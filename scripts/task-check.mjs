#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { run } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolveWebAssetGame, verifyWebAssetSource } from './playtest.mjs';

const exec = promisify(execFile);
const playtest = fileURLToPath(new URL('./playtest.mjs', import.meta.url));
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
    if (!['scenario', 'ready', 'allowStatic', 'timeoutMs'].includes(key) && !Object.hasOwn(browserOptions, key)) {
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
  if (Object.hasOwn(spec, 'allowStatic') && typeof spec.allowStatic !== 'boolean') throw new Error(`${id}: allowStatic must be boolean`);
  if (spec.allowStatic) args.push('--allow-static');
  const timeoutMs = Object.hasOwn(spec, 'timeoutMs') ? spec.timeoutMs : timeout;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new Error(`${id}: timeoutMs must be a positive timer interval in milliseconds`);
  }
  return { scenario, args, timeoutMs };
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
      const { type, file, name, run: browserRun, checkpoint, inspect } = record(entry, `${key}: check`);
      switch (type) {
        case 'test':
          return { type, file: localModule(file, `${key}: file`), name: nonempty(name, `${key}: name`) };
        case 'playtest': {
          const runId = nonempty(browserRun, `${key}: run`);
          if (!Object.hasOwn(playtests, runId)) throw new Error(`${key}: unknown playtest ${runId}`);
          if (!browserRuns.has(runId)) browserRuns.set(runId, parsePlaytest(playtests[runId], runId));
          return { type, run: runId, checkpoint: nonempty(checkpoint, `${key}: checkpoint`) };
        }
        case 'review':
          return { type, inspect: nonempty(inspect, `${key}: inspect`) };
        default:
          throw new Error(`${key}: check type must be test, playtest, or review`);
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

function evaluate(check, tests, browsers) {
  if (check.type === 'review') return { ...check, status: 'review-required' };
  if (check.type === 'test') {
    const result = tests.get(check.file);
    if (result.unavailable) return { ...check, status: 'pending', message: result.unavailable };
    const match = matchNamed(result.events, check.name);
    const status = result.failures.length ? 'failed' : match.status;
    return { ...check, status, message: match.message };
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
  const requirements = task.requirements.map(item => {
    const checks = item.checks.map(check => evaluate(check, tests, browsers));
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
