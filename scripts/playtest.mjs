#!/usr/bin/env node
// Automated AI Playtest Runner: serves a game directory over loopback HTTP, runs a Playwright
// Chrome session with simulated keyboard & pointer inputs, tracks FPS / frame stutters, verifies
// canvas pixels actually respond (or state hook mutates), and asserts zero console/page/HTTP errors.
//
//   node scripts/playtest.mjs <game-dir> [--duration 2000] [--actions "d:350,w:300,j:150,k:150"]
//        [--selector "#game"] [--viewport 960x540] [--state-hook __hgameState] [--trace-hook __hgameTrace]
//        [--ready "#game[data-engine-ready=true]"] [--allow-static] [--no-pointer] [--chrome <path>]
//   node scripts/playtest.mjs <game-id> --webasset --scenario <local-module.mjs>
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createFrameTelemetry, summarizeFrameTelemetry } from './lib/performance-stats.mjs';
import { numberOption } from './lib/cli-numbers.mjs';
import { viewportOption } from './lib/cli-numbers.mjs';
import { launchChromium, resolvePlaywright } from './lib/playwright-resolve.mjs';
import { benchmarkBrowserOptions, observeCanvasContexts, readBrowserEnvironment } from './lib/browser-benchmark.mjs';
import { collectPageUiAudit, evaluateLayoutAudit, evaluateUiAudit } from './lib/snapshot-ui-audit.mjs';

const previewScript = fileURLToPath(new URL('./preview.mjs', import.meta.url));

function startRenderMemorySampling() {
  const intervalMs = 1000;
  let samples = 0;
  let peakEstimatedGpuBytes = 0;
  let lastSampleAt = null;
  let maxSampleGapMs = 0;
  let error = null;
  function sample() {
    if (error) return;
    try {
      if (typeof window.__hgameRenderMemory !== 'function') throw new Error('missing window.__hgameRenderMemory()');
      const bytes = window.__hgameRenderMemory();
      if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('expected a positive integer byte estimate');
      const now = performance.now();
      if (lastSampleAt !== null) maxSampleGapMs = Math.max(maxSampleGapMs, now - lastSampleAt);
      lastSampleAt = now;
      peakEstimatedGpuBytes = Math.max(peakEstimatedGpuBytes, bytes);
      samples++;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }
  sample();
  const timer = setInterval(sample, intervalMs);
  window.__hgameStopRenderMemorySampling = () => {
    clearInterval(timer);
    sample();
    delete window.__hgameStopRenderMemorySampling;
    return { peakEstimatedGpuBytes: samples ? peakEstimatedGpuBytes : null, samples, intervalMs, maxSampleGapMs: Math.ceil(maxSampleGapMs), error };
  };
}

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
    const ms = Math.max(16, numberOption(durRaw || 180, 'action duration'));
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
  const values = frameDeltasMs ?? [];
  const collector = createFrameTelemetry(Math.max(1, values.length));
  for (const value of values) collector.record(value);
  return summarizeFrameTelemetry(collector.snapshot());
}

async function freePort() {
  const s = createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}

export function webAssetOrigins() {
  const origin = (key, fallback) => 'http://127.0.0.1:' +
    numberOption(process.env[key] || fallback, key, { integer: true, min: 1, max: 65535 });
  return { catalog: origin('WEBASSET_PORT', 4174), preview: origin('WEBASSET_GAME_PORT', 4175) };
}

