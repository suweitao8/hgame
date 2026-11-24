import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  computeSafeShortGainDb,
  measureAudioFileVolume,
  parseLoudnormJsonStderr,
  runFfmpegAsync,
  runPool,
} from './audio-library-pipeline.mjs';

export const MUSIC_PIPELINE_VERSION = '2.0.0';
const SUPPORTED_MUSIC_EXTS = new Set(['.wav', '.mp3', '.flac', '.m4a']);
const BGM_TARGET_LUFS = -19.0;
const BGM_TARGET_TP = -1.5;
const BGM_TARGET_LRA = 11;
const BGM_LUFS_TOLERANCE = 1.5;
const STINGER_TARGET_LUFS = -16.0;
const STINGER_TARGET_TP = -1.5;
const STINGER_TARGET_LRA = 9;
const DEFAULT_SILENCE_THRESHOLD_DB = -45;
const GUARD_FALLBACK_THRESHOLD_DB = -58;
const MICRO_FADE_IN_SEC = 0.02;
const MICRO_FADE_OUT_SEC = 0.05;
const PEAK_CEILING_GATE_DBTP = -0.5;
const TAIL_SILENCE_MAX_SEC = 0.3;
const STINGER_WARN_DURATION_SEC = 15.0;
const BGM_WARN_DURATION_SEC = 125.0;

function clamp(v, min, max) {
  return v < min ? min : (v > max ? max : v);
}

function round(v, digits = 4) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function sha1Buffer(buf) {
  return createHash('sha1').update(buf).digest('hex');
}

function sha1Text(str) {
  return createHash('sha1').update(String(str || ''), 'utf8').digest('hex');
}

/**
 * Resolves the default `audio_ai_staging` directory inside the repo audio source area.
 * @returns {string}
 */
export function resolveDefaultMusicStagingRoot() {
  if (process.env.HGAME_MUSIC_STAGING) {
    return path.resolve(process.env.HGAME_MUSIC_STAGING);
  }
  const canonical = path.resolve('webasset/hgame-assets-cn/raw/audio_ai_staging');
  const rootFallback = path.resolve('audio_ai_staging');
  if (existsSync(canonical)) return canonical;
  if (existsSync(rootFallback)) return rootFallback;
  return canonical;
}

/**
 * Infers standardized AI retrieval category from clean track name and kind.
 * @param {string} cleanName
 * @param {'bgm' | 'stinger'} kind
 * @returns {string}
 */
export function inferMusicCategory(cleanName, kind = 'bgm') {
  if (kind === 'stinger') return 'stinger';
  const s = String(cleanName || '').toLowerCase();
  if (/(^|_)(boss|climax_boss|raid|final_phase|nemesis)(_|$)/.test(s) && !/^emo_/.test(s)) return 'boss';
  if (/(^|_)(urgent|countdown|escape|crisis|panic|alert|final_zone)(_|$)/.test(s)) return 'urgent';
  if (/(^|_)(scifi|sci_fi|cyber|cyberpunk|synthwave|mech|space|neon|futuristic)(_|$)/.test(s)) return 'scifi';
  if (/(^|_)(ink|eastern|wuxia|xianxia|guzheng|bamboo|ancient|oriental)(_|$)/.test(s)) return 'ink';
  if (/(^|_)(arcade|chiptune|retro|8bit|16bit)(_|$)/.test(s)) return 'arcade';
  if (/(^|_)(battle|combat|fight|action|war|arena|rush|chase)(_|$)/.test(s)) return 'battle';
  if (/(^|_)(sweet|ambiguous|intimate|climax|afterglow|romance|date|love)(_|$)/.test(s)) return 'romance';
  if (/(^|_)(suspense|stealth|mystery|tense|dark_scheme|wrong_thoughts)(_|$)/.test(s)) return 'suspense';
  if (/(^|_)(daily|warm|bond|sad|melancholy|healing|emotional)(_|$)/.test(s)) return 'emotion';
  if (/(^|_)(puzzle|match|minigame)(_|$)/.test(s)) return 'puzzle';
  if (/(^|_)(result|victory|defeat|summary)(_|$)/.test(s)) return 'result';
  if (/(^|_)(lobby|title|menu|home|hub|town|camp|select)(_|$)/.test(s)) return 'lobby';
  if (/(^|_)(card|deck|shop|draft|tavern|gacha|upgrade)(_|$)/.test(s)) return 'card';
  if (/(^|_)(dungeon|crypt|cave|ruin|labyrinth|tomb|dark|horror|phobia|delirium|tartarus|collaps|collapse|desperation|wasteground|waste_ground|claustrophobia|pulsation|fog|smoke|diffuse|cloud)(_|$)/.test(s)) return 'dungeon';
  if (/(^|_)(explore|exploration|field|adventure|travel)(_|$)/.test(s)) return 'explore';
  if (/(^|_)(survival|cold|winter|night|storm|frost|wild|survivor|savior)(_|$)/.test(s)) return 'survival';
  if (/(^|_)(casual|cozy|farm|chill|garden|lofi|idle|relax)(_|$)/.test(s)) return 'casual';
  if (/(^|_)(comedy|fun|quirky|silly|goofy|cartoon)(_|$)/.test(s)) return 'comedy';
  if (/(^|_)(story|cutscene|drama|lore|ending|credits|narrative|sonata)(_|$)/.test(s)) return 'story';
  return 'bgm';
}

