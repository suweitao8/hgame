import assert from 'node:assert/strict';

export async function run({ page, readState, checkpoint, auditUi }) {
  const initial = await readState();
  await checkpoint('startup', async () => {
    assert.ok(initial && initial.phase === 'playing', `expected initial playing phase: ${JSON.stringify(initial)}`);
    assert.ok(initial.player?.hp > 0, 'player should spawn alive');
    assert.equal(await page.locator('#debug').isVisible(), false, 'debug overlay must start hidden');
    await auditUi('playing');
  });

  await page.keyboard.down('d');
  await page.waitForTimeout(350);
  await page.keyboard.press('k');
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  await page.keyboard.up('d');

  const moved = await readState();
  await checkpoint('controls', async () => {
    assert.ok(moved.tick > initial.tick, 'simulation tick must advance');
    const dist = Math.hypot(
      (moved.player?.x ?? 0) - (initial.player?.x ?? 0),
      (moved.player?.z ?? 0) - (initial.player?.z ?? 0),
    );
    assert.ok(dist > 0.1, `WASD movement did not displace player (dist=${dist})`);
  });

  const combat = await page.evaluate(() => {
    const sim = window.__arena.sim;
    for (let i = 0; i < 2400 && !sim.state.over; i++) {
      sim.step(1 / 60, { attack: i % 15 === 0 });
    }
    const kills = sim.state.kills;
    for (let i = 0; i < 7200 && !sim.state.over; i++) {
      sim.step(1 / 60, {});
    }
    return { kills, over: sim.state.over, hp: sim.player.hp };
  });

  await page.locator('#gameover').waitFor({ state: 'visible', timeout: 5000 });
  const overState = await readState();
  await checkpoint('gameover', async () => {
    assert.ok(combat.kills > 0, `expected real combat kills before gameover: ${JSON.stringify(combat)}`);
    assert.equal(combat.over, true, `expected natural gameover: ${JSON.stringify(combat)}`);
    assert.equal(overState.phase, 'over');
    assert.ok(overState.best?.runs >= (initial.best?.runs ?? 0) + 1, 'gameover must record run count');
    await auditUi('gameover');
  });

  await page.locator('#restart').click();
  await page.waitForFunction(() => window.__hgameState?.().phase === 'playing', null, { timeout: 4000 });
  const restarted = await readState();
  await checkpoint('restarted', async () => {
    assert.equal(restarted.phase, 'playing');
    assert.ok(restarted.time < 3, `restart did not reset run time: ${restarted.time}`);
    assert.ok(restarted.player?.hp > 0, 'restart must restore HP');
    await auditUi('restarted');
  });

  return {
    kills: combat.kills,
    bestRuns: overState.best.runs,
    restartedPhase: restarted.phase,
  };
}

export async function verify({ page, readState, checkpoint, auditUi }, result) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#game[data-engine-ready=true]').waitFor({ timeout: 20000 });
  const reloaded = await readState();
  await checkpoint('reloaded', async () => {
    assert.ok(reloaded.best?.runs >= result.bestRuns, `best.runs did not persist across reload: ${JSON.stringify(reloaded)}`);
    assert.equal(await page.locator('#debug').isVisible(), false, 'debug overlay must remain hidden after reload');
    await auditUi('reloaded');
  });
}
