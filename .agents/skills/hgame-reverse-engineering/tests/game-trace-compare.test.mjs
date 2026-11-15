import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/compare-game-traces.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'game-trace-'));
  try {
    const header = build => ({ _type: 'trace', schemaVersion: 1, gameId: 'demo', scenarioId: 'move-1', build, tickHz: 60 });
    const line = value => JSON.stringify(value);
    const expected = [header('original'), { _type: 'event', tick: 1, actorId: 'p1', type: 'hit', position: { x: 1, y: 2 }, health: 80 }];
    const actual = [header('html'), { _type: 'event', tick: 1, actorId: 'p1', type: 'projectile-hit', position: { x: 1.005, y: 2 }, hp: 80 }];
    const a = path.join(root, 'original.jsonl'), b = path.join(root, 'html.jsonl'), map = path.join(root, 'map.json');
    await writeFile(a, expected.map(line).join('\n') + '\n');
    await writeFile(b, actual.map(line).join('\n') + '\n');
    await writeFile(map, JSON.stringify({ schemaVersion: 1,
      keyFields: [{ expected: 'tick', actual: 'tick' }, { expected: 'actorId', actual: 'actorId' },
        { expected: 'type', actual: 'type', actualAliases: { 'projectile-hit': 'hit' } }],
      compareFields: [{ expected: 'position.x', actual: 'position.x', tolerance: 0.01 },
        { expected: 'position.y', actual: 'position.y', tolerance: 0.01 }, { expected: 'health', actual: 'hp', tolerance: 0 }] }));
    await fn({ root, a, b, map, expected, actual });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('trace comparator maps event aliases and numeric tolerances', () => fixture(async ({ a, b, map }) => {
  const result = run(a, b, '--map', map, '--json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).match, true);
}));

test('trace comparator reports first divergent field and missing/extra events', () => fixture(async ({ a, b, map, actual }) => {
  actual[1].position.x = 1.5;
  actual.push({ _type: 'event', tick: 2, actorId: 'p1', type: 'move', position: { x: 2, y: 2 }, hp: 80 });
  await writeFile(b, actual.map(JSON.stringify).join('\n') + '\n');
  const result = run(a, b, '--map', map, '--json');
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.fieldMismatches, 1);
  assert.equal(report.extraEvents, 1);
  assert.equal(report.firstDivergence.kind, 'field-mismatch');
}));

test('trace metadata mismatch is rejected instead of comparing unrelated scenarios', () => fixture(async ({ a, b, map, actual }) => {
  actual[0].scenarioId = 'other-scenario';
  await writeFile(b, actual.map(JSON.stringify).join('\n') + '\n');
  const result = run(a, b, '--map', map, '--json');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /metadata mismatch/);
}));
