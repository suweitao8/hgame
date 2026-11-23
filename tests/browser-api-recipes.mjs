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
  for (const name of ['2d', 'horde', '3d', 'ui']) {
    const recipe = JSON.parse(run(['scripts/query-api.mjs', '--recipe', name, '--json']));
    const args = recipe.code.split('\n')[0].slice('// Create: node '.length)
      .match(/"[^"]*"|\S+/g).map(value => value.replace(/^"|"$/g, ''));
    const game = path.join(temp, 'recipe-' + name);
    run(args.map(value => value === '<dir>' ? game : value).concat('--no-git'));
    // The Pixi recipes print the same starter source that create-game builds.
    if (name === '2d' || name === 'horde') {
      const entry = name === '2d' ? 'bare.js' : 'horde.js';
      const generatedSource = await readFile(path.join(game, 'src', entry), 'utf8');
      assert.ok(recipe.code.trimEnd().endsWith(generatedSource.trimEnd()), name + ' recipe matches packaged starter source');
    } else {
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
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(url);
    await page.waitForFunction(() => typeof window.__hgameState === 'function', null, { timeout: 10000 })
      .catch(error => { throw new Error(`${name}: ${errors.join('; ')} ${error.message}`); });
    const before = await page.evaluate(() => window.__hgameState());
    await page.keyboard.down('d');
    await page.waitForTimeout(300);
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
    assert.deepEqual(errors, [], `${name} errors`);
    console.log(JSON.stringify({ browser: browserName, version: browser.version(), recipe: name, before, after, errors }));
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
