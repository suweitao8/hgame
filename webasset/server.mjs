import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAssetBackup, listBackups, resolveBackupDir } from './lib/asset-backup.mjs';
import { openAssetDb, resolveDefaultDbPath } from './lib/asset-db.mjs';
import { createAssetHandler } from './lib/asset-server.mjs';
import { createGameApiHandler } from './lib/game-server.mjs';
import { createHGameAssetHandler } from './lib/hgame-asset-server.mjs';
import { createLocalHtmlGameLibrary } from './lib/local-html-games.mjs';
import { createStaticHandler } from './lib/server-core.mjs';

export const WEBASSET_PORT = 4174;
const PROJECT_ROOT = fileURLToPath(new URL('.', import.meta.url));
const HGAME_ROOT = path.resolve(PROJECT_ROOT, '..');

function resolveDefaultHtmlGamesRoot() {
  if (process.env.WEBASSET_HTML_GAMES_ROOT?.trim()) {
    return path.resolve(process.env.WEBASSET_HTML_GAMES_ROOT.trim());
  }
  if (process.env.HGAME_GAMES_ROOT?.trim()) {
    return path.resolve(process.env.HGAME_GAMES_ROOT.trim());
  }
  const localCfgPath = path.join(HGAME_ROOT, '.hgame.local.json');
  if (existsSync(localCfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(localCfgPath, 'utf8'));
      if (typeof cfg?.gamesRootDir === 'string' && cfg.gamesRootDir.trim()) {
        return path.resolve(HGAME_ROOT, cfg.gamesRootDir.trim());
      }
    } catch {
      // Fall back to sibling HTML directory.
    }
  }
  return path.resolve(HGAME_ROOT, '..', 'HTML');
}

function resolveHGameRuntimeRoot(siteRoot) {
  const repoRuntime = path.join(HGAME_ROOT, 'assets', 'runtime');
  if (existsSync(path.join(repoRuntime, 'index.js'))) return repoRuntime;
  const legacyRuntime = path.join(siteRoot, 'public', 'runtime', 'hgame');
  return existsSync(legacyRuntime) ? legacyRuntime : repoRuntime;
}

