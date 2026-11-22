import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  SILENCE_TRIM_FILTER,
  computeSafeShortGainDb,
  measureAudioFileVolume,
  parseLoudnormJsonStderr,
  runFfmpegAsync,
  runPool,
} from './audio-library-pipeline.mjs';

const SUPPORTED_MUSIC_EXTS = new Set(['.wav', '.mp3', '.flac', '.m4a']);
const BGM_TARGET_LUFS = -19.0;
const BGM_TARGET_TP = -1.5;
const BGM_TARGET_LRA = 11;
const BGM_LUFS_TOLERANCE = 1.5;
const STINGER_TARGET_LUFS = -16.0;
const STINGER_TARGET_TP = -1.5;
const STINGER_TARGET_LRA = 9;
const STINGER_MAX_DURATION_SEC = 6.0;
const STINGER_END_FADE_SEC = 0.4;
const PEAK_CEILING_GATE_DBTP = -0.5;

function clamp(v, min, max) {
  return v < min ? min : (v > max ? max : v);
}

function round(v, digits = 4) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
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
 * Parses BPM suffix (`_<N>bpm`) and normalizes standard Cue IDs:
 * `bgm_battle_fast_140bpm.wav` -> `bgm.battle_fast`, `stinger_victory.wav` -> `stinger.victory`.
 *
 * @param {string} filePathOrName
 * @param {'bgm' | 'stinger'} [kind='bgm']
 * @param {string} [relDir='']
 */
export function parseBgmFilenameMeta(filePathOrName, kind = 'bgm', relDir = '') {
  const baseName = path.basename(String(filePathOrName || ''), path.extname(String(filePathOrName || '')));
  const bpmMatch = baseName.match(/_(\d{2,3})bpm$/i);
  const parsedBpm = bpmMatch ? Number(bpmMatch[1]) : null;
  const bpm = Number.isFinite(parsedBpm) && parsedBpm >= 30 && parsedBpm <= 300 ? parsedBpm : null;

  const withoutBpm = bpmMatch ? baseName.slice(0, bpmMatch.index) : baseName;
  const prefixRe = kind === 'stinger' ? /^stinger[_.-]+/i : /^bgm[_.-]+/i;
  let core = withoutBpm.replace(prefixRe, '');
  const cleanRelDir = String(relDir || '').replaceAll('\\', '/').replace(/^\.?\/?|\/$/g, '');
  if (cleanRelDir && cleanRelDir !== '.') {
    core = `${cleanRelDir}/${core}`;
  }
  const slug = core
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'track';

  return {
    rawBaseName: baseName,
    bpm,
    slug,
    cueId: `${kind}.${slug}`,
    outStem: `${kind}_${slug}`,
  };
}

/**
 * Computes beat-aligned loop start, duration, and crossfade length for a BGM track,
 * automatically falling back on short sources so slicing never exceeds totalDurationSec.
 *
 * @param {object} params
 * @param {number} params.totalDurationSec
 * @param {number | null} [params.bpm=null]
 * @param {object | null} [params.override=null]
 */
