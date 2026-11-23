import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import { Entity } from '../assets/runtime/index.js';
import { RapierPhysicsWorld2D } from '../assets/runtime/physics/rapier2d.js';
import { RapierPhysicsWorld3D } from '../assets/runtime/physics/rapier3d.js';

test('S1: Rapier 2D & 3D support fixed, revolute (+limits/motor), prismatic, spherical, and spring joints with auto cleanup', () => {
  // 2D Pendulum + Spring
  const w2 = new RapierPhysicsWorld2D({ gravity: { x: 0, y: -9.81 } });
  const anchor2 = new Entity({ x: 0, y: 5, width: 1, height: 1 });
  const bob2 = new Entity({ x: 2, y: 5, width: 1, height: 1 });
  const fixed2 = new Entity({ x: 0, y: 0, width: 1, height: 1 });
  const springBob2 = new Entity({ x: 0, y: -3, width: 1, height: 1 });

  const bAnchor2 = w2.add(anchor2, { type: 'fixed' });
  const bBob2 = w2.add(bob2, { type: 'dynamic', linearDamping: 0.1 });
  const rev2 = w2.addJoint(bAnchor2, bBob2, {
    type: 'revolute',
    anchor1: { x: 0, y: 0 },
    anchor2: { x: -2, y: 0 },
    limits: [-1.2, 1.2],
    motor: { targetVelocity: 2, maxForce: 5 },
  });
  assert.equal(rev2.type, 'revolute');

  const bFixed2 = w2.add(fixed2, { type: 'fixed' });
  const bSpring2 = w2.add(springBob2, { type: 'dynamic' });
  const spring2 = w2.addJoint(bFixed2, bSpring2, {
    type: 'spring',
    restLength: 2,
    stiffness: 120,
    damping: 4,
    anchor1: { x: 0, y: 0 },
    anchor2: { x: 0, y: 0 },
  });
  assert.equal(spring2.type, 'spring');

  for (let i = 0; i < 30; i++) w2.step();
  assert.ok(Number.isFinite(bob2.x) && Number.isFinite(bob2.y));
  // Spring pulls stretched body back toward restLength = 2
  assert.ok(springBob2.y > -3, `expected spring pullback above -3, got ${springBob2.y}`);

  assert.equal(w2.remove(bob2), true);
  assert.equal(w2.removeJoint(rev2), false, 'removing body cleans up attached joint');
  assert.equal(w2.removeJoint(spring2), true);
  w2.dispose();

  // 3D Spherical + Prismatic + Fixed Joints
  const w3 = new RapierPhysicsWorld3D({ gravity: { x: 0, y: -9.81, z: 0 } });
  const root3 = new Entity({ x: 0, y: 4, z: 0 });
  const link3 = new Entity({ x: 2, y: 4, z: 0 });
  const slider3 = new Entity({ x: 0, y: 0, z: 3 });

  const bRoot3 = w3.add(root3, { type: 'fixed' });
  const bLink3 = w3.add(link3, { type: 'dynamic' });
  const bSlider3 = w3.add(slider3, { type: 'dynamic' });
  const sph3 = w3.addJoint(bRoot3, bLink3, {
    type: 'spherical',
    anchor1: { x: 0, y: 0, z: 0 },
    anchor2: { x: -2, y: 0, z: 0 },
  });
  const pris3 = w3.addJoint(bRoot3, bSlider3, {
    type: 'prismatic',
    axis: { x: 1, y: 0, z: 0 },
    limits: [-2, 2],
    motor: { targetPosition: 1.5, stiffness: 50, damping: 5 },
  });
  assert.equal(sph3.type, 'spherical');
  assert.equal(pris3.type, 'prismatic');

  for (let i = 0; i < 30; i++) w3.step();
  assert.ok(slider3.x > 0.2, `prismatic motor should drive along +X, got x=${slider3.x}`);
  assert.ok(link3.y < 4, 'gravity swings spherical pendulum downward');
  w3.dispose();
});

