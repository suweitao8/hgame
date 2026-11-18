#!/usr/bin/env node
// Zero-blind-scan HGame API quick lookup over docs/api/API-INDEX.json and types/.
// Usage:
//   npm run api -- <keyword>
//   npm run api -- --module <name>
//   npm run api -- --list
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recipeCreateCommand } from './project-profiles.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'docs', 'api', 'API-INDEX.json');
const vendorRoot = path.join(root, 'vendor', 'hgame');
const standalone = fs.existsSync(path.join(vendorRoot, 'VERSION'));
const typesRoot = standalone ? vendorRoot : path.join(root, 'types');

function printUsage() {
  console.log('Usage:');
  console.log('  npm run api -- --map                 Compact intent -> module capability router');
  console.log(standalone
    ? '  npm run api -- --recipe current      Show the source entry selected at project creation'
    : '  npm run api -- --recipe <type>       Minimal runnable wiring for 2d|horde|3d|ui|network');
  console.log('  npm run api -- <keyword>             Search modules, exports, and summaries');
  console.log('  npm run api -- --module <name>       List exports in matching module(s)');
  console.log('  npm run api -- --list                List all indexed runtime modules');
  console.log('  Options: --json                      Emit JSON output');
}

const CAPABILITY_MAP = [
  { need: 'Default 2D PixiJS rendering, input and effects', module: 'generated project src/engine/*', keyApis: 'startPixiGame, Renderer2D, createSwarmLayer, ProceduralAtlas.registerSheet, createCatalogGameAtlas, JuiceSystem, InputAndAudio; npm run api -- --recipe 2d' },
  { need: 'Logical media IDs, scoped loading and release asset selection', module: 'platform/asset-catalog.js', keyApis: 'createAssetCatalog, openScope, loadGroup, projectPath, assets/catalog.json' },
  { need: 'Preload and switch levels with shared scene assets', module: 'world/level-flow.js', keyApis: 'createLevelFlow, prefetch, go, cancel, discard' },
  { need: 'App loop, Scene, Entity, Tags, hitStop', module: 'index.js / core/*', keyApis: 'HGame.defineProject, createGameApplication, Scene, Entity({name}), addTag, scene.queryTags' },
  { need: 'Tweens, springs, idle/attack juice', module: 'time/tween.js', keyApis: 'scene.tweens, EASING, damp, dampAngle, SpringDamper1D/2D/3D' },
  { need: 'Pixi tilemap rendering and A* path', module: 'generated project src/engine/PixiTilemapLayer.js; runtime world/tilemap.js', keyApis: 'renderer.createTilemapLayer, refreshTile, TileMap, findGridPath' },
  { need: 'Legacy Canvas 2D sprites and camera', module: 'integrations/canvas2d.js, animation/*', keyApis: 'createCanvas2DAdapter, Camera2D, Sprite2D, SpriteSheet.fromGrid' },
  { need: '2D CPU swarms with PixiJS', module: 'world/swarm-ecs.js, generated project src/engine/PixiSwarmLayer.js', keyApis: 'createSwarmSimulation, renderer.createSwarmLayer, crowd.sync; npm run api -- --recipe horde' },
  { need: 'Legacy 2D GPU swarms / bullets', module: 'integrations/webgl2d.js, world/gpu-swarm-webgl2.js', keyApis: 'createWebGL2DAdapter, SpriteCrowd2D.bindGpuSwarm, createGpuSwarmWebGL2' },
  { need: 'Legacy Canvas/WebGL2D lighting and post effects', module: 'integrations/post2d.js', keyApis: 'setAmbientLight, addLight2D, setLights2D, clearLights2D, setPost2D (not the Pixi starter)' },
  { need: '3D presentation, sky, lights, post, culling, camera', module: 'integrations/three.js, sky3d.js, lighting3d.js, post3d.js, culling3d.js, camera3d.js', keyApis: 'src/presentation.json (3D starter), createThreeAdapter, createProceduralSky3D, createMegaLights3D, createPostProcessVolumeStack, createCameraRig3D' },
  { need: '3D terrain + Rapier heightfield, NavMesh', module: 'world/terrain3d.js, world/navmesh3d.js', keyApis: 'createHeightfieldTerrain3D, fbmNoise2D, scatterPositions, attachPhysics, createNavMesh3D' },
  { need: '3D rigged GLB, 17 props, VAT crowds', module: 'integrations/model3d.js, procedural-models.js, world-aligned-material.js', keyApis: 'createModel3DProvider, createProceduralModelSlots, createBoneVatCrowd3D, createWorldMaterialPalette, npm run process:model3d' },
  { need: 'Enemy/NPC AI (HFSM + Behavior Tree)', module: 'ai/index.js (ai/fsm.js, ai/bt.js)', keyApis: 'createStateMachine, createBehaviorTree, BT_STATUS, sequence, selector, parallel, cooldown, condition, action' },
  { need: 'Attributes, stackable buffs and abilities', module: 'gameplay/index.js', keyApis: 'GameplayComponent, createGameplayActor, createAttributeSet, createEffectController, createAbilitySystem' },
  { need: 'Sync skill impact, recovery, animation, audio and effect cues', module: 'gameplay/abilities.js', keyApis: 'AbilityDefinition.timeline, GameplayActorOptions.onTimeline' },
  { need: 'Branching dialogue, objectives and quest progression', module: 'gameplay/story.js, gameplay/quests.js', keyApis: 'createStoryRunner, createQuestLog' },
  { need: 'Item stacks, equipment, exchanges and quest rewards', module: 'gameplay/inventory.js', keyApis: 'createInventory, transact, equip, claimQuestRewards' },
  { need: 'Weighted loot, pending loot claims and crafting recipes', module: 'gameplay/loot.js, gameplay/crafting.js', keyApis: 'createLootSystem, createCraftingBook' },
  { need: 'Encounter waves, clear gates, survival and checkpoints', module: 'gameplay/encounters.js', keyApis: 'EncounterComponent, createEncounterDirector' },
  { need: 'Data-driven prefab placement, spawn points and trigger volumes', module: 'world/level.js, world/trigger-volumes.js', keyApis: 'mountLevel, createTriggerVolumes, spawnBatch, updateEntityTriggers' },
  { need: 'Zero-GC VFX, telegraphs, damage numbers', module: 'vfx/index.js', keyApis: 'createVfxSystem, emitHitImpact, slashArc, lightningBolt, spawnTelegraph, popupNumber, screenPulse, CROWD_STATUS' },
  { need: 'UI PanelStack, VirtualList, i18n, RedDot', module: 'ui/index.js, integrations/red-dot-dom.js', keyApis: 'createPanelStack, createVirtualList, createI18n, createRedDotSystem, bindRedDotDOM' },
  { need: '0-KB SFX & adaptive BGM + 3D spatial', module: 'platform/audio.js, audio/synth.js, audio/bgm-synth.js', keyApis: 'audio.playSynth(10 presets), audio.createBgm(6 moods, setIntensity), registerCue, updateListenerFromCamera' },
  { need: 'Touch, arcade P1/P2, split-screen', module: 'platform/input.js, integrations/touch-controls.js', keyApis: 'app.input.pointers, HGame.createArcadeControls, createTouchControls, HGame.computeSplitScreenViews' },
  { need: 'Rapier 2D/3D, sim RNG/checksum, Saves', module: 'physics/*, sim/*, platform/storage.js', keyApis: 'scene.physics.add, createSeededRng, hashState, createSaveStore, createVersionedStore' },
  { need: 'Verify render, playtest & release zip', module: 'scripts/*.mjs', keyApis: 'npm run snapshot -- <dir>, npm run playtest -- <dir>, npm run package:game -- <dir> --version 1.0' },
];

