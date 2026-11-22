import {
  clamp,
  normalizeVec3,
  applyListenerOrientation,
} from './audio/helpers.js';
import { analyzeAudioBuffer } from './audio/analysis.js';
import { normalizeVariantSet } from './audio/variants.js';
import { createAudioBusController } from './audio/buses.js';
import { playAudioBuffer } from './audio/voice.js';
import {
  SYNTH_PRESETS,
  SYNTH_BASE_ATTENUATION_DB,
  SYNTH_HARSH_WAVE_ATTENUATION_DB,
  getSynthCalibrationGain,
  synthesizeSfxPcm,
  playSynthPresetOnContext,
  createSynthSfx,
} from './audio/synth.js';
import {
  BGM_MOODS,
  midiToHz,
  generateBgmStep,
  createProceduralBgm,
} from './audio/bgm-synth.js';

export {
  analyzeAudioBuffer,
  normalizeVariantSet,
  SYNTH_PRESETS,
  SYNTH_BASE_ATTENUATION_DB,
  SYNTH_HARSH_WAVE_ATTENUATION_DB,
  getSynthCalibrationGain,
  synthesizeSfxPcm,
  createSynthSfx,
  BGM_MOODS,
  midiToHz,
  generateBgmStep,
  createProceduralBgm,
};

/**
 * @typedef {import('./audio/helpers.js').AudioListenerState} AudioListenerState
 * @typedef {import('./audio/helpers.js').AudioPosition3D} AudioPosition3D
 * @typedef {import('./audio/helpers.js').AudioPosition2D} AudioPosition2D
 */

/**
 * @typedef {object} AudioManagerOptions
 * @property {(new () => AudioContext) | undefined} [AudioContextClass] Default `AudioContext` / `webkitAudioContext`.
 * @property {number} [volume=1] Master volume, 0..1.
 * @property {number} [maxPolyphony=24] Max simultaneous voices (positive integer).
 * @property {boolean} [compressor=true] Insert a master dynamics limiter.
 * @property {() => number} [now] Clock for cooldowns, milliseconds (default `performance.now`).
 */

/**
 * @typedef {object} SpatialMetrics
 * @property {'3d' | '2d' | 'pan' | 'none'} kind
 * @property {{ x: number, y: number, z: number }} [pos3] Present for `'3d'`.
 * @property {{ x: number, y: number }} [pos2] Present for `'2d'`.
 * @property {number} pan -1 (left) .. 1 (right).
 * @property {number} distanceGain 0..1 attenuation.
 */

/**
 * @typedef {number | { occlusion?: number, lowPassHz?: number, gainScale?: number }} OcclusionResult
 *   Occlusion 0 (open) .. 1 (blocked), or a detailed override (Hz / gain scale 0..1).
 */

/**
 * @callback OcclusionProbe
 * @param {{ x: number, y: number, z?: number }} sourcePosition
 * @param {AudioListenerState} listener
 * @param {{ bus: string, spatial: SpatialMetrics }} info
 * @returns {OcclusionResult | void}
 */

/**
 * @typedef {object} AudioPlayOptions
 * @property {number} [volume=1] Voice gain, 0..2.
 * @property {boolean} [loop=false]
 * @property {number} [playbackRate=1] 0.05..4.
 * @property {number} [pitchJitter=0] Random playback-rate variation (ratio, 0..1).
 * @property {number} [gainJitter=0] Random gain reduction (ratio, 0..1).
 * @property {number} [gainJitterDb=0] Symmetric random gain jitter (+/- dB).
 * @property {number} [cooldownMs=0] Minimum interval between plays of the same `key` / buffer, milliseconds.
 * @property {string | null} [key=null] Cooldown key.
 * @property {string | null} [bus=null] Bus name (default `'spatial'` when positioned, else `'sfx'`).
 * @property {number | null} [pan=null] Stereo pan, -1..1 (when no position).
 * @property {AudioPosition3D | null} [position=null] 3D source position, world units (HRTF panner).
 * @property {AudioPosition2D | null} [position2D=null] 2D source position (stereo pan by `panRange`).
 * @property {boolean} [hrtf=true] Use HRTF panning for 3D sources.
 * @property {DistanceModelType} [distanceModel='inverse']
 * @property {number} [refDistance=3] World units.
 * @property {number} [maxDistance=400] World units.
 * @property {number} [rolloffFactor=0.8]
 * @property {number} [panRange=480] Horizontal distance (pixels / world units) that maps to full pan for 2D sources.
 * @property {boolean} [trimSilence=true] Skip encoder padding / trailing silence.
 * @property {number | null} [offset=null] Start offset, seconds.
 * @property {number | null} [duration=null] Play duration, seconds.
 * @property {number} [tailFadeSec=0] Fade-out length at the trimmed tail, seconds.
 * @property {number | null} [occlusion=null] Fixed occlusion 0..1 (default: evaluated via the occlusion probe).
 * @property {number} [occludedLowPassHz=550] Low-pass cutoff when fully occluded, Hz.
 * @property {number} [occludedGainScale=0.45] Gain scale when fully occluded, 0..1.
 * @property {number} [openLowPassHz=22000] Low-pass cutoff when unoccluded, Hz.
 * @property {((voice: AudioVoice) => void) | null} [onEnded=null]
 * @property {() => number} [random=Math.random] RNG returning 0..1 (for deterministic jitter).
 * @property {{ vx?: number, vy?: number, vz?: number, x?: number, y?: number, z?: number } | null} [velocity=null]
 * @property {number} [speedOfSound=343]
 */

/**
 * @typedef {object} AudioVoice Handle to a playing sound.
 * @property {boolean} loop
 * @property {number} playbackRate Current rate.
 * @property {string} bus Bus the voice is routed to.
 * @property {number} variant Cue variant index (-1 when not played via a cue).
 * @property {number} pan Current pan, -1..1.
 * @property {number} distanceGain 0..1.
 * @property {number} occlusion 0..1.
 * @property {number} lowPassHz Current occlusion low-pass, Hz.
 * @property {(position: AudioPosition3D | AudioPosition2D) => AudioVoice} setPosition Move the source.
 * @property {(value: number, options?: { smoothSeconds?: number, lowPassHz?: number | null, gainScale?: number | null }) => AudioVoice} setOcclusion
 *   Set fixed occlusion 0..1 (disables the probe for this voice); smoothing in seconds.
 * @property {(options?: { smoothSeconds?: number }) => number} refreshOcclusion Re-run the probe; returns occlusion 0..1.
 * @property {(volume: number) => AudioVoice} setVolume Voice gain 0..2.
 * @property {(rate: number) => AudioVoice} setPlaybackRate 0.05..4.
 * @property {(options?: { fadeOutMs?: number }) => void} stop Stop, optionally fading out (milliseconds).
 */

