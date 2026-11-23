import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWebAssetServer, createGamePreviewServer } from '../server.mjs';
import { filterGames } from '../public/js/game-search.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

async function runWithGames(callback) {
  const gamesRoot = await mkdtemp(path.join(os.tmpdir(), 'webasset-games-'));
  const htmlGamesRoot = path.join(gamesRoot, 'empty-html-projects');
  await mkdir(htmlGamesRoot);
  const previewServer = createGamePreviewServer({ gamesRoot, htmlGamesRoot });
  const server = createWebAssetServer({ siteRoot: root, gamesRoot, htmlGamesRoot });
  try {
    await new Promise((resolve, reject) => {
      previewServer.once('error', reject);
      previewServer.listen(0, '127.0.0.1', resolve);
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    await callback('http://127.0.0.1:' + server.address().port, gamesRoot,
      'http://127.0.0.1:' + previewServer.address().port);
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    if (previewServer.listening) await new Promise(resolve => previewServer.close(resolve));
    await rm(gamesRoot, { recursive: true, force: true });
  }
}

test('games workspace is accessible beside the original character workspace', async () => {
  await runWithGames(async base => {
    const page = await (await fetch(base)).text();
    assert.match(page, /id="assets-view"/);
    assert.match(page, /id="games-view"/);
    assert.match(page, /data-workspace="characters"/);
    assert.match(page, /data-workspace="games"/);
    assert.match(page, /id="game-preview"[^>]*sandbox="[^"]*allow-scripts/);
    assert.doesNotMatch(page.match(/id="game-preview"[^>]*>/)?.[0] || '', /allow-same-origin/);
    const sidebar = page.match(/<aside class="workspace-sidebar game-sidebar"[\s\S]*?<\/aside>/)?.[0] || '';
    const preview = page.match(/<section class="preview-panel game-preview-panel"[\s\S]*?<\/section>/)?.[0] || '';
    assert.match(sidebar, /id="game-search"/, 'game list has a search box');
    assert.match(sidebar, /id="game-list"/, 'game library remains visible');
    assert.doesNotMatch(page, /导入 HTML、游戏文件夹或网页地址/, 'no obsolete import instructions');
    const styles = await (await fetch(base + '/css/site.css')).text();
    assert.match(styles, /\.game-search\s*\{[^}]*flex:\s*0\s+0\s+38px\s*;/,
      'search must not grow vertically in the sidebar flex layout');
    assert.doesNotMatch(sidebar, /<h1>网页游戏<\/h1>|导入 HTML|导入文件夹|添加网址/, 'no extra title or import controls');
    assert.doesNotMatch(page, /id="game-html-upload"|id="game-folder-upload"|id="game-url-dialog"/, 'no unused import interface');
    assert.doesNotMatch(sidebar, /id="game-reload"|id="game-open"|id="game-delete"|game-sidebar-actions/,
      'game list has no reload, open, or delete controls');
    assert.match(preview, /id="game-preview"/);
    assert.doesNotMatch(preview, /preview-toolbar|game-title|game-reload|game-delete|game-open|<h[1-6]/,
      'game viewport contains no title or toolbar');
    assert.equal((await fetch(base + '/js/games.js')).status, 200);
    const script = await (await fetch(base + '/js/games.js')).text();
    assert.doesNotMatch(script, /gameReload|gameOpen|gameDelete|\.removeAttribute\('href'\)|window\.confirm/,
      'remove unreachable controls and destructive action handlers');
  });
});

test('game search matches names without case or extra whitespace and preserves library order', () => {
  const items = [
    { id: 'a', name: '忍者之王' },
    { id: 'b', name: 'Firework' },
    { id: 'c', name: '忍者乱斗' },
  ];
  assert.deepEqual(filterGames(items, ' 忍者 ').map(game => game.id), ['a', 'c']);
  assert.deepEqual(filterGames(items, 'FIRE').map(game => game.id), ['b']);
  assert.deepEqual(filterGames(items, '  ').map(game => game.id), ['a', 'b', 'c']);
  assert.deepEqual(filterGames(items, '不存在'), []);
});

test('an imported HTML game with external JS and CSS is persisted and playable', async () => {
  await runWithGames(async (base, gamesRoot, previewBase) => {
    const created = await fetch(base + '/api/games', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '忍者试玩', source: 'upload', entry: 'index.html' }),
    });
    assert.equal(created.status, 201);
    const { game } = await created.json();
    assert.equal(game.status, 'importing');
    for (const [filename, contents] of Object.entries({
      'index.html': '<!doctype html><link rel="stylesheet" href="./css/game.css"><script src="./js/game.js"></script>',
      'css/game.css': 'body{background:#000}',
      'js/game.js': 'window.gameLoaded=true;',
      'data/level.json': '{"level":1}',
    })) {
      const response = await fetch(base + '/api/games/' + game.id + '/files?path=' + encodeURIComponent(filename), {
        method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: contents,
      });
      assert.equal(response.status, 201, filename + ': ' + await response.text());
    }
    const completed = await fetch(base + '/api/games/' + game.id + '/complete', { method: 'POST' });
    assert.equal(completed.status, 200);
    const list = await (await fetch(base + '/api/games')).json();
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].name, '忍者试玩');
    assert.equal(list.items[0].status, 'ready');
    assert.equal(list.items[0].previewUrl, '/games-files/' + game.id + '/index.html');
    const html = await fetch(previewBase + list.items[0].previewUrl);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type'), /text\/html/);
    assert.match(await html.text(), /game\.js/);
    const js = await fetch(previewBase + '/games-files/' + game.id + '/js/game.js');
    assert.equal(js.status, 200);
    assert.match(await js.text(), /gameLoaded/);
    assert.equal((await fetch(previewBase + '/api/games')).status, 404, 'game-only origin must not expose the editor APIs');
    assert.equal((await fetch(base + list.items[0].previewUrl)).status, 404, 'editor origin must not execute imported HTML');
    assert.match(await readFile(path.join(gamesRoot, 'files', game.id, 'css', 'game.css'), 'utf8'), /background/);
    const deleted = await fetch(base + '/api/games/' + game.id, { method: 'DELETE' });
    assert.equal(deleted.status, 204);
    assert.equal((await fetch(previewBase + list.items[0].previewUrl)).status, 404);
    assert.deepEqual((await (await fetch(base + '/api/games')).json()).items, []);
  });
});