const RECIPES = {
  '2d': () => `// Create: ${recipeCreateCommand('2d')}\n// The generated src/bare.js is the empty PixiJS scene entry.\n${fs.readFileSync(path.join(root, 'assets/profiles/pixi2d/src/bare.js'), 'utf8')}`,
  horde: () => `// Create: ${recipeCreateCommand('horde')}\n// Generated src/horde.js connects the HGame CPU swarm to PixiJS.\n${fs.readFileSync(path.join(root, 'assets/profiles/pixi2d/src/horde.js'), 'utf8')}`,
  '3d': `// Create: ${recipeCreateCommand('3d')}
import * as THREE from '../assets/vendor/three/three.module.js';
import { defineProject } from '../vendor/hgame/core/config.js';
import { createGameApplication } from '../vendor/hgame/core/application.js';
import { Scene } from '../vendor/hgame/core/scene.js';
import { createHeightfieldTerrain3D } from '../vendor/hgame/world/terrain3d.js';
import { createThreeAdapter } from '../vendor/hgame/integrations/three.js';
import { createVfxSystem } from '../vendor/hgame/vfx/index.js';

const [engineConfig, presentation] = await Promise.all([
  fetch('./engine.config.json').then(r => r.json()),
  fetch('./src/presentation.json').then(r => r.json()),
]);
const canvas = document.querySelector('#game');
const project = defineProject(engineConfig);
const renderer = createThreeAdapter({
  ...presentation.renderer, THREE, canvas,
  quality3d: project.features.includes('adaptiveQuality3d') ? { mode: presentation.quality } : null,
});
const app = createGameApplication({ project, gameId: 'arena-3d', gameVersion: '1.0.0', renderer });
await app.installFeatures();

const scene = app.scenes.add(new Scene('world'));
const world = renderer.getWorld(scene);
const terrain = createHeightfieldTerrain3D({ width: 120, depth: 120, segmentsX: 48, segmentsZ: 48, edgeFalloff: 'island' });
world.add(terrain.createMesh(THREE).mesh);
terrain.attachPhysics(scene.physics);
const vfx = createVfxSystem({ mode: '3d', THREE, sceneOrAdapter: world });
scene.onDispose(() => vfx.dispose());
app.scenes.start('world');
app.start();
canvas.dataset.engineReady = 'true';
window.__hgameState = () => ({ tick: app.stats.ticks, terrainMaxY: terrain.maxHeight });
window.addEventListener('pagehide', event => { if (!event.persisted) app.dispose(); });`,
  ui: `// Create: ${recipeCreateCommand('ui')}
import { defineProject } from '../vendor/hgame/core/config.js';
import { createGameApplication } from '../vendor/hgame/core/application.js';
import { Scene } from '../vendor/hgame/core/scene.js';
import { createPanelStack, createI18n } from '../vendor/hgame/ui/index.js';
import { createVersionedStore } from '../vendor/hgame/platform/storage.js';

const engineConfig = await fetch('./engine.config.json').then(r => r.json()); // tickHz is 0 (command-driven)
const project = defineProject(engineConfig);
const app = createGameApplication({ project, gameId: 'card-ui', gameVersion: '1.0.0', renderer: { render() {} } });
await app.installFeatures();
app.scenes.add(new Scene('ui'));
const panels = createPanelStack();
const i18n = createI18n({ locale: 'zh', messages: { zh: { play: '开始' }, en: { play: 'Play' } } });
const saves = createVersionedStore({ gameId: 'card-ui', schemaVersion: 1 });
app.scenes.start('ui');
app.start(); // renders once; dispatch updates via app.dispatch(...), never run an idle 60Hz loop
window.__hgameState = () => ({ topPanel: panels.top()?.id ?? null, locale: i18n.getLocale() });
window.addEventListener('pagehide', () => { panels.dispose(); app.dispose(); }, { once: true });`,
  network: `// Client connects to workspace network/ (@hgame/network-client). Use StateSyncRoom or LockstepRoom.
// Run server checks from engine root: npm run check:all
import { hashState } from '../vendor/hgame/index.js';
import { createConfirmedFrameScheduler } from '../vendor/hgame/lockstep/confirmed-frames.js';
// Keep authoritative rules in game src/; lockstep offline/online both keep pinned Rapier 0.21.0 determinism.`,
};

