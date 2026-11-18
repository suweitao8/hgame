#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ASSET_MANIFEST_FILENAME = 'assets.manifest.json';
export const STORE_LAYOUT = 'cas-sha256-v1';
export const PIXI_BUNDLER_PATH = 'scripts/bundle-pixi.mjs';

const RAW_ASSET_DIRS = new Set(['raw', 'art_src', 'art-src', 'source', '.git', 'node_modules', '.cache']);
const RAW_EXTS = new Set([
  '.psd', '.psb', '.blend', '.blend1', '.fbx', '.obj', '.mtl', '.dae',
  '.max', '.ma', '.mb', '.aseprite', '.ase', '.kra', '.xcf', '.spp', '.sbs', '.sbsar',
  '.bak', '.tmp', '.log',
]);
const SKIP_BASENAMES = new Set(['.ds_store', 'thumbs.db', '.gitkeep', 'assets.manifest.json']);
const CATALOG_RELATIVE_PATH = 'assets/catalog.json';

function isPixiInputPath(input) {
  return typeof input === 'string' && input.length > 0 && !/[:\\\x00-\x1f]/.test(input) &&
    input.split('/').every(segment => segment && !segment.startsWith('.'));
}

// The Pixi installer tracks compiled outputs separately from authored assets.
export async function readPixiBuildManifest(gameDir) {
  try {
    const manifest = JSON.parse(await readFile(path.join(gameDir, '.hgame-pixi-build.json'), 'utf8'));
    if (manifest?.schemaVersion === 1 && manifest.files && typeof manifest.files === 'object' &&
        !Array.isArray(manifest.files)) {
      const files = new Map(Object.entries(manifest.files)
        .filter(([name, hash]) => /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name) && /^[a-f0-9]{64}$/.test(hash)));
      const sourceHash = /^[a-f0-9]{64}$/.test(manifest.sourceHash) ? manifest.sourceHash : undefined;
      const inputs = Array.isArray(manifest.inputs) ? [...new Set(manifest.inputs.filter(isPixiInputPath))] : [];
      return { files, sourceHash, inputs };
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  return { files: new Map(), inputs: [] };
}

function isGitOwnedProjectAsset(file, buildFiles) {
  return file === 'catalog.json' || (/\.(?:m?js|css)$/i.test(file) && buildFiles.has(file));
}

// A checkout of a legacy project may normalize line endings. Return bytes
// matching the recorded digest; reject content edits and altered binary files.
export function matchPixiBuildBytes(file, bytes, expectedHash) {
  const matches = input => createHash('sha256').update(input).digest('hex') === expectedHash;
  if (matches(bytes)) return bytes;
  if (!/\.(?:m?js|css)$/i.test(file)) return null;
  const lf = bytes.toString('utf8').replace(/\r\n/g, '\n');
  const normalized = Buffer.from(lf);
  if (matches(normalized)) return normalized;
  const windows = Buffer.from(lf.replace(/\n/g, '\r\n'));
  return matches(windows) ? windows : null;
}

// The scaffold can bundle authored source and vendored HGame imports.
// Presentation and swarm settings are fetched at runtime.
export async function hashPixiSources(gameDir, knownInputs) {
  const folders = await Promise.all(['src', 'vendor/hgame'].map(name => collectFiles(path.join(gameDir, name), gameDir)));
  const sourceFiles = folders.flat().filter(({ relPosix }) =>
    !relPosix.endsWith('.d.ts') && relPosix !== 'src/presentation.json' && relPosix !== 'src/swarm.json');
  const inputs = ['index.source.html', 'package.json', 'package-lock.json'];
  let extra = [];
  try {
    await stat(path.join(gameDir, PIXI_BUNDLER_PATH));
    inputs.push(PIXI_BUNDLER_PATH, 'scripts/install-pixi-build.mjs');
    extra = knownInputs ?? (await readPixiBuildManifest(gameDir)).inputs;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    inputs.push('vite.config.js');
  }
  const files = sourceFiles.concat(inputs.map(relPosix => ({ relPosix, abs: path.join(gameDir, relPosix) })));
  const included = new Set(files.map(file => file.relPosix));
  for (const relPosix of extra) {
    if (isPixiInputPath(relPosix) && !included.has(relPosix)) {
      files.push({ relPosix, abs: path.join(gameDir, relPosix), optional: true });
      included.add(relPosix);
    }
  }
  files.sort((a, b) => a.relPosix < b.relPosix ? -1 : a.relPosix === b.relPosix ? 0 : 1);
  const hash = createHash('sha256');
  for (const { abs, relPosix, optional } of files) {
    let bytes;
    try { bytes = await readFile(abs); }
    catch (error) {
      if (!optional || error.code !== 'ENOENT') throw error;
      hash.update(relPosix).update('\0missing\0');
      continue;
    }
    const stable = /(?:\/VERSION|\.(?:[cm]?[jt]sx?|css|html?|json|svg|txt|md))$/i.test(relPosix)
      ? bytes.toString('utf8').replace(/\r\n/g, '\n')
      : bytes;
    hash.update(relPosix).update('\0').update(createHash('sha256').update(stable).digest());
  }
  return hash.digest('hex');
}

const KIND_BY_EXT = new Map([
  ['.png', 'image'], ['.jpg', 'image'], ['.jpeg', 'image'], ['.webp', 'image'],
  ['.avif', 'image'], ['.gif', 'image'], ['.bmp', 'image'], ['.tga', 'image'],
  ['.dds', 'image'], ['.ktx2', 'image'], ['.basis', 'image'], ['.hdr', 'image'], ['.exr', 'image'],
  ['.glb', 'model3d'], ['.gltf', 'model3d'],
  ['.bin', 'binary'],
  ['.mp3', 'audio'], ['.ogg', 'audio'], ['.wav', 'audio'], ['.flac', 'audio'], ['.m4a', 'audio'], ['.aac', 'audio'],
  ['.mp4', 'video'], ['.webm', 'video'], ['.mov', 'video'],
  ['.ttf', 'font'], ['.otf', 'font'], ['.woff', 'font'], ['.woff2', 'font'],
  ['.json', 'data'], ['.txt', 'data'], ['.csv', 'data'], ['.xml', 'data'],
]);

function toPosix(relPath) {
  return relPath.split(path.sep).join('/');
}

/**
 * Resolves the local unified asset store directory:
 * 1) explicit override (`--store`), 2) `HGAME_ASSET_STORE` env var, 3) `~/.hgame/asset-store`.
 * @param {string|null|undefined} [overrideDir]
 * @returns {string}
 */
export function resolveAssetStoreDir(overrideDir = null) {
  if (overrideDir && String(overrideDir).trim()) return path.resolve(String(overrideDir));
  if (process.env.HGAME_ASSET_STORE && process.env.HGAME_ASSET_STORE.trim()) {
    return path.resolve(process.env.HGAME_ASSET_STORE.trim());
  }
  return path.join(os.homedir(), '.hgame', 'asset-store');
}

/**
 * Classifies a relative asset path into a coarse media kind.
 * @param {string} relPosix
 * @returns {string}
 */
export function classifyAssetKind(relPosix) {
  const lower = relPosix.toLowerCase();
  if (lower.endsWith('.vat.bin')) return 'vat';
  const ext = path.posix.extname(lower);
  return KIND_BY_EXT.get(ext) ?? 'other';
}

/**
 * Returns true when an asset path under `assets/` is vendor/OS/authoring noise
 * that should not be tracked in `assets.manifest.json`.
 * @param {string} relPosix Path relative to `<gameDir>/assets/`.
 * @param {{ includeRaw?: boolean }} [options]
 * @returns {boolean}
 */
export function shouldIgnoreForAssetTracking(relPosix, { includeRaw = false } = {}) {
  const parts = toPosix(relPosix).split('/').filter(Boolean);
  if (parts.length === 0) return true;
  const lowerParts = parts.map(p => p.toLowerCase());
  if (lowerParts[0] === 'vendor') return true;
  if (!includeRaw && lowerParts.some(p => RAW_ASSET_DIRS.has(p))) return true;
  if (lowerParts.some(p => p === '.git' || p === 'node_modules' || p === '.cache')) return true;
  const base = lowerParts[lowerParts.length - 1];
  if (SKIP_BASENAMES.has(base)) return true;
  const ext = path.posix.extname(base);
  if (!includeRaw && RAW_EXTS.has(ext)) return true;
  return false;
}

export function casObjectPath(storeDir, sha256) {
  if (!/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new RangeError(`Invalid sha256 digest: ${sha256}`);
  }
  const clean = sha256.toLowerCase();
  return path.join(storeDir, 'objects', clean.slice(0, 2), clean);
}

async function hashAndSizeFile(filePath) {
  const info = await stat(filePath);
  const hash = createHash('sha256');
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', rejectPromise);
    stream.on('end', resolvePromise);
  });
  return { sha256: hash.digest('hex'), bytes: info.size };
}

