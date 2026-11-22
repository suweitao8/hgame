import {
  analyzeAudioBuffer,
  createAudioManager,
} from '../runtime/hgame/platform/audio.js';
import { createSidebarSquareCard } from './hgame-shared.js';

const viewEl = document.querySelector('#music-view');
const searchInput = document.querySelector('#hgame-music-search');
const scopeFilterEl = document.querySelector('#hgame-music-scope-filter');
const categoryFilterEl = document.querySelector('#hgame-music-category-filter');
const listEl = document.querySelector('#hgame-music-list');
const titleEl = document.querySelector('#hgame-music-title');
const downloadEl = document.querySelector('#hgame-music-download');
const refToneBtn = document.querySelector('#hgame-music-ref-tone-button');
const quickBarEl = document.querySelector('#hgame-music-quick-bar');
const emptyEl = document.querySelector('#hgame-music-empty');
const waveCanvas = document.querySelector('#hgame-music-wave-canvas');
const metricsEl = document.querySelector('#hgame-music-metrics');
const seekInput = document.querySelector('#hgame-music-seek');
const timeOut = document.querySelector('#hgame-music-time');
const playBtn = document.querySelector('#hgame-music-play-button');
const pauseBtn = document.querySelector('#hgame-music-pause-button');
const stopBtn = document.querySelector('#hgame-music-stop-button');
const seamBtn = document.querySelector('#hgame-music-seam-button');
const volumeInput = document.querySelector('#hgame-music-volume');
const volumeVal = document.querySelector('#hgame-music-volume-val');
const loopInput = document.querySelector('#hgame-music-loop');
const statusEl = document.querySelector('#hgame-music-status');

let initialized = false;
let musicEntries = [];
let scopeFilter = 'all';
let categoryFilter = 'all';
let activeTrackId = '';
let audioMgr = null;
let activeStingerVoice = null;
let stingerMeta = null; // { startedAtMs, offsetSec, durationSec }
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

function formatClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function computeTrackAnomaly(track) {
  const peakDb = Number.isFinite(track?.peakDb) ? Number(track.peakDb) : null;
  const lufs = Number.isFinite(track?.measuredLufs ?? track?.measuredDb)
    ? Number(track.measuredLufs ?? track.measuredDb)
    : null;
  if (track?.clippingAlert || (peakDb !== null && peakDb > -0.5)) return true;
  if (Number.isFinite(track?.tailSilenceSec) && Number(track.tailSilenceSec) > 0.3) return true;
  if (track?.trimGuardTriggered || track?.lufsWarn) return true;
  if (isBgmTrack(track)) {
    if (lufs !== null && Math.abs(lufs - (-19.0)) > 1.5) return true;
  } else {
    if (track?.stingerOver15sWarning) return true;
    if (lufs !== null && Math.abs(lufs - (-16.0)) > 1.8) return true;
  }
  return false;
}

function getFilteredTracks() {
  const query = (searchInput?.value || '').trim().toLowerCase();
  return musicEntries.filter((track) => {
    const scope = track.scope || 'universal';
    const category = track.category || (isBgmTrack(track) ? 'bgm' : 'stinger');
    if (scopeFilter !== 'all' && scope !== scopeFilter) return false;
    if (categoryFilter !== 'all' && category !== categoryFilter) return false;
    if (!query) return true;
    return String(track.cueName || '').toLowerCase().includes(query)
      || scope.toLowerCase().includes(query)
      || category.toLowerCase().includes(query)
      || String(track.sourceFile || '').toLowerCase().includes(query);
  });
}

function getSelectedTrack() {
  const list = getFilteredTracks();
  return list.find((t) => t.cueName === activeTrackId) || list[0] || null;
}

function populateFilters() {
  const scopes = [...new Set(musicEntries.map((t) => t.scope || 'universal'))].sort();
  const categories = [...new Set(musicEntries.map((t) => t.category || (isBgmTrack(t) ? 'bgm' : 'stinger')))].sort();
  if (scopeFilter !== 'all' && !scopes.includes(scopeFilter)) scopeFilter = 'all';
  if (categoryFilter !== 'all' && !categories.includes(categoryFilter)) categoryFilter = 'all';

  if (scopeFilterEl) {
    scopeFilterEl.replaceChildren();
    const addOpt = (val, text) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = text;
      scopeFilterEl.append(opt);
    };
    addOpt('all', `全部 (${musicEntries.length})`);
    for (const s of scopes) {
      addOpt(s, s === 'universal' ? '通用母库 (universal)' : s);
    }
    scopeFilterEl.value = scopeFilter;
  }

  if (categoryFilterEl) {
    categoryFilterEl.replaceChildren();
    const addOpt = (val, text) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = text;
      categoryFilterEl.append(opt);
    };
    addOpt('all', '全部类别');
    for (const cat of categories) {
      addOpt(cat, cat === 'bgm' ? 'BGM (循环配乐)' : (cat === 'stinger' ? 'Stinger (短乐句)' : cat));
    }
    categoryFilterEl.value = categoryFilter;
  }
}

