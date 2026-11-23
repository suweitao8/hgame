import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaytestActions, summarizeFrameDeltas } from '../scripts/playtest.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

test('multi-second stalls remain in playtest frame statistics', () => {
  const stats = summarizeFrameDeltas([16, NaN, 0, -1, Infinity, 3000]);
  assert.equal(stats.frames, 2);
  assert.equal(stats.maxMs, 3000);
  assert.equal(stats.meanMs, 1508);
  assert.equal(stats.longFrames, 1);
});

test('sample distributions include median, tails and invalid-sample filtering', async () => {
  const { summarizeSamples } = await import('../scripts/lib/performance-stats.mjs');
  const stats = summarizeSamples([40, 10, 30, 20, NaN, -1, Infinity]);
  assert.equal(stats.samples, 4);
  assert.equal(stats.meanMs, 25);
  assert.equal(stats.p50Ms, 25);
  assert.equal(stats.p95Ms, 38.5);
  assert.ok(Math.abs(stats.p99Ms - 39.7) < 1e-9);
  assert.equal(stats.maxMs, 40);
  assert.equal(summarizeSamples([]).samples, 0);
  assert.equal(summarizeSamples([]).p99Ms, 0);
  assert.equal(summarizeSamples([0]).samples, 1);
});

test('bounded frame detail retains whole-run counts, duration and multi-second maxima', async () => {
  const { createFrameTelemetry, summarizeFrameTelemetry } = await import('../scripts/lib/performance-stats.mjs');
  const collector = createFrameTelemetry(8);
  for (let value = 1; value <= 2000; value++) collector.record(value);
  collector.record(3000);
  collector.record(NaN);
  collector.record(-5);
  const recording = collector.snapshot();
  assert.equal(recording.samples.length, 8);
  assert.equal(recording.frames, 2001);
  assert.equal(recording.totalMs, 2004000);
  assert.equal(recording.maxMs, 3000);
  assert.equal(recording.longFrames, 1951);
  const stats = summarizeFrameTelemetry(recording);
  assert.equal(stats.frames, 2001);
  assert.equal(stats.maxMs, 3000);
  assert.equal(stats.quantileSamples, 8);
  assert.equal(stats.quantilesApproximate, true);
  assert.equal(stats.meanMs, 1001.5);
});

test('numeric options reject nonfinite values and invalid dimensions before running workloads', async () => {
  const { numberOption, viewportOption } = await import('../scripts/lib/cli-numbers.mjs');
  assert.equal(numberOption('0', '--wait'), 0);
  assert.equal(numberOption('16.5', '--duration'), 16.5);
  for (const raw of ['NaN', 'Infinity', '', -1, [], null]) assert.throws(() => numberOption(raw, '--duration'), /duration/);
  assert.throws(() => numberOption('1.5', '--frames', { integer: true }), /frames/);
  assert.throws(() => numberOption('2', '--threshold', { max: 1 }), /threshold/);
  assert.deepEqual(viewportOption('960x540'), { width: 960, height: 540 });
  for (const raw of ['0x540', '960xNaN', '960x540x1']) assert.throws(() => viewportOption(raw), /viewport/);
});

test('workload measurement separates preparation and warmup from retained samples', async () => {
  const { measureWorkload } = await import('../scripts/lib/performance-stats.mjs');
  let ready = false;
  let calls = 0;
  const stats = measureWorkload(() => {
    assert.equal(ready, true);
    ready = false;
    calls++;
  }, { samples: 3, warmup: 2, beforeEach() { ready = true; } });
  assert.equal(calls, 5);
  assert.equal(stats.samples, 3);
  assert.equal(stats.warmup, 2);
  assert.ok(stats.p99Ms >= stats.p50Ms);
  assert.throws(() => measureWorkload(() => {}, { samples: 0 }), /samples/);
});

test('GPU provenance distinguishes software fallback from identified hardware and hidden renderer data', async () => {
  const { classifyGpuRenderer, benchmarkBrowserOptions } = await import('../scripts/lib/browser-benchmark.mjs');
  assert.equal(classifyGpuRenderer('ANGLE (Google, Vulkan (SwiftShader Device (Subzero)))'), 'software');
  assert.equal(classifyGpuRenderer('llvmpipe (LLVM 17.0.6)'), 'software');
  assert.equal(classifyGpuRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11)'), 'hardware');
  assert.equal(classifyGpuRenderer('WebKit WebGL'), 'unknown');
  assert.equal(classifyGpuRenderer('Canvas2D'), 'none');
  assert.throws(() => benchmarkBrowserOptions('fast'), /gpu/i);
});

test('explicit invalid action durations fail instead of silently changing input timing', () => {
  assert.throws(() => parsePlaytestActions('d:NaN'), /duration/i);
  assert.throws(() => parsePlaytestActions('wait:-1'), /duration/i);
});

test('performance CLIs reject invalid numeric options before opening a browser', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const game = path.join(root, 'examples/survivor-2d');
  const cases = [
    ['scripts/snapshot.mjs', [game, '--steps', 'NaN'], /steps/],
    ['scripts/snapshot.mjs', [game, '--threshold', 'Infinity'], /threshold/],
    ['scripts/snapshot.mjs', [game, '--viewport', '0x540'], /viewport/],
    ['scripts/playtest.mjs', [game, '--duration', 'NaN'], /duration/],
    ['scripts/playtest.mjs', [game, '--max-long-frames', '-1'], /long-frames/],
    ['benchmarks/run.mjs', ['--samples', '0'], /samples/],
    ['benchmarks/render-bench.mjs', ['--frames', 'NaN'], /frames/],
    ['benchmarks/render-bench-3d.mjs', ['--instances', '-1'], /instances/],
    ['benchmarks/render-bench.mjs', ['--gpu', 'fast'], /gpu/],
  ];
  for (const [script, args, expected] of cases) {
    const result = spawnSync(process.execPath, [path.join(root, script), ...args], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    assert.ifError(result.error);
    assert.equal(result.status, 2, script + '\n' + result.stdout + result.stderr);
    assert.match(result.stderr, expected);
  }
});
