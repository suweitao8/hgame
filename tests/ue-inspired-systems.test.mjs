import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HGame,
  Component,
  Entity,
  Scene,
  defineProject,
  createGameApplication,
  createInputManager,
  defineInputContext,
  createInputActionRouter,
  createAudioManager,
  normalizeGameplayTag,
  isValidGameplayTag,
  createTagRegistry,
  createTagContainer,
  matchGameplayTags,
  damp,
  dampAngle,
  stepSpring1D,
  SpringDamper1D,
  SpringDamper2D,
  SpringDamper3D,
} from '../assets/runtime/index.js';
import { createSpringArm3D, createCameraRig3D } from '../assets/runtime/integrations/camera3d.js';
import {
  createModel3DProvider,
  createAnimationBudgetAllocator,
} from '../assets/runtime/integrations/model3d.js';

function createMockPlatform() {
  const input = createInputManager();
  return {
    name: 'mock',
    input,
    assets: null,
    audio: null,
    save: null,
    diagnostics: { reportError() {} },
    ready() {},
    watchResize() { return () => {}; },
    watchFocus() { return () => {}; },
    watchVisibility() { return () => {}; },
    dispose() { input.dispose(); },
  };
}

function createNoopRenderer() {
  return {
    add() {},
    remove() {},
    render() {},
    dispose() {},
  };
}

test('GameplayTags: syntax validation, registry taxonomy, reference-counted ancestors, and Entity/Scene integration', () => {
  assert.equal(normalizeGameplayTag('State.Movement.Dashing'), 'State.Movement.Dashing');
  assert.equal(isValidGameplayTag('Faction.Player_01-Alpha'), true);
  for (const invalid of ['', '.Leading', 'Trailing.', 'Double..Dot', 'Has Space', 'Bad$Char']) {
    assert.equal(isValidGameplayTag(invalid), false);
    assert.throws(() => normalizeGameplayTag(invalid));
  }

  const registry = createTagRegistry();
  registry.register('State.Movement.Dashing', { priority: 2 });
  assert.equal(registry.has('State'), true);
  assert.equal(registry.has('State.Movement'), true);
  assert.equal(registry.getParent('State.Movement.Dashing'), 'State.Movement');
  assert.deepEqual(registry.getAncestors('State.Movement.Dashing'), [
    'State',
    'State.Movement',
    'State.Movement.Dashing',
  ]);
  assert.deepEqual(registry.getDescendants('State.Movement').sort(), [
    'State.Movement',
    'State.Movement.Dashing',
  ]);

  const container = createTagContainer(null, { registry });
  container.add('State.Movement.Dashing');
  container.add('State.Movement.Swimming');
  assert.equal(container.has('State'), true);
  assert.equal(container.has('State.Movement'), true);
  assert.equal(container.hasExact('State.Movement'), false);
  assert.equal(container.hasExact('State.Movement.Dashing'), true);

  // Removing one leaf preserves shared ancestor while both weren't removed
  assert.equal(container.remove('State.Movement.Dashing'), true);
  assert.equal(container.has('State.Movement.Dashing'), false);
  assert.equal(container.has('State.Movement'), true);

  // Reference-counted buff stacks
  container.add('Buff.Rage', 2);
  assert.equal(container.stackCount('Buff.Rage'), 2);
  container.remove('Buff.Rage', 1);
  assert.equal(container.stackCount('Buff.Rage'), 1);
  container.remove('Buff.Rage', 1);
  assert.equal(container.has('Buff.Rage'), false);

  // Composite query matching + empty query zero-alloc behavior
  container.add(['Faction.Enemy', 'Status.Burning.Heavy']);
  assert.equal(container.matches({ all: ['Faction', 'Status.Burning'], none: ['State.Dead'] }), true);
  assert.equal(container.matches({ any: ['State.Stunned', 'Status.Burning'], none: ['Faction.Ally'] }), true);
  assert.equal(container.matches({ all: ['Status.Burning'], none: ['Faction.Enemy'] }), false);
  assert.equal(container.matches({ all: ['Status.Burning'], exact: true }), false);
  assert.equal(matchGameplayTags(null, {}), true);
  assert.equal(matchGameplayTags(null, 'Status.Burning'), false);

  // Entity lazy container + Scene queries + destroy cleanup
  const scene = new Scene('tags-test');
  const bare = scene.add(new Entity({ name: 'Bare' }));
  assert.equal(bare._tags, null);
  assert.equal(bare.hasTag('Faction.Enemy'), false);
  assert.equal(bare._tags, null); // reading never allocates!

  const hero = scene.add(new Entity({ name: 'Hero', tags: ['Faction.Player', 'State.Alive'] }));
  const goblin = scene.add(new Entity({ name: 'Goblin' }).addTag('Faction.Enemy').addTag('Status.Burning.Light'));
  const sleepingGoblin = scene.add(new Entity({ name: 'SleepingGoblin', active: false, tags: ['Faction.Enemy'] }));
  scene._setActive(true);

  assert.equal(hero.hasTag('Faction'), true);
  assert.equal(scene.findByTag('Faction.Enemy').length, 2);
  assert.equal(scene.findByTag('Faction.Enemy', { activeOnly: true }).length, 1);
  assert.deepEqual(
    scene.queryTags({ all: ['Faction.Enemy'], any: ['Status.Burning'] }).map(e => e.name),
    ['Goblin'],
  );

  goblin.destroy();
  sleepingGoblin.destroy();
  assert.equal(goblin._tags, null);
  assert.equal(typeof HGame.createTagContainer, 'function');
});

