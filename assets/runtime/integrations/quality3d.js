/**
 * Optional 3D render-quality controller.
 *
 * Uses explicit quality budgets, conservative device selection, hysteresis
 * and resolution-only scaling before an expensive quality-tier drop.
 *
 * No Three.js, DOM, GPU probe, scheduler, localStorage or network dependency.
 * Game rules and fixed ticks MUST NOT depend on render quality.
 */
import { fitDrawingBuffer } from './quality3d/viewport.js';

/** @typedef {'low'|'medium'|'high'} QualityTier */
/** @typedef {QualityTier|'ultra'} QualityPresetTier Tier names accepted by preset tables. */
/** @typedef {'auto'|QualityTier} QualityMode */

/**
 * @typedef {object} Quality3DPreset
 * @property {number} maxPixels Hard physical-pixel budget.
 * @property {number} maxPixelRatio Max device pixel ratio.
 * @property {number} shadowMapSize Shadow map edge in texels.
 * @property {boolean} shadowsEnabled
 * @property {number} shadowDistance World units.
 * @property {number} msaaSamples
 * @property {boolean} ssao
 * @property {boolean} ssgi
 * @property {boolean} ssr
 * @property {boolean} contactShadows
 * @property {boolean} bloom
 * @property {number} volumetricSteps
 * @property {number} anisotropy
 * @property {boolean} fxaa
 * @property {number} sharpen
 * @property {number} drawDistance World units.
 * @property {boolean} occlusionCulling
 * @property {number} animationLodScale
 * @property {number} particleScale
 * @property {number} maxDynamicLights
 * @property {number} megaLightsSamples
 * @property {number} maxClusteredLights
 */
/**
 * @typedef {object} Quality2DPreset
 * @property {number} maxPixelRatio
 * @property {boolean} groundShadows
 * @property {boolean} imageSmoothing
 * @property {number} particleScale
 * @property {'fast'|'full'} hitFlashQuality
 */
/**
 * @typedef {object} QualityDeviceHints
 * @property {boolean} [mobile=false]
 * @property {string} [rendererName=''] GPU renderer string.
 * @property {number|null} [memoryGB=null] Device memory in GB.
 */
/**
 * @typedef {object} QualitySnapshot
 * @property {QualityMode} mode
 * @property {QualityTier} tier
 * @property {Quality3DPreset} preset
 * @property {number} dynamicScale Resolution scale 0..1.
 * @property {number} lastMeanMs Last mean frame time in ms.
 * @property {number|null} lastMeanGpuMs Mean GPU time in the latest window, when enough samples were available.
 * @property {number} transitionCount
 * @property {number} droppedLongFrames
 * @property {{limitBytes: number, targetBytes: number, fixedTargetBytes: number, residentBytes: number, overBudget: boolean} | null} memory Latest observed render memory footprint.
 */
/**
 * @typedef {object} ViewportPlan
 * @property {number} cssWidth
 * @property {number} cssHeight
 * @property {number} pixelRatio
 * @property {number} bufferWidth
 * @property {number} bufferHeight
 * @property {QualityTier} tier
 * @property {number} dynamicScale
 * @property {number} maxPixels
 */
/**
 * @typedef {object} ViewportLimits
 * @property {number} [maxBufferWidth]
 * @property {number} [maxBufferHeight]
 */
/**
 * @typedef {object} AdaptiveQualityOptions
 * @property {QualityMode} [mode='auto']
 * @property {QualityDeviceHints} [device={}]
 * @property {number} [minScale=0.6] Min dynamic resolution scale.
 * @property {number} [maxScale=1] Max dynamic resolution scale.
 * @property {number} [minPixelRatio=0.1]
 * @property {number} [maxPixelRatio=2]
 * @property {number} [settleMs=3500] Initial settle time in ms.
 * @property {number} [settleAfterChangeMs=1000]
 * @property {number} [sampleFrames=45] Frames per sample window (2..300).
 * @property {number} [degradeFrameMs=22] Mean frame ms above which quality drops.
 * @property {number} [recoverFrameMs=17] Mean frame ms below which quality recovers.
 * @property {number | null} [memoryBudgetBytes=null] Optional nominal target and resident byte budget.
 * @property {((state: QualitySnapshot, reason: string) => void)|null} [onChange=null]
 */
