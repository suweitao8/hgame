import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openAssetDb, resolveDefaultDbPath } from './asset-db.mjs';

const MAX_JSON_BYTES = 32 * 1024;
const MAX_MODEL_BYTES = 150 * 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.opus']);
const MODEL_KINDS = new Set(['high', 'low', 'prop', 'anim']);
const AUDIO_CATEGORIES = new Set(['sfx', 'bgm']);
const MATERIAL_CHANNELS = new Set(['color', 'normal', 'orm']);

const MIME = {
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
  '.json': 'application/json; charset=utf-8',
};

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sendJson(response, status, data, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(data));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  response.end(body);
}

const PROCEDURAL_ID_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const PROCEDURAL_EVAL_RE = /\beval\s*\(|\bnew\s+Function\s*\(/;

function safeName(value, extensions) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120 || trimmed.startsWith('.') || trimmed.includes('..')) return null;
  if (/[\\/:*?"<>|\x00-\x1f]/.test(trimmed)) return null;
  const ext = path.extname(trimmed).toLowerCase();
  if (!extensions.has(ext)) return null;
  return trimmed;
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || p.startsWith('.') || /[\x00-\x1f]/.test(p))) return null;
  return parts.join('/');
}

async function readBounded(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('TOO_LARGE');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) {
    const error = new Error('EMPTY');
    error.status = 400;
    throw error;
  }
  return buffer;
}

function validateGlb(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 28 || buffer.toString('ascii', 0, 4) !== 'glTF'
    || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) throw new Error('INVALID_MODEL');
  const jsonSize = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a || jsonSize < 2 || jsonSize > 24 * 1024 * 1024
    || jsonSize % 4 !== 0 || 20 + jsonSize > buffer.length) throw new Error('INVALID_MODEL');
  let model;
  try {
    model = JSON.parse(buffer.toString('utf8', 20, 20 + jsonSize).trim());
  } catch {
    throw new Error('INVALID_MODEL');
  }
  if (model?.asset?.version !== '2.0' || !Array.isArray(model.meshes) || !model.meshes.length) throw new Error('INVALID_MODEL');
  if (!Array.isArray(model.buffers) || model.buffers.length !== 1 || !Number.isSafeInteger(model.buffers[0].byteLength)) {
    throw new Error('INVALID_MODEL');
  }
  if (Array.isArray(model.buffers) && model.buffers.some(item => item.uri)) throw new Error('EXTERNAL_MODEL_ASSETS');
  if (Array.isArray(model.images) && model.images.some(item => item.uri && !/^data:image\/(png|jpeg|webp);base64,/i.test(item.uri))) {
    throw new Error('EXTERNAL_MODEL_ASSETS');
  }
  const binStart = 20 + jsonSize;
  if (binStart + 8 > buffer.length || buffer.readUInt32LE(binStart + 4) !== 0x004e4942
    || binStart + 8 + buffer.readUInt32LE(binStart) !== buffer.length
    || model.buffers[0].byteLength > buffer.readUInt32LE(binStart)) throw new Error('INVALID_MODEL');
}

function validateImageSignature(buffer, ext) {
  if (ext === '.png') {
    return buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (ext === '.webp') {
    return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  }
  return false;
}

function toFileUrl(relPath) {
  return '/files/hgame/' + relPath.split('/').map(encodeURIComponent).join('/');
}

function resolveCuratedRoot(siteRoot, explicitRoot) {
  if (explicitRoot) return existsSync(explicitRoot) ? path.resolve(explicitRoot) : null;
  if (process.env.HGAME_MATERIAL_LIBRARY_ROOT) {
    const envPath = path.resolve(process.env.HGAME_MATERIAL_LIBRARY_ROOT);
    return existsSync(envPath) ? envPath : null;
  }
  const candidates = [
    path.resolve(siteRoot, '..', 'HGame', 'assets', 'material-library'),
    path.resolve(siteRoot, '..', 'HTML', 'world-material-lab', 'assets', 'pbr-materials'),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'catalog.json'))) return candidate;
  }
  return null;
}

function resolveExportRoot(explicitRoot, envVar, defaultPath) {
  if (explicitRoot) {
    return existsSync(path.join(explicitRoot, 'catalog.json')) ? path.resolve(explicitRoot) : null;
  }
  if (process.env[envVar]) {
    const envPath = path.resolve(process.env[envVar]);
    return existsSync(path.join(envPath, 'catalog.json')) ? envPath : null;
  }
  return existsSync(path.join(defaultPath, 'catalog.json')) ? defaultPath : null;
}