test('Analytical Springs & Global Time Dilation / Hit-Stop preserve fixed physics step and frame-rate invariance', () => {
  // damp exact half-life and shortest-arc angular wrap
  assert.ok(Math.abs(damp(0, 100, 0.5, 0.5) - 50) < 1e-12);
  const wrapped = dampAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.1, 0.1);
  assert.ok(wrapped > Math.PI - 0.1 && wrapped < Math.PI + 0.15);

  // Frame-rate independence: 10 substeps of 0.01s must match 1 step of 0.1s identically
  const singleState = { value: 0, velocity: 1.5 };
  stepSpring1D(singleState, 10, 0.12, 0.1);

  const subState = { value: 0, velocity: 1.5 };
  for (let i = 0; i < 10; i++) {
    stepSpring1D(subState, 10, 0.12, 0.01);
  }
  assert.ok(Math.abs(singleState.value - subState.value) < 1e-9);
  assert.ok(Math.abs(singleState.velocity - subState.velocity) < 1e-9);

  // Stateful 1D/2D/3D springs converge monotonically without oscillation overshoot from zero velocity
  const s1 = new SpringDamper1D({ value: 0, halfLife: 0.08 });
  let prev = s1.value;
  for (let i = 0; i < 40; i++) {
    const val = s1.step(0.02, 10);
    assert.ok(val >= prev - 1e-12 && val <= 10 + 1e-12);
    prev = val;
  }
  assert.ok(s1.isSettled(0.05, 0.1));

  const s2 = new SpringDamper2D({ halfLife: 0.06 });
  s2.step(0.5, 4, -8);
  assert.ok(Math.hypot(s2.x - 4, s2.y - -8) < 0.05);

  const s3 = new SpringDamper3D({ halfLife: 0.05 });
  for (let i = 0; i < 20; i++) s3.step(0.03, 1, 2, -3);
  assert.ok(s3.isSettled(1e-3, 1e-2));

  // Global timeScale + hitStop with sub-frame split and constant physics stepSize
  const platform = createMockPlatform();
  const physicsSteps = [];
  const updateDts = [];

  class ProbeScene extends Scene {
    update(dt) {
      updateDts.push(dt);
    }
  }

  const project = defineProject({ profile: '3d', tickHz: 50, features: ['scene', 'input'] });
  const app = createGameApplication({ project, platform, renderer: createNoopRenderer() });
  const scene = app.scenes.add(new ProbeScene('time-test'));
  scene.physics = { step(dt) { physicsSteps.push(dt); } };
  app.scenes.start('time-test');

  // At 2x timeScale, a 0.02s frame accumulates 0.04s -> two 0.02s fixed physics ticks!
  app.setTimeScale(2);
  app.step(0.02);
  assert.equal(physicsSteps.length, 2);
  assert.ok(physicsSteps.every(dt => Math.abs(dt - 0.02) < 1e-12));
  assert.ok(Math.abs(app.unscaledDeltaSeconds - 0.02) < 1e-12);
  assert.ok(Math.abs(app.deltaSeconds - 0.04) < 1e-12);

  // Trigger 0.03s hit-stop at timeScale=1
  app.setTimeScale(1);
  app.hitStop(0.03);
  assert.equal(app.timeScale, 0);

  // Step 0.02s -> completely frozen inside hitStop (0 physics ticks, update dt=0)
  const ticksBeforeFreeze = physicsSteps.length;
  app.step(0.02);
  assert.equal(physicsSteps.length, ticksBeforeFreeze);
  assert.equal(updateDts.at(-1), 0);
  assert.ok(Math.abs(app.hitStopRemaining - 0.01) < 1e-12);

  // Step 0.05s -> 0.01s frozen + 0.04s unfrozen remainder executes cleanly!
  app.step(0.05);
  assert.equal(app.hitStopRemaining, 0);
  assert.equal(app.timeScale, 1);
  assert.ok(Math.abs(app.unscaledDeltaSeconds - 0.05) < 1e-12);
  assert.ok(Math.abs(app.deltaSeconds - 0.04) < 1e-12);
  assert.equal(physicsSteps.length, ticksBeforeFreeze + 2);

  app.dispose();
});

