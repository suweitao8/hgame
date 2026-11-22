// HGame VfxPresetV2 validator, 16-point Curve LUT compiler, and built-in benchmark presets.

export const VFX_V2_SCHEMA_VERSION = 2;
export const VFX_CURVE_LUT_SAMPLES = 16;

const VALID_RENDERERS = new Set(['sprite', 'mesh', 'ribbon', 'event']);
const VALID_QUALITIES = new Set(['low', 'med', 'high']);
const VALID_SHAPES = new Set(['point', 'sphere', 'hemisphere', 'cone', 'box', 'ring']);
const VALID_BLENDS = new Set(['pma', 'alpha', 'additive']);

function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Compiles either `[v0, v1, ...]` uniform samples or `[[t0, v0], [t1, v1], ...]` keyframes
 * into a fixed 16-point `Float32Array` Curve LUT for O(1) runtime interpolation.
 * @param {number[] | Array<[number, number]> | number | null | undefined} curveRaw
 * @param {number} [defaultVal=1.0]
 * @returns {Float32Array}
 */
export function compileCurveLut16(curveRaw, defaultVal = 1.0) {
  const lut = new Float32Array(VFX_CURVE_LUT_SAMPLES);
  if (isFiniteNum(curveRaw)) {
    lut.fill(curveRaw);
    return lut;
  }
  if (!Array.isArray(curveRaw) || curveRaw.length === 0) {
    lut.fill(defaultVal);
    return lut;
  }

  /** @type {Array<[number, number]>} */
  let keys;
  if (Array.isArray(curveRaw[0])) {
    keys = curveRaw
      .filter((k) => Array.isArray(k) && k.length >= 2 && isFiniteNum(Number(k[0])) && isFiniteNum(Number(k[1])))
      .map((k) => [Math.max(0, Math.min(1, Number(k[0]))), Number(k[1])])
      .sort((a, b) => a[0] - b[0]);
  } else {
    const n = curveRaw.length;
    keys = curveRaw.map((v, i) => [
      n === 1 ? 0 : i / (n - 1),
      isFiniteNum(Number(v)) ? Number(v) : defaultVal,
    ]);
  }

  if (keys.length === 0) {
    lut.fill(defaultVal);
    return lut;
  }

  for (let i = 0; i < VFX_CURVE_LUT_SAMPLES; i++) {
    const t = i / (VFX_CURVE_LUT_SAMPLES - 1);
    if (keys.length === 1 || t <= keys[0][0]) {
      lut[i] = keys[0][1];
      continue;
    }
    const last = keys[keys.length - 1];
    if (t >= last[0]) {
      lut[i] = last[1];
      continue;
    }
    for (let j = 0; j < keys.length - 1; j++) {
      const t0 = keys[j][0];
      const t1 = keys[j + 1][0];
      if (t <= t1) {
        const span = Math.max(1e-6, t1 - t0);
        const f = (t - t0) / span;
        lut[i] = keys[j][1] + (keys[j + 1][1] - keys[j][1]) * f;
        break;
      }
    }
  }
  return lut;
}

/**
 * O(1) linear interpolation on a precompiled 16-point Curve LUT.
 * @param {Float32Array} lut
 * @param {number} age01
 * @returns {number}
 */
export function sampleCurveLut16(lut, age01) {
  const t = age01 < 0 ? 0 : age01 > 1 ? 1 : age01;
  const scaled = t * (VFX_CURVE_LUT_SAMPLES - 1);
  const idx = scaled | 0;
  if (idx >= VFX_CURVE_LUT_SAMPLES - 1) return lut[VFX_CURVE_LUT_SAMPLES - 1];
  const frac = scaled - idx;
  return lut[idx] + (lut[idx + 1] - lut[idx]) * frac;
}

