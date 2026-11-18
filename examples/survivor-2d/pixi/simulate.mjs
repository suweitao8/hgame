import { SpatialHash2D } from '../../../assets/runtime/world/spatial2d.js';
import { createSurvivorSim } from '../src/sim/survivor.js';
import { WATCH_CONFIG } from '../src/sim/watch-config.js';

const policies = ['idle', 'left-relay', 'right-relay'];
const steps = 60 * 45;
const perPolicy = 400;
const objective = WATCH_CONFIG.extraction;

function play(seed, policy) {
  const sim = createSurvivorSim({ SpatialHash2D, seed, config: WATCH_CONFIG });
  const input = { x: 0, y: 0, choice: 0 };
  const keys = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  for (let frame = 0; frame < steps && !sim.state.over; frame++) {
    if (policy !== 'idle') {
      if (sim.extraction.relay === null || sim.extraction.open) {
        const target = sim.extraction.relay !== null ? { x: 0, y: 0 } : objective.relays[policy === 'left-relay' ? 0 : 1];
        const dx = target.x - sim.player.x, dy = target.y - sim.player.y;
        input.x = Math.abs(dx) > 16 ? Math.sign(dx) : 0;
        input.y = Math.abs(dy) > 16 ? Math.sign(dy) : 0;
      } else {
        const index = Math.floor(sim.state.time / 0.9) % keys.length;
        [input.x, input.y] = keys[index];
      }
    }
    sim.step(1 / 60, input);
  }
  return { ...sim.summary(), hp: sim.player.hp, opened: sim.extraction.open };
}

const rows = policies.map(policy => {
  let wins = 0;
  let defeats = 0;
  let reached = 0;
  let winSeconds = 0;
  let hp = 0;
  for (let i = 0; i < perPolicy; i++) {
    const result = play(2026 + i, policy);
    if (result.outcome === 'victory') {
      wins++;
      winSeconds += result.time;
      hp += result.hp;
    }
    if (result.outcome === 'defeat') defeats++;
    if (result.opened) reached++;
  }
  return { policy, runs: perPolicy, reached, wins, defeats, meanWinSeconds: wins ? +(winSeconds / wins).toFixed(2) : null,
    meanWinHp: wins ? +(hp / wins).toFixed(2) : null };
});

console.log(JSON.stringify({ objective, runs: policies.length * perPolicy, rows }, null, 2));
