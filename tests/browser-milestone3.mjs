import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { benchmarkBrowserOptions } from '../scripts/lib/browser-benchmark.mjs';
import { createWebAssetServer } from '../webasset/server.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const webassetRoot = path.join(repoRoot, 'webasset');

const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'hgame-m3-browser-'));
const server = createWebAssetServer({
  siteRoot: webassetRoot,
  gamesRoot: path.join(tmpRoot, 'games'),
  htmlGamesRoot: path.join(tmpRoot, 'html-games'),
  hgameAssetRoot: path.join(tmpRoot, 'hgame-assets'),
  dbPath: path.join(tmpRoot, 'assets.db'),
});

const browser = await chromium.launch(benchmarkBrowserOptions('software', process.env.HGAME_CHROME));
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });

  const consoleErrors = [];
  const pageErrors = [];
  const streamFetches = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/assets/cn/audio/streams/') && u.endsWith('.mp3')) streamFetches.push(u);
  });

  const waitUntil = async (fn, label, timeoutMs = 20000) => {
    const start = Date.now();
    let last = null;
    while (Date.now() - start < timeoutMs) {
      last = await page.evaluate(fn);
      if (last && last.ok) return last;
      await page.waitForTimeout(150);
    }
    throw new Error(`Timeout waiting for "${label}": ${JSON.stringify(last)}`);
  };

  await page.goto(`${baseUrl}/#audio`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#audio-view:not([hidden])', { timeout: 15000 });

  // 1. Wait for Cue list ready and surface filter
  const cueInit = await waitUntil(() => {
    const st = document.querySelector('#hgame-audio-status')?.textContent || '';
    const cards = document.querySelectorAll('#hgame-audio-list button').length;
    return { ok: cards > 20 && st.includes('就绪'), st, cards };
  }, 'cue audio ready');

  // Filter to 10-surface steps & impacts (20 cues)
  await page.evaluate(() => {
    const sel = document.querySelector('#hgame-audio-filter');
    sel.value = 'surface';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const surfaceView = await waitUntil(() => {
    const cards = document.querySelectorAll('#hgame-audio-list button').length;
    return { ok: cards === 20, cards };
  }, '20 surface cues');

  // Click Play on a Cue group and verify anti-repeat variant status updates
  await page.evaluate(() => document.querySelector('#hgame-audio-play-button')?.click());
  const cuePlay1 = await waitUntil(() => {
    const st = document.querySelector('#hgame-audio-status')?.textContent || '';
    return { ok: st.includes('防重复随机试听'), st };
  }, 'cue randomized playback');

  // 2. Switch to Streams tab and verify stream track does NOT eager-fetch MP3 on selection
  streamFetches.length = 0;
  await page.evaluate(() => document.querySelector('[data-audio-lib="streams"]')?.click());
  const streamReady = await waitUntil(() => {
    const st = document.querySelector('#hgame-audio-status')?.textContent || '';
    const metrics = document.querySelector('#hgame-audio-metrics')?.textContent || '';
    return { ok: st.includes('流式按需加载就绪') && metrics.includes('preload: stream'), st, metrics };
  }, 'stream track lazy ready');
  await page.waitForTimeout(250);
  assert.equal(streamFetches.length, 0, `Expected 0 stream MP3 fetches before clicking Play, got ${streamFetches.length}`);

  assert.equal(consoleErrors.length, 0, `Console errors: ${JSON.stringify(consoleErrors)}`);
  assert.equal(pageErrors.length, 0, `Page errors: ${JSON.stringify(pageErrors)}`);

  console.log('browser-milestone3 PASS:', {
    initialCueCards: cueInit.cards,
    surfaceCueCards: surfaceView.cards,
    cuePlayStatus: cuePlay1.st,
    streamLazyStatus: streamReady.st,
    eagerStreamFetches: streamFetches.length,
    consoleErrors: 0,
    pageErrors: 0,
  });
} finally {
  await browser.close();
  server.close();
  await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
}
