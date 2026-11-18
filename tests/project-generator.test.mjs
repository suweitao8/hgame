import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skill = fileURLToPath(new URL('../', import.meta.url));
const createGame = path.join(skill, 'scripts', 'create-game.mjs');
const preview = path.join(skill, 'scripts', 'preview.mjs');

test('zero-tick 2D generation requires a bare starter', () => {
  const game = path.join(os.tmpdir(), 'hgame-zero-tick-dry-run');
  const run = (...args) => spawnSync(process.execPath, [createGame, game, '--tick-hz', '0', '--dry-run', ...args], { encoding: 'utf8' });
  for (const args of [['--preset', 'horde'], ['--profile', '2d']]) {
    const result = run(...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--tick-hz 0.*--bare/);
  }
  const bare = run('--preset', 'pixi2d', '--bare');
  assert.equal(bare.status, 0, bare.stderr);
  assert.equal(JSON.parse(bare.stdout).recipe.tickHz, 0);
});

test('HGame generator creates a standalone 2D game anywhere, with independent git and lean dependencies', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'html-game-global-'));
  const game = path.join(tmp, 'anything', 'sample-game');
  try {
    const run = (...args) => spawnSync(process.execPath, [createGame, ...args], { encoding: 'utf8' });
    const dry = run(game, '--name', '测试游戏', '--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    const dryJson = JSON.parse(dry.stdout);
    assert.equal(dryJson.engine, 'HGame');
    assert.equal(dryJson.engineVersion, '1.0.0');
    await assert.rejects(readdir(game));

    const result = run(game, '--name', '测试游戏');
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(await readFile(path.join(game, 'game.config.json'), 'utf8'));
    assert.equal(config.id, 'sample-game');
    assert.equal(config.name, '测试游戏');
    assert.equal(config.standalone, true);
    assert.match(await readFile(path.join(game, 'vendor', 'hgame', 'VERSION'), 'utf8'), /1\.0\.0/);
    await assert.rejects(stat(path.join(game, 'vendor', 'hgame', 'vendor', 'rapier2d')));
    await assert.rejects(stat(path.join(game, 'vendor', 'hgame', 'vendor', 'rapier3d')));
    assert.match(await readFile(path.join(game, 'vendor', 'hgame', 'VERSION'), 'utf8'), /1\.0\.0/);
    const git = spawnSync('git', ['status', '--short'], { cwd: game, encoding: 'utf8' });
    assert.equal(git.status, 0, git.stderr);
    const tests = spawnSync(process.execPath, ['--test', 'tests/config.test.mjs'], { cwd: game, encoding: 'utf8' });
    assert.equal(tests.status, 0, tests.stderr);
    const check = spawnSync(process.execPath, ['--check', 'src/main.js'], { cwd: game, encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);

    await writeFile(path.join(game, 'do-not-touch.txt'), 'original');
    const repeated = run(game, '--name', '不该覆盖');
    assert.notEqual(repeated.status, 0);
    assert.equal(await readFile(path.join(game, 'do-not-touch.txt'), 'utf8'), 'original');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('standalone preview serves game modules but hides git, AGENTS and traversal paths', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'html-game-preview-'));
  const game = path.join(tmp, 'playable-game');
  let child;
  try {
    const build = spawnSync(process.execPath, [createGame, game, '--no-git'], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    await mkdir(path.join(game, '.git'));
    await writeFile(path.join(game, '.git', 'secret'), 'private');
    const port = await freePort();
    child = spawn(process.execPath, [preview, game, '--port', String(port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const root = 'http://127.0.0.1:' + port;
    let started = false;
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch(root + '/'); started = r.status === 200; if (started) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(started, true, 'preview server did not start');
    for (const route of ['/', '/src/main.js', '/vendor/hgame/index.js',
      '/vendor/hgame/platform/engine.js', '/game.config.json']) {
      const response = await fetch(root + route);
      assert.equal(response.status, 200, route);
    }
    for (const route of ['/AGENTS.md', '/.git/secret', '/tests/config.test.mjs', '/package.json']) {
      const response = await fetch(root + route);
      assert.notEqual(response.status, 200, 'Private path leaked: ' + route);
    }
  } finally {
    if (child && !child.killed) child.kill();
    await rm(tmp, { recursive: true, force: true });
  }
});

for (const profile of ['2d', '3d']) {
  test(`create-game --bare --profile ${profile} omits demo level/material/model-slot files and stays valid`, async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'html-game-bare-'));
    const game = path.join(tmp, 'bare-' + profile);
    try {
      const result = spawnSync(process.execPath, [createGame, game, '--profile', profile, '--bare', '--no-git'], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).bare, true);
      for (const demo of ['level.json', 'materials.json', 'model-slots.json']) {
        await assert.rejects(stat(path.join(game, 'src', demo)));
      }
      const main = await readFile(path.join(game, 'src', 'main.js'), 'utf8');
      assert.doesNotMatch(main, /level\.json|materials\.json|model-slots\.json|modular-level|procedural-models/);
      const tests = spawnSync(process.execPath, ['--test', 'tests/config.test.mjs'], { cwd: game, encoding: 'utf8' });
      assert.equal(tests.status, 0, tests.stderr + tests.stdout);
      const check = spawnSync(process.execPath, ['--check', 'src/main.js'], { cwd: game, encoding: 'utf8' });
      assert.equal(check.status, 0, check.stderr);
      const recipe = JSON.parse(await readFile(path.join(game, 'engine.config.json'), 'utf8'));
      assert.equal(recipe.profile, profile);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
}

test('non-bare 3D still scaffolds demo level files; --bare rejects the ui profile', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'html-game-bare-neg-'));
  try {
    const full = spawnSync(process.execPath, [createGame, path.join(tmp, 'full'), '--profile', '3d', '--no-git'], { encoding: 'utf8' });
    assert.equal(full.status, 0, full.stderr);
    for (const demo of ['level.json', 'materials.json', 'model-slots.json']) {
      assert.ok((await stat(path.join(tmp, 'full', 'src', demo))).isFile());
    }
    const ui = spawnSync(process.execPath, [createGame, path.join(tmp, 'ui'), '--profile', 'ui', '--bare', '--no-git'], { encoding: 'utf8' });
    assert.notEqual(ui.status, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('hgame-ui-ux check-ui passes generated 2d/3d/ui starters and blocks web-prose violations with line numbers', async () => {
  const checkUi = path.join(skill, '.agents', 'skills', 'hgame-ui-ux', 'scripts', 'check-ui.mjs');
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-check-ui-'));
  try {
    for (const profile of ['2d', '3d', 'ui']) {
      const game = path.join(tmp, 'clean-' + profile);
      const gen = spawnSync(process.execPath, [createGame, game, '--profile', profile, '--no-git'], { encoding: 'utf8' });
      assert.equal(gen.status, 0, gen.stderr);
      const lint = spawnSync(process.execPath, [checkUi, '--dir', game], { encoding: 'utf8' });
      assert.equal(lint.status, 0, lint.stderr + lint.stdout);
      assert.equal(JSON.parse(lint.stdout).pass, true);
    }

    const badGame = path.join(tmp, 'clean-2d');
    await writeFile(path.join(badGame, 'index.html'), [
      '<!doctype html><html><body>',
      '<canvas id="game"></canvas>',
      '<p>操作说明：按 WASD 移动角色。</p>',
      '<div class="card"><span>狂暴</span><button>选择</button></div>',
      '</body></html>',
    ].join('\n'));
    const badLint = spawnSync(process.execPath, [checkUi, '--dir', badGame], { encoding: 'utf8' });
    assert.notEqual(badLint.status, 0);
    const report = JSON.parse(badLint.stdout);
    assert.equal(report.pass, false);
    assert.ok(report.violations.some(v => v.rule === 'forbidden-prose-keyword' && v.line === 3));
    assert.ok(report.violations.some(v => v.rule === 'prose-paragraph-tag' && v.line === 3));
    assert.ok(report.violations.some(v => v.rule === 'card-nested-button' && v.line === 4));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
