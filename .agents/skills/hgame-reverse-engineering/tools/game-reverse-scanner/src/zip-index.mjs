// zip-index.mjs — read-only ZIP central-directory indexing for the Game
// Reverse Scanner.
//
// indexZipFile(absolutePath, relativePath, options) reads ONLY the end-of-
// central-directory record and the central-directory byte range of a
// ZIP-family file. Member data is never decompressed, extracted, or modified.
// ZIP64 layouts and oversized/corrupt central directories produce explicit
// warnings instead of guessed results.
//
// options.cdMaxBytes caps the central-directory read (default 32 MiB).

import fs from 'node:fs';
import path from 'node:path';

const EOCD_SIG = 0x06054b50;
const EOCD_LOCATOR_SIG = 0x07064b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_MIN_SIZE = 22;
// Fixed EOCD (22) + maximum archive comment (65535).
const EOCD_SCAN_WINDOW = 22 + 65535;
export const DEFAULT_CD_MAX_BYTES = 32 * 1024 * 1024;

const FORMATS = new Map([
  ['.jar', 'jar'],
  ['.apk', 'apk'],
  ['.aab', 'aab'],
  ['.aar', 'aar'],
  ['.ipa', 'ipa'],
  ['.zip', 'zip'],
]);

function formatFor(relativePath) {
  const ext = path.extname(relativePath).toLowerCase();
  return FORMATS.get(ext) ?? 'zip-family';
}

function readAt(fd, buffer, position) {
  let read = 0;
  while (read < buffer.length) {
    const bytesRead = fs.readSync(fd, buffer, read, buffer.length - read, position + read);
    if (bytesRead <= 0) break;
    read += bytesRead;
  }
  return read;
}

export function indexZipFile(absolutePath, relativePath, options = {}) {
  const cdMaxBytes =
    Number.isInteger(options.cdMaxBytes) && options.cdMaxBytes > 0
      ? options.cdMaxBytes
      : DEFAULT_CD_MAX_BYTES;

  const result = { path: relativePath, format: formatFor(relativePath), entries: [], warnings: [] };

  let fd;
  try {
    fd = fs.openSync(absolutePath, 'r');
  } catch {
    result.warnings.push({ code: 'zip-read-failed', path: relativePath });
    return result;
  }

  try {
    const fileSize = fs.fstatSync(fd).size;

    // Locate the end-of-central-directory record by scanning the file tail.
    const scanLen = Math.min(fileSize, EOCD_SCAN_WINDOW);
    const tail = Buffer.alloc(scanLen);
    readAt(fd, tail, fileSize - scanLen);
    let eocdInTail = -1;
    for (let i = tail.length - EOCD_MIN_SIZE; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocdInTail = i;
        break;
      }
    }
    if (eocdInTail < 0) {
      result.warnings.push({ code: 'zip-eocd-not-found', path: relativePath });
      return result;
    }
    const eocdOffset = fileSize - scanLen + eocdInTail;
    const entriesTotal = tail.readUInt16LE(eocdInTail + 10);
    const cdSize = tail.readUInt32LE(eocdInTail + 12);
    const cdOffset = tail.readUInt32LE(eocdInTail + 16);

    // ZIP64 layout: sentinel values mean we cannot trust the classic fields.
    // v0.1 does not index ZIP64 archives — warn instead of guessing.
    const zip64Sentinel =
      entriesTotal === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff;
    if (zip64Sentinel) {
      result.warnings.push({ code: 'zip64-unsupported', path: relativePath });
      return result;
    }

    if (cdOffset + cdSize > fileSize) {
      result.warnings.push({ code: 'zip-central-directory-out-of-range', path: relativePath });
      return result;
    }
    if (cdSize > cdMaxBytes) {
      result.warnings.push({ code: 'zip-central-directory-too-large', path: relativePath });
      return result;
    }

    const cd = Buffer.alloc(cdSize);
    if (readAt(fd, cd, cdOffset) !== cdSize) {
      result.warnings.push({ code: 'zip-central-directory-out-of-range', path: relativePath });
      return result;
    }

    // Parse central-directory headers; member names only, bytes stay on disk.
    let offset = 0;
    let corrupt = false;
    while (offset < cd.length) {
      if (offset + 46 > cd.length || cd.readUInt32LE(offset) !== CENTRAL_HEADER_SIG) {
        corrupt = true;
        break;
      }
      const flags = cd.readUInt16LE(offset + 8);
      const nameLen = cd.readUInt16LE(offset + 28);
      const extraLen = cd.readUInt16LE(offset + 30);
      const commentLen = cd.readUInt16LE(offset + 32);
      const nameStart = offset + 46;
      if (nameStart + nameLen > cd.length) {
        corrupt = true;
        break;
      }
      const encoding = (flags & 0x0800) === 0 ? 'latin1' : 'utf8';
      result.entries.push(cd.toString(encoding, nameStart, nameStart + nameLen));
      offset = nameStart + nameLen + extraLen + commentLen;
    }
    if (corrupt) {
      result.warnings.push({ code: 'zip-central-directory-corrupt', path: relativePath });
    }
    return result;
  } finally {
    fs.closeSync(fd);
  }
}
