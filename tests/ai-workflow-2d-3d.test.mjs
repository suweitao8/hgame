import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  EASING,
  Entity,
  ObjectPool,
  Scene,
  SpatialHash2D,
  TweenManager,
  createGameApplication,
  createAudioManager,
  defineProject,
} from '../assets/runtime/index.js';
import { Sprite2D, createCanvas2DAdapter } from '../assets/runtime/integrations/canvas2d.js';
import {
  createModel3DProvider,
  inspectModel3D,
  prepareAnimationClips,
} from '../assets/runtime/integrations/model3d.js';

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
  const createCtx = (tag) => ({
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    font: '12px sans-serif',
    textAlign: 'left',
    imageSmoothingEnabled: true,
    save() { ops.push([tag, 'save']); },
    restore() { ops.push([tag, 'restore']); },
    setTransform(...args) { ops.push([tag, 'setTransform', ...args]); },
    transform(...args) { ops.push([tag, 'transform', ...args]); },
    translate(x, y) { ops.push([tag, 'translate', x, y]); },
    rotate(a) { ops.push([tag, 'rotate', a]); },
    scale(x, y) { ops.push([tag, 'scale', x, y]); },
    clearRect(x, y, w, h) { ops.push([tag, 'clearRect', x, y, w, h]); },
    fillRect(x, y, w, h) { ops.push([tag, 'fillRect', x, y, w, h, this.fillStyle, this.globalAlpha, this.globalCompositeOperation]); },
    beginPath() {},
    arc(x, y, r) { ops.push([tag, 'arc', x, y, r, this.fillStyle, this.globalAlpha]); },
    fill() { ops.push([tag, 'fill']); },
    fillText(text, x, y) { ops.push([tag, 'fillText', text, x, y, this.fillStyle]); },
    drawImage(...args) { ops.push([tag, 'drawImage', ...args, this.globalAlpha]); },
  });
  const mainCtx = createCtx('main');
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    getContext: (kind) => (kind === '2d' ? mainCtx : null),
  };
  const createBufferCanvas = (bw, bh) => {
    const bctx = createCtx('buf');
    return {
      width: bw,
      height: bh,
      getContext: () => bctx,
    };
  };
  return { canvas, mainCtx, ops, createBufferCanvas };
}

