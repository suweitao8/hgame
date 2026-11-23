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

const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'hgame-m2-browser-'));
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
  const waitUntil = async (fn, label, timeoutMs = 20000) => {
    const start = Date.now();
    let last = null;
    while (Date.now() - start < timeoutMs) {
      last = await page.evaluate(fn);
      if (last && last.ok) return last;
      await page.waitForTimeout(150);
    }
    throw new Error(`Timeout waiting for "${label}" after ${timeoutMs}ms; last=${JSON.stringify(last)}`);
  };

  const consoleErrors = [];
  const pageErrors = [];
  const webglWarnings = [];
  page.on('console', (msg) => {
    const txt = msg.text();
    if (msg.type() === 'error') {
      consoleErrors.push(txt);
      console.error('[CONSOLE ERROR]', txt);
    } else if (msg.type() === 'warning' && /GL ERROR|Shader Error|WebGL:\s*(?:INVALID|ERROR)/i.test(txt)) {
      webglWarnings.push(txt);
      console.warn('[WEBGL WARN]', txt);
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(String(err));
    console.error('[PAGE ERROR]', err);
  });

  // 1. #decals-view (133 unified v5.0 2-Texture OpenGL +Y decals, physical size, blood tints)
  await page.goto(`${baseUrl}/#decals`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#decals-view:not([hidden])', { timeout: 15000 });
  await waitUntil(() => {
    const n = document.querySelectorAll('#hgame-decal-list button').length;
    return { ok: n >= 133, n };
  }, 'decal list >= 133', 25000);
  await page.waitForSelector('#hgame-decal-stage canvas', { timeout: 15000 });

  const decalCount = await page.evaluate(() => document.querySelectorAll('#hgame-decal-list button').length);

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('webasset:open-asset', {
      detail: { workspace: 'decals', id: 'decal_bullet_glass_01', kind: 'cn_pbr' },
    }));
  });
  const glassRes = await waitUntil(() => {
    const st = document.querySelector('#hgame-decal-status')?.textContent || '';
    return { ok: st.includes('OpenGL +Y') && st.includes('0.28m') && st.includes('UWC_Bullet_Holes'), st };
  }, 'glass bullet hole status');
  const glassStatus = glassRes.st;
  console.log('[m2] glass status:', glassStatus);

  // Blood tint multi-state check on RealisticBloodDecals item
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('webasset:open-asset', {
      detail: { workspace: 'decals', id: 'decal_blood_jet_01', kind: 'cn_pbr' },
    }));
  });
  await waitUntil(() => {
    const st = document.querySelector('#hgame-decal-status')?.textContent || '';
    const tw = document.querySelector('#hgame-decal-tint-wrap');
    return { ok: st.includes('RealisticBloodDecals') && Boolean(tw && !tw.hidden), st, hidden: tw?.hidden };
  }, 'blood jet tintable status');

  for (const hex of ['0xea580c', '0x22c55e', '0xffffff', '0x8b0c0c']) {
    await page.evaluate((val) => {
      const sel = document.querySelector('#hgame-decal-tint');
      sel.value = val;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, hex);
    await page.waitForTimeout(80);
  }
  console.log('[m2] blood tint states verified');

  // Non-text VOL2_StreetsRoads physical tire skid check
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('webasset:open-asset', {
      detail: { workspace: 'decals', id: 'decal_road_tire_skid_01', kind: 'cn_pbr' },
    }));
  });
  await waitUntil(() => {
    const st = document.querySelector('#hgame-decal-status')?.textContent || '';
    return { ok: st.includes('VOL2_StreetsRoads') && st.includes('2.6m'), st };
  }, 'road tire skid status');
  console.log('[m2] road tire skid verified');

  // 2. #tests-view (AmplifyLUTPack 207 LUTs + post3d pipeline)
  await page.evaluate(() => document.querySelector('#nav-tests')?.click());
  await page.waitForSelector('#tests-view:not([hidden])', { timeout: 15000 });
  await page.waitForSelector('#hgame-test-stage canvas', { timeout: 25000 });
  await waitUntil(() => {
    const n = document.querySelector('#hgame-test-lut')?.options?.length || 0;
    return { ok: n >= 20, n };
  }, 'preset lut options >= 20', 25000);

  const presetLutOptions = await page.evaluate(() => document.querySelector('#hgame-test-lut')?.options?.length || 0);
  assert.ok(presetLutOptions >= 21, `Expected >= 21 preset LUT options, got ${presetLutOptions}`);

  await page.evaluate(() => {
    const cat = document.querySelector('#hgame-test-lut-cat');
    cat.value = 'all';
    cat.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await waitUntil(() => {
    const n = document.querySelector('#hgame-test-lut')?.options?.length || 0;
    return { ok: n >= 208, n };
  }, 'all 207 lut options');
  const allLutOptions = await page.evaluate(() => document.querySelector('#hgame-test-lut')?.options?.length || 0);

  await page.evaluate(() => {
    const cat = document.querySelector('#hgame-test-lut-cat');
    cat.value = 'presets';
    cat.dispatchEvent(new Event('change', { bubbles: true }));
  });
  for (const lutVal of ['preset:cn_horror_cold', 'preset:cn_old_town_dusk', 'preset:cn_bw_noir']) {
    await page.evaluate((val) => {
      const sel = document.querySelector('#hgame-test-lut');
      sel.value = val;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, lutVal);
    await waitUntil(() => {
      const st = document.querySelector('#hgame-test-status')?.textContent || '';
      return { ok: st.includes('LUT:'), st };
    }, `lut ${lutVal}`);
    await page.waitForTimeout(250);
  }

  const testStatus = await page.evaluate(() => document.querySelector('#hgame-test-status')?.textContent || '');
  assert.equal(consoleErrors.length, 0, `Unexpected console errors: ${JSON.stringify(consoleErrors)}`);
  assert.equal(pageErrors.length, 0, `Unexpected page errors: ${JSON.stringify(pageErrors)}`);
  assert.equal(webglWarnings.length, 0, `Unexpected WebGL warnings: ${JSON.stringify(webglWarnings)}`);

  console.log('browser-milestone2 PASS:', {
    decalCount,
    glassStatus,
    presetLutOptions,
    allLutOptions,
    testStatus,
    consoleErrors: consoleErrors.length,
    pageErrors: pageErrors.length,
    webglWarnings: webglWarnings.length,
  });
} finally {
  await browser.close();
  server.close();
  await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
}
