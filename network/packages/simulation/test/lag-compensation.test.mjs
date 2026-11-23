import test from 'node:test';
import assert from 'node:assert/strict';
import { LagCompensationHistory } from '../dist/index.js';

test('LagCompensationHistory interpolates poses across recorded ticks and respects maxRewindMs clamp', () => {
  const history = new LagCompensationHistory(8);
  assert.equal(history.sampleAt(100), null);

  history.record(1, 1000, {
    target: { x: 0, y: 0, z: 1, radius: 1 },
  });
  history.record(2, 1100, {
    target: { x: 10, y: 20, z: 5, radius: 3 },
  });

  // Interpolate halfway between 1000ms and 1100ms
  const mid = history.sampleAt(1050, 1100, 250);
  assert.ok(mid);
  assert.equal(mid.clamped, false);
  assert.equal(mid.timestampMs, 1050);
  const pose = mid.poses.get('target');
  assert.ok(pose);
  assert.ok(Math.abs(pose.x - 5) < 1e-6);
  assert.ok(Math.abs(pose.y - 10) < 1e-6);
  assert.ok(Math.abs(pose.z - 3) < 1e-6);
  assert.ok(Math.abs(pose.radius - 2) < 1e-6);

  // Clamp rewind window if targetTimestampMs is older than (now - maxRewindMs)
  const clamped = history.sampleAt(800, 1100, 60);
  assert.ok(clamped);
  assert.equal(clamped.clamped, true);
  assert.equal(clamped.timestampMs, 1040);
  assert.ok(Math.abs(clamped.poses.get('target').x - 4) < 1e-6);

  history.clear();
  assert.equal(history.size, 0);
});

test('LagCompensationHistory verifyHit2D excludes shooter and resolves hits accurately in rewound coordinates', () => {
  const history = new LagCompensationHistory(16);

  // Actor 'target' sprints left-to-right from x=0 to x=10 between t=100ms and t=200ms.
  history.record(10, 100, {
    shooter: { x: 0, y: -5, radius: 0.5 },
    target: { x: 0, y: 0, radius: 0.5 },
  });
  history.record(11, 200, {
    shooter: { x: 0, y: -5, radius: 0.5 },
    target: { x: 10, y: 0, radius: 0.5 },
  });

  // Shooter fires straight along +Y from shooter position (0, -5), which would hit their own bounding circle if not excluded!
  // Rewinding to t=100ms puts 'target' directly at (0, 0), so hit distance is 5 - 0.5 = 4.5.
  const hitRewound = history.verifyHit2D({
    shooterId: 'shooter',
    targetTimestampMs: 100,
    nowTimestampMs: 200,
    maxRewindMs: 150,
    ray: { originX: 0, originY: -5, dirX: 0, dirY: 1, maxDistance: 20 },
  });
  assert.equal(hitRewound.hit, true);
  assert.equal(hitRewound.actorId, 'target');
  assert.ok(Math.abs(hitRewound.distance - 4.5) < 1e-6);
  assert.ok(Math.abs(hitRewound.hitX - 0) < 1e-6);
  assert.ok(Math.abs(hitRewound.hitY - -0.5) < 1e-6);
  assert.equal(hitRewound.rewoundMs, 100);

  // Without rewinding far enough (maxRewindMs=20 keeps target near x=8), the same shot at x=0 misses.
  const miss = history.verifyHit2D({
    shooterId: 'shooter',
    targetTimestampMs: 100,
    nowTimestampMs: 200,
    maxRewindMs: 20,
    ray: { originX: 0, originY: -5, dirX: 0, dirY: 1, maxDistance: 20 },
  });
  assert.equal(miss.hit, false);
  assert.equal(miss.actorId, null);
  assert.equal(miss.rewoundMs, 20);
});
