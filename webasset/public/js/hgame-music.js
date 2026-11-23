import { createAudioManager } from '../runtime/hgame/platform/audio.js';

const viewEl = document.querySelector('#music-view');
const searchInput = document.querySelector('#hgame-music-search');
const filterSelect = document.querySelector('#hgame-music-filter');
const listEl = document.querySelector('#hgame-music-list');
const titleEl = document.querySelector('#hgame-music-title');
const downloadEl = document.querySelector('#hgame-music-download');
const emptyEl = document.querySelector('#hgame-music-empty');
const waveCanvas = document.querySelector('#hgame-music-wave-canvas');
const metricsEl = document.querySelector('#hgame-music-metrics');
const seekInput = document.querySelector('#hgame-music-seek');
const timeOut = document.querySelector('#hgame-music-time');
const playBtn = document.querySelector('#hgame-music-play-button');
const seamBtn = document.querySelector('#hgame-music-seam-button');
const volumeInput = document.querySelector('#hgame-music-volume');
const volumeVal = document.querySelector('#hgame-music-volume-val');
const loopInput = document.querySelector('#hgame-music-loop');
const statusEl = document.querySelector('#hgame-music-status');

let initialized = false;
let musicEntries = [];
let activeTrackId = '';
let audioMgr = null;
let activeStingerVoice = null;
let stingerMeta = null;
const decodedCache = new Map();
const registeredCues = new Set();
let currentWaveformSamples = null;
let currentWaveformDur = 0;
let loadToken = 0;
let isSeeking = false;
let seekTimer = null;

function getAudioManager() {
  if (!audioMgr) {
    audioMgr = createAudioManager({ volume: Number(volumeInput?.value) || 0.8 });
  }
  return audioMgr;
}

function isBgmTrack(track) {
  return track?.kind === 'bgm' || String(track?.cueName || '').startsWith('bgm.');
}

function shortTrackTitle(track) {
  const cue = String(track?.cueName || '');
  const short = cue.replace(/^(?:bgm|stinger)\.(?:universal\.)?/, '');
  return track?.scope && track.scope !== 'universal'
    ? `${track.scope.replace(/^game:/, '')} · ${short.replace(/^[^.]+\./, '')}`
    : short;
}

function formatClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function computeTrackAnomaly(track) {
  const peakDb = Number.isFinite(track?.peakDb) ? Number(track.peakDb) : null;
  if (track?.clippingAlert || (peakDb !== null && peakDb > -0.5)) return true;
  if (Number.isFinite(track?.tailSilenceSec) && Number(track.tailSilenceSec) > 0.3) return true;
  if (track?.lufsWarn) return true;
  return false;
}

function populateFilterOptions() {
  if (!filterSelect) return;
  const prev = filterSelect.value || 'all';
  filterSelect.replaceChildren();
  const addOpt = (val, text) => {
    const o = document.createElement('option');
    o.value = val;
    o.textContent = text;
    filterSelect.append(o);
  };

  addOpt('all', `全部 (${musicEntries.length})`);

  const cats = new Map();
  for (const t of musicEntries) {
    const cat = t.category || 'music';
    cats.set(cat, (cats.get(cat) || 0) + 1);
  }
  for (const [cat, cnt] of [...cats.entries()].sort((a, b) => b[1] - a[1])) {
    addOpt(`cat:${cat}`, `${cat} (${cnt})`);
  }

  const scopes = [...new Set(musicEntries.map((t) => t.scope || 'universal'))].filter((s) => s !== 'universal');
  for (const s of scopes.sort()) {
    const cnt = musicEntries.filter((t) => t.scope === s).length;
    addOpt(`scope:${s}`, `${s} (${cnt})`);
  }

  const hasPrev = [...filterSelect.options].some((o) => o.value === prev);
  filterSelect.value = hasPrev ? prev : 'all';
}

