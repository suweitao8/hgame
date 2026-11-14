#!/usr/bin/env node
// Headless render snapshot for AI agents: serves a game dir, screenshots the canvas, and prints
// machine-readable stats (blank ratio, luma, colors, hash, console/HTTP errors) plus an optional
// pixel diff against a baseline PNG.
//
//   node scripts/snapshot.mjs <game-dir> [--out snap.png] [--wait 800] [--keys d:360,space:100]
//        [--selector "#game"] [--viewport 960x540] [--baseline base.png] [--update-baseline]
//        [--threshold 0.01] [--query horde=3000] [--chrome <path>] [--ready "#game[data-engine-ready=true]"]
//
// Exit code 1 when: page errors, blank canvas, or baseline diff above threshold.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const flag = name => argv.includes(name);
const gameDir = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['--update-baseline'].includes(argv[i - 1])));
if (!gameDir) { console.error('Usage: node scripts/snapshot.mjs <game-dir> [options] (see file header)'); process.exit(2); }

const outPng = path.resolve(opt('--out', path.join(gameDir, 'build', 'snapshot.png')));
const waitMs = Number(opt('--wait', 800));
const selector = opt('--selector', '#game');
const ready = opt('--ready', '');
const [vw, vh] = opt('--viewport', '960x540').split('x').map(Number);
const baseline = opt('--baseline', '');
const query = opt('--query', '');
const threshold = Number(opt('--threshold', 0.01));
const keys = opt('--keys', '').split(',').filter(Boolean).map(s => { const [k, ms] = s.split(':'); return { key: k === 'space' ? ' ' : k, ms: Number(ms || 150) }; });

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
  await page.goto(url, { waitUntil: 'load' });
  if (ready) await page.locator(ready).waitFor({ timeout: 20000 });
  await page.waitForTimeout(waitMs);
  for (const { key, ms } of keys) { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); }
  const target = page.locator(selector);
  const png = await target.screenshot();
  mkdirSync(path.dirname(outPng), { recursive: true });
  writeFileSync(outPng, png);
  const baseB64 = baseline && existsSync(baseline) && !flag('--update-baseline')
    ? 'data:image/png;base64,' + readFileSync(baseline).toString('base64') : null;
  const { stats, diff } = await page.evaluate(analyze, { shot: 'data:image/png;base64,' + png.toString('base64'), base: baseB64 });
  const diagnostics = await page.evaluate(() => ({ canvasAttrs: Object.fromEntries([...document.querySelectorAll('canvas')].flatMap(c => [...c.attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value]))) }));
  Object.assign(report, { png: outPng, sha256: createHash('sha256').update(png).digest('hex').slice(0, 16), stats, diagnostics, consoleErrors, httpErrors });
  if (consoleErrors.length || httpErrors.length) report.problems.push('page errors');
  if (stats.nonBlankRatio < 0.001) report.problems.push('canvas is blank');
  if (baseline && flag('--update-baseline')) { mkdirSync(path.dirname(path.resolve(baseline)), { recursive: true }); copyFileSync(outPng, baseline); report.baselineUpdated = baseline; }
  else if (baseline && !baseB64) report.problems.push(`baseline missing: ${baseline} (run with --update-baseline)`);
  if (diff) { report.baseline = { ...diff, threshold }; if (diff.diffRatio > threshold) report.problems.push(`render differs from baseline by ${(diff.diffRatio * 100).toFixed(2)}%`); }
} catch (e) {
  report.problems.push(String(e.message || e));
} finally {
  await browser?.close();
  server.kill();
}
report.ok = report.problems.length === 0;
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

