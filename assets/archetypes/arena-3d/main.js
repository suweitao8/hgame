// Universal 3D Arena Archetype wired to HGame's 5-Pillar Kit (Design, UI, Gameplay, Art, Audio).
import { installPresentationSky } from './presentation-sky.js';

const hosted = location.port === '4175' && location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
const [
  gameConfig, engineConfig, designBlueprint, presentation,
  { createGameApplication }, { defineProject }, { Component }, { Entity }, { Scene },
  { createThreeAdapter }, { createHeightfieldTerrain3D }, { createVfxSystem },
  { createArcadeControls }, { createTouchControls },
  { defineGameBlueprint, getArtTheme, createGameSession, mountGameShell },
  THREE,
] = await Promise.all([
  fetch('./game.config.json').then(r => r.json()),
  fetch('./engine.config.json').then(r => r.json()),
  fetch('./src/game.design.json').then(r => r.json()),
  fetch('./src/presentation.json').then(r => r.json()),
  import(base + '/core/application.js'),
  import(base + '/core/config.js'),
  import(base + '/core/component.js'),
  import(base + '/core/entity.js'),
  import(base + '/core/scene.js'),
  import(base + '/integrations/three.js'),
  import(base + '/world/terrain3d.js'),
  import(base + '/vfx/index.js'),
  import(base + '/platform/input/arcade.js'),
  import(base + '/integrations/touch-controls.js'),
  import(base + '/kit/index.js'),
  import('../assets/vendor/three/three.module.js'),
]);

const blueprint = defineGameBlueprint(designBlueprint);
const theme = getArtTheme(blueprint.art.theme);
const project = defineProject(engineConfig);
const canvas = document.querySelector('#game');
const renderer = createThreeAdapter({
  ...presentation.renderer,
  THREE,
  canvas,
  quality3d: project.features.includes('adaptiveQuality3d') ? { mode: presentation.quality ?? 'auto' } : null,
});

const app = createGameApplication({
  project,
  gameId: gameConfig.id,
  gameVersion: gameConfig.version,
  renderer,
});
await app.installFeatures();

const scene = app.scenes.add(new Scene('arena3d'));
await installPresentationSky({ app, scene, renderer, THREE, base, Component, Entity, settings: presentation.sky });
const world = renderer.getWorld(scene);
const vfx = createVfxSystem({ mode: '3d', THREE, sceneOrAdapter: world });

const halfSpan = Math.max(16, blueprint.design.balance.arenaSpan * 0.5);
const terrain = createHeightfieldTerrain3D({
  width: halfSpan * 2.4,
  depth: halfSpan * 2.4,
  segmentsX: 32,
  segmentsZ: 32,
  maxHeight: 1.2,
  edgeFalloff: 'island',
});
world.add(terrain.createMesh(THREE, { color: theme.palette.surface }).mesh);
if (scene.physics) terrain.attachPhysics(scene.physics);

const playerMesh = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.45, 0.9, 4, 12),
  new THREE.MeshStandardMaterial({ color: theme.palette.player, roughness: 0.45, metalness: 0.15 }),
);
playerMesh.castShadow = true;
world.add(playerMesh);

const enemyGeo = new THREE.BoxGeometry(0.9, 1.3, 0.9);
const enemyMat = new THREE.MeshStandardMaterial({ color: theme.palette.enemy, roughness: 0.5 });

const runtimeStats = {
  moveSpeed: blueprint.design.feel.playerSpeed,
  damage: Math.max(12, Math.round(blueprint.design.balance.weaponDps * 0.65)),
  attackRange: 4.5,
  attackCooldown: 0.5,
};

let shell = null;
const session = createGameSession({
  blueprint,
  app,
  onStartRun() { resetArena3D(); },
  onChoice(picked) {
    if (picked.id === 'atk-up') runtimeStats.damage = Math.round(runtimeStats.damage * 1.25);
    else if (picked.id === 'spd-up') runtimeStats.attackCooldown = Math.max(0.18, runtimeStats.attackCooldown * 0.8);
    else if (picked.id === 'hp-up') session.healPlayer(30);
  },
});

const arcade = createArcadeControls({
  input: app.input,
  actions: [
    { name: 'attack', label: 'ATK', slot: 'j' },
    { name: 'dash', label: 'DASH', slot: 'k' },
  ],
});
const touch = createTouchControls({ controls: arcade.p1, container: document.body, mode: 'touch-only' });

const playerPos = { x: 0, z: 0 };
const enemies = [];
let spawnTimer = 0.5;
let attackTimer = 0;
let dashTimer = 0;
let dashBurst = 0;

function sampleY(x, z) {
  return typeof terrain.sampleHeight === 'function' ? terrain.sampleHeight(x, z) : 0;
}

function resetArena3D() {
  playerPos.x = 0;
  playerPos.z = 0;
  runtimeStats.damage = Math.max(12, Math.round(blueprint.design.balance.weaponDps * 0.65));
  runtimeStats.attackCooldown = 0.5;
  while (enemies.length > 0) {
    const e = enemies.pop();
    world.remove(e.mesh);
  }
  spawnTimer = 0.5;
  attackTimer = 0;
  dashTimer = 0;
  dashBurst = 0;
  for (let i = 0; i < 3; i++) spawnEnemy3D();
}

