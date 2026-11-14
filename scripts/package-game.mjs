#!/usr/bin/env node
import fs from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const DEFAULT_ENGINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const RUNTIME_DIR_PREFIXES = new Set([
  'core',
  'platform',
  'integrations',
  'ui',
  'vfx',
  'sim',
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
    if (!entryName || entryName.includes('..') || entryName.includes('\0')) {
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

async function collectFilesRecursively(dir) {
  const out = [];
  async function walk(curr, prefix) {
    const dirents = await readdir(curr, { withFileTypes: true });
    for (const d of dirents) {
      const nextRel = prefix ? `${prefix}/${d.name}` : d.name;
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
export async function writeZipArchive(sourceDir, zipFilePath, { rootPrefix = '' } = {}) {
  const files = await collectFilesRecursively(sourceDir);
  const cleanPrefix = rootPrefix ? rootPrefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
  const entries = await Promise.all(
    files.map(async ({ rel, abs }) => {
      const [data, st] = await Promise.all([readFile(abs), stat(abs)]);
      const zipPath = cleanPrefix ? `${cleanPrefix}/${rel}` : rel;
      return { path: zipPath, data, mtime: st.mtime };
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

function extractModuleSpecifiers(code, { isApplicationCore = false, includeSrcSubpaths = false } = {}) {
  const clean = stripJsComments(code);
  const specifiers = [];
  const urls = [];

  const sideEffectImportRe = /(?:^|[;\n}])\s*import\s+['"]([^'"]+)['"]/g;
  const importFromRe = /\bimport\s+(?:\*\s+as\s+[\w$]+|[\w$]+(?:\s*,\s*(?:\*\s+as\s+[\w$]+|\{[^}]*\}))?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;
  const exportFromRe = /\bexport\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;
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
    const subpathMatchRe = /(?:^|vendor\/hgame\/|runtime\/hgame\/|\/)((?:core|platform|integrations|ui|vfx|sim|world|time|animation|physics|lockstep)\/[A-Za-z0-9_./-]+\.m?js)$/i;
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

  return { specifiers, urls, runtimeSubpaths };
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
 */
export async function packageGameRelease({
  projectDir = process.cwd(),
  version,
  id,
  tag,
  outDir,
  engineRoot,
  assetStore,
  flatZip = false,
  minify = true,
} = {}) {
  const absGameDir = path.resolve(projectDir);
  const gameConfigPath = path.join(absGameDir, 'game.config.json');
  const engineConfigPath = path.join(absGameDir, 'engine.config.json');

  if (!(await existsFile(gameConfigPath)) || !(await existsFile(engineConfigPath))) {
    throw new Error(`Expected game.config.json and engine.config.json in ${absGameDir}`);
  }

  const gameConfig = JSON.parse(await readFile(gameConfigPath, 'utf8'));
  const engineConfig = JSON.parse(await readFile(engineConfigPath, 'utf8'));

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

  await rm(targetDir, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  await mkdir(targetDir, { recursive: true });

  const includedFiles = new Map(); // relPosix -> absSourcePath
  const generatedBuffers = new Map(); // relPosix -> Buffer

  function resolveSourceCandidate(relPosix) {
    const localAbs = path.join(absGameDir, relPosix);
    if (fs.existsSync(localAbs) && fs.statSync(localAbs).isFile()) {
      return localAbs;
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
    if (isForbiddenRuntimeRel(norm)) return;
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
    if (resolved) enqueueRel(resolved, false);
  }

  // Always seed HGame core entry, active renderer adapter, active optional features, and VERSION.
  enqueueRel('vendor/hgame/VERSION', false);
  enqueueRel('vendor/hgame/index.js', true);

  const rendererSeeds = {
    canvas2d: 'vendor/hgame/integrations/canvas2d.js',
    webgl2d: 'vendor/hgame/integrations/webgl2d.js',
    threejs: 'vendor/hgame/integrations/three.js',
    dom: 'vendor/hgame/integrations/dom.js',
  };
  if (rendererSeeds[project.renderer]) {
    enqueueRel(rendererSeeds[project.renderer], false);
  }

  if (project.features.includes('animation2d')) {
    enqueueRel('vendor/hgame/animation/player.js', false);
    enqueueRel('vendor/hgame/animation/spritesheet.js', false);
  }
  if (project.features.includes('tilemap2d') || project.features.includes('pathfinding2d')) {
    enqueueRel('vendor/hgame/world/tilemap.js', false);
  }
  if (project.features.includes('physics2d')) {
    enqueueRel('vendor/hgame/physics/rapier2d.js', false);
  }
  if (project.features.includes('physics3d')) {
    enqueueRel('vendor/hgame/physics/rapier3d.js', false);
  }

  // Include src/ runtime files (data configs, scripts, shaders) and seed module graph from them.
  const srcRoot = path.join(absGameDir, 'src');
  if (await existsDir(srcRoot)) {
    const srcFiles = await collectFilesRecursively(srcRoot);
    for (const f of srcFiles) {
      const lower = f.rel.toLowerCase();
      const parts = lower.split('/');
      if (parts.some(p => p === 'tests' || p === '__tests__')) continue;
      if (/\.(test|spec)\.[cm]?js$/i.test(lower)) continue;
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

  // Traverse module & CSS dependency graph
  while (traceQueue.length > 0) {
    const { rel, abs } = traceQueue.shift();
    const ext = path.posix.extname(rel).toLowerCase();
    if (ext === '.js' || ext === '.mjs') {
      const code = await readFile(abs, 'utf8');
      const { specifiers, urls, runtimeSubpaths } = extractModuleSpecifiers(code, {
        isApplicationCore: rel === 'vendor/hgame/core/application.js',
        includeSrcSubpaths: rel.startsWith('src/'),
      });
      for (const s of [...specifiers, ...urls]) {
        const target = resolveModulePath(s, rel, importMap);
        if (target) enqueueRel(target, false);
      }
      for (const sub of runtimeSubpaths) {
        enqueueRel(sub, false);
      }
    } else if (ext === '.css') {
      const css = await readFile(abs, 'utf8');
      for (const ref of extractCssDependencies(css)) {
        const target = resolveModulePath(ref, rel, importMap);
        if (target) enqueueRel(target, false);
      }
    }
  }

  // Preserve Third-Party Licenses cleanly
  if ([...includedFiles.keys()].some(k => k.startsWith('assets/vendor/three/'))) {
    enqueueRel('assets/vendor/three/LICENSE', false);
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
  if (await existsDir(assetsRoot)) {
    const allAssets = await collectFilesRecursively(assetsRoot);
    for (const f of allAssets) {
      const relPosix = toPosixRel(f.rel);
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

  // Fallback for manifest-tracked art/audio assets stored outside Git in unified asset store
  let resolvedFromStore = 0;
  const assetManifestPath = path.join(absGameDir, 'assets.manifest.json');
  if (await existsFile(assetManifestPath)) {
    const manifest = JSON.parse(await readFile(assetManifestPath, 'utf8'));
    const entries = manifest && typeof manifest.assets === 'object' ? manifest.assets : null;
    if (entries) {
      const storeDir = assetStore
        ? path.resolve(assetStore)
        : (process.env.HGAME_ASSET_STORE?.trim()
            ? path.resolve(process.env.HGAME_ASSET_STORE.trim())
            : path.join(os.homedir(), '.hgame', 'asset-store'));
      const missingManifestAssets = [];
      for (const relPosix of Object.keys(entries).sort()) {
        const parts = relPosix.split('/');
        const lowerParts = parts.map(p => p.toLowerCase());
        if (lowerParts[0] === 'vendor' && lowerParts[1] === 'three') continue;
        if (lowerParts.some(p => AUTHORING_ASSET_DIRS.has(p))) continue;
        const base = lowerParts[lowerParts.length - 1];
        const ext = path.posix.extname(base);
        if (SKIP_BASENAMES.has(base) || AUTHORING_EXTS.has(ext)) continue;

        const targetRel = `assets/${relPosix}`;
        if (includedFiles.has(targetRel)) continue;

        const sha = typeof entries[relPosix]?.sha256 === 'string' ? entries[relPosix].sha256.toLowerCase() : '';
        const blobAbs = /^[a-f0-9]{64}$/.test(sha) ? path.join(storeDir, 'objects', sha.slice(0, 2), sha) : null;
        if (blobAbs && (await existsFile(blobAbs))) {
          includedFiles.set(targetRel, blobAbs);
          resolvedFromStore++;
        } else {
          missingManifestAssets.push(relPosix);
        }
      }
      if (missingManifestAssets.length > 0) {
        throw new Error(
          `Missing art assets declared in assets.manifest.json (${missingManifestAssets.slice(0, 5).join(', ')}` +
          `${missingManifestAssets.length > 5 ? `, +${missingManifestAssets.length - 5} more` : ''}). ` +
          'Run `npm run assets -- pull` or set HGAME_ASSET_STORE before packaging.',
        );
      }
      if (resolvedFromStore > 0) {
        notes.push(`Resolved ${resolvedFromStore} manifest asset(s) directly from unified store (${storeDir}).`);
      }
    }
  }

  // Write packaged directory with optional esbuild minification
  const esbuild = await loadOptionalEsbuild(minify);
  let totalBytes = 0;

  for (const [relPosix, absSrc] of includedFiles) {
    const dst = path.join(targetDir, ...relPosix.split('/'));
    await mkdir(path.dirname(dst), { recursive: true });
    let data = await readFile(absSrc);
    const ext = path.posix.extname(relPosix).toLowerCase();
    if (
      esbuild &&
      (ext === '.js' || ext === '.mjs' || ext === '.css') &&
      !relPosix.startsWith('assets/vendor/three/') &&
      !relPosix.startsWith('vendor/hgame/vendor/')
    ) {
      const transformed = await esbuild.transform(data.toString('utf8'), {
        loader: ext === '.css' ? 'css' : 'js',
        format: 'esm',
        target: 'es2022',
        minifySyntax: true,
        minifyWhitespace: true,
        minifyIdentifiers: false,
        legalComments: 'inline',
      });
      data = Buffer.from(transformed.code, 'utf8');
    }
    await writeFile(dst, data);
    totalBytes += data.length;
  }

  for (const [relPosix, buf] of generatedBuffers) {
    const dst = path.join(targetDir, ...relPosix.split('/'));
    await mkdir(path.dirname(dst), { recursive: true });
    await writeFile(dst, buf);
    totalBytes += buf.length;
  }

  const zipStats = await writeZipArchive(targetDir, zipPath, {
    rootPrefix: flatZip ? '' : releaseTag,
  });

  return {
    mode: 'game',
    releaseTag,
    gameId: effectiveId,
    version: String(effectiveVersion),
    profile: project.profile,
    renderer: project.renderer,
    physics: project.physics,
    wasm: includedWasm,
    wasmSkipped: physicsDecision && !physicsDecision.bundle ? physicsDecision.reason : null,
    notes,
    minified: Boolean(esbuild),
    resolvedFromStore,
    fileCount: includedFiles.size + generatedBuffers.size,
    outputBytes: totalBytes,
    outputDir: targetDir,
    zipPath,
    zipBytes: zipStats.compressedBytes,
  };
}

/**
 * Packages the clean HGame Engine SDK distribution into `build/hgame_<ver>/` and `.zip`.
 */
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

  await rm(targetDir, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  await mkdir(targetDir, { recursive: true });

  const copyTree = async (srcRel, filterFn = null) => {
    const srcAbs = path.join(absRoot, srcRel);
    if (!(await existsDir(srcAbs))) return 0;
    const items = await collectFilesRecursively(srcAbs);
    let count = 0;
    for (const item of items) {
      const relPosix = `${toPosixRel(srcRel)}/${toPosixRel(item.rel)}`;
      const lower = relPosix.toLowerCase();
      const parts = lower.split('/');
      if (parts.some(p => p === '.git' || p === 'node_modules' || p === 'dist' || p === 'build')) continue;
      if (SKIP_BASENAMES.has(parts[parts.length - 1])) continue;
      if (filterFn && !filterFn(relPosix)) continue;
      const dst = path.join(targetDir, ...relPosix.split('/'));
      await mkdir(path.dirname(dst), { recursive: true });
      await writeFile(dst, await readFile(item.abs));
      count++;
    }
    return count;
  };

  let fileCount = 0;
  fileCount += await copyTree('assets/runtime');
  fileCount += await copyTree('assets/template');
  fileCount += await copyTree('assets/profiles');
  fileCount += await copyTree('assets/optional/three');
  fileCount += await copyTree('scripts');
  fileCount += await copyTree('docs', rel => !rel.startsWith('docs/superpowers/'));
  fileCount += await copyTree('.agents/skills');

  for (const rootFile of ['LICENSE', 'README.md', 'AGENTS.md', 'CHANGELOG.md', 'package.json']) {
    const src = path.join(absRoot, rootFile);
    if (await existsFile(src)) {
      await writeFile(path.join(targetDir, rootFile), await readFile(src));
      fileCount++;
    }
  }

  const zipStats = await writeZipArchive(targetDir, zipPath, {
    rootPrefix: flatZip ? '' : releaseTag,
  });

  return {
    mode: 'engine',
    releaseTag,
    version: String(effectiveVersion),
    runtimeVersion: rtVersion,
    fileCount,
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
    flatZip: false,
    minify: true,
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
    } else if (arg === '--no-minify') {
      opts.minify = false;
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
      'Usage: node scripts/package-game.mjs [project-dir] [--version 1.1] [--id lol] [--tag lol_1_1] [--out-dir build] [--engine-root <hgame>] [--flat-zip] [--no-minify] [--engine]',
    );
    return;
  }
  const summary = opts.engine
    ? await packageEngineRelease({
        engineRoot: opts.targetDir || opts.engineRoot || DEFAULT_ENGINE_ROOT,
        version: opts.version,
        tag: opts.tag,
        outDir: opts.outDir,
        flatZip: opts.flatZip,
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
