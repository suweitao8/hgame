#!/usr/bin/env node
// Temporary loopback fixtures are used only by this automated acceptance tool.
// --webasset instead verifies the already registered isolated live runtimes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium, firefox, webkit } from 'playwright-core';
import { buildExample } from '../scripts/build-examples.mjs';

const argv = process.argv.slice(2);
const live = argv.includes('--webasset');
const mobile = argv.includes('--mobile');
function option(name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}
const browserName = option('--browser') ?? 'chromium';
const browserType = { chromium, firefox, webkit }[browserName];
assert.ok(['chromium', 'firefox', 'webkit'].includes(browserName), 'Use --browser chromium, firefox or webkit');
assert.ok(!mobile || browserName === 'chromium', '--mobile uses Chromium touch dispatch');
const executablePath = option('--executable') ?? option('--chrome');
const children = [];
let browser;
async function fixture(id) {
  if (live) return `http://127.0.0.1:4175/local-games/${id}/index.html`;
  const dir = await buildExample(id);
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['scripts/preview.mjs', dir, '--port', String(port)],
    { windowsHide: true, stdio: 'ignore' });
  children.push(child);
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`${id} fixture exited`);
    try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return `http://127.0.0.1:${port}/`; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`${id} fixture timed out`);
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, (b.z ?? b.y) - (a.z ?? a.y));
}

async function exerciseTouch(page, read, id) {
  const joystick = page.locator('.hgame-joy-zone');
  await joystick.waitFor();
  const zone = await joystick.boundingBox();
  const x = Math.round(zone.x + zone.width / 3);
  const y = Math.round(zone.y + zone.height / 2);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, touchPoints = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const before = await read();
  const dragX = x + 45;
  await touch('touchStart', [{ x, y, id: 0 }]);
  await touch('touchMove', [{ x: dragX, y, id: 0 }]);
  await page.waitForFunction(({ tick }) => window.__hgameState().tick >= tick + 10, { tick: before.tick });
  const moved = await read();
  assert.ok(distance(before.player, moved.player) > 0.1, `${id} touch movement`);
  const input = () => page.evaluate(() => ({
    pointers: (window.__arena ?? window.__survivor).app.input.pointerCount,
    joystick: document.querySelector('.hgame-joy-base').dataset.active,
  }));
  assert.deepEqual(await input(), { pointers: 1, joystick: 'true' });
  await touch('touchCancel');
  assert.deepEqual(await input(), { pointers: 0, joystick: 'false' });
  const cancelled = await read();
  await page.waitForFunction(tick => window.__hgameState().tick >= tick + 36, cancelled.tick);
  const settled = await read();
  await page.waitForFunction(tick => window.__hgameState().tick >= tick + 12, settled.tick);
  assert.ok(distance(settled.player, (await read()).player) < 0.05, `${id} motion settled after touch cancel`);
  await cdp.detach();
  return { moved: true, cancelled: true };
}

