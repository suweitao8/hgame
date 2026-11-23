import { createDefaultGameAtlas } from './engine/ProceduralAtlas.js';
import { startPixiGame } from './engine/startPixiGame.js';
import { SpatialHash2D } from '../vendor/hgame/world/spatial2d.js';
import { createUiDirector, UI_PHASES } from '../vendor/hgame/ui/ux-director.js';
import { bindUiUxDOM } from '../vendor/hgame/integrations/ui-ux-dom.js';
import { createTouchControls } from '../vendor/hgame/integrations/touch-controls.js';
import { createActionGameControls } from '../vendor/hgame/kit/action-game-controls.js';
import { createI18n } from '../vendor/hgame/ui/i18n.js';
import { JuiceSystem } from './engine/JuiceSystem.js';
import { InputAndAudio } from './engine/InputAndAudio.js';
import { DemoArena } from './sim/demoArena.js';
import { HudController } from './ui/HudController.js';

const params = new URLSearchParams(location.search);
const language = value => value?.toLowerCase().split('-')[0];
const requestedLanguage = language(params.get('lang'));
const locale = ['zh', 'en'].includes(requestedLanguage) ? requestedLanguage
  : language(navigator.language) === 'en' ? 'en' : 'zh';
const { t: translate } = createI18n({
  locale,
  fallbackLocale: 'zh',
  messages: { en: {
    继续: 'Resume', 攻击: 'Attack', 冲刺: 'Dash', 震波: 'Quake', 斩击: 'Slash',
    游戏画面: 'Game view', 敌人: 'Enemies', 爆炸: 'Burst', 特效: 'Effects', 粒子: 'Particles',
  } },
});

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
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  renderer.app.canvas.setAttribute('aria-label', translate('游戏画面'));
  const scene = app.scenes.add(new Scene('arena'));
  const arena = new DemoArena(new SpatialHash2D({ cellSize: 48 }));
  const uiDirector = createUiDirector({
    initialPhase: UI_PHASES.PLAYING,
    audio: app.platform.audio,
    metrics: { kills: { value: 0, snap: true } },
    bars: { hp: { value: 1 } },
  });
  const uiUx = bindUiUxDOM({ root: document.querySelector('#ui-layer'), director: uiDirector, autoRaf: false });
  const hud = new HudController({ director: uiDirector, uiUx, translate });
  const juice = new JuiceSystem(renderer);
  scene.onDispose(() => hud.dispose());
  scene.onDispose(() => juice.dispose());
  const controls = createActionGameControls({
    input: app.input,
    actions: ['attack', 'dash', 'skill1', 'skill2'],
    onDisconnect: () => uiDirector.pause(),
  });
  const touch = createTouchControls({
    controls: controls.touchPlayer, mode: 'touch-only', joystick: 'fixed', joystickRadius: 44, buttonLayout: 'action',
  });
  const touchLabels = { skill1: '震波', skill2: '斩击' };
  for (const { name, label } of controls.touchPlayer.bindings) touch.setButtonLabel(name, translate(touchLabels[name] ?? label));
  const input = new InputAndAudio(renderer, app.platform.audio, app.input, controls, touch);
  const resetInput = () => {
    touch.releaseAll();
    controls.releaseTouch();
    input.reset();
  };
  const touchMode = params.get('touch') === '1' ? 'always' : 'touch-only';
  const syncPhase = () => {
    const paused = uiDirector.isPaused();
    hud.resume.hidden = !paused;
    touch.setMode(paused ? 'hidden' : touchMode);
    resetInput();
  };
  scene.onDispose(uiDirector.onPhaseChange(syncPhase));
  scene.onDispose(() => touch.dispose());
  scene.onDispose(() => controls.dispose());
  scene.onDispose(() => input.dispose());
  syncPhase();
  const buttons = new AbortController();
  scene.onDispose(() => buttons.abort());
  for (const button of hud.burstButtons) {
    button.addEventListener('click', () => juice.spawnExplosions(Number(button.dataset.count)), { signal: buttons.signal });
  }
  hud.addEnemies.addEventListener('click', () => arena.addEnemies(10000), { signal: buttons.signal });
  window.addEventListener('keydown', event => {
    if (event.code === 'Backquote' && !event.repeat) hud.toggleDebug();
    if (event.code === 'Escape' && !event.repeat) uiDirector.togglePause();
  }, { signal: buttons.signal });
  hud.resume.addEventListener('click', () => uiDirector.resume(), { signal: buttons.signal });
  const controller = scene.add(new Entity({ name: 'arena' }));
  let frameInput = {}, fps = 0, elapsed = 0, fpsFrames = 0, fpsSince = performance.now();
  let renderedBullets = 0;
  controller.addComponent(new class extends Component {
    fixedUpdate(dt) {
      const paused = uiDirector.isPaused();
      controls.update(dt, paused ? 'menu' : 'combat');
      if (paused !== uiDirector.isPaused()) return;
      if (paused) {
        if (controls.wasPressed('confirm') || controls.wasPressed('cancel')) uiDirector.resume();
        return;
      }
      if (controls.wasPressed('pause')) {
        uiDirector.pause();
        return;
      }
      hud.setInputHint(controls);
      frameInput = input.getState(arena.player);
      const events = arena.step(dt * juice.simTimeScale, frameInput);
      for (const event of events) {
        if (event.type === 'hit') { juice.triggerHitJuice(event.id); juice.burstParticles(event.x, event.y, 3, { tex: 'particle_spark' }); input.play('hit'); }
        if (event.type === 'shockwave') { juice.triggerHitStop(); juice.addTrauma(); juice.spawnShockwave(event.x, event.y); input.play('shockwave'); }
        if (event.type === 'slash') { juice.slash(event.x, event.y, event.angle); input.play('slash'); }
        if (event.type === 'shoot' || event.type === 'dash') input.play(event.type);
      }
    }
    update(dt) {
      juice.update(dt); renderer.camera.targetX = arena.player.x; renderer.camera.targetY = arena.player.y; renderer.update(dt);
      const moving = !uiDirector.isPaused() && Math.abs(frameInput.moveX ?? 0) + Math.abs(frameInput.moveY ?? 0) > 0;
      if (moving) hud.notifyMoved();
      hud.step(dt);
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
    visibility: { resetInput, onVisibility: () => { fpsFrames = 0; fpsSince = performance.now(); } },
    state: () => ({
      tick: app.stats.ticks,
      running: app.running,
      disposed: app.disposed,
      player: { x: +arena.player.x.toFixed(2), y: +arena.player.y.toFixed(2) },
      bullets: arena.bullets.length,
      enemies: arena.enemies.length,
      effects: juice.effects.length,
      particles: juice.visibleParticles,
      activeParticles: juice.active,
      fps,
      kills: arena.kills,
    }),
  };
}

await startPixiGame(setupArena, { createAtlas: createArenaAtlas });