const VOICE_SPACE_CATEGORIES = new Set(['emotion', 'romance', 'suspense', 'comedy']);
export function shouldApplyVoiceSpaceEq(meta, override = null) {
  if (override && typeof override.voiceSpaceEq === 'boolean') {
    return override.voiceSpaceEq;
  }
  if (meta?.kind !== 'bgm') return false;
  return String(meta?.cleanName || '').startsWith('emo_') || VOICE_SPACE_CATEGORIES.has(meta?.category);
}

/**
 * Parses BPM suffix (`_<N>bpm`) and normalizes hierarchical Cue IDs & output paths:
 * - `universal/bgm/bgm_battle_fast_140bpm.wav` -> `bgm.universal.battle_fast`
 * - `games/ninja_king/bgm/bgm_boss_150bpm.wav` -> `bgm.ninja_king.boss`
 *
 * @param {string} filePathOrName
 * @param {object} [opts]
 * @param {'bgm' | 'stinger'} [opts.kind='bgm']
 * @param {string} [opts.scope='universal']
 * @param {string} [opts.relDir='']
 */
export function parseBgmFilenameMeta(filePathOrName, kindOrOpts = 'bgm', relDirArg = '') {
  const opts = typeof kindOrOpts === 'object' && kindOrOpts !== null
    ? kindOrOpts
    : { kind: kindOrOpts || 'bgm', scope: 'universal', relDir: relDirArg };
  const kind = opts.kind === 'stinger' ? 'stinger' : 'bgm';
  const scope = String(opts.scope || 'universal');
  const scopeSlug = scope.startsWith('game:') ? scope.slice(5) : 'universal';
  const relDir = String(opts.relDir || '').replaceAll('\\', '/').replace(/^\.?\/?|\/$/g, '');

  const baseName = path.basename(String(filePathOrName || ''), path.extname(String(filePathOrName || '')));
  const bpmMatch = baseName.match(/_(\d{2,3})bpm$/i);
  const parsedBpm = bpmMatch ? Number(bpmMatch[1]) : null;
  const bpm = Number.isFinite(parsedBpm) && parsedBpm >= 30 && parsedBpm <= 300 ? parsedBpm : null;

  const withoutBpm = bpmMatch ? baseName.slice(0, bpmMatch.index) : baseName;
  let core = withoutBpm.replace(/^(?:(?:bgm|stinger)[_.-]+)+/i, '');
  if (!core) core = withoutBpm;
  if (relDir && relDir !== '.') {
    core = `${relDir}/${core}`;
  }
  const cleanName = core
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'track';

  const cueId = `${kind}.${scopeSlug}.${cleanName}`;
  const outStem = `${kind}_${cleanName}`;
  const category = inferMusicCategory(cleanName, kind);

  return {
    rawBaseName: baseName,
    cleanName,
    bpm,
    kind,
    scope,
    scopeSlug,
    category,
    cueId,
    outStem,
  };
}

/**
 * Probes audio metadata (`duration`, `startTime` encoder delay, channels, sampleRate, bitRate).
 * @param {string} ffprobeBin
 * @param {string} filePath
 */
export async function probeAudioMetadata(ffprobeBin, filePath) {
  const res = await runFfmpegAsync(ffprobeBin, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  if (res.code !== 0) {
    throw new Error(`ffprobe failed for ${filePath}: ${res.stderr}`);
  }
  const parsed = JSON.parse(res.stdout.toString('utf8') || '{}');
  const stream = Array.isArray(parsed.streams) ? parsed.streams.find((s) => s.codec_type === 'audio') || parsed.streams[0] : null;
  const fmt = parsed.format || {};
  const duration = Number(stream?.duration ?? fmt.duration ?? 0);
  const startTime = Number(stream?.start_time ?? fmt.start_time ?? 0);
  return {
    duration: Number.isFinite(duration) ? duration : 0,
    startTime: Number.isFinite(startTime) && startTime > 0 ? startTime : 0,
    sampleRate: Number(stream?.sample_rate) || 44100,
    channels: Number(stream?.channels) || 2,
    bitRate: Number(stream?.bit_rate ?? fmt.bit_rate) || 0,
  };
}

/**
 * Parses `silencedetect` stderr and returns trailing silence duration (seconds) if silence touches EOF.
 * @param {string} stderr
 * @param {number} totalDurationSec
 */
export function parseTailSilenceSec(stderr = '', totalDurationSec = 0) {
  const text = String(stderr || '');
  const events = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/);
    if (startMatch) {
      events.push({ start: Number(startMatch[1]), end: null, duration: null });
      continue;
    }
    const endMatch = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
    if (endMatch && events.length > 0) {
      const last = events[events.length - 1];
      last.end = Number(endMatch[1]);
      last.duration = Number(endMatch[2]);
    }
  }
  if (events.length === 0) return 0;
  const last = events[events.length - 1];
  if (last.end === null) {
    return round(Math.max(0, totalDurationSec - last.start), 3);
  }
  if (totalDurationSec > 0 && Math.abs(totalDurationSec - last.end) <= 0.15) {
    return round(Math.max(0, last.duration || (last.end - last.start)), 3);
  }
  return 0;
}

