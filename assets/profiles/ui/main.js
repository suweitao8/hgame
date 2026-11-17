const hosted = location.port === '4175' && location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
const [gameConfig, engineConfig, { createGameApplication }, { defineProject }, { Scene }, { createDOMAdapter }] = await Promise.all([
  fetch('./game.config.json').then(r => r.json()),
  fetch('./engine.config.json').then(r => r.json()),
  import(base + '/core/application.js'),
  import(base + '/core/config.js'),
  import(base + '/core/scene.js'),
  import(base + '/integrations/dom.js'),
]);

const project = defineProject(engineConfig);
const count = document.querySelector('#count');
const renderer = createDOMAdapter({ render: () => { count.textContent = String(state.draws); } });
const app = createGameApplication({ project, gameId: gameConfig.id, gameVersion: gameConfig.version, renderer });
await app.installFeatures();
const state = { draws: 0 };
const scene = app.scenes.add(new Scene('cards'));
scene.onCommand = command => {
  if (command.type === 'draw') state.draws++;
};
app.scenes.start('cards');
app.start(); // No RAF: DOM updates only after commands.
document.querySelector('#draw').addEventListener('click', () => app.dispatch({ type: 'draw' }));
document.querySelector('#draw').disabled = false;
window.addEventListener('pagehide', function onPageHide(event) {
  if (event.persisted) return;
  window.removeEventListener('pagehide', onPageHide);
  app.dispose();
});