async function collectFiles(rootDir, baseDir = rootDir, out = []) {
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries) {
    const abs = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(abs, baseDir, out);
    } else if (entry.isFile()) {
      out.push({ abs, relPosix: toPosix(path.relative(baseDir, abs)) });
    }
  }
  return out;
}

export async function readProjectAssetCatalog(gameDir, { runtimeModule } = {}) {
  const assetsDir = path.resolve(gameDir, 'assets');
  const catalogPath = path.resolve(gameDir, CATALOG_RELATIVE_PATH);
  let roots;
  async function localFile(file) {
    let resolved;
    try {
      resolved = await realpath(path.join(assetsDir, file));
      if (!(await stat(resolved)).isFile()) throw new Error('Catalog entry requires a file: ' + file);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    roots ??= await Promise.all([realpath(assetsDir), realpath(gameDir)]);
    for (const root of roots) {
      const relative = path.relative(root, resolved);
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) {
        throw new Error('Catalog file resolves outside the project assets: ' + file);
      }
    }
    return resolved;
  }

  const source = await localFile(path.basename(catalogPath));
  if (!source) return null;
  if (runtimeModule === undefined) {
    // The CLI is copied into generated projects and also runs at the engine root.
    for (const relative of ['../vendor/hgame/', '../assets/runtime/']) {
      const file = fileURLToPath(new URL(relative + 'platform/asset-catalog.js', import.meta.url));
      try {
        if ((await stat(file)).isFile()) { runtimeModule = file; break; }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  if (!runtimeModule) throw new Error('Asset catalog requires HGame platform/asset-catalog.js');
  const { listCatalogFiles } = await import(pathToFileURL(runtimeModule).href);
  const files = listCatalogFiles(JSON.parse(await readFile(source, 'utf8')));
  return { source, files, localFile };
}

async function ensureFileInStore(srcAbs, sha256, bytes, storeDir) {
  const dst = casObjectPath(storeDir, sha256);
  try {
    const existing = await stat(dst);
    if (existing.isFile() && existing.size === bytes) {
      return { stored: false, dst };
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  await mkdir(path.dirname(dst), { recursive: true });
  const tmp = `${dst}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await pipeline(createReadStream(srcAbs), createWriteStream(tmp));
    await rename(tmp, dst);
    return { stored: true, dst };
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

async function atomicWriteFile(dstPath, dataOrStreamFn) {
  await mkdir(path.dirname(dstPath), { recursive: true });
  const tmp = `${dstPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await dataOrStreamFn(tmp);
    await rename(tmp, dstPath);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Reads and normalizes `<gameDir>/assets.manifest.json`. Returns a valid empty
 * manifest structure if the file does not exist yet.
 * @param {string} gameDir
 */
export async function readAssetManifest(gameDir) {
  const absGame = path.resolve(gameDir);
  const manifestPath = path.join(absGame, ASSET_MANIFEST_FILENAME);
  let rawText = null;
  try {
    rawText = await readFile(manifestPath, 'utf8');
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  if (rawText === null) {
    return {
      schemaVersion: 1,
      gameId: path.basename(absGame),
      storeLayout: STORE_LAYOUT,
      remoteBaseUrl: null,
      assets: {},
    };
  }
  const parsed = JSON.parse(rawText);
  if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== 1 || !parsed.assets || typeof parsed.assets !== 'object') {
    throw new Error(`Invalid ${ASSET_MANIFEST_FILENAME} in ${absGame}`);
  }
  return {
    schemaVersion: 1,
    gameId: typeof parsed.gameId === 'string' && parsed.gameId ? parsed.gameId : path.basename(absGame),
    storeLayout: typeof parsed.storeLayout === 'string' ? parsed.storeLayout : STORE_LAYOUT,
    remoteBaseUrl: typeof parsed.remoteBaseUrl === 'string' && parsed.remoteBaseUrl.trim() ? parsed.remoteBaseUrl.trim() : null,
    assets: parsed.assets,
  };
}

/**
 * Writes `<gameDir>/assets.manifest.json` with deterministic key ordering.
 * @param {string} gameDir
 * @param {object} manifest
 */
export async function writeAssetManifest(gameDir, manifest) {
  const absGame = path.resolve(gameDir);
  const manifestPath = path.join(absGame, ASSET_MANIFEST_FILENAME);
  const sortedAssets = Object.fromEntries(Object.keys(manifest.assets || {}).sort()
    .map(key => [key, manifest.assets[key]]));
  const normalized = {
    schemaVersion: 1,
    gameId: manifest.gameId || path.basename(absGame),
    storeLayout: STORE_LAYOUT,
    remoteBaseUrl: manifest.remoteBaseUrl ?? null,
    assets: sortedAssets,
  };
  await atomicWriteFile(manifestPath, async (tmp) => {
    await writeFile(tmp, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  });
  return normalized;
}

/**
 * Scans `<gameDir>/assets/`, stores deduplicated binaries in the unified asset store,
 * and updates `<gameDir>/assets.manifest.json`.
 * @param {string} gameDir
 * @param {{ storeDir?: string|null, includeRaw?: boolean, exact?: boolean, catalog?: boolean, remoteBaseUrl?: string|null }} [options]
 */
export async function pushAssets(gameDir, {
  storeDir = null,
  includeRaw = false,
  exact = false,
  catalog = false,
  remoteBaseUrl = undefined,
} = {}) {
  const absGame = path.resolve(gameDir);
  const store = resolveAssetStoreDir(storeDir);
  const manifest = await readAssetManifest(absGame);
  if (remoteBaseUrl !== undefined) {
    manifest.remoteBaseUrl = remoteBaseUrl ? String(remoteBaseUrl).trim() : null;
  }

  const assetsRoot = path.join(absGame, 'assets');
  const nextAssets = Object.assign(Object.create(null), exact ? {} : manifest.assets);
  const { files: buildFiles } = await readPixiBuildManifest(absGame);
  const isProjectFile = file => isGitOwnedProjectAsset(file, buildFiles);
  for (const file of Object.keys(nextAssets)) {
    if (isProjectFile(file)) delete nextAssets[file];
  }
  let files;
  if (catalog) {
    const selection = await readProjectAssetCatalog(absGame);
    if (!selection) throw new Error('--catalog requires assets/catalog.json');
    files = [];
    for (const relPosix of selection.files) {
      if (isProjectFile(relPosix) || shouldIgnoreForAssetTracking(relPosix)) {
        throw new Error('Catalog entry must refer to authored media or data: ' + relPosix);
      }
      const abs = await selection.localFile(relPosix);
      if (abs) files.push({ abs, relPosix });
      else if (Object.hasOwn(manifest.assets, relPosix)) nextAssets[relPosix] = manifest.assets[relPosix];
      else throw new Error('Catalog asset is missing locally and has no CAS entry: ' + relPosix);
    }
  } else {
    files = await collectFiles(assetsRoot);
  }
  let uploadedObjects = 0;
  let reusedObjects = 0;
  let updatedEntries = 0;
  let totalBytes = 0;
  const now = new Date().toISOString();

  for (const file of files) {
    if (isProjectFile(file.relPosix) || shouldIgnoreForAssetTracking(file.relPosix, { includeRaw })) continue;
    const { sha256, bytes } = await hashAndSizeFile(file.abs);
    totalBytes += bytes;
    const res = await ensureFileInStore(file.abs, sha256, bytes, store);
    if (res.stored) uploadedObjects++;
    else reusedObjects++;

    const prev = Object.hasOwn(manifest.assets, file.relPosix) ? manifest.assets[file.relPosix] : null;
    const kind = classifyAssetKind(file.relPosix);
    const unchanged = prev && prev.sha256 === sha256 && prev.bytes === bytes && prev.kind === kind;
    if (!unchanged) updatedEntries++;
    nextAssets[file.relPosix] = unchanged
      ? prev
      : { sha256, bytes, kind, updatedAt: now };
  }

  manifest.assets = nextAssets;
  await writeAssetManifest(absGame, manifest);
  return {
    action: 'push',
    gameDir: absGame,
    storeDir: store,
    manifestPath: path.join(absGame, ASSET_MANIFEST_FILENAME),
    totalAssets: Object.keys(nextAssets).length,
    totalBytes,
    uploadedObjects,
    reusedObjects,
    updatedEntries,
  };
}

/**
 * Restores binaries declared in `<gameDir>/assets.manifest.json` from the unified store
 * (and optional HTTP remote fallback `remoteBaseUrl`) into `<gameDir>/assets/`.
 * @param {string} gameDir
 * @param {{ storeDir?: string|null, remote?: string|null, prefix?: string, force?: boolean, fetchImpl?: typeof fetch }} [options]
 */
export async function pullAssets(gameDir, {
  storeDir = null,
  remote = null,
  prefix = '',
  force = false,
  fetchImpl = globalThis.fetch,
} = {}) {
  const absGame = path.resolve(gameDir);
  const store = resolveAssetStoreDir(storeDir);
  const manifest = await readAssetManifest(absGame);
  const { files: buildFiles } = await readPixiBuildManifest(absGame);
  const baseUrl = (remote ?? manifest.remoteBaseUrl)?.replace(/\/+$/, '') || null;

  let pulled = 0;
  let skipped = 0;
  let fetchedRemote = 0;
  let bytesRestored = 0;
  const missing = [];

  const keys = Object.keys(manifest.assets).sort();
  for (const relPosix of keys) {
    if ((prefix && !relPosix.startsWith(prefix)) || isGitOwnedProjectAsset(relPosix, buildFiles)) continue;
    const entry = manifest.assets[relPosix];
    if (!entry || typeof entry.sha256 !== 'string') continue;

    const dstAbs = path.join(absGame, 'assets', ...relPosix.split('/'));
    if (!force) {
      try {
        const cur = await hashAndSizeFile(dstAbs);
        if (cur.sha256 === entry.sha256 && cur.bytes === entry.bytes) {
          skipped++;
          continue;
        }
      } catch (err) {
        if (err?.code !== 'ENOENT') throw err;
      }
    }

    const blobPath = casObjectPath(store, entry.sha256);
    let haveLocalBlob = false;
    try {
      const s = await stat(blobPath);
      if (s.isFile() && s.size === entry.bytes) haveLocalBlob = true;
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }

    if (!haveLocalBlob && baseUrl && typeof fetchImpl === 'function') {
      const cleanHex = entry.sha256.toLowerCase();
      const url = `${baseUrl}/objects/${cleanHex.slice(0, 2)}/${cleanHex}`;
      const res = await fetchImpl(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const gotHash = createHash('sha256').update(buf).digest('hex');
        if (gotHash !== cleanHex || buf.length !== entry.bytes) {
          throw new Error(`Integrity mismatch fetching ${relPosix} from ${url}`);
        }
        await atomicWriteFile(blobPath, async (tmp) => {
          await writeFile(tmp, buf);
        });
        haveLocalBlob = true;
        fetchedRemote++;
      }
    }

    if (!haveLocalBlob) {
      missing.push(relPosix);
      continue;
    }

    await atomicWriteFile(dstAbs, async (tmp) => {
      await pipeline(createReadStream(blobPath), createWriteStream(tmp));
    });
    pulled++;
    bytesRestored += entry.bytes;
  }

  return {
    action: 'pull',
    ok: missing.length === 0,
    gameDir: absGame,
    storeDir: store,
    pulled,
    skipped,
    fetchedRemote,
    bytesRestored,
    missing,
  };
}

/**
 * Compares `<gameDir>/assets/` on disk against `<gameDir>/assets.manifest.json`
 * and optionally verifies presence in the unified asset store.
 * @param {string} gameDir
 * @param {{ storeDir?: string|null, includeRaw?: boolean, checkStore?: boolean }} [options]
 */
export async function inspectAssetStatus(gameDir, {
  storeDir = null,
  includeRaw = false,
  checkStore = true,
} = {}) {
  const absGame = path.resolve(gameDir);
  const store = resolveAssetStoreDir(storeDir);
  const manifest = await readAssetManifest(absGame);
  const files = await collectFiles(path.join(absGame, 'assets'));
  const { files: buildFiles } = await readPixiBuildManifest(absGame);
  const isProjectFile = file => isGitOwnedProjectAsset(file, buildFiles);
  const diskMap = new Map();
  for (const file of files) {
    if (isProjectFile(file.relPosix) || shouldIgnoreForAssetTracking(file.relPosix, { includeRaw })) continue;
    diskMap.set(file.relPosix, file.abs);
  }

  const inSync = [];
  const modified = [];
  const missingLocal = [];
  const missingInStore = [];

  for (const relPosix of Object.keys(manifest.assets).sort()) {
    if (isProjectFile(relPosix)) continue;
    const entry = manifest.assets[relPosix];
    const abs = diskMap.get(relPosix);
    if (!abs) {
      missingLocal.push(relPosix);
    } else {
      const actual = await hashAndSizeFile(abs);
      if (actual.sha256 === entry.sha256 && actual.bytes === entry.bytes) {
        inSync.push(relPosix);
      } else {
        modified.push(relPosix);
      }
      diskMap.delete(relPosix);
    }
    if (checkStore && entry?.sha256) {
      try {
        const s = await stat(casObjectPath(store, entry.sha256));
        if (!s.isFile()) missingInStore.push(relPosix);
      } catch (err) {
        if (err?.code === 'ENOENT') missingInStore.push(relPosix);
        else throw err;
      }
    }
  }

  const untracked = [...diskMap.keys()].sort();
  return {
    ok: missingLocal.length === 0 && modified.length === 0 && untracked.length === 0,
    gameDir: absGame,
    storeDir: store,
    totalDeclared: Object.keys(manifest.assets).length,
    inSync,
    modified,
    missingLocal,
    untracked,
    missingInStore,
  };
}

/**
 * Removes paths from `<gameDir>/assets.manifest.json` (and optionally deletes local copies).
 * @param {string} gameDir
 * @param {string[]} relPaths
 * @param {{ deleteLocal?: boolean }} [options]
 */
export async function removeManifestAssets(gameDir, relPaths, { deleteLocal = false } = {}) {
  const absGame = path.resolve(gameDir);
  const manifest = await readAssetManifest(absGame);
  const removed = [];
  for (const p of relPaths) {
    const norm = toPosix(p).replace(/^assets\//, '');
    if (Object.prototype.hasOwnProperty.call(manifest.assets, norm)) {
      delete manifest.assets[norm];
      removed.push(norm);
    }
    if (deleteLocal) {
      await unlink(path.join(absGame, 'assets', ...norm.split('/'))).catch(() => {});
    }
  }
  await writeAssetManifest(absGame, manifest);
  return { removed, totalAssets: Object.keys(manifest.assets).length };
}

/**
 * Removes unreferenced CAS blobs from the unified store across the supplied game dirs.
 * @param {string|null|undefined} storeDir
 * @param {string[]} gameDirs
 * @param {{ dryRun?: boolean }} [options]
 */
export async function pruneAssetStore(storeDir, gameDirs, { dryRun = true } = {}) {
  if (!Array.isArray(gameDirs) || gameDirs.length === 0) {
    throw new TypeError('pruneAssetStore requires at least one project directory holding assets.manifest.json');
  }
  const store = resolveAssetStoreDir(storeDir);
  const keep = new Set();
  for (const dir of gameDirs) {
    const m = await readAssetManifest(dir);
    for (const entry of Object.values(m.assets)) {
      if (entry?.sha256) keep.add(entry.sha256.toLowerCase());
    }
  }
  const objectsDir = path.join(store, 'objects');
  const files = await collectFiles(objectsDir);
  const unreferenced = [];
  let reclaimedBytes = 0;
  for (const f of files) {
    const sha = path.posix.basename(f.relPosix).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha) || keep.has(sha)) continue;
    const s = await stat(f.abs);
    unreferenced.push(sha);
    reclaimedBytes += s.size;
    if (!dryRun) await rm(f.abs, { force: true });
  }
  return { storeDir: store, dryRun, referencedCount: keep.size, prunedCount: unreferenced.length, reclaimedBytes };
}

function parseCli(argv) {
  const command = argv[0];
  if (!command || command === '--help' || command === '-h') {
    return { command: 'help', positionals: [], flags: {} };
  }
  const positionals = [];
  const flags = {
    store: null,
    remote: null,
    only: '',
    exact: false,
    catalog: false,
    force: false,
    includeRaw: false,
    allowUntracked: false,
    deleteLocal: false,
    dryRun: false,
    games: [],
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--store') flags.store = argv[++i];
    else if (a === '--remote') flags.remote = argv[++i];
    else if (a === '--only') flags.only = argv[++i] || '';
    else if (a === '--games') flags.games.push(...(argv[++i] || '').split(',').filter(Boolean));
    else if (a === '--exact') flags.exact = true;
    else if (a === '--catalog') flags.catalog = true;
    else if (a === '--force') flags.force = true;
    else if (a === '--include-raw') flags.includeRaw = true;
    else if (a === '--allow-untracked') flags.allowUntracked = true;
    else if (a === '--delete-local') flags.deleteLocal = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a.startsWith('-')) throw new Error(`Unknown flag: ${a}`);
    else positionals.push(a);
  }
  return { command, positionals, flags };
}

async function runCli() {
  const { command, positionals, flags } = parseCli(process.argv.slice(2));
  if (command === 'help') {
    console.log(
      'Usage: node scripts/assets.mjs <push|pull|status|verify|rm|prune-store> [game-dir] [options]\n' +
      '  push [game-dir] [--catalog]  Hash assets/ binaries into unified store and update assets.manifest.json\n' +
      '  pull [game-dir]        Restore assets/ binaries from unified store or --remote URL\n' +
      '  status [game-dir]      Show diff between assets/ on disk, assets.manifest.json, and store\n' +
      '  verify [game-dir]      Like status; exits 1 if missing/modified/untracked files exist\n' +
      '  rm <game-dir> <path..> Remove entries from assets.manifest.json (--delete-local to unlink)\n' +
      '  prune-store --games d1,d2 [--dry-run]  Remove unreferenced store blobs',
    );
    return;
  }

  const gameDir = positionals[0] || '.';
  if (flags.catalog && command !== 'push') throw new Error('--catalog is supported by assets push');
  if (command === 'push') {
    const out = await pushAssets(gameDir, {
      storeDir: flags.store,
      includeRaw: flags.includeRaw,
      exact: flags.exact,
      catalog: flags.catalog,
      ...(flags.remote !== null ? { remoteBaseUrl: flags.remote } : {}),
    });
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (command === 'pull') {
    const out = await pullAssets(gameDir, {
      storeDir: flags.store,
      remote: flags.remote,
      prefix: flags.only,
      force: flags.force,
    });
    console.log(JSON.stringify(out, null, 2));
    if (!out.ok) process.exitCode = 1;
    return;
  }
  if (command === 'status' || command === 'verify') {
    const out = await inspectAssetStatus(gameDir, {
      storeDir: flags.store,
      includeRaw: flags.includeRaw,
    });
    console.log(JSON.stringify(out, null, 2));
    if (command === 'verify') {
      const failUntracked = !flags.allowUntracked && out.untracked.length > 0;
      if (out.missingLocal.length > 0 || out.modified.length > 0 || failUntracked) {
        process.exitCode = 1;
      }
    }
    return;
  }
  if (command === 'rm') {
    if (positionals.length < 2) {
      throw new Error('Usage: node scripts/assets.mjs rm <game-dir> <relPath...>');
    }
    const out = await removeManifestAssets(positionals[0], positionals.slice(1), {
      deleteLocal: flags.deleteLocal,
    });
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (command === 'prune-store') {
    const dirs = flags.games.length > 0 ? flags.games : positionals;
    const out = await pruneAssetStore(flags.store, dirs, { dryRun: flags.dryRun });
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli().catch((error) => {
    console.error(`assets tool failed: ${error.message}`);
    process.exitCode = 1;
  });
}
