// Arena brawler simulation: pure, deterministic (seeded RNG, fixed step), headless-testable.
// A third-person character (jump, spin attack) fights chasing enemies in a walled arena with climbable boxes.
import { CONFIG, TICK, TIER_BUDGET } from './config.js';
import { createRng, createHasher } from './rng.js';
import { pushCircleOutOfBox, circleOverlapsBox } from './collide.js';

export function createArenaSim({ seed = 1, tier = 'medium', maxEnemies, config = CONFIG, godMode = false } = {}) {
  const budget = TIER_BUDGET[tier] ?? TIER_BUDGET.medium;
  const cap = maxEnemies ?? budget.maxEnemies;
  const { player: P, enemy: E, arenaHalf, obstacles } = config;
  const rng = createRng(seed);
  const tmp = { x: 0, z: 0 };

  const state = { tick: 0, time: 0, kills: 0, spawned: 0, over: false, spawnTimer: 1, wave: 0 };
  const pl = {
    x: 0, y: 0, z: 6, vx: 0, vz: 0, vy: 0, yaw: 0, hp: P.hp, grounded: true,
    invuln: 0, spinCd: 0, spinT: 0, spins: 0, jumps: 0,
  };
  // Enemy SoA, densely packed [0, count); death swaps the last enemy into the hole (deterministic order).
  const en = {
    count: 0, x: new Float64Array(cap), z: new Float64Array(cap), vx: new Float64Array(cap), vz: new Float64Array(cap),
    hp: new Int8Array(cap), hit: new Uint8Array(cap), kind: new Uint8Array(cap),
  };

  function resolveStatics(x, z, r, y, out) {
    out.x = x; out.z = z;
    for (let i = 0; i < obstacles.length; i++) {
      const b = obstacles[i];
      if (y !== null && y >= b.h - P.stepUp) continue; // standing/stepping on it: not a wall
      pushCircleOutOfBox(out.x, out.z, r, b, out);
    }
    const lim = arenaHalf - r;
    if (out.x > lim) out.x = lim; else if (out.x < -lim) out.x = -lim;
    if (out.z > lim) out.z = lim; else if (out.z < -lim) out.z = -lim;
  }

  function supportHeight(x, z, y) {
    let h = 0;
    for (let i = 0; i < obstacles.length; i++) {
      const b = obstacles[i];
      if (b.h > h && b.h <= y + P.stepUp && circleOverlapsBox(x, z, P.radius * 0.7, b)) h = b.h;
    }
    return h;
  }

  function spawnEnemy() {
    if (en.count >= cap) return;
    const a = rng.next() * Math.PI * 2;
    let x = Math.cos(a) * E.spawnRadius + pl.x * 0.3, z = Math.sin(a) * E.spawnRadius + pl.z * 0.3;
    resolveStatics(x, z, E.radius, null, tmp); x = tmp.x; z = tmp.z;
    const i = en.count++;
    en.x[i] = x; en.z[i] = z; en.vx[i] = 0; en.vz[i] = 0; en.hp[i] = E.hp + (state.wave >= 4 ? 1 : 0);
    en.hit[i] = 0; en.kind[i] = rng.int(3);
    state.spawned++;
  }

  function killEnemy(i) {
    const last = --en.count;
    if (i !== last) {
      en.x[i] = en.x[last]; en.z[i] = en.z[last]; en.vx[i] = en.vx[last]; en.vz[i] = en.vz[last];
      en.hp[i] = en.hp[last]; en.hit[i] = en.hit[last]; en.kind[i] = en.kind[last];
    }
    state.kills++;
  }

  function stepPlayer(dt, input) {
    let mx = input.mx || 0, mz = input.mz || 0;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const k = Math.min(1, P.accel * dt / P.speed);
    pl.vx += (mx * P.speed - pl.vx) * k;
    pl.vz += (mz * P.speed - pl.vz) * k;
    if (len > 0.05) pl.yaw = Math.atan2(mx, mz);
    // Axis-separated horizontal move + push-out keeps wall sliding stable.
    resolveStatics(pl.x + pl.vx * dt, pl.z + pl.vz * dt, P.radius, pl.y, tmp);
    pl.x = tmp.x; pl.z = tmp.z;
    if (input.jump && pl.grounded) { pl.vy = P.jumpSpeed; pl.grounded = false; pl.jumps++; }
    pl.vy -= P.gravity * dt;
    pl.y += pl.vy * dt;
    const ground = supportHeight(pl.x, pl.z, pl.y);
    if (pl.y <= ground) { pl.y = ground; pl.vy = 0; pl.grounded = true; } else pl.grounded = false;
    pl.invuln = Math.max(0, pl.invuln - dt);
    pl.spinCd = Math.max(0, pl.spinCd - dt);
    pl.spinT = Math.max(0, pl.spinT - dt);
    if (input.attack && pl.spinCd === 0) {
      pl.spinCd = P.spinCooldown; pl.spinT = P.spinTime; pl.spins++;
      const r = P.spinRadius + E.radius;
      for (let i = en.count - 1; i >= 0; i--) {
        const dx = en.x[i] - pl.x, dz = en.z[i] - pl.z, d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        const d = Math.sqrt(d2) || 1;
        en.vx[i] = dx / d * P.spinKnock; en.vz[i] = dz / d * P.spinKnock; en.hit[i] = 1;
        en.hp[i] -= P.spinDamage;
        if (en.hp[i] <= 0) killEnemy(i);
      }
    }
  }

  function stepEnemies(dt) {
    const speed = Math.min(E.speedMax, E.speed + state.time * E.speedGain);
    const sep2 = E.separation * E.separation * 0.1;
    for (let i = 0; i < en.count; i++) {
      let dx = pl.x - en.x[i], dz = pl.z - en.z[i];
      const d = Math.hypot(dx, dz) || 1;
      let ax = dx / d, az = dz / d;
      for (let j = 0; j < en.count; j++) {
        if (j === i) continue;
        const sx = en.x[i] - en.x[j], sz = en.z[i] - en.z[j], s2 = sx * sx + sz * sz;
        if (s2 < sep2 && s2 > 1e-9) { const s = Math.sqrt(s2); ax += sx / s * (1 - s / (E.radius * 2)) * 1.5; az += sz / s * (1 - s / (E.radius * 2)) * 1.5; }
      }
      const al = Math.hypot(ax, az) || 1;
      const kd = Math.exp(-E.knockDecay * dt);
      en.vx[i] *= kd; en.vz[i] *= kd;
      resolveStatics(en.x[i] + (ax / al * speed + en.vx[i]) * dt, en.z[i] + (az / al * speed + en.vz[i]) * dt, E.radius, null, tmp);
      en.x[i] = tmp.x; en.z[i] = tmp.z;
      // Contact damage while the player is not airborne above the enemy.
      if (!godMode && pl.invuln === 0 && pl.y < 1.1 && d < P.radius + E.radius + 0.05) {
        pl.hp -= E.contactDamage; pl.invuln = P.invuln;
        if (pl.hp <= 0) { pl.hp = 0; state.over = true; }
      }
    }
  }

  function step(dt = TICK, input = {}) {
    if (state.over) return;
    state.tick++; state.time += dt;
    stepPlayer(dt, input);
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      state.wave = Math.floor(state.time / 15);
      state.spawnTimer = Math.max(E.spawnEveryMin, E.spawnEvery - state.time * 0.02);
      spawnEnemy();
    }
    stepEnemies(dt);
  }

  function checksum() {
    const h = createHasher();
    h.number(state.tick); h.number(state.kills); h.number(state.spawned); h.number(state.over ? 1 : 0);
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'hp', 'spins', 'jumps']) h.number(pl[k]);
    h.number(en.count);
    h.bytes(en.x.subarray(0, en.count)); h.bytes(en.z.subarray(0, en.count)); h.bytes(en.hp.subarray(0, en.count));
    h.number(rng.state);
    return h.hex();
  }

  return { config, state, player: pl, en, cap, tier, step, checksum, supportHeight };
}
