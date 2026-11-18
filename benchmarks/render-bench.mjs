#!/usr/bin/env node
// Browser benchmarks for the Pixi horde, legacy sprite crowds, and the default 3D scene.
// Frame pacing is the default; --measurement readback measures synchronous pixel reads.
// --renderer pixi|webgl2d|canvas2d|three selects one workload; --count sets the 2D population.
// --soak-seconds records a fixed-duration workload with five-second window summaries.
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { summarizeSamples } from '../scripts/lib/performance-stats.mjs';
import { numberOption, viewportOption } from '../scripts/lib/cli-numbers.mjs';
import { benchmarkBrowserOptions, readBrowserEnvironment } from '../scripts/lib/browser-benchmark.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const renderers = ['pixi', 'webgl2d', 'canvas2d', 'three'];
const warmupFrames = 30;
let count, frames, soakSeconds, budgetP95, gpu, launchOptions, measurement, selected, backend, viewport, dpr, quality;
const touch = argv.includes('--touch');
try {
  gpu = opt('--gpu', 'software');
  launchOptions = benchmarkBrowserOptions(gpu);
  measurement = opt('--measurement', 'frame');
  if (!['frame', 'readback'].includes(measurement)) throw new RangeError('--measurement must be frame or readback');
  if (measurement === 'frame') launchOptions.args = launchOptions.args.filter(arg => arg !== '--disable-frame-rate-limit');
  const renderer = opt('--renderer');
  if (argv.includes('--renderer') && !renderers.includes(renderer)) throw new RangeError('--renderer must be pixi, webgl2d, canvas2d or three');
  selected = renderer ? [renderer] : renderers;
  backend = opt('--backend', 'webgl');
  if (!['auto', 'webgpu', 'webgl', 'canvas'].includes(backend)) throw new RangeError('--backend must be auto, webgpu, webgl, or canvas');
  if (backend === 'webgpu' && measurement === 'readback' && selected.includes('pixi')) {
    throw new RangeError('Use --measurement frame for the Pixi WebGPU backend');
  }
  viewport = viewportOption(opt('--viewport', touch ? '844x390' : '960x540'));
  dpr = numberOption(opt('--dpr', touch ? 2 : 1), '--dpr', { min: 0.5, max: 8 });
  quality = opt('--quality', 'medium');
  if (!['auto', 'low', 'medium', 'high', 'ultra'].includes(quality)) throw new RangeError('--quality must be auto, low, medium, high, or ultra');
  count = numberOption(opt('--count', 10000), '--count', { min: 1, integer: true });
  frames = numberOption(opt('--frames', 90), '--frames', { min: 1, integer: true });
  soakSeconds = argv.includes('--soak-seconds')
    ? numberOption(opt('--soak-seconds'), '--soak-seconds', { min: 5, max: 300, integer: true })
    : 0;
  if (soakSeconds && (argv.includes('--frames') || measurement !== 'frame')) {
    throw new RangeError('--soak-seconds requires frame pacing and cannot be combined with --frames');
  }
  const defaultBudget = gpu === 'software' ? 250 : measurement === 'frame' ? 1000 / 60 + 1 : null;
  const budget = opt('--budget-p95', defaultBudget);
  budgetP95 = budget === null ? null : numberOption(budget, '--budget-p95', { min: 0.01 });
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
const chrome = opt('--chrome', process.env.HGAME_CHROME) || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const { chromium } = createRequire(import.meta.url)('playwright-core');
const measurementMode = measurement === 'readback' ? 'synchronized-readback' : 'frame-interval';

async function measureFrames({ frameCount, durationMs, warmupFrames, readback }) {
  const canvas = document.querySelector('#game');
  const gl = readback && (canvas.getContext('webgl2') || canvas.getContext('webgl'));
  const context2d = readback && !gl && canvas.getContext('2d');
  if (readback && !gl && !context2d) throw new Error('Synchronized readback requires WebGL or Canvas2D');
  const pixel = gl ? new Uint8Array(4) : null;
  const samples = [];
  const windows = [];
  let elapsedMs = 0;
  let windowStartMs = 0;
  let windowStartSample = 0;
  let warmed = 0;
  let previous;
  let timedOut = false;
  function checkpoint() {
    if (!durationMs || samples.length === windowStartSample) return;
    windows.push({
      startMs: windowStartMs, endMs: elapsedMs, fromSample: windowStartSample, toSample: samples.length,
      qualityTier: canvas.dataset.qualityTier ?? null,
      canvasPixels: [canvas.width, canvas.height],
    });
    windowStartMs = elapsedMs;
    windowStartSample = samples.length;
  }
  await new Promise(resolve => {
    let request;
    const deadline = setTimeout(() => {
      cancelAnimationFrame(request);
      timedOut = true;
      checkpoint();
      resolve();
    }, Math.max(120000, durationMs + 30000));
    const frame = timestamp => {
      if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (context2d) context2d.getImageData(0, 0, 1, 1);
      const now = readback ? performance.now() : timestamp;
      if (previous !== undefined && now > previous) {
        if (warmed < warmupFrames) {
          warmed++;
        } else {
          const interval = now - previous;
          elapsedMs += interval;
          samples.push(interval);
          if (durationMs && (elapsedMs - windowStartMs >= 5000 || elapsedMs >= durationMs)) checkpoint();
        }
      }
      previous = now;
      if (durationMs ? elapsedMs < durationMs : samples.length < frameCount) request = requestAnimationFrame(frame);
      else {
        clearTimeout(deadline);
        resolve();
      }
    };
    request = requestAnimationFrame(frame);
  });
  return { samples, elapsedMs, windows, timedOut };
}
const bench = (mod) => `
const { SpriteCrowd2D: Crowd } = await import(base + '/integrations/${mod}.js');
const host = scene.add(new Entity({ x: 0, y: 0 }));
const crowd = host.addComponent(new Crowd({ capacity: ${count + 100}, width: 10, height: 10, color: '#ff8844' }));
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
for (let i = 0; i < ${count}; i++) crowd.spawn({ x: rnd() * 900 - 450, y: rnd() * 500 - 250 });
`;

async function freePort() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
const tmp = mkdtempSync(path.join(os.tmpdir(), 'hgame-rbench-'));
const results = [];
let browser, failed = false;
try {
  browser = await chromium.launch({ ...launchOptions, ...(chrome ? { executablePath: chrome } : {}) });
  for (const renderer of selected) {
    const game = path.join(tmp, renderer);
    const profileFlags = renderer === 'pixi' ? ['--preset', 'horde', '--quality', quality] :
      renderer === 'three' ? ['--profile', '3d'] : ['--profile', '2d', '--renderer', renderer];
    const gen = spawnSync(process.execPath, [path.join(root, 'scripts', 'create-game.mjs'), game, ...profileFlags, '--no-git'], { encoding: 'utf8' });
    if (gen.status !== 0) throw new Error(gen.stderr);
    if (renderer === 'pixi') {
      const presentationPath = path.join(game, 'src', 'presentation.json');
      const presentation = JSON.parse(readFileSync(presentationPath, 'utf8'));
      presentation.backend = backend;
      writeFileSync(presentationPath, JSON.stringify(presentation));
      const settingsPath = path.join(game, 'src', 'swarm.json');
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      settings.capacity = Math.max(settings.capacity, count);
      settings.initialCount = count;
      writeFileSync(settingsPath, JSON.stringify(settings));
    } else if (renderer !== 'three') {
      const mainPath = path.join(game, 'src', 'main.js');
      const entry = readFileSync(mainPath, 'utf8');
      const updated = entry.replace("app.scenes.start('main');", statement => bench(renderer) + '\n' + statement);
      if (updated === entry) throw new Error('The legacy benchmark could not insert its crowd into ' + renderer);
      writeFileSync(mainPath, updated);
    }
    const port = await freePort();
    const server = spawn(process.execPath, [path.join(root, 'scripts', 'preview.mjs'), game, '--port', String(port)], { stdio: 'ignore', windowsHide: true });
    const errors = [];
    let page;
    try {
      const url = `http://127.0.0.1:${port}/`;
      for (let i = 0; ; i++) { if (i > 100) throw new Error('preview failed'); try { if ((await fetch(url)).ok) break; } catch {} await new Promise(r => setTimeout(r, 60)); }
      page = await browser.newPage({ viewport, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text()); });
      page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`HTTP ${response.status()} ${response.url()}`); });
      await page.goto(url);
      try {
        await page.locator('#game[data-engine-ready=true]').waitFor({ timeout: 15000 });
      } catch (error) {
        throw new Error('Renderer did not become ready: ' + errors.join(' | '), { cause: error });
      }
      const environment = await readBrowserEnvironment(page, browser, gpu);
      if (environment.backend === 'webgpu' && measurement === 'readback') {
        throw new Error('Use --measurement frame for the selected WebGPU backend');
      }
      const allowsCanvas = renderer === 'canvas2d' ||
        (renderer === 'pixi' && (backend === 'canvas' || backend === 'auto'));
      const usesCanvas = environment.backend === 'canvas' && allowsCanvas;
      if (!usesCanvas && !environment.gpuModeMatches) errors.push(`Requested ${gpu} GPU, observed ${environment.actualGpu}: ${environment.renderer}`);
      if (renderer === 'pixi' && backend !== 'auto' && environment.backend !== backend) {
        errors.push(`Requested Pixi ${backend}, observed ${environment.backend}`);
      }
      const before = renderer === 'pixi' ? await page.evaluate(() => window.__hgameState()) : null;
      const { samples: intervals, elapsedMs, windows, timedOut } = await page.evaluate(measureFrames, {
        frameCount: frames, durationMs: soakSeconds * 1000, warmupFrames, readback: measurement === 'readback',
      });
      if (timedOut) errors.push('Timed out waiting for render frame samples');
      const after = renderer === 'pixi' ? await page.evaluate(() => window.__hgameState()) : null;
      const finalEnvironment = await readBrowserEnvironment(page, browser, gpu);
      if (finalEnvironment.backend !== environment.backend || finalEnvironment.actualGpu !== environment.actualGpu) {
        errors.push('Renderer backend or GPU mode changed during sampling');
      }
      if (after && (after.activeUnits !== count || after.tick <= before.tick)) errors.push('Pixi horde population or simulation did not match the workload');
      const timings = summarizeSamples(intervals);
      const windowResults = windows.map(({ fromSample, toSample, ...window }) => {
        const samples = intervals.slice(fromSample, toSample);
        return { ...window, longFrames: samples.filter(ms => ms > 50).length, ...summarizeSamples(samples) };
      });
      const worstWindowP95Ms = windowResults.length ? Math.max(...windowResults.map(window => window.p95Ms)) : null;
      const r = { renderer, count: renderer === 'three' ? 0 : count, frames: timings.samples,
        meanMs: +timings.meanMs.toFixed(2), p50Ms: +timings.p50Ms.toFixed(2), p95Ms: +timings.p95Ms.toFixed(2),
        p99Ms: +timings.p99Ms.toFixed(2), maxMs: +timings.maxMs.toFixed(2), warmupFrames,
        longFrames: intervals.filter(ms => ms > 50).length, visibleUnits: after?.visibleUnits,
        measurementMode, elapsedMs, ...(soakSeconds ? { soakSeconds, worstWindowP95Ms, windows: windowResults } : {}),
        requestedBackend: renderer === 'pixi' ? backend : undefined,
        requestedQuality: renderer === 'pixi' ? quality : undefined,
        budgetP95Ms: budgetP95, budgetKind: usesCanvas || budgetP95 === null ? 'informational' :
          gpu === 'software' ? 'software-health' : measurement === 'readback' ? 'readback' : 'target-frame', environment, finalEnvironment, errors };
      r.gated = !usesCanvas && budgetP95 !== null;
      const workloadComplete = soakSeconds ? elapsedMs >= soakSeconds * 1000 && timings.samples > 0 : timings.samples >= frames;
      r.ok = !errors.length && workloadComplete && (!r.gated || timings.p95Ms <= budgetP95);
      failed ||= !r.ok; results.push(r);
      const budgetLabel = r.gated ? ` (budget p95 ${budgetP95}ms)` : '';
      const windowLabel = worstWindowP95Ms === null ? '' : `, worst window p95 ${worstWindowP95Ms.toFixed(2)}ms`;
      console.log(`${r.ok ? (r.gated ? 'PASS' : 'INFO') : 'FAIL'}  ${renderer}${renderer === 'three' ? ' (default 3D scene)' : ' x' + count}  mean ${r.meanMs}ms  p95 ${r.p95Ms}ms${windowLabel}${budgetLabel}${errors.length ? '  errors: ' + errors.join('|') : ''}`);
    } catch (error) {
      failed = true;
      errors.push(error.message);
      results.push({ renderer, measurementMode, frames: 0, ok: false, errors });
      console.error('FAIL  ' + renderer + '  ' + errors.join(' | '));
    } finally {
      try { await page?.close(); } finally { server.kill(); }
    }
  }
} finally { await browser?.close(); await new Promise(r => setTimeout(r, 300)); rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
const j = argv.indexOf('--json');
if (j >= 0) {
  const output = path.resolve(argv[j + 1]);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ node: process.version, percentileMethod: 'linear-interpolation', results }, null, 2));
}
process.exit(failed ? 1 : 0);

