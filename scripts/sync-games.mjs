#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getEngineMetadata,
  inspectProjectEngineSync,
  resolveGamesRoot,
  resolveWebAssetDir,
  syncEngineFilesToProject,
  syncWebAssetRuntime,
} from './lib/engine-sync.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function printHelp() {
  console.log(`Usage:
  npm run sync:games -- --status [--root <dir>] [--strict] [--json]
  npm run sync:games -- --game <slug> [--game <slug>...] [--dry-run] [--force] [--no-build] [--json]
  npm run sync:games -- --dir <game-path> [--dry-run] [--force] [--no-build] [--json]
  npm run sync:games -- --all [--root <dir>] [--dry-run] [--force] [--no-build] [--json]

Notes:
  - Engine-managed paths only: vendor/hgame/, assets/vendor/three/, docs/api/API-INDEX.json, and core engine scripts.
  - Game source (src/, tests/, authored assets/, configs) is never overwritten.
  - External games root resolves from --root, HGAME_GAMES_ROOT, WEBASSET_HTML_GAMES_ROOT, or .hgame.local.json gamesRootDir.`);
}

export function parseSyncArgs(argv) {
  const opts = {
    mode: null,
    games: [],
    dirs: [],
    root: null,
    dryRun: false,
    force: false,
    strict: false,
    rebuildPixi: true,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--status') opts.mode = opts.mode && opts.mode !== 'status' ? conflict(opts.mode, 'status') : 'status';
    else if (arg === '--all') opts.mode = opts.mode && opts.mode !== 'all' ? conflict(opts.mode, 'all') : 'all';
    else if (arg === '--game' || arg === '-g') {
      const val = argv[++i];
      if (!val || val.startsWith('-')) throw new Error('--game requires a slug or path');
      opts.games.push(val);
    } else if (arg === '--dir' || arg === '-d') {
      const val = argv[++i];
      if (!val || val.startsWith('-')) throw new Error('--dir requires a directory path');
      opts.dirs.push(val);
    } else if (arg === '--root') {
      const val = argv[++i];
      if (!val || val.startsWith('-')) throw new Error('--root requires a directory path');
      opts.root = val;
    } else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--strict' || arg === '--check') opts.strict = true;
    else if (arg === '--no-build') opts.rebuildPixi = false;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (!arg.startsWith('-')) opts.games.push(arg);
    else throw new Error('Unknown argument: ' + arg);
  }
  if (!opts.mode) {
    opts.mode = (opts.games.length > 0 || opts.dirs.length > 0) ? 'sync' : 'status';
  }
  return opts;
}

function conflict(a, b) {
  throw new Error(`Cannot combine --${a} with --${b}`);
}

async function listSubdirs(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => path.join(rootDir, e.name))
    .sort((a, b) => a.localeCompare(b));
}

async function resolveTargetDirs(opts, gamesRoot) {
  if (opts.mode === 'status' && opts.games.length === 0 && opts.dirs.length === 0) {
    if (!gamesRoot) {
      throw new Error('No games root configured. Pass --root <dir> or set gamesRootDir in .hgame.local.json');
    }
    return listSubdirs(gamesRoot);
  }
  if (opts.mode === 'all') {
    if (!gamesRoot) {
      throw new Error('No games root configured. Pass --root <dir> or set gamesRootDir in .hgame.local.json');
    }
    return listSubdirs(gamesRoot);
  }

  const targets = [];
  for (const dir of opts.dirs) targets.push(path.resolve(dir));
  for (const token of opts.games) {
    if (token.includes('/') || token.includes('\\') || !gamesRoot) {
      targets.push(path.resolve(token));
    } else {
      targets.push(path.join(gamesRoot, token));
    }
  }
  for (const dir of targets) {
    const st = await stat(dir).catch(() => null);
    if (!st || !st.isDirectory()) throw new Error('Game directory does not exist: ' + dir);
  }
  return [...new Set(targets)];
}

function formatResultLine(item) {
  if (!item.managed) {
    return `  [skip:${item.status}] ${item.name} (${item.reason})`;
  }
  const c = item.counts;
  const delta = `+${c.added} ~${c.updated} -${c.removed}`;
  const notes = [];
  if (item.recordedEngineCommit) notes.push(`from ${item.recordedEngineCommit.slice(0, 7)}`);
  if (c.localEdits > 0) notes.push(`${c.localEdits} local edit(s)`);
  if (item.pixiRebuilt) notes.push('pixi rebuilt');
  if (item.pixiRebuildSkippedReason) notes.push(`pixi skip: ${item.pixiRebuildSkippedReason}`);
  const suffix = notes.length ? ` (${notes.join(', ')})` : '';
  return `  [${item.status}] ${item.name} [${item.profile}/${item.physics}] ${delta}${suffix}`;
}

