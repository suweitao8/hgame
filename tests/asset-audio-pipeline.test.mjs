import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  defineProject,
  createGameApplication,
  Scene,
  Entity,
  SpriteSheet,
  createAudioManager,
  analyzeAudioBuffer,
  normalizeVariantSet,
  SYNTH_PRESETS,
  synthesizeSfxPcm,
  createSynthSfx,
} from '../assets/runtime/index.js';
import { Sprite2D, createCanvas2DAdapter } from '../assets/runtime/integrations/canvas2d.js';
import {
  decodePng,
  encodePng,
  splitRgbaGrid,
  removeBackgroundRgba,
  cropAndNormalizeRgba,
} from '../scripts/process-assets.mjs';
import {
  selectConsistentVariants,
  processCueFiles,
  SURFACE_TYPES_10,
  AUDIO_LOUDNESS_TIERS,
  classifyAudioLoudnessTier,
  computeVariantLoudnessOffsetDb,
  computeSafeShortGainDb,
  extractSemanticCueKey,
  parseWavPcmSamples,
  computeSpectralCentroidHz,
  selectQuantileVariants,
  buildSurfaceTypeCueMap,
  processAudioLibraryBatch,
} from '../scripts/process-audio.mjs';

function makeAudioBuffer({
  sampleRate = 1000,
  leadSilenceSamples = 0,
  activeSamples = 100,
  trailSilenceSamples = 0,
  amplitude = 0.25,
} = {}) {
  const total = leadSilenceSamples + activeSamples + trailSilenceSamples;
  const ch = new Float32Array(total);
  for (let i = 0; i < leadSilenceSamples; i++) {
    ch[i] = 0.0002 * ((i % 2) * 2 - 1);
  }
  for (let i = 0; i < activeSamples; i++) {
    ch[leadSilenceSamples + i] = amplitude * Math.sin((i / 10) * Math.PI * 2);
  }
  for (let i = 0; i < trailSilenceSamples; i++) {
    ch[leadSilenceSamples + activeSamples + i] = 0.0001 * ((i % 2) * 2 - 1);
  }
  return {
    sampleRate,
    length: total,
    duration: total / sampleRate,
    numberOfChannels: 1,
    getChannelData: () => ch,
  };
}

function createSpatialMockAudioContextClass() {
  const created = {
    contexts: [],
    panners: [],
    stereos: [],
    sources: [],
    compressors: [],
    gains: [],
  };

  class MockAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 1.5;
      this.destination = { kind: 'destination' };
      this.listener = {
        positionX: { value: 0 },
        positionY: { value: 0 },
        positionZ: { value: 0 },
        forwardX: { value: 0 },
        forwardY: { value: 0 },
        forwardZ: { value: -1 },
        upX: { value: 0 },
        upY: { value: 1 },
        upZ: { value: 0 },
      };
      created.contexts.push(this);
    }
    async resume() {}
    createGain() {
      const node = {
        gain: {
          value: 1,
          ramps: [],
          targets: [],
          setTargetAtTime(v, t, tc) { this.value = v; this.targets.push([v, t, tc]); },
          setValueAtTime(v, t) { this.ramps.push(['set', v, t]); },
          linearRampToValueAtTime(v, t) { this.ramps.push(['ramp', v, t]); },
          exponentialRampToValueAtTime(v, t) { this.ramps.push(['exp', v, t]); },
          cancelScheduledValues() {},
        },
        connections: [],
        connect(dest) { this.connections.push(dest); },
        disconnect() {},
      };
      created.gains.push(node);
      return node;
    }
    createDynamicsCompressor() {
      const node = {
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 0 },
        attack: { value: 0 },
        release: { value: 0 },
        connect() {},
      };
      created.compressors.push(node);
      return node;
    }
    createPanner() {
      const node = {
        panningModel: 'equalpower',
        distanceModel: 'inverse',
        refDistance: 1,
        maxDistance: 100,
        rolloffFactor: 1,
        positionX: { value: 0 },
        positionY: { value: 0 },
        positionZ: { value: 0 },
        connect() {},
      };
      created.panners.push(node);
      return node;
    }
    createStereoPanner() {
      const node = {
        pan: { value: 0 },
        connect() {},
      };
      created.stereos.push(node);
      return node;
    }
    createBiquadFilter() {
      return {
        type: 'lowpass',
        frequency: { value: 1000, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} },
        Q: { value: 1 },
        connect() {},
        disconnect() {},
      };
    }
    createOscillator() {
      return {
        type: 'sine',
        frequency: { value: 440, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
        addEventListener() {},
      };
    }
    createBuffer(ch, len, sr) {
      return { numberOfChannels: ch, length: len, sampleRate: sr, getChannelData: () => new Float32Array(len) };
    }
    createBufferSource() {
      const listeners = [];
      const src = {
        buffer: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        playbackRate: { value: 1 },
        startCalls: [],
        stopCalls: [],
        connect() {},
        addEventListener(_ev, fn) { listeners.push(fn); },
        start(...args) { src.startCalls.push(args); },
        stop(...args) {
          src.stopCalls.push(args);
          for (const fn of listeners) fn();
        },
      };
      created.sources.push(src);
      return src;
    }
    async close() {}
  }

  return { MockAudioContext, created };
}

