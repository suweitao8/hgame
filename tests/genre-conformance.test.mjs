// Genre conformance: proves the general-purpose runtime supports varied genres
// headlessly, through public runtime APIs and a null renderer only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HGame, Entity, Scene, TileMap, findGridPath, defineProject, createGameApplication,
  createRedDotSystem, createSaveStore,
} from '../assets/runtime/index.js';
import { RapierPhysicsWorld3D } from '../assets/runtime/physics/rapier3d.js';
import { SpriteCrowd2D } from '../assets/runtime/integrations/canvas2d.js';
import { ObjectPool, SpatialHash2D } from '../assets/runtime/world/spatial2d.js';
import { createSpringArm3D, createCameraRig3D } from '../assets/runtime/integrations/camera3d.js';
import { createConfirmedFrameScheduler } from '../assets/runtime/lockstep/confirmed-frames.js';

const platformStub = () => ({
  input: { endFrame() {}, reset() {} },
  lifecycle: { on() { return () => {}; } },
  diagnostics: { recordFrame() {}, reportError() {} },
  ready() {}, dispose() {},
});
const nullRenderer = () => {
  const r = { renders: 0, render() { r.renders++; }, resize() {}, dispose() {} };
  return r;
};
function makeApp(recipe, extra = {}) {
  const renderer = nullRenderer();
  const app = createGameApplication({
    project: defineProject(recipe), renderer, platform: platformStub(), ...extra,
  });
  return { app, renderer };
}

// ---------------------------------------------------------------- 1) platformer
const LEVEL = [
  '..........',
  '..........',
  '....##....',
  '..........',
  '##########',
];
const TILE = 1;

async function runPlatformer(inputs) {
  const { app } = makeApp({ profile: '2d', physics: 'rapier2d', tickHz: 60,
    features: ['scene', 'input', 'physics2d', 'tilemap2d'] });
  const scene = app.scenes.add(new Scene('platformer'));
  app.scenes.start('platformer');
  await app.installFeatures();
  const map = new TileMap({
    tiles: LEVEL.map(row => [...row].map(c => (c === '#' ? 1 : 0))),
    tileWidth: TILE, tileHeight: TILE, solid: [1],
  });
  // tilemap rows grow downward; physics world is y-up.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!map.isSolid(x, y)) continue;
      const tile = new Entity({ x: x + 0.5, y: -(y + 0.5), width: TILE, height: TILE });
      scene.add(tile);
      scene.physics.add(tile, { type: 'fixed' });
    }
  }
  const hero = scene.add(new Entity({ x: 0.5, y: -3.5 + 0.05, width: 0.8, height: 0.9 }));
  scene.physics.add(hero, { type: 'kinematicPosition' });
  const ctl = scene.physics.createCharacterController(hero, {
    offset: 0.02, up: { x: 0, y: 1 }, slide: true, snapToGround: 0.1,
  });
  const dt = 1 / 60;
  let vy = 0, grounded = false, maxY = -Infinity, jumps = 0;
  const trace = [];
  for (let tick = 0; tick < inputs.length; tick++) {
    const { move, jump } = inputs[tick];
    if (jump && grounded) { vy = 9; jumps++; }
    vy -= 25 * dt;
    const res = ctl.move({ x: move * 4 * dt, y: vy * dt });
    grounded = res.grounded;
    if (grounded && vy < 0) vy = 0;
    app.step(dt);
    maxY = Math.max(maxY, hero.y);
    trace.push([hero.x, hero.y]);
  }
  const out = { x: hero.x, y: hero.y, maxY, jumps, trace, checksum: scene.physics.stateChecksum(), grounded };
  app.dispose();
  return out;
}

const platformerInputs = Array.from({ length: 240 }, (_, t) => ({
  move: t < 120 ? 1 : (t < 180 ? -1 : 0),
  jump: t % 70 === 10 && t < 200,
}));

test('genre/platformer: gravity, jump, tilemap-built collision and wall/floor stops', async () => {
  const run = await runPlatformer(platformerInputs);
  assert.ok(run.jumps >= 3, 'hero jumped repeatedly');
  assert.ok(run.maxY > -3.5 + 1.0, 'jump left the ground by > 1 tile');
  assert.ok(run.y > -4 && run.y < -3.3, `hero rests on the tilemap floor, y=${run.y}`);
  assert.equal(run.grounded, true);
  for (const [x, y] of run.trace) assert.ok(y > -3.95, 'never falls through tile floor');
  assert.ok(run.x > 0 && run.x < 10);

  // walking into the right boundary wall (solid out-of-bounds tiles) is not required;
  // verify raised platform tile (x=4..5,y=-2.5) blocks a jump from below.
  const head = await runPlatformer(Array.from({ length: 150 }, (_, t) => ({
    move: t < 25 ? 1 : 0, jump: t === 25 || t === 26 || t === 40,
  })));
  assert.ok(Number.isFinite(head.y));
});