function parseArgs(argv) {
  let moduleQuery = '';
  let recipeQuery = '';
  let listOnly = false;
  let mapOnly = false;
  let jsonOut = false;
  const keywords = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--module' || a === '-m') {
      moduleQuery = argv[++i] ?? '';
    } else if (a === '--recipe' || a === '-r') {
      recipeQuery = argv[++i] ?? '';
    } else if (a === '--list' || a === '-l') {
      listOnly = true;
    } else if (a === '--map') {
      mapOnly = true;
    } else if (a === '--json') {
      jsonOut = true;
    } else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    } else {
      keywords.push(a);
    }
  }
  return { moduleQuery, recipeQuery, listOnly, mapOnly, jsonOut, keyword: keywords.join(' ').trim() };
}

function extractDtsSignature(dtsText, exportName) {
  if (!dtsText) return null;
  const escaped = exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`export\\s+(?:function|class|const|declare\\s+(?:function|class|const))\\s+${escaped}\\b[^;{]*`, 'm');
  const m = re.exec(dtsText);
  if (!m) return null;
  return m[0].replace(/\s+/g, ' ').trim();
}

function readModuleDts(modPath) {
  const relDts = modPath.replace(/\.m?js$/i, '.d.ts');
  const absDts = path.join(typesRoot, relDts);
  if (!fs.existsSync(absDts)) return '';
  return fs.readFileSync(absDts, 'utf8');
}

