import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_ENGINE_PROTOCOL, GAME_ENGINE_PROTOCOL_VERSION, GAME_MESSAGE_TYPES } from '../assets/runtime/platform/protocol.js';
import { createGameHostBridge } from '../assets/runtime/platform/host-bridge.js';
import { createTriggerVolumes } from '../assets/runtime/world/trigger-volumes.js';
import { mountLevel } from '../assets/runtime/world/level.js';
import { Scene } from '../assets/runtime/core/scene.js';
import { Entity } from '../assets/runtime/core/entity.js';
import { PrefabRegistry } from '../assets/runtime/core/prefab.js';
import { createTagContainer } from '../assets/runtime/core/tags.js';

/** A frame, window or document stand-in that records listeners so tests can fire events. */
function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type, event = {}) { for (const listener of [...(listeners.get(type) ?? [])]) listener(event); },
    listenerCount: (type) => listeners.get(type)?.size ?? 0,
  };
}

function createHost({ crypto } = {}) {
  const frame = Object.assign(createEventTarget(), {
    contentWindow: {
      posted: [],
      postMessage(message, origin) { this.posted.push({ message, origin }); },
    },
    rect: { width: 320.5, height: 180 },
    getBoundingClientRect() { return this.rect; },
  });
  const windowRef = Object.assign(createEventTarget(), { devicePixelRatio: 2 });
  if (crypto) windowRef.crypto = crypto;
  const documentRef = Object.assign(createEventTarget(), { activeElement: null, visibilityState: 'visible' });
  const received = [];
  const bridge = createGameHostBridge({ frame, windowRef, documentRef, onMessage: (message) => received.push(message) });
  return { frame, windowRef, documentRef, received, bridge, posted: frame.contentWindow.posted };
}

const ORIGIN = 'https://game.example';

/** A message event as the game iframe would post it. */
function gameEvent(host, session, overrides = {}) {
  return {
    source: host.frame.contentWindow,
    origin: ORIGIN,
    data: { channel: GAME_ENGINE_PROTOCOL, protocolVersion: GAME_ENGINE_PROTOCOL_VERSION, gameId: 'g1', sessionId: session, type: 'game:ready', payload: { width: 960 }, ...overrides },
  };
}

test('host bridge: a session is validated and the bridge stays silent until one starts', () => {
  assert.throws(() => createGameHostBridge(), TypeError('frame is required'));
  const host = createHost();
  assert.equal(host.bridge.session, null);
  assert.equal(host.bridge.sendResize(), false);
  assert.equal(host.bridge.sendFocus(true), false);
  host.frame.dispatch('load');
  host.windowRef.dispatch('resize');
  host.windowRef.dispatch('message', gameEvent(host, 'any'));
  assert.deepEqual(host.posted, []);

  assert.throws(() => host.bridge.startSession({ gameId: '', targetOrigin: ORIGIN }), TypeError('gameId is required'));
  assert.throws(() => host.bridge.startSession({ gameId: 7, targetOrigin: ORIGIN }), TypeError('gameId is required'));
  assert.throws(() => host.bridge.startSession({ gameId: 'g1', targetOrigin: 'ftp://game.example' }), TypeError('game target origin must use HTTP or HTTPS without credentials'));
  assert.throws(() => host.bridge.startSession({ gameId: 'g1', targetOrigin: 'https://user:pass@game.example' }), TypeError('game target origin must use HTTP or HTTPS without credentials'));
  assert.throws(() => host.bridge.startSession({ gameId: 'g1', targetOrigin: 'not a url' }), TypeError);

  const sessionId = host.bridge.startSession({ gameId: 'g1', targetOrigin: 'https://game.example:443/room?x=1#top' });
  assert.deepEqual(host.bridge.session, { gameId: 'g1', targetOrigin: ORIGIN, sessionId, ready: false });
  assert.match(sessionId, /^wge-/);
  assert.match(createHost({ crypto: { randomUUID: () => 'uuid-1' } }).bridge.startSession({ gameId: 'g1', targetOrigin: ORIGIN }), /^uuid-1$/);
});

