import {
  DEFAULT_BUS_VOLUMES,
  clamp,
  applyListenerOrientation,
  setGainTarget,
} from './helpers.js';

/**
 * Manages AudioContext initialization, master gain/compressor, per-bus chains,
 * snapshots, and temporary bus ducking.
 * @param {object} ctx Shared mutable audio manager state.
 */
export function createAudioBusController(ctx) {
  const {
    AudioContextClass,
    compressor,
    listenerState,
  } = ctx;

  const busVolumes = { ...DEFAULT_BUS_VOLUMES };
  const busNodes = new Map();
  const busFilters = new Map();
  const busFilterFreqs = Object.create(null);
  const snapshots = new Map();
  const duckTimers = new Map();

  function resolveBusMix(busName) {
    const userVol = busVolumes[busName] ?? 1;
    if (!ctx.activeSnapshot) {
      return { volume: userVol, lowPassHz: 22000 };
    }
    const busOverride = ctx.activeSnapshot.buses?.[busName];
    const volume = busOverride?.volume !== undefined
      ? clamp(Number(busOverride.volume) || 0, 0, 1.5)
      : (busOverride?.gainScale !== undefined
        ? clamp(userVol * (Number(busOverride.gainScale) || 0), 0, 1.5)
        : userVol);
    const rawHz = busOverride?.lowPassHz ?? busOverride?.filterHz ?? ctx.activeSnapshot.defaultLowPassHz ?? 22000;
    const lowPassHz = clamp(Number(rawHz) || 22000, 60, 22000);
    return { volume, lowPassHz };
  }

  function applyBusMixToNodes(busName, transitionSeconds = 0.15) {
    const mix = resolveBusMix(busName);
    busFilterFreqs[busName] = mix.lowPassHz;
    if (!ctx.context) return;
    const nowTime = Number.isFinite(ctx.context.currentTime) ? ctx.context.currentTime : 0;
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
    const node = ctx.context.createGain();
    node.gain.value = mix.volume;
    if (typeof ctx.context.createBiquadFilter === 'function') {
      const filter = ctx.context.createBiquadFilter();
      filter.type = 'lowpass';
      if (filter.frequency && 'value' in filter.frequency) filter.frequency.value = mix.lowPassHz;
      if (filter.Q && 'value' in filter.Q) filter.Q.value = 0.707;
      node.connect(filter);
      filter.connect(ctx.busTarget);
      busFilters.set(name, filter);
    } else {
      node.connect(ctx.busTarget);
    }
    busNodes.set(name, node);
    return node;
  }

  function ensureContext() {
    if (ctx.context) return ctx.context;
    if (typeof AudioContextClass !== 'function') throw new Error('Web Audio is not supported in this browser');
    const audioContext = new AudioContextClass();
    ctx.context = audioContext;
    ctx.master = audioContext.createGain();
    ctx.master.gain.value = ctx.muted ? 0 : ctx.currentVolume;
    ctx.master.connect(audioContext.destination);

    if (compressor !== false && typeof audioContext.createDynamicsCompressor === 'function') {
      const comp = audioContext.createDynamicsCompressor();
      if (comp.threshold && 'value' in comp.threshold) comp.threshold.value = -10;
      if (comp.knee && 'value' in comp.knee) comp.knee.value = 6;
      if (comp.ratio && 'value' in comp.ratio) comp.ratio.value = 6;
      if (comp.attack && 'value' in comp.attack) comp.attack.value = 0.002;
      if (comp.release && 'value' in comp.release) comp.release.value = 0.14;
      comp.connect(ctx.master);
      ctx.busTarget = comp;
    } else {
      ctx.busTarget = ctx.master;
    }

    for (const name of Object.keys(busVolumes)) {
      createBusChain(name);
    }

    applyListenerOrientation(audioContext.listener, listenerState);
    return audioContext;
  }

  function getBusNode(busName) {
    const key = typeof busName === 'string' && busName ? busName : 'sfx';
    let node = busNodes.get(key);
    if (!node && ctx.context && ctx.busTarget) {
      if (!(key in busVolumes)) busVolumes[key] = 1;
      node = createBusChain(key);
    }
    return node || ctx.master;
  }

  async function unlock() {
    const audioContext = ensureContext();
    if (audioContext.state === 'suspended') await audioContext.resume();
    return audioContext;
  }

  function setVolume(value) {
    ctx.currentVolume = clamp(Number(value) || 0, 0, 1);
    if (ctx.master && ctx.context) {
      setGainTarget(ctx.master.gain, ctx.muted ? 0 : ctx.currentVolume, ctx.context.currentTime || 0, 0.01);
    }
    return ctx.currentVolume;
  }

  function setMuted(value) {
    ctx.muted = Boolean(value);
    if (ctx.master && ctx.context) {
      setGainTarget(ctx.master.gain, ctx.muted ? 0 : ctx.currentVolume, ctx.context.currentTime || 0, 0.01);
    }
    return ctx.muted;
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

    ctx.activeSnapshot = spec;
    const fade = transitionSeconds !== null ? Math.max(0, Number(transitionSeconds) || 0) : spec.transitionSeconds;
    const busSet = new Set([
      ...Object.keys(busVolumes),
      ...busNodes.keys(),
      ...Object.keys(spec.buses),
    ]);
    for (const busName of busSet) {
      if (!(busName in busVolumes)) busVolumes[busName] = 1;
      if (ctx.context && !busNodes.has(busName)) getBusNode(busName);
      applyBusMixToNodes(busName, fade);
    }
    return spec.name;
  }

  function clearSnapshot({ transitionSeconds = 0.2 } = {}) {
    if (!ctx.activeSnapshot) return false;
    ctx.activeSnapshot = null;
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
    if (!node || !ctx.context) return false;
    const base = resolveBusMix(busName).volume;
    const target = base * clamp(Number(factor) || 0, 0, 1);
    setGainTarget(node.gain, target, ctx.context.currentTime || 0, 0.012);
    const ms = Math.max(10, Number(durationMs) || 250);
    const timer = setTimeout(() => {
      duckTimers.delete(busName);
      if (ctx.context) {
        const liveNode = busNodes.get(busName);
        if (liveNode) setGainTarget(liveNode.gain, resolveBusMix(busName).volume, ctx.context.currentTime || 0, 0.08);
      }
    }, ms);
    duckTimers.set(busName, timer);
    return true;
  }

  function dispose() {
    for (const timer of duckTimers.values()) clearTimeout(timer);
    duckTimers.clear();
    busNodes.clear();
    busFilters.clear();
    snapshots.clear();
    ctx.activeSnapshot = null;
  }

  return {
    getBusNode,
    unlock,
    setVolume,
    setMuted,
    setBusVolume,
    getBusVolume,
    registerSnapshot,
    applySnapshot,
    clearSnapshot,
    duckBus,
    dispose,
  };
}
