import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeAudioBuffer } from '../../assets/runtime/platform/audio.js';

export const SURFACE_TYPES_10 = Object.freeze([
  'asphalt',
  'concrete',
  'tile',
  'wood',
  'metal',
  'glass',
  'dirt',
  'grass',
  'water',
  'fabric',
]);

export const SILENCE_TRIM_FILTER =
  'silenceremove=start_periods=1:start_threshold=-50dB:detection=peak,areverse,silenceremove=start_periods=1:start_threshold=-50dB:detection=peak,areverse';

/** 6-tier semantic loudness specification anchored to -16 LUFS / -1.0 dBTP. */
export const AUDIO_LOUDNESS_TIERS = Object.freeze({
  sfx_combat_heavy: Object.freeze({
    id: 'sfx_combat_heavy',
    bus: 'combat',
    targetDb: -14.0,
    ceilingDb: -1.0,
    mode: 'short_rms_limiter',
    shortMaxSec: 1.5,
  }),
  ui_voice: Object.freeze({
    id: 'ui_voice',
    bus: 'ui_voice',
    targetDb: -16.0,
    ceilingDb: -1.5,
    mode: 'hybrid',
    shortMaxSec: 1.5,
  }),
  sfx_combat_light: Object.freeze({
    id: 'sfx_combat_light',
    bus: 'combat',
    targetDb: -17.0,
    ceilingDb: -2.0,
    mode: 'short_rms_limiter',
    shortMaxSec: 1.5,
  }),
  bgm: Object.freeze({
    id: 'bgm',
    bus: 'bgm',
    targetDb: -19.0,
    ceilingDb: -1.5,
    mode: 'loudnorm',
    shortMaxSec: 0,
  }),
  sfx_foley: Object.freeze({
    id: 'sfx_foley',
    bus: 'foley',
    targetDb: -22.0,
    ceilingDb: -4.0,
    mode: 'hybrid',
    shortMaxSec: 1.5,
  }),
  ambience: Object.freeze({
    id: 'ambience',
    bus: 'ambience',
    targetDb: -26.0,
    ceilingDb: -6.0,
    mode: 'loudnorm',
    shortMaxSec: 0,
  }),
});

/**
 * Maps an Anim58 pack/relDir/filename into one of the 6 semantic loudness tiers
 * following the documented ordered precedence rules.
 */
export function classifyAudioLoudnessTier(input, { duration = 0, overrides = null } = {}) {
  const item = typeof input === 'string'
    ? { pack: '', relDir: '', name: input, relWav: input, duration }
    : (input || {});
  const dur = Number(item.duration ?? duration) || 0;
  const pack = String(item.pack || '');
  const relDir = String(item.relDir || '');
  const name = String(item.name || '');
  const relPath = String(item.relWav || `${pack}/${relDir}/${name}`).replaceAll('\\', '/');
  const lower = relPath.toLowerCase();

  if (typeof overrides === 'function') {
    const custom = overrides(item, relPath);
    if (custom && AUDIO_LOUDNESS_TIERS[custom]) return AUDIO_LOUDNESS_TIERS[custom];
  } else if (overrides && typeof overrides === 'object') {
    const direct = overrides[item.id] || overrides[relPath] || overrides[name];
    if (direct && AUDIO_LOUDNESS_TIERS[direct]) return AUDIO_LOUDNESS_TIERS[direct];
  }

  // 1. Heavy combat: GunSoundPack/Guns/** or Explosion/Grenade/Thunder/Fireworks
  if (
    /gunsoundpack\/guns\b/i.test(lower)
    || /(?:^|[^a-z])(explosion|grenade|thunder|firework)/i.test(lower)
    || pack === 'FireworksWithSounds'
  ) {
    return AUDIO_LOUDNESS_TIERS.sfx_combat_heavy;
  }

  // 2. GunSoundPack/BonusSounds/**
  if (/gunsoundpack\/bonussounds\b/i.test(lower)) {
    if (/(headshot|killingspree|frenzy|rampage|dominating|multikill|announcer)/i.test(lower)) {
      return AUDIO_LOUDNESS_TIERS.ui_voice;
    }
    if (/(foley|door|engine|reload|shell|casing|click)/i.test(lower)) {
      return AUDIO_LOUDNESS_TIERS.sfx_foley;
    }
    if (/(bird|cicada|cricket|wind|rain|amb)/i.test(lower)) {
      return AUDIO_LOUDNESS_TIERS.ambience;
    }
    return AUDIO_LOUDNESS_TIERS.ui_voice;
  }

  // 3. Melee / Sword / Futuristic / RPGSkill / Zombie
  if (
    pack === 'Zombie_Sound_Effects_Bundle'
    || /zombie_sound_effects_bundle/i.test(lower)
  ) {
    if (dur >= 4.0 || /(survival_?amb|ambient|atmosphere|loop)/i.test(lower)) {
      return AUDIO_LOUDNESS_TIERS.ambience;
    }
    return AUDIO_LOUDNESS_TIERS.sfx_combat_light;
  }
  if (
    ['MeleeWeaponsSoundEffectsPack1', 'SwordPackUE', 'Futuristic_Impacts', 'RPGSkillSound'].includes(pack)
    || /(?:meleeweapons|swordpackue|futuristic_impacts|rpgskillsound)/i.test(lower)
  ) {
    return AUDIO_LOUDNESS_TIERS.sfx_combat_light;
  }

  // 4. SoundPackRPGGames
  if (pack === 'SoundPackRPGGames' || /soundpackrpggames/i.test(lower)) {
    if (/voices(?:cue|wav)?/i.test(lower)) return AUDIO_LOUDNESS_TIERS.ui_voice;
    if (/(footsteps|crafting)/i.test(lower)) return AUDIO_LOUDNESS_TIERS.sfx_foley;
    if (/(attacks|magic)/i.test(lower)) return AUDIO_LOUDNESS_TIERS.sfx_combat_light;
    if (/actions/i.test(lower)) {
      if (/(scream|grunt|hurt|pain|level|quest|ui|voice|laugh|roar)/i.test(lower)) return AUDIO_LOUDNESS_TIERS.ui_voice;
      if (/(attack|hit|slash|bash|shoot|cast|strike|punch|kick)/i.test(lower)) return AUDIO_LOUDNESS_TIERS.sfx_combat_light;
      return AUDIO_LOUDNESS_TIERS.sfx_foley;
    }
    return AUDIO_LOUDNESS_TIERS.sfx_foley;
  }

  // 5. Rewards / UI / Human Vocal Bonus (except Break_Jar / Break_Wood)
  if (
    pack === 'RewardsLootsAudioPack'
    || /rewardslootsaudiopack/i.test(lower)
  ) {
    if (/(break_?jar|break_?wood)/i.test(lower)) return AUDIO_LOUDNESS_TIERS.sfx_combat_light;
    return AUDIO_LOUDNESS_TIERS.ui_voice;
  }
  if (
    /survival_sfx\/user_interface/i.test(lower)
    || /footstepssoundpack\/bonus_human_vocal_sounds/i.test(lower)
  ) {
    return AUDIO_LOUDNESS_TIERS.ui_voice;
  }

  // 6. Foley packs
  if (
    ['FootstepsSoundPack', 'Doorssfx', 'Coin_And_Gem_SFX', 'Survival_SFX', 'V10_German'].includes(pack)
    || /(?:footstepssoundpack|doorssfx|coin_and_gem_sfx|survival_sfx|v10_german)/i.test(lower)
  ) {
    return AUDIO_LOUDNESS_TIERS.sfx_foley;
  }

  // 7. MegaBundleSoundPack & HorrorSoundPack2
  if (
    ['MegaBundleSoundPack', 'HorrorSoundPack2'].includes(pack)
    || /(?:megabundlesoundpack|horrorsoundpack)/i.test(lower)
  ) {
    if (/(darkambient|ambient|atmosphere|drone|wind|rain)/i.test(lower) && !/(mystick|chase|bgm)/i.test(lower)) {
      return AUDIO_LOUDNESS_TIERS.ambience;
    }
    if (/(mystick|soundtrack|chase|bgm|music)/i.test(lower)) return AUDIO_LOUDNESS_TIERS.bgm;
    if (dur > 0 && dur < 2.5) return AUDIO_LOUDNESS_TIERS.sfx_combat_light;
    return AUDIO_LOUDNESS_TIERS.ambience;
  }

  // 8. Vefects Water
  if (pack === 'Vefects_Water' || /vefects[/_]water/i.test(lower)) {
    return dur > 0 && dur < 2.0 ? AUDIO_LOUDNESS_TIERS.sfx_foley : AUDIO_LOUDNESS_TIERS.ambience;
  }

  // Generic fallbacks
  if (/(bgm|music|soundtrack)/i.test(lower)) return AUDIO_LOUDNESS_TIERS.bgm;
  if (/(ambient|ambience|wind|rain|waterfall)/i.test(lower)) return AUDIO_LOUDNESS_TIERS.ambience;
  if (/(ui|voice|announcer|vocal|click)/i.test(lower)) return AUDIO_LOUDNESS_TIERS.ui_voice;
  if (/(heavy|blast|boom|cannon)/i.test(lower)) return AUDIO_LOUDNESS_TIERS.sfx_combat_heavy;
  if (/(slash|sword|hit|impact|punch|kick|stab|parry)/i.test(lower)) return AUDIO_LOUDNESS_TIERS.sfx_combat_light;
  return AUDIO_LOUDNESS_TIERS.sfx_foley;
}

