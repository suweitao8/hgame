#!/usr/bin/env node
// Optional browser acceptance test. Pass --playwright <absolute-playwright-core-path>
// when playwright-core is not locally resolvable. No permanent project changes.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
const builder = path.join(root, 'scripts', 'create-game.mjs');
const preview = path.join(root, 'scripts', 'preview.mjs');
const argv = process.argv.slice(2);
const modulePath = argv.indexOf('--playwright') >= 0 ? argv[argv.indexOf('--playwright') + 1] : 'playwright-core';
const executablePath = argv.indexOf('--chrome') >= 0 ? argv[argv.indexOf('--chrome') + 1] : undefined;
const require = createRequire(import.meta.url);
const { chromium } = require(modulePath);

const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-browser-profiles-'));
const children = [];
let browser;
async function getPort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function serve(profile) {
  const project = path.join(tmp, 'sample-' + profile);
  const selected = profile.startsWith('3d') ? '3d' : profile === '2d-bare' ? '2d' : profile;
  const result = spawnSync(process.execPath, [builder, project, '--profile', selected, '--no-git',
    ...(profile === '3d-physics' ? ['--with', 'physics3d'] : []),
    ...(profile === '3d-quality' ? ['--quality', 'auto'] : []),
    ...(profile === '3d-bare-low' ? ['--quality', 'low', '--bare'] : []),
    ...(profile === '2d-bare' ? ['--bare'] : []),
], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Generate ' + profile + ': ' + result.stderr);
  const port = await getPort();
  const child = spawn(process.execPath, [preview, project, '--port', String(port)],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const url = 'http://127.0.0.1:' + port + '/';
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error('Preview crashed for ' + profile);
    try {
      if ((await fetch(url)).ok) return url;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error('Preview never started for ' + profile);
}

try {
  browser = await chromium.launch({
    headless: true, ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
  });
  for (const profile of ['2d', '2d-bare', '3d', '3d-physics', '3d-none', '3d-quality', '3d-bare-low', 'ui']) {
    const url = await serve(profile);
    const page = await browser.newPage({
      viewport: { width: 960, height: 540 },
      deviceScaleFactor: profile === '3d-quality' ? 2 : 1,
    });
    const errors = [];
    const startupPaths = [];
    const trackStartup = request => startupPaths.push(new URL(request.url()).pathname);
    page.on('request', trackStartup);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) errors.push('HTTP ' + response.status() + ': ' + response.url());
    });
    const response = await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(650);
    let result;
    if (profile === 'ui') {
      await page.locator('#draw:enabled').waitFor();
    } else {
      await page.locator('#game[data-engine-ready="true"]').waitFor({ timeout: 20000 });
    }
    page.off('request', trackStartup);
    if (profile.startsWith('3d')) {
      const preloads = await page.locator('head link[rel="modulepreload"]').evaluateAll(
        links => links.map(link => new URL(link.href).pathname),
      );
      for (const file of ['three.module.js', 'three.core.js']) {
        const pathname = new URL('./assets/vendor/three/' + file, url).pathname;
        if (!preloads.includes(pathname) || startupPaths.filter(value => value === pathname).length !== 1) {
          throw new Error('3D starter must preload and fetch ' + file + ' once for ' + profile);
        }
      }
    }
    if (startupPaths.some(pathname => pathname.endsWith('/hgame/index.js'))) {
      throw new Error('Starter loaded the full runtime entry for ' + profile);
    }
    const rapierLoads = startupPaths.filter(pathname => /\/vendor\/rapier[23]d\//.test(pathname));
    if (profile === '3d-physics') {
      if (!rapierLoads.some(pathname => pathname.endsWith('/rapier3d.wasm'))) {
        throw new Error('Explicit Rapier 3D starter did not load its WASM');
      }
    } else if (rapierLoads.length) {
      throw new Error('Starter loaded unselected physics for ' + profile);
    }
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    if (profile === 'ui') {
      await page.locator('#draw').click();
      result = { text: await page.locator('#count').innerText() };
      if (result.text !== '1') throw new Error('UI command did not advance after cached navigation');
    } else {
      const canvas = page.locator('#game');
      const bare = profile === '2d-bare' || profile === '3d-bare-low';
      const before = await canvas.screenshot();
      await page.keyboard.down('d');
      await page.waitForTimeout(360);
      await page.keyboard.up('d');
      const after = await canvas.screenshot();
      result = { canvasPixels: await canvas.evaluate(element => [element.width, element.height]),
        changed: !before.equals(after), bytes: after.length };
      if (!result.changed && !bare) throw new Error('Canvas did not update after cached navigation for ' + profile);
      if (bare) {
        const activeScene = await page.evaluate(() => window.__hgameState().scene);
        const expectedScene = profile === '2d-bare' ? 'main' : 'world';
        if (activeScene !== expectedScene) throw new Error('Active scene did not survive cached navigation for ' + profile);
        const exitedScene = await page.evaluate(() => {
          window.dispatchEvent(new PageTransitionEvent('pagehide'));
          return window.__hgameState().scene;
        });
        if (exitedScene !== null) throw new Error('Active scene remained after page exit for ' + profile);
      }
      if (profile === '3d-bare-low') {
        const tier = await canvas.getAttribute('data-quality-tier');
        // Bare starters expose their controller through the canvas just like demo starters.
        if (tier !== 'low') throw new Error('Explicit bare quality was lost: ' + tier);
      }
      if (profile === '3d-quality') {
        const tier = await canvas.getAttribute('data-quality-tier');
        if (tier !== 'medium') throw new Error('Unknown desktop GPU must start conservative medium: ' + tier);
        const [w,h] = result.canvasPixels;
        if (w * h > 1505000) throw new Error('Medium pixel budget exceeded: ' + w + '×' + h);
        result.tier = tier;
      }
    }
    console.log(JSON.stringify({ profile, url, status: response.status(), result, errors }));
    if (errors.length) throw new Error('Browser errors for ' + profile + ': ' + errors.join(' | '));
    await page.close();
  }
} finally {
  await browser?.close();
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  await new Promise(resolve => setTimeout(resolve, 350));
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
