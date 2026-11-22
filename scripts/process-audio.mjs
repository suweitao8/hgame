import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeAudioBuffer } from '../assets/runtime/platform/audio.js';
import {
  SURFACE_TYPES_10,
  AUDIO_LOUDNESS_TIERS,
  SILENCE_TRIM_FILTER,
  classifyAudioLoudnessTier,
  computeVariantLoudnessOffsetDb,
  computeSafeShortGainDb,
  measureAudioFileVolume,
  normalizeAndEncodeAudioFile,
  extractSemanticCueKey,
  parseWavPcmSamples,
  computeSpectralCentroidHz,
  measureSamplesFeatures,
  selectQuantileVariants,
  buildSurfaceTypeCueMap,
  processAudioLibraryBatch,
} from './lib/audio-library-pipeline.mjs';
import {
  MUSIC_PIPELINE_VERSION,
  resolveDefaultMusicStagingRoot,
  inferMusicCategory,
  parseBgmFilenameMeta,
  parseTailSilenceSec,
  probeAudioMetadata,
  processMusicTrack,
  evaluateMusicGate,
  processMusicLibrary,
} from './lib/music-pipeline.mjs';

export {
  SURFACE_TYPES_10,
  AUDIO_LOUDNESS_TIERS,
  SILENCE_TRIM_FILTER,
  classifyAudioLoudnessTier,
  computeVariantLoudnessOffsetDb,
  computeSafeShortGainDb,
  measureAudioFileVolume,
  normalizeAndEncodeAudioFile,
  extractSemanticCueKey,
  parseWavPcmSamples,
  computeSpectralCentroidHz,
  measureSamplesFeatures,
  selectQuantileVariants,
  buildSurfaceTypeCueMap,
  processAudioLibraryBatch,
  MUSIC_PIPELINE_VERSION,
  resolveDefaultMusicStagingRoot,
  inferMusicCategory,
  parseBgmFilenameMeta,
  parseTailSilenceSec,
  probeAudioMetadata,
  processMusicTrack,
  evaluateMusicGate,
  processMusicLibrary,
};

function clamp(value, min, max) {
  return value < min ? min : (value > max ? max : value);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) * 0.5;
}

/** Measures active window, trim offsets, RMS loudness, and peak from mono PCM samples. */
export function analyzeMonoPcm(samples, sampleRate = 24000, options = {}) {
  const floatSamples = samples instanceof Float32Array ? samples : new Float32Array(samples);
  return analyzeAudioBuffer({
    length: floatSamples.length,
    sampleRate,
    numberOfChannels: 1,
    getChannelData: () => floatSamples,
  }, options);
}

/**
 * Selects the 2-4 most consistent variants (duration + RMS loudness) out of a generated batch
 * so in-game round-robin playback never switches abruptly in length or volume.
 */
export function selectConsistentVariants(candidates, {
  minKeep = 2,
  maxKeep = 4,
  maxDurationSpreadRatio = 0.25,
  maxRmsSpreadDb = 6,
} = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new TypeError('selectConsistentVariants requires a non-empty candidates array');
  }

  const valid = [];
  const rejected = [];

  for (const item of candidates) {
    if (!item || !(item.rms > 1e-5) || !(item.activeDuration >= 0.02)) {
      rejected.push({ ...item, reason: 'silent_or_too_short' });
      continue;
    }
    valid.push(item);
  }

  if (valid.length === 0) {
    return {
      selected: [],
      rejected,
      medianDuration: 0,
      targetDurationCap: 0,
      targetRms: 0,
      consistent: false,
      warning: 'No audible candidates met minimum loudness/duration thresholds',
    };
  }

  const medianDuration = median(valid.map(c => c.activeDuration));
  const medianRms = median(valid.map(c => c.rms));
  const medianRmsDb = 20 * Math.log10(Math.max(1e-6, medianRms));
  const targetDurationCap = medianDuration * (1 + maxDurationSpreadRatio);

  const scored = valid.map((c) => {
    const durationDeviation = Math.abs(c.activeDuration - medianDuration) / Math.max(0.02, medianDuration);
    const rmsDb = 20 * Math.log10(Math.max(1e-6, c.rms));
    const rmsDiffDb = Math.abs(rmsDb - medianRmsDb);
    const score = (durationDeviation / Math.max(0.01, maxDurationSpreadRatio))
      + 0.5 * (rmsDiffDb / Math.max(0.5, maxRmsSpreadDb));
    const inTolerance = durationDeviation <= maxDurationSpreadRatio && rmsDiffDb <= maxRmsSpreadDb;
    return { ...c, durationDeviation, rmsDiffDb, score, inTolerance };
  });

  const inTol = scored.filter(c => c.inTolerance).sort((a, b) => a.score - b.score);
  const outTol = scored.filter(c => !c.inTolerance).sort((a, b) => a.score - b.score);

  const chosenRaw = inTol.slice(0, maxKeep);
  let warning = null;
  if (chosenRaw.length < minKeep && outTol.length > 0) {
    const needed = Math.min(minKeep, valid.length) - chosenRaw.length;
    chosenRaw.push(...outTol.slice(0, needed));
    warning = `Only ${inTol.length} candidate(s) stayed within strict duration/RMS tolerance; included closest fallback variant(s).`;
  }

  const chosenSet = new Set(chosenRaw);
  for (const item of scored) {
    if (!chosenSet.has(item)) {
      rejected.push({
        id: item.id,
        file: item.file,
        activeDuration: item.activeDuration,
        rms: item.rms,
        durationDeviation: item.durationDeviation,
        rmsDiffDb: item.rmsDiffDb,
        reason: item.inTolerance ? 'exceeds_max_keep' : 'outlier_duration_or_loudness',
      });
    }
  }

  const selected = chosenRaw.map((c, idx) => {
    const gainDb = clamp(20 * Math.log10(medianRms / c.rms), -5, 5);
    const cappedTail = c.activeDuration > targetDurationCap;
    const exportDuration = Math.min(c.activeDuration, targetDurationCap);
    return {
      variantIndex: idx,
      id: c.id ?? path.basename(c.file || `variant_${idx + 1}`),
      file: c.file,
      trimStart: c.trimStart,
      trimEnd: c.trimEnd,
      activeDuration: c.activeDuration,
      exportDuration,
      cappedTail,
      gainDb,
      rms: c.rms,
      durationDeviation: c.durationDeviation,
      rmsDiffDb: c.rmsDiffDb,
      inTolerance: c.inTolerance,
    };
  });

  return {
    selected,
    rejected,
    medianDuration,
    targetDurationCap,
    targetRms: medianRms,
    consistent: !warning && selected.every(s => s.inTolerance),
    warning,
  };
}

