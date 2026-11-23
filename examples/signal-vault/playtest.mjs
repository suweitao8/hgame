import assert from 'node:assert/strict';
import { solutions } from './routes.mjs';

const key = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const ready = '#game[data-engine-ready=true]';

export async function run({ page, readState, checkpoint }) {
  const initial = await readState();
  await checkpoint('fresh campaign starts in room one', () => {
    assert.equal(initial.room, 0);
    assert.equal(initial.rooms, solutions.length);
  });
  await page.waitForTimeout(350);
  await checkpoint('idle board schedules no renders', async () => {
    assert.equal((await readState()).frames, initial.frames);
  });
  await page.keyboard.press('ArrowRight');
  await checkpoint('one input draws one frame', async () => {
    const state = await readState();
    assert.equal(state.moves, 1);
    assert.equal(state.frames, initial.frames + 1);
  });
  await page.keyboard.press('z');
  await checkpoint('undo restores the first push', async () => {
    const state = await readState();
    assert.deepEqual(state.cells, initial.cells);
    assert.deepEqual(state.player, initial.player);
    assert.equal(state.moves, 0);
  });
  const roomMoves = [];
  for (const [index, solution] of solutions.entries()) {
    for (const step of solution) await page.keyboard.press(key[step]);
    await checkpoint('exit reached in room ' + (index + 1), async () => {
      const state = await readState();
      assert.equal(state.room, index);
      assert.equal(state.won, true);
      assert.equal(state.moves, solution.length);
      roomMoves.push(state.moves);
    });
    if (index < solutions.length - 1) await page.locator('#next').click();
  }
  await page.getByRole('heading', { name: '信号恢复', exact: true }).waitFor();
  return { roomMoves };
}

export async function verify({ page, readState, checkpoint }) {
  await page.reload();
  await page.locator(ready).waitFor({ timeout: 15000 });
  await checkpoint('reload retains the last room', async () => {
    const state = await readState();
    assert.equal(state.room, solutions.length - 1);
    assert.equal(state.moves, 0);
    assert.equal(state.won, false);
  });
  const beforeResize = await readState();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('#game').clientWidth === 390);
  await checkpoint('portrait viewport redraws without changing the puzzle', async () => {
    const state = await readState();
    assert.deepEqual(state.player, beforeResize.player);
    assert.deepEqual(state.cells, beforeResize.cells);
    assert.equal(await page.locator('#game').evaluate(canvas => canvas.clientWidth), 390);
  });
}
