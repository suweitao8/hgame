import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSimWorkerRunner,
  createSwarmSimulation,
  createWorldPartition,
  createAudioManager,
  createInputManager,
  createPanelStack,
  applyAriaToElement,
  computeFlexLayout,
  createNetworkStateSync,
} from '../assets/runtime/index.js';

function createFakeAudioContextClass() {
  class FakeParam {
    constructor(val = 0) { this.value = val; }
    setValueAtTime(v) { this.value = v; }
    setTargetAtTime(v) { this.value = v; }
  }
  class FakeNode {
    constructor(ctx) { this.ctx = ctx; this.connected = []; }
    connect(dest) { this.connected.push(dest); return dest; }
    disconnect() { this.connected = []; }
  }
  class FakeGain extends FakeNode {
    constructor(ctx) { super(ctx); this.gain = new FakeParam(1); }
  }
  class FakeFilter extends FakeNode {
    constructor(ctx) { super(ctx); this.type = 'lowpass'; this.frequency = new FakeParam(22000); }
  }
  class FakeConvolver extends FakeNode {
    constructor(ctx) { super(ctx); this.buffer = null; }
  }
  class FakePanner extends FakeNode {
    constructor(ctx) {
      super(ctx);
      this.positionX = new FakeParam(0);
      this.positionY = new FakeParam(0);
      this.positionZ = new FakeParam(0);
    }
  }
  class FakeStereoPanner extends FakeNode {
    constructor(ctx) { super(ctx); this.pan = new FakeParam(0); }
  }
  class FakeCompressor extends FakeNode {}
  class FakeSource extends FakeNode {
    constructor(ctx) {
      super(ctx);
      this.playbackRate = new FakeParam(1);
      this.loop = false;
      this.buffer = null;
      ctx.playedRates.push(this);
    }
    start() {}
    stop() { this.onended?.(); }
  }
  class FakeAudioBuffer {
    constructor(ch = 2, length = 1024, sr = 48000) {
      this.numberOfChannels = ch;
      this.length = length;
      this.sampleRate = sr;
      this.duration = length / sr;
      this.channels = Array.from({ length: ch }, () => new Float32Array(length));
    }
    getChannelData(c) { return this.channels[c]; }
  }
  return class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.sampleRate = 48000;
      this.currentTime = 0;
      this.destination = new FakeNode(this);
      this.listener = { positionX: new FakeParam(0), positionY: new FakeParam(0), positionZ: new FakeParam(0) };
      this.playedRates = [];
      this.convolvers = [];
    }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createGain() { return new FakeGain(this); }
    createBiquadFilter() { return new FakeFilter(this); }
    createConvolver() { const c = new FakeConvolver(this); this.convolvers.push(c); return c; }
    createPanner() { return new FakePanner(this); }
    createStereoPanner() { return new FakeStereoPanner(this); }
    createDynamicsCompressor() { return new FakeCompressor(this); }
    createBufferSource() { return new FakeSource(this); }
    createBuffer(ch, len, sr) { return new FakeAudioBuffer(ch, len, sr); }
  };
}

test('P1: SwarmSimulation and WorldPartition offload deterministic tasks to createSimWorkerRunner', async () => {
  const committedTicks = [];
  const runner = createSimWorkerRunner({
    onCommit: rec => committedTicks.push({ type: rec.type, submitTick: rec.submitTick, status: rec.status }),
  });

  const swarm = createSwarmSimulation({ capacity: 64, workerRunner: runner });
  swarm.spawnWave({ count: 12, x: 10, y: 10, radius: 5 });
  const swarmRes = await swarm.stepAsync(0.016, { heroX: 0, heroY: 0 });
  assert.equal(swarmRes.activeCount, 12);
  assert.equal(swarmRes.workerMode, 'main-thread');
  assert.ok(swarmRes.committedJobs >= 1);

  const loaded = [];
  const partition = createWorldPartition({
    cellSize: 64,
    loadRadius: 80,
    loadCell: desc => loaded.push(desc.key),
    workerRunner: runner,
  });
  const partRes = await partition.stepAsync([0, 0, 0], [0, 0, 0], 0.016);
  assert.ok(loaded.length >= 1);
  assert.equal(partRes.committedJobs, 1);
  assert.equal(committedTicks.length, 3);

  partition.clear();
  runner.dispose();
});

