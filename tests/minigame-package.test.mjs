import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import AdmZip from 'adm-zip';
import { packageGameRelease } from '../scripts/package-game.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = path.join(root, 'tests/fixtures/minigame-canvas');
const exec = promisify(execFile);
const config = {
  entry: 'src/main.js',
  deviceOrientation: 'landscape',
  assets: ['assets/level.json'],
};

async function createProject(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hgame-minigame-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'src'));
  await mkdir(path.join(dir, 'assets'));
  await writeFile(path.join(dir, 'game.config.json'), JSON.stringify({ id: 'test-game', version: '1.2' }));
  await writeFile(path.join(dir, 'engine.config.json'), JSON.stringify({ renderer: 'canvas2d' }));
  await writeFile(path.join(dir, 'minigame.config.json'), JSON.stringify({ entry: 'src/main.js' }));
  await writeFile(path.join(dir, 'src/main.js'), 'export function start(host) { host.canvas.getContext("2d"); }');
  return dir;
}

function createHost(archive, saved, target = 'wechat') {
  const handlers = new Map();
  const drawnText = [];
  const audioPaths = [];
  const images = [];
  const frames = new Map();
  let fills = 0;
  let frameId = 0;
  let windowInfo = { windowWidth: 360, windowHeight: 800, pixelRatio: 2 };
  const canvas = {
    getContext(type) {
      assert.equal(type, '2d');
      return {
        clearRect() {}, fillRect() { fills++; }, drawImage() {},
        setTransform() {}, translate() {}, rotate() {}, scale() {}, save() {}, restore() {},
        fillText: (text) => drawnText.push(text),
      };
    },
  };
  const api = {
    createCanvas: () => canvas,
    [target === 'wechat' ? 'getWindowInfo' : 'getSystemInfoSync']: () => windowInfo,
    getFileSystemManager: () => ({
      readFile({ filePath, encoding, success, fail }) {
        const bytes = archive.readFile(filePath);
        if (!bytes) return fail({ errMsg: 'missing file' });
        success({ data: encoding ? bytes.toString(encoding) : Uint8Array.from(bytes).buffer });
      },
    }),
    createImage() {
      return { set src(value) { images.push(value); queueMicrotask(() => this.onload?.()); } };
    },
    createInnerAudioContext() {
      return { play() { audioPaths.push(this.src); }, destroy() {} };
    },
    getStorageInfoSync: () => ({ keys: Array.from(saved.keys()) }),
    getStorageSync: (key) => saved.get(key) ?? '',
    setStorageSync: (key, value) => saved.set(key, value),
    removeStorageSync: (key) => saved.delete(key),
  };
  const resizeEvent = target === 'wechat' ? 'WindowResize' : 'DeviceOrientationChange';
  for (const name of ['TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel', 'Show', 'Hide', resizeEvent]) {
    api['on' + name] = (listener) => handlers.set(name, listener);
    api['off' + name] = (listener) => { if (handlers.get(name) === listener) handlers.delete(name); };
  }
  return {
    api, canvas, drawnText, audioPaths, images, frames, handlers,
    resize(info) {
      windowInfo = info;
      handlers.get(resizeEvent)?.(target === 'wechat' ? info : { value: 'portrait' });
    },
    emit: (name, value) => handlers.get(name)?.(value),
    get fills() { return fills; },
    tick(time) {
      const pending = Array.from(frames.values());
      frames.clear();
      for (const callback of pending) callback(time);
    },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
}

for (const [target, global, appid] of [
  ['wechat', 'wx', 'wx1234567890abcdef'],
  ['douyin', 'tt', 'tt1234567890abcdef'],
]) {
  test(`${target} exports a native project and runs a complete canvas round without a DOM`, async (t) => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'hgame-native-export-'));
    t.after(() => rm(outDir, { recursive: true, force: true }));
    const result = await exec(process.execPath, [
      path.join(root, 'scripts/package-game.mjs'), fixture, '--target', target, '--appid', appid,
      '--out-dir', outDir, '--version', '2.1',
    ]);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.target, target);
    assert.equal(path.basename(summary.outputDir), `canvas-tap_2_1_${target}`);
    const archive = new AdmZip(summary.zipPath);
    const names = archive.getEntries().map(entry => entry.entryName).sort();
    assert.deepEqual(names, [
      'LICENSE.txt', 'assets/chime.wav', 'assets/level.json', 'assets/target.png',
      'game.js', 'game.json', 'project.config.json',
    ]);
    assert.deepEqual(JSON.parse(archive.readAsText('game.json')), { deviceOrientation: 'portrait' });
    const project = JSON.parse(archive.readAsText('project.config.json'));
    assert.equal(project.appid, appid);
    assert.equal(project.projectname, '点靶');
    assert.deepEqual(project.packOptions.include, [{ type: 'folder', value: 'assets' }]);
    if (target === 'wechat') assert.equal(project.compileType, 'game');
    assert.equal(await readFile(path.join(summary.outputDir, 'game.js'), 'utf8'), archive.readAsText('game.js'));

    const saved = new Map();
    const host = createHost(archive, saved, target);
    const code = archive.readAsText('game.js');
    // No DOM, Node require, or other platform API is available.
    runInNewContext(code, {
      [global]: host.api, console, setTimeout, clearTimeout,
      requestAnimationFrame: host.requestAnimationFrame, cancelAnimationFrame: host.cancelAnimationFrame,
    });
    await setImmediate();
    assert.deepEqual([host.canvas.width, host.canvas.height], [720, 1600]);
    assert.deepEqual(host.images, ['assets/target.png']);
    assert.equal(host.drawnText.at(-1), '0/3');
    assert.equal(host.frames.size, 1);
    host.emit('Hide');
    assert.equal(host.frames.size, 0);
    const [x, y] = target === 'wechat' ? ['clientX', 'clientY'] : ['screenX', 'screenY'];
    const touch = { changedTouches: [{ identifier: 7, [x]: 180, [y]: 560 }] };
    host.emit('TouchStart', touch);
    assert.equal(host.audioPaths.length, 0);
    host.emit('Show');
    assert.equal(host.frames.size, 1);
    host.resize({ windowWidth: 400, windowHeight: 800, pixelRatio: 2 });
    assert.equal(host.canvas.width, 800);
    touch.changedTouches[0][x] = 200;
    for (let i = 0; i < 3; i++) {
      host.emit('TouchStart', touch);
      host.emit('TouchEnd', touch);
    }
    assert.deepEqual(host.audioPaths, Array(3).fill('assets/chime.wav'));
    assert.equal(host.drawnText.at(-1), '纪录 3');
    assert.equal(host.frames.size, 0);

    const restarted = createHost(archive, saved, target);
    runInNewContext(code, {
      GameGlobal: { [global]: restarted.api }, console, setTimeout, clearTimeout,
      requestAnimationFrame: restarted.requestAnimationFrame, cancelAnimationFrame: restarted.cancelAnimationFrame,
    });
    await setImmediate();
    assert.ok(restarted.drawnText.includes('纪录 3'));
  });
}

