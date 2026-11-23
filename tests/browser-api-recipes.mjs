#!/usr/bin/env node
// Execute the CLI's documented recipes as the actual generated project entries.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, firefox, webkit } from 'playwright-core';
import { benchmarkBrowserOptions } from '../scripts/lib/browser-benchmark.mjs';
import { verifyStorageQuota } from './browser-storage-quota.mjs';

const { values: { browser: browserName, chrome, headed } } = parseArgs({
  options: { browser: { type: 'string', default: 'chromium' }, chrome: { type: 'string' }, headed: { type: 'boolean' } },
});
const browserTypes = new Map([['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]);
const browserType = browserTypes.get(browserName);
assert.ok(browserType, 'Use --browser chromium, firefox or webkit');
assert.ok(!chrome || browserType === chromium, '--chrome requires Chromium');
const temp = await mkdtemp(path.join(os.tmpdir(), 'hgame-recipes-'));
let browser;
let server;
const run = args => {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
};
try {
  const options = browserType === chromium ? benchmarkBrowserOptions('software', chrome) : { headless: true };
  if (options.args) options.args = options.args.filter(arg => arg !== '--disable-frame-rate-limit');
  browser = await browserType.launch({ ...options, headless: !headed });
  const archetypes = ['action-2d', 'horde-2d', 'arena-3d'];
  for (const name of ['2d', 'horde', '3d', 'ui', ...archetypes]) {
    const isArchetype = archetypes.includes(name);
    const recipe = isArchetype ? null : JSON.parse(run(['scripts/query-api.mjs', '--recipe', name, '--json']));
    const args = isArchetype ? ['scripts/create-game.mjs', '<dir>', '--archetype', name] : recipe.code.split('\n')[0].slice('// Create: node '.length)
      .match(/"[^"]*"|\S+/g).map(value => value.replace(/^"|"$/g, ''));
    const game = path.join(temp, 'recipe-' + name);
    run(args.map(value => value === '<dir>' ? game : value).concat('--no-git'));
    // The Pixi recipes print the same starter source that create-game builds.
    if (name === '2d' || name === 'horde') {
      const entry = name === '2d' ? 'bare.js' : 'horde.js';
      const generatedSource = await readFile(path.join(game, 'src', entry), 'utf8');
      assert.ok(recipe.code.trimEnd().endsWith(generatedSource.trimEnd()), name + ' recipe matches packaged starter source');
    } else if (!isArchetype) {
      await writeFile(path.join(game, 'src/main.js'), recipe.code);
    }
    const socket = createServer();
    await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    server = spawn(process.execPath, ['scripts/preview.mjs', game, '--port', String(port)], { windowsHide: true, stdio: 'ignore' });
    const url = `http://127.0.0.1:${port}/`;
    for (let i = 0; ; i++) {
      assert.ok(i < 100 && server.exitCode === null, `${name} fixture failed`);
      try { if ((await fetch(url)).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, locale: 'en-US' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`); });
    if (name === 'action-2d') await page.addInitScript(() => {
      const pad = window.__recipePad = {
        index: 0, id: 'Xbox', mapping: 'standard', connected: true, axes: [0, 0],
        buttons: Array.from({ length: 16 }, () => ({ value: 0 })),
      };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
    });
    await page.goto(url);
    await page.waitForFunction(() => typeof window.__hgameState === 'function', null, { timeout: 10000 })
      .catch(error => { throw new Error(`${name}: ${errors.join('; ')} ${error.message}`); });
    if (isArchetype) {
      if (name === 'action-2d') {
        assert.equal(await page.locator('html').getAttribute('lang'), 'en');
        assert.equal(await page.locator('#start').textContent(), 'Start');
        await page.keyboard.press('j', { delay: 80 });
      }
      else await page.locator('#start').click({ timeout: 3000 });
      await page.waitForFunction(() => window.__hgameState().phase === 'playing', null, { timeout: 3000 });
    }
    const before = await page.evaluate(() => window.__hgameState());
    await page.keyboard.down('d');
    if (isArchetype) {
      await page.waitForFunction(x => window.__hgameState().player.x > x, before.player.x, { timeout: 3000 });
    } else {
      await page.waitForTimeout(300);
    }
    await page.keyboard.up('d');
    const after = await page.evaluate(() => window.__hgameState());
    if (name === '2d') assert.equal(after.scene, 'main', 'bare Pixi scene starts');
    if (name === '3d' || name === 'horde') assert.ok(Number.isInteger(after.tick) && after.tick > before.tick, name + ' advancing tick');
    if (name === 'horde') {
      assert.equal(after.activeUnits, 1200, 'default horde population');
      assert.ok(after.hero.x > before.hero.x, 'Pixi input moves the player');
    }
    if (name === '3d') assert.ok(Number.isFinite(after.terrainMaxY), '3d terrain/physics wiring');
    if (name === 'ui') assert.equal(after.locale, 'zh', 'UI locale getter');
    if (isArchetype) {
      assert.ok(after.player.x > before.player.x, name + ' moves in the generated entry');
      if (name !== 'horde-2d') {
        await page.waitForFunction(() => window.__hgameState().enemies > 0, null, { timeout: 5000 });
      }
    }
    assert.deepEqual(errors, [], `${name} errors`);
    console.log(JSON.stringify({ browser: browserName, version: browser.version(), recipe: name, before, after, errors }));
    if (name === 'action-2d') {
      await page.evaluate(() => { window.__recipePad.axes[0] = 0.65; });
      await page.waitForFunction(x => window.__hgameState().player.x > x, after.player.x, { timeout: 5000 });
      await page.evaluate(() => {
        window.__recipePad.axes[0] = 0;
        window.__recipePad.buttons[1].value = 1;
      });
      await page.waitForFunction(() => window.__hgameState().phase === 'paused', null, { timeout: 3000 });
      assert.equal(await page.locator('#restart').textContent(), 'Resume');
      await page.evaluate(() => {
        window.__recipePad.buttons[1].value = 0;
        window.__recipePad.buttons[0].value = 1;
      });
      await page.waitForFunction(() => window.__hgameState().phase === 'playing', null, { timeout: 3000 });
      await page.evaluate(() => { window.__recipePad.buttons[0].value = 0; });
      if (browserName === 'chromium') {
        const cdp = await page.context().newCDPSession(page);
        await page.setViewportSize({ width: 360, height: 800 });
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 8, y: 8 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const joystick = page.locator('.hgame-joy-base');
        const attack = page.locator('.hgame-skill-btn[data-action="attack"]');
        const dash = page.locator('.hgame-skill-btn[data-action="dash"]');
        await joystick.waitFor({ timeout: 3000 });
        assert.equal(await attack.locator('.hgame-btn-label').textContent(), 'Attack');
        assert.equal(await dash.locator('.hgame-btn-label').textContent(), 'Dash');
        const stick = await joystick.boundingBox();
        const large = await attack.boundingBox();
        const small = await dash.boundingBox();
        assert.ok(stick.x + stick.width < 180 && large.x > 180 && small.x > large.x);
        assert.ok(large.width > small.width && small.width >= 48 && small.y < large.y);
        const start = { x: stick.x + stick.width / 2, y: stick.y + stick.height / 2, id: 1 };
        const fire = { x: large.x + large.width / 2, y: large.y + large.height / 2, id: 2 };
        const x = await page.evaluate(() => window.__hgameState().player.x);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start, fire] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, x: start.x + 34 }, fire] });
        await page.waitForFunction(x => window.__hgameState().player.x > x, x, { timeout: 3000 });
        assert.equal(await attack.getAttribute('data-active'), 'true');
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        assert.equal(await attack.getAttribute('data-active'), 'false');
        await cdp.detach();
      }
      await page.goto(url + '?lang=zh');
      await page.waitForFunction(() => typeof window.__hgameState === 'function');
      assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
      assert.equal(await page.locator('#start').textContent(), '开始');
      assert.deepEqual(errors, [], 'action gamepad movement, menu, and touch');
    }
    if (name === '2d') {
      // Exercise real localStorage across navigation, then repair a corrupted primary.
      await page.evaluate(async () => {
        const { createVersionedStore } = await import('./vendor/hgame/platform/storage.js');
        const saves = createVersionedStore({ gameId: 'recipe-json', prefix: 'hgame.test' });
        saves.save('progress', { score: 1 });
        saves.save('progress', { score: 42, optional: undefined,
          savedAt: new Date('2026-11-17T00:00:00Z'), values: [NaN, undefined, Infinity] });
      });
      await page.reload();
      await page.waitForFunction(() => typeof window.__hgameState === 'function');
      const persistence = await page.evaluate(async () => {
        const { createVersionedStore } = await import('./vendor/hgame/platform/storage.js');
        const saves = createVersionedStore({ gameId: 'recipe-json', prefix: 'hgame.test' });
        try {
          const verified = saves.verify('progress');
          const loaded = saves.load('progress');
          const before = [saves.store.get('progress'), saves.store.get('progress.bak')];
          let rejected = false;
          try { saves.save('progress', { score: 1n }); } catch { rejected = true; }
          const unchanged = JSON.stringify(before) === JSON.stringify([
            saves.store.get('progress'), saves.store.get('progress.bak')]);
          const damaged = saves.store.get('progress');
          damaged.data.score = 999;
          saves.store.set('progress', damaged);
          return { verified, loaded, rejected, unchanged,
            recovered: saves.load('progress'), repaired: saves.verify('progress') };
        } finally { saves.remove('progress'); }
      });
      assert.equal(persistence.verified, true);
      assert.equal(persistence.loaded.ok, true);
      assert.equal(persistence.loaded.recovered, false);
      assert.deepEqual(persistence.loaded.value, {
        score: 42, savedAt: '2026-11-17T00:00:00.000Z', values: [null, null, null],
      });
      assert.equal(persistence.rejected, true);
      assert.equal(persistence.unchanged, true);
      assert.equal(persistence.recovered.ok, true);
      assert.equal(persistence.recovered.recovered, true);
      assert.deepEqual(persistence.recovered.value, { score: 1 });
      assert.equal(persistence.repaired, true);
      assert.deepEqual(errors, [], 'storage reload errors');
      console.log(JSON.stringify({ storage: persistence }));
      await verifyStorageQuota(page);
      assert.deepEqual(errors, [], 'quota storage reload errors');
    }
    await page.close();
    const ended = once(server, 'exit'); server.kill(); await ended; server = null;
  }
  // The network recipe is an import/boundary example; full transport lives in network/.
  const network = JSON.parse(run(['scripts/query-api.mjs', '--recipe', 'network', '--json']));
  const networkFile = path.join(temp, 'network.mjs');
  await writeFile(networkFile, network.code.replaceAll('../vendor/hgame/',
    new URL('../assets/runtime/', import.meta.url).href));
  run([networkFile]);
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; }
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
