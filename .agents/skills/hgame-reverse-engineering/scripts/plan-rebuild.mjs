#!/usr/bin/env node
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineProject } from '../../../../assets/runtime/core/config.js';

function args(argv) {
  const parsed = { root: null, target: null, profile: null, evidence: null,
    physics: null, tickHz: null, features: [], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--profile') parsed.profile = argv[++i];
    else if (arg === '--target') parsed.target = argv[++i];
    else if (arg === '--evidence') parsed.evidence = argv[++i];
    else if (arg === '--with') parsed.features.push(...(argv[++i] || '').split(',').filter(Boolean));
    else if (arg === '--physics') parsed.physics = argv[++i];
    else if (arg === '--tick-hz') parsed.tickHz = Number(argv[++i]);
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (!arg.startsWith('-') && !parsed.root) parsed.root = arg;
    else throw new Error('Unknown or incomplete argument: ' + arg);
  }
  if (!parsed.root || !parsed.target || !parsed.profile || !parsed.evidence?.trim()) {
    throw new Error('Usage: node plan-rebuild.mjs <research-directory> --profile 2d|3d|ui --target <html-project-path> --evidence <source-or-observation> [--with feature1,feature2] [--physics backend] [--tick-hz N] [--dry-run]');
  }
  if (parsed.evidence.length > 500) throw new Error('Evidence reference must be <= 500 characters');
  return parsed;
}
function inside(a, b) {
  const rel = path.relative(a.toLowerCase(), b.toLowerCase());
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
async function main() {
  const options = args(process.argv.slice(2));
  const research = await realpath(path.resolve(options.root));
  const baseline = JSON.parse(await readFile(path.join(research, 'baseline.json'), 'utf8'));
  if (!baseline.sourcePath || !baseline.gameId) throw new Error('Invalid research baseline');
  const source = await realpath(baseline.sourcePath);
  const target = path.resolve(options.target);
  if (inside(source, target) || inside(research, target)) {
    throw new Error('Rebuild target must be outside the original and research directories');
  }
  const chosen = new Set(['scene', ...(options.profile === 'ui' ? [] : ['input']), ...options.features]);
  const physics = options.physics ?? (chosen.has('physics2d') ? 'rapier2d' : chosen.has('physics3d') ? 'rapier3d' : 'none');
  if (physics === 'rapier2d') chosen.add('physics2d');
  if (physics === 'rapier3d') chosen.add('physics3d');
  const recipe = defineProject({
    profile: options.profile, physics, features: [...chosen],
    ...(options.tickHz === null ? {} : { tickHz: options.tickHz }),
  });
  const plan = {
    schemaVersion: 1,
    originalGameId: baseline.gameId,
    sourcePath: source,
    researchPath: research,
    targetPath: target,
    selectedBy: 'explicit-human-project-configuration',
    evidence: [{ kind: 'declared', ref: options.evidence.trim(), verified: false }],
    engineRecipe: recipe,
    status: 'planned-not-implemented',
    requiredChecks: [
      'verify source game build and selected camera/physics dimensions',
      'validate gameplay rules, collision and AI independently from display technology',
      'run browser and gameplay tests before marking coverage passed',
    ],
  };
  const planPath = path.join(research, 'production', 'rebuild-plan.json');
  if (!options.dryRun) {
    try {
      await stat(planPath);
      throw new Error('Existing rebuild plan must be reviewed, refusing overwrite: ' + planPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await writeFile(planPath, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify({ ...plan, dryRun: options.dryRun, output: planPath }, null, 2));
}
main().catch(error => { console.error('Rebuild plan failed: ' + error.message); process.exitCode = 1; });