/**
 * @typedef {object} AudioCueConfig
 * @property {readonly AudioBuffer[]} variants 1-4 decoded buffers.
 * @property {string | null} [bus=null]
 * @property {number} [volume=1]
 * @property {number} [gainDb=0] Post-normalization hot-patch gain offset, dB.
 * @property {number} [pitchJitter=0.04]
 * @property {number} [gainJitter=0]
 * @property {number} [gainJitterDb=0.8] Micro-randomization in dB (+/-).
 * @property {number} [cooldownMs=45] Milliseconds.
 * @property {number} [maxVoices=4] Max simultaneous voices of this cue.
 * @property {number} [maxConcurrent=4] Alias of maxVoices.
 * @property {boolean} [ducking=false] Smoothly duck bgm and ambience buses by -5 dB on play.
 * @property {boolean} [hrtf=true]
 * @property {number} [refDistance=3]
 * @property {number} [maxDistance=400]
 * @property {number} [rolloffFactor=0.8]
 * @property {number} [panRange=480]
 * @property {boolean} [trimSilence=true]
 * @property {number} [silenceThreshold=0.0035]
 * @property {boolean} [normalizeRms=true]
 * @property {number} [maxDurationSpreadRatio=0.28]
 * @property {boolean} [alignDuration=true]
 */

/**
 * @typedef {Omit<AudioPlayOptions, 'loop' | 'offset' | 'duration' | 'tailFadeSec' | 'onEnded'> & {
 *   loop?: boolean,
 *   variant?: number,
 * }} AudioCueOverrides Per-call overrides for {@link AudioManager#playCue}; `variant` forces a variant index.
 */

/**
 * @typedef {object} AudioCueVariantInfo
 * @property {number} index
 * @property {number} duration Seconds.
 * @property {number} activeDuration Seconds.
 * @property {number} playDuration Seconds.
 * @property {number} gainScale
 * @property {number} deviationRatio
 * @property {boolean} consistent
 */

/**
 * @typedef {object} AudioCueInspection
 * @property {string} name
 * @property {string | null} bus
 * @property {number} variantCount
 * @property {number} medianDuration Seconds.
 * @property {number} medianRms
 * @property {number} durationSpreadRatio
 * @property {boolean} allConsistent
 * @property {readonly Readonly<AudioCueVariantInfo>[]} variants
 */

/**
 * @typedef {object} AudioBusMix
 * @property {number} [volume] Absolute bus gain, 0..1.5.
 * @property {number} [gainScale] Multiplier applied to the user bus volume.
 * @property {number} [lowPassHz] Low-pass cutoff, Hz (60..22000).
 * @property {number} [filterHz] Alias of `lowPassHz`.
 */

/**
 * @typedef {object} AudioSnapshotConfig Mix snapshot (e.g. paused / underwater).
 * @property {string} [name]
 * @property {Record<string, AudioBusMix>} [buses]
 * @property {number | null} [defaultLowPassHz] Cutoff for buses without an override, Hz.
 * @property {number} [transitionSeconds=0.2] Cross-fade time, seconds.
 */

/**
 * @typedef {object} AudioSnapshot
 * @property {string} name
 * @property {Record<string, AudioBusMix>} buses
 * @property {number | null} defaultLowPassHz
 * @property {number} transitionSeconds
 */

/**
 * @typedef {Partial<AudioListenerState> & { vx?: number, vy?: number, vz?: number }} AudioListenerUpdate
 */

/**
 * @typedef {{ matrixWorld?: { elements: ArrayLike<number> }, x?: number, y?: number, z?: number, offsetX?: number, offsetY?: number }} AudioListenerCamera
 *   A Three.js-style camera (`matrixWorld`) or a 2D camera (`x`, `y`, optional offsets in pixels).
 */

