// walk.mjs — bounded, read-only file inventory for the Game Reverse Scanner.
//
// walkInput(inputPath, options) accepts a directory or a single file and
// returns { root, files, skipped, warnings, stats }. Traversal never follows
// symbolic links or junctions, never writes anything, reads only a bounded
// header per file, and stops with explicit truncation warnings at the
// configured file/depth limits.

import fs from 'node:fs';
import path from 'node:path';
import { identifyMagic } from './magic.mjs';

export const DEFAULT_MAX_FILES = 50000;
export const DEFAULT_MAX_DEPTH = 40;
export const DEFAULT_HEADER_BYTES = 64;

// Directory names excluded by default (case-insensitive); recorded as skipped,
// never silently treated as inspected. `--include-cache` disables the skip.
const CACHE_DIRS = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '__pycache__',
  '.gradle',
  '.idea',
  '.vs',
  // Game-engine project caches and common tool noise: these hold regenerated
  // artifacts, never shippable content. Deliberately absent: build/dist/saved
  // style directories, which carry real game content or user save data.
  '.godot',
  'library',
  'intermediate',
  'deriveddatacache',
  'obj',
  'cache',
  'caches',
  'temp',
  'tmp',
  'logs',
  '.cache',
  '.pytest_cache',
  '.next',
  '.vite',
]);

function scannerError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function readHeader(absFile, headerBuf) {
  const fd = fs.openSync(absFile, 'r');
  try {
    const bytesRead = fs.readSync(fd, headerBuf, 0, headerBuf.length, 0);
    return headerBuf.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function buildFileEntry(absFile, relPath, headerBuf, ctx) {
  const extension = path.extname(absFile).toLowerCase();
  const entry = {
    path: relPath,
    absolutePath: absFile,
    sizeBytes: 0,
    extension,
    magic: null,
    kind: 'other',
  };
  try {
    entry.sizeBytes = fs.statSync(absFile).size;
    const header = readHeader(absFile, headerBuf);
    entry.magic = identifyMagic(header, extension);
    if (entry.magic) entry.kind = entry.magic.kind;
  } catch {
    ctx.warn('file-read-failed', relPath);
  }
  return entry;
}

export function walkInput(inputPath, options = {}) {
  const maxFiles = Number.isInteger(options.maxFiles) && options.maxFiles > 0 ? options.maxFiles : DEFAULT_MAX_FILES;
  const maxDepth = Number.isInteger(options.maxDepth) && options.maxDepth > 0 ? options.maxDepth : DEFAULT_MAX_DEPTH;
  const headerBytes = Number.isInteger(options.headerBytes) && options.headerBytes > 0 ? options.headerBytes : DEFAULT_HEADER_BYTES;
  const includeCache = options.includeCache === true;

  let inputStat;
  try {
    inputStat = fs.statSync(inputPath);
  } catch {
    throw scannerError('INPUT_NOT_FOUND', `input path not found: ${inputPath}`);
  }

  const ctx = {
    files: [],
    skipped: [],
    warnings: [],
    seenWarnings: new Set(),
    truncated: false,
    dirCount: 0,
    warn(code, warnPath) {
      if (this.seenWarnings.has(code)) return;
      this.seenWarnings.add(code);
      this.warnings.push({ code, path: warnPath });
    },
  };

  const headerBuf = Buffer.alloc(headerBytes);

  if (inputStat.isFile()) {
    const absFile = path.resolve(inputPath);
    const root = path.dirname(absFile);
    ctx.files.push(buildFileEntry(absFile, path.basename(absFile), headerBuf, ctx));
    return { root, files: ctx.files, skipped: ctx.skipped, warnings: ctx.warnings, stats: buildStats(ctx) };
  }

  if (!inputStat.isDirectory()) {
    throw scannerError('INPUT_NOT_FILE_OR_DIR', `input path is neither a file nor a directory: ${inputPath}`);
  }

  const root = path.resolve(inputPath);
  let fileLimitHit = false;
  const stack = [{ abs: root, rel: '', level: 0 }];

  while (stack.length > 0 && !fileLimitHit) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir.abs, { withFileTypes: true });
    } catch {
      const rel = dir.rel || '.';
      ctx.warn('dir-unreadable', rel);
      ctx.skipped.push({ path: rel, reason: 'unreadable' });
      continue;
    }
    ctx.dirCount += 1;

    for (const entry of entries) {
      const childAbs = path.join(dir.abs, entry.name);
      const childRel = dir.rel ? `${dir.rel}/${entry.name}` : entry.name;

      if (entry.isSymbolicLink()) {
        ctx.skipped.push({ path: childRel, reason: 'symlink' });
        continue;
      }
      if (entry.isDirectory()) {
        if (!includeCache && CACHE_DIRS.has(entry.name.toLowerCase())) {
          ctx.skipped.push({ path: childRel, reason: 'cache-excluded' });
          continue;
        }
        const childLevel = dir.level + 1;
        if (childLevel >= maxDepth) {
          ctx.truncated = true;
          ctx.warn('depth-limit-reached', childRel);
          ctx.skipped.push({ path: childRel, reason: 'depth-limit' });
          continue;
        }
        stack.push({ abs: childAbs, rel: childRel, level: childLevel });
        continue;
      }
      if (!entry.isFile()) {
        ctx.skipped.push({ path: childRel, reason: 'special' });
        continue;
      }

      if (ctx.files.length >= maxFiles) {
        fileLimitHit = true;
        ctx.truncated = true;
        ctx.warn('file-limit-reached', childRel);
        break;
      }
      ctx.files.push(buildFileEntry(childAbs, childRel, headerBuf, ctx));
    }
  }

  return { root, files: ctx.files, skipped: ctx.skipped, warnings: ctx.warnings, stats: buildStats(ctx) };
}

function buildStats(ctx) {
  return {
    fileCount: ctx.files.length,
    dirCount: ctx.dirCount,
    skippedCount: ctx.skipped.length,
    truncated: ctx.truncated,
  };
}

// Serialization view for inventory.json: drops internal absolute paths.
export function toInventoryEntry(entry) {
  return {
    path: entry.path,
    sizeBytes: entry.sizeBytes,
    extension: entry.extension,
    magic: entry.magic ? { ...entry.magic } : null,
    kind: entry.kind,
  };
}
