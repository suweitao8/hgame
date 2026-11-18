import { Graphics } from 'pixi.js';
import { loadRuntime, readGameJson, startPixiGame } from './engine/startPixiGame.js';
import { createCatalogGameAtlas, createDefaultGameAtlas } from './engine/ProceduralAtlas.js';
import { JuiceSystem } from './engine/JuiceSystem.js';
import { WATCH_CONFIG } from './sim/watch-config.js';
import { createSurvivorSim } from './sim/survivor.js';
import { loadBest, recordRun } from './meta.js';

const config = WATCH_CONFIG;
const objective = config.extraction;
const [leftRelay, rightRelay] = objective.relays;
const exit = { x: 0, y: 0 };
const choices = {
  damage: '+30% 弹伤', rate: '−15% 射击间隔', multishot: '+1 弹体', pierce: '+1 穿透',
  speed: '+10% 移速', magnet: '+40% 拾取', nova: '+20% 火环', heal: '+40 生命',
};
const el = id => document.getElementById(id);

function setup({ app, renderer, Scene, Entity, Component }, [{ SpatialHash2D }, { createArcadeControls }, { createTouchControls }]) {
  const scene = app.scenes.add(new Scene('watch'));
  const save = app.services.save;
  const seed = new URLSearchParams(location.search).get('seed') ?? 1;
  const makeRun = () => createSurvivorSim({ SpatialHash2D, config, seed });
  let sim = makeRun();
  let best = loadBest(save);
  let saved = false;
  let shown = null;
  let picked = -1;
  let previousOpen = false;
  let previousNova = 0;
  let previousPickup = 0;
  const hud = el('hud');
  const health = el('health').firstElementChild;
  const upgrade = el('upgrade');
  const gameover = el('gameover');
  const status = el('status');
  const buttons = new AbortController();
  const arcade = createArcadeControls({ input: app.input, actions: [] });
  const touch = createTouchControls({ controls: arcade.p1, container: document.body, mode: 'touch-only' });
  const movement = { x: 0, y: 0, magnitude: 0, active: false };
  const input = { x: 0, y: 0, choice: -1 };
  const juice = new JuiceSystem(renderer, 192, { maxShockwaveFilters: 0 });
  const ring = new Graphics();
  const progress = new Graphics();
  const relayGraphics = new Graphics();
  const marker = new Graphics();
  renderer.bgLayer.addChild(ring, progress, relayGraphics);
  renderer.foregroundLayer.addChild(marker);
  for (const { x, y } of objective.relays) {
    relayGraphics.circle(x, y, objective.relayRadius).fill({ color: 0xffad58, alpha: 0.17 })
      .circle(x, y, objective.relayRadius).stroke({ color: 0xffad58, width: 3 })
      .poly([x, y - 20, x + 13, y, x, y + 20, x - 13, y]).fill(0xffbc73);
  }
  const liveEnemies = [];
  const enemyView = Array.from({ length: config.maxEnemies }, (_, id) => ({ id, x: 0, y: 0, elite: false, flash: 0 }));
  const spriteState = { x: 0, y: 0, tex: '', scaleX: 1, scaleY: 1, tint: 0xffffff, hasShadow: false };
  let lastBullet = 0;
  let lastGem = 0;
  let lastProgress = -1;
  let ringOpen = null;
  const audio = app.platform.audio;
  let audioContext;
  const enableSound = event => {
    if (event.isTrusted && audio?.available && audioContext?.state !== 'running') {
      void audio.unlock().then(context => { audioContext = context; }).catch(() => {});
    }
  };
  window.addEventListener('pointerdown', enableSound, { signal: buttons.signal });
  window.addEventListener('keydown', enableSound, { signal: buttons.signal });
  const sound = preset => { if (audioContext?.state === 'running') audio.playSynth(preset, { volume: 0.32 }); };

  function showRing() {
    if (ringOpen !== sim.extraction.open) {
      ringOpen = sim.extraction.open;
      const color = ringOpen ? 0xffb05d : 0x774757;
      ring.clear()
        .circle(0, 0, objective.radius).fill({ color, alpha: 0.075 })
        .circle(0, 0, objective.radius).stroke({ color, alpha: 0.9, width: 3 })
        .circle(0, 0, 22).stroke({ color, alpha: 0.7, width: 2 });
    }
    if (lastProgress !== sim.extraction.progress) {
      lastProgress = sim.extraction.progress;
      progress.clear();
      if (lastProgress > 0) {
        const start = -Math.PI / 2;
        progress.arc(0, 0, objective.radius - 6, start, start + lastProgress / objective.holdSeconds * Math.PI * 2)
          .stroke({ color: 0xffedaa, width: 5, cap: 'round' });
      }
    }
    const { x, y } = renderer.camera;
    const { width, height } = renderer.app.screen;
    relayGraphics.visible = sim.extraction.relay === null;
    let target = exit;
    if (relayGraphics.visible) {
      const left = (leftRelay.x - x) ** 2 + (leftRelay.y - y) ** 2;
      const right = (rightRelay.x - x) ** 2 + (rightRelay.y - y) ** 2;
      target = left <= right ? leftRelay : rightRelay;
    }
    const dx = target.x - x;
    const dy = target.y - y;
    const marginX = Math.max(40, width / 2 - 42);
    const marginY = Math.max(40, height / 2 - 47);
    const scale = Math.min(1, marginX / Math.max(1, Math.abs(dx)), marginY / Math.max(1, Math.abs(dy)));
    marker.visible = scale < 1;
    if (marker.visible) {
      marker.position.set(x + dx * scale, y + dy * scale);
      marker.rotation = Math.atan2(dy, dx);
    }
  }
  marker.poly([13, 0, -10, -8, -5, 0, -10, 8]).fill(0xffbc73).stroke({ color: 0x3b1e1d, width: 2 });

  function syncPool(pool, key, texture, tint, last) {
    const top = Math.max(pool.hw, last);
    spriteState.tex = texture;
    spriteState.tint = tint;
    for (let i = 0; i < top; i++) {
      const id = key + i;
      if (i < pool.hw && pool.alive[i]) {
        spriteState.x = pool.x[i];
        spriteState.y = pool.y[i];
        renderer.syncEntity(id, spriteState);
      } else renderer.releaseEntity(id);
    }
    return pool.hw;
  }

  function syncView(dt) {
    const { player, en, gm, bl, state } = sim;
    renderer.camera.targetX = player.x;
    renderer.camera.targetY = player.y;
    juice.update(dt);
    renderer.update(dt);
    liveEnemies.length = 0;
    for (let i = 0; i < en.hw; i++) {
      if (!en.alive[i]) continue;
      const view = enemyView[i];
      view.x = en.x[i];
      view.y = en.y[i];
      view.elite = en.kind[i] === 2;
      view.flash = en.hit[i] ? 0.08 : Math.max(0, view.flash - dt);
      en.hit[i] = 0;
      liveEnemies.push(view);
    }
    renderer.syncEnemies(liveEnemies, state.time);
    lastBullet = syncPool(bl, 'bolt-', 'bullet_orb', 0xffffff, lastBullet);
    lastGem = syncPool(gm, 'ember-', 'particle_spark', 0xffb052, lastGem);
    renderer.syncEntity('hero', { x: player.x, y: player.y, tex: 'player_hero', scaleX: 0.68, scaleY: 0.68 });
    showRing();
  }

  function syncHud() {
    const { state, player, extraction } = sim;
    hud.hidden = Boolean(state.pending || state.over);
    const meter = extraction.relay === null ? '◇' : extraction.open ? '◎' : '◷ ' + Math.ceil(objective.unlockSeconds - state.time);
    const next = meter + ' · Lv ' + player.level + ' · ✦ ' + state.kills;
    if (status.textContent !== next) status.textContent = next;
    health.style.transform = 'scaleX(' + player.hp / player.maxHp + ')';
    if (shown !== state.pending) {
      shown = state.pending;
      upgrade.hidden = !shown || state.over;
      if (shown) touch.releaseAll();
      el('choices').replaceChildren(...(shown ?? []).map((id, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = choices[id];
        button.dataset.choice = index;
        return button;
      }));
    }
    if (state.over && !saved) {
      saved = true;
      upgrade.hidden = true;
      touch.releaseAll();
      const run = sim.summary();
      best = recordRun(save, run).best;
      el('outcome').textContent = extraction.outcome === 'victory' ? '撤离成功' : '余烬熄灭';
      el('result').textContent = '✦ ' + run.kills + ' · ' + run.time.toFixed(1) + 's' + (best.kills > 0 ? ' · ★ ' + best.kills : '');
      gameover.hidden = false;
      el('restart').focus();
    }
  }

  function restart() {
    sim = makeRun();
    saved = false;
    picked = -1;
    previousOpen = false;
    previousNova = previousPickup = 0;
    for (const view of enemyView) view.flash = 0;
    renderer.camera.x = renderer.camera.y = 0;
    gameover.hidden = true;
    syncHud();
  }

  el('restart').addEventListener('click', restart, { signal: buttons.signal });
  el('choices').addEventListener('click', event => {
    if (event.target.matches('button[data-choice]')) picked = Number(event.target.dataset.choice);
  }, { signal: buttons.signal });
  window.addEventListener('keydown', event => {
    if (event.repeat || !sim.state.pending || sim.state.over) return;
    const index = ['Digit1', 'Digit2', 'Digit3'].indexOf(event.code);
    if (index >= 0) picked = index;
  }, { signal: buttons.signal });
  scene.onDispose(() => { touch.dispose(); buttons.abort(); juice.dispose(); });
  scene.add(new Entity({ name: 'run' })).addComponent(new class extends Component {
    fixedUpdate(dt) {
      arcade.update(dt);
      arcade.p1.getMove(movement);
      input.x = movement.x + Number(app.input.isDown('ArrowRight')) - Number(app.input.isDown('ArrowLeft'));
      input.y = movement.y + Number(app.input.isDown('ArrowDown')) - Number(app.input.isDown('ArrowUp'));
      input.choice = picked;
      picked = -1;
      sim.step(dt, input);
      if (sim.weapon.novaFlash > previousNova) {
        juice.burstParticles(sim.player.x, sim.player.y, 12, { tex: 'particle_spark', color: 0xff8b4f });
      }
      previousNova = sim.weapon.novaFlash;
      if (sim.state.lastPickup !== previousPickup) sound('pickup');
      if (sim.extraction.open && !previousOpen) sound('powerup');
      previousOpen = sim.extraction.open;
      previousPickup = sim.state.lastPickup;
    }
    lateUpdate(dt) { syncView(dt); syncHud(); }
  }());
  return {
    scene: scene.name,
    visibility: { resetInput: () => arcade.reset() },
    state: () => ({
      ...sim.summary(), tick: sim.state.tick, phase: sim.state.over ? 'over' : sim.state.pending ? 'upgrade' : 'playing',
      player: { x: sim.player.x, y: sim.player.y, hp: sim.player.hp }, best,
      extraction: { ...sim.extraction }, backend: renderer.backend,
    }),
  };
}

await startPixiGame(setup, {
  loadResources: () => Promise.all([
    loadRuntime('world/spatial2d.js'), loadRuntime('platform/input/arcade.js'), loadRuntime('integrations/touch-controls.js'),
  ]),
  async createAtlas() {
    const [{ createAssetCatalog }, { createAssetLoader }, definition] = await Promise.all([
      loadRuntime('platform/asset-catalog.js'), loadRuntime('platform/assets.js'), readGameJson('./assets/catalog.json'),
    ]);
    if (!definition.groups?.characters?.length) return createDefaultGameAtlas();
    const catalog = createAssetCatalog(definition, { loader: createAssetLoader() });
    try {
      return await createCatalogGameAtlas(catalog, [
        { name: 'player_hero', asset: 'guardian' },
        { name: 'enemy_chaser', asset: 'wisp' },
        { name: 'enemy_elite', asset: 'brute' },
      ]);
    } finally {
      catalog.dispose();
    }
  },
});
