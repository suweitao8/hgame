// Horde Survivor: reference game for the HGame 2D profile (webgl2d + SpriteCrowd2D + SpatialHash2D).
// Rules live in ./sim (pure, headless-testable). This file only wires input, rendering and HUD.
import { createSurvivorSim } from './sim/survivor.js';
import { recordRun, loadBest } from './meta.js';

const [gameConfig, engineConfig] = await Promise.all([
  fetch('./game.config.json').then(r => r.json()),
  fetch('./engine.config.json').then(r => r.json()),
]);
const hosted = location.port === '4175' && location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
const [{ HGame, Component, Entity, Scene }, gl2d, { createTouchControls }] = await Promise.all([
  import(base + '/index.js'),
  import(base + '/integrations/webgl2d.js'),
  import(base + '/integrations/touch-controls.js'),
]);
const { createWebGL2DAdapter, Sprite2D, SpriteCrowd2D } = gl2d;

// URL knobs for QA: ?horde=3000 starts with a 3000-enemy swarm and an invulnerable player; ?seed=N.
const params = new URLSearchParams(location.search);
const horde = Number(params.get('horde') || 0);
const seed = Number(params.get('seed') || 1);
const debug = params.get('debug') === '1';

const project = HGame.defineProject(engineConfig);
const canvas = document.querySelector('#game');
const renderer = createWebGL2DAdapter({ canvas, width: 960, height: 540, background: '#0d1117' });
const app = HGame.createApplication({ project, gameId: gameConfig.id, gameVersion: gameConfig.version, renderer });
await app.installFeatures();
const save = app.services.save ?? HGame.createSaveStore({ gameId: gameConfig.id });
const cfgSim = () => ({ SpatialHash2D: HGame.SpatialHash2D, seed, godMode: horde > 0 });

// ---- input: WASD + touch stick via arcade controls, plus arrow keys; J/K/L pick upgrades, U restarts ----
const arcade = HGame.createArcadeControls({
  input: app.input,
  actions: [{ name: 'pick1', label: '1', slot: 'j' }, { name: 'pick2', label: '2', slot: 'k' },
    { name: 'pick3', label: '3', slot: 'l' }, { name: 'restart', label: 'Again', slot: 'u' }],
});
const touch = createTouchControls({ controls: arcade.p1, container: document.body, mode: 'touch-only', buttonLayout: 'arc' });
const mv = { x: 0, y: 0, magnitude: 0, active: false };
const input = { x: 0, y: 0, choice: -1 };
let clickChoice = -1;

// ---- game state (sim) and view mirrors ----
let sim = createSurvivorSim(cfgSim());
if (horde) sim.prefill(horde);
let best = loadBest(save);
let saved = false;

const root = app.scenes.add(new Scene('main'));
const world = root.add(new Entity({ name: 'world' }));
const mkCrowd = (opts) => world.addComponent(new SpriteCrowd2D(opts));
const gridCrowd = mkCrowd({ capacity: 256, shape: 'circle', width: 4, height: 4, color: '#1f2a37', layer: 0 });
const gemCrowd = mkCrowd({ capacity: sim.config.maxGems, shape: 'rect', width: 7, height: 7, color: '#4cc3ff', layer: 1 });
const enemyCrowd = mkCrowd({ capacity: sim.config.maxEnemies, shape: 'circle', width: 20, height: 20, color: '#ffffff', layer: 2 });
const boltCrowd = mkCrowd({ capacity: sim.config.maxBullets, shape: 'circle', width: 10, height: 10, color: '#fff3a0', layer: 3 });
const novaRing = world.addComponent(new Sprite2D({ shape: 'circle', width: 180, height: 180, color: '#4cc3ff', layer: 3, opacity: 0 }));
const playerEntity = root.add(new Entity({ name: 'player' }));
playerEntity.addComponent(new Sprite2D({ shape: 'circle', width: 28, height: 28, color: '#60d9b7', layer: 4, groundShadow: true }));

const GRID = 120;
for (let gy = -3; gy <= 3; gy++) for (let gx = -5; gx <= 5; gx++) gridCrowd.spawn({ x: gx * GRID, y: gy * GRID });

const maps = {
  enemy: new Int32Array(sim.config.maxEnemies).fill(-1), enemyHw: 0,
  bolt: new Int32Array(sim.config.maxBullets).fill(-1), boltHw: 0,
  gem: new Int32Array(sim.config.maxGems).fill(-1), gemHw: 0,
};
const SPAWN = { x: 0, y: 0, tint: null, scaleX: 1, scaleY: 1 };

function mirror(crowd, map, hwKey, hw, alive, xs, ys, onNew, onLive) {
  const top = Math.max(hw, maps[hwKey]);
  for (let i = 0; i < top; i++) {
    if (alive[i]) {
      let idx = map[i];
      if (idx < 0) { idx = map[i] = crowd.spawn(onNew(i, SPAWN)); }
      crowd.x[idx] = xs[i]; crowd.y[idx] = ys[i];
      if (onLive) onLive(i, idx);
    } else if (map[i] >= 0) { crowd.kill(map[i]); map[i] = -1; }
  }
  maps[hwKey] = hw;
}