/**
 * @typedef {object} AudioManager Web Audio facade: buses, cues, spatialization, snapshots.
 * @property {number} volume Master volume 0..1.
 * @property {boolean} muted
 * @property {number} activeCount Playing voices.
 * @property {boolean} available True when an AudioContext class exists.
 * @property {AudioListenerState} listener Snapshot copy.
 * @property {string | null} activeSnapshot Name of the active mix snapshot.
 * @property {() => Promise<AudioContext>} unlock Create / resume the context (call from a user gesture).
 * @property {(data: ArrayBuffer) => Promise<AudioBuffer>} decode
 * @property {(buffer: AudioBuffer, options?: AudioPlayOptions) => Promise<AudioVoice | null>} play Resolves null when muted, throttled or no slot is free.
 * @property {(presetOrConfig: string | object, options?: SynthPlayOptions) => SynthVoice} playSynth Play a synthesized sound through the shared mixer and voice budget.
 * @property {(options?: import('./audio/bgm-synth.js').ProceduralBgmOptions) => ReturnType<typeof createProceduralBgm>} createBgm Create a procedural music controller.
 * @property {(name: string, variantsOrConfig: readonly AudioBuffer[] | AudioCueConfig, extraOptions?: Omit<AudioCueConfig, 'variants'>) => AudioCueInspection} registerCue
 * @property {(name: string, overrides?: AudioCueOverrides) => Promise<AudioVoice | null>} playCue
 * @property {(name: string) => AudioCueInspection | null} inspectCue
 * @property {(name: string) => boolean} hasCue
 * @property {(value: number) => number} setVolume Returns the clamped value.
 * @property {(muted: boolean) => boolean} setMuted
 * @property {(bus: string, value: number) => number} setBusVolume Gain 0..1.5; returns the clamped value.
 * @property {(bus: string) => number} getBusVolume
 * @property {(bus: string, cfg?: { lowGainDb?: number, midGainDb?: number, highGainDb?: number, lowFreq?: number, midFreq?: number, highFreq?: number }) => { lowGainDb: number, midGainDb: number, highGainDb: number, lowFreq: number, midFreq: number, highFreq: number }} setBusEq
 * @property {(bus: string) => { lowGainDb: number, midGainDb: number, highGainDb: number, lowFreq: number, midFreq: number, highFreq: number }} getBusEq
 * @property {(bus: string, factor?: number, durationMs?: number) => boolean} duckBus Temporarily scale a bus (factor 0..1, default 0.55; milliseconds, default 250).
 * @property {(name: string, config?: AudioSnapshotConfig) => AudioSnapshot} registerSnapshot
 * @property {(nameOrConfig: string | AudioSnapshotConfig, options?: { transitionSeconds?: number | null }) => string} applySnapshot Returns the snapshot name.
 * @property {(options?: { transitionSeconds?: number }) => boolean} clearSnapshot
 * @property {(probe: OcclusionProbe | null | undefined) => void} setOcclusionProbe
 * @property {() => void} updateOcclusion Refresh occlusion of all active voices.
 * @property {((next?: AudioListenerUpdate) => AudioListenerState)} setListener
 * @property {(vel?: { vx?: number, vy?: number, vz?: number, x?: number, y?: number, z?: number }) => { vx: number, vy: number, vz: number }} setListenerVelocity
 * @property {(opts: { id: string, position?: AudioPosition3D | AudioPosition2D, radius?: number, decaySeconds?: number, wetGain?: number }) => { id: string, radius: number, decaySeconds: number, wetGain: number, currentWet: number, wired: boolean }} createReverbZone
 * @property {(id: string) => boolean} removeReverbZone
 * @property {(pos?: AudioPosition3D | AudioPosition2D) => { activeZones: number, maxWetGain: number }} updateReverbZones
 * @property {() => { unlocked: boolean, hasReverbSend: boolean, zoneCount: number, wiredZones: number }} getDspState
 * @property {(url: string, opts?: { bus?: string, loop?: boolean, volume?: number, autoplay?: boolean }) => { url: string, bus: string, loop: boolean, readonly playing: boolean, readonly volume: number, play: () => Promise<void>, pause: () => void, setVolume: (v: number) => number, stop: () => void }} playStream
 * @property {(camera: AudioListenerCamera | null | undefined) => AudioListenerState} updateListenerFromCamera
 * @property {() => Promise<void> | undefined} dispose Stop everything and close the context.
 */

/**
 * @typedef {object} SynthPlayOptions
 * @property {string} [bus='sfx'] Mixer bus.
 * @property {number} [volume=1] Voice volume.
 * @property {number} [pitchJitter=0.08]
 * @property {number} [gainJitter=0.05]
 * @property {number} [playbackRate=1]
 * @property {number} [pitch] Alias for playbackRate.
 * @property {number} [duration] Duration in seconds.
 * @property {() => number} [random] Random source for pitch and gain variation.
 * @property {() => void} [onEnded] Called when a playing sound ends or is stopped.
 */

/**
 * @typedef {object} SynthVoice
 * @property {string} preset
 * @property {number} pitchFactor
 * @property {number} duration Duration in seconds.
 * @property {boolean} played False when audio is unavailable, muted, or no voice is free.
 * @property {() => void} stop Stop and release the voice.
 */

/**
 * Web Audio manager supporting buses, master dynamics limiter, 3D HRTF / 2D left-right
 * spatialization, MP3 encoder-padding trimming, polyphony control, and multi-variant cues.
 *
 * @param {AudioManagerOptions} [options]
 * @returns {AudioManager}
 */
