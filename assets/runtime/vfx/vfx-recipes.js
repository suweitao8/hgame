import { createVisualPrng, packRgb24 } from './vfx-core.js';
import { evaluateAtlasParticlePosition, evaluateSizeCurve } from './vfx-atlas-particles.js';

const MAX_ACTIVE_EFFECTS = 128;
const MAX_LAYERS_PER_EFFECT = 16;
const MAX_BURSTS_PER_LAYER = 8;
const MAX_TRAIL_FOLLOWERS = 512;
const MAX_TRACKED_PARTICLES = 256;
const MAX_POINT_LIGHTS = 8;

const VALID_LAYER_KINDS = new Set(['particle', 'mesh', 'slash', 'lightning', 'telegraph']);
const VALID_RENDER_MODES = new Set(['billboard', 'horizontal', 'stretched', 'vertical', 'mesh']);
const VALID_BLENDS = new Set(['alpha', 'additive']);

function parseColorNumber(val, fallback = 0xffffff) {
  if (typeof val === 'number' && Number.isFinite(val)) return (val & 0xffffff) >>> 0;
  if (typeof val === 'string') {
    const clean = val.trim().replace(/^#/, '');
    const parsed = Number.parseInt(clean, 16);
    if (Number.isFinite(parsed)) return (parsed & 0xffffff) >>> 0;
  }
  if (Array.isArray(val) && val.length >= 3) {
    return packRgb24((val[0] ?? 1) * 255, (val[1] ?? 1) * 255, (val[2] ?? 1) * 255);
  }
  return fallback;
}

function parseColorRgb01(val, out = [1, 1, 1]) {
  if (Array.isArray(val) && val.length >= 3) {
    out[0] = Number(val[0] ?? 1);
    out[1] = Number(val[1] ?? 1);
    out[2] = Number(val[2] ?? 1);
    return out;
  }
  const num = parseColorNumber(val, 0xffffff);
  out[0] = ((num >> 16) & 255) / 255;
  out[1] = ((num >> 8) & 255) / 255;
  out[2] = (num & 255) / 255;
  return out;
}

/**
 * Validates a declarative `.vfx.json` composite effect recipe (`schemaVersion === 1`).
 * @param {object} recipe
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateVfxRecipe(recipe) {
  /** @type {string[]} */
  const errors = [];
  if (!recipe || typeof recipe !== 'object') {
    return { ok: false, errors: ['Recipe must be a non-null object'] };
  }
  if (recipe.schemaVersion !== 1) {
    errors.push(`schemaVersion must be 1 (got ${String(recipe.schemaVersion)})`);
  }
  if (typeof recipe.id !== 'string' || !recipe.id.trim()) {
    errors.push('id must be a non-empty string');
  }
  if (recipe.duration !== undefined && (typeof recipe.duration !== 'number' || !Number.isFinite(recipe.duration) || recipe.duration <= 0)) {
    errors.push('duration must be a positive finite number');
  }
  if (!Array.isArray(recipe.layers) || recipe.layers.length === 0) {
    errors.push('layers must be a non-empty array');
  } else {
    if (recipe.layers.length > MAX_LAYERS_PER_EFFECT) {
      errors.push(`layers count (${recipe.layers.length}) exceeds max ${MAX_LAYERS_PER_EFFECT}`);
    }
    for (let i = 0; i < recipe.layers.length; i++) {
      const layer = recipe.layers[i];
      if (!layer || typeof layer !== 'object') {
        errors.push(`layers[${i}] must be an object`);
        continue;
      }
      const kind = layer.kind ?? 'particle';
      if (!VALID_LAYER_KINDS.has(kind)) {
        errors.push(`layers[${i}].kind "${String(kind)}" is invalid`);
      }
      if (layer.renderMode !== undefined && !VALID_RENDER_MODES.has(layer.renderMode)) {
        errors.push(`layers[${i}].renderMode "${String(layer.renderMode)}" is invalid`);
      }
      if (layer.blend !== undefined && !VALID_BLENDS.has(layer.blend)) {
        errors.push(`layers[${i}].blend "${String(layer.blend)}" is invalid`);
      }
      if (layer.colorCurve !== undefined) {
        if (!Array.isArray(layer.colorCurve) || layer.colorCurve.length === 0) {
          errors.push(`layers[${i}].colorCurve invalid`);
        }
      }
      if (layer.sizeCurve !== undefined) {
        if (!Array.isArray(layer.sizeCurve) || layer.sizeCurve.length === 0) {
          errors.push(`layers[${i}].sizeCurve invalid`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function readRange(val, fallbackMin, fallbackMax, prng) {
  if (Array.isArray(val)) {
    const a = Number(val[0] ?? fallbackMin);
    const b = Number(val[1] ?? a);
    return a === b ? a : prng.range(Math.min(a, b), Math.max(a, b));
  }
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  return fallbackMin === fallbackMax ? fallbackMin : prng.range(fallbackMin, fallbackMax);
}

/**
 * Creates a zero-GC composite `.vfx.json` recipe player on top of HGame VFX subsystems.
 * @param {object} [options]
 * @param {object | null} [options.atlasParticles=null]
 * @param {object | null} [options.meshVfx=null]
 * @param {object | null} [options.trails=null]
 * @param {object | null} [options.telegraphs=null]
 * @param {object | null} [options.hitstop=null]
 * @param {object | null} [options.shake=null]
 * @param {object | null} [options.screenFeedback=null]
 * @param {object | null} [options.scene=null]
 * @param {object | null} [options.THREE=null]
 * @param {boolean} [options.is2D=false]
 * @param {ReturnType<typeof createVisualPrng>} [options.prng]
 */
export function createEffectPlayer({
  atlasParticles = null,
  meshVfx = null,
  trails = null,
  telegraphs = null,
  hitstop = null,
  shake = null,
  screenFeedback = null,
  scene = /** @type {object | null} */ (null),
  THREE = /** @type {object | null} */ (null),
  is2D = false,
  prng = createVisualPrng(0x9e3779b9),
} = {}) {
  const registry = new Map();
  let nextEffectId = 1;
  let totalPlayed = 0;
  let disposed = false;

  const scratchPos = new Float32Array(3);
  const scratchVel = new Float32Array(3);
  const scratchDir = new Float32Array(3);
  const scratchRgb = [1, 1, 1];
  const scratchTintA = [1, 1, 1];
  const scratchTintB = [1, 1, 1];
  const scratchTintOut = [1, 1, 1];

  function readMagnitude(val, fallback = 0) {
    if (Array.isArray(val)) {
      const a = Math.abs(Number(val[0] ?? 0));
      const b = Math.abs(Number(val[1] ?? a));
      return Math.max(a, b);
    }
    if (typeof val === 'number' && Number.isFinite(val)) return Math.abs(val);
    return fallback;
  }

  function sampleStartColor(startColor, out) {
    if (!startColor) {
      out[0] = 1;
      out[1] = 1;
      out[2] = 1;
      return out;
    }
    if (Array.isArray(startColor) && startColor.length === 2 && (Array.isArray(startColor[0]) || typeof startColor[0] === 'string' || typeof startColor[0] === 'number')) {
      parseColorRgb01(startColor[0], scratchTintA);
      parseColorRgb01(startColor[1], scratchTintB);
      const t = prng.nextFloat();
      out[0] = scratchTintA[0] + (scratchTintB[0] - scratchTintA[0]) * t;
      out[1] = scratchTintA[1] + (scratchTintB[1] - scratchTintA[1]) * t;
      out[2] = scratchTintA[2] + (scratchTintB[2] - scratchTintA[2]) * t;
      return out;
    }
    return parseColorRgb01(startColor, out);
  }

  // Pre-allocated point light pool (3D only, max 8 concurrent dynamic VFX lights).
  const lightSlots = [];
  if (THREE && scene && THREE.PointLight) {
    for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 10, 2);
      light.visible = false;
      light.name = `HGameVfxPointLight_${i}`;
      scene.add(light);
      lightSlots.push({
        active: false,
        age: 0,
        duration: 0.3,
        maxIntensity: 1,
        loop: false,
        light,
      });
    }
  }

  // Pre-allocated trail follower pool for `layer.trail` particles.
  const trailFollowers = [];
  for (let i = 0; i < MAX_TRAIL_FOLLOWERS; i++) {
    trailFollowers.push({
      active: false,
      trailId: -1,
      age: 0,
      duration: 0.5,
      trailLifetime: 0.15,
      sampleAccum: 0,
      x0: 0, y0: 0, z0: 0,
      vx: 0, vy: 0, vz: 0,
      gravity: 0, drag: 0,
      noiseStrength: 0, noiseYScale: 1, noiseFreq: 0.5, phase: 0,
      orbitalY: 0, centerOffX: 0, centerOffZ: 0,
      sizeCurve: null, sizeAffectsWidth: true,
      trackedSlot: -1,
    });
  }

  // Pre-allocated CPU-tracked particle pool for CollisionModule & SubModule layers.
  const trackedParticles = [];
  for (let i = 0; i < MAX_TRACKED_PARTICLES; i++) {
    trackedParticles.push({
      active: false,
      additive: false,
      atlasSlot: -1,
      age: 0,
      duration: 1,
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      gravity: 0, drag: 0,
      hasCollision: false,
      groundY: 0, bounce: 0.45, dampen: 0.2, minSpeed: 0.15, bouncesLeft: 3,
      /** @type {Array<{ trigger?: string, effect?: string | object, probability?: number }> | null} */
      subEmitters: null,
      subDepth: 0,
    });
  }

  // Pre-allocated composite effect slots + layer states.
  const effectSlots = [];
  for (let i = 0; i < MAX_ACTIVE_EFFECTS; i++) {
    const layers = [];
    for (let l = 0; l < MAX_LAYERS_PER_EFFECT; l++) {
      layers.push({
        rateAccum: 0,
        burstCyclesDone: new Uint16Array(MAX_BURSTS_PER_LAYER),
        burstNextTime: new Float32Array(MAX_BURSTS_PER_LAYER),
        triggeredOnce: false,
      });
    }
    const slot = {
      active: false,
      id: 0,
      /** @type {object | null} */
      recipe: null,
      age: 0,
      cycleAge: 0,
      duration: 1,
      loop: false,
      x: 0, y: 0, z: 0,
      yaw: 0,
      scale: 1,
      subDepth: 0,
      /** @type {{ x?: number, y?: number, z?: number, yaw?: number } | null} */
      follow: null,
      lightSlotIdx: -1,
      layers,
      /** @type {object | null} */
      handle: null,
    };
    slot.handle = {
      get id() { return slot.id; },
      isActive() { return slot.active; },
      setTransform(x = 0, y = 0, z = 0, yaw = 0) {
        slot.x = x;
        slot.y = y;
        slot.z = z;
        slot.yaw = yaw;
      },
      stop() {
        stopSlot(slot);
      },
    };
    effectSlots.push(slot);
  }

  function stopSlot(slot) {
    slot.active = false;
    slot.follow = null;
    slot.recipe = null;
    if (slot.lightSlotIdx >= 0 && slot.lightSlotIdx < lightSlots.length) {
      const ls = lightSlots[slot.lightSlotIdx];
      ls.active = false;
      ls.light.intensity = 0;
      ls.light.visible = false;
      slot.lightSlotIdx = -1;
    }
  }

  function compileRecipe(recipe) {
    const res = validateVfxRecipe(recipe);
    if (!res.ok) {
      throw new Error(`Invalid VFX recipe: ${res.errors.join('; ')}`);
    }
    const compiledLayers = recipe.layers.map((layer) => {
      const curveRow = atlasParticles
        ? atlasParticles.compileCurves(layer.colorCurve, layer.sizeCurve)
        : 0;
      return {
        ...layer,
        _curveRow: curveRow,
        _kind: layer.kind ?? 'particle',
      };
    });
    return {
      ...recipe,
      duration: recipe.duration ?? 2.0,
      loop: Boolean(recipe.loop),
      layers: compiledLayers,
    };
  }

  /**
   * Validates and pre-compiles a `.vfx.json` recipe into the player registry.
   * @param {object} recipe
   * @returns {object}
   */
  function registerEffect(recipe) {
    const compiled = compileRecipe(recipe);
    registry.set(compiled.id, compiled);
    return compiled;
  }

  function allocTrailFollower(
    x0, y0, z0,
    vx, vy, vz,
    gravity, drag,
    noiseStrength, noiseYScale, noiseFreq, phase,
    particleDur, initialAge, trailCfg, tintRgb,
    orbitalY = 0, centerOffX = 0, centerOffZ = 0,
    sizeStart = 1, sizeCurve = null,
    trackedSlot = -1,
  ) {
    if (!trails || typeof trails.allocTrail !== 'function') return;
    let slot = null;
    for (let i = 0; i < MAX_TRAIL_FOLLOWERS; i++) {
      if (!trailFollowers[i].active) {
        slot = trailFollowers[i];
        break;
      }
    }
    if (!slot) return;
    const baseColor = trailCfg.inheritColor
      ? packRgb24(Math.round(tintRgb[0] * 255), Math.round(tintRgb[1] * 255), Math.round(tintRgb[2] * 255))
      : parseColorNumber(trailCfg.color, 0xff9f43);
    const endColor = trailCfg.endColor !== undefined ? parseColorNumber(trailCfg.endColor, baseColor) : baseColor;
    const sizeAffectsWidth = trailCfg.sizeAffectsWidth !== false;
    const widthVal = trailCfg.widthOverTrail !== undefined
      ? readRange(trailCfg.widthOverTrail, 1, 1, prng) * (sizeAffectsWidth ? sizeStart : 1)
      : readRange(trailCfg.width, 0.08, 0.08, prng);
    const width = Math.max(0.002, widthVal);
    const endWidth = trailCfg.endWidth ?? 0;
    const trailLifetime = Math.max(0.03, readRange(trailCfg.lifetime, 0.15, 0.15, prng));
    const tid = trails.allocTrail({
      color: baseColor,
      endColor,
      width,
      endWidth,
      hdr: trailCfg.hdr ?? 1.0,
      lifetime: trailLifetime,
      blend: trailCfg.blend || 'additive',
    });
    if (tid < 0) return;

    slot.active = true;
    slot.trailId = tid;
    slot.age = initialAge;
    slot.duration = particleDur;
    slot.trailLifetime = trailLifetime;
    slot.sampleAccum = 0;
    slot.x0 = x0;
    slot.y0 = y0;
    slot.z0 = z0;
    slot.vx = vx;
    slot.vy = vy;
    slot.vz = vz;
    slot.gravity = gravity;
    slot.drag = drag;
    slot.noiseStrength = noiseStrength;
    slot.noiseYScale = noiseYScale;
    slot.noiseFreq = noiseFreq;
    slot.phase = phase;
    slot.orbitalY = orbitalY;
    slot.centerOffX = centerOffX;
    slot.centerOffZ = centerOffZ;
    slot.sizeCurve = sizeAffectsWidth && Array.isArray(sizeCurve) ? sizeCurve : null;
    slot.sizeAffectsWidth = sizeAffectsWidth;
    slot.trackedSlot = trackedSlot;

    if (slot.sizeCurve && typeof trails.setTrailWidthScale === 'function') {
      trails.setTrailWidthScale(tid, evaluateSizeCurve(slot.sizeCurve, Math.min(1, initialAge / Math.max(0.01, particleDur))));
    }
    if (initialAge > 0.005) {
      const nowT = typeof trails.getTime === 'function' ? trails.getTime() : 0;
      const tStart = Math.max(0, initialAge - trailLifetime);
      const samples = 6;
      for (let s = 0; s <= samples; s++) {
        const a = tStart + ((initialAge - tStart) * s) / samples;
        evaluateAtlasParticlePosition(
          x0, y0, z0, vx, vy, vz, gravity, drag,
          noiseStrength, noiseFreq, phase, a, is2D, scratchPos,
          orbitalY, centerOffX, centerOffZ, noiseYScale,
        );
        trails.pushTrailPoint(tid, scratchPos[0], scratchPos[1], scratchPos[2], nowT - (initialAge - a));
      }
    } else {
      trails.pushTrailPoint(tid, x0, y0, z0);
    }
  }

  function fireSubEmitters(subEmitters, triggerType, x, y, z, depth) {
    if (!Array.isArray(subEmitters) || depth >= 2) return;
    for (let i = 0; i < subEmitters.length; i++) {
      const sub = subEmitters[i];
      if (!sub || (sub.trigger || 'death') !== triggerType || !sub.effect) continue;
      const prob = sub.probability ?? 1.0;
      if (prob < 1.0 && prng.nextFloat() > prob) continue;
      if (typeof sub.effect === 'string' && !registry.has(sub.effect)) continue;
      playEffect(sub.effect, { x, y, z, _subDepth: depth + 1 });
    }
  }

  function allocTrackedParticle({
    additive, atlasSlot, duration,
    x, y, z, vx, vy, vz, gravity, drag,
    collision, subEmitters, subDepth,
  }) {
    for (let i = 0; i < MAX_TRACKED_PARTICLES; i++) {
      const tp = trackedParticles[i];
      if (!tp.active) {
        tp.active = true;
        tp.additive = additive;
        tp.atlasSlot = atlasSlot;
        tp.age = 0;
        tp.duration = duration;
        tp.x = x;
        tp.y = y;
        tp.z = z;
        tp.vx = vx;
        tp.vy = vy;
        tp.vz = vz;
        tp.gravity = gravity;
        tp.drag = drag;
        tp.hasCollision = Boolean(collision);
        tp.groundY = collision?.groundY ?? 0;
        tp.bounce = collision?.bounce ?? 0.45;
        tp.dampen = collision?.dampen ?? 0.2;
        tp.minSpeed = collision?.minSpeed ?? 0.15;
        tp.bouncesLeft = collision?.maxBounces ?? 3;
        tp.subEmitters = Array.isArray(subEmitters) ? subEmitters : null;
        tp.subDepth = subDepth;
        return i;
      }
    }
    return -1;
  }

  function sampleShapeAndVelocity(layer, slot, scale) {
    const shape = layer.shape || {};
    const sType = shape.type || 'point';
    const rad = (shape.radius ?? 0) * scale;
    const rt = shape.radiusThickness !== undefined
      ? Math.max(0, Math.min(1, Number(shape.radiusThickness)))
      : (shape.shell ? 0 : 1);
    let lx = 0;
    let ly = 0;
    let lz = 0;
    let dx = 0;
    let dy = 1;
    let dz = 0;

    if (sType === 'sphere' || sType === 'hemisphere') {
      const ang = prng.nextFloat() * 6.283185307179586;
      const elev = sType === 'hemisphere' ? prng.range(0, 1) : prng.range(-1, 1);
      const horiz = Math.sqrt(Math.max(0, 1 - elev * elev));
      dx = Math.cos(ang) * horiz;
      dy = is2D ? Math.sin(ang) : elev;
      dz = is2D ? 0 : Math.sin(ang) * horiz;
      if (is2D) dx = Math.cos(ang);
      const r = rad * Math.cbrt(1 - rt + prng.nextFloat() * rt);
      lx = dx * r;
      ly = dy * r;
      lz = dz * r;
    } else if (sType === 'circle') {
      const ang = prng.nextFloat() * 6.283185307179586;
      const r = rad * Math.sqrt(1 - rt + prng.nextFloat() * rt);
      lx = Math.cos(ang) * r;
      ly = is2D ? Math.sin(ang) * r : 0;
      lz = is2D ? 0 : Math.sin(ang) * r;
      dx = Math.cos(ang);
      dy = is2D ? Math.sin(ang) : 0;
      dz = is2D ? 0 : Math.sin(ang);
    } else if (sType === 'edge') {
      const len = (shape.radius ?? 1) * scale;
      lx = prng.range(-len, len);
      dx = 0;
      dy = is2D ? -1 : 1;
      dz = 0;
    } else if (sType === 'cone') {
      const ang = prng.nextFloat() * 6.283185307179586;
      const halfCone = ((shape.angle ?? 25) * Math.PI) / 180;
      const tilt = prng.range(0, halfCone);
      const sinT = Math.sin(tilt);
      const cosT = Math.cos(tilt);
      dx = Math.cos(ang) * sinT;
      dy = is2D ? Math.sin(ang) * sinT : cosT;
      dz = is2D ? 0 : Math.sin(ang) * sinT;
      const r = rad * Math.sqrt(1 - rt + prng.nextFloat() * rt);
      lx = Math.cos(ang) * r;
      ly = is2D ? Math.sin(ang) * r : 0;
      lz = is2D ? 0 : Math.sin(ang) * r;
    } else if (sType === 'box') {
      const bx = (shape.size?.[0] ?? 1) * 0.5 * scale;
      const by = (shape.size?.[1] ?? 1) * 0.5 * scale;
      const bz = (shape.size?.[2] ?? 1) * 0.5 * scale;
      lx = prng.range(-bx, bx);
      ly = prng.range(-by, by);
      lz = is2D ? 0 : prng.range(-bz, bz);
      dx = 0;
      dy = is2D ? -1 : 1;
      dz = 0;
    } else {
      const ang = prng.nextFloat() * 6.283185307179586;
      dx = Math.cos(ang);
      dy = is2D ? Math.sin(ang) : prng.range(-0.3, 1.0);
      dz = is2D ? 0 : Math.sin(ang);
      const norm = Math.hypot(dx, dy, dz) || 1;
      dx /= norm;
      dy /= norm;
      dz /= norm;
    }

    if (Array.isArray(shape.scale)) {
      const sx = Number(shape.scale[0] ?? 1);
      const sy = Number(shape.scale[1] ?? 1);
      const sz = Number(shape.scale[2] ?? 1);
      lx *= sx;
      ly *= sy;
      lz *= sz;
      if (rad > 0.0001) {
        const nx = lx;
        const ny = ly;
        const nz = lz;
        const nLen = Math.hypot(nx, ny, nz);
        if (nLen > 0.0001) {
          dx = nx / nLen;
          dy = ny / nLen;
          dz = nz / nLen;
        }
      }
    }

    const off = layer.offset;
    if (Array.isArray(off)) {
      lx += (off[0] ?? 0) * scale;
      ly += (off[1] ?? 0) * scale;
      lz += (off[2] ?? 0) * scale;
    }

    const cYaw = Math.cos(slot.yaw);
    const sYaw = Math.sin(slot.yaw);
    if (is2D) {
      scratchPos[0] = slot.x + lx * cYaw - ly * sYaw;
      scratchPos[1] = slot.y + lx * sYaw + ly * cYaw;
      scratchPos[2] = slot.z;
      scratchDir[0] = dx * cYaw - dy * sYaw;
      scratchDir[1] = dx * sYaw + dy * cYaw;
      scratchDir[2] = 0;
    } else {
      scratchPos[0] = slot.x + lx * cYaw - lz * sYaw;
      scratchPos[1] = slot.y + ly;
      scratchPos[2] = slot.z + lx * sYaw + lz * cYaw;
      scratchDir[0] = dx * cYaw - dz * sYaw;
      scratchDir[1] = dy;
      scratchDir[2] = dx * sYaw + dz * cYaw;
    }

    const spd = readRange(layer.speed, 0, 0, prng) * scale;
    let vx = scratchDir[0] * spd;
    let vy = scratchDir[1] * spd;
    let vz = scratchDir[2] * spd;

    const vel = layer.velocity;
    if (vel) {
      if (Array.isArray(vel.linear)) {
        const lvx = readRange(vel.linear[0], 0, 0, prng) * scale;
        const lvy = readRange(vel.linear[1], 0, 0, prng) * scale;
        const lvz = readRange(vel.linear[2], 0, 0, prng) * scale;
        vx += is2D ? (lvx * cYaw - lvy * sYaw) : (lvx * cYaw - lvz * sYaw);
        vy += is2D ? (lvx * sYaw + lvy * cYaw) : lvy;
        vz += is2D ? 0 : (lvx * sYaw + lvz * cYaw);
      }
      const radVel = vel.radial !== undefined ? readRange(vel.radial, 0, 0, prng) : 0;
      if (radVel !== 0) {
        const ox = scratchPos[0] - slot.x;
        const oy = scratchPos[1] - slot.y;
        const oz = scratchPos[2] - slot.z;
        const len = Math.hypot(ox, oy, oz) || 1;
        vx += (ox / len) * radVel * scale;
        vy += (oy / len) * radVel * scale;
        vz += (oz / len) * radVel * scale;
      }
    }

    scratchVel[0] = vx;
    scratchVel[1] = vy;
    scratchVel[2] = vz;
  }

  function emitParticleOrMesh(layer, slot, initialAge = 0) {
    const scale = slot.scale;
    sampleShapeAndVelocity(layer, slot, scale);
    const dur = Math.max(0.02, readRange(layer.life, 0.4, 0.8, prng));
    const clampedInitAge = Math.min(Math.max(0, initialAge), Math.max(0, dur - 0.02));
    const sizeStart = readRange(layer.size, 0.5, 0.5, prng) * scale;
    const rot0 = readRange(layer.rotation, 0, 0, prng);
    const angVel = readRange(layer.angularVel, 0, 0, prng);
    const gravity = (layer.gravity ?? 0) * scale;
    const drag = layer.drag ?? 0;
    const noiseStrength = readMagnitude(layer.noise?.strength, 0) * scale;
    const noiseYRaw = layer.noise?.strengthY !== undefined
      ? readMagnitude(layer.noise.strengthY, 0) * scale
      : noiseStrength;
    const noiseYScale = noiseStrength > 0.0001 ? Math.min(2.0, noiseYRaw / noiseStrength) : 1.0;
    const noiseFreq = layer.noise?.frequency ?? 0.5;
    const phase = prng.nextFloat();
    const rawOrbY = layer.velocity?.orbitalY ?? layer.velocity?.orbital?.[1] ?? 0;
    const orbitalY = readRange(rawOrbY, 0, 0, prng);
    const centerOffX = scratchPos[0] - slot.x;
    const centerOffZ = scratchPos[2] - slot.z;
    sampleStartColor(layer.startColor, scratchTintOut);
    const tintRgb24 = packRgb24(
      Math.round(scratchTintOut[0] * 255),
      Math.round(scratchTintOut[1] * 255),
      Math.round(scratchTintOut[2] * 255),
    );

    if (layer._kind === 'mesh' || layer.renderMode === 'mesh') {
      if (!meshVfx) return;
      const alignDir = Boolean(layer.alignToVelocity || layer.shape?.alignToDirection);
      meshVfx.spawn({
        mesh: layer.mesh || 'crystal',
        x: scratchPos[0],
        y: scratchPos[1],
        z: scratchPos[2],
        vx: scratchVel[0],
        vy: scratchVel[1],
        vz: scratchVel[2],
        dirX: alignDir ? scratchDir[0] : undefined,
        dirY: alignDir ? scratchDir[1] : undefined,
        dirZ: alignDir ? scratchDir[2] : undefined,
        gravity,
        drag,
        orbitalY,
        centerX: slot.x,
        centerZ: slot.z,
        duration: dur,
        sizeStart,
        rotX: layer.rotX ?? 0,
        rotY: rot0,
        rotZ: layer.rotZ ?? 0,
        spinX: layer.spin?.[0] ?? 0,
        spinY: layer.spin?.[1] ?? angVel,
        spinZ: layer.spin?.[2] ?? 0,
        alignToVelocity: alignDir,
        forwardAxis: layer.forwardAxis,
        hdr: layer.hdr ?? 1.0,
        tint: scratchTintOut,
        lit: layer.lit,
        emission: layer.emission,
        cullMode: layer.cullMode,
        opaque: layer.opaque,
        blend: layer.blend ?? 'alpha',
        colorCurve: layer.colorCurve,
        sizeCurve: layer.sizeCurve,
        uvScroll: layer.uvScroll,
        fresnel: layer.fresnel,
        dissolve: layer.dissolve,
      });
      return;
    }

    if (!atlasParticles) return;
    const additive = layer.blend === 'additive';
    const needsTracking = Boolean(layer.collision) || (Array.isArray(layer.subEmitters) && layer.subEmitters.length > 0);
    const atlasSlot = atlasParticles.emit({
      x: scratchPos[0],
      y: scratchPos[1],
      z: scratchPos[2],
      vx: scratchVel[0],
      vy: scratchVel[1],
      vz: scratchVel[2],
      duration: dur,
      initialAge: clampedInitAge,
      sizeStart,
      gravity,
      drag,
      staticPos: Boolean(layer.collision),
      curveRow: layer._curveRow,
      rotation: rot0,
      angularVel: angVel,
      hdr: layer.hdr ?? 1.0,
      tintRgb24,
      orbitalY,
      centerOffX,
      centerOffZ,
      renderMode: layer.renderMode ?? 'billboard',
      blend: layer.blend ?? 'alpha',
      sprite: layer.sprite,
      flipbook: layer.flipbook,
      uvRect: layer.uvRect,
      noiseStrength,
      noiseYScale,
      noiseFreq,
      stretch: layer.stretch ?? 0.8,
      phase,
    });

    let trackedSlot = -1;
    if (needsTracking) {
      if (layer.subEmitters) {
        fireSubEmitters(layer.subEmitters, 'birth', scratchPos[0], scratchPos[1], scratchPos[2], slot.subDepth);
      }
      trackedSlot = allocTrackedParticle({
        additive,
        atlasSlot,
        duration: dur,
        x: scratchPos[0],
        y: scratchPos[1],
        z: scratchPos[2],
        vx: scratchVel[0],
        vy: scratchVel[1],
        vz: scratchVel[2],
        gravity,
        drag,
        collision: layer.collision,
        subEmitters: layer.subEmitters,
        subDepth: slot.subDepth,
      });
    }

    if (layer.trail) {
      const c0 = layer.colorCurve?.[0]?.[1];
      const trailTint = [
        scratchTintOut[0] * (c0 ? (c0[0] ?? 1) : 1),
        scratchTintOut[1] * (c0 ? (c0[1] ?? 1) : 1),
        scratchTintOut[2] * (c0 ? (c0[2] ?? 1) : 1),
      ];
      allocTrailFollower(
        scratchPos[0], scratchPos[1], scratchPos[2],
        scratchVel[0], scratchVel[1], scratchVel[2],
        gravity, drag, noiseStrength, noiseYScale, noiseFreq, phase,
        dur, clampedInitAge, layer.trail, trailTint,
        orbitalY, centerOffX, centerOffZ,
        sizeStart, layer.sizeCurve,
        trackedSlot,
      );
    }
  }

  function triggerAuxiliaryLayer(layer, slot) {
    const ox = slot.x + (layer.offset?.[0] ?? 0) * slot.scale;
    const oy = slot.y + (layer.offset?.[1] ?? 0) * slot.scale;
    const oz = slot.z + (layer.offset?.[2] ?? 0) * slot.scale;
    const col = parseColorNumber(layer.color, 0xffd166);
    if (layer._kind === 'slash' && trails) {
      trails.slashArc({
        x: ox, y: oy, z: oz,
        yawRad: slot.yaw + (layer.yawOffset ?? 0),
        sweepRad: layer.sweepRad ?? 2.1,
        radius: (layer.radius ?? 2.2) * slot.scale,
        color: col,
        duration: layer.duration ?? 0.16,
      });
    } else if (layer._kind === 'lightning' && trails) {
      trails.lightningBolt({
        x0: ox, y0: oy, z0: oz,
        x1: ox + (layer.endOffset?.[0] ?? 0) * slot.scale,
        y1: oy + (layer.endOffset?.[1] ?? 3) * slot.scale,
        z1: oz + (layer.endOffset?.[2] ?? 0) * slot.scale,
        color: col,
        thickness: (layer.thickness ?? 0.12) * slot.scale,
        duration: layer.duration ?? 0.14,
      });
    } else if (layer._kind === 'telegraph' && telegraphs) {
      telegraphs.spawnTelegraph({
        shape: layer.shape ?? 'circle',
        x: ox, y: oy, z: oz,
        yawRad: slot.yaw,
        radius: (layer.radius ?? 3) * slot.scale,
        duration: layer.duration ?? 0.8,
        color: col,
      });
    }
  }

  function triggerJuice(recipe, slot) {
    const j = recipe.juice;
    if (!j) return;
    if (j.hitstop && hitstop) hitstop.trigger(j.hitstop, j.hitstopScale ?? 0.05);
    if (j.shakeTrauma && shake) shake.impulse(j.shakeTrauma, 0, 1, 0);
    if (j.screenPulse && screenFeedback) {
      screenFeedback.screenPulse({
        color: parseColorNumber(j.screenPulse.color, 0xff6a1a),
        strength: j.screenPulse.strength ?? j.screenPulse.alpha ?? 0.35,
        duration: j.screenPulse.duration ?? 0.22,
      });
    }
    if (j.lightPulse && lightSlots.length > 0) {
      let li = -1;
      for (let i = 0; i < lightSlots.length; i++) {
        if (!lightSlots[i].active) {
          li = i;
          break;
        }
      }
      if (li === -1) li = 0;
      const ls = lightSlots[li];
      ls.active = true;
      ls.age = 0;
      ls.duration = Math.max(0.05, j.lightPulse.duration ?? 0.35);
      ls.maxIntensity = j.lightPulse.intensity ?? 2.0;
      ls.loop = Boolean(recipe.loop);
      parseColorRgb01(j.lightPulse.color, scratchRgb);
      ls.light.color.setRGB(scratchRgb[0], scratchRgb[1], scratchRgb[2]);
      ls.light.distance = j.lightPulse.range ?? 10;
      ls.light.position.set(
        slot.x + (j.lightPulse.offset?.[0] ?? 0) * slot.scale,
        slot.y + (j.lightPulse.offset?.[1] ?? 0.5) * slot.scale,
        slot.z + (j.lightPulse.offset?.[2] ?? 0) * slot.scale,
      );
      ls.light.intensity = ls.maxIntensity;
      ls.light.visible = true;
      slot.lightSlotIdx = li;
    }
  }

  /**
   * Plays a registered recipe ID or inline `.vfx.json` recipe object.
   * @param {string | object} recipeOrId
   * @param {object} [options]
   * @returns {object | null} Effect handle with `setTransform`, `stop`, `isActive`, `id`
   */
  function playEffect(recipeOrId, options = {}) {
    if (disposed) return null;
    let compiled;
    if (typeof recipeOrId === 'string') {
      compiled = registry.get(recipeOrId);
      if (!compiled) throw new Error(`Unknown VFX recipe id: "${recipeOrId}"`);
    } else {
      const id = recipeOrId?.id;
      compiled = id && registry.has(id) ? registry.get(id) : registerEffect(recipeOrId);
    }

    let slot = null;
    for (let i = 0; i < MAX_ACTIVE_EFFECTS; i++) {
      if (!effectSlots[i].active) {
        slot = effectSlots[i];
        break;
      }
    }
    if (!slot) {
      slot = effectSlots[0];
      stopSlot(slot);
    }

    slot.active = true;
    slot.id = nextEffectId++;
    slot.recipe = compiled;
    slot.age = 0;
    slot.cycleAge = 0;
    slot.duration = compiled.duration;
    slot.loop = compiled.loop;
    slot.follow = options.follow ?? null;
    slot.x = slot.follow?.x ?? options.x ?? 0;
    slot.y = slot.follow?.y ?? options.y ?? 0;
    slot.z = slot.follow?.z ?? options.z ?? 0;
    slot.yaw = slot.follow?.yaw ?? options.yaw ?? 0;
    slot.scale = options.scale ?? 1;
    slot.subDepth = options._subDepth ?? 0;
    slot.lightSlotIdx = -1;

    for (let l = 0; l < compiled.layers.length; l++) {
      const ls = slot.layers[l];
      ls.rateAccum = 0;
      ls.triggeredOnce = false;
      const bursts = compiled.layers[l].bursts;
      for (let b = 0; b < MAX_BURSTS_PER_LAYER; b++) {
        ls.burstCyclesDone[b] = 0;
        ls.burstNextTime[b] = bursts && bursts[b] ? (bursts[b].time ?? 0) : 0;
      }
    }

    triggerJuice(compiled, slot);
    totalPlayed += 1;

    // Immediately evaluate t=0 bursts and prewarmed looping layers so frame 1 is populated.
    for (let l = 0; l < compiled.layers.length; l++) {
      const layer = compiled.layers[l];
      if (!layer.prewarm) continue;
      const avgRate = Array.isArray(layer.rate)
        ? (Number(layer.rate[0] ?? 0) + Number(layer.rate[1] ?? layer.rate[0] ?? 0)) * 0.5
        : Number(layer.rate ?? 0);
      const avgLife = Array.isArray(layer.life)
        ? (Number(layer.life[0] ?? 1) + Number(layer.life[1] ?? layer.life[0] ?? 1)) * 0.5
        : Number(layer.life ?? 1);
      if (avgRate > 0 && avgLife > 0.05) {
        const warmCount = Math.min(180, Math.max(1, Math.round(avgRate * avgLife)));
        for (let k = 0; k < warmCount; k++) {
          const frac = (k + prng.nextFloat()) / warmCount;
          emitParticleOrMesh(layer, slot, frac * avgLife);
        }
      }
    }
    stepSlotLayers(slot, 0);
    return slot.handle;
  }

  function stepSlotLayers(slot, dt) {
    const recipe = slot.recipe;
    if (!recipe) return;
    const layers = recipe.layers;
    for (let l = 0; l < layers.length; l++) {
      const layer = layers[l];
      const ls = slot.layers[l];
      const delay = layer.delay ?? 0;
      const localAge = slot.cycleAge - delay;
      if (localAge < 0) continue;

      if (layer._kind === 'slash' || layer._kind === 'lightning' || layer._kind === 'telegraph') {
        if (!ls.triggeredOnce) {
          ls.triggeredOnce = true;
          triggerAuxiliaryLayer(layer, slot);
        }
        continue;
      }

      if (Array.isArray(layer.bursts)) {
        const bLen = Math.min(layer.bursts.length, MAX_BURSTS_PER_LAYER);
        for (let b = 0; b < bLen; b++) {
          const burst = layer.bursts[b];
          const cycles = Math.max(1, burst.cycles ?? 1);
          const interval = Math.max(0.01, burst.interval ?? 0.01);
          while (ls.burstCyclesDone[b] < cycles && localAge >= ls.burstNextTime[b]) {
            const count = Math.max(1, Math.round(readRange(burst.count, 1, 1, prng)));
            for (let c = 0; c < count; c++) {
              emitParticleOrMesh(layer, slot);
            }
            ls.burstCyclesDone[b] += 1;
            ls.burstNextTime[b] += interval;
          }
        }
      }

      const rate = layer.rate !== undefined ? readRange(layer.rate, 0, 0, prng) : 0;
      if (rate > 0 && dt > 0) {
        const layerDur = layer.duration ?? slot.duration;
        if (slot.loop || localAge <= layerDur) {
          ls.rateAccum += rate * dt;
          while (ls.rateAccum >= 1) {
            ls.rateAccum -= 1;
            emitParticleOrMesh(layer, slot);
          }
        }
      }
    }
  }

  function update(visualDt) {
    const dt = Math.max(0, visualDt);

    for (let i = 0; i < MAX_ACTIVE_EFFECTS; i++) {
      const slot = effectSlots[i];
      if (!slot.active || !slot.recipe) continue;

      if (slot.follow) {
        if (slot.follow.x !== undefined) slot.x = slot.follow.x;
        if (slot.follow.y !== undefined) slot.y = slot.follow.y;
        if (slot.follow.z !== undefined) slot.z = slot.follow.z;
        if (slot.follow.yaw !== undefined) slot.yaw = slot.follow.yaw;
      }

      slot.age += dt;
      slot.cycleAge += dt;

      if (slot.loop && slot.cycleAge >= slot.duration) {
        slot.cycleAge %= slot.duration;
        for (let l = 0; l < slot.recipe.layers.length; l++) {
          const ls = slot.layers[l];
          ls.triggeredOnce = false;
          const bursts = slot.recipe.layers[l].bursts;
          for (let b = 0; b < MAX_BURSTS_PER_LAYER; b++) {
            ls.burstCyclesDone[b] = 0;
            ls.burstNextTime[b] = bursts && bursts[b] ? (bursts[b].time ?? 0) : 0;
          }
        }
      }

      stepSlotLayers(slot, dt);

      if (slot.lightSlotIdx >= 0 && slot.lightSlotIdx < lightSlots.length) {
        const ls = lightSlots[slot.lightSlotIdx];
        ls.light.position.x = slot.x;
        ls.light.position.z = slot.z;
      }

      if (!slot.loop && slot.age >= slot.duration) {
        stopSlot(slot);
      }
    }

    for (let i = 0; i < lightSlots.length; i++) {
      const ls = lightSlots[i];
      if (!ls.active) continue;
      if (!ls.loop) {
        ls.age += dt;
        if (ls.age >= ls.duration) {
          ls.active = false;
          ls.light.intensity = 0;
          ls.light.visible = false;
        } else {
          const k = 1 - ls.age / ls.duration;
          ls.light.intensity = ls.maxIntensity * k * k;
        }
      }
    }

    for (let i = 0; i < MAX_TRACKED_PARTICLES; i++) {
      const tp = trackedParticles[i];
      if (!tp.active) continue;
      tp.age += dt;
      if (tp.age >= tp.duration) {
        if (tp.subEmitters) {
          fireSubEmitters(tp.subEmitters, 'death', tp.x, tp.y, tp.z, tp.subDepth);
        }
        tp.active = false;
        continue;
      }
      if (dt > 0) {
        if (tp.drag > 0.001) {
          const d = Math.exp(-tp.drag * dt);
          tp.vx *= d;
          tp.vy *= d;
          tp.vz *= d;
        }
        tp.vy += (is2D ? tp.gravity : -tp.gravity) * dt;
        tp.x += tp.vx * dt;
        tp.y += tp.vy * dt;
        tp.z += tp.vz * dt;
        if (tp.hasCollision && !is2D && tp.y <= tp.groundY && tp.vy < 0) {
          tp.y = tp.groundY;
          if (tp.bouncesLeft > 0 && Math.abs(tp.vy) >= tp.minSpeed) {
            tp.vy = Math.abs(tp.vy) * tp.bounce;
            const fric = Math.max(0, 1 - tp.dampen);
            tp.vx *= fric;
            tp.vz *= fric;
            tp.bouncesLeft -= 1;
          } else {
            tp.vy = 0;
            tp.vx *= 0.85;
            tp.vz *= 0.85;
          }
          if (tp.subEmitters) {
            fireSubEmitters(tp.subEmitters, 'collision', tp.x, tp.y, tp.z, tp.subDepth);
          }
        }
        if (tp.hasCollision && atlasParticles && tp.atlasSlot >= 0) {
          atlasParticles.updateSlot(tp.additive, tp.atlasSlot, tp.x, tp.y, tp.z, tp.vx, tp.vy, tp.vz);
        }
      }
    }

    if (trails) {
      for (let i = 0; i < MAX_TRAIL_FOLLOWERS; i++) {
        const tf = trailFollowers[i];
        if (!tf.active) continue;
        tf.age += dt;
        if (tf.age >= tf.duration) {
          trails.freeTrail(tf.trailId);
          tf.active = false;
          tf.trailId = -1;
          continue;
        }
        if (tf.sizeCurve && typeof trails.setTrailWidthScale === 'function') {
          trails.setTrailWidthScale(tf.trailId, evaluateSizeCurve(tf.sizeCurve, Math.min(1, tf.age / Math.max(0.01, tf.duration))));
        }
        let px;
        let py;
        let pz;
        if (tf.trackedSlot >= 0 && trackedParticles[tf.trackedSlot]?.active) {
          const tp = trackedParticles[tf.trackedSlot];
          px = tp.x;
          py = tp.y;
          pz = tp.z;
        } else {
          evaluateAtlasParticlePosition(
            tf.x0, tf.y0, tf.z0,
            tf.vx, tf.vy, tf.vz,
            tf.gravity, tf.drag,
            tf.noiseStrength, tf.noiseFreq, tf.phase,
            tf.age, is2D, scratchPos,
            tf.orbitalY, tf.centerOffX, tf.centerOffZ,
            tf.noiseYScale,
          );
          px = scratchPos[0];
          py = scratchPos[1];
          pz = scratchPos[2];
        }
        const stepDt = Math.max(0.012, tf.trailLifetime / 6);
        tf.sampleAccum += dt;
        if (tf.sampleAccum >= stepDt || typeof trails.updateTrailHead !== 'function') {
          tf.sampleAccum = tf.sampleAccum >= stepDt ? (tf.sampleAccum % stepDt) : tf.sampleAccum;
          trails.pushTrailPoint(tf.trailId, px, py, pz);
        } else {
          trails.updateTrailHead(tf.trailId, px, py, pz);
        }
      }
    }
  }

  function stopAll() {
    for (let i = 0; i < MAX_ACTIVE_EFFECTS; i++) {
      if (effectSlots[i].active) stopSlot(effectSlots[i]);
    }
    for (let i = 0; i < MAX_TRACKED_PARTICLES; i++) {
      trackedParticles[i].active = false;
    }
    if (trails) {
      for (let i = 0; i < MAX_TRAIL_FOLLOWERS; i++) {
        if (trailFollowers[i].active) {
          trails.freeTrail(trailFollowers[i].trailId);
          trailFollowers[i].active = false;
          trailFollowers[i].trailId = -1;
        }
      }
    }
  }

  function reset() {
    stopAll();
    totalPlayed = 0;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopAll();
    for (let i = 0; i < lightSlots.length; i++) {
      scene?.remove?.(lightSlots[i].light);
    }
    lightSlots.length = 0;
    registry.clear();
  }

  function getActiveCount() {
    let n = 0;
    for (let i = 0; i < MAX_ACTIVE_EFFECTS; i++) {
      if (effectSlots[i].active) n += 1;
    }
    return n;
  }

  return {
    registerEffect,
    getEffect: (id) => registry.get(id) ?? null,
    playEffect,
    stopAll,
    update,
    reset,
    dispose,
    getStats() {
      return {
        registeredCount: registry.size,
        activeEffects: getActiveCount(),
        totalPlayed,
      };
    },
  };
}