export function computeBgmLoopTiming({
  totalDurationSec,
  bpm = null,
  override = null,
} = {}) {
  const total = Math.max(0.5, Number(totalDurationSec) || 0);
  const effBpm = Number.isFinite(Number(override?.bpm)) && Number(override.bpm) > 0
    ? Number(override.bpm)
    : (Number.isFinite(Number(bpm)) && Number(bpm) > 0 ? Number(bpm) : null);

  let startSec = Number.isFinite(Number(override?.startSec)) ? Math.max(0, Number(override.startSec)) : 8.0;
  let barSec = effBpm ? (60 / effBpm) * 4 : null;
  let bars = null;
  let loopSec;
  let fadeSec;

  if (barSec) {
    if (Number.isFinite(Number(override?.bars)) && Number(override.bars) > 0) {
      bars = Math.max(4, Math.round(Number(override.bars)));
      loopSec = bars * barSec;
    } else if (Number.isFinite(Number(override?.loopSec)) && Number(override.loopSec) > 0) {
      loopSec = Number(override.loopSec);
      bars = Math.max(1, Math.round(loopSec / barSec));
    } else {
      // Pick 4-bar multiple in [36s, 56s] closest to 48s.
      const candidates = [];
      for (let b = 4; b * barSec <= 96; b += 4) {
        const sec = b * barSec;
        if (sec >= 36 && sec <= 56) candidates.push({ b, sec, diff: Math.abs(sec - 48) });
      }
      if (candidates.length === 0) {
        for (let b = 4; b * barSec <= Math.max(120, total); b += 4) {
          const sec = b * barSec;
          candidates.push({ b, sec, diff: Math.abs(sec - 48) });
        }
      }
      candidates.sort((a, b) => a.diff - b.diff || a.b - b.b);
      const picked = candidates[0] || { b: 4, sec: 4 * barSec };
      bars = picked.b;
      loopSec = picked.sec;
    }

    if (Number.isFinite(Number(override?.fadeSec)) && Number(override.fadeSec) > 0) {
      fadeSec = clamp(Number(override.fadeSec), 0.2, loopSec * 0.4);
    } else if (Number.isFinite(Number(override?.fadeBars)) && Number(override.fadeBars) > 0) {
      fadeSec = clamp(Number(override.fadeBars) * barSec, 0.25, Math.min(6.0, loopSec * 0.4));
    } else {
      fadeSec = clamp(barSec, 1.5, 3.0);
    }
  } else {
    loopSec = Number.isFinite(Number(override?.loopSec)) && Number(override.loopSec) > 0
      ? Number(override.loopSec)
      : 48.0;
    fadeSec = Number.isFinite(Number(override?.fadeSec)) && Number(override.fadeSec) > 0
      ? clamp(Number(override.fadeSec), 0.2, loopSec * 0.4)
      : 2.5;
  }

  // Fallback for shorter inputs: shorten startSec (floor 2.0s first), then step loopSec down.
  const minStartFloor = Number.isFinite(Number(override?.startSec)) ? Math.min(startSec, 2.0) : 2.0;
  if (startSec + loopSec + fadeSec > total) {
    const availForStart = total - loopSec - fadeSec;
    if (availForStart >= minStartFloor) {
      startSec = availForStart;
    } else {
      startSec = Math.min(startSec, minStartFloor);
      if (barSec) {
        while (bars > 4 && startSec + loopSec + fadeSec > total) {
          bars -= 4;
          loopSec = bars * barSec;
        }
      } else {
        while (loopSec > 8 && startSec + loopSec + fadeSec > total) {
          loopSec = Math.max(4, loopSec - 4);
        }
      }
      // Adjust startSec again if room opened up or still tight
      const remAfterLoop = total - loopSec - fadeSec;
      if (remAfterLoop >= minStartFloor) {
        startSec = Math.min(Number.isFinite(Number(override?.startSec)) ? Number(override.startSec) : 8.0, remAfterLoop);
      } else if (remAfterLoop >= 0) {
        startSec = remAfterLoop;
      } else {
        startSec = 0;
        fadeSec = Math.min(fadeSec, Math.max(0.15, total * 0.1));
        loopSec = Math.max(0.25, total - fadeSec);
        if (barSec) bars = Math.max(1, Math.round(loopSec / barSec));
      }
    }
  }

  return {
    bpm: effBpm,
    barSec: barSec ? round(barSec, 6) : null,
    bars,
    startSec: round(startSec, 6),
    loopSec: round(loopSec, 6),
    fadeSec: round(fadeSec, 6),
  };
}