/**
 * Computes intensity & distance relative loudness offset in dB:
 *   light/small/soft/quiet/tiny -> -3.0 dB
 *   heavy/big/large/extreme/crit -> +2.0 dB
 *   far/distant/dist -> -4.0 dB
 */
export function computeVariantLoudnessOffsetDb(nameOrPath, overrides = null) {
  const str = String(nameOrPath || '');
  if (typeof overrides === 'function') {
    const v = overrides(str);
    if (Number.isFinite(v)) return Number(v);
  } else if (overrides && typeof overrides === 'object' && Number.isFinite(overrides[str])) {
    return Number(overrides[str]);
  }
  let offset = 0;
  if (/(?:^|[^a-z])(light|small|soft|quiet|tiny)(?:[^a-z]|$)/i.test(str)) offset -= 3.0;
  if (/(?:^|[^a-z])(heavy|big|large|extreme|crit)(?:[^a-z]|$)/i.test(str)) offset += 2.0;
  if (/(?:^|[^a-z])(far|distant|dist)(?:[^a-z]|$)/i.test(str)) offset -= 4.0;
  return offset;
}

/**
 * Computes clamped gain ([-24, +18] dB) and max 4 dB peak overshoot protection for short SFX.
 */
export function computeSafeShortGainDb({
  targetDb,
  variantOffsetDb = 0,
  meanVolumeDb,
  maxVolumeDb,
  ceilingDb,
}) {
  const desiredDb = Number(targetDb) + (Number(variantOffsetDb) || 0);
  const meanDb = Number.isFinite(meanVolumeDb) ? Number(meanVolumeDb) : desiredDb;
  const maxDb = Number.isFinite(maxVolumeDb) ? Number(maxVolumeDb) : -3.0;
  const ceilDb = Number.isFinite(ceilingDb) ? Number(ceilingDb) : -1.0;

  const rawGainDb = desiredDb - meanDb;
  let gainDb = clamp(rawGainDb, -24.0, 18.0);
  const hitBoostCap = rawGainDb > 18.0;
  let peakClamped = false;

  const maxAllowedPeakDb = ceilDb + 4.0;
  if (maxDb + gainDb > maxAllowedPeakDb) {
    gainDb = clamp(maxAllowedPeakDb - maxDb, -24.0, 18.0);
    peakClamped = true;
  }

  return {
    rawGainDb: Number(rawGainDb.toFixed(2)),
    gainDb: Number(gainDb.toFixed(2)),
    projectedPeakDb: Number((maxDb + gainDb).toFixed(2)),
    ceilingLinear: Number(Math.pow(10, ceilDb / 20).toFixed(6)),
    hitBoostCap,
    peakClamped,
  };
}

const EXTENDED_FOOTSTEP_RE = /(?:^|[_/\\-])(cowboy|retro|robotic|mech|sci[_-]?fi)(?:[_/\\-]|$)/i;

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) * 0.5;
}

/**
 * Normalizes an asset name + directory into a semantic cue key (`sword_slash_heavy`,
 * `step_concrete`, `door_creak`, `gun_pistol_shot`) by stripping only trailing numeric/take suffixes.
 */
export function extractSemanticCueKey(name, { pack = '', relDir = '' } = {}) {
  const raw = String(name || '').trim();
  const normBase = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s./\\]+/g, '_')
    .toLowerCase();

  let cleaned = normBase
    // Remove boilerplate engine asset prefixes while preserving meaningful domain tokens
    .replace(/^(?:sfx|wav|sw|sc|sb|snd|sound|audio)_+(?=[a-z])/i, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  // Strip trailing variation / take / duplicate index suffixes repeatedly: _01, _001, _v2, _var3, _alt2, _a
  let prev;
  do {
    prev = cleaned;
    cleaned = cleaned
      .replace(/(?:_(?:var|variation|ver|v|take|alt|part|rpt|copy|rnd)?\d+|_[a-f])$/i, '')
      .replace(/_+$/, '');
  } while (cleaned && cleaned !== prev);

  // Strip trailing digits only when there is still a descriptive stem ahead of them
  const trailingDigits = cleaned.match(/^([a-z][a-z0-9_]*?[a-z])_?\d{1,3}$/);
  if (trailingDigits && trailingDigits[1].length >= 4) {
    cleaned = trailingDigits[1];
  }

  const contextText = `${pack}/${relDir}/${raw}`.toLowerCase();
  const isExtendedFootstep = EXTENDED_FOOTSTEP_RE.test(contextText)
    && /(footstep|step|walk|run|sprint|land|jump)/i.test(contextText);

  const packPrefix = pack === 'CustomAI'
    ? ''
    : String(pack || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-z0-9]+/gi, '_')
        .toLowerCase()
        .replace(/^_+|_+$/g, '')
        .replace(/_?(?:sound_?effects_?pack_?\d*|sound_?pack|audio_?pack|sfx|bundle)$/i, '');

  const dirLeaf = String(relDir || '').split('/').filter(Boolean).pop() || '';
  const normDirLeaf = dirLeaf.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^a-z0-9]+/gi, '_').toLowerCase().replace(/^_+|_+$/g, '');
  const cueKey = (pack === 'CustomAI' && normDirLeaf && (!cleaned || /^(?:v|var|take|alt|part|sample|out|sfx|audio)?\d*$/.test(cleaned)))
    ? normDirLeaf
    : (cleaned || normBase || 'cue');
  return {
    cueKey,
    fullKey: packPrefix ? `${packPrefix}_${cueKey}` : cueKey,
    isExtendedFootstep,
  };
}

/** Fast standard RIFF/WAV PCM decoder (handles 16/24/32-bit PCM & IEEE float) to mono Float32Array. */
export function parseWavPcmSamples(buf, maxSeconds = 6.0) {
  if (!Buffer.isBuffer(buf) || buf.length < 44) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;

  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;

  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ' && sz >= 16 && body + 16 <= buf.length) {
      audioFormat = buf.readUInt16LE(body);
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      dataOffset = body;
      dataSize = Math.min(sz, buf.length - body);
      break;
    }
    off = body + sz + (sz & 1);
  }

  if ((audioFormat !== 1 && audioFormat !== 3) || !channels || !sampleRate || dataOffset < 0) {
    return null;
  }

  const bytesPerSample = bitsPerSample >> 3;
  const frameSize = bytesPerSample * channels;
  if (!frameSize) return null;

  const totalFrames = Math.floor(dataSize / frameSize);
  const fullDuration = totalFrames / sampleRate;
  const framesToRead = Math.min(totalFrames, Math.floor(sampleRate * maxSeconds));
  const samples = new Float32Array(framesToRead);

  for (let i = 0; i < framesToRead; i++) {
    let sum = 0;
    const base = dataOffset + i * frameSize;
    for (let ch = 0; ch < channels; ch++) {
      const p = base + ch * bytesPerSample;
      let val = 0;
      if (audioFormat === 3 && bitsPerSample === 32) {
        val = buf.readFloatLE(p);
      } else if (bitsPerSample === 16) {
        val = buf.readInt16LE(p) / 32768;
      } else if (bitsPerSample === 24) {
        let s = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
        if (s & 0x800000) s |= ~0xffffff;
        val = s / 8388608;
      } else if (bitsPerSample === 32) {
        val = buf.readInt32LE(p) / 2147483648;
      } else if (bitsPerSample === 8) {
        val = (buf[p] - 128) / 128;
      }
      sum += val;
    }
    samples[i] = sum / channels;
  }

  return { samples, sampleRate, channels, duration: fullDuration };
}

function fftRadix2(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextWRe;
      }
    }
  }
}

/** Computes spectral centroid in Hz using up to 6 evenly spaced 512-sample Hann windows. */
export function computeSpectralCentroidHz(samples, sampleRate, trimStart = 0, trimEnd = null) {
  if (!samples?.length || !(sampleRate > 0)) return 0;
  const N = 512;
  const startIdx = Math.max(0, Math.floor(trimStart * sampleRate));
  const endIdx = Math.min(samples.length, trimEnd != null ? Math.ceil(trimEnd * sampleRate) : samples.length);
  const span = endIdx - startIdx;
  if (span < 32) return 0;

  const numWin = span >= N * 4 ? 6 : Math.max(1, Math.floor(span / 128));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let weightedFreq = 0;
  let totalMag = 0;

  for (let w = 0; w < numWin; w++) {
    const offset = startIdx + Math.floor(((span - Math.min(span, N)) * w) / Math.max(1, numWin - 1));
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < N && offset + i < endIdx; i++) {
      const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
      re[i] = samples[offset + i] * hann;
    }
    fftRadix2(re, im);
    const half = N >> 1;
    for (let k = 1; k < half; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const freq = (k * sampleRate) / N;
      weightedFreq += freq * mag;
      totalMag += mag;
    }
  }
  return totalMag > 1e-8 ? weightedFreq / totalMag : 0;
}

export function measureSamplesFeatures(samples, sampleRate) {
  const analysis = analyzeAudioBuffer({
    length: samples.length,
    sampleRate,
    numberOfChannels: 1,
    getChannelData: () => samples,
  });
  const spectralCentroidHz = computeSpectralCentroidHz(samples, sampleRate, analysis.trimStart, analysis.trimEnd);
  return {
    ...analysis,
    spectralCentroidHz: Math.round(spectralCentroidHz),
  };
}

