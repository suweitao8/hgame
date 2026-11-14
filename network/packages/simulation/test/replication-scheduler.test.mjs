import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplicationPriorityScheduler } from '../dist/index.js';

test('ReplicationPriorityScheduler orders by priority, distance falloff, and view cone boost', () => {
  const scheduler = new ReplicationPriorityScheduler({
    defaultEntityBytes: 50,
    distanceFalloff: 20,
    viewConeBoost: 2.0,
    viewConeCos: 0.5,
  });

  const observer = {
    x: 0, y: 0, z: 0,
    viewDirX: 0, viewDirY: 0, viewDirZ: -1, // looking along -Z
  };

  const candidates = [
    { id: 'far-behind', x: 0, y: 0, z: 40, basePriority: 1 },
    { id: 'near-behind', x: 0, y: 0, z: 5, basePriority: 1 },
    { id: 'near-ahead', x: 0, y: 0, z: -5, basePriority: 1 },
    { id: 'boss-ahead', x: 0, y: 0, z: -12, basePriority: 3 },
    { id: 'dormant-prop', x: 0, y: 0, z: -2, basePriority: 5, dormant: true },
  ];

  const res = scheduler.schedule('client-1', candidates, observer, { maxEntities: 3 }, 0.05);
  assert.equal(res.skippedDormant, 1);
  assert.equal(res.selected.length, 3);
  assert.equal(res.bytesUsed, 150);
  // Boss ahead beats near-ahead; near-ahead (2x view cone) beats near-behind!
  assert.deepEqual(res.selected.map(s => s.id), ['boss-ahead', 'near-ahead', 'near-behind']);
  assert.deepEqual(res.deferred, ['far-behind']);
});

test('ReplicationPriorityScheduler prevents starvation under tight packet limits', () => {
  const scheduler = new ReplicationPriorityScheduler({
    defaultEntityBytes: 40,
    distanceFalloff: 50,
    starvationRate: 1,
  });

  const observer = { x: 0, y: 0 };
  const candidates = [
    { id: 'vip', x: 2, y: 0, basePriority: 5 },
    { id: 'background-npc', x: 2, y: 0, basePriority: 1 },
  ];

  const sentIds = [];
  for (let tick = 0; tick < 10; tick++) {
    const res = scheduler.schedule('obs-1', candidates, observer, { maxEntities: 1 }, 0.05);
    assert.equal(res.selected.length, 1);
    sentIds.push(res.selected[0].id);
  }

  // VIP dominates early ticks, but background-npc accumulates starvation waitTime and gets scheduled too!
  assert.ok(sentIds.includes('vip'));
  assert.ok(sentIds.includes('background-npc'));
});

test('ReplicationPriorityScheduler enforces maxBytes cap and alwaysRelevant cutoff bypass', () => {
  const scheduler = new ReplicationPriorityScheduler({ defaultEntityBytes: 64 });
  const observer = { x: 0, y: 0, maxRelevantDistance: 25 };

  const candidates = [
    { id: 'boss-far', x: 200, y: 0, basePriority: 2, alwaysRelevant: true, estimatedBytes: 120 },
    { id: 'culled-far', x: 200, y: 0, basePriority: 5, alwaysRelevant: false, estimatedBytes: 40 },
    { id: 'small-near', x: 5, y: 0, basePriority: 2, estimatedBytes: 50 },
    { id: 'medium-near', x: 6, y: 0, basePriority: 1.5, estimatedBytes: 100 },
  ];

  // Byte budget of 170 accommodates boss-far (120) + small-near (50) = 170, deferring medium-near (100) and culling culled-far!
  const res = scheduler.schedule('obs-bytes', candidates, observer, { maxBytes: 170 }, 0.05);
  assert.deepEqual(res.selected.map(s => s.id), ['boss-far', 'small-near']);
  assert.equal(res.bytesUsed, 170);
  assert.deepEqual(res.deferred, ['medium-near']);

  // Vanished entity state cleans up automatically on next tick
  scheduler.schedule('obs-bytes', [candidates[0]], observer, { maxBytes: 170 }, 0.05);
  assert.equal(scheduler.getWaitTime('obs-bytes', 'medium-near'), 0);
});