function formatExport(exp, dtsText) {
  const sig = exp.signature ? `${exp.name}${exp.signature}` : exp.name;
  const dtsSig = extractDtsSignature(dtsText, exp.name);
  const lines = [`  [${exp.kind}] ${sig}`];
  if (exp.tier) lines.push(`    stability: ${exp.tier} (declared in ${exp.declaredIn})`);
  if (dtsSig && dtsSig.length <= 200 && dtsSig !== sig) {
    lines.push(`    dts: ${dtsSig}`);
  }
  if (exp.summary) {
    lines.push(`    doc: ${exp.summary}`);
  }
  if (exp.returns?.length) {
    lines.push(`    returns: ${exp.returns.join(', ')}`);
  }
  if (exp.members?.length) {
    lines.push(`    members: ${exp.members.join(', ')}`);
  }
  if (exp.static?.length) {
    lines.push(`    static: ${exp.static.join(', ')}`);
  }
  if (exp.keys?.length && exp.keys.length <= 24) {
    lines.push(`    keys: ${exp.keys.join(', ')}`);
  }
  return lines.join('\n');
}

const args = parseArgs(process.argv.slice(2));

if (args.mapOnly) {
  const hasPixi = fs.existsSync(path.join(root, 'src', 'engine', 'Renderer2D.js'));
  const map = standalone
    ? CAPABILITY_MAP
      .filter(row => !row.module.includes('generated project') || hasPixi)
      .map(row => row.module === 'scripts/*.mjs'
        ? { need: 'Package the game', module: 'scripts/package-game.mjs', keyApis: 'npm run release -- --version 1.0' }
        : { ...row, keyApis: row.keyApis.replace(/; npm run (?:api -- --recipe \w+|process:model3d)$/, '') })
    : CAPABILITY_MAP;
  if (args.jsonOut) {
    console.log(JSON.stringify(map, null, 2));
  } else {
    console.log('=== HGame 1.0.0 Capability Map (Need -> Runtime Module -> Key APIs) ===');
    for (const row of map) {
      console.log(`- [${row.need}] => ${row.module}`);
      console.log(`    ${row.keyApis}`);
    }
  }
  process.exit(0);
}

