/**
 * Optional 3D render-quality controller.
 *
 * Uses explicit quality budgets, conservative device selection, hysteresis
 * and resolution-only scaling before an expensive quality-tier drop.
 *
 * No Three.js, DOM, GPU probe, scheduler, localStorage or network dependency.
 * Game rules and fixed ticks MUST NOT depend on render quality.
 */
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
 * @property {number} transitionCount
 * @property {number} droppedLongFrames
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
 * @property {((state: QualitySnapshot, reason: string) => void)|null} [onChange=null]
 */
/**
 * @typedef {object} AdaptiveQualityController
 * @property {QualitySnapshot} state Current snapshot (getter).
 * @property {(next: QualityMode) => boolean} setMode
 * @property {(ms: number) => boolean} sampleFrame
 * @property {(cssWidth: number, cssHeight: number, dpr?: number) => ViewportPlan} planViewport
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
/** @type {(x: number, lo: number, hi: number) => number} */
const inRange = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * @param {QualityPresetTier} [tier='high']
 * @param {'2d'|'3d'} [dimension='3d']
 * @returns {Readonly<Quality3DPreset>|Readonly<Quality2DPreset>}
 */
export function resolveQualityPreset(tier = 'high', dimension = '3d') {
  const table = dimension === '2d' ? QUALITY2D_PRESETS : QUALITY3D_PRESETS;
  if (!Object.hasOwn(table, tier)) {
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
  if (onChange !== null && typeof onChange !== 'function') throw new TypeError('onChange must be a function');

  let configuredMode = mode;
  let tier = mode === 'auto' ? chooseInitial3dQuality(device) : mode;
  let dynamicScale = mode === 'auto' ? maxScale : 1;
  let slowAtFloor = 0;
  let transitionCount = 0;
  let droppedLongFrames = 0;
  let settle = settleMs;
  let cooldown = 0;
  let total = 0;
  let count = 0;
  let lastMeanMs = 0;

  function snapshot() {
    return Object.freeze({
      mode: configuredMode,
      tier, preset: QUALITY3D_PRESETS[tier],
      dynamicScale, lastMeanMs, transitionCount, droppedLongFrames,
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
    tier = next === 'auto' ? chooseInitial3dQuality(device) : next;
    dynamicScale = next === 'auto' ? maxScale : 1;
    slowAtFloor = 0;
    total = 0;
    count = 0;
    settle = settleMs;
    cooldown = 0;
    return notify('mode');
  }
  function planViewport(cssWidth, cssHeight, dpr = 1) {
    if (!Number.isFinite(cssWidth) || cssWidth <= 0) throw new RangeError('Invalid canvas width');
    if (!Number.isFinite(cssHeight) || cssHeight <= 0) throw new RangeError('Invalid canvas height');
    if (!Number.isFinite(dpr) || dpr <= 0) throw new RangeError('Invalid device pixel ratio');
    const width = Math.max(1, Math.floor(cssWidth));
    const height = Math.max(1, Math.floor(cssHeight));
    const preset = QUALITY3D_PRESETS[tier];
    const budget = preset.maxPixels;
    const budgetScale = Math.sqrt(budget / (width * height));
    const effectiveMaxPr = Math.min(maxPixelRatio, preset.maxPixelRatio ?? maxPixelRatio);
    // Scale the capped buffer so every resolution step can save work at high DPI.
    const cappedPixelRatio = Math.min(inRange(dpr, minPixelRatio, effectiveMaxPr), budgetScale);
    const pixelRatio = Math.max(cappedPixelRatio * dynamicScale, 1 / Math.min(width, height));
    const bufferWidth = Math.floor(width * pixelRatio);
    const bufferHeight = Math.floor(height * pixelRatio);
    return Object.freeze({
      cssWidth: width, cssHeight: height,
      pixelRatio, bufferWidth, bufferHeight,
      tier, dynamicScale, maxPixels: budget,
    });
  }
  function sampleFrame(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return false;
    // A hidden tab, debugger pause or page suspension must not trigger
    // a false quality collapse. The main app resets its frame clock on resume.
    if (ms >= 250) {
      droppedLongFrames++;
      total = 0;
      count = 0;
      return false;
    }
    if (configuredMode !== 'auto') return false;
    settle = Math.max(0, settle - ms);
    cooldown = Math.max(0, cooldown - ms);
    if (settle > 0) return false;
    total += ms;
    count++;
    if (count < sampleFrames) return false;
    const mean = total / count;
    count = 0;
    total = 0;
    lastMeanMs = mean;
    let changed = false;
    let reason = 'resolution';
    if (mean > degradeFrameMs) {
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
          const index = TIERS.indexOf(tier);
          if (index > 0) {
            tier = TIERS[index - 1];
            // Keep the current scale until fast frames earn resolution recovery.
            reason = 'tier';
            settle = settleAfterChangeMs;
            cooldown = 2400;
            changed = true;
          }
          slowAtFloor = 0;
        }
      }
    } else if (mean < recoverFrameMs && dynamicScale < maxScale && cooldown <= 0) {
      dynamicScale = inRange(Math.round((dynamicScale + .1) * 100) / 100, minScale, maxScale);
      changed = true;
      cooldown = 900;
      slowAtFloor = 0;
    } else if (mean <= degradeFrameMs) {
      slowAtFloor = 0;
    }
    if (changed) {
      settle = Math.max(settle, settleAfterChangeMs);
      return notify(reason);
    }
    return false;
  }
  function resetMeasurements() {
    total = 0;
    count = 0;
    settle = settleMs;
    cooldown = 0;
    slowAtFloor = 0;
  }
  return Object.freeze({
    get state() { return snapshot(); },
    setMode, sampleFrame, planViewport, resetMeasurements,
  });
}
