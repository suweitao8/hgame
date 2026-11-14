import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpringArm3D, createSpringArmRayProbe, cameraRelativeMove } from '../assets/runtime/integrations/camera3d.js';

test('ray probe adapts castRay timeOfImpact and never casts a negative distance', () => {
  const calls = [];
  const probe = createSpringArmRayProbe((o, d, max) => {
    if (max < 0) throw new Error('negative');
    calls.push(max);
    return max > 3 ? { timeOfImpact: 2 } : null;
  });
  const v = { x: 0, y: 0, z: 0 };
  assert.deepEqual({ ...probe(v, v, v, 5, 0.2) }, { hit: true, distance: 2 });
  assert.deepEqual({ ...probe(v, v, v, 3, 0.2) }, { hit: false, distance: 3 });
  assert.equal(probe(v, v, v, -1, 0.2).hit, false);
  assert.equal(probe(v, v, v, 0, 0.2).hit, false);
  assert.deepEqual(calls, [5, 3]);
  assert.throws(() => createSpringArmRayProbe(null), TypeError);
});

test('spring arm shortens on probe hit and ignores misses', () => {
  const mk = (cast) => createSpringArm3D({ armLength: 6, probeRadius: 0.25, collisionTest: createSpringArmRayProbe(cast) });
  const hitArm = mk(() => ({ timeOfImpact: 2 }));
  hitArm.update({ x: 0, y: 0, z: 0 }, 0);
  assert.equal(hitArm.collided, true);
  const missArm = mk(() => null);
  missArm.update({ x: 0, y: 0, z: 0 }, 0);
  assert.equal(missArm.collided, false);
});

test('cameraRelativeMove rotates input by yaw and clamps magnitude', () => {
  const o = cameraRelativeMove(0, 1, 0);
  assert.ok(Math.abs(o.x) < 1e-9 && Math.abs(o.z + 1) < 1e-9 && o.y === 0);
  const r = cameraRelativeMove(1, 0, 0, o);
  assert.strictEqual(r, o);
  assert.ok(Math.abs(r.x - 1) < 1e-9 && Math.abs(r.z) < 1e-9);
  const q = cameraRelativeMove(0, 1, Math.PI / 2);
  assert.ok(Math.abs(q.x + 1) < 1e-9 && Math.abs(q.z) < 1e-9);
  const d = cameraRelativeMove(1, 1, 0);
  assert.ok(Math.abs(Math.hypot(d.x, d.z) - 1) < 1e-9);
});
