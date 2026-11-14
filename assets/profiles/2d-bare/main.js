// Bare 2D starter (create-game --bare): configs + an empty scene only.
const [gameConfig, engineConfig] = await Promise.all([
  fetch('./game.config.json').then(r => r.json()),
  fetch('./engine.config.json').then(r => r.json()),
]);
const hosted = location.port === '4175' && location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
const { HGame, Scene } = await import(base + '/index.js');

const project = HGame.defineProject(engineConfig);
const canvas = document.querySelector('#game');
let renderer;
if (project.renderer === 'webgl2d') {
  const mod = await import(base + '/integrations/webgl2d.js');
  renderer = mod.createWebGL2DAdapter({ canvas, width: 960, height: 540 });
} else {
  const mod = await import(base + '/integrations/canvas2d.js');
  renderer = mod.createCanvas2DAdapter({ canvas, width: 960, height: 540 });
}
const app = HGame.createApplication({ project, gameId: gameConfig.id, gameVersion: gameConfig.version, renderer });
await app.installFeatures();

const scene = app.scenes.add(new Scene('main'));
// TODO: add entities/components to `scene` here.
app.scenes.start('main');
app.start();
canvas.dataset.engineReady = 'true';
window.addEventListener('pagehide', () => app.dispose(), { once: true });
