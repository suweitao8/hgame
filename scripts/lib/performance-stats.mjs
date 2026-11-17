import { numberOption } from './cli-numbers.mjs';

/** Linearly interpolated sample quantiles. Zero-duration CPU samples remain valid. */
export function summarizeSamples(values) {
  const sorted = values.filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!sorted.length) return { samples: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  const quantile = fraction => {
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  };
  return {
    samples: sorted.length,
    meanMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50Ms: quantile(0.5),
    p95Ms: quantile(0.95),
    p99Ms: quantile(0.99),
    maxMs: sorted.at(-1),
  };
}

export function measureWorkload(run, { samples = 30, warmup = 3, beforeEach = () => {} } = {}) {
  numberOption(samples, 'samples', { min: 1, integer: true });
  numberOption(warmup, 'warmup', { integer: true });
  const durations = [];
  for (let trial = 0; trial < warmup + samples; trial++) {
    beforeEach();
    const start = performance.now();
    run();
    const duration = performance.now() - start;
    if (trial >= warmup) durations.push(duration);
  }
  return { ...summarizeSamples(durations), warmup };
}

/** Self-contained so the same collector can be installed in a browser init script. */
export function createFrameTelemetry(sampleLimit = 600) {
  if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 1) throw new RangeError('Frame sample limit must be a positive integer.');
  const samples = [];
  let frames = 0;
  let totalMs = 0;
  let maxMs = 0;
  let longFrames = 0;
  let seed = 0x9e3779b9;
  return {
    record(value) {
      if (!Number.isFinite(value) || value <= 0) return;
      frames++;
      totalMs += value;
      maxMs = Math.max(maxMs, value);
      if (value > 50) longFrames++;
      if (samples.length < sampleLimit) {
        samples.push(value);
      } else {
        // Uniform reservoir sampling bounds detail memory while preserving whole-run totals.
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const slot = Math.floor((seed / 4294967296) * frames);
        if (slot < sampleLimit) samples[slot] = value;
      }
    },
    snapshot() {
      return { frames, totalMs, maxMs, longFrames, samples: samples.slice(), sampleLimit,
        quantilesApproximate: frames > samples.length };
    },
  };
}

export function summarizeFrameTelemetry(recording) {
  const stats = summarizeSamples(recording.samples);
  const meanMs = recording.frames ? recording.totalMs / recording.frames : 0;
  const round = value => +value.toFixed(2);
  return {
    frames: recording.frames,
    meanMs: round(meanMs),
    p50Ms: round(stats.p50Ms),
    p95Ms: round(stats.p95Ms),
    p99Ms: round(stats.p99Ms),
    maxMs: round(recording.maxMs),
    fps: meanMs > 0 ? +(1000 / meanMs).toFixed(1) : 0,
    longFrames: recording.longFrames,
    measuredMs: round(recording.totalMs),
    quantileSamples: stats.samples,
    quantilesApproximate: recording.quantilesApproximate,
  };
}
