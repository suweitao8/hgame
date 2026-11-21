import { createReadStream } from 'node:fs';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { MIME } from './server-core.mjs';

const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const ENTRIES = ['index.html', 'extreme_cold.html'];
const ENTRY_OVERRIDES = {
  // The historical index.html lacks the dialogue-choice controls expected by
  // the current 3D bundle. The maintained runtime entry is 3d.html.
  'firework-html5': ['3d.html', ...ENTRIES],
};
const FOLDERS = new Set(['src', 'assets', 'audio', 'levels', 'game_art', 'data', 'dist', 'node_modules']);
const EXTENSIONS = new Set([
  '.html', '.htm', '.js', '.mjs', '.css', '.json', '.map',
  '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.ico', '.svg',
  '.mp3', '.wav', '.ogg', '.flac', '.opus', '.mp4', '.webm',
  '.glb', '.gltf', '.bin', '.wasm', '.data', '.pck',
  '.woff', '.woff2', '.ttf', '.otf', '.webmanifest', '.xml', '.txt',
]);
const NAMES = {
  'boomerang-fu-html': '回旋镖大乱斗',
  'Broforce-HTML5': 'Broforce',
  'CatKnight-HTML': 'CatKnight',
  'extreme-cold': '极寒',
  'firework-html5': '烟火',
  'Hades-Web': 'Hades',
  'pvz-fusion-html': '植物大战僵尸融合版',
};
const RENDERERS = new Set(['threejs', 'canvas2d', 'dom', 'webgl-custom', 'custom']);

function validEntry(value) {
  if (typeof value !== 'string' || !value || value.length > 300 || value.includes('\\') || value.startsWith('/')) return false;
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) return false;
  if (parts.length > 1 && !FOLDERS.has(parts[0])) return false;
  return ['.html', '.htm'].includes(path.posix.extname(value).toLowerCase());
}

