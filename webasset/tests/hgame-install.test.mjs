import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const installer = path.join(root, 'scripts', 'install-hgame.mjs');

test('installer copies the runtime only into an explicit direct game folder', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'webasset-engine-install-'));
  const gamesRoot = path.join(temp, 'HTML');
  const game = path.join(gamesRoot, 'new-game');
  await mkdir(game, { recursive: true });
  try {
    const run = (...args) => spawnSync(process.execPath, [installer, ...args], { encoding: 'utf8' });
    const first = run('--project', game, '--games-root', gamesRoot);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const vendor = path.join(game, 'vendor', 'hgame');
    assert.match(await readFile(path.join(vendor, 'VERSION'), 'utf8'), /1\.0\.0/);
    await assert.rejects(stat(path.join(vendor, 'vendor')), 'no physics: no Rapier bundles');
    await writeFile(path.join(vendor, 'local-change.txt'), 'keep me');
    const second = run('--project', game, '--games-root', gamesRoot);
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /already exists/);
    assert.equal(await readFile(path.join(vendor, 'local-change.txt'), 'utf8'), 'keep me');
    const forced = run('--project', game, '--games-root', gamesRoot, '--force');
    assert.equal(forced.status, 0, forced.stderr || forced.stdout);
    await assert.rejects(readFile(path.join(vendor, 'local-change.txt')));
    const outside = path.join(temp, 'outside');
    await mkdir(outside);
    const rejected = run('--project', outside, '--games-root', gamesRoot);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /direct game folder/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('installer includes only the selected deterministic Rapier bundle', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'webasset-hgame-rapier-install-'));
  const gamesRoot = path.join(tmp, 'HTML');
  try {
    for (const [name, profile, renderer, dimension] of [['rapier-two', '2d', 'canvas2d', '2d'], ['rapier-three', '3d', 'threejs', '3d']]) {
      const game = path.join(gamesRoot, name);
      await mkdir(game, { recursive: true });
      await writeFile(path.join(game, 'engine.config.json'), JSON.stringify({
        configVersion: 1, profile, renderer, physics: `rapier${dimension}`,
        tickHz: 60, features: ['scene', 'input', `physics${dimension}`],
      }));
      const run = spawnSync(process.execPath, [installer, '--project', game, '--games-root', gamesRoot], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr || run.stdout);
      const rapier = path.join(game, 'vendor', 'hgame', 'vendor', `rapier${dimension}`);
      assert.ok((await stat(path.join(rapier, `rapier${dimension}.mjs`))).size > 100_000);
      assert.ok((await stat(path.join(rapier, `rapier${dimension}.wasm`))).size > 1_000_000);
      await assert.rejects(stat(path.join(game, 'vendor', 'hgame', 'vendor', `rapier${dimension === '2d' ? '3d' : '2d'}`)));
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});