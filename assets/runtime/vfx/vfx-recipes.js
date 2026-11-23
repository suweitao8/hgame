import { createVisualPrng, packRgb24 } from './vfx-core.js';
import { evaluateAtlasParticlePosition, evaluateColorCurve, evaluateSizeCurve } from './vfx-atlas-particles.js';
import { VFX_DEPTH_TESTS } from './vfx-depth-state.js';
import { SHURIKEN_QUALITY_TIERS } from './vfx-shuriken-kernel.js';

const MAX_ACTIVE_EFFECTS = 512;
const MAX_LAYERS_PER_EFFECT = 128;
const MAX_BURSTS_PER_LAYER = 8;
const MAX_TRAIL_FOLLOWERS = 512;
const MAX_TRACKED_PARTICLES = 256;
const MAX_POINT_LIGHTS = 16;
const MAX_LOCAL_EFFECT_SLOTS = 31;

const VALID_LAYER_KINDS = new Set(['particle', 'mesh', 'slash', 'lightning', 'telegraph']);
const VALID_RENDER_MODES = new Set(['billboard', 'horizontal', 'stretched', 'vertical', 'mesh', 'none']);
const VALID_BLENDS = new Set(['alpha', 'additive', 'multiply', 'premultiply', 'distortion']);

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
      if (layer.depthTest !== undefined && !VFX_DEPTH_TESTS.includes(layer.depthTest)) {
        errors.push(`layers[${i}].depthTest "${String(layer.depthTest)}" is invalid`);
      }
      for (const field of ['opaque', 'depthWrite', 'softParticles', 'useTexture']) {
        if (layer[field] !== undefined && typeof layer[field] !== 'boolean') {
          errors.push(`layers[${i}].${field} must be a boolean`);
        }
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
 * @param {object | null} [options.shurikenKernel=null]
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
  shurikenKernel = null,
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
  const scratchEmitCenter = new Float32Array(3);
  const scratchVel = new Float32Array(3);
  const scratchDir = new Float32Array(3);
  const scratchTrailExt = { noiseScroll: 0, noiseDamp: false };
  const scratchRgb = [1, 1, 1];
  const scratchTintA = [1, 1, 1];
  const scratchTintB = [1, 1, 1];
  const scratchTintOut = [1, 1, 1];
  const scratchColorRgba = new Float32Array(4);
  const scratchTrailMult = [1, 1, 1];
  const scratchTrailLife = new Float32Array(4);
  const scratchTrailPartLife = new Float32Array(4);
  let collisionResolver = /** @type {((x:number,y:number,z:number,vx:number,vy:number,vz:number)=>{hit:boolean,y?:number,nx?:number,ny?:number,nz?:number}|null) | null} */ (null);

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
    if (Array.isArray(startColor) && startColor.length >= 1 && Array.isArray(startColor[0]) && typeof startColor[0][0] === 'number' && Array.isArray(startColor[0][1])) {
      evaluateColorCurve(startColor, prng.nextFloat(), scratchColorRgba);
      out[0] = scratchColorRgba[0];
      out[1] = scratchColorRgba[1];
      out[2] = scratchColorRgba[2];
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

  // Pre-allocated point light pool (3D only, up to MAX_POINT_LIGHTS concurrent dynamic VFX lights).
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
        particleTrackIdx: -1,
        light,
      });
    }
  }

  // Free pool of 1..31 GPU/mesh local-space effect anchor slots.
  const freeLocalSlots = [];
  for (let i = MAX_LOCAL_EFFECT_SLOTS; i >= 1; i--) freeLocalSlots.push(i);

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
      pushedPoints: 0,
      x0: 0, y0: 0, z0: 0,
      vx: 0, vy: 0, vz: 0,
      gravity: 0, drag: 0,
      noiseStrength: 0, noiseYScale: 1, noiseFreq: 0.5, noiseScroll: 0, noiseDamp: false, phase: 0,
      orbitalX: 0, orbitalY: 0, orbitalZ: 0, centerOffX: 0, centerOffY: 0, centerOffZ: 0,
      sizeCurve: null, sizeAffectsWidth: true,
      lifeColorCurve: null,
      particleColorCurve: null,
      trackedSlot: -1,
    });
  }

  // Pre-allocated CPU-tracked particle pool for CollisionModule, SubModule, and LightsModule layers.
  const trackedParticles = [];
  for (let i = 0; i < MAX_TRACKED_PARTICLES; i++) {
    trackedParticles.push({
      active: false,
      _isTrackedParticle: true,
      atlasState: null,
      atlasSlot: -1,
      meshSlot: -1,
      lightSlotIdx: -1,
      lightBaseIntensity: 0,
      age: 0,
      duration: 1,
      initX: 0, initY: 0, initZ: 0,
      initVx: 0, initVy: 0, initVz: 0,
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      accelX: 0, accelZ: 0,
      gravity: 0, drag: 0,
      curveRow: 0,
      hasVelCurve: false,
      orbitalY: 0,
      centerOffX: 0,
      centerOffZ: 0,
      _evalExt: { hasVelCurve: false, velDispIntegral: 0, duration: 1, velMul: 1, accelX: 0, accelZ: 0 },
      tintR: 1, tintG: 1, tintB: 1,
      sizeMul: 1,
      hasCollision: false,
      groundY: 0, bounce: 0.45, dampen: 0.2, minSpeed: 0.15, bouncesLeft: 3,
      clampVelocity: null,
      /** @type {Array<{ trigger?: string, effect?: string | object, probability?: number, inheritVelocity?: number, inheritColor?: boolean, inheritSize?: boolean }> | null} */
      subEmitters: null,
      subDepth: 0,
    });
  }

  function createLayerState() {
    return {
      cycleAge: 0,
      rateAccum: 0,
      distAccum: 0,
      emitSeq: 0,
      burstCyclesDone: new Uint16Array(MAX_BURSTS_PER_LAYER),
      burstNextTime: new Float32Array(MAX_BURSTS_PER_LAYER),
      activeEndTimes: new Float64Array(64),
      activeEndCursor: 0,
      triggeredOnce: false,
      ribbonTrailId: -1,
      ribbonOpts: null,
      ribbonPts: [],
    };
  }

  function ensureSlotLayerStates(slot, count) {
    while (slot.layers.length < count) {
      slot.layers.push(createLayerState());
    }
  }

  // Pre-allocated composite effect slots + layer states.
  const effectSlots = [];
  for (let i = 0; i < MAX_ACTIVE_EFFECTS; i++) {
    const layers = [];
    for (let l = 0; l < 16; l++) {
      layers.push(createLayerState());
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
      prevX: 0, prevY: 0, prevZ: 0,
      followVx: 0, followVy: 0, followVz: 0,
      yaw: 0,
      scale: 1,
      subDepth: 0,
      inheritVx: 0,
      inheritVy: 0,
      inheritVz: 0,
      inheritTintR: 1,
      inheritTintG: 1,
      inheritTintB: 1,
      localSlotIdx: 0,
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
        shurikenKernel?.setEffectTransform?.(slot.id, slot.x, slot.y, slot.z, slot.yaw, slot.followVx, slot.followVy, slot.followVz);
      },
      stop() {
        stopSlot(slot);
      },
    };
    effectSlots.push(slot);
  }

  function releaseLightSlot(lightIdx) {
    if (lightIdx < 0 || lightIdx >= lightSlots.length) return;
    const ls = lightSlots[lightIdx];
    ls.active = false;
    ls.particleTrackIdx = -1;
    ls.light.intensity = 0;
    ls.light.visible = false;
  }

  function stopSlot(slot) {
    slot.active = false;
    slot.follow = null;
    slot.followVx = 0;
    slot.followVy = 0;
    slot.followVz = 0;
    slot.recipe = null;
    for (let l = 0; l < slot.layers.length; l++) {
      const ls = slot.layers[l];
      if (ls.ribbonTrailId >= 0 && trails?.freeTrail) {
        trails.freeTrail(ls.ribbonTrailId);
      }
      ls.ribbonTrailId = -1;
      ls.ribbonOpts = null;
      ls.ribbonPts.length = 0;
    }
    if (slot.localSlotIdx > 0) {
      freeLocalSlots.push(slot.localSlotIdx);
      slot.localSlotIdx = 0;
    }
    if (slot.lightSlotIdx >= 0) {
      releaseLightSlot(slot.lightSlotIdx);
      slot.lightSlotIdx = -1;
    }
  }

  function usesShurikenKernel(layer) {
    if (!shurikenKernel || !layer) return false;
    const kind = layer.kind ?? 'particle';
    if (kind !== 'particle' && kind !== 'mesh') return false;
    if (layer.useShurikenKernel === true) return true;
    if (layer.uberMat || layer.trail?.mode === 'ribbon' || (Array.isArray(layer.subEmitters) && layer.subEmitters.length > 0)) {
      return false;
    }
    if (layer.shaderProfile || layer.material?.shaderProfile) return true;
    if (layer.renderMode === 'none') return true;
    if (layer.clampVelocity !== undefined
      || layer.rotationBySpeed !== undefined
      || layer.inheritVelocity !== undefined
      || layer.size3D !== undefined
      || layer.sizeZCurve !== undefined
      || layer.sizeZ !== undefined
      || layer.customData !== undefined
      || layer.vertexStreams !== undefined) {
      return true;
    }
    return false;
  }

  function compileRecipe(recipe) {
    const res = validateVfxRecipe(recipe);
    if (!res.ok) {
      throw new Error(`Invalid VFX recipe: ${res.errors.join('; ')}`);
    }
    const compiledLayers = recipe.layers.map((layer) => {
      const curveRow = atlasParticles
        ? atlasParticles.compileCurves(layer.colorCurve, layer.sizeCurve, layer.sizeYCurve ?? null, layer.velCurve ?? null)
        : 0;
      const simSpd = Math.max(0.05, Number(layer.simulationSpeed ?? 1.0));
      const useShuriken = usesShurikenKernel(layer);
      const _shurikenLayer = useShuriken ? shurikenKernel.registerLayer(layer) : null;
      if (!useShuriken && layer.uberMat) {
        if (layer._kind === 'mesh' || layer.kind === 'mesh' || layer.renderMode === 'mesh') {
          meshVfx?.registerUberMaterial?.(layer.uberMat);
        } else {
          atlasParticles?.registerUberMaterial?.(layer.uberMat);
        }
      }
      return {
        ...layer,
        _renderState: {
          blend: layer.blend ?? 'alpha',
          opaque: layer.opaque,
          depthTest: layer.depthTest,
          depthWrite: layer.depthWrite,
          softParticles: layer.softParticles,
          useTexture: layer.useTexture,
          sortingOrder: layer.sortingOrder ?? 0,
        },
        _curveRow: curveRow,
        _kind: layer.kind ?? 'particle',
        _simSpd: simSpd,
        _shurikenLayer,
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
    for (let i = 0; i < compiled.layers.length; i++) {
      const subs = compiled.layers[i].subEmitters;
      if (Array.isArray(subs)) {
        for (let j = 0; j < subs.length; j++) {
          const eff = subs[j]?.effect;
          if (eff && typeof eff === 'object' && eff.id && !registry.has(eff.id)) {
            registerEffect(eff);
          }
        }
      }
    }
    return compiled;
  }

  const scratchTrailCustom1 = [0, 0, 0, 0];

  function sampleCustomDataComponent(comp, prngRef, t) {
    if (comp === undefined || comp === null) return 0;
    if (typeof comp === 'number') return Number.isFinite(comp) ? comp : 0;
    if (Array.isArray(comp)) return readRange(comp, 0, 0, prngRef);
    if (typeof comp === 'object' && comp.mode === 'curve') {
      const sc = Number.isFinite(comp.scalar) ? comp.scalar : 1;
      const val = Array.isArray(comp.curve) && comp.curve.length > 0 ? evaluateSizeCurve(comp.curve, t) : 1;
      return val * sc;
    }
    return 0;
  }

  function sampleCustomDataVec4(vecCfg, prngRef, t = 0, out = scratchTrailCustom1) {
    if (!vecCfg || typeof vecCfg !== 'object') {
      out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;
      return null;
    }
    out[0] = sampleCustomDataComponent(vecCfg.x, prngRef, t);
    out[1] = sampleCustomDataComponent(vecCfg.y, prngRef, t);
    out[2] = sampleCustomDataComponent(vecCfg.z, prngRef, t);
    out[3] = sampleCustomDataComponent(vecCfg.w, prngRef, t);
    return out;
  }

  function applyTrailLifeMod(tid, lifeT, lifeColorCurve, particleColorCurve) {
    if ((!lifeColorCurve && !particleColorCurve) || typeof trails?.setTrailLifeMod !== 'function') return;
    let r = 1;
    let g = 1;
    let b = 1;
    let a = 1;
    if (lifeColorCurve) {
      evaluateColorCurve(lifeColorCurve, lifeT, scratchTrailLife);
      r *= scratchTrailLife[0];
      g *= scratchTrailLife[1];
      b *= scratchTrailLife[2];
      a *= scratchTrailLife[3];
    }
    if (particleColorCurve) {
      evaluateColorCurve(particleColorCurve, lifeT, scratchTrailPartLife);
      r *= scratchTrailPartLife[0];
      g *= scratchTrailPartLife[1];
      b *= scratchTrailPartLife[2];
      a *= scratchTrailPartLife[3];
    }
    trails.setTrailLifeMod(tid, r, g, b, a);
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
    orbitalX = 0, orbitalZ = 0, centerOffY = 0,
    custom1 = null,
    particleColorCurve = null,
    noiseScroll = 0, noiseDamp = false,
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
    const hasColorCurve = Array.isArray(trailCfg.colorCurve) && trailCfg.colorCurve.length >= 2;
    let baseColor;
    if (trailCfg.inheritColor) {
      if (!hasColorCurve && trailCfg.color !== undefined) {
        parseColorRgb01(trailCfg.color, scratchTrailMult);
        baseColor = packRgb24(
          Math.round(tintRgb[0] * scratchTrailMult[0] * 255),
          Math.round(tintRgb[1] * scratchTrailMult[1] * 255),
          Math.round(tintRgb[2] * scratchTrailMult[2] * 255),
        );
      } else {
        baseColor = packRgb24(Math.round(tintRgb[0] * 255), Math.round(tintRgb[1] * 255), Math.round(tintRgb[2] * 255));
      }
    } else {
      baseColor = hasColorCurve ? 0xffffff : parseColorNumber(trailCfg.color, 0xff9f43);
    }
    let endColor;
    if (trailCfg.endColor !== undefined) {
      if (trailCfg.inheritColor) {
        parseColorRgb01(trailCfg.endColor, scratchTrailMult);
        endColor = packRgb24(
          Math.round(tintRgb[0] * scratchTrailMult[0] * 255),
          Math.round(tintRgb[1] * scratchTrailMult[1] * 255),
          Math.round(tintRgb[2] * scratchTrailMult[2] * 255),
        );
      } else {
        endColor = parseColorNumber(trailCfg.endColor, baseColor);
      }
    } else {
      endColor = baseColor;
    }
    if (trailCfg.tint) {
      sampleStartColor(trailCfg.tint, scratchTrailMult);
      const sr = ((baseColor >> 16) & 255) * scratchTrailMult[0];
      const sg = ((baseColor >> 8) & 255) * scratchTrailMult[1];
      const sb = (baseColor & 255) * scratchTrailMult[2];
      baseColor = packRgb24(Math.round(sr), Math.round(sg), Math.round(sb));
      const er = ((endColor >> 16) & 255) * scratchTrailMult[0];
      const eg = ((endColor >> 8) & 255) * scratchTrailMult[1];
      const eb = (endColor & 255) * scratchTrailMult[2];
      endColor = packRgb24(Math.round(er), Math.round(eg), Math.round(eb));
    }
    const sizeAffectsWidth = trailCfg.sizeAffectsWidth !== false;
    const widthVal = trailCfg.widthOverTrail !== undefined
      ? readRange(trailCfg.widthOverTrail, 1, 1, prng) * (sizeAffectsWidth ? sizeStart : 1)
      : readRange(trailCfg.width, 0.08, 0.08, prng);
    const width = Math.max(0.002, widthVal);
    const endWidth = trailCfg.endWidthScale !== undefined
      ? (width * Math.max(0, Number(trailCfg.endWidthScale)))
      : (trailCfg.endWidth ?? 0);
    const trailAlpha = Math.max(0, Math.min(1, readRange(trailCfg.alpha, 1, 1, prng)));
    const rawTrailLife = readRange(trailCfg.lifetime, 0.15, 0.15, prng);
    const trailLifetime = Math.max(
      0.03,
      trailCfg.lifetimeMode === 'fraction' ? (particleDur * rawTrailLife) : rawTrailLife,
    );
    const tid = trails.allocTrail({
      color: baseColor,
      endColor,
      colorCurve: hasColorCurve ? trailCfg.colorCurve : null,
      width,
      endWidth,
      widthCurve: trailCfg.widthCurve || null,
      alpha: trailAlpha,
      hdr: trailCfg.hdr ?? 1.0,
      lifetime: trailLifetime,
      blend: trailCfg.blend || 'additive',
      sprite: trailCfg.sprite,
      uvRect: trailCfg.uvRect ?? (trailCfg.sprite && atlasParticles?.regions?.[trailCfg.sprite]) ?? null,
      uberMat: trailCfg.uberMat ?? null,
      textureScale: trailCfg.textureScale ?? null,
      custom1,
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
    slot.noiseScroll = noiseScroll;
    slot.noiseDamp = noiseDamp;
    slot.phase = phase;
    slot.orbitalX = orbitalX;
    slot.orbitalY = orbitalY;
    slot.orbitalZ = orbitalZ;
    slot.centerOffX = centerOffX;
    slot.centerOffY = centerOffY;
    slot.centerOffZ = centerOffZ;
    slot.sizeCurve = sizeAffectsWidth && Array.isArray(sizeCurve) ? sizeCurve : null;
    slot.sizeAffectsWidth = sizeAffectsWidth;
    slot.lifeColorCurve = Array.isArray(trailCfg.lifeColorCurve) && trailCfg.lifeColorCurve.length >= 2 ? trailCfg.lifeColorCurve : null;
    slot.particleColorCurve = trailCfg.inheritColor && Array.isArray(particleColorCurve) && particleColorCurve.length >= 2 ? particleColorCurve : null;
    slot.trackedSlot = trackedSlot;

    const initLifeT = Math.min(1, initialAge / Math.max(0.01, particleDur));
    if (slot.sizeCurve && typeof trails.setTrailWidthScale === 'function') {
      trails.setTrailWidthScale(tid, evaluateSizeCurve(slot.sizeCurve, initLifeT));
    }
    applyTrailLifeMod(tid, initLifeT, slot.lifeColorCurve, slot.particleColorCurve);
    if (initialAge > 0.005) {
      const nowT = typeof trails.getTime === 'function' ? trails.getTime() : 0;
      const tStart = Math.max(0, initialAge - trailLifetime);
      const maxNodes = typeof trails.getStats === 'function' ? (trails.getStats().trailNodes ?? 8) : 8;
      const samples = Math.max(6, maxNodes - 2);
      scratchTrailExt.noiseScroll = noiseScroll;
      scratchTrailExt.noiseDamp = noiseDamp;
      for (let s = 0; s <= samples; s++) {
        const a = tStart + ((initialAge - tStart) * s) / samples;
        evaluateAtlasParticlePosition(
          x0, y0, z0, vx, vy, vz, gravity, drag,
          noiseStrength, noiseFreq, phase, a, is2D, scratchPos,
          orbitalY, centerOffX, centerOffZ, noiseYScale,
          scratchTrailExt, orbitalX, orbitalZ, centerOffY,
        );
        trails.pushTrailPoint(tid, scratchPos[0], scratchPos[1], scratchPos[2], nowT - (initialAge - a));
      }
      slot.pushedPoints = samples + 1;
    } else {
      trails.pushTrailPoint(tid, x0, y0, z0);
      slot.pushedPoints = 1;
    }
  }

  function fireSubEmitters(subEmitters, triggerType, x, y, z, depth, vx = 0, vy = 0, vz = 0, tintR = 1, tintG = 1, tintB = 1, followTp = null) {
    if (!Array.isArray(subEmitters) || depth >= 2) return;
    if (shurikenKernel && SHURIKEN_QUALITY_TIERS[shurikenKernel.getQualityTier()]?.skipSubEmitters) return;
    for (let i = 0; i < subEmitters.length; i++) {
      const sub = subEmitters[i];
      if (!sub || (sub.trigger || 'death') !== triggerType || !sub.effect) continue;
      const prob = sub.probability ?? 1.0;
      if (prob < 1.0 && prng.nextFloat() > prob) continue;
      if (typeof sub.effect === 'string' && !registry.has(sub.effect)) continue;
      const iv = Number(sub.inheritVelocity ?? 0);
      const effDef = typeof sub.effect === 'string' ? registry.get(sub.effect) : sub.effect;
      const hasDelay = Boolean(followTp && effDef?.layers?.some((l) => (l.delay ?? 0) > 0));
      playEffect(sub.effect, {
        x, y, z,
        ...(hasDelay ? { follow: followTp } : {}),
        _subDepth: depth + 1,
        _inheritVx: iv !== 0 ? vx * iv : 0,
        _inheritVy: iv !== 0 ? vy * iv : 0,
        _inheritVz: iv !== 0 ? vz * iv : 0,
        _inheritTint: sub.inheritColor ? [tintR, tintG, tintB] : null,
      });
    }
  }

  function allocTrackedParticle({
    atlasState = null, atlasSlot = -1, meshSlot = -1, duration, initialAge = 0,
    x, y, z, vx, vy, vz, accelX = 0, accelZ = 0, gravity, drag,
    curveRow = 0, hasVelCurve = false, velCurve = null, orbitalY = 0, centerOffX = 0, centerOffZ = 0,
    tintR = 1, tintG = 1, tintB = 1,
    collision = null, subEmitters = null, subDepth = 0,
    clampVelocity = null,
    lightSlotIdx = -1, lightBaseIntensity = 0,
  }) {
    for (let i = 0; i < MAX_TRACKED_PARTICLES; i++) {
      const tp = trackedParticles[i];
      if (!tp.active) {
        tp.active = true;
        tp.atlasState = atlasState;
        tp.atlasSlot = atlasSlot;
        tp.meshSlot = meshSlot;
        tp.lightSlotIdx = lightSlotIdx;
        tp.lightBaseIntensity = lightBaseIntensity;
        tp.age = initialAge;
        tp.duration = duration;
        tp.initX = x;
        tp.initY = y;
        tp.initZ = z;
        tp.initVx = vx;
        tp.initVy = vy;
        tp.initVz = vz;
        tp.x = x;
        tp.y = y;
        tp.z = z;
        tp.vx = vx;
        tp.vy = vy;
        tp.vz = vz;
        tp.accelX = accelX;
        tp.accelZ = accelZ;
        tp.gravity = gravity;
        tp.drag = drag;
        tp.curveRow = curveRow;
        tp.hasVelCurve = Boolean(hasVelCurve);
        tp.velCurve = Array.isArray(velCurve) && velCurve.length > 0 ? velCurve : null;
        tp.orbitalY = orbitalY;
        tp.centerOffX = centerOffX;
        tp.centerOffZ = centerOffZ;
        tp.tintR = tintR;
        tp.tintG = tintG;
        tp.tintB = tintB;
        tp.hasCollision = Boolean(collision);
        tp.groundY = collision?.groundY ?? 0;
        tp.bounce = collision?.bounce ?? 0.45;
        tp.dampen = collision?.dampen ?? 0.2;
        tp.minSpeed = collision?.minSpeed ?? 0.15;
        tp.bouncesLeft = collision?.maxBounces ?? 3;
        tp.clampVelocity = clampVelocity && clampVelocity.limit > 0 ? clampVelocity : null;
        tp.subEmitters = Array.isArray(subEmitters) ? subEmitters : null;
        tp.subDepth = subDepth;
        if (lightSlotIdx >= 0 && lightSlotIdx < lightSlots.length) {
          lightSlots[lightSlotIdx].particleTrackIdx = i;
        }
        return i;
      }
    }
    return -1;
  }

  function allocParticleLight(plCfg, x, y, z, duration, tintRgb) {
    if (lightSlots.length === 0 || !plCfg) return -1;
    const ratio = plCfg.ratio ?? 1.0;
    if (ratio < 1.0 && prng.nextFloat() > ratio) return -1;
    const maxL = Math.max(1, plCfg.maxLights ?? 6);
    let activeP = 0;
    let freeLi = -1;
    for (let i = 0; i < lightSlots.length; i++) {
      if (lightSlots[i].particleTrackIdx >= 0) activeP += 1;
      if (!lightSlots[i].active && freeLi === -1) freeLi = i;
    }
    if (freeLi === -1 || activeP >= maxL) return -1;
    const ls = lightSlots[freeLi];
    ls.active = true;
    ls.age = 0;
    ls.duration = Math.max(0.02, duration);
    ls.maxIntensity = plCfg.intensity ?? 2.0;
    ls.loop = false;
    parseColorRgb01(plCfg.color, scratchRgb);
    const mult = plCfg.useParticleColor !== false ? tintRgb : [1, 1, 1];
    ls.light.color.setRGB(scratchRgb[0] * mult[0], scratchRgb[1] * mult[1], scratchRgb[2] * mult[2]);
    ls.light.distance = plCfg.range ?? 8;
    ls.light.position.set(x, y, z);
    ls.light.intensity = ls.maxIntensity;
    ls.light.visible = true;
    return freeLi;
  }

  function sampleShapeArcAngle(shape, ls, emitIdx, emitCount) {
    const arcRad = ((shape.arc ?? 360) * Math.PI) / 180;
    const arcMode = shape.arcMode || 'random';
    const spread = Math.max(0, Math.min(1, Number(shape.arcSpread ?? 0)));
    let frac;
    if (arcMode === 'burst-spread') {
      frac = emitCount > 1 ? (emitIdx / emitCount) : 0;
    } else if (arcMode === 'loop' || arcMode === 'pingpong') {
      const spd = Number(shape.arcSpeed ?? 1);
      const seqStep = spread > 0.001 ? spread : 0.08;
      const tSeq = (ls ? ls.cycleAge * Math.abs(spd) : 0) + ((ls ? ls.emitSeq++ : 0) * seqStep);
      const wrap = ((tSeq % 1) + 1) % 1;
      if (arcMode === 'pingpong') {
        const cyc = Math.floor(Math.abs(tSeq));
        frac = (cyc % 2 === 1) ? (1 - wrap) : wrap;
      } else {
        frac = spd < 0 ? (1 - wrap) : wrap;
      }
    } else {
      frac = prng.nextFloat();
    }
    if (spread > 0.001) {
      frac = Math.floor(frac / spread) * spread;
    }
    return frac * arcRad;
  }

  function sampleShapeAndVelocity(layer, slot, scale, ls = null, emitIdx = 0, emitCount = 1) {
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
      const ang = sampleShapeArcAngle(shape, ls, emitIdx, emitCount);
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
      const ang = sampleShapeArcAngle(shape, ls, emitIdx, emitCount);
      const r = rad * Math.sqrt(1 - rt + prng.nextFloat() * rt);
      lx = Math.cos(ang) * r;
      ly = is2D ? Math.sin(ang) * r : 0;
      lz = is2D ? 0 : Math.sin(ang) * r;
      dx = Math.cos(ang);
      dy = is2D ? Math.sin(ang) : 0;
      dz = is2D ? 0 : Math.sin(ang);
    } else if (sType === 'donut') {
      const phi = sampleShapeArcAngle(shape, ls, emitIdx, emitCount);
      const theta = prng.nextFloat() * 6.283185307179586;
      const tubeR = (shape.donutRadius ?? Math.max(0.15, rad * 0.25)) * scale;
      const rMinor = tubeR * Math.sqrt(1 - rt + prng.nextFloat() * rt);
      const cPhi = Math.cos(phi), sPhi = Math.sin(phi);
      const cTh = Math.cos(theta), sTh = Math.sin(theta);
      dx = cPhi * cTh;
      dy = is2D ? (sPhi * cTh) : sTh;
      dz = is2D ? 0 : (sPhi * cTh);
      if (is2D) {
        lx = cPhi * rad + dx * rMinor;
        ly = sPhi * rad + dy * rMinor;
        lz = 0;
      } else {
        lx = cPhi * rad + dx * rMinor;
        ly = dy * rMinor;
        lz = sPhi * rad + dz * rMinor;
      }
    } else if (sType === 'rectangle') {
      const hw = (shape.size?.[0] ?? shape.radius ?? 1) * 0.5 * scale;
      const hh = (shape.size?.[2] ?? shape.size?.[1] ?? shape.radius ?? 1) * 0.5 * scale;
      lx = prng.range(-hw, hw);
      ly = is2D ? prng.range(-hh, hh) : 0;
      lz = is2D ? 0 : prng.range(-hh, hh);
      dx = 0;
      dy = is2D ? 0 : 1;
      dz = is2D ? 1 : 0;
    } else if (sType === 'mesh') {
      const samples = meshVfx?.getSurfaceSamples?.(shape.mesh || layer.mesh || 'crystal');
      if (samples && samples.count > 0) {
        const si = Math.min(samples.count - 1, Math.floor(prng.nextFloat() * samples.count)) * 3;
        const mScale = Number(shape.meshScale ?? 1) * scale;
        lx = samples.points[si] * mScale;
        ly = samples.points[si + 1] * mScale;
        lz = samples.points[si + 2] * mScale;
        dx = samples.normals[si];
        dy = samples.normals[si + 1];
        dz = samples.normals[si + 2];
      } else {
        lx = prng.range(-0.5, 0.5) * scale;
        ly = prng.range(-0.5, 0.5) * scale;
        lz = is2D ? 0 : prng.range(-0.5, 0.5) * scale;
        dx = 0; dy = 1; dz = 0;
      }
    } else if (sType === 'edge') {
      const len = (shape.radius ?? 1) * scale;
      lx = prng.range(-len, len);
      dx = 0;
      dy = is2D ? -1 : 1;
      dz = 0;
    } else if (sType === 'cone') {
      const ang = shape ? sampleShapeArcAngle(shape, ls, emitIdx, emitCount) : (prng.nextFloat() * 6.283185307179586);
      const halfCone = ((shape.angle ?? 25) * Math.PI) / 180;
      const rNorm = Math.sqrt(1 - rt + prng.nextFloat() * rt);
      const tilt = rNorm * halfCone;
      const sinT = Math.sin(tilt);
      const cosT = Math.cos(tilt);
      dx = Math.cos(ang) * sinT;
      dy = is2D ? Math.sin(ang) * sinT : cosT;
      dz = is2D ? 0 : Math.sin(ang) * sinT;
      const coneLen = Math.max(0, Number(shape.length ?? 0)) * scale;
      const h = coneLen > 0 ? prng.nextFloat() * coneLen : 0;
      const sliceRad = rad + h * Math.tan(halfCone);
      const r = sliceRad * rNorm;
      lx = Math.cos(ang) * r;
      ly = is2D ? Math.sin(ang) * r : h;
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

    if ((shape.randomPos ?? 0) > 0.0001) {
      const rp = Number(shape.randomPos) * scale * prng.nextFloat();
      const jAng = prng.nextFloat() * 6.283185307179586;
      const jElev = is2D ? 0 : prng.range(-1, 1);
      const jHoriz = is2D ? 1 : Math.sqrt(Math.max(0, 1 - jElev * jElev));
      lx += Math.cos(jAng) * jHoriz * rp;
      ly += (is2D ? Math.sin(jAng) : jElev) * rp;
      lz += (is2D ? 0 : Math.sin(jAng) * jHoriz) * rp;
    }

    if (Array.isArray(shape.scale)) {
      const sx = Number(shape.scale[0] ?? 1);
      const sy = Number(shape.scale[1] ?? 1);
      const sz = Number(shape.scale[2] ?? 1);
      lx *= sx;
      ly *= sy;
      lz *= sz;
      const nLen = Math.hypot(lx, ly, lz);
      if (nLen > 0.0001) {
        dx = lx / nLen;
        dy = ly / nLen;
        dz = lz / nLen;
      }
    }

    const sphAmt = Math.max(0, Math.min(1, Number(shape.sphericalDirectionAmount ?? 0)));
    if (sphAmt > 0.0001) {
      const pLen = Math.hypot(lx, ly, lz);
      if (pLen > 0.0001) {
        const sx = lx / pLen;
        const sy = ly / pLen;
        const sz = lz / pLen;
        dx = dx + (sx - dx) * sphAmt;
        dy = dy + (sy - dy) * sphAmt;
        dz = dz + (sz - dz) * sphAmt;
        const nLen = Math.hypot(dx, dy, dz) || 1;
        dx /= nLen; dy /= nLen; dz /= nLen;
      }
    }

    const randDirAmt = Math.max(0, Math.min(1, Number(shape.randomDirectionAmount ?? 0)));
    if (randDirAmt > 0.0001) {
      const rAng = prng.nextFloat() * 6.283185307179586;
      const rElev = is2D ? 0 : prng.range(-1, 1);
      const rHoriz = is2D ? 1 : Math.sqrt(Math.max(0, 1 - rElev * rElev));
      const rx = Math.cos(rAng) * rHoriz;
      const ry = is2D ? Math.sin(rAng) : rElev;
      const rz = is2D ? 0 : Math.sin(rAng) * rHoriz;
      dx = dx + (rx - dx) * randDirAmt;
      dy = dy + (ry - dy) * randDirAmt;
      dz = dz + (rz - dz) * randDirAmt;
      const nLen = Math.hypot(dx, dy, dz) || 1;
      dx /= nLen; dy /= nLen; dz /= nLen;
    }

    if (Array.isArray(shape.rotation)) {
      const rx = Number(shape.rotation[0] ?? 0);
      const ry = Number(shape.rotation[1] ?? 0);
      const rz = Number(shape.rotation[2] ?? 0);
      if (Math.abs(rx) > 1e-4 || Math.abs(ry) > 1e-4 || Math.abs(rz) > 1e-4) {
        const cx = Math.cos(rx), sxR = Math.sin(rx);
        const cy = Math.cos(ry), syR = Math.sin(ry);
        const cz = Math.cos(rz), szR = Math.sin(rz);
        // Apply extrinsic XYZ rotation (Z then Y then X) in three separate axis steps.
        const rotateVec = (vx, vy, vz) => {
          let x1 = vx * cz - vy * szR;
          let y1 = vx * szR + vy * cz;
          let z1 = vz;
          let x2 = x1 * cy + z1 * syR;
          let y2 = y1;
          let z2 = -x1 * syR + z1 * cy;
          return [
            x2,
            y2 * cx - z2 * sxR,
            y2 * sxR + z2 * cx,
          ];
        };
        const rp = rotateVec(lx, ly, lz);
        lx = rp[0]; ly = rp[1]; lz = rp[2];
        const rd = rotateVec(dx, dy, dz);
        dx = rd[0]; dy = rd[1]; dz = rd[2];
      }
    }

    const off = layer.offset;
    const offX = Array.isArray(off) ? (off[0] ?? 0) * scale : 0;
    const offY = Array.isArray(off) ? (off[1] ?? 0) * scale : 0;
    const offZ = Array.isArray(off) ? (off[2] ?? 0) * scale : 0;
    lx += offX;
    ly += offY;
    lz += offZ;

    const cYaw = Math.cos(slot.yaw);
    const sYaw = Math.sin(slot.yaw);
    if (is2D) {
      scratchEmitCenter[0] = slot.x + offX * cYaw - offY * sYaw;
      scratchEmitCenter[1] = slot.y + offX * sYaw + offY * cYaw;
      scratchEmitCenter[2] = slot.z;
      scratchPos[0] = slot.x + lx * cYaw - ly * sYaw;
      scratchPos[1] = slot.y + lx * sYaw + ly * cYaw;
      scratchPos[2] = slot.z;
      scratchDir[0] = dx * cYaw - dy * sYaw;
      scratchDir[1] = dx * sYaw + dy * cYaw;
      scratchDir[2] = 0;
    } else {
      scratchEmitCenter[0] = slot.x + offX * cYaw - offZ * sYaw;
      scratchEmitCenter[1] = slot.y + offY;
      scratchEmitCenter[2] = slot.z + offX * sYaw + offZ * cYaw;
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
        const ox = scratchPos[0] - scratchEmitCenter[0];
        const oy = scratchPos[1] - scratchEmitCenter[1];
        const oz = scratchPos[2] - scratchEmitCenter[2];
        const len = Math.hypot(ox, oy, oz);
        // Guard against Float32-vs-Float64 offset residuals near zero by falling back to shape normal.
        const rx = len > 0.0005 ? (ox / len) : scratchDir[0];
        const ry = len > 0.0005 ? (oy / len) : scratchDir[1];
        const rz = len > 0.0005 ? (oz / len) : scratchDir[2];
        vx += rx * radVel * scale;
        vy += ry * radVel * scale;
        vz += rz * radVel * scale;
      }
    }

    const iv = Number(layer.inheritVelocity ?? 0);
    scratchVel[0] = vx + slot.inheritVx + slot.followVx * iv;
    scratchVel[1] = vy + slot.inheritVy + slot.followVy * iv;
    scratchVel[2] = vz + slot.inheritVz + slot.followVz * iv;
  }

  const scratchRowUv = [0, 0, 1, 1];
  const scratchRowFb = { cols: 1, rows: 1, cycles: 1, blend: true, region: '' };

  function resolveFlipbookAndUv(layer, rawDur = 1) {
    const fb = layer.flipbook;
    const uvRect = Array.isArray(layer.uvRect) && layer.uvRect.length >= 4 ? layer.uvRect : undefined;
    if (!fb) {
      return { flipbook: fb, uvRect };
    }
    const cols = Math.max(1, fb.cols | 0);
    const rows = Math.max(1, fb.rows | 0);
    const mode = fb.rowMode || 'grid';
    const hasRowSelect = rows > 1 && (mode === 'random' || fb.rowIndex !== undefined);
    const isStaticFrame = fb.cycles !== undefined && fb.cycles <= 0;
    const hasFps = fb.fps > 0 && !isStaticFrame;
    if (!hasRowSelect && !isStaticFrame && !hasFps) {
      return { flipbook: fb, uvRect };
    }
    const regKey = fb.region || layer.sprite;
    const baseUv = uvRect ?? (regKey ? atlasParticles?.regions?.[regKey] : null) ?? [0, 0, 1, 1];
    let u0 = baseUv[0];
    let v0 = baseUv[1];
    let u1 = baseUv[2];
    let v1 = baseUv[3];
    let outCols = cols;
    let outRows = rows;
    if (hasRowSelect) {
      const rowIdx = fb.rowIndex !== undefined
        ? Math.max(0, Math.min(rows - 1, fb.rowIndex | 0))
        : Math.floor(prng.nextFloat() * rows);
      const vSpan = (v1 - v0) / rows;
      v0 = baseUv[1] + vSpan * rowIdx;
      v1 = baseUv[1] + vSpan * (rowIdx + 1);
      outRows = 1;
    }
    if (isStaticFrame && (outCols > 1 || outRows > 1)) {
      const sf = Math.max(0, Math.min(0.9999, readRange(fb.startFrame, 0, 0, prng)));
      const totalCells = outCols * outRows;
      const cellIdx = Math.min(totalCells - 1, Math.floor(sf * totalCells));
      const colIdx = cellIdx % outCols;
      const rowIdx = Math.floor(cellIdx / outCols);
      const uSpan = (u1 - u0) / outCols;
      const vSpan = (v1 - v0) / outRows;
      u0 = u0 + uSpan * colIdx;
      u1 = u0 + uSpan;
      v0 = v0 + vSpan * rowIdx;
      v1 = v0 + vSpan;
      outCols = 1;
      outRows = 1;
    }
    const totalFrames = outCols * outRows;
    scratchRowUv[0] = u0;
    scratchRowUv[1] = v0;
    scratchRowUv[2] = u1;
    scratchRowUv[3] = v1;
    scratchRowFb.cols = outCols;
    scratchRowFb.rows = outRows;
    scratchRowFb.cycles = isStaticFrame
      ? 1
      : hasFps
        ? Math.max(0.01, (fb.fps * rawDur) / Math.max(1, totalFrames))
        : (fb.cycles ?? 1);
    scratchRowFb.blend = fb.blend;
    scratchRowFb.region = regKey || '';
    return { flipbook: scratchRowFb, uvRect: scratchRowUv };
  }

  function emitParticleOrMesh(layer, slot, initialAge = 0, ls = null, emitIdx = 0, emitCount = 1) {
    const scale = slot.scale;
    const simSpd = layer._simSpd ?? Math.max(0.05, Number(layer.simulationSpeed ?? 1.0));
    sampleShapeAndVelocity(layer, slot, scale, ls, emitIdx, emitCount);
    const rawDur = Math.max(0.02, readRange(layer.life, 0.4, 0.8, prng));
    const dur = rawDur / simSpd;
    const clampedInitAge = Math.min(Math.max(0, initialAge / simSpd), Math.max(0, dur - 0.01));
    scratchVel[0] *= simSpd;
    scratchVel[1] *= simSpd;
    scratchVel[2] *= simSpd;

    const sizeStart = readRange(layer.size, 0.5, 0.5, prng) * scale;
    const sizeYStart = layer.sizeY !== undefined ? (readRange(layer.sizeY, 0.5, 0.5, prng) * scale) : sizeStart;
    const resolvedAspectY = layer.sizeY !== undefined
      ? (sizeYStart / Math.max(1e-4, sizeStart))
      : layer.aspectY;
    const rot0 = readRange(layer.rotation, 0, 0, prng);
    const angVel = readRange(layer.angularVel, 0, 0, prng) * simSpd;
    const rotX0 = readRange(layer.rotX, 0, 0, prng);
    const rotY0 = readRange(layer.rotY, 0, 0, prng);
    const spinX = readRange(layer.spin?.[0], 0, 0, prng) * simSpd;
    const spinY = (layer.spin?.[1] !== undefined ? readRange(layer.spin[1], 0, 0, prng) : 0) * simSpd;
    const spinZ = readRange(layer.spin?.[2], 0, 0, prng) * simSpd;

    const forceArr = Array.isArray(layer.force) ? layer.force : null;
    const forceX = forceArr ? readRange(forceArr[0], 0, 0, prng) * scale * simSpd * simSpd : 0;
    const forceY = forceArr ? readRange(forceArr[1], 0, 0, prng) * scale * simSpd * simSpd : 0;
    const forceZ = forceArr ? readRange(forceArr[2], 0, 0, prng) * scale * simSpd * simSpd : 0;
    const gravity = ((layer.gravity ?? 0) * scale * simSpd * simSpd) - forceY;
    const accelX = forceX;
    const accelZ = forceZ;
    const drag = (layer.drag ?? 0) * simSpd;
    const windMul = Math.max(0, Number(layer.windMul ?? 0));

    const noiseStrength = readMagnitude(layer.noise?.strength, 0) * scale * simSpd;
    const noiseYRaw = layer.noise?.strengthY !== undefined
      ? readMagnitude(layer.noise.strengthY, 0) * scale * simSpd
      : noiseStrength;
    const noiseYScale = noiseStrength > 0.0001 ? Math.min(2.0, noiseYRaw / noiseStrength) : 1.0;
    const noiseFreq = (layer.noise?.frequency ?? 0.5) * simSpd;
    const noiseScroll = Math.max(0, Number(layer.noise?.scrollSpeed ?? 0)) * simSpd;
    const noiseDamp = Boolean(layer.noise?.damping);
    const phase = prng.nextFloat();
    const flipX = layer.flip?.[0] > 0 && prng.nextFloat() < layer.flip[0] ? -1 : 1;
    const flipY = layer.flip?.[1] > 0 && prng.nextFloat() < layer.flip[1] ? -1 : 1;
    const flipZ = layer.flip?.[2] > 0 && prng.nextFloat() < layer.flip[2] ? -1 : 1;

    const rawOrbX = layer.velocity?.orbitalX ?? layer.velocity?.orbital?.[0] ?? 0;
    const rawOrbY = layer.velocity?.orbitalY ?? layer.velocity?.orbital?.[1] ?? 0;
    const rawOrbZ = layer.velocity?.orbitalZ ?? layer.velocity?.orbital?.[2] ?? 0;
    const orbitalX = readRange(rawOrbX, 0, 0, prng) * simSpd;
    const orbitalY = readRange(rawOrbY, 0, 0, prng) * simSpd;
    const orbitalZ = readRange(rawOrbZ, 0, 0, prng) * simSpd;
    const orbOff = layer.velocity?.orbitalOffset;
    let orbPivotX = scratchEmitCenter[0];
    let orbPivotY = scratchEmitCenter[1];
    let orbPivotZ = scratchEmitCenter[2];
    if (orbOff) {
      const oox = readRange(orbOff[0], 0, 0, prng) * scale;
      const ooy = readRange(orbOff[1], 0, 0, prng) * scale;
      const ooz = readRange(orbOff[2], 0, 0, prng) * scale;
      const cYaw = Math.cos(slot.yaw);
      const sYaw = Math.sin(slot.yaw);
      if (is2D) {
        orbPivotX += oox * cYaw - ooy * sYaw;
        orbPivotY += oox * sYaw + ooy * cYaw;
      } else {
        orbPivotX += oox * cYaw - ooz * sYaw;
        orbPivotY += ooy;
        orbPivotZ += oox * sYaw + ooz * cYaw;
      }
    }
    const centerOffX = scratchPos[0] - orbPivotX;
    const centerOffY = scratchPos[1] - orbPivotY;
    const centerOffZ = scratchPos[2] - orbPivotZ;

    sampleStartColor(layer.startColor, scratchTintOut);
    scratchTintOut[0] *= slot.inheritTintR;
    scratchTintOut[1] *= slot.inheritTintG;
    scratchTintOut[2] *= slot.inheritTintB;
    const tintRgb24 = packRgb24(
      Math.round(scratchTintOut[0] * 255),
      Math.round(scratchTintOut[1] * 255),
      Math.round(scratchTintOut[2] * 255),
    );
    const isLocalSpace = layer.space === 'local' && slot.localSlotIdx > 0;

    if (layer._shurikenLayer && shurikenKernel) {
      const qTier = SHURIKEN_QUALITY_TIERS[shurikenKernel.getQualityTier()];
      if (slot.subDepth > 0 && qTier?.skipSubEmitters) return dur - clampedInitAge;
      let emitX = scratchPos[0];
      let emitY = scratchPos[1];
      let emitZ = scratchPos[2];
      let emitVx = scratchVel[0];
      let emitVy = scratchVel[1];
      let emitVz = scratchVel[2];
      let cx = slot.x;
      let cz = slot.z;
      if (layer.space === 'local') {
        const dx = emitX - slot.x;
        const dy = emitY - slot.y;
        const dz = emitZ - slot.z;
        const c = Math.cos(slot.yaw);
        const s = Math.sin(slot.yaw);
        emitX = dx * c + dz * s;
        emitY = dy;
        emitZ = -dx * s + dz * c;
        const vxTmp = emitVx * c + emitVz * s;
        emitVz = -emitVx * s + emitVz * c;
        emitVx = vxTmp;
        cx = 0;
        cz = 0;
      }
      const pIdx = shurikenKernel.emitParticle(layer._shurikenLayer, {
        effectId: slot.id,
        x: emitX,
        y: emitY,
        z: emitZ,
        vx: emitVx,
        vy: emitVy,
        vz: emitVz,
        duration: rawDur,
        initialAge: Math.max(0, initialAge / simSpd),
        scale,
        gravity: (layer.gravity ?? 0) * scale,
        drag: layer.drag ?? 0,
        noiseStrength: readMagnitude(layer.noise?.strength, 0) * scale * simSpd,
        noiseFreq: (layer.noise?.frequency ?? 0.5) * simSpd,
        centerX: cx,
        centerZ: cz,
        inheritTintR: slot.inheritTintR,
        inheritTintG: slot.inheritTintG,
        inheritTintB: slot.inheritTintB,
      });
      if (pIdx >= 0 && Array.isArray(layer.subEmitters) && layer.subEmitters.length > 0) {
        fireSubEmitters(
          layer.subEmitters,
          'birth',
          scratchPos[0],
          scratchPos[1],
          scratchPos[2],
          slot.subDepth,
          scratchVel[0],
          scratchVel[1],
          scratchVel[2],
          scratchTintOut[0],
          scratchTintOut[1],
          scratchTintOut[2],
        );
      }
      return dur - clampedInitAge;
    }

    if (layer._kind === 'mesh' || layer.renderMode === 'mesh') {
      if (!meshVfx) return;
      const alignDir = Boolean(layer.alignToVelocity || layer.shape?.alignToDirection);
      const hasTrRot = Array.isArray(layer.transformRot) && layer.transformRot.length >= 4;
      const { flipbook, uvRect } = resolveFlipbookAndUv(layer, rawDur);
      const atlasTexture = atlasParticles?.texture;
      const regionKey = flipbook?.region || layer.sprite;
      const atlasRegion = atlasTexture && (atlasParticles.regions?.[regionKey]
        ?? (Array.isArray(layer.uvRect) && layer.uvRect.length >= 4 ? layer.uvRect : null));
      const meshSlot = meshVfx.spawn({
        mesh: layer.mesh || 'crystal',
        texture: atlasRegion ? atlasTexture : null,
        textureRect: uvRect ?? atlasRegion,
        flipbook,
        x: scratchPos[0],
        y: scratchPos[1],
        z: scratchPos[2],
        vx: scratchVel[0],
        vy: scratchVel[1],
        vz: scratchVel[2],
        accelX,
        accelZ,
        windMul,
        dirX: alignDir ? scratchDir[0] : undefined,
        dirY: alignDir ? scratchDir[1] : undefined,
        dirZ: alignDir ? scratchDir[2] : undefined,
        gravity,
        drag,
        orbitalY,
        centerX: orbPivotX,
        centerZ: orbPivotZ,
        duration: dur,
        initialAge: clampedInitAge,
        persistent: Boolean(layer.persistent),
        curveCycle: (layer.curveCycle ?? 0) / simSpd,
        sizeStart,
        meshGlobalScale: layer.meshGlobalScale ?? 1.0,
        aspectY: layer.aspectY ?? 1.0,
        aspectZ: layer.aspectZ ?? 1.0,
        rotX: rotX0,
        rotY: hasTrRot ? rotY0 : (Math.abs(Math.sin(rotX0)) > 0.5 ? rotY0 : (rot0 || rotY0)),
        rotZ: readRange(layer.rotZ, 0, 0, prng) + (hasTrRot || Math.abs(Math.sin(rotX0)) > 0.5 ? rot0 : 0),
        spinX,
        spinY: hasTrRot ? spinY : (Math.abs(Math.sin(rotX0)) > 0.5 ? spinY : (layer.spin?.[1] !== undefined ? spinY : angVel)),
        spinZ: spinZ + (hasTrRot || Math.abs(Math.sin(rotX0)) > 0.5 ? angVel : 0),
        transformRot: hasTrRot ? layer.transformRot : null,
        flipX,
        flipY,
        flipZ,
        alignToVelocity: alignDir,
        forwardAxis: layer.forwardAxis,
        space: isLocalSpace ? 'local' : 'world',
        effectSlotIdx: isLocalSpace ? slot.localSlotIdx : 0,
        hdr: layer.hdr ?? 1.0,
        tint: scratchTintOut,
        lit: layer.lit,
        emission: layer.emission,
        cullMode: layer.cullMode,
        alphaCutoff: layer.alphaCutoff,
        cameraFade: layer.cameraFade,
        pivot: layer.pivot,
        uvScale: layer.uvScale,
        uvOffset: layer.uvOffset,
        ...layer._renderState,
        colorCurve: layer.colorCurve,
        sizeCurve: layer.sizeCurve,
        sizeYCurve: layer.sizeYCurve,
        sizeZCurve: layer.sizeZCurve,
        velCurve: layer.velCurve,
        clampVelocity: layer.clampVelocity,
        rotationBySpeed: layer.rotationBySpeed,
        customData: layer.customData,
        uberMat: layer.uberMat,
        phase,
        uvScroll: layer.uvScroll,
        fresnel: layer.fresnel,
        dissolve: layer.dissolve,
      });
      if (clampedInitAge > 0) meshVfx.readSlotMotion?.(meshSlot, scratchPos, scratchVel);
      const lightSlotIdx = layer.particleLight
        ? allocParticleLight(layer.particleLight, scratchPos[0], scratchPos[1], scratchPos[2], dur, scratchTintOut)
        : -1;
      const needsTracking = Boolean(layer.collision)
        || (Array.isArray(layer.subEmitters) && layer.subEmitters.length > 0)
        || lightSlotIdx >= 0;
      if (needsTracking) {
        if (layer.subEmitters) {
          fireSubEmitters(layer.subEmitters, 'birth', scratchPos[0], scratchPos[1], scratchPos[2], slot.subDepth, scratchVel[0], scratchVel[1], scratchVel[2], scratchTintOut[0], scratchTintOut[1], scratchTintOut[2]);
        }
        allocTrackedParticle({
          atlasSlot: -1,
          meshSlot,
          duration: dur,
          initialAge: clampedInitAge,
          x: scratchPos[0],
          y: scratchPos[1],
          z: scratchPos[2],
          vx: scratchVel[0],
          vy: scratchVel[1],
          vz: scratchVel[2],
          accelX,
          accelZ,
          gravity,
          drag,
          tintR: scratchTintOut[0],
          tintG: scratchTintOut[1],
          tintB: scratchTintOut[2],
          collision: layer.collision,
          clampVelocity: layer.clampVelocity,
          velCurve: layer.velCurve,
          subEmitters: layer.subEmitters,
          subDepth: slot.subDepth,
          lightSlotIdx,
          lightBaseIntensity: layer.particleLight?.intensity ?? 2.0,
        });
      }
      return dur - clampedInitAge;
    }

    const isNoneRender = layer.renderMode === 'none';
    if (!atlasParticles && !isNoneRender) return;
    const lightSlotIdx = layer.particleLight
      ? allocParticleLight(layer.particleLight, scratchPos[0], scratchPos[1], scratchPos[2], dur, scratchTintOut)
      : -1;
    const needsTracking = Boolean(layer.collision)
      || Boolean(layer.trail && layer.clampVelocity)
      || (Array.isArray(layer.subEmitters) && layer.subEmitters.length > 0)
      || lightSlotIdx >= 0;
    const { flipbook: resolvedFb, uvRect: resolvedUv } = resolveFlipbookAndUv(layer, rawDur);
    const atlasSlot = (!isNoneRender && atlasParticles)
      ? atlasParticles.emit({
          x: scratchPos[0],
          y: scratchPos[1],
          z: scratchPos[2],
          vx: scratchVel[0],
          vy: scratchVel[1],
          vz: scratchVel[2],
          accelX,
          accelZ,
          windMul,
          duration: dur,
          initialAge: clampedInitAge,
          sizeStart,
          gravity,
          drag,
          staticPos: Boolean(layer.collision),
          persistent: Boolean(layer.persistent),
          curveCycle: (layer.curveCycle ?? 0) / simSpd,
          curveRow: layer._curveRow,
          hasVelCurve: Boolean(layer.velCurve),
          hasSizeSep: Boolean(layer.sizeYCurve || layer.sizeY !== undefined),
          rotation: rot0,
          angularVel: angVel,
          rotX: rotX0,
          rotY: rotY0,
          spinX,
          spinY,
          flipX,
          flipY,
          hdr: layer.hdr ?? 1.0,
          tintRgb24,
          orbitalY,
          centerOffX,
          centerOffZ,
          renderMode: layer.renderMode ?? 'billboard',
          ...layer._renderState,
          cullMode: layer.cullMode,
          alphaCutoff: layer.alphaCutoff,
          cameraFade: layer.cameraFade,
          pivot: layer.pivot,
          velocityScale: layer.velocityScale,
          lengthScale: layer.lengthScale,
          uvScale: layer.uvScale,
          uvOffset: layer.uvOffset,
          emissionBoost: layer.emissionBoost ?? (Array.isArray(layer.emission) ? Math.max(layer.emission[0] ?? 0, layer.emission[1] ?? 0, layer.emission[2] ?? 0) : 0),
          dissolve: layer.dissolve,
          sprite: layer.sprite,
          flipbook: resolvedFb,
          uvRect: resolvedUv,
          noiseStrength,
          noiseYScale,
          noiseFreq,
          noiseScroll,
          noiseDamp,
          clampVelocity: layer.clampVelocity,
          rotationBySpeed: layer.rotationBySpeed,
          customData: layer.customData,
          uberMat: layer.uberMat,
          space: isLocalSpace ? 'local' : 'world',
          effectSlotIdx: isLocalSpace ? slot.localSlotIdx : 0,
          aspectY: resolvedAspectY,
          stretch: resolvedAspectY ?? layer.stretch ?? (layer.renderMode === 'vertical' || layer.renderMode === 'billboard' ? 1.0 : 0.8),
          phase,
        })
      : -1;

    let trackedSlot = -1;
    if (needsTracking) {
      trackedSlot = allocTrackedParticle({
        atlasState: layer._renderState,
        atlasSlot,
        meshSlot: -1,
        duration: dur,
        initialAge: clampedInitAge,
        x: scratchPos[0],
        y: scratchPos[1],
        z: scratchPos[2],
        vx: scratchVel[0],
        vy: scratchVel[1],
        vz: scratchVel[2],
        accelX,
        accelZ,
        gravity,
        drag,
        curveRow: layer._curveRow ?? 0,
        hasVelCurve: Boolean(layer.velCurve),
        velCurve: layer.velCurve,
        orbitalY,
        centerOffX,
        centerOffZ,
        tintR: scratchTintOut[0],
        tintG: scratchTintOut[1],
        tintB: scratchTintOut[2],
        collision: layer.collision,
        clampVelocity: layer.clampVelocity,
        subEmitters: layer.subEmitters,
        subDepth: slot.subDepth,
        lightSlotIdx,
        lightBaseIntensity: layer.particleLight?.intensity ?? 2.0,
      });
      if (layer.subEmitters) {
        const followTp = trackedSlot >= 0 ? trackedParticles[trackedSlot] : null;
        fireSubEmitters(layer.subEmitters, 'birth', scratchPos[0], scratchPos[1], scratchPos[2], slot.subDepth, scratchVel[0], scratchVel[1], scratchVel[2], scratchTintOut[0], scratchTintOut[1], scratchTintOut[2], followTp);
      }
    }

    if (layer.trail) {
      const hasPartColCurve = Array.isArray(layer.colorCurve) && layer.colorCurve.length >= 2;
      const c0 = (!layer.trail.inheritColor || !hasPartColCurve) ? layer.colorCurve?.[0]?.[1] : null;
      const trailTint = [
        scratchTintOut[0] * (c0 ? (c0[0] ?? 1) : 1),
        scratchTintOut[1] * (c0 ? (c0[1] ?? 1) : 1),
        scratchTintOut[2] * (c0 ? (c0[2] ?? 1) : 1),
      ];
      const trailCustom1 = layer.trail.custom1
        ? layer.trail.custom1
        : (layer.trail.useCustomData ? sampleCustomDataVec4(layer.customData?.custom1, prng, Math.min(1, clampedInitAge / Math.max(0.01, dur))) : null);
      if (layer.trail.mode === 'ribbon' && ls) {
        if (!ls.ribbonOpts) {
          ls.ribbonOpts = {
            color: trailTint,
            width: layer.trail.width ?? 0.25,
            endWidth: layer.trail.endWidth ?? 0.02,
            widthCurve: layer.trail.widthCurve ?? null,
            hdr: layer.trail.hdr ?? 1.5,
            blend: layer.trail.blend ?? 'additive',
            sprite: layer.trail.sprite ?? null,
            uvRect: layer.trail.uvRect ?? (layer.trail.sprite && atlasParticles?.regions?.[layer.trail.sprite]) ?? null,
            uberMat: layer.trail.uberMat ?? null,
            textureScale: layer.trail.textureScale ?? null,
            custom1: trailCustom1 ? [...trailCustom1] : null,
            lifetime: 0,
            alpha: layer.trail.alpha ?? 1.0,
          };
        }
        ls.ribbonPts.push({
          age: clampedInitAge,
          duration: dur,
          x0: scratchPos[0], y0: scratchPos[1], z0: scratchPos[2],
          vx: scratchVel[0], vy: scratchVel[1], vz: scratchVel[2],
          gravity, drag, noiseStrength, noiseYScale, noiseFreq, noiseScroll, noiseDamp, phase,
          orbitalX, orbitalY, orbitalZ, centerOffX, centerOffY, centerOffZ, trackedSlot,
        });
        if (ls.ribbonPts.length > 16) ls.ribbonPts.shift();
      } else {
        allocTrailFollower(
          scratchPos[0], scratchPos[1], scratchPos[2],
          scratchVel[0], scratchVel[1], scratchVel[2],
          gravity, drag, noiseStrength, noiseYScale, noiseFreq, phase,
          dur, clampedInitAge, layer.trail, trailTint,
          orbitalY, centerOffX, centerOffZ,
          sizeStart, layer.sizeCurve,
          trackedSlot,
          orbitalX, orbitalZ, centerOffY,
          trailCustom1,
          hasPartColCurve ? layer.colorCurve : null,
          noiseScroll, noiseDamp,
        );
      }
    }
    return dur - clampedInitAge;
  }

  function tryEmitWithCap(layer, ls, slot, emitIdx = 0, emitCount = 1) {
    const cap = layer.maxParticles | 0;
    if (cap <= 0 || cap > 64) {
      emitParticleOrMesh(layer, slot, 0, ls, emitIdx, emitCount);
      return true;
    }
    let active = 0;
    let freeIdx = -1;
    for (let k = 0; k < 64; k++) {
      if (ls.activeEndTimes[k] > slot.age) {
        active += 1;
      } else if (freeIdx === -1) {
        freeIdx = k;
      }
    }
    if (active >= cap) return false;
    const remDur = emitParticleOrMesh(layer, slot, 0, ls, emitIdx, emitCount) ?? 0.5;
    const writeIdx = freeIdx >= 0 ? freeIdx : (ls.activeEndCursor++ % 64);
    ls.activeEndTimes[writeIdx] = layer.persistent ? Infinity : (slot.age + remDur);
    return true;
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
    slot.prevX = slot.x;
    slot.prevY = slot.y;
    slot.prevZ = slot.z;
    slot.yaw = slot.follow?.yaw ?? options.yaw ?? 0;
    slot.scale = options.scale ?? 1;
    slot.subDepth = options._subDepth ?? 0;
    slot.inheritVx = options._inheritVx ?? 0;
    slot.inheritVy = options._inheritVy ?? 0;
    slot.inheritVz = options._inheritVz ?? 0;
    slot.inheritTintR = options._inheritTint?.[0] ?? 1;
    slot.inheritTintG = options._inheritTint?.[1] ?? 1;
    slot.inheritTintB = options._inheritTint?.[2] ?? 1;
    slot.localSlotIdx = 0;
    if (compiled.layers.some((l) => l.space === 'local' && !l._shurikenLayer) && freeLocalSlots.length > 0) {
      slot.localSlotIdx = freeLocalSlots.pop();
      atlasParticles?.setEffectOffset?.(slot.localSlotIdx, slot.x, slot.y, slot.z);
      meshVfx?.setEffectOffset?.(slot.localSlotIdx, slot.x, slot.y, slot.z);
    }
    shurikenKernel?.setEffectTransform?.(slot.id, slot.x, slot.y, slot.z, slot.yaw, 0, 0, 0);
    slot.lightSlotIdx = -1;
    ensureSlotLayerStates(slot, compiled.layers.length);

    for (let l = 0; l < compiled.layers.length; l++) {
      const layer = compiled.layers[l];
      const ls = slot.layers[l];
      const simSpd = layer._simSpd ?? 1;
      const hasRate = Array.isArray(layer.rate) ? (layer.rate[1] > 0) : ((layer.rate ?? 0) > 0);
      const noBursts = !Array.isArray(layer.bursts) || layer.bursts.length === 0;
      ls.cycleAge = 0;
      ls.rateAccum = (layer.maxParticles > 0 && noBursts && hasRate) ? 1 : 0;
      ls.distAccum = 0;
      ls.emitSeq = 0;
      ls.activeEndTimes.fill(-1);
      ls.activeEndCursor = 0;
      ls.triggeredOnce = false;
      const bursts = layer.bursts;
      for (let b = 0; b < MAX_BURSTS_PER_LAYER; b++) {
        ls.burstCyclesDone[b] = 0;
        ls.burstNextTime[b] = bursts && bursts[b] ? ((bursts[b].time ?? 0) / simSpd) : 0;
      }
    }

    triggerJuice(compiled, slot);
    totalPlayed += 1;

    // Immediately evaluate t=0 bursts and prewarmed looping layers so frame 1 is populated.
    for (let l = 0; l < compiled.layers.length; l++) {
      const layer = compiled.layers[l];
      if (!layer.prewarm) continue;
      const simSpd = layer._simSpd ?? 1;
      const avgRate = (Array.isArray(layer.rate)
        ? (Number(layer.rate[0] ?? 0) + Number(layer.rate[1] ?? layer.rate[0] ?? 0)) * 0.5
        : Number(layer.rate ?? 0)) * simSpd;
      const avgLife = (Array.isArray(layer.life)
        ? (Number(layer.life[0] ?? 1) + Number(layer.life[1] ?? layer.life[0] ?? 1)) * 0.5
        : Number(layer.life ?? 1)) / simSpd;
      if (avgRate > 0 && avgLife > 0.05) {
        const emScale = layer._shurikenLayer && shurikenKernel
          ? (SHURIKEN_QUALITY_TIERS[shurikenKernel.getQualityTier()]?.emissionScale ?? 1.0)
          : 1.0;
        const warmCount = Math.min(180, Math.max(layer._shurikenLayer ? 0 : 1, Math.round(avgRate * avgLife * emScale)));
        for (let k = 0; k < warmCount; k++) {
          const frac = (k + prng.nextFloat()) / warmCount;
          emitParticleOrMesh(layer, slot, frac * avgLife * simSpd);
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
    const dxMove = slot.x - slot.prevX;
    const dyMove = slot.y - slot.prevY;
    const dzMove = slot.z - slot.prevZ;
    const moveDist = Math.hypot(dxMove, dyMove, dzMove);
    for (let l = 0; l < layers.length; l++) {
      const layer = layers[l];
      const ls = slot.layers[l];
      const simSpd = layer._simSpd ?? 1;
      const delay = (layer.delay ?? 0) / simSpd;
      const localAge = ls.cycleAge - delay;
      if (localAge < 0) continue;

      if (layer._kind === 'slash' || layer._kind === 'lightning' || layer._kind === 'telegraph') {
        if (!ls.triggeredOnce) {
          ls.triggeredOnce = true;
          triggerAuxiliaryLayer(layer, slot);
        }
        continue;
      }

      const layerLoop = layer.loop !== undefined ? Boolean(layer.loop) : slot.loop;
      const layerDur = Math.max(0.01, (layer.duration ?? slot.duration) / simSpd);
      const emScale = layer._shurikenLayer && shurikenKernel
        ? (SHURIKEN_QUALITY_TIERS[shurikenKernel.getQualityTier()]?.emissionScale ?? 1.0)
        : 1.0;

      if (Array.isArray(layer.bursts)) {
        const bLen = Math.min(layer.bursts.length, MAX_BURSTS_PER_LAYER);
        for (let b = 0; b < bLen; b++) {
          const burst = layer.bursts[b];
          const cycles = burst.cycles === 0 ? Infinity : Math.max(1, burst.cycles ?? 1);
          const interval = Math.max(0.01, (burst.interval ?? 0.01) / simSpd);
          while (ls.burstCyclesDone[b] < cycles && localAge >= ls.burstNextTime[b] && (cycles !== Infinity || ls.burstNextTime[b] < layerDur + 1e-4)) {
            if (burst.probability === undefined || burst.probability >= 1 || prng.nextFloat() <= burst.probability) {
              const rawCount = readRange(burst.count, 1, 1, prng);
              const count = layer._shurikenLayer
                ? Math.max(rawCount > 0 && emScale > 0 ? 1 : 0, Math.round(rawCount * emScale))
                : Math.max(0, Math.round(rawCount));
              for (let c = 0; c < count; c++) {
                tryEmitWithCap(layer, ls, slot, c, count);
              }
            }
            ls.burstCyclesDone[b] += 1;
            ls.burstNextTime[b] += interval;
          }
        }
      }

      const rateMult = Array.isArray(layer.rateCurve)
        ? Math.max(0, evaluateSizeCurve(layer.rateCurve, Math.min(1, localAge / layerDur)))
        : 1;
      const rate = (layer.rate !== undefined ? readRange(layer.rate, 0, 0, prng) : 0) * rateMult * simSpd * emScale;
      if (rate > 0) {
        if (layerLoop || localAge <= layerDur) {
          if (dt > 0) ls.rateAccum += rate * dt;
          while (ls.rateAccum >= 1) {
            if (!tryEmitWithCap(layer, ls, slot)) {
              ls.rateAccum = 0;
              break;
            }
            ls.rateAccum -= 1;
          }
        }
      }

      const rateDist = layer.rateOverDistance !== undefined ? readRange(layer.rateOverDistance, 0, 0, prng) : 0;
      if (rateDist > 0 && moveDist > 0.0001) {
        if (layerLoop || localAge <= layerDur) {
          const totalNeed = ls.distAccum + rateDist * moveDist;
          const totalSteps = Math.floor(totalNeed);
          ls.distAccum = totalNeed - totalSteps;
          const savedX = slot.x;
          const savedY = slot.y;
          const savedZ = slot.z;
          const capped = Math.min(totalSteps, 32);
          for (let sIdx = 0; sIdx < capped; sIdx++) {
            const frac = (sIdx + 0.5) / capped;
            slot.x = slot.prevX + dxMove * frac;
            slot.y = slot.prevY + dyMove * frac;
            slot.z = slot.prevZ + dzMove * frac;
            if (!tryEmitWithCap(layer, ls, slot)) {
              ls.distAccum = 0;
              break;
            }
          }
          slot.x = savedX;
          slot.y = savedY;
          slot.z = savedZ;
        }
      }
    }
    slot.prevX = slot.x;
    slot.prevY = slot.y;
    slot.prevZ = slot.z;
  }

  function update(visualDt) {
    const dt = Math.max(0, visualDt);

    for (let i = 0; i < MAX_ACTIVE_EFFECTS; i++) {
      const slot = effectSlots[i];
      if (!slot.active || !slot.recipe) continue;

      if (slot.follow) {
        if (slot.follow._isTrackedParticle && !slot.follow.active) {
          slot.follow = null;
        } else {
          const prevFx = slot.x;
          const prevFy = slot.y;
          const prevFz = slot.z;
          if (slot.follow.x !== undefined) slot.x = slot.follow.x;
          if (slot.follow.y !== undefined) slot.y = slot.follow.y;
          if (slot.follow.z !== undefined) slot.z = slot.follow.z;
          if (slot.follow.yaw !== undefined) slot.yaw = slot.follow.yaw;
          if (dt > 1e-5) {
            slot.followVx = (slot.x - prevFx) / dt;
            slot.followVy = (slot.y - prevFy) / dt;
            slot.followVz = (slot.z - prevFz) / dt;
          }
          if (slot.follow._isTrackedParticle) {
            let allStarted = true;
            for (let l = 0; l < slot.recipe.layers.length; l++) {
              const lSim = slot.recipe.layers[l]._simSpd ?? 1;
              const lDelay = (slot.recipe.layers[l].delay ?? 0) / lSim;
              if (slot.layers[l].cycleAge < lDelay) { allStarted = false; break; }
            }
            if (allStarted) slot.follow = null;
          }
        }
      }

      if (slot.localSlotIdx > 0) {
        atlasParticles?.setEffectOffset?.(slot.localSlotIdx, slot.x, slot.y, slot.z);
        meshVfx?.setEffectOffset?.(slot.localSlotIdx, slot.x, slot.y, slot.z);
      }
      shurikenKernel?.setEffectTransform?.(slot.id, slot.x, slot.y, slot.z, slot.yaw, slot.followVx, slot.followVy, slot.followVz);

      slot.age += dt;
      slot.cycleAge += dt;

      if (slot.loop && slot.cycleAge >= slot.duration) {
        slot.cycleAge %= slot.duration;
      }
      for (let l = 0; l < slot.recipe.layers.length; l++) {
        const layer = slot.recipe.layers[l];
        const ls = slot.layers[l];
        const simSpd = layer._simSpd ?? 1;
        const delay = (layer.delay ?? 0) / simSpd;
        const layerLoop = layer.loop !== undefined ? Boolean(layer.loop) : slot.loop;
        const layerDur = Math.max(0.01, (layer.duration ?? slot.duration) / simSpd);
        ls.cycleAge += dt;
        if (layerLoop && ls.cycleAge >= delay + layerDur) {
          ls.cycleAge = delay + ((ls.cycleAge - delay) % layerDur);
          ls.triggeredOnce = false;
          const bursts = layer.bursts;
          for (let b = 0; b < MAX_BURSTS_PER_LAYER; b++) {
            ls.burstCyclesDone[b] = 0;
            ls.burstNextTime[b] = bursts && bursts[b] ? ((bursts[b].time ?? 0) / simSpd) : 0;
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
      if (!ls.active || ls.particleTrackIdx >= 0) continue;
      if (!ls.loop) {
        ls.age += dt;
        if (ls.age >= ls.duration) {
          releaseLightSlot(i);
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
          fireSubEmitters(tp.subEmitters, 'death', tp.x, tp.y, tp.z, tp.subDepth, tp.vx, tp.vy, tp.vz, tp.tintR, tp.tintG, tp.tintB);
        }
        if (tp.lightSlotIdx >= 0) {
          releaseLightSlot(tp.lightSlotIdx);
          tp.lightSlotIdx = -1;
        }
        tp.active = false;
        tp.atlasState = null;
        continue;
      }
      if (dt > 0) {
        if (!tp.hasCollision && (tp.hasVelCurve || Math.abs(tp.orbitalY) > 1e-4)) {
          const dispInt = tp.hasVelCurve && atlasParticles?.lut?.sampleVelDisp
            ? atlasParticles.lut.sampleVelDisp(tp.curveRow, Math.min(1, tp.age / Math.max(1e-4, tp.duration)))
            : tp.age / Math.max(1e-4, tp.duration);
          tp._evalExt.hasVelCurve = tp.hasVelCurve;
          tp._evalExt.velDispIntegral = dispInt;
          tp._evalExt.duration = tp.duration;
          tp._evalExt.accelX = tp.accelX;
          tp._evalExt.accelZ = tp.accelZ;
          evaluateAtlasParticlePosition(
            tp.initX, tp.initY, tp.initZ,
            tp.initVx, tp.initVy, tp.initVz,
            tp.gravity, tp.drag,
            0, 0, 0,
            tp.age, is2D, scratchPos,
            tp.orbitalY, tp.centerOffX, tp.centerOffZ,
            1, tp._evalExt,
          );
          tp.x = scratchPos[0];
          tp.y = scratchPos[1];
          tp.z = scratchPos[2];
        } else {
          if (tp.drag > 0.001) {
            const d = Math.exp(-tp.drag * dt);
            tp.vx *= d;
            tp.vy *= d;
            tp.vz *= d;
          }
          tp.vx += tp.accelX * dt;
          tp.vy += (is2D ? tp.gravity : -tp.gravity) * dt;
          tp.vz += tp.accelZ * dt;
          if (tp.clampVelocity && tp.clampVelocity.limit > 0) {
            const spd = Math.hypot(tp.vx, tp.vy, tp.vz);
            const lim = tp.clampVelocity.limit;
            if (spd > lim) {
              const cDampen = Math.max(0, Math.min(1, Number(tp.clampVelocity.dampen ?? 1)));
              const sc = (spd - (spd - lim) * cDampen) / spd;
              tp.vx *= sc;
              tp.vy *= sc;
              tp.vz *= sc;
            }
          }
          const vScale = tp.velCurve ? evaluateSizeCurve(tp.velCurve, Math.min(1, tp.age / Math.max(1e-4, tp.duration))) : 1.0;
          tp.x += tp.vx * vScale * dt;
          tp.y += tp.vy * vScale * dt;
          tp.z += tp.vz * vScale * dt;
        }
        if (tp.hasCollision && !is2D) {
          const col = collisionResolver ? collisionResolver(tp.x, tp.y, tp.z, tp.vx, tp.vy, tp.vz) : null;
          const hitGround = !col && tp.y <= tp.groundY && tp.vy < 0;
          if ((col && col.hit) || hitGround) {
            const nx = col?.nx ?? 0;
            const ny = col?.ny ?? 1;
            const nz = col?.nz ?? 0;
            if (col?.y !== undefined) tp.y = col.y;
            else if (hitGround) tp.y = tp.groundY;
            const vn = tp.vx * nx + tp.vy * ny + tp.vz * nz;
            if (vn < 0) {
              if (tp.bouncesLeft > 0 && Math.abs(vn) >= tp.minSpeed) {
                const imp = (1 + tp.bounce) * vn;
                tp.vx -= imp * nx;
                tp.vy -= imp * ny;
                tp.vz -= imp * nz;
                const fric = Math.max(0, 1 - tp.dampen);
                tp.vx *= fric;
                tp.vz *= fric;
                tp.bouncesLeft -= 1;
              } else {
                tp.vx -= vn * nx;
                tp.vy -= vn * ny;
                tp.vz -= vn * nz;
                tp.vx *= 0.85;
                tp.vz *= 0.85;
              }
            }
            if (tp.subEmitters) {
              fireSubEmitters(tp.subEmitters, 'collision', tp.x, tp.y, tp.z, tp.subDepth, tp.vx, tp.vy, tp.vz, tp.tintR, tp.tintG, tp.tintB);
            }
          }
        }
        if (tp.hasCollision && atlasParticles && tp.atlasSlot >= 0) {
          atlasParticles.updateSlot(tp.atlasState, tp.atlasSlot, tp.x, tp.y, tp.z, tp.vx, tp.vy, tp.vz);
        }
        if (tp.hasCollision && meshVfx && tp.meshSlot >= 0) {
          meshVfx.updateSlot(tp.meshSlot, tp.x, tp.y, tp.z, tp.vx, tp.vy, tp.vz);
        }
      }
      if (tp.lightSlotIdx >= 0 && tp.lightSlotIdx < lightSlots.length) {
        const ls = lightSlots[tp.lightSlotIdx];
        ls.light.position.set(tp.x, tp.y, tp.z);
        const k = Math.max(0, 1 - tp.age / Math.max(0.01, tp.duration));
        ls.light.intensity = tp.lightBaseIntensity * k;
      }
    }

    if (trails) {
      const maxNodes = typeof trails.getStats === 'function' ? (trails.getStats().trailNodes ?? 8) : 8;
      const segDiv = Math.max(6, maxNodes - 2);
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
        const lifeT = Math.min(1, tf.age / Math.max(0.01, tf.duration));
        if (tf.sizeCurve && typeof trails.setTrailWidthScale === 'function') {
          trails.setTrailWidthScale(tf.trailId, evaluateSizeCurve(tf.sizeCurve, lifeT));
        }
        applyTrailLifeMod(tf.trailId, lifeT, tf.lifeColorCurve, tf.particleColorCurve);
        let px;
        let py;
        let pz;
        const stepDt = Math.max(0.008, tf.trailLifetime / segDiv);
        const nowT = typeof trails.getTime === 'function' ? trails.getTime() : 0;
        let sub = 0;
        if (tf.trackedSlot >= 0 && trackedParticles[tf.trackedSlot]?.active) {
          const tp = trackedParticles[tf.trackedSlot];
          px = tp.x;
          py = tp.y;
          pz = tp.z;
          tf.sampleAccum += dt;
          if (tf.sampleAccum >= stepDt || (tf.pushedPoints <= 1 && tf.age >= 0.012) || typeof trails.updateTrailHead !== 'function') {
            tf.sampleAccum = tf.sampleAccum >= stepDt ? (tf.sampleAccum % stepDt) : 0;
            trails.pushTrailPoint(tf.trailId, px, py, pz, nowT);
            tf.pushedPoints += 1;
          } else {
            trails.updateTrailHead(tf.trailId, px, py, pz, nowT);
          }
        } else {
          const angSpd = Math.hypot(tf.orbitalX || 0, tf.orbitalY || 0, tf.orbitalZ || 0);
          const maxArcDt = angSpd > 0.5 ? (0.16 / angSpd) : stepDt;
          const effStepDt = Math.max(0.006, Math.min(stepDt, maxArcDt));
          scratchTrailExt.noiseScroll = tf.noiseScroll;
          scratchTrailExt.noiseDamp = tf.noiseDamp;
          tf.sampleAccum += dt;
          while (tf.sampleAccum >= effStepDt && sub < 12) {
            tf.sampleAccum -= effStepDt;
            const sampleAge = Math.max(0, tf.age - tf.sampleAccum);
            evaluateAtlasParticlePosition(
              tf.x0, tf.y0, tf.z0,
              tf.vx, tf.vy, tf.vz,
              tf.gravity, tf.drag,
              tf.noiseStrength, tf.noiseFreq, tf.phase,
              sampleAge, is2D, scratchPos,
              tf.orbitalY, tf.centerOffX, tf.centerOffZ,
              tf.noiseYScale, scratchTrailExt, tf.orbitalX, tf.orbitalZ, tf.centerOffY,
            );
            trails.pushTrailPoint(tf.trailId, scratchPos[0], scratchPos[1], scratchPos[2], nowT - tf.sampleAccum);
            tf.pushedPoints += 1;
            sub += 1;
          }
          if (tf.sampleAccum >= effStepDt) tf.sampleAccum %= effStepDt;
          evaluateAtlasParticlePosition(
            tf.x0, tf.y0, tf.z0,
            tf.vx, tf.vy, tf.vz,
            tf.gravity, tf.drag,
            tf.noiseStrength, tf.noiseFreq, tf.phase,
            tf.age, is2D, scratchPos,
            tf.orbitalY, tf.centerOffX, tf.centerOffZ,
            tf.noiseYScale, scratchTrailExt, tf.orbitalX, tf.orbitalZ, tf.centerOffY,
          );
          px = scratchPos[0];
          py = scratchPos[1];
          pz = scratchPos[2];
          if ((sub === 0 && tf.pushedPoints <= 1 && tf.age >= 0.012) || typeof trails.updateTrailHead !== 'function') {
            trails.pushTrailPoint(tf.trailId, px, py, pz, nowT);
            tf.pushedPoints += 1;
          } else {
            trails.updateTrailHead(tf.trailId, px, py, pz, nowT);
          }
        }
      }

      if (typeof trails.allocTrail === 'function' && typeof trails.freeTrail === 'function') {
        for (let i = 0; i < MAX_ACTIVE_EFFECTS; i++) {
          const slot = effectSlots[i];
          if (!slot.active || !slot.recipe) continue;
          const layerCount = Math.min(slot.recipe.layers.length, MAX_LAYERS_PER_EFFECT);
          for (let l = 0; l < layerCount; l++) {
            const ls = slot.layers[l];
            const pts = ls.ribbonPts;
            if (!pts || pts.length === 0) continue;
            for (let p = pts.length - 1; p >= 0; p--) {
              pts[p].age += dt;
              if (pts[p].age >= pts[p].duration) pts.splice(p, 1);
            }
            if (ls.ribbonTrailId >= 0) {
              trails.freeTrail(ls.ribbonTrailId);
              ls.ribbonTrailId = -1;
            }
            if (pts.length >= 2 && ls.ribbonOpts) {
              ls.ribbonTrailId = trails.allocTrail(ls.ribbonOpts);
              if (ls.ribbonTrailId >= 0) {
                for (let p = 0; p < pts.length; p++) {
                  const rp = pts[p];
                  if (rp.trackedSlot >= 0 && trackedParticles[rp.trackedSlot]?.active) {
                    const tp = trackedParticles[rp.trackedSlot];
                    trails.pushTrailPoint(ls.ribbonTrailId, tp.x, tp.y, tp.z);
                  } else {
                    scratchTrailExt.noiseScroll = rp.noiseScroll ?? 0;
                    scratchTrailExt.noiseDamp = Boolean(rp.noiseDamp);
                    evaluateAtlasParticlePosition(
                      rp.x0, rp.y0, rp.z0, rp.vx, rp.vy, rp.vz,
                      rp.gravity, rp.drag, rp.noiseStrength, rp.noiseFreq, rp.phase,
                      rp.age, is2D, scratchPos,
                      rp.orbitalY, rp.centerOffX, rp.centerOffZ, rp.noiseYScale,
                      scratchTrailExt, rp.orbitalX, rp.orbitalZ, rp.centerOffY,
                    );
                    trails.pushTrailPoint(ls.ribbonTrailId, scratchPos[0], scratchPos[1], scratchPos[2]);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  function stopAll() {
    for (let i = 0; i < MAX_ACTIVE_EFFECTS; i++) {
      if (effectSlots[i].active) stopSlot(effectSlots[i]);
    }
    for (let i = 0; i < MAX_TRACKED_PARTICLES; i++) {
      if (trackedParticles[i].lightSlotIdx >= 0) {
        releaseLightSlot(trackedParticles[i].lightSlotIdx);
        trackedParticles[i].lightSlotIdx = -1;
      }
      trackedParticles[i].active = false;
      trackedParticles[i].atlasState = null;
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

  function setCollisionResolver(fn) {
    collisionResolver = typeof fn === 'function' ? fn : null;
  }

  return {
    registerEffect,
    getEffect: (id) => registry.get(id) ?? null,
    playEffect,
    setCollisionResolver,
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