test('host bridge: a frame load announces the host and reports the frame size', () => {
  const host = createHost();
  const sessionId = host.bridge.startSession({ gameId: 'g1', targetOrigin: ORIGIN });
  host.frame.dispatch('load');
  assert.deepEqual(host.posted, [
    { origin: ORIGIN, message: { channel: GAME_ENGINE_PROTOCOL, protocolVersion: GAME_ENGINE_PROTOCOL_VERSION, type: 'host:hello', gameId: 'g1', sessionId, payload: { capabilities: { focus: true, resize: true, diagnostics: true } } } },
    { origin: ORIGIN, message: { channel: GAME_ENGINE_PROTOCOL, protocolVersion: GAME_ENGINE_PROTOCOL_VERSION, type: 'host:resize', gameId: 'g1', sessionId, payload: { width: 320.5, height: 180, pixelRatio: 2 } } },
  ]);

  // The pixel ratio stays between 1 and 3 and a frame without a rect reports zeros.
  host.windowRef.devicePixelRatio = 4.75;
  host.bridge.sendResize();
  host.windowRef.devicePixelRatio = 0.5;
  host.bridge.sendResize();
  delete host.frame.getBoundingClientRect;
  assert.equal(host.bridge.sendResize(), true);
  assert.deepEqual(host.posted.slice(2).map(entry => entry.message.payload), [
    { width: 320.5, height: 180, pixelRatio: 3 },
    { width: 320.5, height: 180, pixelRatio: 1 },
    { width: 0, height: 0, pixelRatio: 1 },
  ]);
});

test('host bridge: only messages from the game frame of the current session are accepted', () => {
  const host = createHost();
  const seen = [];
  host.bridge.on('game:ready', message => seen.push(message));
  const sessionId = host.bridge.startSession({ gameId: 'g1', targetOrigin: ORIGIN });

  const reject = (event) => host.windowRef.dispatch('message', event);
  reject({ ...gameEvent(host, sessionId), source: {} });
  reject({ ...gameEvent(host, sessionId), origin: 'https://evil.example' });
  reject(gameEvent(host, sessionId, { channel: 'other' }));
  reject(gameEvent(host, sessionId, { protocolVersion: '0' }));
  reject(gameEvent(host, sessionId, { gameId: 'other' }));
  reject(gameEvent(host, sessionId, { sessionId: 'other' }));
  reject(gameEvent(host, sessionId, { type: 'game:not-a-type' }));
  reject({ ...gameEvent(host, sessionId), data: null });
  assert.deepEqual(seen, []);
  assert.deepEqual(host.received, []);
  assert.equal(host.bridge.session.ready, false);

  host.windowRef.dispatch('message', gameEvent(host, sessionId));
  assert.equal(seen.length, 1);
  assert.ok(Object.isFrozen(seen[0]));
  assert.deepEqual({ ...seen[0] }, { type: 'game:ready', gameId: 'g1', payload: { width: 960 } });
  assert.deepEqual(host.received, seen);
  assert.equal(host.bridge.session.ready, true);

  // A missing payload becomes an empty one and every other declared game message type is forwarded.
  const other = GAME_MESSAGE_TYPES.find(type => type !== 'game:hello' && type !== 'game:ready');
  assert.ok(other, 'the protocol declares more than hello and ready');
  host.windowRef.dispatch('message', gameEvent(host, sessionId, { type: other, payload: null }));
  assert.deepEqual(host.received.at(-1), { type: other, gameId: 'g1', payload: {} });

  // `game:hello` carries no session id yet and is answered like a frame load.
  host.posted.length = 0;
  host.windowRef.dispatch('message', gameEvent(host, undefined, { type: 'game:hello' }));
  assert.deepEqual(host.posted.map(entry => entry.message.type), ['host:hello', 'host:resize']);
  assert.equal(host.received.length, 2);
});

