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
const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'hgame-audio-ui-'));
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto(`${baseUrl}/#audio`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#audio-view:not([hidden])', { timeout: 10000 });
  await page.waitForSelector('#hgame-audio-list .hgame-audio-loud-meta', { timeout: 10000 });

  const metaSample = await page.evaluate(() => ({
    count: document.querySelectorAll('#hgame-audio-list .hgame-audio-loud-meta').length,
    anomalies: document.querySelectorAll('#hgame-audio-list [data-loudness-anomaly="true"]').length,
    firstText: document.querySelector('#hgame-audio-list .hgame-audio-loud-meta')?.textContent || '',
    hasRefBtn: Boolean(document.querySelector('#hgame-audio-ref-tone-button')),
  }));
  assert.ok(metaSample.count >= 50, `expected >= 50 loudness metadata labels, got ${metaSample.count}`);
  assert.match(metaSample.firstText, /PK\s+[-\d.]+/);
  assert.equal(metaSample.hasRefBtn, true);

  await page.click('#hgame-audio-ref-tone-button');
  await page.waitForFunction(
    () => (document.querySelector('#hgame-audio-status')?.textContent || '').includes('-16.0 dBFS'),
    null,
    { timeout: 5000 },
  );
  const statusTxt = await page.evaluate(() => document.querySelector('#hgame-audio-status')?.textContent || '');
  assert.deepEqual(errs, [], `unexpected console errors: ${errs.join('; ')}`);
  console.log('WEBASSET_AUDIO_UI_PASS:', JSON.stringify({ ...metaSample, statusTxt, consoleErrors: 0 }));
} finally {
  await browser.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await rm(tmpRoot, { recursive: true, force: true });
}
