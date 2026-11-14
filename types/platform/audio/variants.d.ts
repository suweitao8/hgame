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
export function normalizeVariantSet(buffers: readonly AudioBuffer[], { silenceThreshold, normalizeRms, maxDurationSpreadRatio, alignDuration, gainClamp, }?: VariantSetOptions): NormalizedVariantSet;
export type VariantSetOptions = {
    /**
     * Silence amplitude (0..1).
     */
    silenceThreshold?: number;
    /**
     * Balance loudness across variants.
     */
    normalizeRms?: boolean;
    /**
     * Allowed active-duration deviation from the median (ratio).
     */
    maxDurationSpreadRatio?: number;
    /**
     * Clamp over-long tails to the allowed duration.
     */
    alignDuration?: boolean;
    /**
     * Min / max loudness gain scale.
     */
    gainClamp?: readonly [number, number];
};
/**
 * One analysed variant (`playDuration` / `tailFadeSec` in seconds).
 */
export type AudioVariant = import("./analysis.js").AudioBufferAnalysis & {
    index: number;
    buffer: AudioBuffer;
    gainScale: number;
    deviationRatio: number;
    consistent: boolean;
    playDuration: number;
    tailFadeSec: number;
};
export type NormalizedVariantSet = {
    variants: AudioVariant[];
    /**
     * Seconds.
     */
    medianDuration: number;
    medianRms: number;
    /**
     * Largest deviation ratio.
     */
    durationSpreadRatio: number;
    allConsistent: boolean;
};
