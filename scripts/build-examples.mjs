#!/usr/bin/env node
// Regenerates the generated (and git-ignored) parts of every examples/<id>/ project from assets/runtime:
//   vendor/hgame/, assets/vendor/three/ (3D), scripts/package-game.mjs.
// Authored files (src/, tests/, configs, html/css) are never touched. It runs scripts/create-game.mjs into a temp
// directory using each example's engine.config.json, then copies only the generated folders, so examples always
// reflect the current runtime and the repo never carries a second copy of it.
//
//   node scripts/build-examples.mjs [example-id ...]
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examplesDir = path.join(root, 'examples');
const GENERATED = [['vendor', 'hgame'], ['assets', 'vendor'], ['scripts']];

export async function listExamples() {
  const entries = await readdir(examplesDir, { withFileTypes: true }).catch(() => []);
  return entries.filter(e => e.isDirectory() && existsSync(path.join(examplesDir, e.name, 'engine.config.json'))).map(e => e.name);
}

export async function buildExample(id) {
  const dir = path.join(examplesDir, id);
  const recipe = JSON.parse(await readFile(path.join(dir, 'engine.config.json'), 'utf8'));
  const game = JSON.parse(await readFile(path.join(dir, 'game.config.json'), 'utf8'));
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-example-'));
  try {
    const out = path.join(tmp, 'gen');
    const withFeatures = recipe.features.filter(f => !['scene', 'input', 'adaptiveQuality3d'].includes(f));
    const args = [path.join(root, 'scripts', 'create-game.mjs'), out, '--profile', recipe.profile, '--renderer', recipe.renderer, '--no-git'];
    if (withFeatures.length) args.push('--with', withFeatures.join(','));
    if (recipe.features.includes('adaptiveQuality3d')) args.push('--quality', game.quality3d?.mode ?? 'auto');
    const run = spawnSync(process.execPath, args, { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`create-game failed for ${id}: ${run.stderr || run.stdout}`);
    for (const parts of GENERATED) {
      const from = path.join(out, ...parts);
      const to = path.join(dir, ...parts);
      if (!existsSync(from)) continue;
      await rm(to, { recursive: true, force: true });
      await mkdir(path.dirname(to), { recursive: true });
      await cp(from, to, { recursive: true });
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return dir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const wanted = process.argv.slice(2);
  const ids = wanted.length ? wanted : await listExamples();
  if (!ids.length) { console.error('No examples found'); process.exit(1); }
  for (const id of ids) {
    await buildExample(id);
    console.log(`built examples/${id}`);
  }
}