test('TweenManager easings, yoyo/repeat, delay, killTweensOf, sequence and Scene.tweens presets', () => {
  for (const name of [
    'linear', 'easeInQuad', 'easeOutQuad', 'easeInOutQuad', 'easeOutCubic',
    'easeInCubic', 'easeInOutCubic', 'easeInSine', 'easeOutSine', 'easeInOutSine',
    'easeInExpo', 'easeOutExpo', 'easeInBack', 'easeOutBack', 'easeInOutBack',
    'easeOutElastic', 'easeOutBounce',
  ]) {
    const fn = EASING[name];
    assert.equal(typeof fn, 'function', `missing easing ${name}`);
    assert.ok(Math.abs(fn(0)) < 1e-6, `${name}(0) should be ~0`);
    assert.ok(Math.abs(fn(1) - 1) < 1e-6, `${name}(1) should be ~1`);
  }
  assert.ok(EASING.easeOutBack(0.5) > 1);

  const tm = new TweenManager();
  const obj = { x: 0, y: 0 };
  let completed = 0;
  tm.add(obj, { x: 10 }, {
    delay: 0.1,
    duration: 0.2,
    repeat: 1,
    yoyo: true,
    onComplete: () => completed++,
  });
  tm.update(0.1);
  assert.equal(obj.x, 0, 'still waiting for delay');
  tm.update(0.1);
  assert.ok(Math.abs(obj.x - 5) < 1e-6);
  tm.update(0.1);
  assert.ok(Math.abs(obj.x - 10) < 1e-6);
  tm.update(0.1);
  assert.ok(Math.abs(obj.x - 5) < 1e-6);
  tm.update(0.1);
  assert.ok(Math.abs(obj.x - 0) < 1e-6);
  assert.equal(completed, 1);
  assert.equal(tm.tweens.size, 0);

  // Sequence with pause and multi-step values
  const seqOrder = [];
  tm.sequence(obj, [
    { values: { y: 20 }, duration: 0.1, onComplete: () => seqOrder.push('step1') },
    { wait: 0.1, onComplete: () => seqOrder.push('wait') },
    { values: { y: 0 }, duration: 0.1, onComplete: () => seqOrder.push('step2') },
  ], { onComplete: () => seqOrder.push('done') });
  tm.update(0.1);
  assert.equal(obj.y, 20);
  tm.update(0.1);
  tm.update(0.1);
  assert.equal(obj.y, 0);
  assert.deepEqual(seqOrder, ['step1', 'wait', 'step2', 'done']);

  // Scene.tweens auto-steps in 2D (fixedUpdate) and drives idle -> run -> attackLunge -> dieKnockback on Sprite2D
  const project = defineProject({ profile: '2d', tickHz: 50, features: ['scene'] });
  const app = createGameApplication({
    project,
    platform: createPlatformStub(),
    renderer: { render() {}, dispose() {} },
  });
  const scene = app.scenes.add(new Scene('brotato'));
  const ent = scene.add(new Entity({ x: 100, y: 120 }));
  const sprite = ent.addComponent(new Sprite2D({ width: 32, height: 32 }));
  app.scenes.start('brotato');

  scene.tweens.idle(sprite, { scaleAmt: 0.1, duration: 0.4 });
  app.step(0.1);
  app.step(0.1);
  assert.ok(sprite.scaleX > 1 && sprite.scaleY < 1);

  scene.tweens.run(sprite, { bobHeight: 8, tiltRad: 0.2, duration: 0.2 });
  app.step(0.1);
  assert.ok(sprite.offsetY < 0);

  let apexReached = false;
  let lungeDone = false;
  scene.tweens.attackLunge(sprite, 1, 0, {
    distance: 20,
    windup: 0.04,
    strike: 0.08,
    recover: 0.1,
    onApex: () => { apexReached = true; },
    onComplete: () => { lungeDone = true; },
  });
  app.step(0.04); // windup moves slightly opposite direction
  assert.ok(sprite.offsetX < 0);
  app.step(0.08); // strike reaches +20
  assert.equal(apexReached, true);
  assert.ok(Math.abs(sprite.offsetX - 20) < 1e-4);
  app.step(0.1); // recover returns cleanly to 0
  assert.equal(lungeDone, true);
  assert.ok(Math.abs(sprite.offsetX) < 1e-4);
  assert.equal(ent.x, 100, 'attackLunge never mutates entity logical hitbox position');
  assert.equal(ent.y, 120);

  let deathDone = false;
  scene.tweens.dieKnockback(sprite, -1, 0, {
    distance: 30,
    duration: 0.2,
    onComplete: () => { deathDone = true; },
  });
  app.step(0.1);
  app.step(0.1);
  assert.equal(deathDone, true);
  assert.ok(Math.abs(sprite.offsetX + 30) < 1e-4);
  assert.equal(sprite.opacity, 0);
  app.dispose();

  // UI profile (tickHz: 0) still advances scene.tweens during update()
  const uiApp = createGameApplication({
    project: defineProject({ profile: 'ui', features: ['scene'] }),
    platform: createPlatformStub(),
    renderer: { render() {}, dispose() {} },
  });
  const uiScene = uiApp.scenes.add(new Scene('ui'));
  const card = { scale: 1 };
  uiApp.scenes.start('ui');
  uiScene.tweens.add(card, { scale: 1.5 }, { duration: 0.2 });
  uiApp.step(0.1);
  assert.ok(Math.abs(card.scale - 1.25) < 1e-6);
  uiApp.dispose();
});