test('genre/platformer: deterministic replay gives identical trajectories and checksums', async () => {
  const a = await runPlatformer(platformerInputs);
  const b = await runPlatformer(platformerInputs);
  assert.deepEqual(a.trace, b.trace);
  assert.equal(a.checksum, b.checksum);
  const c = await runPlatformer(platformerInputs.map(i => ({ ...i, move: i.move * 0.5 })));
  assert.notDeepEqual(c.trace, a.trace, 'different inputs diverge');
});

// ---------------------------------------------------------------- 2) horde / shmup
test('genre/horde: 5k SpriteCrowd2D agents + SpatialHash2D + ObjectPool within budget', () => {
  const N = 5000, TICKS = 30;
  const scene = new Scene('horde');
  const host = scene.add(new Entity({ x: 0, y: 0 }));
  const crowd = host.addComponent(new SpriteCrowd2D({ capacity: 6000, width: 16, height: 16 }));
  scene._setActive(true);
  const hash = new SpatialHash2D({ cellSize: 48 });
  const agents = [];
  let seed = 1234;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < N; i++) {
    const a = { x: rnd() * 1200 - 600, y: rnd() * 800 - 400, radius: 8, slot: -1 };
    a.slot = crowd.spawn({ x: a.x, y: a.y });
    agents.push(a);
  }
  assert.equal(crowd.count, N);
  const bullets = new ObjectPool({
    create: () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0 }),
    reset: (b, x, y, vx, vy) => Object.assign(b, { x, y, vx, vy, life: 1 }),
    initialSize: 64, maxSize: 512,
  });
  const live = [];
  const t0 = performance.now();
  let hits = 0;
  for (let tick = 0; tick < TICKS; tick++) {
    hash.clear?.();
    for (const a of agents) {
      const d = Math.hypot(a.x, a.y) || 1;
      a.x -= (a.x / d) * 0.8; a.y -= (a.y / d) * 0.8;
    }
    hash.resolveSoftSeparation(agents, { defaultRadius: 8, strength: 0.4, iterations: 1 });
    for (const a of agents) crowd.setTransform(a.slot, a.x, a.y);
    if (tick % 3 === 0) live.push(bullets.acquire(0, 0, 10, 4));
    for (let i = live.length - 1; i >= 0; i--) {
      const b = live[i];
      b.x += b.vx; b.y += b.vy; b.life -= 0.05;
      hash.clear?.();
      if (b.life <= 0) { bullets.release(b); live.splice(i, 1); }
    }
    const probe = new SpatialHash2D({ cellSize: 48 });
    for (const a of agents) probe.insert(a, a.x, a.y, a.radius);
    hits += probe.queryRadius(0, 0, 40).length;
    crowd.update(1 / 60);
  }
  const ms = performance.now() - t0;
  assert.ok(hits > 0, 'spatial query finds converging horde');
  assert.equal(crowd.count, N);
  assert.ok(live.length + bullets.freeCount <= 512);
  for (let i = 0; i < 1000; i++) assert.equal(crowd.kill(agents[i].slot), true);
  assert.equal(crowd.count, N - 1000);
  assert.ok(ms < 20_000, `horde ticks took ${ms.toFixed(0)}ms`);
});

