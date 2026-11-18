#!/usr/bin/env node
import { createArenaSim } from '../src/sim/arena.js';
import { CONFIG, TICK } from '../src/sim/config.js';

const ROUTES = [
  [[10, 2, 1], [5, -5], [0, -5], [-9, -6, 0], [-5, 3], [0, 8], [0, 14, 'exit']],
  [[-4, 2], [-5, -3], [-9, -6, 0], [0, -5], [5, -5], [10, 2, 1], [5, 6], [0, 11], [0, 14, 'exit']],
];
const SEEDS_PER_ROUTE = 200;
const POLICIES = [
  { name: 'hold-spin', holdSpin: true, dodge: false },
  { name: 'aim-spin', holdSpin: false, dodge: false },
  { name: 'aim-and-dodge', holdSpin: false, dodge: true },
];

function enemyInReach(sim) {
  const { player, en } = sim;
  const radius = CONFIG.player.spinRadius + CONFIG.enemy.radius;
  for (let i = 0; i < en.count; i++) {
    if (Math.hypot(en.x[i] - player.x, en.z[i] - player.z) <= radius) return true;
  }
  return false;
}

function trial(seed, route, policy) {
  let pulseHits = 0;
  let warnings = 0;
  const sim = createArenaSim({
    seed,
    onEvent(event) {
      if (event.type === 'pulse.warned') warnings++;
      if (event.type === 'pulse.resolved' && event.details.hit) pulseHits++;
    },
  });
  const { state, player, pulse, mission } = sim;
  const input = {};
  for (const [x, z, beacon] of route) {
    let reached = false;
    const deadline = state.tick + 60 * 20;
    while (!state.over && state.tick < deadline) {
      const dx = x - player.x;
      const dz = z - player.z;
      const distance = Math.hypot(dx, dz);
      const moving = distance > 0.45;
      if (!moving && (beacon === undefined || (beacon !== 'exit' && mission.charged[beacon]))) { reached = true; break; }
      input.mx = moving ? dx / distance : 0;
      input.mz = moving ? dz / distance : 0;
      input.attack = policy.holdSpin || enemyInReach(sim);
      input.jump = policy.dodge && player.grounded && pulse.resolveAt > state.time
        && pulse.resolveAt - state.time <= 0.24
        && Math.hypot(pulse.x - player.x, pulse.z - player.z) <= CONFIG.enemy.pulse.radius;
      sim.step(TICK, input);
    }
    if (state.over || !reached) break;
  }
  return { wins: Number(state.outcome === 'victory'), time: state.time, hp: player.hp, warnings, pulseHits, jumps: player.jumps };
}

function mean(results, key) {
  return Number((results.reduce((sum, run) => sum + run[key], 0) / results.length).toFixed(2));
}

const reports = ROUTES.flatMap((route, index) => POLICIES.map(policy => {
  const results = Array.from({ length: SEEDS_PER_ROUTE }, (_, i) => trial(2026 + i, route, policy));
  const wins = results.filter(run => run.wins);
  return {
    route: index + 1,
    policy: policy.name,
    runs: results.length,
    wins: wins.length,
    meanWinSeconds: wins.length ? mean(wins, 'time') : null,
    meanHp: mean(results, 'hp'),
    meanWarnings: mean(results, 'warnings'),
    meanPulseHits: mean(results, 'pulseHits'),
    meanJumps: mean(results, 'jumps'),
  };
}));
console.log(JSON.stringify({ runs: reports.reduce((sum, row) => sum + row.runs, 0), reports }, null, 2));
