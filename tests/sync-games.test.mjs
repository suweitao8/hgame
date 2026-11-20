import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const createGame = path.join(root, 'scripts', 'create-game.mjs');
const syncGames = path.join(root, 'scripts', 'sync-games.mjs');

function runNode(script, args, opts = {}) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', ...opts });
}

test('create-game generates .hgame-sync.json, isolates engine files in .gitignore, and reports up-to-date', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-sync-create-'));
  const game = path.join(tmp, 'fresh-2d');
  try {
    const gen = runNode(createGame, [game, '--profile', '2d', '--renderer', 'canvas2d']);
    assert.equal(gen.status, 0, gen.stderr || gen.stdout);

    const manifest = JSON.parse(await readFile(path.join(game, '.hgame-sync.json'), 'utf8'));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.engine, 'HGame');
    assert.ok(manifest.files['vendor/hgame/index.js']);
    assert.ok(manifest.files['scripts/package-game.mjs']);
    assert.ok(manifest.files['docs/api/API-INDEX.json']);

    const gitStatus = spawnSync('git', ['status', '--short', '--untracked-files=all'], { cwd: game, encoding: 'utf8' });
    assert.equal(gitStatus.status, 0, gitStatus.stderr);
    assert.match(gitStatus.stdout, /\.hgame-sync\.json/);
    assert.match(gitStatus.stdout, /src\//);
    assert.doesNotMatch(gitStatus.stdout, /vendor\/hgame/);
    assert.doesNotMatch(gitStatus.stdout, /scripts\/package-game\.mjs/);
    assert.doesNotMatch(gitStatus.stdout, /docs\/api/);

    const status = runNode(syncGames, ['--status', '--strict', '--root', tmp, '--json']);
    assert.equal(status.status, 0, status.stderr || status.stdout);
    const report = JSON.parse(status.stdout);
    assert.equal(report.managed, 1);
    assert.equal(report.upToDate, 1);
    assert.equal(report.projects[0].status, 'up-to-date');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('sync-games classifies status, guards local edits, preserves game files, and syncs 3d/pixi2d projects', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-sync-suite-'));
  const gamesRoot = path.join(tmp, 'HTML');
  await mkdir(gamesRoot, { recursive: true });

  try {
    const gFresh = path.join(gamesRoot, 'fresh-game');
    const gOutdated = path.join(gamesRoot, 'arena-sample');
    const gLegacy = path.join(gamesRoot, 'legacy-game');
    const gEdited = path.join(gamesRoot, 'edited-game');
    const gPixi = path.join(gamesRoot, 'horde-sample');
    const gNonHgame = path.join(gamesRoot, 'plain-html');

    assert.equal(runNode(createGame, [gFresh, '--profile', '2d', '--renderer', 'canvas2d', '--no-git']).status, 0);
    assert.equal(runNode(createGame, [gOutdated, '--profile', '3d', '--with', 'physics3d', '--no-git']).status, 0);
    assert.equal(runNode(createGame, [gLegacy, '--profile', '2d', '--renderer', 'canvas2d', '--no-git']).status, 0);
    assert.equal(runNode(createGame, [gEdited, '--profile', '2d', '--renderer', 'canvas2d', '--no-git']).status, 0);
    assert.equal(runNode(createGame, [gPixi, '--preset', 'horde', '--no-git']).status, 0);
    await mkdir(gNonHgame, { recursive: true });
    await writeFile(path.join(gNonHgame, 'index.html'), '<h1>plain</h1>\n');

    // Custom game files & custom script that sync must preserve.
    await writeFile(path.join(gOutdated, 'src', 'custom-logic.js'), 'export const keepMe = 42;\n');
    await writeFile(path.join(gOutdated, 'scripts', 'custom-audit.mjs'), 'console.log("keep");\n');

    // Simulate outdated game (manifest matches stale disk state via fake old file hash / missing runtime file).
    await writeFile(path.join(gOutdated, 'vendor', 'hgame', 'stale-removed.js'), 'old\n');
    const outdatedSync = JSON.parse(await readFile(path.join(gOutdated, '.hgame-sync.json'), 'utf8'));
    const crypto = await import('node:crypto');
    outdatedSync.files['vendor/hgame/stale-removed.js'] = crypto.createHash('sha256').update('old\n').digest('hex');
    await writeFile(path.join(gOutdated, '.hgame-sync.json'), JSON.stringify(outdatedSync, null, 2));
    await unlink(path.join(gOutdated, 'vendor', 'hgame', 'index.js'));
    delete outdatedSync.files['vendor/hgame/index.js'];
    await writeFile(path.join(gOutdated, '.hgame-sync.json'), JSON.stringify(outdatedSync, null, 2));

    // Simulate legacy untracked game (no .hgame-sync.json, outdated runtime file).
    await unlink(path.join(gLegacy, '.hgame-sync.json'));
    await writeFile(path.join(gLegacy, 'vendor', 'hgame', 'index.js'), '// old copy\n');

    // Simulate accidental local edit inside vendor/hgame/.
    await writeFile(path.join(gEdited, 'vendor', 'hgame', 'index.js'), '// hacked locally\n');

    // Strict status check should fail and classify every project accurately.
    const status = runNode(syncGames, ['--status', '--strict', '--root', gamesRoot, '--json']);
    assert.equal(status.status, 1, status.stdout);
    const report = JSON.parse(status.stdout);
    const byName = Object.fromEntries(report.projects.map(p => [p.name, p]));
    assert.equal(byName['fresh-game'].status, 'up-to-date');
    assert.equal(byName['arena-sample'].status, 'outdated');
    assert.equal(byName['legacy-game'].status, 'legacy-untracked');
    assert.equal(byName['edited-game'].status, 'local-edits');
    assert.equal(byName['horde-sample'].status, 'up-to-date');
    assert.equal(byName['plain-html'].status, 'non-hgame');

    // Dry-run on legacy-game does not write .hgame-sync.json.
    const dry = runNode(syncGames, ['--root', gamesRoot, '--game', 'legacy-game', '--dry-run', '--json']);
    assert.equal(dry.status, 0, dry.stderr);
    await assert.rejects(stat(path.join(gLegacy, '.hgame-sync.json')));

    // Refuses to overwrite local edits without --force.
    const blocked = runNode(syncGames, ['--root', gamesRoot, '--game', 'edited-game']);
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /Refusing to overwrite locally modified engine files/);

    // Sync outdated 3d game and legacy game.
    const syncOutdated = runNode(syncGames, ['--root', gamesRoot, '--game', 'arena-sample', '--game', 'legacy-game', '--json']);
    assert.equal(syncOutdated.status, 0, syncOutdated.stderr || syncOutdated.stdout);
    await assert.rejects(stat(path.join(gOutdated, 'vendor', 'hgame', 'stale-removed.js')));
    assert.ok((await stat(path.join(gOutdated, 'vendor', 'hgame', 'index.js'))).isFile());
    assert.ok((await stat(path.join(gOutdated, 'vendor', 'hgame', 'vendor', 'rapier3d', 'rapier3d.wasm'))).isFile());
    assert.equal(await readFile(path.join(gOutdated, 'src', 'custom-logic.js'), 'utf8'), 'export const keepMe = 42;\n');
    assert.equal(await readFile(path.join(gOutdated, 'scripts', 'custom-audit.mjs'), 'utf8'), 'console.log("keep");\n');
    assert.ok((await stat(path.join(gLegacy, '.hgame-sync.json'))).isFile());

    // Force-sync edited game + --all syncs remaining cleanly.
    const forceAll = runNode(syncGames, ['--all', '--root', gamesRoot, '--force', '--no-build', '--json']);
    assert.equal(forceAll.status, 0, forceAll.stderr || forceAll.stdout);

    // Pixi2d projectEntry is preserved in docs/api/API-INDEX.json.
    const pixiIndex = JSON.parse(await readFile(path.join(gPixi, 'docs', 'api', 'API-INDEX.json'), 'utf8'));
    assert.equal(pixiIndex.projectEntry, 'src/horde.js');

    // Final strict status check passes 100%.
    const finalStatus = runNode(syncGames, ['--status', '--strict', '--root', gamesRoot, '--json']);
    assert.equal(finalStatus.status, 0, finalStatus.stderr || finalStatus.stdout);
    const finalReport = JSON.parse(finalStatus.stdout);
    assert.equal(finalReport.upToDate, 5);
    assert.equal(finalReport.nonHGame, 1);

    // Non-standalone 3D game using npm three skips copying assets/vendor/three/.
    const npmThreeGame = path.join(gamesRoot, 'npm-three-3d');
    await mkdir(npmThreeGame, { recursive: true });
    await writeFile(path.join(npmThreeGame, 'engine.config.json'), JSON.stringify({
      configVersion: 1, profile: '3d', renderer: 'threejs', physics: 'none', tickHz: 60, features: ['scene', 'input'],
    }));
    await writeFile(path.join(npmThreeGame, 'game.config.json'), JSON.stringify({
      schemaVersion: 1, id: 'npm-three-3d', name: 'NPM3D', version: '0.1.0', entry: 'index.html', renderer: 'threejs', runtime: 'webasset-v1', standalone: false,
    }));
    await writeFile(path.join(npmThreeGame, 'package.json'), JSON.stringify({
      name: 'npm-three-3d', dependencies: { three: '^0.187.0' },
    }));
    const syncNpmThree = runNode(syncGames, ['--root', gamesRoot, '--game', 'npm-three-3d', '--json']);
    assert.equal(syncNpmThree.status, 0, syncNpmThree.stderr || syncNpmThree.stdout);
    await assert.rejects(stat(path.join(npmThreeGame, 'assets', 'vendor', 'three')));
    const npmThreeSync = JSON.parse(await readFile(path.join(npmThreeGame, '.hgame-sync.json'), 'utf8'));
    assert.equal(npmThreeSync.managedRoots.includes('assets/vendor/three'), false);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