async function readGameConfig(folder, realFolder, directoryName) {
  const configPath = path.join(folder, 'game.config.json');
  let raw;
  try {
    const realConfigPath = await realpath(configPath);
    if (!inside(realFolder, realConfigPath)) return false;
    raw = await readFile(realConfigPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let config;
  try { config = JSON.parse(raw); } catch { return false; }
  const allowedKeys = new Set(['schemaVersion', 'id', 'name', 'version', 'entry', 'renderer', 'runtime', 'standalone']);
  if (!config || config.schemaVersion !== 1 || config.id !== directoryName ||
      typeof config.name !== 'string' || !config.name.trim() || config.name.length > 80 ||
      !validEntry(config.entry) || !RENDERERS.has(config.renderer) ||
      config.runtime !== 'webasset-v1' || (config.standalone !== undefined && typeof config.standalone !== 'boolean') ||
      (config.version !== undefined && (typeof config.version !== 'string' || config.version.length > 40)) ||
      Object.keys(config).some(key => !allowedKeys.has(key))) {
    return false;
  }
  return {
    id: config.id,
    name: config.name.trim(),
    version: config.version || '0.1.0',
    entry: config.entry,
    renderer: config.renderer,
    runtime: config.runtime,
    standalone: config.standalone === true,
  };
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function allowedFile(segments) {
  if (!segments.length || segments.some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) return false;
  if (segments.some(part => /^(?:config|source|project)\.local\./i.test(part))) return false;
  const filename = segments.at(-1);
  if (!EXTENSIONS.has(path.extname(filename).toLowerCase())) return false;
  const base = segments[0];
  if (segments.length === 1) return !/^(?:config|source|project)(?:\.|-)/i.test(base);
  if (!FOLDERS.has(base)) return false;
  if (base === 'node_modules' && segments[1] !== 'three') return false;
  return true;
}

function respond(response, code, message) {
  response.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  response.end(message);
}

// Read-only preview of independent HTML game projects. Never copy project files
// into WebAsset, and never expose Git metadata, reverse-engineering tooling or
// local/private source configuration on the game preview origin.
export function createLocalHtmlGameLibrary(htmlGamesRoot) {
  const root = path.resolve(htmlGamesRoot);

  async function list() {
    let directories, canonicalRoot;
    try {
      [directories, canonicalRoot] = await Promise.all([readdir(root, { withFileTypes: true }), realpath(root)]);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const result = [];
    for (const dir of directories) {
      if (!dir.isDirectory() || !SLUG.test(dir.name)) continue;
      const folder = path.join(root, dir.name);
      let entry;
      try {
        const realFolder = await realpath(folder);
        if (!inside(canonicalRoot, realFolder)) continue;
        const config = await readGameConfig(folder, realFolder, dir.name);
        if (config === false) continue;
        if (config) {
          const candidate = path.resolve(folder, ...config.entry.split('/'));
          try {
            const [candidateReal, info] = await Promise.all([realpath(candidate), stat(candidate)]);
            if (!inside(realFolder, candidateReal) || !info.isFile()) continue;
            entry = config.entry;
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            continue;
          }
          result.push({
            id: 'local:' + config.id,
            runtimeId: config.id,
            name: config.name,
            version: config.version,
            source: 'local',
            status: 'ready',
            renderer: config.renderer,
            runtime: config.runtime,
            standalone: config.standalone,
            previewUrl: '/local-games/' + encodeURIComponent(dir.name) + '/' + entry,
          });
          continue;
        }
        for (const candidate of ENTRY_OVERRIDES[dir.name] || ENTRIES) {
          try {
            const [candidateReal, info] = await Promise.all([realpath(path.join(folder, candidate)), stat(path.join(folder, candidate))]);
            if (inside(realFolder, candidateReal) && info.isFile()) {
              entry = candidate;
              break;
            }
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      if (!entry) continue;
      result.push({
        id: 'local:' + dir.name,
        name: NAMES[dir.name] || dir.name,
        source: 'local',
        status: 'ready',
        previewUrl: '/local-games/' + encodeURIComponent(dir.name) + '/' + entry,
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  async function serve(request, response) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    let pieces;
    try {
      const rawPath = (request.url || '').split('?')[0];
      const pathname = decodeURIComponent(rawPath);
      if (!pathname.startsWith('/local-games/') || pathname.includes('\\') || pathname.includes('\0')) {
        respond(response, 400, 'Bad Request');
        return;
      }
      pieces = pathname.slice('/local-games/'.length).split('/');
    } catch {
      respond(response, 400, 'Bad Request');
      return;
    }
    const [slug, ...fileParts] = pieces;
    const games = await list();
    const game = games.find(item => item.id === 'local:' + slug);
    if (!game) {
      respond(response, 404, 'Not Found');
      return;
    }
    const fileSegments = fileParts.length === 1 && fileParts[0] === ''
      ? [path.posix.basename(game.previewUrl)]
      : fileParts;
    if (!allowedFile(fileSegments)) {
      respond(response, 404, 'Not Found');
      return;
    }
    const folder = path.join(root, slug);
    const target = path.resolve(folder, ...fileSegments);
    try {
      const [rootReal, targetReal] = await Promise.all([realpath(folder), realpath(target)]);
      if (!inside(rootReal, targetReal)) {
        respond(response, 403, 'Forbidden');
        return;
      }
      const info = await stat(targetReal);
      if (!info.isFile()) throw new Error('not a file');
      const extension = path.extname(targetReal).toLowerCase();
      const contentType = MIME[extension] || 'application/octet-stream';
      const headers = {
        'Content-Type': contentType,
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      };
      response.writeHead(200, headers);
      if (request.method === 'HEAD') response.end();
      else createReadStream(targetReal).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.message !== 'not a file') console.error('Local HTML preview error:', error);
      respond(response, 404, 'Not Found');
    }
  }

  return { list, serve };
}