/**
 * Selects 3-4 representative variants from a group by removing duration/loudness outliers,
 * ranking by normalized feature vector (activeDuration, spectralCentroidHz, peak), and sampling
 * equidistant quantiles (~25% / 50% / 75% / quartiles).
 */
export function selectQuantileVariants(candidates, { minKeep = 3, maxKeep = 4 } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { selected: [], rejected: [], quantileIndices: [] };
  }

  const audible = [];
  const rejected = [];
  for (const c of candidates) {
    if (!c || !(c.rms > 1e-5) || !(c.activeDuration >= 0.02)) {
      rejected.push({ ...c, reason: 'silent_or_too_short' });
      continue;
    }
    audible.push(c);
  }
  if (audible.length === 0) {
    return { selected: [], rejected, quantileIndices: [] };
  }

  const medDur = median(audible.map((c) => c.activeDuration));
  const medRms = median(audible.map((c) => c.rms));
  const medRmsDb = 20 * Math.log10(Math.max(1e-6, medRms));

  let pool = [];
  if (audible.length <= 2) {
    pool = [...audible];
  } else {
    for (const c of audible) {
      const durRatio = c.activeDuration / Math.max(0.02, medDur);
      const rmsDb = 20 * Math.log10(Math.max(1e-6, c.rms));
      const rmsDiff = Math.abs(rmsDb - medRmsDb);
      if (durRatio < 0.4 || durRatio > 1.85 || rmsDiff > 9.0) {
        rejected.push({ ...c, reason: 'outlier_duration_or_peak' });
      } else {
        pool.push(c);
      }
    }
    if (pool.length < Math.min(minKeep, audible.length)) {
      // Relax softly so we never starve valid cues when all variants diverge slightly
      pool = [...audible];
      rejected.length = 0;
    }
  }

  const durs = pool.map((c) => c.activeDuration);
  const cents = pool.map((c) => c.spectralCentroidHz || 0);
  const peaks = pool.map((c) => c.peak || 0);
  const norm = (v, arr) => {
    const lo = Math.min(...arr);
    const hi = Math.max(...arr);
    return hi > lo + 1e-6 ? (v - lo) / (hi - lo) : 0.5;
  };

  const ranked = [...pool]
    .map((c) => ({
      ...c,
      rankScore: 0.45 * norm(c.activeDuration, durs)
        + 0.35 * norm(c.spectralCentroidHz || 0, cents)
        + 0.2 * norm(c.peak || 0, peaks),
    }))
    .sort((a, b) => a.rankScore - b.rankScore || String(a.id).localeCompare(String(b.id)));

  const targetCount = Math.min(maxKeep, ranked.length);
  const pickedIdx = new Set();
  if (ranked.length <= maxKeep) {
    for (let i = 0; i < ranked.length; i++) pickedIdx.add(i);
  } else {
    const quantiles = targetCount === 3 ? [0.25, 0.5, 0.75] : [0.2, 0.4, 0.65, 0.85];
    for (const q of quantiles) {
      let idx = Math.round(q * (ranked.length - 1));
      while (pickedIdx.has(idx) && idx + 1 < ranked.length) idx++;
      while (pickedIdx.has(idx) && idx - 1 >= 0) idx--;
      pickedIdx.add(idx);
    }
  }

  const indices = [...pickedIdx].sort((a, b) => a - b);
  const selected = indices.map((i) => ranked[i]);
  const selectedIds = new Set(selected.map((s) => s.id));
  for (const item of ranked) {
    if (!selectedIds.has(item.id)) {
      rejected.push({ ...item, reason: 'not_in_quantile_sample' });
    }
  }
  return { selected, rejected, quantileIndices: indices };
}

