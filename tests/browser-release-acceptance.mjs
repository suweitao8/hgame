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
  async function accept(flags = [], expected = 0) {
    const args = ['scripts/accept.mjs', '.', '--release', '--json', ...flags];
    let result;
    try {
      result = await exec(process.execPath, args, { cwd: game, env, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
      assert.equal(expected, 0);
    } catch (error) {
      assert.equal(error.code, expected, error.stderr || error.stdout || error.message);
      result = error;
    }
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
} finally {
  await Promise.all([close(catalog), close(preview)]);
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
