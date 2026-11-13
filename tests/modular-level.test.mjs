import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  compileModularLevel, createModularLevelRenderer, gridToWorld, worldToGrid,
} from '../assets/runtime/integrations/modular-level.js';

const sample = () => ({
  version: 1,
  grid: { cellSize: 1, origin: [0, 0, 0] },
  groups: [
    { slot: 'ground.grass', fill: { from: [-1, 0, -1], to: [1, 0, 1] },
      exclude: [[0, 0, 0]] },
    { slot: 'building.bricks', fill: { from: [-1, 1, -1], to: [1, 2, -1] },
      exclude: [[0, 1, -1]] },
    { slot: 'building.stairs', cells: [[-1, 3, -1], [0, 3, -1], [1, 3, -1]],
      turns: 1 },
    { slot: 'building.bricks', cells: [[2, 1, 1]], turns: 2 },
  ],
  colliders: [
    { id: 'floor', center: [0, 0.5, 0], size: [5, 1, 5] },
    { id: 'wall', center: [-1, 1.5, -1], size: [1, 1, 1], sensor: true },
  ],
  playerSpawn: [0, 1.8, 0],
});

test('compiles inclusive grid fills/holes/rotations deterministically without modifying source', () => {
  const level = sample();
  const original = JSON.stringify(level);
  const compiled = compileModularLevel(level);
  assert.equal(JSON.stringify(level), original);
  assert.equal(compiled.stats.tiles, 17);
  assert.equal(compiled.stats.slots, 3);
  assert.equal(compiled.batches.length, 3);
  assert.deepEqual(compiled.batches.map(g => [g.slot, g.placements.length]),
    [['ground.grass', 8], ['building.bricks', 6], ['building.stairs', 3]]);
  assert.ok(!compiled.batches[0].placements.some(p => p.x === 0 && p.z === 0));
  assert.ok(compiled.batches[1].placements.some(p => p.x === 2 && p.rotationY === Math.PI));
  assert.ok(compiled.batches[2].placements.every(p => p.rotationY === Math.PI / 2));
  assert.equal(compiled.colliders.length, 2);
  assert.equal(compiled.colliders[1].sensor, true);
  assert.deepEqual(compiled.playerSpawn, [0, 1.8, 0]);
  assert.deepEqual(compileModularLevel(level), compiled);
});

test('grid coordinates use model-bottom anchors, non-default cell size, and reversible snaps', () => {
  const grid = { cellSize: 0.5, origin: [2.5, -1, 7] };
  const world = gridToWorld([3, 2, -4], grid);
  assert.deepEqual(world, [4, 0, 5]);
  assert.deepEqual(worldToGrid([4.12, 0.02, 4.93], grid), [3, 2, -4]);
  const compiled = compileModularLevel({
    version: 1, grid,
    groups: [{ slot: 'building.wood', cells: [[3, 2, -4]], scale: 0.5 }],
  });
  assert.deepEqual(
    [compiled.batches[0].placements[0].x, compiled.batches[0].placements[0].y,
      compiled.batches[0].placements[0].z],
    world,
  );
  assert.equal(compiled.batches[0].placements[0].scale, 0.25);
});

