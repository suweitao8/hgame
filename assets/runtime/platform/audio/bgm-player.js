import { clamp } from './helpers.js';

/**
 * Streaming lazy-load BGM controller with sample-accurate MP3 loop trimming,
 * crossfade transitions, strict 1-2 AudioBuffer memory budget, and pause/resume.
 *
 * @param {object} ctx Shared mutable audio manager state.
 * @param {object} buses Bus controller (`getBusNode`, `setBusVolume`, `getBusVolume`).
 */
export function createBgmController(ctx, buses) {
  const bgmCues = new Map();
  const fadingTracks = new Set();
  let currentTrack = null;
  let pendingLoad = null;
  let transitionToken = 0;
  let autoPausedByLifecycle = false;
  let disposed = false;

  function finalizeTrack(track) {
    if (!track) return;
    if (track.fadeTimer) {
      clearTimeout(track.fadeTimer);
      track.fadeTimer = null;
    }
    try { track.source?.stop?.(); } catch {}
    try { track.source?.disconnect?.(); } catch {}
    try { track.gainNode?.disconnect?.(); } catch {}
    track.source = null;
    track.gainNode = null;
    track.buffer = null;
    track.state = 'stopped';
    fadingTracks.delete(track);
  }

  function scheduleFadeOutAndRelease(track, fadeMs) {
    if (!track) return;
    if (track === currentTrack) currentTrack = null;
    const fadeSec = Math.max(0, (Number(fadeMs) || 0) * 0.001);
    if (fadeSec <= 0 || track.state !== 'playing' || !ctx.context || !track.source) {
      finalizeTrack(track);
      return;
    }

    // Keep memory <= 2 BGM buffers: immediately release any previously fading track.
    for (const old of [...fadingTracks]) {
      if (old !== track) finalizeTrack(old);
    }

    track.state = 'fading';
    fadingTracks.add(track);
    const nowTime = Number.isFinite(ctx.context.currentTime) ? ctx.context.currentTime : 0;
    const param = track.gainNode?.gain;
    if (param) {
      const startVal = Number.isFinite(param.value) ? param.value : track.baseGain;
      if (typeof param.setValueAtTime === 'function' && typeof param.linearRampToValueAtTime === 'function') {
        param.cancelScheduledValues?.(nowTime);
        param.setValueAtTime(startVal, nowTime);
        param.linearRampToValueAtTime(0.0001, nowTime + fadeSec);
      } else if (typeof param.setTargetAtTime === 'function') {
        param.setTargetAtTime(0, nowTime, Math.max(0.005, fadeSec / 3));
      } else if ('value' in param) {
        param.value = 0;
      }
    }

    try {
      track.source.stop(nowTime + fadeSec + 0.015);
    } catch {
      try { track.source.stop(); } catch {}
    }

    const timer = setTimeout(() => {
      finalizeTrack(track);
    }, Math.ceil(fadeSec * 1000) + 30);
    timer?.unref?.();
    track.fadeTimer = timer;
  }

  function normalizeCueSpec(cueIdOrSpec) {
    if (typeof cueIdOrSpec === 'string') {
      const registered = bgmCues.get(cueIdOrSpec);
      if (registered) return registered;
      if (/^(?:https?:\/\/|\/|\.\.?\/|blob:|data:)|\.(?:mp3|wav|ogg|flac|m4a)(?:$|\?)/i.test(cueIdOrSpec)) {
        return {
          cueName: cueIdOrSpec,
          url: cueIdOrSpec,
          bus: 'bgm',
          loop: true,
          gainDb: 0,
        };
      }
      throw new Error(`Unknown BGM cue: ${cueIdOrSpec}`);
    }
    if (cueIdOrSpec && typeof cueIdOrSpec === 'object') {
      const url = cueIdOrSpec.url || cueIdOrSpec.variants?.[0]?.url || '';
      const cueName = cueIdOrSpec.cueName || cueIdOrSpec.id || url || 'bgm';
      return {
        cueName,
        url,
        bus: cueIdOrSpec.bus || 'bgm',
        loop: cueIdOrSpec.loop !== false,
        trimStartSec: cueIdOrSpec.trimStartSec,
        trimEndSec: cueIdOrSpec.trimEndSec,
        durationSec: cueIdOrSpec.durationSec ?? cueIdOrSpec.duration,
        gainDb: Number(cueIdOrSpec.gainDb) || 0,
        bpm: cueIdOrSpec.bpm ?? null,
        buffer: cueIdOrSpec.buffer ?? null,
      };
    }
    throw new TypeError('playBgm requires a cueId string or cue descriptor object');
  }

  function computeLoopBounds(buffer, cue) {
    const dur = Number(buffer?.duration) || 0;
    if (!(dur > 0)) return { loopStart: 0, loopEnd: 0 };

    const trimStart = Number.isFinite(cue.trimStartSec) && cue.trimStartSec > 0 ? cue.trimStartSec : 0.026;
    const fallbackEnd = Math.max(trimStart + 0.05, dur - 0.026);
    const rawTrimEnd = Number.isFinite(cue.trimEndSec) && cue.trimEndSec > trimStart ? cue.trimEndSec : fallbackEnd;

    let useTrim = true;
    if (Number.isFinite(cue.durationSec) && cue.durationSec > 0 && Math.abs(dur - cue.durationSec) < 0.012) {
      if (typeof buffer.getChannelData === 'function') {
        const info = ctx.getCachedAnalysis(buffer);
        if (info.analyzable && info.trimStart < 0.005) {
          useTrim = false;
        }
      }
    }

    if (!useTrim) {
      return { loopStart: 0, loopEnd: dur };
    }
    const loopStart = Math.min(trimStart, Math.max(0, dur - 0.05));
    const loopEnd = Math.min(dur, Math.max(loopStart + 0.05, rawTrimEnd));
    return { loopStart, loopEnd };
  }

  function registerBgmCue(cueId, cfg = {}) {
    if (typeof cueId !== 'string' || !cueId.trim()) {
      throw new TypeError('registerBgmCue requires a non-empty cueId');
    }
    const url = cfg.url || cfg.variants?.[0]?.url || '';
    const entry = {
      cueName: cueId,
      url,
      bus: cfg.bus || 'bgm',
      loop: cfg.loop !== false,
      trimStartSec: cfg.trimStartSec ?? null,
      trimEndSec: cfg.trimEndSec ?? null,
      durationSec: cfg.durationSec ?? cfg.duration ?? null,
      gainDb: Number(cfg.gainDb) || 0,
      bpm: cfg.bpm ?? null,
    };
    bgmCues.set(cueId, entry);
    return entry;
  }

  async function loadMusicTable(tableOrUrl, { fetchImpl = globalThis.fetch } = {}) {
    let table = tableOrUrl;
    if (typeof tableOrUrl === 'string') {
      if (typeof fetchImpl !== 'function') throw new Error('fetch is required to load music_table.json URL');
      const res = await fetchImpl(tableOrUrl);
      if (!res.ok) throw new Error(`Failed to fetch music_table (${res.status}): ${tableOrUrl}`);
      table = await res.json();
    }
    const list = Array.isArray(table?.tracks)
      ? table.tracks
      : (Array.isArray(table?.bgm) || Array.isArray(table?.stingers)
        ? [...(table.bgm || []), ...(table.stingers || [])]
        : (Array.isArray(table?.cues) ? table.cues : (Array.isArray(table) ? table : [])));
    let bgmRegistered = 0;
    let stingerCount = 0;
    for (const c of list) {
      if (!c?.cueName) continue;
      if (c.category === 'bgm' || c.preload === 'stream' || String(c.cueName).startsWith('bgm.')) {
        registerBgmCue(c.cueName, c);
        bgmRegistered++;
      } else if (c.category === 'stinger' || String(c.cueName).startsWith('stinger.')) {
        stingerCount++;
      }
    }
    return { bgmRegistered, stingerCount, totalTracks: list.length, table };
  }

  /** @deprecated Prefer `loadMusicTable` for `music_table.json`. Kept as alias for compatibility. */
  const loadCueTable = loadMusicTable;

  async function playBgm(cueIdOrSpec, {
    fadeMs = 600,
    forceRestart = false,
    loop,
    volume = 1,
    startAtSec = null,
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (disposed) return null;
    const cue = normalizeCueSpec(cueIdOrSpec);
    const resolvedId = cue.cueName;

    if (!forceRestart) {
      if (pendingLoad && pendingLoad.cueId === resolvedId) {
        return { cueId: resolvedId, ignored: true, state: 'loading' };
      }
      if (currentTrack && currentTrack.cueId === resolvedId && currentTrack.state === 'playing' && startAtSec === null) {
        return { cueId: resolvedId, ignored: true, state: 'playing' };
      }
    }

    const token = ++transitionToken;
    pendingLoad = { cueId: resolvedId, token };
    autoPausedByLifecycle = false;

    let buffer = cue.buffer || null;
    try {
      const audioCtx = await ctx.unlock();
      if (token !== transitionToken || disposed) return null;

      if (!buffer) {
        if (!cue.url) throw new Error(`BGM cue "${resolvedId}" has no url or buffer`);
        if (typeof fetchImpl !== 'function') throw new Error('fetch is required to stream BGM audio');
        const response = await fetchImpl(cue.url);
        if (!response.ok) throw new Error(`Failed to fetch BGM (${response.status}): ${cue.url}`);
        const arrayBuf = await response.arrayBuffer();
        if (token !== transitionToken || disposed) return null;
        buffer = await audioCtx.decodeAudioData(arrayBuf.slice(0));
      }
      if (token !== transitionToken || disposed || !buffer) return null;

      const isLoop = loop !== undefined ? Boolean(loop) : cue.loop !== false;
      const { loopStart, loopEnd } = computeLoopBounds(buffer, cue);
      const baseGain = clamp(Number(volume) || 1, 0, 2) * Math.pow(10, (Number(cue.gainDb) || 0) / 20);
      const fadeSec = Math.max(0, (Number(fadeMs) || 0) * 0.001);

      if (currentTrack) {
        scheduleFadeOutAndRelease(currentTrack, fadeMs);
      }

      const source = audioCtx.createBufferSource();
      const gainNode = audioCtx.createGain();
      source.buffer = buffer;
      source.loop = isLoop;
      if (isLoop) {
        source.loopStart = loopStart;
        source.loopEnd = loopEnd;
      }

      const busNode = (ctx.getBusNode ? ctx.getBusNode(cue.bus || 'bgm') : null) ?? ctx.master;
      source.connect(gainNode);
      gainNode.connect(busNode);

      const nowTime = Number.isFinite(audioCtx.currentTime) ? audioCtx.currentTime : 0;
      if (fadeSec > 0 && gainNode.gain) {
        if (typeof gainNode.gain.setValueAtTime === 'function' && typeof gainNode.gain.linearRampToValueAtTime === 'function') {
          gainNode.gain.value = 0.0001;
          gainNode.gain.setValueAtTime(0.0001, nowTime);
          gainNode.gain.linearRampToValueAtTime(baseGain, nowTime + fadeSec);
        } else {
          gainNode.gain.value = baseGain;
        }
      } else if (gainNode.gain) {
        gainNode.gain.value = baseGain;
      }

      const offset = startAtSec !== null && Number.isFinite(Number(startAtSec))
        ? clamp(Number(startAtSec), loopStart, Math.max(loopStart, loopEnd - 0.05))
        : loopStart;
      source.start(nowTime, offset);

      const track = {
        cueId: resolvedId,
        cue,
        state: 'playing',
        token,
        buffer,
        source,
        gainNode,
        loop: isLoop,
        loopStart,
        loopEnd,
        baseGain,
        startedAtCtxTime: nowTime,
        offsetAtStart: offset,
        pausedPositionSec: offset,
        fadeTimer: null,
      };
      source.addEventListener?.('ended', () => {
        if (track === currentTrack && track.state === 'playing' && !track.loop) {
          finalizeTrack(track);
          currentTrack = null;
        }
      }, { once: true });

      currentTrack = track;
      if (pendingLoad?.token === token) pendingLoad = null;

      return {
        cueId: resolvedId,
        ignored: false,
        state: 'playing',
        loop: isLoop,
        loopStart,
        loopEnd,
        duration: buffer.duration,
      };
    } catch (err) {
      if (pendingLoad?.token === token) pendingLoad = null;
      buffer = null;
      throw err;
    }
  }

  function stopBgm({ fadeMs = 400 } = {}) {
    transitionToken++;
    pendingLoad = null;
    autoPausedByLifecycle = false;
    if (!currentTrack) return false;
    const target = currentTrack;
    currentTrack = null;
    scheduleFadeOutAndRelease(target, fadeMs);
    return true;
  }

  function pauseBgm({ fromLifecycle = false } = {}) {
    if (!currentTrack || currentTrack.state !== 'playing') return false;
    const audioCtx = ctx.context;
    const nowTime = Number.isFinite(audioCtx?.currentTime) ? audioCtx.currentTime : currentTrack.startedAtCtxTime;
    const elapsed = Math.max(0, nowTime - currentTrack.startedAtCtxTime);
    const loopLen = Math.max(0.05, currentTrack.loopEnd - currentTrack.loopStart);
    currentTrack.pausedPositionSec = currentTrack.loop
      ? currentTrack.loopStart + ((currentTrack.offsetAtStart - currentTrack.loopStart + elapsed) % loopLen)
      : Math.min(currentTrack.loopEnd, currentTrack.offsetAtStart + elapsed);

    try { currentTrack.source?.stop?.(); } catch {}
    try { currentTrack.source?.disconnect?.(); } catch {}
    currentTrack.source = null;
    currentTrack.state = 'paused';
    autoPausedByLifecycle = Boolean(fromLifecycle);
    return true;
  }

  async function resumeBgm({ fromLifecycle = false } = {}) {
    if (fromLifecycle && !autoPausedByLifecycle) return false;
    if (!currentTrack || currentTrack.state !== 'paused' || !currentTrack.buffer || disposed) return false;
    autoPausedByLifecycle = false;

    const audioCtx = await ctx.unlock();
    if (!currentTrack || currentTrack.state !== 'paused' || !currentTrack.buffer || disposed) return false;

    const source = audioCtx.createBufferSource();
    source.buffer = currentTrack.buffer;
    source.loop = currentTrack.loop;
    if (currentTrack.loop) {
      source.loopStart = currentTrack.loopStart;
      source.loopEnd = currentTrack.loopEnd;
    }
    source.connect(currentTrack.gainNode);

    const nowTime = Number.isFinite(audioCtx.currentTime) ? audioCtx.currentTime : 0;
    const resumeOffset = clamp(
      currentTrack.pausedPositionSec,
      currentTrack.loopStart,
      Math.max(currentTrack.loopStart, currentTrack.loopEnd - 0.05),
    );
    source.start(nowTime, resumeOffset);

    const track = currentTrack;
    source.addEventListener?.('ended', () => {
      if (track === currentTrack && track.state === 'playing' && !track.loop) {
        finalizeTrack(track);
        currentTrack = null;
      }
    }, { once: true });

    currentTrack.source = source;
    currentTrack.startedAtCtxTime = nowTime;
    currentTrack.offsetAtStart = resumeOffset;
    currentTrack.state = 'playing';
    return true;
  }

  function setBgmVolume(value) {
    const clamped = clamp(Number(value) || 0, 0, 1);
    return buses.setBusVolume('bgm', clamped);
  }

  function getBgmVolume() {
    return clamp(buses.getBusVolume('bgm'), 0, 1);
  }

  function getBgmState() {
    let activeBufferCount = currentTrack?.buffer ? 1 : 0;
    for (const t of fadingTracks) {
      if (t.buffer) activeBufferCount++;
    }
    return {
      state: currentTrack?.state ?? (pendingLoad ? 'loading' : 'idle'),
      cueId: currentTrack?.cueId ?? pendingLoad?.cueId ?? null,
      loop: currentTrack?.loop ?? false,
      loopStart: currentTrack?.loopStart ?? 0,
      loopEnd: currentTrack?.loopEnd ?? 0,
      bufferDuration: currentTrack?.buffer?.duration ?? 0,
      pausedPositionSec: currentTrack?.pausedPositionSec ?? 0,
      activeBufferCount,
      fadingCount: fadingTracks.size,
      registeredCueCount: bgmCues.size,
    };
  }

  function dispose() {
    disposed = true;
    transitionToken++;
    pendingLoad = null;
    autoPausedByLifecycle = false;
    finalizeTrack(currentTrack);
    currentTrack = null;
    for (const t of [...fadingTracks]) finalizeTrack(t);
    fadingTracks.clear();
    bgmCues.clear();
  }

  return {
    registerBgmCue,
    loadMusicTable,
    loadCueTable,
    hasBgmCue: (cueId) => bgmCues.has(cueId),
    playBgm,
    stopBgm,
    pauseBgm,
    resumeBgm,
    setBgmVolume,
    getBgmVolume,
    getBgmState,
    dispose,
  };
}