function syncView() {
  const { en, bl, gm, player, weapon } = sim;
  const kinds = sim.config.enemyKinds;
  mirror(enemyCrowd, maps.enemy, 'enemyHw', en.hw, en.alive, en.x, en.y,
    (i, o) => { const k = kinds[en.kind[i]]; o.x = en.x[i]; o.y = en.y[i]; o.tint = k.color; o.scaleX = o.scaleY = k.size / 20; return o; },
    (i, idx) => { if (en.hit[i]) { en.hit[i] = 0; enemyCrowd.hitFlash(idx, 0.07); } });
  mirror(boltCrowd, maps.bolt, 'boltHw', bl.hw, bl.alive, bl.x, bl.y, (i, o) => { o.x = bl.x[i]; o.y = bl.y[i]; o.tint = null; o.scaleX = o.scaleY = 1; return o; });
  mirror(gemCrowd, maps.gem, 'gemHw', gm.hw, gm.alive, gm.x, gm.y, (i, o) => { o.x = gm.x[i]; o.y = gm.y[i]; o.tint = null; o.scaleX = o.scaleY = 1; return o; });
  // Scrolling dot grid gives motion reference without any art assets.
  const ox = Math.floor(player.x / GRID) * GRID, oy = Math.floor(player.y / GRID) * GRID;
  let n = 0;
  for (let gy = -3; gy <= 3; gy++) for (let gx = -5; gx <= 5; gx++) { gridCrowd.x[n] = ox + gx * GRID; gridCrowd.y[n] = oy + gy * GRID; n++; }
  playerEntity.x = player.x; playerEntity.y = player.y;
  novaRing.entity.x = player.x; novaRing.entity.y = player.y;
  novaRing.opacity = weapon.novaFlash > 0 ? weapon.novaFlash / 0.18 * 0.25 : 0;
  novaRing.width = novaRing.height = weapon.novaRadius * 2;
  renderer.camera.follow(player, { lerp: 0.25 });
}

// ---- HUD ----
const el = id => document.getElementById(id);
const hud = { hp: el('hp').firstElementChild, xp: el('xp').firstElementChild, stats: el('stats'), levelup: el('levelup'),
  gameover: el('gameover'), result: el('result') };
const LABELS = { damage: '+30% 伤害', rate: '+ 射速', multishot: '+1 弹体', pierce: '+1 穿透', speed: '+10% 移速',
  magnet: '+40% 拾取', nova: '+ 范围', heal: '+40 生命' };
el('debug').hidden = !debug;
let shownPending = null;
function syncHud(fps) {
  const { player, state } = sim;
  hud.hp.style.transform = `scaleX(${player.hp / player.maxHp})`;
  hud.xp.style.transform = `scaleX(${player.xp / player.xpNeed})`;
  hud.stats.textContent = `Lv ${player.level}   ${state.time.toFixed(0)}s   ✦ ${state.kills}`;
  if (debug) el('debug').textContent = `${sim.en.count} enemies   ${fps?.toFixed(0) ?? 0} fps`;
  if (state.pending !== shownPending) {
    shownPending = state.pending;
    hud.levelup.hidden = !state.pending;
    hud.levelup.replaceChildren(...(state.pending ?? []).map((id, i) => {
      const b = document.createElement('button');
      b.innerHTML = `<b>${i + 1}</b>${LABELS[id]}`;
      b.onclick = () => { clickChoice = i; };
      return b;
    }));
    for (const n of ['pick1', 'pick2', 'pick3']) touch.setButtonEnabled(n, Boolean(state.pending));
  }
  if (state.over && hud.gameover.hidden) {
    if (!saved) { saved = true; const r = recordRun(save, sim.summary()); best = r.best; hud.result.textContent = `Lv ${player.level} · ✦ ${state.kills} · ${state.time.toFixed(1)}s${r.record ? ' ★' : ''}`; }
    hud.gameover.hidden = false;
  }
}

function restart() {
  sim = createSurvivorSim({ ...cfgSim(), seed: seed + Math.floor(performance.now()) });
  for (const [crowd, map] of [[enemyCrowd, maps.enemy], [boltCrowd, maps.bolt], [gemCrowd, maps.gem]]) { crowd.clear(); map.fill(-1); }
  maps.enemyHw = maps.boltHw = maps.gemHw = 0;
  saved = false; hud.gameover.hidden = true; shownPending = null; window.__survivor.sim = sim;
}
el('restart').onclick = restart;

class Driver extends Component {
  onDestroy() { touch.dispose(); el('restart').onclick = null; }
  fixedUpdate(dt) {
    arcade.update(dt);
    const p1 = arcade.p1;
    p1.getMove(mv);
    input.x = mv.x + (app.input.isDown('ArrowRight') - app.input.isDown('ArrowLeft'));
    input.y = mv.y + (app.input.isDown('ArrowDown') - app.input.isDown('ArrowUp'));
    input.choice = clickChoice;
    clickChoice = -1;
    for (let i = 0; i < 3; i++) if (p1.consumeBuffered('pick' + (i + 1)) && sim.state.pending) input.choice = i;
    if (sim.state.over && p1.consumeBuffered('restart')) { restart(); return; }
    sim.step(dt, input);
  }
  lateUpdate() {
    syncView();
    syncHud(app.services.diagnostics?.snapshot().fps);
  }
}
playerEntity.addComponent(new Driver());

app.scenes.start('main');
app.start();
window.__survivor = { app, sim, horde };
window.__hgameState = () => ({ phase: sim.state.over ? 'over' : sim.state.pending ? 'upgrade' : 'playing',
  tick: sim.state.tick, time: sim.state.time, kills: sim.state.kills, enemies: sim.en.count,
  player: { x: sim.player.x, y: sim.player.y, hp: sim.player.hp }, best: { ...best },
  running: app.running, disposed: app.disposed, scheduler: app.stats });
canvas.dataset.engineReady = 'true';
window.addEventListener('pagehide', function onPageHide(event) {
  if (event.persisted) return;
  window.removeEventListener('pagehide', onPageHide);
  touch.dispose();
  app.dispose();
});