async function detectTailSilenceSec(ffmpegBin, filePath, durationSec, thresholdDb = DEFAULT_SILENCE_THRESHOLD_DB) {
  const res = await runFfmpegAsync(ffmpegBin, [
    '-hide_banner', '-nostats', '-i', filePath,
    '-af', `silencedetect=noise=${thresholdDb}dB:d=${TAIL_SILENCE_MAX_SEC}`,
    '-f', 'null', '-',
  ]);
  return parseTailSilenceSec(res.stderr, durationSec);
}

async function auditEncodedLoudnormAndPeak(ffmpegBin, filePath, { targetI, targetTp, targetLra }) {
  const [volStats, lnRes] = await Promise.all([
    measureAudioFileVolume(ffmpegBin, filePath, ''),
    runFfmpegAsync(ffmpegBin, [
      '-hide_banner', '-nostats', '-i', filePath,
      '-af', `aformat=sample_fmts=fltp,loudnorm=I=${targetI.toFixed(1)}:TP=${targetTp.toFixed(1)}:LRA=${targetLra}:print_format=json`,
      '-f', 'null', '-',
    ]),
  ]);
  const ln = parseLoudnormJsonStderr(lnRes.stderr);
  const measuredLufs = ln?.inputI ?? volStats.meanDb ?? targetI;
  const peakCandidates = [volStats.maxDb, ln?.inputTp].filter((x) => Number.isFinite(x));
  const peakDb = peakCandidates.length ? Math.max(...peakCandidates) : targetTp;
  return {
    measuredLufs: round(measuredLufs, 2),
    peakDb: round(peakDb, 2),
  };
}

async function encodeTwoPassLoudnormMp3({
  srcPath,
  outPath,
  ffmpegBin,
  ffprobeBin,
  targetI,
  targetTp,
  targetLra,
  preFilter,
  tempDir = os.tmpdir(),
}) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const uid = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const normWav = path.join(tempDir, `hgame_ln_${uid}.wav`);
  const tailCleanWav = path.join(tempDir, `hgame_ln_tail_${uid}.wav`);

  const runWithTp = async (tpLimit) => {
    const p1Filter = `${preFilter},loudnorm=I=${targetI.toFixed(1)}:TP=${tpLimit.toFixed(1)}:LRA=${targetLra}:print_format=json`;
    const p1 = await runFfmpegAsync(ffmpegBin, ['-hide_banner', '-nostats', '-i', srcPath, '-af', p1Filter, '-f', 'null', '-']);
    const ln = parseLoudnormJsonStderr(p1.stderr);
    const p2Loudnorm = ln
      ? `loudnorm=I=${targetI.toFixed(1)}:TP=${tpLimit.toFixed(1)}:LRA=${targetLra}:measured_I=${ln.inputI.toFixed(2)}:measured_TP=${ln.inputTp.toFixed(2)}:measured_LRA=${ln.inputLra.toFixed(2)}:measured_thresh=${ln.inputThresh.toFixed(2)}:offset=${ln.targetOffset.toFixed(2)}:linear=true`
      : `loudnorm=I=${targetI.toFixed(1)}:TP=${tpLimit.toFixed(1)}:LRA=${targetLra}`;
    const p2Filter = `${preFilter},${p2Loudnorm}`;
    const normRes = await runFfmpegAsync(ffmpegBin, [
      '-y', '-v', 'error',
      '-i', srcPath,
      '-af', p2Filter,
      '-c:a', 'pcm_f32le',
      normWav,
    ]);
    if (normRes.code !== 0) {
      throw new Error(`ffmpeg loudnorm encode failed for ${path.basename(outPath)}: ${normRes.stderr}`);
    }

    // Re-trim trailing silence after loudnorm gain shift (at -43 dB RMS, slightly stricter than -45 dB QA gate)
    // so tracks attenuated down to -19 LUFS never trip EOF silence detection.
    const normProbe = await probeAudioMetadata(ffprobeBin, normWav);
    let finalSrcWav = normWav;
    let extraTailTrimmedSec = 0;
    const tailRes = await runFfmpegAsync(ffmpegBin, [
      '-y', '-v', 'error',
      '-i', normWav,
      '-af', 'areverse,silenceremove=start_periods=1:start_duration=0:start_threshold=-43dB:detection=rms,areverse',
      '-c:a', 'pcm_f32le',
      tailCleanWav,
    ]);
    if (tailRes.code === 0) {
      const cleanProbe = await probeAudioMetadata(ffprobeBin, tailCleanWav).catch(() => null);
      if (cleanProbe && cleanProbe.duration > Math.max(0.2, normProbe.duration * 0.5)) {
        finalSrcWav = tailCleanWav;
        extraTailTrimmedSec = round(Math.max(0, normProbe.duration - cleanProbe.duration), 4);
      }
    }

    const finalProbe = finalSrcWav === tailCleanWav
      ? await probeAudioMetadata(ffprobeBin, finalSrcWav)
      : normProbe;
    const fadeOut = Math.min(MICRO_FADE_OUT_SEC, finalProbe.duration * 0.25);
    const fadeOutStart = round(Math.max(0, finalProbe.duration - fadeOut), 4);

    const enc = await runFfmpegAsync(ffmpegBin, [
      '-y', '-v', 'error',
      '-i', finalSrcWav,
      '-af', `afade=t=out:st=${fadeOutStart}:d=${round(fadeOut, 4)}`,
      '-ac', '2',
      '-ar', '44100',
      '-c:a', 'libmp3lame',
      '-b:a', '96k',
      outPath,
    ]);
    if (enc.code !== 0) {
      throw new Error(`ffmpeg mp3 encode failed for ${path.basename(outPath)}: ${enc.stderr}`);
    }
    const audit = await auditEncodedLoudnormAndPeak(ffmpegBin, outPath, { targetI, targetTp, targetLra });
    return { ...audit, extraTailTrimmedSec };
  };

  try {
    let tpLimit = targetTp;
    let audit = await runWithTp(tpLimit);
    for (let retry = 0; retry < 2 && audit.peakDb > -0.8; retry++) {
      tpLimit -= Math.max(0.6, audit.peakDb - (-1.2));
      audit = await runWithTp(tpLimit);
    }
    return audit;
  } finally {
    await fs.rm(normWav, { force: true }).catch(() => {});
    await fs.rm(tailCleanWav, { force: true }).catch(() => {});
  }
}

