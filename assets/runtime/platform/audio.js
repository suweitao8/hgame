import {
  DEFAULT_BUS_VOLUMES,
  clamp,
  normalizeVec3,
  parsePosition3D,
  parsePosition2D,
  applyAudioParamOrMethod,
  applyListenerOrientation,
  setGainTarget,
} from './audio/helpers.js';
import { analyzeAudioBuffer } from './audio/analysis.js';
import { normalizeVariantSet } from './audio/variants.js';

export { analyzeAudioBuffer, normalizeVariantSet };

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
 * @property {number} [pitchJitter=0.02]
 * @property {number} [gainJitter=0.04]
 * @property {number} [cooldownMs=0] Milliseconds.
 * @property {number} [maxConcurrent=4] Max simultaneous voices of this cue.
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
 * @typedef {Partial<AudioListenerState>} AudioListenerUpdate
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
 * @property {(name: string, variantsOrConfig: readonly AudioBuffer[] | AudioCueConfig, extraOptions?: Omit<AudioCueConfig, 'variants'>) => AudioCueInspection} registerCue
 * @property {(name: string, overrides?: AudioCueOverrides) => Promise<AudioVoice | null>} playCue
 * @property {(name: string) => AudioCueInspection | null} inspectCue
 * @property {(name: string) => boolean} hasCue
 * @property {(value: number) => number} setVolume Returns the clamped value.
 * @property {(muted: boolean) => boolean} setMuted
 * @property {(bus: string, value: number) => number} setBusVolume Gain 0..1.5; returns the clamped value.
 * @property {(bus: string) => number} getBusVolume
 * @property {(bus: string, factor?: number, durationMs?: number) => boolean} duckBus Temporarily scale a bus (factor 0..1, default 0.55; milliseconds, default 250).
 * @property {(name: string, config?: AudioSnapshotConfig) => AudioSnapshot} registerSnapshot
 * @property {(nameOrConfig: string | AudioSnapshotConfig, options?: { transitionSeconds?: number | null }) => string} applySnapshot Returns the snapshot name.
 * @property {(options?: { transitionSeconds?: number }) => boolean} clearSnapshot
 * @property {(probe: OcclusionProbe | null | undefined) => void} setOcclusionProbe
 * @property {() => void} updateOcclusion Refresh occlusion of all active voices.
 * @property {(next?: AudioListenerUpdate) => AudioListenerState} setListener
 * @property {(camera: AudioListenerCamera | null | undefined) => AudioListenerState} updateListenerFromCamera
 * @property {() => Promise<void> | undefined} dispose Stop everything and close the context.
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

  let context = null;
  let master = null;
  let busTarget = null;
  let muted = false;
  let currentVolume = clamp(Number(volume) || 0, 0, 1);

  const activeSources = new Set();
  const bufferCooldowns = new WeakMap();
  const bufferAnalysisCache = new WeakMap();
  const keyCooldowns = new Map();
  const cues = new Map();
  const busVolumes = { ...DEFAULT_BUS_VOLUMES };
  const busNodes = new Map();
  const busFilters = new Map();
  const busFilterFreqs = Object.create(null);
  const snapshots = new Map();
  const duckTimers = new Map();
  let activeSnapshot = null;
  let occlusionProbe = null;

  const listenerState = {
    x: 0,
    y: 0,
    z: 0,
    forwardX: 0,
    forwardY: 0,
    forwardZ: -1,
    upX: 0,
    upY: 1,
    upZ: 0,
  };

  function getCachedAnalysis(buffer) {
    if (!buffer || typeof buffer !== 'object') return analyzeAudioBuffer(buffer);
    let info = bufferAnalysisCache.get(buffer);
    if (!info) {
      info = analyzeAudioBuffer(buffer);
      bufferAnalysisCache.set(buffer, info);
    }
    return info;
  }

  function resolveBusMix(busName) {
    const userVol = busVolumes[busName] ?? 1;
    if (!activeSnapshot) {
      return { volume: userVol, lowPassHz: 22000 };
    }
    const busOverride = activeSnapshot.buses?.[busName];
    const volume = busOverride?.volume !== undefined
      ? clamp(Number(busOverride.volume) || 0, 0, 1.5)
      : (busOverride?.gainScale !== undefined
        ? clamp(userVol * (Number(busOverride.gainScale) || 0), 0, 1.5)
        : userVol);
    const rawHz = busOverride?.lowPassHz ?? busOverride?.filterHz ?? activeSnapshot.defaultLowPassHz ?? 22000;
    const lowPassHz = clamp(Number(rawHz) || 22000, 60, 22000);
    return { volume, lowPassHz };
  }

  function applyBusMixToNodes(busName, transitionSeconds = 0.15) {
    const mix = resolveBusMix(busName);
    busFilterFreqs[busName] = mix.lowPassHz;
    if (!context) return;
    const nowTime = Number.isFinite(context.currentTime) ? context.currentTime : 0;
    const timeConst = Math.max(0.005, (Number(transitionSeconds) || 0) / 3);
    const node = busNodes.get(busName);
    if (node) {
      if (transitionSeconds <= 0 && 'value' in node.gain) {
        node.gain.value = mix.volume;
      } else {
        setGainTarget(node.gain, mix.volume, nowTime, timeConst);
      }
    }
    const filter = busFilters.get(busName);
    if (filter?.frequency) {
      if (transitionSeconds <= 0 && 'value' in filter.frequency) {
        filter.frequency.value = mix.lowPassHz;
      } else {
        setGainTarget(filter.frequency, mix.lowPassHz, nowTime, timeConst);
      }
    }
  }

  function createBusChain(name) {
    const mix = resolveBusMix(name);
    busFilterFreqs[name] = mix.lowPassHz;
    const node = context.createGain();
    node.gain.value = mix.volume;
    if (typeof context.createBiquadFilter === 'function') {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      if (filter.frequency && 'value' in filter.frequency) filter.frequency.value = mix.lowPassHz;
      if (filter.Q && 'value' in filter.Q) filter.Q.value = 0.707;
      node.connect(filter);
      filter.connect(busTarget);
      busFilters.set(name, filter);
    } else {
      node.connect(busTarget);
    }
    busNodes.set(name, node);
    return node;
  }

  function ensureContext() {
    if (context) return context;
    if (typeof AudioContextClass !== 'function') throw new Error('Web Audio is not supported in this browser');
    context = new AudioContextClass();
    master = context.createGain();
    master.gain.value = muted ? 0 : currentVolume;
    master.connect(context.destination);

    if (compressor !== false && typeof context.createDynamicsCompressor === 'function') {
      const comp = context.createDynamicsCompressor();
      if (comp.threshold && 'value' in comp.threshold) comp.threshold.value = -10;
      if (comp.knee && 'value' in comp.knee) comp.knee.value = 6;
      if (comp.ratio && 'value' in comp.ratio) comp.ratio.value = 6;
      if (comp.attack && 'value' in comp.attack) comp.attack.value = 0.002;
      if (comp.release && 'value' in comp.release) comp.release.value = 0.14;
      comp.connect(master);
      busTarget = comp;
    } else {
      busTarget = master;
    }

    for (const name of Object.keys(busVolumes)) {
      createBusChain(name);
    }

    applyListenerOrientation(context.listener, listenerState);
    return context;
  }

  function getBusNode(busName) {
    const key = typeof busName === 'string' && busName ? busName : 'sfx';
    let node = busNodes.get(key);
    if (!node && context && busTarget) {
      if (!(key in busVolumes)) busVolumes[key] = 1;
      node = createBusChain(key);
    }
    return node || master;
  }

  async function unlock() {
    const audioContext = ensureContext();
    if (audioContext.state === 'suspended') await audioContext.resume();
    return audioContext;
  }

  function setVolume(value) {
    currentVolume = clamp(Number(value) || 0, 0, 1);
    if (master && context) setGainTarget(master.gain, muted ? 0 : currentVolume, context.currentTime || 0, 0.01);
    return currentVolume;
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (master && context) setGainTarget(master.gain, muted ? 0 : currentVolume, context.currentTime || 0, 0.01);
    return muted;
  }

  function setBusVolume(busName, value) {
    if (typeof busName !== 'string' || !busName) throw new TypeError('busName must be a non-empty string');
    const clamped = clamp(Number(value) || 0, 0, 1.5);
    busVolumes[busName] = clamped;
    applyBusMixToNodes(busName, 0.045);
    return clamped;
  }

  function getBusVolume(busName) {
    return busVolumes[busName] ?? 1;
  }

  function registerSnapshot(name, config = {}) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new TypeError('Audio snapshot requires a non-empty string name');
    }
    const normalized = {
      name,
      buses: config.buses && typeof config.buses === 'object' ? { ...config.buses } : {},
      defaultLowPassHz: config.defaultLowPassHz ?? null,
      transitionSeconds: Math.max(0, Number(config.transitionSeconds) || 0.2),
    };
    snapshots.set(name, normalized);
    return normalized;
  }

  function applySnapshot(nameOrConfig, { transitionSeconds = null } = {}) {
    let spec;
    if (typeof nameOrConfig === 'string') {
      spec = snapshots.get(nameOrConfig);
      if (!spec) throw new RangeError(`Unknown audio mix snapshot: "${nameOrConfig}"`);
    } else if (nameOrConfig && typeof nameOrConfig === 'object') {
      spec = {
        name: typeof nameOrConfig.name === 'string' && nameOrConfig.name ? nameOrConfig.name : 'inline',
        buses: nameOrConfig.buses && typeof nameOrConfig.buses === 'object' ? { ...nameOrConfig.buses } : {},
        defaultLowPassHz: nameOrConfig.defaultLowPassHz ?? null,
        transitionSeconds: Math.max(0, Number(nameOrConfig.transitionSeconds) || 0.2),
      };
    } else {
      throw new TypeError('applySnapshot requires a snapshot name or config object');
    }

    activeSnapshot = spec;
    const fade = transitionSeconds !== null ? Math.max(0, Number(transitionSeconds) || 0) : spec.transitionSeconds;
    const busSet = new Set([
      ...Object.keys(busVolumes),
      ...busNodes.keys(),
      ...Object.keys(spec.buses),
    ]);
    for (const busName of busSet) {
      if (!(busName in busVolumes)) busVolumes[busName] = 1;
      if (context && !busNodes.has(busName)) getBusNode(busName);
      applyBusMixToNodes(busName, fade);
    }
    return spec.name;
  }

  function clearSnapshot({ transitionSeconds = 0.2 } = {}) {
    if (!activeSnapshot) return false;
    activeSnapshot = null;
    const fade = Math.max(0, Number(transitionSeconds) || 0);
    const busSet = new Set([...Object.keys(busVolumes), ...busNodes.keys()]);
    for (const busName of busSet) {
      applyBusMixToNodes(busName, fade);
    }
    return true;
  }

  function duckBus(busName, factor = 0.55, durationMs = 250) {
    if (typeof busName !== 'string' || !busName) return false;
    const prevTimer = duckTimers.get(busName);
    if (prevTimer) clearTimeout(prevTimer);
    const node = getBusNode(busName);
    if (!node || !context) return false;
    const base = resolveBusMix(busName).volume;
    const target = base * clamp(Number(factor) || 0, 0, 1);
    setGainTarget(node.gain, target, context.currentTime || 0, 0.012);
    const ms = Math.max(10, Number(durationMs) || 250);
    const timer = setTimeout(() => {
      duckTimers.delete(busName);
      if (context) {
        const liveNode = busNodes.get(busName);
        if (liveNode) setGainTarget(liveNode.gain, resolveBusMix(busName).volume, context.currentTime || 0, 0.08);
      }
    }, ms);
    duckTimers.set(busName, timer);
    return true;
  }

  function setOcclusionProbe(fn) {
    occlusionProbe = typeof fn === 'function' ? fn : null;
  }

  function updateOcclusion() {
    for (const handle of activeSources) {
      handle.refreshOcclusion?.();
    }
  }

  function setListener(next = {}) {
    if (Number.isFinite(next.x)) listenerState.x = next.x;
    if (Number.isFinite(next.y)) listenerState.y = next.y;
    if (Number.isFinite(next.z)) listenerState.z = next.z;
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
    if (context?.listener) applyListenerOrientation(context.listener, listenerState);
    if (occlusionProbe) updateOcclusion();
    return { ...listenerState };
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

  function computeSpatialMetrics(posArg, opts) {
    const {
      pan: explicitPan = null,
      position = null,
      position2D = null,
      refDistance = 3,
      maxDistance = 400,
      rolloffFactor = 0.8,
      panRange = 480,
    } = opts;

    const is3DArg = posArg && (('z' in posArg) || (Array.isArray(posArg) && posArg.length >= 3));
    const p3 = parsePosition3D(posArg ? (is3DArg ? posArg : null) : position);
    if (p3) {
      const dx = p3.x - listenerState.x;
      const dy = p3.y - listenerState.y;
      const dz = p3.z - listenerState.z;
      const dist = Math.hypot(dx, dy, dz);
      // Right-hand ear axis: forward x up
      const rxRaw = listenerState.forwardY * listenerState.upZ - listenerState.forwardZ * listenerState.upY;
      const ryRaw = listenerState.forwardZ * listenerState.upX - listenerState.forwardX * listenerState.upZ;
      const rzRaw = listenerState.forwardX * listenerState.upY - listenerState.forwardY * listenerState.upX;
      const [rx, ry, rz] = normalizeVec3(rxRaw, ryRaw, rzRaw, 1, 0, 0);
      const computedPan = dist > 1e-6 ? clamp((dx * rx + dy * ry + dz * rz) / dist, -1, 1) : 0;
      const ref = Math.max(0.1, Number(refDistance) || 3);
      const roll = Math.max(0, Number(rolloffFactor) || 0);
      const effDist = Math.min(dist, Math.max(ref, Number(maxDistance) || 400));
      const distanceGain = clamp(ref / (ref + roll * Math.max(0, effDist - ref)), 0, 1);
      return { kind: '3d', pos3: p3, pan: computedPan, distanceGain };
    }

    const p2 = parsePosition2D(posArg || position2D);
    if (p2) {
      const dx = p2.x - listenerState.x;
      const dy = p2.y - listenerState.y;
      const dist = Math.hypot(dx, dy);
      const range = Math.max(1, Number(panRange) || 480);
      const computedPan = clamp(dx / range, -1, 1);
      const ref2 = Math.max(1, Number(opts.refDistance2D ?? refDistance * 40) || 120);
      const roll2 = Math.max(0, Number(rolloffFactor) || 0.8);
      const distanceGain = clamp(ref2 / (ref2 + roll2 * Math.max(0, dist - ref2)), 0, 1);
      return { kind: '2d', pos2: p2, pan: computedPan, distanceGain };
    }

    if (Number.isFinite(explicitPan)) {
      return { kind: 'pan', pan: clamp(explicitPan, -1, 1), distanceGain: 1 };
    }

    return { kind: 'none', pan: 0, distanceGain: 1 };
  }

  async function decode(arrayBuffer) {
    const audioContext = await unlock();
    return audioContext.decodeAudioData(arrayBuffer.slice(0));
  }

  async function play(buffer, {
    volume: soundVolume = 1,
    loop = false,
    playbackRate = 1,
    pitchJitter = 0,
    gainJitter = 0,
    cooldownMs = 0,
    key = null,
    bus = null,
    pan = null,
    position = null,
    position2D = null,
    hrtf = true,
    distanceModel = 'inverse',
    refDistance = 3,
    maxDistance = 400,
    rolloffFactor = 0.8,
    panRange = 480,
    trimSilence = true,
    offset = null,
    duration = null,
    tailFadeSec = 0,
    occlusion = null,
    occludedLowPassHz = 550,
    occludedGainScale = 0.45,
    openLowPassHz = 22000,
    onEnded = null,
    random = Math.random,
  } = {}) {
    if (muted) return null;

    if (cooldownMs > 0) {
      const currentNow = now();
      let lastTime = -Infinity;
      if (typeof key === 'string' && key) {
        lastTime = keyCooldowns.get(key) ?? -Infinity;
        if (currentNow - lastTime < cooldownMs) return null;
        keyCooldowns.set(key, currentNow);
      } else if (buffer && typeof buffer === 'object') {
        lastTime = bufferCooldowns.get(buffer) ?? -Infinity;
        if (currentNow - lastTime < cooldownMs) return null;
        bufferCooldowns.set(buffer, currentNow);
      }
    }

    const isLoop = Boolean(loop);
    const evictForSlot = () => {
      while (activeSources.size >= maxPolyphony) {
        let evicted = null;
        for (const candidate of activeSources) {
          if (!candidate.loop) {
            evicted = candidate;
            break;
          }
        }
        if (!evicted) {
          if (!isLoop) return false;
          evicted = activeSources.values().next().value;
        }
        if (!evicted) break;
        evicted.stop();
      }
      return true;
    };
    if (!evictForSlot()) return null;

    const audioContext = await unlock();
    if (!context || !master || !evictForSlot()) return null;

    const spatialOpts = { pan, position, position2D, refDistance, maxDistance, rolloffFactor, panRange };
    let spatial = computeSpatialMetrics(null, spatialOpts);

    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = buffer;
    source.loop = isLoop;

    const baseRate = Math.max(0.05, Number(playbackRate) || 1);
    const pJitter = Math.max(0, Number(pitchJitter) || 0);
    const rate = pJitter > 0
      ? clamp(baseRate * (1 + (random() * 2 - 1) * pJitter), 0.05, 4)
      : baseRate;
    source.playbackRate.value = rate;

    const gJitter = Math.max(0, Number(gainJitter) || 0);
    let currentBaseVolume = clamp(Number(soundVolume) || 0, 0, 2) * (gJitter > 0 ? (1 - random() * gJitter) : 1);

    const minCutoffHz = clamp(Number(occludedLowPassHz) || 550, 60, 22000);
    const maxCutoffHz = clamp(Math.max(minCutoffHz, Number(openLowPassHz) || 22000), 60, 22000);
    const minGainScale = clamp(Number(occludedGainScale) || 0.45, 0, 1);
    let autoOcclusion = occlusion == null;
    let currentOcclusion = occlusion != null ? clamp(Number(occlusion) || 0, 0, 1) : 0;
    let occlusionLowPassOverride = null;
    let occlusionGainOverride = null;

    function evaluateProbeOcclusion() {
      if (!occlusionProbe) return currentOcclusion;
      const srcPos = spatial.pos3 ?? spatial.pos2 ?? null;
      if (!srcPos) return currentOcclusion;
      const res = occlusionProbe(srcPos, { ...listenerState }, { bus: bus ?? 'sfx', spatial });
      if (typeof res === 'number' && Number.isFinite(res)) {
        occlusionLowPassOverride = null;
        occlusionGainOverride = null;
        return clamp(res, 0, 1);
      }
      if (res && typeof res === 'object') {
        occlusionLowPassOverride = Number.isFinite(res.lowPassHz) ? clamp(res.lowPassHz, 60, 22000) : null;
        occlusionGainOverride = Number.isFinite(res.gainScale) ? clamp(res.gainScale, 0, 1) : null;
        return clamp(Number(res.occlusion) || 0, 0, 1);
      }
      return currentOcclusion;
    }

    if (autoOcclusion && occlusionProbe) {
      currentOcclusion = evaluateProbeOcclusion();
    }

    const busName = bus ?? ((position || position2D) ? 'spatial' : 'sfx');
    const targetBus = getBusNode(busName);

    let occlusionNode = null;
    if (typeof audioContext.createBiquadFilter === 'function') {
      occlusionNode = audioContext.createBiquadFilter();
      occlusionNode.type = 'lowpass';
      if (occlusionNode.Q && 'value' in occlusionNode.Q) occlusionNode.Q.value = 0.707;
    }

    function getOcclusionGainScale() {
      if (occlusionGainOverride !== null) return occlusionGainOverride;
      return 1 - (1 - minGainScale) * currentOcclusion;
    }

    function getOcclusionCutoffHz() {
      if (occlusionLowPassOverride !== null) return occlusionLowPassOverride;
      if (currentOcclusion <= 0) return maxCutoffHz;
      return maxCutoffHz * Math.pow(minCutoffHz / maxCutoffHz, currentOcclusion);
    }

    if (occlusionNode?.frequency && 'value' in occlusionNode.frequency) {
      occlusionNode.frequency.value = getOcclusionCutoffHz();
    }

    source.connect(gain);
    const postGainNode = occlusionNode ?? gain;
    if (occlusionNode) gain.connect(occlusionNode);

    let pannerNode = null;
    let stereoNode = null;
    let distanceAppliedNatively = false;

    if (spatial.kind === '3d' && typeof audioContext.createPanner === 'function') {
      pannerNode = audioContext.createPanner();
      pannerNode.panningModel = hrtf !== false ? 'HRTF' : 'equalpower';
      pannerNode.distanceModel = distanceModel;
      pannerNode.refDistance = Math.max(0.1, Number(refDistance) || 3);
      pannerNode.maxDistance = Math.max(pannerNode.refDistance, Number(maxDistance) || 400);
      pannerNode.rolloffFactor = Math.max(0, Number(rolloffFactor) || 0.8);
      if (pannerNode.coneInnerAngle !== undefined) pannerNode.coneInnerAngle = 360;
      applyAudioParamOrMethod(pannerNode, spatial.pos3.x, spatial.pos3.y, spatial.pos3.z);
      postGainNode.connect(pannerNode);
      pannerNode.connect(targetBus);
      distanceAppliedNatively = true;
    } else if (spatial.kind !== 'none' && typeof audioContext.createStereoPanner === 'function') {
      stereoNode = audioContext.createStereoPanner();
      if (stereoNode.pan && 'value' in stereoNode.pan) stereoNode.pan.value = spatial.pan;
      postGainNode.connect(stereoNode);
      stereoNode.connect(targetBus);
    } else {
      postGainNode.connect(targetBus);
    }

    const effectiveGain = clamp(
      currentBaseVolume * (distanceAppliedNatively ? 1 : spatial.distanceGain) * getOcclusionGainScale(),
      0,
      2,
    );
    gain.gain.value = effectiveGain;

    const info = trimSilence !== false ? getCachedAnalysis(buffer) : analyzeAudioBuffer(null);
    const startAt = Number.isFinite(audioContext.currentTime) ? audioContext.currentTime : 0;
    let startOffset = 0;
    let playDur = null;

    if (isLoop) {
      if (info.analyzable && (info.trimStart > 0 || info.trimEnd < info.duration - 1e-4)) {
        source.loopStart = info.trimStart;
        source.loopEnd = info.trimEnd;
      }
      startOffset = offset !== null ? Math.max(0, Number(offset) || 0) : (info.analyzable ? info.trimStart : 0);
      if (startOffset > 0) source.start(startAt, startOffset);
      else source.start();
    } else {
      startOffset = offset !== null ? Math.max(0, Number(offset) || 0) : (info.analyzable ? info.trimStart : 0);
      if (duration !== null && Number(duration) > 0) {
        playDur = Number(duration);
      } else if (info.analyzable && info.trimEnd < info.duration - 1e-4) {
        playDur = info.activeDuration;
      }

      if (playDur !== null && tailFadeSec > 0
        && typeof gain.gain.setValueAtTime === 'function'
        && typeof gain.gain.linearRampToValueAtTime === 'function') {
        const wallDur = playDur / rate;
        const fadeLen = Math.min(wallDur * 0.5, tailFadeSec / rate);
        const fadeStart = startAt + Math.max(0, wallDur - fadeLen);
        gain.gain.setValueAtTime(effectiveGain, fadeStart);
        gain.gain.linearRampToValueAtTime(0.0001, startAt + wallDur);
      }

      if (playDur !== null) {
        source.start(startAt, startOffset, playDur);
      } else if (startOffset > 0) {
        source.start(startAt, startOffset);
      } else {
        source.start();
      }
    }

    function syncVoiceGainAndFilter(smoothSeconds = 0.02) {
      const t = Number.isFinite(context?.currentTime) ? context.currentTime : 0;
      const tc = Math.max(0.005, (Number(smoothSeconds) || 0.02) / 3);
      const nextGain = clamp(
        currentBaseVolume * (distanceAppliedNatively ? 1 : spatial.distanceGain) * getOcclusionGainScale(),
        0,
        2,
      );
      if (smoothSeconds <= 0 && 'value' in gain.gain) gain.gain.value = nextGain;
      else setGainTarget(gain.gain, nextGain, t, tc);
      if (occlusionNode?.frequency) {
        const nextHz = getOcclusionCutoffHz();
        if (smoothSeconds <= 0 && 'value' in occlusionNode.frequency) occlusionNode.frequency.value = nextHz;
        else setGainTarget(occlusionNode.frequency, nextHz, t, tc);
      }
    }

    const handle = {
      loop: isLoop,
      playbackRate: rate,
      bus: busName,
      variant: -1,
      get pan() { return spatial.pan; },
      get distanceGain() { return spatial.distanceGain; },
      get occlusion() { return currentOcclusion; },
      get lowPassHz() { return getOcclusionCutoffHz(); },
      setPosition(nextPos) {
        spatial = computeSpatialMetrics(nextPos, spatialOpts);
        if (pannerNode && spatial.pos3) {
          applyAudioParamOrMethod(pannerNode, spatial.pos3.x, spatial.pos3.y, spatial.pos3.z);
        } else if (stereoNode?.pan && 'value' in stereoNode.pan) {
          stereoNode.pan.value = spatial.pan;
        }
        if (autoOcclusion && occlusionProbe) {
          currentOcclusion = evaluateProbeOcclusion();
        }
        syncVoiceGainAndFilter(0.015);
        return handle;
      },
      setOcclusion(nextValue, { smoothSeconds = 0.04, lowPassHz = null, gainScale = null } = {}) {
        autoOcclusion = false;
        currentOcclusion = clamp(Number(nextValue) || 0, 0, 1);
        occlusionLowPassOverride = lowPassHz !== null && Number.isFinite(lowPassHz)
          ? clamp(lowPassHz, 60, 22000)
          : null;
        occlusionGainOverride = gainScale !== null && Number.isFinite(gainScale)
          ? clamp(gainScale, 0, 1)
          : null;
        syncVoiceGainAndFilter(smoothSeconds);
        return handle;
      },
      refreshOcclusion({ smoothSeconds = 0.04 } = {}) {
        if (!autoOcclusion || !occlusionProbe) return currentOcclusion;
        currentOcclusion = evaluateProbeOcclusion();
        syncVoiceGainAndFilter(smoothSeconds);
        return currentOcclusion;
      },
      setVolume(nextVol) {
        currentBaseVolume = clamp(Number(nextVol) || 0, 0, 2);
        syncVoiceGainAndFilter(0.015);
        return handle;
      },
      setPlaybackRate(nextRate) {
        const clamped = clamp(Number(nextRate) || 1, 0.05, 4);
        source.playbackRate.value = clamped;
        handle.playbackRate = clamped;
        return handle;
      },
      stop({ fadeOutMs = 0 } = {}) {
        activeSources.delete(handle);
        const fadeSec = Math.max(0, (Number(fadeOutMs) || 0) * 0.001);
        const nowTime = Number.isFinite(context?.currentTime) ? context.currentTime : 0;
        if (fadeSec > 0 && typeof gain.gain.setTargetAtTime === 'function') {
          try {
            gain.gain.setTargetAtTime(0, nowTime, fadeSec / 3);
            source.stop(nowTime + fadeSec);
            return;
          } catch { /* Fall through to immediate stop. */ }
        }
        try { source.stop(); } catch { /* Already stopped. */ }
      },
    };
    source.addEventListener?.('ended', () => {
      activeSources.delete(handle);
      if (typeof onEnded === 'function') onEnded(handle);
    }, { once: true });
    activeSources.add(handle);
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
    const variants = cfg.variants;
    const normalized = normalizeVariantSet(variants, {
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
    const cueRecord = {
      name,
      bus: cfg.bus ?? null,
      volume: cfg.volume ?? 1,
      pitchJitter: cfg.pitchJitter ?? 0.02,
      gainJitter: cfg.gainJitter ?? 0.04,
      cooldownMs: cfg.cooldownMs ?? 0,
      maxConcurrent: Math.max(1, Number(cfg.maxConcurrent) || 4),
      hrtf: cfg.hrtf !== false,
      refDistance: cfg.refDistance ?? 3,
      maxDistance: cfg.maxDistance ?? 400,
      rolloffFactor: cfg.rolloffFactor ?? 0.8,
      panRange: cfg.panRange ?? 480,
      trimSilence: cfg.trimSilence !== false,
      normalized,
      lastVariant: -1,
      activeHandles: new Set(),
    };
    cues.set(name, cueRecord);
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

    // Evict excess concurrent voices for this specific cue before checking cooldown-free playback
    if (cooldownMs <= 0) {
      while (entry.activeHandles.size >= entry.maxConcurrent) {
        const oldest = entry.activeHandles.values().next().value;
        if (!oldest) break;
        entry.activeHandles.delete(oldest);
        oldest.stop({ fadeOutMs: 8 });
      }
    }

    const v = entry.normalized.variants[chosenIndex];
    const requestedVol = (overrides.volume ?? entry.volume) * v.gainScale;
    const prevLast = entry.lastVariant;
    entry.lastVariant = chosenIndex;
    const needsTrimmedDuration = v.analyzable && entry.trimSilence
      && v.playDuration > 0
      && (v.tailFadeSec > 0 || v.playDuration < v.duration - 1e-4);

    let handleRef = null;
    const handle = await play(v.buffer, {
      bus: overrides.bus ?? entry.bus ?? ((overrides.position || overrides.position2D) ? 'spatial' : 'sfx'),
      volume: requestedVol,
      loop: overrides.loop ?? false,
      playbackRate: overrides.playbackRate ?? 1,
      pitchJitter: overrides.pitchJitter ?? entry.pitchJitter,
      gainJitter: overrides.gainJitter ?? entry.gainJitter,
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

    handleRef = handle;
    handle.variant = chosenIndex;
    const origStop = handle.stop;
    handle.stop = (stopOpts) => {
      entry.activeHandles.delete(handle);
      return origStop(stopOpts);
    };
    while (entry.activeHandles.size >= entry.maxConcurrent) {
      const oldest = entry.activeHandles.values().next().value;
      if (!oldest) break;
      oldest.stop({ fadeOutMs: 8 });
    }
    entry.activeHandles.add(handle);
    return handle;
  }

  function hasCue(name) {
    return cues.has(name);
  }

  function dispose() {
    for (const timer of duckTimers.values()) clearTimeout(timer);
    duckTimers.clear();
    for (const source of [...activeSources]) source.stop();
    activeSources.clear();
    for (const cue of cues.values()) cue.activeHandles.clear();
    cues.clear();
    keyCooldowns.clear();
    busNodes.clear();
    busFilters.clear();
    snapshots.clear();
    activeSnapshot = null;
    occlusionProbe = null;
    const closing = context?.close?.();
    context = null;
    master = null;
    busTarget = null;
    return closing;
  }

  return Object.freeze({
    get volume() { return currentVolume; },
    get muted() { return muted; },
    get activeCount() { return activeSources.size; },
    get available() { return typeof AudioContextClass === 'function'; },
    get listener() { return { ...listenerState }; },
    get activeSnapshot() { return activeSnapshot ? activeSnapshot.name : null; },
    unlock,
    decode,
    play,
    registerCue,
    playCue,
    inspectCue,
    hasCue,
    setVolume,
    setMuted,
    setBusVolume,
    getBusVolume,
    duckBus,
    registerSnapshot,
    applySnapshot,
    clearSnapshot,
    setOcclusionProbe,
    updateOcclusion,
    setListener,
    updateListenerFromCamera,
    dispose,
  });
}