test('createAudioManager supports 3D binaural HRTF panning, listener camera sync, 2D stereo panning, and live position updates', async () => {
  const { MockAudioContext, created } = createSpatialMockAudioContextClass();
  const audio = createAudioManager({ AudioContextClass: MockAudioContext });
  await audio.unlock();

  // Limiter initialized on master chain (-2 dBTP ceiling, knee 4, ratio 12, attack 2ms, release 100ms)
  assert.equal(created.compressors.length, 1);
  assert.equal(created.compressors[0].threshold.value, -2);
  assert.equal(created.compressors[0].knee.value, 4);
  assert.equal(created.compressors[0].ratio.value, 12);
  assert.equal(created.compressors[0].attack.value, 0.002);
  assert.equal(created.compressors[0].release.value, 0.1);

  // Sync listener from Three.js column-major camera matrixWorld: placed at (0, 1.7, 10) facing -Z
  const camElements = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 1.7, 10, 1,
  ]);
  audio.updateListenerFromCamera({ matrixWorld: { elements: camElements } });
  const ctx = created.contexts[0];
  assert.equal(ctx.listener.positionX.value, 0);
  assert.ok(Math.abs(ctx.listener.positionY.value - 1.7) < 1e-5);
  assert.equal(ctx.listener.positionZ.value, 10);
  assert.equal(ctx.listener.forwardZ.value, -1);

  const sfx = { id: 'footstep' };
  const leftHandle = await audio.play(sfx, { position: [-6, 1.7, 6], refDistance: 2 });
  const rightHandle = await audio.play(sfx, { position: [6, 1.7, 6], refDistance: 2 });

  assert.equal(created.panners.length, 2);
  assert.equal(created.panners[0].panningModel, 'HRTF');
  assert.ok(leftHandle.pan < -0.5, 'negative X must pan toward left ear');
  assert.ok(rightHandle.pan > 0.5, 'positive X must pan toward right ear');
  assert.ok(leftHandle.distanceGain < 1 && leftHandle.distanceGain > 0);
  assert.equal(leftHandle.bus, 'spatial');

  // Move left sound across to the right ear while playing
  leftHandle.setPosition({ x: 8, y: 1.7, z: 6 });
  assert.ok(leftHandle.pan > 0.7);
  assert.equal(created.panners[0].positionX.value, 8);

  // 2D spatial pan & ducking check
  audio.setListener({ x: 100, y: 50, z: 0 });
  const left2D = await audio.play(sfx, { position2D: { x: -140, y: 50 }, panRange: 480 });
  const right2D = await audio.play(sfx, { position2D: [340, 50], panRange: 480 });
  assert.ok(left2D.pan < -0.45 && left2D.pan >= -0.55);
  assert.ok(right2D.pan > 0.45 && right2D.pan <= 0.55);
  assert.equal(created.stereos.length, 2);
  assert.equal(audio.duckBus('music', 0.4, 20), true);

  await audio.dispose();
});