/**
 * Validates a `VfxPresetV2` (`schemaVersion === 2`) declarative payload.
 * @param {object} preset
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateVfxPresetV2(preset) {
  /** @type {string[]} */
  const errors = [];
  if (!preset || typeof preset !== 'object') {
    return { ok: false, errors: ['Preset must be a non-null object'] };
  }
  if (preset.schemaVersion !== VFX_V2_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be 2 (got ${String(preset.schemaVersion)})`);
  }
  if (typeof preset.id !== 'string' || !preset.id.trim()) {
    errors.push('id must be a non-empty string');
  }
  if (!isFiniteNum(preset.duration) || preset.duration <= 0) {
    errors.push('duration must be a positive finite number');
  }
  if (preset.loop !== undefined && typeof preset.loop !== 'boolean') {
    errors.push('loop must be a boolean');
  }
  if (preset.boundsRadius !== undefined && (!isFiniteNum(preset.boundsRadius) || preset.boundsRadius < 0)) {
    errors.push('boundsRadius must be a non-negative finite number');
  }
  if (!Array.isArray(preset.emitters) || preset.emitters.length === 0) {
    errors.push('emitters must be a non-empty array');
    return { ok: false, errors };
  }

  for (let i = 0; i < preset.emitters.length; i++) {
    const em = preset.emitters[i];
    if (!em || typeof em !== 'object') {
      errors.push(`emitters[${i}] must be an object`);
      continue;
    }
    if (typeof em.id !== 'string' || !em.id.trim()) {
      errors.push(`emitters[${i}].id must be a non-empty string`);
    }
    if (!VALID_RENDERERS.has(em.renderer)) {
      errors.push(`emitters[${i}].renderer "${String(em.renderer)}" is invalid`);
    }
    if (em.minQuality !== undefined && !VALID_QUALITIES.has(em.minQuality)) {
      errors.push(`emitters[${i}].minQuality "${String(em.minQuality)}" is invalid`);
    }
    if (em.delay !== undefined && (!isFiniteNum(em.delay) || em.delay < 0)) {
      errors.push(`emitters[${i}].delay must be >= 0`);
    }
    if (em.renderer !== 'event') {
      if (em.maxParticles !== undefined && (!Number.isInteger(em.maxParticles) || em.maxParticles < 1)) {
        errors.push(`emitters[${i}].maxParticles must be a positive integer`);
      }
      if (em.shape?.type !== undefined && !VALID_SHAPES.has(em.shape.type)) {
        errors.push(`emitters[${i}].shape.type "${String(em.shape.type)}" is invalid`);
      }
      if (em.material?.blendMode !== undefined && !VALID_BLENDS.has(em.material.blendMode)) {
        errors.push(`emitters[${i}].material.blendMode "${String(em.material.blendMode)}" is invalid`);
      }
      if (em.curves) {
        for (const cName of ['size', 'alpha', 'dissolve', 'additive', 'emissive']) {
          const cVal = em.curves[cName];
          if (cVal !== undefined && !Array.isArray(cVal) && !isFiniteNum(cVal)) {
            errors.push(`emitters[${i}].curves.${cName} must be an array or number`);
          }
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function normalizeRange(val, fallbackMin, fallbackMax) {
  if (Array.isArray(val) && val.length >= 1) {
    const a = Number(val[0] ?? fallbackMin);
    const b = Number(val[1] ?? a);
    return [Math.min(a, b), Math.max(a, b)];
  }
  if (isFiniteNum(Number(val))) {
    const n = Number(val);
    return [n, n];
  }
  return [fallbackMin, fallbackMax];
}

/**
 * Compiles a validated `VfxPresetV2` into an immutable runtime descriptor with 16-point Curve LUTs.
 * @param {object} preset
 */
export function compileVfxPresetV2(preset) {
  const check = validateVfxPresetV2(preset);
  if (!check.ok) {
    throw new Error(`Invalid VfxPresetV2 "${preset?.id ?? 'unknown'}": ${check.errors.join('; ')}`);
  }

  const compiledEmitters = preset.emitters.map((em) => {
    if (em.renderer === 'event') {
      return Object.freeze({
        id: em.id,
        renderer: 'event',
        delay: Number(em.delay) || 0,
        minQuality: em.minQuality || 'low',
        events: em.events || {},
      });
    }

    const lifetime = normalizeRange(em.lifetime, 0.6, 1.0);
    const speed = normalizeRange(em.velocity?.speed, 1.0, 2.5);
    const sizeStart = normalizeRange(em.sizeStart, 1.0, 1.0);
    const bursts = Array.isArray(em.spawn?.burst)
      ? em.spawn.burst.map((b) => ({
        time: Math.max(0, Number(b?.time) || 0),
        count: Math.max(0, Math.round(Number(b?.count) || 0)),
      }))
      : [];

    const mat = em.material || {};
    const blendMode = mat.blendMode || 'alpha';
    const defaultAdditive = blendMode === 'additive' ? 1.0 : 0.0;

    return Object.freeze({
      id: em.id,
      renderer: em.renderer,
      delay: Number(em.delay) || 0,
      minQuality: em.minQuality || 'low',
      maxParticles: Math.max(1, Number(em.maxParticles) || 32),
      spawn: Object.freeze({
        burst: bursts,
        rate: Math.max(0, Number(em.spawn?.rate) || 0),
      }),
      lifetime,
      sizeStart,
      shape: Object.freeze({
        type: em.shape?.type || 'point',
        radius: Math.max(0, Number(em.shape?.radius) || 0),
        angle: Number(em.shape?.angle ?? 25),
        size: Array.isArray(em.shape?.size) ? em.shape.size : [1, 1, 1],
      }),
      velocity: Object.freeze({
        speed,
        inherit: Number(em.velocity?.inherit) || 0,
        alignVelocity: Boolean(em.velocity?.alignVelocity),
        stretchFactor: Number(em.velocity?.stretchFactor) || 0,
        dir: Array.isArray(em.velocity?.dir) ? em.velocity.dir : null,
      }),
      motion: Object.freeze({
        gravity: Number(em.motion?.gravity) || 0,
        drag: Math.max(0, Number(em.motion?.drag) || 0),
        angularVel: Array.isArray(em.motion?.angularVel) ? em.motion.angularVel : [0, 0, 0],
        curlNoise: Object.freeze({
          strength: Number(em.motion?.curlNoise?.strength) || 0,
          frequency: Number(em.motion?.curlNoise?.frequency) || 1.0,
          speed: Number(em.motion?.curlNoise?.speed) || 0.8,
        }),
        vortex: Object.freeze({
          strength: Number(em.motion?.vortex?.strength) || 0,
          axis: Array.isArray(em.motion?.vortex?.axis) ? em.motion.vortex.axis : [0, 1, 0],
          pull: Number(em.motion?.vortex?.pull) || 0,
        }),
        attractor: Object.freeze({
          strength: Number(em.motion?.attractor?.strength) || 0,
          offset: Array.isArray(em.motion?.attractor?.offset) ? em.motion.attractor.offset : [0, 0, 0],
        }),
        groundBounce: Object.freeze({
          enabled: Boolean(em.motion?.groundBounce?.enabled),
          groundY: Number(em.motion?.groundBounce?.groundY) || 0,
          restitution: Math.max(0, Math.min(1, Number(em.motion?.groundBounce?.restitution ?? 0.4))),
          friction: Math.max(0, Math.min(1, Number(em.motion?.groundBounce?.friction ?? 0.6))),
        }),
      }),
      curves: Object.freeze({
        size: compileCurveLut16(em.curves?.size, 1.0),
        alpha: compileCurveLut16(em.curves?.alpha, 1.0),
        dissolve: compileCurveLut16(em.curves?.dissolve, 0.0),
        additive: compileCurveLut16(em.curves?.additive, defaultAdditive),
        emissive: compileCurveLut16(em.curves?.emissive, 1.0),
      }),
      material: Object.freeze({
        blendMode,
        mainTex: mat.mainTex || null,
        noiseTex: mat.noiseTex || null,
        flipbook: mat.flipbook || null,
        uvScroll: mat.uvScroll || [0, 0],
        noiseScroll: mat.noiseScroll || [0, 0],
        distortionStrength: Number(mat.distortionStrength) || 0,
        dissolveEdgeWidth: Number(mat.dissolveEdgeWidth) || 0,
        dissolveEdgeColor: mat.dissolveEdgeColor || [4.0, 1.4, 0.25],
        emissiveBoost: Number(mat.emissiveBoost ?? 1.0),
        lutRow: Number.isFinite(mat.lutRow) ? Number(mat.lutRow) : -1,
        tint: mat.tint || [1, 1, 1],
        fresnelPower: Number(mat.fresnelPower) || 0,
        softParticleDepth: Number(mat.softParticleDepth) || 0,
        cameraOffset: Number(mat.cameraOffset) || 0,
        doubleSided: Boolean(mat.doubleSided),
        meshKind: mat.meshKind || 'quad',
        lightningJitter: Number(mat.lightningJitter) || 0,
        ribbonLength: Number(mat.ribbonLength) || 2.4,
      }),
      subEmitters: Object.freeze({
        onCollision: em.subEmitters?.onCollision || null,
        onDeath: em.subEmitters?.onDeath || null,
      }),
    });
  });

  return Object.freeze({
    schemaVersion: VFX_V2_SCHEMA_VERSION,
    id: preset.id,
    name: preset.name || preset.id,
    category: preset.category || 'v2 标杆预设',
    duration: Number(preset.duration),
    loop: Boolean(preset.loop),
    boundsRadius: Number(preset.boundsRadius ?? 6.0),
    emitters: Object.freeze(compiledEmitters),
  });
}

/**
 * 3 built-in benchmark presets verifying VFX v2 capabilities without external Unreal assets.
 */
export const VFX_V2_BENCHMARK_PRESETS = Object.freeze([
  Object.freeze({
    schemaVersion: 2,
    id: 'vfx_bench_explosion',
    name: '写实手雷爆炸 (PMA火转烟+碎块+闪光)',
    category: 'v2 标杆预设',
    duration: 2.2,
    loop: false,
    boundsRadius: 6.0,
    emitters: [
      {
        id: 'fireball_to_smoke',
        renderer: 'sprite',
        delay: 0.0,
        minQuality: 'low',
        maxParticles: 28,
        spawn: { burst: [{ time: 0, count: 8 }], rate: 0 },
        lifetime: [0.8, 1.35],
        sizeStart: [0.85, 1.15],
        shape: { type: 'sphere', radius: 0.35 },
        velocity: { speed: [1.4, 3.6], inherit: 0, alignVelocity: false, stretchFactor: 0.0 },
        motion: {
          gravity: -1.8,
          drag: 2.4,
          curlNoise: { strength: 1.4, frequency: 0.9, speed: 0.7 },
        },
        curves: {
          size: [0.45, 1.15, 1.65, 2.05],
          alpha: [0.0, 1.0, 0.82, 0.0],
          dissolve: [0.0, 0.0, 0.35, 0.95],
          additive: [1.0, 0.78, 0.14, 0.0],
          emissive: [1.0, 0.85, 0.2, 0.0],
        },
        material: {
          blendMode: 'pma',
          mainTex: 'builtin:fire_flipbook',
          noiseTex: 'builtin:noise_packed',
          flipbook: { cols: 4, rows: 4, fps: 18, frameBlend: true, randomStart: false, loop: false },
          noiseScroll: [0.15, -0.35],
          distortionStrength: 0.06,
          dissolveEdgeWidth: 0.12,
          dissolveEdgeColor: [4.5, 1.4, 0.25],
          emissiveBoost: 3.4,
          lutRow: 0,
          tint: [1, 1, 1],
          softParticleDepth: 0.4,
          cameraOffset: 0.15,
        },
      },
      {
        id: 'sparks_burst',
        renderer: 'sprite',
        delay: 0.0,
        minQuality: 'low',
        maxParticles: 40,
        spawn: { burst: [{ time: 0, count: 24 }], rate: 0 },
        lifetime: [0.45, 0.95],
        sizeStart: [0.12, 0.22],
        shape: { type: 'hemisphere', radius: 0.25 },
        velocity: { speed: [4.5, 10.5], inherit: 0, alignVelocity: true, stretchFactor: 0.22 },
        motion: {
          gravity: 12.0,
          drag: 1.2,
          curlNoise: { strength: 1.1, frequency: 1.5, speed: 1.2 },
          groundBounce: { enabled: true, groundY: 0, restitution: 0.45, friction: 0.65 },
        },
        curves: {
          size: [1.0, 0.85, 0.45, 0.1],
          alpha: [1.0, 1.0, 0.7, 0.0],
          additive: [1, 1, 1, 1],
        },
        material: {
          blendMode: 'additive',
          mainTex: 'builtin:soft_disc',
          emissiveBoost: 3.6,
          lutRow: 0,
          tint: [1.0, 0.78, 0.35],
          cameraOffset: 0.08,
        },
      },
      {
        id: 'debris_chunks',
        renderer: 'mesh',
        delay: 0.0,
        minQuality: 'med',
        maxParticles: 20,
        spawn: { burst: [{ time: 0, count: 14 }], rate: 0 },
        lifetime: [0.85, 1.4],
        sizeStart: [0.1, 0.22],
        shape: { type: 'hemisphere', radius: 0.3 },
        velocity: { speed: [3.2, 7.8], inherit: 0 },
        motion: {
          gravity: 16.0,
          drag: 0.6,
          angularVel: [6.0, 9.0, 5.0],
          groundBounce: { enabled: true, groundY: 0, restitution: 0.38, friction: 0.55 },
        },
        curves: {
          size: [1.0, 1.0, 0.85, 0.0],
          alpha: [1.0, 1.0, 1.0, 0.0],
        },
        material: {
          blendMode: 'alpha',
          meshKind: 'shard',
          mainTex: 'builtin:soft_disc',
          lutRow: 1,
          tint: [0.55, 0.52, 0.48],
        },
      },
      {
        id: 'shockwave_ring',
        renderer: 'mesh',
        delay: 0.0,
        minQuality: 'med',
        maxParticles: 4,
        spawn: { burst: [{ time: 0, count: 1 }], rate: 0 },
        lifetime: [0.38, 0.38],
        sizeStart: [1.0, 1.0],
        shape: { type: 'point', radius: 0 },
        velocity: { speed: [0, 0], dir: [0, 0, 0] },
        curves: {
          size: [0.35, 2.2, 3.6, 4.4],
          alpha: [0.85, 0.55, 0.2, 0.0],
        },
        material: {
          blendMode: 'additive',
          meshKind: 'ring',
          mainTex: 'builtin:soft_disc',
          fresnelPower: 1.8,
          emissiveBoost: 2.6,
          tint: [1.0, 0.72, 0.32],
          doubleSided: true,
        },
      },
      {
        id: 'flash_shake_decal',
        renderer: 'event',
        delay: 0.0,
        minQuality: 'low',
        events: {
          pointLightFlash: { color: [1.0, 0.65, 0.25], intensity: 8.0, radius: 8.0, duration: 0.2 },
          cameraShake: { intensity: 0.35, duration: 0.28 },
          spawnDecal: { decalId: 'decal_scorch_01', scale: [2.2, 2.2], randomRotation: true },
          playCue: 'sfx_explosion_mid',
        },
      },
    ],
  }),
  Object.freeze({
    schemaVersion: 2,
    id: 'vfx_bench_slash_shield',
    name: 'ARPG 噪声刀光 + 能量护盾',
    category: 'v2 标杆预设',
    duration: 1.5,
    loop: false,
    boundsRadius: 4.5,
    emitters: [
      {
        id: 'arc_slash',
        renderer: 'mesh',
        delay: 0.0,
        minQuality: 'low',
        maxParticles: 4,
        spawn: { burst: [{ time: 0, count: 1 }], rate: 0 },
        lifetime: [0.45, 0.45],
        sizeStart: [1.9, 1.9],
        shape: { type: 'point', radius: 0 },
        velocity: { speed: [0, 0], dir: [0, 0, 0] },
        motion: { angularVel: [0, 2.8, 0] },
        curves: {
          size: [0.85, 1.05, 1.15, 1.2],
          alpha: [0.0, 1.0, 0.85, 0.0],
          dissolve: [0.02, 0.12, 0.55, 0.98],
          additive: [1, 1, 1, 1],
        },
        material: {
          blendMode: 'additive',
          meshKind: 'arc',
          mainTex: 'builtin:slash_arc',
          noiseTex: 'builtin:noise_packed',
          uvScroll: [1.1, 0.0],
          noiseScroll: [0.55, -0.75],
          distortionStrength: 0.08,
          dissolveEdgeWidth: 0.14,
          dissolveEdgeColor: [3.2, 1.4, 5.0],
          emissiveBoost: 3.2,
          tint: [0.65, 0.45, 1.0],
          fresnelPower: 1.6,
          doubleSided: true,
        },
      },
      {
        id: 'energy_shield',
        renderer: 'mesh',
        delay: 0.0,
        minQuality: 'low',
        maxParticles: 2,
        spawn: { burst: [{ time: 0, count: 1 }], rate: 0 },
        lifetime: [1.25, 1.25],
        sizeStart: [1.35, 1.35],
        shape: { type: 'point', radius: 0 },
        velocity: { speed: [0, 0], dir: [0, 0, 0] },
        curves: {
          size: [0.75, 1.02, 1.0, 0.92],
          alpha: [0.0, 0.9, 0.72, 0.0],
          dissolve: [0.0, 0.0, 0.15, 0.92],
        },
        material: {
          blendMode: 'additive',
          meshKind: 'sphere',
          mainTex: 'builtin:soft_disc',
          noiseTex: 'builtin:noise_packed',
          noiseScroll: [0.22, 0.35],
          dissolveEdgeWidth: 0.12,
          dissolveEdgeColor: [0.4, 3.2, 4.5],
          emissiveBoost: 2.5,
          lutRow: 6,
          tint: [0.35, 0.88, 1.0],
          fresnelPower: 3.2,
          doubleSided: true,
        },
      },
      {
        id: 'arc_lightning',
        renderer: 'ribbon',
        delay: 0.02,
        minQuality: 'med',
        maxParticles: 8,
        spawn: { burst: [{ time: 0, count: 3 }], rate: 0 },
        lifetime: [0.28, 0.42],
        sizeStart: [0.12, 0.18],
        shape: { type: 'ring', radius: 1.55 },
        velocity: { speed: [1.5, 3.5] },
        material: {
          blendMode: 'additive',
          lightningJitter: 0.3,
          ribbonLength: 2.1,
          tint: [0.45, 0.85, 1.0],
          emissiveBoost: 3.0,
        },
      },
      {
        id: 'slash_sparks',
        renderer: 'sprite',
        delay: 0.04,
        minQuality: 'low',
        maxParticles: 24,
        spawn: { burst: [{ time: 0.04, count: 14 }], rate: 0 },
        lifetime: [0.28, 0.55],
        sizeStart: [0.1, 0.18],
        shape: { type: 'ring', radius: 1.4 },
        velocity: { speed: [3.0, 6.5], alignVelocity: true, stretchFactor: 0.2 },
        motion: { gravity: 6.0, drag: 2.5 },
        curves: {
          size: [1.0, 0.7, 0.3, 0.0],
          alpha: [1.0, 0.9, 0.4, 0.0],
        },
        material: {
          blendMode: 'additive',
          mainTex: 'builtin:soft_disc',
          emissiveBoost: 3.2,
          lutRow: 2,
          tint: [0.7, 0.85, 1.0],
        },
      },
    ],
  }),
  Object.freeze({
    schemaVersion: 2,
    id: 'vfx_bench_blood_splash',
    name: '可染色血浆 / 果汁喷溅 (LUT切换+落地贴花)',
    category: 'v2 标杆预设',
    duration: 1.4,
    loop: false,
    boundsRadius: 4.0,
    emitters: [
      {
        id: 'blood_droplets',
        renderer: 'sprite',
        delay: 0.0,
        minQuality: 'low',
        maxParticles: 48,
        spawn: { burst: [{ time: 0, count: 28 }], rate: 0 },
        lifetime: [0.45, 0.9],
        sizeStart: [0.16, 0.3],
        shape: { type: 'cone', radius: 0.18, angle: 36 },
        velocity: { speed: [3.2, 7.6], alignVelocity: true, stretchFactor: 0.28 },
        motion: {
          gravity: 15.0,
          drag: 1.0,
          groundBounce: { enabled: true, groundY: 0, restitution: 0.15, friction: 0.45 },
        },
        curves: {
          size: [0.85, 1.15, 0.95, 0.35],
          alpha: [0.95, 0.95, 0.8, 0.0],
          additive: [0, 0, 0, 0],
        },
        material: {
          blendMode: 'alpha',
          mainTex: 'builtin:soft_disc',
          lutRow: 3, // 3=写实暗红血浆, 4=鲜橙果汁, 5=青柠果汁
          tint: [1, 1, 1],
          emissiveBoost: 1.0,
        },
        subEmitters: {
          onCollision: 'decal_drop',
        },
      },
      {
        id: 'blood_mist',
        renderer: 'sprite',
        delay: 0.0,
        minQuality: 'med',
        maxParticles: 16,
        spawn: { burst: [{ time: 0, count: 8 }], rate: 0 },
        lifetime: [0.5, 0.85],
        sizeStart: [0.55, 0.85],
        shape: { type: 'sphere', radius: 0.28 },
        velocity: { speed: [0.8, 2.2] },
        motion: {
          gravity: 1.2,
          drag: 3.5,
          curlNoise: { strength: 0.9, frequency: 1.1, speed: 0.6 },
        },
        curves: {
          size: [0.5, 1.1, 1.5, 1.8],
          alpha: [0.0, 0.72, 0.45, 0.0],
          dissolve: [0.05, 0.25, 0.65, 1.0],
          additive: [0, 0, 0, 0],
        },
        material: {
          blendMode: 'alpha',
          mainTex: 'builtin:fire_flipbook',
          noiseTex: 'builtin:noise_packed',
          flipbook: { cols: 4, rows: 4, fps: 14, frameBlend: true },
          dissolveEdgeWidth: 0.1,
          dissolveEdgeColor: [0.6, 0.08, 0.08],
          lutRow: 3,
          tint: [1, 1, 1],
        },
      },
      {
        id: 'splash_decal_event',
        renderer: 'event',
        delay: 0.08,
        minQuality: 'low',
        events: {
          spawnDecal: { decalId: 'decal_blood_01', scale: [1.1, 1.1], randomRotation: true },
          playCue: 'sfx_blood_splash',
        },
      },
    ],
  }),
]);
