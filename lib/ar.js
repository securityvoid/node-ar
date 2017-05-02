"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var Archive = (function () {
    function Archive(data) {
        this.data = data;
        this.files = {};
        // Verify that it begins with "!<arch>\n".
        if (data.toString('utf8', 0, 8) !== "!<arch>\n") {
            throw new Error("Invalid archive file: Missing magic header '!<arch>\\n'");
        }
        this.createFiles();
    }
    /**
     * Detects the header type of each file, and creates an ARFile representing
     * each.
     * Currently only supports BSD-style headers.
     */
    Archive.prototype.createFiles = function () {
        // Should only be called once.
        if (this.files.length > 0)
            return;
        var offset = 8, file;
        while (offset < this.data.length) {
            file = new BSDARFile(this.data.slice(offset));
            this.files[file.name()] = file;
            offset += file.totalSize();
        }
    };
    /**
     * Get an array of the files in the archive.
     */
    Archive.prototype.getFiles = function () { return this.files; };
    Archive.prototype.getFile = function (name) { return this.files[name]; };
    return Archive;
}());
exports.Archive = Archive;
/**
 * Given something of size *size* bytes that needs to be aligned by *alignment*
 * bytes, returns the total number of padding bytes that need to be appended to
 * the end of the data.
 */
function getPaddingBytes(size, alignment) {
    return (alignment - (size % alignment)) % alignment;
}
/**
 * Trims trailing whitespace from the given string (both ends, although we
 * only really need the RHS).
 */
function trimWhitespace(str) {
    return String.prototype.trim ? str.trim() : str.replace(/^\s+|\s+$/gm, '');
}
/**
 * Trims trailing NULL characters.
 */
function trimNulls(str) {
    return str.replace(/\0/g, '');
}
/**
 * All archive variants share this header before files, but the variants differ
 * in how they handle odd cases (e.g. files with spaces, long filenames, etc).
 *
 * char    ar_name[16]; File name
 * char    ar_date[12]; file member date
 * char    ar_uid[6]    file member user identification
 * char    ar_gid[6]    file member group identification
 * char    ar_mode[8]   file member mode (octal)
 * char    ar_size[10]; file member size
 * char    ar_fmag[2];  header trailer string
 */
var ARCommonFile = (function () {
    function ARCommonFile(data) {
        this.data = data;
        if (this.fmag() !== "`\n") {
            throw new Error("Record is missing header trailer string; instead, it has: " + this.fmag());
        }
    }
    ARCommonFile.prototype.name = function () {
        // The name field is padded by whitespace, so trim any lingering whitespace.
        return trimWhitespace(this.data.toString('utf8', 0, 16));
    };
    ARCommonFile.prototype.date = function () { return new Date(parseInt(this.data.toString('ascii', 16, 28), 10)); };
    ARCommonFile.prototype.uid = function () { return parseInt(this.data.toString('ascii', 28, 34), 10); };
    ARCommonFile.prototype.gid = function () { return parseInt(this.data.toString('ascii', 34, 40), 10); };
    ARCommonFile.prototype.mode = function () { return parseInt(this.data.toString('ascii', 40, 48), 8); };
    /**
     * Total size of the data section in the record. Does not include padding bytes.
     */
    ARCommonFile.prototype.dataSize = function () { return parseInt(this.data.toString('ascii', 48, 58), 10); };
    /**
     * Total size of the *file* data in the data section of the record. This is
     * not always equal to dataSize.
     */
    ARCommonFile.prototype.fileSize = function () { return this.dataSize(); };
    ARCommonFile.prototype.fmag = function () { return this.data.toString('ascii', 58, 60); };
    /**
     * Total size of the header, including padding bytes.
     */
    ARCommonFile.prototype.headerSize = function () {
        // The common header is already two-byte aligned.
        return 60;
    };
    /**
     * Total size of this file record (header + header padding + file data +
     * padding before next archive member).
     */
    ARCommonFile.prototype.totalSize = function () {
        var headerSize = this.headerSize(), dataSize = this.dataSize();
        // All archive members are 2-byte aligned, so there's padding bytes after
        // the data section.
        return headerSize + dataSize + getPaddingBytes(dataSize, 2);
    };
    /**
     * Returns a *slice* of the backing buffer that has all of the file's data.
     */
    ARCommonFile.prototype.fileData = function () {
        var headerSize = this.headerSize();
        return this.data.slice(headerSize, headerSize + this.dataSize());
    };
    return ARCommonFile;
}());
exports.ARCommonFile = ARCommonFile;
/**
 * BSD variant of the file header.
 */
var BSDARFile = (function (_super) {
    __extends(BSDARFile, _super);
    function BSDARFile(data) {
        var _this = _super.call(this, data) || this;
        // Check if the filename is appended to the header or not.
        _this.appendedFileName = _super.prototype.name.call(_this).substr(0, 3) === "#1/";
        return _this;
    }
    /**
     * Returns the number of bytes that the appended name takes up in the content
     * section.
     */
    BSDARFile.prototype.appendedNameSize = function () {
        if (this.appendedFileName) {
            return parseInt(_super.prototype.name.call(this).substr(3), 10);
        }
        return 0;
    };
    /**
     * BSD ar stores extended filenames by placing the string "#1/" followed by
     * the file name length in the file name field.
     *
     * Note that this is unambiguous, as '/' is not a valid filename character.
     */
    BSDARFile.prototype.name = function () {
        var length, name = _super.prototype.name.call(this), headerSize;
        if (this.appendedFileName) {
            length = this.appendedNameSize();
            // The filename is stored right after the header.
            headerSize = _super.prototype.headerSize.call(this);
            // Unfortunately, even though they give us the *explicit length*, they add
            // NULL bytes and include that in the length, so we must strip them out.
            name = trimNulls(this.data.toString('utf8', headerSize, headerSize + length));
        }
        return name;
    };
    /**
     * dataSize = appendedNameSize + fileSize
     */
    BSDARFile.prototype.fileSize = function () {
        return this.dataSize() - this.appendedNameSize();
    };
    /**
     * Returns a *slice* of the backing buffer that has all of the file's data.
     * For BSD archives, we need to add in the size of the file name, which,
     * unfortunately, is included in the fileSize number.
     */
    BSDARFile.prototype.fileData = function () {
        var headerSize = this.headerSize(), appendedNameSize = this.appendedNameSize();
        return this.data.slice(headerSize + appendedNameSize, headerSize + appendedNameSize + this.fileSize());
    };
    return BSDARFile;
}(ARCommonFile));
exports.BSDARFile = BSDARFile;
//# sourceMappingURL=ar.js.map