/**
 * Safely trims ONLY leading and trailing silence using bidirectional `start_periods=1` + `areverse`
 * (never uses forward `stop_periods`, so mid-track pauses/quiet passages are 100% preserved).
 * Enforces an anti-over-trim guard for long BGM tracks (`>= 20s`).
 */
async function trimHeadTailSilenceSafely({
  srcAbs,
  outTrimWav,
  kind,
  originalDurationSec,
  thresholdDb,
  ffmpegBin,
  ffprobeBin,
  tempDir,
}) {
  const uid = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const headWav = path.join(tempDir, `hgame_head_${uid}.wav`);
  const basePrefix = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo';

  const runDirectionalTrim = async (threshDb) => {
    const leadFilter = `${basePrefix},silenceremove=start_periods=1:start_duration=0:start_threshold=${threshDb}dB:detection=peak`;
    const r1 = await runFfmpegAsync(ffmpegBin, ['-y', '-v', 'error', '-i', srcAbs, '-af', leadFilter, '-c:a', 'pcm_f32le', headWav]);
    if (r1.code !== 0) return null;
    const headProbe = await probeAudioMetadata(ffprobeBin, headWav).catch(() => null);
    if (!headProbe || !(headProbe.duration > 0.02)) return null;

    const tailFilter = `areverse,silenceremove=start_periods=1:start_duration=0:start_threshold=${threshDb}dB:detection=peak,areverse`;
    const r2 = await runFfmpegAsync(ffmpegBin, ['-y', '-v', 'error', '-i', headWav, '-af', tailFilter, '-c:a', 'pcm_f32le', outTrimWav]);
    if (r2.code !== 0) return null;
    const tailProbe = await probeAudioMetadata(ffprobeBin, outTrimWav).catch(() => null);
    if (!tailProbe || !(tailProbe.duration > 0.02)) return null;

    const trimmedLeadSec = round(Math.max(0, originalDurationSec - headProbe.duration), 4);
    const trimmedTailSec = round(Math.max(0, headProbe.duration - tailProbe.duration), 4);
    return {
      trimmedDurationSec: tailProbe.duration,
      trimmedLeadSec,
      trimmedTailSec,
      usedThresholdDb: threshDb,
    };
  };

  try {
    let result = await runDirectionalTrim(thresholdDb);
    let trimGuardTriggered = false;
    const minSafeBgmDur = Math.max(10, originalDurationSec * 0.45);

    if (kind === 'bgm' && originalDurationSec >= 20 && (!result || result.trimmedDurationSec < minSafeBgmDur)) {
      trimGuardTriggered = true;
      const relaxed = await runDirectionalTrim(GUARD_FALLBACK_THRESHOLD_DB);
      if (relaxed && relaxed.trimmedDurationSec >= minSafeBgmDur) {
        result = relaxed;
      } else {
        // Fallback: preserve full original audio rather than risking over-trimming
        const passthrough = await runFfmpegAsync(ffmpegBin, [
          '-y', '-v', 'error', '-i', srcAbs, '-af', basePrefix, '-c:a', 'pcm_f32le', outTrimWav,
        ]);
        if (passthrough.code !== 0) {
          throw new Error(`ffmpeg passthrough fallback failed for ${path.basename(srcAbs)}: ${passthrough.stderr}`);
        }
        result = {
          trimmedDurationSec: originalDurationSec,
          trimmedLeadSec: 0,
          trimmedTailSec: 0,
          usedThresholdDb: null,
        };
      }
    } else if (!result) {
      const passthrough = await runFfmpegAsync(ffmpegBin, [
        '-y', '-v', 'error', '-i', srcAbs, '-af', basePrefix, '-c:a', 'pcm_f32le', outTrimWav,
      ]);
      if (passthrough.code !== 0) {
        throw new Error(`ffmpeg passthrough fallback failed for ${path.basename(srcAbs)}: ${passthrough.stderr}`);
      }
      result = {
        trimmedDurationSec: originalDurationSec,
        trimmedLeadSec: 0,
        trimmedTailSec: 0,
        usedThresholdDb: null,
      };
    }

    return { ...result, trimGuardTriggered };
  } finally {
    await fs.rm(headWav, { force: true }).catch(() => {});
  }
}

