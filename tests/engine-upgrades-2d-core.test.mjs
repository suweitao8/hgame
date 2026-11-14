import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AnimationPlayer,
  Component,
  Entity,
  Scene,
  SpriteSheet,
  TileMap,
  createGameApplication,
  defineProject,
  findGridPath,
} from '../assets/runtime/index.js';
import { Camera2D, Sprite2D, createCanvas2DAdapter } from '../assets/runtime/integrations/canvas2d.js';
import { RapierPhysicsWorld2D } from '../assets/runtime/physics/rapier2d.js';
import { RapierPhysicsWorld3D } from '../assets/runtime/physics/rapier3d.js';
import { createConfirmedFrameScheduler } from '../assets/runtime/lockstep/confirmed-frames.js';

function createPlatformStub() {
  return {
    input: { reset() {}, endFrame() {} },
    lifecycle: { on() { return () => {}; } },
    ready() {},
    dispose() {},
    diagnostics: { recordFrame() {}, reportError() {} },
  };
}

function createRecordingCanvas(width = 640, height = 360) {
  const ops = [];
  const ctx = {
    globalAlpha: 1,
    fillStyle: '#000',
    font: '12px sans-serif',
    textAlign: 'left',
    imageSmoothingEnabled: true,
    save() { ops.push(['save']); },
    restore() { ops.push(['restore']); },
    setTransform(...args) { ops.push(['setTransform', ...args]); },
    transform(...args) { ops.push(['transform', ...args]); },
    translate(x, y) { ops.push(['translate', x, y]); },
    rotate(a) { ops.push(['rotate', a]); },
    scale(x, y) { ops.push(['scale', x, y]); },
    fillRect(x, y, w, h) { ops.push(['fillRect', x, y, w, h, this.fillStyle, this.globalAlpha]); },
    beginPath() {},
    arc(x, y, r) { ops.push(['arc', x, y, r, this.fillStyle]); },
    fill() { ops.push(['fill']); },
    fillText(text, x, y) { ops.push(['fillText', text, x, y, this.fillStyle]); },
    drawImage(...args) { ops.push(['drawImage', ...args]); },
  };
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    getContext: (kind) => (kind === '2d' ? ctx : null),
  };
  return { canvas, ctx, ops };
}

test('Application renderAlpha, interpolatedWorldMatrixInto, snapTransform and zero-GC worldMatrixInto', () => {
  const project = defineProject({ profile: '2d', tickHz: 50, features: ['scene'] });
  const app = createGameApplication({
    project,
    platform: createPlatformStub(),
    renderer: { render() {}, dispose() {} },
  });
  const scene = app.scenes.add(new Scene('interp'));
  const parent = scene.add(new Entity({ x: 0, y: 0, rotationZ: 0 }));
  const child = parent.add(new Entity({ x: 10, y: 0 }));

  class Mover extends Component {
    fixedUpdate() {
      parent.x += 100;
      parent.rotationZ += Math.PI / 2;
    }
  }
  parent.addComponent(new Mover());
  app.scenes.start('interp');

  // 0.02s step tick -> 0.01s yields renderAlpha = 0.5 after capturing previous transforms.
  app.step(0.02);
  assert.ok(Math.abs(app.renderAlpha) < 1e-9);
  app.step(0.01);
  assert.ok(Math.abs(app.renderAlpha - 0.5) < 1e-6);

  const midPos = child.interpolatedWorldPosition(app.renderAlpha);
  // Step 1 transitioned parent.x: 0 -> 100 and rotationZ: 0 -> pi/2; step(0.01) yields alpha = 0.5
  // => interpolated midpoint: parent.x = 50, parent.rotationZ = pi/4.
  const expectedAngle = Math.PI / 4;
  assert.ok(Math.abs(midPos.x - (50 + 10 * Math.cos(expectedAngle))) < 1e-6);
  assert.ok(Math.abs(midPos.y - 10 * Math.sin(expectedAngle)) < 1e-6);

  const scratch = new Float64Array(16);
  const returned = child.worldMatrixInto(scratch);
  assert.equal(returned, scratch);
  const interpReturned = child.interpolatedWorldMatrixInto(0.5, scratch);
  assert.equal(interpReturned, scratch);

  // Teleport + snapTransform disables prior-frame lerping.
  parent.x = 1000;
  parent.rotationZ = 0;
  parent.snapTransform();
  const snapped = parent.interpolatedWorldPosition(0.25);
  assert.equal(snapped.x, 1000);
  assert.equal(snapped.y, 0);

  app.dispose();

  const uiApp = createGameApplication({
    project: defineProject({ profile: 'ui', features: ['scene'] }),
    platform: createPlatformStub(),
    renderer: { render() {}, dispose() {} },
  });
  assert.equal(uiApp.renderAlpha, 1);
  uiApp.dispose();
});