test('invalid/huge/duplicate/unsafe level layouts fail closed before allocating GLBs', () => {
  for (const level of [
    { ...sample(), version: 2 },
    { ...sample(), grid: { cellSize: -1, origin: [0, 0, 0] } },
    { ...sample(), groups: [{ slot: 'bad/../../foo', cells: [[0, 0, 0]] }] },
    { ...sample(), groups: [{ slot: 'ground.grass', fill: { from: [0, 0, 0], to: [2000, 0, 0] } }] },
    { ...sample(), groups: [{ slot: 'ground.grass', cells: [[0, 0, 0], [0, 0, 0]] }] },
    { ...sample(), groups: [{ slot: 'ground.grass', cells: [[0.25, 0, 0]] }] },
    { ...sample(), groups: [{ slot: 'ground.grass', cells: [[0, 0, 0]], turns: 8 }] },
    { ...sample(), groups: [{ slot: 'ground.grass', cells: [[0, 0, 0]], exclude: [[1, 0, 0]] }] },
    { ...sample(), groups: [{ slot: 'ground.grass', cells: [[0, 0, 0]], extra: 1 }] },
    { ...sample(), colliders: [{ id: 'x', center: [0, 0, 0], size: [-1, 1, 1] }] },
    { ...sample(), colliders: [{ id: 'x', center: [0, 0, 0], size: [1, 1, 1] },
      { id: 'x', center: [0, 0, 0], size: [1, 1, 1] }] },
  ]) {
    assert.throws(() => compileModularLevel(level));
  }
  assert.throws(() => worldToGrid([0, NaN, 0], { cellSize: 1, origin: [0, 0, 0] }));
});

test('mount/rebuild uses a single Group, batches per slot, and replacement keeps map intact', async () => {
  const world = new THREE.Scene();
  const calls = [];
  const models = {
    get: name => ({ model: name }),
    async instantiate(slot) {
      calls.push(['single', slot]);
      return new THREE.Group();
    },
    async instantiateBatch(slot, placements) {
      calls.push(['batch', slot, placements.length]);
      return new THREE.Group();
    },
  };
  const renderer = createModularLevelRenderer({ THREE, models, parent: world });
  const input = sample();
  const first = await renderer.setLevel(input);
  assert.equal(first.committed, true);
  assert.deepEqual(calls.map(x => x[0]), ['batch', 'batch', 'batch']);
  assert.equal(world.children.length, 1);
  assert.equal(world.children[0].children.length, 3);
  assert.equal(renderer.stats.tiles, 17);
  assert.equal(renderer.stats.slots, 3);
  const old = world.children[0];
  await renderer.rebuild();
  assert.equal(world.children.length, 1);
  assert.notStrictEqual(world.children[0], old);
  assert.equal(renderer.stats.tiles, 17);
  const changed = sample();
  changed.groups = [{ slot: 'ground.grass', cells: [[0, 0, 0]] }];
  await renderer.setLevel(changed);
  assert.deepEqual(calls.at(-1), ['single', 'ground.grass']);
  assert.equal(world.children.length, 1);
  assert.equal(renderer.stats.tiles, 1);
  renderer.clear();
  assert.equal(world.children.length, 0);
  assert.equal(renderer.stats.tiles, 0);
  renderer.dispose();
  await assert.rejects(renderer.setLevel(sample()), /disposed/i);
});

test('failed async model load preserves old level; concurrent updates commit only newest', async () => {
  const parent = new THREE.Scene();
  let unblock;
  const barrier = new Promise(resolve => { unblock = resolve; });
  const models = {
    get: id => ({ id }),
    async instantiate(slot) {
      if (slot === 'slow.asset') await barrier;
      if (slot === 'broken.asset') throw new Error('intentional model load error');
      return new THREE.Group();
    },
    async instantiateBatch() { return new THREE.Group(); },
  };
  const view = createModularLevelRenderer({ THREE, parent, models });
  const doc = slot => ({
    version: 1, groups: [{ slot, cells: [[0, 0, 0]] }],
  });
  await view.setLevel(doc('fast.asset'));
  const stable = parent.children[0];
  await assert.rejects(view.setLevel(doc('broken.asset')), /intentional/);
  assert.strictEqual(parent.children[0], stable);
  const slow = view.setLevel(doc('slow.asset'));
  const fast = await view.setLevel(doc('next.asset'));
  assert.equal(fast.committed, true);
  unblock();
  assert.equal((await slow).committed, false);
  assert.equal(parent.children.length, 1);
  assert.equal(parent.children[0].children[0].userData.levelSlot, 'next.asset');
  view.dispose();
});