/**
 * @typedef {object} AdaptiveQualityController
 * @property {QualitySnapshot} state Current snapshot (getter).
 * @property {(next: QualityMode) => boolean} setMode
 * @property {(ms: number, gpuMs?: number|null) => boolean} sampleFrame
 * @property {(scalableTargetBytes: number, residentBytes?: number, fixedTargetBytes?: number) => boolean} sampleMemory Record allocation pressure independently of frame time.
 * @property {() => void} resetMemoryMeasurements Forget observations after a context, resource graph or viewport change.
 * @property {(cssWidth: number, cssHeight: number, dpr?: number, limits?: ViewportLimits) => ViewportPlan} planViewport
 * @property {() => void} resetMeasurements
 */

/** @type {readonly QualityTier[]} */
export const QUALITY_TIERS = Object.freeze(['low', 'medium', 'high']);

/** @type {Readonly<Record<QualityPresetTier, Readonly<Quality3DPreset>>>} */
export const QUALITY3D_PRESETS = Object.freeze({
  low: Object.freeze({
    maxPixels: 1_000_000, maxPixelRatio: 1.25, shadowMapSize: 1024, shadowsEnabled: false,
    shadowDistance: 18, msaaSamples: 0, ssao: false, ssgi: false, ssr: false, contactShadows: false,
    bloom: false, volumetricSteps: 0, anisotropy: 2, fxaa: false, sharpen: 0, drawDistance: 90,
    occlusionCulling: true, animationLodScale: 0.65, particleScale: 0.4, maxDynamicLights: 2,
    megaLightsSamples: 1, maxClusteredLights: 32,
  }),
  medium: Object.freeze({
    maxPixels: 1_500_000, maxPixelRatio: 1.5, shadowMapSize: 1536, shadowsEnabled: true,
    shadowDistance: 35, msaaSamples: 0, ssao: true, ssgi: false, ssr: false, contactShadows: true,
    bloom: false, volumetricSteps: 8, anisotropy: 4, fxaa: true, sharpen: 0.1, drawDistance: 150,
    occlusionCulling: true, animationLodScale: 1.0, particleScale: 0.75, maxDynamicLights: 4,
    megaLightsSamples: 2, maxClusteredLights: 96,
  }),
  high: Object.freeze({
    maxPixels: 2_300_000, maxPixelRatio: 2.0, shadowMapSize: 2048, shadowsEnabled: true,
    shadowDistance: 60, msaaSamples: 2, ssao: true, ssgi: true, ssr: true, contactShadows: true,
    bloom: true, volumetricSteps: 16, anisotropy: 8, fxaa: true, sharpen: 0.14, drawDistance: 240,
    occlusionCulling: true, animationLodScale: 1.35, particleScale: 1.0, maxDynamicLights: 8,
    megaLightsSamples: 3, maxClusteredLights: 256,
  }),
  ultra: Object.freeze({
    maxPixels: 3_700_000, maxPixelRatio: 2.0, shadowMapSize: 4096, shadowsEnabled: true,
    shadowDistance: 90, msaaSamples: 4, ssao: true, ssgi: true, ssr: true, contactShadows: true,
    bloom: true, volumetricSteps: 28, anisotropy: 16, fxaa: true, sharpen: 0.16, drawDistance: 350,
    occlusionCulling: true, animationLodScale: 1.75, particleScale: 1.25, maxDynamicLights: 12,
    megaLightsSamples: 4, maxClusteredLights: 512,
  }),
});

/**
 * Target-platform 3D realistic rendering profiles (`mobile_low`, `mobile_high`, `pc_ultra`)
 * layered on top of `QUALITY3D_PRESETS` so `post3d` dead-pass pruning, CSM cascades,
 * foliage Bayer dither, and decal projection mode scale cleanly across mobile & PC.
 */
