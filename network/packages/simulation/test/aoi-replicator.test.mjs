import test from 'node:test';
import assert from 'node:assert/strict';
import { AoiDeltaPlanner } from '../dist/index.js';

test('AoiDeltaPlanner tracks AOI entry/exit, bandwidth deferral, and spectator rebinding', () => {
  const planner = new AoiDeltaPlanner({ cellSize: 50 });

  planner.upsertEntity({ id: 1, x: 0, y: 0, yaw: 0, flags: 1 });
  planner.upsertEntity({ id: 2, x: 40, y: 0, yaw: 1, flags: 1 });
  planner.upsertEntity({ id: 3, x: 500, y: 500, yaw: 2, flags: 1 }); // outside AOI

  planner.setObserver('obsA', {
    x: 0,
    y: 0,
    followEntityId: 1,
    enterRadius: 100,
    exitRadius: 120,
    maxEntities: 10,
  });

  const plan1 = planner.planForObserver('obsA', 1, 0.05);
  assert.ok(plan1 && plan1.kind === 'snapshot');
  assert.deepEqual(plan1.entities.map((e) => e.id).sort((a, b) => a - b), [1, 2]);

  // Move entity 2 outside exitRadius -> should emit removal in delta
  planner.upsertEntity({ id: 2, x: 200, y: 0, yaw: 1, flags: 1 });
  const plan2 = planner.planForObserver('obsA', 2, 0.05);
  assert.ok(plan2 && plan2.kind === 'delta');
  assert.equal(plan2.baseTick, 1);
  assert.deepEqual(plan2.removedIds, [2]);

  // Switching spectator target to entity 3 triggers a fresh full snapshot at entity 3's AOI
  planner.setObserverFollow('obsA', 3);
  const plan3 = planner.planForObserver('obsA', 3, 0.05);
  assert.ok(plan3 && plan3.kind === 'snapshot');
  assert.deepEqual(plan3.entities.map((e) => e.id), [3]);
});

test('AoiDeltaPlanner preserves deferred entities in baseline until starvation promotes them', () => {
  const planner = new AoiDeltaPlanner({ cellSize: 50 });
  planner.upsertEntity({ id: 1, x: 0, y: 0, basePriority: 10 });
  planner.upsertEntity({ id: 2, x: 10, y: 0, basePriority: 1 });

  // Bandwidth cap allows only 1 entity per packet
  planner.setObserver('obsA', {
    x: 0,
    y: 0,
    enterRadius: 100,
    maxEntities: 1,
  });

  const snap = planner.planForObserver('obsA', 1, 0.05);
  assert.equal(snap.kind, 'snapshot');
  assert.equal(snap.entities.length, 1);
  assert.equal(snap.entities[0].id, 1);
  assert.equal(snap.deferredCount, 1);

  // Next tick with no change to entity 1: entity 2 is still dirty (never sent) and gets sent now
  const delta = planner.planForObserver('obsA', 2, 0.05);
  assert.equal(delta.kind, 'delta');
  assert.deepEqual(delta.upserts.map((e) => e.id), [2]);
  assert.deepEqual(delta.removedIds, []);
});