function spawnEnemy3D() {
  if (enemies.length >= 24) return;
  const ang = session.rng.nextFloat() * Math.PI * 2;
  const r = 9 + session.rng.nextFloat() * 7;
  const x = Math.max(-halfSpan, Math.min(halfSpan, playerPos.x + Math.cos(ang) * r));
  const z = Math.max(-halfSpan, Math.min(halfSpan, playerPos.z + Math.sin(ang) * r));
  const mesh = new THREE.Mesh(enemyGeo, enemyMat);
  mesh.castShadow = true;
  mesh.position.set(x, sampleY(x, z) + 0.65, z);
  world.add(mesh);
  enemies.push({ x, z, hp: blueprint.design.balance.gruntHp, speed: 3.1 + session.state.wave * 0.2, hitCd: 0, mesh });
}

const ctrl = scene.add(new Entity({ name: 'arena3d-ctrl' }));
ctrl.addComponent(new class extends Component {
  fixedUpdate(dt) {
    if (session.state.phase !== 'playing') return;
    const mv = arcade.p1.move;
    const mag = Math.hypot(mv.x, mv.y);
    if (mag > 0.05) session.notifyMoved();

    dashTimer = Math.max(0, dashTimer - dt);
    dashBurst = Math.max(0, dashBurst - dt);
    if (arcade.p1.wasPressed('dash') && dashTimer <= 0) {
      dashTimer = blueprint.design.feel.dashCooldownSec;
      dashBurst = 0.16;
      session.audio.play('dash');
    }

    const spd = runtimeStats.moveSpeed * (dashBurst > 0 ? 2.2 : 1);
    if (mag > 0.01) {
      playerPos.x = Math.max(-halfSpan, Math.min(halfSpan, playerPos.x + (mv.x / mag) * spd * dt));
      playerPos.z = Math.max(-halfSpan, Math.min(halfSpan, playerPos.z + (mv.y / mag) * spd * dt));
    }

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = Math.max(0.7, 1.8 - session.state.wave * 0.12);
      spawnEnemy3D();
    }

    attackTimer = Math.max(0, attackTimer - dt);
    if (attackTimer <= 0 || arcade.p1.wasPressed('attack')) {
      let targetIdx = -1;
      let bestDist = runtimeStats.attackRange;
      for (let i = 0; i < enemies.length; i++) {
        const d = Math.hypot(enemies[i].x - playerPos.x, enemies[i].z - playerPos.z);
        if (d < bestDist) { bestDist = d; targetIdx = i; }
      }
      if (targetIdx >= 0 || arcade.p1.wasPressed('attack')) {
        attackTimer = runtimeStats.attackCooldown;
        session.audio.play('attack');
        const py = sampleY(playerPos.x, playerPos.z) + 0.9;
        vfx.slashArc({ x: playerPos.x, y: py, z: playerPos.z, radius: 2.2, color: theme.vfx.slashColor });
        if (targetIdx >= 0) {
          const e = enemies[targetIdx];
          e.hp -= runtimeStats.damage;
          const ey = sampleY(e.x, e.z) + 1.0;
          vfx.emitHitImpact({ x: e.x, y: ey, z: e.z, damage: runtimeStats.damage, numberPreset: blueprint.art.damagePreset });
          if (e.hp <= 0) {
            world.remove(e.mesh);
            enemies.splice(targetIdx, 1);
            const k = session.recordKill({ score: 20, xp: 4, currency: 1 });
            if (k.leveledUp) session.presentChoices();
          } else {
            session.recordHit({ score: 3 });
          }
        }
      }
    }

    for (const e of enemies) {
      e.hitCd = Math.max(0, e.hitCd - dt);
      const dx = playerPos.x - e.x;
      const dz = playerPos.z - e.z;
      const d = Math.hypot(dx, dz) || 1;
      e.x += (dx / d) * e.speed * dt;
      e.z += (dz / d) * e.speed * dt;
      e.mesh.position.set(e.x, sampleY(e.x, e.z) + 0.65, e.z);
      if (d < 1.15 && e.hitCd <= 0 && dashBurst <= 0) {
        e.hitCd = 0.75;
        session.damagePlayer(blueprint.design.balance.gruntDamage);
      }
    }

    const targetWave = 1 + Math.floor(session.state.elapsed / Math.max(12, blueprint.design.balance.waveDurationSec * 0.5));
    if (targetWave > session.state.wave) session.setWave(targetWave);
  }
  update(dt) {
    session.update(dt);
    const py = sampleY(playerPos.x, playerPos.z);
    playerMesh.position.set(playerPos.x, py + 0.9, playerPos.z);
    const cam = renderer.camera;
    if (cam) {
      cam.position.set(playerPos.x, py + 11, playerPos.z + 13);
      cam.lookAt(playerPos.x, py + 0.8, playerPos.z);
    }
    vfx.update(dt, cam?.position ?? null);
    shell?.sync();
  }
}());

shell = mountGameShell({ root: document.body, session, hintKeys: 'WASD · J · K' });
app.scenes.start('arena3d');
app.start();
canvas.dataset.engineReady = 'true';
window.__hgameState = () => ({ ...session.snapshot(), enemies: enemies.length });

window.addEventListener('pagehide', function onPageHide(event) {
  if (event.persisted) return;
  window.removeEventListener('pagehide', onPageHide);
  touch.dispose();
  shell.dispose();
  session.dispose();
  vfx.dispose();
  enemyGeo.dispose();
  enemyMat.dispose();
  app.dispose();
});
