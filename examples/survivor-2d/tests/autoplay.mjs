import { SpatialHash2D } from '../../../assets/runtime/world/spatial2d.js';
import { createSurvivorSim } from '../src/sim/survivor.js';
import { STORM_CONFIG } from '../src/sim/watch-config.js';

const PRIORITY = ['damage', 'rate', 'multishot', 'pierce', 'heal', 'nova', 'speed', 'magnet'];

export default {
  name: 'survivor-2d storm extraction clear-rate & difficulty check',
  runs: 20,
  idleRuns: 10,
  tickHz: 60,
  maxSeconds: 60,
  minWinRate: 0.40,
  maxWinRate: 1.0,
  maxIdleWinRate: 0.0,
  minSkillDelta: 0.40,
  minAvgDurationSec: 5,
  maxTimeoutRate: 0.10,
  minKillsAvg: 5,

  createSession(seed, strategy) {
    const sim = createSurvivorSim({ SpatialHash2D, seed, config: STORM_CONFIG });
    const objective = STORM_CONFIG.extraction;
    const input = { x: 0, y: 0, choice: -1 };

    return {
      step(dt, tick) {
        if (strategy === 'idle') {
          input.x = 0;
          input.y = 0;
          input.choice = -1;
          sim.step(dt, input);
          return;
        }

        if (sim.state.pending) {
          let bestIdx = 0;
          let bestRank = Infinity;
          for (let i = 0; i < sim.state.pending.length; i++) {
            const rank = PRIORITY.indexOf(sim.state.pending[i]);
            if (rank !== -1 && rank < bestRank) {
              bestRank = rank;
              bestIdx = i;
            }
          }
          input.choice = bestIdx;
          sim.step(dt, input);
          return;
        }
        input.choice = -1;

        const { player: p, extraction, en } = sim;
        let target = { x: 0, y: 0 };
        if (extraction.relayCount < objective.requiredRelays) {
          for (let i = 0; i < objective.relays.length; i++) {
            if ((extraction.relayMask & (1 << i)) === 0) {
              target = objective.relays[i];
              break;
            }
          }
        }

        let dx = target.x - p.x;
        let dy = target.y - p.y;
        const dist = Math.hypot(dx, dy);

        // Orbit within the extraction circle when defending origin so chasers miss.
        if (extraction.relayCount >= objective.requiredRelays && dist < objective.radius * 0.65) {
          const ang = tick * 0.09;
          dx = Math.cos(ang);
          dy = Math.sin(ang);
        } else if (dist > 1) {
          dx /= dist;
          dy /= dist;
        }

        // Mild local avoidance from very close enemies while moving.
        let repelX = 0;
        let repelY = 0;
        for (let i = 0; i < en.hw; i++) {
          if (!en.alive[i]) continue;
          const ex = p.x - en.x[i];
          const ey = p.y - en.y[i];
          const d2 = ex * ex + ey * ey;
          if (d2 > 1 && d2 < 45 * 45) {
            const d = Math.sqrt(d2);
            repelX += (ex / d) * (1 - d / 45);
            repelY += (ey / d) * (1 - d / 45);
          }
        }

        const vx = dx + repelX * 0.7;
        const vy = dy + repelY * 0.7;
        const mag = Math.hypot(vx, vy) || 1;
        input.x = vx / mag;
        input.y = vy / mag;

        sim.step(dt, input);
      },
      isOver() {
        return sim.state.over;
      },
      snapshot() {
        return {
          over: sim.state.over,
          outcome: sim.extraction?.outcome ?? (sim.state.over ? 'defeat' : null),
          time: sim.state.time,
          kills: sim.state.kills,
          score: sim.state.kills * 10 + sim.player.level * 50,
          level: sim.player.level,
          hp: sim.player.hp,
          player: { x: sim.player.x, y: sim.player.y },
        };
      },
    };
  },
};
