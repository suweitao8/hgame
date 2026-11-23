import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  HGAME_VERSION, HGame, defineProject, resolveFeatureGraph, createGameApplication,
  Component, Entity, Scene, PrefabRegistry, createTraceRecorder,
} from '../assets/runtime/index.js';
import { createThreeAdapter, createThreeMeshComponent } from '../assets/runtime/integrations/three.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const skill = root;
const generator = path.join(root, 'scripts', 'create-game.mjs');

test('HGame 1.0 exposes deterministic physics and retains optional lockstep, PBR and adaptive 3D quality', () => {
  assert.equal(HGAME_VERSION, '1.0.0');
  assert.equal(HGame.name, 'HGame');
  assert.equal(HGame.version, '1.0.0');
  assert.equal(HGame.createApplication, createGameApplication);
});

test('repository package, runtime entry and VERSION file stay on the same release', async () => {
  const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const runtimeVersion = (await readFile(path.join(root, 'assets', 'runtime', 'VERSION'), 'utf8')).trim();
  assert.equal(rootPackage.version, HGAME_VERSION);
  assert.equal(runtimeVersion, HGAME_VERSION);
});

test('HGame exposes a renderer-neutral JSONL trace recorder without owning a scheduler', () => {
  const lines = [];
  const recorder = createTraceRecorder({ gameId: 'demo', scenarioId: 'movement', build: 'test', tickHz: 60,
    maxEvents: 3, emit: line => lines.push(line) });
  assert.equal(HGame.createTraceRecorder, createTraceRecorder);
  assert.equal(recorder.sequence, 0);
  assert.deepEqual(JSON.parse(lines[0]), {
    _type: 'trace', schemaVersion: 1, gameId: 'demo', scenarioId: 'movement', build: 'test', tickHz: 60,
  });
  assert.equal(recorder.record({ tick: 1, actorId: 'p1', type: 'move', position: { x: 1, y: 0 } }), 1);
  assert.equal(recorder.record({ tick: 1, actorId: 'p1', type: 'hit', health: 80 }), 2);
  assert.equal(recorder.record({ tick: 2, actorId: 7, type: 'move', position: { x: 2, y: 0 } }), 3);
  assert.equal(JSON.parse(lines[1]).sequence, 1);
  assert.equal(JSON.parse(lines[2])._type, 'event');
  assert.equal(recorder.lastTick, 2);
  assert.throws(() => recorder.record({ tick: 0, actorId: 'p1', type: 'move' }), /non-decreasing/);
  assert.throws(() => recorder.record({ tick: 3, actorId: 'p1', type: 'move' }), /limit/);
});

test('trace recorder validates metadata, events and JSON serialization before emitting', () => {
  const lines = [];
  assert.throws(() => createTraceRecorder({ gameId: 'demo', scenarioId: '', emit() {} }), /scenarioId/);
  assert.throws(() => createTraceRecorder({ gameId: 'demo', scenarioId: 's', tickHz: -1, emit() {} }), /tickHz/);
  const recorder = createTraceRecorder({ gameId: 'demo', scenarioId: 's', emit: line => lines.push(line) });
  assert.throws(() => recorder.record({ tick: -1, actorId: 'p1', type: 'move' }), /tick/);
  assert.throws(() => recorder.record({ tick: 1, actorId: '', type: 'move' }), /actorId/);
  assert.throws(() => recorder.record({ tick: 1, actorId: 'p1', type: 'move', value: 1n }), /serialize|BigInt/i);
  assert.equal(lines.length, 1);
  assert.equal(recorder.sequence, 0);
});

