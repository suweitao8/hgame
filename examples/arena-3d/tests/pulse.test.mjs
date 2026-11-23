import test from 'node:test';
import assert from 'node:assert/strict';
import { createArenaSim } from '../src/sim/arena.js';
import { CONFIG, ENEMY_KIND, TICK } from '../src/sim/config.js';

function encounter() {
  const events = [];
  const sim = createArenaSim({ onEvent: event => events.push(event) });
  sim.state.spawnTimer = 60;
  sim.en.count = 1;
  sim.en.x[0] = sim.player.x - 4;
  sim.en.z[0] = sim.player.z;
  sim.en.hp[0] = 2;
  sim.en.kind[0] = ENEMY_KIND.PULSE;
  return { sim, events };
}

function impact(sim, events, input = () => ({})) {
  for (let i = 0; i < 90; i++) {
    sim.step(TICK, input(sim));
    const resolved = events.find(event => event.type === 'pulse.resolved');
    if (resolved) return resolved;
  }
  assert.fail('pulse did not resolve');
}

test('a pulse marks a fixed location before applying damage', () => {
  const { sim, events } = encounter();
  sim.step();
  const warning = events.find(event => event.type === 'pulse.warned');
  assert.ok(warning);
  assert.equal(warning.details.x, sim.player.x);
  assert.equal(warning.details.z, sim.player.z);
  assert.equal(sim.player.hp, CONFIG.player.hp);
  const result = impact(sim, events);
  assert.ok((result.tick - warning.tick) * TICK >= CONFIG.enemy.pulse.windup - 1e-6);
  assert.equal(result.details.hit, true);
  assert.equal(sim.player.hp, CONFIG.player.hp - CONFIG.enemy.pulse.damage);
});

test('a player can sidestep or jump over the marked pulse', () => {
  for (const dodge of ['step', 'jump']) {
    const { sim, events } = encounter();
    sim.step();
    const warning = events.find(event => event.type === 'pulse.warned');
    assert.ok(warning);
    const result = impact(sim, events, current => dodge === 'step'
      ? { mx: 1 }
      : { jump: current.state.tick * TICK > CONFIG.enemy.pulse.windup - 0.25 });
    assert.equal(result.details.hit, false, dodge);
    assert.equal(result.details.x, warning.details.x, 'warning never follows the player');
    assert.equal(sim.player.hp, CONFIG.player.hp, dodge);
  }
});

test('a warning on a platform cannot hit the ground below', () => {
  const { sim, events } = encounter();
  Object.assign(sim.player, { x: 2.09, y: 1.2, z: 0 });
  sim.en.x[0] = 5;
  sim.en.z[0] = 0;
  sim.step();
  const warning = events.find(event => event.type === 'pulse.warned');
  assert.equal(warning?.details.y, 1.2);
  for (let i = 0; i < 5; i++) sim.step(TICK, { mx: 1 });
  const result = impact(sim, events);
  assert.equal(sim.player.y, 0);
  assert.ok(Math.abs(sim.player.x - warning.details.x) < CONFIG.enemy.pulse.radius);
  assert.equal(result.details.hit, false);
  assert.equal(sim.player.hp, CONFIG.player.hp);
});

test('regular enemy rolls cannot spawn the guaranteed pulse sentry early', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const sim = createArenaSim({ seed, godMode: true });
    while (sim.state.spawned < 3) sim.step();
    assert.equal(sim.en.kind.subarray(0, 3).filter(kind => kind === ENEMY_KIND.PULSE).length, 1);
    assert.equal(sim.en.kind[2], ENEMY_KIND.PULSE);
  }
});

test('jumping keeps earned beacon progress until leaving its ring', () => {
  const sim = createArenaSim({ maxEnemies: 0 });
  const [beacon] = CONFIG.mission.beacons;
  sim.player.x = beacon.x;
  sim.player.z = beacon.z;
  for (let i = 0; i < 40; i++) sim.step();
  const progress = sim.mission.progress;
  sim.step(TICK, { jump: true });
  assert.equal(sim.player.grounded, false);
  assert.equal(sim.mission.active, 0);
  assert.equal(sim.mission.progress, progress);
  for (let i = 0; i < 60 && !sim.player.grounded; i++) sim.step();
  assert.ok(sim.mission.progress > progress);
  sim.player.x += CONFIG.mission.radius + 1;
  sim.step();
  assert.equal(sim.mission.progress, 0);
});

test('extraction channels through a final pulse encounter and remembers progress while dodging', () => {
  const events = [];
  const sim = createArenaSim({ maxEnemies: 0, onEvent: event => events.push(event) });
  const { exit, exitHoldSeconds, radius } = CONFIG.mission;
  sim.mission.charged.fill(1);
  sim.mission.chargedCount = sim.mission.charged.length;
  Object.assign(sim.player, exit);
  sim.step();
  assert.equal(sim.state.outcome, null);
  assert.equal(sim.mission.exitProgress, TICK);
  assert.ok(events.some(event => event.type === 'exit.started'));
  sim.player.x += radius + 1;
  for (let i = 0; i < 60; i++) sim.step();
  assert.equal(sim.mission.exitProgress, TICK);
  assert.ok(events.some(event => event.type === 'pulse.warned' && event.details.source === 'exit'));
  assert.ok(events.some(event => event.type === 'pulse.resolved' && !event.details.hit));
  Object.assign(sim.player, exit);
  for (let i = 0; i < Math.ceil(exitHoldSeconds / TICK) && !sim.state.over; i++) sim.step();
  assert.equal(sim.state.outcome, 'victory');
  assert.equal(sim.mission.exitProgress, exitHoldSeconds);
});