/**
 * Processes one music track (`bgm` or `stinger`) without ever truncating musical content:
 * bidirectional head/tail silence trim -> anti-over-trim guard -> 0.02s/0.05s micro anti-click fades ->
 * loudness normalization & 96k stereo MP3 encode -> ffprobe delay + tail silence check.
 */
export async function processMusicTrack({
  srcAbs,
  outAbs,
  meta,
  override = null,
  baseUrl = '/assets/cn/audio',
  relOut,
  ffmpegBin = 'ffmpeg',
  ffprobeBin = 'ffprobe',
  tempDir = os.tmpdir(),
} = {}) {
  const srcProbe = await probeAudioMetadata(ffprobeBin, srcAbs);
  const originalDurationSec = round(srcProbe.duration, 4);
  const thresholdDb = Number.isFinite(Number(override?.silenceThresholdDb))
    ? Number(override.silenceThresholdDb)
    : DEFAULT_SILENCE_THRESHOLD_DB;

  const uid = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const trimmedWav = path.join(tempDir, `hgame_music_trimmed_${uid}.wav`);
  const basePrefix = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo';

  try {
    const trimInfo = await trimHeadTailSilenceSafely({
      srcAbs,
      outTrimWav: trimmedWav,
      kind: meta.kind,
      originalDurationSec,
      thresholdDb,
      ffmpegBin,
      ffprobeBin,
      tempDir,
    });

    const segDur = trimInfo.trimmedDurationSec;
    const fadeIn = Math.min(MICRO_FADE_IN_SEC, segDur * 0.2);
    const fadeOut = Math.min(MICRO_FADE_OUT_SEC, segDur * 0.25);
    const fadeOutStart = round(Math.max(0, segDur - fadeOut), 4);
    const microFadeInOnly = `afade=t=in:st=0:d=${round(fadeIn, 4)}`;
    const microFadeFilter = `${microFadeInOnly},afade=t=out:st=${fadeOutStart}:d=${round(fadeOut, 4)}`;
    const voiceSpaceEq = shouldApplyVoiceSpaceEq(meta, override);
    const eqFilter = voiceSpaceEq ? ',equalizer=f=2800:t=q:w=1.2:g=-2.5' : '';

    let audit;
    if (meta.kind === 'bgm') {
      const preFilter = `${basePrefix},${microFadeInOnly},highpass=f=30${eqFilter}`;
      audit = await encodeTwoPassLoudnormMp3({
        srcPath: trimmedWav,
        outPath: outAbs,
        ffmpegBin,
        ffprobeBin,
        targetI: BGM_TARGET_LUFS,
        targetTp: BGM_TARGET_TP,
        targetLra: BGM_TARGET_LRA,
        preFilter,
        tempDir,
      });
    } else if (segDur >= 1.5) {
      const preFilter = `${basePrefix},${microFadeInOnly},highpass=f=30${eqFilter}`;
      audit = await encodeTwoPassLoudnormMp3({
        srcPath: trimmedWav,
        outPath: outAbs,
        ffmpegBin,
        ffprobeBin,
        targetI: STINGER_TARGET_LUFS,
        targetTp: STINGER_TARGET_TP,
        targetLra: STINGER_TARGET_LRA,
        preFilter,
        tempDir,
      });
    } else {
      await fs.mkdir(path.dirname(outAbs), { recursive: true });
      const stats = await measureAudioFileVolume(ffmpegBin, trimmedWav, '');
      const gainInfo = computeSafeShortGainDb({
        targetDb: STINGER_TARGET_LUFS,
        variantOffsetDb: 0,
        meanVolumeDb: stats.meanDb,
        maxVolumeDb: stats.maxDb,
        ceilingDb: STINGER_TARGET_TP,
      });
      let ceilDb = STINGER_TARGET_TP - 0.6;
      for (let retry = 0; retry < 3; retry++) {
        const ceilLin = Number(Math.pow(10, ceilDb / 20).toFixed(6));
        const enc = await runFfmpegAsync(ffmpegBin, [
          '-y', '-v', 'error',
          '-i', trimmedWav,
          '-af', `${basePrefix},${microFadeFilter},highpass=f=30${eqFilter},volume=${gainInfo.gainDb.toFixed(2)}dB,alimiter=limit=${ceilLin}:attack=2:release=50:level=disabled`,
          '-ac', '2',
          '-ar', '44100',
          '-c:a', 'libmp3lame',
          '-b:a', '96k',
          outAbs,
        ]);
        if (enc.code !== 0) {
          throw new Error(`ffmpeg stinger short encode failed for ${path.basename(srcAbs)}: ${enc.stderr}`);
        }
        const post = await measureAudioFileVolume(ffmpegBin, outAbs, '');
        const peakDb = round(post.maxDb ?? STINGER_TARGET_TP, 2);
        const measuredLufs = round(post.meanDb ?? STINGER_TARGET_LUFS, 2);
        audit = { measuredLufs, peakDb, extraTailTrimmedSec: 0 };
        if (peakDb <= -0.8) break;
        ceilDb -= Math.max(0.6, peakDb - (-1.2));
      }
    }

    const outProbe = await probeAudioMetadata(ffprobeBin, outAbs);
    const outStat = await fs.stat(outAbs);
    const durationSec = round(outProbe.duration > 0 ? outProbe.duration : segDur, 4);
    const trimStartSec = round(outProbe.startTime > 0 ? outProbe.startTime : 0.026, 6);
    const trimEndSec = round(trimStartSec + durationSec, 6);
    const sizeKb = round(outStat.size / 1024, 2);
    const tailSilenceSec = await detectTailSilenceSec(ffmpegBin, outAbs, durationSec);

    const isBgm = meta.kind === 'bgm';
    const lufsWarn = isBgm && Math.abs(audit.measuredLufs - BGM_TARGET_LUFS) > BGM_LUFS_TOLERANCE;
    const stingerOver15sWarning = !isBgm && durationSec > STINGER_WARN_DURATION_SEC;

    return {
      cueName: meta.cueId,
      scope: meta.scope,
      kind: meta.kind,
      category: meta.category,
      pack: isBgm ? 'bgm' : 'stinger',
      url: `${baseUrl}/${relOut}`,
      path: relOut,
      bus: isBgm ? 'bgm' : 'ui_voice',
      loudnessTier: isBgm ? 'bgm' : 'ui_voice',
      preload: isBgm ? 'stream' : 'buffer',
      loop: isBgm,
      ducking: !isBgm,
      bpm: meta.bpm,
      originalDurationSec,
      durationSec,
      trimmedLeadSec: trimInfo.trimmedLeadSec,
      trimmedTailSec: round(trimInfo.trimmedTailSec + (audit.extraTailTrimmedSec || 0), 4),
      trimStartSec,
      trimEndSec,
      tailSilenceSec,
      measuredLufs: audit.measuredLufs,
      measuredDb: audit.measuredLufs,
      peakDb: audit.peakDb,
      sizeKb,
      encodedBytes: outStat.size,
      gainDb: Number(override?.gainDb ?? 0),
      voiceSpaceEq,
      lufsWarn,
      trimGuardTriggered: trimInfo.trimGuardTriggered,
      stingerOver15sWarning,
      variants: [
        {
          id: meta.cueId,
          url: `${baseUrl}/${relOut}`,
          path: relOut,
          duration: durationSec,
          activeDuration: durationSec,
          measuredDb: audit.measuredLufs,
          peakDb: audit.peakDb,
          appliedGainDb: 0,
        },
      ],
    };
  } finally {
    await fs.rm(trimmedWav, { force: true }).catch(() => {});
  }
}

