#!/usr/bin/env node
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineProject } from '../assets/runtime/core/config.js';
import { PIXI_BUNDLER_PATH } from './assets.mjs';
import { getProjectPreset, PROFILE_FILES, RENDERERS, THREE_FILES } from './project-profiles.mjs';

// Completely standalone: the runtime and starter template ship with this repository.
const root = fileURLToPath(new URL('../', import.meta.url));
const template = path.join(root, 'assets', 'template');
const runtime = path.join(root, 'assets', 'runtime');
const profiles = path.join(root, 'assets', 'profiles');
const optionalThree = path.join(root, 'assets', 'optional', 'three');

function parse(argv) {
  const result = { destination: '', name: '', preset: null, profile: null, renderer: null, with: [], physics: null,
    tickHz: null, quality: null, git: true, dryRun: false, bare: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--name') {
      result.name = argv[++i] || '';
    } else if (arg === '--preset') {
      result.preset = argv[++i];
      if (!result.preset || result.preset.startsWith('-')) throw new Error('--preset requires a name');
    } else if (arg === '--profile') {
      result.profile = argv[++i];
    } else if (arg === '--renderer') {
      result.renderer = argv[++i];
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
    } else if (arg === '--bare') {
      result.bare = true;
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (!arg.startsWith('-') && !result.destination) {
      result.destination = arg;
    } else {
      throw new Error('Unknown or incomplete argument: ' + arg);
    }
  }
  if (!result.destination) throw new Error('Usage: node create-game.mjs <new-project-path> [--preset 2d|horde|pixi2d|3d|ui | --profile 2d|3d|ui] [--renderer canvas2d|webgl2d|threejs|dom] [--quality auto|low|medium|high|ultra (Pixi 2D or 3D)] [--with save,audio,physics2d,physics3d] [--physics rapier2d|rapier3d|none] [--tick-hz 60] [--name "游戏名称"] [--bare (2d|3d)] [--no-git] [--dry-run]');
  const preset = result.preset === null ? null : getProjectPreset(result.preset);
  const explicitRenderer = result.renderer !== null;
  if (preset && result.profile && result.profile !== preset.profile) throw new Error('--profile conflicts with --preset ' + result.preset);
  result.profile ??= preset?.profile ?? '2d';
  const usePixi = result.profile === '2d' && !explicitRenderer && (result.preset === null || result.preset === '2d' || result.preset === 'pixi2d' || result.preset === 'horde');
  result.renderer ??= preset?.renderer ?? null;
  if (result.profile === '2d' && result.renderer === null && result.preset === null) result.renderer = 'webgl2d';
  if (result.preset === 'pixi2d' && explicitRenderer) throw new Error('The pixi2d preset selects its own renderer; omit --renderer');
  result.quality ??= preset?.quality ?? (usePixi ? 'auto' : null);
  result.with = [...(preset?.features ?? []), ...result.with];
  if (preset?.starter === 'horde' && !result.bare && result.renderer !== 'webgl2d') throw new Error('The horde starter requires webgl2d');
  if (result.bare && !['2d', '3d'].includes(result.profile)) throw new Error('--bare supports --profile 2d or 3d');
  if (result.profile === '2d' && result.tickHz === 0 && !result.bare) {
    throw new Error('--tick-hz 0 requires --bare for 2D projects because the demo uses fixed updates');
  }
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
    if (result.profile !== '3d' && !usePixi) throw new Error('--quality requires Pixi 2D or --profile 3d');
    if (!['auto','low','medium','high','ultra'].includes(result.quality)) {
      throw new Error('--quality must be auto, low, medium, high or ultra');
    }
  }
  if (!physics && result.with.includes('physics2d')) physics = 'rapier2d';
  if (!physics && result.with.includes('physics3d')) physics = 'rapier3d';
  physics ??= preset?.physics ?? null;
  if (physics && !['none', 'rapier2d', 'rapier3d'].includes(physics)) {
    throw new Error('HGame projects use deterministic rapier2d or rapier3d physics.');
  }
  const features = ['scene', ...(result.profile !== 'ui' ? ['input'] : []), ...result.with,
    ...(result.profile === '3d' && result.quality !== null ? ['adaptiveQuality3d'] : [])];
  if (physics === 'rapier2d') features.push('physics2d');
  if (physics === 'rapier3d') features.push('physics3d');
  const recipe = defineProject({
    profile: result.profile, ...(result.renderer ? { renderer: result.renderer } : {}),
    ...(physics ? { physics } : {}),
    ...(result.tickHz === null ? {} : { tickHz: result.tickHz }), features,
  });
  const starter = usePixi ? 'pixi2d' : result.bare ? result.profile + '-bare' : (result.preset === '2d' && explicitRenderer ? '2d' : preset?.starter ?? result.profile);
  return { ...result, target, slug, starter, name: result.name || slug, recipe };
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
      ...(options.preset ? { preset: options.preset, starter: options.starter, runtime: 'entry-graph' } : {}),
      ...(options.quality ? { quality: options.quality } : {}),
      default3dMaterials: options.recipe.profile === '3d' && !options.bare ? 'native-world-aligned-pbr' : null,
      bare: options.bare, git: options.git }, null, 2));
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
    await cp(path.join(root, 'types'), vendor, {
      recursive: true,
      filter: async source => source.endsWith('.d.ts') || (await stat(source)).isDirectory(),
    });
    await mkdir(path.join(stage, 'scripts'), { recursive: true });
    await cp(path.join(root, 'scripts', 'query-api.mjs'), path.join(stage, 'scripts', 'query-api.mjs'));
    await cp(path.join(root, 'scripts', 'package-game.mjs'), path.join(stage, 'scripts', 'package-game.mjs'));
    await cp(path.join(root, 'scripts', 'project-profiles.mjs'), path.join(stage, 'scripts', 'project-profiles.mjs'));
    await cp(path.join(root, 'scripts', 'toy-preflight.mjs'), path.join(stage, 'scripts', 'toy-preflight.mjs'));
    await cp(path.join(root, 'scripts', 'assets.mjs'), path.join(stage, 'scripts', 'assets.mjs'));
    for (const dimension of ['2d', '3d']) {
      if (options.recipe.physics !== `rapier${dimension}`) {
        await rm(path.join(vendor, 'vendor', `rapier${dimension}`), { recursive: true, force: true });
      }
    }
    if (!['rapier2d', 'rapier3d'].includes(options.recipe.physics)) {
      await rm(path.join(vendor, 'vendor'), { recursive: true, force: true });
    }

    const mainSource = path.join(profiles, options.starter);
    const files = PROFILE_FILES[options.starter] ?? PROFILE_FILES[options.recipe.profile];
    let projectEntry = 'src/main.js';
    if (options.starter === 'pixi2d') {
      await cp(path.join(mainSource, 'dist'), stage, { recursive: true, force: true });
      await cp(path.join(mainSource, 'src'), path.join(stage, 'src'), { recursive: true, force: true });
      const presentationFile = path.join(stage, 'src', 'presentation.json');
      const presentation = JSON.parse(await readFile(presentationFile, 'utf8'));
      presentation.quality = options.quality;
      await writeFile(presentationFile, JSON.stringify(presentation, null, 2) + '\n');
      const sourceEntry = options.bare ? 'index.bare.html' : options.preset === 'horde' ? 'index.horde.html' : 'index.html';
      if (options.bare) projectEntry = 'src/bare.js';
      else if (options.preset === 'horde') projectEntry = 'src/horde.js';
      if (sourceEntry !== 'index.html') await cp(path.join(mainSource, 'dist', sourceEntry), path.join(stage, 'index.html'), { force: true });
      await cp(path.join(mainSource, sourceEntry), path.join(stage, 'index.source.html'));
      if (options.preset === 'horde' && !options.bare) await cp(path.join(profiles, 'horde', 'swarm.json'), path.join(stage, 'src', 'swarm.json'));
      await cp(path.join(mainSource, 'install-build.mjs'), path.join(stage, 'scripts', 'install-pixi-build.mjs'));
      await cp(path.join(mainSource, 'bundle.mjs'), path.join(stage, PIXI_BUNDLER_PATH));
      await cp(path.join(mainSource, 'package-lock.json'), path.join(stage, 'package-lock.json'));
      await cp(path.join(mainSource, 'CLAUDE.md'), path.join(stage, 'CLAUDE.md'));
    } else {
      await cp(path.join(mainSource, 'main.js'), path.join(stage, 'src', 'main.js'), { force: true });
      if (files.html) await cp(path.join(profiles, files.html), path.join(stage, 'index.html'), { force: true });
    }
    for (const file of options.bare ? [] : files.demoData) {
      await cp(path.join(mainSource, file), path.join(stage, 'src', file), { force: false });
    }
    if (options.recipe.profile === '3d') {
      await cp(path.join(profiles, '3d', 'model-loader.js'), path.join(stage, 'src', 'model-loader.js'), { force: false });
      await cp(path.join(profiles, '3d', 'presentation-sky.js'), path.join(stage, 'src', 'presentation-sky.js'), { force: false });
      const presentation = JSON.parse(await readFile(path.join(mainSource, 'presentation.json'), 'utf8'));
      presentation.quality = options.quality ?? presentation.quality;
      await writeFile(path.join(stage, 'src', 'presentation.json'), JSON.stringify(presentation, null, 2) + '\n');
      const threeDest = path.join(stage, 'assets', 'vendor', 'three');
      await mkdir(threeDest, { recursive: true });
      for (const file of THREE_FILES) {
        const dest = path.join(threeDest, file);
        await mkdir(path.dirname(dest), { recursive: true });
        await cp(path.join(optionalThree, file), dest, { force: false });
      }
    }
    await writeFile(path.join(stage, 'engine.config.json'), JSON.stringify(options.recipe, null, 2) + '\n');
    if (options.preset || options.starter === 'pixi2d') {
      await writeFile(path.join(stage, 'hgame.project.json'), JSON.stringify({
        schemaVersion: 1, ...(options.preset ? { preset: options.preset } : {}), runtime: 'entry-graph',
        includeRuntime: options.starter === 'pixi2d'
          ? ['core/application.js', 'core/config.js', 'core/scene.js', 'core/component.js', 'core/entity.js', 'integrations/quality3d.js',
            ...(options.preset === 'horde' && !options.bare ? ['world/swarm-ecs.js'] : [])]
          : options.recipe.profile === '3d' ? ['integrations/sky3d.js'] : [],
        includeSource: [], assetMode: 'all',
      }, null, 2) + '\n');
      await mkdir(path.join(stage, 'assets'), { recursive: true });
      await writeFile(path.join(stage, 'assets', 'catalog.json'), JSON.stringify({
        schemaVersion: 1, assets: {}, groups: {},
      }, null, 2) + '\n');
    }

    const configFile = path.join(stage, 'game.config.json');
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    Object.assign(config, { id: options.slug, name: options.name, standalone: true,
      renderer: RENDERERS[options.recipe.renderer].catalog });
    await writeFile(configFile, JSON.stringify(config, null, 2) + '\n');
    const apiDirectory = path.join(stage, 'docs', 'api');
    const apiIndex = JSON.parse(await readFile(path.join(root, 'docs', 'api', 'API-INDEX.json'), 'utf8'));
    await mkdir(apiDirectory, { recursive: true });
    await writeFile(path.join(apiDirectory, 'API-INDEX.json'), JSON.stringify({ ...apiIndex, projectEntry }) + '\n');
    const packageFile = path.join(stage, 'package.json');
    const pkg = JSON.parse(await readFile(packageFile, 'utf8'));
    pkg.name = options.slug.toLowerCase();
    if (options.starter === 'pixi2d') {
      const pixiPackage = JSON.parse(await readFile(path.join(mainSource, 'package.json'), 'utf8'));
      pkg.dependencies = pixiPackage.dependencies;
      pkg.devDependencies = pixiPackage.devDependencies;
      pkg.scripts['build:pixi'] = 'node scripts/install-pixi-build.mjs --build';
      await writeFile(path.join(stage, '.gitattributes'), 'assets/*.js text eol=lf\nassets/*.mjs text eol=lf\nassets/*.css text eol=lf\n');
      const instructions = await readFile(path.join(mainSource, 'AGENTS.md'), 'utf8');
      await writeFile(path.join(stage, 'AGENTS.md'), (await readFile(path.join(stage, 'AGENTS.md'), 'utf8')) + '\n' + instructions);
    }
    await writeFile(packageFile, JSON.stringify(pkg, null, 2) + '\n');
    if (options.starter === 'pixi2d') {
      const seed = spawnSync(process.execPath, ['scripts/install-pixi-build.mjs', '--seed', path.join(mainSource, 'dist', 'assets')], { cwd: stage, encoding: 'utf8' });
      if (seed.error || seed.status !== 0) throw new Error('Failed to record Pixi build assets: ' + (seed.stderr || seed.error?.message || 'unknown error'));
    }
    await writeFile(path.join(stage, 'assets.manifest.json'), JSON.stringify({
      schemaVersion: 1,
      gameId: options.slug,
      storeLayout: 'cas-sha256-v1',
      remoteBaseUrl: null,
      assets: {},
    }, null, 2) + '\n');
    if (options.git) {
      const command = spawnSync('git', ['init', '-q'], { cwd: stage, encoding: 'utf8' });
      if (command.error || command.status !== 0) {
        throw new Error('git init failed: ' + (command.stderr || command.error?.message || 'unknown error'));
      }
    }
    await rename(stage, options.target);
    console.log(JSON.stringify({
      success: true, project: options.target, gameId: options.slug,
      engine: 'HGame', engineVersion: '1.0.0', profile: options.recipe.profile, bare: options.bare, features: options.recipe.features,
      physics: options.recipe.physics, standalone: true, gitInitialized: options.git,
      ...(options.preset ? { preset: options.preset, starter: options.starter, runtime: 'entry-graph' } : {}),
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