function getFilteredTracks() {
  const query = (searchInput?.value || '').trim().toLowerCase();
  const fval = filterSelect?.value || 'all';
  return musicEntries.filter((track) => {
    if (fval.startsWith('cat:') && (track.category || 'music') !== fval.slice(4)) return false;
    if (fval.startsWith('scope:') && (track.scope || 'universal') !== fval.slice(6)) return false;
    if (!query) return true;
    return String(track.cueName || '').toLowerCase().includes(query)
      || String(track.category || '').toLowerCase().includes(query);
  });
}

function getSelectedTrack() {
  const list = getFilteredTracks();
  return list.find((t) => t.cueName === activeTrackId) || list[0] || null;
}

function renderList() {
  if (!listEl) return;
  const list = getFilteredTracks();
  listEl.replaceChildren();
  if (list.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hgame-list-empty';
    empty.textContent = musicEntries.length === 0 ? '暂无音乐。' : '无匹配曲目。';
    listEl.append(empty);
    return;
  }

  if (!list.some((t) => t.cueName === activeTrackId)) {
    activeTrackId = list[0].cueName;
  }

  for (const track of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hgame-list-item hgame-music-row';
    btn.setAttribute('aria-current', String(track.cueName === activeTrackId));
    if (computeTrackAnomaly(track)) {
      btn.dataset.loudnessAnomaly = 'true';
    }

    const main = document.createElement('div');
    main.className = 'hgame-music-row-main';

    const nameEl = document.createElement('span');
    nameEl.className = 'hgame-music-row-name';
    nameEl.textContent = shortTrackTitle(track);
    nameEl.title = track.cueName;

    const durNum = Number(track.durationSec ?? track.duration ?? 0);
    const lufsNum = Number(track.measuredLufs ?? track.measuredDb);
    const parts = [formatClock(durNum)];
    if (track.bpm) parts.push(`${track.bpm} BPM`);
    else if (Number.isFinite(lufsNum)) parts.push(`${lufsNum.toFixed(1)} LUFS`);

    const subEl = document.createElement('span');
    subEl.className = 'hgame-music-row-sub';
    subEl.textContent = parts.join(' · ');

    main.append(nameEl, subEl);
    btn.append(main);
    btn.addEventListener('click', () => {
      activeTrackId = track.cueName;
      renderList();
      void selectCurrentTrack();
    });
    btn.addEventListener('dblclick', () => {
      activeTrackId = track.cueName;
      renderList();
      void selectCurrentTrack().then(() => playOrToggleSelected());
    });
    listEl.append(btn);
  }
}

function drawWaveform(samples, { durationSec = 0, playheadSec = null } = {}) {
  if (!waveCanvas) return;
  const ctx = waveCanvas.getContext('2d');
  const w = waveCanvas.width;
  const h = waveCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#131812';
  ctx.fillRect(0, 0, w, h);

  const mid = h * 0.5;
  ctx.strokeStyle = 'rgba(213, 228, 180, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(w, mid);
  ctx.stroke();

  if (samples && samples.length > 0) {
    const step = Math.max(1, Math.floor(samples.length / w));
    ctx.fillStyle = '#d5e4b4';
    for (let x = 0; x < w; x++) {
      const offset = Math.floor((x / w) * samples.length);
      let min = 0;
      let max = 0;
      for (let i = 0; i < step && offset + i < samples.length; i++) {
        const s = samples[offset + i];
        if (s < min) min = s;
        if (s > max) max = s;
      }
      const yTop = mid - max * (mid - 18);
      const yBot = mid - min * (mid - 18);
      ctx.fillRect(x, yTop, 1, Math.max(1.5, yBot - yTop));
    }
  }

  if (playheadSec !== null && durationSec > 0) {
    const px = Math.max(0, Math.min(w - 1, (playheadSec / durationSec) * w));
    ctx.strokeStyle = '#7bd88f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
  }
}

function renderMetrics(items) {
  if (!metricsEl) return;
  metricsEl.textContent = items.join(' · ');
}

async function decodeCachedUrl(url) {
  let buf = decodedCache.get(url);
  if (!buf) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    buf = await getAudioManager().decode(ab);
    decodedCache.set(url, buf);
  }
  return buf;
}

