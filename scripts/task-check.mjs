#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { run } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolveWebAssetGame, verifyWebAssetSource } from './playtest.mjs';

const exec = promisify(execFile);
const playtest = fileURLToPath(new URL('./playtest.mjs', import.meta.url));
const snapshotScript = fileURLToPath(new URL('./snapshot.mjs', import.meta.url));
const doctorScript = fileURLToPath(new URL('./doctor-playability.mjs', import.meta.url));
const acceptScript = fileURLToPath(new URL('./accept.mjs', import.meta.url));
const localCheckUi = fileURLToPath(new URL('./check-ui.mjs', import.meta.url));
const skillCheckUi = fileURLToPath(new URL('../.agents/skills/hgame-ui-ux/scripts/check-ui.mjs', import.meta.url));
const checkUiScript = existsSync(localCheckUi) ? localCheckUi : skillCheckUi;
const timeout = 120_000;
const browserOptions = {
  selector: '--selector', query: '--query', viewport: '--viewport',
  stateHook: '--state-hook', traceHook: '--trace-hook', maxLongFrames: '--max-long-frames',
};

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function nonempty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be nonempty text`);
  return value.trim();
}

function optionText(value, label) {
  const text = nonempty(value, label);
  if (text.startsWith('--')) throw new Error(`${label} cannot be a CLI flag`);
  return text;
}

function localModule(value, label) {
  const file = nonempty(value, label);
  const relative = path.relative(process.cwd(), path.resolve(file));
  if (path.isAbsolute(file) || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`) ||
      !/\.[cm]?js$/i.test(file)) throw new Error(`${label} must name a JavaScript file inside the project`);
  return relative;
}

function parsePlaytest(value, id) {
  const spec = record(value, `playtests.${id}`);
  for (const key of Object.keys(spec)) {
    if (!['scenario', 'ready', 'allowStatic', 'checkUi', 'checkLayout', 'timeoutMs'].includes(key) && !Object.hasOwn(browserOptions, key)) {
      throw new Error(`${id}: unknown option ${key}`);
    }
  }
  const scenario = localModule(spec.scenario, `${id}: scenario`);
  const args = ['--ready', optionText(spec.ready, `${id}: ready`)];
  for (const [option, flag] of Object.entries(browserOptions)) {
    if (!Object.hasOwn(spec, option)) continue;
    const value = spec[option];
    if (option === 'maxLongFrames') {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${id}: ${option} must be a nonnegative integer`);
      args.push(flag, String(value));
    } else {
      args.push(flag, optionText(value, `${id}: ${option}`));
    }
  }
  for (const [boolOpt, flag] of [['allowStatic', '--allow-static'], ['checkUi', '--check-ui'], ['checkLayout', '--check-layout']]) {
    if (Object.hasOwn(spec, boolOpt) && typeof spec[boolOpt] !== 'boolean') throw new Error(`${id}: ${boolOpt} must be boolean`);
    if (spec[boolOpt]) args.push(flag);
  }
  const timeoutMs = Object.hasOwn(spec, 'timeoutMs') ? spec.timeoutMs : timeout;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new Error(`${id}: timeoutMs must be a positive timer interval in milliseconds`);
  }
  return { scenario, args, timeoutMs };
}

function parseSnapshotCheck(entry, key) {
  const args = ['.'];
  if (Object.hasOwn(entry, 'viewport')) args.push('--viewport', optionText(entry.viewport, `${key}: viewport`));
  if (Object.hasOwn(entry, 'ready')) args.push('--ready', optionText(entry.ready, `${key}: ready`));
  if (Object.hasOwn(entry, 'selector')) args.push('--selector', optionText(entry.selector, `${key}: selector`));
  if (Object.hasOwn(entry, 'keys')) args.push('--keys', optionText(entry.keys, `${key}: keys`));
  if (Object.hasOwn(entry, 'query')) args.push('--query', optionText(entry.query, `${key}: query`));
  if (Object.hasOwn(entry, 'out')) args.push('--out', optionText(entry.out, `${key}: out`));
  if (Object.hasOwn(entry, 'steps')) {
    if (!Number.isSafeInteger(entry.steps) || entry.steps < 1) throw new Error(`${key}: steps must be a positive integer`);
    args.push('--steps', String(entry.steps));
  }
  if (Object.hasOwn(entry, 'wait')) {
    if (!Number.isSafeInteger(entry.wait) || entry.wait < 0) throw new Error(`${key}: wait must be a nonnegative integer`);
    args.push('--wait', String(entry.wait));
  }
  if (entry.checkUi !== false) args.push('--check-ui');
  if (entry.checkLayout) args.push('--check-layout');
  return { type: 'snapshot', args };
}

function parseTask(value) {
  const { schemaVersion, task, requirements, playtests = {} } = record(value, 'Task');
  if (schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  const taskText = nonempty(task, 'task');
  if (!Array.isArray(requirements) || !requirements.length) throw new Error('requirements must be a nonempty array');
  record(playtests, 'playtests');

  const ids = new Set();
  const browserRuns = new Map();
  const items = requirements.map(entry => {
    const { id, expected, checks } = record(entry, 'Requirement');
    const key = nonempty(id, 'Requirement id');
    if (ids.has(key)) throw new Error(`Duplicate requirement ${key}`);
    ids.add(key);
    if (!Array.isArray(checks) || !checks.length) throw new Error(`${key}: checks must be a nonempty array`);
    return { id: key, expected: nonempty(expected, `${key}: expected`), checks: checks.map(entry => {
      const checkSpec = record(entry, `${key}: check`);
      const { type, file, name, run: browserRun, checkpoint, inspect } = checkSpec;
      switch (type) {
        case 'test':
          return { type, file: localModule(file, `${key}: file`), name: nonempty(name, `${key}: name`) };
        case 'playtest': {
          const runId = nonempty(browserRun, `${key}: run`);
          if (!Object.hasOwn(playtests, runId)) throw new Error(`${key}: unknown playtest ${runId}`);
          if (!browserRuns.has(runId)) browserRuns.set(runId, parsePlaytest(playtests[runId], runId));
          return { type, run: runId, checkpoint: nonempty(checkpoint, `${key}: checkpoint`) };
        }
        case 'ui':
          return { type };
        case 'snapshot':
          return parseSnapshotCheck(checkSpec, key);
        case 'doctor':
          return {
            type,
            ready: Object.hasOwn(checkSpec, 'ready') ? optionText(checkSpec.ready, `${key}: ready`) : '#game[data-engine-ready=true]',
          };
        case 'accept':
          return {
            type,
            quick: Boolean(checkSpec.quick),
            strict: Boolean(checkSpec.strict),
            webasset: Boolean(checkSpec.webasset),
          };
        case 'review':
          return { type, inspect: nonempty(inspect, `${key}: inspect`) };
        default:
          throw new Error(`${key}: check type must be test, playtest, ui, snapshot, doctor, accept, or review`);
      }
    }) };
  });
  return { task: taskText, requirements: items, browserRuns };
}

async function existingModule(file) {
  const resolved = await realpath(file);
  const relative = path.relative(await realpath('.'), resolved);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`) || !(await stat(resolved)).isFile()) {
    throw new Error(`Expected a file inside the project: ${file}`);
  }
  return resolved;
}