function parseVolumeDetectStderr(stderr = '') {
  const meanMatches = [...String(stderr).matchAll(/mean_volume:\s*(-?[\d.inf]+)\s*dB/gi)];
  const maxMatches = [...String(stderr).matchAll(/max_volume:\s*(-?[\d.inf]+)\s*dB/gi)];
  const nMatches = [...String(stderr).matchAll(/n_samples:\s*(\d+)/gi)];
  const srMatch = String(stderr).match(/(\d+)\s*Hz,\s*(mono|stereo|\d+\s*channels)/i);

  const meanRaw = meanMatches.length ? meanMatches[meanMatches.length - 1][1] : null;
  const maxRaw = maxMatches.length ? maxMatches[maxMatches.length - 1][1] : null;
  const nSamples = nMatches.length ? Number(nMatches[nMatches.length - 1][1]) : 0;
  const sampleRate = srMatch ? Number(srMatch[1]) : 44100;
  const channels = srMatch ? (/stereo/i.test(srMatch[2]) ? 2 : 1) : 1;

  const parseDb = (v) => {
    if (!v) return null;
    if (/inf/i.test(v)) return -91.0;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const trimmedDuration = nSamples > 0 && sampleRate > 0 ? nSamples / (sampleRate * channels) : 0;
  return {
    meanDb: parseDb(meanRaw),
    maxDb: parseDb(maxRaw),
    nSamples,
    trimmedDuration,
  };
}

export function parseLoudnormJsonStderr(stderr = '') {
  const text = String(stderr || '');
  const idx = text.lastIndexOf('{');
  const end = text.lastIndexOf('}');
  if (idx < 0 || end <= idx) return null;
  try {
    const obj = JSON.parse(text.slice(idx, end + 1));
    if (!obj || obj.input_i === '-inf' || !Number.isFinite(Number(obj.input_i))) return null;
    return {
      inputI: Number(obj.input_i),
      inputTp: Number(obj.input_tp),
      inputLra: Number(obj.input_lra),
      inputThresh: Number(obj.input_thresh),
      targetOffset: Number(obj.target_offset),
    };
  } catch {
    return null;
  }
}

export async function measureAudioFileVolume(ffmpegBin, filePath, preFilter = '') {
  const af = ['aformat=sample_fmts=fltp', preFilter, 'volumedetect'].filter(Boolean).join(',');
  const res = await runFfmpegAsync(ffmpegBin, ['-hide_banner', '-nostats', '-i', filePath, '-af', af, '-f', 'null', '-']);
  return parseVolumeDetectStderr(res.stderr);
}

/**
 * Runs Pass-1 measurement + Pass-2 rendering + post-encode peak/RMS audit on one audio file
 * according to the 6-tier loudness spec.
 */
export async function normalizeAndEncodeAudioFile({
  srcAbs,
  outAbs,
  item,
  duration = 0,
  ffmpegBin = 'ffmpeg',
  overrides = null,
} = {}) {
  const tier = classifyAudioLoudnessTier(item, { duration, overrides: overrides?.tierOverrides });
  const variantOffsetDb = computeVariantLoudnessOffsetDb(`${item?.relDir || ''}/${item?.name || path.basename(srcAbs)}`, overrides?.offsetOverrides);
  const ctxText = `${item?.pack || ''}/${item?.relDir || ''}/${item?.name || ''}`;
  const isHeavySubBass = tier.id === 'bgm' || tier.id === 'ambience' || (tier.id === 'sfx_combat_heavy' && /(explosion|grenade|thunder|firework|cannon)/i.test(ctxText));
  const hpHz = isHeavySubBass ? 30 : 80;
  const hpFilter = `highpass=f=${hpHz}`;

  const isLongAlways = tier.mode === 'loudnorm';
  const rawPass1 = await measureAudioFileVolume(ffmpegBin, srcAbs, '');

  // Pre-trim prefix/suffix silence for non-music/ambience
  let useTrim = !isLongAlways;
  let trimmedStats = useTrim ? await measureAudioFileVolume(ffmpegBin, srcAbs, `${SILENCE_TRIM_FILTER},${hpFilter}`) : rawPass1;
  if (useTrim && (trimmedStats.meanDb === null || trimmedStats.trimmedDuration < 0.02)) {
    useTrim = false;
    trimmedStats = await measureAudioFileVolume(ffmpegBin, srcAbs, hpFilter);
  }

  const effectiveDur = trimmedStats.trimmedDuration > 0 ? trimmedStats.trimmedDuration : (duration || 0.5);
  const useLoudnorm = isLongAlways || effectiveDur >= (tier.shortMaxSec || 1.5);
  const isStreamOut = (tier.id === 'bgm' || tier.id === 'ambience' || effectiveDur >= 4.0) && (duration >= 4.0 || isLongAlways);
  const outChannels = isStreamOut ? 2 : 1;
  const outLayout = isStreamOut ? 'stereo' : 'mono';
  const outBitrate = isStreamOut ? '96k' : '64k';
  const fmtPrefix = `aresample=44100,aformat=sample_fmts=fltp:channel_layouts=${outLayout}`;

  await fs.mkdir(path.dirname(outAbs), { recursive: true });

  let algorithm = useLoudnorm ? 'loudnorm_2pass' : 'active_rms_limiter';
  let gainInfo = { rawGainDb: 0, gainDb: 0, hitBoostCap: false, peakClamped: false };
  // Reserve pre-MP3 headroom (-1.3 dB for 64k mono, -0.8 dB for 96k stereo) so libmp3lame MDCT quantization stays <= ceilingDb
  let mp3SafeCeilingDb = tier.ceilingDb - (isStreamOut ? 0.8 : 1.3);
  let mp3SafeCeilingLinear = Number(Math.pow(10, mp3SafeCeilingDb / 20).toFixed(6));

  const renderShortOnce = async (gainDb, ceilLin) => {
    const renderFilter = [
      fmtPrefix,
      useTrim ? SILENCE_TRIM_FILTER : '',
      hpFilter,
      `volume=${gainDb.toFixed(2)}dB`,
      `alimiter=limit=${ceilLin}:attack=2:release=50:level=disabled`,
    ].filter(Boolean).join(',');
    let enc = await runFfmpegAsync(ffmpegBin, ['-y', '-v', 'error', '-i', srcAbs, '-af', renderFilter, '-c:a', 'libmp3lame', '-b:a', outBitrate, outAbs]);
    if (enc.code !== 0) {
      const fbFilter = `${fmtPrefix},${hpFilter},volume=${gainDb.toFixed(2)}dB,alimiter=limit=${ceilLin}:attack=2:release=50:level=disabled`;
      enc = await runFfmpegAsync(ffmpegBin, ['-y', '-v', 'error', '-i', srcAbs, '-af', fbFilter, '-c:a', 'libmp3lame', '-b:a', outBitrate, outAbs]);
      if (enc.code !== 0) throw new Error(`ffmpeg short encode failed for ${srcAbs}: ${enc.stderr}`);
    }
  };

  if (useLoudnorm) {
    const targetI = clamp(tier.targetDb + variantOffsetDb, -36, -5);
    const p1Filter = [fmtPrefix, useTrim ? SILENCE_TRIM_FILTER : '', hpFilter, `loudnorm=I=${targetI.toFixed(1)}:TP=${mp3SafeCeilingDb.toFixed(1)}:LRA=11:print_format=json`].filter(Boolean).join(',');
    const p1 = await runFfmpegAsync(ffmpegBin, ['-hide_banner', '-nostats', '-i', srcAbs, '-af', p1Filter, '-f', 'null', '-']);
    const ln = parseLoudnormJsonStderr(p1.stderr);
    let p2Filter;
    if (ln) {
      p2Filter = [
        fmtPrefix,
        useTrim ? SILENCE_TRIM_FILTER : '',
        hpFilter,
        `loudnorm=I=${targetI.toFixed(1)}:TP=${mp3SafeCeilingDb.toFixed(1)}:LRA=11:measured_I=${ln.inputI.toFixed(2)}:measured_TP=${ln.inputTp.toFixed(2)}:measured_LRA=${ln.inputLra.toFixed(2)}:measured_thresh=${ln.inputThresh.toFixed(2)}:offset=${ln.targetOffset.toFixed(2)}:linear=true`,
      ].filter(Boolean).join(',');
      gainInfo.gainDb = Number((targetI - ln.inputI).toFixed(2));
    } else {
      algorithm = 'active_rms_limiter';
      gainInfo = computeSafeShortGainDb({
        targetDb: tier.targetDb,
        variantOffsetDb,
        meanVolumeDb: trimmedStats.meanDb,
        maxVolumeDb: trimmedStats.maxDb,
        ceilingDb: mp3SafeCeilingDb,
      });
      p2Filter = [
        fmtPrefix,
        useTrim ? SILENCE_TRIM_FILTER : '',
        hpFilter,
        `volume=${gainInfo.gainDb.toFixed(2)}dB`,
        `alimiter=limit=${mp3SafeCeilingLinear}:attack=2:release=50:level=disabled`,
      ].filter(Boolean).join(',');
    }
    let enc = await runFfmpegAsync(ffmpegBin, ['-y', '-v', 'error', '-i', srcAbs, '-af', p2Filter, '-c:a', 'libmp3lame', '-b:a', outBitrate, outAbs]);
    if (enc.code !== 0) {
      enc = await runFfmpegAsync(ffmpegBin, ['-y', '-v', 'error', '-i', srcAbs, '-ac', String(outChannels), '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', outBitrate, outAbs]);
      if (enc.code !== 0) throw new Error(`ffmpeg encode failed for ${srcAbs}: ${enc.stderr}`);
    }
  } else {
    gainInfo = computeSafeShortGainDb({
      targetDb: tier.targetDb,
      variantOffsetDb,
      meanVolumeDb: trimmedStats.meanDb,
      maxVolumeDb: trimmedStats.maxDb,
      ceilingDb: tier.ceilingDb,
    });
    await renderShortOnce(gainInfo.gainDb, mp3SafeCeilingLinear);
  }

  // Post-encode verification (strip MP3 encoder padding cleanly for Active RMS, or read EBU R128 LUFS for long tracks)
  let postStats = await measureAudioFileVolume(ffmpegBin, outAbs, isLongAlways ? '' : SILENCE_TRIM_FILTER);
  if (postStats.meanDb === null && postStats.maxDb === null) {
    postStats = await measureAudioFileVolume(ffmpegBin, outAbs, '');
  }
  if (!isLongAlways && postStats.meanDb === null && postStats.maxDb === null && useTrim) {
    const fbFilter = `${fmtPrefix},${hpFilter},volume=${gainInfo.gainDb.toFixed(2)}dB,alimiter=limit=${mp3SafeCeilingLinear}:attack=2:release=50:level=disabled`;
    const fbEnc = await runFfmpegAsync(ffmpegBin, ['-y', '-v', 'error', '-i', srcAbs, '-af', fbFilter, '-c:a', 'libmp3lame', '-b:a', outBitrate, outAbs]);
    if (fbEnc.code === 0) {
      postStats = await measureAudioFileVolume(ffmpegBin, outAbs, '');
    }
  }
  for (let retry = 0; retry < 3 && postStats.maxDb !== null && postStats.maxDb > Math.min(tier.ceilingDb, -0.6); retry++) {
    const overshoot = postStats.maxDb - tier.ceilingDb;
    mp3SafeCeilingDb -= overshoot + 0.8 + retry * 0.4;
    mp3SafeCeilingLinear = Number(Math.pow(10, mp3SafeCeilingDb / 20).toFixed(6));
    const stepCut = Math.max(0.8, overshoot + 0.8);
    const trimBackFilter = `${fmtPrefix},volume=-${stepCut.toFixed(2)}dB,alimiter=limit=${mp3SafeCeilingLinear}:attack=2:release=50:level=disabled`;
    const bakPath = `${outAbs}.tmp.mp3`;
    const re = await runFfmpegAsync(ffmpegBin, ['-y', '-v', 'error', '-i', outAbs, '-af', trimBackFilter, '-c:a', 'libmp3lame', '-b:a', outBitrate, bakPath]);
    if (re.code === 0) {
      await fs.rename(bakPath, outAbs);
    } else {
      await fs.rm(bakPath, { force: true }).catch(() => {});
      break;
    }
    postStats = await measureAudioFileVolume(ffmpegBin, outAbs, isLongAlways ? '' : SILENCE_TRIM_FILTER);
  }
  let measuredDb = postStats.meanDb ?? (tier.targetDb + variantOffsetDb);
  let peakDb = postStats.maxDb ?? tier.ceilingDb;
  if (algorithm === 'loudnorm_2pass') {
    const lnCheck = await runFfmpegAsync(ffmpegBin, [
      '-hide_banner', '-nostats', '-i', outAbs,
      '-af', `aformat=sample_fmts=fltp,loudnorm=I=${(tier.targetDb + variantOffsetDb).toFixed(1)}:TP=${tier.ceilingDb.toFixed(1)}:LRA=11:print_format=json`,
      '-f', 'null', '-',
    ]);
    const postLn = parseLoudnormJsonStderr(lnCheck.stderr);
    if (postLn) {
      measuredDb = postLn.inputI;
      if (Number.isFinite(postStats.maxDb)) peakDb = postStats.maxDb;
    }
  }

  return {
    loudnessTier: tier.id,
    bus: tier.bus,
    targetDb: Number((tier.targetDb + variantOffsetDb).toFixed(2)),
    ceilingDb: tier.ceilingDb,
    variantOffsetDb,
    algorithm,
    highpassHz: hpHz,
    silenceTrimmed: useTrim,
    rawBeforeDb: rawPass1.meanDb,
    rawBeforePeakDb: rawPass1.maxDb,
    trimmedBeforeDb: trimmedStats.meanDb,
    measuredDb: Number(measuredDb.toFixed(2)),
    peakDb: Number(peakDb.toFixed(2)),
    appliedGainDb: Number(gainInfo.gainDb.toFixed(2)),
    hitBoostCap: Boolean(gainInfo.hitBoostCap),
    peakClamped: Boolean(gainInfo.peakClamped),
    clippingAlert: peakDb > -0.5,
  };
}

export function runFfmpegAsync(ffmpegBin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const outChunks = [];
    const errChunks = [];
    child.stdout.on('data', (d) => outChunks.push(d));
    child.stderr.on('data', (d) => errChunks.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code,
        stdout: Buffer.concat(outChunks),
        stderr: Buffer.concat(errChunks).toString('utf8'),
      });
    });
  });
}

