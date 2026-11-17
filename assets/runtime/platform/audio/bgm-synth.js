// Zero-KB procedural adaptive WebAudio BGM step sequencer.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Built-in musical mood presets for adaptive dynamic BGM. */
export const BGM_MOODS = Object.freeze({
  dungeon: Object.freeze({
    bpm: 108,
    rootMidi: 45, // A2
    scale: Object.freeze([0, 2, 3, 5, 7, 8, 10]),
    chords: Object.freeze([0, 5, 3, 4]),
    bassWave: 'triangle',
    leadWave: 'sine',
    leadCutoffHz: 1400,
    arpSteps: Object.freeze([0, 2, 4, 7, 4, 2, 5, 4]),
  }),
  cyber: Object.freeze({
    bpm: 128,
    rootMidi: 40, // E2
    scale: Object.freeze([0, 2, 3, 5, 7, 10]),
    chords: Object.freeze([0, 0, 3, 4]),
    bassWave: 'sawtooth',
    leadWave: 'square',
    leadCutoffHz: 2400,
    arpSteps: Object.freeze([0, 7, 12, 7, 3, 7, 10, 7]),
  }),
  boss: Object.freeze({
    bpm: 152,
    rootMidi: 38, // D2 Phrygian-like drive
    scale: Object.freeze([0, 1, 3, 5, 7, 8, 10]),
    chords: Object.freeze([0, 1, 0, 5]),
    bassWave: 'sawtooth',
    leadWave: 'sawtooth',
    leadCutoffHz: 3000,
    arpSteps: Object.freeze([0, 7, 12, 8, 7, 5, 3, 1]),
  }),
  chill: Object.freeze({
    bpm: 88,
    rootMidi: 48, // C3 major pentatonic/ionian
    scale: Object.freeze([0, 2, 4, 7, 9, 11]),
    chords: Object.freeze([0, 4, 3, 2]),
    bassWave: 'sine',
    leadWave: 'triangle',
    leadCutoffHz: 1100,
    arpSteps: Object.freeze([0, 4, 7, 11, 7, 4, 2, 4]),
  }),
  adventure: Object.freeze({
    bpm: 120,
    rootMidi: 43, // G2
    scale: Object.freeze([0, 2, 4, 5, 7, 9, 11]),
    chords: Object.freeze([0, 4, 5, 3]),
    bassWave: 'triangle',
    leadWave: 'triangle',
    leadCutoffHz: 1900,
    arpSteps: Object.freeze([0, 2, 4, 7, 9, 7, 4, 2]),
  }),
  victory: Object.freeze({
    bpm: 132,
    rootMidi: 48, // C3
    scale: Object.freeze([0, 2, 4, 5, 7, 9, 11]),
    chords: Object.freeze([0, 3, 4, 0]),
    bassWave: 'triangle',
    leadWave: 'square',
    leadCutoffHz: 2600,
    arpSteps: Object.freeze([0, 4, 7, 12, 16, 12, 7, 4]),
  }),
});

/** Converts a MIDI note number to frequency in Hz (A4 = 69 = 440 Hz). */
export function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Computes one 16th-note musical step deterministically from mood, step index, and combat intensity.
 * @param {string} [mood='adventure']
 * @param {number} [stepIndex=0]
 * @param {number} [intensity=0.5]
 * @param {number} [bpmOverride]
 */
export function generateBgmStep(mood = 'adventure', stepIndex = 0, intensity = 0.5, bpmOverride) {
  const m = BGM_MOODS[mood] ?? BGM_MOODS.adventure;
  const clampedIntensity = clamp(Number(intensity) || 0, 0, 1);
  const step = Math.max(0, Math.floor(stepIndex));
  const bar = Math.floor(step / 16);
  const sub = step % 16;
  const scale = m.scale;
  const chordDeg = m.chords[bar % m.chords.length];
  const chordRootOffset = scale[chordDeg % scale.length];

  const bpm = clamp(Number.isFinite(bpmOverride) ? bpmOverride : m.bpm, 40, 240);
  const stepDuration = 60 / bpm / 4; // 16th note seconds

  // Bass plays downbeats + syncopated drive when intensity >= 0.35.
  let bassHz = 0;
  if (sub % 4 === 0 || (clampedIntensity >= 0.35 && sub % 2 === 0 && (sub === 6 || sub === 14))) {
    const octaveBoost = clampedIntensity >= 0.7 && sub % 4 === 2 ? 12 : 0;
    bassHz = midiToHz(m.rootMidi + chordRootOffset + octaveBoost);
  }

  // Lead / arpeggio layer density scales with intensity.
  let leadHz = 0;
  const playLead = clampedIntensity >= 0.65
    ? sub % 2 === 0
    : clampedIntensity >= 0.25
      ? sub % 4 === 0
      : sub % 8 === 0;
  if (playLead) {
    const arpInterval = m.arpSteps[(sub + bar) % m.arpSteps.length];
    leadHz = midiToHz(m.rootMidi + 12 + chordRootOffset + arpInterval);
  }

  // Percussion layer unlocks progressively with intensity.
  /** @type {'kick' | 'snare' | 'hat' | null} */
  let drum = null;
  if (clampedIntensity >= 0.2 && sub % 8 === 0) {
    drum = 'kick';
  } else if (clampedIntensity >= 0.5 && (sub === 4 || sub === 12)) {
    drum = 'snare';
  } else if (clampedIntensity >= 0.75 && sub % 2 === 1) {
    drum = 'hat';
  }

  return {
    step,
    bar,
    sub,
    mood: BGM_MOODS[mood] ? mood : 'adventure',
    intensity: clampedIntensity,
    bpm,
    stepDuration,
    bassHz,
    leadHz,
    drum,
    bassWave: m.bassWave,
    leadWave: m.leadWave,
    leadCutoffHz: m.leadCutoffHz,
  };
}