test('host bridge: focus, visibility and resize changes are forwarded until the session ends', () => {
  const host = createHost();
  host.bridge.startSession({ gameId: 'g1', targetOrigin: ORIGIN });
  host.posted.length = 0;

  host.documentRef.activeElement = host.frame;
  host.windowRef.dispatch('focusin');
  host.windowRef.dispatch('focus');
  host.windowRef.dispatch('blur');
  host.documentRef.activeElement = null;
  host.windowRef.dispatch('blur');
  host.windowRef.dispatch('focus');
  host.frame.dispatch('focus');
  host.documentRef.visibilityState = 'hidden';
  host.documentRef.dispatch('visibilitychange');
  host.bridge.sendFocus(1);
  host.bridge.sendFocus(0);
  host.frame.rect = { width: 200, height: 100 };
  host.windowRef.dispatch('resize');

  assert.deepEqual(host.posted.map(entry => [entry.message.type, entry.message.payload]), [
    ['host:focus', { focused: true }],
    ['host:focus', { focused: true }],
    ['host:focus', { focused: false }],
    ['host:focus', { focused: false }],
    ['host:focus', { focused: true }],
    ['host:visibility', { visible: false }],
    ['host:focus', { focused: true }],
    ['host:focus', { focused: false }],
    ['host:resize', { width: 200, height: 100, pixelRatio: 2 }],
  ]);

  host.bridge.stopSession();
  assert.equal(host.bridge.session, null);
  assert.equal(host.bridge.sendFocus(true), false);
  host.windowRef.dispatch('message', gameEvent(host, 'any'));
  host.bridge.startSession({ gameId: 'g1', targetOrigin: ORIGIN });
  const contentWindow = host.frame.contentWindow;
  host.frame.contentWindow = null;
  assert.equal(host.bridge.sendResize(), false);
  host.frame.contentWindow = contentWindow;

  assert.equal(host.bridge.dispose(), true);
  assert.equal(host.bridge.dispose(), false);
  for (const type of ['load', 'focus']) assert.equal(host.frame.listenerCount(type), 0);
  for (const type of ['message', 'resize', 'focusin', 'blur', 'focus']) assert.equal(host.windowRef.listenerCount(type), 0);
  assert.equal(host.documentRef.listenerCount('visibilitychange'), 0);
  host.posted.length = 0;
  host.frame.dispatch('load');
  host.windowRef.dispatch('resize');
  assert.deepEqual(host.posted, []);
  assert.throws(() => host.bridge.startSession({ gameId: 'g1', targetOrigin: ORIGIN }), Error('game host bridge is disposed'));
});

const BOX = { min: [0, 0], max: [10, 10] };

function createVolumes(definitions = { a: BOX, b: BOX }, options = {}) {
  const events = [];
  const volumes = createTriggerVolumes(definitions, {
    dimensions: 2,
    ...options,
    onEvent: (event) => { events.push(event); options.onEvent?.(event); },
  });
  return { volumes, events };
}

const brief = (events) => events.map(event => [event.type, event.trigger, event.actor, event.signal]);

test('trigger volumes: definitions are validated when the tracker is created', () => {
  assert.throws(() => createTriggerVolumes({}, { dimensions: 1 }), RangeError('Trigger dimensions must be 2 or 3'));
  assert.throws(() => createVolumes({ box: { min: [0], max: [1, 1] } }), TypeError('volume minimum needs 2 coordinates'));
  assert.throws(() => createVolumes({ box: { min: [0, 0], max: [1, 'x'] } }), TypeError('volume maximum must be finite'));
  assert.throws(() => createVolumes({ box: { min: [5, 0], max: [5, 1] } }), RangeError('Trigger volume needs positive size: box'));
  assert.throws(() => createVolumes({ '  ': BOX }), TypeError('trigger id must be a non-empty string'));
  assert.throws(() => createVolumes({ box: { ...BOX, enterSignal: '' } }), TypeError('enter signal must be a non-empty string'));
  assert.throws(() => createVolumes({ box: { ...BOX, exitSignal: 3 } }), TypeError('exit signal must be a non-empty string'));
});