test('starter profiles use the application runtime and drive collidable actors through Rapier velocities', async () => {
  const profiles = path.join(skill, 'assets', 'profiles');
  const twoD = await readFile(path.join(profiles, '2d', 'main.js'), 'utf8');
  const threeD = await readFile(path.join(profiles, '3d', 'main.js'), 'utf8');
  const ui = await readFile(path.join(profiles, 'ui', 'main.js'), 'utf8');
  assert.match(twoD, /createGameApplication\(\{/);
  assert.match(twoD, /type: 'dynamic', shape: 'cuboid', gravityScale: 0/);
  assert.match(twoD, /actorBody\.setVelocity/);
  assert.match(threeD, /createGameApplication\(\{/);
  assert.match(threeD, /type: 'dynamic', gravityScale: 0, friction: 0/);
  assert.match(threeD, /actorBody\.setVelocity/);
  assert.match(ui, /createGameApplication\(\{/);
});

function platform() {
  return {
    input: { isDown: () => false, wasPressed: () => false, wasReleased: () => false,
      endFrame() {}, reset() {} },
    lifecycle: { on: () => () => {} },
    ready() {}, dispose() {},
    diagnostics: { recordFrame() {}, reportError(error) { throw error; } },
  };
}

test('profile defaults are lean, exclusive, and never silently install the other dimension', () => {
  const two = defineProject({ profile: '2d' });
  assert.equal(two.renderer, 'canvas2d');
  assert.equal(two.physics, 'none');
  assert.equal(two.tickHz, 60);
  assert.deepEqual(two.features, ['scene', 'input']);
  const three = defineProject({ profile: '3d' });
  assert.equal(three.renderer, 'threejs');
  assert.equal(three.physics, 'none');
  assert.deepEqual(three.features, ['scene', 'input']);
  const ui = defineProject({ profile: 'ui' });
  assert.equal(ui.tickHz, 0);
  assert.equal(ui.renderer, 'dom');
  assert.deepEqual(ui.features, ['scene']);
  assert.throws(() => defineProject({ profile: '3d', physics: 'arcade2d' }), /2d|3d|physics/i);
  assert.throws(() => defineProject({ profile: '2d', renderer: 'threejs' }), /profile|renderer/i);
  assert.throws(() => defineProject({ profile: '2d', tickHzz: 60 }), /Unknown engine config field/);
  assert.throws(() => defineProject({ profile: '3d', features: ['tilemap2d'] }), /2d|feature/i);
  assert.throws(() => defineProject({ profile: 'ui', features: ['physics2d'] }), /feature|ui|physics/i);
});

test('feature resolution validates dependencies, rejects cycles, duplicates and unknown services', () => {
  assert.deepEqual(resolveFeatureGraph(['physics2d'], {
    scene: { depends: [] }, physics2d: { depends: ['scene'] },
  }), ['scene', 'physics2d']);
  assert.throws(() => resolveFeatureGraph(['not-real'], {}), /Unknown feature/);
  assert.throws(() => resolveFeatureGraph(['a'], {
    a: { depends: ['b'] }, b: { depends: ['a'] },
  }), /cycle/i);
  assert.deepEqual(resolveFeatureGraph(['scene', 'scene'], { scene: { depends: [] } }), ['scene']);
});

test('Unity-style component lifetime follows Awake, OnEnable, Start, FixedUpdate, Update, LateUpdate, OnDisable, OnDestroy', () => {
  const seen = [];
  class Spin extends Component {
    awake() { seen.push('awake'); }
    onEnable() { seen.push('enable'); }
    start() { seen.push('start'); }
    fixedUpdate(dt) { seen.push('fixed:' + dt); }
    update() { seen.push('update'); }
    lateUpdate() { seen.push('late'); }
    onDisable() { seen.push('disable'); }
    onDestroy() { seen.push('destroy'); }
  }
  const app = createGameApplication({
    project: defineProject({ profile: '2d' }), platform: platform(),
    renderer: { render() {}, dispose() {} },
  });
  const main = app.scenes.add(new Scene('main'));
  const entity = main.add(new Entity({ name: 'actor', x: 4, y: 7 }));
  const script = entity.addComponent(new Spin());
  app.scenes.start('main');
  assert.deepEqual(seen, ['awake', 'enable']);
  app.step(1 / 60);
  assert.deepEqual(seen.slice(2), ['start', 'fixed:' + 1 / 60, 'update', 'late']);
  script.enabled = false;
  app.step(1 / 60);
  assert.equal(seen.filter(x => x === 'disable').length, 1);
  script.enabled = true;
  app.step(1 / 60);
  assert.equal(seen.filter(x => x === 'awake').length, 1);
  assert.equal(seen.filter(x => x === 'start').length, 1);
  entity.destroy();
  assert.deepEqual(seen.slice(-2), ['disable', 'destroy']);
  app.dispose();
});

test('component state follows parent activation, scene change and dynamic additions', () => {
  const seen = [];
  class C extends Component {
    awake() { seen.push(this.entity.name + ':awake'); }
    onEnable() { seen.push(this.entity.name + ':enable'); }
    onDisable() { seen.push(this.entity.name + ':disable'); }
    onDestroy() { seen.push(this.entity.name + ':destroy'); }
  }
  const app = createGameApplication({ project: defineProject({ profile: '2d' }),
    platform: platform(), renderer: { render() {} } });
  const first = app.scenes.add(new Scene('first'));
  const second = app.scenes.add(new Scene('second'));
  const parent = first.add(new Entity({ name: 'parent' }));
  const child = parent.add(new Entity({ name: 'child' }));
  child.addComponent(new C());
  app.scenes.start('first');
  assert.deepEqual(seen, ['child:awake', 'child:enable']);
  parent.active = false;
  assert.equal(seen.at(-1), 'child:disable');
  parent.active = true;
  assert.equal(seen.at(-1), 'child:enable');
  app.scenes.start('second');
  assert.equal(seen.at(-1), 'child:disable');
  app.scenes.start('first');
  assert.equal(seen.at(-1), 'child:enable');
  assert.throws(() => child.add(parent), /cycle|ancestor/i);
  app.dispose();
  assert.equal(seen.at(-1), 'child:destroy');
});

test('worldPosition composes parent rotation and scale in 2D and 3D instead of adding offsets', () => {
  const parent2D = new Entity({ x: 10, y: 20, rotationZ: Math.PI / 2, scaleX: 2, scaleY: 3 });
  const child2D = parent2D.add(new Entity({ x: 1, y: 2 }));
  const p2 = child2D.worldPosition();
  assert.ok(Math.abs(p2.x - 4) < 1e-9);
  assert.ok(Math.abs(p2.y - 22) < 1e-9);
  const parent3D = new Entity({ x: 0, y: 4, z: 5, rotationY: Math.PI / 2, scaleX: 2, scaleY: 2, scaleZ: 2 });
  const child3D = parent3D.add(new Entity({ x: 0, y: 0, z: 2 }));
  const p3 = child3D.worldPosition();
  assert.ok(Math.abs(p3.x - 4) < 1e-9);
  assert.ok(Math.abs(p3.y - 4) < 1e-9);
  assert.ok(Math.abs(p3.z - 5) < 1e-9);
});

test('disabling inside awake never triggers a spurious OnEnable and late reenable wakes only once', () => {
  const calls = [];
  class DisableDuringAwake extends Component {
    awake() { calls.push('awake'); this.enabled = false; }
    onEnable() { calls.push('enable'); }
    onDisable() { calls.push('disable'); }
  }
  const app = createGameApplication({ project: defineProject({ profile:'2d' }),
    platform: platform(), renderer: { render() {} } });
  const scene = app.scenes.add(new Scene('state'));
  const entity = scene.add(new Entity({ name: 'actor' }));
  app.scenes.start('state');
  const c = entity.addComponent(new DisableDuringAwake());
  assert.deepEqual(calls, ['awake']);
  c.enabled = true;
  assert.deepEqual(calls, ['awake', 'enable']);
  app.dispose();
  assert.equal(calls.at(-1), 'disable');
});

test('Three mesh visually inherits parent position, rotation and uniform scale', async () => {
  const THREE = await import('../assets/optional/three/three.module.js');
  const app = createGameApplication({
    project: defineProject({ profile:'3d' }), platform: platform(),
    renderer: { render() {}, add() {}, remove() {} },
  });
  const scene = app.scenes.add(new Scene('hierarchy'));
  const parent = scene.add(new Entity({ x: 10, y: 0, z: 0, rotationY: Math.PI/2, scaleX:2, scaleY:2, scaleZ:2 }));
  const child = parent.add(new Entity({ x: 0, y: 1, z: 3, rotationY: Math.PI/2 }));
  const meshComponent = child.addComponent(createThreeMeshComponent(THREE));
  app.scenes.start('hierarchy');
  app.step(1 / 60);
  const position = meshComponent.mesh.position;
  assert.ok(Math.abs(position.x - 16) < 1e-9);
  assert.ok(Math.abs(position.y - 2) < 1e-9);
  assert.ok(Math.abs(position.z) < 1e-9);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(meshComponent.mesh.quaternion);
  assert.ok(Math.abs(forward.z + 1) < 1e-8, 'parent and child yaw compose to 180 degrees');
  assert.ok(Math.abs(meshComponent.mesh.scale.x - 2) < 1e-9);
  app.dispose();
});

test('prefab instantiation is data-driven, cloned and rejects unregistered or malformed components', () => {
  class Speed extends Component {
    constructor({ speed = 1 } = {}) { super(); this.speed = speed; }
  }
  const prefabs = new PrefabRegistry();
  prefabs.registerComponent('speed', props => new Speed(props));
  prefabs.register('enemy', {
    name: 'enemy', transform: { x: 1, y: 2, z: 3 },
    components: [{ type: 'speed', properties: { speed: 7 } }],
    children: [{ name: 'hat', transform: { y: 2 } }],
  });
  const a = prefabs.instantiate('enemy', { x: 50 });
  const b = prefabs.instantiate('enemy');
  assert.equal(a.x, 50);
  assert.equal(b.x, 1);
  assert.equal(a.z, 3);
  assert.equal(a.children[0].name, 'hat');
  assert.notEqual(a.components[0], b.components[0]);
  assert.equal(a.getComponent(Speed).speed, 7);
  assert.throws(() => prefabs.register('bad', { components: [{ type: 'missing' }] }) && prefabs.instantiate('bad'), /unregistered/i);
  assert.throws(() => prefabs.register('evil', { transform: { __proto__: null } }) && prefabs.instantiate('evil'), /properties|invalid|plain/i);
});

for (const dimension of [2, 3]) {
  test(`HGame standalone runtime loads the vendored deterministic Rapier${dimension}D backend`, async () => {
    const physics = `rapier${dimension}d`;
    const feature = `physics${dimension}d`;
    const project = defineProject({ profile: `${dimension}d`, physics,
      features: ['scene', 'input', feature], tickHz: 60 });
    const app = createGameApplication({ project, platform: platform(), renderer: { render() {} } });
    const scene = app.scenes.add(new Scene('physics'));
    app.scenes.start('physics');
    await app.installFeatures();
    const entity = scene.add(new Entity({ x: 0, y: 1, z: 0, width: 1, height: 1, depth: 1 }));
    const body = scene.physics.add(entity, { shape: 'ball', radius: 0.25, gravityScale: 0 });
    body.setVelocity(dimension === 2 ? { x: 1, y: 0 } : { x: 1, y: 0, z: 0 });
    for (let tick = 0; tick < 30; tick++) app.step(1 / 60);
    assert.equal(scene.physics.backend, `@dimforge/rapier${dimension}d-deterministic`);
    assert.equal(scene.physics.tick, 30);
    assert.equal(scene.physics.checksums.at(-1).tick, 30);
    const snapshot = scene.physics.takeSnapshot();
    const checksum = scene.physics.stateChecksum();
    scene.physics.step(1 / 60);
    scene.physics.restoreSnapshot(snapshot);
    assert.equal(scene.physics.stateChecksum(), checksum);
    app.dispose();
  });
}

test('manual UI mode executes commands without RAF or fixed-step physics', () => {
  let requested = 0, renderCount = 0, updateCount = 0;
  const app = createGameApplication({ project: defineProject({ profile: 'ui' }), platform: platform(),
    renderer: { render() { renderCount++; } }, requestFrame() { requested++; } });
  const scene = app.scenes.add(new Scene('cards'));
  scene.onCommand = event => { assert.equal(event.type, 'draw'); updateCount++; };
  app.scenes.start('cards');
  app.start();
  assert.equal(requested, 0);
  app.dispatch({ type: 'draw' });
  assert.equal(updateCount, 1);
  assert.equal(renderCount, 2); // initial view + one command-driven redraw
  app.dispose();
});

test('Three adapter is dependency-injected, creates only 3D rendering resources and disposes owned meshes', () => {
  const calls = [];
  class Scene3D { constructor() { this.children = []; } add(x) { this.children.push(x); } remove(x) { this.children.splice(this.children.indexOf(x), 1); } }
  class Camera { position = { set() {} }; constructor() {} updateProjectionMatrix() {} }
  class WebGLRenderer { constructor({ canvas }) { this.canvas = canvas; } setSize(w,h) { calls.push(['size',w,h]); }
    setPixelRatio(r) { calls.push(['dpr',r]); } render(scene,camera) { calls.push(['render',scene.children.length]); } dispose() { calls.push(['dispose']); } }
  class Mesh { position = { set(...a) { calls.push(['move', ...a]); } }; rotation = { set() {} }; scale = { set() {} };
    constructor(geometry,material) { this.geometry = geometry; this.material = material; } }
  class BoxGeometry { dispose() { calls.push(['geometryDispose']); } }
  class MeshStandardMaterial { dispose() { calls.push(['materialDispose']); } }
  const THREE = { Scene: Scene3D, PerspectiveCamera: Camera, WebGLRenderer, Mesh, BoxGeometry, MeshStandardMaterial };
  const canvas = { clientWidth: 600, clientHeight: 340 };
  const renderer = createThreeAdapter({ THREE, canvas, width: 640, height: 360, pixelRatio: 2 });
  const app = createGameApplication({ project: defineProject({ profile: '3d' }),
    platform: platform(), renderer });
  const scene = app.scenes.add(new Scene('world'));
  const actor = scene.add(new Entity({ x: 2, y: 3, z: 4 }));
  actor.addComponent(createThreeMeshComponent(THREE, { type: 'box', color: 0xff2200 }));
  app.scenes.start('world');
  app.step(1 / 60);
  assert.ok(calls.some(c => c[0] === 'render'));
  assert.ok(calls.some(c => c[0] === 'move' && c[1] === 2 && c[3] === 4));
  app.dispose();
  assert.ok(calls.some(c => c[0] === 'geometryDispose'));
  assert.ok(calls.some(c => c[0] === 'dispose'));
});

test('generator produces 2D, 3D and UI profiles from any directory without overwriting or pulling unused renderer', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'hgame-profiles-'));
  try {
    for (const mode of ['2d', '3d', 'ui']) {
      const destination = path.join(temp, 'game-' + mode);
      const r = spawnSync(process.execPath, [generator, destination, '--profile', mode, '--no-git'], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const recipe = JSON.parse(await readFile(path.join(destination, 'engine.config.json'), 'utf8'));
      assert.equal(recipe.profile, mode);
      const config = JSON.parse(await readFile(path.join(destination, 'game.config.json'), 'utf8'));
      assert.equal(config.renderer, { '2d': 'webgl-custom', '3d': 'threejs', ui: 'dom' }[mode]);
      const js = await readFile(path.join(destination, 'src', 'main.js'), 'utf8');
      assert.match(js, mode === '2d' ? /startPixiGame/ : /vendor\/hgame/);
      const threePath = path.join(destination, 'assets', 'vendor', 'three');
      const hasThree = await import('node:fs').then(fs => fs.existsSync(threePath));
      assert.equal(hasThree, mode === '3d');
      const tests = spawnSync(process.execPath, ['--test', 'tests/config.test.mjs'], { cwd: destination, encoding: 'utf8' });
      assert.equal(tests.status, 0, tests.stderr);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('generating a 2D physics project selects deterministic Rapier2D and and ships the opt-in 2D helpers inside the single runtime', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'hgame-feature-selection-'));
  try {
    const destination = path.join(temp, 'physics-2d');
    const run = (...args) => spawnSync(process.execPath, [generator, destination, ...args], { encoding: 'utf8' });
    const invalid = run('--profile', '3d', '--with', 'physics2d', '--no-git');
    assert.notEqual(invalid.status, 0);
    const success = run('--profile', '2d', '--with', 'physics2d,tilemap2d,save', '--no-git');
    assert.equal(success.status, 0, success.stderr);
    const recipe = JSON.parse(await readFile(path.join(destination, 'engine.config.json'), 'utf8'));
    assert.equal(recipe.physics, 'rapier2d');
    assert.ok(recipe.features.includes('physics2d'));
    const physicsOnly = path.join(temp, 'physics-only');
    const only = spawnSync(process.execPath, [generator, physicsOnly, '--profile', '2d', '--with', 'physics2d', '--no-git'], { encoding: 'utf8' });
    assert.equal(only.status, 0, only.stderr);
    const fs = await import('node:fs');
    assert.equal(fs.existsSync(path.join(physicsOnly, 'vendor', 'hgame', 'vendor', 'rapier2d', 'rapier2d.wasm')), true);
    assert.equal(fs.existsSync(path.join(physicsOnly, 'vendor', 'hgame', 'vendor', 'rapier3d')), false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('3D physics projects select deterministic Rapier3D without bundling the 2D runtime', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'hgame-physics3d-generator-'));
  const dest = path.join(temp, 'simple-3d');
  try {
    const result = spawnSync(process.execPath, [generator, dest, '--profile', '3d',
      '--with', 'physics3d', '--no-git'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const recipe = JSON.parse(await readFile(path.join(dest, 'engine.config.json'), 'utf8'));
    assert.equal(recipe.physics, 'rapier3d');
    assert.ok(recipe.features.includes('physics3d'));
    const fs = await import('node:fs');
    assert.equal(fs.existsSync(path.join(dest, 'vendor', 'hgame', 'physics', 'rapier3d.js')), true);
    assert.equal(fs.existsSync(path.join(dest, 'vendor', 'hgame', 'vendor', 'rapier3d', 'rapier3d.wasm')), true);
    assert.equal(fs.existsSync(path.join(dest, 'vendor', 'hgame', 'vendor', 'rapier2d')), false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