if (args.recipeQuery) {
  const key = args.recipeQuery.toLowerCase();
  const validRecipes = standalone ? ['current'] : Object.keys(RECIPES);
  if (!validRecipes.includes(key)) {
    console.error(`Unknown recipe "${args.recipeQuery}". Valid recipes: ${validRecipes.join(', ')}`);
    process.exit(1);
  }
  let entry;
  let code;
  if (standalone) {
    ({ projectEntry: entry } = readApiIndex());
    if (typeof entry !== 'string' || !/^src\/[\w-]+\.js$/.test(entry) || !fs.existsSync(path.join(root, entry))) {
      console.error('The starter entry recorded in docs/api/API-INDEX.json is missing or invalid.');
      process.exit(1);
    }
    code = fs.readFileSync(path.join(root, entry), 'utf8');
  } else {
    const recipe = RECIPES[key];
    code = typeof recipe === 'function' ? recipe() : recipe;
  }
  if (args.jsonOut) {
    console.log(JSON.stringify({ recipe: key, ...(entry ? { entry } : {}), code }, null, 2));
  } else {
    console.log(`=== HGame Recipe: ${entry ?? key} ===\n${code}`);
  }
  process.exit(0);
}

function readApiIndex() {
  if (!fs.existsSync(indexPath)) {
    console.error(standalone
      ? 'Missing docs/api/API-INDEX.json. Restore the API index from the engine version used to create the project.'
      : 'Missing docs/api/API-INDEX.json. Run: npm run build:api-index');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
}

const apiIndex = readApiIndex();
const modules = apiIndex.modules || {};
// These adapters belong to generated games rather than the renderer-neutral runtime.
// Include them in the same lookup without pretending they are vendor/hgame modules.
const pixiStarterModules = {
  'src/engine/startPixiGame.js': { exports: [
    { kind: 'function', name: 'startPixiGame', signature: '(setup, {mount, createAtlas, rendererOptions}={})', summary: 'Start the Pixi renderer and HGame loop. The setup callback returns { scene, state?, visibility? }.', returns: ['app', 'renderer'] },
    { kind: 'function', name: 'loadRuntime', signature: '(module)', summary: 'Import an HGame runtime module by its path, using the starter host configuration.' },
    { kind: 'function', name: 'readGameJson', signature: '(path)', summary: 'Load a JSON file relative to the game document and report HTTP errors.' },
  ] },
  'src/engine/Renderer2D.js': { exports: [{ kind: 'class', name: 'Renderer2D', signature: 'new(atlas, {maxPixels, maxPixelRatio, qualityController, qualityPresets}={})', summary: 'PixiJS starter renderer and camera; takes ownership of the atlas.', members: ['init', 'resize', 'resetQualityMeasurements', 'setQuality', 'setBloom', 'setEffectFilters', 'onBeforeRender', 'createSwarmLayer', 'createTilemapLayer', 'syncEntity', 'releaseEntity', 'update', 'screenToWorld', 'worldToScreen', 'render', 'dispose'] }] },
  'src/engine/ProceduralAtlas.js': { exports: [
    { kind: 'class', name: 'ProceduralAtlas', signature: 'new(size=1024)', summary: 'PixiJS shared atlas with optional white hit-flash frames.', members: ['register', 'registerImage', 'registerSheet', 'build', 'get', 'dispose'] },
    { kind: 'function', name: 'createDefaultGameAtlas', signature: '({playerImage, enemyImage, eliteImage, extraFrames, size}={})', summary: 'Create and build the PixiJS starter atlas.' },
    { kind: 'function', name: 'createCatalogGameAtlas', signature: '(catalog, frames, {size, signal}={})', summary: 'Bake catalog images and sprite sheets into a PixiJS atlas; releases the temporary asset scope.' },
  ] },
  'src/engine/PixiSwarmLayer.js': { exports: [{ kind: 'class', name: 'PixiSwarmLayer', signature: 'new(renderer, options)', summary: 'PixiJS adapter for an HGame CPU swarm; create with renderer.createSwarmLayer(options).', members: ['sync', 'dispose'] }] },
  'src/engine/PixiTilemapLayer.js': { exports: [{ kind: 'class', name: 'PixiTilemapLayer', signature: 'new(renderer, map, {frames, layer, chunkSize, maxCachedChunks, originX, originY})', summary: 'PixiJS atlas-backed HGame TileMap rendering; create with renderer.createTilemapLayer(map, options).', members: ['setTile', 'setTiles', 'refreshTile', 'update', 'dispose'] }] },
  'src/engine/JuiceSystem.js': { exports: [{ kind: 'class', name: 'JuiceSystem', signature: 'new(renderer, capacity=10000, {maxShockwaveFilters=3}={})', summary: 'PixiJS starter hit effects, particles, shake and trails; dispose before the renderer.', members: ['triggerHitJuice', 'triggerHitStop', 'addTrauma', 'spawnShockwave', 'burstParticles', 'spawnExplosions', 'update', 'slash', 'dispose'] }] },
  'src/engine/InputAndAudio.js': { exports: [{ kind: 'class', name: 'InputAndAudio', signature: 'new(renderer, ui, audio, input)', summary: 'PixiJS demo input helper using HGame input and audio services.', members: ['getState', 'reset', 'unlock', 'play', 'dispose'] }] },
};
const moduleEntries = [
  ...Object.entries(modules)
    .filter(([name]) => !standalone || fs.existsSync(path.join(vendorRoot, name)))
    .map(([name, info]) => [name, info, 'runtime']),
  ...Object.entries(pixiStarterModules)
    .filter(([name]) => !standalone || fs.existsSync(path.join(root, name)))
    .map(([name, info]) => [name, { ...info, tier: 'starter' }, 'pixi-starter']),
];
const displayModule = (name, source) => source === 'pixi-starter'
  ? (standalone ? name : `generated game ${name}`)
  : `vendor/hgame/${name}`;

if (args.listOnly) {
  const summary = moduleEntries.map(([modPath, info, source]) => ({
    module: modPath,
    tier: info.tier,
    exports: info.exports?.length ?? 0,
    source,
  }));
  if (args.jsonOut) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const row of summary) {
      console.log(`${displayModule(row.module, row.source)} (${row.tier}, ${row.exports} exports)`);
    }
  }
  process.exit(0);
}