test('trigger volumes: an actor enters and leaves each volume once per crossing', () => {
  const { volumes, events } = createVolumes({ a: BOX, b: { ...BOX, enterSignal: 'b-enter', exitSignal: 'b-exit' } });
  assert.deepEqual(brief(volumes.update([{ id: 'hero', position: [5, 5] }, { id: 'ghost', position: [15, 5] }])), [
    ['enter', 'a', 'hero', undefined],
    ['enter', 'b', 'hero', 'b-enter'],
  ]);
  assert.ok(Object.isFrozen(events[0]));
  assert.deepEqual(volumes.update([{ id: 'hero', position: [5, 5] }]), []);
  assert.equal(volumes.contains('a', 'hero'), true);
  assert.equal(volumes.contains('a', 'ghost'), false);
  assert.equal(volumes.contains('missing', 'hero'), false);
  assert.deepEqual(brief(volumes.update([{ id: 'hero', position: [10.0001, 5] }])), [
    ['exit', 'a', 'hero', undefined],
    ['exit', 'b', 'hero', 'b-exit'],
  ]);
  assert.equal(volumes.contains('a', 'hero'), false);
  assert.deepEqual(brief(volumes.update([])), []);
  assert.deepEqual(createVolumes({}).volumes.update([{ id: 'hero', position: [0, 0] }]), []);
});

test('trigger volumes: tag queries decide who triggers, and 3D volumes use three coordinates', () => {
  const { volumes, events } = createVolumes({
    burning: { ...BOX, tags: { all: ['Status.Burning'] } },
  });
  volumes.update([{ id: 'mage', position: [1, 1], tags: createTagContainer(['Status.Burning']) }]);
  volumes.update([
    { id: 'hero', position: [1, 1] },
    { id: 'mage', position: [1, 1], tags: createTagContainer(['Status.Burning']) },
  ]);
  assert.deepEqual(brief(events), [['enter', 'burning', 'mage', undefined]]);

  const cube = createTriggerVolumes({ room: { min: [0, 0, 0], max: [2, 2, 2] } }, { dimensions: 3 });
  assert.deepEqual(cube.update([{ id: 'fly', position: [1, 1, 3] }]), []);
  assert.equal(cube.update([{ id: 'fly', position: [1, 1, 2] }])[0].type, 'enter');
  assert.throws(() => cube.update([{ id: 'fly', position: [1, 1] }]), TypeError('actor position needs 3 coordinates'));
});

test('trigger volumes: a one-shot zone fires for one actor and stays spent', () => {
  const { volumes, events } = createVolumes({ once: { ...BOX, once: true } });
  volumes.update([{ id: 'first', position: [1, 1] }, { id: 'second', position: [2, 2] }]);
  assert.deepEqual(brief(events), [['enter', 'once', 'first', undefined]]);
  assert.deepEqual(volumes.snapshot(), ['once']);
  assert.deepEqual(brief(volumes.update([{ id: 'first', position: [20, 1] }, { id: 'second', position: [2, 2] }])), [
    ['exit', 'once', 'first', undefined],
  ]);
  assert.deepEqual(volumes.update([{ id: 'first', position: [1, 1] }]), []);
  assert.deepEqual(volumes.snapshot(), ['once']);
});

test('trigger volumes: commands are refused inside callbacks and after disposal', () => {
  const host = { volumes: null };
  const { volumes } = createVolumes({ a: BOX }, { onEvent: () => {
    assert.throws(() => host.volumes.update([]), Error('Trigger commands cannot run during trigger callbacks'));
    assert.throws(() => host.volumes.restore([]), Error('Trigger commands cannot run during trigger callbacks'));
  } });
  host.volumes = volumes;
  volumes.update([{ id: 'hero', position: [1, 1] }]);

  // A listener that throws leaves the tracker usable.
  const loud = createVolumes({ a: BOX }, { onEvent: () => { throw new Error('listener failed'); } });
  assert.throws(() => loud.volumes.update([{ id: 'hero', position: [1, 1] }]), Error('listener failed'));
  loud.volumes.update([{ id: 'hero', position: [1, 1] }]);
  assert.throws(() => loud.volumes.update([{ id: 'hero', position: [1, 1] }, { id: 'hero', position: [1, 1] }]), Error('Duplicate trigger actor: hero'));
  assert.throws(() => loud.volumes.update([{ id: 'other', position: [1, 1] }]), Error('listener failed'));
  loud.volumes.update([{ id: 'other', position: [1, 1] }]);
  loud.volumes.dispose();
  assert.throws(() => loud.volumes.update([]), Error('Trigger volumes are disposed'));
  assert.throws(() => loud.volumes.restore([]), Error('Trigger volumes are disposed'));
  assert.equal(typeof loud.volumes.subscribe(() => {}), 'function');
});

