// Arena Brawler: reference game for the HGame 3D profile (three adapter + spring-arm camera + adaptive quality).
// Rules live in ./sim (pure, headless-testable). This file wires input, procedural meshes, camera and HUD.
import { createArenaSim } from './sim/arena.js';
import { TIER_BUDGET, CONFIG } from './sim/config.js';
import { rayBoxes } from './sim/collide.js';
import { recordRun, loadBest } from './meta.js';

const [gameConfig, engineConfig] = await Promise.all([
  fetch('./game.config.json').then(r => r.json()),
  fetch('./engine.config.json').then(r => r.json()),
]);
const hosted = location.port === '4175' && location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
const [{ HGame, Component, Entity, Scene }, { createThreeAdapter }, { createSpringArm3D }, { createTouchControls }, THREE] = await Promise.all([
  import(base + '/index.js'),
  import(base + '/integrations/three.js'),
  import(base + '/integrations/camera3d.js'),
  import(base + '/integrations/touch-controls.js'),
  import('../assets/vendor/three/three.module.js'),
]);

// QA knobs: ?seed=N, ?tier=low|medium|high (otherwise the adaptive controller picks), ?god=1 for invulnerability.
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') || 1);
const god = params.get('god') === '1';
const debug = params.get('debug') === '1';
const lifetime = new AbortController();

const project = HGame.defineProject(engineConfig);
const canvas = document.querySelector('#game');
const renderer = createThreeAdapter({
  THREE, canvas, shadows: true, toneMapping: 'ueFilmic', exposure: 1.1,
  quality3d: { mode: params.get('tier') ?? gameConfig.quality3d?.mode ?? 'auto',
    device: { mobile: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches },
    onChange(state) { canvas.dataset.qualityTier = state.tier; } },
});
canvas.dataset.qualityTier = renderer.qualityController?.state.tier ?? 'high';
const app = HGame.createApplication({ project, gameId: gameConfig.id, gameVersion: gameConfig.version, renderer });
await app.installFeatures();
const save = app.services.save ?? HGame.createSaveStore({ gameId: gameConfig.id });

// The enemy cap is part of the sim config, so it is fixed per run from the tier we start in.
const tierNow = () => renderer.qualityController?.state.tier ?? 'high';
const newSim = (s) => createArenaSim({ seed: s, tier: tierNow(), godMode: god });
let sim = newSim(seed);
let best = loadBest(save);
let saved = false;

// ---- scene: procedural meshes only ----
const scene = app.scenes.add(new Scene('arena'));
const world = renderer.getWorld(scene);
const SKY = 0x0d1522;
world.background = new THREE.Color(SKY);
world.fog = new THREE.Fog(SKY, 22, 60);
world.add(new THREE.HemisphereLight(0xbcd4ff, 0x2a2430, 1.6));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.position.set(10, 18, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 60 });
sun.shadow.bias = -0.0003;
renderer.setSunLight(sun);
world.add(sun);

const H = CONFIG.arenaHalf;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), new THREE.MeshStandardMaterial({ color: 0x27323f, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; world.add(floor);
const grid = new THREE.GridHelper(H * 2, H, 0x3d4d60, 0x303d4d); grid.position.y = 0.01; world.add(grid);
const wallMat = new THREE.MeshStandardMaterial({ color: 0x46556a, roughness: 0.8 });
for (const [x, z, sx, sz] of [[0, -H, H * 2, 0.6], [0, H, H * 2, 0.6], [-H, 0, 0.6, H * 2], [H, 0, 0.6, H * 2]]) {
  const w = new THREE.Mesh(new THREE.BoxGeometry(sx, 1.4, sz), wallMat); w.position.set(x, 0.7, z); w.castShadow = w.receiveShadow = true; world.add(w);
}
const hues = [0xc27a4e, 0x7a8fc2, 0xa6a06c, 0x8c6cc2, 0x6cc29a, 0xc26c8c];
CONFIG.obstacles.forEach((b, i) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.h, b.hz * 2), new THREE.MeshStandardMaterial({ color: hues[i % hues.length], roughness: 0.7 }));
  m.position.set(b.x, b.h / 2, b.z); m.castShadow = m.receiveShadow = true; world.add(m);
});