export async function runPool(items, concurrency, fn) {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

/**
 * Guarantees 100% step_<surface> and impact_<surface> cue coverage across all 10 surface types:
 * asphalt | concrete | tile | wood | metal | glass | dirt | grass | water | fabric.
 * Excludes FootstepsSoundPack Cowboy/Retro/Robotic variants from generic default steps.
 */
export function buildSurfaceTypeCueMap(sfxCues, allSfxItems) {
  const stepRules = {
    asphalt: { regex: /(gravel|asphalt|pavement|tarmac|stone_step|concrete)/i, fallback: /concrete/i },
    concrete: { regex: /(concrete|cement|stone|sidewalk|asphalt)/i, fallback: /gravel|rock/i },
    tile: { regex: /(tile|marble|ceramic|floor_tile)/i, fallback: /concrete|wood/i },
    wood: { regex: /(wood|plank|timber|deck)/i, fallback: /tree/i },
    metal: { regex: /(metal|steel|iron|grate|chain)/i, fallback: /armor/i },
    glass: { regex: /(glass|crystal|shard|tile_step)/i, fallback: /gravel|ice|tile/i },
    dirt: { regex: /(dirt|soil|earth|mud)/i, fallback: /sand|gravel/i },
    grass: { regex: /(grass|leaves|leaf|foliage|forest|bush)/i, fallback: /dirt/i },
    water: { regex: /(water|puddle|mud_water|splash|wade)/i, fallback: /mud/i },
    fabric: { regex: /(carpet|cloth|fabric|rug|cushion)/i, fallback: /sand|snow|leaves/i },
  };

  const impactRules = {
    asphalt: { regex: /(rock|stone|concrete|bullet.*rock|bullet.*concrete|stone.*impact)/i, fallback: /ground|impact.*heavy/i },
    concrete: { regex: /(concrete|stone|brick|wall_hit|rock_impact|crush)/i, fallback: /heavy_hit|ground/i },
    tile: { regex: /(tile|ceramic|porcelain|stone|pottery)/i, fallback: /glass|brick|concrete/i },
    wood: { regex: /(wood|plank|crate|door|log).*?(hit|impact|crush|break|thud)|(?:impact|hit|break).*?(wood|crate)/i, fallback: /wood|door/i },
    metal: { regex: /(metal|metl|sword_parry|anvil|armor|iron|steel).*?(hit|impact|clang|parry|fric|clash)|(?:metlimpt|sword_parry)/i, fallback: /metal|sword/i },
    glass: { regex: /(glass|jar|bottle|pot|crystal).*?(break|shatter|hit|impact)|(?:break_jar|shatter)/i, fallback: /break|ceramic|metal_chime/i },
    dirt: { regex: /(dirt|mud|dig|shovel|earth|soil|sand)/i, fallback: /ground|thud/i },
    grass: { regex: /(grass|leaf|leaves|bush|foliage|chop|harvest|pick).*?(cut|hit|swish|rustle)|(?:grass|leaves)/i, fallback: /cloth|dirt|swish/i },
    water: { regex: /(water|splash|water_explosion|drop).*?(big|splash|hit|impact)|(?:splash|water_ball)/i, fallback: /water/i },
    fabric: { regex: /(cloth|fabric|leather|flesh|cushion|armor_cloth|tactical)/i, fallback: /body|punch|thud/i },
  };

  const nonExtSfx = allSfxItems.filter((it) => !it.isExtendedFootstep);

  const pickVariants = (pool, rule, requireFootstepCtx) => {
    const scored = [];
    for (const it of pool) {
      const text = `${it.pack}/${it.relDir}/${it.name}`;
      if (requireFootstepCtx && !/(footstep|step|walk|run|mud|water|carpet|gravel|tile|snow|sand|wood|metal|concrete|grass|leaves)/i.test(text)) {
        continue;
      }
      if (requireFootstepCtx && /(voice|grunt|gun|rifle|zombie|chest|coin|door)/i.test(text)) continue;
      let score = 0;
      if (rule.regex.test(text)) score += 10;
      else if (rule.fallback.test(text)) score += 3;
      else continue;
      if (/footstep|step/i.test(text) && requireFootstepCtx) score += 8;
      if (/footstepssoundpack/i.test(it.pack) && requireFootstepCtx) score += 6;
      if (/impact|impt|hit|break|splash|parry/i.test(text) && !requireFootstepCtx) score += 6;
      if (/(vefects_water|meleeweapons|soundpackrpggames|survival_sfx|rewardsloots|doorssfx)/i.test(it.pack) && !requireFootstepCtx) score += 3;
      if (it.duration >= 0.04 && it.duration <= 2.5) score += 2;
      scored.push({ it, score });
    }
    scored.sort((a, b) => b.score - a.score || a.it.duration - b.it.duration);
    const top = scored.slice(0, Math.min(24, scored.length)).map((s) => s.it);
    if (!top.length) return [];
    const { selected } = selectQuantileVariants(top, { minKeep: 3, maxKeep: 4 });
    return selected.slice(0, 4);
  };

  const surfaceCues = [];
  const coverage = { step: {}, impact: {} };

  const avgField = (arr, field) => {
    const nums = arr.map((x) => x[field]).filter((v) => Number.isFinite(v));
    return nums.length ? Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)) : null;
  };
  const maxField = (arr, field) => {
    const nums = arr.map((x) => x[field]).filter((v) => Number.isFinite(v));
    return nums.length ? Number(Math.max(...nums).toFixed(2)) : null;
  };

  for (const surface of SURFACE_TYPES_10) {
    const stepVars = pickVariants(nonExtSfx, stepRules[surface], true);
    coverage.step[surface] = stepVars.length;
    if (stepVars.length > 0) {
      surfaceCues.push({
        cueName: `step_${surface}`,
        category: 'footstep_surface',
        surfaceType: surface,
        bus: 'foley',
        loudnessTier: 'sfx_foley',
        measuredDb: avgField(stepVars, 'measuredDb'),
        peakDb: maxField(stepVars, 'peakDb'),
        appliedGainDb: avgField(stepVars, 'appliedGainDb') ?? 0,
        gainDb: 0,
        preload: 'buffer',
        variants: stepVars.map((v) => ({
          id: v.id,
          url: v.url,
          path: v.relOut,
          duration: v.duration,
          activeDuration: v.activeDuration,
          peak: v.peak,
          measuredDb: v.measuredDb ?? null,
          peakDb: v.peakDb ?? null,
          appliedGainDb: v.appliedGainDb ?? 0,
          spectralCentroidHz: v.spectralCentroidHz,
        })),
      });
    }

    const impVars = pickVariants(nonExtSfx, impactRules[surface], false);
    coverage.impact[surface] = impVars.length;
    if (impVars.length > 0) {
      surfaceCues.push({
        cueName: `impact_${surface}`,
        category: 'impact_surface',
        surfaceType: surface,
        bus: 'combat',
        loudnessTier: 'sfx_combat_light',
        measuredDb: avgField(impVars, 'measuredDb'),
        peakDb: maxField(impVars, 'peakDb'),
        appliedGainDb: avgField(impVars, 'appliedGainDb') ?? 0,
        gainDb: 0,
        preload: 'buffer',
        variants: impVars.map((v) => ({
          id: v.id,
          url: v.url,
          path: v.relOut,
          duration: v.duration,
          activeDuration: v.activeDuration,
          peak: v.peak,
          measuredDb: v.measuredDb ?? null,
          peakDb: v.peakDb ?? null,
          appliedGainDb: v.appliedGainDb ?? 0,
          spectralCentroidHz: v.spectralCentroidHz,
        })),
      });
    }
  }

  return { surfaceCues, coverage };
}

/**
 * Full batch processor for Milestone 3:
 *   1. Reads Unreal staging audio_source_meta.json + scans direct V10_German/Wavs/*.wav
 *   2. Splits < 4.0s (Mono 64k MP3, -50dB trim + 80Hz HPF + -14 LUFS) vs >= 4.0s (Stereo 96k MP3, -16 LUFS)
 *   3. Groups short SFX by semantic cue key, runs quantile curation (3-4 variants), builds 10-surface map
 *   4. Writes cue_table.json (preload: buffer ONLY), streams_table.json (preload: stream), audio_library_full.json
 */