export const QUALITY3D_PROFILES = Object.freeze({
  mobile_low: Object.freeze({
    ...QUALITY3D_PRESETS.low,
    profile: 'mobile_low',
    baseTier: 'low',
    shadowMapSize: 1024,
    shadowsEnabled: true,
    shadowCascades: 1,
    maxDynamicLights: 4,
    bloom: false,
    ssao: false,
    ssgi: false,
    ssr: false,
    contactShadows: false,
    volumetricSteps: 0,
    temporalAA: false,
    fxaa: false,
    foliageBayerDither: false,
    decalMode: 'surface',
  }),
  mobile_high: Object.freeze({
    ...QUALITY3D_PRESETS.medium,
    profile: 'mobile_high',
    baseTier: 'medium',
    shadowMapSize: 1024,
    shadowsEnabled: true,
    shadowCascades: 1,
    maxDynamicLights: 8,
    bloom: true,
    ssao: false,
    ssgi: false,
    ssr: false,
    contactShadows: false,
    volumetricSteps: 0,
    temporalAA: false,
    fxaa: true,
    foliageBayerDither: true,
    decalMode: 'projected',
  }),
  pc_ultra: Object.freeze({
    ...QUALITY3D_PRESETS.ultra,
    profile: 'pc_ultra',
    baseTier: 'ultra',
    shadowMapSize: 2048,
    shadowsEnabled: true,
    shadowCascades: 3,
    maxDynamicLights: 16,
    bloom: true,
    ssao: true,
    ssgi: true,
    ssr: true,
    contactShadows: true,
    volumetricSteps: 16,
    temporalAA: true,
    fxaa: true,
    foliageBayerDither: true,
    decalMode: 'projected',
  }),
});

/**
 * Resolves either a platform profile (`mobile_low` | `mobile_high` | `pc_ultra`)
 * or a base tier (`low` | `medium` | `high` | `ultra`).
 * @param {'mobile_low' | 'mobile_high' | 'pc_ultra' | QualityPresetTier} [nameOrTier='mobile_high']
 */
export function resolveQuality3DProfile(nameOrTier = 'mobile_high') {
  if (Object.prototype.hasOwnProperty.call(QUALITY3D_PROFILES, nameOrTier)) {
    return QUALITY3D_PROFILES[nameOrTier];
  }
  if (Object.prototype.hasOwnProperty.call(QUALITY3D_PRESETS, nameOrTier)) {
    const base = QUALITY3D_PRESETS[nameOrTier];
    return Object.freeze({
      ...base,
      profile: nameOrTier,
      baseTier: nameOrTier,
      shadowCascades: nameOrTier === 'low' ? 1 : nameOrTier === 'medium' ? 2 : 3,
      temporalAA: nameOrTier === 'high' || nameOrTier === 'ultra',
      foliageBayerDither: nameOrTier !== 'low',
      decalMode: nameOrTier === 'low' ? 'surface' : 'projected',
    });
  }
  throw new RangeError('Unsupported 3D quality profile or tier: ' + nameOrTier);
}

/** @type {Readonly<Record<QualityPresetTier, Readonly<Quality2DPreset>>>} */
export const QUALITY2D_PRESETS = Object.freeze({
  low: Object.freeze({
    maxPixelRatio: 1.0, groundShadows: false, imageSmoothing: false,
    particleScale: 0.4, hitFlashQuality: 'fast',
  }),
  medium: Object.freeze({
    maxPixelRatio: 1.5, groundShadows: true, imageSmoothing: true,
    particleScale: 0.75, hitFlashQuality: 'full',
  }),
  high: Object.freeze({
    maxPixelRatio: 2.0, groundShadows: true, imageSmoothing: true,
    particleScale: 1.0, hitFlashQuality: 'full',
  }),
  ultra: Object.freeze({
    maxPixelRatio: 3.0, groundShadows: true, imageSmoothing: true,
    particleScale: 1.25, hitFlashQuality: 'full',
  }),
});

const TIERS = Object.freeze(Object.keys(QUALITY3D_PRESETS));
const VALID_MODES = Object.freeze(['auto', ...TIERS]);
const TIER_RECOVERY_MS = 4500;
const TIER_MAX_RETRY_MS = 30000;
const TIER_PROBE_MS = 8000;
const TIER_COOLDOWN_MS = 2400;
/** @type {(x: number, lo: number, hi: number) => number} */
const inRange = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * @param {QualityPresetTier} [tier='high']
 * @param {'2d'|'3d'} [dimension='3d']
 * @returns {Readonly<Quality3DPreset>|Readonly<Quality2DPreset>}
 */
