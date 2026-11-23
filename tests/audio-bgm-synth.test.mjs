import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HGame,
  BGM_MOODS,
  midiToHz,
  generateBgmStep,
  createProceduralBgm,
  createAudioManager,
} from '../assets/runtime/index.js';

function createFakeAudioContext() {
  const created = { oscs: 0, gains: 0, filters: 0 };
  return {
    created,
    Context: class FakeAudioContext {
      constructor() {
        this.currentTime = 0;
        this.state = 'running';
        this.destination = { connect() {} };
      }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createGain() {
        created.gains++;
        return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
      }
      createDynamicsCompressor() {
        return { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }, connect() {} };
      }
      createBiquadFilter() {
        created.filters++;
        return { type: 'lowpass', frequency: { value: 1000, setValueAtTime() {} }, connect() {} };
      }
      createOscillator() {
        created.oscs++;
        return { type: 'sine', frequency: { value: 440, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} };
      }
    },
  };
}

test('BGM_MOODS, midiToHz, and generateBgmStep produce deterministic intensity-scaled musical patterns', () => {
  assert.equal(typeof HGame.createProceduralBgm, 'function');
  assert.ok(Math.abs(midiToHz(69) - 440) < 1e-6);
  assert.deepEqual(Object.keys(BGM_MOODS), ['dungeon', 'cyber', 'boss', 'chill', 'adventure', 'victory']);

  const calm = generateBgmStep('dungeon', 0, 0.1);
  const intense = generateBgmStep('boss', 5, 0.9);
  assert.equal(calm.drum, null);
  assert.ok(calm.bassHz > 0);
  assert.equal(intense.drum, 'hat');
  assert.equal(intense.bpm, BGM_MOODS.boss.bpm);
});

test('createProceduralBgm runs headlessly and drives WebAudio nodes cleanly on mood/intensity shifts', () => {
  const { created, Context } = createFakeAudioContext();
  const bgm = createProceduralBgm({
    AudioContextClass: Context,
    mood: 'chill',
    intensity: 0.1,
    autoSchedule: false,
  });
  bgm.start();
  const lowSteps = bgm.update(0.8);
  assert.ok(lowSteps.length >= 4);
  const oscAfterLow = created.oscs;
  assert.ok(oscAfterLow > 0);

  bgm.setMood('boss');
  bgm.setIntensity(0.95);
  const highSteps = bgm.update(0.8);
  assert.ok(highSteps.some((s) => s.drum === 'kick' || s.drum === 'snare' || s.drum === 'hat'));
  assert.ok(created.oscs > oscAfterLow);

  bgm.pause();
  assert.deepEqual(bgm.update(0.5), []);
  bgm.resume();
  assert.ok(bgm.update(0.25).length >= 1);

  bgm.dispose();
  assert.equal(bgm.getState().playing, false);
});

test('createAudioManager.createBgm integrates with audio manager and disposes cleanly', () => {
  const audio = createAudioManager({ AudioContextClass: undefined });
  const bgm = audio.createBgm({ mood: 'adventure', intensity: 0.6, autoSchedule: false });
  bgm.start();
  const steps = bgm.update(0.5);
  assert.ok(steps.length >= 2);
  audio.dispose();
  assert.equal(bgm.getState().playing, false);
});
