import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const moduleUrl = new URL('../scripts/lib/snapshot-output.mjs', import.meta.url);

function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hgame-snapshot-output-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const baselinePath = path.join(dir, 'baseline.png');
  writeFileSync(baselinePath, 'accepted');
  return { dir, baselinePath, outputPath: path.join(dir, 'candidate.png'), png: Buffer.from('candidate') };
}

test('failed captures preserve the accepted baseline and retain separate diagnostics', async t => {
  const { writeSnapshotOutput } = await import(moduleUrl);
  const f = fixture(t);
  const result = writeSnapshotOutput({ ...f, updateBaseline: true, valid: false });
  assert.equal(readFileSync(f.baselinePath, 'utf8'), 'accepted');
  assert.equal(readFileSync(f.outputPath, 'utf8'), 'candidate');
  assert.equal(result.baselineUpdated, undefined);
});

test('failed capture with output equal to baseline preserves accepted bytes', async t => {
  const { writeSnapshotOutput } = await import(moduleUrl);
  const f = fixture(t);
  writeSnapshotOutput({ ...f, outputPath: f.baselinePath, updateBaseline: true, valid: false });
  assert.equal(readFileSync(f.baselinePath, 'utf8'), 'accepted');
});

test('failed capture through a directory alias preserves accepted bytes', async t => {
  const { writeSnapshotOutput } = await import(moduleUrl);
  const f = fixture(t);
  const alias = path.join(f.dir, 'alias');
  symlinkSync(f.dir, alias, process.platform === 'win32' ? 'junction' : 'dir');
  writeSnapshotOutput({ ...f, outputPath: path.join(alias, 'baseline.png'), updateBaseline: true, valid: false });
  assert.equal(readFileSync(f.baselinePath, 'utf8'), 'accepted');
});

test('successful explicit updates replace the baseline, including a shared output path', async t => {
  const { writeSnapshotOutput } = await import(moduleUrl);
  const f = fixture(t);
  const result = writeSnapshotOutput({ ...f, outputPath: f.baselinePath, updateBaseline: true, valid: true });
  assert.equal(readFileSync(f.baselinePath, 'utf8'), 'candidate');
  assert.equal(result.baselineUpdated, f.baselinePath);
  assert.deepEqual(readdirSync(f.dir), ['baseline.png']);
});

test('comparison output cannot implicitly replace its own reference', async t => {
  const { writeSnapshotOutput } = await import(moduleUrl);
  const f = fixture(t);
  assert.throws(() => writeSnapshotOutput({ ...f, outputPath: f.baselinePath, updateBaseline: false, valid: true }), /baseline|reference/i);
  assert.equal(readFileSync(f.baselinePath, 'utf8'), 'accepted');
});

test('candidate write failure preserves the baseline', async t => {
  const { writeSnapshotOutput } = await import(moduleUrl);
  const f = fixture(t);
  mkdirSync(f.outputPath);
  assert.throws(() => writeSnapshotOutput({ ...f, updateBaseline: true, valid: true }));
  assert.equal(readFileSync(f.baselinePath, 'utf8'), 'accepted');
  assert.deepEqual(readdirSync(f.dir).sort(), ['baseline.png', 'candidate.png']);
});

test('baseline replacement failure preserves its destination and removes temporary output', async t => {
  const { writeSnapshotOutput } = await import(moduleUrl);
  const f = fixture(t);
  const baselinePath = path.join(f.dir, 'protected');
  mkdirSync(baselinePath);
  writeFileSync(path.join(baselinePath, 'accepted'), 'original');
  assert.throws(() => writeSnapshotOutput({ ...f, baselinePath, updateBaseline: true, valid: true }));
  assert.equal(readFileSync(path.join(baselinePath, 'accepted'), 'utf8'), 'original');
  assert.deepEqual(readdirSync(f.dir).sort(), ['baseline.png', 'candidate.png', 'protected']);
});
