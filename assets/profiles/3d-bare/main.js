// Bare 3D starter (create-game --bare): renderer, one light and an empty scene.
// No demo level, material palette or model slots.
const hosted = location.port === '4175' && location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
const [gameConfig, engineConfig, presentation,
  { createGameApplication }, { defineProject }, { Scene }, { createThreeAdapter }, THREE] = await Promise.all([
  fetch('./game.config.json').then(r => r.json()),
  fetch('./engine.config.json').then(r => r.json()),
  fetch('./src/presentation.json').then(r => r.json()),
  import(base + '/core/application.js'),
  import(base + '/core/config.js'),
  import(base + '/core/scene.js'),
  import(base + '/integrations/three.js'),
  import('../assets/vendor/three/three.module.js'),
]);

const project = defineProject(engineConfig);
const viewCanvas = document.querySelector('#game');
const qualityEnabled = project.features.includes('adaptiveQuality3d');
const renderer = createThreeAdapter({
  ...presentation.renderer,
  THREE,
  canvas: viewCanvas,
  quality3d: qualityEnabled ? {
    mode: gameConfig.quality3d?.mode ?? presentation.quality,
    device: {
      mobile: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    },
    onChange(state) { viewCanvas.dataset.qualityTier = state.tier; },
  } : null,
});
viewCanvas.dataset.qualityTier = renderer.qualityController?.state.tier ?? 'high';

const app = createGameApplication({
  project, gameId: gameConfig.id, gameVersion: gameConfig.version, renderer,
});
await app.installFeatures();
app.scenes.add(new Scene('world'));
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
