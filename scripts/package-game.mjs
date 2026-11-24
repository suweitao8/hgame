#!/usr/bin/env node
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { runToyPreflight } from './toy-preflight.mjs';
import { normalizeReleaseProfile, runtimeSeeds, THREE_KTX2_FILES } from './project-profiles.mjs';
import { PIXI_BUNDLER_PATH, casObjectPath, hashPixiSources, matchPixiBuildBytes, readAssetManifest, readPixiBuildManifest, readProjectAssetCatalog, resolveAssetStoreDir, shouldIgnoreForAssetTracking } from './assets.mjs';
import { auditKtx2Textures } from './lib/toktx.mjs';

const DEFAULT_ENGINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const RUNTIME_DIR_PREFIXES = new Set([
  'core',
  'platform',
  'integrations',
  'ui',
  'vfx',
  'sim',
  'ai',
  'gameplay',
  'world',
  'time',
  'animation',
  'physics',
  'lockstep',
]);

const AUTHORING_ASSET_DIRS = new Set([
  'raw',
  'art_src',
  'source',
  '.git',
  '.agents',
  '.re-workspace',
  'node_modules',
  '.cache',
]);

const AUTHORING_EXTS = new Set([
  '.psd',
  '.blend',
  '.blend1',
  '.fbx',
  '.aseprite',
  '.ase',
  '.kra',
  '.xcf',
  '.max',
  '.ma',
  '.mb',
  '.log',
  '.md',
  '.map',
  '.ts',
  '.bak',
  '.tmp',
]);

const SKIP_BASENAMES = new Set([
  '.ds_store',
  'thumbs.db',
  '.gitkeep',
  'assets.manifest.json',
  'toy.yaml',
]);

const REGEX_PREV_KEYWORDS = new Set([
  'return',
  'throw',
  'case',
  'yield',
  'await',
  'typeof',
  'void',
  'delete',
  'in',
  'instanceof',
  'of',
  'else',
]);

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    c = CRC32_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Formats a version string (`"1.1"`, `"1.1.0"`, `"1.0.3"`) into a clean underscore suffix
 * (`"1_1"`, `"1_0"`, `"1_0_3"`).
 *
 * @param {string} version
 * @returns {string}
 */
export function formatVersionSlug(version) {
  if (typeof version !== 'string' || !version.trim()) {
    throw new TypeError('Version must be a non-empty string');
  }
  const cleaned = version.trim().replace(/^[vV]/, '');
  const zeroPatch = /^(\d+)\.(\d+)\.0$/.exec(cleaned);
  if (zeroPatch) {
    return `${zeroPatch[1]}_${zeroPatch[2]}`;
  }
  const slug = cleaned
    .replace(/[.\-+]+/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug) {
    throw new RangeError(`Cannot derive version slug from "${version}"`);
  }
  return slug;
}

/**
 * Formats the release directory and archive basename (`lol_1_1`, `hgame_1_0`).
 *
 * @param {string} id
 * @param {string} version
 * @param {string} [explicitTag]
 * @returns {string}
 */
export function formatReleaseTag(id, version, explicitTag) {
  let tag;
  if (explicitTag !== undefined && explicitTag !== null && explicitTag !== '') {
    tag = String(explicitTag).trim();
  } else {
    if (typeof id !== 'string' || !id.trim()) {
      throw new TypeError('Game ID must be a non-empty string');
    }
    const base = id.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    const ver = formatVersionSlug(version);
    tag = `${base}_${ver}`;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(tag)) {
    throw new RangeError(`Invalid release tag: "${tag}"`);
  }
  return tag;
}

function encodeDosDateTime(dateInput = new Date()) {
  const d = dateInput instanceof Date && Number.isFinite(dateInput.getTime())
    ? dateInput
    : new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
  const year = d.getFullYear();
  if (year < 1980) {
    return { dosTime: 0, dosDate: ((2026 - 1980) << 9) | (1 << 5) | 1 };
  }
  const dosTime = ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((d.getSeconds() >> 1) & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0x0f) << 5) |
    (d.getDate() & 0x1f);
  return { dosTime, dosDate };
}

/**
 * Creates an uncompressed/DEFLATE standard PKZIP buffer from `{ path, data, mtime? }[]`.
 *
 * @param {Array<{ path: string, data: Buffer | Uint8Array, mtime?: Date }>} entries
 * @returns {Buffer}
 */