function resolveThreeRoot(siteRoot) {
  const candidates = [
    path.join(siteRoot, 'node_modules', 'three'),
    path.join(HGAME_ROOT, 'node_modules', 'three'),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  return candidates[1];
}

function sendJson(response, status, data) {
  const body = Buffer.from(JSON.stringify(data));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

const DEFAULT_HTML_GAMES_ROOT = resolveDefaultHtmlGamesRoot();

export function createWebAssetServer({
  siteRoot = PROJECT_ROOT,
  imageRoot = path.join(siteRoot, 'assets'),
  characterCatalog = path.join(imageRoot, 'characters', 'index.json'),
  gamesRoot = path.join(siteRoot, 'assets', 'games'),
  hgameAssetRoot = path.join(imageRoot, 'hgame'),
  proceduralRoot = path.join(imageRoot, 'procedural'),
  dbPath = null,
  backupDir = null,
  materialLibraryRoot = null,
  unrealExportRoot = null,
  anim23Root = null,
  htmlGamesRoot = DEFAULT_HTML_GAMES_ROOT,
  ...assetOptions
} = {}) {
  const resolvedSiteRoot = path.resolve(siteRoot);
  const resolvedImageRoot = path.resolve(imageRoot);
  const defaultImageRoot = path.join(resolvedSiteRoot, 'assets');
  const resolvedDbPath = dbPath
    || (resolvedImageRoot === defaultImageRoot
      ? resolveDefaultDbPath(resolvedSiteRoot)
      : path.join(path.dirname(resolvedImageRoot), 'assets.db'));
  const assetDb = openAssetDb(resolvedDbPath);

  const handleAssets = createAssetHandler({
    imageRoot: resolvedImageRoot,
    characterCatalog,
    assetDb,
    ...assetOptions,
  });
  const handleHGameAssets = createHGameAssetHandler({
    siteRoot: resolvedSiteRoot,
    hgameAssetRoot,
    proceduralRoot,
    assetDb,
    materialLibraryRoot,
    unrealExportRoot,
    anim23Root,
  });
  mkdirSync(path.join(gamesRoot, 'files'), { recursive: true });
  const localGames = createLocalHtmlGameLibrary(htmlGamesRoot);
  const handleGames = createGameApiHandler(gamesRoot, { listLocalGames: localGames.list });
  const handlePublic = createStaticHandler(path.join(resolvedSiteRoot, 'public'));
  const handleRuntime = createStaticHandler(resolveHGameRuntimeRoot(resolvedSiteRoot), { basePath: '/runtime/hgame' });
  const cnBuiltRoot = path.join(resolvedSiteRoot, 'hgame-assets-cn', 'built');
  const handleCnAssets = existsSync(cnBuiltRoot)
    ? createStaticHandler(cnBuiltRoot, { basePath: '/assets/cn' })
    : (_req, _res, next) => next();
  const handleThree = createStaticHandler(resolveThreeRoot(resolvedSiteRoot), { basePath: '/vendor/three' });

  const server = createServer(async (request, response) => {
    const reqUrl = new URL(request.url || '/', 'http://127.0.0.1');
    const pathname = reqUrl.pathname;

    if (pathname === '/api/assets/db/summary' && request.method === 'GET') {
      try {
        await handleAssets.ensureDbReady?.();
        sendJson(response, 200, assetDb.getArtSummary());
      } catch (error) {
        sendJson(response, 500, { error: 'DB_ERROR', message: error.message });
      }
      return;
    }

    if (pathname === '/api/assets/db/search' && request.method === 'GET') {
      try {
        const result = assetDb.searchArtAssets({
          query: reqUrl.searchParams.get('q') || '',
          domain: reqUrl.searchParams.get('domain') || '',
          category: reqUrl.searchParams.get('category') || '',
          ext: reqUrl.searchParams.get('ext') || '',
          limit: reqUrl.searchParams.get('limit') || 100,
          offset: reqUrl.searchParams.get('offset') || 0,
        });
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 500, { error: 'DB_ERROR', message: error.message });
      }
      return;
    }

    if (pathname === '/api/assets/db/sync' && request.method === 'POST') {
      try {
        await handleAssets.ensureDbReady?.();
        const rehash = reqUrl.searchParams.get('rehash') === 'true';
        const result = await assetDb.syncArtCatalog({ webassetRoot: resolvedSiteRoot, rehash });
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        sendJson(response, 500, { error: 'DB_SYNC_ERROR', message: error.message });
      }
      return;
    }

    if (pathname === '/api/assets/db/backups' && request.method === 'GET') {
      try {
        const resolvedBackup = resolveBackupDir({ hgameRoot: HGAME_ROOT, overrideDir: backupDir });
        const diskBackups = await listBackups({ backupDir: resolvedBackup });
        const dbSnapshots = assetDb.listBackupSnapshots(30);
        sendJson(response, 200, { ...diskBackups, dbSnapshots });
      } catch (error) {
        sendJson(response, 500, { error: 'BACKUP_LIST_ERROR', message: error.message });
      }
      return;
    }

    if (pathname === '/api/assets/db/backup' && request.method === 'POST') {
      try {
        await handleAssets.ensureDbReady?.();
        const result = await createAssetBackup({
          webassetRoot: resolvedSiteRoot,
          hgameRoot: HGAME_ROOT,
          assetDb,
          backupDir,
          notes: reqUrl.searchParams.get('notes') || 'api-triggered',
        });
        sendJson(response, 201, result);
      } catch (error) {
        sendJson(response, 500, { error: 'BACKUP_ERROR', message: error.message });
      }
      return;
    }

    if (pathname === '/api/games' || pathname.startsWith('/api/games/')) {
      await handleGames(request, response);
    } else if (pathname.startsWith('/runtime/hgame/')) {
      await handleRuntime(request, response, () => {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not Found');
      });
    } else if (pathname.startsWith('/assets/cn/')) {
      await handleCnAssets(request, response, () => {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not Found');
      });
    } else if (
      pathname.startsWith('/api/hgame/') ||
      pathname.startsWith('/files/hgame/') ||
      pathname.startsWith('/files/procedural/') ||
      pathname.startsWith('/files/hgame-materials/') ||
      pathname.startsWith('/files/hgame-anim23/') ||
      pathname.startsWith('/files/hgame-unreal/')
    ) {
      await handleHGameAssets(request, response);
    } else if (pathname.startsWith('/api/') || pathname.startsWith('/files/images/') || pathname.startsWith('/files/models/')) {
      await handleAssets(request, response);
    } else if (pathname.startsWith('/vendor/three/')) {
      await handleThree(request, response, () => {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Three.js dependency unavailable: run npm install');
      });
    } else {
      await handlePublic(request, response, () => {
        response.writeHead(404, {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end('Not Found');
      });
    }
  });

  server.on('close', () => {
    handleAssets.close?.();
    handleHGameAssets.close?.();
    try { assetDb.close(); } catch { /* already closed */ }
  });
  return server;
}

// Run uploaded games on a different origin with no editor/API routes.
// This allows relative assets, WASM fetches and localStorage without giving
// imported JavaScript access to character data or editor API endpoints.
export function createGamePreviewServer({
  siteRoot = PROJECT_ROOT,
  gamesRoot = path.join(PROJECT_ROOT, 'assets', 'games'),
  htmlGamesRoot = DEFAULT_HTML_GAMES_ROOT,
} = {}) {
  mkdirSync(path.join(gamesRoot, 'files'), { recursive: true });
  const handleGameFiles = createStaticHandler(path.join(gamesRoot, 'files'), { basePath: '/games-files' });
  const localGames = createLocalHtmlGameLibrary(htmlGamesRoot);
  const handleRuntime = createStaticHandler(resolveHGameRuntimeRoot(path.resolve(siteRoot)), { basePath: '/runtime/hgame' });
  return createServer(async (request, response) => {
    const pathname = (request.url || '').split('?')[0];
    if (pathname.startsWith('/runtime/hgame/')) {
      await handleRuntime(request, response, () => {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not Found');
      });
    } else if (pathname.startsWith('/local-games/')) {
      await localGames.serve(request, response);
    } else if ((request.url || '').split('?')[0].startsWith('/games-files/')) {
      await handleGameFiles(request, response, () => {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not Found');
      });
    } else {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number.parseInt(process.env.WEBASSET_PORT || '', 10) || WEBASSET_PORT;
  const gamePort = Number.parseInt(process.env.WEBASSET_GAME_PORT || '', 10) || 4175;
  const server = createWebAssetServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`WebAsset 角色资产库： http://127.0.0.1:${port}/`);
  });
  server.on('error', error => {
    console.error('WebAsset 启动失败：', error.message);
    process.exitCode = 1;
  });
  const gamePreview = createGamePreviewServer();
  gamePreview.listen(gamePort, '127.0.0.1', () => {
    console.log(`HTML 游戏预览： http://127.0.0.1:${gamePort}/`);
  });
  gamePreview.on('error', error => {
    console.error('HTML 游戏预览启动失败：', error.message);
    process.exitCode = 1;
  });
}
