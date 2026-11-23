import test from 'node:test';
import assert from 'node:assert/strict';
import { Entity, Scene, TileMap, defineProject, createGameApplication } from '../assets/runtime/index.js';

const platform = () => ({ input: { endFrame() {}, reset() {} }, lifecycle: { on() { return () => {}; } },
  diagnostics: { recordFrame() {}, reportError() {} }, ready() {}, dispose() {} });

async function setup() {
  const app = createGameApplication({
    project: defineProject({ profile: '2d', physics: 'rapier2d', tickHz: 60, features: ['scene', 'physics2d', 'tilemap2d'] }),
    renderer: { render() {}, resize() {}, dispose() {} }, platform: platform(),
  });
  const scene = app.scenes.add(new Scene('level'));
  app.scenes.start('level');
  await app.installFeatures();
  return { app, scene };
}
const rows = ['..........', '..##......', '..##......', '##########', '##########'];
const mk = () => new TileMap({ tiles: rows.map(r => [...r].map(c => (c === '#' ? 1 : 0))), tileWidth: 1, tileHeight: 1, solid: [1] });

test('physics.addTileMap merges solid tiles into few colliders', async () => {
  const { scene } = await setup();
  const merged = scene.physics.addTileMap(scene, mk());
  assert.equal(merged.length, 3, 'block+floor column (2x4), left floor (2x2), right floor (6x2)');
  const { scene: s2 } = await setup();
  const raw = s2.physics.addTileMap(s2, mk(), { merge: false });
  assert.equal(raw.length, 24, '20 floor + 4 block tiles without merging');
});

test('physics.addTileMap keeps physics y-up: a falling body lands on the floor top', async () => {
  const { app, scene } = await setup();
  scene.physics.addTileMap(scene, mk(), { originY: 0 }); // floor top surface at world y = -3
  scene.physics.setGravity?.({ x: 0, y: -20 });
  const ball = scene.add(new Entity({ x: 6.5, y: 2, width: 0.5, height: 0.5 }));
  scene.physics.add(ball, { type: 'dynamic' });
  for (let i = 0; i < 240; i++) app.step ? app.step(1 / 60) : scene.physics.step(1 / 60);
  assert.ok(ball.y > -3 && ball.y < -2.5, `ball rests on top of floor, y=${ball.y}`);
});

test('physics.addTileMap validates arguments', async () => {
  const { scene } = await setup();
  assert.throws(() => scene.physics.addTileMap(null, mk()), /owning Scene/);
  assert.throws(() => scene.physics.addTileMap(scene, {}), /TileMap/);
});