test('audio pipeline trims MP3 encoder silence for instant one-shots & gapless loops, aligns variant loudness/duration, and avoids consecutive duplicates', async () => {
  const { MockAudioContext, created } = createSpatialMockAudioContextClass();
  const audio = createAudioManager({ AudioContextClass: MockAudioContext });

  // Variants simulate website MP3 candidates with leading/trailing padding, loudness differences, and one long tail
  const v0 = makeAudioBuffer({ sampleRate: 1000, leadSilenceSamples: 40, activeSamples: 240, trailSilenceSamples: 40, amplitude: 0.20 });
  const v1 = makeAudioBuffer({ sampleRate: 1000, leadSilenceSamples: 30, activeSamples: 250, trailSilenceSamples: 30, amplitude: 0.45 });
  const v2 = makeAudioBuffer({ sampleRate: 1000, leadSilenceSamples: 35, activeSamples: 245, trailSilenceSamples: 35, amplitude: 0.22 });
  const v3 = makeAudioBuffer({ sampleRate: 1000, leadSilenceSamples: 20, activeSamples: 550, trailSilenceSamples: 20, amplitude: 0.21 });

  const analyzed0 = analyzeAudioBuffer(v0);
  assert.ok(analyzed0.analyzable);
  assert.ok(analyzed0.trimStart > 0.035 && analyzed0.trimStart < 0.041);
  assert.ok(analyzed0.activeDuration < 0.26);

  const norm = normalizeVariantSet([v0, v1, v2, v3], { maxDurationSpreadRatio: 0.25 });
  assert.equal(norm.allConsistent, false);
  assert.equal(norm.variants[3].consistent, false, 'outlier 0.55s tail must be flagged');
  assert.ok(norm.variants[1].gainScale < 0.7, 'louder variant must be attenuated to match median RMS');
  assert.ok(norm.variants[3].playDuration <= norm.medianDuration * 1.25 + 1e-6, 'outlier duration tail must be clamped');
  assert.ok(norm.variants[3].tailFadeSec > 0);

  const cueSummary = audio.registerCue('shot', [v0, v1, v2, v3], { maxDurationSpreadRatio: 0.25, cooldownMs: 0 });
  assert.equal(cueSummary.variantCount, 4);
  assert.equal(cueSummary.allConsistent, false);

  let prevVariant = -1;
  for (let i = 0; i < 40; i++) {
    const h = await audio.playCue('shot', { random: () => ((i * 37) % 100) / 100 });
    assert.ok(h);
    assert.notEqual(h.variant, prevVariant, 'consecutive identical variants must never play back-to-back');
    prevVariant = h.variant;
    h.stop();
  }

  // 2-variant cue strictly alternates A -> B -> A -> B
  audio.registerCue('step', [v0, v2], { cooldownMs: 0 });
  const seq = [];
  for (let i = 0; i < 6; i++) {
    const h = await audio.playCue('step');
    seq.push(h.variant);
    h.stop();
  }
  assert.deepEqual(seq, [0, 1, 0, 1, 0, 1]);

  // Gapless loop binds loopStart/loopEnd inside non-silent waveform
  const bgmLoop = await audio.play(v0, { loop: true, bus: 'music' });
  const loopSrc = created.sources[created.sources.length - 1];
  assert.equal(loopSrc.loop, true);
  assert.ok(loopSrc.loopStart > 0.035);
  assert.ok(loopSrc.loopEnd < 0.29);
  bgmLoop.stop();

  await audio.dispose();
});

test('Sprite2D.groundShadow stays planted without flashing white on hitFlash and SpriteSheet.fromGrid slices uniformly', () => {
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
    beginPath() { ops.push([tag, 'beginPath']); },
    arc(x, y, r) { ops.push([tag, 'arc', x, y, r, this.fillStyle, this.globalAlpha]); },
    fill() { ops.push([tag, 'fill']); },
    fillText(text, x, y) { ops.push([tag, 'fillText', text, x, y]); },
    drawImage(...args) { ops.push([tag, 'drawImage', ...args, this.globalAlpha]); },
  });
  const mainCtx = createCtx('main');
  const canvas = {
    width: 320,
    height: 180,
    clientWidth: 320,
    clientHeight: 180,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 180 }),
    getContext: (kind) => (kind === '2d' ? mainCtx : null),
  };
  const createBufferCanvas = (bw, bh) => ({
    width: bw,
    height: bh,
    getContext: () => createCtx('buf'),
  });

  const adapter = createCanvas2DAdapter({ canvas, width: 320, height: 180, createBufferCanvas });
  const app = createGameApplication({
    project: defineProject({ profile: '2d', tickHz: 50, features: ['scene'] }),
    platform: {
      assets: { async json() { return {}; } },
      input: { endFrame() {}, reset() {} },
      diagnostics: { recordFrame() {} },
    },
    renderer: adapter,
  });
  const scene = app.scenes.add(new Scene('shadow'));
  const ent = scene.add(new Entity({ x: 0, y: 0 }));
  const sprite = ent.addComponent(new Sprite2D({
    image: { width: 64, height: 64 },
    width: 40,
    height: 60,
    anchorY: 1,
    offsetY: -20,
    rotation: 0.35,
    groundShadow: true,
  }));
  sprite.hitFlash(0.1, '#ffffff');
  app.scenes.start('shadow');
  app.step(0.02);

  // Verify ground shadow rendered via arc fallback BEFORE sprite offsetY/rotate and only 1 white flash occurred
  const shadowTranslateIdx = ops.findIndex(o => o[0] === 'main' && o[1] === 'translate' && Math.abs(o[3] - (-60 * 0.032)) < 1e-4);
  const bodyLiftIdx = ops.findIndex(o => o[0] === 'main' && o[1] === 'translate' && o[3] === -20);
  const bodyRotIdx = ops.findIndex(o => o[0] === 'main' && o[1] === 'rotate' && o[2] === 0.35);
  const shadowArc = ops.find(o => o[0] === 'main' && o[1] === 'arc');
  const flashFills = ops.filter(o => o[0] === 'buf' && o[1] === 'fillRect' && o[8] === 'source-in');

  assert.ok(shadowTranslateIdx >= 0, 'ground shadow stays near rest ground plane instead of lifting with sprite.offsetY');
  assert.ok(shadowArc && shadowArc[6] < 0.45, 'jumping offsetY < 0 reduces shadow alpha');
  assert.ok(shadowTranslateIdx < bodyLiftIdx && bodyLiftIdx < bodyRotIdx, 'shadow draws strictly before body bounce and tilt');
  assert.equal(flashFills.length, 1, 'hitFlash applies only to sprite body, never ground shadow');

  // Verify SpriteSheet.fromGrid slicing
  const grid3 = SpriteSheet.fromGrid({ width: 1024, height: 1024 }, { columns: 3, rows: 3, inset: 2 });
  assert.equal(grid3.length, 9);
  assert.deepEqual(grid3.frame(4), { x: 343, y: 343, width: 337, height: 337 });
  const grid2 = SpriteSheet.fromGrid({ width: 1024, height: 1024 }, { columns: 2, rows: 2 });
  assert.equal(grid2.length, 4);
  assert.deepEqual(grid2.frame(3), { x: 512, y: 512, width: 512, height: 512 });

  app.dispose();
});

