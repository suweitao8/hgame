/**
 * Optional 3D render-quality controller.
 *
 * Uses explicit quality budgets, conservative device selection, hysteresis
 * and resolution-only scaling before an expensive quality-tier drop.
 *
 * No Three.js, DOM, GPU probe, scheduler, localStorage or network dependency.
 * Game rules and fixed ticks MUST NOT depend on render quality.
 */
export const QUALITY3D_PRESETS = Object.freeze({
  low: Object.freeze({
    maxPixels: 1_000_000, shadowMapSize: 1024, msaaSamples: 0,
    ssao: false, bloom: false, volumetricSteps: 0, anisotropy: 2,
  }),
  medium: Object.freeze({
    maxPixels: 1_500_000, shadowMapSize: 1536, msaaSamples: 0,
    ssao: true, bloom: false, volumetricSteps: 8, anisotropy: 4,
  }),
  high: Object.freeze({
    maxPixels: 2_300_000, shadowMapSize: 2048, msaaSamples: 2,
    ssao: true, bloom: true, volumetricSteps: 16, anisotropy: 8,
  }),
  ultra: Object.freeze({
    maxPixels: 3_700_000, shadowMapSize: 4096, msaaSamples: 4,
    ssao: true, bloom: true, volumetricSteps: 28, anisotropy: 16,
  }),
});

const TIERS = Object.freeze(Object.keys(QUALITY3D_PRESETS));
const VALID_MODES = Object.freeze(['auto', ...TIERS]);
const inRange = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Pure, conservative hint selection. Do not allocate a new probing WebGL context. */
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
  let dynamicScale = 1;
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
    dynamicScale = 1;
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
    const budget = QUALITY3D_PRESETS[tier].maxPixels;
    const budgetScale = Math.sqrt(budget / (width * height));
    const idealScale = inRange(dpr, minPixelRatio, maxPixelRatio) * dynamicScale;
    // Never render more physical pixels than the selected tier's pixel budget.
    // Extreme viewports may need less than minPixelRatio to respect hard cap.
    const pixelRatio = Math.min(idealScale, budgetScale);
    const bufferWidth = Math.max(1, Math.floor(width * pixelRatio));
    const bufferHeight = Math.max(1, Math.floor(height * pixelRatio));
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
            dynamicScale = Math.max(minScale, .8);
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
