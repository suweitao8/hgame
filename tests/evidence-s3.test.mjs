// Scorecard S3 evidence: multi-bus mixer + limiter, 3D/2D spatial math, 0-KB synth,
// Web Audio convolution reverb + 3-band EQ, bus ducking, snapshots, procedural BGM, and streaming media.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAudioManager,
  synthesizeSfxPcm,
  getSynthCalibrationGain,
  getComboStepPitchFactor,
  createProceduralBgm,
} from '../assets/runtime/platform/audio.js';
import { computeSpatialMetrics } from '../assets/runtime/platform/audio/voice.js';
import { createBgmController } from '../assets/runtime/platform/audio/bgm-player.js';

function createFakeAudioContextClass() {
  class FakeParam {
    constructor(v = 0) { this.value = v; }
    setValueAtTime(v) { this.value = v; }
    linearRampToValueAtTime(v) { this.value = v; }
    setTargetAtTime(v) { this.value = v; }
  }
  class FakeNode {
    constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outputs = new Set(); }
    connect(d) { this.outputs.add(d); return d; }
    disconnect(d) { if (d) this.outputs.delete(d); else this.outputs.clear(); }
  }
  class FakeGain extends FakeNode { constructor(ctx) { super(ctx, 'gain'); this.gain = new FakeParam(1); } }
  class FakeFilter extends FakeNode {
    constructor(ctx) { super(ctx, 'filter'); this.type = 'lowpass'; this.frequency = new FakeParam(22000); this.Q = new FakeParam(1); this.gain = new FakeParam(0); }
  }
  class FakeConvolver extends FakeNode { constructor(ctx) { super(ctx, 'convolver'); this.buffer = null; } }
  class FakePanner extends FakeNode {
    constructor(ctx) { super(ctx, 'panner'); this.positionX = new FakeParam(0); this.positionY = new FakeParam(0); this.positionZ = new FakeParam(0); }
  }
  class FakeStereo extends FakeNode { constructor(ctx) { super(ctx, 'stereo'); this.pan = new FakeParam(0); } }
  class FakeComp extends FakeNode { constructor(ctx) { super(ctx, 'compressor'); } }
  class FakeSource extends FakeNode {
    constructor(ctx) { super(ctx, 'source'); this.playbackRate = new FakeParam(1); this.loop = false; this.buffer = null; ctx.sources.push(this); }
    start() {}
    stop() { this.onended?.(); }
  }
  class FakeBuffer {
    constructor(ch, len, sr) { this.numberOfChannels = ch; this.length = len; this.sampleRate = sr; this.duration = len / sr; this.ch = Array.from({ length: ch }, () => new Float32Array(len)); }
    getChannelData(c) { return this.ch[c]; }
  }
  return class FakeAudioContext {
    constructor() {
      this.state = 'running'; this.sampleRate = 48000; this.currentTime = 0;
      this.destination = new FakeNode(this, 'destination');
      this.listener = { positionX: new FakeParam(0), positionY: new FakeParam(0), positionZ: new FakeParam(0) };
      this.sources = []; this.convolvers = []; this.filters = []; this.compressors = [];
      FakeAudioContext.last = this;
    }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createGain() { return new FakeGain(this); }
    createBiquadFilter() { const f = new FakeFilter(this); this.filters.push(f); return f; }
    createConvolver() { const c = new FakeConvolver(this); this.convolvers.push(c); return c; }
    createPanner() { return new FakePanner(this); }
    createStereoPanner() { return new FakeStereo(this); }
    createDynamicsCompressor() { const c = new FakeComp(this); this.compressors.push(c); return c; }
    createBufferSource() { return new FakeSource(this); }
    createMediaElementSource(el) { const n = new FakeNode(this, 'media'); n.element = el; this.sources.push(n); return n; }
    createBuffer(ch, len, sr) { return new FakeBuffer(ch, len, sr); }
  };
}