test('Rapier2D syncs rotation, angular velocity and rebinds character controllers across snapshots', () => {
  const physics = new RapierPhysicsWorld2D({ tickHz: 60, gravity: { x: 0, y: 0 } });

  const rotor = new Entity({ x: 0, y: 0, width: 2, height: 1, rotationZ: 0.25 });
  const rotorBody = physics.add(rotor, { type: 'dynamic', angularVelocity: 0 });
  assert.ok(Math.abs(rotorBody.rigidBody.rotation() - 0.25) < 1e-5);
  physics.setAngularVelocity(rotor, Math.PI);
  for (let i = 0; i < 15; i++) physics.step();
  assert.ok(rotor.rotationZ > 0.25 + 0.5);
  assert.ok(Math.abs(physics.getAngularVelocity(rotor) - Math.PI) < 0.2);

  physics.setRotation(rotor, 1.1);
  assert.ok(Math.abs(rotor.rotationZ - 1.1) < 1e-5);
  physics.remove(rotor);

  const floor = new Entity({ x: 0, y: -3, width: 20, height: 2 });
  physics.add(floor, { static: true });

  const player = new Entity({ x: 0, y: -1.4, width: 1, height: 1 });
  physics.add(player, { type: 'kinematicPosition' });
  physics.step();
  const controller = physics.createCharacterController(player, {
    offset: 0.02,
    up: { x: 0, y: 1 },
    slide: true,
    maxSlopeClimbAngle: Math.PI / 4,
    snapToGround: 0.2,
  });

  const stepDown = controller.move({ x: 0.25, y: -2.0 });
  assert.equal(stepDown.grounded, true);
  assert.ok(stepDown.collisions.length >= 1);
  assert.ok(player.y > -2.05, 'floor collider stops player from falling through y=-2 surface');
  physics.step();

  const snap = physics.takeSnapshot();
  const movedX = player.x;
  controller.move({ x: 2, y: 0 });
  physics.step();
  assert.ok(player.x > movedX + 1.5);

  physics.restoreSnapshot(snap);
  assert.ok(Math.abs(player.x - movedX) < 1e-4);

  // Character controller must remain live and collide with restored world.
  const postRestore = controller.move({ x: 0.1, y: -2.0 });
  assert.equal(postRestore.grounded, true);

  assert.equal(controller.dispose(), true);
  assert.equal(controller.dispose(), false);
  physics.dispose();
});