// Player: capsule body + nose (shows facing) + spin ring.
const hero = new THREE.Group();
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x60d9b7, roughness: 0.5 });
const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.7, 6, 12), bodyMat); body.position.y = 0.75; body.castShadow = true;
const nose = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.4), new THREE.MeshStandardMaterial({ color: 0xffffff })); nose.position.set(0, 1.0, 0.45); nose.castShadow = true;
const ring = new THREE.Mesh(new THREE.TorusGeometry(CONFIG.player.spinRadius, 0.08, 6, 48), new THREE.MeshBasicMaterial({ color: 0x4cc3ff, transparent: true, opacity: 0.8 }));
ring.rotation.x = Math.PI / 2; ring.position.y = 0.15; ring.visible = false;
hero.add(body, nose, ring); world.add(hero);

// Enemies: one InstancedMesh; per-instance colour carries kind and the hit flash.
const MAXE = TIER_BUDGET.high.maxEnemies;
const enemyMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(CONFIG.enemy.radius, 1), new THREE.MeshStandardMaterial({ roughness: 0.45 }), MAXE);
enemyMesh.castShadow = true; enemyMesh.frustumCulled = false; enemyMesh.count = 0;
enemyMesh.setColorAt(0, new THREE.Color(0xffffff));
world.add(enemyMesh);
const kindColor = [new THREE.Color(0xe0566b), new THREE.Color(0xe08a3c), new THREE.Color(0xc454e0)];
const flash = new THREE.Color(0xffffff);
const mat4 = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(1, 1, 1);
const flashLeft = new Float32Array(MAXE);

// ---- camera: spring arm with box collision probe, lag, Q/E + drag orbit ----
const arm = createSpringArm3D({
  THREE, armLength: 8.5, pitch: -0.62, yaw: Math.PI, minPitch: -1.3, maxPitch: -0.12,
  targetOffset: { x: 0, y: 1.2, z: 0 }, lagHalfLife: 0.07, probeRadius: 0.3,
  collisionTest: (pivot, desired, back, length) => rayBoxes(CONFIG.obstacles, pivot.x, pivot.y, pivot.z, back.x, back.y, back.z, length),
});
arm.snap({ x: sim.player.x, y: 0, z: sim.player.z });
let drag = null;
canvas.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') drag = { x: e.clientX, y: e.clientY, moved: 0 }; }, { signal: lifetime.signal });
window.addEventListener('pointerup', () => { drag = null; }, { signal: lifetime.signal });
window.addEventListener('pointermove', e => {
  if (!drag) return;
  arm.addAngles(-(e.clientX - drag.x) * 0.006, -(e.clientY - drag.y) * 0.004);
  drag.moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
  drag.x = e.clientX; drag.y = e.clientY;
}, { signal: lifetime.signal });

// ---- input: WASD/arrows + touch stick (camera-relative), Space/J jump, K/click spin, Q/E orbit, U restart ----
const arcade = HGame.createArcadeControls({
  input: app.input,
  actions: [{ name: 'jump', label: 'Jump', slot: 'j' }, { name: 'spin', label: 'Spin', slot: 'k' }, { name: 'restart', label: 'Again', slot: 'u' }],
});
const touch = createTouchControls({ controls: arcade.p1, container: document.body, mode: 'touch-only', buttonLayout: 'arc' });
const mv = { x: 0, y: 0, magnitude: 0, active: false };
const input = { mx: 0, mz: 0, jump: false, attack: false };
let clickSpin = false;
canvas.addEventListener('click', () => { if (!drag || drag.moved < 6) clickSpin = true; }, { signal: lifetime.signal });