function triggerTone(audioCtx, dest, wave, freqHz, cutoffHz, gainPeak, duration, time) {
  if (!audioCtx || !dest || typeof audioCtx.createOscillator !== 'function' || freqHz <= 0) return;
  const osc = audioCtx.createOscillator();
  const env = audioCtx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freqHz, time);

  env.gain.setValueAtTime(0.0001, time);
  env.gain.linearRampToValueAtTime(gainPeak, time + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, time + duration);

  let tail = env;
  if (typeof audioCtx.createBiquadFilter === 'function' && cutoffHz > 0) {
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(clamp(cutoffHz, 80, 18000), time);
    env.connect(filter);
    tail = filter;
  }
  osc.connect(env);
  tail.connect(dest);
  osc.start(time);
  osc.stop(time + duration + 0.01);
}

function triggerPercussion(audioCtx, dest, drumKind, gainScale, time) {
  if (!audioCtx || !dest || typeof audioCtx.createOscillator !== 'function' || !drumKind) return;
  if (drumKind === 'kick') {
    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.11);
    env.gain.setValueAtTime(0.32 * gainScale, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
    osc.connect(env);
    env.connect(dest);
    osc.start(time);
    osc.stop(time + 0.13);
  } else {
    const dur = drumKind === 'snare' ? 0.08 : 0.03;
    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(drumKind === 'snare' ? 240 : 1200, time);
    env.gain.setValueAtTime((drumKind === 'snare' ? 0.12 : 0.07) * gainScale, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(env);
    env.connect(dest);
    osc.start(time);
    osc.stop(time + dur + 0.01);
  }
}

/**
 * @typedef {object} ProceduralBgmOptions
 * @property {(new () => AudioContext) | undefined} [AudioContextClass]
 * @property {AudioContext | null} [context=null]
 * @property {AudioNode | null} [destination=null]
 * @property {(() => {context: AudioContext | null, destination: AudioNode | null} | null) | null} [resolveAudio=null] Lazily acquire a shared context and destination.
 * @property {keyof typeof BGM_MOODS | string} [mood='adventure']
 * @property {number} [intensity=0.5]
 * @property {number} [bpm]
 * @property {number} [volume=0.45]
 * @property {boolean} [autoSchedule=true]
 */

/**
 * Creates a zero-KB procedural adaptive BGM synthesizer that dynamically responds
 * to `setMood(...)` and `setIntensity(0..1)` without any external audio files.
 * Works cleanly in both browser WebAudio and headless Node tests.
 * @param {ProceduralBgmOptions} [options={}]
 */
export function createProceduralBgm(options = {}) {
  const Ctor = options.AudioContextClass ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
  let ctx = options.context ?? null;
  let destination = options.destination ?? null;
  let master = null;
  let ownsCtx = false;

  let mood = BGM_MOODS[options.mood] ? options.mood : 'adventure';
  let intensity = clamp(options.intensity ?? 0.5, 0, 1);
  let bpmOverride = Number.isFinite(options.bpm) ? options.bpm : undefined;
  let volume = clamp(options.volume ?? 0.45, 0, 1);
  let muted = false;
  let playing = false;
  let paused = false;
  let disposed = false;
  let stepIndex = 0;
  let accumSec = 0;
  let timerId = null;

  function ensureContext() {
    if (ctx && master) return ctx;
    if (!ctx && typeof options.resolveAudio === 'function') {
      const shared = options.resolveAudio();
      ctx = shared?.context ?? null;
      destination ??= shared?.destination ?? null;
    }
    if (!ctx && typeof Ctor === 'function') {
      ctx = new Ctor();
      ownsCtx = true;
    }
    if (ctx && !master && typeof ctx.createGain === 'function') {
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(destination ?? ctx.destination);
    }
    return ctx;
  }

  function applyGain() {
    if (master?.gain) {
      master.gain.value = muted || paused || !playing ? 0 : volume;
    }
  }

  function renderStep(stepInfo, audioTime) {
    if (muted || volume <= 0) return stepInfo;
    if (ctx && master) {
      const volScale = 0.75 + intensity * 0.25;
      if (stepInfo.bassHz > 0) {
        triggerTone(
          ctx,
          master,
          stepInfo.bassWave,
          stepInfo.bassHz,
          stepInfo.leadCutoffHz * 0.6,
          0.26 * volScale,
          stepInfo.stepDuration * 0.9,
          audioTime,
        );
      }
      if (stepInfo.leadHz > 0) {
        triggerTone(
          ctx,
          master,
          stepInfo.leadWave,
          stepInfo.leadHz,
          stepInfo.leadCutoffHz * (0.6 + intensity * 0.6),
          0.14 * volScale,
          stepInfo.stepDuration * 1.35,
          audioTime,
        );
      }
      if (stepInfo.drum) {
        triggerPercussion(ctx, master, stepInfo.drum, volScale, audioTime);
      }
    }
    return stepInfo;
  }

  function advanceStep(audioTime) {
    const info = generateBgmStep(mood, stepIndex++, intensity, bpmOverride);
    return renderStep(info, audioTime);
  }

  function clearScheduler() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function startScheduler() {
    if (options.autoSchedule === false || timerId !== null || typeof setInterval !== 'function' || !ctx || !playing || paused) return;
    const tickMs = Math.max(20, Math.round(generateBgmStep(mood, 0, intensity, bpmOverride).stepDuration * 1000));
    timerId = setInterval(() => {
      if (playing && !paused) advanceStep(ctx.currentTime || 0);
    }, tickMs);
    timerId.unref?.();
  }

  function start(startOpts = {}) {
    if (disposed) throw new Error('BGM controller is disposed');
    if (startOpts.mood) setMood(startOpts.mood);
    if (startOpts.intensity !== undefined) setIntensity(startOpts.intensity);
    ensureContext();
    if (ctx?.state === 'suspended') ctx.resume?.().catch?.(() => {});
    playing = true;
    paused = false;
    applyGain();
    startScheduler();
    return getState();
  }

  function stop() {
    playing = false;
    paused = false;
    stepIndex = 0;
    accumSec = 0;
    clearScheduler();
    applyGain();
  }

  function pause() {
    if (!playing) return;
    paused = true;
    clearScheduler();
    applyGain();
  }

  function resume() {
    if (disposed) throw new Error('BGM controller is disposed');
    if (!playing) return start();
    paused = false;
    if (ctx?.state === 'suspended') ctx.resume?.().catch?.(() => {});
    applyGain();
    startScheduler();
  }

  /**
   * Manually advances internal clock by `dt` seconds (ideal for deterministic fixed-step games and tests).
   * @param {number} dt
   */
  function update(dt) {
    if (!playing || paused) return [];
    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    accumSec += safeDt;
    const triggered = [];
    let guard = 0;
    while (guard < 32) {
      const nextDur = generateBgmStep(mood, stepIndex, intensity, bpmOverride).stepDuration;
      if (accumSec < nextDur) break;
      accumSec -= nextDur;
      triggered.push(advanceStep(ctx?.currentTime || 0));
      guard++;
    }
    return triggered;
  }

  function setMood(nextMood) {
    if (!BGM_MOODS[nextMood]) throw new Error(`Unknown BGM mood "${nextMood}".`);
    const previousBpm = Number.isFinite(bpmOverride) ? bpmOverride : BGM_MOODS[mood].bpm;
    mood = nextMood;
    const nextBpm = Number.isFinite(bpmOverride) ? bpmOverride : BGM_MOODS[mood].bpm;
    if (playing && !paused && previousBpm !== nextBpm) { clearScheduler(); startScheduler(); }
  }

  function setIntensity(nextIntensity) {
    intensity = clamp(Number(nextIntensity) || 0, 0, 1);
  }

  function setVolume(v) {
    volume = clamp(Number(v) || 0, 0, 1);
    applyGain();
  }

  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    applyGain();
  }

  function getState() {
    return {
      mood,
      intensity,
      bpm: Number.isFinite(bpmOverride) ? bpmOverride : BGM_MOODS[mood].bpm,
      volume,
      muted,
      playing,
      paused,
      stepIndex,
      available: Boolean(ctx || typeof Ctor === 'function'),
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    try { master?.disconnect?.(); } catch { /* The context may already be closed. */ }
    if (ownsCtx) ctx?.close?.().catch?.(() => {});
    ctx = null;
    master = null;
    destination = null;
  }

  return Object.freeze({
    start,
    stop,
    pause,
    resume,
    update,
    setMood,
    setIntensity,
    setVolume,
    setMuted,
    getState,
    dispose,
  });
}
