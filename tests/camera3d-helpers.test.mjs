import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSpringArm3D,
  createSpringArmRayProbe,
  createBoxCollisionTest,
  cameraRelativeMove,
} from '../assets/runtime/integrations/camera3d.js';

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

test('createBoxCollisionTest intersects floor-standing, centered, and minmax boxes cleanly', () => {
  assert.throws(() => createBoxCollisionTest(null), TypeError);
  const boxes = [
    { x: 0, z: 3, hx: 1, hz: 0.5, h: 4 }, // floor-standing [0..4], z in [2.5..3.5]
    { x: 5, y: 2, z: 0, hx: 1, hy: 1, hz: 1 }, // centered at (5,2,0)
    { minX: -6, minY: 0, minZ: -1, maxX: -4, maxY: 3, maxZ: 1 },
  ];
  const probe = createBoxCollisionTest(boxes);
  const origin = { x: 0, y: 1.5, z: 0 };
  const dirZ = { x: 0, y: 0, z: 1 };
  const hit1 = probe(origin, { x: 0, y: 1.5, z: 6 }, dirZ, 6, 0.25);
  assert.equal(hit1.hit, true);
  assert.ok(Math.abs(hit1.distance - 2.5) < 1e-6);

  // Reuse same result object on miss
  const miss = probe(origin, { x: 0, y: 1.5, z: -6 }, { x: 0, y: 0, z: -1 }, 6, 0.25);
  assert.strictEqual(miss, hit1);
  assert.equal(miss.hit, false);
  assert.equal(miss.distance, 6);

  // Centered box along +X and minmax box along -X
  const hitCentered = probe({ x: 0, y: 2, z: 0 }, { x: 8, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, 8, 0.2);
  assert.equal(hitCentered.hit, true);
  assert.ok(Math.abs(hitCentered.distance - 4) < 1e-6);

  const hitMinMax = probe({ x: 0, y: 1.5, z: 0 }, { x: -8, y: 1.5, z: 0 }, { x: -1, y: 0, z: 0 }, 8, 0.2);
  assert.equal(hitMinMax.hit, true);
  assert.ok(Math.abs(hitMinMax.distance - 4) < 1e-6);

  // inflateByProbe pads box faces outward by probeRadius
  const padded = createBoxCollisionTest([boxes[0]], { inflateByProbe: true });
  const hitPad = padded(origin, { x: 0, y: 1.5, z: 6 }, dirZ, 6, 0.3);
  assert.equal(hitPad.hit, true);
  assert.ok(Math.abs(hitPad.distance - 2.2) < 1e-6);

  // Integrates directly with createSpringArm3D
  const arm = createSpringArm3D({
    armLength: 6,
    pitch: 0,
    yaw: 0,
    probeRadius: 0.25,
    collisionTest: createBoxCollisionTest(boxes),
  });
  const out = arm.update(0, { x: 0, y: 1.5, z: 0 });
  assert.equal(arm.collided, true);
  assert.ok(out.position.z < 2.5);
});
