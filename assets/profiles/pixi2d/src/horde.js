// CPU swarm simulation and PixiJS rendering share HGame's application loop.
import { loadRuntime, readGameJson, startPixiGame } from './engine/startPixiGame.js';

await startPixiGame(({ app, renderer, Scene, Entity, Component }, [settings, { createSwarmSimulation }]) => {
  app.input.preventKeys(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
  const scene = app.scenes.add(new Scene('main'));
  const hero = scene.add(new Entity({ name: 'player', width: 26, height: 26 }));
  const swarm = createSwarmSimulation({
    capacity: settings.capacity, ecsSlots: settings.ecsSlots, maxHitEvents: settings.maxHitEvents,
    maxPatchesPerStep: settings.maxPatchesPerStep, cellSize: 48, originX: -3072, originY: -3072,
  });
  swarm.spawnWave({ count: settings.initialCount, centerX: hero.x, centerY: hero.y, minRadius: 140, maxRadius: 240, speed: settings.speed });
  const crowd = renderer.createSwarmLayer({ textures: ['enemy_chaser'], scale: settings.spriteSize / 40, chunkCull: true });
  const target = { heroX: hero.x, heroY: hero.y, prepareRenderChunks: true };
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
  return {
    scene: 'main',
    state: () => ({ tick: app.stats.ticks, activeUnits: swarm.count, visibleUnits: crowd.visibleCount, hero: { x: hero.x, y: hero.y } }),
  };
}, {
  loadResources: () => Promise.all([readGameJson('./src/swarm.json'), loadRuntime('world/swarm-ecs.js')]),
});
