#!/usr/bin/env node
// Batch self-test & acceptance scanner across HGame examples or downstream projects in gamesRootDir.
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAcceptForProject } from './accept.mjs';
import { resolveGamesRoot } from './lib/engine-sync.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const opts = {
    mode: 'quick', // 'quick' | 'full' | 'verify-fresh'
    examples: false,
    root: '',
    games: [],
    requireAutoplay: false,
    webasset: false,
    skipWebasset: false,
    strict: false,
    chrome: '',
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--quick') opts.mode = 'quick';
    else if (a === '--full') opts.mode = 'full';
    else if (a === '--verify-fresh') opts.mode = 'verify-fresh';
    else if (a === '--examples') opts.examples = true;
    else if (a === '--root') opts.root = argv[++i] ?? '';
    else if (a === '--game') opts.games.push(argv[++i] ?? '');
    else if (a === '--require-autoplay') opts.requireAutoplay = true;
    else if (a === '--webasset') opts.webasset = true;
    else if (a === '--skip-webasset') opts.skipWebasset = true;
    else if (a === '--strict') opts.strict = true;
    else if (a === '--chrome') opts.chrome = argv[++i] ?? '';
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

async function discoverDirs(opts) {
  if (opts.examples) {
    const exRoot = path.join(repoRoot, 'examples');
    const entries = await readdir(exRoot, { withFileTypes: true }).catch(() => []);
    return entries
      .filter(e => e.isDirectory() && existsSync(path.join(exRoot, e.name, 'engine.config.json')))
      .map(e => ({ id: e.name, dir: path.join(exRoot, e.name) }));
  }

  const rootDir = opts.root ? path.resolve(opts.root) : await resolveGamesRoot(repoRoot);
  if (!rootDir || !existsSync(rootDir)) {
    throw new Error('No downstream games root resolved (pass --root <dir> or configure .hgame.local.json gamesRootDir)');
  }
  const entries = await readdir(rootDir, { withFileTypes: true });
  const wanted = new Set(opts.games.filter(Boolean));
  return entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .filter(e => wanted.size === 0 || wanted.has(e.name))
    .map(e => ({ id: e.name, dir: path.join(rootDir, e.name) }))
    .filter(({ dir }) => existsSync(path.join(dir, 'engine.config.json')) || existsSync(path.join(dir, 'game.config.json')))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function summarizeReport(id, dir, report, mode) {
  if (mode === 'verify-fresh') {
    return {
      id,
      dir,
      ok: Boolean(report.ok),
      status: report.ok ? 'FRESH' : 'STALE',
      checkedAt: report.checkedAt ?? null,
      problems: report.problems ?? [],
    };
  }
  const gates = report.gates ?? {};
  return {
    id: report.gameId || id,
    dir,
    ok: Boolean(report.ok),
    accepted: Boolean(report.accepted),
    status: report.accepted ? 'ACCEPTED' : report.ok ? 'QUICK-OK' : 'REJECTED',
    gates: Object.fromEntries(Object.entries(gates).map(([k, v]) => [k, v?.status ?? 'unknown'])),
    problems: report.problems ?? [],
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      'Usage: node scripts/accept-all.mjs [--quick|--full|--verify-fresh] [--examples] [--root <dir>] [--game <slug>] [--require-autoplay] [--webasset|--skip-webasset] [--strict] [--json]',
    );
    return;
  }

  const targets = await discoverDirs(opts);
  const items = [];
  for (const target of targets) {
    const acceptOpts = {
      gameDir: target.dir,
      quick: opts.mode === 'quick',
      strict: opts.strict,
      webasset: opts.webasset,
      skipWebasset: opts.skipWebasset || opts.mode === 'quick',
      doctor: false,
      requireAutoplay: opts.requireAutoplay,
      autoplayRuns: undefined,
      autoplayIdleRuns: undefined,
      packageCheck: false,
      verifyFresh: opts.mode === 'verify-fresh',
      examples: false,
      allowSkips: false,
      allowIdMismatch: false,
      viewport: '960x540',
      mobileViewport: '360x800',
      skipMobilePlaytest: false,
      ready: '',
      chrome: opts.chrome,
      out: '',
      json: false,
      help: false,
    };
    const report = await runAcceptForProject(target.dir, acceptOpts);
    items.push(summarizeReport(target.id, target.dir, report, opts.mode));
  }

  const passed = items.filter(i => i.ok).length;
  const failed = items.length - passed;
  const summary = { ok: failed === 0, mode: opts.mode, total: items.length, passed, failed, items };

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`=== HGame Batch Acceptance (${opts.mode}: ${passed}/${items.length} passed) ===`);
    for (const item of items) {
      const gateStr = item.gates
        ? Object.entries(item.gates)
            .filter(([, s]) => s !== 'skipped')
            .map(([k, s]) => `${k}:${s}`)
            .join(' ')
        : (item.checkedAt ?? '');
      console.log(`  [${item.status}] ${item.id}  ${gateStr}`);
      for (const p of item.problems.slice(0, 4)) console.log(`      -> ${p}`);
    }
  }
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch(err => {
  console.error('accept-all failed: ' + err.message);
  process.exitCode = 1;
});