test('trigger volumes: restore replaces the spent one-shot list and rebuilds occupancy', () => {
  const { volumes, events } = createVolumes({ once: { ...BOX, once: true }, field: BOX });
  volumes.update([{ id: 'hero', position: [1, 1] }]);
  events.length = 0;

  assert.throws(() => volumes.restore(['field']), Error('Invalid one-shot trigger snapshot'));
  assert.throws(() => volumes.restore('once'), Error('Invalid one-shot trigger snapshot'));
  volumes.restore(['once']);
  assert.deepEqual(volumes.snapshot(), ['once']);
  assert.equal(volumes.contains('field', 'hero'), false);
  // Occupancy was cleared, so the ordinary zone reports the actor again while the spent one stays quiet.
  volumes.update([{ id: 'hero', position: [1, 1] }]);
  assert.deepEqual(brief(events), [['enter', 'field', 'hero', undefined]]);

  volumes.restore([]);
  events.length = 0;
  volumes.update([{ id: 'hero', position: [1, 1] }]);
  assert.deepEqual(brief(events), [['enter', 'once', 'hero', undefined], ['enter', 'field', 'hero', undefined]]);
  assert.deepEqual(volumes.snapshot(), ['once']);
});

function createRegistry() {
  const registry = new PrefabRegistry();
  registry.register('coin', { name: 'coin', transform: { x: 1 }, children: [{ name: 'spark' }] });
  registry.register('enemy', { name: 'enemy' });
  return registry;
}

/** Records every entity the registry instantiates so tests can check that failures clean them up. */
function trackInstantiations(registry) {
  const created = [];
  const instantiate = registry.instantiate.bind(registry);
  registry.instantiate = (name, overrides) => {
    const entity = instantiate(name, overrides);
    created.push(entity);
    return entity;
  };
  return created;
}

const levelData = (overrides = {}) => ({
  schemaVersion: 1,
  id: 'arena',
  dimensions: 2,
  entities: [
    { id: 'child', parent: 'root-node' },
    { id: 'root-node', prefab: 'coin' },
    { id: 'lamp', transform: { x: 3, y: 4 }, tags: ['State.Lit'], active: false },
  ],
  spawns: { start: { position: [4, 5] }, facing: { position: [1, 2], rotation: [0, 0, 1] } },
  triggers: {
    gate: { min: [0, 0], max: [2, 2], once: true, enterSignal: 'gate-open' },
    field: { min: [0, 0], max: [3, 3] },
  },
  ...overrides,
});

test('level: invalid definitions are rejected before anything is mounted', () => {
  const scene = new Scene('level-validation');
  const registry = createRegistry();
  const mount = (overrides) => mountLevel(scene, registry, levelData(overrides));
  assert.throws(() => mount({ schemaVersion: 2 }), Error('Unsupported level schema version'));
  assert.throws(() => mount({ id: '' }), TypeError('level id must be a non-empty string'));
  assert.throws(() => mount({ dimensions: 4 }), RangeError('Level dimensions must be 2 or 3'));
  assert.throws(() => mount({ entities: [{ id: 'a' }, { id: 'a' }] }), Error('Duplicate level entity: a'));
  assert.throws(() => mount({ entities: [{ id: 'a', prefab: 'nope' }] }), Error('Unknown level prefab: nope'));
  assert.throws(() => mount({ entities: [{ id: 'a', parent: 'ghost' }] }), Error('Unknown level parent: ghost'));
  assert.throws(() => mount({ entities: [{ id: 'a', parent: 'b' }, { id: 'b', parent: 'a' }] }), Error('Cyclic level hierarchy at a'));
  assert.throws(() => mount({ entities: [{ id: 'a', transform: { colour: 'red' } }] }), Error('Unknown level transform field: colour'));
  assert.throws(() => mount({ entities: [{ id: 'a', transform: { x: '1' } }] }), TypeError('x must be finite'));
  assert.throws(() => mount({ spawns: { p: { position: [1] } } }), Error('Spawn point needs 2 coordinates'));
  assert.throws(() => mount({ spawns: { p: { position: [1, 2], rotation: [0, 0] } } }), Error('Spawn rotation needs XYZ radians'));

  const chain = Array.from({ length: 70 }, (_, i) => ({ id: `n${i}`, ...(i ? { parent: `n${i - 1}` } : {}) }));
  assert.throws(() => mount({ entities: chain }), Error('Level hierarchy exceeds 64 entities deep'));
  assert.throws(() => mount({ triggers: { box: { min: [1, 1], max: [0, 0] } } }), RangeError('Trigger volume needs positive size: box'));
  assert.equal(scene.objects.length, 0);
});