function decodePcmViaFfmpeg(ffmpegBin, inputPath, analysisRate = 24000) {
  const res = spawnSync(ffmpegBin, [
    '-v', 'error',
    '-i', inputPath,
    '-ac', '1',
    '-ar', String(analysisRate),
    '-f', 'f32le',
    'pipe:1',
  ], { maxBuffer: 64 * 1024 * 1024 });

  if (res.error) throw res.error;
  if (res.status !== 0) {
    const stderr = res.stderr ? res.stderr.toString('utf8').trim() : '';
    throw new Error(`ffmpeg decode failed for ${path.basename(inputPath)}: ${stderr || `exit ${res.status}`}`);
  }
  const stdout = res.stdout;
  const byteLen = stdout.byteLength - (stdout.byteLength % 4);
  const ab = stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + byteLen);
  return new Float32Array(ab);
}

/**
 * Measures raw MP3/WAV candidates via ffmpeg, selects and aligns the most consistent
 * 2-4 variants, trims silence padding, normalizes loudness, and exports clean MP3s.
 */
export function processCueFiles({
  cueName,
  inputs,
  outDir,
  isBgm = false,
  sampleRate = null,
  bitrate = null,
  minKeep = 2,
  maxKeep = 4,
  maxDurationSpreadRatio = 0.25,
  maxRmsSpreadDb = 6,
  ffmpegBin = 'ffmpeg',
} = {}) {
  if (!cueName || typeof cueName !== 'string') throw new TypeError('cueName is required');
  if (!Array.isArray(inputs) || inputs.length === 0) throw new TypeError('inputs must be a non-empty array');
  if (!outDir) throw new TypeError('outDir is required');

  const analysisRate = 24000;
  const measured = inputs.map((file, i) => {
    const samples = decodePcmViaFfmpeg(ffmpegBin, file, analysisRate);
    const analysis = analyzeMonoPcm(samples, analysisRate);
    return {
      id: path.basename(file, path.extname(file)) || `${cueName}_${i + 1}`,
      file,
      ...analysis,
    };
  });

  let selection;
  if (isBgm || measured.length === 1) {
    const item = measured[0];
    selection = {
      selected: [{
        variantIndex: 0,
        id: item.id,
        file: item.file,
        trimStart: item.trimStart,
        trimEnd: item.trimEnd,
        activeDuration: item.activeDuration,
        exportDuration: item.activeDuration,
        cappedTail: false,
        gainDb: 0,
        rms: item.rms,
        durationDeviation: 0,
        rmsDiffDb: 0,
        inTolerance: true,
      }],
      rejected: [],
      medianDuration: item.activeDuration,
      targetDurationCap: item.activeDuration,
      targetRms: item.rms,
      consistent: true,
      warning: null,
    };
  } else {
    selection = selectConsistentVariants(measured, {
      minKeep: Math.min(minKeep, measured.length),
      maxKeep,
      maxDurationSpreadRatio,
      maxRmsSpreadDb,
    });
  }

  fs.mkdirSync(outDir, { recursive: true });
  const targetRate = sampleRate ?? (isBgm ? 44100 : 24000);
  const targetChannels = isBgm ? 2 : 1;
  const targetBitrate = bitrate ?? (isBgm ? '128k' : '96k');

  const exported = [];
  for (let i = 0; i < selection.selected.length; i++) {
    const v = selection.selected[i];
    const outName = (isBgm || selection.selected.length === 1)
      ? `${cueName}.mp3`
      : `${cueName}_${String(i + 1).padStart(2, '0')}.mp3`;
    const outPath = path.join(outDir, outName);

    const dur = Math.max(0.03, v.exportDuration);
    const fadeDur = isBgm
      ? Math.min(0.6, dur * 0.1)
      : (v.cappedTail ? Math.min(0.045, dur * 0.25) : Math.min(0.02, dur * 0.15));
    const fadeStart = Math.max(0, dur - fadeDur);
    const filters = [];
    if (Math.abs(v.gainDb) > 0.05) {
      filters.push(`volume=${v.gainDb.toFixed(2)}dB`);
    }
    if (fadeDur > 0.002) {
      filters.push(`afade=t=out:st=${fadeStart.toFixed(3)}:d=${fadeDur.toFixed(3)}`);
    }

    const args = [
      '-y', '-v', 'error',
      '-ss', v.trimStart.toFixed(4),
      '-t', dur.toFixed(4),
      '-i', v.file,
      ...(filters.length ? ['-af', filters.join(',')] : []),
      '-ac', String(targetChannels),
      '-ar', String(targetRate),
      '-c:a', 'libmp3lame',
      '-b:a', String(targetBitrate),
      outPath,
    ];
    const enc = spawnSync(ffmpegBin, args, { encoding: 'utf8' });
    if (enc.error) throw enc.error;
    if (enc.status !== 0) {
      throw new Error(`ffmpeg encode failed for ${outName}: ${enc.stderr || `exit ${enc.status}`}`);
    }

    exported.push({
      outputName: outName,
      outputFile: outPath,
      sourceName: path.basename(v.file),
      exportDuration: dur,
      gainDb: Number(v.gainDb.toFixed(2)),
      cappedTail: v.cappedTail,
    });
  }

  return {
    cueName,
    format: 'mp3',
    channels: targetChannels,
    sampleRate: targetRate,
    bitrate: targetBitrate,
    medianDuration: selection.medianDuration,
    targetDurationCap: selection.targetDurationCap,
    consistent: selection.consistent,
    warning: selection.warning,
    selected: exported,
    rejectedCount: selection.rejected.length,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

export async function runAudioCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args['only-music']) {
    return processMusicLibrary({
      ...(args['music-staging'] ? { musicStagingRoot: path.resolve(String(args['music-staging'])) } : {}),
      ...(args['out-dir'] ? { outDir: path.resolve(String(args['out-dir'])) } : {}),
      ...(args['base-url'] ? { baseUrl: String(args['base-url']) } : {}),
      ...(args.concurrency ? { concurrency: Number(args.concurrency) } : {}),
      force: Boolean(args.force),
    });
  }
  if (args.batch) {
    const batchRes = await processAudioLibraryBatch({
      ...(args.staging ? { stagingRoot: path.resolve(String(args.staging)) } : {}),
      ...(args['v10-wavs'] ? { v10WavsDir: path.resolve(String(args['v10-wavs'])) } : {}),
      ...(args['out-dir'] ? { outDir: path.resolve(String(args['out-dir'])) } : {}),
      ...(args.concurrency ? { concurrency: Number(args.concurrency) } : {}),
      force: Boolean(args.force),
    });
    const musicRoot = args['music-staging']
      ? path.resolve(String(args['music-staging']))
      : resolveDefaultMusicStagingRoot();
    if (fs.existsSync(musicRoot)) {
      batchRes.music = await processMusicLibrary({
        musicStagingRoot: musicRoot,
        ...(args['out-dir'] ? { outDir: path.resolve(String(args['out-dir'])) } : {}),
        ...(args['base-url'] ? { baseUrl: String(args['base-url']) } : {}),
        ...(args.concurrency ? { concurrency: Number(args.concurrency) } : {}),
        force: Boolean(args.force),
      });
    }
    return batchRes;
  }
  if (!args.cue || !args.inputs || !args['out-dir']) {
    throw new Error('Usage: node scripts/process-audio.mjs --cue <name> --inputs a.mp3,b.mp3,c.mp3,d.mp3 --out-dir <dir> [--bgm] | --batch | --only-music [--force]');
  }
  const inputs = String(args.inputs).split(',').map(s => s.trim()).filter(Boolean);
  return processCueFiles({
    cueName: String(args.cue),
    inputs,
    outDir: String(args['out-dir']),
    isBgm: Boolean(args.bgm),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve(runAudioCli())
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error(err.message || err);
      process.exitCode = 1;
    });
}
