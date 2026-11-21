import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_FILE_BYTES = 150 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024;
const WEB_EXTENSIONS = new Set([
  '.html', '.htm', '.js', '.mjs', '.css', '.json', '.map', '.wasm', '.data', '.pck',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico',
  '.mp3', '.ogg', '.wav', '.flac', '.mp4', '.webm', '.opus',
  '.glb', '.gltf', '.bin', '.ttf', '.otf', '.woff', '.woff2', '.txt', '.xml', '.webmanifest',
]);

function validateFilePath(value, { html = false } = {}) {
  if (typeof value !== 'string' || !value || value.length > 500 || value.includes('\\') ||
      value.startsWith('/') || /[\u0000-\u001f]/.test(value) || /^[A-Za-z]:/.test(value) ||
      value.split('/').some(part => !part || part === '.' || part === '..' || part.endsWith(':'))) return false;
  const extension = path.posix.extname(value).toLowerCase();
  return html ? ['.html', '.htm'].includes(extension) : WEB_EXTENSIONS.has(extension);
}

function gameView(game) {
  const previewUrl = game.source === 'url'
    ? game.url
    : '/games-files/' + game.id + '/' + game.entry.split('/').map(encodeURIComponent).join('/');
  return { id: game.id, name: game.name, source: game.source, status: game.status, previewUrl };
}

async function readBounded(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('文件太大。');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function send(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(data));
}

export function createGameApiHandler(gamesRoot, { listLocalGames = async () => [] } = {}) {
  const root = path.resolve(gamesRoot);
  const indexPath = path.join(root, 'index.json');
  let updateQueue = Promise.resolve();

  async function load() {
    try {
      const parsed = JSON.parse(await readFile(indexPath, 'utf8'));
      return Array.isArray(parsed.games) ? parsed.games : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function save(games) {
    await mkdir(root, { recursive: true });
    const tempPath = path.join(root, 'index-' + randomUUID() + '.tmp');
    await writeFile(tempPath, JSON.stringify({ games }, null, 2));
    await rename(tempPath, indexPath);
  }

  function mutate(operation) {
    const pending = updateQueue.then(operation);
    updateQueue = pending.catch(() => {});
    return pending;
  }

  return async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/api/games' && request.method === 'GET') {
        const games = await load();
        const localGames = await listLocalGames();
        send(response, 200, { items: [...localGames, ...games.filter(item => item.status === 'ready').map(gameView)] });
        return;
      }

      if (url.pathname === '/api/games' && request.method === 'POST') {
        const params = JSON.parse((await readBounded(request, MAX_JSON_BYTES)).toString('utf8'));
        const name = typeof params.name === 'string' ? params.name.trim() : '';
        if (!name || name.length > 80 || !['url', 'upload'].includes(params.source)) {
          send(response, 400, { error: 'INVALID_GAME', message: '请填写游戏名称。' });
          return;
        }
        let externalUrl = '';
        let entry = '';
        if (params.source === 'url') {
          try {
            const parsed = new URL(params.url);
            if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
                params.url.length > 2048) throw new Error('bad URL');
            externalUrl = parsed.href;
          } catch {
            send(response, 400, { error: 'INVALID_URL', message: '只支持 HTTP 或 HTTPS 网页地址。' });
            return;
          }
        } else {
          entry = params.entry;
          if (!validateFilePath(entry, { html: true })) {
            send(response, 400, { error: 'INVALID_ENTRY', message: '请选择 HTML 入口文件。' });
            return;
          }
        }
        const game = { id: randomUUID(), name, source: params.source, url: externalUrl, entry,
          status: params.source === 'url' ? 'ready' : 'importing' };
        await mutate(async () => {
          const games = await load();
          if (params.source === 'upload') {
            await mkdir(path.join(root, 'files', game.id), { recursive: true });
          }
          games.push(game);
          await save(games);
        });
        send(response, 201, { game: gameView(game) });
        return;
      }

      const match = url.pathname.match(/^\/api\/games\/([0-9a-f-]{36})(?:\/(files|complete))?$/i);
      if (!match) {
        send(response, 404, { error: 'NOT_FOUND' });
        return;
      }
      const [, gameId, action] = match;
      if (request.method === 'DELETE' && !action) {
        await mutate(async () => {
          const games = await load();
          const game = games.find(item => item.id === gameId);
          if (!game) return;
          await save(games.filter(item => item.id !== gameId));
          if (game.source === 'upload') await rm(path.join(root, 'files', gameId), { recursive: true, force: true });
        });
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.method === 'PUT' && action === 'files') {
        const filename = url.searchParams.get('path');
        if (!validateFilePath(filename)) {
          send(response, 400, { error: 'INVALID_PATH', message: '文件路径或类型不支持。' });
          return;
        }
        const game = (await load()).find(item => item.id === gameId);
        if (!game || game.source !== 'upload' || game.status !== 'importing') {
          send(response, 404, { error: 'GAME_NOT_IMPORTING' });
          return;
        }
        const contents = await readBounded(request, MAX_FILE_BYTES);
        const target = path.join(root, 'files', gameId, ...filename.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, contents);
        send(response, 201, { path: filename });
        return;
      }
      if (request.method === 'POST' && action === 'complete') {
        const result = await mutate(async () => {
          const games = await load();
          const game = games.find(item => item.id === gameId);
          if (!game || game.source !== 'upload' || game.status !== 'importing') return 404;
          try {
            if (!(await stat(path.join(root, 'files', gameId, ...game.entry.split('/')))).isFile()) return 409;
          } catch { return 409; }
          game.status = 'ready';
          await save(games);
          return gameView(game);
        });
        if (typeof result === 'number') send(response, result, { error: 'GAME_NOT_READY' });
        else send(response, 200, { game: result });
        return;
      }
      send(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    } catch (error) {
      if (error instanceof SyntaxError) {
        send(response, 400, { error: 'BAD_JSON' });
      } else {
        send(response, error.status || 500, { error: error.status === 413 ? 'TOO_LARGE' : 'GAME_ERROR',
          message: error.status === 413 ? error.message : '游戏操作失败。' });
        if (!error.status) console.error('Game library error:', error);
      }
    }
  };
}