test('level: placements mount parents first whatever their declaration order', () => {
  const scene = new Scene('level-mount');
  const level = mountLevel(scene, createRegistry(), levelData());

  assert.equal(level.id, 'arena');
  assert.equal(level.root.name, 'level:arena');
  assert.equal(level.root.scene, scene);
  assert.deepEqual(scene.objects, [level.root]);
  assert.equal(level.getEntity('child').parent, level.getEntity('root-node'));
  assert.equal(level.getEntity('root-node').parent, level.root);
  // A placement with a prefab is a fresh instance of the whole prefab tree.
  assert.equal(level.getEntity('root-node').children[0].name, 'spark');
  const lamp = level.getEntity('lamp');
  assert.deepEqual([lamp.x, lamp.y, lamp.active, lamp.tags.matches('State.Lit')], [3, 4, false, true]);
  assert.equal(level.getEntity('missing'), null);

  lamp.destroy();
  assert.equal(level.getEntity('lamp'), null, 'a destroyed placement is no longer returned');
  level.getEntity('child').detach();
  assert.equal(level.getEntity('child'), null, 'a placement moved out of the level is no longer returned');
  level.dispose();
});

test('level: spawn points are copies and spawning follows the point and the options', () => {
  const scene = new Scene('level-spawn');
  const registry = createRegistry();
  const level = mountLevel(scene, registry, levelData());

  const start = level.getSpawnPoint('start');
  assert.deepEqual(start, { x: 4, y: 5, z: 0 });
  start.x = 99;
  assert.equal(level.getSpawnPoint('start').x, 4);
  assert.deepEqual(level.getSpawnPoint('facing'), { x: 1, y: 2, z: 0, rotationX: 0, rotationY: 0, rotationZ: 1 });
  assert.equal(level.getSpawnPoint('nope'), null);

  const coin = level.spawn('coin', 'start', { name: 'loot', tags: ['State.Lit'] });
  assert.deepEqual([coin.name, coin.x, coin.y, coin.parent, coin.tags.matches('State.Lit'), coin.children.length], ['loot', 4, 5, level.root, true, 1]);
  const before = level.root.children.length;
  const batch = level.spawnBatch('enemy', 'start', 3, { active: false });
  assert.equal(batch.length, 3);
  assert.equal(level.root.children.length, before + 3);
  assert.ok(batch.every(entity => !entity.active && entity.x === 4 && entity.y === 5));

  assert.throws(() => level.spawnBatch('coin', 'start', 0), RangeError('spawn count must be a positive integer'));
  assert.throws(() => level.spawnBatch('coin', 'start', 1.5), RangeError('spawn count must be a positive integer'));
  assert.throws(() => level.spawnBatch('coin', 'start', 4097), RangeError('Level prefab batches are limited to 4096 entities'));
  assert.throws(() => level.spawnBatch('coin', 'nope', 1), Error('Unknown spawn point: nope'));
  assert.throws(() => level.spawnBatch('nope', 'start', 1), Error('Unknown prefab: nope'));
  assert.throws(() => level.spawnBatch('coin', 'start', 1, { name: ' ' }), TypeError('spawned entity name must be a non-empty string'));
  level.dispose();
});

