/**
 * @typedef {Pick<AudioBuffer, 'getChannelData' | 'sampleRate' | 'length' | 'numberOfChannels' | 'duration'>} AudioBufferLike
 *   Decoded PCM buffer.
 */
/**
 * @typedef {object} AnalyzeAudioBufferOptions
 * @property {number} [silenceThreshold=0.0035] Absolute sample amplitude treated as silence (0..1).
 * @property {number} [minActiveDuration=0.01] Minimum reported active duration, seconds.
 */
/**
 * @typedef {object} AudioBufferAnalysis
 * @property {boolean} analyzable False when no PCM data was available (values fall back to `duration`).
 * @property {number} duration Full buffer duration, seconds.
 * @property {number} trimStart First audible time, seconds.
 * @property {number} trimEnd End of audible content, seconds.
 * @property {number} activeDuration `trimEnd - trimStart` (>= `minActiveDuration`), seconds.
 * @property {number} rms Root-mean-square amplitude of the active part (0..1).
 * @property {number} peak Peak absolute amplitude (0..1).
 */
/**
 * Inspects decoded PCM AudioBuffer data to strip encoder padding / trailing silence
 * and compute active duration, RMS loudness, and peak amplitude.
 *
 * @param {AudioBufferLike | null | undefined} buffer
 * @param {AnalyzeAudioBufferOptions} [options]
 * @returns {AudioBufferAnalysis}
 */
export function analyzeAudioBuffer(buffer: AudioBufferLike | null | undefined, { silenceThreshold, minActiveDuration, }?: AnalyzeAudioBufferOptions): AudioBufferAnalysis;
/**
 * Decoded PCM buffer.
 */
export type AudioBufferLike = Pick<AudioBuffer, "getChannelData" | "sampleRate" | "length" | "numberOfChannels" | "duration">;
export type AnalyzeAudioBufferOptions = {
    /**
     * Absolute sample amplitude treated as silence (0..1).
     */
    silenceThreshold?: number;
    /**
     * Minimum reported active duration, seconds.
     */
    minActiveDuration?: number;
};
export type AudioBufferAnalysis = {
    /**
     * False when no PCM data was available (values fall back to `duration`).
     */
    analyzable: boolean;
    /**
     * Full buffer duration, seconds.
     */
    duration: number;
    /**
     * First audible time, seconds.
     */
    trimStart: number;
    /**
     * End of audible content, seconds.
     */
    trimEnd: number;
    /**
     * `trimEnd - trimStart` (>= `minActiveDuration`), seconds.
     */
    activeDuration: number;
    /**
     * Root-mean-square amplitude of the active part (0..1).
     */
    rms: number;
    /**
     * Peak absolute amplitude (0..1).
     */
    peak: number;
};