// ---- HUD ----
const el = id => document.getElementById(id);
const hud = { hp: el('hp').firstElementChild, stats: el('stats'), gameover: el('gameover'), result: el('result') };
el('debug').hidden = !debug;
function syncHud() {
  const { player, state } = sim;
  hud.hp.style.transform = `scaleX(${player.hp / CONFIG.player.hp})`;
  const fps = app.services.diagnostics?.snapshot().fps;
  hud.stats.textContent = `${state.time.toFixed(0)}s   ✦ ${state.kills}`;
  if (debug) el('debug').textContent = `${sim.en.count}/${sim.cap} enemies   ${sim.tier}   ${fps?.toFixed(0) ?? 0} fps`;
  if (state.over && hud.gameover.hidden) {
    if (!saved) { saved = true; const r = recordRun(save, { time: state.time, kills: state.kills, level: 1 }); best = r.best; hud.result.textContent = `✦ ${state.kills} · ${state.time.toFixed(1)}s${r.record ? ' ★' : ''}`; }
    hud.gameover.hidden = false;
  }
}
function restart() {
  sim = newSim(seed + Math.floor(performance.now()));
  saved = false; hud.gameover.hidden = true; window.__arena.sim = sim;
  arm.snap({ x: sim.player.x, y: 0, z: sim.player.z });
}
el('restart').onclick = restart;

function syncView(dt) {
  const { player: p, en } = sim;
  hero.position.set(p.x, p.y, p.z);
  hero.rotation.y = p.yaw;
  bodyMat.emissive.setHex(p.invuln > 0 && Math.floor(sim.state.time * 20) % 2 ? 0xff3030 : 0x000000);
  ring.visible = p.spinT > 0;
  enemyMesh.count = en.count;
  for (let i = 0; i < en.count; i++) {
    if (en.hit[i]) { en.hit[i] = 0; flashLeft[i] = 0.08; }
    flashLeft[i] = Math.max(0, flashLeft[i] - dt);
    pos.set(en.x[i], CONFIG.enemy.radius, en.z[i]);
    mat4.compose(pos, quat, scl); enemyMesh.setMatrixAt(i, mat4);
    enemyMesh.setColorAt(i, flashLeft[i] > 0 ? flash : kindColor[en.kind[i]]);
  }
  enemyMesh.instanceMatrix.needsUpdate = true; enemyMesh.instanceColor.needsUpdate = true;
  arm.applyToCamera(renderer.camera, dt, { x: p.x, y: p.y, z: p.z });
}

class Driver extends Component {
  onDestroy() { lifetime.abort(); touch.dispose(); el('restart').onclick = null; }
  fixedUpdate(dt) {
    arcade.update(dt);
    const p1 = arcade.p1;
    p1.getMove(mv);
    const ix = mv.x + (app.input.isDown('ArrowRight') - app.input.isDown('ArrowLeft'));
    const iy = mv.y + (app.input.isDown('ArrowDown') - app.input.isDown('ArrowUp'));
    // Camera-relative: screen-up (iy<0) walks along the camera's forward vector flattened onto xz.
    const yaw = arm.yaw, sy = Math.sin(yaw), cy = Math.cos(yaw);
    input.mx = ix * cy + iy * sy;
    input.mz = -ix * sy + iy * cy;
    input.jump = app.input.isDown('Space') || Boolean(p1.consumeBuffered('jump'));
    input.attack = clickSpin || app.input.isDown('KeyK') || Boolean(p1.consumeBuffered('spin'));
    clickSpin = false;
    arm.addAngles((app.input.isDown('KeyQ') - app.input.isDown('KeyE')) * 2.2 * dt, 0);
    if (sim.state.over && (p1.consumeBuffered('restart') || app.input.isDown('KeyU'))) { restart(); return; }
    sim.step(dt, input);
  }
  lateUpdate(dt) { syncView(dt); syncHud(); }
}
scene.add(new Entity({ name: 'driver' })).addComponent(new Driver());

app.scenes.start('arena');
app.start();
window.__arena = { app, sim, renderer, arm };
window.__hgameState = () => ({ phase: sim.state.over ? 'over' : 'playing', tick: sim.state.tick,
  time: sim.state.time, kills: sim.state.kills, enemies: sim.en.count,
  player: { x: sim.player.x, y: sim.player.y, z: sim.player.z, hp: sim.player.hp }, best: { ...best },
  running: app.running, disposed: app.disposed, scheduler: app.stats });
canvas.dataset.engineReady = 'true';
window.addEventListener('pagehide', () => { touch.dispose(); app.dispose(); }, { once: true });