test('Priority Input Mapping Contexts, key consumption, chords, and input buffering', () => {
  const downCodes = new Set();
  const router = createInputActionRouter({ readCode: code => downCodes.has(code) });

  const gameplay = defineInputContext('Gameplay', {
    priority: 0,
    actions: {
      Jump: { keys: ['Space'], bufferWindow: 0.15 },
      Interact: { keys: ['KeyE'] },
      MoveAttack: { keys: ['KeyJ'], bufferWindow: 0.1 },
    },
    axes2D: {
      Move: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], normalize: true },
    },
  });

  const abilityMod = defineInputContext('AbilityChord', {
    priority: 5,
    actions: {
      HeavyInteract: { keys: ['KeyE'], chord: ['ShiftLeft'] },
    },
  });

  const menu = defineInputContext('PauseMenu', {
    priority: 100,
    consumesKeys: true,
    actions: {
      Confirm: { keys: ['Space'] },
    },
  });

  router.pushContext(gameplay);
  router.pushContext(abilityMod);

  // Without ShiftLeft held, KeyE passes through AbilityChord to Gameplay Interact
  downCodes.add('KeyE');
  downCodes.add('KeyW');
  downCodes.add('KeyD');
  router.update(0.016);
  assert.equal(router.wasPressed('Interact'), true);
  assert.equal(router.wasPressed('HeavyInteract'), false);
  const move = router.getAxis2D('Move');
  assert.ok(Math.abs(move.x - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(move.y - Math.SQRT1_2) < 1e-6);

  // Release KeyE, then hold ShiftLeft + KeyE -> AbilityChord consumes KeyE cleanly!
  downCodes.clear();
  router.update(0.016);
  downCodes.add('ShiftLeft');
  downCodes.add('KeyE');
  router.update(0.016);
  assert.equal(router.wasPressed('HeavyInteract'), true);
  assert.equal(router.isDown('Interact'), false);

  // Push modal menu -> Space triggers Confirm and consumes Space so Gameplay Jump never fires
  downCodes.clear();
  router.update(0.016);
  router.pushContext(menu);
  downCodes.add('Space');
  router.update(0.016);
  assert.equal(router.wasPressed('Confirm'), true);
  assert.equal(router.wasPressed('Jump'), false);
  assert.equal(router.isBuffered('Jump'), false);

  // Disable PauseMenu -> Space reaches Gameplay Jump & fills 0.15s input buffer across release!
  downCodes.clear();
  router.update(0.016);
  router.setContextEnabled('PauseMenu', false);
  downCodes.add('Space');
  router.update(0.016);
  assert.equal(router.wasPressed('Jump'), true);
  assert.equal(router.isBuffered('Jump'), true);
  downCodes.delete('Space');
  router.update(0.05);
  assert.equal(router.isDown('Jump'), false);
  assert.equal(router.isBuffered('Jump'), true);
  assert.equal(router.consumeBuffered('Jump'), true);
  assert.equal(router.consumeBuffered('Jump'), false); // consumed once

  // Hold duration test
  downCodes.add('KeyJ');
  router.update(0.05);
  router.update(0.12);
  assert.equal(router.isHeld('MoveAttack', 0.1), true);
});

