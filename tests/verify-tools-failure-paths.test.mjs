import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeSourceDigest, runAcceptForProject, runWebAssetGate } from '../scripts/accept.mjs';
import { resolveWebAssetGame, verifyWebAssetSource, webAssetOrigins } from '../scripts/playtest.mjs';
import { parseSnapshotArgs } from '../scripts/lib/snapshot-args.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const game = path.join(root, 'examples', 'survivor-2d');
const missing = path.join(root, 'examples', 'no-such-game');

/** Runs a repository script and resolves with its exit code and output. */
function runCli(name, args, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', name), ...args], {
      cwd: root, windowsHide: true, env: { ...process.env, NODE_TEST_CONTEXT: undefined, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill(), 30_000);
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.on('error', error => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(error) }); });
  });
}

test('snapshot.mjs reads its options through one parser that refuses anything it cannot use', () => {
  const defaults = {
    gameDir: 'game', outPath: path.join('game', 'build', 'snapshot.png'), selector: '#game', ready: '',
    visualReady: '', baseline: '', entryPath: '/', query: '', evalExpr: '', stateHook: '__hgameState', chrome: '',
    freeze: false, checkUi: false, checkLayout: false, allowBlank: false, updateBaseline: false,
    waitMs: 800, threshold: 0.01, requestedSteps: undefined, viewport: { width: 960, height: 540 },
    maxHudRatio: 0.10, maxHudButtons: 1, keys: [],
  };
  assert.deepEqual(parseSnapshotArgs(['game']), defaults);
  assert.deepEqual(
    parseSnapshotArgs(['game', '--entry', 'toy/demo/index.html', '--steps', '10', '--viewport', '360x800',
      '--keys', 'd:360,space:100,,x', '--wait', '100', '--check-ui', '--out', 'shot.png']),
    {
      ...defaults, outPath: 'shot.png', entryPath: '/toy/demo/index.html', freeze: true, requestedSteps: 10,
      viewport: { width: 360, height: 800 },
      keys: [{ key: 'd', ms: 360 }, { key: ' ', ms: 100 }, { key: 'x', ms: 150 }],
      waitMs: 100, checkUi: true,
    },
  );

  // The game dir is the first bare argument that is not the value of an option.
  const flags = parseSnapshotArgs(['--freeze-time', '--update-baseline', 'game', '--chrome', 'C:/chrome.exe', '--eval', '1+1']);
  assert.equal(flags.gameDir, 'game');
  assert.equal(flags.freeze, true, 'a frozen clock can be asked for without --steps');
  assert.equal(flags.updateBaseline, true);
  assert.equal(flags.chrome, 'C:/chrome.exe');
  assert.equal(flags.evalExpr, '1+1');

  const refused = [
    [[], /Usage: node scripts\/snapshot\.mjs <game-dir>/],
    [['--wait', '800'], /Usage: node scripts\/snapshot\.mjs <game-dir>/],
    [['game', '--entry', 'http://evil.example/x'], /--entry must be a path inside the fixture/],
    [['game', '--entry', '/index.html?debug=1'], /--entry must be a path inside the fixture/],
    [['game', '--entry', '/#top'], /--entry must be a path inside the fixture/],
    [['game', '--entry'], /--entry must be a path inside the fixture/],
    [['game', '--wait'], /--wait must be a finite number between 0 and Infinity/],
    [['game', '--wait', '-1'], /--wait must be a finite number between 0 and Infinity/],
    [['game', '--threshold', '1.5'], /--threshold must be a finite number between 0 and 1/],
    [['game', '--max-hud-ratio', '1.5'], /--max-hud-ratio must be a finite number between 0 and 1/],
    [['game', '--max-hud-buttons', '2.5'], /--max-hud-buttons must be a finite integer/],
    [['game', '--steps', '2.5'], /--steps must be a finite integer/],
    [['game', '--steps'], /--steps must be a finite integer/],
    [['game', '--keys', 'd:abc'], /--keys duration must be a finite number/],
    [['game', '--keys'], /reading 'split'/],
  ];
  for (const [argv, expected] of refused) {
    assert.throws(() => parseSnapshotArgs(argv), error => {
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /[\r\n]/, 'the CLI prints the message as it is');
      return true;
    }, argv.join(' '));
  }
});