test('package fails with actionable errors for unadapted projects, web dependencies and missing resources', async (t) => {
  const dir = await createProject(t);
  const pack = () => packageGameRelease({ projectDir: dir, engineRoot: root, target: 'wechat' });
  await writeFile(path.join(dir, 'minigame.config.json'), JSON.stringify({ entry: 'index.html' }));
  await assert.rejects(pack, /entry.*src/i);
  await writeFile(path.join(dir, 'minigame.config.json'), JSON.stringify({ entry: 'src/main.js' }));
  await writeFile(path.join(dir, 'src/main.js'), 'import "./screen.css"; export function start() {}');
  await writeFile(path.join(dir, 'src/screen.css'), 'body { color: blue; }');
  await assert.rejects(pack, /screen\.css/);
  await writeFile(path.join(dir, 'src/main.js'), 'import "https://example.com/game.js"; export function start() {}');
  await assert.rejects(pack, /example\.com/);
  await writeFile(path.join(dir, 'src/main.js'), 'export function start(host) { return import(host.game.module); }');
  await assert.rejects(pack, /import.*not be bundled/i);
  await writeFile(path.join(dir, 'src/main.js'), 'export function start() {}');
  await writeFile(path.join(dir, 'minigame.config.json'), JSON.stringify(config));
  await assert.rejects(pack, /assets\/level\.json/);
  await assert.rejects(access(path.join(dir, 'build/test-game_1_2_wechat.zip')), { code: 'ENOENT' });
});

