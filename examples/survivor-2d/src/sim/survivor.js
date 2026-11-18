// Headless horde-survivor simulation. Pure JS: no DOM, no renderer, no wall clock.
// Everything is struct-of-arrays and seeded, so the same inputs give the same state.
// SpatialHash2D is injected so this file works from the vendored runtime or the repo runtime.
import { CONFIG } from './config.js';
import { createRng, createHasher } from './rng.js';

const TAU = Math.PI * 2;

export function createSurvivorSim({ SpatialHash2D, seed = 1, config = CONFIG, godMode = false } = {}) {
  if (!SpatialHash2D) throw new TypeError('createSurvivorSim requires SpatialHash2D');
  const rng = createRng(seed);
  const hash = new SpatialHash2D({ cellSize: config.hashCell });
  const near = [];
  const kinds = config.enemyKinds;

  const E = config.maxEnemies, B = config.maxBullets, G = config.maxGems;
  const en = {
    x: new Float32Array(E), y: new Float32Array(E), hp: new Float32Array(E),
    kind: new Uint8Array(E), alive: new Uint8Array(E), hit: new Uint8Array(E), // hit: view consumes for flashes
    free: new Int32Array(E), freeTop: 0, hw: 0, count: 0,
  };
  for (let i = 0; i < E; i++) en.free[i] = E - 1 - i;
  en.freeTop = E;
  const bl = {
    x: new Float32Array(B), y: new Float32Array(B), vx: new Float32Array(B), vy: new Float32Array(B),
    life: new Float32Array(B), pierce: new Int8Array(B), alive: new Uint8Array(B), hits: new Int32Array(B * 4).fill(-1),
    hw: 0, count: 0,
  };
  const gm = {
    x: new Float32Array(G), y: new Float32Array(G), v: new Float32Array(G), alive: new Uint8Array(G),
    hw: 0, count: 0,
  };

  const player = {
    x: 0, y: 0, hp: config.player.hp, maxHp: config.player.hp, xp: 0, level: 1, xpNeed: config.xp.base,
    speed: config.player.speed, magnet: config.player.magnet, facing: 0,
  };
  const weapon = {
    boltCd: 0, boltCooldown: config.bolt.cooldown, boltDamage: config.bolt.damage, boltCount: config.bolt.count,
    boltPierce: config.bolt.pierce, novaCd: 0.8, novaRadius: config.nova.radius, novaDamage: config.nova.damage,
    novaFlash: 0, // seconds left of the nova ring (view effect)
  };
  const state = { tick: 0, time: 0, kills: 0, over: false, pending: null, godMode, lastPickup: 0 };
  const objective = config.extraction;
  const extraction = objective ? { open: false, progress: 0, outcome: null, relay: null } : null;
  const levels = {};

  function addEnemy(x, y, kind) {
    if (en.freeTop === 0) return -1;
    const i = en.free[--en.freeTop];
    en.x[i] = x; en.y[i] = y; en.kind[i] = kind; en.hp[i] = kinds[kind].hp; en.alive[i] = 1; en.hit[i] = 0;
    if (i >= en.hw) en.hw = i + 1;
    en.count++;
    return i;
  }
  function killEnemy(i) {
    en.alive[i] = 0; en.free[en.freeTop++] = i; en.count--; state.kills++;
    while (en.hw > 0 && !en.alive[en.hw - 1]) en.hw--;
    addGem(en.x[i], en.y[i], kinds[en.kind[i]].xp);
  }
  function addGem(x, y, v) {
    let slot = -1;
    for (let i = 0; i < gm.hw; i++) if (!gm.alive[i]) { slot = i; break; }
    if (slot < 0) {
      if (gm.hw >= G) { gainXp(v); return; }
      slot = gm.hw++;
    }
    gm.x[slot] = x; gm.y[slot] = y; gm.v[slot] = v; gm.alive[slot] = 1; gm.count++;
  }
  function addBullet(x, y, vx, vy) {
    let slot = -1;
    for (let i = 0; i < bl.hw; i++) if (!bl.alive[i]) { slot = i; break; }
    if (slot < 0) { if (bl.hw >= B) return; slot = bl.hw++; }
    bl.x[slot] = x; bl.y[slot] = y; bl.vx[slot] = vx; bl.vy[slot] = vy; bl.life[slot] = config.bolt.life;
    bl.pierce[slot] = weapon.boltPierce; bl.alive[slot] = 1; bl.count++;
    bl.hits.fill(-1, slot * 4, slot * 4 + 4);
  }
  function dropBullet(i) {
    bl.alive[i] = 0; bl.count--;
    while (bl.hw > 0 && !bl.alive[bl.hw - 1]) bl.hw--;
  }

  function damageEnemy(i, dmg) {
    en.hp[i] -= dmg; en.hit[i] = 1;
    if (en.hp[i] <= 0) killEnemy(i);
  }

  function gainXp(v) {
    player.xp += v;
    if (!state.pending && player.xp >= player.xpNeed) {
      player.xp -= player.xpNeed; player.level++;
      player.xpNeed = Math.round(config.xp.base * config.xp.mult ** (player.level - 1));
      const pool = config.upgrades.slice(), pick = [];
      for (let n = 0; n < 3; n++) pick.push(pool.splice(rng.int(pool.length), 1)[0]);
      state.pending = pick;
    }
  }

  function applyUpgrade(id) {
    levels[id] = (levels[id] ?? 0) + 1;
    switch (id) {
      case 'damage': weapon.boltDamage *= 1.3; weapon.novaDamage *= 1.15; break;
      case 'rate': weapon.boltCooldown = Math.max(0.12, weapon.boltCooldown * 0.85); break;
      case 'multishot': weapon.boltCount = Math.min(7, weapon.boltCount + 1); break;
      case 'pierce': weapon.boltPierce++; break;
      case 'speed': player.speed *= 1.1; break;
      case 'magnet': player.magnet *= 1.4; break;
      case 'nova': weapon.novaRadius *= 1.2; weapon.novaDamage += 1; break;
      case 'heal': player.hp = Math.min(player.maxHp, player.hp + 40); player.maxHp += 10; break;
    }
  }

  function spawnWave(dt) {
    const sp = config.spawn;
    const target = Math.min(config.maxEnemies, sp.base + sp.perSecond * state.time);
    let n = Math.min(sp.perTick, Math.floor(target - en.count));
    while (n-- > 0) {
      const a = rng.next() * TAU, r = rng.range(sp.ringMin, sp.ringMax);
      const roll = rng.next();
      const kind = state.time > sp.bruteAfter && roll > 0.94 ? 2 : state.time > sp.runnerAfter && roll > 0.7 ? 1 : 0;
      if (addEnemy(player.x + Math.cos(a) * r, player.y + Math.sin(a) * r, kind) < 0) break;
    }
  }

  function nearestEnemy(range) {
    let best = -1, bd = Infinity;
    for (let r = 160; r <= range * 2; r *= 2) {
      hash.queryRadius(player.x, player.y, Math.min(r, range), near);
      for (let k = 0; k < near.length; k++) {
        const i = near[k];
        if (!en.alive[i]) continue;
        const dx = en.x[i] - player.x, dy = en.y[i] - player.y, d = dx * dx + dy * dy;
        if (d < bd || (d === bd && i < best)) { bd = d; best = i; }
      }
      if (best >= 0 || r >= range) break;
    }
    return best;
  }

  function stepExtraction(dt) {
    if (state.over) {
      extraction.outcome = 'defeat';
      state.pending = null;
      return;
    }
    if (objective.relays && extraction.relay === null) {
      const index = objective.relays.findIndex(({ x, y }) =>
        (player.x - x) ** 2 + (player.y - y) ** 2 <= objective.relayRadius ** 2);
      if (index < 0) return;
      extraction.relay = index;
    }
    if (state.time + 1e-9 < objective.unlockSeconds) return;
    extraction.open = true;
    if (player.x ** 2 + player.y ** 2 > objective.radius ** 2) return;
    extraction.progress += dt;
    if (extraction.progress + 1e-9 < objective.holdSeconds) return;
    extraction.progress = objective.holdSeconds;
    extraction.outcome = 'victory';
    state.over = true;
  }

  /** Advance one fixed tick. input: { x, y } move vector (-1..1) and { choice } level-up pick (0..2). */
  function step(dt, input = {}) {
    if (state.over) return;
    if (state.pending) {
      const c = input.choice;
      if (c >= 0 && c < state.pending.length) { applyUpgrade(state.pending[c]); state.pending = null; }
      return;
    }
    state.tick++; state.time += dt;

    // Player: normalise so diagonals are not faster.
    let mx = input.x || 0, my = input.y || 0;
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    player.x += mx * player.speed * dt; player.y += my * player.speed * dt;
    if (ml > 0.05) player.facing = Math.atan2(my, mx);
    player.hp = Math.min(player.maxHp, player.hp + config.player.regen * dt);

    spawnWave(dt);

    // Enemies chase; the hash is rebuilt afterwards from final positions.
    for (let i = 0; i < en.hw; i++) {
      if (!en.alive[i]) continue;
      const k = kinds[en.kind[i]];
      const dx = player.x - en.x[i], dy = player.y - en.y[i];
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      en.x[i] += dx / d * k.speed * dt; en.y[i] += dy / d * k.speed * dt;
    }
    hash.clear();
    for (let i = 0; i < en.hw; i++) if (en.alive[i]) hash.insert(i, en.x[i], en.y[i], kinds[en.kind[i]].radius);

    // Soft separation on alternating halves, capped neighbours: keeps a 3000+ swarm readable and cheap.
    const par = state.tick & 1;
    for (let i = par; i < en.hw; i += 2) {
      if (!en.alive[i]) continue;
      const ri = kinds[en.kind[i]].radius;
      hash.queryRadius(en.x[i], en.y[i], ri, near);
      let pushed = 0;
      for (let k = 0; k < near.length && pushed < 6; k++) {
        const j = near[k];
        if (j === i || !en.alive[j]) continue;
        let dx = en.x[i] - en.x[j], dy = en.y[i] - en.y[j];
        let d = Math.sqrt(dx * dx + dy * dy);
        const min = ri + kinds[en.kind[j]].radius;
        if (d >= min) continue;
        if (d < 1e-4) { dx = (i & 1) ? 1 : -1; dy = 0; d = 1; }
        const p = (min - d) * 0.25 / d;
        en.x[i] += dx * p; en.y[i] += dy * p;
        pushed++;
      }
    }

    // Weapons.
    weapon.boltCd -= dt; weapon.novaCd -= dt; weapon.novaFlash = Math.max(0, weapon.novaFlash - dt);
    if (weapon.boltCd <= 0 && en.count > 0) {
      const t = nearestEnemy(config.bolt.range);
      if (t >= 0) {
        weapon.boltCd = weapon.boltCooldown;
        const base = Math.atan2(en.y[t] - player.y, en.x[t] - player.x);
        const n = weapon.boltCount, spread = 0.18;
        for (let b = 0; b < n; b++) {
          const a = base + (b - (n - 1) / 2) * spread;
          addBullet(player.x, player.y, Math.cos(a) * config.bolt.speed, Math.sin(a) * config.bolt.speed);
        }
      }
    }
    if (weapon.novaCd <= 0) {
      weapon.novaCd = config.nova.cooldown; weapon.novaFlash = 0.18;
      hash.queryRadius(player.x, player.y, weapon.novaRadius, near);
      for (let k = 0; k < near.length; k++) {
        const i = near[k];
        if (!en.alive[i]) continue;
        const dx = en.x[i] - player.x, dy = en.y[i] - player.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        en.x[i] += dx / d * config.nova.knock; en.y[i] += dy / d * config.nova.knock;
        damageEnemy(i, weapon.novaDamage);
      }
    }

    // Bullets move, then hit enemies through the hash (pierce, remembering recent victims).
    for (let b = 0; b < bl.hw; b++) {
      if (!bl.alive[b]) continue;
      bl.x[b] += bl.vx[b] * dt; bl.y[b] += bl.vy[b] * dt; bl.life[b] -= dt;
      if (bl.life[b] <= 0) { dropBullet(b); continue; }
      hash.queryRadius(bl.x[b], bl.y[b], config.bolt.radius, near);
      for (let k = 0; k < near.length; k++) {
        const i = near[k];
        if (!en.alive[i]) continue;
        const h = b * 4;
        if (bl.hits[h] === i || bl.hits[h + 1] === i || bl.hits[h + 2] === i || bl.hits[h + 3] === i) continue;
        bl.hits[h + (bl.pierce[b] & 3)] = i;
        damageEnemy(i, weapon.boltDamage);
        if (--bl.pierce[b] < 0) { dropBullet(b); break; }
      }
    }

    // Gems: magnet pull, pickup.
    const pr2 = (config.player.radius + 6) ** 2, mr2 = player.magnet * player.magnet;
    for (let g = 0; g < gm.hw; g++) {
      if (!gm.alive[g]) continue;
      const dx = player.x - gm.x[g], dy = player.y - gm.y[g], d2 = dx * dx + dy * dy;
      if (d2 < pr2) { gm.alive[g] = 0; gm.count--; state.lastPickup = state.tick; gainXp(gm.v[g]); continue; }
      if (d2 < mr2) { const d = Math.sqrt(d2); gm.x[g] += dx / d * 420 * dt; gm.y[g] += dy / d * 420 * dt; }
    }
    while (gm.hw > 0 && !gm.alive[gm.hw - 1]) gm.hw--;

    // Contact damage (damage per second per touching enemy).
    hash.queryRadius(player.x, player.y, config.player.radius, near);
    let dps = 0;
    for (let k = 0; k < near.length; k++) if (en.alive[near[k]]) dps += kinds[en.kind[near[k]]].dps;
    if (dps > 0 && !state.godMode) {
      player.hp -= dps * dt;
      if (player.hp <= 0) { player.hp = 0; state.over = true; }
    }
    if (extraction) stepExtraction(dt);
  }

  /** Spawn n enemies on a disc around the player: stress tests and screenshots. */
  function prefill(n, radius = 420) {
    for (let k = 0; k < n; k++) {
      const a = rng.next() * TAU, r = Math.sqrt(rng.next()) * radius + 40;
      addEnemy(player.x + Math.cos(a) * r, player.y + Math.sin(a) * r, rng.next() > 0.85 ? 1 : 0);
    }
  }

  function checksum() {
    const h = createHasher();
    h.number(state.tick); h.number(state.kills); h.number(rng.state); h.number(state.over ? 1 : 0);
    for (const k of ['x', 'y', 'hp', 'xp', 'level', 'speed', 'magnet']) h.number(player[k]);
    for (const k in weapon) h.number(weapon[k]);
    h.bytes(en.x.subarray(0, en.hw)); h.bytes(en.y.subarray(0, en.hw)); h.bytes(en.hp.subarray(0, en.hw));
    h.bytes(en.alive.subarray(0, en.hw));
    h.bytes(bl.x.subarray(0, bl.hw)); h.bytes(bl.y.subarray(0, bl.hw));
    h.bytes(gm.x.subarray(0, gm.hw)); h.bytes(gm.y.subarray(0, gm.hw)); h.bytes(gm.alive.subarray(0, gm.hw));
    if (extraction) {
      h.number(Number(extraction.open));
      h.number(extraction.progress);
      h.number(Number(extraction.outcome === 'victory'));
      h.number(extraction.relay ?? -1);
    }
    return h.hex();
  }

  function summary() {
    return { time: +state.time.toFixed(2), kills: state.kills, level: player.level, over: state.over, enemies: en.count,
      ...(extraction && { outcome: extraction.outcome }) };
  }

  return { config, state, player, weapon, levels, en, bl, gm, extraction, step, prefill, checksum, summary, applyUpgrade };
}