test('S3: AudioManager supports spatial reverb zones, Doppler shift, and streaming track controls', async () => {
  const FakeAudioContext = createFakeAudioContextClass();
  const audio = createAudioManager({ AudioContextClass: FakeAudioContext });
  await audio.unlock();

  // Reverb zone crossfade + cleanup
  const zone = audio.createReverbZone({
    id: 'cavern',
    position: { x: 10, y: 0, z: 0 },
    radius: 20,
    decaySeconds: 2.0,
    wetGain: 0.4,
  });
  audio.setListener({ x: 10, y: 0, z: 0 });
  assert.ok(Math.abs(zone.currentWet - 0.4) < 1e-6);
  audio.setListener({ x: 20, y: 0, z: 0 }); // halfway to edge => (0.5)^1.5 * 0.4 ~ 0.1414
  assert.ok(zone.currentWet > 0.1 && zone.currentWet < 0.25);
  audio.setListener({ x: 40, y: 0, z: 0 }); // outside radius
  assert.equal(zone.currentWet, 0);
  assert.equal(audio.removeReverbZone('cavern'), true);

  // Doppler shift: moving away lowers pitch, moving toward raises pitch
  audio.setListener({ x: 0, y: 0, z: 0 });
  audio.setListenerVelocity({ vx: 0, vy: 0, vz: 0 });
  const dummyBuffer = { duration: 0.5, sampleRate: 48000, numberOfChannels: 1, length: 24000, getChannelData: () => new Float32Array(24000) };
  const approaching = await audio.play(dummyBuffer, {
    position: { x: 20, y: 0, z: 0 },
    velocity: { vx: -40, vy: 0, vz: 0 },
  });
  assert.ok(approaching.playbackRate > 1.05);

  const receding = await audio.play(dummyBuffer, {
    position: { x: 20, y: 0, z: 0 },
    velocity: { vx: 40, vy: 0, vz: 0 },
  });
  assert.ok(receding.playbackRate < 0.95);

  // Streaming music controller
  const stream = audio.playStream('assets/bgm.ogg', { bus: 'music', volume: 0.6, autoplay: true });
  assert.equal(stream.playing, true);
  assert.equal(stream.setVolume(0.3), 0.3);
  stream.pause();
  assert.equal(stream.playing, false);
  stream.stop();

  await audio.dispose();
});

