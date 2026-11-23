import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntime } from './helpers.mjs';
import { CONFIG } from '../src/sim/config.js';
import { createSurvivorSim } from '../src/sim/survivor.js';

const { SpatialHash2D } = await loadRuntime('world/spatial2d.js');
const dt = 1 / 60;
const extraction = { unlockSeconds: 1, holdSeconds: 0.5, radius: 45 };

function createSim(objective = extraction) {
  return createSurvivorSim({ SpatialHash2D, seed: 42, config: {
    ...CONFIG,
    spawn: { ...CONFIG.spawn, base: 0, perSecond: 0 },
    extraction: objective,
  } });
}

function ticks(sim, count, input) {
  for (let i = 0; i < count; i++) sim.step(dt, input);
}

test('extraction opens after surviving and keeps earned progress when leaving its ring', () => {
  const sim = createSim();
  ticks(sim, 30, { x: 1 });
  assert.equal(sim.extraction.open, false);
  ticks(sim, 30);
  assert.equal(sim.extraction.open, true);
  assert.equal(sim.extraction.progress, 0);
  assert.equal(sim.state.over, false);

  Object.assign(sim.player, { x: 0, y: 0 });
  ticks(sim, 10);
  assert.ok(sim.extraction.progress > 0);
  const progress = sim.extraction.progress;
  ticks(sim, 40, { x: 1 });
  assert.ok(sim.extraction.progress > progress);
  assert.equal(sim.state.over, false);
  const away = sim.extraction.progress;
  ticks(sim, 20);
  assert.equal(sim.extraction.progress, away);

  Object.assign(sim.player, { x: 0, y: 0 });
  ticks(sim, 30);
  assert.equal(sim.summary().outcome, 'victory');
  assert.equal(sim.extraction.progress, extraction.holdSeconds);
  const tick = sim.state.tick;
  ticks(sim, 30);
  assert.equal(sim.state.tick, tick);
});

test('upgrades freeze the extraction and lethal contact wins a same-tick tie', () => {
  const sim = createSim();
  ticks(sim, 88);
  assert.equal(sim.state.over, false);
  sim.state.pending = ['speed'];
  const progress = sim.extraction.progress;
  ticks(sim, 60);
  assert.equal(sim.extraction.progress, progress);
  sim.step(dt, { choice: 0 });
  assert.equal(sim.extraction.progress, progress);

  sim.prefill(1);
  sim.en.x[0] = sim.player.x;
  sim.en.y[0] = sim.player.y;
  sim.weapon.boltCd = 2;
  sim.weapon.novaCd = 2;
  sim.player.hp = 0.001;
  sim.step(dt);
  assert.equal(sim.summary().outcome, 'defeat');
  assert.equal(sim.extraction.progress, progress);
});

test('either relay unlocks extraction after the timer, while staying at spawn cannot win', () => {
  const relays = [{ x: -220, y: 0 }, { x: 220, y: 0 }];
  const objective = { ...extraction, relays, relayRadius: 25 };
  const idle = createSim(objective);
  ticks(idle, 180);
  assert.equal(idle.extraction.open, false);
  assert.equal(idle.extraction.relay, null);
  for (const [index, relay] of relays.entries()) {
    const sim = createSim(objective);
    Object.assign(sim.player, relay);
    sim.step(dt);
    assert.equal(sim.extraction.relay, index);
    assert.equal(sim.extraction.open, false);
    Object.assign(sim.player, { x: 0, y: 0 });
    ticks(sim, 100);
    assert.equal(sim.summary().outcome, 'victory');
  }
});

test('a storm requires both relays and has a fixed deadline', () => {
  const relays = [{ x: -220, y: 0 }, { x: 220, y: 0 }];
  const objective = { ...extraction, relays, relayRadius: 25, requiredRelays: 2, deadlineSeconds: 3 };
  const sim = createSim(objective);
  Object.assign(sim.player, relays[0]);
  ticks(sim, 65);
  assert.equal(sim.extraction.relayMask, 1);
  assert.equal(sim.extraction.open, false);
  Object.assign(sim.player, relays[1]);
  sim.step(dt);
  assert.equal(sim.extraction.relayMask, 3);
  assert.equal(sim.extraction.open, true);
  Object.assign(sim.player, { x: 0, y: 0 });
  ticks(sim, 31);
  assert.equal(sim.extraction.outcome, 'victory');
  const tardy = createSim(objective);
  ticks(tardy, 180);
  assert.equal(tardy.extraction.outcome, 'defeat');
  assert.equal(tardy.extraction.reason, 'timeout');
});
