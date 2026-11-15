#!/usr/bin/env node
// Audits RE workspace disk footprints and safely archives bloated temp/raw dumps without permanent deletion.
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { resolveReConfig } from './local-config.mjs';

function parseArgs(argv) {
  const opts = { audit: false, archiveRawSlug: null, maxMb: 500, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--audit') opts.audit = true;
    else if (token === '--archive-raw') opts.archiveRawSlug = argv[++i];
    else if (token === '--max-mb') opts.maxMb = Number(argv[++i]);
    else if (token === '--json') opts.json = true;
    else if (token === '--help' || token === '-h') opts.help = true;
    else throw new Error(`Unknown or incomplete argument: ${token}`);
  }
  if (!opts.archiveRawSlug && !opts.audit) opts.audit = true;
  return opts;
}

async function folderStats(dir, maxDepth = 6, depth = 0) {
  if (depth > maxDepth) return { files: 0, bytes: 0 };
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { files: 0, bytes: 0 };
  }
  let files = 0;
  let bytes = 0;
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await folderStats(full, maxDepth, depth + 1);
      files += sub.files;
      bytes += sub.bytes;
    } else {
      try {
        const st = await stat(full);
        files += 1;
        bytes += st.size;
      } catch {
        // skip transient file
      }
    }
  }
  return { files, bytes };
}

async function safeMoveDir(src, dst) {
  await mkdir(dst, { recursive: true });
  if (process.platform === 'win32') {
    const res = spawnSync('robocopy', [src, dst, '/E', '/MOVE', '/XJ', '/MT:8', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], {
      encoding: 'utf8',
    });
    if (res.status === null || res.status > 7) {
      throw new Error(`robocopy failed (exit ${res.status}): ${res.stderr || res.stdout}`);
    }
    return { method: 'robocopy', exitCode: res.status };
  }
  await cp(src, dst, { recursive: true, force: true });
  await rm(src, { recursive: true, force: true });
  return { method: 'cp-rm' };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node clean-research.mjs [--audit] [--max-mb 500] [--archive-raw <slug>] [--json]');
    return;
  }

  const cfg = resolveReConfig();
  const projectsDir = path.join(cfg.reWorkspaceDir, 'projects');

  if (opts.archiveRawSlug) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(opts.archiveRawSlug)) {
      throw new Error(`Invalid slug: ${opts.archiveRawSlug}`);
    }
    const rawDir = path.join(projectsDir, opts.archiveRawSlug, 'raw');
    const stamp = new Date().toISOString().slice(0, 7);
    const dst = path.join(cfg.reWorkspaceDir, 'legacy-archive', stamp, `${opts.archiveRawSlug}-raw`);
    const st = await stat(rawDir).catch(() => null);
    if (!st || !st.isDirectory()) {
      throw new Error(`No raw directory found at ${rawDir}`);
    }
    const moveInfo = await safeMoveDir(rawDir, dst);
    const out = { ok: true, archived: opts.archiveRawSlug, from: rawDir, to: dst, ...moveInfo };
    if (opts.json) console.log(JSON.stringify(out, null, 2));
    else console.log(`[re:clean] Archived raw dump -> ${dst} (${moveInfo.method})`);
    return;
  }

  let dirs = [];
  try {
    dirs = (await readdir(projectsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    dirs = [];
  }

  const report = [];
  for (const slug of dirs) {
    const rawStats = await folderStats(path.join(projectsDir, slug, 'raw'));
    const rawMb = Number((rawStats.bytes / (1024 * 1024)).toFixed(1));
    report.push({
      slug,
      rawFiles: rawStats.files,
      rawMb,
      overBudget: rawMb > opts.maxMb,
    });
  }

  const overBudget = report.filter((r) => r.overBudget);
  const summary = { ok: true, workspaceDir: cfg.reWorkspaceDir, maxMb: opts.maxMb, projectCount: report.length, overBudgetCount: overBudget.length, projects: report };
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`[re:clean] Audited ${report.length} projects (budget <= ${opts.maxMb} MB per raw/): ${overBudget.length} over budget`);
    for (const r of report) {
      if (r.rawFiles > 0) {
        console.log(`  ${r.overBudget ? '[WARN]' : '[OK]  '} ${r.slug}: ${r.rawMb} MB (${r.rawFiles} files in raw/)`);
      }
    }
  }
}

main().catch((err) => {
  console.error('clean-research failed: ' + err.message);
  process.exitCode = 1;
});
