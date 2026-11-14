// Tunable constants for the arena sim. Pure data: no engine imports, safe in Node and the browser.
export const TICK = 1 / 60;

// Quality tier -> sim/view budget. The tier is chosen once per run (enemy cap changes gameplay, so it is part
// of the sim config and of the seed's replay identity), never mid-run.
export const TIER_BUDGET = Object.freeze({
  low: { maxEnemies: 10, shadows: false },
  medium: { maxEnemies: 18, shadows: true },
  high: { maxEnemies: 28, shadows: true },
});

export const CONFIG = Object.freeze({
  arenaHalf: 18,
  // Axis-aligned obstacles (xz footprint half-extents, height). Players may stand on them; enemies cannot climb.
  obstacles: Object.freeze([
    { x: 0, z: 0, hx: 2, hz: 2, h: 1.2 },
    { x: 8, z: -6, hx: 1.5, hz: 3, h: 2.4 },
    { x: -9, z: 5, hx: 3, hz: 1.5, h: 1.8 },
    { x: -5, z: -10, hx: 1.2, hz: 1.2, h: 0.8 },
    { x: 10, z: 9, hx: 2.2, hz: 2.2, h: 1.6 },
    { x: -13, z: -3, hx: 0.8, hz: 0.8, h: 3.2 },
  ]),
  player: { radius: 0.45, speed: 6.5, accel: 40, jumpSpeed: 8.2, gravity: 24, stepUp: 0.35, hp: 100,
    invuln: 0.6, spinCooldown: 0.9, spinRadius: 3, spinKnock: 9, spinDamage: 1, spinTime: 0.25 },
  enemy: { radius: 0.5, speed: 2.4, speedGain: 0.012, speedMax: 4.2, hp: 2, contactDamage: 9, separation: 3.2,
    spawnRadius: 16, spawnEvery: 1.6, spawnEveryMin: 0.45, knockDecay: 6 },
});