export async function resolveWebAssetGame(id) {
  const { catalog, preview } = webAssetOrigins();
  const response = await fetch(catalog + '/api/games', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('WebAsset catalog returned HTTP ' + response.status);
  const { items } = await response.json();
  const game = Array.isArray(items) && items.find(entry => entry?.source === 'local' && entry.runtimeId === id && entry.status === 'ready');
  if (!game) throw new Error('WebAsset does not list a ready local game named ' + id);
  const url = new URL(game.previewUrl ?? '', preview);
  if (url.origin !== preview || !url.pathname.startsWith('/local-games/' + id + '/')) {
    throw new Error('Unexpected WebAsset preview address for ' + id);
  }
  return url;
}

export async function verifyWebAssetSource(gameRootUrl, projectDir) {
  const token = randomUUID();
  const name = `hgame-task-${token}.json`;
  const marker = path.join(projectDir, name);
  const content = JSON.stringify({ token });
  await writeFile(marker, content, { flag: 'wx' });
  try {
    const response = await fetch(new URL(name, gameRootUrl), {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || await response.text() !== content) {
      throw new Error(`WebAsset does not serve this project directory (${projectDir}). Run from the registered source directory.`);
    }
  } finally {
    await unlink(marker);
  }
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
  const valueFlags = new Set(['--duration', '--actions', '--selector', '--viewport', '--state-hook', '--trace-hook', '--ready', '--chrome', '--gpu', '--query', '--max-long-frames', '--scenario', '--entry']);
  const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
  const flag = name => argv.includes(name);
  const gameDir = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && valueFlags.has(argv[i - 1])));

  if (!gameDir || flag('--help')) {
    console.error('Usage: node scripts/playtest.mjs <game-dir> [--duration 2000] [--actions "d:350,w:300,j:150,k:150"] [--selector "#game"] [--viewport 960x540] [--touch] [--state-hook __hgameState] [--trace-hook __hgameTrace] [--allow-static]');
    console.error('       node scripts/playtest.mjs <game-id> --webasset --scenario <local-module.mjs>');
    process.exit(flag('--help') ? 0 : 2);
  }

  const live = flag('--webasset');
  const resolvedDir = live ? null : path.resolve(gameDir);
  const entry = opt('--entry', 'index.html').replace(/^\.?\//, '');
  if (live && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(gameDir)) {
    console.error('--webasset requires a local game ID');
    process.exit(2);
  }
  if (!live && (!entry || entry.includes('\\') || entry.includes('?') || entry.includes('#') ||
      entry.split('/').some(segment => !segment || segment === '.' || segment === '..') ||
      !existsSync(path.join(resolvedDir, entry)))) {
    console.error(`Invalid or missing entry ${entry} in ${resolvedDir}`);
    process.exit(2);
  }

  let profile = 'custom';
  if (!live) try {
    const cfg = JSON.parse(readFileSync(path.join(resolvedDir, 'engine.config.json'), 'utf8'));
    if (cfg?.profile) profile = cfg.profile;
  } catch { /* Optional config check. */ }

  let durationMs, viewport, maxLongFrames, launchOptions;
  const gpu = opt('--gpu', 'software');
  try {
    durationMs = Math.max(400, numberOption(opt('--duration', 1800), '--duration'));
    viewport = viewportOption(opt('--viewport', '960x540'));
    maxLongFrames = numberOption(opt('--max-long-frames', 9999), '--max-long-frames', { integer: true });
    launchOptions = benchmarkBrowserOptions(gpu, opt('--chrome', ''));
    launchOptions.args = launchOptions.args.filter(arg => arg !== '--disable-frame-rate-limit');
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const selector = opt('--selector', '#game');
  const ready = opt('--ready', '');
  const { width: vw, height: vh } = viewport;
  const stateHook = opt('--state-hook', '__hgameState');
  const traceHook = opt('--trace-hook', '');
  if (flag('--trace-hook') && (!traceHook || traceHook.startsWith('--'))) {
    console.error('--trace-hook requires a window function name');
    process.exit(2);
  }
  const query = opt('--query', '');
  const allowStatic = flag('--allow-static') || profile === 'ui';
  const allowBlank = flag('--allow-blank');
  const checkUi = flag('--check-ui');
  const checkLayout = flag('--check-layout');
  const sampleRenderMemory = flag('--sample-render-memory');
  const measuringTouch = flag('--touch');
  const frameSampleLimit = flag('--exact-percentiles') ? 200_000 : 600;
  const usePointer = !flag('--no-pointer');
  const actionsRaw = opt('--actions', profile === 'ui' ? 'click,wait:250' : 'd:320,w:260,j:160,a:260,space:160,wait:250');
  let actions;
  let scenarioPath;
  try {
    if (flag('--scenario')) {
      const argument = opt('--scenario', '');
      if (!argument || argument.startsWith('--')) throw new Error('--scenario requires a local module file');
      if (flag('--actions') || flag('--duration')) throw new Error('--scenario replaces --actions and --duration');
      scenarioPath = path.resolve(argument);
    }
    actions = parsePlaytestActions(actionsRaw);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  let playwrightMod;
  try {
    playwrightMod = resolvePlaywright(import.meta.url, { cwd: resolvedDir ?? process.cwd() });
  } catch (err) {
    console.log(JSON.stringify({ ok: false, problems: ['playwright-core not installed: ' + err.message] }, null, 2));
    process.exit(1);
  }
  const { chromium } = playwrightMod;

  const consoleErrors = [];
  const httpErrors = [];
  const report = { ok: false, ...(live ? { gameId: gameDir } : { gameDir: resolvedDir }), profile, problems: [], consoleErrors, httpErrors };
  let server;
  let browser;
  try {
    const scenario = scenarioPath ? await import(pathToFileURL(scenarioPath).href) : null;
    if (scenario && (typeof scenario.run !== 'function' || (scenario.verify !== undefined && typeof scenario.verify !== 'function'))) {
      throw new Error('Scenario must export run(context) and may export verify(context)');
    }
    if (scenario) {
      report.scenario = scenarioPath;
      report.checkpoints = [];
    }
    let url;
    if (live) {
      url = await resolveWebAssetGame(gameDir);
    } else {
      const port = await freePort();
      url = new URL(`http://127.0.0.1:${port}/`);
      if (entry) url.pathname = entry;
      server = spawn(process.execPath, [previewScript, resolvedDir, '--port', String(port)], {
        windowsHide: true, stdio: 'ignore',
      });
      let spawnError;
      server.once('error', error => { spawnError = error; });
      for (let i = 0; ; i++) {
        if (spawnError) throw spawnError;
        if (server.exitCode !== null || i > 100) throw new Error('preview server failed to start');
        try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* retry */ }
        await new Promise(r => setTimeout(r, 60));
      }
    }
    if (query) url.search = query;
    report.url = url.href;

    browser = await launchChromium(chromium, launchOptions);
    const page = await browser.newPage({
      viewport: { width: vw, height: vh }, deviceScaleFactor: 1,
      hasTouch: measuringTouch, isMobile: measuringTouch,
    });
    await page.addInitScript(observeCanvasContexts);
    page.on('pageerror', e => consoleErrors.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) consoleErrors.push(m.text());
    });
    page.on('response', r => {
      if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) httpErrors.push(`HTTP ${r.status()} ${r.url()}`);
    });
    page.on('requestfailed', request => {
      const failure = request.failure()?.errorText;
      if (failure === 'net::ERR_ABORTED' || request.url().endsWith('/favicon.ico')) return;
      httpErrors.push(`${failure ?? 'Request failed'} ${request.url()}`);
    });

    await page.addInitScript({ content: `(() => {
      const createCollector = ${createFrameTelemetry.toString()};
      let collector = createCollector(600);
      let last = performance.now();
      let running = true;
      let frameId;
      let touchPresses = 0;
      let peakTouchContacts = 0;
      let multiTouchMoves = 0;
      let recordingTouch = false;
      const contacts = new Map();
      const touchEvents = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'];
      function clearContacts() {
        contacts.clear();
      }
      function countTouch(event) {
        if (!recordingTouch || !event.isTrusted || event.pointerType !== 'touch') return;
        const point = contacts.get(event.pointerId);
        if (event.type === 'pointerdown') {
          touchPresses++;
          contacts.set(event.pointerId, [event.clientX, event.clientY]);
          peakTouchContacts = Math.max(peakTouchContacts, contacts.size);
        } else if (event.type === 'pointermove') {
          if (!point || (point[0] === event.clientX && point[1] === event.clientY)) return;
          point[0] = event.clientX;
          point[1] = event.clientY;
          if (contacts.size >= 2) multiTouchMoves++;
        } else {
          contacts.delete(event.pointerId);
        }
      }
      if (${measuringTouch}) {
        // Observe end and cancellation before game capture handlers can consume them.
        for (const type of touchEvents) addEventListener(type, countTouch, { capture: true, passive: true });
        addEventListener('blur', clearContacts);
        document.addEventListener('visibilitychange', clearContacts);
      }
      function sample(now) {
        if (!running) return;
        collector.record(now - last);
        last = now;
        frameId = requestAnimationFrame(sample);
      }
      frameId = requestAnimationFrame(sample);
      window.__hgamePlaytestTelemetry = () => collector.snapshot();
      window.__hgamePlaytestMultiTouchMoves = () => multiTouchMoves;
      window.__hgamePlaytestTelemetryReset = () => {
        collector = createCollector(${frameSampleLimit});
        last = performance.now();
        touchPresses = 0;
        peakTouchContacts = 0;
        multiTouchMoves = 0;
        clearContacts();
        recordingTouch = ${measuringTouch};
      };
      window.__hgamePlaytestTelemetryStop = () => new Promise(resolve => {
        recordingTouch = false;
        if (${measuringTouch}) {
          for (const type of touchEvents) removeEventListener(type, countTouch, true);
          removeEventListener('blur', clearContacts);
          document.removeEventListener('visibilitychange', clearContacts);
        }
        requestAnimationFrame(now => {
          collector.record(now - last);
          running = false;
          cancelAnimationFrame(frameId);
          resolve({ ...collector.snapshot(), touchPresses, peakTouchContacts, multiTouchMoves });
        });
      });
    })();` });

    const bootStart = performance.now();
    await page.goto(url.href, { waitUntil: 'load' });
    if (ready) {
      await page.locator(ready).waitFor({ timeout: 15000 });
    }
    if (flag('--state-ready')) await page.waitForFunction(name => typeof window[name] === 'function', stateHook, { timeout: 15000 });
    const readyMs = Math.round(performance.now() - bootStart);
    if (!scenario) await page.waitForTimeout(500);

    const target = page.locator(selector);
    const hasTarget = (await target.count()) > 0;
    const captureBuf = async () => (hasTarget ? target.screenshot() : page.screenshot());
    const shotBefore = await captureBuf();
    const beforeHash = createHash('sha256').update(shotBefore).digest('hex').slice(0, 16);
    const readState = async () => {
      try {
        const res = await page.evaluate(async n => {
          if (typeof window[n] !== 'function') return { present: false, value: null, nonFinite: [] };
          const raw = await window[n]();
          const nonFinite = [];
          const scan = (val, p, seen) => {
            if (typeof val === 'number') { if (!Number.isFinite(val)) nonFinite.push(p || 'root'); return; }
            if (!val || typeof val !== 'object' || seen.has(val)) return;
            seen.add(val);
            if (Array.isArray(val)) { for (let i = 0; i < val.length; i++) scan(val[i], `${p}[${i}]`, seen); }
            else { for (const [k, v] of Object.entries(val)) scan(v, p ? `${p}.${k}` : k, seen); }
          };
          scan(raw, '', new Set());
          return { present: true, value: JSON.parse(JSON.stringify(raw ?? null)), nonFinite };
        }, stateHook);
        if (res.nonFinite?.length) {
          const msg = `state hook ${stateHook} contains non-finite numbers: ${res.nonFinite.slice(0, 5).join(', ')}`;
          if (!report.problems.includes(msg)) report.problems.push(msg);
        }
        return res.value;
      } catch (error) {
        report.problems.push(`state hook ${stateHook} failed: ${error.message}`);
        return null;
      }
    };
    const stateBefore = await readState();
    let measuringScenario = false;
    const readMultiTouchMoves = () => page.evaluate(() => window.__hgamePlaytestMultiTouchMoves());
    const checkpoint = async (name, check) => {
      if (typeof name !== 'string' || !name.trim() || typeof check !== 'function') {
        throw new TypeError('A checkpoint requires a name and a check function');
      }
      try {
        const before = measuringScenario && measuringTouch ? await readMultiTouchMoves() : null;
        if (await check() === false) throw new Error('Checkpoint returned false');
        const moves = before === null ? 0 : (await readMultiTouchMoves()) - before;
        report.checkpoints.push({ name, ok: true, ...(moves > 0 ? { multiTouchMoves: moves } : {}) });
      } catch (error) {
        const message = String(error?.message ?? error);
        report.checkpoints.push({ name, ok: false, message });
        const problem = name + ': ' + message;
        report.problems.push(problem);
        throw new Error(problem, { cause: error });
      }
    };
    const uiAudits = [];
    const auditUi = async (label = 'phase', options = {}) => {
      const ui = await page.evaluate(collectPageUiAudit);
      const allowDebug = options.allowDebug ?? /(?:^|&)debug=1(?:&|$)/.test(query.replace(/^\?/, ''));
      const maxHudRatio = options.maxHudRatio ?? (profile === 'ui' ? 0.85 : 0.10);
      const maxHudButtons = options.maxHudButtons ?? (profile === 'ui' ? 4 : 1);
      const maxHudTextChars = options.maxHudTextChars ?? (profile === 'ui' ? 280 : 140);
      const problems = [
        ...evaluateUiAudit(ui, { allowDebug, maxHudRatio, maxHudButtons, maxHudTextChars }),
        ...evaluateLayoutAudit(ui),
      ];
      const entry = { label, ok: problems.length === 0, ui, problems };
      uiAudits.push(entry);
      if (problems.length > 0) {
        const msg = `UI audit [${label}]: ${problems.join('; ')}`;
        report.problems.push(msg);
        throw new Error(msg);
      }
      return entry;
    };
    const context = { page, readState, checkpoint, auditUi, measuringRenderMemory: sampleRenderMemory, measuringTouch };

    const measurementId = randomUUID();
    await page.evaluate(id => {
      window.__hgamePlaytestMeasurementId = id;
      window.__hgamePlaytestTelemetryReset();
    }, measurementId);
    if (sampleRenderMemory) await page.evaluate(startRenderMemorySampling);
    const measurementStart = performance.now();
    if (scenario) {
      try {
        measuringScenario = true;
        const result = await scenario.run(context);
        if (result !== undefined) report.scenarioResult = JSON.parse(JSON.stringify(result));
      } catch (error) {
        const message = String(error?.message ?? error);
        if (!report.problems.includes(message)) report.problems.push('scenario run failed: ' + message);
      } finally {
        measuringScenario = false;
      }
    } else {
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
      }
      if (usePointer) {
        await page.mouse.move(vw * 0.65, vh * 0.45);
        await page.mouse.down();
        await page.mouse.move(vw * 0.45, vh * 0.55, { steps: 4 });
        await page.mouse.up();
      }
      const remainingMs = durationMs - (performance.now() - measurementStart);
      if (remainingMs > 0) await page.waitForTimeout(remainingMs);
    }
    const recording = await page.evaluate(id => {
      if (window.__hgamePlaytestMeasurementId !== id) {
        throw new Error('The measured run changed documents. Put reload or navigation checks in verify.');
      }
      return window.__hgamePlaytestTelemetryStop();
    }, measurementId);
    const actualDurationMs = performance.now() - measurementStart;
    if (sampleRenderMemory) {
      report.renderMemory = await page.evaluate(() => window.__hgameStopRenderMemorySampling());
      if (report.renderMemory.error) report.problems.push('render memory telemetry: ' + report.renderMemory.error);
    }

    const shotAfter = await captureBuf();
    const afterHash = createHash('sha256').update(shotAfter).digest('hex').slice(0, 16);
    const stateAfter = await readState();
    const uiAudit = (checkUi || checkLayout) ? await page.evaluate(collectPageUiAudit) : null;
    if (traceHook) {
      try {
        report.trace = await page.evaluate(async name => {
          if (typeof window[name] !== 'function') throw new Error('window function is missing');
          const trace = await window[name]();
          if (!Array.isArray(trace?.events) || !Number.isSafeInteger(trace.dropped) || trace.dropped < 0) {
            throw new Error('expected { dropped, events }');
          }
          const events = trace.events.slice(-128);
          for (const event of events) {
            if (!Number.isSafeInteger(event?.tick) || event.tick < 0 || typeof event.type !== 'string' ||
                !event.type || typeof event.subject !== 'string' || !event.subject) {
              throw new Error('each event requires a nonnegative tick, type, and subject');
            }
          }
          return JSON.parse(JSON.stringify({ dropped: trace.dropped + trace.events.length - events.length, events }));
        }, traceHook);
      } catch (error) {
        report.problems.push(`trace hook ${traceHook} failed: ${error.message}`);
      }
    }
    const canvasStats = await page.evaluate(analyzeCanvasStats, {
      shot: 'data:image/png;base64,' + shotAfter.toString('base64'),
    });

    const frameStats = summarizeFrameTelemetry(recording);
    const rendererEnvironment = await readBrowserEnvironment(page, browser, gpu, selector, { observeOnly: true });
    const visualChanged = beforeHash !== afterHash;
    const stateChanged = stateBefore !== null && JSON.stringify(stateBefore) !== JSON.stringify(stateAfter);

    if (!allowBlank && canvasStats.nonBlankRatio < 0.001) report.problems.push('canvas appears blank');
    if (!allowStatic && !visualChanged && !stateChanged) report.problems.push('game frame & state remained completely static after scripted input');
    if (stateAfter && typeof stateAfter === 'object' && stateAfter.disposed === true) {
      report.problems.push('application was disposed unexpectedly during playtest');
    }
    if (frameStats.longFrames > maxLongFrames) report.problems.push(`too many long frames (>50ms): ${frameStats.longFrames}`);
    if (checkUi && uiAudit) {
      const allowDebug = /(?:^|&)debug=1(?:&|$)/.test(query.replace(/^\?/, ''));
      report.problems.push(...evaluateUiAudit(uiAudit, {
        allowDebug,
        ...(profile === 'ui' ? { maxHudRatio: 0.85, maxHudButtons: 4, maxHudTextChars: 280 } : { maxHudTextChars: 140 }),
      }));
    }
    if (checkLayout && uiAudit) {
      report.problems.push(...evaluateLayoutAudit(uiAudit));
    }

    Object.assign(report, {
      browserVersion: browser.version(), readyMs, rendererEnvironment,
      ...(measuringTouch ? {
        touchPresses: recording.touchPresses,
        peakTouchContacts: recording.peakTouchContacts,
        multiTouchMoves: recording.multiTouchMoves,
      } : {}),
      beforeHash,
      afterHash,
      visualChanged,
      stateChanged,
      ...(scenario ? {} : { requestedDurationMs: durationMs }),
      actualDurationMs: +actualDurationMs.toFixed(2),
      frameStats,
      canvasStats,
      ...(uiAudit ? { uiAudit } : {}),
      ...(uiAudits.length > 0 ? { uiAudits } : {}),
      stateBefore,
      stateAfter,
    });
    if (scenario) report.measuredCheckpoints = report.checkpoints.slice();
    if (scenario?.verify && report.problems.length === 0) await scenario.verify(context, report.scenarioResult);
  } catch (err) {
    const message = String(err?.message || err);
    if (!report.problems.includes(message)) report.problems.push(message);
  } finally {
    try { await browser?.close(); } finally { server?.kill(); }
  }

  if (consoleErrors.length) report.problems.push('console/page errors present');
  if (httpErrors.length) report.problems.push('http errors present');
  report.ok = report.problems.length === 0;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runCli();
}
