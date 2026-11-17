#!/usr/bin/env node
// Zero-blind-scan HGame API quick lookup over docs/api/API-INDEX.json and types/.
// Usage:
//   npm run api -- <keyword>
//   npm run api -- --module <name>
//   npm run api -- --list
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'docs', 'api', 'API-INDEX.json');
const typesRoot = path.join(root, 'types');

function printUsage() {
  console.log('Usage:');
  console.log('  npm run api -- --map                 Compact intent -> module capability router');
  console.log('  npm run api -- --recipe <type>       Minimal runnable wiring for 2d|horde|3d|ui|network');
  console.log('  npm run api -- <keyword>             Search modules, exports, and summaries');
  console.log('  npm run api -- --module <name>       List exports in matching module(s)');
  console.log('  npm run api -- --list                List all indexed runtime modules');
  console.log('  Options: --json                      Emit JSON output');
}

const CAPABILITY_MAP = [
  { need: 'App loop, Scene, Entity, Tags, hitStop', module: 'index.js / core/*', keyApis: 'HGame.defineProject, createGameApplication, Scene, Entity({name}), addTag, scene.queryTags' },
  { need: 'Tweens, springs, idle/attack juice', module: 'time/tween.js', keyApis: 'scene.tweens, EASING, damp, dampAngle, SpringDamper1D/2D/3D' },
  { need: '2D sprites, camera, tilemap, A* path', module: 'integrations/canvas2d.js, animation/*, world/tilemap.js', keyApis: 'createCanvas2DAdapter, Camera2D, Sprite2D(groundShadow/hitFlash), SpriteSheet.fromGrid, findGridPath' },
  { need: '2D 5k-150k+ hordes / bullets', module: 'integrations/webgl2d.js, world/swarm-ecs.js, world/gpu-swarm-webgl2.js', keyApis: 'createWebGL2DAdapter, SpriteCrowd2D.bindSwarm/bindGpuSwarm, createSwarmSimulation, createGpuSwarmWebGL2' },
  { need: '2D ambient lighting, 32 lights, bloom', module: 'integrations/post2d.js', keyApis: 'setAmbientLight, addLight2D, setLights2D, clearLights2D, setPost2D' },
  { need: '3D sky, MegaLights, post, culling, camera', module: 'integrations/three.js, sky3d.js, lighting3d.js, post3d.js, culling3d.js, camera3d.js', keyApis: 'createThreeAdapter, createProceduralSky3D, createMegaLights3D, createPostProcessVolumeStack, createCameraRig3D' },
  { need: '3D terrain + Rapier heightfield, NavMesh', module: 'world/terrain3d.js, world/navmesh3d.js', keyApis: 'createHeightfieldTerrain3D, fbmNoise2D, scatterPositions, attachPhysics, createNavMesh3D' },
  { need: '3D rigged GLB, 17 props, VAT crowds', module: 'integrations/model3d.js, procedural-models.js, world-aligned-material.js', keyApis: 'createModel3DProvider, createProceduralModelSlots, createBoneVatCrowd3D, createWorldMaterialPalette, npm run process:model3d' },
  { need: 'Enemy/NPC AI (HFSM + Behavior Tree)', module: 'ai/index.js (ai/fsm.js, ai/bt.js)', keyApis: 'createStateMachine, createBehaviorTree, BT_STATUS, sequence, selector, parallel, cooldown, condition, action' },
  { need: 'Attributes, stackable buffs and abilities', module: 'gameplay/index.js', keyApis: 'GameplayComponent, createGameplayActor, createAttributeSet, createEffectController, createAbilitySystem' },
  { need: 'Branching dialogue, objectives and quest progression', module: 'gameplay/story.js, gameplay/quests.js', keyApis: 'createStoryRunner, createQuestLog' },
  { need: 'Zero-GC VFX, telegraphs, damage numbers', module: 'vfx/index.js', keyApis: 'createVfxSystem, emitHitImpact, slashArc, lightningBolt, spawnTelegraph, popupNumber, screenPulse, CROWD_STATUS' },
  { need: 'UI PanelStack, VirtualList, i18n, RedDot', module: 'ui/index.js, integrations/red-dot-dom.js', keyApis: 'createPanelStack, createVirtualList, createI18n, createRedDotSystem, bindRedDotDOM' },
  { need: '0-KB SFX & adaptive BGM + 3D spatial', module: 'platform/audio.js, audio/synth.js, audio/bgm-synth.js', keyApis: 'audio.playSynth(10 presets), audio.createBgm(6 moods, setIntensity), registerCue, updateListenerFromCamera' },
  { need: 'Touch, arcade P1/P2, split-screen', module: 'platform/input.js, integrations/touch-controls.js', keyApis: 'app.input.pointers, HGame.createArcadeControls, createTouchControls, HGame.computeSplitScreenViews' },
  { need: 'Rapier 2D/3D, sim RNG/checksum, Saves', module: 'physics/*, sim/*, platform/storage.js', keyApis: 'scene.physics.add, createSeededRng, hashState, createSaveStore, createVersionedStore' },
  { need: 'Verify render, playtest & release zip', module: 'scripts/*.mjs', keyApis: 'npm run snapshot -- <dir>, npm run playtest -- <dir>, npm run package:game -- <dir> --version 1.0' },
];

