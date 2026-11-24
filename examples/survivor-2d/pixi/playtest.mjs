import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { WATCH_CONFIG, STORM_CONFIG } from '../src/sim/watch-config.js';

const output = path.resolve('build/ember-watch');
const ready = '#game[data-engine-ready=true]';

async function drive({ page, readState }, config, sequence, handleUpgrade) {
  const origin = { x: 0, y: 0 };
  const objective = config.extraction;
  const deadline = Date.now() + 55000;
  let picks = 0;
  while (Date.now() < deadline) {
    const state = await readState();
    if (state.over) return { state, picks };
    if (state.phase === 'upgrade') {
      await handleUpgrade(picks++);
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
  assert.fail('Full playthrough timed out: ' + JSON.stringify(await readState()));
}

export async function run(context) {
  const { page, readState, checkpoint } = context;
  await mkdir(output, { recursive: true });
  await checkpoint('fresh save starts in Watch', async () => {
    const initial = await readState();
    assert.equal(initial.mode, 'watch');
    assert.equal(initial.stormUnlocked, false);
  });
  const watch = await drive(context, WATCH_CONFIG, [1], picks => picks
    ? page.keyboard.press('Digit1')
    : page.locator('#choices button').first().click({ timeout: 3000 }));
  await checkpoint('Watch wins and unlocks Storm', () => {
    assert.equal(watch.state.outcome, 'victory');
    assert.equal(watch.state.stormUnlocked, true);
    assert.ok(watch.picks > 0);
  });
  await page.screenshot({ path: path.join(output, 'watch-win.png') });
  await page.locator('#storm').click();
  await checkpoint('results switch to Storm', async () => assert.equal((await readState()).mode, 'storm'));
  const storm = await drive(context, STORM_CONFIG, [0, 1], () => page.keyboard.press('Digit1'));
  await checkpoint('Storm wins with both relays', () => {
    assert.equal(storm.state.outcome, 'victory');
    assert.equal(storm.state.extraction.relayMask, 3);
    assert.equal(storm.state.best.runs, watch.state.best.runs + 1);
  });
  await page.screenshot({ path: path.join(output, 'storm-win.png') });
  return { watch, storm };
}

export async function verify({ page, readState, checkpoint }, { storm }) {
  await page.locator('#restart').click();
  await checkpoint('restart clears extraction progress', async () => assert.equal((await readState()).extraction.progress, 0));
  await page.reload();
  await page.locator(ready).waitFor({ timeout: 15000 });
  await checkpoint('reload retains score and selected mode', async () => {
    const reloaded = await readState();
    assert.deepEqual(reloaded.best, storm.state.best);
    assert.equal(reloaded.stormUnlocked, true);
    assert.equal(reloaded.mode, 'storm');
  });
}
