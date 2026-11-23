import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { Entity } from '../assets/runtime/core/entity.js';
import { RapierPhysicsWorld3D } from '../assets/runtime/physics/rapier3d.js';
import { RapierPhysicsWorld2D } from '../assets/runtime/physics/rapier2d.js';
import { createPhysicsKernel } from '../assets/runtime/physics/physics-worker-kernel.js';
import { createWorkerPhysicsWorld } from '../assets/runtime/physics/worker-physics.js';

function makeBodiesSpec(count = 20) {
  const specs = [];
  for (let i = 0; i < count; i++) {
    const isFloor = i === 0;
    specs.push({
      x: isFloor ? 0 : (i % 5) * 1.2 - 2.4,
      y: isFloor ? -2 : 2 + Math.floor(i / 5) * 1.5,
      z: isFloor ? 0 : ((i * 3) % 4) * 1.1 - 1.5,
      width: isFloor ? 40 : 0.8,
      height: isFloor ? 1 : 0.8,
      depth: isFloor ? 40 : 0.8,
      options: isFloor
        ? { type: 'fixed', shape: 'cuboid', restitution: 0.4, friction: 0.6 }
        : { type: 'dynamic', shape: i % 2 === 0 ? 'cuboid' : 'ball', radius: 0.4, restitution: 0.35, friction: 0.5 },
      initVel: isFloor ? null : { x: ((i % 3) - 1) * 0.8, y: 0, z: ((i % 2) ? 0.5 : -0.5) },
    });
  }
  return specs;
}

test('three-way determinism: direct Rapier3D, inline worker-physics, and MessageChannel worker match checksum over 300 steps with 20 bodies', async () => {
  const specs = makeBodiesSpec(20);
  const steps = 300;
  const dt = 1 / 60;

  // 1. Direct RapierPhysicsWorld3D
  const directWorld = new RapierPhysicsWorld3D({ tickHz: 60, gravity: { x: 0, y: -9.81, z: 0 } });
  const directEntities = specs.map((s) => {
    const e = new Entity({ x: s.x, y: s.y, z: s.z, width: s.width, height: s.height, depth: s.depth });
    directWorld.add(e, s.options);
    if (s.initVel) directWorld.setVelocity(e, s.initVel);
    return e;
  });
  for (let t = 0; t < steps; t++) {
    if (t === 120) directWorld.setVelocity(directEntities[3], { x: 2.5, y: 4.0, z: -1.0 });
    directWorld.step(dt);
  }
  const directChecksum = directWorld.stateChecksum();

  // 2. Inline WorkerPhysicsWorld
  const inlineWorld = createWorkerPhysicsWorld({
    dimension: 3,
    tickHz: 60,
    gravity: { x: 0, y: -9.81, z: 0 },
    worker: 'inline',
    WorldClass: RapierPhysicsWorld3D,
  });
  assert.equal(inlineWorld.mode, 'inline');
  const inlineEntities = specs.map((s) => {
    const e = new Entity({ x: s.x, y: s.y, z: s.z, width: s.width, height: s.height, depth: s.depth });
    inlineWorld.add(e, s.options);
    if (s.initVel) inlineWorld.setVelocity(e, s.initVel);
    return e;
  });
  for (let t = 0; t < steps; t++) {
    if (t === 120) inlineWorld.setVelocity(inlineEntities[3], { x: 2.5, y: 4.0, z: -1.0 });
    inlineWorld.step(dt);
  }
  const inlineChecksum = await inlineWorld.stateChecksum();

  // 3. MessageChannel-simulated Worker
  const { port1, port2 } = new MessageChannel();
  let kernel = null;
  port2.on('message', (msg) => {
    if (msg.type === 'init') {
      kernel = createPhysicsKernel(RapierPhysicsWorld3D, { tickHz: msg.tickHz, gravity: msg.gravity });
      port2.postMessage({ type: 'init', requestId: msg.requestId, ok: true });
      return;
    }
    const reply = kernel.handle(msg);
    const transfers = [];
    if (reply.transforms) transfers.push(reply.transforms.buffer);
    if (reply.ids) transfers.push(reply.ids.buffer);
    if (reply.step) {
      transfers.push(reply.step.transforms.buffer, reply.step.ids.buffer);
    }
    port2.postMessage(reply, transfers);
  });

  const channelWorld = createWorkerPhysicsWorld({
    dimension: 3,
    tickHz: 60,
    gravity: { x: 0, y: -9.81, z: 0 },
    worker: port1,
  });
  assert.equal(channelWorld.mode, 'worker');
  const channelEntities = specs.map((s) => {
    const e = new Entity({ x: s.x, y: s.y, z: s.z, width: s.width, height: s.height, depth: s.depth });
    channelWorld.add(e, s.options);
    if (s.initVel) channelWorld.setVelocity(e, s.initVel);
    return e;
  });
  for (let t = 0; t < steps; t++) {
    if (t === 120) channelWorld.setVelocity(channelEntities[3], { x: 2.5, y: 4.0, z: -1.0 });
    channelWorld.step(dt);
  }
  const workerChecksum = await channelWorld.stateChecksum();

  assert.equal(inlineChecksum, directChecksum);
  assert.equal(workerChecksum, directChecksum);
  assert.ok(Math.abs(channelEntities[1].y - directEntities[1].y) < 1e-4);

  directWorld.dispose();
  inlineWorld.dispose();
  channelWorld.dispose();
  port1.close();
  port2.close();
});