function getCurrentPlaybackTiming() {
  const track = getSelectedTrack();
  const bgmState = audioMgr?.getBgmState?.();
  if (stingerMeta && stingerMeta.durationSec > 0 && (!track || !isBgmTrack(track))) {
    const elapsed = (performance.now() - stingerMeta.startedAtMs) / 1000;
    const cur = stingerMeta.offsetSec + elapsed;
    if (cur < stingerMeta.durationSec) {
      return { current: cur, duration: stingerMeta.durationSec, active: true };
    }
    stingerMeta = null;
  }
  if (bgmState && bgmState.state !== 'idle' && bgmState.bufferDuration > 0 && track?.cueName === bgmState.cueId) {
    const dur = bgmState.loopEnd > 0 ? bgmState.loopEnd : bgmState.bufferDuration;
    return {
      current: bgmState.currentTimeSec || 0,
      duration: dur,
      active: bgmState.state === 'playing',
    };
  }
  const cachedBuf = track?.url ? decodedCache.get(track.url) : null;
  const fallbackDur = Number(cachedBuf?.duration ?? track?.durationSec ?? track?.duration) || 0;
  return { current: 0, duration: fallbackDur, active: false };
}

function syncPlayButtonLabel() {
  if (!playBtn) return;
  const track = getSelectedTrack();
  const bgmState = audioMgr?.getBgmState?.();
  if (track && isBgmTrack(track) && bgmState?.cueId === track.cueName) {
    if (bgmState.state === 'playing') {
      playBtn.textContent = '暂停';
      return;
    }
    if (bgmState.state === 'paused') {
      playBtn.textContent = '继续';
      return;
    }
  }
  playBtn.textContent = '播放';
}

function syncSeekBar() {
  if (!seekInput || !timeOut) return;
  const { current, duration, active } = getCurrentPlaybackTiming();
  const maxVal = duration > 0 ? duration : 100;
  seekInput.max = String(maxVal);
  seekInput.disabled = !(duration > 0);
  if (!isSeeking) {
    seekInput.value = String(Math.min(maxVal, Math.max(0, current)));
    timeOut.textContent = `${formatClock(current)} / ${formatClock(duration)}`;
  }
  if (currentWaveformSamples && currentWaveformDur > 0) {
    drawWaveform(currentWaveformSamples, {
      durationSec: currentWaveformDur,
      playheadSec: active || current > 0 ? current : null,
    });
  }
  syncPlayButtonLabel();
  if (!active && seekTimer) {
    clearInterval(seekTimer);
    seekTimer = null;
  }
}

function startSeekTicker() {
  syncSeekBar();
  if (seekTimer) return;
  seekTimer = setInterval(syncSeekBar, 120);
}

function stopPlayback({ keepBgm = false } = {}) {
  try {
    activeStingerVoice?.stop?.({ fadeOutMs: 12 });
  } catch { /* ignore */ }
  activeStingerVoice = null;
  stingerMeta = null;
  if (!keepBgm) {
    try {
      audioMgr?.stopBgm?.({ fadeMs: 120 });
    } catch { /* ignore */ }
  }
  if (seekTimer) {
    clearInterval(seekTimer);
    seekTimer = null;
  }
  syncSeekBar();
}

async function ensureTrackWaveform(track, token) {
  if (!track?.url) return;
  try {
    const buf = await decodeCachedUrl(track.url);
    if (token !== loadToken) return;
    currentWaveformSamples = buf.getChannelData(0);
    currentWaveformDur = buf.duration;
    const { current, active } = getCurrentPlaybackTiming();
    drawWaveform(currentWaveformSamples, {
      durationSec: buf.duration,
      playheadSec: active || current > 0 ? current : null,
    });
  } catch {
    // Ignore transient decode error when unmounted
  }
}