export function resolveQualityPreset(tier = 'high', dimension = '3d') {
  const table = dimension === '2d' ? QUALITY2D_PRESETS : QUALITY3D_PRESETS;
  if (!Object.prototype.hasOwnProperty.call(table, tier)) {
    throw new RangeError('Unsupported quality tier: ' + tier);
  }
  return table[tier];
}

/**
 * Pure, conservative hint selection. Does not allocate a probing WebGL context.
 * @param {QualityDeviceHints} [hints]
 * @returns {QualityTier}
 */
export function chooseInitial3dQuality({
  mobile = false, rendererName = '', memoryGB = null,
} = {}) {
  if (mobile) return 'low';
  const gpu = String(rendererName);
  if (/SwiftShader|llvmpipe|software|Mali|Adreno|PowerVR/i.test(gpu)) return 'low';
  if (/Intel/i.test(gpu) && !/Arc\b/i.test(gpu)) return 'medium';
  if (Number.isFinite(memoryGB) && memoryGB <= 2) return 'low';
  if (/NVIDIA|GeForce|RTX\b|Radeon RX|Intel Arc/i.test(gpu)) return 'high';
  return 'medium';
}

/**
 * @param {AdaptiveQualityOptions} [options]
 * @returns {Readonly<AdaptiveQualityController>}
 */