test('Sprite2D visual transform decoupling, foot anchor, and source-in hitFlash/tint rendering', () => {
  const { canvas, ops, createBufferCanvas } = createRecordingCanvas(320, 180);
  const adapter = createCanvas2DAdapter({
    canvas,
    width: 320,
    height: 180,
    createBufferCanvas,
  });
  const project = defineProject({ profile: '2d', tickHz: 50, features: ['scene'] });
  const app = createGameApplication({
    project,
    platform: createPlatformStub(),
    renderer: adapter,
  });
  const scene = app.scenes.add(new Scene('sprite-juice'));
  const ent = scene.add(new Entity({ x: 0, y: 0 }));
  const fakeImage = { width: 64, height: 64 };
  const sprite = ent.addComponent(new Sprite2D({
    image: fakeImage,
    width: 32,
    height: 48,
    anchorY: 1,
    offsetX: 6,
    offsetY: -4,
    scaleX: 1.1,
    scaleY: 0.9,
    rotation: 0.25,
    tint: '#4488ff',
  }));
  app.scenes.start('sprite-juice');

  sprite.hitFlash(0.1, '#ffffff');
  assert.equal(sprite.flash, 1);

  app.step(0.05);
  assert.ok(Math.abs(sprite.flash - 0.5) < 1e-6);

  // Verify offscreen buffer executed source-in silhouette fills for both tint and flash
  const sourceInFills = ops.filter(op => op[0] === 'buf' && op[1] === 'fillRect' && op[8] === 'source-in');
  assert.equal(sourceInFills.length, 2);
  assert.equal(sourceInFills[0][6], '#4488ff');
  assert.equal(sourceInFills[1][6], '#ffffff');

  // Verify sprite visual rotation/scale applied and hitFlash clears after full duration
  assert.equal(sprite.visualRotation, 0.25);
  app.step(0.05);
  assert.equal(sprite.flash, 0);
  assert.equal(ent.x, 0);
  assert.equal(ent.y, 0);
  app.dispose();
});

test('ObjectPool and SpatialHash2D handle survivor queries, deduplication and soft separation', () => {
  const pool = new ObjectPool({
    create: () => ({ id: Math.random(), x: 0, y: 0 }),
    reset: (item, x, y) => { item.x = x; item.y = y; },
    initialSize: 2,
    maxSize: 3,
  });
  assert.equal(pool.freeCount, 2);
  assert.equal(pool.activeCount, 0);

  const a = pool.acquire(10, 20);
  const b = pool.acquire(30, 40);
  const c = pool.acquire(50, 60);
  assert.equal(a.x, 10);
  assert.equal(pool.activeCount, 3);
  assert.equal(pool.freeCount, 0);

  assert.equal(pool.release(a), true);
  assert.equal(pool.release(a), false, 'duplicate release must be ignored');
  pool.release(b);
  pool.release(c);
  const d = pool.acquire(1, 2);
  pool.release(d);
  assert.equal(pool.freeCount, 3);
  pool.clear();
  assert.equal(pool.freeCount, 0);

  const hash = new SpatialHash2D({ cellSize: 32 });
  const big = { name: 'boss' };
  const near = { name: 'minion' };
  const far = { name: 'far' };
  hash.insert(big, 32, 32, 40);
  hash.insert(near, 45, 34, 8);
  hash.insert(far, 300, 300, 8);

  const hit = hash.queryRadius(30, 30, 12);
  assert.equal(hit.length, 2, 'multi-cell entity must not be returned multiple times');
  assert.ok(hit.includes(big));
  assert.ok(hit.includes(near));

  const boxHit = hash.queryAABB(290, 290, 310, 310);
  assert.deepEqual(boxHit, [far]);

  // Horde soft separation pushes stacked & overlapping enemies cleanly apart
  const swarm = [
    { x: 0, y: 0, radius: 10 },
    { x: 0, y: 0, radius: 10 },
    { x: 5, y: 0, radius: 10 },
  ];
  hash.resolveSoftSeparation(swarm, { strength: 1, iterations: 3 });
  assert.ok(Math.hypot(swarm[1].x - swarm[0].x, swarm[1].y - swarm[0].y) > 8);
});

