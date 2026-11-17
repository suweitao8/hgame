// High-density 2D starter. One simulation buffer and one crowd component.
const hosted = location.port === '4175' && location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}`);
  return response.json();
}
const [gameConfig, engineConfig, settings, { createGameApplication }, { defineProject },
  { Scene }, { Entity }, { Component }, { createWebGL2DAdapter, Sprite2D, SpriteCrowd2D },
  { createSwarmSimulation }] = await Promise.all([
  readJson('./game.config.json'),
  readJson('./engine.config.json'),
  readJson('./src/swarm.json'),
  import(base + '/core/application.js'),
  import(base + '/core/config.js'),
  import(base + '/core/scene.js'),
  import(base + '/core/entity.js'),
  import(base + '/core/component.js'),
  import(base + '/integrations/webgl2d.js'),
  import(base + '/world/swarm-ecs.js'),
]);

const project = defineProject(engineConfig);
const canvas = document.querySelector('#game');
const renderer = createWebGL2DAdapter({ canvas, width: 960, height: 540, background: settings.background });
const app = createGameApplication({ project, gameId: gameConfig.id, gameVersion: gameConfig.version, renderer });
await app.installFeatures();
const scene = app.scenes.add(new Scene('main'));
const hero = scene.add(new Entity({ name: 'player', width: 26, height: 26 }));
const swarm = createSwarmSimulation({ capacity: settings.capacity, cellSize: 48, originX: -3072, originY: -3072 });
swarm.spawnWave({ count: settings.initialCount, centerX: hero.x, centerY: hero.y, minRadius: 140, maxRadius: 240, speed: settings.speed });
const crowd = scene.add(new Entity({ name: 'crowd' }));
crowd.addComponent(new SpriteCrowd2D({ capacity: settings.capacity, width: settings.spriteSize, height: settings.spriteSize })).bindSwarm(swarm);
hero.addComponent(new Sprite2D({ shape: 'circle', width: 26, height: 26, color: '#62e6b2', layer: 1 }));
const target = { heroX: hero.x, heroY: hero.y };
hero.addComponent(new class extends Component {
  fixedUpdate(dt) {
    const dx = Number(app.input.isDown('KeyD')) - Number(app.input.isDown('KeyA'));
    const dy = Number(app.input.isDown('KeyS')) - Number(app.input.isDown('KeyW'));
    const speed = 175 * dt / (Math.hypot(dx, dy) || 1);
    hero.x = Math.max(-467, Math.min(467, hero.x + dx * speed));
    hero.y = Math.max(-257, Math.min(257, hero.y + dy * speed));
    target.heroX = hero.x;
    target.heroY = hero.y;
    swarm.step(dt, target);
  }
}());
renderer.setAmbientLight('#28334e', 0.8);
app.scenes.start('main');
app.start();
canvas.dataset.engineReady = 'true';
window.__hgameState = () => ({ tick: app.stats.ticks, activeUnits: swarm.count, hero: { x: hero.x, y: hero.y } });
window.addEventListener('pagehide', function onPageHide(event) {
  if (event.persisted) return;
  window.removeEventListener('pagehide', onPageHide);
  app.dispose();
});