test('S3 buses, spatial math, and 0-KB synth generate calibrated PCM without network/assets', () => {
  const pcm = synthesizeSfxPcm('hit', { sampleRate: 22050 });
  assert.ok(pcm instanceof Float32Array && pcm.length > 100);
  assert.ok(pcm.some((s) => Math.abs(s) > 0) && pcm.every((s) => Math.abs(s) <= 1));
  assert.ok(getSynthCalibrationGain('sawtooth') < getSynthCalibrationGain('sine'));
  assert.ok(getComboStepPitchFactor(4) > getComboStepPitchFactor(0));

  const listener = { x: 0, y: 0, z: 0, forwardX: 0, forwardY: 0, forwardZ: -1, upX: 0, upY: 1, upZ: 0 };
  const m2d = computeSpatialMetrics([240, 0], { maxDistance: 400, panRange: 480 }, listener);
  assert.equal(m2d.kind, '2d');
  assert.ok(m2d.pan > 0 && m2d.distanceGain > 0 && m2d.distanceGain < 1);
  const m3d = computeSpatialMetrics({ x: 0, y: 0, z: -15 }, { maxDistance: 30, refDistance: 3 }, listener);
  assert.equal(m3d.kind, '3d');
  assert.ok(m3d.distanceGain < 1 && m3d.distanceGain > 0);
});

test('S3 DSP chain wires master limiter, ConvolverNode, 3-band EQ, ducking, snapshots, and adaptive BGM', async () => {
  const Ctx = createFakeAudioContextClass();
  const audio = createAudioManager({ AudioContextClass: Ctx, compressor: true });
  audio.createReverbZone({ id: 'hall', position: { x: 0, y: 0, z: 0 }, radius: 20, decaySeconds: 1.8, wetGain: 0.4 });
  const ctx = await audio.unlock();
  assert.ok(ctx.compressors.length >= 1, 'master dynamics limiter allocated');
  assert.ok(ctx.convolvers.length >= 1, 'ConvolverNode allocated');

  audio.setBusEq('sfx', { lowGainDb: 3, midGainDb: -2, highGainDb: 4 });
  assert.equal(audio.getBusEq('sfx').midGainDb, -2);
  assert.ok(ctx.filters.some((f) => f.type === 'peaking' && f.gain.value === -2));

  audio.duckBus('bgm', 0.25, { attackMs: 5, holdMs: 20, releaseMs: 30 });
  assert.ok(audio.getDspState().ducking.bgm.targetGain < 1);

  audio.registerSnapshot('pause', { bgm: 0.3, sfx: 0.1 });
  audio.applySnapshot('pause');
  assert.equal(audio.activeSnapshot, 'pause');
  audio.clearSnapshot();
  assert.equal(audio.activeSnapshot, null);

  const bgm = audio.createBgm({ mood: 'combat', bpm: 130 });
  assert.ok(typeof bgm.setMood === 'function');
  const proc = createProceduralBgm({ mood: 'explore' });
  proc.setMood('boss');
  assert.equal(proc.getState().mood, 'boss');
  await audio.dispose();
});

test('S3 streaming BGM plays via HTMLAudioElement without decodeAudioData memory residency', async () => {
  const OrigAudio = globalThis.Audio;
  const created = [];
  globalThis.Audio = class extends EventTarget {
    constructor() { super(); this.src = ''; this.paused = true; this.currentTime = 0; this.duration = 120; created.push(this); }
    async play() { this.paused = false; }
    pause() { this.paused = true; }
    removeAttribute(k) { if (k === 'src') this.src = ''; }
    load() {}
  };
  let decodeCalled = 0;
  const Ctx = createFakeAudioContextClass();
  const NoDecodeCtx = class extends Ctx {
    decodeAudioData() { decodeCalled++; return Promise.resolve(this.createBuffer(2, 1024, 48000)); }
  };
  const audio = createAudioManager({ AudioContextClass: NoDecodeCtx });
  try {
    await audio.unlock();
    audio.registerBgmCue('bgm.boss', { url: '/audio/boss.ogg', loop: true });
    const started = await audio.playBgm('bgm.boss', { fadeMs: 0 });
    assert.ok(started);
    assert.equal(created.length, 1);
    assert.equal(created[0].paused, false);
    assert.equal(decodeCalled, 0, 'streaming BGM must not call decodeAudioData');
    assert.equal(typeof createBgmController, 'function');
    audio.stopBgm();
  } finally {
    await audio.dispose();
    globalThis.Audio = OrigAudio;
  }
});