test('Rapier3D syncs Euler/Quaternion rotations and supports 3D CharacterController', () => {
  const physics = new RapierPhysicsWorld3D({ tickHz: 60, gravity: { x: 0, y: 0, z: 0 } });

  const spinner = new Entity({ x: 0, y: 5, z: 0, width: 1, height: 1, depth: 1, rotationY: 0.5 });
  physics.add(spinner, { type: 'dynamic', enabledRotations: [false, true, false] });
  physics.setAngularVelocity(spinner, { x: 4, y: 2, z: 4 });
  for (let i = 0; i < 15; i++) physics.step();
  assert.ok(Math.abs(spinner.rotationX) < 1e-4, 'enabledRotations locked X');
  assert.ok(Math.abs(spinner.rotationZ) < 1e-4, 'enabledRotations locked Z');
  assert.ok(spinner.rotationY > 0.5 + 0.3, 'Y axis rotation advances cleanly');

  const floor = new Entity({ x: 0, y: 0, z: 0, width: 20, height: 1, depth: 20 });
  physics.add(floor, { static: true });

  const pawn = new Entity({ x: 0, y: 1.5, z: 0, width: 0.8, height: 1.8, depth: 0.8 });
  physics.add(pawn, { type: 'kinematicPosition', shape: 'capsule', radius: 0.4, halfHeight: 0.5 });
  physics.step();
  const ctrl = physics.createCharacterController(pawn, { offset: 0.02, up: { x: 0, y: 1, z: 0 } });

  const res = ctrl.move({ x: 0.5, y: -2.0, z: -0.25 });
  assert.equal(res.grounded, true);
  assert.ok(pawn.y >= 1.38 && pawn.y <= 1.55);
  physics.step();

  const snap = physics.takeSnapshot();
  ctrl.move({ x: 3, y: 0, z: 3 });
  physics.step();
  physics.restoreSnapshot(snap);
  const res2 = ctrl.move({ x: 0.1, y: -1.0, z: 0 });
  assert.equal(res2.grounded, true);

  physics.dispose();
});

test('Camera2D, Sprite2D sheet/flip/ySort, frustum culling and screen/world inverse transforms', () => {
  const { canvas, ops } = createRecordingCanvas(800, 600);
  const adapter = createCanvas2DAdapter({
    canvas,
    width: 800,
    height: 600,
    background: '#081018',
    pixelRatio: 1,
    cull: true,
  });

  adapter.camera.bounds = { minX: -50, maxX: 200, minY: -50, maxY: 200 };
  adapter.camera.zoom = 2;
  adapter.camera.rotation = 0.25;
  adapter.camera.follow({ x: 500, y: 500 }, { lerp: 1 });
  assert.equal(adapter.camera.x, 200);
  assert.equal(adapter.camera.y, 200);

  adapter.camera.shake(10, 0.4);
  adapter.camera.update(0.1);
  assert.ok(Math.hypot(adapter.camera.offsetX, adapter.camera.offsetY) > 0);
  adapter.camera.update(0.5);
  assert.equal(adapter.camera.offsetX, 0);
  assert.equal(adapter.camera.offsetY, 0);

  // Screen <-> world round trip under pan, zoom, and rotation.
  const screenPt = adapter.worldToScreen(215, 180);
  const roundTrip = adapter.screenToWorld(screenPt.x, screenPt.y);
  assert.ok(Math.abs(roundTrip.x - 215) < 1e-6);
  assert.ok(Math.abs(roundTrip.y - 180) < 1e-6);

  adapter.camera.rotation = 0;
  adapter.camera.zoom = 1;
  adapter.camera.x = 0;
  adapter.camera.y = 0;

  const scene = new Scene('sprites');
  scene.app = { renderer: adapter };
  scene._setActive(true);

  const img = { width: 64, height: 32 };
  const sheet = new SpriteSheet({ image: img, frameWidth: 32, frameHeight: 32 });
  const anim = new AnimationPlayer().define('walk', { frames: [0, 1], fps: 10, loop: true }).play('walk');
  anim.update(0.12);

  // Lower y but ySort: true -> rendered BEFORE higher y on same layer!
  const lower = scene.add(new Entity({ x: 10, y: 20, anchorX: 0, anchorY: 0 }));
  lower.addComponent(new Sprite2D({
    sheet, animation: anim, width: 32, height: 32, layer: 1, ySort: true, flipX: true, opacity: 0.75,
  }));

  const upper = scene.add(new Entity({ x: 10, y: -10 }));
  upper.addComponent(new Sprite2D({ shape: 'rect', color: '#ff0000', width: 20, height: 20, layer: 1, ySort: true }));

  const bg = scene.add(new Entity({ x: 0, y: 0 }));
  bg.addComponent(new Sprite2D({ shape: 'rect', color: '#00ff00', width: 20, height: 20, layer: 0 }));

  const culled = scene.add(new Entity({ x: 5000, y: 5000 }));
  culled.addComponent(new Sprite2D({ shape: 'rect', color: '#0000ff', width: 20, height: 20, layer: 2 }));

  const hidden = scene.add(new Entity({ x: 0, y: 0 }));
  hidden.addComponent(new Sprite2D({ shape: 'rect', color: '#ffff00', width: 20, height: 20, visible: false }));

  adapter.render(scene);

  const spriteDraws = ops.filter(op =>
    (op[0] === 'fillRect' && op[5] !== '#081018') || op[0] === 'drawImage'
  );
  // Order: layer 0 (#00ff00), layer 1 upper (#ff0000 at y=-10), layer 1 lower (drawImage at y=20); culled & hidden skipped.
  assert.equal(spriteDraws.length, 3);
  assert.equal(spriteDraws[0][5], '#00ff00');
  assert.equal(spriteDraws[1][5], '#ff0000');
  assert.equal(spriteDraws[2][0], 'drawImage');
  assert.equal(spriteDraws[2][2], 32, 'animated sheet frame 1 sx = 32');
  assert.ok(ops.some(op => op[0] === 'scale' && op[1] === -1 && op[2] === 1));

  scene.dispose();
  adapter.dispose();
});

