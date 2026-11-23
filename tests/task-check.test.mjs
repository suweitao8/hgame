import assert from 'node:assert/strict';
import { env } from 'node:process';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyWebAssetSource } from '../scripts/playtest.mjs';

const cli = fileURLToPath(new URL('../scripts/task-check.mjs', import.meta.url));

function project(t, source) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hgame-task-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'tests'));
  writeFileSync(path.join(dir, 'tests', 'behavior.test.mjs'), source);
  return dir;
}

function check(dir, requirements) {
  writeFileSync(path.join(dir, 'task.json'), JSON.stringify({
    schemaVersion: 1,
    task: 'Keep the restored score after restart',
    requirements,
  }));
  const result = spawnSync(process.execPath, [cli, 'task.json'], {
    cwd: dir, env: { ...env, NODE_TEST_CONTEXT: undefined }, encoding: 'utf8', timeout: 15000,
  });
  assert.ifError(result.error);
  assert.ok(result.stdout, result.stderr);
  return { code: result.status, ...JSON.parse(result.stdout) };
}

function requirement(id, name) {
  return { id, expected: `Observe ${name}`, checks: [{ type: 'test', file: 'tests/behavior.test.mjs', name }] };
}

test('task-check proves only the exact tests that ran and passed', t => {
  const dir = project(t, `import test from 'node:test';
test('restores score', () => {});
test.skip('ignores outdated data', () => {});
test('ambiguous', () => {});
test('ambiguous', () => {});
`);
  const passed = check(dir, [requirement('score', 'restores score')]);
  assert.equal(passed.code, 0, JSON.stringify(passed));
  assert.equal(passed.status, 'passed');
  assert.equal(passed.requirements[0].status, 'passed');

  const partial = check(dir, [requirement('score', 'restores score'), requirement('missing', 'score'),
    requirement('skipped', 'ignores outdated data'), requirement('duplicate', 'ambiguous')]);
  assert.equal(partial.code, 1);
  assert.equal(partial.status, 'pending');
  assert.deepEqual(partial.requirements.map(item => item.status), ['passed', 'pending', 'pending', 'pending']);
});

test('task-check runs fresh evidence and reports failures after source changes', t => {
  const dir = project(t, `import test from 'node:test'; test('restores score', () => {});`);
  const requirements = [requirement('score', 'restores score')];
  assert.equal(check(dir, requirements).status, 'passed');
  writeFileSync(path.join(dir, 'tests', 'behavior.test.mjs'),
    `import test from 'node:test'; test('restores score', () => { throw new Error('score reset'); });`);
  const failed = check(dir, requirements);
  assert.equal(failed.code, 1);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.requirements[0].status, 'failed');
  assert.match(JSON.stringify(failed), /score reset/);
});

test('task-check exposes visual review separately and rejects empty criteria', t => {
  const dir = project(t, '');
  const result = check(dir, [{ id: 'hud', expected: 'Health remains readable in combat', checks: [
    { type: 'review', inspect: 'Inspect a combat frame at 360×800.' },
  ] }]);
  assert.equal(result.code, 1);
  assert.equal(result.status, 'pending');
  assert.equal(result.requirements[0].checks[0].status, 'review-required');
  assert.equal(check(dir, []).code, 2);
  assert.equal(check(dir, [{ id: 'empty', expected: 'Empty', checks: [] }]).code, 2);
  assert.match(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }), /task-check/);
});

test('WebAsset source verification accepts only the directory that serves its fresh probe', async t => {
  const registered = project(t, '');
  const copy = project(t, '');
  const server = createServer(async (request, response) => {
    try {
      response.end(await readFile(path.join(registered, path.basename(request.url))));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = new URL(`http://127.0.0.1:${server.address().port}/local-games/arena/`);
  await verifyWebAssetSource(url, registered);
  await assert.rejects(verifyWebAssetSource(url, copy), /WebAsset.*project directory/i);
  assert.deepEqual(await readdir(registered), ['tests']);
  assert.deepEqual(await readdir(copy), ['tests']);
});
