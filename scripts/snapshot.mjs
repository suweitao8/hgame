#!/usr/bin/env node
// Headless render snapshot for AI agents: serves a game dir, screenshots the canvas, and prints
// machine-readable stats (blank ratio, luma, colors, hash, console/HTTP errors) plus an optional
// pixel diff against a baseline PNG.
//
//   node scripts/snapshot.mjs <game-dir> [--out snap.png] [--wait 800] [--keys d:360,space:100]
//        [--selector "#game"] [--viewport 960x540] [--baseline base.png] [--update-baseline]
//        [--eval "<js expr>"] [--freeze-time] [--steps N] [--state-hook __hgameState]
//        [--threshold 0.01] [--query horde=3000] [--chrome <path>] [--ready "#game[data-engine-ready=true]"]
//
// Exit code 1 when: page errors, blank canvas, or baseline diff above threshold.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { writeSnapshotOutput } from './lib/snapshot-output.mjs';
import { numberOption, viewportOption } from './lib/cli-numbers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const flag = name => argv.includes(name);
const gameDir = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['--update-baseline', '--freeze-time'].includes(argv[i - 1])));
if (!gameDir) { console.error('Usage: node scripts/snapshot.mjs <game-dir> [options] (see file header)'); process.exit(2); }

const outPng = path.resolve(opt('--out', path.join(gameDir, 'build', 'snapshot.png')));
const selector = opt('--selector', '#game');
const ready = opt('--ready', '');
const baseline = opt('--baseline', '');
const query = opt('--query', '');
const evalExpr = opt('--eval', '');
const freeze = flag('--freeze-time') || argv.includes('--steps');
const stepsArg = opt('--steps', '');
const stateHook = opt('--state-hook', '__hgameState');
const FRAME_MS = 1000 / 60;
let waitMs, threshold, viewport, requestedSteps, keys;
try {
  waitMs = numberOption(opt('--wait', 800), '--wait');
  threshold = numberOption(opt('--threshold', 0.01), '--threshold', { max: 1 });
  viewport = viewportOption(opt('--viewport', '960x540'));
  if (argv.includes('--steps')) requestedSteps = numberOption(stepsArg, '--steps', { integer: true });
  keys = opt('--keys', '').split(',').filter(Boolean).map(token => {
    const [key, ms] = token.split(':');
    return { key: key === 'space' ? ' ' : key, ms: numberOption(ms || 150, '--keys duration') };
  });
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
const { width: vw, height: vh } = viewport;

function findChrome() {
  const env = opt('--chrome', process.env.HGAME_CHROME);
  if (env) return env;
  const c = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return c.find(existsSync);
}
async function freePort() {
  const s = createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}

// Runs inside the page: decodes PNG data URLs and measures them.
const analyze = async ({ shot, base }) => {
  const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const pixels = async src => {
    const img = await load(src);
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, d: g.getImageData(0, 0, img.width, img.height).data };
  };
  const a = await pixels(shot);
  const colors = new Set(); let lumaSum = 0, nonBlank = 0;
  const first = [a.d[0], a.d[1], a.d[2]];
  const hist = new Array(8).fill(0);
  for (let i = 0; i < a.d.length; i += 4) {
    const r = a.d[i], g = a.d[i + 1], b = a.d[i + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lumaSum += l; hist[Math.min(7, l >> 5)]++;
    if (r !== first[0] || g !== first[1] || b !== first[2]) nonBlank++;
    if (colors.size < 5000) colors.add((r << 16) | (g << 8) | b);
  }
  const n = a.w * a.h;
  const stats = { width: a.w, height: a.h, nonBlankRatio: +(nonBlank / n).toFixed(4), meanLuma: +(lumaSum / n).toFixed(2),
    uniqueColors: colors.size >= 5000 ? '5000+' : colors.size, lumaHistogram8: hist.map(v => +(v / n).toFixed(4)) };
  let diff = null;
  if (base) {
    const b = await pixels(base);
    if (b.w !== a.w || b.h !== a.h) diff = { sizeMismatch: [b.w, b.h], diffRatio: 1 };
    else {
      let bad = 0, minX = a.w, minY = a.h, maxX = -1, maxY = -1;
      for (let i = 0, p = 0; i < a.d.length; i += 4, p++) {
        const m = Math.max(Math.abs(a.d[i] - b.d[i]), Math.abs(a.d[i + 1] - b.d[i + 1]), Math.abs(a.d[i + 2] - b.d[i + 2]));
        if (m > 8) { bad++; const x = p % a.w, y = (p / a.w) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
      diff = { diffRatio: +(bad / n).toFixed(5), bbox: bad ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null };
    }
  }
  return { stats, diff };
};

// Deterministic clock, installed before page scripts. rAF callbacks only run when stepped; time only
// advances by 1/60 s per stepped frame. Math.random is seeded. Games opt in by simply using
// performance.now/Date.now/requestAnimationFrame/Math.random (setTimeout is not virtualised).
const freezeClock = (frameMs) => {
  let now = 0; let q = []; let id = 0;
  const base = 1700000000000;
  performance.now = () => now;
  Date.now = () => base + Math.round(now);
  const RealDate = Date;
  window.Date = new Proxy(RealDate, { construct(t, a) { return a.length ? new t(...a) : new t(base + Math.round(now)); } });
  window.requestAnimationFrame = cb => { q.push([++id, cb]); return id; };
  window.cancelAnimationFrame = i => { q = q.filter(e => e[0] !== i); };
  let seed = 0x9e3779b9;
  Math.random = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  window.__hgameStep = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += frameMs; const run = q; q = [];
      for (const [, cb] of run) { try { cb(now); } catch (e) { setTimeout(() => { throw e; }); } }
    }
    return now;
  };
};
const exe = findChrome();
const { chromium } = createRequire(import.meta.url)('playwright-core');
const port = await freePort();
const server = spawn(process.execPath, [path.join(root, 'scripts', 'preview.mjs'), path.resolve(gameDir), '--port', String(port)],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
const report = { ok: true, problems: [] };
try {
  const url = `http://127.0.0.1:${port}/` + (query ? '?' + query.replace(/^\?/, '') : '');
  for (let i = 0; ; i++) {
    if (server.exitCode !== null || i > 100) throw new Error('preview server failed to start');
    try { if ((await fetch(url)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 60));
  }
  browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
  const consoleErrors = [], httpErrors = [];
  page.on('pageerror', e => consoleErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) consoleErrors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) httpErrors.push(`HTTP ${r.status()} ${r.url()}`); });
  if (freeze) await page.addInitScript(freezeClock, FRAME_MS);
  const step = n => page.evaluate(k => window.__hgameStep(k), n);
  await page.goto(url, { waitUntil: 'load' });
  if (ready) {
    // Under a frozen clock, wait un-stepped first so the number of pre-ready frames is deterministic;
    // only pump frames if the page needs them to become ready.
    const ok = await page.locator(ready).waitFor({ timeout: freeze ? 4000 : 20000 }).then(() => true, () => false);
    if (!ok) {
      if (!freeze) throw new Error('ready selector timeout');
      const t0 = Date.now();
      for (;;) { await step(1); if (await page.locator(ready).count()) break; if (Date.now() - t0 > 20000) throw new Error('ready selector timeout'); await page.waitForTimeout(5); }
    }
  }
  if (freeze) {
    await page.waitForTimeout(50);
    await step(requestedSteps ?? Math.round(waitMs / FRAME_MS));
    for (const { key, ms } of keys) { await page.keyboard.down(key); await step(Math.max(1, Math.round(ms / FRAME_MS))); await page.keyboard.up(key); await step(1); }
  } else {
    await page.waitForTimeout(waitMs);
    for (const { key, ms } of keys) { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); }
  }
  if (evalExpr) {
    try { report.eval = await page.evaluate(async src => JSON.parse(JSON.stringify(await (0, eval)(src) ?? null)), evalExpr); }
    catch (e) { report.problems.push('eval failed: ' + String(e.message || e).split('\n')[0]); }
  }
  const st = await page.evaluate(async n => typeof window[n] === 'function' ? { v: JSON.parse(JSON.stringify(await window[n]() ?? null)) } : null, stateHook).catch(e => ({ err: String(e.message || e) }));
  if (st?.err) report.problems.push('state hook failed: ' + st.err); else if (st) report.state = st.v;
  const target = page.locator(selector);
  let png;
  if (freeze) {
    // Freeze CSS motion before measuring the clip, then avoid locator stability waits.
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }' });
    await target.evaluate(element => element.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' }));
    const bounds = await target.boundingBox();
    if (!bounds) throw new Error('Snapshot target is not visible.');
    png = await page.screenshot({ clip: bounds, animations: 'disabled' });
  } else {
    png = await target.screenshot();
  }
  const baseB64 = baseline && existsSync(baseline) && !flag('--update-baseline')
    ? 'data:image/png;base64,' + readFileSync(baseline).toString('base64') : null;
  const { stats, diff } = await page.evaluate(analyze, { shot: 'data:image/png;base64,' + png.toString('base64'), base: baseB64 });
  const diagnostics = await page.evaluate(() => ({ canvasAttrs: Object.fromEntries([...document.querySelectorAll('canvas')].flatMap(c => [...c.attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value]))) }));
  Object.assign(report, { frozenTime: freeze || undefined, png: outPng, sha256: createHash('sha256').update(png).digest('hex').slice(0, 16), stats, diagnostics, consoleErrors, httpErrors });
  if (consoleErrors.length || httpErrors.length) report.problems.push('page errors');
  if (stats.nonBlankRatio < 0.001) report.problems.push('canvas is blank');
  if (baseline && !flag('--update-baseline') && !baseB64) report.problems.push(`baseline missing: ${baseline} (run with --update-baseline)`);
  if (diff) { report.baseline = { ...diff, threshold }; if (diff.diffRatio > threshold) report.problems.push(`render differs from baseline by ${(diff.diffRatio * 100).toFixed(2)}%`); }
  Object.assign(report, writeSnapshotOutput({ png, outputPath: outPng, baselinePath: baseline,
    updateBaseline: flag('--update-baseline'), valid: report.problems.length === 0 }));
} catch (e) {
  report.problems.push(String(e.message || e));
} finally {
  await browser?.close();
  server.kill();
}
report.ok = report.problems.length === 0;
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