export function createAdaptiveQualityController({
  mode = 'auto',
  device = {},
  minScale = 0.6,
  maxScale = 1,
  minPixelRatio = 0.1,
  maxPixelRatio = 2,
  settleMs = 3500,
  settleAfterChangeMs = 1000,
  sampleFrames = 45,
  degradeFrameMs = 22,
  recoverFrameMs = 17,
  memoryBudgetBytes = null,
  onChange = null,
} = {}) {
  if (!VALID_MODES.includes(mode)) throw new RangeError('Unsupported 3D quality mode: ' + mode);
  if (!(minScale > 0 && minScale <= maxScale && maxScale <= 1)) {
    throw new RangeError('Invalid render scale range');
  }
  if (!(minPixelRatio > 0 && minPixelRatio <= maxPixelRatio && maxPixelRatio <= 4)) {
    throw new RangeError('Invalid pixel ratio bounds');
  }
  if (!Number.isFinite(settleMs) || settleMs < 0 ||
      !Number.isFinite(settleAfterChangeMs) || settleAfterChangeMs < 0) {
    throw new RangeError('Settle milliseconds must be nonnegative');
  }
  if (!Number.isInteger(sampleFrames) || sampleFrames < 2 || sampleFrames > 300) {
    throw new RangeError('sampleFrames must be 2..300');
  }
  if (!(recoverFrameMs > 0 && degradeFrameMs > recoverFrameMs)) {
    throw new RangeError('Invalid frame-time hysteresis');
  }
  if (memoryBudgetBytes !== null && (!Number.isSafeInteger(memoryBudgetBytes) || memoryBudgetBytes <= 0)) {
    throw new RangeError('memoryBudgetBytes must be a positive safe integer');
  }
  if (onChange !== null && typeof onChange !== 'function') throw new TypeError('onChange must be a function');

  let configuredMode = mode;
  let autoCeiling = mode === 'auto' ? chooseInitial3dQuality(device) : null;
  let tier = autoCeiling ?? mode;
  let dynamicScale = mode === 'auto' ? maxScale : 1;
  let slowAtFloor = 0;
  let healthyAtMaxScaleMs = 0;
  let tierRecoveryDelayMs = TIER_RECOVERY_MS;
  let tierProbeRemainingMs = 0;
  let transitionCount = 0;
  let droppedLongFrames = 0;
  let settle = settleMs;
  let cooldown = 0;
  let total = 0;
  let count = 0;
  let gpuTotal = 0;
  let gpuCount = 0;
  let lastMeanMs = 0;
  let lastMeanGpuMs = null;
  let memory = null;
  let memoryScale = null;
  let memoryTier = null;
  const measuredTiers = memoryBudgetBytes === null ? null : new Map();

  function snapshot() {
    return Object.freeze({
      mode: configuredMode,
      tier, preset: QUALITY3D_PRESETS[tier],
      dynamicScale, lastMeanMs, lastMeanGpuMs, transitionCount, droppedLongFrames, memory,
    });
  }
  function notify(reason) {
    transitionCount++;
    onChange?.(snapshot(), reason);
    return true;
  }
  function setMode(next) {
    if (!VALID_MODES.includes(next)) throw new RangeError('Unsupported 3D quality mode: ' + next);
    if (configuredMode === next) return false;
    configuredMode = next;
    autoCeiling = next === 'auto' ? chooseInitial3dQuality(device) : null;
    tier = autoCeiling ?? next;
    dynamicScale = next === 'auto' ? maxScale : 1;
    slowAtFloor = 0;
    healthyAtMaxScaleMs = 0;
    tierRecoveryDelayMs = TIER_RECOVERY_MS;
    tierProbeRemainingMs = 0;
    clearWindow();
    lastMeanGpuMs = null;
    settle = settleMs;
    cooldown = 0;
    resetMemoryMeasurements();
    return notify('mode');
  }
  function planViewport(cssWidth, cssHeight, dpr = 1, limits = {}) {
    if (!Number.isFinite(cssWidth) || cssWidth <= 0) throw new RangeError('Invalid canvas width');
    if (!Number.isFinite(cssHeight) || cssHeight <= 0) throw new RangeError('Invalid canvas height');
    if (!Number.isFinite(dpr) || dpr <= 0) throw new RangeError('Invalid device pixel ratio');
    const width = Math.max(1, Math.floor(cssWidth));
    const height = Math.max(1, Math.floor(cssHeight));
    const preset = QUALITY3D_PRESETS[tier];
    const budget = preset.maxPixels;
    const effectiveMaxPr = Math.min(maxPixelRatio, preset.maxPixelRatio ?? maxPixelRatio);
    return Object.freeze({
      cssWidth: width, cssHeight: height,
      ...fitDrawingBuffer(width, height, inRange(dpr, minPixelRatio, effectiveMaxPr), {
        maxBufferWidth: limits.maxBufferWidth,
        maxBufferHeight: limits.maxBufferHeight,
        maxPixels: budget,
        scale: dynamicScale,
      }),
      tier, dynamicScale, maxPixels: budget,
    });
  }
  function clearWindow() {
    total = 0;
    count = 0;
    gpuTotal = 0;
    gpuCount = 0;
  }

  function promotionScale(nextTier) {
    const current = QUALITY3D_PRESETS[tier];
    const next = QUALITY3D_PRESETS[nextTier];
    const currentCap = Math.min(maxPixelRatio, current.maxPixelRatio);
    const nextCap = Math.min(maxPixelRatio, next.maxPixelRatio);
    // Bound the initial increase in GPU work when the new tier enables more effects.
    const ratio = Math.min(currentCap / nextCap, Math.sqrt(current.maxPixels / next.maxPixels));
    return inRange(dynamicScale * ratio, minScale, maxScale);
  }

  function promoteTier(nextTier, scale) {
    dynamicScale = scale;
    tier = nextTier;
    healthyAtMaxScaleMs = 0;
    tierProbeRemainingMs = TIER_PROBE_MS;
    cooldown = TIER_COOLDOWN_MS;
  }

  function lowerTier() {
    const index = TIERS.indexOf(tier);
    if (index === 0) return false;
    tier = TIERS[index - 1];
    cooldown = TIER_COOLDOWN_MS;
    if (tierProbeRemainingMs > 0) {
      tierRecoveryDelayMs = Math.min(tierRecoveryDelayMs * 2, TIER_MAX_RETRY_MS);
      tierProbeRemainingMs = 0;
    }
    return true;
  }

  function memoryAllowsGrowth(nextScale, nextTier = tier) {
    if (memoryBudgetBytes === null) return true;
    if (!memory || memoryScale !== dynamicScale || memoryTier !== tier || memory.overBudget) return false;
    // Keep headroom for fixed-size attachments and allocations deferred to the next draw.
    const observed = measuredTiers.get(nextTier);
    const targetBytes = observed ? observed.fixed + observed.bytes * (nextScale / observed.scale) ** 2 : memory.targetBytes;
    return memory.residentBytes + targetBytes <= memoryBudgetBytes * 0.9;
  }

  function resetMemoryMeasurements() {
    memory = null;
    memoryScale = null;
    memoryTier = null;
    measuredTiers?.clear();
  }

  function sampleMemory(scalableTargetBytes, residentBytes = 0, fixedTargetBytes = 0) {
    if (memoryBudgetBytes === null || ![scalableTargetBytes, fixedTargetBytes, residentBytes].every(bytes => Number.isFinite(bytes) && bytes >= 0)) return false;
    const targetBytes = scalableTargetBytes + fixedTargetBytes;
    const overBudget = targetBytes + residentBytes > memoryBudgetBytes;
    memory = Object.freeze({ limitBytes: memoryBudgetBytes, targetBytes, fixedTargetBytes, residentBytes, overBudget });
    memoryTier = tier;
    memoryScale = dynamicScale;
    measuredTiers.set(tier, { bytes: scalableTargetBytes, fixed: fixedTargetBytes, scale: dynamicScale });
    if (!overBudget || configuredMode !== 'auto' || targetBytes === 0) return false;

    const remaining = memoryBudgetBytes - residentBytes - fixedTargetBytes;
    let reason;
    if (dynamicScale > minScale && remaining > 0 && scalableTargetBytes > 0) {
      const ratio = Math.sqrt(remaining / scalableTargetBytes);
      dynamicScale = inRange(Math.floor(dynamicScale * ratio * 100) / 100, minScale, maxScale);
      reason = 'memory-resolution';
    } else if (lowerTier()) {
      reason = 'memory-tier';
    } else {
      return false;
    }
    healthyAtMaxScaleMs = 0;
    slowAtFloor = 0;
    clearWindow();
    settle = Math.max(settle, settleAfterChangeMs);
    return notify(reason);
  }

  function sampleFrame(ms, gpuMs = null) {
    if (!Number.isFinite(ms) || ms <= 0) return false;
    // A hidden tab, debugger pause or page suspension must not trigger
    // a false quality collapse. The main app resets its frame clock on resume.
    if (ms >= 250) {
      droppedLongFrames++;
      clearWindow();
      lastMeanGpuMs = null;
      slowAtFloor = 0;
      healthyAtMaxScaleMs = 0;
      return false;
    }
    if (configuredMode !== 'auto') return false;
    settle = Math.max(0, settle - ms);
    cooldown = Math.max(0, cooldown - ms);
    if (tierProbeRemainingMs > 0) {
      tierProbeRemainingMs = Math.max(0, tierProbeRemainingMs - ms);
      if (tierProbeRemainingMs === 0) tierRecoveryDelayMs = TIER_RECOVERY_MS;
    }
    if (settle > 0) return false;
    total += ms;
    count++;
    if (gpuMs !== null && Number.isFinite(gpuMs) && gpuMs > 0) {
      gpuTotal += gpuMs;
      gpuCount++;
    }
    if (count < sampleFrames) return false;
    const windowMs = total;
    const mean = windowMs / count;
    lastMeanGpuMs = gpuCount >= Math.ceil(count / 4) ? gpuTotal / gpuCount : null;
    clearWindow();
    lastMeanMs = mean;
    let changed = false;
    let reason = 'resolution';
    const gpuHasHeadroom = lastMeanGpuMs !== null && lastMeanGpuMs < recoverFrameMs;
    if (mean > degradeFrameMs && !gpuHasHeadroom) {
      healthyAtMaxScaleMs = 0;
      if (dynamicScale > minScale + 0.00001) {
        dynamicScale = inRange(
          Math.round((dynamicScale - (mean > 34 ? .2 : .1)) * 100) / 100,
          minScale, maxScale,
        );
        slowAtFloor = 0;
        changed = true;
      } else {
        slowAtFloor++;
        if (slowAtFloor >= 2 && mean > degradeFrameMs + 3) {
          if (lowerTier()) {
            // Keep the current scale until fast frames earn resolution recovery.
            reason = 'tier';
            changed = true;
          }
          slowAtFloor = 0;
        }
      }
    } else if (mean < recoverFrameMs && (gpuHasHeadroom || lastMeanGpuMs === null) && cooldown <= 0) {
      slowAtFloor = 0;
      const gpuCanPromote = lastMeanGpuMs === null || lastMeanGpuMs < recoverFrameMs * 0.8;
      if (dynamicScale < maxScale) {
        const nextScale = inRange(Math.round((dynamicScale + .1) * 100) / 100, minScale, maxScale);
        if (memoryAllowsGrowth(nextScale)) {
          dynamicScale = nextScale;
          healthyAtMaxScaleMs = 0;
          changed = true;
          cooldown = 900;
        }
      } else if (tier !== autoCeiling && gpuCanPromote) {
        healthyAtMaxScaleMs = Math.min(tierRecoveryDelayMs, healthyAtMaxScaleMs + windowMs);
        if (healthyAtMaxScaleMs >= tierRecoveryDelayMs) {
          const nextTier = TIERS[TIERS.indexOf(tier) + 1];
          const nextScale = promotionScale(nextTier);
          if (memoryAllowsGrowth(nextScale, nextTier)) {
            promoteTier(nextTier, nextScale);
            reason = 'tier';
            changed = true;
          }
        }
      } else {
        healthyAtMaxScaleMs = 0;
      }
    } else {
      slowAtFloor = 0;
      healthyAtMaxScaleMs = 0;
    }
    if (changed) {
      settle = Math.max(settle, settleAfterChangeMs);
      return notify(reason);
    }
    return false;
  }
  function resetMeasurements() {
    clearWindow();
    lastMeanGpuMs = null;
    settle = settleMs;
    cooldown = 0;
    slowAtFloor = 0;
    healthyAtMaxScaleMs = 0;
  }
  return Object.freeze({
    get state() { return snapshot(); },
    setMode, sampleFrame, sampleMemory, planViewport, resetMeasurements, resetMemoryMeasurements,
  });
}