test('game uploads reject traversal, disallowed files and URLs with unsafe schemes', async () => {
  await runWithGames(async (base, _gamesRoot, previewBase) => {
    const invalidUrl = await fetch(base + '/api/games', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '危险链接', source: 'url', url: 'javascript:alert(1)' }),
    });
    assert.equal(invalidUrl.status, 400);
    const invalidEntry = await fetch(base + '/api/games', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '逃逸', source: 'upload', entry: '../outside.html' }),
    });
    assert.equal(invalidEntry.status, 400);
    const created = await fetch(base + '/api/games', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '未完成', source: 'upload', entry: 'index.html' }),
    });
    const { game } = await created.json();
    const badFile = await fetch(base + '/api/games/' + game.id + '/files?path=..%2Foutside.html', {
      method: 'PUT', body: '<h1>bad</h1>',
    });
    assert.equal(badFile.status, 400);
    const banned = await fetch(base + '/api/games/' + game.id + '/files?path=script.exe', {
      method: 'PUT', body: 'bad',
    });
    assert.equal(banned.status, 400);
    assert.equal((await fetch(base + '/api/games/' + game.id + '/complete', { method: 'POST' })).status, 409);
    assert.equal((await fetch(previewBase + '/games-files/' + game.id + '/index.html')).status, 404);
    assert.deepEqual((await (await fetch(base + '/api/games')).json()).items, []);
    assert.equal((await fetch(base + '/assets/games/index.json')).status, 404);
  });
});

test('external webpage games can be added and removed without downloading them', async () => {
  await runWithGames(async base => {
    const response = await fetch(base + '/api/games', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '本地游戏服务', source: 'url', url: 'http://127.0.0.1:4173/game.html' }),
    });
    assert.equal(response.status, 201);
    const { game } = await response.json();
    assert.equal(game.previewUrl, 'http://127.0.0.1:4173/game.html');
    assert.equal(game.status, 'ready');
    const listed = await (await fetch(base + '/api/games')).json();
    assert.equal(listed.items[0].previewUrl, game.previewUrl);
    assert.equal((await fetch(base + '/api/games/' + game.id, { method: 'DELETE' })).status, 204);
    assert.deepEqual((await (await fetch(base + '/api/games')).json()).items, []);
  });
});
