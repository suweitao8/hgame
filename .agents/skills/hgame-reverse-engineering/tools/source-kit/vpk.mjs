#!/usr/bin/env node
// Generic read-only Source Engine VPK (v1/v2) directory index parser & selective subset extractor.
import { createWriteStream, existsSync, mkdirSync, openSync, closeSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const VPK_SIGNATURE = 0x55aa1234;
const VPK_ALT_SIGNATURE = 0x55a033b3;

function readCString(buf, off) {
  const end = buf.indexOf(0, off);
  if (end < 0) throw new Error(`Unterminated string at offset ${off}`);
  return buf.toString('utf8', off, end);
}

export function parseVpkDir(vpkPath) {
  const buf = readFileSync(vpkPath);
  if (buf.length < 12) throw new Error(`VPK header too short: ${vpkPath}`);
  const sig = buf.readUInt32LE(0);
  if (sig !== VPK_SIGNATURE && sig !== VPK_ALT_SIGNATURE) {
    throw new Error(`Invalid VPK signature 0x${sig.toString(16)} in ${vpkPath}`);
  }
  const version = buf.readUInt32LE(4);
  const treeSize = buf.readUInt32LE(8);
  let off = 12;
  const headerExtra = {};
  if (version === 2 && buf.length >= 28) {
    headerExtra.fileDataSize = buf.readUInt32LE(12);
    headerExtra.archiveMd5Size = buf.readUInt32LE(16);
    headerExtra.otherMd5Size = buf.readUInt32LE(20);
    headerExtra.signatureSize = buf.readUInt32LE(24);
    off = 28;
  }

  const entries = [];
  const treeEnd = Math.min(buf.length, off + treeSize);
  while (off < treeEnd) {
    const ext = readCString(buf, off);
    off += ext.length + 1;
    if (ext === '') break;

    while (off < treeEnd) {
      const dir = readCString(buf, off);
      off += dir.length + 1;
      if (dir === '') break;

      while (off < treeEnd) {
        const name = readCString(buf, off);
        off += name.length + 1;
        if (name === '') break;
        if (off + 18 > buf.length) break;

        const crc = buf.readUInt32LE(off);
        const preloadBytes = buf.readUInt16LE(off + 4);
        const archiveIndex = buf.readUInt16LE(off + 6);
        const entryOffset = buf.readUInt32LE(off + 8);
        const entryLength = buf.readUInt32LE(off + 12);
        off += 18;
        if (preloadBytes > 0) off += preloadBytes;

        const dirPrefix = dir && dir !== ' ' ? `${dir}/` : '';
        entries.push({
          path: `${dirPrefix}${name}${ext ? '.' + ext : ''}`,
          ext,
          dir,
          name,
          crc,
          archiveIndex,
          entryOffset,
          entryLength,
          preloadBytes,
          dataOffsetBase: archiveIndex === 0x7fff ? treeEnd : 0,
        });
      }
    }
  }

  return { vpkPath, version, treeSize, headerExtra, entries };
}

export function extractVpkSubset(vpkPath, entries, outDir, options = {}) {
  const exts = new Set((options.exts || ['txt', 'res', 'vdf']).map((e) => String(e).toLowerCase().replace(/^\./, '')));
  const pathPrefixes = (options.pathPrefixes || []).map((p) => String(p).toLowerCase());
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : 128 * 1024 * 1024;

  mkdirSync(outDir, { recursive: true });
  let dirBuf = null;
  let totalBytes = 0;
  let extracted = 0;
  let skipped = 0;
  const openArchives = new Map();

  try {
    for (const entry of entries) {
      if (!exts.has(String(entry.ext).toLowerCase()) || entry.entryLength <= 0) continue;
      if (pathPrefixes.length > 0) {
        const low = entry.path.toLowerCase();
        if (!pathPrefixes.some((pfx) => low.startsWith(pfx))) continue;
      }
      if (totalBytes + entry.entryLength > maxBytes) {
        skipped += 1;
        continue;
      }

      const safeRel = entry.path.replace(/[<>:"|?*]/g, '_');
      const dest = path.join(outDir, safeRel);
      mkdirSync(path.dirname(dest), { recursive: true });

      let chunk = null;
      if (entry.archiveIndex === 0x7fff) {
        if (!dirBuf) dirBuf = readFileSync(vpkPath);
        const start = entry.dataOffsetBase + entry.entryOffset;
        if (start + entry.entryLength <= dirBuf.length) {
          chunk = dirBuf.subarray(start, start + entry.entryLength);
        }
      } else {
        const archivePath = vpkPath.replace(/_dir\.vpk$/i, `_${String(entry.archiveIndex).padStart(3, '0')}.vpk`);
        if (!existsSync(archivePath)) {
          skipped += 1;
          continue;
        }
        let fd = openArchives.get(archivePath);
        if (fd === undefined) {
          fd = openSync(archivePath, 'r');
          openArchives.set(archivePath, fd);
        }
        const fsize = statSync(archivePath).size;
        if (entry.entryOffset + entry.entryLength <= fsize) {
          chunk = Buffer.alloc(entry.entryLength);
          readSync(fd, chunk, 0, entry.entryLength, entry.entryOffset);
        }
      }

      if (!chunk) {
        skipped += 1;
        continue;
      }
      writeFileSync(dest, chunk);
      extracted += 1;
      totalBytes += entry.entryLength;
    }
  } finally {
    for (const fd of openArchives.values()) {
      try { closeSync(fd); } catch {}
    }
  }

  return { extracted, skipped, totalBytes };
}