test('process-assets.mjs splits 2x2 green-screen and 3x3 white-bg PNG sheets cleanly without baking shadows by default', () => {
  // 1) Synthetic 2x2 sheet (64x64): #00FF00 background with a natural green forest character in cell (0,0)
  const w2 = 64;
  const h2 = 64;
  const px2 = new Uint8ClampedArray(w2 * h2 * 4);
  for (let i = 0; i < w2 * h2; i++) {
    px2[i * 4] = 0;
    px2[i * 4 + 1] = 255;
    px2[i * 4 + 2] = 0;
    px2[i * 4 + 3] = 255;
  }
  for (let y = 6; y < 26; y++) {
    for (let x = 6; x < 26; x++) {
      const idx = (y * w2 + x) * 4;
      px2[idx] = 40;
      px2[idx + 1] = 115;
      px2[idx + 2] = 50;
      px2[idx + 3] = 255;
    }
  }
  const decoded2 = decodePng(encodePng({ width: w2, height: h2, data: px2 }));
  assert.deepEqual(decoded2.data, px2);

  const cells2 = splitRgbaGrid(decoded2, { grid: 2 });
  assert.equal(cells2.length, 4);
  const cutoutGreen = removeBackgroundRgba(cells2[0], { mode: 'green', preserveInteriorGreen: true });
  assert.equal(cutoutGreen.data[3], 0, 'exterior #00FF00 green background becomes transparent');
  const centerIdx = (16 * cells2[0].width + 16) * 4;
  assert.ok(cutoutGreen.data[centerIdx + 3] > 200, 'interior forest-green armor remains opaque');

  const actor = cropAndNormalizeRgba(cutoutGreen, { tier: '2x2', mode: 'actor', bakeShadow: false });
  assert.ok(actor.width <= 512 && actor.height <= 512);
  assert.ok(actor.width <= 20 && actor.height <= 20, 'cropped actor excludes empty whitespace and baked shadow');

  // 2) White-background cutout preserves interior white eye highlights surrounded by dark outline
  const cw = 30;
  const ch = 30;
  const whiteSheet = { width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) };
  whiteSheet.data.fill(255); // solid white background
  for (let y = 8; y < 22; y++) {
    for (let x = 8; x < 22; x++) {
      const off = (y * cw + x) * 4;
      const isEye = x >= 13 && x <= 16 && y >= 13 && y <= 16;
      whiteSheet.data[off] = isEye ? 255 : 20;
      whiteSheet.data[off + 1] = isEye ? 255 : 20;
      whiteSheet.data[off + 2] = isEye ? 255 : 20;
      whiteSheet.data[off + 3] = 255;
    }
  }
  const cutoutWhite = removeBackgroundRgba(whiteSheet, { mode: 'white' });
  assert.equal(cutoutWhite.data[3], 0, 'exterior white background removed');
  const eyeIdx = (14 * cw + 14) * 4;
  assert.equal(cutoutWhite.data[eyeIdx + 3], 255, 'interior white highlight stays 100% opaque');
});

