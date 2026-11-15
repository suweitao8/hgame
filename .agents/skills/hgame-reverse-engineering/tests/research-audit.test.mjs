import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/audit-research.mjs', import.meta.url));
const skillRoot = fileURLToPath(new URL('../', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('research audit evaluates only configured gates and never calls an empty ledger complete', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'research-audit-'));
  try {
    await mkdir(path.join(root, 'raw', 'scanner'), { recursive: true });
    await mkdir(path.join(root, 'production'), { recursive: true });
    await mkdir(path.join(root, 'production', 'traces'), { recursive: true });
    for (const file of ['inventory.json', 'engine-profile.json', 'tool-recommendations.json', 'report.md']) {
      await writeFile(path.join(root, 'raw', 'scanner', file), '{}');
    }
    const baselinePath = path.join(root, 'baseline.json');
    await writeFile(baselinePath, JSON.stringify({ schemaVersion: 1, gameId: 'demo', sourcePath: 'original', scannerStatus: 'unreviewed' }));
    await writeFile(path.join(root, 'production', 'verification-plan.json'), JSON.stringify({ schemaVersion: 1,
      requirements: { scanner: true, coverage: true, functionIndex: false, dataInventory: false, traceComparison: false } }));
    await writeFile(path.join(root, 'production', 'coverage.csv'), await readFile(path.join(skillRoot, 'assets', 'coverage.template.csv'), 'utf8'));
    const result = run(root, '--json');
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.scanner.status, 'incomplete');
    assert.equal(report.complete, false);
    await writeFile(baselinePath, JSON.stringify({ schemaVersion: 1, gameId: 'demo', sourcePath: 'original', scannerStatus: 'reviewed' }));
    const reviewed = JSON.parse(run(root, '--json').stdout);
    assert.equal(reviewed.checks.scanner.status, 'passed');
    assert.equal(reviewed.checks.coverage.status, 'incomplete');
    assert.equal(reviewed.complete, false);
    assert.equal(run(root, '--require-complete').status, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('research audit passes when all configured gates have evidence and coverage is complete', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'research-audit-complete-'));
  try {
    await mkdir(path.join(root, 'raw', 'scanner'), { recursive: true });
    await mkdir(path.join(root, 'production'), { recursive: true });
    for (const file of ['inventory.json', 'engine-profile.json', 'tool-recommendations.json', 'report.md']) {
      await writeFile(path.join(root, 'raw', 'scanner', file), '{}');
    }
    await writeFile(path.join(root, 'baseline.json'), JSON.stringify({ schemaVersion: 1, gameId: 'demo', scannerStatus: 'reviewed' }));
    await writeFile(path.join(root, 'production', 'verification-plan.json'), JSON.stringify({ schemaVersion: 1,
      requirements: { scanner: true, coverage: true, functionIndex: false, dataInventory: false, traceComparison: false } }));
    const coverage = 'id,domain,item,scope,source_ref,evidence_kind,evidence_ref,extracted_output,target_path,reverse_status,implementation_status,verification_status,blocker,notes\n' +
      'move,mechanic,player movement,offline-required,src/Player.cs:1,static,src/Player.cs:1,raw/move.json,src/move.js,understood,implemented,passed,,\n';
    await writeFile(path.join(root, 'production', 'coverage.csv'), coverage);
    const result = run(root, '--json', '--require-complete');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).complete, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('research audit enforces function, data and original-vs-HTML trace gates when configured', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'research-audit-all-gates-'));
  try {
    await mkdir(path.join(root, 'raw', 'scanner'), { recursive: true });
    await mkdir(path.join(root, 'production', 'traces'), { recursive: true });
    for (const file of ['inventory.json', 'engine-profile.json', 'tool-recommendations.json', 'report.md']) {
      await writeFile(path.join(root, 'raw', 'scanner', file), '{}');
    }
    await writeFile(path.join(root, 'baseline.json'), JSON.stringify({ schemaVersion: 1, gameId: 'demo', scannerStatus: 'reviewed' }));
    await writeFile(path.join(root, 'production', 'verification-plan.json'), JSON.stringify({ schemaVersion: 1,
      requirements: { scanner: true, coverage: true, functionIndex: true, dataInventory: true, traceComparison: true } }));
    const coverage = 'id,domain,item,scope,source_ref,evidence_kind,evidence_ref,extracted_output,target_path,reverse_status,implementation_status,verification_status,blocker,notes\n' +
      'move,mechanic,player movement,offline-required,src/Player.cs:1,static,src/Player.cs:1,raw/move.json,src/move.js,understood,implemented,passed,,\n';
    await writeFile(path.join(root, 'production', 'coverage.csv'), coverage);
    await writeFile(path.join(root, 'production', 'function-index.json'), JSON.stringify({ schemaVersion: 1,
      entryPoints: ['entry'], functions: [{ id: 'entry', name: 'Entry', sourceRef: 'src/main.cs:1' }], calls: [] }));
    await writeFile(path.join(root, 'production', 'data-inventory.json'), JSON.stringify({ schemaVersion: 1,
      schemaApplied: true, truncated: false, tableCount: 1, totalRecords: 2, duplicateIdCount: 0,
      unresolvedReferenceCount: 0, errors: [], warnings: [] }));
    await writeFile(path.join(root, 'production', 'trace-map.json'), JSON.stringify({ schemaVersion: 1,
      keyFields: [{ expected: 'tick', actual: 'tick' }, { expected: 'actorId', actual: 'actorId' }, { expected: 'type', actual: 'type' }],
      compareFields: [{ expected: 'position.x', actual: 'position.x', tolerance: 0.01 }] }));
    const header = build => ({ _type: 'trace', schemaVersion: 1, gameId: 'demo', scenarioId: 'move-1', build, tickHz: 60 });
    const event = x => ({ _type: 'event', tick: 1, actorId: 'p1', type: 'move', position: { x } });
    await writeFile(path.join(root, 'production', 'traces', 'original.jsonl'), [header('original'), event(1)].map(JSON.stringify).join('\n') + '\n');
    const htmlPath = path.join(root, 'production', 'traces', 'html.jsonl');
    await writeFile(htmlPath, [header('html'), event(1.005)].map(JSON.stringify).join('\n') + '\n');
    const passing = run(root, '--json', '--require-complete');
    assert.equal(passing.status, 0, passing.stderr);
    assert.equal(JSON.parse(passing.stdout).complete, true);
    await writeFile(htmlPath, [header('html'), event(2)].map(JSON.stringify).join('\n') + '\n');
    const diverged = run(root, '--json', '--require-complete');
    assert.equal(diverged.status, 1);
    assert.equal(JSON.parse(diverged.stdout).checks.traceComparison.status, 'failed');
  } finally { await rm(root, { recursive: true, force: true }); }
});