/** Portrait Bilibili Toy mobile-first 60fps balance preset capping fill-rate & shadow bandwidth. */
export const MOBILE_PORTRAIT_PRESET = Object.freeze({
  tier: 'medium',
  maxPixelRatio: 2,
  maxPixels: 390 * 844 * 2.25,
  targetFps: 60,
  shadowMapSize: 512,
  pcss: false,
  msaaSamples: 4,
  bloom: true,
  rcasSharpness: 0.45,
  colorLut: 'vibrant',
  heightFog: Object.freeze({ density: 0.012, baseHeight: 0, falloff: 0.22 }),
});

/**
 * Resolve fill-rate-capped backing-store dimensions and safe-area-aware thumb UI bounds for
 * mobile portrait H5 viewports (e.g. 390x844 @ DPR 2 or 3).
 *
 * @param {object} [options]
 * @param {number} [options.width=390]
 * @param {number} [options.height=844]
 * @param {number} [options.dpr=2]
 * @param {number} [options.maxDpr=2]
 * @param {{ top?: number, right?: number, bottom?: number, left?: number }} [options.safeArea]
 */
export function resolvePortraitViewport({
  width = 390,
  height = 844,
  dpr = 2,
  maxDpr = MOBILE_PORTRAIT_PRESET.maxPixelRatio,
  safeArea = {},
} = {}) {
  const cssW = Math.max(180, Math.floor(Number(width) || 390));
  const cssH = Math.max(240, Math.floor(Number(height) || 844));
  const effDpr = Math.max(1, Math.min(Number(maxDpr) || 2, Number(dpr) || 1));
  const plan = fitDrawingBuffer(cssW, cssH, effDpr, {
    maxPixels: MOBILE_PORTRAIT_PRESET.maxPixels,
    minWidth: 1,
    minHeight: 1,
  });
  return Object.freeze({
    cssWidth: cssW,
    cssHeight: cssH,
    pixelRatio: plan.pixelRatio,
    bufferWidth: plan.bufferWidth,
    bufferHeight: plan.bufferHeight,
    orientation: cssH >= cssW ? 'portrait' : 'landscape',
    safeArea: Object.freeze({
      top: Math.max(0, Number(safeArea.top) || 0),
      right: Math.max(0, Number(safeArea.right) || 0),
      bottom: Math.max(0, Number(safeArea.bottom) || 0),
      left: Math.max(0, Number(safeArea.left) || 0),
    }),
  });
}

