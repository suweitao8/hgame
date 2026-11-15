import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runScan, writeOutputs } from '../src/cli.mjs';

const binPath = fileURLToPath(new URL('../bin/game-reverse-scan.mjs', import.meta.url));

function makeTemp(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `grs-cli-${name}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const PE_HEADER = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64), Buffer.from('PE\0\0')]);

function buildUnityFixture(root) {
  fs.mkdirSync(path.join(root, 'Game_Data', 'Managed'), { recursive: true });
  fs.writeFileSync(path.join(root, 'UnityPlayer.dll'), PE_HEADER);
  fs.writeFileSync(path.join(root, 'Game_Data', 'Managed', 'Assembly-CSharp.dll'), PE_HEADER);
  fs.writeFileSync(path.join(root, 'Game_Data', 'boot.config'), 'wait-for-native-debugger=0\n');
  fs.writeFileSync(path.join(root, 'readme.txt'), 'fixture');
}

function buildUnknownFixture(root) {
  fs.writeFileSync(path.join(root, 'notes.txt'), 'nothing recognizable here');
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function runBin(args, options = {}) {
  return spawnSync(process.execPath, [binPath, ...args], { encoding: 'utf8', ...options });
}

test('runScan produces the four artifacts for a synthetic Unity build', async (t) => {
  const input = makeTemp(t, 'unity');
  buildUnityFixture(input);
  const result = await runScan(input);
  assert.equal(result.profile.schema_version, 1);
  assert.equal(result.profile.engine.name, 'Unity');
  assert.ok(result.inventory.files.some(file => file.path === 'UnityPlayer.dll'));
  assert.ok(!result.inventory.files.some(file => 'absolutePath' in file), 'serialized inventory omits absolute paths');
  assert.ok(result.recommendations.recommendations.length >= 1);
  for (const group of result.recommendations.recommendations) {
    for (const tool of group.tools) assert.equal(tool.availability, 'not_checked');
  }
  assert.match(result.report, /Unity/);
  assert.equal(JSON.parse(JSON.stringify(result.inventory)).stats.fileCount >= 3, true);
  const profile = JSON.parse(JSON.stringify(result.profile));
  assert.equal(profile.source.find(item => item.path === 'UnityPlayer.dll').sha256, '');
});

test('runScan keeps unknown builds unknown without fabricated versions', async (t) => {
  const input = makeTemp(t, 'unknown');
  buildUnknownFixture(input);
  const result = await runScan(input);
  assert.equal(result.profile.engine.name, 'unknown');
  assert.equal(result.profile.engine.version, 'unknown');
  assert.deepEqual(result.profile.offline_scope.unknown, []);
});

test('runScan hashes only recognized key artifacts when hashing is opted in', async (t) => {
  const input = makeTemp(t, 'hash');
  buildUnityFixture(input);
  const result = await runScan(input, { hashKeyFiles: true });
  const hashed = result.profile.source.find(item => item.path === 'UnityPlayer.dll');
  assert.equal(hashed.sha256, sha256(path.join(input, 'UnityPlayer.dll')));
  assert.equal(result.profile.source.find(item => item.path === 'readme.txt'), undefined);
});

test('runScan honors max-files limits and records truncation', async (t) => {
  const input = makeTemp(t, 'limit');
  buildUnityFixture(input);
  fs.mkdirSync(path.join(input, 'more'), { recursive: true });
  for (let index = 0; index < 6; index += 1) {
    fs.writeFileSync(path.join(input, 'more', `f${index}.txt`), `file ${index}`);
  }
  const result = await runScan(input, { maxFiles: 4 });
  assert.equal(result.inventory.files.length, 4);
  assert.equal(result.inventory.stats.truncated, true);
  assert.ok(result.inventory.warnings.some(warning => warning.code === 'file-limit-reached'));
});

test('writeOutputs writes exactly the four artifacts', async (t) => {
  const input = makeTemp(t, 'write');
  buildUnityFixture(input);
  const outDir = makeTemp(t, 'out');
  const result = await runScan(input);
  const { writtenFiles } = await writeOutputs(outDir, result);
  const names = writtenFiles.map(file => path.basename(file)).sort();
  assert.deepEqual(names, ['engine-profile.json', 'inventory.json', 'report.md', 'tool-recommendations.json']);
  for (const file of writtenFiles) {
    if (file.endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  assert.match(fs.readFileSync(path.join(outDir, 'report.md'), 'utf8'), /Game Reverse Scanner report/);
});

test('writeOutputs refuses directories inside the scanned input', async (t) => {
  const input = makeTemp(t, 'guard');
  buildUnityFixture(input);
  const result = await runScan(input);
  await assert.rejects(
    () => writeOutputs(path.join(input, 'out'), result),
    error => error.code === 'UNSAFE_OUTPUT',
  );
});

test('CLI scans a directory end to end and leaves input bytes unchanged', (t) => {
  const input = makeTemp(t, 'e2e');
  buildUnityFixture(input);
  const outDir = makeTemp(t, 'e2e-out');
  const before = sha256(path.join(input, 'UnityPlayer.dll'));
  const run = runBin(['scan', input, '--out', outDir]);
  assert.equal(run.status, 0, `stderr: ${run.stderr}`);
  assert.equal(sha256(path.join(input, 'UnityPlayer.dll')), before, 'input bytes must not change');
  for (const name of ['inventory.json', 'engine-profile.json', 'tool-recommendations.json']) {
    JSON.parse(fs.readFileSync(path.join(outDir, name), 'utf8'));
  }
  const profile = JSON.parse(fs.readFileSync(path.join(outDir, 'engine-profile.json'), 'utf8'));
  assert.equal(profile.engine.name, 'Unity');
  assert.match(fs.readFileSync(path.join(outDir, 'report.md'), 'utf8'), /Game Reverse Scanner report/);
});

test('CLI scans a single file input', (t) => {
  const dir = makeTemp(t, 'single');
  const file = path.join(dir, 'UnityPlayer.dll');
  fs.writeFileSync(file, PE_HEADER);
  const outDir = makeTemp(t, 'single-out');
  const run = runBin(['scan', file, '--out', outDir]);
  assert.equal(run.status, 0, `stderr: ${run.stderr}`);
  const profile = JSON.parse(fs.readFileSync(path.join(outDir, 'engine-profile.json'), 'utf8'));
  assert.equal(profile.engine.name, 'Unity');
});

test('CLI --help and --version exit 0', () => {
  const help = runBin(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /scan <input-path>/);
  const version = runBin(['--version']);
  assert.equal(version.status, 0);
  assert.match(version.stdout, /^\d+\.\d+\.\d+/);
});

test('CLI argument errors exit 2', (t) => {
  const input = makeTemp(t, 'args');
  buildUnityFixture(input);
  const outDir = makeTemp(t, 'args-out');
  const cases = [
    [],
    ['scan'],
    ['scan', input],
    ['scan', input, '--out'],
    ['scan', input, '--out', outDir, '--max-files', 'zero'],
    ['scan', input, '--out', outDir, '--unknown-flag'],
    ['not-a-command', input],
  ];
  for (const args of cases) {
    const run = runBin(args);
    assert.equal(run.status, 2, `expected exit 2 for: ${args.join(' ')}`);
  }
});

test('CLI nonexistent input exits 1 with a scan failure', (t) => {
  const missing = path.join(os.tmpdir(), `grs-missing-${process.pid}`);
  const outDir = makeTemp(t, 'missing-out');
  const run = runBin(['scan', missing, '--out', outDir]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /not found/i);
});

test('CLI rejects output paths inside the input with exit 3', (t) => {
  const input = makeTemp(t, 'unsafe');
  buildUnityFixture(input);
  const inside = path.join(input, 'nested', 'out');
  const run = runBin(['scan', input, '--out', inside]);
  assert.equal(run.status, 3);
  assert.match(run.stderr, /inside|unsafe/i);
  const equalRun = runBin(['scan', input, '--out', input]);
  assert.equal(equalRun.status, 3);
});

test('CLI output path matching is case-insensitive on Windows', (t) => {
  if (process.platform !== 'win32') return;
  const input = makeTemp(t, 'case');
  buildUnityFixture(input);
  const upper = input.toUpperCase();
  const lower = input.toLowerCase();
  if (upper === lower) return;
  const run = runBin(['scan', upper, '--out', path.join(lower, 'out')]);
  assert.equal(run.status, 3, 'case variants of the input path must be rejected');
});
