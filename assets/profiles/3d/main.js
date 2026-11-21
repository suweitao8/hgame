// Default 3D scene: native procedural geometry, continuous WORLD-ALIGNED PBR
// materials, and data-driven modular level. No MC models, UV atlases or sprites.
// Level geometry is visual-only; collisions are authored separately.
import { createStarterModelLoader, installStarter3DFeatures } from './model-loader.js';
import { installPresentationSky } from './presentation-sky.js';

const hosted = location.port === '4175' && location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
const [
  gameConfig, engineConfig, presentation, slotConfig, materialConfig, levelConfig,
  { createGameApplication }, { defineProject }, { Component }, { Entity }, { Scene },
  { createThreeAdapter, createThreeMeshComponent },
  { createWorldMaterialPalette },
  { createProceduralModelSlots },
  { createModularLevelRenderer },
  { createUiDirector, UI_PHASES },
  { bindUiUxDOM },
  { createWorldHud3D },
  THREE,
] = await Promise.all([
  fetch('./game.config.json').then(r => r.json()),
  fetch('./engine.config.json').then(r => r.json()),
  fetch('./src/presentation.json').then(r => r.json()),
  fetch('./src/model-slots.json').then(r => r.json()),
  fetch('./src/materials.json').then(r => r.json()),
  fetch('./src/level.json').then(r => r.json()),
  import(base + '/core/application.js'),
  import(base + '/core/config.js'),
  import(base + '/core/component.js'),
  import(base + '/core/entity.js'),
  import(base + '/core/scene.js'),
  import(base + '/integrations/three.js'),
  import(base + '/integrations/world-aligned-material.js'),
  import(base + '/integrations/procedural-models.js'),
  import(base + '/integrations/modular-level.js'),
  import(base + '/ui/ux-director.js'),
  import(base + '/integrations/ui-ux-dom.js'),
  import(base + '/integrations/ui-3d.js'),
  import('../assets/vendor/three/three.module.js'),
]);

const project = defineProject(engineConfig);
const qualityEnabled = project.features.includes('adaptiveQuality3d');
const viewCanvas = document.querySelector('#game');
const qualitySettings = qualityEnabled ? {
  mode: gameConfig.quality3d?.mode ?? presentation.quality,
  memoryBudgetBytes: presentation.renderMemoryBudgetBytes ?? null,
  residency: {
    readBytes: () => app.services.model3d?.residency.readBytes() ?? 0,
    trimIdle: bytes => app.services.model3d?.residency.trimIdle(bytes),
  },
  // Passive device hints only: never create a throwaway WebGL context just
  // to detect a GPU. Desktop with an unknown GPU begins conservatively.
  device: {
    mobile: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  },
  onChange(state) {
    viewCanvas.dataset.qualityTier = state.tier;
  },
} : null;
const renderer = createThreeAdapter({
  ...presentation.renderer,
  THREE,
  canvas: viewCanvas,
  quality3d: qualitySettings,
});
if (renderer.qualityController) {
  viewCanvas.dataset.qualityTier = renderer.qualityController.state.tier;
}
const app = createGameApplication({
  project, gameId: gameConfig.id, gameVersion: gameConfig.version, renderer,
});
function onPageHide(event) {
  if (event.persisted) return;
  window.removeEventListener('pagehide', onPageHide);
  app.dispose();
}
window.addEventListener('pagehide', onPageHide);