async function scanAudioFilesRecursive(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  async function walk(cur) {
    const entries = await fs.readdir(cur, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (SUPPORTED_MUSIC_EXTS.has(ext)) {
          results.push(full);
        }
      }
    }
  }
  await walk(dir);
  results.sort((a, b) => a.localeCompare(b));
  return results;
}

/**
 * Discovers all staged tracks across:
 * - `universal/bgm/**` and `universal/stinger/**`
 * - `games/<gameSlug>/bgm/**` and `games/<gameSlug>/stinger/**`
 */
async function scanMusicStagingJobs(musicStagingRoot) {
  const jobs = [];
  const addTree = async (baseDir, scope, scopeDir, kind) => {
    const files = await scanAudioFilesRecursive(baseDir);
    for (const srcAbs of files) {
      const relDir = path.dirname(path.relative(baseDir, srcAbs));
      const meta = parseBgmFilenameMeta(srcAbs, {
        kind,
        scope,
        relDir: relDir === '.' ? '' : relDir,
      });
      const relOut = kind === 'bgm'
        ? `streams/bgm/${scopeDir}/${meta.outStem}.mp3`
        : `sfx/stinger/${scopeDir}/${meta.outStem}.mp3`;
      jobs.push({ srcAbs, meta, relOut, scopeDir });
    }
  };

  await addTree(path.join(musicStagingRoot, 'universal', 'bgm'), 'universal', 'universal', 'bgm');
  await addTree(path.join(musicStagingRoot, 'universal', 'stinger'), 'universal', 'universal', 'stinger');

  const gamesRoot = path.join(musicStagingRoot, 'games');
  if (existsSync(gamesRoot)) {
    const gameDirs = await fs.readdir(gamesRoot, { withFileTypes: true });
    for (const ent of gameDirs) {
      if (!ent.isDirectory()) continue;
      const gameSlug = ent.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || ent.name;
      const scope = `game:${gameSlug}`;
      await addTree(path.join(gamesRoot, ent.name, 'bgm'), scope, gameSlug, 'bgm');
      await addTree(path.join(gamesRoot, ent.name, 'stinger'), scope, gameSlug, 'stinger');
    }
  }

  return jobs;
}

function lookupOverride(overridesMap, meta, filePath) {
  if (!overridesMap || typeof overridesMap !== 'object') return null;
  const baseWithExt = path.basename(filePath);
  return overridesMap[meta.cueId]
    || overridesMap[meta.rawBaseName]
    || overridesMap[meta.outStem]
    || overridesMap[baseWithExt]
    || null;
}

