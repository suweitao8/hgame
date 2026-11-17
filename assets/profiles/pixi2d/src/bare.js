// HGame owns the scheduler; add game entities to this empty scene.
import { createDefaultGameAtlas } from './engine/ProceduralAtlas.js';
import { Renderer2D } from './engine/Renderer2D.js';

const hosted = location.port === '4175' && location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
const [gameConfig, engineConfig, { createGameApplication }, { defineProject }, { Scene }] = await Promise.all([
  fetch('./game.config.json').then(r => r.json()), fetch('./engine.config.json').then(r => r.json()),
  import(base + '/core/application.js'), import(base + '/core/config.js'), import(base + '/core/scene.js'),
]);
const renderer = new Renderer2D(createDefaultGameAtlas());
const mount = document.querySelector('#game-canvas');
await renderer.init(mount);
const app = createGameApplication({ project: defineProject(engineConfig), gameId: gameConfig.id, gameVersion: gameConfig.version,
  renderer: { render() { renderer.render(); }, resize() {}, dispose() { renderer.dispose(); } } });
await app.installFeatures();
app.scenes.add(new Scene('main'));
app.scenes.start('main'); app.start(); mount.dataset.engineReady = 'true';
window.__hgameState = () => ({ scene: app.scenes.current?.name ?? null });
window.addEventListener('pagehide', event => { if (!event.persisted) app.dispose(); });
