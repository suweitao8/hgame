#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = fileURLToPath(new URL('../', import.meta.url));
const scripts = path.join(skillRoot, 'scripts');
const DEFAULT_PLAN = Object.freeze({ scanner: true, coverage: true, functionIndex: false, dataInventory: false, traceComparison: false });

function parseArgs(argv) {
  const o = { root: null, json: false, requireComplete: false };
  for (const arg of argv) {
    if (arg === '--json') o.json = true;
    else if (arg === '--require-complete') o.requireComplete = true;
    else if (!arg.startsWith('-') && !o.root) o.root = arg;
    else throw new Error('Unknown or incomplete argument: ' + arg);
  }
  if (!o.root) throw new Error('Usage: node audit-research.mjs <research-root> [--json] [--require-complete]');
  return o;
}
async function exists(file) { try { await stat(file); return true; } catch { return false; } }
function runJson(script, args) {
  const result = spawnSync(process.execPath, [path.join(scripts, script), ...args, '--json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  let parsed = null;
  try { parsed = JSON.parse((result.stdout || '').replace(/^\uFEFF/, '')); } catch {}
  return { code: result.status ?? 2, result: parsed, stderr: result.stderr || '' };
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = path.resolve(options.root);
  const baselinePath = path.join(root, 'baseline.json');
  if (!(await exists(baselinePath))) throw new Error('Missing baseline.json: ' + baselinePath);
  const baseline = JSON.parse((await readFile(baselinePath, 'utf8')).replace(/^\uFEFF/, ''));
  const planPath = path.join(root, 'production', 'verification-plan.json');
  const plan = await exists(planPath)
    ? JSON.parse((await readFile(planPath, 'utf8')).replace(/^\uFEFF/, '')).requirements
    : DEFAULT_PLAN;
  if (!plan || Object.keys(DEFAULT_PLAN).some(key => typeof plan[key] !== 'boolean')) {
    throw new Error('verification-plan.json must define boolean requirements: ' + Object.keys(DEFAULT_PLAN).join(', '));
  }

  const checks = {};
  const scannerFiles = ['inventory.json', 'engine-profile.json', 'tool-recommendations.json', 'report.md'];
  const scannerMissing = [];
  for (const name of scannerFiles) if (!(await exists(path.join(root, 'raw', 'scanner', name)))) scannerMissing.push(name);
  checks.scanner = { status: scannerMissing.length ? 'missing' : baseline.scannerStatus === 'reviewed' ? 'passed' : 'incomplete',
    scannerStatus: baseline.scannerStatus || 'unreviewed', missing: scannerMissing,
    note: 'Scanner files must exist and the engine/version candidate must be cross-checked against independent evidence; set baseline.scannerStatus to reviewed only after that review.' };

  const coveragePath = path.join(root, 'production', 'coverage.csv');
  if (await exists(coveragePath)) {
    const coverage = runJson('audit-coverage.mjs', [coveragePath]);
    checks.coverage = coverage.result
      ? { status: coverage.result.errors?.length ? 'failed' : coverage.result.complete ? 'passed' : 'incomplete', ...coverage.result }
      : { status: 'failed', error: coverage.stderr || 'Coverage audit returned invalid JSON' };
  } else checks.coverage = { status: 'missing' };

  const functionPath = path.join(root, 'production', 'function-index.json');
  if (await exists(functionPath)) {
    const audit = runJson('audit-function-index.mjs', [functionPath]);
    const result = audit.result;
    checks.functionIndex = result ? {
      status: result.errors?.length || result.unresolvedEdges?.length || result.unanchoredConfirmedEdges?.length ? 'failed'
        : result.functionCount > 0 && result.entryPoints?.length > 0 && result.reachableFunctionCount > 0 ? 'passed' : 'incomplete',
      functionCount: result.functionCount, externalFunctionCount: result.externalFunctionCount,
      callEdgeCount: result.callEdgeCount, entryPoints: result.entryPoints,
      reachableFunctionCount: result.reachableFunctionCount,
      unresolvedEdges: result.unresolvedEdges?.length || 0,
      unanchoredConfirmedEdges: result.unanchoredConfirmedEdges?.length || 0,
      warnings: result.warnings || [], errors: result.errors || [],
    } : { status: 'failed', error: audit.stderr || 'Function index audit returned invalid JSON' };
  } else checks.functionIndex = { status: 'missing' };

  const inventoryPath = path.join(root, 'production', 'data-inventory.json');
  if (await exists(inventoryPath)) {
    const inventory = JSON.parse((await readFile(inventoryPath, 'utf8')).replace(/^\uFEFF/, ''));
    checks.dataInventory = { status: inventory.schemaApplied && !inventory.truncated && !inventory.errors?.length &&
      !inventory.duplicateIdCount && !inventory.unresolvedReferenceCount ? 'passed' : 'incomplete',
      tableCount: inventory.tableCount, totalRecords: inventory.totalRecords,
      duplicateIdCount: inventory.duplicateIdCount, unresolvedReferenceCount: inventory.unresolvedReferenceCount,
      schemaApplied: inventory.schemaApplied, truncated: inventory.truncated,
      errors: inventory.errors || [], warnings: inventory.warnings || [] };
  } else checks.dataInventory = { status: 'missing' };

  const originalTrace = path.join(root, 'production', 'traces', 'original.jsonl');
  const htmlTrace = path.join(root, 'production', 'traces', 'html.jsonl');
  const traceMap = path.join(root, 'production', 'trace-map.json');
  if ((await exists(originalTrace)) && (await exists(htmlTrace)) && (await exists(traceMap))) {
    const comparison = runJson('compare-game-traces.mjs', [originalTrace, htmlTrace, '--map', traceMap]);
    checks.traceComparison = comparison.result ? {
      status: comparison.result.match ? 'passed' : 'failed',
      expectedEvents: comparison.result.expectedEvents, actualEvents: comparison.result.actualEvents,
      missingEvents: comparison.result.missingEvents, extraEvents: comparison.result.extraEvents,
      fieldMismatches: comparison.result.fieldMismatches, firstDivergence: comparison.result.firstDivergence,
    } : { status: 'failed', error: comparison.stderr || 'Trace comparison returned invalid JSON' };
  } else checks.traceComparison = { status: 'not-run', missing: [
    ...(await exists(originalTrace) ? [] : ['original.jsonl']),
    ...(await exists(htmlTrace) ? [] : ['html.jsonl']),
    ...(await exists(traceMap) ? [] : ['trace-map.json']),
  ] };

  const required = Object.keys(DEFAULT_PLAN).filter(key => plan[key]);
  const failedRequired = required.filter(key => checks[key].status !== 'passed');
  const report = { schemaVersion: 1, gameId: baseline.gameId || null, researchRoot: root,
    sourcePath: baseline.sourcePath || null, requirements: plan, checks,
    requiredChecks: required, failedRequired, complete: failedRequired.length === 0,
    conclusion: failedRequired.length === 0
      ? 'All configured research gates passed; this does not prove every hidden original mechanic was discovered.'
      : 'Research is not complete for the configured gates. Review failed/incomplete checks and unknown scope.' };
  console.log(options.json ? JSON.stringify(report, null, 2) : [
    'Research: ' + (report.gameId || root),
    ...Object.entries(checks).map(([name, check]) => name + ': ' + check.status + (plan[name] ? ' [required]' : '')),
    'Required gates: ' + required.length + ' | failed: ' + failedRequired.length,
    'Overall: ' + (report.complete ? 'configured gates passed' : 'in progress'),
    report.conclusion,
  ].join('\n'));
  if (options.requireComplete && !report.complete) process.exitCode = 1;
}
main().catch(error => { console.error('Research audit failed: ' + error.message); process.exitCode = 2; });
