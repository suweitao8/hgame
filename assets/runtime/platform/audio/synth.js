// Zero-KB procedural WebAudio SFX synthesizer with 15 built-in game-feel presets.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Baseline -14 dB attenuation so procedural synth aligns with -16 LUFS mastered MP3s. */
export const SYNTH_BASE_ATTENUATION_DB = -14;
/** Extra -3 dB attenuation for harmonically dense square / sawtooth waveforms. */
export const SYNTH_HARSH_WAVE_ATTENUATION_DB = -3;
export const SYNTH_BASE_ATTENUATION_LINEAR = Math.pow(10, SYNTH_BASE_ATTENUATION_DB / 20);
export const SYNTH_HARSH_WAVE_FACTOR = Math.pow(10, SYNTH_HARSH_WAVE_ATTENUATION_DB / 20);

/**
 * Returns the output calibration multiplier for a procedural synth waveform.
 * @param {string} [wave='sine']
 * @param {{ rawUncalibrated?: boolean }} [options]
 * @returns {number}
 */
export function getSynthCalibrationGain(wave = 'sine', options = {}) {
  if (options?.rawUncalibrated) return 1;
  const harsh = wave === 'square' || wave === 'sawtooth';
  return SYNTH_BASE_ATTENUATION_LINEAR * (harsh ? SYNTH_HARSH_WAVE_FACTOR : 1);
}

/**
 * Built-in procedural sound presets.
 */