test('snapshot.mjs and playtest.mjs stop with exit code 2 on a bad command line, before a browser starts', async () => {
  const cases = [
    ['snapshot.mjs', [], /Usage: node scripts\/snapshot\.mjs <game-dir>/],
    ['snapshot.mjs', ['--steps', '30'], /Usage: node scripts\/snapshot\.mjs <game-dir>/],
    ['snapshot.mjs', [game, '--entry', 'http://evil.example/x'], /--entry must be a path inside the fixture/],
    ['snapshot.mjs', [game, '--keys', 'd:abc'], /--keys duration must be a finite number/],
    ['playtest.mjs', [], /Usage: node scripts\/playtest\.mjs <game-dir>/],
    ['playtest.mjs', [missing], /Invalid or missing entry index\.html in/],
    ['playtest.mjs', [game, '--entry', '../secret/index.html'], /Invalid or missing entry \.\.\/secret\/index\.html/],
    ['playtest.mjs', ['not a game id!', '--webasset'], /--webasset requires a local game ID/],
    ['playtest.mjs', [game, '--trace-hook'], /--trace-hook requires a window function name/],
    ['playtest.mjs', [game, '--scenario'], /--scenario requires a local module file/],
    ['playtest.mjs', [game, '--scenario', 'a.mjs', '--actions', 'd:100'], /--scenario replaces --actions and --duration/],
    ['playtest.mjs', [game, '--actions', 'd:abc'], /action duration must be a finite number/],
    ['playtest.mjs', [game, '--viewport', '960'], /--viewport must contain positive integer dimensions/],
  ];
  const results = await Promise.all(cases.map(([name, args]) => runCli(name, args)));
  results.forEach((result, i) => {
    const label = cases[i][0] + ' ' + cases[i][1].join(' ');
    assert.equal(result.code, 2, label + '\n' + result.stdout + result.stderr);
    assert.doesNotMatch(result.stderr, /^\s+at /m, label + ' prints no stack trace:\n' + result.stderr);
    assert.match(result.stderr, cases[i][2]);
    assert.equal(result.stdout, '', label + ' produced no report');
  });

  const help = await runCli('playtest.mjs', ['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stderr, /Usage: node scripts\/playtest\.mjs <game-dir>/);
});

test('accept.mjs reports a bad command line or a missing directory without running the gates', async () => {
  const cases = [
    [['--bogus'], /accept failed: Unknown argument: --bogus/],
    [['--out'], /accept failed: --out requires a value/],
    [['--autoplay-runs', '0'], /accept failed: --autoplay-runs must be a finite integer between 1 and Infinity/],
    [['--viewport', '960'], /accept failed: --viewport must contain positive integer dimensions/],
    [['--release', '--quick'], /accept failed: --release cannot be combined with/],
    [['--release', '--viewport', '360x800'], /accept failed: --release requires a distinct portrait mobile viewport/],
    [['--release', '--mobile-viewport', '800x360'], /accept failed: --release requires a distinct portrait mobile viewport/],
    [[missing], /accept failed: Target game directory does not exist/],
    [[missing, '--verify-fresh'], /accept failed: Target game directory does not exist/],
  ];
  const results = await Promise.all(cases.map(([args]) => runCli('accept.mjs', args)));
  results.forEach((result, i) => {
    assert.equal(result.code, 1, cases[i][0].join(' ') + '\n' + result.stdout + result.stderr);
    assert.match(result.stderr, cases[i][1]);
    assert.equal(result.stdout, '', cases[i][0].join(' ') + ' printed no report');
  });

  const help = await runCli('accept.mjs', ['--help']);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /Usage: node scripts\/accept\.mjs \[game-dir\]/);
});

test('accept --verify-fresh says why an acceptance report cannot be trusted', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-accept-trust-'));
  const dir = path.join(tmp, 'trust-me');
  try {
    await mkdir(dir);
    const reportPath = path.join(dir, 'build', 'acceptance-report.json');
    const writeReport = async report => {
      await mkdir(path.dirname(reportPath), { recursive: true });
      await writeFile(reportPath, typeof report === 'string' ? report : JSON.stringify(report));
    };
    const opts = { verifyFresh: true };

    const noReport = await runAcceptForProject(dir, opts);
    assert.equal(noReport.ok, false);
    assert.equal(noReport.mode, 'verify-fresh');
    assert.match(noReport.problems.join(' '), /Missing acceptance report at .*\. Run "node scripts\/accept\.mjs \." first\./);
    assert.deepEqual(await readdir(dir), [], 'a refused check leaves nothing behind');

    await writeReport('{ not json');
    await assert.rejects(() => runAcceptForProject(dir, opts), SyntaxError);

    for (const report of [{ accepted: false, mode: 'full' }, { accepted: true, mode: 'quick' }, { accepted: true, mode: 'verify-fresh' }]) {
      await writeReport(report);
      const refused = await runAcceptForProject(dir, opts);
      assert.equal(refused.ok, false);
      assert.equal(refused.problems.length, 1);
      assert.match(refused.problems[0], /Last acceptance run did not pass full acceptance \(accepted=/);
    }

    const full = {
      schemaVersion: 1, ok: true, accepted: true, mode: 'full', gameId: 'trust-me',
      sourceDigest: computeSourceDigest(dir), checkedAt: '2026-11-24T00:00:00.000Z', gates: {},
    };
    await writeReport(full);
    assert.match((await runAcceptForProject(dir, opts)).problems.join(' '), /Missing acceptance screenshot artifact: desktop/);
    const captures = path.join(dir, 'build', 'acceptance');
    await mkdir(captures, { recursive: true });
    await writeFile(path.join(captures, 'desktop.png'), 'png');
    full.gates.visual = { captures: { desktop: { png: 'build/acceptance/desktop.png' } } };
    await writeReport(full);
    assert.match((await runAcceptForProject(dir, opts)).problems.join(' '), /Missing acceptance screenshot artifact: mobile/);
    await writeFile(path.join(captures, 'mobile.png'), 'png');
    full.gates.visual.captures.mobile = { png: 'build/acceptance/mobile.png' };
    await writeReport(full);
    assert.deepEqual(await runAcceptForProject(dir, opts), {
      schemaVersion: 1, ok: true, accepted: true, mode: 'verify-fresh', gameDir: dir, gameId: 'trust-me',
      releaseReady: false, sourceDigest: full.sourceDigest, checkedAt: full.checkedAt, problems: [],
    });

    // Release evidence is held to more than a passing report.
    const release = { verifyFresh: true, release: true };
    assert.match((await runAcceptForProject(dir, release)).problems.join(' '), /Last acceptance report has no passing release evidence/);
    full.releaseReady = true;
    await writeReport(full);
    assert.match((await runAcceptForProject(dir, release)).problems.join(' '), /Release archive is missing or no longer matches the report/);

    // Any authored change makes a matching report stale.
    delete full.releaseReady;
    await writeReport(full);
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'main.js'), 'export const changed = true;\n');
    assert.deepEqual((await runAcceptForProject(dir, opts)).problems, [
      'Acceptance report is stale: source files changed since 2026-11-24T00:00:00.000Z. Re-run acceptance.',
    ]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('accept --release stops at an unusable release spec before any gate runs', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-release-spec-'));
  const dir = path.join(tmp, 'release-spec');
  const specPath = path.join(dir, 'tests', 'release.json');
  const reportPath = path.join(dir, 'build', 'acceptance-report.json');
  const valid = {
    target: 'web', autoplay: true, doctor: true,
    limits: {
      desktop: { readyMs: 1500, p95Ms: 32 },
      mobile: { readyMs: 2000, p95Ms: 48 },
      zipBytes: 2_000_000,
    },
  };
  try {
    await mkdir(path.dirname(specPath), { recursive: true });
    await writeFile(path.join(dir, 'tests', 'acceptance.mjs'), 'export async function run() {}\n');
    const refuse = async (spec, expected) => {
      if (spec !== undefined) await writeFile(specPath, typeof spec === 'string' ? spec : JSON.stringify(spec));
      const report = await runAcceptForProject(dir, { release: true });
      assert.equal(report.ok, false);
      assert.equal(report.accepted, false);
      assert.equal(report.releaseReady, false);
      assert.deepEqual(Object.keys(report.gates), ['release'], 'no other gate ran');
      assert.equal(report.gates.release.status, 'failed');
      assert.deepEqual(report.problems.length, 1);
      assert.match(report.problems[0], expected);
      assert.deepEqual(JSON.parse(await readFile(reportPath, 'utf8')), report, 'the refusal is the recorded report');
    };

    await refuse(undefined, /Release requires tests\/release\.json with explicit budgets/);
    await refuse('{ "target":', /\[release\] Unexpected end of JSON input/);
    await refuse({ ...valid, target: 'steam' }, /\[release\] Release target must be web or toy/);
    await refuse({ ...valid, gpu: 'auto' }, /\[release\] Release gpu must be software or hardware/);
    await refuse({ ...valid, mobileTouch: 'true' }, /\[release\] Release mobileTouch must be a boolean/);
    await refuse({ ...valid, autoplay: ' ' }, /\[release\] Release autoplay must be true or explain why it does not apply/);
    await refuse({ ...valid, doctor: undefined }, /\[release\] Release doctor must be true or explain why it does not apply/);
    await refuse({ ...valid, limits: { ...valid.limits, desktop: { p95Ms: 32 } } }, /\[release\] Invalid release budget desktop\.readyMs/);
    await refuse(
      { ...valid, limits: { ...valid.limits, mobile: { ...valid.limits.mobile, minDurationMs: 0 } } },
      /\[release\] Invalid release budget mobile\.minDurationMs/,
    );
    await refuse({ ...valid, limits: { ...valid.limits, zipBytes: 0 } }, /\[release\] Invalid release budget zipBytes/);
    await writeFile(specPath, JSON.stringify(valid));
    await rm(path.join(dir, 'tests', 'acceptance.mjs'));
    await refuse(undefined, /\[release\] Release requires tests\/acceptance\.mjs with observable input checkpoints/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

/** A port nothing listens on. */
async function closedPort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

/** Serves the two WebAsset endpoints the verification scripts talk to, from one throwaway port. */
async function startFakeWebAsset() {
  const state = { items: [], serveDir: null, mangle: false };
  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://127.0.0.1');
    if (pathname === '/api/games') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ items: state.items }));
      return;
    }
    try {
      const body = await readFile(path.join(state.serveDir, path.basename(pathname)));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(state.mangle ? '{}' : body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    state,
    port,
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

/** Runs `run` with the WebAsset ports the scripts read from the environment, then restores them. */
async function withWebAssetEnv(overrides, run) {
  const saved = Object.keys(overrides).map(key => [key, process.env[key]]);
  const apply = values => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(overrides);
  try {
    return await run();
  } finally {
    apply(Object.fromEntries(saved));
  }
}

test('verification scripts refuse a WebAsset that is offline, unaware of the game, or serving another directory', async () => {
  const web = await startFakeWebAsset();
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-webasset-source-'));
  try {
    const dir = path.join(tmp, 'folder-name');
    await mkdir(dir);
    const preview = `${web.origin}/local-games/my-game/index.html`;
    const listed = extra => [{ source: 'local', runtimeId: 'my-game', status: 'ready', previewUrl: preview, ...extra }];
    const root = new URL('/local-games/my-game/', preview);
    const opts = { viewport: '960x540', chrome: '' };
    const meta = { ready: '#game' };
    // The gate goes by the configured id, not by the folder name.
    const config = { id: 'my-game' };

    // Offline: a required check fails, an optional one is skipped.
    const offlinePort = await closedPort();
    const offline = { WEBASSET_PORT: String(offlinePort), WEBASSET_GAME_PORT: String(offlinePort) };
    await withWebAssetEnv(offline, async () => {
      assert.deepEqual(webAssetOrigins(), { catalog: `http://127.0.0.1:${offlinePort}`, preview: `http://127.0.0.1:${offlinePort}` });
      await assert.rejects(() => resolveWebAssetGame('my-game'), /fetch failed/);
      assert.deepEqual(await runWebAssetGate(dir, opts, meta, config), {
        status: 'skipped', reason: `WebAsset offline on http://127.0.0.1:${offlinePort}`, errors: [],
      });
      assert.deepEqual(await runWebAssetGate(dir, { ...opts, webasset: true }, meta, config), {
        status: 'failed', errors: [`WebAsset is offline on http://127.0.0.1:${offlinePort} (--webasset required)`],
      });
      assert.deepEqual(await runWebAssetGate(dir, { ...opts, skipWebasset: true }, meta, config), {
        status: 'skipped', reason: '--skip-webasset', errors: [],
      });
      const cli = await runCli('playtest.mjs', ['my-game', '--webasset'], offline);
      assert.equal(cli.code, 1, cli.stdout + cli.stderr);
      const report = JSON.parse(cli.stdout);
      assert.equal(report.ok, false);
      assert.equal(report.gameId, 'my-game');
      assert.deepEqual(report.problems, ['fetch failed']);
      assert.equal(report.url, undefined, 'no page was opened');
    });

    // Online, but the game is not registered as a ready local game.
    const online = { WEBASSET_PORT: String(web.port), WEBASSET_GAME_PORT: String(web.port) };
    await withWebAssetEnv(online, async () => {
      for (const items of [[], listed({ status: 'building' }), listed({ source: 'remote' })]) {
        web.state.items = items;
        await assert.rejects(() => resolveWebAssetGame('my-game'), /WebAsset does not list a ready local game named my-game/);
      }
      web.state.items = [];
      assert.deepEqual(await runWebAssetGate(dir, opts, meta, config), {
        status: 'skipped', reason: 'Game "my-game" not in WebAsset catalog', errors: [],
      });
      assert.deepEqual(await runWebAssetGate(dir, { ...opts, webasset: true }, meta, config), {
        status: 'failed', url: null, errors: ['WebAsset does not list a ready local game named my-game'],
      });
      const cli = await runCli('playtest.mjs', ['my-game', '--webasset'], online);
      assert.equal(cli.code, 1, cli.stdout + cli.stderr);
      assert.deepEqual(JSON.parse(cli.stdout).problems, ['WebAsset does not list a ready local game named my-game']);

      // Registered under an address that is not the local-games preview.
      const foreign = ['http://127.0.0.1:1/local-games/my-game/index.html', `${web.origin}/local-games/other-game/index.html`];
      for (const previewUrl of foreign) {
        web.state.items = listed({ previewUrl });
        await assert.rejects(() => resolveWebAssetGame('my-game'), /Unexpected WebAsset preview address for my-game/);
      }

      // Registered, but the preview serves another directory or other bytes.
      const mismatch = `WebAsset does not serve this project directory (${dir}). Run from the registered source directory.`;
      web.state.items = listed();
      assert.deepEqual(await runWebAssetGate(dir, opts, meta, config), { status: 'failed', url: preview, errors: [mismatch] });
      await assert.rejects(() => verifyWebAssetSource(root, dir), /does not serve this project directory/);
      assert.deepEqual(await readdir(dir), [], 'the probe file is removed after every attempt');
      web.state.serveDir = dir;
      web.state.mangle = true;
      await assert.rejects(() => verifyWebAssetSource(root, dir), /does not serve this project directory/);
      web.state.mangle = false;
      await verifyWebAssetSource(root, dir);
      assert.deepEqual(await readdir(dir), []);
      assert.equal((await resolveWebAssetGame('my-game')).href, preview);
    });

    await withWebAssetEnv({ WEBASSET_PORT: '0', WEBASSET_GAME_PORT: 'abc' }, () => {
      assert.throws(() => webAssetOrigins(), /WEBASSET_PORT must be a finite integer between 1 and 65535/);
      delete process.env.WEBASSET_PORT;
      assert.throws(() => webAssetOrigins(), /WEBASSET_GAME_PORT must be a finite integer between 1 and 65535/);
    });
    await withWebAssetEnv({ WEBASSET_PORT: undefined, WEBASSET_GAME_PORT: undefined }, () => {
      assert.deepEqual(webAssetOrigins(), { catalog: 'http://127.0.0.1:4174', preview: 'http://127.0.0.1:4175' });
    });
  } finally {
    await web.close();
    await rm(tmp, { recursive: true, force: true });
  }
});