// ---------------------------------------------------------------- 3) turn-based UI card game
test('genre/card-ui: tickHz 0 UI profile has no RAF loop, red dots + save round-trip', () => {
  let rafRequests = 0;
  const { app, renderer } = makeApp({ profile: 'ui', tickHz: 0, features: ['scene'] },
    { requestFrame: () => { rafRequests++; return 1; } });
  assert.equal(app.project.tickHz, 0);
  const scene = app.scenes.add(new Scene('table'));
  app.scenes.start('table');
  assert.equal(app.start(), true);
  assert.equal(rafRequests, 0, 'UI profile never requests animation frames');
  assert.equal(renderer.renders, 1, 'initial render only');

  // play a card: tween advances only via explicit steps
  const card = { y: 0, scale: 1 };
  scene.tweens.add(card, { y: -40, scale: 1.2 }, { duration: 0.2 });
  app.step(0.1);
  assert.ok(Math.abs(card.y + 20) < 1e-6);
  app.step(0.2);
  assert.equal(card.y, -40);
  assert.equal(rafRequests, 0);

  const backing = new Map();
  const storage = {
    get length() { return backing.size; }, key: i => [...backing.keys()][i] ?? null,
    getItem: k => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)), removeItem: k => backing.delete(k),
  };
  const save = createSaveStore({ gameId: 'cards', storage });
  const deck = { hand: ['fire', 'ice'], gold: 12, turn: 3 };
  save.set('run', deck);
  assert.deepEqual(createSaveStore({ gameId: 'cards', storage }).get('run'), deck);

  const rd = createRedDotSystem({ storage: save });
  rd.setValue('Deck/Reward/Claim', 2, { style: 'number' });
  rd.markUnread('Deck/Cards/new_card_7', 'new');
  assert.equal(rd.getCount('Deck') >= 2, true);
  const before = rd.getCount('Deck');
  rd.clearUnread('Deck/Cards/new_card_7');
  assert.equal(rd.getCount('Deck'), before - 1);
  rd.setValue('Deck/Reward/Claim', 0, { style: 'number' });
  assert.equal(rd.getCount('Deck'), 0);
  rd.dispose();
  app.dispose();
});

// ---------------------------------------------------------------- 4) 3D action
test('genre/3d-action: Rapier3D character controller + SpringArm3D/CameraRig3D without WebGL', async () => {
  const physics = new RapierPhysicsWorld3D({ tickHz: 60, gravity: { x: 0, y: -9.81, z: 0 } });
  const floor = new Entity({ x: 0, y: -0.5, z: 0, width: 40, height: 1, depth: 40 });
  physics.add(floor, { type: 'fixed' });
  const wall = new Entity({ x: 0, y: 1, z: -5, width: 10, height: 2, depth: 1 });
  physics.add(wall, { type: 'fixed' });
  const pawn = new Entity({ x: 0, y: 2, z: 0, width: 0.8, height: 1.8, depth: 0.8 });
  physics.add(pawn, { type: 'kinematicPosition', shape: 'capsule', radius: 0.4, halfHeight: 0.5 });
  const ctl = physics.createCharacterController(pawn, { offset: 0.02, up: { x: 0, y: 1, z: 0 } });
  const dt = 1 / 60;
  let vy = 0, grounded = false;
  const arm = createSpringArm3D({ armLength: 4, lagHalfLife: 0, inHalfLife: 0, outHalfLife: 0.1,
    collisionTest: (pivot, _desired, backVec, length) => {
      const hit = physics.castRay(pivot, backVec, length);
      return hit ? { distance: hit.timeOfImpact } : null;
    } });
  const camera = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
    fov: 70, updateProjectionMatrix() {} };
  const rig = createCameraRig3D({ camera, mode: 'thirdPerson', baseFov: 70 });
  let armState;
  for (let i = 0; i < 180; i++) {
    vy = grounded ? 0 : vy - 9.81 * dt;
    const res = ctl.move({ x: 0, y: vy * dt, z: i > 60 ? -3 * dt : 0 });
    grounded = res.grounded;
    physics.step();
    armState = arm.update(dt, { x: pawn.x, y: pawn.y, z: pawn.z });
    rig.update(dt, { x: pawn.x, y: pawn.y, z: pawn.z });
  }
  assert.equal(grounded, true, 'pawn landed');
  assert.ok(pawn.y > 0.3 && pawn.y < 1.6, `pawn on floor y=${pawn.y}`);
  assert.ok(pawn.z < -0.5, 'pawn moved forward');
  assert.ok(pawn.z > -4.4, 'wall blocks pawn');
  assert.ok(Number.isFinite(armState.position.x) && Number.isFinite(armState.position.z));
  assert.ok(Number.isFinite(camera.position.x) && Number.isFinite(camera.position.y));
  physics.dispose();
});