/**
 * Zero-GC Dynamic Resolution Scaling (DRS) loop controller tuned for mobile portrait
 * Bilibili Toy viewports, smoothing backing-store scale down during heavy particles/battles
 * and stepping smoothly back up once frame times recover.
 */
export function createPortraitDrsController({
  width = 390,
  height = 844,
  dpr = 2,
  maxDpr = MOBILE_PORTRAIT_PRESET.maxPixelRatio,
  minScale = 0.72,
  maxScale = 1.0,
  targetFrameMs = 16.67,
  degradeThresholdMs = 20.0,
  recoverThresholdMs = 13.5,
  stepDown = 0.08,
  stepUp = 0.04,
  windowFrames = 16,
} = {}) {
  const winLen = Math.max(2, Math.floor(Number(windowFrames) || 16));
  const ring = new Float32Array(winLen);
  const lo = Math.max(0.5, Math.min(1, Number(minScale) || 0.72));
  const hi = Math.max(lo, Math.min(1, Number(maxScale) || 1.0));
  const baseVp = resolvePortraitViewport({ width, height, dpr, maxDpr });

  let cursor = 0;
  let count = 0;
  let sumMs = 0;
  let renderScale = hi;
  let avgFrameMs = targetFrameMs;
  let bufferWidth = baseVp.bufferWidth;
  let bufferHeight = baseVp.bufferHeight;
  let pixelRatio = baseVp.pixelRatio;

  function recomputeDimensions() {
    const plan = fitDrawingBuffer(baseVp.cssWidth, baseVp.cssHeight, baseVp.pixelRatio * renderScale, {
      maxPixels: MOBILE_PORTRAIT_PRESET.maxPixels,
      minWidth: 1,
      minHeight: 1,
    });
    pixelRatio = plan.pixelRatio;
    bufferWidth = plan.bufferWidth;
    bufferHeight = plan.bufferHeight;
  }

  function sample(frameMs, out = null) {
    const ms = Number.isFinite(frameMs) && frameMs > 0 ? frameMs : targetFrameMs;
    if (count < winLen) {
      ring[cursor] = ms;
      sumMs += ms;
      count++;
    } else {
      sumMs -= ring[cursor];
      ring[cursor] = ms;
      sumMs += ms;
    }
    cursor = (cursor + 1) % winLen;

    let changed = false;
    if (cursor === 0 && count === winLen) {
      avgFrameMs = sumMs / winLen;
      const prevScale = renderScale;
      if (avgFrameMs > degradeThresholdMs && renderScale > lo) {
        renderScale = Math.max(lo, Number((renderScale - stepDown).toFixed(4)));
      } else if (avgFrameMs < recoverThresholdMs && renderScale < hi) {
        renderScale = Math.min(hi, Number((renderScale + stepUp).toFixed(4)));
      }
      if (renderScale !== prevScale) {
        recomputeDimensions();
        changed = true;
      }
    }

    const res = out && typeof out === 'object' ? out : {};
    res.scale = renderScale;
    res.pixelRatio = pixelRatio;
    res.bufferWidth = bufferWidth;
    res.bufferHeight = bufferHeight;
    res.avgFrameMs = avgFrameMs;
    res.changed = changed;
    return res;
  }

  function getState() {
    return Object.freeze({
      scale: renderScale,
      pixelRatio,
      bufferWidth,
      bufferHeight,
      avgFrameMs,
      minScale: lo,
      maxScale: hi,
    });
  }

  return Object.freeze({
    sample,
    getState,
  });
}

export { createShaderWarmupQueue3D } from './quality3d/shader-warmup.js';
