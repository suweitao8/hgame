import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import {
  BILIBILI_TOY_RATE_LIMIT_CODE,
  BILIBILI_TOY_SDK_URL,
  createToyBridge,
  createToyCloudSaveAdapter,
  isBilibiliToyEnvironment,
  isToyRateLimitError,
  loadBilibiliToySdk,
} from '../assets/runtime/integrations/bilibili-toy.js';
import { packageGameRelease } from '../scripts/package-game.mjs';
import { parseZipEntries, runToyPreflight } from '../scripts/toy-preflight.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const createGame = path.join(root, 'scripts', 'create-game.mjs');

function makePngHeader(width, height) {
  const buf = Buffer.alloc(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

test('createToyBridge handles local fallback, validation, 307044 backoff, and checkpoint cloud saves', async () => {
  assert.equal(isBilibiliToyEnvironment(), false);
  assert.equal(isToyRateLimitError({ type: 'http_error', code: BILIBILI_TOY_RATE_LIMIT_CODE }), true);
  assert.equal(isToyRateLimitError({ type: 'http_error', code: 307000 }), false);

  // 1. Offline/local preview fallback
  const localBridge = createToyBridge({ fallbackStorage: null, gameId: 'toy-test' });
  assert.equal(localBridge.isAvailable, false);
  assert.equal(await localBridge.isSupport('share'), false);
  await localBridge.setCloudStorage({ coins: '42', stage: '3' });
  assert.deepEqual(await localBridge.getCloudStorage(['coins']), { coins: '42' });
  await localBridge.removeCloudStorage(['stage']);
  assert.deepEqual(await localBridge.getCloudStorage(), { coins: '42' });
  assert.deepEqual(await localBridge.submitScore({ score: 0 }), { score: 0 });
  assert.deepEqual(await localBridge.getMyRank(), { ranked: true, rank: 1, score: 0 });

  // 2. Mocked window.toy with 307044 rate limit retry & batching
  let cloudWrites = 0;
  let attempts = 0;
  const store = new Map();
  const mockSdk = {
    async isSupport(name) { return name === 'checkInputSafety'; },
    async getCloudStorage(keys) {
      if (!keys?.length) return Object.fromEntries(store.entries());
      const out = {};
      for (const k of keys) if (store.has(k)) out[k] = store.get(k);
      return out;
    },
    async setCloudStorage(items) {
      attempts++;
      if (attempts === 1) {
        throw { type: 'http_error', code: 307044, message: 'rate limited' };
      }
      cloudWrites++;
      for (const [k, v] of Object.entries(items)) store.set(k, v);
    },
    async removeCloudStorage(keys) {
      for (const k of keys) store.delete(k);
    },
    async checkInputSafety({ text }) {
      return text === 'bad'
        ? { status: 'unavailable', passed: true } // unavailable must NOT pass even if passed were true
        : { status: 'ok', passed: true };
    },
    async getChargeUnlock({ minPrice }) {
      return { status: 'ok', data: { unlocked: minPrice <= 1200 } };
    },
  };

  const bridge = createToyBridge({
    sdk: mockSdk,
    baseDelayMs: 5,
    maxRetries: 2,
    random: () => 0.5,
  });

  await assert.rejects(() => bridge.setCloudStorage({ __reserved: '1' }), /Invalid Toy cloud storage key/);
  await assert.rejects(() => bridge.setCloudStorage({ big: 'a'.repeat(1025) }), /1024 UTF-8 bytes/);
  await assert.rejects(() => bridge.submitScore({ board: 6, score: 10 }), /1\.\.5/);
  await assert.rejects(() => bridge.submitScore({ score: 16777216 }), /16777215/);

  const adapter = createToyCloudSaveAdapter({ bridge, bindPageHide: false });
  adapter.set('hp', 100);
  adapter.set('lv', 5);
  assert.equal(cloudWrites, 0);
  assert.equal(adapter.dirtyCount, 2);
  await adapter.flush();
  assert.equal(cloudWrites, 1); // Single batched write after 307044 backoff retry
  assert.equal(adapter.dirtyCount, 0);
  assert.deepEqual(await bridge.getCloudStorage(), { hp: '100', lv: '5' });

  const safetyBad = await bridge.checkInputSafety({ text: 'bad', scene: 'nick_1' });
  assert.equal(safetyBad.passed, false);
  const safetyOk = await bridge.checkInputSafety({ text: 'hello', scene: 'nick_1' });
  assert.equal(safetyOk.passed, true);

  const charge = await bridge.getChargeUnlock({ minPrice: 1200 });
  assert.equal(charge.data.unlocked, true);
});

/** Runs `run` with temporary globals and restores them afterwards. */
async function withGlobals(overrides, run) {
  const saved = Object.keys(overrides).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.assign(globalThis, overrides);
  try {
    return await run();
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

/** A document whose `<script>` elements record their listeners so a test can fire load and error. */
function createFakeDocument() {
  const document = {
    scripts: [],
    head: { appendChild(script) { document.scripts.push(script); } },
    createElement() {
      return { listeners: {}, addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); } };
    },
  };
  return document;
}

/** A Storage stand-in holding values from several namespaces. */
function createFakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

/** An EventTarget stand-in whose listeners a test fires by hand. */
function createFakeEventTarget() {
  const target = {
    listeners: {},
    addEventListener(type, listener) { (target.listeners[type] ??= []).push(listener); },
    removeEventListener(type, listener) {
      target.listeners[type] = (target.listeners[type] ?? []).filter(item => item !== listener);
    },
    fire(type) { for (const listener of [...(target.listeners[type] ?? [])]) listener(); },
  };
  return target;
}

/** Reads `keys` (all keys when omitted) out of a Map, stripping `prefix` from each key. */
function pickStored(map, keys, prefix = '') {
  const out = {};
  if (keys?.length) {
    for (const key of keys) {
      const value = map.get(prefix + key);
      if (value !== undefined) out[key] = value;
    }
  } else {
    for (const [key, value] of map.entries()) out[key.slice(prefix.length)] = value;
  }
  return out;
}

/** A Map-backed stand-in for `window.toy` whose storage methods record every call. */
function createFakeToy() {
  const cloud = new Map();
  const shared = new Map();
  const calls = [];
  return {
    calls,
    cloud,
    shared,
    async getCloudStorage(keys) { calls.push(['getCloudStorage', keys]); return pickStored(cloud, keys); },
    async setCloudStorage(items) { calls.push(['setCloudStorage', items]); for (const [k, v] of Object.entries(items)) cloud.set(k, v); },
    async removeCloudStorage(keys) { calls.push(['removeCloudStorage', keys]); for (const k of keys) cloud.delete(k); },
    async getSharedStorage(id, keys) { calls.push(['getSharedStorage', id, keys]); return pickStored(shared, keys, `${id}.`); },
    async setSharedStorage(id, items) { calls.push(['setSharedStorage', id, items]); for (const [k, v] of Object.entries(items)) shared.set(`${id}.${k}`, v); },
    async removeSharedStorage(id, keys) { calls.push(['removeSharedStorage', id, keys]); for (const k of keys) shared.delete(`${id}.${k}`); },
  };
}

const macrotask = () => new Promise(resolve => setTimeout(resolve, 0));

test('toy bridge: the SDK is detected, and its script is only loaded where it can exist', async () => {
  assert.equal(isToyRateLimitError({ code: BILIBILI_TOY_RATE_LIMIT_CODE }), true);
  assert.equal(isToyRateLimitError({ type: 'server_error', code: BILIBILI_TOY_RATE_LIMIT_CODE }), false);
  assert.equal(isToyRateLimitError('307044'), false);
  assert.equal(isToyRateLimitError(null), false);

  const toy = { isSupport: async () => true };
  await withGlobals({ window: { toy } }, async () => {
    assert.equal(isBilibiliToyEnvironment(), true);
    assert.equal(await loadBilibiliToySdk(), toy, 'a loaded SDK is returned as is');
  });
  await withGlobals({ window: { toy: {} } }, () => assert.equal(isBilibiliToyEnvironment(), false));
  assert.equal(await loadBilibiliToySdk(), null, 'without a document there is nothing to load into');

  // Off the Bilibili hosts nothing is injected unless asked for.
  let document = createFakeDocument();
  assert.equal(await withGlobals({ document, location: { hostname: 'bilibili.com.evil.example', protocol: 'https:' } }, () => loadBilibiliToySdk()), null);
  assert.equal(document.scripts.length, 0);

  // Forced: the script fails, and a late load event cannot change the settled result.
  document = createFakeDocument();
  await withGlobals({ document, location: { hostname: 'example.com', protocol: 'https:' } }, async () => {
    const pending = loadBilibiliToySdk({ forceInject: true });
    const script = document.scripts[0];
    assert.equal(script.src, 'https:' + BILIBILI_TOY_SDK_URL);
    assert.equal(script.async, true);
    script.listeners.error[0]();
    assert.equal(await pending, null);
    script.listeners.load[0]();
  });

  // On a Bilibili host the plain-http address is kept, and loading resolves with the SDK it installed.
  document = createFakeDocument();
  await withGlobals({ document, location: { hostname: 'm.bilibili.com', protocol: 'http:' }, window: { toy: null } }, async () => {
    const pending = loadBilibiliToySdk();
    const script = document.scripts[0];
    assert.equal(script.src, 'http:' + BILIBILI_TOY_SDK_URL);
    globalThis.window.toy = toy;
    script.listeners.load[0]();
    assert.equal(await pending, toy);
  });

  // A script that neither loads nor fails gives up after the timeout.
  document = createFakeDocument();
  await withGlobals({ document, location: { hostname: 'www.bilibili.com', protocol: 'https:' } }, async () => {
    assert.equal(await loadBilibiliToySdk({ timeoutMs: 5 }), null);
    assert.equal(document.scripts.length, 1);
  });
});

test('toy bridge: every SDK call validates its input and degrades without the SDK', async () => {
  // 1. Storage falls back to the given backend, namespaced by game, and only its own keys come back.
  const storage = createFakeStorage({ 'hgame.toy.other-game.cloud.coins': '7', unrelated: 'x' });
  const local = createToyBridge({ fallbackStorage: storage, gameId: 'toy-a' });
  assert.equal(local.isAvailable, false);
  await assert.rejects(() => local.setCloudStorage(null), TypeError);
  await assert.rejects(() => local.setCloudStorage([]), TypeError);
  await assert.rejects(() => local.setCloudStorage({ v: undefined }), TypeError);
  await assert.rejects(() => local.setCloudStorage({ f: () => 1 }), TypeError);
  await assert.rejects(() => local.setCloudStorage({ big: '汉'.repeat(342) }), /1024 UTF-8 bytes/);
  await local.setCloudStorage({});
  assert.equal(storage.map.size, 2, 'a rejected or empty write stores nothing');

  await local.setCloudStorage({ coins: 42, list: [1, 2], flag: true });
  assert.equal(storage.getItem('hgame.toy.toy-a.cloud.coins'), '42');
  assert.deepEqual(await local.getCloudStorage(), { coins: '42', list: '[1,2]', flag: 'true' });
  assert.deepEqual(await local.getCloudStorage(['coins', 'missing']), { coins: '42' });
  await assert.rejects(() => local.getCloudStorage(['bad key']), RangeError);
  await assert.rejects(() => local.removeCloudStorage('coins'), TypeError);
  await local.removeCloudStorage(['coins']);
  assert.deepEqual(await local.getCloudStorage(['coins']), {});
  await local.setCloudStorage({ wide: '汉'.repeat(341) });
  assert.equal((await local.getCloudStorage(['wide'])).wide.length, 341);

  // 2. Shared storage is a separate namespace per storage id.
  await assert.rejects(() => local.getSharedStorage(''), TypeError);
  await assert.rejects(() => local.setSharedStorage(undefined, {}), TypeError);
  await assert.rejects(() => local.removeSharedStorage('room', 'host'), TypeError);
  await local.setSharedStorage('room', { host: 'p1' });
  assert.equal(storage.getItem('hgame.toy.toy-a.shared.room.host'), 'p1');
  assert.deepEqual(await local.getSharedStorage('room', ['host', 'ghost']), { host: 'p1' });
  assert.deepEqual(await local.getSharedStorage('hall'), {});
  await local.removeSharedStorage('room', ['host']);
  assert.deepEqual(await local.getSharedStorage('room'), {});

  // 3. Rate limits are retried up to maxRetries; other errors surface at once.
  let limitedCalls = 0;
  const limited = createToyBridge({
    sdk: { async setCloudStorage() { limitedCalls++; throw { type: 'http_error', code: BILIBILI_TOY_RATE_LIMIT_CODE }; } },
    maxRetries: 2,
    baseDelayMs: 1,
    random: () => 0.5,
  });
  await assert.rejects(() => limited.setCloudStorage({ a: '1' }), isToyRateLimitError);
  assert.equal(limitedCalls, 3);
  await assert.rejects(
    () => createToyBridge({ sdk: limited.sdk, autoRetryRateLimit: false }).setCloudStorage({ a: '1' }),
    isToyRateLimitError,
  );
  assert.equal(limitedCalls, 4, 'retries can be switched off');
  const broken = createToyBridge({ sdk: { async setCloudStorage() { throw new Error('offline'); } }, maxRetries: 3, baseDelayMs: 1 });
  await assert.rejects(() => broken.setCloudStorage({ a: '1' }), /offline/);
  let tries = 0;
  assert.equal(await limited.withRateLimitBackoff(async () => {
    if (++tries < 3) throw { code: BILIBILI_TOY_RATE_LIMIT_CODE };
    return 'ok';
  }), 'ok');
  assert.equal(tries, 3);
  assert.equal(await createToyBridge({ sdk: { isSupport() { throw new Error('no'); } } }).isSupport('share'), false);

  // 4. Without the SDK the leaderboard lives locally and keeps the best score.
  await assert.rejects(() => local.submitScore(null), TypeError);
  await assert.rejects(() => local.submitScore({ score: 1.5 }), RangeError);
  await assert.rejects(() => local.submitScore({ score: -16777217 }), /16777216/);
  await assert.rejects(() => local.submitScore({ board: 0, score: 1 }), /1\.\.5/);
  assert.deepEqual(await local.getRankList({ board: 1 }), []);
  assert.deepEqual(await local.getMyRank(), { ranked: false, rank: 0, score: 0 });
  assert.deepEqual(await local.submitScore({ score: 10 }), { score: 10 });
  assert.deepEqual(await local.submitScore({ score: 5 }), { score: 10 });
  assert.deepEqual(await local.submitScore({ score: 12, board: 1 }), { score: 12 });
  assert.deepEqual(await local.getMyRank({ board: 1 }), { ranked: true, rank: 1, score: 12 });
  assert.deepEqual(await local.getMyRank({ board: 2 }), { ranked: false, rank: 0, score: 0 });
  assert.equal(storage.getItem('hgame.toy.toy-a.lb.lb_b1'), '12');

  // 5. Player text is validated before it is sent, and passes when nothing can check it.
  await assert.rejects(() => local.checkInputSafety(null), TypeError);
  await assert.rejects(() => local.checkInputSafety({ text: '' }), TypeError);
  await assert.rejects(() => local.checkInputSafety({ text: 'a'.repeat(16385) }), /16384/);
  await assert.rejects(() => local.checkInputSafety({ text: 'hi', scene: 'bad scene' }), RangeError);
  assert.deepEqual(await local.checkInputSafety({ text: 'hi' }), { status: 'ok', passed: true });
  const safety = createToyBridge({
    fallbackStorage: null,
    sdk: { async checkInputSafety() { return { status: 'rejected', passed: false }; } },
  });
  assert.deepEqual(await safety.checkInputSafety({ text: 'hi', scene: 'nick_1' }), { status: 'rejected', passed: false });

  // 6. Calls that need the SDK name the missing method, and pass arguments through when it is there.
  const offline = createToyBridge({ fallbackStorage: null });
  const needsSdk = [
    'getUserProfile', 'openChargePanel', 'getQrCode', 'share', 'navigate', 'closeBrowser', 'getContainerState',
    'setContainerMode', 'requestCamera', 'requestMicrophone',
  ];
  for (const method of needsSdk) {
    await assert.rejects(() => offline[method](), new RegExp(`\\[ToySDK\\] ${method} unavailable`));
  }
  await assert.rejects(() => offline.openChargePanel({ minPrice: 0 }), /positive integer/);
  assert.deepEqual(await offline.getAuthorProfile(), { status: 'unsupported' });
  assert.deepEqual(await offline.getAuthorRelation(), { status: 'unsupported' });
  assert.deepEqual(await offline.getAuthorVideos({ videos: [] }), { status: 'unsupported', items: [] });
  assert.deepEqual(await offline.getVideoUserActions({ aids: [] }), { status: 'unsupported', items: [] });
  assert.deepEqual(await offline.getChargeUnlock(), { status: 'unsupported' });
  await assert.rejects(() => offline.getChargeUnlock({ minPrice: 0 }), RangeError);
  await assert.rejects(() => offline.getChargeUnlock({ minPrice: 1.5 }), RangeError);
  assert.equal(typeof offline.onChargeUnlockChange(() => {}), 'function');
  assert.equal(typeof offline.onContainerChange(() => {}), 'function');

  const passthrough = [
    ['getUserProfile', [], undefined],
    ['openChargePanel', [], { minPrice: 1200 }],
    ['openChargePanel', [{ minPrice: 600 }], { minPrice: 600 }],
    ['getQrCode', [{ path: 'share.png', size: 240 }], { path: 'share.png', size: 240 }],
    ['share', [{ path: 'video', id: '1' }], { path: 'video', id: '1' }],
    ['navigate', [{ type: 'video', id: '1' }], { type: 'video', id: '1' }],
    ['closeBrowser', [], undefined],
    ['getContainerState', [], undefined],
    ['setContainerMode', [{ orientation: 'portrait' }], { orientation: 'portrait' }],
    ['requestCamera', [{ facingMode: 'user' }], { facingMode: 'user' }],
    ['requestMicrophone', [], undefined],
    ['getRankList', [{ board: 2 }], { board: 2 }],
    ['getMyRank', [], {}],
    ['getAuthorProfile', [], undefined],
    ['getAuthorRelation', [], undefined],
    ['getAuthorVideos', [{ videos: [] }], { videos: [] }],
    ['getVideoUserActions', [{ aids: [1] }], { aids: [1] }],
    ['getChargeUnlock', [], { minPrice: 1200 }],
    ['getChargeUnlock', [{ minPrice: 600 }], { minPrice: 600 }],
  ];
  const echo = {};
  const seen = [];
  for (const [method] of passthrough) {
    echo[method] = async (...args) => { seen.push([method, ...args]); return { method }; };
  }
  const online = createToyBridge({ sdk: echo, fallbackStorage: null });
  for (const [method, args, expected] of passthrough) {
    assert.deepEqual(await online[method](...args), { method });
    const [seenMethod, ...seenArgs] = seen.at(-1);
    assert.equal(seenMethod, method);
    assert.deepEqual(seenArgs, expected === undefined ? [] : [expected]);
  }
  let unsubscribed = 0;
  echo.onChargeUnlockChange = listener => { seen.push(['onChargeUnlockChange', listener]); return () => { unsubscribed++; }; };
  echo.onContainerChange = listener => { seen.push(['onContainerChange', listener]); return () => { unsubscribed++; }; };
  const onChange = () => {};
  online.onChargeUnlockChange(onChange)();
  online.onContainerChange(onChange)();
  assert.deepEqual(seen.slice(-2), [['onChargeUnlockChange', onChange], ['onContainerChange', onChange]]);
  assert.equal(unsubscribed, 2);

  // 7. Images go to the album through the SDK, or through a download link on the plain web.
  await assert.rejects(() => offline.saveImage(null), /url or base64Data/);
  await assert.rejects(() => offline.saveImage({}), /url or base64Data/);
  assert.deepEqual(await offline.saveImage({ url: 'https://example.com/a.png' }), { localPath: '' });
  echo.isSupport = async () => true;
  echo.saveImageToAlbum = async req => { seen.push(['saveImageToAlbum', req]); return { localPath: 'album/a.png' }; };
  assert.deepEqual(await online.saveImage({ base64Data: 'AAAA' }), { localPath: 'album/a.png' });
  await online.saveImage({ url: 'https://example.com/a.png', hintMsg: 'saved' });
  await online.saveImage({ url: 'https://example.com/a.png', filename: 'ignored.png' });
  assert.deepEqual(seen.slice(-3), [
    ['saveImageToAlbum', { base64Data: 'AAAA' }],
    ['saveImageToAlbum', { url: 'https://example.com/a.png', hintMsg: 'saved' }],
    ['saveImageToAlbum', { url: 'https://example.com/a.png' }],
  ]);

  const anchors = [];
  const webPage = Object.assign(createFakeEventTarget(), {
    body: {
      children: [],
      appendChild(node) { this.children.push(node); },
      removeChild(node) { this.children.splice(this.children.indexOf(node), 1); },
    },
    createElement(tag) {
      const anchor = { tag, clicked: 0, click() { this.clicked++; } };
      anchors.push(anchor);
      return anchor;
    },
  });
  const web = createToyBridge({
    fallbackStorage: null,
    sdk: { isSupport: async () => false, saveImageToAlbum: async () => ({ localPath: 'album' }) },
  });
  await withGlobals({ document: webPage }, async () => {
    assert.deepEqual(await web.saveImage({ url: 'https://example.com/a.png' }), { localPath: 'toy-image.png' });
    assert.deepEqual(await web.saveImage({ base64Data: 'AAAA' }), { localPath: 'toy-image.png' });
    assert.deepEqual(
      await web.saveImage({ base64Data: 'data:image/jpeg;base64,AAAA', filename: 'shot.jpg' }),
      { localPath: 'shot.jpg' },
    );
    assert.deepEqual(
      await offline.saveImage({ url: 'https://example.com/a.png', base64Data: 'AAAA' }),
      { localPath: 'toy-image.png' },
    );
  });
  assert.deepEqual(
    anchors.map(anchor => [anchor.tag, anchor.href, anchor.download, anchor.rel, anchor.clicked]),
    [
      ['a', 'https://example.com/a.png', 'toy-image.png', 'noopener', 1],
      ['a', 'data:image/png;base64,AAAA', 'toy-image.png', 'noopener', 1],
      ['a', 'data:image/jpeg;base64,AAAA', 'shot.jpg', 'noopener', 1],
      ['a', 'data:image/png;base64,AAAA', 'toy-image.png', 'noopener', 1],
    ],
  );
  assert.equal(webPage.body.children.length, 0, 'the download link is removed after the click');

  // 8. Media streams are handed to the SDK, or stopped track by track.
  const stopped = [];
  const stream = { getTracks: () => [{ stop() { stopped.push('video'); } }, { stop() { stopped.push('audio'); } }] };
  echo.stopMedia = async media => { seen.push(['stopMedia', media]); return 'stopped'; };
  assert.equal(await online.stopMedia(stream), 'stopped');
  assert.equal(seen.at(-1)[1], stream);
  await offline.stopMedia(stream);
  await offline.stopMedia();
  assert.deepEqual(stopped, ['video', 'audio']);
});

test('toy cloud save adapter: shared storage, removals, load merge and page-hide flush', async () => {
  assert.throws(() => createToyCloudSaveAdapter({}), /requires bridge/);

  // 1. Values are stored as JSON text and read back as JSON, or as the raw string.
  const toy = createFakeToy();
  const bridge = createToyBridge({ sdk: toy, fallbackStorage: null });
  const save = createToyCloudSaveAdapter({ bridge, bindPageHide: false });
  assert.equal(save.loaded, false);
  assert.equal(save.get('missing', 'fallback'), 'fallback');
  save.set('hp', { v: 100 });
  save.set('name', 'Ada');
  save.set('raw', 'plain');
  save.set('count', 5);
  assert.deepEqual(save.get('hp'), { v: 100 });
  assert.equal(save.get('name'), 'Ada');
  assert.equal(save.get('raw'), 'plain');
  assert.equal(save.get('count'), 5);
  assert.deepEqual(save.getAll(), { hp: '{"v":100}', name: 'Ada', raw: 'plain', count: '5' });
  assert.equal(save.dirtyCount, 4);
  assert.throws(() => save.set('bad key', 1), RangeError);
  assert.throws(() => save.set('__x', 1), RangeError);
  assert.throws(() => save.get('__x'), RangeError);
  assert.throws(() => save.remove('__x'), RangeError);
  assert.throws(() => save.set('u', undefined), TypeError);
  assert.throws(() => save.set('f', () => 1), TypeError);
  assert.throws(() => save.set('big', 'a'.repeat(1025)), /1024 UTF-8 bytes/);
  assert.throws(() => save.set('big', '汉'.repeat(342)), /1024 UTF-8 bytes/);
  save.set('wide', '汉'.repeat(341));
  assert.equal(save.dirtyCount, 5);

  // 2. load() merges the stored data without undoing edits made before it ran.
  toy.cloud.set('gold', '9');
  toy.cloud.set('gone', 'x');
  toy.cloud.set('name', 'Bob');
  save.remove('gone');
  assert.deepEqual(await save.load(), {
    hp: '{"v":100}', name: 'Ada', raw: 'plain', count: '5', wide: '汉'.repeat(341), gold: '9',
  });
  assert.equal(save.loaded, true);
  assert.equal(save.get('gold'), 9);
  assert.equal(save.get('gone', 'none'), 'none');
  assert.deepEqual(toy.calls, [['getCloudStorage', undefined]]);
  await save.load(['gold']);
  assert.deepEqual(toy.calls.at(-1), ['getCloudStorage', ['gold']]);
  toy.cloud.set('gold', '11');
  await save.load();
  assert.equal(save.get('gold'), 11, 'a later load sees writes made elsewhere');

  // 3. flush() writes the dirty keys in one call, then the removals.
  toy.calls.length = 0;
  await save.flush();
  assert.deepEqual(toy.calls, [
    ['setCloudStorage', { hp: '{"v":100}', name: 'Ada', raw: 'plain', count: '5', wide: '汉'.repeat(341) }],
    ['removeCloudStorage', ['gone']],
  ]);
  assert.equal(save.dirtyCount, 0);
  await save.flush();
  assert.equal(toy.calls.length, 2, 'a clean adapter writes nothing');

  toy.calls.length = 0;
  save.set('d', 4);
  save.remove('d');
  assert.equal(save.dirtyCount, 1, 'a key that was set and then removed is only a removal');
  save.remove('e');
  save.set('e', 5);
  save.set('gone', 'back');
  assert.equal(save.dirtyCount, 3);
  await save.flush();
  assert.deepEqual(toy.calls, [
    ['setCloudStorage', { e: '5', gone: 'back' }],
    ['removeCloudStorage', ['d']],
  ]);
  toy.calls.length = 0;
  save.remove('d');
  save.remove('e');
  await save.flush();
  assert.deepEqual(toy.calls, [['removeCloudStorage', ['d', 'e']]]);
  assert.equal(save.dirtyCount, 0);

  // 4. A storage id routes every call to the shared storage.
  toy.calls.length = 0;
  toy.shared.set('room.host', 'p1');
  const shared = createToyCloudSaveAdapter({ bridge, storageId: 'room', bindPageHide: false });
  assert.deepEqual(await shared.load(), { host: 'p1' });
  shared.set('guest', 'p2');
  shared.remove('host');
  await shared.flush();
  assert.deepEqual(toy.calls, [
    ['getSharedStorage', 'room', undefined],
    ['setSharedStorage', 'room', { guest: 'p2' }],
    ['removeSharedStorage', 'room', ['host']],
  ]);
  assert.deepEqual(pickStored(toy.shared), { 'room.guest': 'p2' });

  // 5. The page-hide listeners flush pending writes and removals, and let go on dispose.
  const flushToy = createFakeToy();
  const flushBridge = createToyBridge({ sdk: flushToy, fallbackStorage: null });
  const document = Object.assign(createFakeEventTarget(), { visibilityState: 'visible' });
  const window = createFakeEventTarget();
  await withGlobals({ document, window }, async () => {
    const hidden = createToyCloudSaveAdapter({ bridge: flushBridge });
    assert.equal(document.listeners.visibilitychange.length, 1);
    assert.equal(window.listeners.pagehide.length, 1);
    createToyCloudSaveAdapter({ bridge: flushBridge, bindPageHide: false });
    assert.equal(document.listeners.visibilitychange.length, 1, 'an unbound adapter listens to nothing');

    hidden.set('k', 1);
    document.fire('visibilitychange');
    await macrotask();
    assert.deepEqual(flushToy.calls, [], 'a visible page does not flush');

    document.visibilityState = 'hidden';
    document.fire('visibilitychange');
    await macrotask();
    assert.deepEqual(flushToy.calls, [['setCloudStorage', { k: '1' }]]);
    assert.equal(hidden.dirtyCount, 0);

    document.fire('visibilitychange');
    window.fire('pagehide');
    await macrotask();
    assert.equal(flushToy.calls.length, 1, 'nothing pending, nothing sent');

    hidden.set('k', 2);
    document.visibilityState = 'visible';
    window.fire('pagehide');
    await macrotask();
    assert.deepEqual(flushToy.calls.at(-1), ['setCloudStorage', { k: '2' }]);
    assert.equal(hidden.dirtyCount, 0);

    hidden.remove('k');
    window.fire('pagehide');
    await macrotask();
    assert.deepEqual(flushToy.calls.at(-1), ['removeCloudStorage', ['k']]);

    hidden.dispose();
    assert.equal(document.listeners.visibilitychange.length, 0);
    assert.equal(window.listeners.pagehide.length, 0);
    hidden.set('k', 3);
    window.fire('pagehide');
    await macrotask();
    assert.equal(hidden.dirtyCount, 1, 'a disposed adapter no longer listens');
    await hidden.flush();

    // A failed flush on page hide is swallowed and keeps the data for the next try.
    const failing = createToyCloudSaveAdapter({
      bridge: createToyBridge({ fallbackStorage: null, sdk: { async setCloudStorage() { throw new Error('offline'); } } }),
    });
    failing.set('k', 4);
    window.fire('pagehide');
    await macrotask();
    assert.equal(failing.dirtyCount, 1);
    failing.dispose();
  });
});

test('package-game --target toy produces flat content-hashed zip, injects toy-sdk.js, and passes preflight', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-toy-pkg-'));
  const game = path.join(tmp, 'toy-sample');
  try {
    const gen = spawnSync(process.execPath, [createGame, game, '--renderer', 'canvas2d', '--name', '测试Toy', '--no-git'], { encoding: 'utf8' });
    assert.equal(gen.status, 0, gen.stderr);

    // Reference bilibili-toy.js in src/main.js so auto-injection triggers
    const mainPath = path.join(game, 'src', 'main.js');
    const origMain = await readFile(mainPath, 'utf8');
    await writeFile(
      mainPath,
      `import { createToyBridge } from '../vendor/hgame/integrations/bilibili-toy.js';\n${origMain}\nconst __toy = createToyBridge();\n`,
    );

    // Leave legacy toy.yaml in source tree to verify it gets excluded cleanly
    await writeFile(path.join(game, 'toy.yaml'), 'id: 123\nslug: old\n');

    const posterPath = path.join(tmp, 'cover.png');
    const iconPath = path.join(tmp, 'icon.png');
    await writeFile(posterPath, makePngHeader(1200, 900));
    await writeFile(iconPath, makePngHeader(256, 256));

    const summary = await packageGameRelease({
      projectDir: game,
      version: '1.0',
      target: 'toy',
      slug: 'my-test-toy',
      poster: posterPath,
      icon: iconPath,
    });

    assert.equal(summary.target, 'toy');
    assert.equal(summary.toySdkInjected, true);
    assert.equal(summary.toyPreflight.ok, true);
    assert.equal(summary.toyPreflight.errorCount, 0);
    assert.equal(
      summary.toyPreflight.findings.some(f => f.rule === 'missing-contenthash'),
      false,
      'Toy package must satisfy contenthash rule',
    );

    const zipEntries = parseZipEntries(await readFile(summary.zipPath));
    assert.equal(zipEntries.has('index.html'), true, 'ZIP must have flat root index.html');
    assert.equal(zipEntries.has('toy.yaml'), false, 'toy.yaml must be excluded');
    const html = zipEntries.get('index.html').toString('utf8');
    assert.match(html, /\/\/s1\.hdslb\.com\/bfs\/seed\/toy\/app\/sdk\/toy-sdk\.js/);
    assert.match(html, /href="\.\/style-[a-f0-9]{8}\.css"/);
    assert.match(html, /src="\.\/src\/main-[a-f0-9]{8}\.js"/);

    // Verify preflight directly on the generated ZIP
    const zipReport = await runToyPreflight({
      targetPath: summary.zipPath,
      slug: 'my-test-toy',
      poster: posterPath,
      icon: iconPath,
      requireRootIndex: true,
    });
    assert.equal(zipReport.ok, true);
    assert.equal(zipReport.errorCount, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('toy-preflight distinguishes external URLs from shader separators', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hgame-toy-shader-'));
  try {
    await writeFile(path.join(dir, 'index.html'), '<script type="module" src="./app.js"></script>');
    await writeFile(path.join(dir, 'app.js'), 'export const shader = "//----";\nfetch("https://api.example.com/data");\n');
    const report = await runToyPreflight({ targetPath: dir });
    assert.deepEqual(report.externalDomains, ['api.example.com']);
    assert.equal(report.requiredCapabilities.includes('EXTERNAL_SERVICE_ACCESS'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('toy-preflight blocks >1MB index.html, root-relative paths, >=10000px images, oversized icons, and flags capabilities', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-toy-bad-'));
  try {
    const dir = path.join(tmp, 'bad-pkg');
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    await writeFile(path.join(dir, 'assets', 'huge.png'), makePngHeader(10000, 64));
    await writeFile(path.join(dir, 'assets', 'bgm.mp3'), Buffer.from('ID3'));
    await writeFile(
      path.join(dir, 'index.html'),
      `<!doctype html><html><head><title>Bad</title><link rel="stylesheet" href="/assets/app.css"></head>` +
      `<body><img src="./assets/missing.png"><script>setInterval(() => window.toy.setCloudStorage({ a: '1' }), 1000);</script>` +
      `<!-- ${'x'.repeat(1050000)} --></body></html>`,
    );

    const badIcon = path.join(tmp, 'big-icon.png');
    await writeFile(badIcon, makePngHeader(1025, 512));

    const report = await runToyPreflight({
      targetPath: dir,
      slug: 'bad slug!',
      icon: badIcon,
      requireRootIndex: true,
    });

    assert.equal(report.ok, false);
    const rules = new Set(report.findings.map(f => f.rule));
    assert.equal(rules.has('invalid-slug'), true);
    assert.equal(rules.has('icon-edge-limit'), true);
    assert.equal(rules.has('entry-index-over-1mb'), true);
    assert.equal(rules.has('root-relative-path'), true);
    assert.equal(rules.has('missing-local-ref'), true);
    assert.equal(rules.has('image-edge-limit'), true);
    assert.equal(rules.has('rate-limit-poll'), true);
    assert.equal(rules.has('missing-307044-handling'), true);
    assert.equal(report.requiredCapabilities.includes('AUDIO_VIDEO_UPLOAD'), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
