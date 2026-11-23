#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineProject } from '../assets/runtime/core/config.js';
import { createBlueprintFromIdea, defineGameBlueprint, evaluateBlueprintBalance } from '../assets/runtime/kit/blueprint.js';
import { resolvePresentationPreset } from '../assets/runtime/kit/art-themes.js';
import { renderGameDesignDocs } from '../assets/runtime/kit/design-docs.js';
import { syncEngineFilesToProject } from './lib/engine-sync.mjs';
import { ARCHETYPE_STARTERS, getProjectPreset, PROFILE_FILES, RENDERERS } from './project-profiles.mjs';

// Completely standalone: the runtime and starter template ship with this repository.
const root = fileURLToPath(new URL('../', import.meta.url));
const template = path.join(root, 'assets', 'template');
const runtime = path.join(root, 'assets', 'runtime');
const profiles = path.join(root, 'assets', 'profiles');
const archetypesDir = path.join(root, 'assets', 'archetypes');

function parse(argv) {
  const result = { destination: '', name: '', preset: null, archetype: null, theme: null, design: null,
    profile: null, renderer: null, with: [], physics: null,
    tickHz: null, quality: null, git: true, dryRun: false, bare: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--name') {
      result.name = argv[++i] || '';
    } else if (arg === '--preset') {
      result.preset = argv[++i];
      if (!result.preset || result.preset.startsWith('-')) throw new Error('--preset requires a name');
    } else if (arg === '--archetype') {
      result.archetype = argv[++i];
      if (!result.archetype || result.archetype.startsWith('-')) throw new Error('--archetype requires a name');
    } else if (arg === '--theme') {
      result.theme = argv[++i];
      if (!result.theme || result.theme.startsWith('-')) throw new Error('--theme requires a theme id');
    } else if (arg === '--design') {
      result.design = argv[++i];
      if (!result.design || result.design.startsWith('-')) throw new Error('--design requires a JSON path');
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
  if (!result.destination) throw new Error('Usage: node create-game.mjs <new-project-path> [--archetype action-2d|horde-2d|arena-3d|card-ui --theme scifi|arcane|arcade|cyber|cozy|ink | --design <game.design.json> | --preset 2d|horde|pixi2d|3d|ui | --profile 2d|3d|ui] [--renderer canvas2d|webgl2d|threejs|dom] [--quality auto|low|medium|high|ultra] [--with save,audio,physics2d,physics3d] [--physics rapier2d|rapier3d|none] [--tick-hz 60] [--name "游戏名称"] [--bare (2d|3d)] [--no-git] [--dry-run]');

  const target = path.resolve(result.destination);
  const slug = path.basename(target);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(slug)) {
    throw new Error('Project folder must be an ASCII slug (letters, digits, - or _). Use --name for a Chinese display name.');
  }

  let inputDesign = null;
  if (result.design) {
    inputDesign = JSON.parse(readFileSync(path.resolve(result.design), 'utf8'));
    result.archetype ??= inputDesign?.meta?.genre ?? inputDesign?.genre ?? 'action-2d';
    result.theme ??= inputDesign?.art?.theme ?? inputDesign?.theme ?? null;
    if (!result.name && (inputDesign?.meta?.title || inputDesign?.title)) {
      result.name = String(inputDesign.meta?.title ?? inputDesign.title);
    }
  }
  if (result.preset && result.archetype) throw new Error('--preset cannot be combined with --archetype');
  if (result.archetype && !Object.hasOwn(ARCHETYPE_STARTERS, result.archetype)) {
    throw new Error('Unknown archetype: ' + result.archetype + '. Use ' + Object.keys(ARCHETYPE_STARTERS).join(', '));
  }

  const archSpec = result.archetype ? ARCHETYPE_STARTERS[result.archetype] : null;
  const preset = result.preset === null ? null : getProjectPreset(result.preset);
  const explicitRenderer = result.renderer !== null;
  if (preset && result.profile && result.profile !== preset.profile) throw new Error('--profile conflicts with --preset ' + result.preset);
  if (archSpec && result.profile && result.profile !== archSpec.profile) throw new Error('--profile conflicts with --archetype ' + result.archetype);
  result.profile ??= archSpec?.profile ?? preset?.profile ?? '2d';
  const usePixi = !archSpec && result.profile === '2d' && !explicitRenderer && (result.preset === null || result.preset === '2d' || result.preset === 'pixi2d' || result.preset === 'horde');
  result.renderer ??= archSpec?.renderer ?? preset?.renderer ?? null;
  if (result.profile === '2d' && result.renderer === null && result.preset === null) result.renderer = 'webgl2d';
  if (result.preset === 'pixi2d' && explicitRenderer) throw new Error('The pixi2d preset selects its own renderer; omit --renderer');
  result.quality ??= archSpec?.quality ?? preset?.quality ?? (usePixi ? 'auto' : null);
  result.tickHz ??= archSpec?.tickHz ?? null;
  result.with = [...(archSpec?.features ?? preset?.features ?? []), ...result.with];
  if (preset?.starter === 'horde' && !result.bare && result.renderer !== 'webgl2d') throw new Error('The horde starter requires webgl2d');
  if (result.bare && !['2d', '3d'].includes(result.profile)) throw new Error('--bare supports --profile 2d or 3d');
  if (result.profile === '2d' && result.tickHz === 0 && !result.bare) {
    throw new Error('--tick-hz 0 requires --bare for 2D projects because the demo uses fixed updates');
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
  physics ??= archSpec?.physics ?? preset?.physics ?? null;
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

  const starter = archSpec
    ? (result.bare ? result.profile + '-bare' : 'archetype:' + result.archetype)
    : (usePixi ? 'pixi2d' : result.bare ? result.profile + '-bare' : (result.preset === '2d' && explicitRenderer ? '2d' : preset?.starter ?? result.profile));

  const displayName = result.name || slug;
  let blueprint = null;
  if (archSpec || result.theme || inputDesign) {
    if (inputDesign) {
      blueprint = defineGameBlueprint({
        ...inputDesign,
        meta: { ...(inputDesign.meta ?? {}), id: slug, title: displayName, genre: result.archetype ?? inputDesign.meta?.genre ?? 'action-2d' },
        ...(result.theme ? { art: { ...(inputDesign.art ?? {}), theme: result.theme } } : {}),
      });
      const evalRes = evaluateBlueprintBalance(blueprint);
      if (!evalRes.ok) throw new Error('Design blueprint failed balance validation: ' + evalRes.errors.join('; '));
    } else {
      blueprint = createBlueprintFromIdea({
        id: slug,
        title: displayName,
        genre: result.archetype ?? (result.profile === '3d' ? 'arena-3d' : result.profile === 'ui' ? 'card-ui' : 'action-2d'),
        ...(result.theme ? { theme: result.theme } : {}),
      });
    }
  }
  return { ...result, target, slug, starter, archSpec, blueprint, name: displayName, recipe };
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
      ...(options.archetype ? { archetype: options.archetype, theme: options.blueprint?.art?.theme, starter: options.starter, runtime: 'entry-graph' } : {}),
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

    const isArchetype = options.starter.startsWith('archetype:');
    const archName = isArchetype ? options.starter.slice('archetype:'.length) : null;
    const mainSource = isArchetype ? path.join(archetypesDir, archName) : path.join(profiles, options.starter);
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
      await cp(path.join(mainSource, 'package-lock.json'), path.join(stage, 'package-lock.json'));
      await cp(path.join(mainSource, 'CLAUDE.md'), path.join(stage, 'CLAUDE.md'));
    } else if (isArchetype) {
      await cp(path.join(mainSource, 'main.js'), path.join(stage, 'src', 'main.js'), { force: true });
      if (archName === 'card-ui') {
        await cp(path.join(mainSource, 'index.html'), path.join(stage, 'index.html'), { force: true });
      } else {
        await cp(path.join(archetypesDir, 'action-interface.js'), path.join(stage, 'src', 'action-interface.js'));
      }
    } else {
      await cp(path.join(mainSource, 'main.js'), path.join(stage, 'src', 'main.js'), { force: true });
      if (files.html) await cp(path.join(profiles, files.html), path.join(stage, 'index.html'), { force: true });
    }
    for (const file of (options.bare || isArchetype) ? [] : files.demoData) {
      await cp(path.join(mainSource, file), path.join(stage, 'src', file), { force: false });
    }
    if (options.recipe.profile === '3d') {
      await cp(path.join(profiles, '3d', 'model-loader.js'), path.join(stage, 'src', 'model-loader.js'), { force: false });
      await cp(path.join(profiles, '3d', 'presentation-sky.js'), path.join(stage, 'src', 'presentation-sky.js'), { force: false });
      const presentation = isArchetype && options.blueprint
        ? resolvePresentationPreset(options.blueprint.art.theme, '3d', options.quality ?? 'auto')
        : JSON.parse(await readFile(path.join(profiles, options.bare ? '3d-bare' : '3d', 'presentation.json'), 'utf8'));
      presentation.quality = options.quality ?? presentation.quality;
      await writeFile(path.join(stage, 'src', 'presentation.json'), JSON.stringify(presentation, null, 2) + '\n');
    }
    if (options.blueprint) {
      await writeFile(path.join(stage, 'src', 'game.design.json'), JSON.stringify(options.blueprint, null, 2) + '\n');
    }
    await writeFile(path.join(stage, 'engine.config.json'), JSON.stringify(options.recipe, null, 2) + '\n');
    if (options.preset || options.starter === 'pixi2d' || isArchetype) {
      const presetForProject = options.preset ?? options.archSpec?.profile;
      await writeFile(path.join(stage, 'hgame.project.json'), JSON.stringify({
        schemaVersion: 1,
        ...(options.preset ? { preset: options.preset } : presetForProject && !isArchetype ? { preset: presetForProject } : {}),
        ...(isArchetype ? { archetype: options.archetype } : {}),
        runtime: 'entry-graph',
        includeRuntime: isArchetype
          ? [...options.archSpec.includeRuntime]
          : options.starter === 'pixi2d'
            ? ['core/application.js', 'core/config.js', 'core/scene.js', 'core/component.js', 'core/entity.js',
              'integrations/quality3d.js', 'integrations/draw-order-2d.js',
              ...(options.preset === 'horde' && !options.bare ? ['world/swarm-ecs.js'] : [])]
            : options.recipe.profile === '3d'
              ? (options.bare ? ['integrations/sky3d.js'] : ['integrations/sky3d.js', 'ui/ux-director.js', 'integrations/ui-ux-dom.js', 'integrations/ui-3d.js'])
              : [],
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

    const designDocsDir = path.join(stage, 'docs', 'design');
    await mkdir(designDocsDir, { recursive: true });
    const designDocs = renderGameDesignDocs({
      gameConfig: config,
      recipe: options.recipe,
      blueprint: options.blueprint,
      archetype: options.archetype,
    });
    for (const [docName, docContent] of Object.entries(designDocs)) {
      await writeFile(path.join(designDocsDir, docName), docContent);
    }
    await syncEngineFilesToProject({
      repoRoot: root,
      targetDir: stage,
      recipe: options.recipe,
      projectEntry,
      includePixi2dScripts: options.starter === 'pixi2d',
      rebuildPixi: false,
    });
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
      ...(options.archetype ? { archetype: options.archetype, theme: options.blueprint?.art?.theme, starter: options.starter, runtime: 'entry-graph' } : {}),
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