test('native assets come from explicit local files or the asset store', async (t) => {
  const dir = await createProject(t);
  const assets = 'assets/level.json';
  const bytes = Buffer.from('{"score":10}');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const assetStore = path.join(dir, 'store');
  const objectDir = path.join(assetStore, 'objects', hash.slice(0, 2));
  await mkdir(objectDir, { recursive: true });
  await writeFile(path.join(objectDir, hash), bytes);
  await writeFile(path.join(dir, 'assets.manifest.json'), JSON.stringify({ schemaVersion: 1, assets: { 'level.json': { sha256: hash } } }));
  await writeFile(path.join(dir, 'assets/unlisted.txt'), 'Unlisted');
  await writeFile(path.join(dir, 'minigame.config.json'), JSON.stringify({ entry: 'src/main.js', assets: [assets] }));
  const pack = () => packageGameRelease({ projectDir: dir, engineRoot: root, assetStore, target: 'douyin' });
  const first = await pack();
  const release = new AdmZip(first.zipPath);
  assert.deepEqual(release.readFile(assets), bytes);
  assert.equal(release.getEntry('assets/unlisted.txt'), null);
  const original = await readFile(first.zipPath);
  assert.deepEqual(await readFile((await pack()).zipPath), original);
  await writeFile(path.join(objectDir, hash), 'corrupted');
  await assert.rejects(pack, /assets\/level\.json.*SHA-256/i);
  assert.deepEqual(await readFile(first.zipPath), original);
});

test('Douyin rejects listed media outside the platform upload allowlist', async (t) => {
  const dir = await createProject(t);
  await writeFile(path.join(dir, 'minigame.config.json'), JSON.stringify({
    entry: 'src/main.js', assets: ['assets/font.woff2'],
  }));
  await writeFile(path.join(dir, 'assets/font.woff2'), Buffer.from('font fixture'));
  await assert.rejects(() => packageGameRelease({ projectDir: dir, engineRoot: root, target: 'douyin' }),
    /douyin.*font\.woff2/i);
});

test('the native host claims the first canvas before game modules initialize', async (t) => {
  const dir = await createProject(t);
  await writeFile(path.join(dir, 'src/main.js'), [
    'const effectsCanvas = wx.createCanvas();',
    'export function start(host) {',
    '  host.storage.setItem("screen", host.canvas.screen);',
    '  host.storage.setItem("effects", effectsCanvas.screen);',
    '}',
  ].join('\n'));
  const result = await packageGameRelease({ projectDir: dir, engineRoot: root, target: 'wechat' });
  const archive = new AdmZip(result.zipPath);
  const saved = new Map();
  const host = createHost(archive, saved);
  host.canvas.screen = 'foreground';
  let canvasCount = 0;
  host.api.createCanvas = () => canvasCount++ === 0 ? host.canvas : { screen: 'offscreen' };
  runInNewContext(archive.readAsText('game.js'), {
    wx: host.api, console, setTimeout, clearTimeout,
  });
  assert.equal(saved.get('screen'), 'foreground');
  assert.equal(saved.get('effects'), 'offscreen');
});