/**
 * Probes encoded audio metadata (`duration`, `startTime` encoder delay, channels, sampleRate, bitRate).
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
  targetI,
  targetTp,
  targetLra,
  preFilter = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,highpass=f=30',
}) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  const runWithTp = async (tpLimit) => {
    const p1Filter = `${preFilter},loudnorm=I=${targetI.toFixed(1)}:TP=${tpLimit.toFixed(1)}:LRA=${targetLra}:print_format=json`;
    const p1 = await runFfmpegAsync(ffmpegBin, ['-hide_banner', '-nostats', '-i', srcPath, '-af', p1Filter, '-f', 'null', '-']);
    const ln = parseLoudnormJsonStderr(p1.stderr);
    const p2Loudnorm = ln
      ? `loudnorm=I=${targetI.toFixed(1)}:TP=${tpLimit.toFixed(1)}:LRA=${targetLra}:measured_I=${ln.inputI.toFixed(2)}:measured_TP=${ln.inputTp.toFixed(2)}:measured_LRA=${ln.inputLra.toFixed(2)}:measured_thresh=${ln.inputThresh.toFixed(2)}:offset=${ln.targetOffset.toFixed(2)}:linear=true`
      : `loudnorm=I=${targetI.toFixed(1)}:TP=${tpLimit.toFixed(1)}:LRA=${targetLra}`;
    const p2Filter = `${preFilter},${p2Loudnorm}`;
    const enc = await runFfmpegAsync(ffmpegBin, [
      '-y', '-v', 'error',
      '-i', srcPath,
      '-af', p2Filter,
      '-ac', '2',
      '-ar', '44100',
      '-c:a', 'libmp3lame',
      '-b:a', '96k',
      outPath,
    ]);
    if (enc.code !== 0) {
      throw new Error(`ffmpeg loudnorm encode failed for ${path.basename(outPath)}: ${enc.stderr}`);
    }
    return auditEncodedLoudnormAndPeak(ffmpegBin, outPath, { targetI, targetTp, targetLra });
  };

  let tpLimit = targetTp;
  let audit = await runWithTp(tpLimit);
  // If MP3 MDCT quantization pushed inter-sample peak near -0.5 dBTP, lower pre-encode TP ceiling cleanly.
  for (let retry = 0; retry < 2 && audit.peakDb > -0.8; retry++) {
    tpLimit -= Math.max(0.6, audit.peakDb - (-1.2));
    audit = await runWithTp(tpLimit);
  }
  return audit;
}

/**
 * Processes one looping BGM track:
 * BPM alignment -> tail-to-head hsin crossfade WAV -> highpass=f=30 + 2-pass -19 LUFS loudnorm -> 96k stereo MP3 -> ffprobe trim metadata.
 */
