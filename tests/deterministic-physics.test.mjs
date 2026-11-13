import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HGame, Entity, Scene, defineProject, createGameApplication } from '../assets/runtime/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const creator = path.join(root, 'scripts', 'create-game.mjs');
const platform = {
  input: { endFrame() {}, reset() {} },
  lifecycle: { on() { return () => {}; } },
  diagnostics: { recordFrame() {}, reportError() {} },
  ready() {}, dispose() {},
};
const renderer = { render() {}, resize() {}, dispose() {} };

test('HGame runtime is 1.0 and pins deterministic Rapier 0.21.0', async () => {
  assert.equal(HGame.version, '1.0.0');
  assert.deepEqual(HGame.physicsBackends, { '2d': 'rapier2d', '3d': 'rapier3d' });
  const pkg = JSON.parse(await readFile(path.join(root, 'assets/runtime/package.json'), 'utf8'));
  assert.equal(pkg.physics['2d'], '@dimforge/rapier2d-deterministic@0.21.0');
  assert.equal(pkg.physics['3d'], '@dimforge/rapier3d-deterministic@0.21.0');
});

for (const dimension of [2, 3]) {
test(`HGame Rapier${dimension}D advances fixed ticks and restores snapshots`, async () => {
    const physics = `rapier${dimension}d`;
    const feature = `physics${dimension}d`;
    const project = defineProject({ profile: `${dimension}d`, physics, tickHz: 60,
      features: ['scene', 'input', feature] });
    const app = createGameApplication({ project, renderer, platform });
    const scene = new Scene('physics');
    app.scenes.add(scene);
    app.scenes.start('physics');
    await app.installFeatures();
    assert.equal(scene.physics.backend, `@dimforge/rapier${dimension}d-deterministic`);
    assert.equal(scene.physics.engineVersion, '0.21.0');

    const entity = new Entity({ x: 0, y: 2, z: 0, width: 1, height: 1, depth: 1 });
    scene.add(entity);
    const body = scene.physics.add(entity, { shape: 'ball', radius: 0.25, gravityScale: 0 });
    body.setVelocity(dimension === 2 ? { x: 1, y: 0 } : { x: 1, y: 0, z: 0 });
    for (let tick = 0; tick < 60; tick++) app.step(1 / 60);

    assert.ok(entity.x > 0.9 && entity.x < 1.1);
    assert.equal(scene.physics.tick, 60);
    assert.deepEqual(scene.physics.checksums.map(item => item.tick), [30, 60]);
    const snapshot = scene.physics.takeSnapshot();
    const checksum = scene.physics.stateChecksum();
    app.step(1 / 60);
    scene.physics.restoreSnapshot(snapshot);
    assert.equal(scene.physics.tick, 60);
    assert.equal(scene.physics.stateChecksum(), checksum);
    app.dispose();
  });
}

test('projects without physics do not create a Rapier world', async () => {
  const app = createGameApplication({ project: defineProject({ profile: '2d' }), renderer, platform });
  const scene = new Scene('no-physics');
  app.scenes.add(scene);
  app.scenes.start('no-physics');
  await app.installFeatures();
  assert.equal(scene.physics, null);
  assert.equal(app.services.physics2d, undefined);
  app.dispose();
});

test('project generator packages only the selected deterministic Rapier dimension', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'hgame-global-physics-'));
  try {
    for (const dimension of [2, 3]) {
      const folder = path.join(temp, `rapier-${dimension}d-game`);
      execFileSync(process.execPath, [creator, folder, '--profile', `${dimension}d`,
        '--with', `physics${dimension}d`, '--no-git'], { encoding: 'utf8' });
      const config = JSON.parse(await readFile(path.join(folder, 'engine.config.json'), 'utf8'));
      assert.equal(config.physics, `rapier${dimension}d`);
      assert.ok(config.features.includes(`physics${dimension}d`));
      const vendor = path.join(folder, 'vendor/hgame/vendor');
      await stat(path.join(vendor, `rapier${dimension}d`, `rapier${dimension}d.wasm`));
      await assert.rejects(stat(path.join(vendor, `rapier${dimension === 2 ? 3 : 2}d`)));
          }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('project generator omits both Rapier WASM bundles when physics is disabled', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'hgame-global-no-physics-'));
  try {
    const folder = path.join(temp, 'no-physics-game');
    execFileSync(process.execPath, [creator, folder, '--profile', '2d', '--no-git'], {
      encoding: 'utf8',
    });
    const config = JSON.parse(await readFile(path.join(folder, 'engine.config.json'), 'utf8'));
    assert.equal(config.physics, 'none');
    const vendor = path.join(folder, 'vendor/hgame/vendor');
    await assert.rejects(stat(path.join(vendor, 'rapier2d')));
    await assert.rejects(stat(path.join(vendor, 'rapier3d')));
    await assert.rejects(stat(path.join(vendor, 'LICENSE-rapier.txt')));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
