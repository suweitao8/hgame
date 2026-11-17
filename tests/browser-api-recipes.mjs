#!/usr/bin/env node
// Execute the CLI's documented recipes as the actual generated project entries.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
const temp = await mkdtemp(path.join(os.tmpdir(), 'hgame-recipes-'));
const chrome = process.argv.indexOf('--chrome');
let browser;
let server;
const run = args => {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
};
try {
  browser = await chromium.launch({ headless: true,
    ...(chrome >= 0 ? { executablePath: process.argv[chrome + 1] } : {}),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'] });
  for (const name of ['2d', 'horde', '3d', 'ui']) {
    const recipe = JSON.parse(run(['scripts/query-api.mjs', '--recipe', name, '--json']));
    const args = recipe.code.split('\n')[0].slice('// Create: node '.length)
      .match(/"[^"]*"|\S+/g).map(value => value.replace(/^"|"$/g, ''));
    const game = path.join(temp, 'recipe-' + name);
    run(args.map(value => value === '<dir>' ? game : value).concat('--no-git'));
    await writeFile(path.join(game, 'src/main.js'), recipe.code);
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
    if (name !== 'ui') assert.ok(Number.isInteger(after.tick) && after.tick > before.tick, `${name} advancing tick ${JSON.stringify(after)}`);
    if (name === '2d') assert.ok(after.hero.x > before.hero.x, '2d keyboard wiring');
    if (name === 'horde') assert.equal(after.activeUnits, 300, 'horde simulation and count wiring');
    if (name === '3d') assert.ok(Number.isFinite(after.terrainMaxY), '3d terrain/physics wiring');
    if (name === 'ui') assert.equal(after.locale, 'zh', 'UI locale getter');
    assert.deepEqual(errors, [], `${name} errors`);
    console.log(JSON.stringify({ recipe: name, before, after, errors }));
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