test('HGame application and native canvas renderer bundle without pulling in optional Rapier', async (t) => {
  const dir = await createProject(t);
  await writeFile(path.join(dir, 'src/main.js'), [
    'import { createGameApplication } from "@hgame/core/application.js";',
    'import { Scene } from "@hgame/core/scene.js";',
    'import { createCanvas2DAdapter } from "@hgame/integrations/canvas2d.js";',
    'export function start(host) {',
    '  const renderer = createCanvas2DAdapter({ canvas: host.canvas, pixelRatio: host.viewport.pixelRatio });',
    '  const app = createGameApplication({ renderer, platform: {}, requestFrame: host.requestFrame, cancelFrame: host.cancelFrame });',
    '  const initial = app.scenes.add(new Scene("main"));',
    '  app.scenes.add(new Scene("next")); app.scenes.start("main"); app.start();',
    '  const signal = initial.activationSignal;',
    '  signal.addEventListener("abort", () => host.storage.setItem("scene-abort", signal.reason.name), { once: true });',
    '  app.scenes.start("next");',
    '}',
  ].join('\n'));
  const result = await packageGameRelease({ projectDir: dir, engineRoot: root, target: 'wechat' });
  const archive = new AdmZip(result.zipPath);
  const saved = new Map();
  const host = createHost(archive, saved);
  runInNewContext(archive.readAsText('game.js'), {
    wx: host.api, console, setTimeout, clearTimeout,
    requestAnimationFrame: host.requestAnimationFrame, cancelAnimationFrame: host.cancelAnimationFrame,
  });
  assert.equal(saved.get('scene-abort'), 'AbortError');
  assert.equal(host.frames.size, 1);
  host.tick(100);
  assert.ok(host.fills > 0);
  assert.ok(archive.getEntries().every(entry => !entry.entryName.endsWith('.wasm')));
});

test('platform size limits keep an oversized staged project from overwriting a prior release', async (t) => {
  const dir = await createProject(t);
  const pack = (target) => packageGameRelease({ projectDir: dir, engineRoot: root, target });
  const first = await pack('wechat');
  const previous = await readFile(first.zipPath);
  await writeFile(path.join(dir, 'minigame.config.json'), JSON.stringify({ entry: 'src/main.js', assets: ['assets/large.bin'] }));
  await writeFile(path.join(dir, 'assets/large.bin'), Buffer.alloc(4 * 1024 * 1024));
  await assert.rejects(pack('wechat'), /wechat.*4 MiB/i);
  assert.deepEqual(await readFile(first.zipPath), previous);
  assert.equal((await pack('douyin')).target, 'douyin');
  await writeFile(path.join(dir, 'assets/large.bin'), Buffer.alloc(20 * 1024 * 1024));
  await assert.rejects(pack('douyin'), /douyin.*20 MiB/i);
});

test('generated HGame projects carry native packaging tools and resolve their vendored HGame modules', async (t) => {
  const buildRoot = path.join(root, 'build');
  await mkdir(buildRoot, { recursive: true });
  const temp = await mkdtemp(path.join(buildRoot, 'generated-minigame-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const dir = path.join(temp, 'generated-minigame');
  await exec(process.execPath, [path.join(root, 'scripts/create-game.mjs'), dir, '--renderer', 'canvas2d', '--no-git'], { cwd: root });
  const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['package:wechat'], /--target wechat/);
  assert.match(pkg.scripts['package:douyin'], /--target douyin/);
  await cp(path.join(fixture, 'assets'), path.join(dir, 'assets'), { recursive: true });
  await cp(path.join(fixture, 'src/main.js'), path.join(dir, 'src/minigame.js'));
  await writeFile(path.join(dir, 'minigame.config.json'), JSON.stringify({
    ...JSON.parse(await readFile(path.join(fixture, 'minigame.config.json'), 'utf8')),
    entry: 'src/minigame.js',
    deviceOrientation: 'landscape',
  }));
  const result = await exec(process.execPath, ['scripts/package-game.mjs', '--target', 'wechat'], { cwd: dir });
  const summary = JSON.parse(result.stdout);
  const archive = new AdmZip(summary.zipPath);
  assert.deepEqual(JSON.parse(archive.readAsText('game.json')), { deviceOrientation: 'landscape' });
  assert.equal(JSON.parse(archive.readAsText('project.config.json')).appid, 'touristappid');
  assert.match(archive.readAsText('LICENSE.txt'), /Apache License/);
});
