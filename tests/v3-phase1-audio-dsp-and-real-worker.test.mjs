import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAudioManager,
  createSimWorkerRunner,
  createSwarmSimulation,
} from '../assets/runtime/index.js';

function createInspectableAudioContextClass() {
  class FakeParam {
    constructor(val = 0) { this.value = val; }
    setValueAtTime(v) { this.value = v; }
    linearRampToValueAtTime(v) { this.value = v; }
    setTargetAtTime(v) { this.value = v; }
  }
  class FakeNode {
    constructor(ctx, kind) {
      this.ctx = ctx;
      this.kind = kind;
      this.outputs = new Set();
      this.inputs = new Set();
    }
    connect(dest) {
      this.outputs.add(dest);
      dest?.inputs?.add?.(this);
      return dest;
    }
    disconnect(dest) {
      if (dest) {
        this.outputs.delete(dest);
        dest?.inputs?.delete?.(this);
      } else {
        for (const d of this.outputs) d?.inputs?.delete?.(this);
        this.outputs.clear();
      }
    }
  }
  class FakeGain extends FakeNode {
    constructor(ctx) { super(ctx, 'gain'); this.gain = new FakeParam(1); }
  }
  class FakeFilter extends FakeNode {
    constructor(ctx) {
      super(ctx, 'filter');
      this.type = 'lowpass';
      this.frequency = new FakeParam(22000);
      this.Q = new FakeParam(0.707);
      this.gain = new FakeParam(0);
    }
  }
  class FakeConvolver extends FakeNode {
    constructor(ctx) { super(ctx, 'convolver'); this.buffer = null; }
  }
  class FakePanner extends FakeNode {
    constructor(ctx) {
      super(ctx, 'panner');
      this.positionX = new FakeParam(0);
      this.positionY = new FakeParam(0);
      this.positionZ = new FakeParam(0);
    }
  }
  class FakeStereoPanner extends FakeNode {
    constructor(ctx) { super(ctx, 'stereo'); this.pan = new FakeParam(0); }
  }
  class FakeCompressor extends FakeNode {
    constructor(ctx) { super(ctx, 'compressor'); }
  }
  class FakeSource extends FakeNode {
    constructor(ctx) {
      super(ctx, 'source');
      this.playbackRate = new FakeParam(1);
      this.loop = false;
      this.buffer = null;
      ctx.sources.push(this);
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
  return class InspectableAudioContext {
    constructor() {
      this.state = 'running';
      this.sampleRate = 48000;
      this.currentTime = 0;
      this.destination = new FakeNode(this, 'destination');
      this.listener = { positionX: new FakeParam(0), positionY: new FakeParam(0), positionZ: new FakeParam(0) };
      this.sources = [];
      this.convolvers = [];
      this.filters = [];
    }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createGain() { return new FakeGain(this); }
    createBiquadFilter() { const f = new FakeFilter(this); this.filters.push(f); return f; }
    createConvolver() { const c = new FakeConvolver(this); this.convolvers.push(c); return c; }
    createPanner() { return new FakePanner(this); }
    createStereoPanner() { return new FakeStereoPanner(this); }
    createDynamicsCompressor() { return new FakeCompressor(this); }
    createBufferSource() { return new FakeSource(this); }
    createMediaElementSource(element) {
      const node = new FakeNode(this, 'media');
      node.element = element;
      this.sources.push(node);
      return node;
    }
    createBuffer(ch, len, sr) { return new FakeAudioBuffer(ch, len, sr); }
  };
}

test('URL dialogue cues share the mixer and voice limits, pause with the game, and release audio on end', async () => {
  const OriginalAudio = globalThis.Audio;
  const instances = [];
  let failPlayback = false;
  let signalSlowStart;
  const slowStarted = new Promise(resolve => { signalSlowStart = resolve; });
  globalThis.Audio = class extends EventTarget {
    constructor() { super(); this.paused = true; instances.push(this); }
    async play() {
      if (failPlayback) throw new Error('Cannot play');
      if (this.src === '/voice/slow.ogg') {
        signalSlowStart();
        return new Promise((_, reject) => { this.abortPlayback = reject; });
      }
      this.paused = false;
    }
    pause() {
      this.paused = true;
      this.abortPlayback?.(new Error('Playback was stopped'));
      this.abortPlayback = null;
    }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    load() {}
  };
  const audio = createAudioManager({ AudioContextClass: createInspectableAudioContextClass(), maxPolyphony: 2 });
  try {
    audio.registerCue('voice.intro', {
      variants: [{ url: '/voice/intro-en.ogg', durationSec: 45 }],
      bus: 'ui_voice', cooldownMs: 0, maxVoices: 1,
    });
    assert.equal(audio.inspectCue('voice.intro').variants[0].duration, 45);
    assert.equal(instances.length, 0, 'registration does not load media');
    const context = await audio.unlock();
    const first = await audio.playCue('voice.intro');
    assert.equal(first.bus, 'ui_voice');
    assert.equal(first.variant, 0);
    assert.equal(audio.activeCount, 1);
    const firstElement = instances[0];
    assert.equal(firstElement.paused, false);
    assert.ok(reachable(context.sources[0], context.destination));
    assert.ok(context.sources.every(source => source.kind === 'media'));

    audio.onHide();
    assert.equal(firstElement.paused, true);
    audio.onShow();
    assert.equal(firstElement.paused, false);
    const second = await audio.playCue('voice.intro');
    assert.ok(second);
    assert.equal(audio.activeCount, 1);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(firstElement.src, '');
    instances[1].dispatchEvent(new Event('ended'));
    assert.equal(audio.activeCount, 0);
    assert.equal(instances[1].src, '');
    assert.equal(context.sources[1].outputs.size, 0);

    failPlayback = true;
    assert.equal(await audio.playCue('voice.intro'), null);
    assert.equal(audio.activeCount, 0);
    assert.equal(instances[2].src, '');
    assert.equal(context.sources[2].outputs.size, 0);

    failPlayback = false;
    audio.registerCue('voice.race', {
      variants: [{ url: '/voice/slow.ogg' }, { url: '/voice/fast.ogg' }],
      cooldownMs: 0, maxVoices: 1,
    });
    const older = audio.playCue('voice.race', { variant: 0 });
    await slowStarted;
    const newer = await audio.playCue('voice.race', { variant: 1 });
    assert.equal(newer.variant, 1);
    assert.equal(audio.activeCount, 1, 'pending starts occupy the per-cue voice limit');
    assert.equal(await older, null);
    assert.equal(instances.at(-1).src, '/voice/fast.ogg');
    newer.stop();

    audio.onHide();
    const hidden = await audio.playCue('voice.intro', { ducking: true });
    assert.ok(hidden);
    assert.equal(instances.at(-1).paused, true);
    assert.equal(audio.getDspState().ducking.bgm, undefined, 'inaudible dialogue does not duck music');
    audio.onShow();
    await Promise.resolve();
    assert.ok(audio.getDspState().ducking.bgm.targetGain < 1);
  } finally {
    await audio.dispose();
    globalThis.Audio = OriginalAudio;
  }
});

function reachable(startNode, targetNode, visited = new Set()) {
  if (!startNode) return false;
  if (startNode === targetNode) return true;
  if (visited.has(startNode)) return false;
  visited.add(startNode);
  for (const next of startNode.outputs ?? []) {
    if (reachable(next, targetNode, visited)) return true;
  }
  return false;
}

test('S3 real DSP graph: voice connects through reverbSend -> ConvolverNode -> destination and bus 3-band EQ', async () => {
  const CtxClass = createInspectableAudioContextClass();
  let lastCtx = null;
  const WrappedCtx = class extends CtxClass {
    constructor() { super(); lastCtx = this; }
  };
  const audio = createAudioManager({ AudioContextClass: WrappedCtx });

  // Register reverb zone BEFORE unlock to verify deferred graph wiring on unlock too
  const zone = audio.createReverbZone({
    id: 'cathedral',
    position: { x: 0, y: 0, z: 0 },
    radius: 30,
    decaySeconds: 2.5,
    wetGain: 0.45,
  });
  assert.equal(zone.wired, false);
  await audio.unlock();
  assert.equal(zone.wired, true);
  assert.equal(audio.getDspState().wiredZones, 1);

  const eq = audio.setBusEq('sfx', { lowGainDb: 4, midGainDb: -3, highGainDb: 6 });
  assert.equal(eq.lowGainDb, 4);
  assert.equal(audio.getBusEq('sfx').highGainDb, 6);

  const dummyBuf = {
    duration: 0.4,
    sampleRate: 48000,
    numberOfChannels: 1,
    length: 19200,
    getChannelData: () => new Float32Array(19200),
  };
  const voice = await audio.play(dummyBuf, { position: { x: 2, y: 0, z: 0 }, reverbSend: 0.75 });
  assert.equal(voice.reverbSendGain, 0.75);

  const srcNode = lastCtx.sources[0];
  const convolverNode = lastCtx.convolvers[0];
  assert.ok(convolverNode, 'ConvolverNode must be allocated');
  // True end-to-end graph check: Source -> ... -> ConvolverNode -> ... -> AudioDestination
  assert.equal(reachable(srcNode, convolverNode), true, 'Audio voice must feed into ConvolverNode input');
  assert.equal(reachable(convolverNode, lastCtx.destination), true, 'ConvolverNode must reach master destination');

  // Verify 3-band EQ filters exist in signal graph with applied gains
  const lowShelf = lastCtx.filters.find(f => f.type === 'lowshelf' && f.gain.value === 4);
  const peaking = lastCtx.filters.find(f => f.type === 'peaking' && f.gain.value === -3);
  const highShelf = lastCtx.filters.find(f => f.type === 'highshelf' && f.gain.value === 6);
  assert.ok(lowShelf && peaking && highShelf, 'All 3 parametric EQ bands must be connected and tuned');

  await audio.dispose();
});

test('P1 real worker offload: SwarmSimulation stepAsync delegates flow-field & swarm-separate to async worker pool', async () => {
  // Build an async worker-mode runner that executes real exported kernels asynchronously (setTimeout 1ms)
  const workerJobs = [];
  const asyncWorkerRunner = createSimWorkerRunner({
    workerCount: 2,
    workerFactory: () => {
      const listeners = new Set();
      return {
        postMessage(msg) {
          if (msg?.op !== 'run') return;
          workerJobs.push(msg.type);
          setTimeout(() => {
            // Run the actual worker kernel asynchronously outside main stack
            const helperRunner = createSimWorkerRunner();
            const h = helperRunner.submit(msg.type, msg.payload);
            const [res] = helperRunner.flushTick(0);
            helperRunner.dispose();
            for (const fn of listeners) {
              fn({ data: { id: msg.id, ok: res.status === 'completed', result: res.value, error: res.error } });
            }
          }, 2);
        },
        addEventListener(t, fn) { if (t === 'message') listeners.add(fn); },
        removeEventListener(t, fn) { if (t === 'message') listeners.delete(fn); },
        terminate() { listeners.clear(); },
      };
    },
  });

  const swarm = createSwarmSimulation({
    capacity: 32,
    separationRadius: 2.0,
    separationStrength: 3.0,
    flowInterval: 0,
    workerRunner: asyncWorkerRunner,
  });

  // Spawn two tightly overlapping units at (1, 0) and (1.2, 0) so separation vector must push apart
  const u0 = swarm.spawn({ x: 1.0, y: 0, speed: 0 });
  const u1 = swarm.spawn({ x: 1.2, y: 0, speed: 0 });
  const initialDist = Math.abs(swarm.posX[u1] - swarm.posX[u0]);

  const res = await swarm.stepAsync(0.05, { heroX: 20, heroY: 0 });
  assert.equal(res.workerMode, 'worker');
  assert.equal(res.flowOffloaded, true);
  assert.equal(res.sepOffloaded, true);
  assert.equal(res.committedJobs, 2);
  assert.ok(workerJobs.includes('flow-field') && workerJobs.includes('swarm-separate'));

  // Assert real separation output copied back and integrated (units pushed further apart along X)
  assert.ok(swarm.sepX[u0] < 0, 'u0 should be pushed -X away from u1');
  assert.ok(swarm.sepX[u1] > 0, 'u1 should be pushed +X away from u0');
  assert.ok(Math.abs(swarm.posX[u1] - swarm.posX[u0]) > initialDist);
  assert.equal(swarm.flowField._hasComputed, true);

  asyncWorkerRunner.dispose();
});
