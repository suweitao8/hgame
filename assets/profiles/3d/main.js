// Default 3D scene: native procedural geometry, continuous WORLD-ALIGNED PBR
// materials, and data-driven modular level. No MC models, UV atlases or sprites.
// Level geometry is visual-only; collisions are authored separately.
const hosted = location.port === '4175' && location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
const [
  gameConfig, engineConfig, presentation, slotConfig, materialConfig, levelConfig,
  { createGameApplication }, { defineProject }, { Component }, { Entity }, { Scene },
  { createThreeAdapter, createThreeMeshComponent },
  { createWorldMaterialPalette },
  { createProceduralModelSlots },
  { createModularLevelRenderer },
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
  import('../assets/vendor/three/three.module.js'),
]);

const project = defineProject(engineConfig);
const qualityEnabled = project.features.includes('adaptiveQuality3d');
const viewCanvas = document.querySelector('#game');
const qualitySettings = qualityEnabled ? {
  mode: gameConfig.quality3d?.mode ?? presentation.quality,
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
  await app.installFeatures();
  const loader = app.platform.assets;
  let assetCatalog = null;
  if (!app.disposed && Object.values(slotConfig.slots ?? {}).some(slot => slot?.replacementAsset !== undefined)) {
    const [{ createAssetCatalog }, catalogData] = await Promise.all([
      import(base + '/platform/asset-catalog.js'),
      loader.json('catalog.json'),
    ]);
    if (app.disposed) return;
    assetCatalog = createAssetCatalog(catalogData, { loader });
  }
  if (app.disposed) return;
  const scene = app.scenes.add(new Scene('world'));
  if (assetCatalog) scene.onDispose(() => assetCatalog.dispose());
  const world = renderer.getWorld(scene);
  const materialPalette = createWorldMaterialPalette(THREE, materialConfig.materials);
  let models;
  let levelView;
  scene.onDispose(() => {
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
  models = createProceduralModelSlots({
    THREE, slots: slotConfig.slots, materialPalette, assetCatalog, projectBaseUrl: location.href,
    async loadGLTF(url) {
      const { GLTFLoader } = await import('../assets/vendor/three/jsm/loaders/GLTFLoader.js');
      return new GLTFLoader().loadAsync(url);
    },
  });
  levelView = createModularLevelRenderer({ THREE, models, parent: world, chunkCells: presentation.chunkCells });
  const mounted = await levelView.setLevel(levelConfig);
  if (!mounted.committed || app.disposed) return;
  addPlayer(scene, levelView.level);
  app.scenes.start('world');
  app.start();
  viewCanvas.dataset.engineReady = 'true';
}

function addPlayer(scene, compiled) {
  const actor = scene.add(new Entity({
    name: 'player',
    x: compiled.playerSpawn[0], y: compiled.playerSpawn[1],
    z: compiled.playerSpawn[2],
    width: 1.2, height: 1.4, depth: 1.2,
  }));
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
  class Control extends Component {
    fixedUpdate(dt) {
      const input = this.scene.app.input;
      const dx = Number(input.isDown('KeyD') || input.isDown('ArrowRight')) -
        Number(input.isDown('KeyA') || input.isDown('ArrowLeft'));
      const dz = Number(input.isDown('KeyS') || input.isDown('ArrowDown')) -
        Number(input.isDown('KeyW') || input.isDown('ArrowUp'));
      const len = Math.hypot(dx, dz) || 1;
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
    update(dt) { this.entity.rotationY += dt * 0.4; }
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
