import { createDefaultGameAtlas } from './engine/ProceduralAtlas.js';
import { startPixiGame } from './engine/startPixiGame.js';
import { SpatialHash2D } from '../vendor/hgame/world/spatial2d.js';
import { JuiceSystem } from './engine/JuiceSystem.js';
import { InputAndAudio } from './engine/InputAndAudio.js';
import { DemoArena } from './sim/demoArena.js';
import { HudController } from './ui/HudController.js';

function loadCharacter(path) {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = path;
  });
}

async function createArenaAtlas() {
  const useCharacterImages = document.querySelector('meta[name="hgame-character-images"]')?.content === 'true';
  const [playerImage, enemyImage] = useCharacterImages ? await Promise.all([
    loadCharacter('./assets/actors/player.png'), loadCharacter('./assets/actors/enemy.png'),
  ]) : [null, null];
  return createDefaultGameAtlas({ playerImage, enemyImage });
}

function setupArena({ app, renderer, Scene, Entity, Component }) {
  const scene = app.scenes.add(new Scene('arena'));
  const arena = new DemoArena(new SpatialHash2D({ cellSize: 48 }));
  const hud = new HudController(), juice = new JuiceSystem(renderer);
  scene.onDispose(() => juice.dispose());
  const buttons = new AbortController();
  scene.onDispose(() => buttons.abort());
  for (const button of hud.burstButtons) {
    button.addEventListener('click', () => juice.spawnExplosions(Number(button.dataset.count)), { signal: buttons.signal });
  }
  hud.addEnemies.addEventListener('click', () => arena.addEnemies(10000), { signal: buttons.signal });
  window.addEventListener('keydown', event => {
    if (event.code === 'Backquote' && !event.repeat) hud.toggleDebug();
  }, { signal: buttons.signal });
  const input = new InputAndAudio(renderer, hud, app.platform.audio, app.input);
  scene.onDispose(() => input.dispose());
  const controller = scene.add(new Entity({ name: 'arena' }));
  let controls = {}, fps = 0, elapsed = 0, fpsFrames = 0, fpsSince = performance.now();
  let renderedBullets = 0;
  controller.addComponent(new class extends Component {
    fixedUpdate(dt) {
      controls = input.getState(arena.player);
      const events = arena.step(dt * juice.simTimeScale, controls);
      for (const event of events) {
        if (event.type === 'hit') { juice.triggerHitJuice(event.id); juice.burstParticles(event.x, event.y, 3, { tex: 'particle_spark' }); input.play('hit'); }
        if (event.type === 'shockwave') { juice.triggerHitStop(); juice.addTrauma(); juice.spawnShockwave(event.x, event.y); input.play('shockwave'); }
        if (event.type === 'slash') { juice.slash(event.x, event.y, event.angle); input.play('slash'); }
        if (event.type === 'shoot' || event.type === 'dash') input.play(event.type);
      }
    }
    update(dt) {
      juice.update(dt); renderer.camera.targetX = arena.player.x; renderer.camera.targetY = arena.player.y; renderer.update(dt);
      const moving = Math.abs(controls.moveX ?? 0) + Math.abs(controls.moveY ?? 0) > 0;
      const stride = moving ? Math.sin(arena.time * 11) : 0;
      renderer.syncEntity('player', { ...arena.player, tex: 'player_hero', rot: stride * 0.08, scaleX: 1 + stride * 0.04, scaleY: 1 - stride * 0.05 });
      renderer.syncEnemies(arena.enemies, arena.time);
      for (let i = 0; i < arena.bullets.length; i++) renderer.syncEntity('bullet-' + i, { ...arena.bullets[i], tex: 'bullet_orb', hasShadow: false });
      for (let i = arena.bullets.length; i < renderedBullets; i++) renderer.releaseEntity('bullet-' + i);
      renderedBullets = arena.bullets.length;
      elapsed += dt; fpsFrames++;
      const now = performance.now(), fpsWindow = now - fpsSince;
      if (fpsWindow >= 500) { fps = fpsFrames * 1000 / fpsWindow; fpsFrames = 0; fpsSince = now; }
      if (elapsed > 0.2) { hud.update(arena, juice, fps); elapsed = 0; }
    }
  }());
  return {
    scene: 'arena',
    visibility: { resetInput: () => input.reset(), onVisibility: () => { fpsFrames = 0; fpsSince = performance.now(); } },
    state: () => ({ enemies: arena.enemies.length, effects: juice.effects.length, particles: juice.visibleParticles, activeParticles: juice.active, fps, kills: arena.kills }),
  };
}

await startPixiGame(setupArena, { createAtlas: createArenaAtlas });
