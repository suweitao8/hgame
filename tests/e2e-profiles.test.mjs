import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const createGame = path.join(root, 'scripts', 'create-game.mjs');
const packageGame = path.join(root, 'scripts', 'package-game.mjs');
const exists = p => access(p).then(() => true, () => false);

// End-to-end acceptance: generate -> project's own tests -> package, for every profile.
for (const [profile, extra] of [['2d', ['--with', 'audio,save,physics2d']], ['3d', ['--with', 'audio,save']], ['ui', []]]) {
  test(`e2e: ${profile} profile generates, passes its own checks, and packages`, async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), `hgame-e2e-${profile}-`));
    try {
      const game = path.join(tmp, 'sample');
      const gen = spawnSync(process.execPath, [createGame, game, '--name', `E2E ${profile}`, '--profile', profile, ...extra, '--no-git'], { encoding: 'utf8' });
      assert.equal(gen.status, 0, gen.stderr || gen.stdout);
      const pkg = JSON.parse(await readFile(path.join(game, 'package.json'), 'utf8'));
      if (pkg.scripts?.test) {
        const t = spawnSync(process.execPath, ['--test'], { cwd: game, encoding: 'utf8' });
        assert.equal(t.status, 0, t.stdout + t.stderr);
      }
      const pack = spawnSync(process.execPath, [packageGame, game, '--version', '0.1'], { encoding: 'utf8' });
      assert.equal(pack.status, 0, pack.stderr || pack.stdout);
      const summary = JSON.parse(pack.stdout);
      assert.equal(await exists(path.join(game, 'build', `${summary.releaseTag}.zip`)), true);
      assert.equal(await exists(path.join(game, 'build', summary.releaseTag, 'index.html')), true);
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });
}