export function createZipBuffer(entries) {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of sorted) {
    const entryName = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
    // reject path traversal at segment level only ('..', 'a/../b'); basenames like
    // "cross_icon..png" from an original asset pack are legitimate (double dot, no slash)
    if (!entryName || entryName === '.' || entryName.split('/').includes('..') || entryName.includes('\0')) {
      throw new RangeError(`Unsafe ZIP entry name: "${entry.path}"`);
    }
    const nameBuf = Buffer.from(entryName, 'utf8');
    const rawBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(rawBuf);
    const deflated = rawBuf.length > 0 ? zlib.deflateRawSync(rawBuf, { level: 9 }) : rawBuf;
    const useDeflate = rawBuf.length > 0 && deflated.length < rawBuf.length;
    const method = useDeflate ? 8 : 0;
    const payload = useDeflate ? deflated : rawBuf;
    const { dosTime, dosDate } = encodeDosDateTime(entry.mtime);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed 2.0
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len

    localParts.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 filename flag
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra len
    centralHeader.writeUInt16LE(0, 32); // comment len
    centralHeader.writeUInt16LE(0, 34); // disk start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(sorted.length, 8);
  eocd.writeUInt16LE(sorted.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

async function collectFilesRecursively(dir, include = () => true) {
  const out = [];
  async function walk(curr, prefix) {
    const dirents = await readdir(curr, { withFileTypes: true });
    for (const d of dirents) {
      const nextRel = prefix ? `${prefix}/${d.name}` : d.name;
      if (!include(nextRel)) continue;
      const abs = path.join(curr, d.name);
      if (d.isDirectory()) {
        await walk(abs, nextRel);
      } else if (d.isFile()) {
        out.push({ rel: nextRel, abs });
      }
    }
  }
  await walk(dir, '');
  return out;
}

/**
 * Packages every file inside `sourceDir` into `zipFilePath` using only Node built-ins.
 */
export async function writeZipArchive(sourceDir, zipFilePath, { rootPrefix = '', mtime } = {}) {
  const files = (await collectFilesRecursively(sourceDir))
    .sort((a, b) => a.rel < b.rel ? -1 : a.rel === b.rel ? 0 : 1);
  const cleanPrefix = rootPrefix ? rootPrefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
  const entries = await Promise.all(
    files.map(async ({ rel, abs }) => {
      const [data, st] = await Promise.all([readFile(abs), stat(abs)]);
      const zipPath = cleanPrefix ? `${cleanPrefix}/${rel}` : rel;
      return { path: zipPath, data, mtime: mtime ?? st.mtime };
    }),
  );
  const buf = createZipBuffer(entries);
  await mkdir(path.dirname(zipFilePath), { recursive: true });
  await writeFile(zipFilePath, buf);
  return {
    zipPath: zipFilePath,
    entryCount: entries.length,
    compressedBytes: buf.length,
    uncompressedBytes: entries.reduce((sum, e) => sum + e.data.length, 0),
  };
}

// Assemble next to the destination so publishing and rollback can use renames.
// The previous release stays available throughout compression and preflight.
async function stageRelease(targetDir, zipPath, assemble) {
  const parent = path.dirname(targetDir);
  await mkdir(parent, { recursive: true });
  const stage = await mkdtemp(path.join(parent, '.hgame-release-'));
  if (path.dirname(stage) !== parent || path.dirname(zipPath) !== parent) {
    throw new Error('Invalid release staging directory');
  }
  const files = path.join(stage, 'files');
  const archive = path.join(stage, 'release.zip');
  const lock = path.join(parent, '.' + path.basename(targetDir) + '.publish');
  let preserveStage = false;
  try {
    await mkdir(files);
    const result = await assemble(files, archive);
    await mkdir(lock);
    try {
      const undo = [];
      async function move(from, to, { optional = false } = {}) {
        try { await rename(from, to); }
        catch (error) {
          if (optional && error.code === 'ENOENT') return;
          throw error;
        }
        undo.push([to, from]);
      }
      try {
        await move(targetDir, path.join(stage, 'previous'), { optional: true });
        await move(zipPath, path.join(stage, 'previous.zip'), { optional: true });
        await move(files, targetDir);
        await move(archive, zipPath);
      } catch (error) {
        const rollbackErrors = [];
        for (const [from, to] of undo.reverse()) {
          try { await rename(from, to); } catch (failure) { rollbackErrors.push(failure); }
        }
        if (rollbackErrors.length) {
          preserveStage = true;
          throw new AggregateError([error, ...rollbackErrors], 'Release rollback was incomplete. Backups are in ' + stage);
        }
        throw error;
      }
    } finally {
      await rmdir(lock);
    }
    return result;
  } finally {
    if (!preserveStage) await rm(stage, { recursive: true, force: true });
  }
}

const RELEASE_ZIP_DATE = new Date(1980, 0, 1);

function toPosixRel(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isExternalSpecifier(spec) {
  if (!spec) return true;
  if (spec.startsWith('#') || spec.startsWith('data:') || spec.startsWith('blob:') || spec.startsWith('node:')) {
    return true;
  }
  return /^(?:https?:|mailto:|tel:|\/\/)/i.test(spec);
}

function stripJsComments(source) {
  let out = '';
  let i = 0;
  const len = source.length;
  let lastWord = '';
  let lastNonWs = '';

  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < len) {
        const c = source[i];
        out += c;
        if (c === '\\') {
          if (i + 1 < len) {
            out += source[i + 1];
            i += 2;
          } else {
            i++;
          }
          continue;
        }
        i++;
        if (c === quote) break;
      }
      lastWord = '';
      lastNonWs = quote;
      continue;
    }

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && source[i] !== '\n') i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }

    if (
      ch === '/' &&
      (lastNonWs === '' ||
        '=([,:;!&|?{}~^+-*%<>\n'.includes(lastNonWs) ||
        REGEX_PREV_KEYWORDS.has(lastWord))
    ) {
      out += ch;
      i++;
      let inClass = false;
      while (i < len) {
        const c = source[i];
        out += c;
        if (c === '\\') {
          if (i + 1 < len) {
            out += source[i + 1];
            i += 2;
          } else {
            i++;
          }
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']' && inClass) inClass = false;
        else if (c === '/' && !inClass) {
          i++;
          break;
        } else if (c === '\n') {
          i++;
          break;
        }
        i++;
      }
      lastWord = '';
      lastNonWs = '/';
      continue;
    }

    out += ch;
    if (/\s/.test(ch)) {
      if (ch === '\n') {
        lastNonWs = '\n';
        lastWord = '';
      }
    } else if (/[A-Za-z0-9_$]/.test(ch)) {
      lastWord += ch;
      lastNonWs = ch;
    } else {
      lastWord = '';
      lastNonWs = ch;
    }
    i++;
  }
  return out;
}

function extractModuleSpecifiers(code, { isApplicationCore = false, includeSrcSubpaths = false, pixiBuildFiles } = {}) {
  const clean = stripJsComments(code);
  const specifiers = [];
  const urls = [];

  const sideEffectImportRe = /(?:^|[;\n}])\s*import\s*['"]([^'"]+)['"]/g;
  const importFromRe = /\bimport\b\s*(?:\*\s*as\s+[\w$]+|[\w$]+(?:\s*,\s*(?:\*\s*as\s+[\w$]+|\{[^}]*\}))?|\{[^}]*\})\s*\bfrom\s*['"]([^'"]+)['"]/g;
  const exportFromRe = /\bexport\b\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*\bfrom\s*['"]([^'"]+)['"]/g;
  const dynamicImportRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const newUrlRe = /\bnew\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;

  for (const re of [sideEffectImportRe, importFromRe, exportFromRe]) {
    let m;
    while ((m = re.exec(clean)) !== null) {
      specifiers.push(m[1]);
    }
  }

  let m;
  while ((m = dynamicImportRe.exec(clean)) !== null) {
    if (isApplicationCore && /^\.\.\/(?:physics\/rapier|animation\/|world\/tilemap)/.test(m[1])) {
      continue;
    }
    specifiers.push(m[1]);
  }

  while ((m = newUrlRe.exec(clean)) !== null) {
    urls.push(m[1]);
  }

  const runtimeSubpaths = [];
  if (includeSrcSubpaths) {
    const literalRe = /['"`]([^'"`\r\n]+)['"`]/g;
    const subpathMatchRe = /(?:^|vendor\/hgame\/|runtime\/hgame\/|\/)((?:core|platform|integrations|ui|vfx|sim|ai|gameplay|world|time|animation|physics|lockstep)\/[A-Za-z0-9_./-]+\.m?js)$/i;
    let lit;
    while ((lit = literalRe.exec(clean)) !== null) {
      const raw = lit[1].replace(/\$\{[^}]+\}/g, '');
      const cleanSub = raw.replace(/^\/+/, '');
      if (cleanSub === 'index.js') {
        runtimeSubpaths.push('vendor/hgame/index.js');
        continue;
      }
      const match = subpathMatchRe.exec(raw);
      if (match) {
        const sub = match[1];
        const firstSeg = sub.split('/')[0];
        if (RUNTIME_DIR_PREFIXES.has(firstSeg)) {
          runtimeSubpaths.push(`vendor/hgame/${sub}`);
        }
      }
    }
  }

  const buildSubpaths = [];
  if (pixiBuildFiles) {
    // Preload tables and literal dynamic imports both reference hashed output files.
    for (const match of clean.matchAll(/(['"\x60])((?:assets\/|\.\/)[A-Za-z0-9_.-]+)\1/g)) {
      const output = match[2].startsWith('./') ? 'assets/' + match[2].slice(2) : match[2];
      if (pixiBuildFiles.has(output)) buildSubpaths.push(output);
    }
    // Vite may rename loadRuntime(), but its literal module arguments survive.
    // Scan actual chunks in the entry graph, not all source files or assets.
    const literalPath = /(['"`])((?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9_-]+\.m?js|index\.js)\1/g;
    while ((m = literalPath.exec(clean)) !== null) {
      const sub = m[2];
      if (sub === 'index.js' || RUNTIME_DIR_PREFIXES.has(sub.split('/')[0])) {
        runtimeSubpaths.push('vendor/hgame/' + sub);
      }
    }
  }

  return { specifiers, urls, runtimeSubpaths, buildSubpaths };
}

function extractCssDependencies(cssText) {
  const deps = [];
  const stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const importRe = /@import\s+(?:url\(\s*)?['"]?([^'")\s]+)['"]?\s*\)?/gi;
  const urlRe = /\burl\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi;
  let m;
  while ((m = importRe.exec(stripped)) !== null) deps.push(m[1]);
  while ((m = urlRe.exec(stripped)) !== null) deps.push(m[1]);
  return deps;
}

