import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = path.join(root, 'scripts', 'start-research.mjs');
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });

test('evidence pipeline tools, templates and docs are installed as one LeanRea capability', async () => {
  for (const file of [
    'scripts/analyze-data-tables.mjs', 'scripts/audit-function-index.mjs', 'scripts/compare-game-traces.mjs',
    'scripts/merge-function-index.mjs', 'scripts/export-ghidra-function-index.ps1',
    'scripts/audit-research.mjs', 'assets/verification-plan.template.json',
    'tools/ghidra/ExportGameFunctionIndex.java',
    'assets/function-index.template.json', 'assets/data-schema.template.json', 'assets/trace-map.template.json',
    'assets/game-trace.template.jsonl', 'assets/game-trace-recorder.template.mjs', 'references/evidence-pipeline.md',
  ]) assert.equal(existsSync(path.join(root, file)), true, 'missing ' + file);
  const skill = await readFile(path.join(root, 'SKILL.md'), 'utf8');
  const docs = await readFile(path.join(root, 'references', 'portable-workflow.md'), 'utf8');
  assert.match(skill, /逆向证据闭环/);
  assert.match(skill, /audit-function-index\.mjs/);
  assert.match(skill, /export-ghidra-function-index\.ps1/);
  assert.match(skill, /audit-research\.mjs/);
  assert.match(docs, /analyze-data-tables\.mjs/);
  assert.match(docs, /compare-game-traces\.mjs/);
});

test('new research bootstrap creates function, data and trace contracts without claiming extracted evidence', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'leanrea-evidence-bootstrap-'));
  const source = path.join(temp, 'original');
  const output = path.join(temp, 'research');
  try {
    await mkdir(source);
    const result = run(source, '--out', output, '--game-id', 'demo');
    assert.equal(result.status, 0, result.stderr);
    for (const file of [
      'raw/extracted-data', 'production/function-index.json', 'production/data-schema.json',
      'production/trace-map.json', 'production/verification-plan.json',
      'production/trace-recorder.template.mjs', 'production/traces',
    ]) assert.equal(existsSync(path.join(output, file)), true, 'missing bootstrap output ' + file);
    const index = JSON.parse(await readFile(path.join(output, 'production', 'function-index.json'), 'utf8'));
    assert.deepEqual(index.functions, []);
    const baseline = JSON.parse(await readFile(path.join(output, 'baseline.json'), 'utf8'));
    assert.equal(baseline.functionIndex, 'production/function-index.json');
    assert.equal(baseline.verificationPlan, 'production/verification-plan.json');
    const readme = await readFile(path.join(output, 'README.md'), 'utf8');
    assert.match(readme, /data-inventory\.json/);
    assert.match(readme, /compare-game-traces\.mjs/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