export function createAudioManager({
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  volume = 1,
  maxPolyphony = 24,
  compressor = true,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  if (!Number.isInteger(maxPolyphony) || maxPolyphony < 1) {
    throw new RangeError('maxPolyphony must be a positive integer');
  }

  const bufferAnalysisCache = new WeakMap();
  const cues = new Map();
  const reverbZones = new Map();
  const activeStreams = new Set();
  const listenerState = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    forwardX: 0,
    forwardY: 0,
    forwardZ: -1,
    upX: 0,
    upY: 1,
    upZ: 0,
  };

  function computeDopplerRate(sourcePos, sourceVel, lPos, lVel, speedOfSound = 343) {
    if (!sourcePos || !sourceVel) return 1;
    const sx = Number(Array.isArray(sourcePos) ? sourcePos[0] : sourcePos.x) || 0;
    const sy = Number(Array.isArray(sourcePos) ? sourcePos[1] : sourcePos.y) || 0;
    const sz = Number(Array.isArray(sourcePos) ? sourcePos[2] : sourcePos.z) || 0;
    const dx = sx - lPos.x;
    const dy = sy - lPos.y;
    const dz = sz - lPos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-5) return 1;
    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;
    const svx = Number(sourceVel.vx ?? sourceVel.x ?? 0) || 0;
    const svy = Number(sourceVel.vy ?? sourceVel.y ?? 0) || 0;
    const svz = Number(sourceVel.vz ?? sourceVel.z ?? 0) || 0;
    // Direction is listener -> source: positive v_source moves away, negative moves toward
    const vSourceAway = svx * nx + svy * ny + svz * nz;
    const vListenerToward = (lVel.vx || 0) * nx + (lVel.vy || 0) * ny + (lVel.vz || 0) * nz;
    const c = Math.max(20, Number(speedOfSound) || 343);
    return clamp((c + vListenerToward) / Math.max(1, c + vSourceAway), 0.5, 2.0);
  }

  function getCachedAnalysis(buffer) {
    if (!buffer || typeof buffer !== 'object') return analyzeAudioBuffer(buffer);
    let info = bufferAnalysisCache.get(buffer);
    if (!info) {
      info = analyzeAudioBuffer(buffer);
      bufferAnalysisCache.set(buffer, info);
    }
    return info;
  }

  const ctx = {
    AudioContextClass,
    compressor,
    maxPolyphony,
    now,
    context: null,
    master: null,
    busTarget: null,
    muted: false,
    currentVolume: clamp(Number(volume) || 0, 0, 1),
    activeSources: new Set(),
    bufferCooldowns: new WeakMap(),
    keyCooldowns: new Map(),
    activeSnapshot: null,
    occlusionProbe: null,
    reverbSend: null,
    listenerState,
    getCachedAnalysis,
    getBusNode: null,
    unlock: null,
  };

  const buses = createAudioBusController(ctx);
  ctx.getBusNode = buses.getBusNode;
  ctx.unlock = async () => {
    const c = await buses.unlock();
    for (const zone of reverbZones.values()) wireReverbZoneNodes(zone);
    return c;
  };

  function setOcclusionProbe(fn) {
    ctx.occlusionProbe = typeof fn === 'function' ? fn : null;
  }

  function updateOcclusion() {
    for (const handle of ctx.activeSources) {
      handle.refreshOcclusion?.();
    }
  }

  function setListener(next = {}) {
    if (Number.isFinite(next.x)) listenerState.x = next.x;
    if (Number.isFinite(next.y)) listenerState.y = next.y;
    if (Number.isFinite(next.z)) listenerState.z = next.z;
    if (Number.isFinite(next.vx)) listenerState.vx = next.vx;
    if (Number.isFinite(next.vy)) listenerState.vy = next.vy;
    if (Number.isFinite(next.vz)) listenerState.vz = next.vz;
    const hasForward = Number.isFinite(next.forwardX) || Number.isFinite(next.forwardY) || Number.isFinite(next.forwardZ);
    if (hasForward) {
      const [fx, fy, fz] = normalizeVec3(
        Number.isFinite(next.forwardX) ? next.forwardX : listenerState.forwardX,
        Number.isFinite(next.forwardY) ? next.forwardY : listenerState.forwardY,
        Number.isFinite(next.forwardZ) ? next.forwardZ : listenerState.forwardZ,
        0, 0, -1,
      );
      listenerState.forwardX = fx;
      listenerState.forwardY = fy;
      listenerState.forwardZ = fz;
    }
    const hasUp = Number.isFinite(next.upX) || Number.isFinite(next.upY) || Number.isFinite(next.upZ);
    if (hasUp) {
      const [ux, uy, uz] = normalizeVec3(
        Number.isFinite(next.upX) ? next.upX : listenerState.upX,
        Number.isFinite(next.upY) ? next.upY : listenerState.upY,
        Number.isFinite(next.upZ) ? next.upZ : listenerState.upZ,
        0, 1, 0,
      );
      listenerState.upX = ux;
      listenerState.upY = uy;
      listenerState.upZ = uz;
    }
    if (ctx.context?.listener) applyListenerOrientation(ctx.context.listener, listenerState);
    if (ctx.occlusionProbe) updateOcclusion();
    if (reverbZones.size > 0) updateReverbZones(listenerState);
    return { ...listenerState };
  }

  function setListenerVelocity(vel = {}) {
    if (Array.isArray(vel)) {
      if (Number.isFinite(vel[0])) listenerState.vx = vel[0];
      if (Number.isFinite(vel[1])) listenerState.vy = vel[1];
      if (Number.isFinite(vel[2])) listenerState.vz = vel[2];
    } else if (vel && typeof vel === 'object') {
      if (Number.isFinite(vel.vx ?? vel.x)) listenerState.vx = Number(vel.vx ?? vel.x);
      if (Number.isFinite(vel.vy ?? vel.y)) listenerState.vy = Number(vel.vy ?? vel.y);
      if (Number.isFinite(vel.vz ?? vel.z)) listenerState.vz = Number(vel.vz ?? vel.z);
    }
    return { vx: listenerState.vx, vy: listenerState.vy, vz: listenerState.vz };
  }

  function updateListenerFromCamera(camera) {
    if (!camera) return { ...listenerState };
    const e = camera.matrixWorld?.elements;
    if (e && e.length >= 16) {
      return setListener({
        x: Number(e[12]) || 0,
        y: Number(e[13]) || 0,
        z: Number(e[14]) || 0,
        forwardX: -(Number(e[8]) || 0),
        forwardY: -(Number(e[9]) || 0),
        forwardZ: -(Number(e[10]) || -1),
        upX: Number(e[4]) || 0,
        upY: Number(e[5]) || 1,
        upZ: Number(e[6]) || 0,
      });
    }
    if (Number.isFinite(camera.x) && Number.isFinite(camera.y)) {
      return setListener({
        x: camera.x + (Number(camera.offsetX) || 0),
        y: camera.y + (Number(camera.offsetY) || 0),
        z: Number.isFinite(camera.z) ? camera.z : 0,
        forwardX: 0,
        forwardY: 0,
        forwardZ: -1,
        upX: 0,
        upY: 1,
        upZ: 0,
      });
    }
    return { ...listenerState };
  }

  async function decode(arrayBuffer) {
    const audioContext = await buses.unlock();
    return audioContext.decodeAudioData(arrayBuffer.slice(0));
  }

  const play = (buffer, options = {}) => {
    const pos = options.position ?? options.position2D ?? null;
    const doppler = (pos && options.velocity)
      ? computeDopplerRate(pos, options.velocity, listenerState, listenerState, options.speedOfSound)
      : 1;
    const effectiveRate = clamp((Number(options.playbackRate) || 1) * doppler, 0.05, 4);
    return playAudioBuffer(ctx, buffer, doppler !== 1 ? { ...options, playbackRate: effectiveRate } : options);
  };

  function buildImpulseResponse(audioCtx, decaySeconds) {
    if (!audioCtx || typeof audioCtx.createBuffer !== 'function') return null;
    const sr = audioCtx.sampleRate || 48000;
    const length = Math.max(1, Math.floor(sr * Math.max(0.05, decaySeconds)));
    const ir = audioCtx.createBuffer(2, length, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const env = Math.pow(1 - t, Math.max(0.5, decaySeconds * 1.4));
        // Deterministic pseudo-noise scaled by exponential decay
        const noise = Math.sin(i * 12.9898 + ch * 78.233) * 43758.5453;
        data[i] = ((noise - Math.floor(noise)) * 2 - 1) * env * 0.5;
      }
    }
    return ir;
  }

  function wireReverbZoneNodes(zone) {
    if (!zone || zone.convolver) return;
    const audioCtx = ctx.context;
    const wetDest = ctx.busTarget ?? ctx.master;
    if (audioCtx && ctx.reverbSend && wetDest && typeof audioCtx.createConvolver === 'function' && typeof audioCtx.createGain === 'function') {
      const convolver = audioCtx.createConvolver();
      convolver.buffer = buildImpulseResponse(audioCtx, zone.decaySeconds);
      const wetNode = audioCtx.createGain();
      wetNode.gain.value = zone.currentWet;
      ctx.reverbSend.connect(convolver);
      convolver.connect(wetNode);
      wetNode.connect(wetDest);
      zone.convolver = convolver;
      zone.wetNode = wetNode;
    }
  }

  function createReverbZone({
    id,
    position = { x: 0, y: 0, z: 0 },
    radius = 20,
    decaySeconds = 1.6,
    wetGain = 0.35,
  } = {}) {
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('Reverb zone requires a non-empty id');
    const zoneRadius = Math.max(0.1, Number(radius) || 20);
    const decay = clamp(Number(decaySeconds) || 1.6, 0.05, 10);
    const maxWet = clamp(Number(wetGain) || 0.35, 0, 1);
    const px = Number(Array.isArray(position) ? position[0] : position?.x) || 0;
    const py = Number(Array.isArray(position) ? position[1] : position?.y) || 0;
    const pz = Number(Array.isArray(position) ? position[2] : position?.z) || 0;

    if (reverbZones.has(id)) removeReverbZone(id);
    const zone = {
      id,
      x: px,
      y: py,
      z: pz,
      radius: zoneRadius,
      decaySeconds: decay,
      wetGain: maxWet,
      currentWet: 0,
      convolver: null,
      wetNode: null,
    };
    reverbZones.set(id, zone);
    updateReverbZones(listenerState);
    wireReverbZoneNodes(zone);
    return {
      get id() { return zone.id; },
      get radius() { return zone.radius; },
      get decaySeconds() { return zone.decaySeconds; },
      get wetGain() { return zone.wetGain; },
      get currentWet() { return zone.currentWet; },
      get wired() { return Boolean(zone.convolver && zone.wetNode); },
    };
  }

  function removeReverbZone(id) {
    const zone = reverbZones.get(id);
    if (!zone) return false;
    try { if (zone.convolver) ctx.reverbSend?.disconnect?.(zone.convolver); } catch {}
    try { zone.wetNode?.disconnect?.(); } catch {}
    try { zone.convolver?.disconnect?.(); } catch {}
    reverbZones.delete(id);
    return true;
  }

  function updateReverbZones(pos = listenerState) {
    const lx = Number(Array.isArray(pos) ? pos[0] : pos?.x) || 0;
    const ly = Number(Array.isArray(pos) ? pos[1] : pos?.y) || 0;
    const lz = Number(Array.isArray(pos) ? pos[2] : pos?.z) || 0;
    let activeZones = 0;
    let maxWetGain = 0;
    for (const zone of reverbZones.values()) {
      const dist = Math.hypot(zone.x - lx, zone.y - ly, zone.z - lz);
      const t = dist < zone.radius ? clamp(1 - dist / zone.radius, 0, 1) : 0;
      const wet = t > 0 ? zone.wetGain * Math.pow(t, 1.5) : 0;
      zone.currentWet = wet;
      if (wet > 0) activeZones++;
      if (wet > maxWetGain) maxWetGain = wet;
      if (zone.wetNode?.gain) zone.wetNode.gain.value = wet;
    }
    return { activeZones, maxWetGain };
  }

  function playStream(url, { bus = 'music', loop = true, volume: streamVolume = 1, autoplay = true } = {}) {
    if (typeof url !== 'string' || !url.trim()) throw new TypeError('playStream requires a valid url string');
    let vol = clamp(Number(streamVolume) || 0, 0, 1.5);
    let playing = false;
    let disposed = false;
    let audioEl = null;
    let sourceNode = null;
    let gainNode = null;

    if (typeof globalThis.Audio === 'function') {
      try {
        audioEl = new globalThis.Audio(url);
        audioEl.loop = Boolean(loop);
        audioEl.crossOrigin = 'anonymous';
        if (!ctx.context) void buses.unlock().catch(() => {});
        const c = ctx.context;
        const dest = (ctx.getBusNode ? ctx.getBusNode(bus) : null) ?? ctx.master;
        if (c && typeof c.createMediaElementSource === 'function' && dest) {
          sourceNode = c.createMediaElementSource(audioEl);
          gainNode = c.createGain();
          gainNode.gain.value = ctx.muted ? 0 : vol;
          sourceNode.connect(gainNode);
          gainNode.connect(dest);
        } else {
          audioEl.volume = ctx.muted ? 0 : clamp(vol, 0, 1);
        }
      } catch {
        audioEl = null;
      }
    }

    const handle = {
      url,
      bus,
      loop: Boolean(loop),
      get playing() { return playing && !disposed; },
      get volume() { return vol; },
      async play() {
        if (disposed) return;
        playing = true;
        if (audioEl && typeof audioEl.play === 'function') {
          try { await audioEl.play(); } catch {}
        }
      },
      pause() {
        if (disposed) return;
        playing = false;
        audioEl?.pause?.();
      },
      setVolume(nextVol) {
        vol = clamp(Number(nextVol) || 0, 0, 1.5);
        if (gainNode?.gain) gainNode.gain.value = ctx.muted ? 0 : vol;
        else if (audioEl) audioEl.volume = ctx.muted ? 0 : clamp(vol, 0, 1);
        return vol;
      },
      stop() {
        if (disposed) return;
        disposed = true;
        playing = false;
        activeStreams.delete(handle);
        if (audioEl) {
          try { audioEl.pause?.(); } catch {}
          try { audioEl.src = ''; } catch {}
        }
        try { sourceNode?.disconnect?.(); } catch {}
        try { gainNode?.disconnect?.(); } catch {}
      },
    };
    activeStreams.add(handle);
    if (autoplay) void handle.play();
    return handle;
  }

  function inspectCue(name) {
    const entry = cues.get(name);
    if (!entry) return null;
    return Object.freeze({
      name: entry.name,
      bus: entry.bus,
      variantCount: entry.normalized.variants.length,
      medianDuration: entry.normalized.medianDuration,
      medianRms: entry.normalized.medianRms,
      durationSpreadRatio: entry.normalized.durationSpreadRatio,
      allConsistent: entry.normalized.allConsistent,
      variants: entry.normalized.variants.map(v => Object.freeze({
        index: v.index,
        duration: v.duration,
        activeDuration: v.activeDuration,
        playDuration: v.playDuration,
        gainScale: v.gainScale,
        deviationRatio: v.deviationRatio,
        consistent: v.consistent,
      })),
    });
  }

  function registerCue(name, variantsOrConfig, extraOptions = {}) {
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('Cue name must be a non-empty string');
    const isArray = Array.isArray(variantsOrConfig);
    const cfg = isArray ? { variants: variantsOrConfig, ...extraOptions } : (variantsOrConfig || {});
    const normalized = normalizeVariantSet(cfg.variants, {
      silenceThreshold: cfg.silenceThreshold ?? 0.0035,
      normalizeRms: cfg.normalizeRms !== false,
      maxDurationSpreadRatio: cfg.maxDurationSpreadRatio ?? 0.28,
      alignDuration: cfg.alignDuration !== false,
    });
    for (const v of normalized.variants) {
      if (v.buffer && typeof v.buffer === 'object' && !bufferAnalysisCache.has(v.buffer)) {
        bufferAnalysisCache.set(v.buffer, {
          analyzable: v.analyzable,
          duration: v.duration,
          trimStart: v.trimStart,
          trimEnd: v.trimEnd,
          activeDuration: v.activeDuration,
          rms: v.rms,
          peak: v.peak,
        });
      }
    }
    const bus = cfg.bus ?? null;
    const isUiVoice = bus === 'ui_voice' || bus === 'ui';
    const maxVoices = Math.max(1, Number(cfg.maxVoices ?? cfg.maxConcurrent) || 4);
    const defaultCooldown = cfg.cooldownMs !== undefined ? Math.max(0, Number(cfg.cooldownMs) || 0) : 45;
    const defaultPitchJitter = cfg.pitchJitter !== undefined ? Math.max(0, Number(cfg.pitchJitter) || 0) : (isUiVoice ? 0 : 0.04);
    const defaultGainJitterDb = cfg.gainJitterDb !== undefined
      ? Math.max(0, Number(cfg.gainJitterDb) || 0)
      : (cfg.gainJitter !== undefined ? 0 : (isUiVoice ? 0.4 : 0.8));
    cues.set(name, {
      name,
      bus,
      volume: cfg.volume ?? 1,
      gainDb: Number(cfg.gainDb) || 0,
      pitchJitter: defaultPitchJitter,
      gainJitter: cfg.gainJitter ?? 0,
      gainJitterDb: defaultGainJitterDb,
      cooldownMs: defaultCooldown,
      maxVoices,
      maxConcurrent: maxVoices,
      ducking: Boolean(cfg.ducking),
      hrtf: cfg.hrtf !== false,
      refDistance: cfg.refDistance ?? 3,
      maxDistance: cfg.maxDistance ?? 400,
      rolloffFactor: cfg.rolloffFactor ?? 0.8,
      panRange: cfg.panRange ?? 480,
      trimSilence: cfg.trimSilence !== false,
      normalized,
      lastVariant: -1,
      activeHandles: new Set(),
    });
    return inspectCue(name);
  }

  async function playCue(name, overrides = {}) {
    const entry = cues.get(name);
    if (!entry) throw new Error(`Unknown audio cue: ${name}`);

    const n = entry.normalized.variants.length;
    const rng = typeof overrides.random === 'function' ? overrides.random : Math.random;
    let chosenIndex;
    if (Number.isInteger(overrides.variant)) {
      chosenIndex = ((overrides.variant % n) + n) % n;
    } else if (n === 1) {
      chosenIndex = 0;
    } else if (n === 2) {
      chosenIndex = entry.lastVariant === 0 ? 1 : 0;
    } else if (entry.lastVariant < 0) {
      chosenIndex = Math.floor(rng() * n) % n;
    } else {
      const step = rng() < 0.35 ? 2 : 1;
      chosenIndex = (entry.lastVariant + step) % n;
    }

    const cooldownMs = overrides.cooldownMs ?? entry.cooldownMs;
    const cooldownKey = overrides.key ?? `cue:${name}`;
    const maxVoices = Math.max(1, Number(overrides.maxVoices ?? entry.maxVoices ?? entry.maxConcurrent) || 4);

    if (cooldownMs > 0) {
      const prevTime = ctx.keyCooldowns.get(cooldownKey) ?? -Infinity;
      if (now() - prevTime < cooldownMs) return null;
    }

    while (entry.activeHandles.size >= maxVoices) {
      const oldest = entry.activeHandles.values().next().value;
      if (!oldest) break;
      entry.activeHandles.delete(oldest);
      oldest.stop({ fadeOutMs: 8 });
    }

    const v = entry.normalized.variants[chosenIndex];
    const cueGainLinear = Math.pow(10, ((entry.gainDb || 0) + (Number(overrides.gainDb) || 0)) / 20);
    const requestedVol = (overrides.volume ?? entry.volume) * cueGainLinear * v.gainScale;
    const prevLast = entry.lastVariant;
    entry.lastVariant = chosenIndex;
    const needsTrimmedDuration = v.analyzable && entry.trimSilence
      && v.playDuration > 0
      && (v.tailFadeSec > 0 || v.playDuration < v.duration - 1e-4);

    let handleRef = null;
    const resolvedBus = overrides.bus ?? entry.bus ?? ((overrides.position || overrides.position2D) ? 'spatial' : 'combat');
    const handle = await play(v.buffer, {
      bus: resolvedBus,
      volume: requestedVol,
      loop: overrides.loop ?? false,
      playbackRate: overrides.playbackRate ?? 1,
      pitchJitter: overrides.pitchJitter ?? entry.pitchJitter,
      gainJitter: overrides.gainJitter ?? entry.gainJitter,
      gainJitterDb: overrides.gainJitterDb ?? entry.gainJitterDb,
      cooldownMs,
      key: cooldownKey,
      pan: overrides.pan ?? null,
      position: overrides.position ?? null,
      position2D: overrides.position2D ?? null,
      hrtf: overrides.hrtf ?? entry.hrtf,
      distanceModel: overrides.distanceModel ?? 'inverse',
      refDistance: overrides.refDistance ?? entry.refDistance,
      maxDistance: overrides.maxDistance ?? entry.maxDistance,
      rolloffFactor: overrides.rolloffFactor ?? entry.rolloffFactor,
      panRange: overrides.panRange ?? entry.panRange,
      trimSilence: overrides.trimSilence ?? entry.trimSilence,
      velocity: overrides.velocity ?? null,
      offset: v.analyzable && entry.trimSilence ? v.trimStart : null,
      duration: needsTrimmedDuration ? v.playDuration : null,
      tailFadeSec: v.tailFadeSec,
      occlusion: overrides.occlusion ?? null,
      occludedLowPassHz: overrides.occludedLowPassHz ?? 550,
      occludedGainScale: overrides.occludedGainScale ?? 0.45,
      openLowPassHz: overrides.openLowPassHz ?? 22000,
      onEnded: () => { if (handleRef) entry.activeHandles.delete(handleRef); },
      random: rng,
    });

    if (!handle) {
      entry.lastVariant = prevLast;
      return null;
    }

    if (overrides.ducking ?? entry.ducking) {
      const duckTarget = Math.pow(10, -5 / 20);
      const duckOpts = { targetGain: duckTarget, attackSec: 0.05, holdSec: 0.4, releaseSec: 0.25 };
      buses.duckBus('bgm', duckOpts);
      buses.duckBus('ambience', duckOpts);
      if (buses.getBusVolume('music') !== undefined) buses.duckBus('music', duckOpts);
    }

    handleRef = handle;
    handle.variant = chosenIndex;
    const origStop = handle.stop;
    handle.stop = (stopOpts) => {
      entry.activeHandles.delete(handle);
      return origStop(stopOpts);
    };
    while (entry.activeHandles.size >= maxVoices) {
      const oldest = entry.activeHandles.values().next().value;
      if (!oldest) break;
      oldest.stop({ fadeOutMs: 8 });
    }
    entry.activeHandles.add(handle);
    return handle;
  }

  function playSynth(presetOrConfig, options = {}) {
    if (ctx.muted || typeof AudioContextClass !== 'function') {
      return playSynthPresetOnContext(null, null, presetOrConfig, options);
    }
    while (ctx.activeSources.size >= ctx.maxPolyphony) {
      let candidate = null;
      for (const source of ctx.activeSources) {
        if (!source.loop) { candidate = source; break; }
      }
      if (!candidate) return playSynthPresetOnContext(null, null, presetOrConfig, options);
      candidate.stop();
    }
    if (!ctx.context) {
      buses.unlock().catch(() => {});
    }
    const c = ctx.context;
    const presetName = typeof presetOrConfig === 'string'
      ? presetOrConfig
      : (presetOrConfig?.preset || '');
    const defaultBus = /^(click|pickup|powerup|jump|coin|ui)/i.test(presetName) ? 'ui_voice' : 'combat';
    const busName = options.bus || defaultBus;
    const dest = ctx.getBusNode ? ctx.getBusNode(busName) : ctx.master;
    let voice = null, ended = false;
    voice = playSynthPresetOnContext(c, dest, presetOrConfig, {
      ...options,
      onEnded() {
        ended = true;
        if (voice) ctx.activeSources.delete(voice);
        try { options.onEnded?.(); } catch (error) { console.error('Synth onEnded callback failed:', error); }
      },
    });
    if (voice.played && !ended) ctx.activeSources.add(voice);
    return voice;
  }

  const bgmInstances = new Set();

  function createBgm(bgmOpts = {}) {
    const controller = createProceduralBgm({
      AudioContextClass,
      resolveAudio() {
        if (!ctx.context) void buses.unlock().catch(() => {});
        return { context: ctx.context, destination: ctx.getBusNode ? ctx.getBusNode('music') : ctx.master };
      },
      ...bgmOpts,
    });
    const bgm = Object.freeze({
      ...controller,
      dispose() { bgmInstances.delete(bgm); controller.dispose(); },
    });
    bgmInstances.add(bgm);
    return bgm;
  }

  let indoorState = false;
  let indoorLowPassHz = 650;
  let indoorConvolver = null;
  let indoorWetNode = null;
  const lifecycleCleanups = [];

  function ensureIndoorConvolver(reverbDecaySeconds = 0.4, targetWet = 0) {
    const audioCtx = ctx.context;
    const wetDest = ctx.busTarget ?? ctx.master;
    if (!audioCtx || !ctx.reverbSend || !wetDest || indoorConvolver ||
        typeof audioCtx.createConvolver !== 'function' || typeof audioCtx.createGain !== 'function') {
      return;
    }
    indoorConvolver = audioCtx.createConvolver();
    indoorConvolver.buffer = buildImpulseResponse(audioCtx, clamp(Number(reverbDecaySeconds) || 0.4, 0.05, 4));
    indoorWetNode = audioCtx.createGain();
    indoorWetNode.gain.value = targetWet;
    ctx.reverbSend.connect(indoorConvolver);
    indoorConvolver.connect(indoorWetNode);
    indoorWetNode.connect(wetDest);
  }

  function setIndoor(indoor = false, {
    lowPassHz = 650,
    openLowPassHz = 18000,
    transitionSeconds = 0.4,
    reverbWet = 0.28,
    reverbDecaySeconds = 0.4,
  } = {}) {
    indoorState = Boolean(indoor);
    indoorLowPassHz = clamp(Number(lowPassHz) || 650, 80, 22000);
    const openHz = clamp(Number(openLowPassHz) || 18000, 1000, 22000);
    const targetHz = indoorState ? indoorLowPassHz : openHz;
    const tSec = Math.max(0, Number(transitionSeconds) || 0.4);

    buses.applySnapshot({
      name: indoorState ? 'indoor' : 'outdoor',
      transitionSeconds: tSec,
      buses: {
        ambience: { lowPassHz: targetHz },
        ambient: { lowPassHz: targetHz },
      },
    });

    const targetWet = indoorState ? clamp(Number(reverbWet) || 0.28, 0, 1) : 0;
    if (indoorState) {
      ensureIndoorConvolver(reverbDecaySeconds, targetWet);
    }
    if (indoorWetNode?.gain) {
      indoorWetNode.gain.value = targetWet;
    }
    return indoorState;
  }

  async function unlockWithIndoor() {
    const audioCtx = await ctx.unlock();
    if (indoorState) {
      ensureIndoorConvolver(0.4, 0.28);
    }
    return audioCtx;
  }

  function playSurfaceCue(surfaceType, kind = 'footstep', options = {}) {
    const surf = String(surfaceType || 'concrete').toLowerCase();
    const prefix = String(kind || 'footstep').toLowerCase();
    const cueName = `${prefix}_${surf}`;
    const opts = {
      pitchJitter: 0.1,
      gainJitter: 0.12,
      ...options,
    };
    if (cues.has(cueName)) return playCue(cueName, opts);
    if (cues.has(prefix)) return playCue(prefix, opts);
    return Promise.resolve(null);
  }

  function bindLifecycle({
    doc = globalThis.document ?? null,
    win = globalThis.window ?? null,
    miniGameHost = null,
  } = {}) {
    const onGesture = () => {
      void buses.unlock().catch(() => {});
    };
    const onVisibility = () => {
      if (!ctx.context) return;
      if (doc?.hidden) {
        void ctx.context.suspend?.().catch?.(() => {});
      } else if (!ctx.muted) {
        void ctx.context.resume?.().catch?.(() => {});
      }
    };
    const onHide = () => {
      if (ctx.context) void ctx.context.suspend?.().catch?.(() => {});
    };
    const onShow = () => {
      if (ctx.context && !ctx.muted) void ctx.context.resume?.().catch?.(() => {});
    };

    if (win && typeof win.addEventListener === 'function') {
      for (const ev of ['pointerdown', 'touchstart', 'keydown']) {
        win.addEventListener(ev, onGesture, { passive: true });
        lifecycleCleanups.push(() => win.removeEventListener(ev, onGesture));
      }
    }
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', onVisibility);
      lifecycleCleanups.push(() => doc.removeEventListener('visibilitychange', onVisibility));
    }
    if (miniGameHost && typeof miniGameHost.onHide === 'function') {
      miniGameHost.onHide(onHide);
      if (typeof miniGameHost.offHide === 'function') {
        lifecycleCleanups.push(() => miniGameHost.offHide(onHide));
      }
    }
    if (miniGameHost && typeof miniGameHost.onShow === 'function') {
      miniGameHost.onShow(onShow);
      if (typeof miniGameHost.offShow === 'function') {
        lifecycleCleanups.push(() => miniGameHost.offShow(onShow));
      }
    }
    return () => {
      while (lifecycleCleanups.length > 0) {
        const fn = lifecycleCleanups.pop();
        try { fn?.(); } catch {}
      }
    };
  }

  function dispose() {
    while (lifecycleCleanups.length > 0) {
      const fn = lifecycleCleanups.pop();
      try { fn?.(); } catch {}
    }
    try { if (indoorConvolver) ctx.reverbSend?.disconnect?.(indoorConvolver); } catch {}
    try { indoorWetNode?.disconnect?.(); } catch {}
    try { indoorConvolver?.disconnect?.(); } catch {}
    indoorConvolver = null;
    indoorWetNode = null;
    for (const bgm of bgmInstances) bgm.dispose();
    bgmInstances.clear();
    for (const stream of [...activeStreams]) stream.stop();
    activeStreams.clear();
    for (const id of [...reverbZones.keys()]) removeReverbZone(id);
    for (const source of [...ctx.activeSources]) source.stop();
    ctx.activeSources.clear();
    for (const cue of cues.values()) cue.activeHandles.clear();
    cues.clear();
    ctx.keyCooldowns.clear();
    buses.dispose();
    ctx.occlusionProbe = null;
    const closing = ctx.context?.close?.();
    ctx.context = null;
    ctx.master = null;
    ctx.busTarget = null;
    return closing;
  }

  return Object.freeze({
    get volume() { return ctx.currentVolume; },
    get muted() { return ctx.muted; },
    get activeCount() { return ctx.activeSources.size; },
    get available() { return typeof AudioContextClass === 'function'; },
    get listener() { return { ...listenerState }; },
    get activeSnapshot() { return ctx.activeSnapshot ? ctx.activeSnapshot.name : null; },
    get isIndoor() { return indoorState; },
    unlock: unlockWithIndoor,
    setIndoor,
    playSurfaceCue,
    bindLifecycle,
    decode,
    play,
    playSynth,
    createBgm,
    registerCue,
    playCue,
    inspectCue,
    hasCue: (name) => cues.has(name),
    setVolume: buses.setVolume,
    setMuted: buses.setMuted,
    setBusVolume: buses.setBusVolume,
    getBusVolume: buses.getBusVolume,
    setBusEq: buses.setBusEq,
    getBusEq: buses.getBusEq,
    duckBus: buses.duckBus,
    registerSnapshot: buses.registerSnapshot,
    applySnapshot: buses.applySnapshot,
    clearSnapshot: buses.clearSnapshot,
    setOcclusionProbe,
    updateOcclusion,
    setListener,
    setListenerVelocity,
    createReverbZone,
    removeReverbZone,
    updateReverbZones,
    getDspState() {
      let wiredZones = 0;
      for (const z of reverbZones.values()) if (z.convolver && z.wetNode) wiredZones++;
      return Object.freeze({
        unlocked: Boolean(ctx.context),
        hasReverbSend: Boolean(ctx.reverbSend),
        zoneCount: reverbZones.size,
        wiredZones,
        ducking: buses.getDuckingState(),
      });
    },
    playStream,
    updateListenerFromCamera,
    dispose,
  });
}
