// Evidence for scorecard P1: worker-offloaded CPU simulation with non-isolated (inline) fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimWorkerRunner } from '../assets/runtime/sim/worker-sim.js';
import { createFlowField2D, createFlatSpatialHash2D, SWARM_UNIT_FLAGS } from '../assets/runtime/world/swarm-ecs.js';
import { createWorkerPhysicsWorld } from '../assets/runtime/physics/worker-physics.js';
import { Entity } from '../assets/runtime/core/entity.js';
import { RapierPhysicsWorld3D } from '../assets/runtime/physics/rapier3d.js';

function flowPayload() {
  const cols = 8, rows = 8;
  const cost = new Uint8Array(cols * rows).fill(1);
  for (let y = 0; y < 6; y++) cost[y * cols + 4] = 255; // wall with gap at the bottom
  return { cols, rows, cost, goalX: 7, goalY: 0 };
}

test('P1 worker-sim: without Worker the runner falls back to main-thread and commits deterministically in (tick, priority, id) order', () => {
  const order = [];
  const runner = createSimWorkerRunner({ onCommit: r => order.push(r.id) });
  assert.equal(runner.mode, 'main-thread');
  const a = runner.submit('batch-eval', { items: [1, 2] }, { tick: 1, priority: 0 });
  const b = runner.submit('batch-eval', { items: [3] }, { tick: 1, priority: 5 });
  const c = runner.submit('batch-eval', { items: [4] }, { tick: 0, priority: 0 });
  const late = runner.submit('batch-eval', { items: [9] }, { tick: 5 });
  assert.equal(runner.flushTick(0).length, 1);
  const committed = runner.flushTick(1);
  assert.deepEqual(committed.map(r => r.id), [b.id, a.id]); // higher priority first within a tick
  assert.deepEqual(order, [c.id, b.id, a.id]);
  assert.deepEqual(committed[1].value, [2, 4]);
  assert.equal(late.state, 'queued'); // future tick job is not run early
  assert.equal(runner.flushTick(5).length, 1);
  assert.equal(late.state, 'completed');
  runner.dispose();
});

test('P1 worker-sim: flow-field kernel via runner routes around walls and is bit-identical across runs', () => {
  const run = () => {
    const r = createSimWorkerRunner();
    r.submit('flow-field', flowPayload());
    const [res] = r.flushTick(0);
    r.dispose();
    return res;
  };
  const r1 = run();
  const r2 = run();
  assert.equal(r1.status, 'completed');
  assert.deepEqual(Array.from(r1.value.dirX), Array.from(r2.value.dirX));
  assert.deepEqual(Array.from(r1.value.dirY), Array.from(r2.value.dirY));
  // cell (0,0) is left of the wall: it must head toward the +x/+y gap, not stand still
  const { dirX, dirY } = r1.value;
  assert.ok(Math.hypot(dirX[0], dirY[0]) > 0.99);
  // the cell just left of the wall at the top (3,0) cannot go straight through: it must step down (+y)
  assert.ok(dirY[3] > 0 || dirX[3] <= 0);
  // goal itself has zero direction
  assert.equal(dirX[7], 0);
  assert.equal(dirY[7], 0);
});

test('P1 worker-sim: injected worker pool is used, results are staged until flushTick, cancel/unknown kernel/backpressure handled', () => {
  const posted = [];
  const fakeWorker = { postMessage: m => posted.push(m), addEventListener(t, fn) { this.fn = fn; }, terminate() { this.dead = true; } };
  const runner = createSimWorkerRunner({ workerFactory: () => fakeWorker, maxPending: 2 });
  assert.equal(runner.mode, 'worker');
  const j1 = runner.submit('x', { v: 1 }, { tick: 0 });
  const j2 = runner.submit('x', { v: 2 }, { tick: 3 });
  assert.equal(runner.submit('x', {}), null); // maxPending reached
  assert.equal(runner.getStats().rejected, 1);
  assert.equal(posted.length, 2);
  fakeWorker.fn({ data: { id: j1.id, ok: true, result: 42 } });
  fakeWorker.fn({ data: { id: j2.id, ok: true, result: 43 } });
  assert.equal(j1.state, 'staged'); // staged, not committed until its tick flush
  assert.equal(runner.flushTick(-1).length, 0);
  assert.deepEqual(runner.flushTick(0).map(r => r.value), [42]);
  assert.equal(j2.state, 'staged');
  assert.deepEqual(runner.flushTick(3).map(r => r.value), [43]);
  runner.dispose();
  assert.equal(fakeWorker.dead, true);

  const r2 = createSimWorkerRunner();
  r2.submit('nope', {});
  const [fail] = r2.flushTick(0);
  assert.equal(fail.status, 'failed');
  assert.match(fail.error.message, /Unknown simulation worker kernel/);
  const cancelled = r2.submit('batch-eval', { items: [1] });
  assert.equal(cancelled.cancel(), true);
  assert.equal(r2.flushTick(0).length, 0);
  r2.dispose();
});