test('process-audio.mjs selects consistent 2-4 variants and processes MP3s cleanly with ffmpeg', () => {
  const selection = selectConsistentVariants([
    { id: 'c1', trimStart: 0.03, trimEnd: 0.28, activeDuration: 0.25, rms: 0.20, peak: 0.8 },
    { id: 'c2', trimStart: 0.03, trimEnd: 0.30, activeDuration: 0.27, rms: 0.38, peak: 0.9 },
    { id: 'c3', trimStart: 0.02, trimEnd: 0.26, activeDuration: 0.24, rms: 0.21, peak: 0.8 },
    { id: 'c4', trimStart: 0.01, trimEnd: 0.65, activeDuration: 0.64, rms: 0.22, peak: 0.8 },
  ], { minKeep: 2, maxKeep: 4, maxDurationSpreadRatio: 0.25 });

  assert.equal(selection.selected.length, 3, 'outlier c4 is rejected when 3 consistent variants meet threshold');
  assert.equal(selection.rejected.length, 1);
  assert.equal(selection.rejected[0].id, 'c4');
  assert.equal(selection.consistent, true);

  // Optional end-to-end FFmpeg test if ffmpeg is installed in environment
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (probe.status !== 0) return;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-audio-'));
  try {
    const outDir = path.join(tmpDir, 'out');
    const rawFiles = [];
    const specs = [
      { name: 'v1.mp3', freq: 330, dur: 0.25, vol: 0.4 },
      { name: 'v2.mp3', freq: 350, dur: 0.26, vol: 0.8 },
      { name: 'v3.mp3', freq: 340, dur: 0.24, vol: 0.45 },
      { name: 'v4.mp3', freq: 360, dur: 0.70, vol: 0.5 },
    ];
    for (const s of specs) {
      const fpath = path.join(tmpDir, s.name);
      const gen = spawnSync('ffmpeg', [
        '-y', '-v', 'error',
        '-f', 'lavfi', '-i', `sine=frequency=${s.freq}:duration=${s.dur}`,
        '-af', `adelay=40|40,apad=pad_dur=0.05,volume=${s.vol}`,
        '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k',
        fpath,
      ], { encoding: 'utf8' });
      assert.equal(gen.status, 0, gen.stderr);
      rawFiles.push(fpath);
    }

    const report = processCueFiles({
      cueName: 'blaster',
      inputs: rawFiles,
      outDir,
      minKeep: 2,
      maxKeep: 4,
      maxDurationSpreadRatio: 0.28,
    });
    assert.equal(report.format, 'mp3');
    assert.equal(report.channels, 1);
    assert.equal(report.selected.length, 3);
    assert.equal(report.rejectedCount, 1);
    for (const item of report.selected) {
      assert.equal(fs.existsSync(item.outputFile), true);
      assert.ok(fs.statSync(item.outputFile).size > 500);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('procedural audio synth provides 10 presets, pitchJitter, PCM generation, and headless/AudioManager integration', async () => {
  const requiredPresets = ['hit', 'slash', 'shoot', 'explosion', 'pickup', 'powerup', 'click', 'hurt', 'laser', 'jump'];
  for (const name of requiredPresets) {
    assert.ok(SYNTH_PRESETS[name], `missing preset ${name}`);
    const pcm = synthesizeSfxPcm(name, { sampleRate: 22050 });
    assert.ok(pcm instanceof Float32Array && pcm.length > 100);
    let peak = 0;
    for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    assert.ok(peak > 0.05 && peak <= 1.0, `unexpected PCM peak ${peak} for ${name}`);
  }

  // Headless safe fallback
  const headlessSynth = createSynthSfx({ AudioContextClass: undefined, random: () => 0.75 });
  assert.equal(headlessSynth.available, false);
  const resHeadless = headlessSynth.play('hit', { pitchJitter: 0.1 });
  assert.equal(resHeadless.played, false);
  assert.ok(Math.abs(resHeadless.pitchFactor - 1.05) < 1e-6);

  // Mock WebAudio context verification
  let oscCount = 0;
  let bufSrcCount = 0;
  class SynthMockCtx {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.state = 'running';
      this.destination = { connect() {} };
      this.listener = {};
    }
    createGain() {
      return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }, connect() {} };
    }
    createBiquadFilter() {
      return { type: 'lowpass', frequency: { value: 1000, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }, Q: { value: 1 }, connect() {} };
    }
    createOscillator() {
      oscCount++;
      return { type: 'sine', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} };
    }
    createBuffer(ch, len, sr) {
      return { numberOfChannels: ch, length: len, sampleRate: sr, getChannelData: () => new Float32Array(len) };
    }
    createBufferSource() {
      bufSrcCount++;
      return { buffer: null, connect() {}, start() {}, stop() {} };
    }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }

  const audio = createAudioManager({ AudioContextClass: SynthMockCtx });
  const played = audio.playSynth('explosion', { pitchJitter: 0.12, random: () => 0.25 });
  assert.equal(played.played, true);
  assert.equal(played.preset, 'explosion');
  assert.ok(oscCount >= 1 && bufSrcCount >= 1);
  played.stop();
  await audio.dispose();
});

