// CPU swarm simulation and PixiJS rendering share HGame's application loop.
import { createDefaultGameAtlas } from './engine/ProceduralAtlas.js';
import { Renderer2D } from './engine/Renderer2D.js';
import { bindVisibilitySuspension } from './engine/VisibilityController.js';

const hosted = location.port === '4175' && location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}`);
  return response.json();
}
const [gameConfig, engineConfig, settings, { createGameApplication }, { defineProject },
  { Scene }, { Entity }, { Component }, { createSwarmSimulation }] = await Promise.all([
  readJson('./game.config.json'), readJson('./engine.config.json'), readJson('./src/swarm.json'),
  import(base + '/core/application.js'), import(base + '/core/config.js'), import(base + '/core/scene.js'),
  import(base + '/core/entity.js'), import(base + '/core/component.js'), import(base + '/world/swarm-ecs.js'),
]);

const mount = document.querySelector('#game-canvas');
const renderer = new Renderer2D(createDefaultGameAtlas());
await renderer.init(mount);
let visibility;
const app = createGameApplication({ project: defineProject(engineConfig), gameId: gameConfig.id, gameVersion: gameConfig.version,
  renderer: { render() { renderer.render(); }, resize() { renderer.resize(); }, dispose() { visibility?.dispose(); renderer.dispose(); } } });
await app.installFeatures();
renderer.onResize = () => { if (app.project.tickHz === 0 && app.running && !app.paused) renderer.render(); };
visibility = bindVisibilitySuspension(app);
app.input.preventKeys(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
const scene = app.scenes.add(new Scene('main'));
const hero = scene.add(new Entity({ name: 'player', width: 26, height: 26 }));
const swarm = createSwarmSimulation({ capacity: settings.capacity, cellSize: 48, originX: -3072, originY: -3072 });
swarm.spawnWave({ count: settings.initialCount, centerX: hero.x, centerY: hero.y, minRadius: 140, maxRadius: 240, speed: settings.speed });
const crowd = renderer.createSwarmLayer({ textures: ['enemy_chaser'], scale: settings.spriteSize / 40 });
const target = { heroX: hero.x, heroY: hero.y };
hero.addComponent(new class extends Component {
  fixedUpdate(dt) {
    let dx = Number(app.input.isDown('KeyD') || app.input.isDown('ArrowRight')) - Number(app.input.isDown('KeyA') || app.input.isDown('ArrowLeft'));
    let dy = Number(app.input.isDown('KeyS') || app.input.isDown('ArrowDown')) - Number(app.input.isDown('KeyW') || app.input.isDown('ArrowUp'));
    let canvasRect = null;
    for (const pointer of app.input.pointers) {
      if (pointer.pointerType !== 'touch') continue;
      canvasRect ??= renderer.app.canvas.getBoundingClientRect();
      if (pointer.startX < canvasRect.left || pointer.startX >= canvasRect.left + canvasRect.width / 2 ||
          pointer.startY < canvasRect.top || pointer.startY >= canvasRect.bottom) continue;
      dx = (pointer.x - pointer.startX) / 48; dy = (pointer.y - pointer.startY) / 48; break;
    }
    const speed = 175 * dt / Math.max(1, Math.hypot(dx, dy));
    hero.x = Math.max(-467, Math.min(467, hero.x + dx * speed));
    hero.y = Math.max(-257, Math.min(257, hero.y + dy * speed));
    target.heroX = hero.x; target.heroY = hero.y; swarm.step(dt, target);
  }
  update(dt) {
    renderer.camera.targetX = hero.x; renderer.camera.targetY = hero.y; renderer.update(dt);
    renderer.syncEntity('player', { x: hero.x, y: hero.y, tex: 'player_hero', scaleX: 0.4, scaleY: 0.4 });
    crowd.sync(swarm);
  }
}());
app.scenes.start('main'); app.start(); visibility.sync(); mount.dataset.engineReady = 'true';
window.__hgameState = () => ({ tick: app.stats.ticks, activeUnits: swarm.count, visibleUnits: crowd.visibleCount, hero: { x: hero.x, y: hero.y } });
window.addEventListener('pagehide', event => { if (!event.persisted) app.dispose(); });
