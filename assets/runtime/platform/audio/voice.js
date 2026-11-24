import {
  clamp,
  normalizeVec3,
  parsePosition3D,
  parsePosition2D,
  applyAudioParamOrMethod,
  setGainTarget,
} from './helpers.js';
import { analyzeAudioBuffer } from './analysis.js';

/**
 * Computes 3D / 2D / explicit stereo spatial pan and distance gain against listenerState.
 * @param {unknown} posArg
 * @param {object} opts
 * @param {import('./helpers.js').AudioListenerState} listenerState
 */
export function computeSpatialMetrics(posArg, opts, listenerState) {
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

/**
 * Instantiates and starts a single Web Audio voice with spatialization, occlusion filter,
 * encoder-padding trimming, and polyphony eviction.
 * @param {object} ctx Shared mutable audio manager state.
 * @param {AudioBuffer} buffer
 * @param {object} [options]
 */
export function playAudioBuffer(ctx, buffer, options) {
  return playVoice(ctx, buffer, null, null, options);
}

export function playAudioMedia(ctx, url, options, reservation) {
  return playVoice(ctx, null, url, reservation, options);
}

function setMediaRate(media, rate) {
  try {
    media.playbackRate = clamp(rate, 0.0625, 4);
  } catch (error) {
    if (error?.name !== 'NotSupportedError') throw error;
  }
  return media.playbackRate;
}

async function playVoice(ctx, buffer, url, reservation, {
  volume: soundVolume = 1,
  loop = false,
  playbackRate = 1,
  pitchJitter = 0,
  gainJitter = 0,
  gainJitterDb = 0,
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
  reverbSend = null,
  onEnded = null,
  onMediaStarted = null,
  random = Math.random,
} = {}) {
  if (ctx.muted || (url && typeof globalThis.Audio !== 'function')) return null;

  if (cooldownMs > 0) {
    const currentNow = ctx.now();
    let lastTime = -Infinity;
    if (typeof key === 'string' && key) {
      lastTime = ctx.keyCooldowns.get(key) ?? -Infinity;
      if (currentNow - lastTime < cooldownMs) return null;
      ctx.keyCooldowns.set(key, currentNow);
    } else if (buffer && typeof buffer === 'object') {
      lastTime = ctx.bufferCooldowns.get(buffer) ?? -Infinity;
      if (currentNow - lastTime < cooldownMs) return null;
      ctx.bufferCooldowns.set(buffer, currentNow);
    }
  }

  const isLoop = Boolean(loop);
  const evictForSlot = () => {
    while (ctx.activeSources.size >= ctx.maxPolyphony) {
      let evicted = null;
      for (const candidate of ctx.activeSources) {
        if (!candidate.loop) {
          evicted = candidate;
          break;
        }
      }
      if (!evicted) {
        if (!isLoop) return false;
        evicted = ctx.activeSources.values().next().value;
      }
      if (!evicted) break;
      evicted.stop();
    }
    return true;
  };
  if (!evictForSlot()) return null;

  const audioContext = url && ctx.hidden && ctx.context ? ctx.context : await ctx.unlock();
  if (reservation?.cancelled || ctx.context !== audioContext || !ctx.master || !evictForSlot()) return null;
  if (url && typeof audioContext.createMediaElementSource !== 'function') return null;

  const busName = bus ?? ((position || position2D) ? 'spatial' : 'sfx');
  const isUiDirect = busName === 'ui_voice' || busName === 'ui';
  const spatialOpts = { pan, position, position2D, refDistance, maxDistance, rolloffFactor, panRange };
  let spatial = isUiDirect
    ? { kind: 'none', pan: 0, distanceGain: 1 }
    : computeSpatialMetrics(null, spatialOpts, ctx.listenerState);

  const media = url ? new globalThis.Audio() : null;
  const source = media ? audioContext.createMediaElementSource(media) : audioContext.createBufferSource();
  const gain = audioContext.createGain();
  if (media) {
    media.crossOrigin = 'anonymous';
    media.preload = 'metadata';
    media.loop = isLoop;
    media.preservesPitch = false;
  } else {
    source.buffer = buffer;
    source.loop = isLoop;
  }

  const baseRate = Math.max(0.05, Number(playbackRate) || 1);
  const pJitter = Math.max(0, Number(pitchJitter) || 0);
  const desiredRate = pJitter > 0
    ? clamp(baseRate * (1 + (random() * 2 - 1) * pJitter), 0.05, 4)
    : baseRate;
  const rate = media ? setMediaRate(media, desiredRate) : desiredRate;
  if (!media) source.playbackRate.value = rate;

  const gJitterDb = Math.max(0, Number(gainJitterDb) || 0);
  const dbScale = gJitterDb > 0 ? Math.pow(10, ((random() * 2 - 1) * gJitterDb) / 20) : 1;
  const gJitter = Math.max(0, Number(gainJitter) || 0);
  let currentBaseVolume = clamp(Number(soundVolume) || 0, 0, 2)
    * dbScale
    * (gJitter > 0 && gJitterDb <= 0 ? (1 - random() * gJitter) : 1);

  const minCutoffHz = clamp(Number(occludedLowPassHz) || 550, 60, 22000);
  const maxCutoffHz = clamp(Math.max(minCutoffHz, Number(openLowPassHz) || 22000), 60, 22000);
  const minGainScale = clamp(Number(occludedGainScale) || 0.45, 0, 1);
  let autoOcclusion = occlusion == null;
  let currentOcclusion = occlusion != null ? clamp(Number(occlusion) || 0, 0, 1) : 0;
  let occlusionLowPassOverride = null;
  let occlusionGainOverride = null;

  function evaluateProbeOcclusion() {
    if (!ctx.occlusionProbe) return currentOcclusion;
    const srcPos = spatial.pos3 ?? spatial.pos2 ?? null;
    if (!srcPos) return currentOcclusion;
    const res = ctx.occlusionProbe(srcPos, { ...ctx.listenerState }, { bus: bus ?? 'sfx', spatial });
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

  if (autoOcclusion && ctx.occlusionProbe) {
    currentOcclusion = evaluateProbeOcclusion();
  }

  const targetBus = ctx.getBusNode(busName);

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
  let finalVoiceNode = postGainNode;

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
    finalVoiceNode = pannerNode;
    distanceAppliedNatively = true;
  } else if (spatial.kind !== 'none' && typeof audioContext.createStereoPanner === 'function') {
    stereoNode = audioContext.createStereoPanner();
    if (stereoNode.pan && 'value' in stereoNode.pan) stereoNode.pan.value = spatial.pan;
    postGainNode.connect(stereoNode);
    stereoNode.connect(targetBus);
    finalVoiceNode = stereoNode;
  } else {
    postGainNode.connect(targetBus);
  }

  // Route real audio signal into the shared wet reverb send bus
  const defaultSend = (busName === 'ui_voice' || busName === 'ui' || busName === 'music' || busName === 'bgm') ? 0 : 1;
  const sendAmount = reverbSend !== null ? clamp(Number(reverbSend) || 0, 0, 1.5) : defaultSend;
  let reverbSendNode = null;
  if (sendAmount > 0 && ctx.reverbSend && typeof audioContext.createGain === 'function') {
    reverbSendNode = audioContext.createGain();
    if (reverbSendNode.gain && 'value' in reverbSendNode.gain) reverbSendNode.gain.value = sendAmount;
    finalVoiceNode.connect(reverbSendNode);
    reverbSendNode.connect(ctx.reverbSend);
  }

  const effectiveGain = clamp(
    currentBaseVolume * (distanceAppliedNatively ? 1 : spatial.distanceGain) * getOcclusionGainScale(),
    0,
    2,
  );
  gain.gain.value = effectiveGain;

  if (!media) {
    const info = trimSilence !== false ? ctx.getCachedAnalysis(buffer) : analyzeAudioBuffer(null);
    const startAt = Number.isFinite(audioContext.currentTime) ? audioContext.currentTime : 0;
    const startOffset = offset !== null ? Math.max(0, Number(offset) || 0) : (info.analyzable ? info.trimStart : 0);

    if (isLoop) {
      if (info.analyzable && (info.trimStart > 0 || info.trimEnd < info.duration - 1e-4)) {
        source.loopStart = info.trimStart;
        source.loopEnd = info.trimEnd;
      }
      if (startOffset > 0) source.start(startAt, startOffset);
      else source.start();
    } else {
      let playDur = null;
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

      if (playDur !== null) source.start(startAt, startOffset, playDur);
      else if (startOffset > 0) source.start(startAt, startOffset);
      else source.start();
    }
  }

  function syncVoiceGainAndFilter(smoothSeconds = 0.02) {
    const t = Number.isFinite(ctx.context?.currentTime) ? ctx.context.currentTime : 0;
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
    get reverbSendGain() { return reverbSendNode ? (reverbSendNode.gain?.value ?? sendAmount) : 0; },
    setReverbSend(amount) {
      const v = clamp(Number(amount) || 0, 0, 1.5);
      if (reverbSendNode?.gain) reverbSendNode.gain.value = v;
      return handle;
    },
    setPosition(nextPos) {
      spatial = computeSpatialMetrics(nextPos, spatialOpts, ctx.listenerState);
      if (pannerNode && spatial.pos3) {
        applyAudioParamOrMethod(pannerNode, spatial.pos3.x, spatial.pos3.y, spatial.pos3.z);
      } else if (stereoNode?.pan && 'value' in stereoNode.pan) {
        stereoNode.pan.value = spatial.pan;
      }
      if (autoOcclusion && ctx.occlusionProbe) {
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
      if (!autoOcclusion || !ctx.occlusionProbe) return currentOcclusion;
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
      if (media) handle.playbackRate = setMediaRate(media, clamped);
      else {
        source.playbackRate.value = clamped;
        handle.playbackRate = clamped;
      }
      return handle;
    },
    stop({ fadeOutMs = 0 } = {}) {
      ctx.activeSources.delete(handle);
      const fadeSec = Math.max(0, (Number(fadeOutMs) || 0) * 0.001);
      const nowTime = Number.isFinite(ctx.context?.currentTime) ? ctx.context.currentTime : 0;
      if (media) {
        if (fadeSec > 0 && fadeTimer === null && !media.paused && typeof gain.gain.setTargetAtTime === 'function') {
          gain.gain.setTargetAtTime(0, nowTime, fadeSec / 3);
          fadeTimer = setTimeout(releaseMedia, fadeSec * 1000);
        } else {
          releaseMedia();
        }
        return;
      }
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
  function finishVoice() {
    ctx.activeSources.delete(handle);
    try { reverbSendNode?.disconnect?.(); } catch {}
    if (typeof onEnded === 'function') onEnded(handle);
  }

  let released = false;
  let lifecyclePaused = false;
  let fadeTimer = null;
  let playbackRequest = 0;
  let reportedPlayback = false;
  function releaseMedia() {
    if (released) return;
    released = true;
    clearTimeout(fadeTimer);
    ctx.mediaVoices.delete(handle);
    media.removeEventListener('ended', releaseMedia);
    media.removeEventListener('error', releaseMedia);
    media.pause();
    media.removeAttribute('src');
    media.load();
    for (const node of [source, gain, occlusionNode, pannerNode, stereoNode]) node?.disconnect();
    finishVoice();
  }

  async function startMedia() {
    const request = ++playbackRequest;
    try {
      await media.play();
    } catch {
      // Pause and resume can invalidate a still-pending play() promise.
      if (request === playbackRequest) releaseMedia();
    }
    if (!released && !reservation?.cancelled && request === playbackRequest && !reportedPlayback) {
      reportedPlayback = true;
      onMediaStarted?.();
    }
    return !released;
  }

  if (!media) {
    source.addEventListener?.('ended', finishVoice, { once: true });
    ctx.activeSources.add(handle);
    return handle;
  }

  media.addEventListener('ended', releaseMedia);
  media.addEventListener('error', releaseMedia);
  ctx.mediaVoices.set(handle, {
    pause() {
      if (fadeTimer !== null) {
        releaseMedia();
        return;
      }
      lifecyclePaused = true;
      playbackRequest++;
      media.pause();
    },
    resume() {
      if (!lifecyclePaused) return;
      lifecyclePaused = false;
      void startMedia();
    },
    release: releaseMedia,
  });
  ctx.activeSources.add(handle);
  if (reservation) reservation.handle = handle;
  media.src = url;
  if (ctx.hidden || ctx.muted) lifecyclePaused = true;
  else if (!await startMedia()) return null;
  return handle;
}