export async function runSyncCli(argv = process.argv.slice(2)) {
  const opts = parseSyncArgs(argv);
  if (opts.help) {
    printHelp();
    return 0;
  }

  const gamesRoot = await resolveGamesRoot(repoRoot, opts.root);
  const metadata = await getEngineMetadata(repoRoot);
  const targets = await resolveTargetDirs(opts, gamesRoot);
  const results = [];
  const errors = [];

  for (const dir of targets) {
    if (opts.mode === 'status') {
      const inspected = await inspectProjectEngineSync({ repoRoot, targetDir: dir });
      results.push({ ...inspected, expected: undefined });
      continue;
    }

    const inspected = await inspectProjectEngineSync({ repoRoot, targetDir: dir });
    if (!inspected.managed) {
      // Only skip non-hgame directories when running --all; fail loudly if explicitly requested.
      if (opts.mode === 'all') {
        results.push({ ...inspected, expected: undefined });
        continue;
      }
      throw new Error(`Target is not an HGame project (${inspected.reason}): ${dir}`);
    }

    try {
      const res = await syncEngineFilesToProject({
        repoRoot,
        targetDir: dir,
        dryRun: opts.dryRun,
        force: opts.force,
        rebuildPixi: opts.rebuildPixi,
        metadata,
      });
      results.push(res);
    } catch (err) {
      if (opts.mode === 'all') {
        errors.push({ name: inspected.name, projectDir: inspected.projectDir, error: err.message });
        results.push({ ...inspected, expected: undefined, syncError: err.message });
      } else {
        throw err;
      }
    }
  }

  const managed = results.filter(r => r.managed);
  let webAssetSync = null;
  let skillsSynced = false;
  if (opts.mode === 'all' && !opts.dryRun && !opts.root) {
    const webAssetDir = await resolveWebAssetDir(repoRoot);
    if (webAssetDir) {
      webAssetSync = await syncWebAssetRuntime({ repoRoot, webAssetDir, dryRun: false });
    }
    const skillsRun = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'sync-skills.mjs')], {
      cwd: repoRoot, encoding: 'utf8', windowsHide: true,
    });
    skillsSynced = skillsRun.status === 0;
  }

  const summary = {
    engineVersion: metadata.engineVersion,
    engineCommit: metadata.engineCommit,
    engineDirty: metadata.engineDirty,
    gamesRoot,
    mode: opts.mode,
    dryRun: opts.dryRun,
    total: results.length,
    managed: managed.length,
    upToDate: managed.filter(r => r.status === 'up-to-date').length,
    outdated: managed.filter(r => r.status === 'outdated').length,
    legacyUntracked: managed.filter(r => r.status === 'legacy-untracked').length,
    localEdits: managed.filter(r => r.status === 'local-edits').length,
    nonHGame: results.filter(r => !r.managed).length,
    webAssetSync,
    skillsSynced,
    errors,
    projects: results,
  };

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`HGame ${metadata.engineVersion} (${metadata.engineCommit ? metadata.engineCommit.slice(0, 7) : 'no-git'}${metadata.engineDirty ? ' dirty' : ''})`);
    if (gamesRoot) console.log(`Games root: ${gamesRoot}`);
    for (const item of results) console.log(formatResultLine(item));
    console.log(
      `Summary: ${summary.managed} managed (${summary.upToDate} up-to-date, ${summary.outdated} outdated, ` +
      `${summary.legacyUntracked} legacy-untracked, ${summary.localEdits} local-edits), ${summary.nonHGame} skipped.`,
    );
    if (webAssetSync?.destDir) {
      console.log(`WebAsset runtime: +${webAssetSync.added} ~${webAssetSync.updated} -${webAssetSync.removed} (${webAssetSync.destDir})`);
    }
    if (skillsSynced) {
      console.log('Skills: synced global skill junctions via scripts/sync-skills.mjs');
    }
    if (errors.length > 0) {
      for (const e of errors) console.error(`Error (${e.name}): ${e.error}`);
    }
  }

  if (errors.length > 0) return 1;
  if (opts.strict && managed.some(r => r.status !== 'up-to-date')) return 1;
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSyncCli().then(code => {
    process.exitCode = code;
  }).catch(err => {
    console.error('sync-games failed: ' + err.message);
    process.exitCode = 1;
  });
}
