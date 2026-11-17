// Bare 3D starter (create-game --bare): renderer, one light and an empty scene.
// No demo level, material palette or model slots.
const [gameConfig, engineConfig] = await Promise.all([
  fetch('./game.config.json').then(r => r.json()),
  fetch('./engine.config.json').then(r => r.json()),
]);
const hosted = location.port === '4175' && location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
const [{ HGame, Scene }, { createThreeAdapter }, THREE] = await Promise.all([
  import(base + '/index.js'),
  import(base + '/integrations/three.js'),
  import('../assets/vendor/three/three.module.js'),
]);

const defaultQualityMode = "auto";
const project = HGame.defineProject(engineConfig);
const viewCanvas = document.querySelector('#game');
const qualityEnabled = project.features.includes('adaptiveQuality3d');
const renderer = createThreeAdapter({
  THREE,
  canvas: viewCanvas,
  quality3d: qualityEnabled ? { mode: gameConfig.quality3d?.mode ?? defaultQualityMode } : null,
});
renderer.camera.position.set(0, 4, 8);
renderer.camera.lookAt(0, 0, 0);
viewCanvas.dataset.qualityTier = renderer.qualityController?.state.tier ?? 'high';

const app = HGame.createApplication({
  project, gameId: gameConfig.id, gameVersion: gameConfig.version, renderer,
});
await app.installFeatures();
const scene = app.scenes.add(new Scene('world'));
const world = renderer.getWorld(scene);
world.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2));
// TODO: add entities/components to `scene` here.
app.scenes.start('world');
app.start();
viewCanvas.dataset.engineReady = 'true';
window.__hgameState = () => ({ scene: app.scenes.current?.name ?? null });
window.addEventListener('pagehide', function onPageHide(event) {
  if (event.persisted) return;
  window.removeEventListener('pagehide', onPageHide);
  app.dispose();
});