function parseEntryHtml(htmlText) {
  const importMap = new Map();
  const assetRefs = [];
  const inlineModules = [];

  const importMapRe = /<script\b[^>]*\btype\s*=\s*["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = importMapRe.exec(htmlText)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed?.imports && typeof parsed.imports === 'object') {
        for (const [k, v] of Object.entries(parsed.imports)) {
          if (typeof v === 'string') importMap.set(k, v);
        }
      }
    } catch {
      // Ignore malformed optional import maps cleanly.
    }
  }

  const linkRe = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((m = linkRe.exec(htmlText)) !== null) {
    if (!isExternalSpecifier(m[1])) assetRefs.push(m[1]);
  }

  const scriptSrcRe = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((m = scriptSrcRe.exec(htmlText)) !== null) {
    if (!isExternalSpecifier(m[1])) assetRefs.push(m[1]);
  }

  const inlineScriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  while ((m = inlineScriptRe.exec(htmlText)) !== null) {
    if (/\bsrc\s*=|\btype\s*=\s*["']importmap["']/i.test(m[1])) continue;
    if (m[2].trim()) inlineModules.push(m[2]);
  }

  return { importMap, assetRefs, inlineModules };
}

function assertWasmMagic(buffer, label) {
  if (
    !buffer ||
    buffer.length < 4 ||
    buffer[0] !== 0x00 ||
    buffer[1] !== 0x61 ||
    buffer[2] !== 0x73 ||
    buffer[3] !== 0x6d
  ) {
    throw new Error(`Invalid WASM binary header for ${label}`);
  }
}

async function existsFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function existsDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function loadOptionalEsbuild(minifyEnabled) {
  if (!minifyEnabled) return null;
  try {
    return await import('esbuild');
  } catch {
    return null;
  }
}

function findNearestEngineRoot(startDir) {
  const candidates = [DEFAULT_ENGINE_ROOT];
  let curr = path.resolve(startDir);
  for (let i = 0; i < 4; i++) {
    candidates.push(curr);
    const next = path.dirname(curr);
    if (next === curr) break;
    curr = next;
  }
  for (const dir of candidates) {
    if (
      fs.existsSync(path.join(dir, 'assets', 'runtime', 'VERSION')) &&
      fs.existsSync(path.join(dir, 'assets', 'runtime', 'core', 'config.js'))
    ) {
      return dir;
    }
  }
  return null;
}

const PHYSICS_USAGE_RE = /\.physics\b|physics\/rapier|rapier(?:2d|3d)\b|RapierPhysicsWorld|createRapier/;

/**
 * Decides whether the Rapier WASM backend must ship. Explicit
 * game.config.json physics.bundleWasm wins; otherwise statically scan
 * game sources for physics usage. Uncertain scans keep the safe default (bundle).
 */
async function decidePhysicsBundle(absGameDir, gameConfig, project) {
  const flag = gameConfig?.physics?.bundleWasm;
  if (typeof flag === 'boolean') {
    return { bundle: flag, reason: 'game.config.json physics.bundleWasm=' + flag, note: null };
  }
  const texts = [];
  const srcRoot = path.join(absGameDir, 'src');
  if (await existsDir(srcRoot)) {
    for (const f of await collectFilesRecursively(srcRoot)) {
      const parts = f.rel.toLowerCase().split('/');
      if (parts.some(p => p === 'tests' || p === '__tests__') || /\.(test|spec)\.[cm]?js$/i.test(f.rel)) continue;
      if (/\.(m?js|html?)$/i.test(f.rel)) texts.push(await readFile(f.abs, 'utf8'));
    }
  }
  const entry = path.join(absGameDir, (gameConfig.entry || 'index.html').replace(/^\/+/, ''));
  if (await existsFile(entry)) texts.push(await readFile(entry, 'utf8'));
  if (!(await existsFile(path.join(srcRoot, 'main.js')))) {
    return { bundle: true, reason: 'scan uncertain', note: 'Note: could not scan game sources for physics usage; bundling Rapier WASM (set physics.bundleWasm in game.config.json to override).' };
  }
  if (texts.some(t => PHYSICS_USAGE_RE.test(t))) {
    return { bundle: true, reason: 'physics usage detected', note: null };
  }
  return {
    bundle: false, reason: 'no scene.physics / Rapier usage found in src',
    note: 'Note: ' + project.physics + ' is declared but src never uses scene.physics; Rapier WASM omitted and the physics feature stripped from the packaged engine.config.json (set physics.bundleWasm=true in game.config.json to force it).',
  };
}

/**
 * Packages a standalone HGame project into `build/<id>_<version>/` and `build/<id>_<version>.zip`
 * containing only the active runtime modules, deterministic WASM backend, and runtime assets.
 *
 * When `target === 'toy'`, builds a Bilibili Toy compliant package: flat ZIP root,
 * content-hashed entry JS/CSS for cross-version cache reuse, optional `toy-sdk.js` head injection,
 * and automatic `runToyPreflight` validation.
 *
 * Every packaged `.ktx2` must be genuinely compressed (ETC1S / UASTC) and carry a mip chain once
 * large enough to alias; the package is not written otherwise. `allowUncompressedKtx2` is a
 * development-only escape hatch.
 */
export async function packageGameRelease({
  projectDir = process.cwd(),
  version,
  id,
  tag,
  outDir,
  engineRoot,
  assetStore,
  flatZip,
  minify = true,
  target = 'standard',
  toySdk,
  slug,
  poster,
  icon,
  allowUncompressedKtx2 = false,
} = {}) {
  if (target !== 'standard' && target !== 'toy') {
    throw new RangeError(`Unsupported package target "${target}". Use "standard" or "toy".`);
  }
  const effectiveFlatZip = flatZip ?? (target === 'toy');
  const absGameDir = path.resolve(projectDir);
  const gameConfigPath = path.join(absGameDir, 'game.config.json');
  const engineConfigPath = path.join(absGameDir, 'engine.config.json');

  if (!(await existsFile(gameConfigPath)) || !(await existsFile(engineConfigPath))) {
    throw new Error(`Expected game.config.json and engine.config.json in ${absGameDir}`);
  }

  const gameConfig = JSON.parse(await readFile(gameConfigPath, 'utf8'));
  const engineConfig = JSON.parse(await readFile(engineConfigPath, 'utf8'));
  const releaseProfilePath = path.join(absGameDir, 'hgame.project.json');
  const releaseProfile = normalizeReleaseProfile(await existsFile(releaseProfilePath)
    ? JSON.parse(await readFile(releaseProfilePath, 'utf8')) : undefined);
  let pixiBuild = await readPixiBuildManifest(absGameDir);
  if (pixiBuild.sourceHash && pixiBuild.sourceHash !== await hashPixiSources(absGameDir)) {
    const dependency = await existsFile(path.join(absGameDir, PIXI_BUNDLER_PATH))
      ? 'node_modules/esbuild/package.json'
      : 'node_modules/vite/bin/vite.js';
    if (!(await existsFile(path.join(absGameDir, dependency)))) {
      throw new Error('Pixi source changed since the last build. Install the project dependencies with npm ci before packaging.');
    }
    const build = spawnSync(process.execPath, ['scripts/install-pixi-build.mjs', '--build'], {
      cwd: absGameDir, stdio: ['ignore', 2, 2], windowsHide: true,
    });
    if (build.error) throw build.error;
    if (build.status !== 0) throw new Error('Pixi compilation failed before packaging.');
    pixiBuild = await readPixiBuildManifest(absGameDir);
  }
  const pixiBuildFiles = new Map([...pixiBuild.files].map(([name, hash]) => ['assets/' + name, hash]));
  const { assets: assetManifest } = await readAssetManifest(absGameDir);
  const storeDir = resolveAssetStoreDir(assetStore);

  const resolvedEngineRoot = engineRoot
    ? path.resolve(engineRoot)
    : findNearestEngineRoot(absGameDir);

  const localConfigJs = path.join(absGameDir, 'vendor', 'hgame', 'core', 'config.js');
  const fallbackConfigJs = resolvedEngineRoot
    ? path.join(resolvedEngineRoot, 'assets', 'runtime', 'core', 'config.js')
    : '';
  const configJsPath = (await existsFile(localConfigJs)) ? localConfigJs : fallbackConfigJs;
  if (!configJsPath || !(await existsFile(configJsPath))) {
    throw new Error('Cannot locate HGame core/config.js to validate engine.config.json');
  }

  const { defineProject } = await import(pathToFileURL(configJsPath).href);
  let project = defineProject(engineConfig);
  const notes = [];

  // Decide whether the Rapier WASM backend is bundled. Declaring a physics
  // feature alone is not enough: the game must actually use scene.physics /
  // Rapier modules, or set physics.bundleWasm in game.config.json.
  let physicsDecision = null;
  if (project.physics === 'rapier2d' || project.physics === 'rapier3d') {
    physicsDecision = await decidePhysicsBundle(absGameDir, gameConfig, project);
    if (physicsDecision.note) notes.push(physicsDecision.note);
    if (!physicsDecision.bundle) {
      const stripped = new Set(['physics2d', 'physics3d']);
      project = defineProject({
        ...engineConfig,
        physics: 'none',
        features: (engineConfig.features || project.features).filter(f => !stripped.has(f)),
      });
    }
  }

  const effectiveId = id || gameConfig.id || path.basename(absGameDir);
  const effectiveVersion = version || gameConfig.version || '0.1.0';
  const releaseTag = formatReleaseTag(effectiveId, effectiveVersion, tag);

  const resolvedOutParent = outDir ? path.resolve(outDir) : path.join(absGameDir, 'build');
  const targetDir = path.join(resolvedOutParent, releaseTag);
  const zipPath = path.join(resolvedOutParent, `${releaseTag}.zip`);

  const includedFiles = new Map(); // relPosix -> absSourcePath
  const generatedBuffers = new Map(); // relPosix -> Buffer

  function resolveSourceCandidate(relPosix) {
    const localAbs = path.join(absGameDir, relPosix);
    if (fs.existsSync(localAbs) && fs.statSync(localAbs).isFile()) {
      return localAbs;
    }
    const buildHash = pixiBuildFiles.get(relPosix);
    if (buildHash && assetManifest[relPosix.slice('assets/'.length)]?.sha256 === buildHash) {
      const blob = casObjectPath(storeDir, buildHash);
      if (fs.existsSync(blob) && fs.statSync(blob).isFile()) return blob;
    }
    if (resolvedEngineRoot && relPosix.startsWith('vendor/hgame/')) {
      const fallbackRel = relPosix.slice('vendor/hgame/'.length);
      const fallbackAbs = path.join(resolvedEngineRoot, 'assets', 'runtime', fallbackRel);
      if (fs.existsSync(fallbackAbs) && fs.statSync(fallbackAbs).isFile()) {
        return fallbackAbs;
      }
    }
    return null;
  }

  function isForbiddenRuntimeRel(relPosix) {
    if (
      relPosix.startsWith('.agents/') ||
      relPosix.startsWith('.re-workspace/') ||
      relPosix.startsWith('.hgame.local') ||
      relPosix === 'scripts/re-pipeline.mjs' ||
      relPosix === 'scripts/doctor-playability.mjs' ||
      relPosix === 'scripts/sync-skills.mjs'
    ) {
      return true;
    }
    if (relPosix.startsWith('vendor/hgame/vendor/rapier2d/')) {
      return project.physics !== 'rapier2d';
    }
    if (relPosix.startsWith('vendor/hgame/vendor/rapier3d/')) {
      return project.physics !== 'rapier3d';
    }
    if (relPosix === 'vendor/hgame/physics/rapier2d.js') {
      return project.physics !== 'rapier2d';
    }
    if (relPosix === 'vendor/hgame/physics/rapier3d.js') {
      return project.physics !== 'rapier3d';
    }
    if (relPosix.startsWith('assets/vendor/three/') && project.profile !== '3d') {
      return true;
    }
    return false;
  }

  function resolveModulePath(specifier, importerRel, importMap) {
    if (!specifier || isExternalSpecifier(specifier)) return null;
    if (importMap.has(specifier)) {
      return toPosixRel(path.posix.normalize(importMap.get(specifier).split(/[?#]/)[0]));
    }
    const cleanSpec = specifier.split(/[?#]/)[0];
    if (cleanSpec.startsWith('/')) {
      return toPosixRel(path.posix.normalize(cleanSpec.slice(1)));
    }
    if (cleanSpec.startsWith('.')) {
      const baseDir = path.posix.dirname(importerRel);
      const joined = baseDir === '.' ? cleanSpec : `${baseDir}/${cleanSpec}`;
      const normalized = toPosixRel(path.posix.normalize(joined));
      if (normalized.startsWith('../')) return null;
      return normalized;
    }
    return null;
  }

  // Write normalized release configs
  const releaseGameConfig = { ...gameConfig, id: effectiveId, version: String(effectiveVersion) };
  generatedBuffers.set('game.config.json', Buffer.from(JSON.stringify(releaseGameConfig, null, 2) + '\n'));
  generatedBuffers.set('engine.config.json', Buffer.from(JSON.stringify(project, null, 2) + '\n'));

  const entryRel = toPosixRel((gameConfig.entry || 'index.html').replace(/^\/+/, ''));
  if (/[:\x00-\x1f]/.test(entryRel) || entryRel.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Game entry must be a relative path inside the project: ' + entryRel);
  }
  const entryAbs = resolveSourceCandidate(entryRel);
  if (!entryAbs) {
    throw new Error(`Entry HTML file missing: ${entryRel}`);
  }
  includedFiles.set(entryRel, entryAbs);

  const htmlText = await readFile(entryAbs, 'utf8');
  const { importMap, assetRefs, inlineModules } = parseEntryHtml(htmlText);

  const traceQueue = [];
  const tracedSet = new Set();

  function enqueueRel(relPosix, required = false) {
    const norm = toPosixRel(path.posix.normalize(relPosix));
    if (!norm || norm === '.' || norm.startsWith('../')) return;
    if (isForbiddenRuntimeRel(norm)) {
      if (required) throw new Error('Required runtime module is incompatible with engine.config.json: ' + norm);
      return;
    }
    if (tracedSet.has(norm)) return;
    const abs = resolveSourceCandidate(norm);
    if (!abs) {
      if (required) {
        throw new Error(`Required release file missing: ${norm}`);
      }
      return;
    }
    tracedSet.add(norm);
    includedFiles.set(norm, abs);
    traceQueue.push({ rel: norm, abs });
  }

  for (const ref of assetRefs) {
    const resolved = resolveModulePath(ref, entryRel, importMap);
    if (resolved) enqueueRel(resolved, pixiBuildFiles.has(resolved));
  }

  // Older standalone projects can rely on the root facade through computed module paths.
  // Entry-graph projects include it only when it is referenced or explicitly requested.
  enqueueRel('vendor/hgame/VERSION', false);
  if (releaseProfile.runtime === 'compat') enqueueRel('vendor/hgame/index.js', true);
  for (const module of runtimeSeeds(project)) enqueueRel('vendor/hgame/' + module, false);
  for (const module of releaseProfile.includeRuntime) enqueueRel('vendor/hgame/' + module, true);
  for (const module of releaseProfile.includeSource) enqueueRel('src/' + module, true);

  // Include source data files. Entry-graph projects reach JS through the HTML, imports and explicit includes.
  const srcRoot = path.join(absGameDir, 'src');
  if (await existsDir(srcRoot)) {
    const srcFiles = await collectFilesRecursively(srcRoot);
    for (const f of srcFiles) {
      const lower = f.rel.toLowerCase();
      const parts = lower.split('/');
      if (parts.some(p => p === 'tests' || p === '__tests__' || p === '.agents' || p === '.re-workspace' || p.startsWith('.hgame.local'))) continue;
      if (/\.(test|spec)\.[cm]?js$/i.test(lower)) continue;
      if (releaseProfile.runtime === 'entry-graph' && /\.m?js$/i.test(lower)) continue;
      if (AUTHORING_EXTS.has(path.posix.extname(lower)) || SKIP_BASENAMES.has(path.posix.basename(lower))) {
        continue;
      }
      enqueueRel(`src/${toPosixRel(f.rel)}`, false);
    }
  }

  // Inline <script type="module"> inside index.html
  for (const snippet of inlineModules) {
    const { specifiers, urls, runtimeSubpaths } = extractModuleSpecifiers(snippet, {
      includeSrcSubpaths: true,
    });
    for (const s of [...specifiers, ...urls]) {
      const target = resolveModulePath(s, entryRel, importMap);
      if (target) enqueueRel(target, false);
    }
    for (const sub of runtimeSubpaths) enqueueRel(sub, false);
  }

  // game.config.json release.includeDirs: wholesale static directories referenced
  // via runtime fetch()/url() (content JSONs, asset mirrors) that the ES import
  // graph cannot see. Paths are game-root relative, packaged as-is.
  for (const dir of (gameConfig.release?.includeDirs ?? [])) {
    const absDir = path.join(absGameDir, toPosixRel(dir));
    if (await existsDir(absDir)) {
      for (const f of await collectFilesRecursively(absDir)) {
        enqueueRel(toPosixRel(path.join(toPosixRel(dir), f.rel)), false);
      }
    }
  }

  // Traverse module & CSS dependency graph
  while (traceQueue.length > 0) {
    const { rel, abs } = traceQueue.shift();
    const ext = path.posix.extname(rel).toLowerCase();
    if (ext === '.js' || ext === '.mjs') {
      const code = await readFile(abs, 'utf8');
      const { specifiers, urls, runtimeSubpaths, buildSubpaths } = extractModuleSpecifiers(code, {
        isApplicationCore: rel === 'vendor/hgame/core/application.js',
        includeSrcSubpaths: rel.startsWith('src/'),
        pixiBuildFiles: pixiBuildFiles.has(rel) ? pixiBuildFiles : undefined,
      });
      for (const s of [...specifiers, ...urls]) {
        const target = resolveModulePath(s, rel, importMap);
        if (target) enqueueRel(target, pixiBuildFiles.has(target));
      }
      for (const sub of runtimeSubpaths) {
        enqueueRel(sub, false);
      }
      for (const sub of buildSubpaths) {
        enqueueRel(sub, true);
      }
    } else if (ext === '.css') {
      const css = await readFile(abs, 'utf8');
      for (const ref of extractCssDependencies(css)) {
        const target = resolveModulePath(ref, rel, importMap);
        if (target) enqueueRel(target, pixiBuildFiles.has(target));
      }
    }
  }

  // Preserve Third-Party Licenses cleanly
  for (const license of ['LICENSE-pixijs.txt', 'LICENSE-pixi-filters.txt', 'LICENSE-gsap.txt']) {
    enqueueRel(license, false);
  }
  if ([...includedFiles.keys()].some(k => k.startsWith('assets/vendor/three/'))) {
    enqueueRel('assets/vendor/three/LICENSE', false);
    if (includedFiles.has('assets/vendor/three/jsm/libs/meshopt_decoder.module.js')) {
      enqueueRel('assets/vendor/three/jsm/libs/LICENSE-meshoptimizer.txt', true);
    }
    if (includedFiles.has('assets/vendor/three/jsm/loaders/KTX2Loader.js')) {
      for (const file of THREE_KTX2_FILES) enqueueRel('assets/vendor/three/' + file, true);
    }
  }

  // Strictly verify and package deterministic Rapier WASM only when the game uses physics
  let includedWasm = null;
  if (project.physics === 'rapier2d' || project.physics === 'rapier3d') {
    const dim = project.physics === 'rapier2d' ? '2d' : '3d';
    const mjsRel = `vendor/hgame/vendor/rapier${dim}/rapier${dim}.mjs`;
    const wasmRel = `vendor/hgame/vendor/rapier${dim}/rapier${dim}.wasm`;
    const licenseRel = 'vendor/hgame/vendor/LICENSE-rapier.txt';

    const mjsAbs = resolveSourceCandidate(mjsRel);
    const wasmAbs = resolveSourceCandidate(wasmRel);
    const licenseAbs = resolveSourceCandidate(licenseRel);
    if (!mjsAbs || !wasmAbs || !licenseAbs) {
      throw new Error(
        `Missing deterministic Rapier${dim.toUpperCase()} bundle (${wasmRel}). Rebuild engine physics or provide --engine-root.`,
      );
    }
    const wasmBytes = await readFile(wasmAbs);
    assertWasmMagic(wasmBytes, wasmRel);
    includedFiles.set(mjsRel, mjsAbs);
    includedFiles.set(wasmRel, wasmAbs);
    includedFiles.set(licenseRel, licenseAbs);
    includedWasm = wasmRel;
  }

  // Copy non-Three runtime game assets while excluding authoring raw files (PSD/Blend/FBX/raw/)
  const assetsRoot = path.join(absGameDir, 'assets');
  if (releaseProfile.assetMode === 'all' && await existsDir(assetsRoot)) {
    const allAssets = await collectFilesRecursively(assetsRoot);
    for (const f of allAssets) {
      const relPosix = toPosixRel(f.rel);
      if (pixiBuildFiles.has('assets/' + relPosix)) continue;
      const parts = relPosix.split('/');
      const lowerParts = parts.map(p => p.toLowerCase());
      if (lowerParts[0] === 'vendor' && lowerParts[1] === 'three') {
        continue; // Already strictly traced above if profile === '3d'.
      }
      if (lowerParts.some(p => AUTHORING_ASSET_DIRS.has(p))) continue;
      const base = lowerParts[lowerParts.length - 1];
      const ext = path.posix.extname(base);
      if (SKIP_BASENAMES.has(base) || AUTHORING_EXTS.has(ext)) continue;
      includedFiles.set(`assets/${relPosix}`, f.abs);
    }
  }

  const catalogRel = 'assets/catalog.json';
  const catalog = await readProjectAssetCatalog(absGameDir, {
    runtimeModule: resolveSourceCandidate('vendor/hgame/platform/asset-catalog.js') ?? null,
  });
  const catalogFiles = catalog?.files ?? [];
  if (catalog) {
    includedFiles.set(catalogRel, catalog.source);
  } else if (releaseProfile.assetMode === 'catalog') {
    throw new Error('assetMode catalog requires assets/catalog.json');
  }

  // The catalog names logical resources. The CAS manifest maps files to bytes.
  const files = new Set(catalogFiles);
  if (releaseProfile.assetMode === 'all') {
    for (const file of Object.keys(assetManifest)) {
      if (file !== 'catalog.json' && !pixiBuildFiles.has('assets/' + file) && !shouldIgnoreForAssetTracking(file)) files.add(file);
    }
  }
  let resolvedFromStore = 0;
  const requiredCatalogFiles = new Set(catalogFiles);
  const missing = [];
  for (const file of [...files].sort()) {
    const parts = file.split('/');
    if (/[\\:\x00-\x1f]/.test(file) || parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) {
      throw new Error('Invalid release asset path: ' + file);
    }
    const lower = parts.map(part => part.toLowerCase());
    const basename = lower.at(-1);
    if (shouldIgnoreForAssetTracking(file) || lower.some(part => AUTHORING_ASSET_DIRS.has(part)) ||
      SKIP_BASENAMES.has(basename) || AUTHORING_EXTS.has(path.posix.extname(basename))) {
      if (requiredCatalogFiles.has(file)) throw new Error('Catalog asset is not a runtime file: ' + file);
      continue;
    }
    const target = `assets/${file}`;
    const pathOnDisk = path.join(assetsRoot, file);
    const local = requiredCatalogFiles.has(file) ? await catalog.localFile(file)
      : (await existsFile(pathOnDisk) ? pathOnDisk : null);
    if (local) {
      includedFiles.set(target, local);
      continue;
    }
    const sha = Object.hasOwn(assetManifest, file) ? assetManifest[file]?.sha256 : undefined;
    const blob = typeof sha === 'string' && /^[a-f0-9]{64}$/i.test(sha) ? casObjectPath(storeDir, sha) : null;
    if (blob && await existsFile(blob)) { includedFiles.set(target, blob); resolvedFromStore++; }
    else missing.push(file);
  }
  if (missing.length) {
    const preview = missing.slice(0, 5).join(', ') + (missing.length > 5 ? `, +${missing.length - 5} more` : '');
    throw new Error('Missing art assets declared in the catalog or assets.manifest.json (' + preview + '). Restore the files or set HGAME_ASSET_STORE.');
  }
  if (resolvedFromStore) notes.push(`Resolved ${resolvedFromStore} manifest asset(s) directly from unified store (${storeDir}).`);

  // Transform assets in-memory first so Toy target can apply contenthash & SDK injection cleanly.
  const esbuild = await loadOptionalEsbuild(minify);
  const stagedOutputs = new Map();
  let usesToySdkSource = false;

  for (const [relPosix, absSrc] of includedFiles) {
    let data = await readFile(absSrc);
    const buildHash = pixiBuildFiles.get(relPosix);
    if (buildHash) {
      data = matchPixiBuildBytes(relPosix, data, buildHash);
      if (!data) throw new Error('Pixi build file changed after compilation: ' + relPosix + '. Run npm run build:pixi before packaging.');
    }
    const ext = path.posix.extname(relPosix).toLowerCase();
    const isThreeRuntime = /^assets\/vendor\/three\/three\.(module|core)\.js$/.test(relPosix);
    if (
      esbuild &&
      !buildHash &&
      (ext === '.js' || ext === '.mjs' || ext === '.css') &&
      (isThreeRuntime || !relPosix.startsWith('assets/vendor/three/')) &&
      !relPosix.startsWith('vendor/hgame/vendor/')
    ) {
      const transformed = await esbuild.transform(data.toString('utf8'), {
        loader: ext === '.css' ? 'css' : 'js',
        format: 'esm',
        target: 'es2022',
        minifySyntax: true,
        minifyWhitespace: true,
        minifyIdentifiers: isThreeRuntime,
        keepNames: isThreeRuntime,
        legalComments: 'inline',
      });
      data = Buffer.from(transformed.code, 'utf8');
    }
    if (target === 'toy' && !usesToySdkSource &&
        (relPosix.startsWith('src/') || pixiBuildFiles.has(relPosix)) && (ext === '.js' || ext === '.mjs')) {
      usesToySdkSource = /bilibili-toy\.js|\b(?:window|globalThis)\??\.toy\b/.test(stripJsComments(data.toString('utf8')));
    }
    stagedOutputs.set(relPosix, data);
  }

  for (const [relPosix, buf] of generatedBuffers) {
    stagedOutputs.set(relPosix, buf);
  }

  let toySdkInjected = false;
  if (target === 'toy') {
    const entryBuf = stagedOutputs.get(entryRel);
    let entryHtml = entryBuf ? entryBuf.toString('utf8') : htmlText;
    const shouldInjectSdk = toySdk === false
      ? false
      : Boolean(toySdk === true || gameConfig?.toy?.sdk === true || usesToySdkSource);

    if (shouldInjectSdk && !/toy-sdk\.js/i.test(entryHtml)) {
      const sdkTag = '  <script src="//s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js"></script>\n';
      if (/<\/head>/i.test(entryHtml)) {
        entryHtml = entryHtml.replace(/<\/head>/i, sdkTag + '</head>');
        toySdkInjected = true;
      } else if (/<script\b/i.test(entryHtml)) {
        entryHtml = entryHtml.replace(/<script\b/i, sdkTag + '<script');
        toySdkInjected = true;
      }
    }

    // Apply contenthash to entry CSS & entry module script referenced by entry HTML
    // so Bilibili Toy CDN reuses unchanged assets across versions without breaking relative imports.
    const entryDir = path.posix.dirname(entryRel);
    const renameEntryAsset = rawRef => {
      if (!rawRef || isExternalSpecifier(rawRef)) return null;
      const clean = rawRef.split(/[?#]/)[0];
      if (clean.startsWith('/')) return null;
      const resolved = toPosixRel(path.posix.normalize(entryDir === '.' ? clean : `${entryDir}/${clean}`));
      if (!stagedOutputs.has(resolved)) return null;
      if (pixiBuildFiles.has(resolved)) return null; // The Pixi build has already named these by content.
      if (!/\.(?:js|mjs|css)$/i.test(resolved) || /\.min\.(?:js|mjs|css)$/i.test(resolved)) return null;
      if (/[-._][A-Za-z0-9_-]*[0-9_-][A-Za-z0-9_-]*\.(?:js|mjs|css)$/i.test(path.posix.basename(resolved))) {
        return null;
      }
      const data = stagedOutputs.get(resolved);
      const hash8 = crypto.createHash('sha256').update(data).digest('hex').slice(0, 8);
      const ext = path.posix.extname(resolved);
      const hashedRel = `${resolved.slice(0, -ext.length)}-${hash8}${ext}`;
      if (hashedRel !== resolved) {
        stagedOutputs.delete(resolved);
        stagedOutputs.set(hashedRel, data);
      }
      const prefix = rawRef.startsWith('./') ? './' : '';
      const suffix = rawRef.slice(clean.length);
      return `${prefix}${hashedRel}${suffix}`;
    };

    entryHtml = entryHtml.replace(
      /(<link\b[^>]*\bhref\s*=\s*)(["'])([^"']+\.css(?:[?#][^"']*)?)\2([^>]*>)/gi,
      (full, pre, q, href, post) => {
        if (!/\brel\s*=\s*["']stylesheet["']/i.test(pre + post)) return full;
        const nextHref = renameEntryAsset(href);
        return nextHref ? `${pre}${q}${nextHref}${q}${post}` : full;
      },
    );
    entryHtml = entryHtml.replace(
      /(<script\b[^>]*\btype\s*=\s*["']module["'][^>]*\bsrc\s*=\s*)(["'])([^"']+\.m?js(?:[?#][^"']*)?)\2([^>]*>)/gi,
      (full, pre, q, src, post) => {
        const nextSrc = renameEntryAsset(src);
        return nextSrc ? `${pre}${q}${nextSrc}${q}${post}` : full;
      },
    );

    stagedOutputs.set(entryRel, Buffer.from(entryHtml, 'utf8'));
  }

  let ktx2 = null;
  const { zipStats, toyPreflight } = await stageRelease(targetDir, zipPath, async (files, archive) => {
    for (const [relPosix, data] of stagedOutputs) {
      const dst = path.join(files, ...relPosix.split('/'));
      await mkdir(path.dirname(dst), { recursive: true });
      await writeFile(dst, data);
    }

    if (!allowUncompressedKtx2) {
      const audit = auditKtx2Textures(stagedOutputs);
      ktx2 = {
        files: audit.files.length,
        compressed: audit.files.filter((file) => file.compressed).length,
        fullMipChains: audit.files.filter((file) => file.fullMipChain).length,
        bytes: audit.files.reduce((sum, file) => sum + file.bytes, 0),
      };
      if (!audit.ok) {
        throw new Error(`KTX2 release audit failed:\n  ${audit.failures.join('\n  ')}\n`
          + 'Re-encode with toktx (npm run game:pack -- --release) or pass --allow-uncompressed-ktx2 for a development build.');
      }
    }

    const preflight = target === 'toy' ? await runToyPreflight({
      targetPath: files,
      slug: slug || gameConfig?.toy?.slug || effectiveId,
      poster,
      icon,
      requireRootIndex: true,
    }) : null;
    for (const f of preflight?.findings ?? []) {
      if (f.severity === 'WARN') {
        notes.push(`[toy WARN] ${f.file}: ${f.message}`);
      }
    }
    if (preflight?.requiredCapabilities.length) {
      notes.push(`[toy capabilities] Required/detected: ${preflight.requiredCapabilities.join(', ')}`);
    }
    if (preflight && !preflight.ok) {
      const errLines = preflight.findings
        .filter(f => f.severity === 'ERROR')
        .map(f => `${f.file}: ${f.message}`)
        .join('; ');
      throw new Error(`Bilibili Toy preflight failed: ${errLines}`);
    }
    const zipStats = await writeZipArchive(files, archive, {
      rootPrefix: effectiveFlatZip ? '' : releaseTag,
      mtime: RELEASE_ZIP_DATE,
    });
    return { zipStats, toyPreflight: preflight && { ...preflight, target: targetDir } };
  });

  const budgetReport = await analyzeBundleBudget(targetDir);
  if (target === 'toy') {
    await writeFile(
      path.join(resolvedOutParent, `${releaseTag}.budget-report.json`),
      JSON.stringify(budgetReport, null, 2) + '\n',
    );
  }

  return {
    mode: 'game',
    target,
    releaseTag,
    gameId: effectiveId,
    version: String(effectiveVersion),
    profile: project.profile,
    renderer: project.renderer,
    runtime: releaseProfile.runtime,
    assetMode: releaseProfile.assetMode,
    catalogAssets: catalogFiles.length,
    physics: project.physics,
    wasm: includedWasm,
    wasmSkipped: physicsDecision && !physicsDecision.bundle ? physicsDecision.reason : null,
    toySdkInjected,
    toyPreflight,
    budgetReport,
    ktx2,
    notes,
    minified: Boolean(esbuild),
    resolvedFromStore,
    fileCount: stagedOutputs.size,
    outputBytes: zipStats.uncompressedBytes,
    outputDir: targetDir,
    zipPath,
    zipBytes: zipStats.compressedBytes,
  };
}

/**
 * Audit packaged directory byte distribution against the 50MB Bilibili Toy ceiling and estimate
 * uncompressed texture savings achievable via KTX2 conversion.
 * @param {string} rootDir
 * @param {{ limitBytes?: number }} [options]
 */
export async function analyzeBundleBudget(rootDir, { limitBytes = 50 * 1024 * 1024 } = {}) {
  const limit = Math.max(1024, Number(limitBytes) || 50 * 1024 * 1024);
  const categories = { code: 0, textures: 0, models3d: 0, audio: 0, data: 0, other: 0 };
  const fileSizes = [];
  let ktx2PotentialSavingsBytes = 0;

  async function walkDir(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walkDir(full);
      } else if (ent.isFile()) {
        const st = await stat(full);
        const bytes = st.size;
        const rel = toPosixRel(path.relative(rootDir, full));
        const ext = path.extname(ent.name).toLowerCase();
        fileSizes.push({ path: rel, bytes });
        if (['.js', '.mjs', '.wasm', '.css', '.html'].includes(ext)) categories.code += bytes;
        else if (['.png', '.jpg', '.jpeg', '.webp', '.ktx2', '.dds'].includes(ext)) {
          categories.textures += bytes;
          if (['.png', '.jpg', '.jpeg'].includes(ext) && bytes > 32768) {
            ktx2PotentialSavingsBytes += Math.round(bytes * 0.65);
          }
        } else if (['.glb', '.gltf', '.bin'].includes(ext)) categories.models3d += bytes;
        else if (['.ogg', '.mp3', '.wav', '.m4a'].includes(ext)) categories.audio += bytes;
        else if (['.json', '.yaml', '.txt'].includes(ext)) categories.data += bytes;
        else categories.other += bytes;
      }
    }
  }

  await walkDir(rootDir);
  fileSizes.sort((a, b) => b.bytes - a.bytes);
  const totalBytes = fileSizes.reduce((s, f) => s + f.bytes, 0);
  const utilizationPct = Number(((totalBytes / limit) * 100).toFixed(2));

  return {
    totalBytes,
    limitBytes: limit,
    utilizationPct,
    withinLimit: totalBytes <= limit,
    categories,
    ktx2PotentialSavingsBytes,
    topFiles: fileSizes.slice(0, 10),
  };
}

const SDK_DIRECTORIES = [
  'assets/runtime', 'assets/template', 'assets/profiles', 'assets/archetypes', 'assets/optional/three',
  'scripts', 'types', 'docs', '.agents/skills', 'network', 'tests', 'benchmarks', 'examples',
];
const SDK_LOCAL_CONFIG_EXAMPLE = '.hgame.local.example.json';
const SDK_ROOT_FILES = [
  '.gitattributes', '.gitignore', SDK_LOCAL_CONFIG_EXAMPLE, 'LICENSE', 'README.md', 'AGENTS.md', 'CHANGELOG.md',
  'package.json', 'package-lock.json',
];
const SDK_FILE_MANIFEST = 'hgame.sdk-files.json';
const SDK_CACHE_DIRS = new Set(['.git', 'node_modules', 'build', '.re-workspace', '__pycache__', '.cache', 'coverage']);

function includeSdkPath(rel) {
  if (typeof rel !== 'string' || /[\\:\x00-\x1f]/.test(rel)) return false;
  if (rel === SDK_LOCAL_CONFIG_EXAMPLE) return true;
  if (!SDK_ROOT_FILES.includes(rel) && !SDK_DIRECTORIES.some(dir => rel === dir || rel.startsWith(dir + '/'))) return false;
  const lower = rel.toLowerCase();
  const parts = lower.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || SDK_CACHE_DIRS.has(p) || p.startsWith('.hgame.local') || p === '.npmrc' ||
    p === '.env' || (p.startsWith('.env.') && p !== '.env.example'))) return false;
  if (lower === 'docs/superpowers' || lower.startsWith('docs/superpowers/')) return false;
  if (parts.includes('dist') && lower !== 'assets/profiles/pixi2d/dist' &&
    !lower.startsWith('assets/profiles/pixi2d/dist/')) return false;
  return !SKIP_BASENAMES.has(parts.at(-1));
}

async function listSdkFiles(root) {
  if (fs.existsSync(path.join(root, '.git'))) {
    const tracked = spawnSync('git', ['ls-files', '--cached', '-z', '--', ...SDK_ROOT_FILES, ...SDK_DIRECTORIES], {
      cwd: root, encoding: 'utf8', windowsHide: true,
    });
    if (tracked.error) throw tracked.error;
    if (tracked.status !== 0) throw new Error('Could not read tracked SDK files: ' + tracked.stderr);
    return [...new Set(tracked.stdout.split('\0').filter(Boolean))].filter(includeSdkPath);
  }

  const manifestPath = path.join(root, SDK_FILE_MANIFEST);
  if (await existsFile(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.every(includeSdkPath)) {
      throw new Error('Invalid SDK file manifest');
    }
    return [...new Set(manifest.files)];
  }

  const paths = [];
  for (const relative of SDK_DIRECTORIES) {
    const dir = path.join(root, relative);
    if (!(await existsDir(dir))) continue;
    const items = await collectFilesRecursively(dir, child => {
      if (!includeSdkPath(relative + '/' + child)) return false;
      if (relative !== 'examples') return true;
      const parts = child.split('/');
      if (parts[1] === 'vendor' || parts[1] === 'scripts') return false;
      return parts[1] !== 'assets' || parts.length < 3 || !shouldIgnoreForAssetTracking(parts.slice(2).join('/'));
    });
    for (const { rel } of items) paths.push(relative + '/' + rel);
  }
  for (const file of SDK_ROOT_FILES) {
    if (await existsFile(path.join(root, file))) paths.push(file);
  }
  return paths;
}

/** Packages the full HGame SDK, including its documented tool entry points. */
export async function packageEngineRelease({
  engineRoot = DEFAULT_ENGINE_ROOT,
  version,
  tag,
  outDir,
  flatZip = false,
} = {}) {
  const absRoot = path.resolve(engineRoot);
  const pkgPath = path.join(absRoot, 'package.json');
  const versionPath = path.join(absRoot, 'assets', 'runtime', 'VERSION');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  const rtVersion = (await readFile(versionPath, 'utf8')).trim();
  const effectiveVersion = version || pkg.version || rtVersion;
  const releaseTag = formatReleaseTag('hgame', effectiveVersion, tag);

  // Verify deterministic Rapier WASM bundles and third-party notices
  for (const dim of ['2d', '3d']) {
    const wasmFile = path.join(absRoot, 'assets', 'runtime', 'vendor', `rapier${dim}`, `rapier${dim}.wasm`);
    if (!(await existsFile(wasmFile))) {
      throw new Error(`Missing Rapier${dim.toUpperCase()} WASM bundle. Run npm run build:physics first.`);
    }
    assertWasmMagic(await readFile(wasmFile), `assets/runtime/vendor/rapier${dim}/rapier${dim}.wasm`);
  }
  if (!(await existsFile(path.join(absRoot, 'assets', 'runtime', 'vendor', 'LICENSE-rapier.txt')))) {
    throw new Error('Missing assets/runtime/vendor/LICENSE-rapier.txt');
  }
  if (!(await existsFile(path.join(absRoot, 'assets', 'optional', 'three', 'LICENSE')))) {
    throw new Error('Missing assets/optional/three/LICENSE');
  }

  const resolvedOutParent = outDir ? path.resolve(outDir) : path.join(absRoot, 'build');
  const targetDir = path.join(resolvedOutParent, releaseTag);
  const zipPath = path.join(resolvedOutParent, `${releaseTag}.zip`);

  const canonicalRoot = await realpath(absRoot);
  const sdkPaths = (await listSdkFiles(absRoot))
    .filter(rel => !rel.startsWith('types/') || rel.endsWith('.d.ts'))
    .sort();
  const zipStats = await stageRelease(targetDir, zipPath, async (files, archive) => {
    for (const relative of sdkPaths) {
      const src = path.join(canonicalRoot, ...relative.split('/'));
      if (!(await lstat(src)).isFile()) throw new Error('SDK entry is not a regular file: ' + relative);
      const resolved = await realpath(src);
      const contained = path.relative(canonicalRoot, resolved);
      if (path.isAbsolute(contained) || contained === '..' || contained.startsWith('..' + path.sep)) {
        throw new Error('SDK entry resolves outside the engine root: ' + relative);
      }
      const dst = path.join(files, ...relative.split('/'));
      await mkdir(path.dirname(dst), { recursive: true });
      await writeFile(dst, await readFile(resolved));
    }
    await writeFile(path.join(files, SDK_FILE_MANIFEST), JSON.stringify({ schemaVersion: 1, files: sdkPaths }, null, 2) + '\n');

    return writeZipArchive(files, archive, {
      rootPrefix: flatZip ? '' : releaseTag,
      mtime: RELEASE_ZIP_DATE,
    });
  });

  return {
    mode: 'engine',
    releaseTag,
    version: String(effectiveVersion),
    runtimeVersion: rtVersion,
    fileCount: zipStats.entryCount,
    outputBytes: zipStats.uncompressedBytes,
    outputDir: targetDir,
    zipPath,
    zipBytes: zipStats.compressedBytes,
  };
}

function parseCliArgs(argv) {
  const opts = {
    targetDir: '',
    version: undefined,
    id: undefined,
    tag: undefined,
    outDir: undefined,
    engineRoot: undefined,
    assetStore: undefined,
    flatZip: undefined,
    minify: true,
    target: 'standard',
    toySdk: undefined,
    slug: undefined,
    poster: undefined,
    icon: undefined,
    allowUncompressedKtx2: false,
    engine: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--version' || arg === '-v') {
      opts.version = argv[++i];
    } else if (arg === '--id' || arg === '--name') {
      opts.id = argv[++i];
    } else if (arg === '--tag') {
      opts.tag = argv[++i];
    } else if (arg === '--out-dir' || arg === '-o') {
      opts.outDir = argv[++i];
    } else if (arg === '--engine-root') {
      opts.engineRoot = argv[++i];
    } else if (arg === '--asset-store') {
      opts.assetStore = argv[++i];
    } else if (arg === '--flat-zip') {
      opts.flatZip = true;
    } else if (arg === '--no-flat-zip') {
      opts.flatZip = false;
    } else if (arg === '--target') {
      opts.target = argv[++i];
    } else if (arg === '--toy-sdk') {
      opts.toySdk = true;
    } else if (arg === '--no-toy-sdk') {
      opts.toySdk = false;
    } else if (arg === '--slug') {
      opts.slug = argv[++i];
    } else if (arg === '--poster') {
      opts.poster = argv[++i];
    } else if (arg === '--icon') {
      opts.icon = argv[++i];
    } else if (arg === '--no-minify') {
      opts.minify = false;
    } else if (arg === '--allow-uncompressed-ktx2') {
      opts.allowUncompressedKtx2 = true;
    } else if (arg === '--engine') {
      opts.engine = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (!arg.startsWith('-') && !opts.targetDir) {
      opts.targetDir = arg;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  return opts;
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      'Usage: node scripts/package-game.mjs [project-dir] [--target standard|toy] [--version 1.1] [--id lol] [--tag lol_1_1] [--out-dir build] [--engine-root <hgame>] [--flat-zip] [--toy-sdk|--no-toy-sdk] [--slug <slug>] [--poster <file>] [--icon <file>] [--allow-uncompressed-ktx2] [--no-minify] [--engine]',
    );
    return;
  }
  const summary = opts.engine
    ? await packageEngineRelease({
        engineRoot: opts.targetDir || opts.engineRoot || DEFAULT_ENGINE_ROOT,
        version: opts.version,
        tag: opts.tag,
        outDir: opts.outDir,
        flatZip: Boolean(opts.flatZip),
      })
    : await packageGameRelease({
        projectDir: opts.targetDir || process.cwd(),
        version: opts.version,
        id: opts.id,
        tag: opts.tag,
        outDir: opts.outDir,
        engineRoot: opts.engineRoot,
        assetStore: opts.assetStore,
        flatZip: opts.flatZip,
        minify: opts.minify,
        target: opts.target,
        toySdk: opts.toySdk,
        slug: opts.slug,
        poster: opts.poster,
        icon: opts.icon,
        allowUncompressedKtx2: opts.allowUncompressedKtx2,
      });
  for (const note of summary.notes || []) console.error(note);
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('Release packaging failed: ' + error.message);
    process.exitCode = 1;
  });
}
