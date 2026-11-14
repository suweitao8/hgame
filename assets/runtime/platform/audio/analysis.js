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
export function analyzeAudioBuffer(buffer, {
  silenceThreshold = 0.0035,
  minActiveDuration = 0.01,
} = {}) {
  if (!buffer || typeof buffer.getChannelData !== 'function' || !(buffer.sampleRate > 0) || !(buffer.length > 0)) {
    const rawDuration = Number(buffer?.duration) || 0;
    return {
      analyzable: false,
      duration: rawDuration,
      trimStart: 0,
      trimEnd: rawDuration,
      activeDuration: rawDuration,
      rms: 0,
      peak: 0,
    };
  }

  const length = buffer.length;
  const sampleRate = buffer.sampleRate;
  const duration = length / sampleRate;
  const channels = Math.max(1, Number(buffer.numberOfChannels) || 1);
  /** @type {Float32Array[]} */
  const channelData = new Array(channels);
  for (let c = 0; c < channels; c++) {
    channelData[c] = buffer.getChannelData(c);
  }

  let firstNonSilent = -1;
  let lastNonSilent = -1;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      if (Math.abs(channelData[c][i]) >= silenceThreshold) {
        firstNonSilent = i;
        break;
      }
    }
    if (firstNonSilent !== -1) break;
  }

  if (firstNonSilent === -1) {
    return {
      analyzable: true,
      duration,
      trimStart: 0,
      trimEnd: duration,
      activeDuration: Math.max(minActiveDuration, duration),
      rms: 0,
      peak: 0,
    };
  }

  for (let i = length - 1; i >= firstNonSilent; i--) {
    for (let c = 0; c < channels; c++) {
      if (Math.abs(channelData[c][i]) >= silenceThreshold) {
        lastNonSilent = i;
        break;
      }
    }
    if (lastNonSilent !== -1) break;
  }

  const preGuard = Math.round(sampleRate * 0.0015);
  const postGuard = Math.round(sampleRate * 0.003);
  const startIdx = Math.max(0, firstNonSilent - preGuard);
  const endIdx = Math.min(length - 1, Math.max(firstNonSilent, lastNonSilent + postGuard));

  let sumSq = 0;
  let peak = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = channelData[c][i];
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSq += sample * sample;
    }
  }
  const sampleCount = (endIdx - startIdx + 1) * channels;
  const rms = sampleCount > 0 ? Math.sqrt(sumSq / sampleCount) : 0;
  const trimStart = startIdx / sampleRate;
  const trimEnd = (endIdx + 1) / sampleRate;
  const activeDuration = Math.max(minActiveDuration, trimEnd - trimStart);

  return {
    analyzable: true,
    duration,
    trimStart,
    trimEnd,
    activeDuration,
    rms,
    peak,
  };
}
