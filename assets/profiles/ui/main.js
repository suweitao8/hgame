const hosted = location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
const [
  gameConfig, engineConfig,
  { createGameApplication }, { defineProject }, { Scene },
  { createDOMAdapter }, { createUiDirector, UI_PHASES, UI_UX_CUES }, { bindUiUxDOM },
] = await Promise.all([
  fetch('./game.config.json').then(r => r.json()),
  fetch('./engine.config.json').then(r => r.json()),
  import(base + '/core/application.js'),
  import(base + '/core/config.js'),
  import(base + '/core/scene.js'),
  import(base + '/integrations/dom.js'),
  import(base + '/ui/ux-director.js'),
  import(base + '/integrations/ui-ux-dom.js'),
]);

const project = defineProject(engineConfig);
const app = createGameApplication({
  project,
  gameId: gameConfig.id,
  gameVersion: gameConfig.version,
  renderer: createDOMAdapter({ render: () => uiUx.syncDirectorDom() }),
});
await app.installFeatures();

const director = createUiDirector({
  initialPhase: UI_PHASES.PLAYING,
  hintEnabled: false,
  audio: app.platform.audio,
  metrics: {
    draws: { value: 0, snap: true },
  },
});

const uiUx = bindUiUxDOM({
  root: document.querySelector('main'),
  director,
  audio: app.platform.audio,
});

const state = { draws: 0 };
const scene = app.scenes.add(new Scene('cards'));
scene.onCommand = command => {
  if (command.type === 'draw') {
    state.draws++;
    director.setMetric('draws', state.draws);
    director.emitCue(UI_UX_CUES.CONFIRM);
    uiUx.wake();
  }
};
app.scenes.start('cards');
app.start(); // No idle RAF: DOM updates on command, springs sleep automatically once settled.

const drawBtn = document.querySelector('#draw');
drawBtn.addEventListener('click', () => {
  void app.platform.audio?.unlock?.().catch(() => {});
  app.dispatch({ type: 'draw' });
});
drawBtn.disabled = false;
document.querySelector('main').dataset.engineReady = 'true';
window.__hgameState = () => ({
  scene: app.scenes.current?.name ?? null,
  draws: state.draws,
  running: app.running,
  disposed: app.disposed,
  ui: director.snapshot(),
});

window.addEventListener('pagehide', function onPageHide(event) {
  if (event.persisted) return;
  window.removeEventListener('pagehide', onPageHide);
  uiUx.dispose();
  director.dispose();
  app.dispose();
});
