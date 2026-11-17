const hosted = location.port === '4175' && location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
const [
  gameConfig, engineConfig, { createGameApplication }, { defineProject },
  { Component }, { Entity }, { Scene }, { createCanvas2DAdapter, Sprite2D },
] = await Promise.all([
  fetch('./game.config.json').then(r => r.json()),
  fetch('./engine.config.json').then(r => r.json()),
  import(base + '/core/application.js'),
  import(base + '/core/config.js'),
  import(base + '/core/component.js'),
  import(base + '/core/entity.js'),
  import(base + '/core/scene.js'),
  import(base + '/integrations/canvas2d.js'),
]);

const project = defineProject(engineConfig);
const canvas = document.querySelector('#game');
const renderer = createCanvas2DAdapter({ canvas, width: 960, height: 540 });
const app = createGameApplication({ project, gameId: gameConfig.id, gameVersion: gameConfig.version, renderer });
await app.installFeatures();

const scene = app.scenes.add(new Scene('main'));
const actor = scene.add(new Entity({ name: 'player' }));
actor.addComponent(new Sprite2D({ shape: 'rect', width: 44, height: 44, color: '#60d9b7' }));
class Move extends Component {
  fixedUpdate(dt) {
    const input = this.scene.app.input;
    let dx = Number(input.isDown('KeyD') || input.isDown('ArrowRight')) -
      Number(input.isDown('KeyA') || input.isDown('ArrowLeft'));
    let dy = Number(input.isDown('KeyS') || input.isDown('ArrowDown')) -
      Number(input.isDown('KeyW') || input.isDown('ArrowUp'));
    const mag = Math.hypot(dx, dy) || 1;
    dx /= mag; dy /= mag;
    this.entity.x = Math.max(-460, Math.min(460, this.entity.x + dx * 220 * dt));
    this.entity.y = Math.max(-250, Math.min(250, this.entity.y + dy * 220 * dt));
  }
}
actor.addComponent(new Move());
app.scenes.start('main');
app.start();
window.addEventListener('pagehide', function onPageHide(event) {
  if (event.persisted) return;
  window.removeEventListener('pagehide', onPageHide);
  app.dispose();
});
