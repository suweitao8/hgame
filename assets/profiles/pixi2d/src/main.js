import { createDefaultGameAtlas } from './engine/ProceduralAtlas.js';
import { Renderer2D } from './engine/Renderer2D.js';
import { JuiceSystem } from './engine/JuiceSystem.js';
import { InputAndAudio } from './engine/InputAndAudio.js';
import { DemoArena } from './sim/demoArena.js';
import { HudController } from './ui/HudController.js';
import { bindVisibilitySuspension } from './engine/VisibilityController.js';

const hosted = location.port === '4175' && location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
const [{ createGameApplication }, { defineProject }, { Scene }, { Component }, { Entity }, engineConfig, gameConfig] = await Promise.all([
  import(base + '/core/application.js'), import(base + '/core/config.js'), import(base + '/core/scene.js'),
  import(base + '/core/component.js'), import(base + '/core/entity.js'),
  fetch('./engine.config.json').then(r => r.json()), fetch('./game.config.json').then(r => r.json()),
]);
function loadCharacter(path) {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = path;
  });
}
const useCharacterImages = document.querySelector('meta[name="hgame-character-images"]')?.content === 'true';
const [playerImage, enemyImage] = useCharacterImages ? await Promise.all([
  loadCharacter('./assets/actors/player.png'), loadCharacter('./assets/actors/enemy.png'),
]) : [null, null];
const renderer = new Renderer2D(createDefaultGameAtlas({ playerImage, enemyImage }));
await renderer.init(document.querySelector('#game-canvas'));
const arena = new DemoArena(1000), hud = new HudController(), juice = new JuiceSystem(renderer), input = new InputAndAudio(renderer, hud);
for (const button of hud.burstButtons) {
  button.addEventListener('click', () => juice.spawnExplosions(Number(button.dataset.count)));
}
hud.addEnemies.addEventListener('click', () => arena.addEnemies(10000));
let visibility;
const app = createGameApplication({ project: defineProject(engineConfig), gameId: gameConfig.id, gameVersion: gameConfig.version,
  renderer: { render() { renderer.render(); }, resize() { renderer.resize(); }, dispose() { visibility?.dispose(); input.dispose(); juice.dispose(); renderer.dispose(); } } });
await app.installFeatures();
renderer.onResize = () => { if (app.project.tickHz === 0 && app.running && !app.paused) renderer.render(); };
const scene = app.scenes.add(new Scene('arena'));
const controller = scene.add(new Entity({ name: 'arena' }));
let controls = {}, fps = 0, elapsed = 0, fpsFrames = 0, fpsSince = performance.now();
visibility = bindVisibilitySuspension(app, { resetInput: () => input.reset(), onVisibility: () => { fpsFrames = 0; fpsSince = performance.now(); } });
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
app.scenes.start('arena'); app.start(); visibility.sync(); document.querySelector('#game-canvas').dataset.engineReady = 'true';
window.__hgameState = () => ({ enemies: arena.enemies.length, effects: juice.effects.length, particles: juice.visibleParticles, activeParticles: juice.active, fps, kills: arena.kills });
window.addEventListener('pagehide', event => { if (!event.persisted) app.dispose(); });
