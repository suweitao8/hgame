#!/usr/bin/env node
// Browser benchmarks for the Pixi horde, legacy sprite crowds, and the default 3D scene.
// Frame pacing is the default; --measurement readback measures synchronous pixel reads.
// --renderer pixi|webgl2d|canvas2d|three selects one workload; --count sets the 2D population.
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { summarizeSamples } from '../scripts/lib/performance-stats.mjs';
import { numberOption } from '../scripts/lib/cli-numbers.mjs';
import { benchmarkBrowserOptions, readBrowserEnvironment } from '../scripts/lib/browser-benchmark.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const renderers = ['pixi', 'webgl2d', 'canvas2d', 'three'];
const warmupFrames = 30;
let count, frames, budgetP95, gpu, launchOptions, measurement, selected;
try {
  gpu = opt('--gpu', 'software');
  launchOptions = benchmarkBrowserOptions(gpu);
  measurement = opt('--measurement', 'frame');
  if (!['frame', 'readback'].includes(measurement)) throw new RangeError('--measurement must be frame or readback');
  if (measurement === 'frame') launchOptions.args = launchOptions.args.filter(arg => arg !== '--disable-frame-rate-limit');
  const renderer = opt('--renderer');
  if (argv.includes('--renderer') && !renderers.includes(renderer)) throw new RangeError('--renderer must be pixi, webgl2d, canvas2d or three');
  selected = renderer ? [renderer] : renderers;
  count = numberOption(opt('--count', 10000), '--count', { min: 1, integer: true });
  frames = numberOption(opt('--frames', 90), '--frames', { min: 1, integer: true });
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

async function measureFrames({ frameCount, warmupFrames, readback }) {
  const sampleCount = frameCount + warmupFrames;
  const canvas = document.querySelector('#game');
  const gl = readback && (canvas.getContext('webgl2') || canvas.getContext('webgl'));
  const context2d = readback && !gl && canvas.getContext('2d');
  if (readback && !gl && !context2d) throw new Error('Synchronized readback requires WebGL or Canvas2D');
  const pixel = gl ? new Uint8Array(4) : null;
  const samples = [];
  let previous;
  await new Promise((resolve, reject) => {
    let request;
    const deadline = setTimeout(() => {
      cancelAnimationFrame(request);
      reject(new Error('Timed out waiting for render frame samples'));
    }, 120000);
    const frame = timestamp => {
      if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (context2d) context2d.getImageData(0, 0, 1, 1);
      const now = readback ? performance.now() : timestamp;
      if (previous !== undefined && now > previous) samples.push(now - previous);
      previous = now;
      if (samples.length < sampleCount) request = requestAnimationFrame(frame);
      else {
        clearTimeout(deadline);
        resolve();
      }
    };
    request = requestAnimationFrame(frame);
  });
  return samples.slice(warmupFrames);
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
    const profileFlags = renderer === 'pixi' ? ['--preset', 'horde', '--quality', 'medium'] :
      renderer === 'three' ? ['--profile', '3d'] : ['--profile', '2d', '--renderer', renderer];
    const gen = spawnSync(process.execPath, [path.join(root, 'scripts', 'create-game.mjs'), game, ...profileFlags, '--no-git'], { encoding: 'utf8' });
    if (gen.status !== 0) throw new Error(gen.stderr);
    if (renderer === 'pixi') {
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
    try {
      const url = `http://127.0.0.1:${port}/`;
      for (let i = 0; ; i++) { if (i > 100) throw new Error('preview failed'); try { if ((await fetch(url)).ok) break; } catch {} await new Promise(r => setTimeout(r, 60)); }
      const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text()); });
      page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`HTTP ${response.status()} ${response.url()}`); });
      // Keep the Pixi benchmark on WebGL so both Chrome GPU modes are verifiable.
      if (renderer === 'pixi') await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
      await page.goto(url);
      await page.locator('#game[data-engine-ready=true]').waitFor();
      const environment = await readBrowserEnvironment(page, browser, gpu);
      if (renderer !== 'canvas2d' && !environment.gpuModeMatches) errors.push(`Requested ${gpu} GPU, observed ${environment.actualGpu}: ${environment.renderer}`);
      const before = renderer === 'pixi' ? await page.evaluate(() => window.__hgameState()) : null;
      const intervals = await page.evaluate(measureFrames, { frameCount: frames, warmupFrames, readback: measurement === 'readback' });
      const after = renderer === 'pixi' ? await page.evaluate(() => window.__hgameState()) : null;
      if (after && (after.activeUnits !== count || after.tick <= before.tick)) errors.push('Pixi horde population or simulation did not match the workload');
      const timings = summarizeSamples(intervals);
      const r = { renderer, count: renderer === 'three' ? 0 : count, frames: timings.samples,
        meanMs: +timings.meanMs.toFixed(2), p50Ms: +timings.p50Ms.toFixed(2), p95Ms: +timings.p95Ms.toFixed(2),
        p99Ms: +timings.p99Ms.toFixed(2), maxMs: +timings.maxMs.toFixed(2), warmupFrames,
        longFrames: intervals.filter(ms => ms > 50).length, visibleUnits: after?.visibleUnits,
        measurementMode: measurement === 'readback' ? 'synchronized-readback' : 'frame-interval',
        budgetP95Ms: budgetP95, budgetKind: budgetP95 === null ? 'informational' :
          gpu === 'software' ? 'software-health' : measurement === 'readback' ? 'readback' : 'target-frame', environment, errors };
      r.gated = renderer !== 'canvas2d' && budgetP95 !== null;
      r.ok = !errors.length && timings.samples >= frames && (!r.gated || timings.p95Ms <= budgetP95);
      failed ||= !r.ok; results.push(r);
      const budgetLabel = r.gated ? ` (budget p95 ${budgetP95}ms)` : '';
      console.log(`${r.ok ? (r.gated ? 'PASS' : 'INFO') : 'FAIL'}  ${renderer}${renderer === 'three' ? ' (default 3D scene)' : ' x' + count}  mean ${r.meanMs}ms  p95 ${r.p95Ms}ms${budgetLabel}${errors.length ? '  errors: ' + errors.join('|') : ''}`);
      await page.close();
    } finally { server.kill(); }
  }
} finally { await browser?.close(); await new Promise(r => setTimeout(r, 300)); rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
const j = argv.indexOf('--json');
if (j >= 0) {
  const output = path.resolve(argv[j + 1]);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ node: process.version, percentileMethod: 'linear-interpolation', results }, null, 2));
}
process.exit(failed ? 1 : 0);

