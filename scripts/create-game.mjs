#!/usr/bin/env node
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineProject } from '../assets/runtime/core/config.js';

// Completely standalone: the runtime and starter template ship with this repository.
const root = fileURLToPath(new URL('../', import.meta.url));
const template = path.join(root, 'assets', 'template');
const runtime = path.join(root, 'assets', 'runtime');
const profiles = path.join(root, 'assets', 'profiles');
const optionalThree = path.join(root, 'assets', 'optional', 'three');

function parse(argv) {
  const result = { destination: '', name: '', profile: '2d', with: [], physics: null,
    tickHz: null, quality: null, git: true, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--name') {
      result.name = argv[++i] || '';
    } else if (arg === '--profile') {
      result.profile = argv[++i];
    } else if (arg === '--with') {
      result.with.push(...(argv[++i] || '').split(',').filter(Boolean));
    } else if (arg === '--physics') {
      result.physics = argv[++i];
    } else if (arg === '--tick-hz') {
      result.tickHz = Number(argv[++i]);
    } else if (arg === '--quality') {
      result.quality = argv[++i];
    } else if (arg === '--no-git') {
      result.git = false;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (!arg.startsWith('-') && !result.destination) {
      result.destination = arg;
    } else {
      throw new Error('Unknown or incomplete argument: ' + arg);
    }
  }
  if (!result.destination) throw new Error('Usage: node create-game.mjs <new-project-path> [--profile 2d|3d|ui] [--quality auto|low|medium|high|ultra (3D only)] [--with save,audio,physics2d,physics3d] [--physics rapier2d|rapier3d|none] [--tick-hz 60] [--name "游戏名称"] [--no-git] [--dry-run]');
  const target = path.resolve(result.destination);
  const slug = path.basename(target);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(slug)) {
    throw new Error('Project folder must be an ASCII slug (letters, digits, - or _). Use --name for a Chinese display name.');
  }
  if (result.name && (result.name.trim().length < 1 || result.name.length > 80)) {
    throw new Error('Display name must contain 1–80 characters');
  }
  let physics = result.physics;
  if (result.quality !== null) {
    if (result.profile !== '3d') throw new Error('--quality requires --profile 3d');
    if (!['auto','low','medium','high','ultra'].includes(result.quality)) {
      throw new Error('--quality must be auto, low, medium, high or ultra');
    }
  }
  if (!physics && result.with.includes('physics2d')) physics = 'rapier2d';
  if (!physics && result.with.includes('physics3d')) physics = 'rapier3d';
  if (physics && !['none', 'rapier2d', 'rapier3d'].includes(physics)) {
    throw new Error('HGame projects use deterministic rapier2d or rapier3d physics.');
  }
  const features = ['scene', ...(result.profile !== 'ui' ? ['input'] : []), ...result.with,
    ...(result.quality === null ? [] : ['adaptiveQuality3d'])];
  if (physics === 'rapier2d') features.push('physics2d');
  if (physics === 'rapier3d') features.push('physics3d');
  const recipe = defineProject({
    profile: result.profile, ...(physics ? { physics } : {}),
    ...(result.tickHz === null ? {} : { tickHz: result.tickHz }), features,
  });
  return { ...result, target, slug, name: result.name || slug, recipe };
}