test('P1 swarm-ecs: flow field routes around obstacles, spatial hash finds neighbours', () => {
  const ff = createFlowField2D({ cols: 8, rows: 8, cellSize: 1, originX: 0, originY: 0 });
  for (let y = 0; y < 6; y++) ff.setCost(4, y, 255);
  ff.compute([{ x: 7.5, y: 0.5 }]);
  const out = ff.sample(1.5, 0.5);
  assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y));
  assert.ok(Math.hypot(out.x, out.y) > 0.5);
  // walking the field from (0.5, 0.5) must reach the goal without entering a wall
  let x = 0.5, y = 0.5;
  for (let i = 0; i < 80; i++) {
    const d = ff.sample(x, y);
    x += d.x * 0.5; y += d.y * 0.5;
    const cx = Math.floor(x), cy = Math.floor(y);
    assert.notEqual(ff.cost[cy * 8 + cx], 255, 'path entered a wall');
  }
  assert.ok(Math.hypot(x - 7.5, y - 0.5) < 1.5);

  const hash = createFlatSpatialHash2D({ cols: 10, rows: 10, cellSize: 1, originX: 0, originY: 0, capacity: 16 });
  const px = new Float32Array([1, 1.4, 8, 1.2]);
  const py = new Float32Array([1, 1.1, 8, 5]);
  const flags = new Uint8Array(4).fill(SWARM_UNIT_FLAGS.ALIVE);
  hash.rebuildFromArrays(flags, px, py, 4);
  const ids = new Int32Array(8);
  const n = hash.queryRadiusIds(1, 1, 1, ids, 8, px, py, 0);
  assert.deepEqual(Array.from(ids.slice(0, n)).sort(), [1]);
  assert.equal(hash.insert(99, 0, 0), -1);
});

test('P1 worker-physics: inline fallback is explicit, and two inline worlds yield identical checksums', async () => {
  const auto = createWorkerPhysicsWorld({ dimension: 3, WorldClass: RapierPhysicsWorld3D, WorkerCtor: null });
  assert.equal(auto.mode, 'inline');
  assert.ok(auto.fallbackReason);
  assert.throws(() => createWorkerPhysicsWorld({ tickHz: 0 }), RangeError);
  auto.dispose();

  const sim = async () => {
    const w = createWorkerPhysicsWorld({ dimension: 3, worker: 'inline', WorldClass: RapierPhysicsWorld3D, gravity: { x: 0, y: -9.81, z: 0 } });
    const floor = new Entity({ x: 0, y: -2, z: 0, width: 20, height: 1, depth: 20 });
    w.add(floor, { type: 'fixed', shape: 'cuboid' });
    const ball = new Entity({ x: 0, y: 3, z: 0, width: 0.8, height: 0.8, depth: 0.8 });
    w.add(ball, { type: 'dynamic', shape: 'ball', radius: 0.4, restitution: 0.3 });
    w.setVelocity(ball, { x: 1, y: 0, z: 0.5 });
    for (let i = 0; i < 120; i++) w.step(1 / 60);
    const sum = await w.stateChecksum();
    const y = ball.y;
    w.dispose();
    return { sum, y, x: ball.x };
  };
  const a = await sim();
  const b = await sim();
  assert.equal(a.sum, b.sum);
  assert.ok(a.y < 3 && a.y > -2, 'ball fell and rests above floor');
  assert.ok(a.x > 0.5, 'horizontal velocity advanced entity');
});