export const SYNTH_PRESETS = Object.freeze({
  hit: Object.freeze({
    wave: 'triangle',
    freqStart: 190,
    freqEnd: 46,
    duration: 0.095,
    gain: 0.65,
    noiseMix: 0.45,
    filterType: 'bandpass',
    filterStartHz: 1100,
    filterEndHz: 320,
    attack: 0.002,
  }),
  slash: Object.freeze({
    wave: 'sine',
    freqStart: 420,
    freqEnd: 150,
    duration: 0.13,
    gain: 0.45,
    noiseMix: 0.85,
    filterType: 'bandpass',
    filterStartHz: 2400,
    filterEndHz: 480,
    attack: 0.004,
  }),
  shoot: Object.freeze({
    wave: 'square',
    freqStart: 560,
    freqEnd: 120,
    duration: 0.11,
    gain: 0.42,
    noiseMix: 0.35,
    filterType: 'lowpass',
    filterStartHz: 3200,
    filterEndHz: 600,
    attack: 0.002,
  }),
  explosion: Object.freeze({
    wave: 'sawtooth',
    freqStart: 115,
    freqEnd: 24,
    duration: 0.42,
    gain: 0.75,
    noiseMix: 0.8,
    filterType: 'lowpass',
    filterStartHz: 1200,
    filterEndHz: 120,
    attack: 0.004,
  }),
  pickup: Object.freeze({
    wave: 'triangle',
    freqStart: 660,
    freqEnd: 990,
    steps: [660, 990],
    duration: 0.14,
    gain: 0.45,
    noiseMix: 0,
    filterType: 'lowpass',
    filterStartHz: 6000,
    filterEndHz: 6000,
    attack: 0.003,
  }),
  powerup: Object.freeze({
    wave: 'triangle',
    freqStart: 440,
    freqEnd: 880,
    steps: [440, 554.37, 659.25, 880],
    duration: 0.32,
    gain: 0.5,
    noiseMix: 0.05,
    filterType: 'lowpass',
    filterStartHz: 7000,
    filterEndHz: 7000,
    attack: 0.005,
  }),
  click: Object.freeze({
    wave: 'sine',
    freqStart: 1150,
    freqEnd: 620,
    duration: 0.032,
    gain: 0.35,
    noiseMix: 0.15,
    filterType: 'highpass',
    filterStartHz: 500,
    filterEndHz: 500,
    attack: 0.001,
  }),
  hurt: Object.freeze({
    wave: 'sawtooth',
    freqStart: 250,
    freqEnd: 70,
    duration: 0.18,
    gain: 0.55,
    noiseMix: 0.4,
    filterType: 'lowpass',
    filterStartHz: 1800,
    filterEndHz: 260,
    attack: 0.002,
  }),
  laser: Object.freeze({
    wave: 'sawtooth',
    freqStart: 940,
    freqEnd: 170,
    duration: 0.16,
    gain: 0.4,
    noiseMix: 0.1,
    filterType: 'bandpass',
    filterStartHz: 2600,
    filterEndHz: 520,
    attack: 0.002,
  }),
  jump: Object.freeze({
    wave: 'sine',
    freqStart: 210,
    freqEnd: 540,
    duration: 0.14,
    gain: 0.45,
    noiseMix: 0,
    filterType: 'lowpass',
    filterStartHz: 4000,
    filterEndHz: 4000,
    attack: 0.004,
  }),
  comboStep: Object.freeze({
    wave: 'triangle',
    freqStart: 523.25,
    freqEnd: 783.99,
    steps: [523.25, 659.25],
    duration: 0.11,
    gain: 0.44,
    noiseMix: 0.02,
    filterType: 'lowpass',
    filterStartHz: 6500,
    filterEndHz: 5200,
    attack: 0.002,
  }),
  textBlip: Object.freeze({
    wave: 'triangle',
    freqStart: 620,
    freqEnd: 540,
    duration: 0.042,
    gain: 0.34,
    noiseMix: 0.04,
    filterType: 'lowpass',
    filterStartHz: 4200,
    filterEndHz: 3200,
    attack: 0.002,
  }),
  microTick: Object.freeze({
    wave: 'sine',
    freqStart: 1420,
    freqEnd: 960,
    duration: 0.022,
    gain: 0.3,
    noiseMix: 0.12,
    filterType: 'highpass',
    filterStartHz: 700,
    filterEndHz: 700,
    attack: 0.001,
  }),
  heartbeat: Object.freeze({
    wave: 'sine',
    freqStart: 72,
    freqEnd: 46,
    steps: [72, 54, 68, 48],
    duration: 0.42,
    gain: 0.72,
    noiseMix: 0.04,
    filterType: 'lowpass',
    filterStartHz: 240,
    filterEndHz: 120,
    attack: 0.01,
  }),
  retroOneUp: Object.freeze({
    wave: 'square',
    freqStart: 329.63,
    freqEnd: 783.99,
    steps: [329.63, 392.0, 659.25, 523.25, 587.33, 783.99],
    duration: 0.42,
    gain: 0.36,
    noiseMix: 0,
    filterType: 'lowpass',
    filterStartHz: 5200,
    filterEndHz: 5200,
    attack: 0.002,
  }),
  retroClear: Object.freeze({
    wave: 'square',
    freqStart: 523.25,
    freqEnd: 1046.5,
    steps: [523.25, 659.25, 783.99, 1046.5],
    duration: 0.48,
    gain: 0.38,
    noiseMix: 0,
    filterType: 'lowpass',
    filterStartHz: 5600,
    filterEndHz: 5600,
    attack: 0.003,
  }),
});

/**
 * Computes a chromatic pitch multiplier for combo chains (`step = 0..16`, 1 semitone per step).
 * @param {number} [step=0]
 * @returns {number}
 */
export function getComboStepPitchFactor(step = 0) {
  const n = clamp(Math.round(Number(step) || 0), 0, 16);
  return Math.pow(2, n / 12);
}

function getVoiceTonePitchFactor(voiceTone) {
  if (voiceTone === 'high') return 1.35;
  if (voiceTone === 'low') return 0.72;
  return 1;
}

export function resolveSynthPreset(presetOrConfig) {
  if (typeof presetOrConfig === 'string') {
    return SYNTH_PRESETS[presetOrConfig] || SYNTH_PRESETS.hit;
  }
  if (presetOrConfig && typeof presetOrConfig === 'object') {
    const base = presetOrConfig.preset ? (SYNTH_PRESETS[presetOrConfig.preset] || SYNTH_PRESETS.hit) : SYNTH_PRESETS.hit;
    return { ...base, ...presetOrConfig };
  }
  return SYNTH_PRESETS.hit;
}