if (!args.moduleQuery && !args.keyword) {
  printUsage();
  process.exit(1);
}

const modNeedle = args.moduleQuery.toLowerCase().replaceAll('\\', '/')
  .replace(/^(?:\.\.?\/)+/, '').replace(/^vendor\/hgame\//, '');
const kwNeedle = args.keyword.toLowerCase();
const matches = [];

for (const [modPath, info, source] of moduleEntries) {
  const modLower = modPath.toLowerCase();
  if (modNeedle && !modLower.includes(modNeedle)) continue;

  const exportsList = info.exports || [];
  let matchedExports = exportsList;
  if (kwNeedle) {
    const modMatches = modLower.includes(kwNeedle);
    matchedExports = exportsList.filter((exp) => {
      if (modMatches && !args.moduleQuery && modLower !== 'index.js') return true;
      return (
        exp.name.toLowerCase().includes(kwNeedle) ||
        (exp.summary || '').toLowerCase().includes(kwNeedle) ||
        (exp.returns || []).some((r) => r.toLowerCase().includes(kwNeedle)) ||
        (exp.members || []).some((m) => m.toLowerCase().includes(kwNeedle))
      );
    });
  }

  if (matchedExports.length > 0) {
    matches.push({ module: modPath, tier: info.tier, source, exports: matchedExports });
  }
}

if (args.jsonOut) {
  console.log(JSON.stringify({ query: args, matches }, null, 2));
  process.exit(0);
}

if (matches.length === 0) {
  console.log(`No API matches found for ${args.moduleQuery ? `--module ${args.moduleQuery}` : args.keyword}`);
  process.exit(0);
}

for (const entry of matches) {
  const dtsText = entry.source === 'runtime' ? readModuleDts(entry.module) : '';
  console.log(`=== ${displayModule(entry.module, entry.source)} [${entry.tier}] ===`);
  for (const exp of entry.exports) {
    console.log(formatExport(exp, dtsText));
  }
}
