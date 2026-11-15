import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const tool = fileURLToPath(new URL('../scripts/compare-tick-traces.mjs', import.meta.url));

test('same canonical tick/hash CSV from two runtimes matches exactly', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ticktrace-match-'));
  try {
    const a = path.join(dir, 'windows.csv'), b = path.join(dir, 'web.csv');
    await writeFile(a, '1,3400000000\n2,3\n3,4294967295\n');
    await writeFile(b, '1,3400000000\r\n2,3\r\n3,4294967295\r\n');
    const r = spawnSync(process.execPath, [tool, a, b, '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.match, true);
    assert.equal(report.comparedTicks, 3);
    assert.equal(report.firstDifferenceTick, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('altering Tick7 identifies first divergent logic tick', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ticktrace-diff-'));
  try {
    const a = path.join(dir, 'a.csv'), b = path.join(dir, 'b.csv');
    await writeFile(a, Array.from({ length: 10 }, (_, i) => (i + 1) + ',' + (1000 + i)).join('\n'));
    await writeFile(b, Array.from({ length: 10 }, (_, i) => (i + 1) + ',' + (i === 6 ? 99999 : 1000 + i)).join('\n'));
    const r = spawnSync(process.execPath, [tool, a, b, '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    const report = JSON.parse(r.stdout);
    assert.equal(report.match, false);
    assert.equal(report.firstDifferenceTick, 7);
    assert.equal(report.expectedHash, '1006');
    assert.equal(report.actualHash, '99999');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('missing/duplicate ticks or unequal trace length cannot silently pass', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ticktrace-invalid-'));
  try {
    const a = path.join(dir, 'a.csv'), b = path.join(dir, 'b.csv');
    await writeFile(a, '1,123\n2,124\n3,125\n');
    await writeFile(b, '1,123\n3,125\n');
    let r = spawnSync(process.execPath, [tool, a, b, '--json'], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    await writeFile(b, '1,123\n2,124\n2,124\n');
    r = spawnSync(process.execPath, [tool, a, b, '--json'], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    await writeFile(b, '1,123\n2,124\n');
    r = spawnSync(process.execPath, [tool, a, b, '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).firstDifferenceTick, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
