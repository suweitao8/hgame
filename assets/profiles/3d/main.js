// Default 3D scene: native procedural geometry, continuous WORLD-ALIGNED PBR
// materials, and data-driven modular level. No MC models, UV atlases or sprites.
// Level geometry is visual-only; collisions are authored separately.
const [gameConfig, engineConfig, slotConfig, materialConfig, levelConfig] = await Promise.all([
  fetch('./game.config.json').then(r => r.json()),
  fetch('./engine.config.json').then(r => r.json()),
  fetch('./src/model-slots.json').then(r => r.json()),
  fetch('./src/materials.json').then(r => r.json()),
  fetch('./src/level.json').then(r => r.json()),
]);
const hosted = location.port === '4175' && location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
const [
  { HGame, Component, Entity, Scene },
  { createThreeAdapter, createThreeMeshComponent },
  { createWorldMaterialPalette },
  { createProceduralModelSlots },
  { compileModularLevel, createModularLevelRenderer },
  { GLTFLoader }, THREE,
] = await Promise.all([
  import(base + '/index.js'),
  import(base + '/integrations/three.js'),
  import(base + '/integrations/world-aligned-material.js'),
  import(base + '/integrations/procedural-models.js'),
  import(base + '/integrations/modular-level.js'),
  import('../assets/vendor/three/jsm/loaders/GLTFLoader.js'),
  import('../assets/vendor/three/three.module.js'),
]);

const defaultQualityMode = "auto";
const project = HGame.defineProject(engineConfig);
const qualityEnabled = project.features.includes('adaptiveQuality3d');
const viewCanvas = document.querySelector('#game');
const qualitySettings = qualityEnabled ? {
  mode: gameConfig.quality3d?.mode ?? defaultQualityMode,
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
  THREE,
  canvas: viewCanvas,
  quality3d: qualitySettings,
  shadows: true,
  toneMapping: 'ueFilmic',
  exposure: 1.15,
});
if (renderer.qualityController) {
  viewCanvas.dataset.qualityTier = renderer.qualityController.state.tier;
}
renderer.camera.position.set(9, 8.5, 12);
renderer.camera.lookAt(0, 1, 0);

const app = HGame.createApplication({
  project, gameId: gameConfig.id, gameVersion: gameConfig.version, renderer,
});
await app.installFeatures();
const scene = app.scenes.add(new Scene('world'));
const world = renderer.getWorld(scene);
world.background = new THREE.Color(0x8eafc2);
world.fog = new THREE.Fog(0x8eafc2, 17, 50);
world.add(new THREE.HemisphereLight(0xffffff, 0x61707b, 2.0));
const sun = new THREE.DirectionalLight(0xfff3dd, 2.6);
sun.position.set(7, 13, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -13;
sun.shadow.camera.right = 13;
sun.shadow.camera.top = 13;
sun.shadow.camera.bottom = -13;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 45;
sun.shadow.bias = -0.0002;
renderer.setSunLight(sun);
world.add(sun);

// World-position mapping means adjacent tiles use one continuous projected
// texture coordinate frame regardless of individual cube UVs/mesh positions.
const materialPalette = createWorldMaterialPalette(THREE, materialConfig.materials);
renderer.registerMaterialPalette(materialPalette);
const models = createProceduralModelSlots({
  THREE, slots: slotConfig.slots, materialPalette, GLTFLoader,
  projectBaseUrl: location.href,
});
const compiled = compileModularLevel(levelConfig);
const levelView = createModularLevelRenderer({ THREE, models, parent: world });
await levelView.setLevel(levelConfig);

// A neutral player test mesh; no character rig is coupled to the environment.
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
  // Explicit level collider metadata: changing a texture/material never
  // changes gameplay collisions or authoritative world state.
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
app.scenes.start('world');
app.start();
// Async material generation and level assembly may complete after DOM load.
// Host/browser QA must wait for a genuine started scene before sending input.
document.querySelector('#game').dataset.engineReady = 'true';
window.addEventListener('pagehide', function onPageHide(event) {
  if (event.persisted) return;
  window.removeEventListener('pagehide', onPageHide);
  app.dispose();
  levelView.dispose();
  void models.dispose().finally(() => materialPalette.dispose());
});
