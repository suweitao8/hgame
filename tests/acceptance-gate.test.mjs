import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const createGame = path.join(root, 'scripts', 'create-game.mjs');
const acceptScript = path.join(root, 'scripts', 'accept.mjs');
const taskCheckScript = path.join(root, 'scripts', 'task-check.mjs');

function runNode(script, args, opts = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, ...(opts.env || {}) },
    ...opts,
  });
}

test('accept --quick passes on fresh generated project and blocks syntax, import, config, UI, and skipped-test regressions', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-accept-quick-'));
  const game = path.join(tmp, 'sample-accept');
  try {
    const gen = runNode(createGame, [game, '--profile', '2d', '--renderer', 'canvas2d', '--no-git']);
    assert.equal(gen.status, 0, gen.stderr || gen.stdout);

    // Synced scripts work directly from inside the generated game directory.
    const quickOk = runNode(path.join(game, 'scripts', 'accept.mjs'), ['.', '--quick', '--json'], { cwd: game });
    assert.equal(quickOk.status, 0, quickOk.stderr || quickOk.stdout);
    const reportOk = JSON.parse(quickOk.stdout);
    assert.equal(reportOk.ok, true);
    assert.equal(reportOk.accepted, false, '--quick must never mark a project as fully accepted');
    assert.equal(reportOk.gates.config.status, 'passed');
    assert.equal(reportOk.gates.syntax.status, 'passed');
    assert.equal(reportOk.gates.uiStatic.status, 'passed');
    assert.equal(reportOk.gates.tests.status, 'passed');

    // 1. Secondary file syntax error must fail even when src/main.js is valid.
    await writeFile(path.join(game, 'src', 'broken.js'), 'export function broken( { return 1; }\n');
    const badSyntax = runNode(acceptScript, [game, '--quick', '--json']);
    assert.equal(badSyntax.status, 1);
    assert.equal(JSON.parse(badSyntax.stdout).gates.syntax.status, 'failed');
    await rm(path.join(game, 'src', 'broken.js'));

    // 2. Unresolved relative import in src/ must fail syntax/import integrity gate.
    const origMain = await readFile(path.join(game, 'src', 'main.js'), 'utf8');
    await writeFile(path.join(game, 'src', 'main.js'), "import './does-not-exist.js';\n" + origMain);
    const badImport = runNode(acceptScript, [game, '--quick', '--json']);
    assert.equal(badImport.status, 1);
    assert.equal(JSON.parse(badImport.stdout).gates.syntax.status, 'failed');
    await writeFile(path.join(game, 'src', 'main.js'), origMain);

    // 3. Disallowed WebAsset key in game.config.json must fail config gate.
    const gameCfgPath = path.join(game, 'game.config.json');
    const origCfg = await readFile(gameCfgPath, 'utf8');
    const badCfg = { ...JSON.parse(origCfg), quality3d: { mode: 'auto' } };
    await writeFile(gameCfgPath, JSON.stringify(badCfg, null, 2));
    const badConfig = runNode(acceptScript, [game, '--quick', '--json']);
    assert.equal(badConfig.status, 1);
    assert.equal(JSON.parse(badConfig.stdout).gates.config.status, 'failed');
    await writeFile(gameCfgPath, origCfg);

    // 4. Anti-Bloat UI violation must fail uiStatic gate.
    const indexPath = path.join(game, 'index.html');
    const origHtml = await readFile(indexPath, 'utf8');
    await writeFile(indexPath, origHtml.replace('</body>', '<p>操作说明：请按 WASD 移动角色。</p></body>'));
    const badUi = runNode(acceptScript, [game, '--quick', '--json']);
    assert.equal(badUi.status, 1);
    assert.equal(JSON.parse(badUi.stdout).gates.uiStatic.status, 'failed');
    await writeFile(indexPath, origHtml);

    // 5. Skipped tests must fail tests gate (zero-skip policy).
    await writeFile(path.join(game, 'tests', 'skipped.test.mjs'), "import test from 'node:test';\ntest.skip('skipped', () => {});\n");
    const badSkip = runNode(acceptScript, [game, '--quick', '--json']);
    assert.equal(badSkip.status, 1);
    assert.equal(JSON.parse(badSkip.stdout).gates.tests.status, 'failed');
    await rm(path.join(game, 'tests', 'skipped.test.mjs'));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('accept --verify-fresh enforces matching sourceDigest and existing artifacts', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-accept-fresh-'));
  const game = path.join(tmp, 'fresh-verify');
  try {
    const gen = runNode(createGame, [game, '--profile', '2d', '--renderer', 'canvas2d', '--no-git']);
    assert.equal(gen.status, 0, gen.stderr || gen.stdout);

    // Without report -> must fail.
    const missing = runNode(acceptScript, [game, '--verify-fresh', '--json']);
    assert.equal(missing.status, 1);
    assert.equal(JSON.parse(missing.stdout).accepted, false);

    // Write a simulated full report matching current sourceDigest + artifacts.
    const { computeSourceDigest } = await import('../scripts/accept.mjs');
    await mkdir(path.join(game, 'build', 'acceptance'), { recursive: true });
    await writeFile(path.join(game, 'build', 'acceptance', 'desktop.png'), 'png');
    await writeFile(path.join(game, 'build', 'acceptance', 'mobile.png'), 'png');
    await writeFile(
      path.join(game, 'build', 'acceptance-report.json'),
      JSON.stringify({
        schemaVersion: 1,
        ok: true,
        accepted: true,
        mode: 'full',
        gameId: 'fresh-verify',
        sourceDigest: computeSourceDigest(game),
        checkedAt: new Date().toISOString(),
        gates: {
          visual: {
            captures: {
              desktop: { png: 'build/acceptance/desktop.png' },
              mobile: { png: 'build/acceptance/mobile.png' },
            },
          },
        },
      }),
    );

    const freshOk = runNode(acceptScript, [game, '--verify-fresh', '--json']);
    assert.equal(freshOk.status, 0, freshOk.stdout);
    assert.equal(JSON.parse(freshOk.stdout).accepted, true);

    // Editing src/main.js invalidates acceptance immediately.
    await writeFile(path.join(game, 'src', 'main.js'), (await readFile(path.join(game, 'src', 'main.js'), 'utf8')) + '\n// edit\n');
    const stale = runNode(acceptScript, [game, '--verify-fresh', '--json']);
    assert.equal(stale.status, 1);
    assert.match(stale.stdout, /stale/i);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('task-check supports ui check type alongside existing test and review checks', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-task-ui-'));
  try {
    await mkdir(path.join(tmp, 'src'));
    await writeFile(path.join(tmp, 'index.html'), '<canvas id="game"></canvas>');
    await writeFile(path.join(tmp, 'src', 'main.js'), 'export const ok = 1;\n');
    await writeFile(path.join(tmp, 'task.json'), JSON.stringify({
      schemaVersion: 1,
      task: 'Keep UI free of bloat',
      requirements: [{ id: 'ui-clean', expected: 'No prose or modal bloat', checks: [{ type: 'ui' }] }],
    }));

    const passRes = runNode(taskCheckScript, ['task.json'], { cwd: tmp });
    assert.equal(passRes.status, 0, passRes.stdout + passRes.stderr);
    assert.equal(JSON.parse(passRes.stdout).status, 'passed');

    await writeFile(path.join(tmp, 'index.html'), '<p>操作说明：禁止段落。</p>');
    const failRes = runNode(taskCheckScript, ['task.json'], { cwd: tmp });
    assert.equal(failRes.status, 1, failRes.stdout + failRes.stderr);
    assert.equal(JSON.parse(failRes.stdout).status, 'failed');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