test('Milestone 3: semantic cue grouping, WAV PCM parser, spectral centroid, quantile 3-4 selection, and 10-surface coverage', () => {
  // 1. Semantic grouping preserves action/material/intensity and strips trailing take/index suffixes
  const sword = extractSemanticCueKey('SFX_Sword_Slash_Heavy_04', { pack: 'SwordPackUE', relDir: 'Combat' });
  assert.equal(sword.cueKey, 'sword_slash_heavy');
  assert.equal(sword.isExtendedFootstep, false);

  const door = extractSemanticCueKey('door_creak_003_var2', { pack: 'Doorssfx', relDir: 'Wood' });
  assert.equal(door.cueKey, 'door_creak');

  const robotStep = extractSemanticCueKey('Robotic_Concrete_Walk_01', { pack: 'FootstepsSoundPack', relDir: 'Robotic/Concrete' });
  assert.equal(robotStep.isExtendedFootstep, true);

  // 2. WAV PCM parser + spectral centroid
  const sr = 22050;
  const nFrames = Math.floor(sr * 0.25);
  const wavBuf = Buffer.alloc(44 + nFrames * 2);
  wavBuf.write('RIFF', 0);
  wavBuf.writeUInt32LE(36 + nFrames * 2, 4);
  wavBuf.write('WAVE', 8);
  wavBuf.write('fmt ', 12);
  wavBuf.writeUInt32LE(16, 16);
  wavBuf.writeUInt16LE(1, 20);
  wavBuf.writeUInt16LE(1, 22);
  wavBuf.writeUInt32LE(sr, 24);
  wavBuf.writeUInt32LE(sr * 2, 28);
  wavBuf.writeUInt16LE(2, 32);
  wavBuf.writeUInt16LE(16, 34);
  wavBuf.write('data', 36);
  wavBuf.writeUInt32LE(nFrames * 2, 40);
  for (let i = 0; i < nFrames; i++) {
    const val = Math.sin((2 * Math.PI * 880 * i) / sr) * 0.5;
    wavBuf.writeInt16LE(Math.round(val * 32767), 44 + i * 2);
  }
  const parsed = parseWavPcmSamples(wavBuf, 2.0);
  assert.ok(parsed);
  assert.equal(parsed.sampleRate, sr);
  assert.ok(Math.abs(parsed.duration - 0.25) < 0.01);
  const centroid = computeSpectralCentroidHz(parsed.samples, sr, 0, 0.25);
  assert.ok(centroid > 750 && centroid < 1050, `Expected ~880Hz centroid, got ${centroid}`);

  // 3. Quantile selection picks 3-4 evenly distributed variants and rejects outliers
  const group = Array.from({ length: 12 }, (_, i) => ({
    id: `v_${i + 1}`,
    activeDuration: 0.22 + i * 0.012,
    rms: 0.25,
    peak: 0.75 + i * 0.01,
    spectralCentroidHz: 600 + i * 120,
  }));
  group.push({ id: 'outlier_long', activeDuration: 2.8, rms: 0.25, peak: 0.9, spectralCentroidHz: 400 });
  const qRes = selectQuantileVariants(group, { minKeep: 3, maxKeep: 4 });
  assert.equal(qRes.selected.length, 4);
  assert.ok(qRes.selected.every((s) => s.id !== 'outlier_long'));

  // 4. 10 surfaceTypes coverage for step_* & impact_* excluding Cowboy/Retro/Robotic footsteps
  assert.equal(SURFACE_TYPES_10.length, 10);
  const mockSfx = [];
  for (const s of SURFACE_TYPES_10) {
    mockSfx.push({
      id: `step_${s}_1`,
      pack: 'FootstepsSoundPack',
      relDir: s,
      name: `Footstep_${s}_Walk_01`,
      isExtendedFootstep: false,
      duration: 0.3,
      activeDuration: 0.25,
      rms: 0.2,
      peak: 0.6,
      spectralCentroidHz: 900,
      relOut: `sfx/FootstepsSoundPack/${s}.mp3`,
      url: `/assets/cn/audio/sfx/FootstepsSoundPack/${s}.mp3`,
    });
    mockSfx.push({
      id: `imp_${s}_1`,
      pack: 'MeleeWeaponsSoundEffectsPack1',
      relDir: s,
      name: `Impact_${s}_Hit_01`,
      isExtendedFootstep: false,
      duration: 0.25,
      activeDuration: 0.2,
      rms: 0.25,
      peak: 0.8,
      spectralCentroidHz: 1100,
      relOut: `sfx/Melee/${s}.mp3`,
      url: `/assets/cn/audio/sfx/Melee/${s}.mp3`,
    });
  }
  mockSfx.push({
    id: 'cowboy_1',
    pack: 'FootstepsSoundPack',
    relDir: 'Cowboy',
    name: 'Cowboy_Concrete_01',
    isExtendedFootstep: true,
    duration: 0.3,
    activeDuration: 0.25,
    rms: 0.2,
    peak: 0.6,
    spectralCentroidHz: 900,
    relOut: 'sfx/FootstepsSoundPack/cowboy.mp3',
    url: '/assets/cn/audio/sfx/FootstepsSoundPack/cowboy.mp3',
  });
  const sMap = buildSurfaceTypeCueMap([], mockSfx);
  for (const s of SURFACE_TYPES_10) {
    assert.ok(sMap.coverage.step[s] >= 1, `missing step_${s}`);
    assert.ok(sMap.coverage.impact[s] >= 1, `missing impact_${s}`);
  }
  const stepAllIds = sMap.surfaceCues.filter((c) => c.cueName.startsWith('step_')).flatMap((c) => c.variants.map((v) => v.id));
  assert.ok(!stepAllIds.includes('cowboy_1'), 'extended Cowboy footsteps must not enter default step_<surface>');
});