async function startWorld() {
  const modelLoader = createStarterModelLoader(renderer.renderer);
  await installStarter3DFeatures(app, THREE, base, modelLoader);
  const loader = app.platform.assets;
  let assetCatalog = null;
  if (!app.disposed && Object.values(slotConfig.slots ?? {}).some(slot => slot?.replacementAsset !== undefined)) {
    const [{ createAssetCatalog }, catalogData] = await Promise.all([
      import(base + '/platform/asset-catalog.js'),
      loader.json('catalog.json'),
    ]);
    if (app.disposed) return;
    assetCatalog = createAssetCatalog(catalogData, { loader, modelProvider: app.services.model3d });
  }
  if (app.disposed) return;
  const scene = app.scenes.add(new Scene('world'));
  await installPresentationSky({ app, scene, renderer, THREE, base, Component, Entity, settings: presentation.sky });
  if (app.disposed) return;
  if (assetCatalog) scene.onDispose(() => assetCatalog.dispose());
  const world = renderer.getWorld(scene);
  const materialPalette = createWorldMaterialPalette(THREE, materialConfig.materials);
  let models;
  let levelView;
  let pendingUpgrade = null;
  scene.onDispose(() => {
    if (pendingUpgrade !== null) clearTimeout(pendingUpgrade);
    renderer.unregisterMaterialPalette(materialPalette);
    try {
      levelView?.dispose();
    } finally {
      void Promise.resolve(models?.dispose())
        .finally(() => materialPalette.dispose())
        .catch(error => console.error('3D level disposal failed', error));
    }
  });
  renderer.registerMaterialPalette(materialPalette);
  const slots = slotConfig.slots;
  const startup = presentation.startupModelSlots;
  const deferredReplacements = [];
  if (startup !== undefined) {
    if (!Array.isArray(startup) || startup.some(id => typeof id !== 'string' || !Object.hasOwn(slots ?? {}, id))) {
      throw new Error('startupModelSlots must list model slot IDs');
    }
    const immediate = new Set(startup);
    for (const group of levelConfig.groups ?? []) {
      const slot = slots?.[group.slot];
      if ((slot?.replacement || slot?.replacementAsset) && !immediate.has(group.slot)) {
        immediate.add(group.slot);
        deferredReplacements.push(group.slot);
      }
    }
  }
  models = createProceduralModelSlots({
    THREE, slots: slotConfig.slots, materialPalette, assetCatalog, projectBaseUrl: location.href,
    instanceStaticModels: true, deferredReplacements,
    loadGLTF: url => modelLoader.loadAsync(url),
    acquireGLTF: app.services.model3d?.acquire,
    cloneSkeleton: async root => (await import('../assets/vendor/three/jsm/utils/SkeletonUtils.js')).clone(root),
  });
  levelView = createModularLevelRenderer({ THREE, models, parent: world, chunkCells: presentation.chunkCells });
  const mounted = await levelView.setLevel(levelConfig);
  if (!mounted.committed || app.disposed) return;
  const hudRoot = document.querySelector('#hud');
  const worldHudRoot = document.querySelector('#world-hud');
  let uiDirector = null;
  let uiUx = null;
  let worldHud = null;
  if (hudRoot && worldHudRoot) {
    hudRoot.hidden = false;
    uiDirector = createUiDirector({
      initialPhase: UI_PHASES.PLAYING,
      audio: app.platform.audio,
      metrics: { energy: { value: 100, snap: false } },
      bars: { hp: { value: 1 } },
    });
    uiUx = bindUiUxDOM({ root: hudRoot, director: uiDirector, autoRaf: false });
    worldHud = createWorldHud3D({ renderer, container: worldHudRoot, maxItems: 8 });
    scene.onDispose(() => {
      worldHud?.dispose();
      uiUx?.dispose();
      uiDirector?.dispose();
    });
  }
  addPlayer(scene, levelView.level, { uiDirector, uiUx, worldHud });
  function upgradeModels() {
    pendingUpgrade = null;
    if (app.disposed || app.scenes.current !== scene || !models.enableDeferredReplacements()) return;
    void levelView.rebuild().catch(error => {
      if (!app.disposed) console.error('3D model upgrade failed', error);
    });
  }
  if (deferredReplacements.length > 0 && project.tickHz > 0) {
    // Start after the scene has rendered once, using the application scheduler.
    const deferred = scene.add(new Entity({ name: 'deferred-model-upgrade' }));
    deferred.addComponent(new class extends Component {
      update() {
        if (!this.frames) this.frames = 0;
        if (++this.frames < 2) return;
        this.entity.destroy();
        upgradeModels();
      }
    }());
  }
  app.scenes.start('world');
  app.start();
  viewCanvas.dataset.engineReady = 'true';
  // Command-driven scenes have no frame loop, so defer once after their initial render.
  if (deferredReplacements.length > 0 && project.tickHz === 0) pendingUpgrade = setTimeout(upgradeModels, 0);
}