test('TileMap viewBounds culling, sheet rendering and octile findGridPath corner guard', () => {
  const tiles = Array.from({ length: 40 }, () => Array.from({ length: 40 }, (_, x) => (x % 2)));
  const map = new TileMap({ tiles, tileWidth: 32, tileHeight: 32 });
  const sheet = new SpriteSheet({ image: { width: 64, height: 32 }, frameWidth: 32, frameHeight: 32 });

  const ops = [];
  const ctx = {
    drawImage(...args) { ops.push(['drawImage', ...args]); },
    fillRect(...args) { ops.push(['fillRect', ...args]); },
    fillStyle: '#000',
  };
  map.draw(ctx, {
    sheet,
    viewBounds: { minX: 32, minY: 64, maxX: 95, maxY: 127 },
  });
  // Only tiles x in [1..2], y in [2..3] -> 2x2 = 4 tiles drawn instead of 1600!
  assert.equal(ops.length, 4);
  assert.equal(ops[0][0], 'drawImage');

  // Corner-cutting guard:
  // S #
  // # G
  const grid = new TileMap({
    tiles: [
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, 0],
    ],
    solid: [1],
  });
  const blockedDiag = findGridPath(grid, { x: 0, y: 0 }, { x: 1, y: 1 }, {
    allowDiagonal: true,
    preventCornerCutting: true,
  });
  assert.deepEqual(blockedDiag, []);

  const allowedDiag = findGridPath(grid, { x: 0, y: 0 }, { x: 1, y: 1 }, {
    allowDiagonal: true,
    preventCornerCutting: false,
  });
  assert.deepEqual(allowedDiag, [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
});

test('confirmed frame scheduler adaptiveCatchup accelerates multi-frame backlog recovery safely', () => {
  const ticks = [];
  const makeScheduler = (opts) => createConfirmedFrameScheduler({
    netHz: 10,
    logicHz: 20,
    playerIds: [0],
    startBufferFrames: 2,
    maxBufferFrames: 32,
    maxStepsPerUpdate: 6,
    simulate: (_inputs, meta) => ticks.push(meta.logicTick),
    ...opts,
  });

  const adaptive = makeScheduler({ adaptiveCatchup: true, maxExtraStepsPerUpdate: 4 });
  for (let i = 1; i <= 8; i++) {
    assert.equal(adaptive.enqueue({ netTick: i, inputs: [{ pid: 0, buttons: i }] }), true);
  }
  adaptive.advanceElapsedMs(0); // start
  // excessFrames = 8 - (2 + 1) = 5 -> recoveryBudget = min(4, 10) = 4; 50ms real step = 1 => 5 completed!
  const completed = adaptive.advanceElapsedMs(50);
  assert.equal(completed, 5);
  assert.equal(adaptive.catchupSteps, 4);
  assert.deepEqual(ticks, [1, 2, 3, 4, 5]);
});
