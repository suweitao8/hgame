import test from 'node:test';
import assert from 'node:assert/strict';
import { InterestGrid2D } from '../dist/index.js';

test('InterestGrid2D indexes, moves across cells cleanly, removes, and queries within radius', () => {
  const grid = new InterestGrid2D(16);

  grid.upsert('p1', 0, 0);
  grid.upsert('e1', 5, 5);
  grid.upsert('e2', 20, 20);   // ~28.28 away
  grid.upsert('e3', 100, 100);

  assert.equal(grid.size, 4);
  const near = new Set(grid.queryRadius(0, 0, 10));
  assert.equal(near.has('p1'), true);
  assert.equal(near.has('e1'), true);
  assert.equal(near.has('e2'), false);
  assert.equal(near.has('e3'), false);

  // Move e3 across cells into range
  grid.upsert('e3', -6, 0);
  const afterMove = new Set(grid.queryRadius(0, 0, 10));
  assert.equal(afterMove.has('e3'), true);

  // Remove e1 and verify it disappears cleanly
  assert.equal(grid.remove('e1'), true);
  assert.equal(grid.remove('e1'), false);
  assert.equal(grid.size, 3);
  assert.equal(grid.queryRadius(0, 0, 10).includes('e1'), false);

  // Nearest neighbor sorting prioritizes closest entities
  const sorted = grid.queryNeighborsSorted(0, 0, 40, 2);
  assert.deepEqual(sorted.map((s) => s.id), ['p1', 'e3']);
});

test('InterestGrid2D observer diff applies enter/exit radius hysteresis without flicker', () => {
  const grid = new InterestGrid2D(32);
  grid.upsert(1, 0, 0);
  grid.upsert(2, 9, 0);   // within enterRadius 10
  grid.upsert(3, 12, 0);  // outside enterRadius 10, inside exitRadius 14

  const frame1 = grid.computeObserverDiff({
    x: 0,
    y: 0,
    enterRadius: 10,
    exitRadius: 14,
    excludeId: 1,
  });
  assert.deepEqual(frame1.entered, [2]);
  assert.deepEqual(frame1.exited, []);
  assert.deepEqual([...frame1.visible], [2]);

  // Entity 2 drifts to 12 units (beyond enterRadius 10, still <= exitRadius 14): stays visible!
  grid.upsert(2, 12, 0);
  const frame2 = grid.computeObserverDiff({
    x: 0,
    y: 0,
    enterRadius: 10,
    exitRadius: 14,
    currentlyVisible: frame1.visible,
    excludeId: 1,
  });
  assert.deepEqual(frame2.entered, []);
  assert.deepEqual(frame2.exited, []);
  assert.equal(frame2.visible.has(2), true);
  // Entity 3 was never entered because it sits at 12 > enterRadius 10
  assert.equal(frame2.visible.has(3), false);

  // Entity 2 leaves exitRadius (>14) and Entity 3 steps inside enterRadius (<=10)
  grid.upsert(2, 15, 0);
  grid.upsert(3, 8, 0);
  const frame3 = grid.computeObserverDiff({
    x: 0,
    y: 0,
    enterRadius: 10,
    exitRadius: 14,
    currentlyVisible: frame2.visible,
    excludeId: 1,
  });
  assert.deepEqual(frame3.entered, [3]);
  assert.deepEqual(frame3.exited, [2]);
  assert.deepEqual([...frame3.visible], [3]);
});