function addPlayer(scene, compiled, ui = {}) {
  const { uiDirector, uiUx, worldHud } = ui;
  const actor = scene.add(new Entity({
    name: 'player',
    x: compiled.playerSpawn[0], y: compiled.playerSpawn[1],
    z: compiled.playerSpawn[2],
    width: 1.2, height: 1.4, depth: 1.2,
  }));
  window.__hgameState = () => ({
    scene: app.scenes.current?.name ?? null,
    tick: app.stats.ticks,
    running: app.running,
    disposed: app.disposed,
    player: { x: +actor.x.toFixed(2), y: +actor.y.toFixed(2), z: +actor.z.toFixed(2) },
  });
  actor.addComponent(createThreeMeshComponent(THREE, {
    type: 'box', color: 0x44d0ae, size: 1.2,
  }));
  let actorBody = null;
  if (project.physics === 'rapier3d') {
    // Colliders are authored separately from visual placements.
    for (const def of compiled.colliders) {
      const [x, y, z] = def.center;
      const [width, height, depth] = def.size;
      const entity = scene.add(new Entity({
        name: 'collision:' + def.id, x, y, z, width, height, depth,
      }));
      scene.physics.add(entity, {
        static: true, sensor: def.sensor, layer: def.layer, mask: def.mask,
      });
    }
    actorBody = scene.physics.add(actor, { type: 'dynamic', gravityScale: 0, friction: 0 });
  }
  const hudAnchors = [{ id: 'player', x: 0, y: 0, z: 0, text: '◆ 100' }];
  class Control extends Component {
    fixedUpdate(dt) {
      const input = this.scene.app.input;
      let dx = Number(input.isDown('KeyD') || input.isDown('ArrowRight')) -
        Number(input.isDown('KeyA') || input.isDown('ArrowLeft'));
      let dz = Number(input.isDown('KeyS') || input.isDown('ArrowDown')) -
        Number(input.isDown('KeyW') || input.isDown('ArrowUp'));
      if (input.pointerCount > 0) {
        for (const pointer of input.pointers) {
          if (pointer.pointerType !== 'touch' || pointer.startX >= window.innerWidth / 2) continue;
          dx = (pointer.x - pointer.startX) / 48; dz = (pointer.y - pointer.startY) / 48;
          break;
        }
      }
      if (Math.abs(dx) + Math.abs(dz) > 0.05) {
        uiDirector?.notifyMoved();
      }
      const len = Math.max(1, Math.hypot(dx, dz));
      if (actorBody) {
        let vx = dx / len * 4, vz = dz / len * 4;
        if (this.entity.x + vx * dt < -3.5 || this.entity.x + vx * dt > 3.5) vx = 0;
        if (this.entity.z + vz * dt < -3.5 || this.entity.z + vz * dt > 3.5) vz = 0;
        actorBody.setVelocity({ x: vx, y: 0, z: vz });
      } else {
        this.entity.x = Math.max(-3.5, Math.min(3.5, this.entity.x + dx / len * 4 * dt));
        this.entity.z = Math.max(-3.5, Math.min(3.5, this.entity.z + dz / len * 4 * dt));
      }
    }
    update(dt) {
      this.entity.rotationY += dt * 0.4;
      uiUx?.step(dt);
      if (worldHud) {
        hudAnchors[0].x = this.entity.x;
        hudAnchors[0].y = this.entity.y + 1.25;
        hudAnchors[0].z = this.entity.z;
        worldHud.update(hudAnchors, dt);
      }
    }
  }
  actor.addComponent(new Control());
}

try {
  await startWorld();
} catch (error) {
  window.removeEventListener('pagehide', onPageHide);
  try { app.dispose(); }
  catch (cleanupError) { throw new AggregateError([error, cleanupError], '3D startup failed'); }
  throw error;
}