test('S1: 16-layer collision matrix and material combine rules control physical contacts', () => {
  const w3 = new RapierPhysicsWorld3D({ gravity: { x: 0, y: 0, z: 0 } });
  const a = new Entity({ x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1 });
  const b = new Entity({ x: 1.5, y: 0, z: 0, width: 1, height: 1, depth: 1 });

  // Disable collision between layer 1 and layer 2
  w3.setLayerCollision(1, 2, false);
  assert.equal(w3.getLayerCollision(1, 2), false);
  assert.equal(w3.getLayerCollision(2, 1), false);

  const ba = w3.add(a, { type: 'dynamic', layerIndex: 1, restitutionCombine: 'max', frictionCombine: 'min' });
  const bb = w3.add(b, { type: 'fixed', layerIndex: 2, restitution: 0.9, friction: 0.1 });
  ba.setVelocity({ x: 10, y: 0, z: 0 });

  for (let i = 0; i < 20; i++) w3.step();
  assert.ok(a.x > 2.2, `layer-disabled bodies pass right through (x=${a.x})`);

  // Reset position, enable collision between layer 1 & 2, now they collide and bounce/stop
  w3.setPosition(ba, { x: 0, y: 0, z: 0 });
  w3.setLayerCollision(1, 2, true);
  assert.equal(w3.getLayerCollision(1, 2), true);
  ba.setVelocity({ x: 10, y: 0, z: 0 });
  let entered = 0;
  w3.on('enter', () => { entered++; });
  for (let i = 0; i < 20; i++) w3.step();
  assert.ok(entered >= 1, 're-enabling layer matrix fires collision event');
  assert.ok(a.x < 1.0, `re-enabled collision blocks or bounces body (x=${a.x})`);

  // Move body B to isolated layer 5
  assert.equal(w3.setBodyLayer(bb, 5), true);
  w3.setLayerCollision(1, 5, false);
  assert.ok((w3.getLayerMask(5) & (1 << 1)) === 0);
  w3.dispose();
});

test('S1: castShape, queryOverlap, and createRagdoll work end-to-end on real Rapier 3D & 2D worlds', () => {
  const w3 = new RapierPhysicsWorld3D({ gravity: { x: 0, y: -9.81, z: 0 } });
  const targetA = new Entity({ name: 'wallA', x: 4, y: 0, z: 0, width: 1, height: 2, depth: 2 });
  const targetB = new Entity({ name: 'crateB', x: 0, y: 0, z: 3, width: 1, height: 1, depth: 1 });
  w3.add(targetA, { type: 'fixed' });
  w3.add(targetB, { type: 'fixed' });
  w3.step();

  const hit = w3.castShape({
    shape: 'capsule',
    radius: 0.3,
    halfHeight: 0.5,
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    maxToi: 20,
  });
  assert.ok(hit);
  assert.equal(hit.body.entity, targetA);
  assert.ok(hit.timeOfImpact > 2.5 && hit.timeOfImpact < 4.0);
  assert.ok(hit.normal && Math.abs(hit.normal.x + 1) < 0.25);

  const overlapHits = w3.queryOverlap({
    shape: 'cuboid',
    width: 12,
    height: 4,
    depth: 12,
    origin: { x: 2, y: 0, z: 1.5 },
  });
  assert.equal(overlapHits.length, 2);

  // Ragdoll articulation syncing to Three.Bone instances
  const bones = {
    spine: new THREE.Bone(),
    head: new THREE.Bone(),
  };
  const pelvisEnt = new Entity({ name: 'spine', x: 0, y: 6, z: 0, width: 0.6, height: 0.8, depth: 0.4 });
  const headEnt = new Entity({ name: 'head', x: 0, y: 7, z: 0, width: 0.4, height: 0.4, depth: 0.4 });
  const ragdoll = w3.createRagdoll([
    { entity: pelvisEnt, boneName: 'spine', parentIndex: -1, bodyOptions: { type: 'dynamic', shape: 'capsule' } },
    { entity: headEnt, boneName: 'head', parentIndex: 0, joint: { type: 'spherical', anchor1: { x: 0, y: 0.5, z: 0 }, anchor2: { x: 0, y: -0.3, z: 0 } } },
  ]);
  for (let i = 0; i < 15; i++) w3.step();
  const synced = ragdoll.syncToBones(bones);
  assert.equal(synced, 2);
  assert.ok(bones.spine.position.y < 6);
  assert.ok(bones.head.position.y < 7);

  ragdoll.setActive(false);
  assert.equal(ragdoll.dispose(), true);
  assert.equal(w3.bodies.length, 2);
  w3.dispose();
});
