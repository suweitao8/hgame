#!/usr/bin/env node
// Browser render benchmark: N SpriteCrowd2D instances on the webgl2d and canvas2d renderers.
// Reports frame-time stats as JSON. Under CI software GL (SwiftShader) absolute numbers are pessimistic,
// so budgets are loose and mostly catch regressions (e.g. losing instancing). Usage:
//   node benchmarks/render-bench.mjs [--count 10000] [--frames 90] [--budget-p95 250] [--json out.json] [--chrome path]
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
let count, frames, budgetP95, gpu, launchOptions;
try {
  gpu = opt('--gpu', 'software');
  launchOptions = benchmarkBrowserOptions(gpu);
  count = numberOption(opt('--count', 10000), '--count', { min: 1, integer: true });
  frames = numberOption(opt('--frames', 90), '--frames', { min: 1, integer: true });
  budgetP95 = numberOption(opt('--budget-p95', gpu === 'hardware' ? 1000 / 60 : 250), '--budget-p95');
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
const chrome = opt('--chrome', process.env.HGAME_CHROME) || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const { chromium } = createRequire(import.meta.url)('playwright-core');

const frameProbe = `window.__frames = []; let last = performance.now();
const probeCanvas = document.querySelector('#game');
const probeGl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
const probe2d = probeGl ? null : probeCanvas.getContext('2d');
const probePixel = new Uint8Array(4);
const tick = () => {
  if (probeGl) probeGl.readPixels(0, 0, 1, 1, probeGl.RGBA, probeGl.UNSIGNED_BYTE, probePixel);
  else probe2d.getImageData(0, 0, 1, 1);
  const now = performance.now(); window.__frames.push(now - last); last = now;
  if (window.__frames.length < ${frames + 10}) requestAnimationFrame(tick); else window.__done = true;
};
requestAnimationFrame(tick);`;
const bench = (mod) => `
const { SpriteCrowd2D: Crowd } = await import(base + '/integrations/${mod}.js');
const host = scene.add(new Entity({ x: 0, y: 0 }));
const crowd = host.addComponent(new Crowd({ capacity: ${count + 100}, width: 10, height: 10, color: '#ff8844' }));
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
for (let i = 0; i < ${count}; i++) crowd.spawn({ x: rnd() * 900 - 450, y: rnd() * 500 - 250 });
${frameProbe}
`;

async function freePort() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
const tmp = mkdtempSync(path.join(os.tmpdir(), 'hgame-rbench-'));
const results = [];
let browser, failed = false;
try {
  browser = await chromium.launch({ ...launchOptions, ...(chrome ? { executablePath: chrome } : {}) });
  for (const renderer of ['webgl2d', 'canvas2d', 'three']) {
    const game = path.join(tmp, renderer);
    const gen = spawnSync(process.execPath, [path.join(root, 'scripts', 'create-game.mjs'), game, '--profile', renderer === 'three' ? '3d' : '2d', ...(renderer === 'three' ? [] : ['--renderer', renderer]), '--no-git'], { encoding: 'utf8' });
    if (gen.status !== 0) throw new Error(gen.stderr);
    const mainPath = path.join(game, 'src', 'main.js');
    const probe = renderer === 'three' ? frameProbe : bench(renderer);
    const src = readFileSync(mainPath, 'utf8').replace(/app\.scenes\.start\('(\w+)'\);/, (m) => probe + '\n' + m);
    writeFileSync(mainPath, src);
    const port = await freePort();
    const server = spawn(process.execPath, [path.join(root, 'scripts', 'preview.mjs'), game, '--port', String(port)], { stdio: 'ignore', windowsHide: true });
    try {
      const url = `http://127.0.0.1:${port}/`;
      for (let i = 0; ; i++) { if (i > 100) throw new Error('preview failed'); try { if ((await fetch(url)).ok) break; } catch {} await new Promise(r => setTimeout(r, 60)); }
      const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text()); });
      page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`HTTP ${response.status()} ${response.url()}`); });
      await page.goto(url);
      await page.locator('#game[data-engine-ready=true]').waitFor();
      const environment = await readBrowserEnvironment(page, browser, gpu);
      if (renderer !== 'canvas2d' && !environment.gpuModeMatches) errors.push(`Requested ${gpu} GPU, observed ${environment.actualGpu}: ${environment.renderer}`);
      await page.waitForFunction('window.__done === true', null, { timeout: 120000 });
      const timings = summarizeSamples((await page.evaluate('window.__frames')).slice(10).filter(value => value > 0));
      const r = { renderer, count: renderer === 'three' ? 0 : count, frames: timings.samples,
        meanMs: +timings.meanMs.toFixed(2), p50Ms: +timings.p50Ms.toFixed(2), p95Ms: +timings.p95Ms.toFixed(2),
        p99Ms: +timings.p99Ms.toFixed(2), maxMs: +timings.maxMs.toFixed(2), warmupFrames: 10,
        measurementMode: 'synchronized-readback',
        budgetP95Ms: budgetP95, budgetKind: gpu === 'software' ? 'software-health' : 'target-frame', environment, errors };
      // Only the instanced webgl2d path is budgeted; canvas2d is the compatibility fallback and is reported for information.
      r.gated = renderer !== 'canvas2d';
      r.ok = !errors.length && timings.samples >= frames && (!r.gated || timings.p95Ms <= budgetP95);
      failed ||= !r.ok; results.push(r);
      console.log(`${r.ok ? (r.gated ? 'PASS' : 'INFO') : 'FAIL'}  ${renderer}${renderer === 'three' ? ' (default 3D scene)' : ' x' + count}  mean ${r.meanMs}ms  p95 ${r.p95Ms}ms  (budget p95 ${budgetP95}ms)${errors.length ? '  errors: ' + errors.join('|') : ''}`);
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