function emptyIndex() {
  return {
    schemaVersion: 1,
    models: [],
    spritesheets: [],
    vfx: [],
    materials: [],
    audio: [],
  };
}

export function createHGameAssetHandler({
  siteRoot,
  hgameAssetRoot = path.join(siteRoot, 'assets', 'hgame'),
  proceduralRoot = path.join(siteRoot, 'assets', 'procedural'),
  assetDb = null,
  dbPath = null,
  materialLibraryRoot = null,
  unrealExportRoot = null,
  unityExportRoot = null,
} = {}) {
  const root = path.resolve(hgameAssetRoot);
  const procRoot = path.resolve(proceduralRoot);
  const indexPath = path.join(root, 'index.json');
  const procManifestPath = path.join(procRoot, 'manifest.json');
  let updateQueue = Promise.resolve();
  let ownedDb = null;

  function getDb() {
    if (assetDb) return assetDb;
    if (!ownedDb) {
      const defaultRoot = path.resolve(siteRoot, 'assets', 'hgame');
      const resolvedDb = dbPath || (root === defaultRoot ? resolveDefaultDbPath(siteRoot) : path.join(path.dirname(root), 'hgame-assets.db'));
      ownedDb = openAssetDb(resolvedDb);
    }
    return ownedDb;
  }

  async function ensureDbReady() {
    const db = getDb();
    if (db.countHGameAssets() === 0 && existsSync(indexPath)) {
      try {
        const parsed = JSON.parse(await readFile(indexPath, 'utf8'));
        db.importHGameIndexIfEmpty(parsed, root);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return db;
  }

  function getCuratedRoot() {
    return null;
  }

  function getUnrealRoot() {
    return resolveExportRoot(unrealExportRoot, 'HGAME_UNREAL_EXPORT_ROOT', 'D:\\UnrealWorkspace\\Anim58\\Saved\\WebAssetExport');
  }

  function getUnityRoot() {
    return resolveExportRoot(unityExportRoot, 'HGAME_UNITY_EXPORT_ROOT', 'D:\\UnityWorkspace\\AssetTest\\Saved\\WebAssetExport');
  }

  async function loadProceduralManifest() {
    try {
      const parsed = JSON.parse(await readFile(procManifestPath, 'utf8'));
      const materials = Array.isArray(parsed.materials) ? parsed.materials : [];
      const meshes = Array.isArray(parsed.meshes) ? parsed.meshes : [];
      return {
        format: 'hgame.manifest',
        version: 1,
        materials,
        meshes,
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { format: 'hgame.manifest', version: 1, materials: [], meshes: [] };
      }
      throw error;
    }
  }

  async function saveProceduralManifest(manifest) {
    await mkdir(procRoot, { recursive: true });
    const temp = path.join(procRoot, `manifest-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(manifest, null, 2) + '\n');
    await rename(temp, procManifestPath);
  }

  async function loadIndex() {
    const db = await ensureDbReady();
    return db.listHGameAssets(toFileUrl);
  }

  async function saveIndex(data) {
    await mkdir(root, { recursive: true });
    const temp = path.join(root, `index-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(data, null, 2));
    await rename(temp, indexPath);
  }

  function mutate(operation) {
    const pending = updateQueue.then(operation);
    updateQueue = pending.catch(() => {});
    return pending;
  }

  function registeredPaths(index) {
    const allowed = new Set();
    for (const item of index.models) if (item?.path) allowed.add(item.path);
    for (const item of index.spritesheets) if (item?.path) allowed.add(item.path);
    for (const item of index.audio) if (item?.path) allowed.add(item.path);
    for (const item of index.materials) {
      for (const ch of MATERIAL_CHANNELS) {
        if (item?.maps?.[ch]?.path) allowed.add(item.maps[ch].path);
      }
    }
    return allowed;
  }

  async function writeStoredFile(folder, ext, buffer) {
    const dir = path.join(root, folder);
    await mkdir(dir, { recursive: true });
    const filename = `${randomUUID()}${ext}`;
    const relPath = `${folder}/${filename}`;
    const absPath = path.join(root, relPath);
    const [realRoot, realDir] = await Promise.all([realpath(root), realpath(dir)]);
    if (!isInside(realRoot, realDir)) throw new Error('ESCAPE');
    const tempPath = path.join(dir, `.upload-${randomUUID()}.tmp`);
    await writeFile(tempPath, buffer);
    await rename(tempPath, absPath);
    return relPath;
  }

  async function removeStoredFile(relPath) {
    if (!relPath) return;
    const target = path.resolve(root, relPath);
    if (!isInside(root, target)) return;
    await unlink(target).catch(() => {});
  }

  async function serveStream(request, response, absPath, contentType, extraHeaders = {}) {
    const info = await stat(absPath);
    if (!info.isFile()) {
      response.writeHead(404);
      response.end('Not Found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(absPath).on('error', () => response.destroy()).pipe(response);
  }

  function clampInt(value, fallback, min, max) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function clampNum(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  const handler = async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    try {
      if (pathname === '/api/hgame/assets' && request.method === 'GET') {
        const index = await loadIndex();
        const cnCatalogPath = path.join(siteRoot, 'hgame-assets-cn', 'built', 'catalog.json');
        sendJson(response, 200, {
          ...index,
          curatedMaterialsAvailable: false,
          proceduralAvailable: false,
          cnAssetsAvailable: existsSync(cnCatalogPath),
          pbrAtlasAvailable: existsSync(path.join(siteRoot, 'hgame-assets-cn', 'built', 'materials', 'material_table.json')),
        });
        return;
      }

      if (pathname === '/api/hgame/cn/catalog' && (request.method === 'GET' || request.method === 'HEAD')) {
        const cnCatalogPath = path.join(siteRoot, 'hgame-assets-cn', 'built', 'catalog.json');
        if (!existsSync(cnCatalogPath)) {
          sendJson(response, 200, { available: false, models: [], materials: [], decals: [], foliage: [], hdri: [] });
          return;
        }
        const catalog = JSON.parse(await readFile(cnCatalogPath, 'utf8'));
        sendJson(
          response,
          200,
          { available: true, baseUrl: '/assets/cn', ...catalog },
          { 'Access-Control-Allow-Origin': '*' },
        );
        return;
      }

      if (pathname.startsWith('/api/hgame/procedural/')) {
        sendJson(response, 404, {
          error: 'PROCEDURAL_ASSETS_DISABLED',
          message: '程序化 .hmat/.hmesh 已按 Phase 0 彻底移除，请使用 hgame-assets-cn 静态母库。',
        });
        return;
      }

      if (pathname === '/api/hgame/unity/catalog' && request.method === 'GET') {
        const unityRoot = getUnityRoot();
        if (!unityRoot) {
          sendJson(response, 200, { available: false, vfxSystems: [], vfxMeshes: [], vfxTextures: [] });
          return;
        }
        const catalogPath = path.join(unityRoot, 'catalog.json');
        if (!existsSync(catalogPath)) {
          sendJson(response, 200, { available: false, vfxSystems: [], vfxMeshes: [], vfxTextures: [] });
          return;
        }
        try {
          const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
          sendJson(response, 200, {
            available: true,
            sourceEngine: 'unity',
            vfxSystems: Array.isArray(catalog.vfxSystems) ? catalog.vfxSystems : [],
            vfxMeshes: Array.isArray(catalog.vfxMeshes) ? catalog.vfxMeshes : [],
            vfxTextures: Array.isArray(catalog.vfxTextures) ? catalog.vfxTextures : [],
          });
        } catch {
          sendJson(response, 200, { available: false, vfxSystems: [], vfxMeshes: [], vfxTextures: [] });
        }
        return;
      }

      if (pathname === '/api/hgame/unreal/catalog' && request.method === 'GET') {
        const unrealRoot = getUnrealRoot();
        if (!unrealRoot) {
          sendJson(response, 200, { available: false, characters: [], animations: [], staticModels: [], vfxSystems: [], vfxMeshes: [], vfxTextures: [], materials: [], decals: [], audio: [] });
          return;
        }
        const catalogPath = path.join(unrealRoot, 'catalog.json');
        if (!existsSync(catalogPath)) {
          sendJson(response, 200, { available: false, characters: [], animations: [], staticModels: [], vfxSystems: [], vfxMeshes: [], vfxTextures: [], materials: [], decals: [], audio: [] });
          return;
        }
        try {
          const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
          sendJson(response, 200, {
            available: true,
            generatedAt: catalog.generatedAt || null,
            characters: [],
            animations: Array.isArray(catalog.animations) ? catalog.animations : [],
            staticModels: [],
            vfxSystems: Array.isArray(catalog.vfxSystems) ? catalog.vfxSystems : [],
            vfxMeshes: Array.isArray(catalog.vfxMeshes) ? catalog.vfxMeshes : [],
            vfxTextures: Array.isArray(catalog.vfxTextures) ? catalog.vfxTextures : [],
            materials: [],
            decals: Array.isArray(catalog.decals) ? catalog.decals : [],
            audio: Array.isArray(catalog.audio) ? catalog.audio : [],
          });
        } catch {
          sendJson(response, 200, { available: false, characters: [], animations: [], staticModels: [], vfxSystems: [], vfxMeshes: [], vfxTextures: [], materials: [], decals: [], audio: [] });
        }
        return;
      }

      if (pathname === '/api/hgame/materials/curated' && request.method === 'GET') {
        sendJson(response, 200, { available: false, version: 1, materials: [] });
        return;
      }

      if (pathname === '/api/hgame/models' && request.method === 'POST') {
        sendJson(response, 404, { error: 'STATIC_MODELS_DISABLED', message: '静态 GLB 模型已迁移为程序化 .hmesh.json 配方。' });
        return;
      }

      if (pathname === '/api/hgame/spritesheets' && request.method === 'POST') {
        const name = safeName(url.searchParams.get('name'), IMAGE_EXTENSIONS);
        if (!name) {
          sendJson(response, 400, { error: 'BAD_NAME', message: '只支持 PNG、JPG、WebP 精灵图。' });
          return;
        }
        const ext = path.extname(name).toLowerCase();
        const buffer = await readBounded(request, MAX_IMAGE_BYTES);
        if (!validateImageSignature(buffer, ext)) {
          sendJson(response, 400, { error: 'INVALID_IMAGE', message: '文件内容与图片格式不匹配。' });
          return;
        }
        const columns = clampInt(url.searchParams.get('columns'), 3, 1, 64);
        const rows = clampInt(url.searchParams.get('rows'), 3, 1, 64);
        const fps = clampInt(url.searchParams.get('fps'), 8, 1, 60);
        const inset = clampNum(url.searchParams.get('inset'), 0, 0, 32);
        const loop = url.searchParams.get('loop') !== 'false';
        const item = await mutate(async () => {
          const db = await ensureDbReady();
          const relPath = await writeStoredFile('spritesheets', ext, buffer);
          const id = randomUUID();
          const createdAt = new Date().toISOString();
          const sha256 = createHash('sha256').update(buffer).digest('hex');
          db.insertHGameAsset({
            id,
            kind: 'spritesheet',
            name,
            relPath,
            sha256,
            bytes: buffer.length,
            metadata: { columns, rows, fps, inset, loop },
            createdAt,
          });
          await saveIndex(db.listHGameAssets(toFileUrl));
          return {
            id,
            name,
            columns,
            rows,
            fps,
            inset,
            loop,
            path: relPath,
            url: toFileUrl(relPath),
            createdAt,
          };
        });
        sendJson(response, 201, { item });
        return;
      }

      if (pathname.startsWith('/api/hgame/spritesheets/') && request.method === 'PATCH') {
        const id = pathname.slice('/api/hgame/spritesheets/'.length);
        const body = JSON.parse((await readBounded(request, MAX_JSON_BYTES)).toString('utf8'));
        const item = await mutate(async () => {
          const db = await ensureDbReady();
          const current = db.listHGameAssets(toFileUrl).spritesheets.find(entry => entry.id === id);
          if (!current) return null;
          const updated = db.updateHGameSpritesheet(id, {
            name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : current.name,
            columns: body.columns !== undefined ? clampInt(body.columns, current.columns, 1, 64) : current.columns,
            rows: body.rows !== undefined ? clampInt(body.rows, current.rows, 1, 64) : current.rows,
            fps: body.fps !== undefined ? clampInt(body.fps, current.fps, 1, 60) : current.fps,
            inset: body.inset !== undefined ? clampNum(body.inset, current.inset, 0, 32) : current.inset,
            loop: body.loop !== undefined ? Boolean(body.loop) : current.loop,
          });
          if (!updated) return null;
          await saveIndex(db.listHGameAssets(toFileUrl));
          return { ...updated, url: toFileUrl(updated.path) };
        });
        if (!item) {
          sendJson(response, 404, { error: 'NOT_FOUND', message: '找不到该精灵图。' });
          return;
        }
        sendJson(response, 200, { item });
        return;
      }

      if (pathname === '/api/hgame/materials/textures' && request.method === 'POST') {
        sendJson(response, 404, { error: 'STATIC_MATERIALS_DISABLED', message: '静态贴图材质已禁用，请使用 CC0 实拍 PBR 材质管线。' });
        return;
      }

      if (pathname === '/api/hgame/audio' && request.method === 'POST') {
        const name = safeName(url.searchParams.get('name'), AUDIO_EXTENSIONS);
        if (!name) {
          sendJson(response, 400, { error: 'BAD_NAME', message: '只支持 MP3、WAV、OGG、FLAC、OPUS 音频文件。' });
          return;
        }
        const ext = path.extname(name).toLowerCase();
        const categoryParam = url.searchParams.get('category') || 'sfx';
        const category = AUDIO_CATEGORIES.has(categoryParam) ? categoryParam : 'sfx';
        const buffer = await readBounded(request, MAX_AUDIO_BYTES);
        const item = await mutate(async () => {
          const db = await ensureDbReady();
          const relPath = await writeStoredFile('audio', ext, buffer);
          const id = randomUUID();
          const createdAt = new Date().toISOString();
          const sha256 = createHash('sha256').update(buffer).digest('hex');
          db.insertHGameAsset({
            id,
            kind: 'audio',
            name,
            relPath,
            sha256,
            bytes: buffer.length,
            metadata: { category },
            createdAt,
          });
          await saveIndex(db.listHGameAssets(toFileUrl));
          return {
            id,
            name,
            category,
            bytes: buffer.length,
            path: relPath,
            url: toFileUrl(relPath),
            createdAt,
          };
        });
        sendJson(response, 201, { item });
        return;
      }

      const deleteMatch = /^\/api\/hgame\/(models|spritesheets|vfx|materials|audio)\/([^/]+)$/.exec(pathname);
      if (deleteMatch && request.method === 'DELETE') {
        const [, kind, id] = deleteMatch;
        const removed = await mutate(async () => {
          const db = await ensureDbReady();
          const deleted = db.deleteHGameAsset(kind, id);
          if (!deleted) return null;
          await saveIndex(db.listHGameAssets(toFileUrl));
          if (deleted.rel_path) await removeStoredFile(deleted.rel_path);
          return deleted;
        });
        if (!removed) {
          sendJson(response, 404, { error: 'NOT_FOUND', message: '找不到该资产。' });
          return;
        }
        response.writeHead(204);
        response.end();
        return;
      }

      if (pathname.startsWith('/files/hgame/')) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { Allow: 'GET, HEAD' });
          response.end();
          return;
        }
        let relPath;
        try {
          relPath = safeRelativePath(decodeURIComponent(pathname.slice('/files/hgame/'.length)));
        } catch {
          relPath = null;
        }
        if (!relPath) {
          response.writeHead(404);
          response.end('Not Found');
          return;
        }
        const index = await loadIndex();
        if (!registeredPaths(index).has(relPath)) {
          response.writeHead(404);
          response.end('Not Found');
          return;
        }
        const abs = path.resolve(root, relPath);
        const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(abs)]);
        if (!isInside(realRoot, realTarget)) {
          response.writeHead(403);
          response.end('Forbidden');
          return;
        }
        const ext = path.extname(realTarget).toLowerCase();
        await serveStream(request, response, realTarget, MIME[ext] || 'application/octet-stream');
        return;
      }

      async function serveExportedFile(exportRoot, prefix, allowedPattern) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { Allow: 'GET, HEAD' });
          response.end();
          return;
        }
        if (!exportRoot) {
          response.writeHead(404);
          response.end('Not Found');
          return;
        }
        let rawRelPath = '';
        try {
          rawRelPath = decodeURIComponent(pathname.slice(prefix.length));
        } catch {
          rawRelPath = '';
        }
        const relPath = safeRelativePath(rawRelPath);
        if (!relPath || !allowedPattern.test(relPath)) {
          response.writeHead(404);
          response.end('Not Found');
          return;
        }
        const target = path.resolve(exportRoot, relPath);
        if (!isInside(exportRoot, target) || !existsSync(target)) {
          response.writeHead(404);
          response.end('Not Found');
          return;
        }
        let realRoot;
        let realTarget;
        try {
          realRoot = await realpath(exportRoot);
          realTarget = await realpath(target);
        } catch {
          response.writeHead(404);
          response.end('Not Found');
          return;
        }
        if (!isInside(realRoot, realTarget)) {
          response.writeHead(404);
          response.end('Not Found');
          return;
        }
        const ext = path.extname(realTarget).toLowerCase();
        await serveStream(request, response, realTarget, MIME[ext] || 'application/octet-stream');
      }

      if (pathname.startsWith('/files/procedural/')) {
        sendJson(response, 404, { error: 'PROCEDURAL_ASSETS_DISABLED', message: '程序化 .hmesh 已移除。' });
        return;
      }

      if (pathname.startsWith('/files/hgame-unreal/')) {
        await serveExportedFile(
          getUnrealRoot(),
          '/files/hgame-unreal/',
          /^(animations|vfx_meshes|vfx_textures|decals|audio)\/[A-Za-z0-9_.\-]+\.(glb|wav|png|webp|jpg|jpeg|mp3|ogg)$/i,
        );
        return;
      }

      if (pathname.startsWith('/files/hgame-unity/')) {
        await serveExportedFile(
          getUnityRoot(),
          '/files/hgame-unity/',
          /^(meshes|textures)\/[A-Za-z0-9_.\-]+\.(glb|png|webp|jpg|jpeg)$/i,
        );
        return;
      }

      if (pathname.startsWith('/files/hgame-materials/')) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { Allow: 'GET, HEAD' });
          response.end();
          return;
        }
        const curatedRoot = getCuratedRoot();
        if (!curatedRoot) {
          response.writeHead(404);
          response.end('Not Found');
          return;
        }
        let relPath;
        try {
          relPath = safeRelativePath(decodeURIComponent(pathname.slice('/files/hgame-materials/'.length)));
        } catch {
          relPath = null;
        }
        const allowedTop = relPath && (relPath === 'catalog.json' || relPath.startsWith('textures/') || relPath.startsWith('thumbnails/'));
        if (!allowedTop) {
          response.writeHead(404);
          response.end('Not Found');
          return;
        }
        const ext = path.extname(relPath).toLowerCase();
        if (!['.json', '.webp', '.png', '.jpg'].includes(ext)) {
          response.writeHead(404);
          response.end('Not Found');
          return;
        }
        const abs = path.resolve(curatedRoot, relPath);
        const [realRoot, realTarget] = await Promise.all([realpath(curatedRoot), realpath(abs)]);
        if (!isInside(realRoot, realTarget)) {
          response.writeHead(403);
          response.end('Forbidden');
          return;
        }
        await serveStream(request, response, realTarget, MIME[ext] || 'application/octet-stream');
        return;
      }

      response.writeHead(404);
      response.end('Not Found');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        response.writeHead(404);
        response.end('Not Found');
        return;
      }
      if (error?.message === 'TOO_LARGE' || error?.status === 413) {
        sendJson(response, 413, { error: 'TOO_LARGE', message: '文件超出大小限制。' });
        return;
      }
      if (error?.message === 'EMPTY') {
        sendJson(response, 400, { error: 'EMPTY', message: '上传内容为空。' });
        return;
      }
      if (error?.message === 'INVALID_MODEL') {
        sendJson(response, 400, { error: 'INVALID_MODEL', message: '不是有效的 glTF 2.0 GLB 模型。' });
        return;
      }
      if (error?.message === 'EXTERNAL_MODEL_ASSETS') {
        sendJson(response, 400, { error: 'EXTERNAL_MODEL_ASSETS', message: 'GLB 必须自包含贴图和缓冲数据。' });
        return;
      }
      sendJson(response, 500, { error: 'HGAME_ASSET_ERROR', message: error?.message || '资产服务异常。' });
    }
  };

  handler.close = () => {
    if (ownedDb) {
      ownedDb.close();
      ownedDb = null;
    }
  };
  return handler;
}