function sampleWave(wave, phase) {
  const p = phase - Math.floor(phase);
  switch (wave) {
    case 'square':
      return p < 0.5 ? 1 : -1;
    case 'sawtooth':
      return p * 2 - 1;
    case 'triangle':
      return 1 - 4 * Math.abs(p - 0.5);
    default:
      return Math.sin(p * Math.PI * 2);
  }
}

/**
 * Pure CPU PCM synthesis for deterministic testing or offline AudioBuffer creation.
 * @param {string|object} presetOrConfig
 * @param {{ sampleRate?: number, pitchFactor?: number, step?: number | null, voiceTone?: 'high' | 'mid' | 'low', volume?: number, seed?: number, rawUncalibrated?: boolean }} [options]
 * @returns {Float32Array}
 */
export function synthesizeSfxPcm(presetOrConfig, {
  sampleRate = 44100,
  pitchFactor = 1,
  step = null,
  voiceTone = 'mid',
  volume = 1,
  seed = 0x13579bdf,
  rawUncalibrated = false,
} = {}) {
  const cfg = resolveSynthPreset(presetOrConfig);
  const sr = Math.max(8000, sampleRate | 0);
  const dur = Math.max(0.01, cfg.duration || 0.1);
  const len = Math.max(1, Math.round(sr * dur));
  const out = new Float32Array(len);

  const stepMult = Number.isFinite(Number(step)) && step !== null ? getComboStepPitchFactor(step) : 1;
  const toneMult = getVoiceTonePitchFactor(voiceTone);
  const pitch = clamp(pitchFactor * stepMult * toneMult, 0.25, 4);
  const calibGain = getSynthCalibrationGain(cfg.wave, { rawUncalibrated });
  const gain = clamp((cfg.gain ?? 0.5) * volume * calibGain, 0, 2);
  const noiseMix = clamp(cfg.noiseMix ?? 0, 0, 1);
  const oscMix = 1 - noiseMix * 0.6;
  const attackSamples = Math.max(1, Math.round(sr * (cfg.attack ?? 0.002)));
  const steps = Array.isArray(cfg.steps) && cfg.steps.length > 0 ? cfg.steps : null;

  let rng = (seed >>> 0) || 1;
  let phase = 0;

  for (let i = 0; i < len; i++) {
    const tNorm = i / len;
    const envAttack = i < attackSamples ? i / attackSamples : 1;
    const envDecay = Math.pow(1 - tNorm, 1.8);
    const env = envAttack * envDecay;

    let freq;
    if (steps) {
      const idx = Math.min(steps.length - 1, Math.floor(tNorm * steps.length));
      freq = steps[idx] * pitch;
    } else {
      const f0 = (cfg.freqStart || 440) * pitch;
      const f1 = (cfg.freqEnd || f0) * pitch;
      freq = f0 * Math.pow(Math.max(1, f1) / Math.max(1, f0), tNorm);
    }

    phase += freq / sr;
    const osc = sampleWave(cfg.wave, phase);

    rng ^= rng << 13;
    rng ^= rng >>> 17;
    rng ^= rng << 5;
    const noise = ((rng >>> 0) / 2147483648) - 1;

    out[i] = clamp((osc * oscMix + noise * noiseMix) * env * gain, -1, 1);
  }
  return out;
}

/**
 * Plays a procedural SFX preset on an active WebAudio context and destination node.
 * @param {AudioContext|null} audioCtx
 * @param {AudioNode|null} destination
 * @param {string|object} presetOrConfig
 * @param {import('../audio.js').SynthPlayOptions} [options]
 */