test('model3d supports inspectModel3D, Unreal namespace/root-motion stripping, loadClips, targetHeight/alignGround, bone sockets and overlays', async () => {
  // Build a centimeter-scale (180 units high) rigged skeleton with Unreal-style namespaced bones
  const rootBone = new THREE.Bone();
  rootBone.name = 'Armature|pelvis';
  const handBone = new THREE.Bone();
  handBone.name = 'Armature|hand_r';
  handBone.position.set(20, 90, 0);
  rootBone.add(handBone);

  // Offset box vertically so min.y=50..max.y=230 (180 units tall, floating 50cm off floor)
  const geom = new THREE.BoxGeometry(40, 180, 40);
  geom.translate(0, 140, 0);
  const posAttr = geom.attributes.position;
  const skinIndices = [];
  const skinWeights = [];
  for (let i = 0; i < posAttr.count; i++) {
    skinIndices.push(0, 1, 0, 0);
    skinWeights.push(0.5, 0.5, 0, 0);
  }
  geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

  const protoScene = new THREE.Group();
  const skinned = new THREE.SkinnedMesh(geom, new THREE.MeshStandardMaterial());
  protoScene.add(rootBone);
  protoScene.add(skinned);
  protoScene.updateMatrixWorld(true);
  skinned.bind(new THREE.Skeleton([rootBone, handBone]));

  const rawWalkClip = new THREE.AnimationClip('Walk', 1.0, [
    new THREE.VectorKeyframeTrack('Armature|pelvis.position', [0, 0.5, 1.0], [1, 90, 2, 100, 105, 50, 200, 90, 100]),
    new THREE.NumberKeyframeTrack('Armature|hand_r.rotation[z]', [0, 0.5, 1.0], [0, 0.8, 0]),
  ]);
  const rawOverlayClip = new THREE.AnimationClip('Fire', 0.5, [
    new THREE.NumberKeyframeTrack('Armature|hand_r.rotation[x]', [0, 0.25, 0.5], [0, -0.9, 0]),
  ]);

  const info = inspectModel3D(THREE, { scene: protoScene, animations: [rawWalkClip] });
  assert.ok(Math.abs(info.bounds.size.y - 180) < 1e-4);
  assert.deepEqual(info.boneNames, ['Armature|pelvis', 'Armature|hand_r']);
  assert.equal(info.meshCount, 1);
  assert.equal(info.skinnedMeshCount, 1);
  assert.equal(info.clips[0].hasRootMotion, true);

  const prepped = prepareAnimationClips(THREE, [rawWalkClip], {
    stripNamespace: true,
    stripRootMotion: 'xz',
  });
  assert.equal(prepped[0].tracks[0].name, 'pelvis.position');
  assert.equal(prepped[0].tracks[1].name, 'hand_r.rotation[z]');
  // X and Z locked to frame 0 (1, 2), Y retains jump bounce (105)
  assert.deepEqual(Array.from(prepped[0].tracks[0].values), [1, 90, 2, 1, 105, 2, 1, 90, 2]);

  // loadClips from separate Unreal animation GLB without geometry
  const provider = createModel3DProvider({
    THREE,
    loader: {
      async loadAsync(url) {
        if (url.endsWith('slash.glb')) {
          return { scene: null, animations: [rawWalkClip] };
        }
        throw new Error('Unexpected URL ' + url);
      },
    },
  });
  await assert.rejects(() => provider.loadClips('../secret.glb'), /traversal/i);
  const loadedClips = await provider.loadClips('assets/anims/slash.glb', {
    clipName: 'Slash',
    stripRootMotion: 'xz',
  });
  assert.equal(loadedClips.length, 1);
  assert.equal(loadedClips[0].name, 'Slash');

  provider.registerAsset('assets/models/hero.glb', {
    scene: protoScene,
    animations: [loadedClips[0], rawOverlayClip],
    owned: true,
  });
  const heroAsset = await provider.load('assets/models/hero.glb');
  assert.equal(provider.inspect(heroAsset).boneNames.length, 2);

  const addedObjects = [];
  const project = defineProject({ profile: '3d', tickHz: 60, features: ['scene', 'model3d'] });
  const app = createGameApplication({
    project,
    platform: createPlatformStub(),
    renderer: {
      render() {},
      add(_s, obj) { addedObjects.push(obj); },
      remove(_s, obj) {
        const at = addedObjects.indexOf(obj);
        if (at !== -1) addedObjects.splice(at, 1);
      },
      dispose() {},
    },
  });
  await app.installFeatures({ model3d: provider });

  const scene = app.scenes.add(new Scene('unreal'));
  const ent = scene.add(new Entity({ x: 0, y: 0, z: 0 }));
  const modelComp = ent.addComponent(provider.createComponent({
    asset: heroAsset,
    targetHeight: 1.8,
    alignGround: true,
    rotationY: Math.PI,
    stripNamespace: true,
  }));
  app.scenes.start('unreal');

  assert.ok(Math.abs(modelComp.modelRoot.scale.y - 0.01) < 1e-6);
  assert.ok(Math.abs(modelComp.modelRoot.position.y + 0.5) < 1e-4, 'shifts floating 50cm origin down by -0.5m');
  modelComp.object3d.updateMatrixWorld(true);
  const alignedWorldBox = new THREE.Box3().setFromObject(modelComp.object3d);
  assert.ok(Math.abs(alignedWorldBox.min.y) < 1e-4, 'aligned bounding bottom touches y=0');
  assert.ok(Math.abs((alignedWorldBox.max.y - alignedWorldBox.min.y) - 1.8) < 1e-4, 'scaled world height equals 1.8m');
  assert.ok(Math.abs(modelComp.modelRoot.rotation.y - Math.PI) < 1e-6);

  const weapon = new THREE.Object3D();
  const socket = modelComp.attachToBone('Hand_R', weapon, { position: { x: 2, y: 0, z: 0 } });
  assert.equal(socket.bone.name, 'hand_r');
  assert.equal(handBone.name, 'Armature|hand_r', 'prototype skeleton names untouched');
  assert.equal(weapon.parent, socket.bone);

  let finishedSlash = null;
  assert.equal(modelComp.play('Slash', {
    loop: false,
    onComplete: (name) => { finishedSlash = name; },
  }), true);

  let finishedOverlay = null;
  assert.equal(modelComp.playOverlay('Fire', {
    loop: false,
    weight: 0.9,
    fadeIn: 0,
    fadeOut: 0,
    onComplete: (name) => { finishedOverlay = name; },
  }), true);

  // Step 0.25s -> verify both base Slash and overlay Fire actually drive bone rotations cleanly
  app.step(0.25);
  assert.ok(Math.abs(socket.bone.rotation.z) > 0.1, 'base clip drives hand bone rotation.z');
  assert.ok(Math.abs(socket.bone.rotation.x) > 0.1, 'overlay clip drives hand bone rotation.x concurrently');

  // Step to 0.55s -> Fire (0.5s) completes; Slash (1.0s) still playing
  app.step(0.15);
  app.step(0.15);
  assert.equal(finishedOverlay, 'Fire');
  assert.equal(finishedSlash, null);

  // Step remaining time -> Slash completes
  app.step(0.25);
  app.step(0.25);
  assert.equal(finishedSlash, 'Slash');

  socket.detach();
  assert.equal(weapon.parent, null);
  app.dispose();
});

