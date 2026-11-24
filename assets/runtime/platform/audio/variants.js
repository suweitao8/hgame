import { clamp, median } from './helpers.js';
import { analyzeAudioBuffer } from './analysis.js';

/**
 * @typedef {object} VariantSetOptions
 * @property {number} [silenceThreshold=0.0035] Silence amplitude (0..1).
 * @property {boolean} [normalizeRms=true] Balance loudness across variants.
 * @property {number} [maxDurationSpreadRatio=0.28] Allowed active-duration deviation from the median (ratio).
 * @property {boolean} [alignDuration=true] Clamp over-long tails to the allowed duration.
 * @property {readonly [number, number]} [gainClamp=[0.55, 1.65]] Min / max loudness gain scale.
 */

/**
 * @typedef {import('./analysis.js').AudioBufferAnalysis & {
 *   index: number,
 *   buffer: AudioBuffer,
 *   gainScale: number,
 *   deviationRatio: number,
 *   consistent: boolean,
 *   playDuration: number,
 *   tailFadeSec: number,
 * }} AudioVariant One analysed variant (`playDuration` / `tailFadeSec` in seconds).
 */

/**
 * @typedef {object} NormalizedVariantSet
 * @property {AudioVariant[]} variants
 * @property {number} medianDuration Seconds.
 * @property {number} medianRms
 * @property {number} durationSpreadRatio Largest deviation ratio.
 * @property {boolean} allConsistent
 */

/**
 * Normalizes a pool of 1-4 SFX variant buffers so loudness stays balanced
 * and overly long outlier tails are flagged and optionally trimmed to stay tight.
 *
 * @param {readonly AudioBuffer[]} buffers
 * @param {VariantSetOptions} [options]
 * @returns {NormalizedVariantSet}
 */
export function normalizeVariantSet(buffers, {
  silenceThreshold = 0.0035,
  normalizeRms = true,
  maxDurationSpreadRatio = 0.28,
  alignDuration = true,
  gainClamp = [0.55, 1.65],
} = {}) {
  if (!Array.isArray(buffers) || buffers.length === 0) {
    throw new TypeError('normalizeVariantSet requires a non-empty array of audio buffers');
  }

  const minGain = Array.isArray(gainClamp) ? Number(gainClamp[0]) || 0.55 : 0.55;
  const maxGain = Array.isArray(gainClamp) ? Number(gainClamp[1]) || 1.65 : 1.65;
  const analyses = buffers.map(buffer => analyzeAudioBuffer(buffer, { silenceThreshold }));
  /** @type {number[]} */
  const activeDurations = [];
  /** @type {number[]} */
  const activeRms = [];

  for (const info of analyses) {
    if (info.analyzable) {
      activeDurations.push(info.activeDuration);
      if (info.rms > 1e-5) activeRms.push(info.rms);
    }
  }

  const medianDuration = median(activeDurations);
  const medianRms = median(activeRms);
  const maxAllowedDuration = medianDuration > 0 ? medianDuration * (1 + maxDurationSpreadRatio) : 0;

  let durationSpreadRatio = 0;
  const variants = buffers.map((buffer, index) => {
    const info = analyses[index];
    const gainScale = (normalizeRms && info.analyzable && medianRms > 1e-5 && info.rms > 1e-5)
      ? clamp(medianRms / info.rms, minGain, maxGain)
      : 1;
    const deviationRatio = medianDuration > 0
      ? Math.abs(info.activeDuration - medianDuration) / Math.max(0.02, medianDuration)
      : 0;
    if (deviationRatio > durationSpreadRatio) durationSpreadRatio = deviationRatio;
    const consistent = deviationRatio <= maxDurationSpreadRatio;
    const clampedTail = alignDuration && info.analyzable && maxAllowedDuration > 0 && info.activeDuration > maxAllowedDuration;
    const playDuration = clampedTail
      ? maxAllowedDuration
      : (info.analyzable ? info.activeDuration : 0);
    const tailFadeSec = clampedTail ? Math.min(0.04, playDuration * 0.2) : 0;

    return {
      index,
      buffer,
      ...info,
      gainScale,
      deviationRatio,
      consistent,
      playDuration,
      tailFadeSec,
    };
  });

  return {
    variants,
    medianDuration,
    medianRms,
    durationSpreadRatio,
    allConsistent: variants.every(v => v.consistent),
  };
}

/** Build cue metadata for authored streams without downloading or analyzing samples. */
export function normalizeStreamVariantSet(streams, { maxDurationSpreadRatio = 0.28 } = {}) {
  const durations = streams.map(stream => {
    if (typeof stream?.url !== 'string' || !stream.url.trim()) {
      throw new TypeError('A streamed cue requires a URL for every variant');
    }
    if (stream.durationSec !== undefined && (!Number.isFinite(stream.durationSec) || stream.durationSec <= 0)) {
      throw new TypeError('A streamed cue duration must be a positive number of seconds');
    }
    return stream.durationSec ?? 0;
  });
  const medianDuration = median(durations.filter(duration => duration > 0));
  let durationSpreadRatio = 0;
  const variants = streams.map((stream, index) => {
    const duration = durations[index];
    const deviationRatio = duration > 0 && medianDuration > 0
      ? Math.abs(duration - medianDuration) / medianDuration : 0;
    durationSpreadRatio = Math.max(durationSpreadRatio, deviationRatio);
    return {
      index, url: stream.url.trim(), buffer: null, duration, activeDuration: duration,
      playDuration: duration, analyzable: false, gainScale: 1, tailFadeSec: 0,
      deviationRatio, consistent: deviationRatio <= maxDurationSpreadRatio,
    };
  });
  return { variants, medianDuration, medianRms: 0, durationSpreadRatio, allConsistent: variants.every(variant => variant.consistent) };
}
