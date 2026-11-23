import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('snapshot CLI accepts new baselines only after all capture checks succeed', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hgame-snapshot-safety-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const game = path.join(dir, 'game');
  mkdirSync(game);
  writeFileSync(path.join(game, 'index.html'), `<!doctype html><style>@keyframes slide { from { transform: translateX(0); } to { transform: translateX(20px); } }</style><canvas id="game" width="64" height="64"></canvas><script>
const mode = new URLSearchParams(location.search).get('mode');
if (mode === 'animated') document.getElementById('game').style.animation = 'slide 1s linear infinite alternate';
const g = document.getElementById('game').getContext('2d');
g.fillStyle = '#123'; g.fillRect(0, 0, 64, 64);
if (mode !== 'blank') { g.fillStyle = '#fa0'; g.fillRect(4, 4, 24, 24); }
if (mode === 'page') queueMicrotask(() => { throw new Error('page-failed'); });
if (mode === 'http') fetch('./missing-resource');
window.__hgameState = () => { if (mode === 'state') throw new Error('state-failed'); return { ready: true }; };
</script>`);
  const baseline = path.join(dir, 'baseline.png');
  const out = path.join(dir, 'candidate.png');
  const run = (extra = []) => {
    const outputArgs = extra.includes('--out') ? [] : ['--out', out];
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/snapshot.mjs'), game,
      '--freeze-time', '--steps', '0', '--baseline', baseline, '--update-baseline', ...outputArgs, ...extra],
    { encoding: 'utf8', timeout: 45000 });
    assert.ifError(result.error);
    return { status: result.status, report: JSON.parse(result.stdout) };
  };
  for (const mode of ['eval', 'state', 'page', 'http', 'blank']) {
    await t.test(`failed ${mode} leaves accepted baseline unchanged`, () => {
      writeFileSync(baseline, 'accepted');
      const args = mode === 'eval' ? ['--eval', "Promise.reject(new Error('eval-failed'))"] : ['--query', 'mode=' + mode];
      const result = run(args);
      assert.equal(result.status, 1, JSON.stringify(result.report));
      assert.equal(result.report.ok, false);
      assert.equal(readFileSync(baseline, 'utf8'), 'accepted');
      assert.equal(result.report.baselineUpdated, undefined);
    });
  }
  await t.test('failed shared-path output preserves baseline', () => {
    writeFileSync(baseline, 'accepted');
    const result = run(['--out', baseline, '--query', 'mode=blank']);
    assert.equal(result.status, 1);
    assert.equal(readFileSync(baseline, 'utf8'), 'accepted');
  });
  await t.test('output destination failure preserves baseline', () => {
    writeFileSync(baseline, 'accepted');
    const blocked = path.join(dir, 'blocked');
    mkdirSync(blocked);
    const result = run(['--out', blocked]);
    assert.equal(result.status, 1);
    assert.equal(result.report.baselineUpdated, undefined);
    assert.equal(readFileSync(baseline, 'utf8'), 'accepted');
  });
  await t.test('successful shared-path update writes a valid PNG', () => {
    const result = run(['--out', baseline]);
    assert.equal(result.status, 0, JSON.stringify(result.report));
    assert.equal(result.report.baselineUpdated, baseline);
    assert.equal(readFileSync(baseline).subarray(1, 4).toString(), 'PNG');
  });
  await t.test('frozen capture handles an animated element without waiting for live animation frames', () => {
    const result = run(['--query', 'mode=animated']);
    assert.equal(result.status, 0, JSON.stringify(result.report));
    assert.equal(result.report.ok, true);
    const repeat = run(['--query', 'mode=animated']);
    assert.equal(repeat.status, 0, JSON.stringify(repeat.report));
    assert.equal(repeat.report.sha256, result.report.sha256);
  });
  await t.test('captures a nested entry within the fixture', () => {
    const entry = 'toy/release-probe/index.html';
    const nested = path.join(game, 'toy', 'release-probe');
    mkdirSync(nested, { recursive: true });
    const html = readFileSync(path.join(game, 'index.html'), 'utf8');
    writeFileSync(path.join(nested, 'index.html'), html.replace('{ ready: true }', '{ entry: location.pathname }'));
    const result = run(['--entry', entry]);
    assert.equal(result.status, 0, JSON.stringify(result.report));
    assert.deepEqual(result.report.state, { entry: '/' + entry });
  });
  await t.test('early failure reports HTTP and JavaScript errors', () => {
    const entryFile = path.join(game, 'index.html');
    const html = readFileSync(entryFile, 'utf8');
    writeFileSync(baseline, 'accepted');
    try {
      writeFileSync(entryFile, `<!doctype html><img src="./missing-module.png" hidden><canvas hidden id="game"></canvas>
<script>throw new Error('early-boot-failure');</script>`);
      const result = run();
      assert.equal(result.status, 1, JSON.stringify(result.report));
      assert.ok(result.report.httpErrors?.some(error => error.includes('404') && error.endsWith('/missing-module.png')));
      assert.ok(result.report.consoleErrors?.some(error => error.includes('early-boot-failure')));
      assert.equal(readFileSync(baseline, 'utf8'), 'accepted');
    } finally {
      writeFileSync(entryFile, html);
    }
  });
});
