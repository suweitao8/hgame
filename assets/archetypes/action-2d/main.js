// Universal 2D Action Archetype wired to HGame's 5-Pillar Kit (Design, UI, Gameplay, Art, Audio).
const hosted = location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
const [
  gameConfig, engineConfig, designBlueprint,
  { createGameApplication }, { defineProject }, { Component }, { Entity }, { Scene },
  { createWebGL2DAdapter, Sprite2D, SpriteCrowd2D },
  { createVfxSystem },
  { createTouchControls },
  { defineGameBlueprint, getArtTheme, createGameSession, createActionGameControls, mountGameShell },
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
  import(base + '/vfx/index.js'),
  import(base + '/integrations/touch-controls.js'),
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

const PX_PER_M = 32;
const halfSpanPx = Math.max(280, blueprint.design.balance.arenaSpan * PX_PER_M * 0.5);

const runtimeStats = {
  moveSpeed: blueprint.design.feel.playerSpeed * PX_PER_M,
  damage: Math.max(10, Math.round(blueprint.design.balance.weaponDps * 0.6)),
  fireInterval: 0.45,
  dashCooldown: blueprint.design.feel.dashCooldownSec,
};

let shell = null;
const session = createGameSession({
  blueprint,
  app,
  onStartRun() { resetArena(); },
  onChoice(picked) {
    if (picked.id === 'atk-up') runtimeStats.damage = Math.round(runtimeStats.damage * 1.25);
    else if (picked.id === 'spd-up') runtimeStats.fireInterval = Math.max(0.16, runtimeStats.fireInterval * 0.8);
    else if (picked.id === 'hp-up') session.healPlayer(30);
  },
});

const controls = createActionGameControls({
  input: app.input,
  onDisconnect: () => session.pause(),
});
const touchMode = new URLSearchParams(location.search).get('touch') === '1' ? 'always' : 'touch-only';
const touch = createTouchControls({
  controls: controls.touchPlayer, mode: 'hidden', joystick: 'fixed',
  joystickRadius: 44, buttonLayout: 'action',
});
const syncTouch = () => touch.setMode(session.state.phase === 'playing' ? touchMode : 'hidden');
const removePhaseListener = session.director.onPhaseChange(syncTouch);
syncTouch();
let hintDevice = '';

function updateMenuInput(phase) {
  if (phase === 'choice') {
    const cards = Array.from(shell.hud.querySelectorAll('[data-upgrade]'));
    let selected = cards.indexOf(document.activeElement);
    if (controls.wasPressed('next')) cards[(selected + 1) % cards.length]?.focus();
    if (controls.wasPressed('previous')) cards[(selected <= 0 ? cards.length : selected) - 1]?.focus();
    selected = cards.indexOf(document.activeElement);
    if (controls.wasPressed('confirm')) cards[Math.max(0, selected)]?.click();
    return;
  }
  if (phase === 'title' && controls.wasPressed('confirm')) session.startRun();
  if (phase === 'paused' && (controls.wasPressed('confirm') || controls.wasPressed('cancel'))) session.resume();
  if (phase === 'result' && controls.wasPressed('confirm')) session.restart();
}

const scene = app.scenes.add(new Scene('main'));
const world = scene.add(new Entity({ name: 'world' }));
const gridCrowd = world.addComponent(new SpriteCrowd2D({ capacity: 169, shape: 'rect', width: 6, height: 6, color: theme.palette.surface, layer: 0 }));
for (let gy = -6; gy <= 6; gy++) {
  for (let gx = -6; gx <= 6; gx++) {
    gridCrowd.spawn({ x: gx * 120, y: gy * 120 });
  }
}

const enemyCrowd = world.addComponent(new SpriteCrowd2D({ capacity: 256, shape: 'circle', width: 24, height: 24, color: theme.palette.enemy, layer: 2 }));
const boltCrowd = world.addComponent(new SpriteCrowd2D({ capacity: 128, shape: 'circle', width: 10, height: 10, color: theme.palette.projectile, layer: 3 }));
const player = scene.add(new Entity({ name: 'player', width: 28, height: 28 }));
const playerSprite = player.addComponent(new Sprite2D({ shape: 'circle', width: 28, height: 28, color: theme.palette.player, layer: 4, groundShadow: true }));
const vfx = createVfxSystem({ mode: 'webgl2d', sceneOrAdapter: renderer });

const enemies = [];
const bolts = [];
let fireTimer = 0;
let spawnTimer = 0;
let dashTimer = 0;
let dashBurst = 0;
let aimX = 1;
let aimY = 0;

function resetArena() {
  player.x = 0;
  player.y = 0;
  runtimeStats.damage = Math.max(10, Math.round(blueprint.design.balance.weaponDps * 0.6));
  runtimeStats.fireInterval = 0.45;
  enemies.length = 0;
  bolts.length = 0;
  enemyCrowd.clear();
  boltCrowd.clear();
  fireTimer = 0;
  spawnTimer = 0.4;
  dashTimer = 0;
  dashBurst = 0;
  for (let i = 0; i < 4; i++) spawnEnemy();
}

function spawnEnemy() {
  if (enemies.length >= 200) return;
  const angle = session.rng.next() * Math.PI * 2;
  const dist = 240 + session.rng.next() * 140;
  const x = Math.max(-halfSpanPx, Math.min(halfSpanPx, player.x + Math.cos(angle) * dist));
  const y = Math.max(-halfSpanPx, Math.min(halfSpanPx, player.y + Math.sin(angle) * dist));
  const idx = enemyCrowd.spawn({ x, y });
  if (idx < 0) return;
  enemies.push({ idx, x, y, hp: blueprint.design.balance.gruntHp, speed: 95 + session.state.wave * 8, hitCd: 0 });
}

function fireBolt(tx, ty) {
  const len = Math.hypot(tx, ty) || 1;
  const vx = (tx / len) * 520;
  const vy = (ty / len) * 520;
  const idx = boltCrowd.spawn({ x: player.x, y: player.y });
  if (idx < 0) return;
  bolts.push({ idx, x: player.x, y: player.y, vx, vy, life: 1.4 });
  session.audio.play('attack');
}

player.addComponent(new class extends Component {
  fixedUpdate(dt) {
    const phase = session.state.phase;
    controls.update(dt, phase === 'playing' ? 'combat' : 'menu');
    if (phase !== 'playing') {
      if (shell && phase === session.state.phase) updateMenuInput(phase);
      return;
    }
    if (phase !== session.state.phase || controls.wasPressed('pause')) {
      session.pause();
      return;
    }
    if (shell && hintDevice !== controls.device) {
      hintDevice = controls.device;
      const movement = hintDevice === 'keyboard' ? 'WASD' : '◉';
      const attack = controls.getGlyph('attack');
      const dash = controls.getGlyph('dash');
      shell.hud.querySelector('[data-ui-hint]').textContent = [movement, attack, dash].filter(Boolean).join(' · ');
    }
    const mv = controls.move;
    const dx = mv.x;
    const dy = mv.y;
    const mag = Math.hypot(dx, dy);
    if (mag > 0.05) {
      session.notifyMoved();
      aimX = dx / mag;
      aimY = dy / mag;
    }

    dashTimer = Math.max(0, dashTimer - dt);
    dashBurst = Math.max(0, dashBurst - dt);
    if (controls.wasPressed('dash') && dashTimer <= 0) {
      dashTimer = runtimeStats.dashCooldown;
      dashBurst = 0.16;
      session.audio.play('dash');
      vfx.burstParticles({ x: player.x, y: player.y, count: 10, color: theme.palette.primary, speedMin: 60, speedMax: 180, sizeStart: 8, sizeEnd: 2, durationMin: 0.2, durationMax: 0.35 });
    }

    const speed = runtimeStats.moveSpeed * (dashBurst > 0 ? 2.4 : 1);
    if (mag > 0.01) {
      player.x = Math.max(-halfSpanPx, Math.min(halfSpanPx, player.x + dx * speed * dt));
      player.y = Math.max(-halfSpanPx, Math.min(halfSpanPx, player.y + dy * speed * dt));
    }

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = Math.max(0.35, 1.3 - session.state.wave * 0.08);
      spawnEnemy();
    }

    fireTimer -= dt;
    if (fireTimer <= 0 || controls.wasPressed('attack')) {
      let bestDist = Infinity;
      let tx = aimX;
      let ty = aimY;
      for (const e of enemies) {
        const d = Math.hypot(e.x - player.x, e.y - player.y);
        if (d < bestDist) { bestDist = d; tx = e.x - player.x; ty = e.y - player.y; }
      }
      if (bestDist < 420 || controls.isDown('attack')) {
        fireBolt(tx, ty);
        fireTimer = runtimeStats.fireInterval;
      }
    }

    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      boltCrowd.setTransform(b.idx, b.x, b.y);
      let hit = false;
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (Math.hypot(b.x - e.x, b.y - e.y) < 20) {
          hit = true;
          e.hp -= runtimeStats.damage;
          enemyCrowd.hitFlash(e.idx, 0.08);
          vfx.emitHitImpact({ x: e.x, y: e.y, damage: runtimeStats.damage, numberPreset: blueprint.art.damagePreset });
          if (e.hp <= 0) {
            enemyCrowd.kill(e.idx);
            enemies.splice(j, 1);
            const res = session.recordKill({ score: 15, xp: 3, currency: 1 });
            if (res.leveledUp) session.presentChoices();
          } else {
            session.recordHit({ score: 2 });
          }
          break;
        }
      }
      if (hit || b.life <= 0) {
        boltCrowd.kill(b.idx);
        bolts.splice(i, 1);
      }
    }

    for (const e of enemies) {
      e.hitCd = Math.max(0, e.hitCd - dt);
      const ex = player.x - e.x;
      const ey = player.y - e.y;
      const dist = Math.hypot(ex, ey) || 1;
      e.x += (ex / dist) * e.speed * dt;
      e.y += (ey / dist) * e.speed * dt;
      enemyCrowd.setTransform(e.idx, e.x, e.y);
      if (dist < 24 && e.hitCd <= 0 && dashBurst <= 0) {
        e.hitCd = 0.65;
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
    shell?.sync();
  }
}());

shell = mountGameShell({ root: document.body, session, hintKeys: 'WASD · J · K' });
app.scenes.start('main');
app.start();
canvas.dataset.engineReady = 'true';
window.__hgameState = () => ({ ...session.snapshot(), player: { x: player.x, y: player.y }, enemies: enemies.length });

window.addEventListener('pagehide', function onPageHide(event) {
  if (event.persisted) return;
  window.removeEventListener('pagehide', onPageHide);
  removePhaseListener();
  touch.dispose();
  controls.dispose();
  shell.dispose();
  session.dispose();
  vfx.dispose();
  app.dispose();
});
