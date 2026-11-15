import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/merge-function-index.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('function index merge preserves curated entries and imports Ghidra functions/calls without overwriting', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'function-index-merge-'));
  try {
    const target = path.join(root, 'curated.json'), source = path.join(root, 'ghidra.json'), output = path.join(root, 'merged.json');
    await writeFile(target, JSON.stringify({ schemaVersion: 1, gameId: 'demo', entryPoints: ['game.start'],
      sources: [{ id: 'manual', path: 'notes.md' }], functions: [{ id: 'game.start', name: 'Start', sourceRef: 'notes.md:1' }],
      calls: [{ from: 'game.start', to: 'game.update', kind: 'observed', evidenceRef: 'trace#1' }] }));
    await writeFile(source, JSON.stringify({ schemaVersion: 1, gameId: 'demo.exe', entryPoints: [],
      sources: [{ id: 'ghidra', path: 'demo.exe', tool: 'Ghidra' }],
      functions: [{ id: 'game.update', name: 'Update', address: '0x1000' }, { id: 'game.start', name: 'Start', address: '0x2000' }],
      calls: [{ from: 'game.start', to: 'game.update', kind: 'static', confidence: 'confirmed', evidenceRef: '0x2000 -> 0x1000' }] }));
    const result = run(target, source, '--out', output, '--json');
    assert.equal(result.status, 0, result.stderr);
    const merged = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(merged.gameId, 'demo');
    assert.equal(merged.functions.length, 2);
    assert.equal(merged.calls.length, 2);
    assert.equal(merged.functions.find(fn => fn.id === 'game.start').sourceRef, 'notes.md:1');
    assert.equal(merged.mergeHistory.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('function index merge rejects identity conflicts and existing output paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'function-index-conflict-'));
  try {
    const target = path.join(root, 'a.json'), source = path.join(root, 'b.json'), output = path.join(root, 'out.json');
    await writeFile(target, JSON.stringify({ schemaVersion: 1, functions: [{ id: 'f1', name: 'One', address: '0x1' }], calls: [] }));
    await writeFile(source, JSON.stringify({ schemaVersion: 1, functions: [{ id: 'f1', name: 'Other', address: '0x2' }], calls: [] }));
    const conflict = run(target, source, '--out', output);
    assert.equal(conflict.status, 2);
    assert.match(conflict.stderr, /identity conflicts/);
    await writeFile(output, 'keep');
    const exists = run(target, source, '--out', output);
    assert.equal(exists.status, 2);
    assert.equal(await readFile(output, 'utf8'), 'keep');
  } finally { await rm(root, { recursive: true, force: true }); }
});