const RECIPES = {
  '2d': `// Create: node scripts/create-game.mjs "<dir>" --profile 2d --with audio,save --bare --name "Title"
import { HGame, Scene, Entity, Component, createVersionedStore } from '../vendor/hgame/index.js';
import { createCanvas2DAdapter, Sprite2D } from '../vendor/hgame/integrations/canvas2d.js';
import { createVfxSystem } from '../vendor/hgame/vfx/index.js';

const engineConfig = await fetch('./engine.config.json').then(r => r.json());
const canvas = document.querySelector('#game');
const project = HGame.defineProject(engineConfig);
const renderer = createCanvas2DAdapter({ canvas, width: 960, height: 540, background: '#0e131f' });
const app = HGame.createApplication({ project, gameId: 'my-2d', gameVersion: '1.0.0', renderer });
await app.installFeatures();

const scene = app.scenes.add(new Scene('main'));
const hero = scene.add(new Entity({ name: 'hero', x: 0, y: 0, width: 32, height: 32 }));
hero.addComponent(new Sprite2D({ shape: 'circle', width: 32, height: 32, color: '#60d9b7' }));
const vfx = createVfxSystem({ mode: 'canvas2d', sceneOrAdapter: renderer });
hero.addComponent(new class extends Component {
  fixedUpdate(dt) { hero.x += (app.input.isDown('KeyD') - app.input.isDown('KeyA')) * 180 * dt; vfx.update(dt); }
  onDestroy() { vfx.dispose(); }
}());
const saves = createVersionedStore({ gameId: 'my-2d', schemaVersion: 1 });
app.services.audio?.createBgm?.({ mood: 'adventure', intensity: 0.4 });
renderer.setAmbientLight('#24304a', 0.85);
app.scenes.start('main');
app.start();
canvas.dataset.engineReady = 'true';
window.__hgameState = () => ({ tick: app.stats.ticks, hero: { x: hero.x, y: hero.y } });
window.addEventListener('pagehide', () => app.dispose(), { once: true });`,
  horde: `// Create: node scripts/create-game.mjs "<dir>" --profile 2d --renderer webgl2d --with audio,save --bare --name "Horde"
import { HGame, Scene, Entity, Component, createSwarmSimulation } from '../vendor/hgame/index.js';
import { createWebGL2DAdapter, SpriteCrowd2D } from '../vendor/hgame/integrations/webgl2d.js';
import { createVfxSystem } from '../vendor/hgame/vfx/index.js';

const engineConfig = await fetch('./engine.config.json').then(r => r.json());
const canvas = document.querySelector('#game');
const project = HGame.defineProject(engineConfig);
const renderer = createWebGL2DAdapter({ canvas, width: 960, height: 540, background: '#090d16' });
const app = HGame.createApplication({ project, gameId: 'horde', gameVersion: '1.0.0', renderer });
await app.installFeatures();

const scene = app.scenes.add(new Scene('main'));
const swarm = createSwarmSimulation({ capacity: 12000, cellSize: 48, originX: -3072, originY: -3072 });
swarm.spawnWave({ count: 300, minRadius: 180, maxRadius: 260, speed: 30 });
const hordeEntity = scene.add(new Entity({ name: 'horde' }));
const crowd = hordeEntity.addComponent(new SpriteCrowd2D({ capacity: 12000, width: 12, height: 12 })).bindSwarm(swarm);
const vfx = createVfxSystem({ mode: 'webgl2d', sceneOrAdapter: renderer });
hordeEntity.addComponent(new class extends Component {
  fixedUpdate(dt) { swarm.step(dt, { heroX: 0, heroY: 0 }); vfx.update(dt); }
  onDestroy() { vfx.dispose(); }
}());
renderer.setAmbientLight('#1f263a', 0.78);
renderer.setPost2D({ bloomIntensity: 0.35, vignette: 0.25 });
app.scenes.start('main');
app.start();
canvas.dataset.engineReady = 'true';
window.__hgameState = () => ({ tick: app.stats.ticks, activeUnits: swarm.count });
window.addEventListener('pagehide', () => app.dispose(), { once: true });`,
  '3d': `// Create: node scripts/create-game.mjs "<dir>" --profile 3d --quality auto --with physics3d,audio,save --bare --name "3D"
import * as THREE from '../assets/vendor/three/three.module.js';
import { HGame, Scene, createHeightfieldTerrain3D, createNavMesh3D } from '../vendor/hgame/index.js';
import { createThreeAdapter } from '../vendor/hgame/integrations/three.js';
import { createVfxSystem } from '../vendor/hgame/vfx/index.js';

const engineConfig = await fetch('./engine.config.json').then(r => r.json());
const canvas = document.querySelector('#game');
const project = HGame.defineProject(engineConfig);
const renderer = createThreeAdapter({ THREE, canvas, quality3d: { mode: 'auto' } });
const app = HGame.createApplication({ project, gameId: 'arena-3d', gameVersion: '1.0.0', renderer });
await app.installFeatures();

const scene = app.scenes.add(new Scene('world'));
const world = renderer.getWorld(scene);
world.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.8));
const terrain = createHeightfieldTerrain3D({ width: 120, depth: 120, segmentsX: 48, segmentsZ: 48, edgeFalloff: 'island' });
world.add(terrain.createMesh(THREE).mesh);
terrain.attachPhysics(scene.physics);
const vfx = createVfxSystem({ mode: '3d', THREE, sceneOrAdapter: world });
app.scenes.start('world');
app.start();
canvas.dataset.engineReady = 'true';
window.__hgameState = () => ({ tick: app.stats.ticks, terrainMaxY: terrain.maxHeight });
window.addEventListener('pagehide', () => { vfx.dispose(); app.dispose(); }, { once: true });`,
  ui: `// Create: node scripts/create-game.mjs "<dir>" --profile ui --with audio,save --name "Card/UI"
import { HGame, Scene, createPanelStack, createI18n, createRedDotSystem, createVersionedStore } from '../vendor/hgame/index.js';

const engineConfig = await fetch('./engine.config.json').then(r => r.json()); // tickHz is 0 (command-driven)
const project = HGame.defineProject(engineConfig);
const app = HGame.createApplication({ project, gameId: 'card-ui', gameVersion: '1.0.0', renderer: { render() {} } });
await app.installFeatures();
app.scenes.add(new Scene('ui'));
const panels = createPanelStack();
const i18n = createI18n({ locale: 'zh', messages: { zh: { play: '开始' }, en: { play: 'Play' } } });
const redDots = createRedDotSystem();
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
  if (args.jsonOut) {
    console.log(JSON.stringify(CAPABILITY_MAP, null, 2));
  } else {
    console.log('=== HGame 1.0.0 Capability Map (Need -> Runtime Module -> Key APIs) ===');
    for (const row of CAPABILITY_MAP) {
      console.log(`- [${row.need}] => vendor/hgame/${row.module}`);
      console.log(`    ${row.keyApis}`);
    }
  }
  process.exit(0);
}

if (args.recipeQuery) {
  const key = args.recipeQuery.toLowerCase();
  const code = RECIPES[key];
  if (!code) {
    console.error(`Unknown recipe "${args.recipeQuery}". Valid recipes: ${Object.keys(RECIPES).join(', ')}`);
    process.exit(1);
  }
  if (args.jsonOut) {
    console.log(JSON.stringify({ recipe: key, code }, null, 2));
  } else {
    console.log(`=== HGame Recipe: ${key} ===\n${code}`);
  }
  process.exit(0);
}

if (!fs.existsSync(indexPath)) {
  console.error('Missing docs/api/API-INDEX.json. Run: npm run build:api-index');
  process.exit(1);
}

const apiIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const modules = apiIndex.modules || {};
const moduleEntries = Object.entries(modules);

if (args.listOnly) {
  const summary = moduleEntries.map(([modPath, info]) => ({
    module: modPath,
    tier: info.tier,
    exports: info.exports?.length ?? 0,
  }));
  if (args.jsonOut) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const row of summary) {
      console.log(`vendor/hgame/${row.module} (${row.tier}, ${row.exports} exports)`);
    }
  }
  process.exit(0);
}

if (!args.moduleQuery && !args.keyword) {
  printUsage();
  process.exit(1);
}

const modNeedle = args.moduleQuery.toLowerCase();
const kwNeedle = args.keyword.toLowerCase();
const matches = [];

for (const [modPath, info] of moduleEntries) {
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
    matches.push({ module: modPath, tier: info.tier, exports: matchedExports });
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
  const dtsText = readModuleDts(entry.module);
  console.log(`=== vendor/hgame/${entry.module} [${entry.tier}] ===`);
  for (const exp of entry.exports) {
    console.log(formatExport(exp, dtsText));
  }
}
