// Bare 2D starter (create-game --bare): configs + an empty scene only.
const hosted = location.port === '4175' && location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
const [gameConfig, engineConfig, { createGameApplication }, { defineProject }, { Scene }] = await Promise.all([
  fetch('./game.config.json').then(r => r.json()),
  fetch('./engine.config.json').then(r => r.json()),
  import(base + '/core/application.js'),
  import(base + '/core/config.js'),
  import(base + '/core/scene.js'),
]);

const project = defineProject(engineConfig);
const canvas = document.querySelector('#game');
let renderer;
if (project.renderer === 'webgl2d') {
  const mod = await import(base + '/integrations/webgl2d.js');
  renderer = mod.createWebGL2DAdapter({ canvas, width: 960, height: 540 });
} else {
  const mod = await import(base + '/integrations/canvas2d.js');
  renderer = mod.createCanvas2DAdapter({ canvas, width: 960, height: 540 });
}
const app = createGameApplication({ project, gameId: gameConfig.id, gameVersion: gameConfig.version, renderer });
await app.installFeatures();

const scene = app.scenes.add(new Scene('main'));
// TODO: add entities/components to `scene` here.
app.scenes.start('main');
app.start();
canvas.dataset.engineReady = 'true';
window.__hgameState = () => ({
  scene: app.scenes.current?.name ?? null,
  tick: app.stats.ticks,
  running: app.running,
  disposed: app.disposed,
});
window.addEventListener('pagehide', function onPageHide(event) {
  if (event.persisted) return;
  window.removeEventListener('pagehide', onPageHide);
  app.dispose();
});