test('worker-physics supports interpolation, remove, fallbackReason, and 2D mode', async () => {
  const autoFallback = createWorkerPhysicsWorld({
    dimension: 2,
    tickHz: 60,
    gravity: { x: 0, y: -10 },
    worker: 'auto',
    WorkerCtor: class BrokenWorker {
      constructor() {
        throw new Error('CSP blocked module worker');
      }
    },
    WorldClass: null,
  });
  assert.equal(autoFallback.mode, 'inline');
  assert.match(autoFallback.fallbackReason, /CSP blocked/);

  const box = new Entity({ x: 0, y: 5, width: 1, height: 1 });
  const box2 = new Entity({ x: 3, y: 5, width: 1, height: 1 });
  autoFallback.add(box, { type: 'dynamic', shape: 'cuboid' });
  autoFallback.add(box2, { type: 'dynamic', shape: 'cuboid' });

  await autoFallback.flush();
  for (let i = 0; i < 10; i++) autoFallback.step(1 / 60);
  await autoFallback.flush();

  const interp0 = autoFallback.getInterpolated(box, 0);
  const interpHalf = autoFallback.getInterpolated(box, 0.5);
  const interp1 = autoFallback.getInterpolated(box, 1);
  assert.ok(interpHalf.y <= interp0.y && interpHalf.y >= interp1.y);
  assert.ok(Math.abs(interpHalf.y - (interp0.y + interp1.y) * 0.5) < 1e-5);

  assert.equal(autoFallback.remove(box2), true);
  assert.equal(autoFallback.remove(box2), false);

  // Verify 2D checksum matches direct RapierPhysicsWorld2D
  const direct2d = new RapierPhysicsWorld2D({ tickHz: 60, gravity: { x: 0, y: -10 } });
  const dBox = new Entity({ x: 0, y: 5, width: 1, height: 1 });
  const dBox2 = new Entity({ x: 3, y: 5, width: 1, height: 1 });
  direct2d.add(dBox, { type: 'dynamic', shape: 'cuboid' });
  direct2d.add(dBox2, { type: 'dynamic', shape: 'cuboid' });
  for (let i = 0; i < 10; i++) direct2d.step(1 / 60);
  direct2d.remove(dBox2);

  assert.equal(await autoFallback.stateChecksum(), direct2d.stateChecksum());

  direct2d.dispose();
  assert.equal(autoFallback.dispose(), true);
  assert.equal(autoFallback.dispose(), false);
  assert.throws(() => autoFallback.step(1 / 60), /disposed/);
});