export async function processBgmTrack({
  srcAbs,
  outAbs,
  cueId,
  bpm = null,
  override = null,
  baseUrl = '/assets/cn/audio',
  relOut,
  ffmpegBin = 'ffmpeg',
  ffprobeBin = 'ffprobe',
  tempDir = os.tmpdir(),
} = {}) {
  const srcProbe = await probeAudioMetadata(ffprobeBin, srcAbs);
  const timing = computeBgmLoopTiming({
    totalDurationSec: srcProbe.duration,
    bpm,
    override,
  });

  const mainEnd = round(timing.startSec + timing.loopSec, 6);
  const tailEnd = round(mainEnd + timing.fadeSec, 6);
  const tmpWav = path.join(tempDir, `hgame_bgm_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.wav`);

  try {
    const filterComplex = [
      `[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=2[src_main][src_tail]`,
      `[src_main]atrim=start=${timing.startSec}:end=${mainEnd},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${timing.fadeSec}:curve=hsin[main]`,
      `[src_tail]atrim=start=${mainEnd}:end=${tailEnd},asetpts=PTS-STARTPTS,afade=t=out:st=0:d=${timing.fadeSec}:curve=hsin[tail]`,
      `[main][tail]amix=inputs=2:duration=first:normalize=0[mixed]`,
    ].join(';');

    const mixRes = await runFfmpegAsync(ffmpegBin, [
      '-y', '-v', 'error',
      '-i', srcAbs,
      '-filter_complex', filterComplex,
      '-map', '[mixed]',
      '-ac', '2',
      '-ar', '44100',
      '-c:a', 'pcm_f32le',
      tmpWav,
    ]);
    if (mixRes.code !== 0) {
      throw new Error(`ffmpeg tail-to-head loop build failed for ${path.basename(srcAbs)}: ${mixRes.stderr}`);
    }

    const audit = await encodeTwoPassLoudnormMp3({
      srcPath: tmpWav,
      outPath: outAbs,
      ffmpegBin,
      targetI: BGM_TARGET_LUFS,
      targetTp: BGM_TARGET_TP,
      targetLra: BGM_TARGET_LRA,
    });

    const outProbe = await probeAudioMetadata(ffprobeBin, outAbs);
    const outStat = await fs.stat(outAbs);
    const trimStartSec = round(outProbe.startTime > 0 ? outProbe.startTime : 0.026, 6);
    const durationSec = round(outProbe.duration > 0 ? outProbe.duration : timing.loopSec, 4);
    const trimEndSec = round(trimStartSec + durationSec, 6);
    const sizeKb = round(outStat.size / 1024, 2);

    return {
      cueName: cueId,
      pack: 'bgm',
      category: 'bgm',
      url: `${baseUrl}/${relOut}`,
      path: relOut,
      bus: 'bgm',
      loudnessTier: 'bgm',
      preload: 'stream',
      loop: true,
      bpm: timing.bpm,
      bars: timing.bars,
      fadeSec: timing.fadeSec,
      durationSec,
      trimStartSec,
      trimEndSec,
      measuredLufs: audit.measuredLufs,
      measuredDb: audit.measuredLufs,
      peakDb: audit.peakDb,
      sizeKb,
      encodedBytes: outStat.size,
      gainDb: Number(override?.gainDb ?? 0),
      ducking: false,
      variants: [
        {
          id: cueId,
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
    await fs.rm(tmpWav, { force: true }).catch(() => {});
  }
}

/**
 * Processes one non-looping Stinger track:
 * -50 dB silence trim -> cap 6.0s with 0.4s tail fade -> -16 LUFS loudnorm (>=1.5s) or Active RMS (<1.5s) -> 96k stereo MP3.
 */
export async function processStingerTrack({
  srcAbs,
  outAbs,
  cueId,
  override = null,
  baseUrl = '/assets/cn/audio',
  relOut,
  ffmpegBin = 'ffmpeg',
  ffprobeBin = 'ffprobe',
  tempDir = os.tmpdir(),
} = {}) {
  const uid = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const trimWav = path.join(tempDir, `hgame_stinger_trim_${uid}.wav`);
  const capWav = path.join(tempDir, `hgame_stinger_cap_${uid}.wav`);

  try {
    const basePrefix = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo';
    let trimRes = await runFfmpegAsync(ffmpegBin, [
      '-y', '-v', 'error',
      '-i', srcAbs,
      '-af', `${basePrefix},${SILENCE_TRIM_FILTER},highpass=f=30`,
      '-c:a', 'pcm_f32le',
      trimWav,
    ]);
    let trimProbe = trimRes.code === 0 ? await probeAudioMetadata(ffprobeBin, trimWav).catch(() => null) : null;
    if (!trimProbe || trimProbe.duration < 0.02) {
      trimRes = await runFfmpegAsync(ffmpegBin, [
        '-y', '-v', 'error',
        '-i', srcAbs,
        '-af', `${basePrefix},highpass=f=30`,
        '-c:a', 'pcm_f32le',
        trimWav,
      ]);
      if (trimRes.code !== 0) {
        throw new Error(`ffmpeg stinger trim failed for ${path.basename(srcAbs)}: ${trimRes.stderr}`);
      }
      trimProbe = await probeAudioMetadata(ffprobeBin, trimWav);
    }

    let workWav = trimWav;
    let effectiveDur = trimProbe.duration;
    if (effectiveDur > STINGER_MAX_DURATION_SEC) {
      const fadeStart = STINGER_MAX_DURATION_SEC - STINGER_END_FADE_SEC;
      const capRes = await runFfmpegAsync(ffmpegBin, [
        '-y', '-v', 'error',
        '-i', trimWav,
        '-af', `atrim=0:${STINGER_MAX_DURATION_SEC},asetpts=PTS-STARTPTS,afade=t=out:st=${fadeStart.toFixed(3)}:d=${STINGER_END_FADE_SEC}`,
        '-c:a', 'pcm_f32le',
        capWav,
      ]);
      if (capRes.code !== 0) {
        throw new Error(`ffmpeg stinger cap failed for ${path.basename(srcAbs)}: ${capRes.stderr}`);
      }
      workWav = capWav;
      effectiveDur = STINGER_MAX_DURATION_SEC;
    }

    let audit;
    if (effectiveDur >= 1.5) {
      audit = await encodeTwoPassLoudnormMp3({
        srcPath: workWav,
        outPath: outAbs,
        ffmpegBin,
        targetI: STINGER_TARGET_LUFS,
        targetTp: STINGER_TARGET_TP,
        targetLra: STINGER_TARGET_LRA,
        preFilter: basePrefix,
      });
    } else {
      await fs.mkdir(path.dirname(outAbs), { recursive: true });
      const stats = await measureAudioFileVolume(ffmpegBin, workWav, '');
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
          '-i', workWav,
          '-af', `${basePrefix},volume=${gainInfo.gainDb.toFixed(2)}dB,alimiter=limit=${ceilLin}:attack=2:release=50:level=disabled`,
          '-ac', '2',
          '-ar', '44100',
          '-c:a', 'libmp3lame',
          '-b:a', '96k',
          outAbs,
        ]);
        if (enc.code !== 0) {
          throw new Error(`ffmpeg stinger short encode failed for ${path.basename(srcAbs)}: ${enc.stderr}`);
        }
        const post = await measureAudioFileVolume(ffmpegBin, outAbs, SILENCE_TRIM_FILTER);
        const peakDb = round(post.maxDb ?? STINGER_TARGET_TP, 2);
        const measuredLufs = round(post.meanDb ?? STINGER_TARGET_LUFS, 2);
        audit = { measuredLufs, peakDb };
        if (peakDb <= -0.8) break;
        ceilDb -= Math.max(0.6, peakDb - (-1.2));
      }
    }

    const outProbe = await probeAudioMetadata(ffprobeBin, outAbs);
    const outStat = await fs.stat(outAbs);
    const trimStartSec = round(outProbe.startTime > 0 ? outProbe.startTime : 0.026, 6);
    const durationSec = round(outProbe.duration > 0 ? outProbe.duration : effectiveDur, 4);
    const trimEndSec = round(trimStartSec + durationSec, 6);
    const sizeKb = round(outStat.size / 1024, 2);

    return {
      cueName: cueId,
      pack: 'stinger',
      category: 'stinger',
      url: `${baseUrl}/${relOut}`,
      path: relOut,
      bus: 'ui_voice',
      loudnessTier: 'ui_voice',
      preload: 'buffer',
      loop: false,
      bpm: null,
      durationSec,
      trimStartSec,
      trimEndSec,
      measuredLufs: audit.measuredLufs,
      measuredDb: audit.measuredLufs,
      peakDb: audit.peakDb,
      sizeKb,
      encodedBytes: outStat.size,
      gainDb: Number(override?.gainDb ?? 0),
      ducking: true,
      variants: [
        {
          id: cueId,
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
    await fs.rm(trimWav, { force: true }).catch(() => {});
    await fs.rm(capWav, { force: true }).catch(() => {});
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

function lookupOverride(overridesMap, meta, filePath) {
  if (!overridesMap || typeof overridesMap !== 'object') return null;
  const baseWithExt = path.basename(filePath);
  return overridesMap[meta.rawBaseName]
    || overridesMap[meta.cueId]
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
        category: t.category,
        reason: 'peak_above_ceiling',
        peakDb: t.peakDb,
        ceilingDb: PEAK_CEILING_GATE_DBTP,
      });
    }
    if (t.category === 'bgm' && Math.abs(Number(t.measuredLufs) - BGM_TARGET_LUFS) > BGM_LUFS_TOLERANCE) {
      alerts.push({
        cueName: t.cueName,
        category: 'bgm',
        reason: 'lufs_out_of_tolerance',
        measuredLufs: t.measuredLufs,
        targetLufs: BGM_TARGET_LUFS,
        toleranceLufs: BGM_LUFS_TOLERANCE,
      });
    }
  }
  return alerts;
}

/**
 * Processes `audio_ai_staging/bgm/**` and `audio_ai_staging/stinger/**`, merges
 * `bgm.*` / `stinger.*` entries into `cue_table.json` & `streams_table.json`,
 * runs strict LUFS/Peak gates, and outputs `music_report.json`.
 */
export async function processMusicLibrary({
  musicStagingRoot = resolveDefaultMusicStagingRoot(),
  outDir = path.resolve('webasset/hgame-assets-cn/built/audio'),
  baseUrl = '/assets/cn/audio',
  ffmpegBin = 'ffmpeg',
  ffprobeBin = 'ffprobe',
  concurrency = Math.min(4, Math.max(1, os.cpus().length - 2)),
} = {}) {
  const bgmDir = path.join(musicStagingRoot, 'bgm');
  const stingerDir = path.join(musicStagingRoot, 'stinger');
  const overridesPath = path.join(musicStagingRoot, 'bgm_overrides.json');

  let overridesMap = {};
  if (existsSync(overridesPath)) {
    overridesMap = JSON.parse(await fs.readFile(overridesPath, 'utf8'));
  }

  const [bgmFiles, stingerFiles] = await Promise.all([
    scanAudioFilesRecursive(bgmDir),
    scanAudioFilesRecursive(stingerDir),
  ]);

  await fs.mkdir(outDir, { recursive: true });
  const bgmResults = new Array(bgmFiles.length);
  const stingerResults = new Array(stingerFiles.length);

  await runPool(bgmFiles, concurrency, async (srcAbs, idx) => {
    const relDir = path.dirname(path.relative(bgmDir, srcAbs));
    const meta = parseBgmFilenameMeta(srcAbs, 'bgm', relDir === '.' ? '' : relDir);
    const override = lookupOverride(overridesMap, meta, srcAbs);
    const relOut = `streams/bgm/${meta.outStem}.mp3`;
    const outAbs = path.join(outDir, relOut);
    bgmResults[idx] = await processBgmTrack({
      srcAbs,
      outAbs,
      cueId: meta.cueId,
      bpm: meta.bpm,
      override,
      baseUrl,
      relOut,
      ffmpegBin,
      ffprobeBin,
    });
  });

  await runPool(stingerFiles, concurrency, async (srcAbs, idx) => {
    const relDir = path.dirname(path.relative(stingerDir, srcAbs));
    const meta = parseBgmFilenameMeta(srcAbs, 'stinger', relDir === '.' ? '' : relDir);
    const override = lookupOverride(overridesMap, meta, srcAbs);
    const relOut = `sfx/stinger/${meta.outStem}.mp3`;
    const outAbs = path.join(outDir, relOut);
    stingerResults[idx] = await processStingerTrack({
      srcAbs,
      outAbs,
      cueId: meta.cueId,
      override,
      baseUrl,
      relOut,
      ffmpegBin,
      ffprobeBin,
    });
  });

  const bgmTracks = bgmResults.filter(Boolean).sort((a, b) => a.cueName.localeCompare(b.cueName));
  const stingerTracks = stingerResults.filter(Boolean).sort((a, b) => a.cueName.localeCompare(b.cueName));
  const alerts = evaluateMusicGate(bgmTracks, stingerTracks);

  const report = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    stagingRoot: musicStagingRoot,
    bgmTargetLufs: BGM_TARGET_LUFS,
    bgmToleranceLufs: BGM_LUFS_TOLERANCE,
    stingerTargetLufs: STINGER_TARGET_LUFS,
    peakCeilingDbTp: PEAK_CEILING_GATE_DBTP,
    totalTracks: bgmTracks.length + stingerTracks.length,
    bgmCount: bgmTracks.length,
    stingerCount: stingerTracks.length,
    passed: alerts.length === 0,
    alertCount: alerts.length,
    alerts,
    bgm: bgmTracks.map((t) => ({
      cueName: t.cueName,
      bpm: t.bpm,
      bars: t.bars,
      durationSec: t.durationSec,
      trimStartSec: t.trimStartSec,
      trimEndSec: t.trimEndSec,
      measuredLufs: t.measuredLufs,
      peakDb: t.peakDb,
      sizeKb: t.sizeKb,
      url: t.url,
    })),
    stingers: stingerTracks.map((t) => ({
      cueName: t.cueName,
      durationSec: t.durationSec,
      trimStartSec: t.trimStartSec,
      trimEndSec: t.trimEndSec,
      measuredLufs: t.measuredLufs,
      peakDb: t.peakDb,
      sizeKb: t.sizeKb,
      url: t.url,
    })),
  };

  await fs.writeFile(path.join(outDir, 'music_report.json'), JSON.stringify(report, null, 2));

  if (alerts.length > 0) {
    const first = alerts[0];
    throw new Error(
      `Music loudness gate failed (${alerts.length} alert(s), e.g. ${first.cueName} ${first.reason}: peak=${first.peakDb ?? 'n/a'} lufs=${first.measuredLufs ?? 'n/a'})`,
    );
  }

  // Merge cleanly into cue_table.json (preserving existing SFX cues)
  const cueTablePath = path.join(outDir, 'cue_table.json');
  let existingCueTable = {
    version: '1.0.0',
    format: 'mp3',
    preloadRule: 'buffer_only_sfx_under_4s',
    cueCount: 0,
    surfaceCueCount: 0,
    surfaceCoverage: {},
    streamTracksExcluded: 0,
    cues: [],
  };
  if (existsSync(cueTablePath)) {
    existingCueTable = JSON.parse(await fs.readFile(cueTablePath, 'utf8'));
  }
  const preservedCues = (existingCueTable.cues || []).filter(
    (c) => !String(c.cueName || '').startsWith('bgm.') && !String(c.cueName || '').startsWith('stinger.'),
  );
  const mergedCues = [...preservedCues, ...bgmTracks, ...stingerTracks];
  const updatedCueTable = {
    ...existingCueTable,
    cueCount: mergedCues.length,
    musicCueCount: bgmTracks.length + stingerTracks.length,
    cues: mergedCues,
  };

  // Merge cleanly into streams_table.json (preserving non-BGM stream tracks)
  const streamsTablePath = path.join(outDir, 'streams_table.json');
  let existingStreamsTable = {
    version: '1.0.0',
    format: 'mp3',
    preload: 'stream',
    count: 0,
    totalBytes: 0,
    streams: [],
  };
  if (existsSync(streamsTablePath)) {
    existingStreamsTable = JSON.parse(await fs.readFile(streamsTablePath, 'utf8'));
  }
  const preservedStreams = (existingStreamsTable.streams || []).filter(
    (s) => s.category !== 'bgm' && !String(s.path || '').startsWith('streams/bgm/'),
  );
  const bgmStreamEntries = bgmTracks.map((t) => ({
    id: t.cueName,
    cueName: t.cueName,
    pack: 'BGM',
    category: 'bgm',
    name: t.cueName,
    relDir: 'bgm',
    duration: t.durationSec,
    durationSec: t.durationSec,
    trimStartSec: t.trimStartSec,
    trimEndSec: t.trimEndSec,
    bpm: t.bpm,
    loop: true,
    bitrateKbps: 96,
    channels: 2,
    preload: 'stream',
    bus: 'bgm',
    loudnessTier: 'bgm',
    measuredLufs: t.measuredLufs,
    measuredDb: t.measuredLufs,
    peakDb: t.peakDb,
    appliedGainDb: 0,
    gainDb: t.gainDb,
    sizeKb: t.sizeKb,
    encodedBytes: t.encodedBytes,
    path: t.path,
    url: t.url,
  }));
  const mergedStreams = [...bgmStreamEntries, ...preservedStreams];
  const totalStreamBytes = mergedStreams.reduce((sum, s) => sum + (Number(s.encodedBytes) || 0), 0);
  const updatedStreamsTable = {
    ...existingStreamsTable,
    count: mergedStreams.length,
    totalBytes: totalStreamBytes,
    streams: mergedStreams,
  };

  await Promise.all([
    fs.writeFile(cueTablePath, JSON.stringify(updatedCueTable, null, 2)),
    fs.writeFile(streamsTablePath, JSON.stringify(updatedStreamsTable, null, 2)),
  ]);

  return {
    outDir,
    stagingRoot: musicStagingRoot,
    report,
    bgmCount: bgmTracks.length,
    stingerCount: stingerTracks.length,
    cueCount: mergedCues.length,
    streamCount: mergedStreams.length,
  };
}
