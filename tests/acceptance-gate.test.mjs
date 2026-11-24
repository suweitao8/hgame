import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const createGame = path.join(root, 'scripts', 'create-game.mjs');
const acceptScript = path.join(root, 'scripts', 'accept.mjs');
const checkAutoplayScript = path.join(root, 'scripts', 'check-autoplay.mjs');
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

test('release freshness rejects a legacy report without opted-in mobile touch evidence', async () => {
  const game = await mkdtemp(path.join(os.tmpdir(), 'hgame-accept-touch-fresh-'));
  try {
    const { computeSourceDigest } = await import('../scripts/accept.mjs');
    await mkdir(path.join(game, 'build', 'acceptance'), { recursive: true });
    await mkdir(path.join(game, 'tests'));
    await writeFile(path.join(game, 'tests', 'acceptance.mjs'), 'export function run() {}');
    const spec = {
      target: 'web', autoplay: 'Fixture has no win condition.', doctor: 'Fixture has no simulation.',
      limits: { desktop: { readyMs: 50, p95Ms: 20 }, mobile: { readyMs: 50, p95Ms: 20 }, zipBytes: 100 },
    };
    const manifest = path.join(game, 'tests', 'release.json');
    const desktop = { png: 'build/acceptance/desktop.png' };
    const mobile = { png: 'build/acceptance/mobile.png' };
    const zip = 'fixture archive';
    await writeFile(path.join(game, desktop.png), 'png');
    await writeFile(path.join(game, mobile.png), 'png');
    await writeFile(path.join(game, 'build', 'acceptance', 'release.zip'), zip);
    const verify = async (manifestData, mobileEvidence) => {
      await writeFile(manifest, JSON.stringify(manifestData));
      await writeFile(path.join(game, 'build', 'acceptance-report.json'), JSON.stringify({
        accepted: true, mode: 'full', releaseReady: true,
        sourceDigest: computeSourceDigest(game, { release: true }),
        gates: {
          package: {
            archiveHash: createHash('sha256').update(zip).digest('hex'),
            playtest: { profiles: { mobile: mobileEvidence } },
          },
          visual: { captures: { desktop, mobile } },
        },
      }));
      return runNode(acceptScript, [game, '--release', '--verify-fresh', '--json']);
    };
    assert.equal((await verify(spec)).status, 0);
    const optedIn = { ...spec, mobileTouch: true };
    const legacy = await verify(optedIn);
    assert.equal(legacy.status, 1);
    assert.match(JSON.parse(legacy.stdout).problems.join(' '), /missing mobile touch evidence/);
    const current = await verify(optedIn, { rendererEnvironment: { touch: true }, touchPresses: 1 });
    assert.equal(current.status, 0, current.stdout);
  } finally {
    await rm(game, { recursive: true, force: true });
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

test('check-autoplay validates clear rate, idle skill gap, non-finite telemetry, and task-check integration', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-autoplay-'));
  try {
    await mkdir(path.join(tmp, 'tests'), { recursive: true });

    // Missing spec fails fail-closed.
    const missing = runNode(checkAutoplayScript, [tmp, '--json']);
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /missing/i);

    const writeSpec = async body => {
      await writeFile(path.join(tmp, 'tests', 'autoplay.mjs'), body);
    };

    // 1. Healthy game: skilled bot clears ~80% in ~15s, idle loses in ~4s -> passes.
    await writeSpec(`
      export const config = {
        runs: 10,
        idleRuns: 6,
        minWinRate: 0.6,
        maxWinRate: 1.0,
        maxIdleWinRate: 0.1,
        minSkillDelta: 0.3,
        minAvgDurationSec: 5,
      };
      export function runSeed(seed, strategy) {
        if (strategy === 'idle') return { outcome: 'defeat', durationSec: 4, kills: 0 };
        return { outcome: seed % 5 === 0 ? 'defeat' : 'victory', durationSec: 15, kills: 12 };
      }
    `);
    const passRes = runNode(checkAutoplayScript, [tmp, '--json']);
    assert.equal(passRes.status, 0, passRes.stdout + passRes.stderr);
    const passReport = JSON.parse(passRes.stdout);
    assert.equal(passReport.ok, true);
    assert.equal(passReport.bot.winRate, 0.8);
    assert.equal(passReport.idle.winRate, 0);
    assert.equal(passReport.skillDelta, 0.8);

    // 2. Unwinnable / overtuned game: bot winRate below minWinRate -> fails.
    await writeSpec(`
      export const config = { runs: 8, idleRuns: 4, minWinRate: 0.6 };
      export function runSeed(_seed, _strategy) {
        return { outcome: 'defeat', durationSec: 12, kills: 1 };
      }
    `);
    const tooHard = runNode(checkAutoplayScript, [tmp, '--json']);
    assert.equal(tooHard.status, 1);
    assert.match(tooHard.stdout, /below minWinRate/i);

    // 3. Zero-difficulty AFK-clearable game: idle wins too often / no skillDelta -> fails.
    await writeSpec(`
      export const config = { runs: 8, idleRuns: 4, minWinRate: 0.6, maxIdleWinRate: 0.1, minSkillDelta: 0.25 };
      export function runSeed(_seed, _strategy) {
        return { outcome: 'victory', durationSec: 12, kills: 5 };
      }
    `);
    const afkClear = runNode(checkAutoplayScript, [tmp, '--json']);
    assert.equal(afkClear.status, 1);
    assert.match(afkClear.stdout, /maxIdleWinRate|skillDelta/i);

    // 4. NaN simulation telemetry -> fails.
    await writeSpec(`
      export const config = { runs: 6, idleRuns: 3, minWinRate: 0.5, minAvgDurationSec: 5 };
      export function runSeed(_seed, strategy) {
        if (strategy === 'idle') return { outcome: 'defeat', durationSec: 4, kills: 0 };
        return { outcome: 'victory', durationSec: 12, kills: NaN };
      }
    `);
    const nanSim = runNode(checkAutoplayScript, [tmp, '--json']);
    assert.equal(nanSim.status, 1);
    assert.match(nanSim.stdout, /NaN|Infinity|non-finite/i);

    // 5. task-check { type: "autoplay" } integration passes on healthy spec & fails on broken spec.
    await writeSpec(`
      export const config = { runs: 6, idleRuns: 4, minWinRate: 0.6, maxIdleWinRate: 0.1, minSkillDelta: 0.3, minAvgDurationSec: 5 };
      export function runSeed(_seed, strategy) {
        return strategy === 'idle'
          ? { outcome: 'defeat', durationSec: 4, kills: 0 }
          : { outcome: 'victory', durationSec: 12, kills: 8 };
      }
    `);
    await writeFile(path.join(tmp, 'task.json'), JSON.stringify({
      schemaVersion: 1,
      task: 'Verify autoplay clear rate & difficulty',
      requirements: [{ id: 'autoplay-gate', expected: 'Bot clears >=60% while idle loses', checks: [{ type: 'autoplay', runs: 6, idleRuns: 4 }] }],
    }));
    const taskPass = runNode(taskCheckScript, ['task.json'], { cwd: tmp });
    assert.equal(taskPass.status, 0, taskPass.stdout + taskPass.stderr);
    assert.equal(JSON.parse(taskPass.stdout).status, 'passed');

    // 6. Three-tier bot vs random vs idle skill progression + determinism check.
    await writeSpec(`
      export const config = {
        runs: 6,
        idleRuns: 4,
        randomRuns: 4,
        deterministic: true,
        minWinRate: 0.6,
        maxIdleWinRate: 0.1,
        maxRandomWinRate: 0.3,
        minSkillDelta: 0.4,
        minBotOverRandomDelta: 0.3,
        minAvgDurationSec: 5,
        maxAvgDurationSec: 30,
      };
      export function runSeed(seed, strategy) {
        if (strategy === 'idle') return { outcome: 'defeat', durationSec: 4, kills: 0 };
        if (strategy === 'random') return { outcome: seed === 1 ? 'victory' : 'defeat', durationSec: 8, kills: 2 };
        return { outcome: 'victory', durationSec: 14, kills: 12, score: 100 };
      }
    `);
    const tierOk = runNode(checkAutoplayScript, [tmp, '--json']);
    assert.equal(tierOk.status, 0, tierOk.stdout + tierOk.stderr);
    const tierReport = JSON.parse(tierOk.stdout);
    assert.equal(tierReport.deterministic, true);
    assert.equal(tierReport.bot.p50DurationSec, 14);
    assert.equal(tierReport.random.winRate, 0.25);

    // Random clearing too easily violates maxRandomWinRate / minBotOverRandomDelta.
    await writeSpec(`
      export const config = {
        runs: 6, idleRuns: 4, randomRuns: 4,
        minWinRate: 0.6, maxIdleWinRate: 0.1, maxRandomWinRate: 0.25, minBotOverRandomDelta: 0.3,
      };
      export function runSeed(_seed, strategy) {
        if (strategy === 'idle') return { outcome: 'defeat', durationSec: 4, kills: 0 };
        return { outcome: 'victory', durationSec: 12, kills: 10 };
      }
    `);
    const randomEasy = runNode(checkAutoplayScript, [tmp, '--json']);
    assert.equal(randomEasy.status, 1);
    assert.match(randomEasy.stdout, /maxRandomWinRate|bot-over-random/i);

    // Non-deterministic Math.random() simulation fails deterministic check.
    await writeSpec(`
      export const config = { runs: 4, idleRuns: 2, deterministic: true, minWinRate: 0.5, minAvgDurationSec: 5 };
      let counter = 0;
      export function runSeed(seed, strategy) {
        if (strategy === 'idle') return { outcome: 'defeat', durationSec: 4, kills: 0 };
        counter++;
        return { outcome: 'victory', durationSec: 12, kills: 10 + counter };
      }
    `);
    const nonDet = runNode(checkAutoplayScript, [tmp, '--json']);
    assert.equal(nonDet.status, 1);
    assert.match(nonDet.stdout, /determinism check failed/i);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('release acceptance requires explicit budgets and rejects bypass options', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-release-requirements-'));
  const game = path.join(tmp, 'release-requirements');
  try {
    const gen = runNode(createGame, [game, '--profile', '2d', '--renderer', 'canvas2d', '--no-git']);
    assert.equal(gen.status, 0, gen.stderr || gen.stdout);
    const missing = runNode(acceptScript, [game, '--release', '--json']);
    assert.equal(missing.status, 1);
    const report = JSON.parse(missing.stdout);
    assert.equal(report.releaseReady, false);
    assert.match(report.problems.join(' '), /tests\/release\.json/);

    for (const flag of ['--quick', '--allow-skips', '--skip-webasset', '--skip-mobile-playtest']) {
      const bypass = runNode(acceptScript, [game, '--release', flag]);
      assert.equal(bypass.status, 1);
      assert.match(bypass.stderr, /--release cannot be combined/);
    }

    const config = {
      target: 'web', autoplay: 'No game win condition in this fixture.',
      doctor: 'No simulation health probe in this fixture.',
      limits: {
        desktop: { readyMs: 1500, p95Ms: 32 },
        mobile: { readyMs: 2000, p95Ms: 48 },
        zipBytes: 2_000_000,
      },
    };
    const specPath = path.join(game, 'tests', 'release.json');
    await writeFile(specPath, JSON.stringify({ ...config, mobileTouch: 'true' }));
    const invalidTouch = runNode(acceptScript, [game, '--release', '--json']);
    assert.equal(invalidTouch.status, 1);
    assert.match(JSON.parse(invalidTouch.stdout).problems.join(' '), /Release mobileTouch must be a boolean/);
    await writeFile(specPath, JSON.stringify({ ...config, gpu: 'auto' }));
    const invalidGpu = runNode(acceptScript, [game, '--release', '--json']);
    assert.equal(invalidGpu.status, 1);
    assert.match(JSON.parse(invalidGpu.stdout).problems.join(' '), /Release gpu must be software or hardware/);
    await writeFile(specPath, JSON.stringify({
      ...config,
      limits: { ...config.limits, desktop: { ...config.limits.desktop, p99Ms: 0 } },
    }));
    const invalidP99 = runNode(acceptScript, [game, '--release', '--json']);
    assert.equal(invalidP99.status, 1);
    assert.match(JSON.parse(invalidP99.stdout).problems.join(' '), /Invalid release budget desktop\.p99Ms/);
    await writeFile(specPath, JSON.stringify(config));
    await rm(path.join(game, 'tests', 'acceptance.mjs'));
    const missingScenario = runNode(acceptScript, [game, '--release', '--json']);
    assert.equal(missingScenario.status, 1);
    assert.match(JSON.parse(missingScenario.stdout).problems.join(' '), /tests\/acceptance\.mjs/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
