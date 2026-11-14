const DEFAULT_BUS_VOLUMES = Object.freeze({
  sfx: 1,
  spatial: 1,
  music: 0.75,
  ambience: 0.7,
});

function clamp(value, min, max) {
  return value < min ? min : (value > max ? max : value);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) * 0.5;
}

function normalizeVec3(x, y, z, fx, fy, fz) {
  const len = Math.hypot(x, y, z);
  if (!(len > 1e-8)) return [fx, fy, fz];
  return [x / len, y / len, z / len];
}

function parsePosition3D(pos) {
  if (!pos) return null;
  if (Array.isArray(pos)) {
    return {
      x: Number(pos[0]) || 0,
      y: Number(pos[1]) || 0,
      z: Number(pos[2]) || 0,
    };
  }
  return {
    x: Number(pos.x) || 0,
    y: Number(pos.y) || 0,
    z: Number(pos.z) || 0,
  };
}

function parsePosition2D(pos) {
  if (!pos) return null;
  if (Array.isArray(pos)) {
    return {
      x: Number(pos[0]) || 0,
      y: Number(pos[1]) || 0,
    };
  }
  return {
    x: Number(pos.x) || 0,
    y: Number(pos.y) || 0,
  };
}

function applyAudioParamOrMethod(node, x, y, z) {
  if (!node) return;
  if (node.positionX && typeof node.positionX === 'object' && 'value' in node.positionX) {
    node.positionX.value = x;
    node.positionY.value = y;
    node.positionZ.value = z;
  } else if (typeof node.setPosition === 'function') {
    node.setPosition(x, y, z);
  }
}

function applyListenerOrientation(listener, state) {
  if (!listener) return;
  applyAudioParamOrMethod(listener, state.x, state.y, state.z);
  if (listener.forwardX && typeof listener.forwardX === 'object' && 'value' in listener.forwardX) {
    listener.forwardX.value = state.forwardX;
    listener.forwardY.value = state.forwardY;
    listener.forwardZ.value = state.forwardZ;
    listener.upX.value = state.upX;
    listener.upY.value = state.upY;
    listener.upZ.value = state.upZ;
  } else if (typeof listener.setOrientation === 'function') {
    listener.setOrientation(
      state.forwardX, state.forwardY, state.forwardZ,
      state.upX, state.upY, state.upZ,
    );
  }
}

function setGainTarget(gainParam, value, currentTime, timeConstant = 0.01) {
  if (!gainParam) return;
  if (typeof gainParam.setTargetAtTime === 'function') {
    gainParam.setTargetAtTime(value, currentTime, timeConstant);
  } else {
    gainParam.value = value;
  }
}

/**
 * Inspects decoded PCM AudioBuffer data to strip encoder padding / trailing silence
 * and compute active duration, RMS loudness, and peak amplitude.
 */
export function analyzeAudioBuffer(buffer, {
  silenceThreshold = 0.0035,
  minActiveDuration = 0.01,
} = {}) {
  if (!buffer || typeof buffer.getChannelData !== 'function' || !(buffer.sampleRate > 0) || !(buffer.length > 0)) {
    const rawDuration = Number(buffer?.duration) || 0;
    return {
      analyzable: false,
      duration: rawDuration,
      trimStart: 0,
      trimEnd: rawDuration,
      activeDuration: rawDuration,
      rms: 0,
      peak: 0,
    };
  }

  const length = buffer.length;
  const sampleRate = buffer.sampleRate;
  const duration = length / sampleRate;
  const channels = Math.max(1, Number(buffer.numberOfChannels) || 1);
  const channelData = new Array(channels);
  for (let c = 0; c < channels; c++) {
    channelData[c] = buffer.getChannelData(c);
  }

  let firstNonSilent = -1;
  let lastNonSilent = -1;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      if (Math.abs(channelData[c][i]) >= silenceThreshold) {
        firstNonSilent = i;
        break;
      }
    }
    if (firstNonSilent !== -1) break;
  }

  if (firstNonSilent === -1) {
    return {
      analyzable: true,
      duration,
      trimStart: 0,
      trimEnd: duration,
      activeDuration: Math.max(minActiveDuration, duration),
      rms: 0,
      peak: 0,
    };
  }

  for (let i = length - 1; i >= firstNonSilent; i--) {
    for (let c = 0; c < channels; c++) {
      if (Math.abs(channelData[c][i]) >= silenceThreshold) {
        lastNonSilent = i;
        break;
      }
    }
    if (lastNonSilent !== -1) break;
  }

  const preGuard = Math.round(sampleRate * 0.0015);
  const postGuard = Math.round(sampleRate * 0.003);
  const startIdx = Math.max(0, firstNonSilent - preGuard);
  const endIdx = Math.min(length - 1, Math.max(firstNonSilent, lastNonSilent + postGuard));

  let sumSq = 0;
  let peak = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = channelData[c][i];
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSq += sample * sample;
    }
  }
  const sampleCount = (endIdx - startIdx + 1) * channels;
  const rms = sampleCount > 0 ? Math.sqrt(sumSq / sampleCount) : 0;
  const trimStart = startIdx / sampleRate;
  const trimEnd = (endIdx + 1) / sampleRate;
  const activeDuration = Math.max(minActiveDuration, trimEnd - trimStart);

  return {
    analyzable: true,
    duration,
    trimStart,
    trimEnd,
    activeDuration,
    rms,
    peak,
  };
}

