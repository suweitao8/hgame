import assert from 'node:assert/strict';

const inputTimeout = { timeout: 5000 };
const runFrames = (page, frames) => page.evaluate(async count => {
  for (let i = 0; i < count; i++) await new Promise(resolve => requestAnimationFrame(resolve));
}, frames);

const waitForMove = (page, x) => page.waitForFunction(
  before => window.__hgameState().player.x > before + 0.05, x, inputTimeout);

async function attackWhileMoving(page, readState, attack) {
  const before = await readState();
  await attack();
  await page.waitForFunction(state => {
    const current = window.__hgameState();
    return state.manualAttacks === undefined
      ? current.bullets > state.bullets : current.manualAttacks > state.manualAttacks;
  }, before, inputTimeout);
  await waitForMove(page, (await readState()).player.x);
}

async function moveAndAttackWithTouch(page, readState) {
  const stick = page.locator('.hgame-joy-base');
  const attack = page.locator('.hgame-skill-btn[data-action="attack"]');
  const dash = page.locator('.hgame-skill-btn[data-action="dash"]');
  await stick.waitFor({ state: 'visible', ...inputTimeout });
  const [stickBox, attackBox, dashBox] = await Promise.all(
    [stick, attack, dash].map(button => button.boundingBox()));
  assert.ok(stickBox && attackBox && dashBox, 'Expected visible joystick, attack and dash controls');
  const center = ({ x, y, width, height }, id) => ({ x: x + width / 2, y: y + height / 2, id });
  const move = center(stickBox, 1);
  const fire = center(attackBox, 2);
  const deflected = { ...move, x: move.x + 28 };
  const dashCenter = center(dashBox);
  const middle = page.viewportSize().width / 2;
  assert.ok(stickBox.x + stickBox.width < middle && attackBox.x > middle,
    'Expected left joystick and right attack cluster');
  assert.ok(dashCenter.x > fire.x && dashCenter.y < fire.y && attackBox.width > dashBox.width && dashBox.width >= 48,
    'Expected a larger attack button with dash at its upper right');

  const client = await page.context().newCDPSession(page);
  const send = (type, touchPoints) => client.send('Input.dispatchTouchEvent', { type, touchPoints });
  let released = false;
  try {
    const before = await readState();
    await send('touchStart', [move]);
    await send('touchMove', [deflected]);
    await waitForMove(page, before.player.x);
    await attackWhileMoving(page, readState, async () => {
      await send('touchStart', [deflected, fire]);
      await send('touchMove', [{ ...deflected, x: move.x + 34 }, fire]);
    });
    assert.equal(await attack.getAttribute('data-active'), 'true');
    await runFrames(page, 36);
    await send('touchEnd', []);
    released = true;
  } finally {
    if (!released) await send('touchCancel', []).catch(() => {});
    // Leave the session attached until the page closes to preserve touch emulation.
  }
  assert.equal(await attack.getAttribute('data-active'), 'false');
}

export async function run({ page, readState, checkpoint, auditUi, measuringTouch }) {
  const initial = await readState();
  assert.ok(initial?.player && Number.isFinite(initial.player.x), 'Expected the starter player in __hgameState');
  assert.notEqual(initial.disposed, true);
  const hasSession = typeof initial.phase === 'string';
  const activate = locator => measuringTouch ? locator.tap(inputTimeout) : locator.click(inputTimeout);

  if (initial.phase === 'title') {
    await checkpoint('start from the title', async () => {
      await activate(page.locator('#start'));
      await page.waitForFunction(() => window.__hgameState().phase === 'playing', null, inputTimeout);
    });
  }
  await auditUi('playing');

  await checkpoint(measuringTouch ? 'two-finger movement and attack' : 'keyboard movement and attack', async () => {
    if (measuringTouch) {
      await moveAndAttackWithTouch(page, readState);
    } else {
      const before = await readState();
      await page.keyboard.down('d');
      try {
        await waitForMove(page, before.player.x);
        try {
          await attackWhileMoving(page, readState, () => page.keyboard.down('j'));
          await runFrames(page, 36);
        } finally {
          await page.keyboard.up('j');
        }
      } finally {
        await page.keyboard.up('d');
      }
    }
    const released = await readState();
    await runFrames(page, 4);
    assert.deepEqual((await readState()).player, released.player, 'Movement stops after input is released');
  });

  await checkpoint('pause and resume', async () => {
    const pause = page.locator('#pause');
    const resume = page.locator(hasSession ? '#restart' : '#resume');
    if (measuringTouch && await pause.isVisible()) await activate(pause);
    else await page.keyboard.press('Escape');
    await resume.waitFor({ state: 'visible', ...inputTimeout });
    await auditUi('paused');
    const paused = await readState();
    await page.keyboard.press('d', { delay: 120 });
    assert.deepEqual((await readState()).player, paused.player, 'The paused player stays still');
    if (measuringTouch) await activate(resume);
    else await page.keyboard.press('k', { delay: 100 });
    await resume.waitFor({ state: 'hidden', ...inputTimeout });
    if (hasSession) assert.equal((await readState()).phase, 'playing');
    await auditUi('resumed');
  });
}
