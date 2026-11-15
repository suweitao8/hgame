#!/usr/bin/env node
// Syncs HGame/.agents/skills/* into ~/.agents/skills, ~/.codex/skills, and ~/.trae/skills via junctions/symlinks.
import { lstat, mkdir, readdir, readlink, rm, symlink, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const skillsSourceRoot = path.join(repoRoot, '.agents', 'skills');

function normalizePath(p) {
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

async function ensureRealDirectory(dirPath) {
  try {
    const st = await lstat(dirPath);
    if (st.isSymbolicLink()) {
      const target = await readlink(dirPath);
      await unlink(dirPath);
      await mkdir(dirPath, { recursive: true });
      // If ~/.agents/skills was previously a root junction to another repo, re-link its immediate skill dirs as junctions too.
      try {
        const entries = await readdir(target, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const src = path.join(target, entry.name);
          try {
            const skillStat = await lstat(path.join(src, 'SKILL.md'));
            if (skillStat.isFile()) {
              await ensureLink(path.join(dirPath, entry.name), src);
            }
          } catch {
            // Not a skill directory.
          }
        }
      } catch {
        // Ignore unreadable legacy link target.
      }
      return;
    }
    if (!st.isDirectory()) {
      throw new Error(`Expected directory at ${dirPath}`);
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      await mkdir(dirPath, { recursive: true });
      return;
    }
    throw err;
  }
}

async function ensureLink(linkPath, targetPath) {
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  try {
    const st = await lstat(linkPath);
    if (st.isSymbolicLink()) {
      const existing = await readlink(linkPath);
      if (normalizePath(existing) === normalizePath(targetPath)) {
        return 'existing';
      }
      await rm(linkPath, { recursive: true, force: true });
    } else {
      console.warn(`[sync-skills] Preserved non-link directory: ${linkPath}`);
      return 'preserved';
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  await symlink(targetPath, linkPath, linkType);
  return 'created';
}

async function main() {
  const home = os.homedir();
  const entries = await readdir(skillsSourceRoot, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(skillsSourceRoot, entry.name);
    try {
      const st = await lstat(path.join(skillDir, 'SKILL.md'));
      if (st.isFile()) skills.push({ name: entry.name, dir: skillDir });
    } catch {
      // Skip non-skill folders.
    }
  }

  const targetRoots = [
    path.join(home, '.agents', 'skills'),
    path.join(home, '.codex', 'skills'),
    path.join(home, '.trae', 'skills'),
    path.join(home, '.gemini', 'config', 'skills'),
  ];

  let created = 0;
  let existing = 0;
  for (const root of targetRoots) {
    await ensureRealDirectory(root);
    for (const skill of skills) {
      const status = await ensureLink(path.join(root, skill.name), skill.dir);
      if (status === 'created') created += 1;
      else if (status === 'existing') existing += 1;
    }
  }

  console.log(
    `[sync-skills] Synced ${skills.length} HGame skill(s) across ${targetRoots.length} host directories (created=${created}, existing=${existing})`,
  );
}

main().catch((err) => {
  console.error('sync-skills failed: ' + err.message);
  process.exitCode = 1;
});
