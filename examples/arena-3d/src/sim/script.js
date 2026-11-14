// Deterministic scripted "player" for tests and benchmarks: pure function of the tick number.
// Circles the arena, hops every ~2s and spins whenever an enemy is close (the sim reads `attack` as a request).
export function scriptedInput(tick, out = { mx: 0, mz: 0, jump: false, attack: false }) {
  const t = tick / 60;
  out.mx = Math.cos(t * 0.5) + 0.3 * Math.sin(t * 1.7);
  out.mz = Math.sin(t * 0.5) + 0.3 * Math.cos(t * 1.3);
  out.jump = tick % 120 === 60;
  out.attack = tick % 50 === 0;
  return out;
}

/** Run `seconds` of game time and return the final checksum. */
export function runScript(sim, seconds, dt = 1 / 60) {
  const input = { mx: 0, mz: 0, jump: false, attack: false };
  const ticks = Math.round(seconds / dt);
  for (let i = 0; i < ticks; i++) {
    scriptedInput(sim.state.tick, input);
    sim.step(dt, input);
  }
  return sim.checksum();
}
