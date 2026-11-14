#!/usr/bin/env node
// Automated AI Playtest Runner: serves a game directory over loopback HTTP, runs a Playwright
// Chrome session with simulated keyboard & pointer inputs, tracks FPS / frame stutters, verifies
// canvas pixels actually respond (or state hook mutates), and asserts zero console/page/HTTP errors.
//
//   node scripts/playtest.mjs <game-dir> [--duration 2000] [--actions "d:350,w:300,j:150,k:150"]
//        [--selector "#game"] [--viewport 960x540] [--state-hook __hgameState]
//        [--ready "#game[data-engine-ready=true]"] [--allow-static] [--no-pointer] [--chrome <path>]
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * Parse a comma-separated input script like `"d:350,space:120,wait:200,click"`.
 * @param {string} raw
 * @returns {Array<{ type: 'key'|'wait'|'click', key?: string, ms: number }>}
 */
export function parsePlaytestActions(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const list = [];
  for (const token of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    const [head, durRaw] = token.split(':');
    const name = (head ?? '').trim();
    const ms = Math.max(16, Number(durRaw || 180) || 180);
    if (!name) continue;
    if (name === 'wait' || name === 'pause') {
      list.push({ type: 'wait', ms });
    } else if (name === 'click' || name === 'tap') {
      list.push({ type: 'click', ms });
    } else {
      const normalized = name === 'space' ? ' ' : name;
      list.push({ type: 'key', key: normalized, ms });
    }
  }
  return list;
}

/**
 * Summarize an array of frame delta milliseconds into FPS / stutter metrics.
 * @param {number[]} frameDeltasMs
 */
export function summarizeFrameDeltas(frameDeltasMs) {
  const valid = (frameDeltasMs ?? []).filter(d => Number.isFinite(d) && d > 0 && d < 2000);
  if (!valid.length) {
    return { frames: 0, meanMs: 0, p95Ms: 0, maxMs: 0, fps: 0, longFrames: 0 };
  }
  const sorted = [...valid].sort((a, b) => a - b);
  const sum = valid.reduce((a, b) => a + b, 0);
  const meanMs = sum / valid.length;
  const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  const p95Ms = sorted[p95Idx];
  const maxMs = sorted[sorted.length - 1];
  const longFrames = valid.filter(d => d > 50).length;
  return {
    frames: valid.length,
    meanMs: +meanMs.toFixed(2),
    p95Ms: +p95Ms.toFixed(2),
    maxMs: +maxMs.toFixed(2),
    fps: meanMs > 0 ? +(1000 / meanMs).toFixed(1) : 0,
    longFrames,
  };
}

function findChrome(explicitPath) {
  if (explicitPath) return explicitPath;
  if (process.env.HGAME_CHROME && existsSync(process.env.HGAME_CHROME)) return process.env.HGAME_CHROME;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find(existsSync) ?? null;
}

async function freePort() {
  const s = createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}

const analyzeCanvasStats = async ({ shot }) => {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = shot;
  });
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;
  let nonBlank = 0;
  let lumaSum = 0;
  const first = [d[0], d[1], d[2]];
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gr = d[i + 1], b = d[i + 2];
    lumaSum += 0.2126 * r + 0.7152 * gr + 0.0722 * b;
    if (r !== first[0] || gr !== first[1] || b !== first[2]) nonBlank++;
  }
  const n = Math.max(1, img.width * img.height);
  return {
    width: img.width,
    height: img.height,
    nonBlankRatio: +(nonBlank / n).toFixed(4),
    meanLuma: +(lumaSum / n).toFixed(2),
  };
};