async function runTests(files) {
  const results = new Map();
  for (const file of files) {
    try {
      const resolved = await existingModule(file);
      const events = [];
      const failures = [];
      for await (const { type, data } of run({ files: [resolved], timeout })) {
        if (type !== 'test:pass' && type !== 'test:fail') continue;
        if (type === 'test:fail' && !data.todo) failures.push(data.details.error?.message ?? data.name);
        if (data.file !== resolved || data.details.type !== 'test' || (data.line === 1 && data.name === resolved)) continue;
        events.push({ name: data.name, status: data.skip || data.todo ? 'pending' : type === 'test:pass' ? 'passed' : 'failed' });
      }
      results.set(file, { events, failures });
    } catch (error) {
      results.set(file, { events: [], unavailable: error.message });
    }
  }
  return results;
}

async function runBrowser(spec) {
  try {
    const config = JSON.parse(await readFile('game.config.json', 'utf8'));
    const id = path.basename(process.cwd());
    if (config.id !== id || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)) {
      throw new Error('WebAsset requires game.config.json id to match the project directory');
    }
    const scenario = await existingModule(spec.scenario);
    const url = await resolveWebAssetGame(id);
    await verifyWebAssetSource(new URL(`/local-games/${id}/`, url), process.cwd());
    const command = [playtest, id, '--webasset', '--scenario', scenario, ...spec.args];
    let exitCode = 0;
    let output;
    try {
      ({ stdout: output } = await exec(process.execPath, command, {
        timeout: spec.timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
      }));
    } catch (error) {
      if (error.code !== 1 || !error.stdout) throw new Error(error.stderr?.trim() || error.message);
      exitCode = error.code;
      output = error.stdout;
    }
    const report = record(JSON.parse(output), 'Playtest report');
    if (typeof report.ok !== 'boolean' || (report.checkpoints !== undefined && !Array.isArray(report.checkpoints))) {
      throw new Error('Invalid playtest report');
    }
    return { exitCode, sourceVerified: true, report };
  } catch (error) {
    return { unavailable: error.message };
  }
}

