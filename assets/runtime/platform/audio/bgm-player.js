import { clamp } from './helpers.js';

/** Returned by `startStreamTrack` when a cue turns out to need the decoded path after all. */
const DECODE = Symbol('bgm.decode');

/**
 * Lazy-load BGM controller with crossfade transitions and pause/resume.
 *
 * URL cues stream through an `HTMLAudioElement` routed into the engine's mix buses, so a long
 * track never sits decoded in memory. A media element loops whole files only: trim points that
 * sit at the file bounds (decoder-delay compensation) are left to its own gapless handling, while
 * a cue that selects a window inside the file keeps the sample-accurate `AudioBuffer` path, as do
 * short cues, cues that carry a `buffer`, and environments without media elements. That path
 * holds at most two decoded BGM buffers.
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

  /** URL cues at or above this length (seconds) stream; shorter ones decode like sound effects. */
  const STREAM_MIN_DURATION_SEC = 10;

  /** Trim points within this distance of the file bounds compensate decoder delay; they do not select a loop window. */
  const LOOP_WINDOW_TOLERANCE_SEC = 0.05;

  /** @param {object} cue */
  function wantsStreaming(cue) {
    if (cue.buffer) return false;
    if (typeof cue.stream === 'boolean') return cue.stream;
    if (cue.durationSec == null) return true;
    const duration = Number(cue.durationSec);
    return !Number.isFinite(duration) || duration >= STREAM_MIN_DURATION_SEC;
  }

  /**
   * Whether a cue's trim points select a window inside the file. A media element loops whole
   * files only, so such cues keep the decoded path. Points sitting at the file bounds merely skip
   * encoder padding, which media playback skips by itself.
   * @param {object} cue
   * @param {number} durationSec Media length when known, else 0
   * @returns {boolean | null} Null while the length is unknown and the points could still be a window
   */
  function isLoopWindow(cue, durationSec) {
    const start = Number.isFinite(cue.trimStartSec) && cue.trimStartSec > 0 ? cue.trimStartSec : 0;
    const end = Number.isFinite(cue.trimEndSec) && cue.trimEndSec > 0 ? cue.trimEndSec : 0;
    if (start > LOOP_WINDOW_TOLERANCE_SEC) return true;
    if (!(end > 0)) return false;
    if (!(durationSec > 0)) return null;
    return end < durationSec - LOOP_WINDOW_TOLERANCE_SEC;
  }

  /** @returns {HTMLAudioElement | null} Null where media elements cannot feed the audio graph. */
  function createStreamElement(audioCtx) {
    const MediaElement = globalThis.Audio;
    if (typeof MediaElement !== 'function' || typeof audioCtx?.createMediaElementSource !== 'function') return null;
    return new MediaElement();
  }

  /** Resolves once an element knows its length, or when loading fails or stalls. */
  function waitForMetadata(element, timeoutMs = 10000) {
    return new Promise((resolve) => {
      let timer = null;
      const done = () => {
        clearTimeout(timer);
        element.removeEventListener?.('loadedmetadata', done);
        element.removeEventListener?.('error', done);
        resolve();
      };
      timer = setTimeout(done, timeoutMs);
      element.addEventListener?.('loadedmetadata', done);
      element.addEventListener?.('error', done);
    });
  }

  /** Detach the decoder behind a streaming element so its buffers can be reclaimed. */
  function releaseStreamElement(element) {
    try {
      element.pause();
      element.removeAttribute('src');
      element.load();
    } catch {}
  }

  function finalizeTrack(track) {
    if (!track) return;
    if (track.fadeTimer) {
      clearTimeout(track.fadeTimer);
      track.fadeTimer = null;
    }
    if (track.element) releaseStreamElement(track.element);
    try { track.source?.stop?.(); } catch {}
    try { track.source?.disconnect?.(); } catch {}
    try { track.gainNode?.disconnect?.(); } catch {}
    track.source = null;
    track.gainNode = null;
    track.buffer = null;
    track.element = null;
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
    fadeOut(track.gainNode?.gain, track.baseGain, fadeSec, nowTime);

    // A media element keeps playing silently under its ramp and is released by the timer below;
    // a buffer source has to be told when to stop.
    if (!track.element) {
      try {
        track.source.stop(nowTime + fadeSec + 0.015);
      } catch {
        try { track.source.stop(); } catch {}
      }
    }

    const timer = setTimeout(() => {
      finalizeTrack(track);
    }, Math.ceil(fadeSec * 1000) + 30);
    timer?.unref?.();
    track.fadeTimer = timer;
  }

  /** Ramp a gain parameter from silence up to `targetGain` over `fadeSec` (instant when zero). */
  function fadeIn(param, targetGain, fadeSec, nowTime) {
    if (!param) return;
    if (fadeSec > 0 && typeof param.setValueAtTime === 'function' && typeof param.linearRampToValueAtTime === 'function') {
      param.value = 0.0001;
      param.setValueAtTime(0.0001, nowTime);
      param.linearRampToValueAtTime(targetGain, nowTime + fadeSec);
      return;
    }
    param.value = targetGain;
  }

  /** Ramp a gain parameter from its present value down to silence over `fadeSec`. */
  function fadeOut(param, fallbackStart, fadeSec, nowTime) {
    if (!param) return;
    const start = Number.isFinite(param.value) ? param.value : fallbackStart;
    if (typeof param.setValueAtTime === 'function' && typeof param.linearRampToValueAtTime === 'function') {
      param.cancelScheduledValues?.(nowTime);
      param.setValueAtTime(start, nowTime);
      param.linearRampToValueAtTime(0.0001, nowTime + fadeSec);
    } else if (typeof param.setTargetAtTime === 'function') {
      param.setTargetAtTime(0, nowTime, Math.max(0.005, fadeSec / 3));
    } else if ('value' in param) {
      param.value = 0;
    }
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
        stream: cueIdOrSpec.stream,
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
      // `preload: "stream"` in a music table opts the cue into media-element streaming.
      stream: cfg.stream ?? (cfg.preload === 'stream' ? true : null),
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
        // `stream` stays undefined when streaming does not apply and is null when superseded while starting.
        let stream;
        if (wantsStreaming(cue) && isLoopWindow(cue, Number(cue.durationSec)) !== true) {
          const element = createStreamElement(audioCtx);
          if (element) stream = await startStreamTrack(audioCtx, element, cue, { resolvedId, token, loop, volume, fadeMs, startAtSec });
        }
        if (stream === null) return null;
        if (stream && stream !== DECODE) return stream;
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
      fadeIn(gainNode.gain, baseGain, fadeSec, nowTime);

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
        streaming: false,
      };
    } catch (err) {
      if (pendingLoad?.token === token) pendingLoad = null;
      buffer = null;
      throw err;
    }
  }

  /**
   * Start a cue on a media element wired into the mix buses. Resolves once playback has begun.
   * The element's decoder streams the file, so nothing the size of the track is ever held in a
   * buffer. Returns null when superseded while starting, or `DECODE` when the trim points turn
   * out to select a window inside the file.
   */
  async function startStreamTrack(audioCtx, element, cue, { resolvedId, token, loop, volume, fadeMs, startAtSec }) {
    const isLoop = loop !== undefined ? Boolean(loop) : cue.loop !== false;
    const baseGain = clamp(Number(volume) || 1, 0, 2) * Math.pow(10, (Number(cue.gainDb) || 0) / 20);
    const fadeSec = Math.max(0, (Number(fadeMs) || 0) * 0.001);

    element.preload = 'auto';
    element.loop = isLoop;
    element.src = cue.url;

    // A cue with no declared length can only be judged once the media length is known.
    if (isLoopWindow(cue, Number(cue.durationSec)) === null) {
      await waitForMetadata(element);
      if (token !== transitionToken || disposed) return null;
      if (isLoopWindow(cue, Number(element.duration))) {
        releaseStreamElement(element);
        return DECODE;
      }
    }

    // The media timeline starts at the first audible sample, so no offset is added for trims.
    const offset = startAtSec !== null && Number.isFinite(Number(startAtSec)) ? Math.max(0, Number(startAtSec)) : 0;

    // A media element can only ever be routed through one source node, so pause/resume keeps
    // this node connected and only stops and restarts the element itself.
    const source = audioCtx.createMediaElementSource(element);
    const gainNode = audioCtx.createGain();
    const busNode = (ctx.getBusNode ? ctx.getBusNode(cue.bus || 'bgm') : null) ?? ctx.master;
    source.connect(gainNode);
    gainNode.connect(busNode);

    const nowTime = Number.isFinite(audioCtx.currentTime) ? audioCtx.currentTime : 0;
    fadeIn(gainNode.gain, baseGain, fadeSec, nowTime);

    const track = {
      cueId: resolvedId,
      cue,
      state: 'playing',
      token,
      mode: 'element',
      buffer: null,
      element,
      source,
      gainNode,
      loop: isLoop,
      loopStart: 0,
      loopEnd: 0,
      baseGain,
      startedAtCtxTime: nowTime,
      offsetAtStart: offset,
      pausedPositionSec: offset,
      fadeTimer: null,
    };

    if (currentTrack) {
      scheduleFadeOutAndRelease(currentTrack, fadeMs);
    }
    currentTrack = track;
    if (pendingLoad?.token === token) pendingLoad = null;

    const readDuration = () => {
      track.loopEnd = trackDuration(track);
    };
    readDuration();
    element.addEventListener?.('loadedmetadata', readDuration);
    element.addEventListener?.('ended', () => {
      if (track === currentTrack && track.state === 'playing' && !track.loop) {
        finalizeTrack(track);
        currentTrack = null;
      }
    });
    element.addEventListener?.('error', () => {
      if (track === currentTrack) {
        finalizeTrack(track);
        currentTrack = null;
      }
    });

    try {
      element.currentTime = offset;
      await element.play();
    } catch (err) {
      // Being paused or replaced while starting aborts play(); that is not a failure.
      if (track !== currentTrack || track.state !== 'playing' || disposed) return null;
      finalizeTrack(track);
      currentTrack = null;
      throw err;
    }
    return (track === currentTrack && !disposed)
      ? {
        cueId: resolvedId,
        ignored: false,
        state: 'playing',
        loop: isLoop,
        loopStart: 0,
        loopEnd: track.loopEnd,
        duration: track.loopEnd,
        streaming: true,
      }
      : null;
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

  /** @param {object} track @returns {number} Track length in seconds; a stream reports its cue's declared length until its metadata has loaded. */
  function trackDuration(track) {
    if (!track) return 0;
    if (track.buffer) return track.buffer.duration;
    const duration = Number(track.element?.duration);
    return Number.isFinite(duration) ? duration : (Number(track.cue?.durationSec) || 0);
  }

  function computeTrackCurrentTimeSec(track) {
    if (!track) return 0;
    if (track.mode === 'element') {
      if (track.state !== 'playing') return track.pausedPositionSec || 0;
      const time = Number(track.element?.currentTime);
      return Number.isFinite(time) ? time : (track.pausedPositionSec || 0);
    }
    if (track.state !== 'playing') return track.pausedPositionSec || 0;
    const audioCtx = ctx.context;
    const nowTime = Number.isFinite(audioCtx?.currentTime) ? audioCtx.currentTime : track.startedAtCtxTime;
    const elapsed = Math.max(0, nowTime - track.startedAtCtxTime);
    const loopLen = Math.max(0.05, track.loopEnd - track.loopStart);
    return track.loop
      ? track.loopStart + ((track.offsetAtStart - track.loopStart + elapsed) % loopLen)
      : Math.min(track.loopEnd, track.offsetAtStart + elapsed);
  }

  function startTrackSource(audioCtx, track, offsetSec) {
    const source = audioCtx.createBufferSource();
    source.buffer = track.buffer;
    source.loop = track.loop;
    if (track.loop) {
      source.loopStart = track.loopStart;
      source.loopEnd = track.loopEnd;
    }
    source.connect(track.gainNode);

    const nowTime = Number.isFinite(audioCtx.currentTime) ? audioCtx.currentTime : 0;
    const clampedOffset = clamp(
      Number(offsetSec) || 0,
      track.loopStart,
      Math.max(track.loopStart, track.loopEnd - 0.02),
    );
    source.start(nowTime, clampedOffset);

    source.addEventListener?.('ended', () => {
      if (track === currentTrack && track.source === source && track.state === 'playing' && !track.loop) {
        finalizeTrack(track);
        currentTrack = null;
      }
    }, { once: true });

    track.source = source;
    track.startedAtCtxTime = nowTime;
    track.offsetAtStart = clampedOffset;
    track.pausedPositionSec = clampedOffset;
    return clampedOffset;
  }

  function pauseBgm({ fromLifecycle = false } = {}) {
    if (!currentTrack || currentTrack.state !== 'playing') return false;
    currentTrack.pausedPositionSec = computeTrackCurrentTimeSec(currentTrack);
    if (currentTrack.mode === 'element') {
      // The source node stays connected: a media element cannot be routed through a second one.
      try { currentTrack.element?.pause(); } catch {}
    } else {
      try { currentTrack.source?.stop?.(); } catch {}
      try { currentTrack.source?.disconnect?.(); } catch {}
      currentTrack.source = null;
    }
    currentTrack.state = 'paused';
    autoPausedByLifecycle = Boolean(fromLifecycle);
    return true;
  }

  async function resumeBgm({ fromLifecycle = false } = {}) {
    if (fromLifecycle && !autoPausedByLifecycle) return false;
    const resumable = () => Boolean(currentTrack) && currentTrack.state === 'paused' && !disposed
      && (currentTrack.mode === 'element' || Boolean(currentTrack.buffer));
    if (!resumable()) return false;
    autoPausedByLifecycle = false;

    const audioCtx = await ctx.unlock();
    if (!resumable()) return false;

    if (currentTrack.mode === 'element') {
      try {
        await currentTrack.element.play();
      } catch (err) {
        // Paused again while play() was still pending.
        if (err?.name === 'AbortError') return false;
        throw err;
      }
      if (!resumable()) return false;
      currentTrack.state = 'playing';
      return true;
    }

    startTrackSource(audioCtx, currentTrack, currentTrack.pausedPositionSec);
    currentTrack.state = 'playing';
    return true;
  }

  async function seekBgm(positionSec) {
    if (!currentTrack || disposed || !(currentTrack.buffer || currentTrack.mode === 'element')) return null;
    if (currentTrack.mode === 'element') {
      const start = currentTrack.loopStart;
      const end = currentTrack.loopEnd > 0
        ? currentTrack.loopEnd - 0.02
        : (trackDuration(currentTrack) > 0 ? trackDuration(currentTrack) - 0.02 : Number.POSITIVE_INFINITY);
      const clamped = clamp(Number(positionSec) || 0, start, Math.max(start, end));
      try {
        currentTrack.element.currentTime = clamped;
      } catch {
        return null;
      }
      currentTrack.pausedPositionSec = clamped;
      return clamped;
    }
    const clamped = clamp(
      Number(positionSec) || 0,
      currentTrack.loopStart,
      Math.max(currentTrack.loopStart, currentTrack.loopEnd - 0.02),
    );
    currentTrack.pausedPositionSec = clamped;
    if (currentTrack.state !== 'playing') return clamped;

    const audioCtx = await ctx.unlock();
    if (!currentTrack || !currentTrack.buffer || disposed) return null;
    const oldSrc = currentTrack.source;
    currentTrack.source = null;
    try { oldSrc?.stop?.(); } catch {}
    try { oldSrc?.disconnect?.(); } catch {}
    startTrackSource(audioCtx, currentTrack, clamped);
    return clamped;
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
      duration: trackDuration(currentTrack),
      streaming: currentTrack?.mode === 'element',
      currentTimeSec: computeTrackCurrentTimeSec(currentTrack),
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
    seekBgm,
    setBgmVolume,
    getBgmVolume,
    getBgmState,
    dispose,
  };
}
