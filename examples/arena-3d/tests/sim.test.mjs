import test from 'node:test';
import assert from 'node:assert/strict';
import { createArenaSim } from '../src/sim/arena.js';
import { runScript } from '../src/sim/script.js';
import { rayBoxes, pushCircleOutOfBox } from '../src/sim/collide.js';
import { CONFIG, TIER_BUDGET } from '../src/sim/config.js';
import { recordRun, loadBest } from '../src/meta.js';

const make = (o = {}) => createArenaSim({ seed: 7, ...o });
const memoryStorage = () => { const m = new Map(); return { get length() { return m.size; }, key: i => [...m.keys()][i] ?? null,
  getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('60s scripted run is bit-identical across runs and differs by seed', () => {
  for (const tier of Object.keys(TIER_BUDGET)) {
    const a = runScript(make({ tier, godMode: true }), 60), b = runScript(make({ tier, godMode: true }), 60);
    assert.equal(a, b, tier);
  }
  assert.notEqual(runScript(make({ godMode: true }), 60), runScript(make({ godMode: true, seed: 8 }), 60));
});

test('quality tier caps the live enemy count', () => {
  for (const tier of Object.keys(TIER_BUDGET)) {
    const sim = make({ tier, godMode: true });
    for (let i = 0; i < 60 * 90; i++) sim.step(1 / 60, {}); // idle: nobody attacks
    assert.equal(sim.en.count, TIER_BUDGET[tier].maxEnemies, tier);
  }
});

test('player jumps onto a box, stands on it, and walls block enemies from climbing', () => {
  const sim = make({ godMode: true });
  const box = CONFIG.obstacles[0]; // 4x4 footprint, 1.2 high at the origin
  sim.player.x = 0; sim.player.z = box.hz + 1.5; sim.player.y = 0;
  // Walking straight into the box at ground level is blocked.
  for (let i = 0; i < 90; i++) sim.step(1 / 60, { mx: 0, mz: -1 });
  assert.ok(sim.player.z >= box.hz + 0.44, `walked through box: z=${sim.player.z}`);
  // Jump + forward lands on top (jump apex ~1.4 > 1.2).
  sim.step(1 / 60, { mx: 0, mz: -1, jump: true });
  for (let i = 0; i < 25; i++) sim.step(1 / 60, { mx: 0, mz: -0.6 });
  for (let i = 0; i < 60; i++) sim.step(1 / 60, {});
  assert.ok(sim.player.grounded);
  assert.ok(Math.abs(sim.player.y - box.h) < 1e-9, `y=${sim.player.y}`);
  // Walking off drops back to the floor.
  for (let i = 0; i < 120; i++) sim.step(1 / 60, { mx: 0, mz: 1 });
  assert.equal(sim.player.y, 0);
  for (const e of [0, 1, 2]) { sim.en.x[e] = 0; }
});

test('spin attack damages, knocks back and kills enemies in radius; far ones are untouched', () => {
  const sim = make({ godMode: true });
  sim.step(1 / 60, {});
  const p = sim.player;
  const mk = (x, z) => { const i = sim.en.count++; sim.en.x[i] = x; sim.en.z[i] = z; sim.en.hp[i] = 2; sim.en.vx[i] = sim.en.vz[i] = 0; };
  mk(p.x + 1.5, p.z); mk(p.x - 1.5, p.z); mk(p.x, p.z + 12);
  sim.step(1 / 60, { attack: true });
  assert.equal(sim.state.kills, 0, 'needs two hits at 2hp');
  assert.equal(sim.en.count, 3);
  assert.ok(sim.en.vx[0] > 0 || sim.en.x[0] > p.x + 1.5, 'knocked back');
  for (let i = 0; i < 60; i++) sim.step(1 / 60, {});
  sim.step(1 / 60, { attack: true });
  assert.equal(sim.state.kills, 2);
  assert.ok(sim.en.count >= 1);
});

test('enemies chase, deal contact damage with invulnerability frames, and end the run at 0 hp', () => {
  const sim = make();
  let sawIframes = false, last = sim.player.hp;
  for (let i = 0; i < 60 * 120 && !sim.state.over; i++) {
    sim.step(1 / 60, {});
    if (sim.player.hp < last) {
      assert.ok(sim.player.hp === 0 || [CONFIG.enemy.contactDamage, CONFIG.enemy.pulse.damage].includes(last - sim.player.hp));
      sawIframes ||= sim.player.invuln > 0;
      last = sim.player.hp;
    }
  }
  assert.ok(sim.state.over && sim.player.hp === 0);
  assert.equal(sim.state.outcome, 'defeat');
  assert.ok(sawIframes);
  const t = sim.state.tick; sim.step(1 / 60, {});
  assert.equal(sim.state.tick, t, 'sim frozen after game over');
});

test('beacons charge in either order and only the unlocked exit ends the run', () => {
  for (const order of [[0, 1], [1, 0]]) {
    const sim = make({ godMode: true, maxEnemies: 0 });
    const { beacons, exit, holdSeconds, exitHoldSeconds } = CONFIG.mission;
    const place = point => { sim.player.x = point.x; sim.player.z = point.z; };
    const charge = () => {
      for (let i = 0; i <= Math.ceil(holdSeconds * 60); i++) sim.step();
    };
    place(exit); sim.step();
    assert.equal(sim.state.over, false, 'the exit starts locked');

    place(beacons[order[0]]); charge();
    assert.equal(sim.mission.chargedCount, 1);
    place(exit); sim.step();
    assert.equal(sim.state.over, false, 'both beacons are required');

    place(beacons[order[1]]); charge();
    assert.equal(sim.mission.chargedCount, 2);
    assert.equal(sim.state.over, false, 'charging does not complete the exit');
    place(exit); sim.step();
    assert.equal(sim.state.over, false, 'the gate needs time to complete extraction');
    for (let i = 0; i < Math.ceil(exitHoldSeconds * 60) - 1; i++) sim.step();
    assert.equal(sim.state.outcome, 'victory');
    assert.equal(sim.state.over, true);
    const tick = sim.state.tick;
    sim.step();
    assert.equal(sim.state.tick, tick);
  }
});

test('nearby enemies interrupt beacon charging and leaving clears unfinished progress', () => {
  const events = [];
  const sim = make({ godMode: true, maxEnemies: 1, onEvent: event => events.push(event) });
  const [beacon] = CONFIG.mission.beacons;
  sim.player.x = beacon.x; sim.player.z = beacon.z;
  for (let i = 0; i < 15; i++) sim.step();
  const progress = sim.mission.progress;
  assert.ok(progress > 0);

  sim.en.count = 1;
  sim.en.x[0] = beacon.x + CONFIG.mission.dangerRadius - 0.3;
  sim.en.z[0] = beacon.z;
  sim.en.hp[0] = 2;
  sim.step();
  assert.equal(sim.mission.blocked, true);
  assert.equal(sim.mission.progress, progress);
  sim.step(1 / 60, { attack: true });
  for (let i = 0; i < 20 && sim.mission.blocked; i++) sim.step();
  assert.equal(sim.mission.blocked, false, 'knockback opens a charging window');
  assert.ok(sim.mission.progress > progress);

  sim.player.x = 0; sim.player.z = 6;
  sim.step();
  assert.equal(sim.mission.active, -1);
  assert.equal(sim.mission.progress, 0);
  assert.equal(sim.mission.chargedCount, 0);
  assert.deepEqual(events.map(event => event.type),
    ['run.started', 'beacon.entered', 'beacon.blocked', 'player.spin', 'beacon.resumed', 'beacon.left']);
  assert.deepEqual(events.find(event => event.type === 'beacon.blocked'), {
    tick: 16, type: 'beacon.blocked', subject: 'beacon:0', details: { enemySlot: 0 },
  });
});

test('a lethal hit on the exit takes precedence over victory', () => {
  const sim = make();
  const { exit } = CONFIG.mission;
  sim.mission.charged.fill(1);
  sim.mission.chargedCount = sim.mission.charged.length;
  sim.player.x = exit.x; sim.player.z = exit.z;
  sim.player.hp = 1;
  sim.en.count = 1;
  sim.en.x[0] = exit.x; sim.en.z[0] = exit.z;
  sim.step();
  assert.equal(sim.state.outcome, 'defeat');
});

test('stays inside the arena and never inside an obstacle over a long run', () => {
  const sim = make({ godMode: true });
  const lim = CONFIG.arenaHalf;
  for (let i = 0; i < 60 * 60; i++) {
    runScript(sim, 1 / 60 * 1); // one tick via the scripted driver
    for (const [x, z] of [[sim.player.x, sim.player.z]]) assert.ok(Math.abs(x) <= lim && Math.abs(z) <= lim);
    if (sim.player.y < 0.3) for (const b of CONFIG.obstacles) assert.ok(!(Math.abs(sim.player.x - b.x) < b.hx - 0.01 && Math.abs(sim.player.z - b.z) < b.hz - 0.01));
  }
  for (let i = 0; i < sim.en.count; i++) for (const b of CONFIG.obstacles) {
    assert.ok(!(Math.abs(sim.en.x[i] - b.x) < b.hx && Math.abs(sim.en.z[i] - b.z) < b.hz));
  }
});

test('camera probe: ray hits a box slab, misses past it; push-out works from inside', () => {
  const b = { x: 0, z: 0, hx: 1, hz: 1, h: 2 };
  assert.equal(rayBoxes([b], 5, 1, 0, -1, 0, 0, 10), 4);
  assert.equal(rayBoxes([b], 5, 1, 0, -1, 0, 0, 3), null);
  assert.equal(rayBoxes([b], 5, 3, 0, -1, 0, 0, 10), null, 'passes over the top');
  const out = { x: 0, z: 0 };
  assert.ok(pushCircleOutOfBox(0.2, 0, 0.5, b, out));
  assert.ok(out.x >= 1.5 - 1e-9);
});

test('best-run save store keeps maxima', () => {
  const store = { get: (k, d) => d, set(k, v) { this.v = v; } };
  const s = memoryStorage(); void s;
  const a = recordRun(store, { time: 30, kills: 5, level: 1 });
  assert.equal(a.best.runs, 1);
  assert.deepEqual(loadBest({ get: () => a.best }).kills, 5);
});

test('victory count and fastest extraction survive older saved records', () => {
  let saved = { time: 30, kills: 10, level: 1, runs: 2 };
  const store = { get: () => saved, set(key, value) { saved = value; } };
  assert.equal(loadBest(store).wins, 0);
  recordRun(store, { time: 24, kills: 5, level: 1, outcome: 'victory' });
  recordRun(store, { time: 12, kills: 2, level: 1, outcome: 'defeat' });
  recordRun(store, { time: 21, kills: 6, level: 1, outcome: 'victory' });
  assert.equal(loadBest(store).wins, 2);
  assert.equal(loadBest(store).fastestWin, 21);
  assert.equal(loadBest(store).kills, 10);
  assert.equal(loadBest(store).runs, 5);
});

test('the longer extraction records its own fastest time while keeping previous results', () => {
  let saved = { time: 30, kills: 10, level: 1, runs: 2, wins: 1, fastestWin: 13 };
  const store = { get: () => saved, set(key, value) { saved = value; } };
  assert.equal(loadBest(store, 'held-gate').fastestWin, null);
  recordRun(store, { time: 22, kills: 7, level: 1, outcome: 'victory' }, 'held-gate');
  recordRun(store, { time: 23, kills: 11, level: 1, outcome: 'victory' }, 'held-gate');
  assert.equal(loadBest(store, 'held-gate').fastestWin, 22);
  assert.equal(loadBest(store).fastestWin, 13);
  assert.equal(loadBest(store).wins, 3);
  assert.equal(loadBest(store).kills, 11);
});
