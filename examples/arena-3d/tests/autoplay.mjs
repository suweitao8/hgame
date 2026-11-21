import { createArenaSim } from '../src/sim/arena.js';
import { CONFIG } from '../src/sim/config.js';

export default {
  name: 'arena-3d clear-rate & difficulty check',
  runs: 20,
  idleRuns: 10,
  randomRuns: 6,
  deterministic: true,
  tickHz: 60,
  maxSeconds: 180,
  minWinRate: 0.40,
  maxWinRate: 1.0,
  maxIdleWinRate: 0.10,
  maxRandomWinRate: 0.25,
  minSkillDelta: 0.35,
  minBotOverRandomDelta: 0.30,
  minAvgDurationSec: 10,
  maxTimeoutRate: 0.15,
  minKillsAvg: 1,

  createSession(seed, strategy) {
    const sim = createArenaSim({ seed, tier: 'medium' });
    const { mission: objective, player: P, enemy: E } = CONFIG;
    const input = { mx: 0, mz: 0, jump: false, attack: false };

    return {
      step(dt, tick) {
        if (strategy === 'idle') {
          input.mx = 0;
          input.mz = 0;
          input.jump = false;
          input.attack = false;
          sim.step(dt, input);
          return;
        }
        if (strategy === 'random') {
          const h = (Math.imul(tick ^ (seed * 7919), 2654435761) >>> 0);
          const ang = (h % 360) * (Math.PI / 180);
          input.mx = Math.cos(ang);
          input.mz = Math.sin(ang);
          input.jump = (h & 31) === 0;
          input.attack = (h & 7) === 0;
          sim.step(dt, input);
          return;
        }

        const { player: p, en, mission, pulse, state } = sim;
        let target = objective.exit;
        for (let i = 0; i < objective.beacons.length; i++) {
          if (!mission.charged[i]) {
            target = objective.beacons[i];
            break;
          }
        }

        let dx = target.x - p.x;
        let dz = target.z - p.z;
        const distToTarget = Math.hypot(dx, dz);

        // Find nearest enemy for spin attack & local kiting when beacon is blocked.
        let nearDist = Infinity;
        let nearDx = 0;
        let nearDz = 0;
        for (let i = 0; i < en.count; i++) {
          const ex = en.x[i] - p.x;
          const ez = en.z[i] - p.z;
          const d = Math.hypot(ex, ez);
          if (d < nearDist) {
            nearDist = d;
            nearDx = ex;
            nearDz = ez;
          }
        }

        if (mission.blocked && nearDist < 4.5) {
          // Orbit/kite slightly around beacon while spinning enemies away.
          const ang = tick * 0.09;
          dx = Math.cos(ang) * 1.5 - nearDx * 0.5;
          dz = Math.sin(ang) * 1.5 - nearDz * 0.5;
        } else if (distToTarget > 0.35) {
          // Simple obstacle slide bias if blocked by central box.
          const ox = p.x;
          const oz = p.z;
          for (const b of CONFIG.obstacles) {
            if (Math.abs(ox - b.x) < b.hx + 1.1 && Math.abs(oz - b.z) < b.hz + 1.1) {
              const side = (ox - b.x) * dz - (oz - b.z) * dx >= 0 ? 1 : -1;
              dx += -dz * 0.65 * side;
              dz += dx * 0.65 * side;
              break;
            }
          }
        } else {
          // Inside beacon / exit radius: slight weave to evade chasers.
          dx = Math.cos(tick * 0.08) * 0.4;
          dz = Math.sin(tick * 0.08) * 0.4;
        }

        const len = Math.hypot(dx, dz) || 1;
        input.mx = distToTarget > 0.2 || mission.blocked ? dx / len : Math.cos(tick * 0.08) * 0.35;
        input.mz = distToTarget > 0.2 || mission.blocked ? dz / len : Math.sin(tick * 0.08) * 0.35;

        // Jump over incoming pulse ring just before resolve.
        const pulseClosing = pulse && pulse.resolveAt > 0 && (pulse.resolveAt - state.time) < 0.28 &&
          Math.hypot(p.x - pulse.x, p.z - pulse.z) <= E.pulse.radius + 0.6;
        input.jump = Boolean(pulseClosing);

        // Spin attack whenever any enemy is inside spin radius.
        input.attack = nearDist <= P.spinRadius + E.radius * 0.8;

        sim.step(dt, input);
      },
      isOver() {
        return sim.state.over;
      },
      snapshot() {
        return {
          over: sim.state.over,
          outcome: sim.state.outcome ?? (sim.state.over ? 'defeat' : null),
          time: sim.state.time,
          kills: sim.state.kills,
          score: sim.state.kills * 100 + sim.mission.chargedCount * 250,
          hp: sim.player.hp,
          player: { x: sim.player.x, y: sim.player.y, z: sim.player.z },
        };
      },
    };
  },
};