/**
 * Normalizes a pool of 1-4 SFX variant buffers so loudness stays balanced
 * and overly long outlier tails are flagged and optionally trimmed to stay tight.
 */
export function normalizeVariantSet(buffers, {
  silenceThreshold = 0.0035,
  normalizeRms = true,
  maxDurationSpreadRatio = 0.28,
  alignDuration = true,
  gainClamp = [0.55, 1.65],
} = {}) {
  if (!Array.isArray(buffers) || buffers.length === 0) {
    throw new TypeError('normalizeVariantSet requires a non-empty array of audio buffers');
  }

  const minGain = Array.isArray(gainClamp) ? Number(gainClamp[0]) || 0.55 : 0.55;
  const maxGain = Array.isArray(gainClamp) ? Number(gainClamp[1]) || 1.65 : 1.65;
  const analyses = buffers.map(buffer => analyzeAudioBuffer(buffer, { silenceThreshold }));
  const activeDurations = [];
  const activeRms = [];

  for (const info of analyses) {
    if (info.analyzable) {
      activeDurations.push(info.activeDuration);
      if (info.rms > 1e-5) activeRms.push(info.rms);
    }
  }

  const medianDuration = median(activeDurations);
  const medianRms = median(activeRms);
  const maxAllowedDuration = medianDuration > 0 ? medianDuration * (1 + maxDurationSpreadRatio) : 0;

  let durationSpreadRatio = 0;
  const variants = buffers.map((buffer, index) => {
    const info = analyses[index];
    const gainScale = (normalizeRms && info.analyzable && medianRms > 1e-5 && info.rms > 1e-5)
      ? clamp(medianRms / info.rms, minGain, maxGain)
      : 1;
    const deviationRatio = medianDuration > 0
      ? Math.abs(info.activeDuration - medianDuration) / Math.max(0.02, medianDuration)
      : 0;
    if (deviationRatio > durationSpreadRatio) durationSpreadRatio = deviationRatio;
    const consistent = deviationRatio <= maxDurationSpreadRatio;
    const clampedTail = alignDuration && info.analyzable && maxAllowedDuration > 0 && info.activeDuration > maxAllowedDuration;
    const playDuration = clampedTail
      ? maxAllowedDuration
      : (info.analyzable ? info.activeDuration : 0);
    const tailFadeSec = clampedTail ? Math.min(0.04, playDuration * 0.2) : 0;

    return {
      index,
      buffer,
      ...info,
      gainScale,
      deviationRatio,
      consistent,
      playDuration,
      tailFadeSec,
    };
  });

  return {
    variants,
    medianDuration,
    medianRms,
    durationSpreadRatio,
    allConsistent: variants.every(v => v.consistent),
  };
}

/**
 * Web Audio manager supporting buses, master dynamics limiter, 3D HRTF / 2D left-right
 * spatialization, MP3 encoder-padding trimming, polyphony control, and multi-variant cues.
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