test('3D SpringArm3D collision probe asymmetric recovery and CameraRig3D trauma/recoil/FOV', () => {
  let obstacleDist = null;
  const arm = createSpringArm3D({
    armLength: 5,
    minArmLength: 0.5,
    probeRadius: 0.25,
    targetOffset: { x: 0, y: 1.5, z: 0 },
    socketOffset: { x: 0.5, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    lagHalfLife: 0,
    inHalfLife: 0,
    outHalfLife: 0.2,
    collisionTest: () => (obstacleDist !== null ? { distance: obstacleDist } : null),
  });

  const open = arm.update(0.016, { x: 0, y: 0, z: 0 });
  assert.equal(open.collided, false);
  assert.equal(open.currentLength, 5);
  assert.ok(Math.abs(open.position.x - 0.5) < 1e-6);
  assert.ok(Math.abs(open.position.z - 5) < 1e-6);

  // Wall strikes at 2.0m -> fast snap-in to 2.0 - 0.25 = 1.75m without clipping
  obstacleDist = 2.0;
  const hitFrame = arm.update(0.016, { x: 0, y: 0, z: 0 });
  assert.equal(hitFrame.collided, true);
  assert.ok(Math.abs(hitFrame.currentLength - 1.75) < 1e-6);

  // Wall clears -> slow smooth recovery toward 5m rather than snapping immediately back
  obstacleDist = null;
  const recoverFrame = arm.update(0.05, { x: 0, y: 0, z: 0 });
  assert.equal(recoverFrame.collided, false);
  assert.ok(recoverFrame.currentLength > 1.75 && recoverFrame.currentLength < 5);

  // CameraRig3D modes, quadratic trauma shake, recoil recovery, and priority FOV blending
  let projectionUpdates = 0;
  const camera = {
    position: { x: 0, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    fov: 70,
    updateProjectionMatrix() { projectionUpdates++; },
  };
  const rig = createCameraRig3D({
    camera,
    mode: 'thirdPerson',
    baseFov: 70,
    traumaDecay: 2.0,
    recoilHalfLife: 0.05,
  });

  rig.setFovModifier('sprint', { deltaFov: 12, priority: 1, blendIn: 0.05 });
  rig.setFovModifier('ads', { fov: 45, priority: 10, blendIn: 0.05, blendOut: 0.08 });
  rig.addTrauma(0.5); // intensity = 0.25 (quadratic)
  rig.addRecoil({ pitch: 0.08, pushback: -0.2 });

  const f1 = rig.update(0.05, { x: 0, y: 0, z: 0 });
  assert.ok(Math.abs(f1.shakeIntensity - 0.25) < 1e-6);
  assert.ok(f1.fov < 70 && f1.fov >= 45);
  assert.ok(projectionUpdates > 0);

  // Clear ADS -> falls back to lower-priority Sprint (+12 => 82)
  rig.clearFovModifier('ads');
  for (let i = 0; i < 20; i++) rig.update(0.05, { x: 0, y: 0, z: 0 });
  assert.ok(rig.fov > 78);
  assert.equal(rig.trauma, 0);

  rig.setMode('firstPerson');
  const fpsState = rig.update(0.016, { x: 2, y: 0, z: 3 });
  assert.equal(fpsState.mode, 'firstPerson');
  assert.ok(Math.abs(camera.position.x - 2) < 0.1);
});

test('Model3D zero-miss AnimNotify timeline events and AnimationBudgetAllocator frame cap', () => {
  class MockClip {
    constructor(name, duration) {
      this.name = name;
      this.duration = duration;
    }
  }
  class MockAction {
    constructor(clip) {
      this._clip = clip;
      this.time = 0;
      this.timeScale = 1;
      this.clampWhenFinished = false;
    }
    getClip() { return this._clip; }
    setLoop() {}
    reset() { this.time = 0; }
    play() {}
    stop() {}
    fadeOut() {}
    crossFadeTo() {}
    setEffectiveWeight() {}
  }
  class MockMixer {
    constructor(root) {
      this.root = root;
      this.timeScale = 1;
      this.updates = 0;
      this.actions = new Map();
    }
    clipAction(clip) {
      let act = this.actions.get(clip);
      if (!act) {
        act = new MockAction(clip);
        this.actions.set(clip, act);
      }
      return act;
    }
    update(dt) {
      this.updates++;
      for (const act of this.actions.values()) {
        act.time += dt * act.timeScale * this.timeScale;
      }
    }
    addEventListener() {}
    removeEventListener() {}
    stopAllAction() {}
    uncacheRoot() {}
  }
  class MockVector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; }
  }
  class MockBox3 {
    setFromObject() { return this; }
    getSize(out) { out.set(1, 2, 1); return out; }
    get isEmpty() { return false; }
  }
  class MockObject3D {
    constructor() {
      this.position = new MockVector3();
      this.rotation = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
      this.scale = new MockVector3(1, 1, 1);
      this.visible = true;
      this.children = [];
    }
    add(c) { this.children.push(c); }
    traverse(fn) { fn(this); }
    clone() { return new MockObject3D(); }
    updateMatrixWorld() {}
  }
  const MockTHREE = {
    AnimationClip: Object.assign(MockClip, {
      findByName: (clips, name) => clips.find(c => c.name === name) ?? null,
    }),
    AnimationMixer: MockMixer,
    Group: MockObject3D,
    Vector3: MockVector3,
    Box3: MockBox3,
    LoopRepeat: 2201,
    LoopOnce: 2200,
  };

  const provider = createModel3DProvider({ THREE: MockTHREE });
  const runClip = new MockClip('Run', 1.0);
  const root = new MockObject3D();
  const asset = { scene: root, animations: [runClip] };

  const fired = [];
  const comp = provider.createComponent({
    asset,
    clip: 'Run',
    loop: true,
    enableLod: false,
  });
  comp.awake();
  comp.addNotify('Run', { name: 'Start', time: 0, callback: e => fired.push(`${e.name}@${e.loopCount}`) });
  comp.addNotify('Run', { name: 'StepR', normalizedTime: 0.5, callback: e => fired.push(`${e.name}@${e.loopCount}`) });

  // Multi-lap delta (2.6s on 1.0s loop) must hit Start on laps 0, 1, 2 and StepR on laps 0, 1, 2 cleanly!
  comp.update(2.6);
  assert.deepEqual(fired, [
    'Start@0', 'StepR@0',
    'Start@1', 'StepR@1',
    'Start@2', 'StepR@2',
  ]);

  // Budget Allocator caps updates per frame and starves nothing
  const allocator = createAnimationBudgetAllocator({
    maxFullRateCount: 1,
    maxHalfRateCount: 1,
    maxQuarterRateCount: 2,
    maxUpdateBudgetPerFrame: 2,
    offscreenTickInterval: 0.2,
  });

  const ticks = [0, 0, 0, 0];
  const objs = [0, 1, 2, 3].map(idx => ({
    object3d: { position: { x: idx * 20, y: 0, z: 0 }, visible: idx !== 3 },
    update() { ticks[idx]++; },
  }));
  objs.forEach((o, i) => allocator.register(o, { priority: i === 0 ? 5 : 0 }));

  for (let f = 0; f < 16; f++) {
    const stats = allocator.update(0.05, { x: 0, y: 0, z: 0 });
    assert.ok(stats.updated <= 2);
  }
  assert.equal(ticks[0], 16); // full rate every frame
  assert.ok(ticks[1] > 0 && ticks[2] > 0 && ticks[3] > 0); // throttled & offscreen still advance
});