test('Loudness tier classification, intensity/distance offsets, gain clamping, synth calibration, and 5-bus concurrency/ducking guards', async () => {
  // 1. 6-tier classification across packs
  assert.equal(classifyAudioLoudnessTier({ pack: 'GunSoundPack', relDir: 'Guns', name: 'rifle_shot' }).id, 'sfx_combat_heavy');
  assert.equal(classifyAudioLoudnessTier({ pack: 'VfxExtras', relDir: 'Explosions', name: 'Grenade_Blast_01' }).id, 'sfx_combat_heavy');
  assert.equal(classifyAudioLoudnessTier({ pack: 'GunSoundPack', relDir: 'BonusSounds', name: 'announcer_headshot' }).id, 'ui_voice');
  assert.equal(classifyAudioLoudnessTier({ pack: 'GunSoundPack', relDir: 'BonusSounds', name: 'foley_shell_drop' }).id, 'sfx_foley');
  assert.equal(classifyAudioLoudnessTier({ pack: 'GunSoundPack', relDir: 'BonusSounds', name: 'bird_chirp' }).id, 'ambience');
  assert.equal(classifyAudioLoudnessTier({ pack: 'MeleeWeaponsSoundEffectsPack1', relDir: 'WAV/Swings', name: 'swing_01' }).id, 'sfx_combat_light');
  assert.equal(classifyAudioLoudnessTier({ pack: 'Zombie_Sound_Effects_Bundle', relDir: 'Wavs', name: 'survival_ambient_loop', duration: 12 }).id, 'ambience');
  assert.equal(classifyAudioLoudnessTier({ pack: 'SoundPackRPGGames', relDir: 'SoundPackWav/VoicesCue', name: 'quest_complete' }).id, 'ui_voice');
  assert.equal(classifyAudioLoudnessTier({ pack: 'SoundPackRPGGames', relDir: 'SoundPackWav/CraftingWav', name: 'hammer_anvil' }).id, 'sfx_foley');
  assert.equal(classifyAudioLoudnessTier({ pack: 'SoundPackRPGGames', relDir: 'SoundPackWav/AttacksWav', name: 'slash_01' }).id, 'sfx_combat_light');
  assert.equal(classifyAudioLoudnessTier({ pack: 'RewardsLootsAudioPack', relDir: 'Break_Jar_01/Sounds', name: 'jar_break' }).id, 'sfx_combat_light');
  assert.equal(classifyAudioLoudnessTier({ pack: 'RewardsLootsAudioPack', relDir: 'Deliver_Quest_01/Sounds', name: 'quest_done' }).id, 'ui_voice');
  assert.equal(classifyAudioLoudnessTier({ pack: 'FootstepsSoundPack', relDir: 'BONUS_HUMAN_VOCAL_SOUNDS', name: 'grunt_01' }).id, 'ui_voice');
  assert.equal(classifyAudioLoudnessTier({ pack: 'FootstepsSoundPack', relDir: 'Concrete', name: 'step_01' }).id, 'sfx_foley');
  assert.equal(classifyAudioLoudnessTier({ pack: 'MegaBundleSoundPack', relDir: 'MystickSoundtracks/Soundtracks', name: 'theme_01', duration: 40 }).id, 'bgm');
  assert.equal(classifyAudioLoudnessTier({ pack: 'MegaBundleSoundPack', relDir: 'DarkAmbientSoundtracks/Soundtracks', name: 'cave_01', duration: 40 }).id, 'ambience');
  assert.equal(classifyAudioLoudnessTier({ pack: 'HorrorSoundPack2', relDir: 'Audio/Wav', name: 'stinger_01', duration: 1.2 }).id, 'sfx_combat_light');
  assert.equal(classifyAudioLoudnessTier({ pack: 'Vefects_Water', relDir: 'Audio', name: 'splash_short', duration: 0.8 }).id, 'sfx_foley');
  assert.equal(classifyAudioLoudnessTier({ pack: 'Vefects_Water', relDir: 'Audio', name: 'waterfall_loop', duration: 8.5 }).id, 'ambience');
  assert.equal(Object.keys(AUDIO_LOUDNESS_TIERS).length, 6);

  // 2. Variant relative loudness offsets
  assert.equal(computeVariantLoudnessOffsetDb('sword_slash_light_01'), -3.0);
  assert.equal(computeVariantLoudnessOffsetDb('sword_slash_heavy_02'), 2.0);
  assert.equal(computeVariantLoudnessOffsetDb('gun_shot_distant_03'), -4.0);
  assert.equal(computeVariantLoudnessOffsetDb('explosion_far_light'), -7.0);

  // 3. Gain clamping: +18 dB boost cap and max 4 dB overshoot peak protection
  const cappedBoost = computeSafeShortGainDb({
    targetDb: -14.0,
    variantOffsetDb: 0,
    meanVolumeDb: -50.0,
    maxVolumeDb: -42.0,
    ceilingDb: -1.0,
  });
  assert.equal(cappedBoost.gainDb, 18.0);
  assert.equal(cappedBoost.hitBoostCap, true);

  const peakProtected = computeSafeShortGainDb({
    targetDb: -14.0,
    variantOffsetDb: 0,
    meanVolumeDb: -26.0, // rawGainDb = +12 dB
    maxVolumeDb: -2.0,   // -2 + 12 = +10 dB (> ceiling -1 + 4 = +3 dB!)
    ceilingDb: -1.0,
  });
  assert.equal(peakProtected.peakClamped, true);
  assert.equal(peakProtected.gainDb, 5.0); // (+3) - (-2) = +5 dB

  // 4. Synth calibration (-14 dB baseline + -3 dB harsh square/sawtooth)
  const rawSine = synthesizeSfxPcm({ wave: 'sine', gain: 0.8, noiseMix: 0 }, { sampleRate: 16000, rawUncalibrated: true });
  const calSine = synthesizeSfxPcm({ wave: 'sine', gain: 0.8, noiseMix: 0 }, { sampleRate: 16000 });
  const rawSquare = synthesizeSfxPcm({ wave: 'square', gain: 0.8, noiseMix: 0 }, { sampleRate: 16000, rawUncalibrated: true });
  const calSquare = synthesizeSfxPcm({ wave: 'square', gain: 0.8, noiseMix: 0 }, { sampleRate: 16000 });
  const peakOf = (buf) => { let m = 0; for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i])); return m; };
  assert.ok(Math.abs(20 * Math.log10(peakOf(calSine) / peakOf(rawSine)) - (-14.0)) < 0.05);
  assert.ok(Math.abs(20 * Math.log10(peakOf(calSquare) / peakOf(rawSquare)) - (-17.0)) < 0.05);

  // 5. Runtime 5-bus mixer, cooldownMs=45, maxVoices=4 preemption, ui_voice 2D bypass, gainDb, and ducking
  const { MockAudioContext, created } = createSpatialMockAudioContextClass();
  let mockNowMs = 1000;
  const audio = createAudioManager({ AudioContextClass: MockAudioContext, now: () => mockNowMs });
  await audio.unlock();
  assert.equal(audio.getBusVolume('bgm'), 0.85);
  assert.equal(audio.getBusVolume('ambience'), 0.75);
  assert.equal(audio.getBusVolume('combat'), 1.0);
  assert.equal(audio.getBusVolume('foley'), 0.85);
  assert.equal(audio.getBusVolume('ui_voice'), 1.0);

  const sfxBuf = makeAudioBuffer({ sampleRate: 1000, activeSamples: 200, amplitude: 0.2 });
  audio.registerCue('boss_roar', [sfxBuf], { bus: 'combat', ducking: true, gainDb: 3.0 });

  // Cooldown 45ms blocks burst within 10ms, allows at +50ms
  const r1 = await audio.playCue('boss_roar');
  assert.ok(r1);
  mockNowMs += 10;
  const rBlocked = await audio.playCue('boss_roar');
  assert.equal(rBlocked, null);

  // Advance clock across 5 rapid calls -> maxVoices=4 preempts oldest!
  const handles = [r1];
  for (let i = 0; i < 4; i++) {
    mockNowMs += 60;
    const h = await audio.playCue('boss_roar');
    assert.ok(h);
    handles.push(h);
  }
  assert.ok(created.sources[0].stopCalls.length >= 1, '5th active voice must preempt 1st oldest voice');

  // ui_voice cue bypasses 3D panning cleanly & defaults pitchJitter=0
  audio.registerCue('ui_notify', [sfxBuf], { bus: 'ui_voice', cooldownMs: 0 });
  const prevPanners = created.panners.length;
  const uiHandle = await audio.playCue('ui_notify', { position: [25, 0, 10] });
  assert.equal(created.panners.length, prevPanners, 'ui_voice must stay direct 2D without 3D PannerNode');
  assert.equal(uiHandle.pan, 0);

  const svUi = audio.playSynth('click');
  const svCombat = audio.playSynth('explosion');
  assert.equal(svUi.played, true);
  assert.equal(svCombat.played, true);
  svUi.stop();
  svCombat.stop();
  await audio.dispose();
});