function renderQuickBar() {
  if (!quickBarEl) return;
  quickBarEl.replaceChildren();
  const bgmList = musicEntries.filter((t) => isBgmTrack(t));
  const stingerList = musicEntries.filter((t) => !isBgmTrack(t));
  const activeBgmId = audioMgr?.getBgmState?.().cueId || null;

  if (bgmList.length > 0) {
    const label = document.createElement('span');
    label.textContent = '600ms 切歌:';
    quickBarEl.append(label);
    for (const bgm of bgmList.slice(0, 6)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hgame-audio-music-pill';
      btn.textContent = bgm.cueName.replace(/^bgm\./, '');
      btn.setAttribute('aria-pressed', String(activeBgmId === bgm.cueName));
      btn.addEventListener('click', () => {
        activeTrackId = bgm.cueName;
        renderList();
        void selectCurrentTrack();
        void playBgmCrossfade(bgm);
      });
      quickBarEl.append(btn);
    }
  }

  if (stingerList.length > 0) {
    const label = document.createElement('span');
    label.textContent = '叠加闪避(-6dB):';
    quickBarEl.append(label);
    for (const st of stingerList.slice(0, 6)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hgame-audio-music-pill';
      btn.textContent = st.cueName.replace(/^stinger\./, '');
      btn.addEventListener('click', () => {
        activeTrackId = st.cueName;
        renderList();
        void selectCurrentTrack();
        void playStingerOverlay(st);
      });
      quickBarEl.append(btn);
    }
  }
}

function renderList() {
  if (!listEl) return;
  const list = getFilteredTracks();
  listEl.replaceChildren();
  if (list.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hgame-list-empty';
    empty.textContent = musicEntries.length === 0 ? '暂无音乐资产。' : '没有匹配的音乐。';
    listEl.append(empty);
    return;
  }

  if (!list.some((t) => t.cueName === activeTrackId)) {
    activeTrackId = list[0].cueName;
  }

  for (const track of list) {
    const selected = track.cueName === activeTrackId;
    const isBgm = isBgmTrack(track);
    const { button } = createSidebarSquareCard({
      name: track.cueName,
      badge: isBgm ? 'BGM' : 'Stinger',
      active: selected,
      onClick: () => {
        activeTrackId = track.cueName;
        renderList();
        void selectCurrentTrack();
      },
    });

    const origNum = Number(track.originalDurationSec ?? track.durationSec ?? track.duration);
    const cleanNum = Number(track.durationSec ?? track.duration);
    const durRange = Number.isFinite(origNum) && Number.isFinite(cleanNum)
      ? `${origNum.toFixed(1)}s → ${cleanNum.toFixed(1)}s`
      : '--';
    const lufsNum = Number(track.measuredLufs ?? track.measuredDb);
    const lufsTxt = Number.isFinite(lufsNum) ? `${lufsNum.toFixed(1)} LUFS` : '--';
    const pkTxt = Number.isFinite(track.peakDb) ? `${Number(track.peakDb).toFixed(1)} dB` : '--';
    const kbTxt = Number.isFinite(track.sizeKb)
      ? `${Math.round(track.sizeKb)} KB`
      : (track.encodedBytes ? `${Math.round(track.encodedBytes / 1024)} KB` : '--');

    const metaSpan = document.createElement('span');
    metaSpan.className = 'hgame-audio-loud-meta';
    metaSpan.textContent = `${durRange} · ${lufsTxt} / ${pkTxt} / ${kbTxt}`;

    const row = document.createElement('div');
    row.className = 'hgame-audio-bgm-row';

    const playSwitchBtn = document.createElement('button');
    playSwitchBtn.type = 'button';
    playSwitchBtn.className = 'hgame-audio-seam-btn';
    playSwitchBtn.textContent = isBgm ? '播放/切歌' : '播放/闪避';
    playSwitchBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      activeTrackId = track.cueName;
      renderList();
      void selectCurrentTrack();
      if (isBgm) void playBgmCrossfade(track);
      else void playStingerOverlay(track);
    });
    row.append(playSwitchBtn);

    if (isBgm) {
      const cardSeamBtn = document.createElement('button');
      cardSeamBtn.type = 'button';
      cardSeamBtn.className = 'hgame-audio-seam-btn';
      cardSeamBtn.textContent = '测结尾循环';
      cardSeamBtn.title = '跳至结尾前 4.0 秒播放，验证尾部空白已清干净与循环过渡';
      cardSeamBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        activeTrackId = track.cueName;
        renderList();
        void selectCurrentTrack();
        void playBgmSeamTest(track);
      });
      row.append(cardSeamBtn);
    }

    if (computeTrackAnomaly(track)) {
      button.dataset.loudnessAnomaly = 'true';
    }
    button.append(metaSpan, row);
    listEl.append(button);
  }
}

