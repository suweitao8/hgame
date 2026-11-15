import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/audit-function-index.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('function index resolves a static/observed call path from entry to target', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'function-index-'));
  try {
    const file = path.join(root, 'functions.json');
    await writeFile(file, JSON.stringify({ schemaVersion: 1, entryPoints: ['game.start'],
      functions: [{ id: 'game.start', name: 'Start', sourceRef: 'Game.cs:10' },
        { id: 'player.spawn', name: 'Spawn', sourceRef: 'Player.cs:20' },
        { id: 'combat.hit', name: 'Hit', address: '0x1000' }],
      calls: [{ from: 'game.start', to: 'player.spawn', kind: 'static', confidence: 'confirmed', evidenceRef: 'Game.cs:15' },
        { from: 'player.spawn', to: 'combat.hit', kind: 'observed', confidence: 'confirmed', evidenceRef: 'trace#event=8' }] }));
    const result = run(file, '--target', 'combat.hit', '--json', '--require-resolved');
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.pathsToTarget[0], ['game.start', 'player.spawn', 'combat.hit']);
    assert.equal(report.reachableFunctionCount, 3);
    assert.equal(report.edgeKinds.observed, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unresolved call edges and unanchored confirmed edges fail strict audit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'function-index-invalid-'));
  try {
    const file = path.join(root, 'functions.json');
    await writeFile(file, JSON.stringify({ schemaVersion: 1, entryPoints: ['entry'],
      functions: [{ id: 'entry', name: 'Entry' }, { id: 'target', name: 'Target' }],
      calls: [{ from: 'entry', to: 'target', kind: 'static', confidence: 'confirmed' },
        { from: 'entry', to: 'missing', kind: 'inferred' }] }));
    const result = run(file, '--json', '--require-resolved');
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.unresolvedEdges.length, 1);
    assert.equal(report.unanchoredConfirmedEdges.length, 1);
    assert.equal(report.reachableFunctionCount, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
