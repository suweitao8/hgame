import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { WATCH_CONFIG, STORM_CONFIG } from '../src/sim/watch-config.js';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const integration = 'http://127.0.0.1:4175/local-games/ember-watch/index.html';
const output = path.resolve('build/ember-watch');
const errors = [];
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });
  const get = () => page.evaluate(() => window.__hgameState());
  const waitReady = () => page.locator('#game[data-engine-ready=true]').waitFor({ timeout: 15000 });
  await page.goto(integration);
  await waitReady();
  assert.equal((await get()).stormUnlocked, false);
  await page.evaluate(() => {
    const frames = [];
    window.__emberFrameGaps = frames;
    let previous;
    const sample = now => {
      if (previous !== undefined) frames.push(now - previous);
      previous = now;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  async function drive(config, sequence, handleUpgrade) {
    const origin = { x: 0, y: 0 };
    const objective = config.extraction;
    const deadline = Date.now() + 55000;
    let picks = 0;
    while (Date.now() < deadline) {
      const state = await get();
      if (state.over) return { state, picks };
      if (state.phase === 'upgrade') {
        await handleUpgrade(picks);
        picks++;
        await page.waitForTimeout(45);
        continue;
      }
      const target = state.extraction.relayCount < sequence.length
        ? objective.relays[sequence[state.extraction.relayCount]]
        : state.extraction.open || config === STORM_CONFIG ? origin : null;
      let keys;
      if (target) {
        const dx = target.x - state.player.x;
        const dy = target.y - state.player.y;
        keys = [];
        if (Math.abs(dx) > 16) keys.push(dx > 0 ? 'd' : 'a');
        if (Math.abs(dy) > 16) keys.push(dy > 0 ? 's' : 'w');
      } else {
        const orbit = ['d', 's', 'a', 'w'];
        keys = [orbit[Math.floor(state.time / 0.9) % orbit.length]];
      }
      for (const key of keys) await page.keyboard.down(key);
      await page.waitForTimeout(100);
      for (const key of keys) await page.keyboard.up(key);
    }
    assert.fail('Full playthrough timed out: ' + JSON.stringify(await get()));
  }

  const watch = await drive(WATCH_CONFIG, [1], picks => picks
    ? page.keyboard.press('Digit1')
    : page.locator('#choices button').first().click({ timeout: 3000 }));
  const perf = await page.evaluate(() => {
    const frames = window.__emberFrameGaps.sort((a, b) => a - b);
    return { frames: frames.length, p95Ms: frames[Math.floor(frames.length * 0.95)], p99Ms: frames[Math.floor(frames.length * 0.99)] };
  });
  assert.equal(watch.state.outcome, 'victory');
  assert.equal(watch.state.stormUnlocked, true);
  assert.ok(watch.picks > 0);
  await page.screenshot({ path: path.join(output, 'watch-win.png') });
  await page.locator('#storm').click();
  assert.equal((await get()).mode, 'storm');
  const storm = await drive(STORM_CONFIG, [0, 1], () => page.keyboard.press('Digit1'));
  assert.equal(storm.state.outcome, 'victory');
  assert.equal(storm.state.extraction.relayMask, 3);
  assert.equal(storm.state.best.runs, watch.state.best.runs + 1);
  await page.screenshot({ path: path.join(output, 'storm-win.png') });
  await page.locator('#restart').click();
  assert.equal((await get()).extraction.progress, 0);
  await page.reload();
  await waitReady();
  const reloaded = await get();
  assert.deepEqual(reloaded.best, storm.state.best);
  assert.equal(reloaded.stormUnlocked, true);
  assert.equal(reloaded.mode, 'storm');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ watch, storm, perf, errors }, null, 2));
} finally {
  await browser.close();
}
