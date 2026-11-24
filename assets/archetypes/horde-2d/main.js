// Universal 2D Horde Survivor Archetype wired to HGame's 5-Pillar Kit + 10k+ Swarm Simulation.
import { mountActionInterface } from './action-interface.js';

const hosted = location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
const [
  gameConfig, engineConfig, designBlueprint,
  { createGameApplication }, { defineProject }, { Component }, { Entity }, { Scene },
  { createWebGL2DAdapter, Sprite2D, SpriteCrowd2D },
  { createSwarmSimulation },
  { createVfxSystem },
  { defineGameBlueprint, getArtTheme, createGameSession },
] = await Promise.all([
  fetch('./game.config.json').then(r => r.json()),
  fetch('./engine.config.json').then(r => r.json()),
  fetch('./src/game.design.json').then(r => r.json()),
  import(base + '/core/application.js'),
  import(base + '/core/config.js'),
  import(base + '/core/component.js'),
  import(base + '/core/entity.js'),
  import(base + '/core/scene.js'),
  import(base + '/integrations/webgl2d.js'),
  import(base + '/world/swarm-ecs.js'),
  import(base + '/vfx/index.js'),
  import(base + '/kit/index.js'),
]);

const blueprint = defineGameBlueprint(designBlueprint);
const theme = getArtTheme(blueprint.art.theme);
const project = defineProject(engineConfig);
const canvas = document.querySelector('#game');
const renderer = createWebGL2DAdapter({
  canvas,
  width: 960,
  height: 540,
  background: theme.palette.bg,
});

const app = createGameApplication({
  project,
  gameId: gameConfig.id,
  gameVersion: gameConfig.version,
  renderer,
});
await app.installFeatures();

const PX_PER_M = 28;
const halfSpanPx = Math.max(400, blueprint.design.balance.arenaSpan * PX_PER_M * 0.5);
const waveSpawnRadius = 460;

const runtimeStats = {
  moveSpeed: blueprint.design.feel.playerSpeed * PX_PER_M,
  pulseDamage: Math.max(12, Math.round(blueprint.design.balance.weaponDps * 0.55)),
  pulseRadius: 120,
  pulseInterval: 0.55,
};

const session = createGameSession({
  blueprint,
  app,
  onStartRun() { resetHorde(); },
  onChoice(picked) {
    if (picked.id === 'atk-up') runtimeStats.pulseDamage = Math.round(runtimeStats.pulseDamage * 1.3);
    else if (picked.id === 'spd-up') runtimeStats.pulseInterval = Math.max(0.2, runtimeStats.pulseInterval * 0.8);
    else if (picked.id === 'hp-up') session.healPlayer(35);
    else runtimeStats.pulseRadius += 28;
  },
});

const scene = app.scenes.add(new Scene('horde'));
const world = scene.add(new Entity({ name: 'world' }));
const gridCrowd = world.addComponent(new SpriteCrowd2D({ capacity: 169, shape: 'rect', width: 6, height: 6, color: theme.palette.surface, layer: 0 }));
for (let gy = -6; gy <= 6; gy++) {
  for (let gx = -6; gx <= 6; gx++) {
    gridCrowd.spawn({ x: gx * 140, y: gy * 140 });
  }
}

const enemyCrowd = world.addComponent(new SpriteCrowd2D({ capacity: 4096, shape: 'circle', width: 16, height: 16, color: theme.palette.enemy, layer: 2 }));
const cellSize = 36;
const gridSide = Math.ceil((halfSpanPx + waveSpawnRadius) * 2 / cellSize);
const gridOrigin = -gridSide * cellSize / 2;
const swarm = createSwarmSimulation({
  capacity: 4096,
  cellSize,
  gridCols: gridSide,
  gridRows: gridSide,
  originX: gridOrigin,
  originY: gridOrigin,
});
swarm.syncToSpriteCrowd2D(enemyCrowd);

const player = scene.add(new Entity({ name: 'player', width: 26, height: 26 }));
const playerSprite = player.addComponent(new Sprite2D({ shape: 'circle', width: 26, height: 26, color: theme.palette.player, layer: 4, groundShadow: true }));
const vfx = createVfxSystem({ mode: 'webgl2d', sceneOrAdapter: renderer });

let pulseTimer = 0;
let manualAttacks = 0;
let waveTimer = 0;
let hurtCd = 0;
let dashTimer = 0;
let dashBurst = 0;
const nearby = new Int32Array(1);

