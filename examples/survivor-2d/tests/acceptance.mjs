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
  await page.waitForTimeout(300);
  await page.keyboard.up('d');
  await page.keyboard.down('w');
  await page.waitForTimeout(200);
  await page.keyboard.up('w');

  const moved = await readState();
  await checkpoint('controls', async () => {
    assert.ok(moved.tick > initial.tick, 'simulation tick must advance');
    const dist = Math.hypot(
      (moved.player?.x ?? 0) - (initial.player?.x ?? 0),
      (moved.player?.y ?? 0) - (initial.player?.y ?? 0),
    );
    assert.ok(dist > 10, `WASD movement did not displace player (dist=${dist})`);
  });

  const levelupPrep = await page.evaluate(() => {
    const sim = window.__survivor.sim;
    sim.prefill(80, 180);
    for (let i = 0; i < 3600 && !sim.state.pending && !sim.state.over; i++) {
      sim.step(1 / 60, {});
    }
    return { pending: sim.state.pending, over: sim.state.over, kills: sim.state.kills };
  });
  assert.ok(Array.isArray(levelupPrep.pending) && levelupPrep.pending.length >= 2,
    `expected upgrade choices during combat: ${JSON.stringify(levelupPrep)}`);

  await page.locator('#levelup').waitFor({ state: 'visible', timeout: 5000 });
  const upgradeState = await readState();
  await checkpoint('upgrade', async () => {
    assert.equal(upgradeState.phase, 'upgrade');
    await auditUi('upgrade');
  });

  for (let i = 0; i < 4; i++) {
    const cur = await readState();
    if (cur.phase !== 'upgrade') break;
    await page.locator('#levelup button').first().click();
    await page.waitForTimeout(120);
  }
  await page.waitForFunction(() => window.__hgameState?.().phase === 'playing', null, { timeout: 4000 });
  await auditUi('post-upgrade');

  const combat = await page.evaluate(() => {
    const sim = window.__survivor.sim;
    sim.prefill(1200, 120);
    for (let i = 0; i < 12000 && !sim.state.over; i++) {
      sim.step(1 / 60, { choice: 0 });
    }
    return { kills: sim.state.kills, over: sim.state.over, hp: sim.player.hp };
  });

  await page.locator('#gameover').waitFor({ state: 'visible', timeout: 5000 });
  const overState = await readState();
  await checkpoint('gameover', async () => {
    assert.ok(combat.kills > 0, `expected combat kills before gameover: ${JSON.stringify(combat)}`);
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
