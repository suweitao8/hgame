import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const start = path.join(root, 'scripts', 'start-research.mjs');
const audit = path.join(root, 'scripts', 'audit-coverage.mjs');
const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024,
});

test('research bootstrap integrates built-in scanner, creates one canonical profile and a blank coverage ledger outside source', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'skill-research-'));
  const source = path.join(temp, 'original');
  const output = path.join(temp, 'research');
  try {
    await mkdir(path.join(source, 'Demo_Data', 'Managed'), { recursive: true });
    await writeFile(path.join(source, 'Demo_Data', 'Managed', 'Assembly-CSharp.dll'), 'test fixture');
    await writeFile(path.join(source, 'UnityPlayer.dll'), 'test fixture');
    const original = await readdir(source);
    const dry = run(start, source, '--out', output, '--game-id', 'demo', '--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    await assert.rejects(stat(output), { code: 'ENOENT' });

    const created = run(start, source, '--out', output, '--game-id', 'demo', '--name', '示例');
    assert.equal(created.status, 0, created.stderr);
    assert.deepEqual((await readdir(source)).sort(), original.sort(), 'the source is unchanged');
    const profile = JSON.parse(await readFile(path.join(output, 'production', 'engine-profile.json'), 'utf8'));
    assert.equal(profile.game.id, 'demo');
    assert.equal(profile.game.name, '示例');
    assert.ok(profile.engine.name.toLowerCase().includes('unity'));
    const report = await readFile(path.join(output, 'raw', 'scanner', 'report.md'), 'utf8');
    assert.match(report, /Unity/i);
    const ledger = await readFile(path.join(output, 'production', 'coverage.csv'), 'utf8');
    assert.match(ledger, /^id,domain,item,scope,/);
    assert.equal(ledger.split(/\r?\n/).filter(Boolean).length, 1);
    const baseline = JSON.parse(await readFile(path.join(output, 'baseline.json'), 'utf8'));
    assert.equal(baseline.scannerStatus, 'unreviewed');
    assert.equal(baseline.sourcePath, await (await import('node:fs/promises')).realpath(source));

    await writeFile(path.join(output, 'notes.txt'), 'user data');
    const repeat = run(start, source, '--out', output, '--game-id', 'demo');
    assert.notEqual(repeat.status, 0);
    assert.equal(await readFile(path.join(output, 'notes.txt'), 'utf8'), 'user data');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('research bootstrap refuses to create outputs in original game or unsafe aliases', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'skill-research-boundary-'));
  const source = path.join(temp, 'original');
  try {
    await mkdir(source);
    await writeFile(path.join(source, 'data.win'), 'untouched');
    const result = run(start, source, '--out', path.join(source, 'research'), '--game-id', 'demo');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside|original|source/i);
    assert.equal(await readFile(path.join(source, 'data.win'), 'utf8'), 'untouched');
    assert.deepEqual(await readdir(source), ['data.win']);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

const HEADER = 'id,domain,item,scope,source_ref,evidence_kind,evidence_ref,extracted_output,target_path,reverse_status,implementation_status,verification_status,blocker,notes';

test('coverage audit separates reverse, implementation, verification and excluded online scope', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'skill-coverage-'));
  try {
    const file = path.join(temp, 'coverage.csv');
    const rows = [
      'movement,gameplay,"加速,转向",offline-required,src/Move.cs,static,src/Move.cs:45,data/move.json,src/move.js,understood,implemented,passed,,',
      'npc-ai,ai,追击,offline-required,src/Npc.cs,observed,video#t=30,,src/ai.js,understood,implemented,not-run,,',
      'effects,audio,音效,offline-adapter,,, ,,,unknown,not-started,deferred,needs original mapping,',
      'login,platform,登录,excluded-online,,,,,,unseen,not-applicable,deferred,,',
    ];
    await writeFile(file, HEADER + '\n' + rows.join('\n') + '\n');
    const check = run(audit, file, '--json');
    assert.equal(check.status, 0, check.stderr);
    const summary = JSON.parse(check.stdout);
    assert.equal(summary.total, 4);
    assert.equal(summary.inScope, 3);
    assert.equal(summary.excluded, 1);
    assert.equal(summary.reverse.understood, 2);
    assert.equal(summary.implementation.implemented, 2);
    assert.equal(summary.verification.passed, 1);
    assert.equal(summary.complete, false);
    assert.equal(summary.errors.length, 0);
    const gate = run(audit, file, '--require-complete');
    assert.notEqual(gate.status, 0);
    assert.match(gate.stdout, /incomplete|未完成/i);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('coverage audit rejects duplicates, bad states and unverifiable passed rows', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'skill-coverage-invalid-'));
  try {
    const file = path.join(temp, 'coverage.csv');
    const rows = [
      'hit,combat,伤害,offline-required,,inferred,,,src/hit.js,understood,implemented,passed,,',
      'hit,combat,重复,offline-required,src/hit.cs,static,src/hit.cs:1,,,nonsense,implemented,passed,,',
    ];
    await writeFile(file, HEADER + '\n' + rows.join('\n') + '\n');
    const auditResult = run(audit, file, '--json');
    assert.notEqual(auditResult.status, 0);
    const summary = JSON.parse(auditResult.stdout);
    assert.ok(summary.errors.some(message => /duplicate/i.test(message)));
    assert.ok(summary.errors.some(message => /reverse_status|unknown status/i.test(message)));
    assert.ok(summary.errors.some(message => /evidence|source_ref/i.test(message)));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('empty coverage ledger never reports complete or 100% fidelity', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'skill-coverage-empty-'));
  try {
    const file = path.join(temp, 'coverage.csv');
    await writeFile(file, HEADER + '\n');
    const result = run(audit, file, '--json');
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.complete, false);
    assert.equal(report.inScope, 0);
    assert.equal(report.reverseRate, null);
    assert.equal(report.verifiedRate, null);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('coverage CSV accepts multiline quoted notes while rejecting malformed and incomplete headers', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'skill-coverage-quote-'));
  try {
    const file = path.join(temp, 'coverage.csv');
    const row = [
      'movement', 'gameplay', '转向', 'offline-required',
      'code/move.cs', 'static', 'code/move.cs:10', '',
      'src/move.js', 'understood', 'implemented', 'passed', '',
      '"有逗号, 有换行\n并包含""双引号"""',
    ].join(',');
    await writeFile(file, HEADER + '\n' + row + '\n');
    const result = run(audit, file, '--json', '--require-complete');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).complete, true);
    assert.equal(JSON.parse(result.stdout).verifiedRate, 100);

    await writeFile(file, 'id,scope\nmove,offline-required\n');
    const invalid = run(audit, file);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /missing columns/i);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