test('S4: computeFlexLayout, InputManager rebinding persistence & rumble, and PanelStack ARIA', async () => {
  const layout = computeFlexLayout({
    id: 'root',
    direction: 'row',
    gap: 10,
    padding: 10,
    children: [
      { id: 'sidebar', width: 200 },
      {
        id: 'main',
        flexGrow: 1,
        direction: 'column',
        gap: 8,
        children: [
          { id: 'hud', height: 60 },
          { id: 'viewport', flexGrow: 1 },
        ],
      },
    ],
  }, 1000, 600);

  assert.equal(layout.children[0].width, 200);
  assert.equal(layout.children[0].height, 580);
  assert.equal(layout.children[1].x, 220);
  assert.equal(layout.children[1].width, 770); // 1000 - 20 pad - 10 gap - 200 sidebar
  assert.equal(layout.children[1].children[0].height, 60);
  assert.equal(layout.children[1].children[1].y, 78);
  assert.equal(layout.children[1].children[1].height, 512);

  // Input rebinding + persistence + gamepad rumble
  const pressedKeys = new Set(['KeyJ']);
  const listeners = new Map();
  const fakeWindow = {
    addEventListener: (t, fn) => listeners.set(t, fn),
    removeEventListener: (t) => listeners.delete(t),
  };
  const input = createInputManager({
    target: fakeWindow,
    defaultBindings: { attack: ['Space'] },
  });
  input.setBinding('attack', ['KeyJ']);
  listeners.get('keydown')?.({ code: 'KeyJ', repeat: false });
  assert.equal(input.isActionDown('attack'), true);
  assert.equal(input.wasActionPressed('attack'), true);
  const exported = JSON.stringify(input.exportBindings());
  input.resetBindings();
  assert.deepEqual(input.getBinding('attack'), ['Space']);
  input.importBindings(exported);
  assert.deepEqual(input.getBinding('attack'), ['KeyJ']);

  let rumbleCalls = 0;
  const rumbled = await input.triggerGamepadRumble(0, {
    durationMs: 120,
    weakMagnitude: 0.4,
    strongMagnitude: 0.8,
    navigatorObj: {
      getGamepads: () => [{
        vibrationActuator: {
          playEffect: async (type, params) => {
            assert.equal(type, 'dual-rumble');
            assert.equal(params.duration, 120);
            rumbleCalls++;
          },
        },
      }],
    },
  });
  assert.equal(rumbled, true);
  assert.equal(rumbleCalls, 1);
  input.dispose();
  assert.equal(pressedKeys.size, 1);

  // ARIA attributes
  const attrs = new Map();
  const fakeEl = {
    setAttribute(k, v) { attrs.set(k, v); },
    hasAttribute(k) { return attrs.has(k); },
  };
  assert.equal(applyAriaToElement(fakeEl, { role: 'dialog', modal: true, label: 'Pause Menu', live: 'polite' }), true);
  assert.equal(attrs.get('role'), 'dialog');
  assert.equal(attrs.get('aria-modal'), 'true');
  assert.equal(attrs.get('aria-label'), 'Pause Menu');
  assert.equal(attrs.get('aria-live'), 'polite');
  assert.equal(attrs.get('tabindex'), '-1');

  const stack = createPanelStack({ panels: { pause: { modal: true, ariaLabel: 'Pause Dialog' } } });
  stack.push('pause');
  assert.equal(stack.top().id, 'pause');
  stack.dispose();
});

test('N1: createNetworkStateSync supports delta compression, prediction/reconciliation, interpolation, and lag rewind', () => {
  const net = createNetworkStateSync({
    quantizePos: 100,
    quantizeRot: 1000,
    interpolationDelayMs: 50,
  });

  // 1. Delta encoding omits unchanged fields & compresses changes cleanly
  const prev = {
    hero: { x: 10.1234, y: 2.0, rot: 1.5, hp: 100 },
    crate: { x: 5.0, y: 0.0, hp: 50 },
  };
  const next = {
    hero: { x: 11.4567, y: 2.0, rot: 1.5, hp: 100 },
    crate: { x: 5.0, y: 0.0, hp: 50 },
  };
  const delta = net.encodeDelta(prev, next);
  assert.equal(delta.changedCount, 1);
  assert.deepEqual(delta.changed.hero.keys, ['x']);
  assert.equal(delta.changed.hero.values[0], 11.46); // quantized to 0.01
  const reconstructed = net.decodeDelta(prev, delta);
  assert.equal(reconstructed.hero.x, 11.46);
  assert.equal(reconstructed.crate.hp, 50);

  // 2. Client prediction & server authoritative reconciliation
  net.pushLocalInput(1, { dx: 2 });
  net.pushLocalInput(2, { dx: 2 });
  net.pushLocalInput(3, { dx: 1 });
  const recon = net.reconcileServerState(1, { p1: { x: 12 } }, (state, inp) => ({
    ...state,
    p1: { x: state.p1.x + inp.dx },
  }));
  assert.equal(recon.replayedInputs, 2); // ticks 2 & 3 replayed atop tick 1 server x=12 => 12 + 2 + 1 = 15
  assert.equal(recon.state.p1.x, 15);

  // 3. Snapshot interpolation & lag-compensation rewind
  net.pushServerSnapshot(100, { p2: { x: 0, y: 0 } });
  net.pushServerSnapshot(200, { p2: { x: 10, y: 20 } });
  const interp = net.sampleInterpolated(200); // target = 200 - 50 delay = 150ms => alpha = 0.5
  assert.equal(interp.p2.x, 5);
  assert.equal(interp.p2.y, 10);
  const rewind = net.getHistoricalState(125); // 25% between 100 and 200
  assert.equal(rewind.p2.x, 2.5);

  net.clear();
});
