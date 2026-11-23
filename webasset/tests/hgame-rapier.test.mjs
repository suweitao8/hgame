import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { defineProject } from '../../assets/runtime/core/config.js';
import { HGame, createGameApplication, Entity, Scene } from '../../assets/runtime/index.js';

const platform = {
  input: { endFrame() {}, reset() {} },
  lifecycle: { on() { return () => {}; } },
  diagnostics: { recordFrame() {}, reportError() {} },
  ready() {}, dispose() {},
};
const renderer = { render() {}, resize() {}, dispose() {} };

test('HGame selects deterministic Rapier2D for 2D projects', () => {
  const project = defineProject({ profile: '2d', physics: 'rapier2d', tickHz: 60,
    features: ['scene', 'input', 'physics2d'] });
  assert.equal(project.physics, 'rapier2d');
  assert.equal(project.tickHz, 60);
  assert.ok(project.features.includes('physics2d'));
});

test('HGame selects deterministic Rapier3D for 3D projects', () => {
  const project = defineProject({ profile: '3d', physics: 'rapier3d', tickHz: 60,
    features: ['scene', 'input', 'physics3d'] });
  assert.equal(project.physics, 'rapier3d');
  assert.ok(project.features.includes('physics3d'));
});

test('HGame rejects physics backends that do not match the selected dimension', () => {
  assert.throws(() => defineProject({ profile: '2d', physics: 'rapier3d', features: ['scene', 'physics3d'] }), /incompatible|profile/i);
  assert.throws(() => defineProject({ profile: '3d', physics: 'rapier2d', features: ['scene', 'physics2d'] }), /incompatible|profile/i);
});

test('HGame exposes its stable engine identity and version', () => {
  assert.equal(HGame.name, 'HGame');
  assert.equal(HGame.version, '1.0.0');
  assert.deepEqual(HGame.physicsBackends, { '2d': 'rapier2d', '3d': 'rapier3d' });
  assert.equal(typeof HGame.createApplication, 'function');
});

for (const dimension of [2, 3]) {
  test(`HGame Rapier${dimension}D world is created by installFeatures and advances only fixed ticks`, async () => {
    const physics = `rapier${dimension}d`;
    const feature = `physics${dimension}d`;
    const project = defineProject({ profile: `${dimension}d`, physics, tickHz: 60,
      features: ['scene', 'input', feature] });
    const app = createGameApplication({ project, renderer, platform });
    const scene = new Scene('physics');
    app.scenes.add(scene);
    app.scenes.start('physics');
    await app.installFeatures();
    assert.equal(scene.physics.backend, '@dimforge/rapier' + dimension + 'd-deterministic');
    assert.equal(scene.physics.tickHz, 60);
    scene.physics.setGravity(dimension === 2 ? { x: 0, y: -9.81 } : { x: 0, y: -9.81, z: 0 });
    const entity = new Entity({ x: 0, y: 2, z: 0, width: 1, height: 1, depth: 1 });
    scene.add(entity);
    const body = scene.physics.add(entity, { shape: 'ball', radius: 0.25, gravityScale: 0 });
    body.rigidBody.setLinvel(dimension === 2 ? { x: 1, y: 0 } : { x: 1, y: 0, z: 0 }, true);
    for (let tick = 0; tick < 60; tick++) app.step(1 / 60);
    assert.ok(entity.x > 0.9 && entity.x < 1.1);
    assert.equal(scene.physics.tick, 60);
    assert.deepEqual(scene.physics.checksums.map(item => item.tick), [30, 60]);
    assert.throws(() => scene.physics.step(1 / 30), /fixed|tick/i);
    const snapshot = scene.physics.takeSnapshot();
    const checksum = scene.physics.stateChecksum();
    scene.physics.step(1 / 60);
    scene.physics.restoreSnapshot(snapshot);
    assert.equal(scene.physics.tick, 60);
    assert.equal(scene.physics.stateChecksum(), checksum);
    assert.equal(scene.physics.get(entity).rigidBody.handle, body.rigidBody.handle);
    app.dispose();
  });

  test(`HGame Rapier${dimension}D supports deterministic ray queries, contacts and rollback of body creation`, async () => {
    const project = defineProject({ profile: `${dimension}d`, physics: `rapier${dimension}d`,
      features: ['scene', `physics${dimension}d`] });
    const app = createGameApplication({ project, renderer, platform });
    const scene = new Scene('collision');
    app.scenes.add(scene);
    app.scenes.start('collision');
    await app.installFeatures();
    const physics = scene.physics;
    const wall = new Entity({ x: 2, y: 0, z: 0, width: 1, height: 2, depth: 2 });
    const actor = new Entity({ x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1 });
    scene.add(wall); scene.add(actor);
    physics.add(wall, { static: true });
    const actorBody = physics.add(actor, { shape: 'ball', radius: 0.25, gravityScale: 0 });
    // Rapier refreshes its broad-phase query structures at the end of each step.
    physics.step();
    const ray = physics.castRay(dimension === 2 ? { x: -2, y: 0.8 } : { x: -2, y: 0.8, z: 0 },
      dimension === 2 ? { x: 1, y: 0 } : { x: 1, y: 0, z: 0 }, 10);
    assert.ok(ray && ray.timeOfImpact > 3 && ray.timeOfImpact < 4);
    assert.equal(ray.body.entity, wall);
    let enters = 0;
    physics.on('enter', () => enters++);
    actorBody.setVelocity(dimension === 2 ? { x: 8, y: 0 } : { x: 8, y: 0, z: 0 });
    for (let tick = 0; tick < 60; tick++) physics.step();
    assert.ok(enters >= 1);
    assert.ok(actor.x < 1.5);
    assert.equal(physics.overlaps(actor, wall), true);
    const snapshot = physics.takeSnapshot();
    const transient = new Entity({ x: -5, y: 0, z: 0, width: 1, height: 1, depth: 1 });
    scene.add(transient);
    physics.add(transient);
    physics.restoreSnapshot(snapshot);
    assert.equal(physics.get(transient), null);
    assert.ok(physics.get(actor));
    app.dispose();
  });
}

test('HGame keeps physics optional and does not initialize a WASM world for non-physics projects', async () => {
  const app = createGameApplication({ project: defineProject({ profile: '2d' }), renderer, platform });
  const scene = new Scene('no-physics');
  app.scenes.add(scene);
  app.scenes.start('no-physics');
  await app.installFeatures();
  assert.equal(scene.physics, null);
  assert.equal(app.services.physics2d, undefined);
  app.dispose();
});

test('HGame Rapier WASM bundles are reproducible from the exact pinned npm packages', () => {
  const script = new URL('../../scripts/build-physics.mjs', import.meta.url);
  const output = execFileSync(process.execPath, [script.pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--check'], {
    encoding: 'utf8',
  });
  assert.match(output, /rapier2d-deterministic@0\.21\.0: vendor bundle verified/);
  assert.match(output, /rapier3d-deterministic@0\.21\.0: vendor bundle verified/);
});
