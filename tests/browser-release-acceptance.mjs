#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createGamePreviewServer, createWebAssetServer } from '../webasset/server.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-release-evidence-'));
const hardwareChrome = process.env.HGAME_RELEASE_HARDWARE_CHROME;
const game = path.join(tmp, 'release-probe');
const gamesRoot = path.join(tmp, 'uploads');
const common = { gamesRoot, htmlGamesRoot: tmp };
let catalog;
let preview;

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(String(server.address().port)));
});
const close = server => new Promise(resolve => server?.listening ? server.close(resolve) : resolve());

try {
  await exec(process.execPath, ['scripts/create-game.mjs', game, '--archetype', 'action-2d', '--no-git'], { cwd: root });
  await writeFile(path.join(game, 'tests', 'acceptance.mjs'), `
export async function run({ page, readState, checkpoint }) {
  await checkpoint('player moves from the title', async () => {
    await page.keyboard.press('j', { delay: 120 });
    const before = (await readState()).player.x;
    await page.keyboard.down('d');
    try {
      await page.waitForFunction(x => window.__hgameState().player.x > x + 16, before, { timeout: 3000 });
      await page.waitForTimeout(700);
    } finally { await page.keyboard.up('d'); }
  });
}
`);
  const spec = {
    target: 'web',
    autoplay: 'The release fixture verifies entry and movement without a scored run.',
    doctor: 'The fixture has no authored doctor hook.',
    limits: {
      desktop: { readyMs: 5000, p95Ms: 100 },
      mobile: { readyMs: 5000, p95Ms: 100 },
      zipBytes: 2_000_000,
    },
  };
  await writeFile(path.join(game, 'tests', 'release.json'), JSON.stringify(spec));
  const gameConfig = path.join(game, 'game.config.json');
  const originalConfig = await readFile(gameConfig, 'utf8');
  const defaultEntry = path.join(game, 'index.html');
  const customEntry = path.join(game, 'play.html');
  await writeFile(gameConfig, JSON.stringify({ ...JSON.parse(originalConfig), entry: 'play.html' }));
  await rename(defaultEntry, customEntry);
  catalog = createWebAssetServer({ ...common, dbPath: path.join(tmp, 'assets.db') });
  preview = createGamePreviewServer(common);
  const env = {
    ...process.env, HGAME_ROOT: root,
    WEBASSET_PORT: await listen(catalog), WEBASSET_GAME_PORT: await listen(preview),
  };
  async function accept(flags = [], expected = 0, directory = game) {
    const args = ['scripts/accept.mjs', '.', '--release', '--json', ...flags];
    let result;
    let status = 0;
    try {
      result = await exec(process.execPath, args, { cwd: directory, env, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
    } catch (error) {
      status = error.code;
      result = error;
    }
    assert.ok([expected].flat().includes(status), result.stderr || result.stdout || result.message);
    return JSON.parse(result.stdout);
  }
  const report = await accept();
  assert.equal(report.releaseReady, true, report.problems.join('; '));
  assert.equal(report.playable, true);
  assert.equal(report.gates.webasset.status, 'passed');
  assert.equal(report.gates.release.status, 'passed');
  assert.equal(report.gates.package.playtest.status, 'passed');
  assert.ok(report.gates.release.measured.desktop.frames >= 30);
  assert.ok(report.gates.release.measured.mobile.frames >= 30);
  assert.ok(report.gates.release.measured.zipBytes > 0);
  assert.equal((await accept(['--verify-fresh'])).releaseReady, true);
  const archive = path.join(game, report.gates.package.archive);
  const packageBytes = await readFile(archive);
  await writeFile(archive, Buffer.concat([packageBytes, Buffer.from('changed')]));
  assert.match((await accept(['--verify-fresh'], 1)).problems.join(' '), /Release archive/);
  await writeFile(archive, packageBytes);
  await writeFile(path.join(game, 'assets', 'release-probe.txt'), 'added after release');
  assert.match((await accept(['--verify-fresh'], 1)).problems.join(' '), /acceptance report is stale/i);
  await rm(path.join(game, 'assets', 'release-probe.txt'));
  const rootScript = path.join(game, 'helper.js');
  await writeFile(rootScript, 'export const changed = true;');
  assert.match((await accept(['--verify-fresh'], 1)).problems.join(' '), /acceptance report is stale/i);
  await rm(rootScript);
  console.log(JSON.stringify({ target: 'web', releaseReady: report.releaseReady, ...report.gates.release.measured }));
  await rename(customEntry, defaultEntry);
  await writeFile(gameConfig, originalConfig);
  await writeFile(path.join(game, 'tests', 'release.json'), JSON.stringify({ ...spec, target: 'toy' }));
  const toy = await accept();
  assert.equal(toy.releaseReady, true, toy.problems.join('; '));
  assert.equal(toy.gates.release.target, 'toy');
  assert.equal((await accept(['--verify-fresh'])).releaseReady, true);
  console.log(JSON.stringify({ target: 'toy', releaseReady: toy.releaseReady, ...toy.gates.release.measured }));
  await writeFile(path.join(game, 'tests', 'release.json'), JSON.stringify({
    ...spec, limits: { ...spec.limits, zipBytes: 1 },
  }));
  const oversize = await accept([], 1);
  assert.equal(oversize.playable, true);
  assert.equal(oversize.releaseReady, false);
  assert.match(oversize.gates.release.errors.join(' '), /Package exceeded byte budget/);

  const pixi = path.join(tmp, 'release-pixi-arena');
  await exec(process.execPath, ['scripts/create-game.mjs', pixi, '--no-git'], { cwd: root });
  await writeFile(path.join(pixi, 'tests', 'release.json'), JSON.stringify({ ...spec, target: 'toy' }));
  await writeFile(path.join(pixi, 'tests', 'acceptance.mjs'), `
export async function run({ page, readState, checkpoint, auditUi }) {
  await auditUi('playing');
  await checkpoint('attack while moving', async () => {
    const before = (await readState()).player.x;
    await page.keyboard.down('d');
    await page.keyboard.down('j');
    try {
      await page.waitForFunction(x => window.__hgameState().player.x > x + 16 && window.__hgameState().bullets > 0, before, { timeout: 4000 });
      // Collect enough frames during motion even when software rendering is slow.
      await page.evaluate(async () => {
        for (let count = 0; count < 40; count++) await new Promise(resolve => requestAnimationFrame(resolve));
      });
    } finally {
      await page.keyboard.up('j');
      await page.keyboard.up('d');
    }
  });
  await checkpoint('pause and resume', async () => {
    await page.keyboard.press('Escape');
    const resume = page.locator('#resume');
    await resume.waitFor({ timeout: 3000 });
    await auditUi('paused');
    const paused = (await readState()).player.x;
    await page.keyboard.press('d', { delay: 100 });
    if ((await readState()).player.x !== paused) throw new Error('Player moved while paused');
    await resume.click();
    await resume.waitFor({ state: 'hidden', timeout: 3000 });
    await auditUi('resumed');
  });
}
`);
  const pixiReport = await accept([], 0, pixi);
  assert.equal(pixiReport.releaseReady, true, pixiReport.problems.join('; '));
  assert.equal(pixiReport.gates.webasset.status, 'passed');
  assert.equal((await accept(['--verify-fresh'], 0, pixi)).releaseReady, true);
  console.log(JSON.stringify({ profile: 'pixi-arena', target: 'toy', releaseReady: true, ...pixiReport.gates.release.measured }));

  for (const profile of ['horde-2d', 'arena-3d']) {
    const project = path.join(tmp, 'release-' + profile);
    const target = profile === 'arena-3d' ? 'web' : 'toy';
    const verifyHardware = profile === 'arena-3d' && Boolean(hardwareChrome);
    const quality = profile === 'arena-3d' ? ['--quality', 'low'] : [];
    await exec(process.execPath, ['scripts/create-game.mjs', project, '--archetype', profile, ...quality, '--no-git'], { cwd: root });
    const designPath = path.join(project, 'src', 'game.design.json');
    const design = JSON.parse(await readFile(designPath, 'utf8'));
    // A short authored defeat fixture exercises the real damage path in each build.
    Object.assign(design.design.balance, { playerHp: 30, gruntDamage: 10, gruntHp: 120 });
    await writeFile(designPath, JSON.stringify(design));
    await writeFile(path.join(project, 'tests', 'release.json'), JSON.stringify({
      ...spec, target,
      ...(verifyHardware ? { gpu: 'hardware' } : {}),
      autoplay: 'The authored defeat fixture verifies result and replay rather than a clear.',
      limits: { ...spec.limits, zipBytes: 3_000_000 },
    }));
    await writeFile(path.join(project, 'tests', 'acceptance.mjs'), `
async function confirm(page) {
  await page.keyboard.down('j');
  try {
    await page.waitForFunction(() => window.__hgameState().phase === 'playing', null, { timeout: 4000 });
  } finally {
    await page.keyboard.up('j');
  }
}

export async function run({ page, readState, checkpoint, auditUi }) {
  const before = await readState();
  if (before.phase !== 'title') throw new Error('Release did not start at its title');
  await auditUi('title');
  await checkpoint('start and move', async () => {
    await confirm(page);
    await auditUi('playing');
    const x = (await readState()).player.x;
    await page.keyboard.down('d');
    try {
      await page.waitForFunction(x => window.__hgameState().player.x > x, x, { timeout: 4000 });
    } finally {
      await page.keyboard.up('d');
    }
  });
  await checkpoint('take damage and reach the result', async () => {
    const directions = ['d', 's', 'a', 'w'];
    for (let turn = 0; turn < 16 && (await readState()).phase !== 'result'; turn++) {
      await page.keyboard.press(directions[turn % directions.length], { delay: 1200 });
    }
    const result = await readState();
    if (result.phase !== 'result' || result.hp !== 0 || result.victory || result.meta.runs !== before.meta.runs + 1) {
      throw new Error('Defeat did not record the completed run');
    }
    await auditUi('result');
  });
  await checkpoint('restart from result', async () => {
    await page.locator('#mute').focus();
    await page.keyboard.press('Enter', { delay: 120 });
    const muted = await readState();
    if (muted.phase !== 'result' || !muted.audio.muted) throw new Error('Enter on Mute must keep the result open');
    await page.evaluate(() => {
      const pad = {
        index: 0, id: 'Xbox', mapping: 'standard', connected: true, axes: [0, 0],
        buttons: Array.from({ length: 16 }, (_, index) => ({ value: index === 0 ? 1 : 0 })),
      };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
    });
    await page.waitForFunction(() => window.__hgameState().phase === 'playing', null, { timeout: 4000 });
    const restarted = await readState();
    if (restarted.hp !== restarted.maxHp || Math.abs(restarted.player.x) > 0.001) {
      throw new Error('Replay did not reset HP and position');
    }
    await auditUi('replay');
  });
}
`);
    // Software-only hosts must still exercise the packaged lifecycle. A missed
    // frame budget stays a failed release, even when all gameplay checks pass.
    const complete = await accept(verifyHardware ? ['--chrome', hardwareChrome] : [],
      profile === 'arena-3d' && !verifyHardware ? [0, 1] : 0, project);
    assert.equal(complete.playable, true, complete.problems.join('; '));
    assert.equal(complete.gates.package.status, 'passed');
    assert.equal(complete.gates.package.playtest.status, 'passed');
    for (const viewport of ['desktop', 'mobile']) {
      const observed = complete.gates.release.measured[viewport].rendererEnvironment;
      assert.equal(observed.requestedGpu, verifyHardware ? 'hardware' : 'software');
      assert.equal(observed.actualGpu, verifyHardware ? 'hardware' : 'software');
      assert.ok(observed.renderer);
    }
    if (complete.releaseReady) {
      assert.equal((await accept(['--verify-fresh'], 0, project)).releaseReady, true);
    } else {
      const errors = complete.gates.release.errors;
      assert.ok(errors.length > 0 && errors.every(message =>
        /^(desktop|mobile)\.p95Ms exceeded budget/.test(message)), complete.problems.join('; '));
      assert.equal(complete.gates.release.status, 'failed');
    }
    console.log(JSON.stringify({ profile, target, releaseReady: complete.releaseReady, ...complete.gates.release.measured }));
  }
} finally {
  await Promise.all([close(catalog), close(preview)]);
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