try {
  browser = await browserType.launch({ headless: true, ...(executablePath ? { executablePath } : {}),
    ...(browserName === 'chromium' ? { args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'] } : {}) });
  for (const id of ['survivor-2d', 'arena-3d']) {
    const url = await fixture(id);
    const page = await browser.newPage(mobile
      ? { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : { viewport: { width: 960, height: 540 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => {
      if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(url + '?seed=1&tier=low');
    await page.locator('#game[data-engine-ready=true]').waitFor({ timeout: 20000 })
      .catch(error => { throw new Error(`${id} did not load: ${errors.join('; ')}; ${error.message}`); });
    assert.equal(await page.evaluate(() => typeof window.__hgameState), 'function', `${id} state hook`);
    const read = () => page.evaluate(() => window.__hgameState());
    const initial = await read();
    await page.keyboard.down('d');
    await page.waitForTimeout(500);
    await page.keyboard.up('d');
    const moved = await read();
    assert.ok(moved.tick > initial.tick, `${id} scheduler progress`);
    assert.ok(distance(initial.player, moved.player) > 0.1, `${id} keyboard movement`);
    const touch = mobile ? await exerciseTouch(page, read, id) : null;
    assert.equal(await page.locator('#debug').isVisible(), false);
    let completed;
    for (let cycle = 0; cycle < 3; cycle++) {
      // Drive the existing deterministic game-owned simulation, never write death flags or scores.
      const combat = await page.evaluate(({ id, cycle }) => {
        const sim = id === 'survivor-2d' ? window.__survivor.sim : window.__arena.sim;
        if (id === 'survivor-2d') sim.prefill(1500, 120);
        for (let i = 0; i < 1800 && !sim.state.over; i++) {
          sim.step(1 / 60, id === 'survivor-2d' ? { choice: 0 } : { attack: true });
        }
        const kills = sim.state.kills;
        for (let i = 0; i < 7200 && !sim.state.over; i++) {
          sim.step(1 / 60, id === 'survivor-2d' ? { choice: 2 } : {});
        }
        return { kills, over: sim.state.over, hp: sim.player.hp, cycle };
      }, { id, cycle });
      assert.ok(combat.kills > 0, `${id} combat ${JSON.stringify(combat)}`);
      assert.equal(combat.over, true, `${id} natural death ${JSON.stringify(combat)}`);
      assert.equal(combat.hp, 0);
      await page.locator('#gameover').waitFor({ state: 'visible' });
      completed = await read();
      assert.equal(completed.phase, 'over');
      assert.equal(completed.best.runs, initial.best.runs + cycle + 1);
      assert.ok(completed.best.time + 0.005 >= completed.time, `${id} saved time ${JSON.stringify(completed)}`);
      if (cycle < 2) {
        if (cycle === 0 && mobile) await page.locator('#restart').tap();
        else if (cycle === 0) await page.locator('#restart').click();
        else { await page.keyboard.down('u'); await page.waitForTimeout(100); await page.keyboard.up('u'); }
        await page.waitForFunction(() => window.__hgameState().phase === 'playing', null, { timeout: 3000 })
          .catch(async error => { throw new Error(`${id} restart cycle ${cycle}: ${JSON.stringify(await read())}; errors: ${errors.join('; ')}; ${error.message}`); });
        const restarted = await read();
        assert.ok(restarted.time < 3, `${id} restart clears simulation time`);
        assert.ok(restarted.player.hp > 0);
        assert.deepEqual(restarted.best, completed.best);
      }
    }
    await page.reload();
    await page.locator('#game[data-engine-ready=true]').waitFor();
    const reloaded = await read();
    assert.deepEqual(reloaded.best, completed.best, `${id} persistence after reload`);
    await page.keyboard.down('d');
    const disposal = await page.evaluate(id => {
      const { app } = id === 'survivor-2d' ? window.__survivor : window.__arena;
      const renderer = app.renderer;
      let disposed = 0;
      const dispose = renderer.dispose.bind(renderer);
      renderer.dispose = () => { disposed++; return dispose(); };
      const first = app.dispose(), second = app.dispose();
      return { first, second, disposed, running: app.running, inputHeld: app.input.isDown('KeyD'),
        touchRoots: document.querySelectorAll('[data-hgame-touch-root]').length };
    }, id);
    assert.deepEqual(disposal, { first: true, second: false, disposed: 1, running: false, inputHeld: false, touchRoots: 0 });
    const stopped = await read();
    await page.waitForTimeout(150);
    await page.keyboard.up('d');
    assert.deepEqual(await read(), stopped, `${id} no work after disposal`);
    assert.equal(stopped.disposed, true);
    assert.deepEqual(errors, [], `${id} browser errors`);
    console.log(JSON.stringify({ id, browser: browserName, version: browser.version(), live, mobile, touch,
      cycles: 3, kills: completed.kills, best: completed.best, disposal, errors }));
    await page.close();
  }
} finally {
  await browser?.close();
  for (const child of children) {
    if (child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
  }
}