test('level: a batch that fails part-way is rolled back', () => {
  const scene = new Scene('level-rollback');
  const registry = createRegistry();
  const created = trackInstantiations(registry);
  const level = mountLevel(scene, registry, levelData());
  const before = level.root.children.length;

  const add = level.root.add.bind(level.root);
  let calls = 0;
  level.root.add = (child) => {
    if (++calls === 2) throw new Error('attach failed');
    return add(child);
  };
  assert.throws(() => level.spawnBatch('enemy', 'start', 3), Error('attach failed'));
  assert.equal(level.root.children.length, before);
  assert.ok(created.slice(-3).every(entity => entity.destroyed));

  // Unknown prefabs leave nothing behind either.
  assert.throws(() => level.spawn('nope', 'start'), Error('Unknown prefab: nope'));
  level.dispose();
});

test('level: triggers follow samples and live scene entities, and snapshots round-trip', () => {
  // Only entities of an active scene are sampled.
  const scene = Object.assign(new Scene('level-triggers'), { active: true });
  const level = mountLevel(scene, createRegistry(), levelData());
  const events = [];
  const queued = [];
  const unsubscribe = level.subscribe(event => queued.push(event));

  assert.deepEqual(level.updateTriggers([{ id: 'hero', position: [1, 1] }]).map(event => [event.type, event.trigger, event.actor, event.signal]), [
    ['enter', 'gate', 'hero', 'gate-open'],
    ['enter', 'field', 'hero', undefined],
  ]);
  assert.equal(level.contains('gate', 'hero'), true);
  assert.equal(queued.length, 2);
  unsubscribe();

  const walker = level.spawn('enemy', 'facing');
  const idle = level.spawn('enemy', 'start', { active: false });
  const elsewhere = new Entity({ name: 'elsewhere', x: 1, y: 1 });
  new Scene('other').add(elsewhere);
  // Every update is the complete set of actors: `hero` is no longer sampled, so it leaves both zones,
  // while the inactive entity and the one from another scene are not sampled at all. A zone lists
  // its arrivals before its departures.
  events.push(...level.updateEntityTriggers([walker, idle, elsewhere]));
  assert.deepEqual(events.map(event => [event.type, event.trigger, event.actor]), [
    ['exit', 'gate', 'hero'],
    ['enter', 'field', String(walker.id)],
    ['exit', 'field', 'hero'],
  ]);
  walker.x = 50;
  events.push(...level.updateEntityTriggers([walker]));
  assert.deepEqual(events.at(-1), { type: 'exit', trigger: 'field', actor: String(walker.id), signal: undefined });

  const snapshot = level.snapshot();
  assert.deepEqual(snapshot, { schemaVersion: 1, levelId: 'arena', usedTriggers: ['gate'] });
  assert.throws(() => level.restore({ schemaVersion: 1, levelId: 'other', usedTriggers: [] }), Error('Incompatible level snapshot'));
  assert.throws(() => level.restore(null), Error('Incompatible level snapshot'));
  level.restore(snapshot);
  assert.deepEqual(level.snapshot(), snapshot);
  level.dispose();
});

test('level: unmounting closes the level', () => {
  const scene = new Scene('level-unmount');
  const level = mountLevel(scene, createRegistry(), levelData());
  level.root.destroy();
  const closed = Error('Level is not mounted: arena');
  assert.throws(() => level.spawn('coin', 'start'), closed);
  assert.throws(() => level.updateTriggers([]), closed);
  assert.throws(() => level.updateEntityTriggers([]), closed);
  assert.throws(() => level.snapshot(), closed);
  assert.throws(() => level.restore({ schemaVersion: 1, levelId: 'arena', usedTriggers: [] }), closed);
  assert.equal(level.contains('gate', 'hero'), false);
  level.dispose();

  const other = mountLevel(new Scene('level-unmount-2'), createRegistry(), levelData());
  other.dispose();
  assert.equal(other.root.destroyed, true);
  other.dispose();
});

test('level: a root that is detached during activation rolls the level back', () => {
  const scene = new Scene('level-detached');
  scene.add = () => {};
  const registry = createRegistry();
  const created = trackInstantiations(registry);
  assert.throws(() => mountLevel(scene, registry, levelData()), Error('Level root was detached during activation: arena'));
  assert.equal(created.length, 1);
  assert.equal(created[0].destroyed, true);
});
