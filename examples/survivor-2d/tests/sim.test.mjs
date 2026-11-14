import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntime } from './helpers.mjs';
import { createSurvivorSim } from '../src/sim/survivor.js';
import { runScript } from '../src/sim/script.js';
import { recordRun, loadBest } from '../src/meta.js';

const { SpatialHash2D, createSaveStore } = await loadRuntime('index.js').then(m => ({ SpatialHash2D: m.SpatialHash2D, createSaveStore: m.createSaveStore }));
const make = (opts = {}) => createSurvivorSim({ SpatialHash2D, seed: 42, ...opts });

function memoryStorage() {
  const m = new Map();
  return { get length() { return m.size; }, key: i => [...m.keys()][i] ?? null, getItem: k => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

test('60s scripted run is bit-identical across runs and differs by seed', () => {
  const a = runScript(make({ godMode: true }), 60);
  const b = runScript(make({ godMode: true }), 60);
  assert.equal(a, b);
  assert.notEqual(a, runScript(make({ godMode: true, seed: 43 }), 60));
  const c = runScript(make(), 60), d = runScript(make(), 60);
  assert.equal(c, d);
});

test('horde scales past 3000 enemies while staying within the tick budget', () => {
  const sim = make({ godMode: true });
  sim.prefill(3000);
  assert.equal(sim.en.count, 3000);
  const t0 = performance.now();
  runScript(sim, 5);
  const msPerTick = (performance.now() - t0) / 300;
  assert.ok(sim.en.count >= 1000, `horde collapsed: ${sim.en.count}`);
  assert.ok(sim.state.kills > 0 && sim.player.level > 1, 'auto-attack and XP flow work');
  assert.ok(msPerTick < 8, `sim tick too slow: ${msPerTick.toFixed(2)}ms`);
});

test('auto-attack kills enemies, drops XP gems and levels up with a paused choice', () => {
  const sim = make({ godMode: true });
  sim.prefill(200, 150);
  const input = { x: 0, y: 0, choice: -1 };
  let paused = false;
  for (let i = 0; i < 1800 && !paused; i++) { sim.step(1 / 60, input); paused = Boolean(sim.state.pending); }
  assert.ok(paused, 'a level-up must be offered');
  assert.equal(sim.state.pending.length, 3);
  const tick = sim.state.tick;
  sim.step(1 / 60, input);
  assert.equal(sim.state.tick, tick, 'simulation is frozen while choosing');
  const pick = sim.state.pending[1];
  sim.step(1 / 60, { choice: 1 });
  assert.equal(sim.state.pending, null);
  assert.equal(sim.levels[pick], 1);
});

test('idle player is overrun and the sim stops', () => {
  const sim = make();
  sim.prefill(1500, 120);
  for (let i = 0; i < 3600 && !sim.state.over; i++) sim.step(1 / 60, { choice: 0 });
  assert.equal(sim.state.over, true);
  assert.equal(sim.player.hp, 0);
  const tick = sim.state.tick;
  sim.step(1 / 60, {});
  assert.equal(sim.state.tick, tick);
});

test('enemy and gem slots are recycled (no unbounded growth)', () => {
  const sim = make({ godMode: true });
  runScript(sim, 30);
  assert.ok(sim.en.hw <= sim.config.maxEnemies && sim.gm.hw <= sim.config.maxGems && sim.bl.hw <= sim.config.maxBullets);
  assert.equal(sim.en.count, [...sim.en.alive.subarray(0, sim.en.hw)].filter(Boolean).length);
});

test('best-run save store keeps maxima and counts runs', () => {
  const store = createSaveStore({ gameId: 'survivor-2d', storage: memoryStorage() });
  assert.equal(loadBest(store).runs, 0);
  assert.equal(recordRun(store, { time: 30, kills: 100, level: 5 }).record, true);
  const r = recordRun(store, { time: 20, kills: 50, level: 9 });
  assert.equal(r.record, false);
  assert.deepEqual(loadBest(store), { time: 30, kills: 100, level: 9, runs: 2 });
});