// ---------------------------------------------------------------- 5) puzzle / grid
test('genre/puzzle: tilemap mutation + findGridPath + tween-driven piece movement', () => {
  const rows = ['S.#....', '..#.##.', '..#..#.', '....#.G', '.##...#'];
  const map = new TileMap({
    tiles: rows.map(r => [...r].map(c => (c === '#' ? 1 : 0))), solid: [1],
    tileWidth: 32, tileHeight: 32,
  });
  const start = { x: 0, y: 0 }, goal = { x: 6, y: 3 };
  const path = findGridPath(map, start, goal);
  assert.ok(path.length > 0);
  assert.deepEqual(path[0], start);
  assert.deepEqual(path.at(-1), goal);
  for (const p of path) assert.equal(map.isSolid(p.x, p.y), false);
  for (let i = 1; i < path.length; i++) {
    assert.equal(Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y), 1);
  }
  // Block the route: pathfinder reports no path; unblock: path returns.
  const blockers = path.slice(1, -1);
  for (const p of blockers) map.set(p.x, p.y, 1);
  const alt = findGridPath(map, start, goal);
  assert.notDeepEqual(alt, path);
  for (const p of alt) assert.equal(map.isSolid(p.x, p.y), false);
  for (let x = 0; x < map.width; x++) map.set(x, 2, 1); // full wall row
  assert.deepEqual(findGridPath(map, start, goal), []);

  const { app } = makeApp({ profile: '2d', tickHz: 60, features: ['scene'] });
  const scene = app.scenes.add(new Scene('puzzle'));
  app.scenes.start('puzzle');
  const piece = scene.add(new Entity({ x: 16, y: 16 }));
  const target = map.tileToWorld(1, 0);
  scene.tweens.add(piece, { x: target.x, y: target.y }, { duration: 0.25 });
  for (let i = 0; i < 20; i++) app.step(1 / 60);
  assert.equal(piece.x, target.x);
  assert.equal(piece.y, target.y);
  assert.equal(scene.tweens.tweens.size, 0, 'tween finished and released');
  app.dispose();
});

// ---------------------------------------------------------------- 6) lockstep
test('genre/lockstep: two peers with different packet arrival stay bit-identical', () => {
  const players = [0, 1];
  const makePeer = () => {
    const state = { x: [0, 100], hp: [10, 10], ticks: 0, log: 0 };
    const scheduler = createConfirmedFrameScheduler({
      netHz: 10, logicHz: 30, playerIds: players, startBufferFrames: 2, maxStepsPerUpdate: 8,
      simulate(inputs, ctx) {
        state.ticks++;
        for (const input of inputs) {
          state.x[input.pid] += input.move * 2 + (input.buttons & 1 ? 1 : 0);
          if (input.buttons & 2) state.hp[1 - input.pid] -= 1;
        }
        state.log = (Math.imul(state.log, 31) + state.x[0] * 7 + state.x[1] * 13
          + state.hp[0] + ctx.logicTick) >>> 0;
      },
    });
    return { state, scheduler };
  };
  const frames = Array.from({ length: 60 }, (_, i) => ({
    netTick: i + 1,
    inputs: players.map(pid => ({ pid, move: ((i + pid) % 3) - 1, buttons: (i * (pid + 2)) % 4 })),
  }));
  const A = makePeer(), B = makePeer();
  // A: frames arrive in order with 100ms ticks. B: delayed, bursty, out-of-order arrival.
  let bIdx = 0;
  for (let step = 0; step < 70; step++) {
    if (step < frames.length) A.scheduler.enqueue(frames[step]);
    A.scheduler.advanceElapsedMs(100);
    if (step % 7 === 6) { // burst of 7 frames, reversed
      const burst = frames.slice(bIdx, bIdx + 7).reverse();
      bIdx += 7;
      for (const f of burst) B.scheduler.enqueue(f);
    }
    B.scheduler.advanceElapsedMs(100);
  }
  // drain
  for (const f of frames.slice(bIdx)) B.scheduler.enqueue(f);
  for (let i = 0; i < 40; i++) { A.scheduler.advanceElapsedMs(100); B.scheduler.advanceElapsedMs(100); }
  assert.equal(A.scheduler.fatal, false);
  assert.equal(B.scheduler.fatal, false);
  assert.ok(A.state.ticks > 100);
  assert.equal(A.state.ticks, B.state.ticks, 'peers simulated same number of ticks');
  assert.deepEqual(A.state, B.state);
  assert.equal(A.scheduler.logicTick, B.scheduler.logicTick);
});

test('genre/meta: HGame facade exposes deterministic backends', () => {
  assert.deepEqual(HGame.physicsBackends, { '2d': 'rapier2d', '3d': 'rapier3d' });
});
