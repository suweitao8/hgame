import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLATFORM_VERSION,
  GAME_ENGINE_PROTOCOL,
  createGameEngine,
  createAssetLoader,
  createSaveStore,
  createGameBridge,
  createGameHostBridge,
  createInputManager,
  createDiagnostics,
} from '../../assets/runtime/platform/engine.js';

class FakeTarget {
  listeners = new Map();
  addEventListener(type, callback) {
    const entries = this.listeners.get(type) || new Set();
    entries.add(callback);
    this.listeners.set(type, entries);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatch(type, event = {}) {
    for (const callback of [...(this.listeners.get(type) || [])]) callback({ type, ...event });
  }
}

class FakeStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function fakeWindow(origin = 'http://127.0.0.1:4175') {
  const win = new FakeTarget();
  win.location = new URL(origin);
  win.parent = new FakeTarget();
  win.parent.messages = [];
  win.parent.postMessage = (message, targetOrigin) => win.parent.messages.push({ message, targetOrigin });
  win.document = new FakeTarget();
  win.document.visibilityState = 'visible';
  win.document.referrer = 'http://127.0.0.1:4174/#games';
  win.document.activeElement = null;
  win.crypto = { randomUUID: () => 'session-test-id' };
  win.fetch = globalThis.fetch;
  return win;
}

test('the shared engine exposes a versioned, renderer-neutral API', () => {
  assert.equal(PLATFORM_VERSION, '1.0.0');
  assert.equal(GAME_ENGINE_PROTOCOL, 'webasset-html-game/v1');
  assert.throws(() => createGameEngine(), /gameId/);
  const win = fakeWindow();
  const engine = createGameEngine({ gameId: 'demo-game', windowRef: win, documentRef: win.document, storage: new FakeStorage() });
  assert.equal(engine.meta.gameId, 'demo-game');
  assert.equal(engine.lifecycle.state, 'created');
  assert.equal(typeof engine.input.isDown, 'function');
  assert.equal(typeof engine.assets.json, 'function');
  assert.equal(typeof engine.save.set, 'function');
  assert.equal(typeof engine.audio.setMuted, 'function');
  assert.equal(typeof engine.diagnostics.snapshot, 'function');
  assert.equal(typeof engine.host.on, 'function');
  assert.equal(engine.ready(), true);
  assert.equal(engine.lifecycle.state, 'ready');
  assert.equal(engine.dispose(), true);
  assert.equal(engine.lifecycle.state, 'disposed');
  assert.equal(engine.dispose(), false);
});

test('lifecycle reports ready, focus, visibility and resize without owning the game loop', () => {
  const win = fakeWindow();
  const engine = createGameEngine({ gameId: 'lifecycle-test', windowRef: win, documentRef: win.document, storage: new FakeStorage() });
  const seen = [];
  engine.lifecycle.on('focus', value => seen.push(['focus', value]));
  engine.lifecycle.on('resize', value => seen.push(['resize', value.width, value.height]));
  win.dispatch('blur');
  win.dispatch('resize');
  win.document.visibilityState = 'hidden';
  win.document.dispatch('visibilitychange');
  assert.deepEqual(seen.slice(0, 2), [['focus', false], ['resize', 0, 0]]);
  assert.equal(engine.lifecycle.visible, false);
  engine.dispose();
});

test('input manager tracks keys and pointer, resets on blur and never blocks keys by default', () => {
  const target = new FakeTarget();
  const input = createInputManager({ target, focused: true });
  let prevented = 0;
  target.dispatch('keydown', { code: 'KeyW', repeat: false, target: {}, preventDefault: () => prevented++ });
  assert.equal(input.isDown('KeyW'), true);
  assert.equal(input.wasPressed('KeyW'), true);
  assert.equal(prevented, 0);
  input.endFrame();
  assert.equal(input.wasPressed('KeyW'), false);
  input.setFocused(false);
  target.dispatch('keyup', { code: 'KeyW', target: {} });
  assert.equal(input.isDown('KeyW'), false);
  input.setFocused(true);
  target.dispatch('pointerdown', { pointerId: 1, clientX: 12, clientY: 24, button: 0, buttons: 1 });
  assert.equal(input.pointer.x, 12);
  assert.equal(input.pointer.y, 24);
  input.dispose();
});

test('asset loader resolves only inside its configured base and supports JSON fetches', async () => {
  const requests = [];
  const assets = createAssetLoader({
    baseUrl: 'http://127.0.0.1:4175/local-games/demo/assets/',
    fetchImpl: async url => {
      requests.push(url);
      return { ok: true, status: 200, json: async () => ({ hp: 10 }) };
    },
  });
  assert.equal(assets.resolve('data/player.json'), 'http://127.0.0.1:4175/local-games/demo/assets/data/player.json');
  assert.throws(() => assets.resolve('../secret.json'), /outside|invalid/i);
  assert.throws(() => assets.resolve('https://example.com/file.json'), /outside|origin|invalid|absolute/i);
  assert.deepEqual(await assets.json('data/player.json'), { hp: 10 });
  assert.equal(requests.length, 1);
  const externalAssets = createAssetLoader({
    baseUrl: 'http://127.0.0.1:4175/assets/',
    allowCrossOrigin: true,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => 'ok' }),
  });
  assert.equal(externalAssets.resolve('https://cdn.example.com/sprite.png'), 'https://cdn.example.com/sprite.png');
});

