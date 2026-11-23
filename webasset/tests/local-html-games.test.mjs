import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createWebAssetServer, createGamePreviewServer } from '../server.mjs';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const cases = [
  ['boomerang-fu-html', 'index.html'],
  ['Broforce-HTML5', 'index.html'],
  ['CatKnight-HTML', 'index.html'],
  ['extreme-cold', 'extreme_cold.html'],
  ['firework-html5', '3d.html'],
  ['Hades-Web', 'index.html'],
  ['pvz-fusion-html', 'index.html'],
];

async function start(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return 'http://127.0.0.1:' + server.address().port;
}

async function withLocalGames(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webasset-html-projects-'));
  const htmlGamesRoot = path.join(root, 'HTML');
  const gamesRoot = path.join(root, 'webasset-data');
  await mkdir(htmlGamesRoot, { recursive: true });
  for (const [name, entry] of cases) {
    const directory = path.join(htmlGamesRoot, name);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, entry), '<!doctype html><title>' + name + '</title><script src="./src/main.js"></script>');
    await mkdir(path.join(directory, 'src'));
    await writeFile(path.join(directory, 'src/main.js'), 'window.started = true;');
  }
  await mkdir(path.join(htmlGamesRoot, 'NotAGame'), { recursive: true });
  const site = createWebAssetServer({ siteRoot, gamesRoot, htmlGamesRoot });
  const preview = createGamePreviewServer({ gamesRoot, htmlGamesRoot });
  try {
    const siteUrl = await start(site);
    const previewUrl = await start(preview);
    await callback({ siteUrl, previewUrl, htmlGamesRoot });
  } finally {
    if (site.listening) await new Promise(resolve => site.close(resolve));
    if (preview.listening) await new Promise(resolve => preview.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

test('the site automatically lists seven HTML projects without import or per-game servers', async () => {
  await withLocalGames(async ({ siteUrl, previewUrl }) => {
    const runtime = await fetch(previewUrl + '/runtime/hgame/platform/engine.js');
    assert.equal(runtime.status, 200);
    assert.match(await runtime.text(), /createGameEngine/);
    assert.equal((await fetch(previewUrl + '/runtime/hgame/platform/lifecycle.js')).status, 200,
      'relative module imports under the runtime URL work');
    assert.equal((await fetch(siteUrl + '/runtime/hgame/index.js')).status, 200,
      'the main WebAsset origin exposes the HGame runtime');
    const result = await fetch(siteUrl + '/api/games');
    assert.equal(result.status, 200);
    const { items } = await result.json();
    assert.equal(items.length, 7);
    for (const [name, entry] of cases) {
      const game = items.find(item => item.id === 'local:' + name);
      assert.ok(game, 'missing ' + name);
      assert.equal(game.source, 'local');
      assert.equal(game.previewUrl, '/local-games/' + encodeURIComponent(name) + '/' + entry);
      assert.equal(game.status, 'ready');
      const html = await fetch(previewUrl + game.previewUrl);
      assert.equal(html.status, 200, name);
      assert.match(await html.text(), new RegExp(name));
      assert.equal((await fetch(siteUrl + game.previewUrl)).status, 404, 'editor must not host game HTML');
    }
    assert.equal((await fetch(previewUrl + '/api/games')).status, 404);
  });
});

test('games load local JS, generated bundles, Three.js, images, JSON, models and audio', async () => {
  await withLocalGames(async ({ previewUrl, htmlGamesRoot }) => {
    const files = [
      ['boomerang-fu-html', 'node_modules/three/build/three.module.js', 'export const THREE = true;', /javascript/],
      ['firework-html5', 'dist/game3d.bundle.js', 'window.rendered = true;', /javascript/],
      ['Broforce-HTML5', 'levels/pack.js', 'window.levels = [];', /javascript/],
      ['extreme-cold', 'game_art/Map.webp', 'img bytes', /image\/webp/],
      ['Hades-Web', 'assets/original-launch/textures/background.png', 'png bytes', /image\/png/],
      ['pvz-fusion-html', 'assets/audio/Day.ogg', 'ogg bytes', /audio\/ogg/],
      ['CatKnight-HTML', 'assets/cards/example.webp', 'img bytes', /image\/webp/],
    ];
    for (const [name, file, content, mime] of files) {
      const destination = path.join(htmlGamesRoot, name, ...file.split('/'));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content);
      const response = await fetch(previewUrl + '/local-games/' + name + '/' + file);
      assert.equal(response.status, 200, name + ': ' + file);
      assert.match(response.headers.get('content-type'), mime);
      assert.equal(await response.text(), content);
    }
    const privateDir = path.join(htmlGamesRoot, 'firework-html5', 'assets-private', 'polygon');
    await mkdir(privateDir, { recursive: true });
    await writeFile(path.join(privateDir, 'actor.glb'), 'glb bytes');
    assert.equal((await fetch(previewUrl + '/assets-private/polygon/actor.glb')).status, 404,
      'legacy root-relative Polygon asset route must be removed');
    assert.equal((await fetch(previewUrl + '/local-games/firework-html5/assets-private/polygon/actor.glb')).status, 404,
      'legacy assets-private/polygon folder must not be served');
  });
});

test('preview never exposes source code tooling, secrets or other project paths', async () => {
  await withLocalGames(async ({ previewUrl, htmlGamesRoot }) => {
    const dir = path.join(htmlGamesRoot, 'Hades-Web');
    await mkdir(path.join(dir, 'analysis'), { recursive: true });
    await mkdir(path.join(dir, '.git'), { recursive: true });
    await writeFile(path.join(dir, 'analysis/private.json'), 'secret');
    await writeFile(path.join(dir, 'config.local.json'), 'secret');
    await writeFile(path.join(dir, 'source.local.json'), 'secret');
    await writeFile(path.join(dir, '.git/config'), 'secret');
    await writeFile(path.join(dir, 'AGENTS.md'), 'not public');
    await writeFile(path.join(dir, 'src/main.js'), 'safe');
    const paths = [
      'Hades-Web/analysis/private.json',
      'Hades-Web/config.local.json',
      'Hades-Web/source.local.json',
      'Hades-Web/.git/config',
      'Hades-Web/AGENTS.md',
      'Hades-Web/..%2Fboomerang-fu-html/index.html',
      'UnknownGame/index.html',
      'Hades-Web/tools/audit.py',
    ];
    for (const requestPath of paths) {
      const response = await fetch(previewUrl + '/local-games/' + requestPath);
      assert.notEqual(response.status, 200, requestPath);
    }
    assert.equal((await fetch(previewUrl + '/local-games/Hades-Web/src/main.js')).status, 200);
  });
});

test('the catalog updates when a game folder is added or its entry disappears', async () => {
  await withLocalGames(async ({ siteUrl, htmlGamesRoot }) => {
    const newGame = path.join(htmlGamesRoot, 'new-demo');
    await mkdir(newGame);
    await writeFile(path.join(newGame, 'index.html'), '<h1>new</h1>');
    let items = (await (await fetch(siteUrl + '/api/games')).json()).items;
    assert.ok(items.find(item => item.id === 'local:new-demo'));
    await rm(path.join(newGame, 'index.html'));
    items = (await (await fetch(siteUrl + '/api/games')).json()).items;
    assert.equal(items.some(item => item.id === 'local:new-demo'), false);
  });
});

test('new projects use game.config.json and WebAsset exposes only the declared safe entry', async () => {
  await withLocalGames(async ({ siteUrl, previewUrl, htmlGamesRoot }) => {
    const folder = path.join(htmlGamesRoot, 'runtime-demo');
    await mkdir(path.join(folder, 'dist'), { recursive: true });
    await writeFile(path.join(folder, 'dist/main.html'), '<h1>Configured game</h1>');
    await writeFile(path.join(folder, 'index.html'), '<h1>Legacy entry must not win</h1>');
    await writeFile(path.join(folder, 'game.config.json'), JSON.stringify({
      schemaVersion: 1,
      id: 'runtime-demo',
      name: 'Runtime Demo',
      entry: 'dist/main.html',
      renderer: 'threejs',
      runtime: 'webasset-v1',
      standalone: false,
    }));
    const items = (await (await fetch(siteUrl + '/api/games')).json()).items;
    const game = items.find(item => item.runtimeId === 'runtime-demo');
    assert.ok(game);
    assert.equal(game.name, 'Runtime Demo');
    assert.equal(game.renderer, 'threejs');
    assert.equal(game.runtime, 'webasset-v1');
    assert.equal(game.standalone, false);
    assert.equal(game.previewUrl, '/local-games/runtime-demo/dist/main.html');
    assert.match(await (await fetch(previewUrl + game.previewUrl)).text(), /Configured game/);
  });
});

test('invalid game.config.json cannot register traversal entries or mismatched game ids', async () => {
  await withLocalGames(async ({ siteUrl, htmlGamesRoot }) => {
    for (const [folderName, config] of [
      ['bad-traversal', { schemaVersion: 1, id: 'bad-traversal', name: 'Bad', entry: '../secret.html', renderer: 'dom', runtime: 'webasset-v1' }],
      ['bad-id', { schemaVersion: 1, id: 'other-folder', name: 'Bad', entry: 'index.html', renderer: 'dom', runtime: 'webasset-v1' }],
      ['bad-renderer', { schemaVersion: 1, id: 'bad-renderer', name: 'Bad', entry: 'index.html', renderer: 'unity', runtime: 'webasset-v1' }],
      ['bad-folder', { schemaVersion: 1, id: 'bad-folder', name: 'Bad', entry: 'analysis/index.html', renderer: 'dom', runtime: 'webasset-v1' }],
    ]) {
      const folder = path.join(htmlGamesRoot, folderName);
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, 'index.html'), '<h1>Not registered</h1>');
      await writeFile(path.join(folder, 'game.config.json'), JSON.stringify(config));
    }
    const items = (await (await fetch(siteUrl + '/api/games')).json()).items;
    assert.equal(items.some(item => item.runtimeId?.startsWith('bad-') || item.runtimeId === 'other-folder'), false);
  });
});