function normalizeHorrorDedupKey(item) {
  let stem = String(item.name || '').toLowerCase();
  stem = stem.replace(/^(?:sfx_|wav_|snd_|hsp2_)/, '').replace(/(?:_wav|_sfx)+$/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const dur = Number(item.duration || 0).toFixed(2);
  return `${stem}@${dur}`;
}

function isHorrorOverlapCandidate(item) {
  return item.pack === 'HorrorSoundPack2'
    || (item.pack === 'MegaBundleSoundPack' && /HorrorSoundPack2/i.test(item.relDir || item.relWav || ''));
}

const SUPPORTED_CUSTOM_SFX_EXTS = new Set(['.wav', '.mp3', '.flac', '.m4a', '.ogg']);

function isPromotedMusicSource(item) {
  if (item?.pack !== 'MegaBundleSoundPack') return false;
  const dir = String(item.relDir || item.relWav || '');
  return /MystickSoundtracks\/Sountracks/i.test(dir) || /DarkAmbientSoundtracks\/Soundtracks/i.test(dir);
}

export function isDirtyAnnouncerSource(item) {
  if (item?.pack !== 'GunSoundPack') return false;
  const name = String(item.name || item.relWav || '');
  return /announcer_voice_classic_FPS_style_(?:headshot|frenzy|killingspree)/i.test(name);
}

async function probeDurationViaFfprobe(ffprobeBin, filePath) {
  const res = await runFfmpegAsync(ffprobeBin, [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=channels,sample_rate',
    '-of', 'json',
    filePath,
  ]).catch(() => null);
  if (!res?.stdout) return null;
  try {
    const parsed = JSON.parse(res.stdout);
    const dur = Number(parsed?.format?.duration);
    const st = Array.isArray(parsed?.streams) ? parsed.streams[0] : null;
    return Number.isFinite(dur) && dur > 0
      ? {
          duration: dur,
          channels: Number(st?.channels) || 1,
          sampleRate: Number(st?.sample_rate) || 44100,
        }
      : null;
  } catch {
    return null;
  }
}

export async function processAudioLibraryBatch({
  stagingRoot = path.resolve(process.env.HGAME_AUDIO_STAGING || 'D:/UnrealWorkspace/Anim58/Saved/WebAssetExport/audio_staging'),
  v10WavsDir = path.resolve(process.env.HGAME_V10_WAVS_DIR || 'D:/UnrealWorkspace/Anim58/Content/V10_German/Wavs'),
  customSfxRoot = path.resolve(process.env.HGAME_CUSTOM_SFX_STAGING || 'webasset/hgame-assets-cn/raw/audio_ai_staging/universal/sfx'),
  outDir = path.resolve('webasset/hgame-assets-cn/built/audio'),
  baseUrl = '/assets/cn/audio',
  ffmpegBin = 'ffmpeg',
  ffprobeBin = 'ffprobe',
  concurrency = Math.min(12, Math.max(2, os.cpus().length - 2)),
  force = false,
} = {}) {
  const metaPath = path.join(stagingRoot, 'audio_source_meta.json');
  const sourceMeta = existsSync(metaPath)
    ? JSON.parse(await fs.readFile(metaPath, 'utf8'))
    : { items: [] };

  // Scan direct V10_German/Wavs/*.wav bypassing FMOD cleanly
  const v10Items = [];
  if (existsSync(v10WavsDir)) {
    const walkWavs = async (dir) => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) await walkWavs(p);
        else if (/\.wav$/i.test(entry.name)) {
          const rel = path.relative(v10WavsDir, p).replaceAll('\\', '/');
          const stem = path.basename(entry.name, path.extname(entry.name));
          const st = await fs.stat(p);
          const buf = await fs.readFile(p);
          const wav = parseWavPcmSamples(buf, 1.0);
          v10Items.push({
            id: `V10_German__${rel.replace(/\.wav$/i, '').replaceAll('/', '__')}`,
            pack: 'V10_German',
            name: stem,
            relDir: path.dirname(rel).replaceAll('\\', '/'),
            relWav: `V10_German/${rel}`,
            wavAbs: p,
            duration: wav ? Number(wav.duration.toFixed(4)) : 1.0,
            channels: wav?.channels || 1,
            sampleRate: wav?.sampleRate || 44100,
            rawBytes: st.size,
          });
        }
      }
    };
    await walkWavs(v10WavsDir);
  }

  // Scan custom incremental SFX staging (e.g. ElevenLabs / TTS / custom packs)
  const customItems = [];
  if (customSfxRoot && existsSync(customSfxRoot)) {
    const walkCustom = async (dir) => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walkCustom(p);
        } else if (SUPPORTED_CUSTOM_SFX_EXTS.has(path.extname(entry.name).toLowerCase())) {
          const rel = path.relative(customSfxRoot, p).replaceAll('\\', '/');
          const ext = path.extname(entry.name);
          const stem = path.basename(entry.name, ext);
          const st = await fs.stat(p);
          let duration = null;
          let channels = 1;
          let sampleRate = 44100;
          if (/\.wav$/i.test(ext)) {
            const wav = parseWavPcmSamples(await fs.readFile(p), 5.0);
            if (wav) {
              duration = Number(wav.duration.toFixed(4));
              channels = wav.channels;
              sampleRate = wav.sampleRate;
            }
          }
          if (duration === null) {
            const probed = await probeDurationViaFfprobe(ffprobeBin, p);
            if (probed) {
              duration = Number(probed.duration.toFixed(4));
              channels = probed.channels;
              sampleRate = probed.sampleRate;
            }
          }
          customItems.push({
            id: `CustomAI__${rel.slice(0, -ext.length).replaceAll('/', '__')}`,
            pack: 'CustomAI',
            name: stem,
            relDir: path.dirname(rel) === '.' ? '' : path.dirname(rel).replaceAll('\\', '/'),
            relWav: `CustomAI/${rel}`,
            wavAbs: p,
            duration: duration ?? 1.0,
            channels,
            sampleRate,
            rawBytes: st.size,
          });
        }
      }
    };
    await walkCustom(customSfxRoot);
  }

  // Deduplicate HorrorSoundPack2 vs MegaBundleSoundPack/HorrorSoundPack2 by normalized name & duration + fallback duration/fingerprint match
  // Also skip tracks promoted to music_table.json (MystickSoundtracks/Sountracks & DarkAmbientSoundtracks/Soundtracks).
  const rawUeItems = sourceMeta.items || [];
  const horrorMap = new Map();
  const nonHorrorUe = [];
  let horrorOverlapTotal = 0;
  let promotedMusicSkipped = 0;
  let dirtyVoiceSkipped = 0;
  for (const item of rawUeItems) {
    if (isPromotedMusicSource(item)) {
      promotedMusicSkipped++;
      continue;
    }
    if (isDirtyAnnouncerSource(item)) {
      dirtyVoiceSkipped++;
      continue;
    }
    if (isHorrorOverlapCandidate(item)) {
      horrorOverlapTotal++;
      const k = normalizeHorrorDedupKey(item);
      const prev = horrorMap.get(k);
      const score = (item.sampleRate || 0) * 10 + (item.channels || 1) * 2 + (item.pack === 'HorrorSoundPack2' ? 1 : 0);
      if (!prev || score > prev.score) {
        horrorMap.set(k, { score, item });
      }
    } else {
      nonHorrorUe.push(item);
    }
  }
  const dedupedHorror = [...horrorMap.values()].map((v) => v.item);
  const dedupHorrorDropped = (sourceMeta.dedupHorrorDropped || 0) + (horrorOverlapTotal - dedupedHorror.length);

  const allSources = [...nonHorrorUe, ...dedupedHorror, ...v10Items, ...customItems];
  await fs.mkdir(path.join(outDir, 'sfx'), { recursive: true });
  await fs.mkdir(path.join(outDir, 'streams'), { recursive: true });

  const processed = new Array(allSources.length);
  const packStats = new Map();
  const trackErrors = [];

  await runPool(allSources, concurrency, async (item, idx) => {
    const srcAbs = item.wavAbs;
    if (!existsSync(srcAbs)) return;
    const rawStat = await fs.stat(srcAbs);
    let wavInfo = null;
    let features = { activeDuration: item.duration || 0.2, rms: 0.1, peak: 0.5, trimStart: 0, trimEnd: item.duration || 0.2, spectralCentroidHz: 1000 };
    try {
      if (/\.wav$/i.test(srcAbs)) {
        const fileBuf = await fs.readFile(srcAbs);
        wavInfo = parseWavPcmSamples(fileBuf, 5.0);
        if (wavInfo && wavInfo.samples.length > 0) {
          features = measureSamplesFeatures(wavInfo.samples, wavInfo.sampleRate);
        }
      }
    } catch { /* fallback defaults */ }

    const realDuration = wavInfo?.duration || item.duration || 0.5;
    const isStream = realDuration >= 4.0;
    const tierDir = isStream ? 'streams' : 'sfx';
    const relNoExt = item.relWav.replace(/\.(wav|mp3|flac|m4a|ogg)$/i, '').replace(/[^a-zA-Z0-9_./-]/g, '_');
    const relOut = `${tierDir}/${relNoExt}.mp3`;
    const outAbs = path.join(outDir, relOut);
    await fs.mkdir(path.dirname(outAbs), { recursive: true });

    let needEncode = force || !existsSync(outAbs);
    if (!needEncode) {
      const existingStat = await fs.stat(outAbs).catch(() => null);
      if (!existingStat || existingStat.size < 128) needEncode = true;
    }

    let loudAudit = null;
    if (!needEncode) {
      const tier = classifyAudioLoudnessTier(item, { duration: realDuration });
      const variantOffsetDb = computeVariantLoudnessOffsetDb(`${item.relDir || ''}/${item.name}`);
      let postStats = await measureAudioFileVolume(ffmpegBin, outAbs, tier.mode === 'loudnorm' ? '' : SILENCE_TRIM_FILTER);
      if (postStats.meanDb === null && postStats.maxDb === null) {
        postStats = await measureAudioFileVolume(ffmpegBin, outAbs, '');
      }
      if ((postStats.meanDb === null && postStats.maxDb === null) || Number(postStats.maxDb) > -0.5) {
        needEncode = true;
      } else {
        const measuredDb = postStats.meanDb ?? (tier.targetDb + variantOffsetDb);
        const peakDb = postStats.maxDb ?? tier.ceilingDb;
        loudAudit = {
          loudnessTier: tier.id,
          bus: tier.bus,
          targetDb: Number((tier.targetDb + variantOffsetDb).toFixed(2)),
          ceilingDb: tier.ceilingDb,
          variantOffsetDb,
          algorithm: realDuration >= 1.5 || tier.mode === 'loudnorm' ? 'loudnorm_2pass' : 'active_rms_limiter',
          rawBeforeDb: features.rms > 0 ? Number((20 * Math.log10(features.rms)).toFixed(2)) : null,
          rawBeforePeakDb: features.peak > 0 ? Number((20 * Math.log10(features.peak)).toFixed(2)) : null,
          measuredDb: Number(measuredDb.toFixed(2)),
          peakDb: Number(peakDb.toFixed(2)),
          appliedGainDb: Number(((measuredDb - (features.rms > 0 ? 20 * Math.log10(features.rms) : measuredDb))).toFixed(2)),
          hitBoostCap: false,
          peakClamped: false,
          clippingAlert: false,
        };
      }
    }
    if (needEncode) {
      try {
        loudAudit = await normalizeAndEncodeAudioFile({
          srcAbs,
          outAbs,
          item,
          duration: realDuration,
          ffmpegBin,
        });
      } catch (err) {
        trackErrors.push({ id: item.id, err: String(err?.message || err).slice(0, 200) });
        return;
      }
    }

    const outStat = await fs.stat(outAbs);
    const { cueKey, fullKey, isExtendedFootstep } = extractSemanticCueKey(item.name, { pack: item.pack, relDir: item.relDir });

    const rec = {
      id: item.id,
      pack: item.pack,
      name: item.name,
      relDir: item.relDir,
      cueKey: fullKey,
      shortCueKey: cueKey,
      isExtendedFootstep,
      preload: isStream ? 'stream' : 'buffer',
      format: 'mp3',
      sampleRate: 44100,
      channels: isStream ? 2 : 1,
      bitrateKbps: isStream ? 96 : 64,
      duration: Number(realDuration.toFixed(4)),
      activeDuration: Number((features.activeDuration || realDuration).toFixed(4)),
      peak: Number((features.peak || 0).toFixed(4)),
      rms: Number((features.rms || 0).toFixed(4)),
      spectralCentroidHz: features.spectralCentroidHz || 0,
      loudnessTier: loudAudit.loudnessTier,
      bus: loudAudit.bus,
      targetDb: loudAudit.targetDb,
      measuredDb: loudAudit.measuredDb,
      peakDb: loudAudit.peakDb,
      appliedGainDb: loudAudit.appliedGainDb,
      hitBoostCap: loudAudit.hitBoostCap,
      peakClamped: loudAudit.peakClamped,
      clippingAlert: loudAudit.clippingAlert,
      rawBeforeDb: loudAudit.rawBeforeDb,
      rawBeforePeakDb: loudAudit.rawBeforePeakDb,
      rawBytes: rawStat.size,
      encodedBytes: outStat.size,
      relOut,
      url: `${baseUrl}/${relOut}`,
    };
    processed[idx] = rec;

    const ps = packStats.get(item.pack) || { pack: item.pack, totalCount: 0, sfxCount: 0, streamCount: 0, rawBytes: 0, encodedBytes: 0 };
    ps.totalCount++;
    if (isStream) ps.streamCount++; else ps.sfxCount++;
    ps.rawBytes += rawStat.size;
    ps.encodedBytes += outStat.size;
    packStats.set(item.pack, ps);
  });

  const validProcessed = processed.filter(Boolean);
  const sfxItems = validProcessed.filter((x) => x.preload === 'buffer');
  const streamItems = validProcessed.filter((x) => x.preload === 'stream');

  // Group short SFX into semantic cues & apply quantile selection (max 4 variants per cue)
  const cueGroups = new Map();
  for (const it of sfxItems) {
    if (!cueGroups.has(it.cueKey)) cueGroups.set(it.cueKey, []);
    cueGroups.get(it.cueKey).push(it);
  }

  const runtimeCues = [];
  for (const [cueName, group] of cueGroups.entries()) {
    const { selected } = selectQuantileVariants(group, { minKeep: Math.min(3, group.length), maxKeep: 4 });
    if (!selected.length) continue;
    const meanNums = selected.map((v) => v.measuredDb).filter((x) => Number.isFinite(x));
    const peakNums = selected.map((v) => v.peakDb).filter((x) => Number.isFinite(x));
    const gainNums = selected.map((v) => v.appliedGainDb).filter((x) => Number.isFinite(x));
    runtimeCues.push({
      cueName,
      pack: group[0].pack,
      category: group[0].isExtendedFootstep ? 'footstep_extended' : 'sfx',
      bus: selected[0].bus || 'combat',
      loudnessTier: selected[0].loudnessTier || 'sfx_combat_light',
      measuredDb: meanNums.length ? Number((meanNums.reduce((a, b) => a + b, 0) / meanNums.length).toFixed(2)) : null,
      peakDb: peakNums.length ? Number(Math.max(...peakNums).toFixed(2)) : null,
      appliedGainDb: gainNums.length ? Number((gainNums.reduce((a, b) => a + b, 0) / gainNums.length).toFixed(2)) : 0,
      gainDb: 0,
      preload: 'buffer',
      totalSourceVariants: group.length,
      variants: selected.map((v) => ({
        id: v.id,
        url: v.url,
        path: v.relOut,
        duration: v.duration,
        activeDuration: v.activeDuration,
        peak: v.peak,
        measuredDb: v.measuredDb ?? null,
        peakDb: v.peakDb ?? null,
        appliedGainDb: v.appliedGainDb ?? 0,
        spectralCentroidHz: v.spectralCentroidHz,
      })),
    });
  }
  runtimeCues.sort((a, b) => a.cueName.localeCompare(b.cueName));

  // Guarantee 10 surfaceType step_<surface> and impact_<surface> cues
  const { surfaceCues, coverage } = buildSurfaceTypeCueMap(runtimeCues, sfxItems);
  const allRuntimeCues = [...surfaceCues, ...runtimeCues];

  // Auto-align any cue whose selected variants exceed 2.5 dB RMS spread (converges shared & native cues cleanly)
  const syncCueMetrics = (cue) => {
    const meanNums = cue.variants.map((v) => v.measuredDb).filter((x) => Number.isFinite(x));
    const peakNums = cue.variants.map((v) => v.peakDb).filter((x) => Number.isFinite(x));
    const gainNums = cue.variants.map((v) => v.appliedGainDb).filter((x) => Number.isFinite(x));
    cue.measuredDb = meanNums.length ? Number((meanNums.reduce((a, b) => a + b, 0) / meanNums.length).toFixed(2)) : null;
    cue.peakDb = peakNums.length ? Number(Math.max(...peakNums).toFixed(2)) : null;
    if (gainNums.length) cue.appliedGainDb = Number((gainNums.reduce((a, b) => a + b, 0) / gainNums.length).toFixed(2));
  };
  const sfxById = new Map(sfxItems.map((it) => [it.id, it]));
  const variantsById = new Map();
  for (const cue of allRuntimeCues) {
    for (const v of cue.variants) {
      if (!variantsById.has(v.id)) variantsById.set(v.id, []);
      variantsById.get(v.id).push({ cue, v });
    }
  }
  const adjustVariantRms = async (v, deltaDb) => {
    const rec = sfxById.get(v.id);
    if (!rec) return false;
    const outAbs = path.join(outDir, rec.relOut);
    if (!existsSync(outAbs)) return false;
    const ceilDb = -1.8;
    const ceilLin = Number(Math.pow(10, ceilDb / 20).toFixed(6));
    const tmpOut = `${outAbs}.rmsalign.mp3`;
    const af = [
      'aresample=44100',
      'aformat=sample_fmts=fltp:channel_layouts=mono',
      `volume=${deltaDb.toFixed(2)}dB`,
      `alimiter=limit=${ceilLin}:attack=2:release=50:level=disabled`,
    ].join(',');
    const enc = await runFfmpegAsync(ffmpegBin, ['-y', '-v', 'error', '-i', outAbs, '-af', af, '-c:a', 'libmp3lame', '-b:a', '64k', tmpOut]);
    if (enc.code !== 0) {
      await fs.rm(tmpOut, { force: true }).catch(() => {});
      return false;
    }
    await fs.rename(tmpOut, outAbs);
    let post = await measureAudioFileVolume(ffmpegBin, outAbs, SILENCE_TRIM_FILTER);
    if (post.maxDb !== null && post.maxDb > -0.6) {
      const cutDb = -((post.maxDb - (-0.8)) + 0.6);
      const cutLin = Number(Math.pow(10, -2.0 / 20).toFixed(6));
      const re = await runFfmpegAsync(ffmpegBin, ['-y', '-v', 'error', '-i', outAbs, '-af', `aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono,volume=${cutDb.toFixed(2)}dB,alimiter=limit=${cutLin}:attack=2:release=50:level=disabled`, '-c:a', 'libmp3lame', '-b:a', '64k', tmpOut]);
      if (re.code === 0) {
        await fs.rename(tmpOut, outAbs);
        post = await measureAudioFileVolume(ffmpegBin, outAbs, SILENCE_TRIM_FILTER);
      } else {
        await fs.rm(tmpOut, { force: true }).catch(() => {});
      }
    }
    const newDb = Number((post.meanDb ?? (v.measuredDb + deltaDb)).toFixed(2));
    const newPeak = Number((post.maxDb ?? v.peakDb ?? -1.0).toFixed(2));
    const appliedShift = Number((newDb - (v.measuredDb ?? newDb)).toFixed(2));
    const newStat = await fs.stat(outAbs).catch(() => null);
    rec.measuredDb = newDb;
    rec.peakDb = newPeak;
    rec.appliedGainDb = Number(((rec.appliedGainDb ?? 0) + appliedShift).toFixed(2));
    if (newStat) rec.encodedBytes = newStat.size;
    rec.clippingAlert = newPeak > -0.5;
    for (const ref of variantsById.get(v.id) || []) {
      ref.v.measuredDb = newDb;
      ref.v.peakDb = newPeak;
      ref.v.appliedGainDb = rec.appliedGainDb;
      syncCueMetrics(ref.cue);
    }
    return true;
  };

  for (let pass = 0; pass < 3; pass++) {
    const alertCues = allRuntimeCues.filter((cue) => {
      const vals = cue.variants.map((v) => v.measuredDb).filter((x) => Number.isFinite(x));
      return vals.length >= 2 && (Math.max(...vals) - Math.min(...vals)) > 2.4;
    });
    if (alertCues.length === 0) break;
    let changedInPass = false;
    for (const cue of alertCues) {
      const curVals = cue.variants.map((v) => v.measuredDb).filter((x) => Number.isFinite(x));
      if (curVals.length < 2 || (Math.max(...curVals) - Math.min(...curVals)) <= 2.4) continue;
      const sorted = [...curVals].sort((a, b) => a - b);
      const medDb = sorted[Math.floor(sorted.length / 2)];
      const maxDb = sorted[sorted.length - 1];
      const anchorHigh = Math.min(maxDb, medDb + 0.5);
      // 1) Lift unusually quiet variants toward group median with limiter protection
      for (const v of cue.variants) {
        if (!Number.isFinite(v.measuredDb)) continue;
        if (v.measuredDb < anchorHigh - 2.0) {
          const boostDb = clamp((anchorHigh - 1.1) - v.measuredDb, 0, 8.0);
          if (boostDb >= 0.4 && await adjustVariantRms(v, boostDb)) changedInPass = true;
        }
      }
      // 2) Trim any remaining high outliers down within 2.0 dB of the quietest variant
      const postVals = cue.variants.map((v) => v.measuredDb).filter((x) => Number.isFinite(x));
      const postMin = Math.min(...postVals);
      for (const v of cue.variants) {
        if (!Number.isFinite(v.measuredDb)) continue;
        if (v.measuredDb > postMin + 2.15) {
          const cutDb = clamp((postMin + 1.8) - v.measuredDb, -12.0, -0.35);
          if (await adjustVariantRms(v, cutDb)) changedInPass = true;
        }
      }
    }
    if (!changedInPass) break;
  }

  // Auto-audit loudness gates
  const clippingAlerts = validProcessed
    .filter((it) => Number(it.peakDb) > -0.5)
    .map((it) => ({ id: it.id, pack: it.pack, tier: it.loudnessTier, peakDb: it.peakDb, measuredDb: it.measuredDb }));
  const boostCapWarnings = validProcessed
    .filter((it) => it.hitBoostCap)
    .map((it) => ({ id: it.id, pack: it.pack, tier: it.loudnessTier, rawBeforeDb: it.rawBeforeDb, appliedGainDb: it.appliedGainDb, measuredDb: it.measuredDb }));
  const cueSpreadAlerts = [];
  for (const cue of allRuntimeCues) {
    const vals = cue.variants.map((v) => v.measuredDb).filter((x) => Number.isFinite(x));
    if (vals.length >= 2) {
      const spreadDb = Number((Math.max(...vals) - Math.min(...vals)).toFixed(2));
      if (spreadDb > 2.5) {
        cueSpreadAlerts.push({ cueName: cue.cueName, pack: cue.pack, tier: cue.loudnessTier, spreadDb, variantDbs: vals });
      }
    }
  }
  const loudnessReport = {
    version: '1.0.0',
    anchorLufs: -16.0,
    anchorCeilingDb: -1.0,
    generatedAt: new Date().toISOString(),
    totalTracksAudited: validProcessed.length,
    clippingAlertCount: clippingAlerts.length,
    boostCapWarningCount: boostCapWarnings.length,
    cueSpreadAlertCount: cueSpreadAlerts.length,
    clippingAlerts,
    boostCapWarnings,
    cueSpreadAlerts,
  };

  const packSummary = [...packStats.values()]
    .map((p) => ({
      ...p,
      rawMB: Number((p.rawBytes / 1048576).toFixed(2)),
      encodedMB: Number((p.encodedBytes / 1048576).toFixed(2)),
      compressionRatio: p.rawBytes > 0 ? Number((p.encodedBytes / p.rawBytes).toFixed(4)) : 0,
    }))
    .sort((a, b) => b.rawBytes - a.rawBytes);

  const totalRawBytes = packSummary.reduce((s, p) => s + p.rawBytes, 0);
  const totalEncodedBytes = packSummary.reduce((s, p) => s + p.encodedBytes, 0);
  const totalRuntimePreloadBytes = allRuntimeCues.reduce(
    (s, c) => s + c.variants.length * 16000,
    0,
  );
  const sfxOnlyBytes = sfxItems.reduce((s, x) => s + x.encodedBytes, 0);
  const streamOnlyBytes = streamItems.reduce((s, x) => s + x.encodedBytes, 0);

  const cueTable = {
    version: '1.0.0',
    format: 'mp3',
    preloadRule: 'buffer_only_sfx_under_4s',
    cueCount: allRuntimeCues.length,
    surfaceCueCount: surfaceCues.length,
    surfaceCoverage: coverage,
    streamTracksExcluded: streamItems.length,
    cues: allRuntimeCues,
  };

  const streamsTable = {
    version: '1.0.0',
    format: 'mp3',
    preload: 'stream',
    count: streamItems.length,
    totalBytes: streamOnlyBytes,
    streams: streamItems.map((s) => ({
      id: s.id,
      pack: s.pack,
      name: s.name,
      relDir: s.relDir,
      duration: s.duration,
      bitrateKbps: 96,
      channels: 2,
      preload: 'stream',
      bus: s.bus || 'bgm',
      loudnessTier: s.loudnessTier || 'bgm',
      measuredDb: s.measuredDb ?? null,
      peakDb: s.peakDb ?? null,
      appliedGainDb: s.appliedGainDb ?? 0,
      gainDb: 0,
      encodedBytes: s.encodedBytes,
      path: s.relOut,
      url: s.url,
    })),
  };

  const fullLibrary = {
    version: '1.0.0',
    excludeFromGameBuild: true,
    generatedAt: new Date().toISOString(),
    sourceStats: {
      skippedClassicZombie: sourceMeta.skippedClassicZombie || 0,
      skippedV10GermanUe: sourceMeta.skippedV10GermanUe || 0,
      skippedSoundCue: sourceMeta.skippedSoundCue || 0,
      dedupHorrorDropped,
      promotedMusicSkipped,
      dirtyVoiceSkipped,
      v10DirectWavs: v10Items.length,
      customSfxCount: customItems.length,
    },
    totals: {
      totalTracks: validProcessed.length,
      sfxCount: sfxItems.length,
      streamCount: streamItems.length,
      cueCount: allRuntimeCues.length,
      surfaceCoverage: coverage,
      rawBytes: totalRawBytes,
      rawMB: Number((totalRawBytes / 1048576).toFixed(2)),
      encodedBytes: totalEncodedBytes,
      encodedMB: Number((totalEncodedBytes / 1048576).toFixed(2)),
      sfxMB: Number((sfxOnlyBytes / 1048576).toFixed(2)),
      streamsMB: Number((streamOnlyBytes / 1048576).toFixed(2)),
      compressionRatio: totalRawBytes > 0 ? Number((totalEncodedBytes / totalRawBytes).toFixed(4)) : 0,
      trackErrorCount: trackErrors.length,
    },
    packs: packSummary,
    items: validProcessed,
  };

  await Promise.all([
    fs.writeFile(path.join(outDir, 'cue_table.json'), JSON.stringify(cueTable, null, 2)),
    fs.writeFile(path.join(outDir, 'streams_table.json'), JSON.stringify(streamsTable, null, 2)),
    fs.writeFile(path.join(outDir, 'audio_library_full.json'), JSON.stringify(fullLibrary, null, 2)),
    fs.writeFile(path.join(outDir, 'audio_loudness_report.json'), JSON.stringify(loudnessReport, null, 2)),
  ]);

  if (clippingAlerts.length > 0) {
    throw new Error(`Audio loudness audit blocked: ${clippingAlerts.length} track(s) exceeded -0.5 dBTP ceiling (e.g. ${clippingAlerts[0].id} peak=${clippingAlerts[0].peakDb} dBTP)`);
  }

  return {
    outDir,
    totals: fullLibrary.totals,
    sourceStats: fullLibrary.sourceStats,
    packs: packSummary,
    surfaceCoverage: coverage,
    loudnessSummary: {
      totalTracksAudited: loudnessReport.totalTracksAudited,
      clippingAlertCount: loudnessReport.clippingAlertCount,
      boostCapWarningCount: loudnessReport.boostCapWarningCount,
      cueSpreadAlertCount: loudnessReport.cueSpreadAlertCount,
    },
    trackErrors,
  };
}