test('save store namespaces keys by game and schema version and clears only its own data', () => {
  const storage = new FakeStorage();
  const first = createSaveStore({ gameId: 'alpha', schemaVersion: 2, storage });
  const second = createSaveStore({ gameId: 'beta', schemaVersion: 1, storage });
  first.set('slot-1', { level: 3 });
  second.set('slot-1', { level: 8 });
  assert.deepEqual(first.get('slot-1'), { level: 3 });
  assert.deepEqual(second.get('slot-1'), { level: 8 });
  first.clear();
  assert.equal(first.get('slot-1'), undefined);
  assert.deepEqual(second.get('slot-1'), { level: 8 });
});

test('game bridge authenticates host origin, parent source, game id and session', () => {
  const win = fakeWindow();
  win.document.referrer = '';
  const bridge = createGameBridge({ gameId: 'demo-game', windowRef: win, documentRef: win.document });
  const hostEvents = [];
  bridge.on('focus', value => hostEvents.push(['focus', value]));
  bridge.ready();
  assert.equal(win.parent.messages[0].message.type, 'game:hello');
  const hello = {
    channel: GAME_ENGINE_PROTOCOL,
    type: 'host:hello',
    protocolVersion: 1,
    gameId: 'demo-game',
    sessionId: 'session-1',
  };
  win.dispatch('message', { source: {}, origin: 'http://127.0.0.1:4174', data: hello });
  assert.equal(bridge.connected, false);
  win.dispatch('message', { source: win.parent, origin: 'http://evil.test', data: hello });
  assert.equal(bridge.connected, false);
  win.dispatch('message', { source: win.parent, origin: 'http://127.0.0.1:4174', data: hello });
  assert.equal(bridge.connected, true);
  assert.equal(bridge.parentOrigin, 'http://127.0.0.1:4174');
  const readyMessage = win.parent.messages.find(item => item.message.type === 'game:ready');
  assert.equal(readyMessage.targetOrigin, 'http://127.0.0.1:4174');
  win.dispatch('message', {
    source: win.parent,
    origin: 'http://127.0.0.1:4174',
    data: { ...hello, type: 'host:focus', focused: false },
  });
  assert.deepEqual(hostEvents, [['focus', false]]);
  bridge.dispose();
});

test('host bridge sends hello after iframe load and rejects stale or spoofed messages', () => {
  const win = fakeWindow('http://127.0.0.1:4174');
  const frame = new FakeTarget();
  frame.contentWindow = { messages: [], postMessage(message, targetOrigin) { this.messages.push({ message, targetOrigin }); } };
  frame.ownerDocument = { activeElement: frame };
  const received = [];
  const host = createGameHostBridge({ frame, windowRef: win, documentRef: frame.ownerDocument, onMessage: message => received.push(message.type) });
  host.startSession({ gameId: 'demo-game', targetOrigin: 'http://127.0.0.1:4175' });
  frame.dispatch('load');
  const hello = frame.contentWindow.messages[0];
  assert.equal(hello.message.type, 'host:hello');
  assert.equal(hello.targetOrigin, 'http://127.0.0.1:4175');
  win.dispatch('message', {
    source: frame.contentWindow,
    origin: 'http://127.0.0.1:4175',
    data: { channel: GAME_ENGINE_PROTOCOL, protocolVersion: 1, type: 'game:hello', gameId: 'demo-game' },
  });
  assert.equal(frame.contentWindow.messages.at(-2).message.type, 'host:hello');
  assert.equal(frame.contentWindow.messages.at(-1).message.type, 'host:resize');
  const ready = {
    channel: GAME_ENGINE_PROTOCOL,
    type: 'game:ready',
    protocolVersion: 1,
    gameId: 'demo-game',
    sessionId: hello.message.sessionId,
  };
  win.dispatch('message', { source: {}, origin: 'http://127.0.0.1:4175', data: ready });
  win.dispatch('message', { source: frame.contentWindow, origin: 'http://evil.test', data: ready });
  assert.deepEqual(received, []);
  win.dispatch('message', { source: frame.contentWindow, origin: 'http://127.0.0.1:4175', data: ready });
  assert.deepEqual(received, ['game:ready']);
  host.dispose();
});

test('diagnostics calculates frame timing and reports runtime errors without an overlay', () => {
  const win = fakeWindow();
  const reports = [];
  const diagnostics = createDiagnostics({ gameId: 'metrics-test', windowRef: win, onReport: report => reports.push(report) });
  diagnostics.recordFrame(0);
  diagnostics.recordFrame(16.7);
  diagnostics.reportError(new Error('test failure'), { phase: 'render' });
  assert.ok(diagnostics.snapshot().fps > 0);
  assert.equal(diagnostics.snapshot().errorCount, 1);
  assert.equal(reports[0].message, 'test failure');
  diagnostics.dispose();
});
