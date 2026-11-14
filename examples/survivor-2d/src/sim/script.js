// Deterministic scripted "player" used by tests and benchmarks: a slow kiting orbit with a direction change,
// and a fixed level-up pick order. Pure function of the tick number.
const PICKS = [2, 0, 1];

export function scriptedInput(tick, out = { x: 0, y: 0, choice: -1 }) {
  const t = tick / 60;
  out.x = Math.cos(t * 0.9) + 0.35 * Math.sin(t * 2.3);
  out.y = Math.sin(t * 0.9 + 0.5) + 0.35 * Math.cos(t * 1.7);
  out.choice = PICKS[tick % 3];
  return out;
}

/** Run `seconds` of game time. Returns the final checksum. */
export function runScript(sim, seconds, dt = 1 / 60) {
  const input = { x: 0, y: 0, choice: -1 };
  const ticks = Math.round(seconds / dt);
  for (let i = 0; i < ticks; i++) {
    scriptedInput(sim.state.tick, input);
    sim.step(dt, input);
  }
  return sim.checksum();
}
