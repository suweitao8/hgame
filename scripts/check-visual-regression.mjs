#!/usr/bin/env node
// Render an explicitly accepted Git revision and the working tree in the same browser environment.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const snapshot = path.join(root, 'scripts/snapshot.mjs');

export function validateVisualReference(config) {
  if (config?.schemaVersion !== 1) throw new Error('Visual reference schemaVersion must be 1.');
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(config.revision ?? '')) {
    throw new Error('Visual reference revision must be an explicitly accepted full Git commit hash.');
  }
  if (!/^[1-9]\d*x[1-9]\d*$/.test(config.viewport ?? '')) throw new Error('Invalid visual reference viewport.');
  if (!Array.isArray(config.scenarios) || !config.scenarios.length) throw new Error('Visual reference scenarios are required.');
  const ids = new Set();
  for (const scenario of config.scenarios) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(scenario?.id ?? '')) throw new Error('Invalid visual scenario id.');
    if (ids.has(scenario.id)) throw new Error(`Duplicate visual scenario ${scenario.id}.`);
    ids.add(scenario.id);
    if (!Number.isSafeInteger(scenario.steps) || scenario.steps < 0) throw new Error('Visual scenario steps must be nonnegative integers.');
    if (!Number.isFinite(scenario.threshold) || scenario.threshold < 0 || scenario.threshold > 1) throw new Error('Visual scenario threshold must be between 0 and 1.');
    if (typeof scenario.keys !== 'string' || typeof scenario.query !== 'string') throw new Error('Visual scenario keys and query must be strings.');
  }
  return config;
}

export function resolveReferenceRevision(repository, revision) {
  if (typeof revision !== 'string' || !revision || revision.startsWith('-') || revision.trim() !== revision) {
    throw new Error('Invalid visual reference revision.');
  }
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`],
      { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    throw new Error(`Visual reference revision ${revision} is unavailable. Fetch the accepted commit before running this check.`);
  }
}

function capture(args) {
  const result = spawnSync(process.execPath, [snapshot, ...args], {
    encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  });
  if (result.error) return { ok: false, problems: [result.error.message] };
  try {
    const report = JSON.parse(result.stdout);
    return { ...report, ok: result.status === 0 && report.ok === true, exitCode: result.status };
  } catch {
    return { ok: false, problems: [result.stderr || result.stdout || `Snapshot exited ${result.status} without a report.`] };
  }
}

export function compareVisualScenarios({ referenceRoot, candidateRoot, outDir, viewport, scenarios, chrome = '' }) {
  mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const scenario of scenarios) {
    const referencePng = path.join(outDir, `${scenario.id}.reference.png`);
    const candidatePng = path.join(outDir, `${scenario.id}.candidate.png`);
    const common = ['--ready', '#game[data-engine-ready=true]', '--visual-ready', '#game:not([data-visual-loading])',
      '--freeze-time', '--steps', String(scenario.steps),
      '--viewport', viewport, '--keys', scenario.keys, '--query', scenario.query];
    if (chrome) common.push('--chrome', chrome);
    const reference = capture([path.join(referenceRoot, 'examples', scenario.id), ...common, '--out', referencePng]);
    const candidate = reference.ok ? capture([path.join(candidateRoot, 'examples', scenario.id), ...common,
      '--out', candidatePng, '--baseline', referencePng, '--threshold', String(scenario.threshold)]) : null;
    results.push({ id: scenario.id, ok: reference.ok && candidate?.ok === true, reference, candidate });
  }
  return results;
}

function buildExamples(repository, scenarios) {
  execFileSync(process.execPath, [path.join(repository, 'scripts/build-examples.mjs'), ...scenarios.map(s => s.id)],
    { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

async function main() {
  let temporary;
  let outDir;
  const report = { ok: false, problems: [] };
  try {
    const { values } = parseArgs({ options: {
      manifest: { type: 'string' }, reference: { type: 'string' },
      'out-dir': { type: 'string' }, chrome: { type: 'string' }, help: { type: 'boolean' },
    } });
    if (values.help) {
      console.log('Usage: check-visual-regression.mjs [--reference <accepted-commit>] [--manifest <json>] [--out-dir <dir>] [--chrome <path>]');
      return;
    }
    const config = validateVisualReference(JSON.parse(readFileSync(values.manifest ?? path.join(root, 'tests/visual-reference.json'), 'utf8')));
    const revision = resolveReferenceRevision(root, values.reference ?? config.revision);
    outDir = path.resolve(values['out-dir'] ?? path.join(root, 'build/visual-regression'));
    mkdirSync(outDir, { recursive: true });
    Object.assign(report, { revision, viewport: config.viewport });
    temporary = mkdtempSync(path.join(os.tmpdir(), 'hgame-visual-reference-'));
    const archive = path.join(temporary, 'reference.tar');
    const referenceRoot = path.join(temporary, 'source');
    mkdirSync(referenceRoot);
    execFileSync('git', ['archive', '--format=tar', '--output', archive, revision], { cwd: root, windowsHide: true });
    execFileSync('tar', ['-xf', archive, '-C', referenceRoot], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    buildExamples(referenceRoot, config.scenarios);
    buildExamples(root, config.scenarios);
    report.scenarios = compareVisualScenarios({ referenceRoot, candidateRoot: root, outDir,
      viewport: config.viewport, scenarios: config.scenarios, chrome: values.chrome ?? '' });
    report.ok = report.scenarios.every(scenario => scenario.ok);
    if (!report.ok) report.problems.push('Visual reference comparison failed. Inspect reference/candidate PNGs and scenario reports.');
  } catch (error) {
    report.problems.push(String(error.message || error));
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  if (outDir) writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