async function main() {
  const options = parse(process.argv.slice(2));
  try {
    await stat(options.target);
    throw new Error('Target directory already exists; refusing to overwrite: ' + options.target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const required of [template, path.join(runtime, 'core'), path.join(runtime, 'platform'), path.join(profiles, options.recipe.profile)]) {
    if (!(await stat(required)).isDirectory()) throw new Error('Bundled HGame source is incomplete: ' + required);
  }
  if (options.dryRun) {
    console.log(JSON.stringify({ action: 'create-html-game', target: options.target, name: options.name,
      engine: 'HGame', engineVersion: '1.0.0', recipe: options.recipe,
      default3dMaterials: options.recipe.profile === '3d' ? 'native-world-aligned-pbr' : null,
      git: options.git }, null, 2));
    return;
  }

  const parent = path.dirname(options.target);
  await mkdir(parent, { recursive: true });
  // Stage beside the destination so rename is on the same filesystem.
  const stage = path.join(parent, '.' + options.slug + '.hgame-staging-' + process.pid);
  try {
    await stat(stage);
    throw new Error('Staging directory exists; refusing to reuse it: ' + stage);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await cp(template, stage, { recursive: true, force: false, errorOnExist: true });
    const vendor = path.join(stage, 'vendor', 'hgame');
    await cp(runtime, vendor, { recursive: true });
    for (const dimension of ['2d', '3d']) {
      if (options.recipe.physics !== `rapier${dimension}`) {
        await rm(path.join(vendor, 'vendor', `rapier${dimension}`), { recursive: true, force: true });
      }
    }
    if (!['rapier2d', 'rapier3d'].includes(options.recipe.physics)) {
      await rm(path.join(vendor, 'vendor'), { recursive: true, force: true });
    }

    const profileFiles = path.join(profiles, options.recipe.profile);
    await cp(path.join(profileFiles,
      'main.js'),
      path.join(stage, 'src', 'main.js'), { force: true });
    if (options.recipe.profile === 'ui') {
      await cp(path.join(profileFiles, 'index.html'), path.join(stage, 'index.html'), { force: true });
    }
    if (options.recipe.profile === '3d') {
      await cp(path.join(profileFiles, 'index.html'), path.join(stage, 'index.html'), { force: true });
      await cp(path.join(profileFiles, 'level.json'), path.join(stage, 'src', 'level.json'), { force: false });
      const threeDest = path.join(stage, 'assets', 'vendor', 'three');
      await mkdir(threeDest, { recursive: true });
      for (const file of ['three.module.js', 'three.core.js', 'LICENSE']) {
        await cp(path.join(optionalThree, file), path.join(threeDest, file), { force: false });
      }
      for (const file of ['loaders/GLTFLoader.js', 'utils/BufferGeometryUtils.js', 'utils/SkeletonUtils.js']) {
        const dest = path.join(threeDest, 'jsm', file);
        await mkdir(path.dirname(dest), { recursive: true });
        await cp(path.join(optionalThree, 'jsm', file), dest, { force: false });
      }
      for (const file of ['materials.json', 'model-slots.json']) {
        await cp(path.join(profileFiles, file), path.join(stage, 'src', file), { force: false });
      }
    }
    await writeFile(path.join(stage, 'engine.config.json'), JSON.stringify(options.recipe, null, 2) + '\n');

    const configFile = path.join(stage, 'game.config.json');
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    Object.assign(config, { id: options.slug, name: options.name, standalone: true,
      renderer: options.recipe.renderer });
    if (options.recipe.features.includes('adaptiveQuality3d')) {
      config.quality3d = { mode: options.quality ?? 'auto' };
    }
    await writeFile(configFile, JSON.stringify(config, null, 2) + '\n');
    const packageFile = path.join(stage, 'package.json');
    const pkg = JSON.parse(await readFile(packageFile, 'utf8'));
    pkg.name = options.slug.toLowerCase();
    await writeFile(packageFile, JSON.stringify(pkg, null, 2) + '\n');
    if (options.git) {
      const command = spawnSync('git', ['init', '-q'], { cwd: stage, encoding: 'utf8' });
      if (command.error || command.status !== 0) {
        throw new Error('git init failed: ' + (command.stderr || command.error?.message || 'unknown error'));
      }
    }
    await rename(stage, options.target);
    console.log(JSON.stringify({
      success: true, project: options.target, gameId: options.slug,
      engine: 'HGame', engineVersion: '1.0.0', profile: options.recipe.profile, features: options.recipe.features,
      physics: options.recipe.physics, standalone: true, gitInitialized: options.git,
    }, null, 2));
  } catch (error) {
    await rm(stage, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

main().catch(error => {
  console.error('Create HTML game failed: ' + error.message);
  process.exitCode = 1;
});
