#!/usr/bin/env node
// Real Chromium Playwright verification for universal HGame UI/UX motion, 2D/3D starters, and 3D spatial UI.
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { collectPageUiAudit, evaluateUiAudit } from '../scripts/lib/snapshot-ui-audit.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const builder = path.join(root, 'scripts', 'create-game.mjs');
const preview = path.join(root, 'scripts', 'preview.mjs');
const { chromium } = createRequire(import.meta.url)('playwright-core');

const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-browser-ui-ux-'));
const children = [];
let browser;

async function getPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function servePreset(name, extraArgs = []) {
  const dir = path.join(tmp, 'sample-' + name);
  const res = spawnSync(process.execPath, [builder, dir, '--preset', name, '--no-git', ...extraArgs], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`create-game ${name} failed: ${res.stderr}`);
  const port = await getPort();
  const child = spawn(process.execPath, [preview, dir, '--port', String(port)], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(url)).ok) return url;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(`Preview did not start for ${name}`);
}

async function launchBrowser() {
  for (const channel of ['chrome', 'msedge', undefined]) {
    try {
      return await chromium.launch({
        headless: true,
        ...(channel ? { channel } : {}),
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'],
      });
    } catch {}
  }
  throw new Error('No Chromium executable available');
}

try {
  browser = await launchBrowser();

  // 1. UI starter: real 3D perspective tilt, glare CSS variables, metric pulse, Anti-Bloat audit
  {
    const url = await servePreset('ui');
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url, { waitUntil: 'load' });
    await page.locator('#draw:enabled').waitFor();

    const box = await page.locator('#draw').boundingBox();
    assert.ok(box && box.width > 100);
    await page.mouse.move(box.x + box.width * 0.88, box.y + box.height * 0.15);
    await page.waitForTimeout(220);

    const hoverInfo = await page.evaluate(() => {
      const btn = document.querySelector('#draw');
      return {
        hovered: btn.getAttribute('data-ui-hovered'),
        transform: getComputedStyle(btn).transform,
        glare: Number(btn.style.getPropertyValue('--hg-glare-o')),
      };
    });
    assert.equal(hoverInfo.hovered, 'true');
    assert.ok(hoverInfo.transform.startsWith('matrix3d('), `Expected 3D matrix transform, got ${hoverInfo.transform}`);
    assert.ok(hoverInfo.glare > 0.2, `Expected glare opacity > 0.2, got ${hoverInfo.glare}`);

    await page.locator('#draw').click();
    assert.equal(await page.locator('#count').innerText(), '1');
    const audit = await page.evaluate(collectPageUiAudit);
    assert.deepEqual(evaluateUiAudit(audit), []);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({ check: 'ui-starter', hover3d: true, glare: hoverInfo.glare, errors: 0 }));
  }

  // 2. 3D starter: world HUD anchor projection, hint auto-fade on move, Anti-Bloat audit, and real Three.js 3D UI group
  {
    const url = await servePreset('3d');
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url, { waitUntil: 'load' });
    await page.locator('canvas#game[data-engine-ready="true"]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(250);

    const initial = await page.evaluate(() => ({
      hintVisible: !document.querySelector('[data-ui-hint]')?.hidden,
      worldAnchorText: document.querySelector('#world-hud .hg-world-hud-item:not([hidden])')?.textContent ?? null,
    }));
    assert.equal(initial.hintVisible, true);
    assert.equal(initial.worldAnchorText, '◆ 100');

    await page.keyboard.down('d');
    await page.waitForTimeout(650);
    await page.keyboard.up('d');
    const hintAfterMove = await page.evaluate(() => Boolean(document.querySelector('[data-ui-hint]')?.hidden));
    assert.equal(hintAfterMove, true, 'Hint badge should fade out and hide after movement');

    const audit = await page.evaluate(collectPageUiAudit);
    assert.deepEqual(evaluateUiAudit(audit), []);

    // Real Three.js createSpatialPanel3D + createSpatialUiGroup3D depth picking in browser
    const spatialResult = await page.evaluate(async () => {
      const THREE = await import('./assets/vendor/three/three.module.js');
      const { createThreeAdapter } = await import('./vendor/hgame/integrations/three.js');
      const { createSpatialPanel3D, createSpatialUiGroup3D } = await import('./vendor/hgame/integrations/ui-3d.js');
      const c = document.createElement('canvas');
      c.width = 640; c.height = 360;
      c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 360 });
      const adapter = createThreeAdapter({ THREE, canvas: c, width: 640, height: 360 });
      adapter.camera.position.set(0, 0, 5);
      adapter.camera.lookAt(0, 0, 0);
      adapter.camera.updateMatrixWorld(true);

      let frontHits = 0;
      let backHits = 0;
      const back = createSpatialPanel3D({
        THREE, renderer: adapter, width: 2, height: 1.5, curveRadius: 4, position: [0, 0, 0],
        onClick: () => backHits++,
      });
      const front = createSpatialPanel3D({
        THREE, renderer: adapter, width: 2, height: 1.5, curveRadius: 4, position: [0, 0, 1.2],
        onClick: () => frontHits++,
      });
      const group = createSpatialUiGroup3D({ renderer: adapter, panels: [back, front] });
      group.handlePointerDown(320, 180);
      group.handlePointerUp(320, 180);
      group.update(0.05);
      const hovered = group.getHoveredIndex();
      group.dispose();
      adapter.dispose();
      return { frontHits, backHits, hovered };
    });
    assert.deepEqual(spatialResult, { frontHits: 1, backHits: 0, hovered: 1 });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({ check: '3d-starter+spatial3d', ...spatialResult, hudAreaRatio: audit.hudAreaRatio }));
  }

  // 3. 2D Pixi starter: ghost bar, metric sync, hint fade, Anti-Bloat audit
  {
    const url = await servePreset('2d');
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url, { waitUntil: 'load' });
    await page.locator('canvas#game[data-engine-ready="true"]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(250);

    assert.equal(await page.evaluate(() => document.querySelector('[data-ui-hint]')?.hidden), false);
    await page.keyboard.down('d');
    await page.waitForTimeout(650);
    await page.keyboard.up('d');
    assert.equal(await page.evaluate(() => document.querySelector('[data-ui-hint]')?.hidden), true);

    const audit = await page.evaluate(collectPageUiAudit);
    assert.deepEqual(evaluateUiAudit(audit), []);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(JSON.stringify({ check: 'pixi2d-starter', hudAreaRatio: audit.hudAreaRatio, errors: 0 }));
  }
} finally {
  await browser?.close();
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  await new Promise((resolve) => setTimeout(resolve, 350));
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