function drawWaveform(samples, { durationSec = 0, trimStart = 0, trimEnd = 0, playheadSec = null } = {}) {
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
    if (durationSec > 0 && trimEnd > trimStart) {
      const startX = (trimStart / durationSec) * w;
      const endX = (trimEnd / durationSec) * w;
      ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
      if (startX > 1) ctx.fillRect(0, 0, startX, h);
      if (endX < w - 1) ctx.fillRect(endX, 0, w - endX, h);
    }

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
  metricsEl.replaceChildren();
  for (const [k, v] of items) {
    const span = document.createElement('span');
    span.textContent = `${k} ${v}`;
    metricsEl.append(span);
  }
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
  if (stingerMeta && stingerMeta.durationSec > 0) {
    const elapsed = (performance.now() - stingerMeta.startedAtMs) / 1000;
    const cur = stingerMeta.offsetSec + elapsed;
    if (cur < stingerMeta.durationSec) {
      return { current: cur, duration: stingerMeta.durationSec, active: true };
    }
    stingerMeta = null;
  }
  if (bgmState && bgmState.state !== 'idle' && bgmState.bufferDuration > 0) {
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

function updatePauseButtonLabel() {
  if (!pauseBtn) return;
  const bgmState = audioMgr?.getBgmState?.();
  pauseBtn.textContent = bgmState?.state === 'paused' ? '继续' : '暂停';
  pauseBtn.disabled = !bgmState || bgmState.state === 'idle';
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
    const track = getSelectedTrack();
    drawWaveform(currentWaveformSamples, {
      durationSec: currentWaveformDur,
      trimStart: Number(track?.trimStartSec) || 0,
      trimEnd: Number(track?.trimEndSec) || currentWaveformDur,
      playheadSec: active || current > 0 ? current : null,
    });
  }
  updatePauseButtonLabel();
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
  renderQuickBar();
}

async function ensureTrackWaveform(track, token) {
  if (!track?.url) return;
  const cached = decodedCache.get(track.url);
  if (cached) {
    if (token !== loadToken) return;
    currentWaveformSamples = cached.getChannelData(0);
    currentWaveformDur = cached.duration;
    drawWaveform(currentWaveformSamples, {
      durationSec: cached.duration,
      trimStart: Number(track.trimStartSec) || 0,
      trimEnd: Number(track.trimEndSec) || cached.duration,
    });
    return;
  }
  try {
    const buf = await decodeCachedUrl(track.url);
    if (token !== loadToken) return;
    currentWaveformSamples = buf.getChannelData(0);
    currentWaveformDur = buf.duration;
    drawWaveform(currentWaveformSamples, {
      durationSec: buf.duration,
      trimStart: Number(track.trimStartSec) || 0,
      trimEnd: Number(track.trimEndSec) || buf.duration,
    });
  } catch {
    // Ignore waveform decode errors before explicit play
  }
}

async function selectCurrentTrack() {
  const track = getSelectedTrack();
  if (!track) {
    if (emptyEl) emptyEl.hidden = false;
    if (waveCanvas) waveCanvas.hidden = true;
    metricsEl?.replaceChildren();
    if (downloadEl) downloadEl.hidden = true;
    if (titleEl) titleEl.textContent = '音乐库';
    if (statusEl) statusEl.textContent = '暂无音乐资产（投放至 audio_ai_staging 后运行 --only-music）';
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  if (waveCanvas) waveCanvas.hidden = false;
  const token = ++loadToken;
  const isBgm = isBgmTrack(track);
  if (titleEl) titleEl.textContent = track.cueName;
  if (seamBtn) seamBtn.disabled = !isBgm;
  if (downloadEl) {
    if (track.url) {
      downloadEl.hidden = false;
      downloadEl.href = track.url;
      downloadEl.download = `${track.cueName}.mp3`;
      downloadEl.textContent = `下载 ${track.cueName}.mp3`;
    } else {
      downloadEl.hidden = true;
    }
  }

  const lufs = Number(track.measuredLufs ?? track.measuredDb);
  const pk = Number(track.peakDb);
  const origDur = Number(track.originalDurationSec ?? track.durationSec ?? track.duration ?? 0);
  const dur = Number(track.durationSec ?? track.duration ?? 0);
  const kb = Number(track.sizeKb) || (track.encodedBytes ? track.encodedBytes / 1024 : 0);

  if (isBgm) {
    renderMetrics([
      ['加载策略', `流式循环 BGM (${track.scope || 'universal'} · ${track.category || 'bgm'})`],
      ['原时长 → 去空白后', `${origDur.toFixed(1)}s → ${dur.toFixed(1)}s (去首${Number(track.trimmedLeadSec || 0).toFixed(2)}s / 去尾${Number(track.trimmedTailSec || 0).toFixed(2)}s)`],
      ['响度 / 峰值 / 体积', `${Number.isFinite(lufs) ? `${lufs.toFixed(1)} LUFS` : '--'} / ${Number.isFinite(pk) ? `${pk.toFixed(1)} dBTP` : '--'} / ${kb.toFixed(1)} KB`],
      ['BPM / MP3裁剪', `${track.bpm ? `${track.bpm} BPM` : '无 BPM'} · ${Number(track.trimStartSec || 0).toFixed(3)}s~${Number(track.trimEndSec || dur).toFixed(3)}s`],
    ]);
    if (statusEl) statusEl.textContent = `BGM 「${track.cueName}」就绪 · 点「播放/切歌」或「测结尾循环」`;
  } else {
    renderMetrics([
      ['加载策略', `Stinger 短乐句 (ui_voice · 自动闪避 BGM -6 dB · ${track.scope || 'universal'})`],
      ['原时长 → 去空白后', `${origDur.toFixed(1)}s → ${dur.toFixed(1)}s (去首${Number(track.trimmedLeadSec || 0).toFixed(2)}s / 去尾${Number(track.trimmedTailSec || 0).toFixed(2)}s)`],
      ['响度 / 峰值 / 体积', `${Number.isFinite(lufs) ? `${lufs.toFixed(1)} LUFS` : '--'} / ${Number.isFinite(pk) ? `${pk.toFixed(1)} dBTP` : '--'} / ${kb.toFixed(1)} KB`],
      ['MP3 编码', `44.1 kHz Stereo 96k · 尾部静音 ${Number(track.tailSilenceSec || 0).toFixed(2)}s`],
    ]);
    if (statusEl) statusEl.textContent = `Stinger 「${track.cueName}」就绪 · 点「播放/闪避」可与当前 BGM 叠加测试`;
  }

  currentWaveformSamples = null;
  currentWaveformDur = dur;
  drawWaveform(null, { durationSec: dur });
  if (decodedCache.has(track.url)) {
    await ensureTrackWaveform(track, token);
  }
  syncSeekBar();
}

async function playBgmCrossfade(track, { forceRestart = false, startAtSec = null } = {}) {
  if (!track) return;
  const mgr = getAudioManager();
  await mgr.unlock();
  mgr.setVolume(Number(volumeInput?.value) || 0.8);
  stopPlayback({ keepBgm: true });
  try {
    const loop = loopInput ? loopInput.checked : true;
    const res = await mgr.playBgm(track, {
      fadeMs: startAtSec !== null ? 120 : 600,
      forceRestart,
      loop,
      startAtSec,
    });
    renderQuickBar();
    void ensureTrackWaveform(track, loadToken);
    startSeekTicker();
    if (statusEl) {
      if (res?.ignored) {
        statusEl.textContent = `BGM「${track.cueName}」已在播放（防重入忽略）`;
      } else if (startAtSec !== null) {
        statusEl.textContent = `从 ${formatClock(startAtSec)} 播放 BGM：${track.cueName}`;
      } else {
        statusEl.textContent = `正在播放 BGM（600ms 淡入切换）：${track.cueName} · ${Number(track.measuredLufs ?? track.measuredDb ?? -19).toFixed(1)} LUFS`;
      }
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = err?.message || 'BGM 播放失败';
  }
}

async function playBgmSeamTest(track) {
  if (!track) return;
  const trimStart = Number(track.trimStartSec) || 0.026;
  const loopEnd = Number(track.trimEndSec) || Number(track.durationSec) || Number(track.duration) || 48;
  const startAtSec = Math.max(trimStart, loopEnd - 4.0);
  await playBgmCrossfade(track, { forceRestart: true, startAtSec });
  if (statusEl) {
    statusEl.textContent = `测结尾循环（结尾前 4.0s 起播）：${track.cueName} · 5 秒内可听尾接首过渡`;
  }
}

async function playStingerOverlay(track, offsetSec = 0) {
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
  void ensureTrackWaveform(track, loadToken);
  startSeekTicker();
  if (statusEl) {
    statusEl.textContent = `叠加 Stinger：${track.cueName}（bgmBus 已自动压低 -6 dB，播完后 400ms 恢复）`;
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
      void ensureTrackWaveform(track, loadToken);
      startSeekTicker();
      if (statusEl) statusEl.textContent = `已跳转至 ${formatClock(targetSec)}：${track.cueName}`;
    } else {
      await playBgmCrossfade(track, { forceRestart: true, startAtSec: targetSec });
    }
    return;
  }

  await playStingerOverlay(track, targetSec);
}

async function playReferencePinkNoise() {
  const mgr = getAudioManager();
  const audioCtx = await mgr.unlock();
  mgr.setVolume(Number(volumeInput?.value) || 0.8);
  stopPlayback();

  const sr = audioCtx.sampleRate || 44100;
  const nSamples = sr;
  const buf = audioCtx.createBuffer(1, nSamples, sr);
  const ch = buf.getChannelData(0);

  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let s = 0x13572468;
  let sumSq = 0;
  for (let i = 0; i < nSamples; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    const white = ((s >>> 0) / 2147483648) - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
    ch[i] = pink;
    sumSq += pink * pink;
  }

  const targetRms = Math.pow(10, -16.0 / 20);
  const curRms = Math.sqrt(sumSq / nSamples) || 1e-4;
  const gain = targetRms / curRms;
  const fadeSamples = Math.round(sr * 0.015);
  for (let i = 0; i < nSamples; i++) {
    let env = 1;
    if (i < fadeSamples) env = i / fadeSamples;
    else if (i >= nSamples - fadeSamples) env = (nSamples - 1 - i) / fadeSamples;
    ch[i] = Math.max(-0.95, Math.min(0.95, ch[i] * gain * env));
  }

  currentWaveformSamples = ch;
  currentWaveformDur = 1.0;
  const analysis = analyzeAudioBuffer(buf);
  drawWaveform(ch, { durationSec: 1.0, trimStart: analysis.trimStart, trimEnd: analysis.trimEnd });
  activeStingerVoice = await mgr.play(buf, { bus: 'ui_voice', volume: 1, loop: false, trimSilence: false });
  if (statusEl) statusEl.textContent = '正在播放：1s -16.0 dBFS 校准粉噪基准音 (uiVoiceBus)';
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
    scopeFilterEl?.addEventListener('change', () => {
      scopeFilter = scopeFilterEl.value || 'all';
      renderList();
      void selectCurrentTrack();
    });
    categoryFilterEl?.addEventListener('change', () => {
      categoryFilter = categoryFilterEl.value || 'all';
      renderList();
      void selectCurrentTrack();
    });
    playBtn?.addEventListener('click', () => {
      const track = getSelectedTrack();
      if (!track) return;
      if (isBgmTrack(track)) void playBgmCrossfade(track);
      else void playStingerOverlay(track);
    });
    pauseBtn?.addEventListener('click', () => {
      const mgr = getAudioManager();
      const state = mgr.getBgmState();
      if (state.state === 'playing') {
        mgr.pauseBgm();
        syncSeekBar();
        if (statusEl) statusEl.textContent = `已暂停：${state.cueId}`;
      } else if (state.state === 'paused') {
        void mgr.resumeBgm().then(() => {
          startSeekTicker();
          if (statusEl) statusEl.textContent = `继续播放：${state.cueId}`;
        });
      }
    });
    stopBtn?.addEventListener('click', () => {
      stopPlayback();
      if (statusEl) statusEl.textContent = '已停止播放';
    });
    seamBtn?.addEventListener('click', () => {
      const track = getSelectedTrack();
      if (track && isBgmTrack(track)) void playBgmSeamTest(track);
    });
    refToneBtn?.addEventListener('click', () => {
      void playReferencePinkNoise();
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
    if (statusEl) statusEl.textContent = err?.message || '读取 music_table.json 失败';
  }

  populateFilters();
  renderQuickBar();
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