async function selectCurrentTrack() {
  const track = getSelectedTrack();
  if (!track) {
    if (emptyEl) emptyEl.hidden = false;
    if (waveCanvas) waveCanvas.hidden = true;
    metricsEl?.replaceChildren();
    if (downloadEl) downloadEl.hidden = true;
    if (titleEl) titleEl.textContent = '音乐';
    if (statusEl) statusEl.textContent = '';
    syncPlayButtonLabel();
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  if (waveCanvas) waveCanvas.hidden = false;
  const token = ++loadToken;
  if (titleEl) titleEl.textContent = shortTrackTitle(track);
  if (seamBtn) seamBtn.disabled = false;
  if (downloadEl) {
    if (track.url) {
      downloadEl.hidden = false;
      downloadEl.href = track.url;
      downloadEl.download = `${track.cueName}.mp3`;
      downloadEl.textContent = '下载';
    } else {
      downloadEl.hidden = true;
    }
  }

  const dur = Number(track.durationSec ?? track.duration ?? 0);
  const lufs = Number(track.measuredLufs ?? track.measuredDb);
  const mb = (Number(track.sizeKb) || (track.encodedBytes ? track.encodedBytes / 1024 : 0)) / 1024;
  const chips = [`${dur.toFixed(1)}s`];
  if (Number.isFinite(lufs)) chips.push(`${lufs.toFixed(1)} LUFS`);
  if (track.bpm) chips.push(`${track.bpm} BPM`);
  if (mb > 0) chips.push(`${mb.toFixed(2)} MB`);
  renderMetrics(chips);
  if (statusEl) statusEl.textContent = '';

  currentWaveformSamples = null;
  currentWaveformDur = dur;
  drawWaveform(null, { durationSec: dur });
  syncSeekBar();
  void ensureTrackWaveform(track, token);
}

async function playBgmTrack(track, { forceRestart = false, startAtSec = null } = {}) {
  if (!track) return;
  const mgr = getAudioManager();
  await mgr.unlock();
  mgr.setVolume(Number(volumeInput?.value) || 0.8);
  stopPlayback({ keepBgm: true });
  try {
    const loop = loopInput ? loopInput.checked : true;
    await mgr.playBgm(track, {
      fadeMs: startAtSec !== null ? 120 : 600,
      forceRestart,
      loop,
      startAtSec,
    });
    startSeekTicker();
    if (statusEl) {
      statusEl.textContent = startAtSec !== null
        ? `从 ${formatClock(startAtSec)} 播放`
        : '';
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = err?.message || '播放失败';
  }
}

async function playStingerTrack(track, offsetSec = 0) {
  if (!track?.url) return;
  const mgr = getAudioManager();
  await mgr.unlock();
  mgr.setVolume(Number(volumeInput?.value) || 0.8);
  const buf = await decodeCachedUrl(track.url);
  if (!registeredCues.has(track.cueName)) {
    mgr.registerCue(track.cueName, [buf], {
      bus: track.bus || 'ui_voice',
      gainDb: Number(track.gainDb) || 0,
      ducking: track.ducking !== false,
    });
    registeredCues.add(track.cueName);
  }
  try {
    activeStingerVoice?.stop?.({ fadeOutMs: 12 });
  } catch { /* ignore */ }
  const dur = buf?.duration || Number(track.durationSec) || 0;
  const clamped = Math.max(0, Math.min(Math.max(0, dur - 0.05), offsetSec));
  if (clamped > 0.01) {
    activeStingerVoice = await mgr.play(buf, {
      bus: track.bus || 'ui_voice',
      ducking: true,
      volume: 1,
      loop: false,
      offset: clamped,
      trimSilence: false,
    });
  } else {
    activeStingerVoice = await mgr.playCue(track.cueName, { loop: false, volume: 1, ducking: true });
  }
  stingerMeta = {
    startedAtMs: performance.now(),
    offsetSec: clamped,
    durationSec: dur,
  };
  startSeekTicker();
  if (statusEl) statusEl.textContent = '';
}

async function playOrToggleSelected() {
  const track = getSelectedTrack();
  if (!track) return;
  if (isBgmTrack(track)) {
    const mgr = getAudioManager();
    const state = mgr.getBgmState();
    if (state.cueId === track.cueName && state.state === 'playing') {
      mgr.pauseBgm();
      syncSeekBar();
      return;
    }
    if (state.cueId === track.cueName && state.state === 'paused') {
      await mgr.resumeBgm();
      startSeekTicker();
      return;
    }
    await playBgmTrack(track);
    return;
  }
  await playStingerTrack(track);
}

async function playBgmSeamTest(track) {
  if (!track) return;
  const trimStart = Number(track.trimStartSec) || 0.026;
  const loopEnd = Number(track.trimEndSec) || Number(track.durationSec) || Number(track.duration) || 48;
  const startAtSec = Math.max(trimStart, loopEnd - 4.0);
  if (isBgmTrack(track)) {
    await playBgmTrack(track, { forceRestart: true, startAtSec });
  } else {
    await playStingerTrack(track, Math.max(0, loopEnd - 4.0));
  }
}

async function seekToSeconds(targetSec) {
  const track = getSelectedTrack();
  if (!track) return;
  const mgr = getAudioManager();
  await mgr.unlock();
  mgr.setVolume(Number(volumeInput?.value) || 0.8);

  if (isBgmTrack(track)) {
    const bgmState = mgr.getBgmState();
    if (bgmState.cueId === track.cueName && bgmState.state !== 'idle') {
      await mgr.seekBgm(targetSec);
      startSeekTicker();
    } else {
      await playBgmTrack(track, { forceRestart: true, startAtSec: targetSec });
    }
    return;
  }

  await playStingerTrack(track, targetSec);
}

function syncVolumeOutput() {
  if (volumeVal && volumeInput) {
    volumeVal.textContent = Number(volumeInput.value || 0.8).toFixed(2);
  }
}

async function initMusicView() {
  if (!initialized) {
    initialized = true;
    searchInput?.addEventListener('input', renderList);
    filterSelect?.addEventListener('change', () => {
      renderList();
      void selectCurrentTrack();
    });
    playBtn?.addEventListener('click', () => {
      void playOrToggleSelected();
    });
    seamBtn?.addEventListener('click', () => {
      const track = getSelectedTrack();
      if (track) void playBgmSeamTest(track);
    });
    volumeInput?.addEventListener('input', () => {
      syncVolumeOutput();
      audioMgr?.setVolume(Number(volumeInput.value) || 0.8);
    });
    if (seekInput) {
      seekInput.addEventListener('pointerdown', () => { isSeeking = true; });
      seekInput.addEventListener('input', () => {
        isSeeking = true;
        if (timeOut) {
          timeOut.textContent = `${formatClock(Number(seekInput.value) || 0)} / ${formatClock(Number(seekInput.max) || 0)}`;
        }
      });
      seekInput.addEventListener('change', () => {
        const target = Number(seekInput.value) || 0;
        isSeeking = false;
        void seekToSeconds(target);
      });
      seekInput.addEventListener('pointerup', () => { isSeeking = false; });
    }
    waveCanvas?.addEventListener('click', (ev) => {
      const { duration } = getCurrentPlaybackTiming();
      if (!(duration > 0)) return;
      const rect = waveCanvas.getBoundingClientRect();
      if (!(rect.width > 0)) return;
      const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      void seekToSeconds(ratio * duration);
    });
  }

  syncVolumeOutput();
  try {
    const res = await fetch('/assets/cn/audio/music_table.json', { cache: 'no-cache' });
    const table = res.ok ? await res.json() : { tracks: [] };
    musicEntries = Array.isArray(table.tracks)
      ? table.tracks
      : [...(Array.isArray(table.bgm) ? table.bgm : []), ...(Array.isArray(table.stingers) ? table.stingers : [])];
  } catch (err) {
    if (statusEl) statusEl.textContent = err?.message || '加载失败';
  }

  populateFilterOptions();
  renderList();
  await selectCurrentTrack();
}

window.addEventListener('webasset:workspace-change', (event) => {
  if (event.detail?.workspace === 'music') {
    void initMusicView();
  } else {
    stopPlayback();
  }
});

if (viewEl && !viewEl.hidden) {
  void initMusicView();
}