function resetHorde() {
  manualAttacks = 0;
  player.x = 0;
  player.y = 0;
  runtimeStats.pulseDamage = Math.max(12, Math.round(blueprint.design.balance.weaponDps * 0.55));
  runtimeStats.pulseRadius = 120;
  runtimeStats.pulseInterval = 0.55;
  swarm.clear();
  swarm.syncToSpriteCrowd2D(enemyCrowd);
  swarm.spawnWave({
    count: 90,
    centerX: 0,
    centerY: 0,
    minRadius: 210,
    maxRadius: 420,
    speed: 78,
    hp: blueprint.design.balance.gruntHp,
    seed: 101,
  });
  pulseTimer = 0.2;
  waveTimer = 3.5;
  hurtCd = 0;
  dashTimer = 0;
  dashBurst = 0;
}

player.addComponent(new class extends Component {
  fixedUpdate(dt) {
    if (!controls.update(dt)) return;
    const mv = controls.move;
    const mag = Math.hypot(mv.x, mv.y);
    if (mag > 0.05) session.notifyMoved();

    dashTimer = Math.max(0, dashTimer - dt);
    dashBurst = Math.max(0, dashBurst - dt);
    if (controls.wasPressed('dash') && dashTimer <= 0) {
      dashTimer = blueprint.design.feel.dashCooldownSec;
      dashBurst = 0.16;
      session.audio.play('dash');
      vfx.burstParticles({ x: player.x, y: player.y, count: 12, color: theme.palette.primary, speedMin: 80, speedMax: 210, sizeStart: 8, sizeEnd: 2, durationMin: 0.2, durationMax: 0.35 });
    }

    const speed = runtimeStats.moveSpeed * (dashBurst > 0 ? 2.3 : 1);
    if (mag > 0.01) {
      player.x = Math.max(-halfSpanPx, Math.min(halfSpanPx, player.x + mv.x * speed * dt));
      player.y = Math.max(-halfSpanPx, Math.min(halfSpanPx, player.y + mv.y * speed * dt));
    }

    pulseTimer -= dt;
    const manual = controls.wasPressed('attack');
    if (pulseTimer <= 0 || manual) {
      pulseTimer = runtimeStats.pulseInterval;
      const hits = swarm.applyCircleDamage({
        x: player.x,
        y: player.y,
        radius: runtimeStats.pulseRadius,
        damage: runtimeStats.pulseDamage,
        knockback: 180,
      });
      session.audio.play('attack');
      vfx.slashArc({ x: player.x, y: player.y, radius: runtimeStats.pulseRadius * 0.75, color: theme.vfx.slashColor });
      if (manual) manualAttacks++;
      if (hits > 0) session.recordHit({ score: hits * 2 });
    }

    waveTimer -= dt;
    if (waveTimer <= 0 && swarm.count < 1800) {
      waveTimer = 4.0;
      swarm.spawnWave({
        count: 35 + session.state.wave * 15,
        centerX: player.x,
        centerY: player.y,
        minRadius: 260,
        maxRadius: waveSpawnRadius,
        speed: 75 + session.state.wave * 6,
        hp: blueprint.design.balance.gruntHp,
        seed: 100 + session.state.wave * 31 + swarm.count,
      });
    }

    swarm.step(dt, {
      heroX: player.x,
      heroY: player.y,
      onUnitKilled(_id, x, y) {
        vfx.emitHitImpact({ x, y, damage: runtimeStats.pulseDamage, numberPreset: blueprint.art.damagePreset });
        const k = session.recordKill({ score: 12, xp: 1, currency: 1 });
        if (k.leveledUp && session.state.phase === 'playing') session.presentChoices();
      },
    });
    hurtCd = Math.max(0, hurtCd - dt);
    if (hurtCd <= 0 && dashBurst <= 0) {
      const count = swarm.spatialHash.queryRadiusIds(player.x, player.y, 18, nearby, nearby.length, swarm.posX, swarm.posY);
      if (count > 0) {
        hurtCd = 0.65;
        playerSprite.hitFlash = 0.14;
        session.damagePlayer(blueprint.design.balance.gruntDamage);
      }
    }

    const targetWave = 1 + Math.floor(session.state.elapsed / Math.max(10, blueprint.design.balance.waveDurationSec * 0.5));
    if (targetWave > session.state.wave) session.setWave(targetWave);
  }
  update(dt) {
    session.update(dt);
    vfx.update(dt);
    renderer.camera.x = player.x;
    renderer.camera.y = player.y;
    controls.sync();
  }
}());

const controls = await mountActionInterface({ base, canvas, session, input: app.input, labels: { attack: '脉冲' } });
app.scenes.start('horde');
app.start();
canvas.dataset.engineReady = 'true';
window.__hgameState = () => ({ ...session.snapshot(), player: { x: player.x, y: player.y }, swarmCount: swarm.count, manualAttacks });

window.addEventListener('pagehide', function onPageHide(event) {
  if (event.persisted) return;
  window.removeEventListener('pagehide', onPageHide);
  controls.dispose();
  session.dispose();
  vfx.dispose();
  app.dispose();
});
