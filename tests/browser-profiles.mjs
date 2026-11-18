#!/usr/bin/env node
// Optional browser acceptance test. Pass --playwright <absolute-playwright-core-path>
// when playwright-core is not locally resolvable. --webgpu also tests installed Chrome.
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
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
const verifyWebGpu = argv.includes('--webgpu');
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
  const selected = profile.startsWith('3d') ? '3d' : profile.startsWith('2d') ? '2d' : profile;
  const starter = profile === 'pixi-recovery' ? ['--preset', 'horde'] : ['--profile', selected];
  const result = spawnSync(process.execPath, [builder, project, ...starter, '--no-git',
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

function startupTransfer(page) {
  return page.evaluate(() => [
    ...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource'),
  ].reduce((total, entry) => total + entry.transferSize, 0));
}

async function checkPixiWebGpuAtlas(url) {
  const webGpuBrowser = await chromium.launch({
    headless: true, ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-webgpu-adapter=swiftshader'],
  });
  try {
    const page = await webGpuBrowser.newPage({ viewport: { width: 640, height: 360 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => {
      const probe = window.__atlasUpload = { writes: [], externalCopies: 0, validationErrors: [] };
      const requestDevice = GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice = async function (...args) {
        const device = await requestDevice.apply(this, args);
        device.addEventListener('uncapturederror', event => probe.validationErrors.push(event.error.message));
        return device;
      };
      const readPixels = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function (...args) {
        const image = readPixels.apply(this, args);
        if (this.canvas.width === 1024 && this.canvas.height === 1024) {
          const { data } = image;
          for (let offset = 0; offset < data.length; offset += 4) {
            const [red, green, blue, alpha] = data.subarray(offset, offset + 4);
            if (alpha === 0 || alpha === 255 || red + green + blue === 0) continue;
            probe.sample = { offset, rgba: [red, green, blue, alpha] };
            break;
          }
        }
        return image;
      };
      const isAtlas = texture => texture.width === 1024 && texture.height === 1024;
      const copyExternal = GPUQueue.prototype.copyExternalImageToTexture;
      GPUQueue.prototype.copyExternalImageToTexture = function (source, destination, size) {
        if (isAtlas(destination.texture)) probe.externalCopies++;
        return copyExternal.call(this, source, destination, size);
      };
      const writeTexture = GPUQueue.prototype.writeTexture;
      GPUQueue.prototype.writeTexture = function (destination, data, layout, size) {
        if (isAtlas(destination.texture) && probe.sample) {
          const { offset } = probe.sample;
          probe.writes.push({ format: destination.texture.format, rgba: Array.from(data.subarray(offset, offset + 4)) });
        }
        return writeTexture.call(this, destination, data, layout, size);
      };
    });
    await page.route('**/src/presentation.json', route => route.fulfill({ json: { backend: 'webgpu', quality: 'low' } }));
    await page.goto(url);
    try {
      await page.waitForFunction(() => window.__hgameState?.().tick > 5, undefined, { timeout: 10000 });
    } catch (error) {
      throw new Error(`Pixi WebGPU did not start in Chromium ${webGpuBrowser.version()}. ${errors.join(' ')}`, { cause: error });
    }
    assert.equal(await page.locator('canvas#game').getAttribute('data-renderer-backend'), 'webgpu');
    const startupBytes = await startupTransfer(page);
    assert.ok(startupBytes > 0 && startupBytes <= 900_000, `Horde WebGPU cold startup transferred ${startupBytes} bytes (budget 900,000)`);
    const { writes, sample, externalCopies, validationErrors } = await page.evaluate(() => window.__atlasUpload);
    assert.equal(externalCopies, 0, 'The WebGPU atlas must avoid the external image upload path');
    assert.ok(sample && writes.length > 0, 'The renderer must upload the atlas bytes');
    const [red, green, blue, alpha] = sample.rgba;
    assert.deepEqual(writes[0], {
      format: 'rgba8unorm',
      rgba: [red, green, blue].map(channel => Math.round(channel * alpha / 255)).concat(alpha),
    });
    assert.deepEqual(validationErrors, []);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ profile: 'pixi-webgpu', browserVersion: webGpuBrowser.version(), startupBytes, atlasBytes: true, premultipliedAlpha: true }));
  } finally {
    await webGpuBrowser.close();
  }
}

async function checkPixiRecovery() {
  const url = await serve('pixi-recovery');
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const errors = [];
  const trackAtlas = () => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...options) {
      const context = getContext.call(this, type, ...options);
      if (type === '2d' && this.width === 1024 && this.height === 1024) window.__testAtlas = this;
      return context;
    };
  };
  const atlasSize = () => window.__testAtlas && [window.__testAtlas.width, window.__testAtlas.height];
  try {
    await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
    await page.addInitScript(trackAtlas);
    await page.route('**/src/presentation.json', route => route.fulfill({ json: { backend: 'auto', quality: 'medium' } }));
    page.on('pageerror', error => errors.push(error.message));
    const engineConfig = Promise.withResolvers();
    await page.route('**/engine.config.json', async route => {
      await engineConfig.promise;
      await route.continue();
    });
    try {
      await Promise.all([
        page.waitForRequest('**/src/swarm.json', { timeout: 5000 }),
        page.goto(url, { waitUntil: 'commit' }),
      ]);
    } catch (error) {
      throw new Error('Horde must request its swarm settings while engine configuration is pending', { cause: error });
    } finally {
      engineConfig.resolve();
    }
    const canvas = page.locator('canvas#game[data-engine-ready="true"]');
    await canvas.waitFor();
    assert.equal(await canvas.getAttribute('data-renderer-backend'), 'webgl');
    const startupBytes = await startupTransfer(page);
    assert.ok(startupBytes > 0 && startupBytes <= 900_000, `Horde cold startup transferred ${startupBytes} bytes (budget 900,000)`);
    const before = await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      return window.__hgameState().tick;
    });
    const lost = await canvas.evaluate(element => {
      const gl = element.getContext('webgl2');
      const extension = gl?.getExtension('WEBGL_lose_context');
      if (!extension) throw new Error('Pixi recovery probe needs WEBGL_lose_context');
      return new Promise((resolve, reject) => {
        const onLost = () => {
          clearTimeout(timeout);
          resolve(gl.isContextLost());
          setTimeout(() => extension.restoreContext(), 50);
        };
        const timeout = setTimeout(() => {
          element.removeEventListener('webglcontextlost', onLost);
          reject(new Error('Pixi did not report WebGL context loss'));
        }, 5000);
        element.addEventListener('webglcontextlost', onLost, { once: true });
        extension.loseContext();
      });
    });
    assert.equal(lost, true);
    await page.waitForFunction(() => !document.querySelector('#game').getContext('webgl2').isContextLost());
    assert.equal(await page.evaluate(() => window.__hgameState().tick), before, 'hidden Pixi game must pause simulation');
    await page.evaluate(() => {
      delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(tick => window.__hgameState().tick >= tick + 10, before);
    const after = await canvas.screenshot();
    const colors = await page.evaluate(async png => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + png;
      await image.decode();
      const sample = document.createElement('canvas');
      sample.width = 80;
      sample.height = 40;
      const ctx = sample.getContext('2d');
      ctx.drawImage(image, 0, 0, 80, 40);
      const data = ctx.getImageData(0, 0, 80, 40).data;
      const colors = new Set();
      for (let i = 0; i < data.length; i += 4) colors.add(data[i] * 65536 + data[i + 1] * 256 + data[i + 2]);
      return colors.size;
    }, after.toString('base64'));
    assert.ok(colors > 8, 'Pixi must restore the game frame after returning to the foreground');
    assert.equal(await canvas.evaluate(element => element.getContext('webgl2').getError()), 0);
    assert.deepEqual(await page.evaluate(atlasSize), [1024, 1024]);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    assert.equal(await page.locator('canvas#game').count(), 0);
    assert.deepEqual(await page.evaluate(atlasSize), [0, 0], 'Pixi shutdown must release the atlas backing canvas');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
  const failed = await browser.newPage();
  try {
    await failed.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
    await failed.addInitScript(trackAtlas);
    await failed.route('**/src/presentation.json', route => route.fulfill({ json: { backend: 'webgpu' } }));
    const [error] = await Promise.all([failed.waitForEvent('pageerror', { timeout: 15000 }), failed.goto(url)]);
    assert.equal(error.message, 'Unable to initialize a Pixi renderer');
    assert.equal(await failed.locator('canvas#game').count(), 0);
    assert.deepEqual(await failed.evaluate(atlasSize), [0, 0], 'Pixi startup failure must release the atlas backing canvas');
  } finally {
    await failed.close();
  }
  if (verifyWebGpu) await checkPixiWebGpuAtlas(url);
  console.log(JSON.stringify({ profile: 'pixi-recovery', contextRecovery: true, startupCleanup: true, startupBudget: true }));
}

try {
  browser = await chromium.launch({
    headless: true, ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'],
  });
  await checkPixiRecovery();
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
      try {
        await page.locator('canvas#game[data-engine-ready="true"]').waitFor({ timeout: 20000 });
      } catch (error) {
        throw new Error(profile + ' did not become ready. ' + errors.join(' | '), { cause: error });
      }
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
          return window.__hgameState?.()?.scene ?? null;
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