export function playSynthPresetOnContext(audioCtx, destination, presetOrConfig, options = {}) {
  const cfg = resolveSynthPreset(presetOrConfig);
  const name = typeof presetOrConfig === 'string' ? presetOrConfig : (presetOrConfig?.preset || 'custom');
  const rng = typeof options.random === 'function' ? options.random : Math.random;
  const pitchJitter = clamp(options.pitchJitter ?? 0.08, 0, 0.9);
  const gainJitter = clamp(options.gainJitter ?? 0.05, 0, 0.9);
  const stepMult = Number.isFinite(Number(options.step)) && options.step !== null ? getComboStepPitchFactor(options.step) : 1;
  const toneMult = getVoiceTonePitchFactor(options.voiceTone);
  const pitchBase = clamp((options.playbackRate ?? options.pitch ?? 1) * stepMult * toneMult, 0.25, 4);
  const pitchFactor = pitchBase * (1 + (rng() * 2 - 1) * pitchJitter);
  const gainFactor = clamp((options.volume ?? 1) * (1 - rng() * gainJitter), 0, 2);
  const dur = Math.max(0.015, (options.duration ?? cfg.duration) || 0.1);

  if (!audioCtx || !destination || typeof audioCtx.createOscillator !== 'function') {
    return {
      preset: name,
      pitchFactor,
      duration: dur,
      played: false,
      stop() {},
    };
  }

  const now = audioCtx.currentTime || 0;
  const endTime = now + dur;
  const calibGain = getSynthCalibrationGain(cfg.wave, options);
  const peakGain = clamp((cfg.gain ?? 0.5) * gainFactor * calibGain, 0.0005, 1.5);

  const envGain = audioCtx.createGain();
  envGain.gain.setValueAtTime(0.0001, now);
  envGain.gain.linearRampToValueAtTime(peakGain, now + Math.max(0.001, cfg.attack ?? 0.002));
  envGain.gain.exponentialRampToValueAtTime(0.0001, endTime);

  let outNode = envGain;
  let filterNode = null;
  if (typeof audioCtx.createBiquadFilter === 'function' && cfg.filterType) {
    const filter = audioCtx.createBiquadFilter();
    filter.type = cfg.filterType;
    const f0 = clamp((cfg.filterStartHz ?? 2000) * pitchFactor, 40, 20000);
    const f1 = clamp((cfg.filterEndHz ?? f0) * pitchFactor, 40, 20000);
    filter.frequency.setValueAtTime(f0, now);
    if (Math.abs(f1 - f0) > 1) {
      filter.frequency.exponentialRampToValueAtTime(f1, endTime);
    }
    envGain.connect(filter);
    outNode = filter; filterNode = filter;
  }
  outNode.connect(destination);

  const osc = audioCtx.createOscillator();
  osc.type = cfg.wave || 'sine';
  const steps = Array.isArray(cfg.steps) && cfg.steps.length > 0 ? cfg.steps : null;
  if (steps) {
    const stepDur = dur / steps.length;
    for (let i = 0; i < steps.length; i++) {
      osc.frequency.setValueAtTime(clamp(steps[i] * pitchFactor, 20, 20000), now + i * stepDur);
    }
  } else {
    const f0 = clamp((cfg.freqStart || 440) * pitchFactor, 20, 20000);
    const f1 = clamp((cfg.freqEnd || f0) * pitchFactor, 20, 20000);
    osc.frequency.setValueAtTime(f0, now);
    if (Math.abs(f1 - f0) > 1) {
      osc.frequency.exponentialRampToValueAtTime(f1, endTime);
    }
  }

  const oscGain = audioCtx.createGain();
  const noiseMix = clamp(cfg.noiseMix ?? 0, 0, 1);
  oscGain.gain.setValueAtTime(1 - noiseMix * 0.6, now);
  osc.connect(oscGain);
  oscGain.connect(envGain);
  osc.start(now);
  osc.stop(endTime + 0.01);

  let noiseSrc = null, noiseGain = null;
  if (noiseMix > 0.01 && typeof audioCtx.createBuffer === 'function' && typeof audioCtx.createBufferSource === 'function') {
    if (!audioCtx.__hgameSynthNoiseBuf) {
      const sr = audioCtx.sampleRate || 44100;
      const buf = audioCtx.createBuffer(1, sr, sr);
      const ch = buf.getChannelData(0);
      let s = 0x2468ace1;
      for (let i = 0; i < ch.length; i++) {
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
        ch[i] = ((s >>> 0) / 2147483648) - 1;
      }
      audioCtx.__hgameSynthNoiseBuf = buf;
    }
    noiseSrc = audioCtx.createBufferSource();
    noiseSrc.buffer = audioCtx.__hgameSynthNoiseBuf;
    const nGain = audioCtx.createGain();
    noiseGain = nGain;
    nGain.gain.setValueAtTime(noiseMix, now);
    noiseSrc.connect(nGain);
    nGain.connect(envGain);
    noiseSrc.start(now);
    noiseSrc.stop(endTime + 0.01);
  }

  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    for (const node of [osc, oscGain, noiseSrc, noiseGain, envGain, filterNode]) {
      try { node?.disconnect?.(); } catch { /* A closed context may have already disconnected the node. */ }
    }
    if (typeof options.onEnded === 'function') options.onEnded();
  };
  if (typeof osc.addEventListener === 'function') osc.addEventListener('ended', finish, { once: true });
  else osc.onended = finish;

  return {
    preset: name,
    pitchFactor,
    duration: dur,
    played: true,
    stop() {
      try { osc.stop(); } catch {}
      try { noiseSrc?.stop?.(); } catch {}
      finish();
    },
  };
}

