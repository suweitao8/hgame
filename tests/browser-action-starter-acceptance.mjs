import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createGamePreviewServer, createWebAssetServer } from '../webasset/server.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const tempRoot = path.resolve(os.tmpdir());
const temporary = await mkdtemp(path.join(tempRoot, 'hgame-starter-acceptance-'));
const gamesRoot = path.join(temporary, 'uploads');
const common = { gamesRoot, htmlGamesRoot: temporary };
const catalog = createWebAssetServer({ ...common, dbPath: path.join(temporary, 'assets.db') });
const preview = createGamePreviewServer(common);

async function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(String(server.address().port)));
  });
}

try {
  const env = {
    ...process.env,
    HGAME_ROOT: root,
    WEBASSET_PORT: await listen(catalog),
    WEBASSET_GAME_PORT: await listen(preview),
  };
  for (const [slug, args] of [
    ['pixi-arena', []],
    ['action-2d', ['--archetype', 'action-2d']],
    ['horde-2d', ['--archetype', 'horde-2d']],
    ['arena-3d', ['--archetype', 'arena-3d', '--quality', 'low']],
  ]) {
    const game = path.join(temporary, slug);
    await exec(process.execPath, [path.join(root, 'scripts/create-game.mjs'), game, '--no-git', ...args]);
    async function runReport(label, opts) {
      try {
        const result = await exec(process.execPath, opts, { cwd: game, env, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
        return JSON.parse(result.stdout);
      } catch (error) {
        throw new Error(slug + ' ' + label + '\n' + (error.stdout || error.stderr || error.message), { cause: error });
      }
    }
    const hardwareChrome = slug === 'arena-3d' ? process.env.HGAME_RELEASE_HARDWARE_CHROME : null;
    const browser = hardwareChrome ? ['--chrome', hardwareChrome] : [];
    const accepted = await runReport('acceptance', ['scripts/accept.mjs', '.', '--webasset', '--json', ...browser]);
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.gates.webasset.status, 'passed');
    const keyboard = accepted.gates.playtest.measuredCheckpoints;
    assert.ok(keyboard.some(entry => entry.name === 'keyboard movement and attack' && entry.ok));
    assert.ok(keyboard.some(entry => entry.name === 'pause and resume' && entry.ok));

    const touch = await runReport('touch', [
      path.join(root, 'scripts/playtest.mjs'), slug, '--webasset', '--scenario', 'tests/acceptance.mjs',
      '--ready', '#game[data-engine-ready=true]', '--state-ready', '--check-ui', '--check-layout',
      '--query', 'lang=zh', '--viewport', '360x800', '--touch',
      ...(hardwareChrome ? ['--gpu', 'hardware', ...browser] : []),
    ]);
    assert.equal(touch.ok, true);
    assert.equal(touch.peakTouchContacts, 2);
    assert.ok(touch.measuredCheckpoints.some(entry =>
      entry.name === 'two-finger movement and attack' && entry.ok && entry.multiTouchMoves > 0));
    assert.ok(touch.measuredCheckpoints.some(entry => entry.name === 'pause and resume' && entry.ok));
    console.log(JSON.stringify({ slug, accepted: true, keyboardFrames: accepted.gates.playtest.frameStats.frames,
      touchFrames: touch.frameStats.frames, multiTouchMoves: touch.multiTouchMoves, renderer: touch.rendererEnvironment.actualGpu }));
  }
} finally {
  await Promise.all([catalog, preview].map(server =>
    new Promise(resolve => server.listening ? server.close(resolve) : resolve())));
  if (path.dirname(temporary) === tempRoot) await rm(temporary, { recursive: true, force: true, maxRetries: 3 });
}