test('Audio low-pass acoustic occlusion, probe updates, mix snapshots, and mock fallback', async () => {
  class MockParam {
    constructor(val) { this.value = val; }
    setValueAtTime(v) { this.value = v; }
    linearRampToValueAtTime(v) { this.value = v; }
    setTargetAtTime(v) { this.value = v; }
  }
  class MockAudioContext {
    constructor({ withFilters = true } = {}) {
      this.currentTime = 0;
      this.state = 'running';
      this.destination = { kind: 'dest' };
      this.listener = {};
      this.createdFilters = [];
      if (!withFilters) {
        this.createBiquadFilter = undefined;
      }
    }
    createGain() {
      return { gain: new MockParam(1), connect() {} };
    }
    createBiquadFilter() {
      const f = { type: 'lowpass', frequency: new MockParam(22000), Q: new MockParam(0.707), connect() {} };
      this.createdFilters.push(f);
      return f;
    }
    createStereoPanner() {
      return { pan: new MockParam(0), connect() {} };
    }
    createBufferSource() {
      return {
        buffer: null,
        loop: false,
        playbackRate: new MockParam(1),
        connect() {},
        start() {},
        stop() {},
        addEventListener() {},
      };
    }
  }

  let wallBlocked = true;
  const contexts = [];
  const audio = createAudioManager({
    AudioContextClass: function () {
      const ctx = new MockAudioContext({ withFilters: true });
      contexts.push(ctx);
      return ctx;
    },
    compressor: false,
  });

  audio.setOcclusionProbe((srcPos, listenerPos) => (wallBlocked && srcPos.x > listenerPos.x ? 1 : 0));
  audio.setBusVolume('music', 0.8);

  const handle = await audio.play({ duration: 1 }, { position: [10, 0, 0], volume: 1 });
  assert.equal(handle.occlusion, 1);
  assert.ok(handle.lowPassHz <= 555);

  // Opening door updates occlusion smoothly on refresh
  wallBlocked = false;
  audio.updateOcclusion();
  assert.equal(handle.occlusion, 0);
  assert.ok(handle.lowPassHz >= 21999);

  // Manual override
  handle.setOcclusion(0.5);
  assert.equal(handle.occlusion, 0.5);
  assert.ok(handle.lowPassHz > 550 && handle.lowPassHz < 22000);

  // Mix snapshot lowers music & adds lowpass filter, then clear restores original user 0.8 music volume!
  audio.registerSnapshot('pause', {
    buses: {
      music: { gainScale: 0.25, lowPassHz: 600 },
    },
    transitionSeconds: 0,
  });
  audio.applySnapshot('pause');
  assert.equal(audio.activeSnapshot, 'pause');
  assert.equal(audio.getBusVolume('music'), 0.8); // user preference stays intact

  audio.clearSnapshot({ transitionSeconds: 0 });
  assert.equal(audio.activeSnapshot, null);
  assert.equal(audio.getBusVolume('music'), 0.8);

  // Verify mock AudioContext without createBiquadFilter still works seamlessly
  const fallbackAudio = createAudioManager({
    AudioContextClass: function () { return new MockAudioContext({ withFilters: false }); },
    compressor: false,
  });
  const fbHandle = await fallbackAudio.play({ duration: 0.5 }, { position2D: [100, 0], occlusion: 1 });
  assert.equal(fbHandle.occlusion, 1);
});