export function evaluateMusicGate(bgmTracks, stingerTracks) {
  const alerts = [];
  for (const t of [...bgmTracks, ...stingerTracks]) {
    if (Number(t.peakDb) > PEAK_CEILING_GATE_DBTP) {
      alerts.push({
        cueName: t.cueName,
        kind: t.kind || t.category,
        reason: 'peak_above_ceiling',
        peakDb: t.peakDb,
        ceilingDb: PEAK_CEILING_GATE_DBTP,
      });
    }
    if (Number(t.tailSilenceSec) > TAIL_SILENCE_MAX_SEC) {
      alerts.push({
        cueName: t.cueName,
        kind: t.kind || t.category,
        reason: 'tail_silence_detected',
        tailSilenceSec: t.tailSilenceSec,
        maxAllowedSec: TAIL_SILENCE_MAX_SEC,
      });
    }
  }
  return alerts;
}

/**
 * Processes `audio_ai_staging/universal/**` and `audio_ai_staging/games/<slug>/**`
 * with SHA-1 incremental caching (`.music_cache.json`), writes standalone
 * `music_table.json`, `music-ai-index.json`, and `music_report.json`
 * (never polluting SFX `cue_table.json` or `streams_table.json`).
 */
export async function processMusicLibrary({
  musicStagingRoot = resolveDefaultMusicStagingRoot(),
  outDir = path.resolve('webasset/hgame-assets-cn/built/audio'),
  baseUrl = '/assets/cn/audio',
  ffmpegBin = 'ffmpeg',
  ffprobeBin = 'ffprobe',
  concurrency = Math.min(4, Math.max(1, os.cpus().length - 2)),
  force = false,
} = {}) {
  const overridesPath = path.join(musicStagingRoot, 'bgm_overrides.json');
  let overridesMap = {};
  if (existsSync(overridesPath)) {
    overridesMap = JSON.parse(await fs.readFile(overridesPath, 'utf8'));
  }

  const cachePath = path.join(outDir, '.music_cache.json');
  let prevCache = { version: MUSIC_PIPELINE_VERSION, entries: {} };
  if (!force && existsSync(cachePath)) {
    try {
      const parsed = JSON.parse(await fs.readFile(cachePath, 'utf8'));
      if (parsed?.version === MUSIC_PIPELINE_VERSION && parsed.entries && typeof parsed.entries === 'object') {
        prevCache = parsed;
      }
    } catch { /* ignore corrupt cache */ }
  }

  const jobs = await scanMusicStagingJobs(musicStagingRoot);
  await fs.mkdir(outDir, { recursive: true });

  const results = new Array(jobs.length);
  const nextCacheEntries = {};
  let cacheHits = 0;
  let cacheMisses = 0;

  await runPool(jobs, concurrency, async (job, idx) => {
    const { srcAbs, meta, relOut } = job;
    const outAbs = path.join(outDir, relOut);
    const override = lookupOverride(overridesMap, meta, srcAbs);
    const srcBuf = await fs.readFile(srcAbs);
    const srcSha1 = sha1Buffer(srcBuf);
    const overrideHash = sha1Text(JSON.stringify(override || null));
    const cacheKey = `${meta.cueId}::${relOut}`;
    const cached = prevCache.entries?.[cacheKey];

    if (
      !force
      && cached
      && cached.srcSha1 === srcSha1
      && cached.overrideHash === overrideHash
      && cached.baseUrl === baseUrl
      && existsSync(outAbs)
      && cached.track
    ) {
      cacheHits++;
      results[idx] = cached.track;
      nextCacheEntries[cacheKey] = cached;
      return;
    }

    cacheMisses++;
    const track = await processMusicTrack({
      srcAbs,
      outAbs,
      meta,
      override,
      baseUrl,
      relOut,
      ffmpegBin,
      ffprobeBin,
    });
    results[idx] = track;
    nextCacheEntries[cacheKey] = {
      srcSha1,
      overrideHash,
      baseUrl,
      relOut,
      track,
    };
  });

  const allTracks = results.filter(Boolean).sort((a, b) => a.cueName.localeCompare(b.cueName));
  const bgmTracks = allTracks.filter((t) => t.kind === 'bgm');
  const stingerTracks = allTracks.filter((t) => t.kind === 'stinger');

  const alerts = evaluateMusicGate(bgmTracks, stingerTracks);
  const lufsWarnings = bgmTracks
    .filter((t) => t.lufsWarn)
    .map((t) => ({
      cueName: t.cueName,
      measuredLufs: t.measuredLufs,
      targetLufs: BGM_TARGET_LUFS,
      toleranceLufs: BGM_LUFS_TOLERANCE,
    }));
  const trimGuardWarnings = allTracks
    .filter((t) => t.trimGuardTriggered)
    .map((t) => ({ cueName: t.cueName, originalDurationSec: t.originalDurationSec, durationSec: t.durationSec }));
  const stingerLongWarnings = stingerTracks
    .filter((t) => t.stingerOver15sWarning)
    .map((t) => ({ cueName: t.cueName, durationSec: t.durationSec, hint: 'Stinger > 15s; confirm not misplaced BGM' }));
  const bgmLongWarnings = bgmTracks
    .filter((t) => Number(t.durationSec) > BGM_WARN_DURATION_SEC)
    .map((t) => ({ cueName: t.cueName, durationSec: t.durationSec, hint: 'BGM > 125s; consider <= 120s for mini-game bundle size' }));

  const report = {
    version: MUSIC_PIPELINE_VERSION,
    generatedAt: new Date().toISOString(),
    stagingRoot: musicStagingRoot,
    bgmTargetLufs: BGM_TARGET_LUFS,
    bgmToleranceLufs: BGM_LUFS_TOLERANCE,
    stingerTargetLufs: STINGER_TARGET_LUFS,
    peakCeilingDbTp: PEAK_CEILING_GATE_DBTP,
    tailSilenceMaxSec: TAIL_SILENCE_MAX_SEC,
    bgmMaxDurationWarnSec: BGM_WARN_DURATION_SEC,
    totalTracks: allTracks.length,
    bgmCount: bgmTracks.length,
    stingerCount: stingerTracks.length,
    cacheHits,
    cacheMisses,
    passed: alerts.length === 0,
    alertCount: alerts.length,
    lufsWarningCount: lufsWarnings.length,
    trimGuardWarningCount: trimGuardWarnings.length,
    stingerLongWarningCount: stingerLongWarnings.length,
    bgmLongWarningCount: bgmLongWarnings.length,
    alerts,
    lufsWarnings,
    trimGuardWarnings,
    stingerLongWarnings,
    bgmLongWarnings,
    bgm: bgmTracks.map((t) => ({
      cueName: t.cueName,
      scope: t.scope,
      category: t.category,
      bpm: t.bpm,
      originalDurationSec: t.originalDurationSec,
      durationSec: t.durationSec,
      trimmedLeadSec: t.trimmedLeadSec,
      trimmedTailSec: t.trimmedTailSec,
      trimStartSec: t.trimStartSec,
      trimEndSec: t.trimEndSec,
      tailSilenceSec: t.tailSilenceSec,
      measuredLufs: t.measuredLufs,
      peakDb: t.peakDb,
      sizeKb: t.sizeKb,
      voiceSpaceEq: Boolean(t.voiceSpaceEq),
      lufsWarn: t.lufsWarn,
      trimGuardTriggered: t.trimGuardTriggered,
      url: t.url,
    })),
    stingers: stingerTracks.map((t) => ({
      cueName: t.cueName,
      scope: t.scope,
      category: t.category,
      originalDurationSec: t.originalDurationSec,
      durationSec: t.durationSec,
      trimmedLeadSec: t.trimmedLeadSec,
      trimmedTailSec: t.trimmedTailSec,
      trimStartSec: t.trimStartSec,
      trimEndSec: t.trimEndSec,
      tailSilenceSec: t.tailSilenceSec,
      measuredLufs: t.measuredLufs,
      peakDb: t.peakDb,
      sizeKb: t.sizeKb,
      stingerOver15sWarning: t.stingerOver15sWarning,
      url: t.url,
    })),
  };

  await fs.writeFile(path.join(outDir, 'music_report.json'), JSON.stringify(report, null, 2));

  if (alerts.length > 0) {
    const first = alerts[0];
    throw new Error(
      `Music QA gate failed (${alerts.length} alert(s), e.g. ${first.cueName} ${first.reason}: peak=${first.peakDb ?? 'n/a'} tailSilence=${first.tailSilenceSec ?? 'n/a'})`,
    );
  }

  // 1. Write standalone music_table.json (BGM & Stinger strictly separated from SFX cue_table.json)
  const totalBytes = allTracks.reduce((sum, t) => sum + (Number(t.encodedBytes) || 0), 0);
  const musicTablePath = path.join(outDir, 'music_table.json');
  const musicTable = {
    version: MUSIC_PIPELINE_VERSION,
    format: 'mp3',
    generatedAt: report.generatedAt,
    bgmTargetLufs: BGM_TARGET_LUFS,
    stingerTargetLufs: STINGER_TARGET_LUFS,
    totalCount: allTracks.length,
    bgmCount: bgmTracks.length,
    stingerCount: stingerTracks.length,
    totalBytes,
    bgm: bgmTracks,
    stingers: stingerTracks,
    tracks: allTracks,
  };

  // 2. Write AI retrieval index built/audio/music-ai-index.json
  const aiIndexPath = path.join(outDir, 'music-ai-index.json');
  const aiIndex = {
    version: MUSIC_PIPELINE_VERSION,
    generatedAt: report.generatedAt,
    count: allTracks.length,
    items: allTracks.map((t) => ({
      id: t.cueName,
      scope: t.scope,
      kind: t.kind,
      category: t.category,
      bpm: t.bpm,
      durationSec: t.durationSec,
      measuredLufs: t.measuredLufs,
      peakDb: t.peakDb,
      sizeKb: t.sizeKb,
      url: t.url,
    })),
  };

  await Promise.all([
    fs.writeFile(musicTablePath, JSON.stringify(musicTable, null, 2)),
    fs.writeFile(aiIndexPath, JSON.stringify(aiIndex, null, 2)),
    fs.writeFile(cachePath, JSON.stringify({ version: MUSIC_PIPELINE_VERSION, entries: nextCacheEntries }, null, 2)),
  ]);

  return {
    outDir,
    stagingRoot: musicStagingRoot,
    musicTablePath,
    aiIndexPath,
    cachePath,
    report,
    bgmCount: bgmTracks.length,
    stingerCount: stingerTracks.length,
    totalCount: allTracks.length,
    cacheHits,
    cacheMisses,
  };
}
