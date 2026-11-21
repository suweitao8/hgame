#!/usr/bin/env node
// Full browser acceptance E2E suite: verifies all generated game profiles pass `scripts/accept.mjs`
// cleanly from inside the standalone project directory, and proves negative regressions fail closed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const createGame = path.join(root, 'scripts', 'create-game.mjs');

function runNode(script, args, opts = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, HGAME_ROOT: root, ...(opts.env || {}) },
    ...opts,
  });
}

const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-browser-accept-'));
try {
  const cases = [
    ['acc-canvas2d', ['--profile', '2d', '--renderer', 'canvas2d']],
    ['acc-2d-bare', ['--profile', '2d', '--renderer', 'canvas2d', '--bare']],
    ['acc-pixi2d', ['--profile', '2d']],
    ['acc-horde', ['--preset', 'horde']],
    ['acc-3d', ['--profile', '3d']],
    ['acc-3d-bare', ['--profile', '3d', '--bare', '--quality', 'low']],
    ['acc-ui', ['--profile', 'ui']],
  ];

  for (const [slug, flags] of cases) {
    const game = path.join(tmp, slug);
    const gen = runNode(createGame, [game, ...flags, '--no-git']);
    assert.equal(gen.status, 0, `${slug} create-game: ${gen.stderr || gen.stdout}`);

    const res = runNode(path.join(game, 'scripts', 'accept.mjs'), ['.', '--skip-webasset', '--json'], { cwd: game });
    assert.equal(res.status, 0, `${slug} accept failed: ${res.stdout}\n${res.stderr}`);
    const report = JSON.parse(res.stdout);
    assert.equal(report.ok, true, `${slug}: ${JSON.stringify(report.problems)}`);
    assert.equal(report.accepted, true, `${slug}: accepted must be true`);
    assert.equal(report.gates.visual.status, 'passed', `${slug} visual`);
    assert.equal(report.gates.playtest.status, 'passed', `${slug} playtest`);

    const fresh = runNode(path.join(game, 'scripts', 'accept.mjs'), ['.', '--verify-fresh', '--json'], { cwd: game });
    assert.equal(fresh.status, 0, `${slug} --verify-fresh: ${fresh.stdout}`);
    console.log(JSON.stringify({ profile: slug, accepted: true, bare: report.bareScaffold, summary: report.summary }));
  }

  // Negative browser regression tests on acc-canvas2d
  const negGame = path.join(tmp, 'acc-canvas2d');
  const origMain = await readFile(path.join(negGame, 'src', 'main.js'), 'utf8');
  const origHtml = await readFile(path.join(negGame, 'index.html'), 'utf8');

  // 1. NaN in __hgameState must fail acceptance.
  await writeFile(
    path.join(negGame, 'src', 'main.js'),
    origMain.replace('x: +actor.x.toFixed(2)', 'x: NaN'),
  );
  const nanRes = runNode(path.join(negGame, 'scripts', 'accept.mjs'), ['.', '--skip-webasset', '--json'], { cwd: negGame });
  assert.equal(nanRes.status, 1, 'NaN in state hook must fail acceptance');
  assert.match(nanRes.stdout, /non-finite/i);

  // 2. Dead/static game ignoring movement input must fail playtest gate.
  await writeFile(
    path.join(negGame, 'src', 'main.js'),
    origMain.replace('this.entity.x = Math.max', '// frozen: void').replace('this.entity.y = Math.max', '// frozen: void'),
  );
  const deadRes = runNode(path.join(negGame, 'scripts', 'accept.mjs'), ['.', '--skip-webasset', '--json'], { cwd: negGame });
  assert.equal(deadRes.status, 1, 'Dead movement input must fail acceptance');
  assert.equal(JSON.parse(deadRes.stdout).gates.playtest.status, 'failed');

  // 3. Mobile 360x800 layout overflow / clipped button must fail visual gate.
  await writeFile(path.join(negGame, 'src', 'main.js'), origMain);
  await writeFile(
    path.join(negGame, 'index.html'),
    origHtml.replace('</body>', '<button style="position:fixed;left:340px;top:12px;width:90px;height:36px">开始</button></body>'),
  );
  const overflowRes = runNode(path.join(negGame, 'scripts', 'accept.mjs'), ['.', '--skip-webasset', '--json'], { cwd: negGame });
  assert.equal(overflowRes.status, 1, 'Clipped mobile button must fail acceptance');
  const overflowReport = JSON.parse(overflowRes.stdout);
  assert.equal(overflowReport.gates.visual.status, 'failed');
  assert.match(JSON.stringify(overflowReport.gates.visual), /clipped|overflow/i);

  // 4. Blank non-bare canvas must fail visual gate.
  await writeFile(path.join(negGame, 'index.html'), origHtml);
  await writeFile(
    path.join(negGame, 'src', 'main.js'),
    origMain.replace("new Sprite2D({ shape: 'rect', width: 44, height: 44, color: '#60d9b7' })", "new Sprite2D({ shape: 'rect', width: 0, height: 0, color: '#60d9b7' })"),
  );
  const blankRes = runNode(path.join(negGame, 'scripts', 'accept.mjs'), ['.', '--skip-webasset', '--json'], { cwd: negGame });
  assert.equal(blankRes.status, 1, 'Blank canvas must fail acceptance');
  assert.equal(JSON.parse(blankRes.stdout).gates.visual.status, 'failed');

  // 5. Missing tests/autoplay.mjs must fail when --require-autoplay is enforced.
  await writeFile(path.join(negGame, 'src', 'main.js'), origMain);
  const noAutoplayRes = runNode(
    path.join(negGame, 'scripts', 'accept.mjs'),
    ['.', '--require-autoplay', '--skip-webasset', '--json'],
    { cwd: negGame },
  );
  assert.equal(noAutoplayRes.status, 1, 'Missing autoplay spec must fail acceptance under --require-autoplay');
  assert.equal(JSON.parse(noAutoplayRes.stdout).gates.autoplay.status, 'failed');

  // 6. Mid-game dynamic UI bloat/clip caught by context.auditUi('upgrade') inside tests/acceptance.mjs.
  await writeFile(
    path.join(negGame, 'tests', 'acceptance.mjs'),
    [
      'export async function run({ page, auditUi }) {',
      '  await auditUi("playing");',
      '  await page.evaluate(() => {',
      '    const b = document.createElement("button");',
      '    b.textContent = "溢出按钮";',
      '    b.style.cssText = "position:fixed;right:-30px;top:16px;width:90px;height:36px;";',
      '    document.body.appendChild(b);',
      '  });',
      '  await auditUi("upgrade");',
      '}',
    ].join('\n'),
  );
  const dynamicUiRes = runNode(path.join(negGame, 'scripts', 'accept.mjs'), ['.', '--skip-webasset', '--json'], { cwd: negGame });
  assert.equal(dynamicUiRes.status, 1, 'Dynamic clipped button during scenario must fail playtest gate via auditUi');
  const dynamicReport = JSON.parse(dynamicUiRes.stdout);
  assert.equal(dynamicReport.gates.playtest.status, 'failed');
  assert.match(JSON.stringify(dynamicReport.gates.playtest), /UI audit \[upgrade\].*clipped/i);

  console.log(JSON.stringify({
    negativeBrowserGates: 'all-caught',
    cases: ['nan-state', 'dead-input', 'mobile-clipped-button', 'blank-canvas', 'missing-autoplay', 'dynamic-ui-audit'],
  }));
} finally {
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