/**
 * Standalone zero-asset procedural WebAudio SFX synthesizer with headless fallback.
 * @param {{ AudioContextClass?: typeof AudioContext, context?: AudioContext, destination?: AudioNode, volume?: number, pitchJitter?: number, gainJitter?: number, random?: () => number }} [options]
 */
export function createSynthSfx({
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  context = null,
  destination = null,
  volume = 0.8,
  pitchJitter = 0.08,
  gainJitter = 0.05,
  random = Math.random,
} = {}) {
  let ctx = context;
  let master = destination;
  let currentVolume = clamp(volume, 0, 1);
  let muted = false;
  let disposed = false;

  function ensureContext() {
    if (disposed) return null;
    if (!ctx && typeof AudioContextClass === 'function') {
      ctx = new AudioContextClass();
    }
    if (ctx && !master && typeof ctx.createGain === 'function') {
      master = ctx.createGain();
      master.gain.value = muted ? 0 : currentVolume;
      master.connect(ctx.destination);
    }
    return ctx;
  }

  function unlock() {
    const c = ensureContext();
    if (!c) return Promise.resolve(false);
    if ((c.state === 'suspended' || c.state === 'interrupted') && typeof c.resume === 'function') {
      return c.resume().then(() => true).catch(() => false);
    }
    return Promise.resolve(true);
  }

  function play(presetOrConfig, overrides = {}) {
    if (disposed || muted) {
      return {
        preset: typeof presetOrConfig === 'string' ? presetOrConfig : 'custom',
        pitchFactor: 1,
        duration: 0,
        played: false,
        stop() {},
      };
    }
    const c = ensureContext();
    return playSynthPresetOnContext(c, master, presetOrConfig, {
      pitchJitter,
      gainJitter,
      random,
      ...overrides,
    });
  }

  function setVolume(v) {
    currentVolume = clamp(v, 0, 1);
    if (master && !muted) master.gain.value = currentVolume;
  }

  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    if (master) master.gain.value = muted ? 0 : currentVolume;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (!context && ctx && typeof ctx.close === 'function') {
      ctx.close();
    }
    ctx = null;
    master = null;
  }

  return Object.freeze({
    get available() { return Boolean(context || typeof AudioContextClass === 'function'); },
    get volume() { return currentVolume; },
    get muted() { return muted; },
    presets: SYNTH_PRESETS,
    unlock,
    play,
    renderPcm: synthesizeSfxPcm,
    setVolume,
    setMuted,
    dispose,
  });
}