test('createAudioManager enforces cooldownMs, maxPolyphony preserving loops, and pitchJitter', async () => {
  const startedSources = [];
  const stoppedSources = [];
  let nowMs = 1000;

  class MockAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = {};
    }
    async resume() {}
    createGain() {
      return { gain: { value: 1, setTargetAtTime() {} }, connect() {} };
    }
    createBufferSource() {
      const listeners = [];
      const src = {
        buffer: null,
        loop: false,
        playbackRate: { value: 1 },
        connect() {},
        addEventListener(_ev, fn) { listeners.push(fn); },
        start() { startedSources.push(src); },
        stop() {
          stoppedSources.push(src);
          for (const fn of listeners) fn();
        },
      };
      return src;
    }
    async close() {}
  }

  const audio = createAudioManager({
    AudioContextClass: MockAudioContext,
    maxPolyphony: 3,
    now: () => nowMs,
  });

  const hitSfx = { id: 'hit' };
  const bgm = { id: 'bgm' };

  const h1 = await audio.play(hitSfx, { cooldownMs: 50, pitchJitter: 0.1, random: () => 1 });
  const h2 = await audio.play(hitSfx, { cooldownMs: 50 });
  assert.ok(h1);
  assert.equal(h2, null, 'burst within cooldownMs must be suppressed');
  assert.ok(Math.abs(h1.playbackRate - 1.1) < 1e-6);

  nowMs += 60;
  const hLoop = await audio.play(bgm, { loop: true });
  const h3 = await audio.play(hitSfx, { cooldownMs: 50, pitchJitter: 0.1, random: () => 0 });
  assert.ok(hLoop);
  assert.ok(h3);
  assert.ok(Math.abs(h3.playbackRate - 0.9) < 1e-6);
  assert.equal(audio.activeCount, 3);

  // 4th sound should evict oldest non-looping sound (h1), keeping looping BGM alive
  nowMs += 60;
  const h4 = await audio.play(hitSfx, { cooldownMs: 50 });
  assert.ok(h4);
  assert.equal(audio.activeCount, 3);
  assert.equal(stoppedSources.length, 1);
  assert.equal(stoppedSources[0].loop, false);

  await audio.dispose();
  assert.equal(audio.activeCount, 0);
});