async function runJsonTool(scriptPath, args, timeoutMs = timeout) {
  let exitCode = 0;
  let output;
  try {
    ({ stdout: output } = await exec(process.execPath, [scriptPath, ...args], {
      timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    }));
  } catch (error) {
    if (error.code !== 1 || !error.stdout) {
      return { status: 'failed', message: error.stderr?.trim() || error.message };
    }
    exitCode = error.code;
    output = error.stdout;
  }
  try {
    const report = record(JSON.parse(output), 'Tool report');
    const ok = exitCode === 0 && (report.ok === true || report.pass === true);
    const detail = report.problems?.join('; ') || report.violations?.map(v => `${v.file}:${v.line} ${v.rule}`).slice(0, 3).join('; ') || undefined;
    return { status: ok ? 'passed' : 'failed', message: ok ? undefined : (detail || 'Check failed'), report };
  } catch (error) {
    return { status: 'failed', message: `Invalid JSON output: ${error.message}` };
  }
}

async function runToolChecks(requirements) {
  const toolResults = new Map();
  for (const item of requirements) {
    for (const check of item.checks) {
      if (!['ui', 'snapshot', 'doctor', 'accept'].includes(check.type)) continue;
      const cacheKey = JSON.stringify(check);
      if (toolResults.has(cacheKey)) continue;
      if (check.type === 'ui') {
        toolResults.set(cacheKey, await runJsonTool(checkUiScript, ['--dir', '.']));
      } else if (check.type === 'snapshot') {
        toolResults.set(cacheKey, await runJsonTool(snapshotScript, check.args));
      } else if (check.type === 'doctor') {
        toolResults.set(cacheKey, await runJsonTool(doctorScript, ['.', '--ready', check.ready, '--json']));
      } else if (check.type === 'accept') {
        const args = ['.', '--json'];
        if (check.quick) args.push('--quick');
        if (check.strict) args.push('--strict');
        if (check.webasset) args.push('--webasset');
        toolResults.set(cacheKey, await runJsonTool(acceptScript, args, 240_000));
      }
    }
  }
  return toolResults;
}

function matchNamed(items, name) {
  const matches = items.filter(item => item.name === name);
  if (matches.length !== 1) {
    return { status: 'pending', message: matches.length ? 'Name is ambiguous' : 'Named check did not run' };
  }
  return matches[0];
}

function summarize(items) {
  if (items.some(item => item.status === 'failed')) return 'failed';
  if (items.some(item => item.status !== 'passed')) return 'pending';
  return 'passed';
}

function evaluate(check, tests, browsers, tools) {
  if (check.type === 'review') return { ...check, status: 'review-required' };
  if (check.type === 'test') {
    const result = tests.get(check.file);
    if (result.unavailable) return { ...check, status: 'pending', message: result.unavailable };
    const match = matchNamed(result.events, check.name);
    const status = result.failures.length ? 'failed' : match.status;
    return { ...check, status, message: match.message };
  }
  if (['ui', 'snapshot', 'doctor', 'accept'].includes(check.type)) {
    const res = tools.get(JSON.stringify(check));
    return { ...check, status: res?.status ?? 'pending', ...(res?.message ? { message: res.message } : {}) };
  }
  const result = browsers.get(check.run);
  if (result.unavailable) return { ...check, status: 'pending', message: result.unavailable };
  const report = result.report;
  const checkpoints = (report.checkpoints ?? []).map(item => ({
    name: item.name, status: item.ok === true ? 'passed' : 'failed', message: item.message,
  }));
  const match = matchNamed(checkpoints, check.checkpoint);
  const status = result.exitCode !== 0 || report.ok !== true ? 'failed' : match.status;
  return { ...check, status, message: match.message };
}

async function main(argv) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('Usage: task-check <task.json> (run from the project root)');
    return;
  }
  if (argv.length !== 1 || argv[0].startsWith('--')) throw new Error('Expected a task JSON file. See --help.');
  const input = await readFile(argv[0], 'utf8');
  const task = parseTask(JSON.parse(input.replace(/^\uFEFF/, '')));
  const files = new Set(task.requirements.flatMap(item => item.checks.filter(check => check.type === 'test').map(check => check.file)));
  const tests = await runTests(files);
  const browsers = new Map();
  for (const [id, spec] of task.browserRuns) browsers.set(id, await runBrowser(spec));
  const tools = await runToolChecks(task.requirements);
  const requirements = task.requirements.map(item => {
    const checks = item.checks.map(check => evaluate(check, tests, browsers, tools));
    return { ...item, checks, status: summarize(checks) };
  });
  const status = summarize(requirements);
  console.log(JSON.stringify({ status, task: task.task, manifest: path.resolve(argv[0]),
    manifestSha256: createHash('sha256').update(input).digest('hex'), project: process.cwd(),
    checkedAt: new Date().toISOString(), requirements, tests: Object.fromEntries(tests), playtests: Object.fromEntries(browsers),
  }, null, 2));
  process.exitCode = status === 'passed' ? 0 : 1;
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.log(JSON.stringify({ status: 'invalid', message: error.message }, null, 2));
  process.exitCode = 2;
}