async function runCli() {
  const argv = process.argv.slice(2);
  const valueFlags = new Set(['--duration', '--actions', '--selector', '--viewport', '--state-hook', '--ready', '--chrome', '--query', '--max-long-frames']);
  const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
  const flag = name => argv.includes(name);
  const gameDir = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && valueFlags.has(argv[i - 1])));

  if (!gameDir || flag('--help')) {
    console.error('Usage: node scripts/playtest.mjs <game-dir> [--duration 2000] [--actions "d:350,w:300,j:150,k:150"] [--selector "#game"] [--viewport 960x540] [--state-hook __hgameState] [--allow-static]');
    process.exit(flag('--help') ? 0 : 2);
  }

  const resolvedDir = path.resolve(gameDir);
  if (!existsSync(path.join(resolvedDir, 'index.html'))) {
    console.error(`Missing index.html in ${resolvedDir}`);
    process.exit(2);
  }

  let profile = 'custom';
  try {
    const cfg = JSON.parse(readFileSync(path.join(resolvedDir, 'engine.config.json'), 'utf8'));
    if (cfg?.profile) profile = cfg.profile;
  } catch { /* Optional config check. */ }

  const durationMs = Math.max(400, Number(opt('--duration', 1800)));
  const selector = opt('--selector', '#game');
  const ready = opt('--ready', '');
  const [vw, vh] = opt('--viewport', '960x540').split('x').map(Number);
  const stateHook = opt('--state-hook', '__hgameState');
  const query = opt('--query', '');
  const allowStatic = flag('--allow-static') || profile === 'ui';
  const usePointer = !flag('--no-pointer');
  const actionsRaw = opt('--actions', profile === 'ui' ? 'click,wait:250' : 'd:320,w:260,j:160,a:260,space:160,wait:250');
  const actions = parsePlaytestActions(actionsRaw);
  const maxLongFrames = Number(opt('--max-long-frames', 9999));

  const exe = findChrome(opt('--chrome', ''));
  let playwrightMod;
  try {
    playwrightMod = createRequire(import.meta.url)('playwright-core');
  } catch (err) {
    console.log(JSON.stringify({ ok: false, problems: ['playwright-core not installed: ' + err.message] }, null, 2));
    process.exit(1);
  }
  const { chromium } = playwrightMod;

  const port = await freePort();
  const server = spawn(process.execPath, [path.join(root, 'scripts', 'preview.mjs'), resolvedDir, '--port', String(port)], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const report = { ok: false, gameDir: resolvedDir, profile, problems: [] };
  let browser;
  try {
    const url = `http://127.0.0.1:${port}/` + (query ? '?' + query.replace(/^\?/, '') : '');
    for (let i = 0; ; i++) {
      if (server.exitCode !== null || i > 100) throw new Error('preview server failed to start');
      try { if ((await fetch(url)).ok) break; } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 60));
    }

    browser = await chromium.launch({
      headless: true,
      ...(exe ? { executablePath: exe } : {}),
      args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
    });
    const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
    const consoleErrors = [];
    const httpErrors = [];
    page.on('pageerror', e => consoleErrors.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) consoleErrors.push(m.text());
    });
    page.on('response', r => {
      if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) httpErrors.push(`HTTP ${r.status()} ${r.url()}`);
    });

    await page.addInitScript(() => {
      const deltas = [];
      let last = performance.now();
      function sample(now) {
        deltas.push(now - last);
        last = now;
        if (deltas.length > 600) deltas.shift();
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
      window.__hgamePlaytestTelemetry = () => deltas.slice();
    });

    await page.goto(url, { waitUntil: 'load' });
    if (ready) {
      await page.locator(ready).waitFor({ timeout: 15000 });
    }
    await page.waitForTimeout(500);

    const target = page.locator(selector);
    const hasTarget = (await target.count()) > 0;
    const captureBuf = async () => (hasTarget ? target.screenshot() : page.screenshot());
    const shotBefore = await captureBuf();
    const beforeHash = createHash('sha256').update(shotBefore).digest('hex').slice(0, 16);
    const stateBefore = await page.evaluate(async n => typeof window[n] === 'function' ? JSON.parse(JSON.stringify(await window[n]() ?? null)) : null, stateHook).catch(() => null);

    let elapsed = 0;
    for (const act of actions) {
      if (act.type === 'wait') {
        await page.waitForTimeout(act.ms);
      } else if (act.type === 'click' && usePointer) {
        await page.mouse.click(vw * 0.5, vh * 0.5);
        await page.waitForTimeout(act.ms);
      } else if (act.type === 'key') {
        await page.keyboard.down(act.key);
        await page.waitForTimeout(act.ms);
        await page.keyboard.up(act.key);
      }
      elapsed += act.ms;
    }
    if (usePointer) {
      await page.mouse.move(vw * 0.65, vh * 0.45);
      await page.mouse.down();
      await page.mouse.move(vw * 0.45, vh * 0.55, { steps: 4 });
      await page.mouse.up();
    }
    if (elapsed < durationMs) {
      await page.waitForTimeout(durationMs - elapsed);
    }

    const shotAfter = await captureBuf();
    const afterHash = createHash('sha256').update(shotAfter).digest('hex').slice(0, 16);
    const stateAfter = await page.evaluate(async n => typeof window[n] === 'function' ? JSON.parse(JSON.stringify(await window[n]() ?? null)) : null, stateHook).catch(() => null);
    const deltas = await page.evaluate(() => (typeof window.__hgamePlaytestTelemetry === 'function' ? window.__hgamePlaytestTelemetry() : []));
    const canvasStats = await page.evaluate(analyzeCanvasStats, {
      shot: 'data:image/png;base64,' + shotAfter.toString('base64'),
    });

    const frameStats = summarizeFrameDeltas(deltas);
    const visualChanged = beforeHash !== afterHash;
    const stateChanged = stateBefore !== null && JSON.stringify(stateBefore) !== JSON.stringify(stateAfter);

    if (consoleErrors.length) report.problems.push('console/page errors present');
    if (httpErrors.length) report.problems.push('http errors present');
    if (canvasStats.nonBlankRatio < 0.001) report.problems.push('canvas appears blank');
    if (!allowStatic && !visualChanged && !stateChanged) report.problems.push('game frame & state remained completely static after scripted input');
    if (frameStats.longFrames > maxLongFrames) report.problems.push(`too many long frames (>50ms): ${frameStats.longFrames}`);

    Object.assign(report, {
      beforeHash,
      afterHash,
      visualChanged,
      stateChanged,
      frameStats,
      canvasStats,
      consoleErrors,
      httpErrors,
      stateBefore,
      stateAfter,
    });
  } catch (err) {
    report.problems.push(String(err?.message || err));
  } finally {
    await browser?.close();
    server.kill();
  }

  report.ok = report.problems.length === 0;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runCli();
}
