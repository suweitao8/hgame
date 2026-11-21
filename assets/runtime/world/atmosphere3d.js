/**
 * Unified 3D atmosphere facade coordinating sky3d, post3d quality profiles,
 * post-process grading, global shader wetness, foliage/decal quality flags,
 * weather VFX, and indoor/outdoor spatial audio transitions.
 */
import { resolveQuality3DProfile } from '../integrations/quality3d.js';

export const ATMOSPHERE_PRESETS_CN = Object.freeze({
  cn_cbd_day: Object.freeze({
    id: 'cn_cbd_day',
    skyPreset: 'day',
    sunColor: 0xfff8ee,
    sunIntensity: 1.25,
    sunDirection: Object.freeze([0.46, 0.72, 0.52]),
    exposure: 1.05,
    bloomStrength: 0.22,
    contrast: 1.06,
    saturation: 1.04,
    vignette: 0.14,
  }),
  cn_old_town_dusk: Object.freeze({
    id: 'cn_old_town_dusk',
    skyPreset: 'goldenHour',
    sunColor: 0xffaa66,
    sunIntensity: 1.1,
    sunDirection: Object.freeze([0.65, 0.22, 0.72]),
    exposure: 1.02,
    bloomStrength: 0.34,
    contrast: 1.08,
    saturation: 1.12,
    vignette: 0.22,
    colorGain: Object.freeze([1.06, 0.98, 0.9]),
  }),
  cn_horror_night: Object.freeze({
    id: 'cn_horror_night',
    skyPreset: 'night',
    sunColor: 0x7a99c2,
    sunIntensity: 0.38,
    sunDirection: Object.freeze([-0.38, 0.58, -0.72]),
    exposure: 0.92,
    bloomStrength: 0.52,
    contrast: 1.12,
    saturation: 0.92,
    vignette: 0.34,
    colorLift: Object.freeze([-0.02, 0.0, 0.02]),
  }),
  cn_rural_morning: Object.freeze({
    id: 'cn_rural_morning',
    skyPreset: 'day',
    sunColor: 0xffebd2,
    sunIntensity: 0.95,
    sunDirection: Object.freeze([0.55, 0.32, 0.77]),
    exposure: 1.0,
    bloomStrength: 0.28,
    contrast: 1.0,
    saturation: 1.05,
    vignette: 0.16,
  }),
});

/**
 * Creates a high-level 3D atmosphere controller wrapping sky, post3d, material
 * shared wetness block, foliage/decal quality toggles, and audio indoor state.
 * @param {Record<string, any>} [options]
 */
export function createAtmosphere3D({
  sky = null,
  postPipeline = null,
  sharedBlock = null,
  directionalLight = null,
  foliage = null,
  decals = null,
  audio = null,
  rainToggle = null,
} = {}) {
  let currentPreset = ATMOSPHERE_PRESETS_CN.cn_cbd_day;
  let currentQuality = resolveQuality3DProfile('mobile_high');
  let currentWetness = 0;
  let targetWetness = 0;
  let wetnessStart = 0;
  let wetnessDuration = 0;
  let wetnessElapsed = 0;
  let playerIndoor = false;

  function applyWetness(w) {
    const clamped = Math.max(0, Math.min(1, Number(w) || 0));
    currentWetness = clamped;
    if (sharedBlock?.set) {
      sharedBlock.set('uWetness', clamped);
    } else if (sharedBlock?.uniforms?.uWetness) {
      sharedBlock.uniforms.uWetness.value = clamped;
    }
    return clamped;
  }

  function setPreset(presetIdOrConfig, {
    quality = null,
    wetness = null,
    transitionSec = 0,
  } = {}) {
    const preset = typeof presetIdOrConfig === 'string'
      ? (ATMOSPHERE_PRESETS_CN[presetIdOrConfig] || ATMOSPHERE_PRESETS_CN.cn_cbd_day)
      : { ...ATMOSPHERE_PRESETS_CN.cn_cbd_day, ...(presetIdOrConfig || {}) };
    currentPreset = preset;

    if (quality !== null && quality !== undefined) {
      currentQuality = resolveQuality3DProfile(quality);
      postPipeline?.setPreset?.(currentQuality);
      foliage?.setBayerDither?.(currentQuality.foliageBayerDither);
      decals?.applyQualityProfile?.(currentQuality);
    }

    if (sky?.setPreset && preset.skyPreset) {
      sky.setPreset(preset.skyPreset);
    }

    if (directionalLight) {
      directionalLight.color?.set?.(preset.sunColor);
      if ('intensity' in directionalLight) directionalLight.intensity = preset.sunIntensity;
      if (directionalLight.position?.set && Array.isArray(preset.sunDirection)) {
        directionalLight.position.set(
          preset.sunDirection[0] * 40,
          preset.sunDirection[1] * 40,
          preset.sunDirection[2] * 40,
        );
      }
    }

    if (postPipeline?.setState) {
      postPipeline.setState({
        exposure: preset.exposure,
        bloomStrength: currentQuality.bloom ? preset.bloomStrength : 0,
        contrast: preset.contrast,
        saturation: preset.saturation,
        vignette: preset.vignette,
        ...(preset.colorLift ? { colorLift: preset.colorLift } : {}),
        ...(preset.colorGain ? { colorGain: preset.colorGain } : {}),
      });
    }

    if (wetness !== null && wetness !== undefined) {
      const nextW = Math.max(0, Math.min(1, Number(wetness) || 0));
      const tSec = Math.max(0, Number(transitionSec) || 0);
      if (tSec <= 0.001) {
        targetWetness = nextW;
        wetnessDuration = 0;
        applyWetness(nextW);
      } else {
        wetnessStart = currentWetness;
        targetWetness = nextW;
        wetnessDuration = tSec;
        wetnessElapsed = 0;
      }
    }

    return {
      preset: currentPreset.id,
      quality: currentQuality.profile,
      wetness: currentWetness,
    };
  }

  function setPlayerIndoor(indoor, { transitionSec = 0.4 } = {}) {
    playerIndoor = Boolean(indoor);
    audio?.setIndoor?.(playerIndoor, { transitionSeconds: transitionSec });
    if (typeof rainToggle === 'function') {
      rainToggle(!playerIndoor);
    }
    return playerIndoor;
  }

  function update(dt = 0) {
    if (wetnessDuration > 0) {
      wetnessElapsed += Math.max(0, Number(dt) || 0);
      const u = Math.min(1, wetnessElapsed / wetnessDuration);
      applyWetness(wetnessStart + (targetWetness - wetnessStart) * u);
      if (u >= 1) wetnessDuration = 0;
    }
    return {
      preset: currentPreset.id,
      quality: currentQuality.profile,
      wetness: currentWetness,
      indoor: playerIndoor,
    };
  }

  return Object.freeze({
    get preset() { return currentPreset; },
    get quality() { return currentQuality; },
    get wetness() { return currentWetness; },
    get isIndoor() { return playerIndoor; },
    setPreset,
    setWetness: applyWetness,
    setPlayerIndoor,
    update,
  });
}
