#!/usr/bin/env node
// Browser render benchmark: N SpriteCrowd2D instances on the webgl2d and canvas2d renderers.
// Reports frame-time stats as JSON. Under CI software GL (SwiftShader) absolute numbers are pessimistic,
// so budgets are loose and mostly catch regressions (e.g. losing instancing). Usage:
//   node benchmarks/render-bench.mjs [--count 10000] [--frames 90] [--budget-p95 250] [--json out.json] [--chrome path]
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const count = Number(opt('--count', 10000));
const frames = Number(opt('--frames', 90));
const budgetP95 = Number(opt('--budget-p95', 250));
const chrome = opt('--chrome', process.env.HGAME_CHROME) || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const { chromium } = createRequire(import.meta.url)('playwright-core');

const frameProbe = `window.__frames = []; let last = performance.now();
const tick = now => { window.__frames.push(now - last); last = now; if (window.__frames.length < ${frames + 10}) requestAnimationFrame(tick); else window.__done = true; };
requestAnimationFrame(tick);`;
const bench = (mod) => `
const { SpriteCrowd2D: Crowd } = await import(base + '/integrations/${mod}.js');
const host = scene.add(new Entity({ x: 0, y: 0 }));
const crowd = host.addComponent(new Crowd({ capacity: ${count + 100}, width: 10, height: 10, color: '#ff8844' }));
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
for (let i = 0; i < ${count}; i++) crowd.spawn({ x: rnd() * 900 - 450, y: rnd() * 500 - 250 });
window.__frames = []; let last = performance.now();
const tick = now => { window.__frames.push(now - last); last = now; if (window.__frames.length < ${frames + 10}) requestAnimationFrame(tick); else window.__done = true; };
requestAnimationFrame(tick);
`;

async function freePort() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
const tmp = mkdtempSync(path.join(os.tmpdir(), 'hgame-rbench-'));
const results = [];
let browser, failed = false;
try {
  browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--disable-frame-rate-limit'] });
  for (const renderer of ['webgl2d', 'canvas2d', 'three']) {
    const game = path.join(tmp, renderer);
    const gen = spawnSync(process.execPath, [path.join(root, 'scripts', 'create-game.mjs'), game, '--profile', renderer === 'three' ? '3d' : '2d', ...(renderer === 'three' ? [] : ['--renderer', renderer]), '--no-git'], { encoding: 'utf8' });
    if (gen.status !== 0) throw new Error(gen.stderr);
    const mainPath = path.join(game, 'src', 'main.js');
    const probe = renderer === 'three' ? frameProbe.replace('${frames + 10}', String(frames + 10)) : bench(renderer);
    const src = readFileSync(mainPath, 'utf8').replace(/app\.scenes\.start\('(\w+)'\);/, (m) => probe + '\n' + m);
    writeFileSync(mainPath, src);
    const port = await freePort();
    const server = spawn(process.execPath, [path.join(root, 'scripts', 'preview.mjs'), game, '--port', String(port)], { stdio: 'ignore' });
    try {
      const url = `http://127.0.0.1:${port}/`;
      for (let i = 0; ; i++) { if (i > 100) throw new Error('preview failed'); try { if ((await fetch(url)).ok) break; } catch {} await new Promise(r => setTimeout(r, 60)); }
      const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(url);
      await page.waitForFunction('window.__done === true', null, { timeout: 120000 });
      const f = (await page.evaluate('window.__frames')).slice(10).sort((a, b) => a - b);
      const mean = f.reduce((a, b) => a + b, 0) / f.length;
      const r = { renderer, count: renderer === 'three' ? 0 : count, frames: f.length, meanMs: +mean.toFixed(2), p50Ms: +f[f.length >> 1].toFixed(2),
        p95Ms: +f[Math.floor(f.length * 0.95)].toFixed(2), maxMs: +f.at(-1).toFixed(2), errors };
      // Only the instanced webgl2d path is budgeted; canvas2d is the compatibility fallback and is reported for information.
      r.gated = renderer !== 'canvas2d';
      r.ok = !errors.length && (!r.gated || r.p95Ms <= budgetP95);
      failed ||= !r.ok; results.push(r);
      console.log(`${r.ok ? (r.gated ? 'PASS' : 'INFO') : 'FAIL'}  ${renderer}${renderer === 'three' ? ' (default 3D scene)' : ' x' + count}  mean ${r.meanMs}ms  p95 ${r.p95Ms}ms  (budget p95 ${budgetP95}ms)${errors.length ? '  errors: ' + errors.join('|') : ''}`);
      await page.close();
    } finally { server.kill(); }
  }
} finally { await browser?.close(); await new Promise(r => setTimeout(r, 300)); rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
const j = argv.indexOf('--json'); if (j >= 0) writeFileSync(argv[j + 1], JSON.stringify({ node: process.version, results }, null, 2));
process.exit(failed ? 1 : 0);

