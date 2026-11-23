import {
  analyzeAudioBuffer,
  createAudioManager,
} from '../runtime/hgame/platform/audio.js';
import {
  apiRequestJson,
  fetchHGameAssets,
  formatBytes,
  onHGameAssetsChanged,
  refreshHGameAssets,
} from './hgame-shared.js';

const viewEl = document.querySelector('#audio-view');
const searchInput = document.querySelector('#hgame-audio-search');
const filterSelect = document.querySelector('#hgame-audio-filter');
const uploadButton = document.querySelector('#hgame-audio-upload-button');
const uploadInput = document.querySelector('#hgame-audio-upload');
const listEl = document.querySelector('#hgame-audio-list');
const titleEl = document.querySelector('#hgame-audio-title');
const downloadEl = document.querySelector('#hgame-audio-download');
const refToneBtn = document.querySelector('#hgame-audio-ref-tone-button');
const deleteBtn = document.querySelector('#hgame-audio-delete-button');
const emptyEl = document.querySelector('#hgame-audio-empty');
const waveCanvas = document.querySelector('#hgame-audio-wave-canvas');
const metricsEl = document.querySelector('#hgame-audio-metrics');
const playBtn = document.querySelector('#hgame-audio-play-button');
const volumeInput = document.querySelector('#hgame-audio-volume');
const volumeVal = document.querySelector('#hgame-audio-volume-val');
const loopInput = document.querySelector('#hgame-audio-loop');
const statusEl = document.querySelector('#hgame-audio-status');
const seekInput = document.querySelector('#hgame-audio-seek');
const timeOut = document.querySelector('#hgame-audio-time');

let initialized = false;
let cueEntries = [];
let streamEntries = [];
let fullEntries = [];
let uploadedAudio = [];
let spreadAnomalyCues = new Set();
let activeSelection = { type: 'cue', id: '' };
let audioMgr = null;
let activeVoice = null;
let activeStream = null;
const decodedCache = new Map();
const registeredCues = new Set();
let currentDecoded = null;
let currentAnalysis = null;
let loadToken = 0;
let isSeeking = false;
let seekTimer = null;
let voicePlaybackMeta = null;

function getAudioManager() {
  if (!audioMgr) {
    audioMgr = createAudioManager({ volume: Number(volumeInput.value) || 0.8 });
  }
  return audioMgr;
}

function isMusicCueEntry(c) {
  const name = String(c?.cueName || c?.id || '');
  return c?.category === 'bgm' || c?.category === 'stinger' || name.startsWith('bgm.') || name.startsWith('stinger.');
}

function buildActiveList(modeOverride = null) {
  const fval = modeOverride ?? (filterSelect?.value || 'lib:cues');
  if (fval === 'lib:streams') {
    return streamEntries.map((s) => ({
      type: 'stream',
      id: s.id,
      name: s.name || s.id,
      pack: s.pack || '长音轨',
      category: '长音轨',
      preload: 'stream',
      url: s.url,
      fileName: `${s.name || s.id}.mp3`,
      item: s,
    }));
  }
  if (fval === 'lib:full') {
    const uploaded = uploadedAudio.map((item) => ({
      type: 'file',
      id: item.id,
      name: item.name,
      pack: '已上传',
      category: '已上传',
      preload: 'buffer',
      url: item.url,
      fileName: item.name,
      item,
    }));
    const fullMapped = fullEntries.map((f) => ({
      type: f.preload === 'stream' ? 'stream' : 'sfx_item',
      id: f.id,
      name: f.name || f.id,
      pack: f.pack || 'Anim58',
      category: f.preload === 'stream' ? '长音轨' : '单条音效',
      preload: f.preload || 'buffer',
      url: f.url,
      fileName: `${f.name || f.id}.mp3`,
      item: f,
    }));
    return [...uploaded, ...fullMapped];
  }
  return cueEntries
    .filter((c) => !isMusicCueEntry(c))
    .map((c) => ({
      type: 'cue',
      id: c.cueName,
      name: c.cueName,
      pack: c.pack || (c.surfaceType ? `材质:${c.surfaceType}` : 'SFX'),
      category: c.category || 'sfx',
      preload: 'buffer',
      url: c.variants?.[0]?.url || '',
      fileName: `${c.cueName}.mp3`,
      item: c,
    }));
}

function populateFilterOptions() {
  if (!filterSelect) return;
  const prev = filterSelect.value || 'lib:cues';
  filterSelect.replaceChildren();
  const cueList = buildActiveList('lib:cues');
  const packs = new Map();
  let surfaceCount = 0;
  for (const e of cueList) {
    if (e.pack) packs.set(e.pack, (packs.get(e.pack) || 0) + 1);
    if (e.category === 'footstep_surface' || e.category === 'impact_surface') surfaceCount++;
  }
  const addOpt = (val, text) => {
    const o = document.createElement('option');
    o.value = val;
    o.textContent = text;
    filterSelect.append(o);
  };
  addOpt('lib:cues', `Cue 分组 (${cueList.length})`);
  if (streamEntries.length > 0) addOpt('lib:streams', `长音轨 (${streamEntries.length})`);
  addOpt('lib:full', `全量 / 上传 (${uploadedAudio.length + fullEntries.length})`);
  if (surfaceCount > 0) {
    addOpt('surface', `10 材质 (${surfaceCount})`);
  }
  for (const [p, cnt] of [...packs.entries()].sort((a, b) => b[1] - a[1])) {
    addOpt(`pack:${p}`, `${p} (${cnt})`);
  }
  const hasPrev = [...filterSelect.options].some((o) => o.value === prev);
  filterSelect.value = hasPrev ? prev : 'lib:cues';
}

function getFilteredList() {
  const query = searchInput.value.trim().toLowerCase();
  const fval = filterSelect?.value || 'all';
  return buildActiveList().filter((entry) => {
    if (fval === 'surface' && entry.category !== 'footstep_surface' && entry.category !== 'impact_surface') return false;
    if (fval.startsWith('pack:') && entry.pack !== fval.slice(5)) return false;
    if (!query) return true;
    return entry.name.toLowerCase().includes(query)
      || entry.id.toLowerCase().includes(query)
      || (entry.pack || '').toLowerCase().includes(query)
      || (entry.category || '').toLowerCase().includes(query);
  });
}

function getSelectedEntry() {
  const list = getFilteredList();
  return list.find((entry) => entry.type === activeSelection.type && entry.id === activeSelection.id)
    || list[0]
    || null;
}

function shortTierLabel(rawTier) {
  if (!rawTier) return 'sfx';
  return String(rawTier).replace(/^sfx_/, '');
}

function computeAudioLoudnessSummary(entry) {
  const item = entry.item || {};
  const tierRaw = item.loudnessTier || (entry.preload === 'stream' ? 'bgm' : 'sfx_combat_light');
  const tier = shortTierLabel(tierRaw);

  let rmsDb = Number.isFinite(item.measuredDb) ? Number(item.measuredDb) : null;
  if (rmsDb === null && entry.type === 'cue' && Array.isArray(item.variants) && item.variants.length > 0) {
    const dbs = item.variants.map((v) => v.measuredDb).filter((x) => Number.isFinite(x));
    if (dbs.length) rmsDb = dbs.reduce((a, b) => a + b, 0) / dbs.length;
  }
  if (rmsDb === null && Number.isFinite(item.rms) && item.rms > 0) {
    rmsDb = 20 * Math.log10(item.rms);
  }

  let peakDb = Number.isFinite(item.peakDb) ? Number(item.peakDb) : null;
  if (peakDb === null && entry.type === 'cue' && Array.isArray(item.variants) && item.variants.length > 0) {
    const pks = item.variants.map((v) => v.peakDb).filter((x) => Number.isFinite(x));
    if (pks.length) peakDb = Math.max(...pks);
  }
  if (peakDb === null && Number.isFinite(item.peak) && item.peak > 0) {
    peakDb = 20 * Math.log10(item.peak);
  }

  let anomaly = Boolean(item.clippingAlert || item.hitBoostCap || (peakDb !== null && peakDb > -0.5));
  if (entry.type === 'cue') {
    if (spreadAnomalyCues.has(entry.name)) anomaly = true;
    const dbs = (item.variants || []).map((v) => v.measuredDb).filter((x) => Number.isFinite(x));
    if (dbs.length >= 2 && Math.max(...dbs) - Math.min(...dbs) > 2.5) anomaly = true;
  }

  const rmsTxt = rmsDb !== null ? `${rmsDb.toFixed(1)}dB` : '--';
  const pkTxt = peakDb !== null ? `PK ${peakDb.toFixed(1)}` : 'PK --';
  return {
    text: `${tier} · ${rmsTxt} / ${pkTxt}`,
    anomaly,
    tier: tierRaw,
    rmsDb,
    peakDb,
  };
}

function renderList() {
  const entries = getFilteredList();
  listEl.replaceChildren();
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hgame-list-empty';
    empty.textContent = '暂无音频';
    listEl.append(empty);
    return;
  }

  if (!entries.some((entry) => entry.type === activeSelection.type && entry.id === activeSelection.id)) {
    activeSelection = { type: entries[0].type, id: entries[0].id };
  }

  const MAX_RENDER = 320;
  const visible = entries.slice(0, MAX_RENDER);
  for (const entry of visible) {
    const selected = entry.type === activeSelection.type && entry.id === activeSelection.id;
    const loud = computeAudioLoudnessSummary(entry);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hgame-list-item hgame-music-row';
    btn.setAttribute('aria-current', String(selected));
    if (loud.anomaly) {
      btn.dataset.loudnessAnomaly = 'true';
    }

    const main = document.createElement('div');
    main.className = 'hgame-music-row-main';

    const nameEl = document.createElement('span');
    nameEl.className = 'hgame-music-row-name';
    nameEl.textContent = entry.name;
    nameEl.title = entry.name;

    const subEl = document.createElement('span');
    subEl.className = 'hgame-music-row-sub';
    const subParts = [];
    if (entry.type === 'cue') subParts.push(`${entry.item?.variants?.length || 1} 变体`);
    if (loud.rmsDb !== null) subParts.push(`${loud.rmsDb.toFixed(1)} dB`);
    if (loud.peakDb !== null) subParts.push(`PK ${loud.peakDb.toFixed(1)}`);
    subEl.textContent = subParts.join(' · ') || entry.pack || 'SFX';

    main.append(nameEl, subEl);
    btn.append(main);
    btn.addEventListener('click', () => {
      stopPlayback();
      activeSelection = { type: entry.type, id: entry.id };
      renderList();
      void selectCurrentAudio();
    });
    listEl.append(btn);
  }
  if (entries.length > MAX_RENDER) {
    const hint = document.createElement('p');
    hint.className = 'hgame-list-empty';
    hint.textContent = `显示前 ${MAX_RENDER} / ${entries.length} 条`;
    listEl.append(hint);
  }
}

function formatClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function getCurrentPlaybackTiming() {
  const entry = getSelectedEntry();
  if (activeStream && (activeStream.playing || activeStream.duration > 0)) {
    const dur = activeStream.duration || Number(entry?.item?.durationSec ?? entry?.item?.duration) || 0;
    return { current: activeStream.currentTime || 0, duration: dur, active: activeStream.playing };
  }
  if (voicePlaybackMeta && voicePlaybackMeta.durationSec > 0) {
    const elapsed = (performance.now() - voicePlaybackMeta.startedAtMs) / 1000;
    const raw = voicePlaybackMeta.offsetSec + elapsed;
    const dur = voicePlaybackMeta.durationSec;
    const cur = voicePlaybackMeta.loop ? (raw % dur) : Math.min(dur, raw);
    const active = voicePlaybackMeta.loop || raw < dur;
    if (!active) voicePlaybackMeta = null;
    return { current: cur, duration: dur, active };
  }
  const fallbackDur = Number(currentDecoded?.duration ?? entry?.item?.durationSec ?? entry?.item?.duration) || 0;
  return { current: 0, duration: fallbackDur, active: false };
}

function syncSeekBar() {
  const { current, duration, active } = getCurrentPlaybackTiming();
  if (playBtn) playBtn.textContent = active ? '停止' : '播放';
  if (!seekInput || !timeOut) return;
  const maxVal = duration > 0 ? duration : 100;
  seekInput.max = String(maxVal);
  seekInput.disabled = !(duration > 0);
  if (!isSeeking) {
    seekInput.value = String(Math.min(maxVal, Math.max(0, current)));
    timeOut.textContent = `${formatClock(current)} / ${formatClock(duration)}`;
  }
  if (!active && seekTimer) {
    clearInterval(seekTimer);
    seekTimer = null;
  }
}

function startSeekTicker() {
  syncSeekBar();
  if (seekTimer) return;
  seekTimer = setInterval(syncSeekBar, 150);
}

async function seekToSeconds(targetSec) {
  const entry = getSelectedEntry();
  if (!entry) return;
  const mgr = getAudioManager();
  await mgr.unlock();
  mgr.setVolume(Number(volumeInput.value) || 0.8);

  if (activeStream) {
    activeStream.seek(targetSec);
    startSeekTicker();
    statusEl.textContent = `已跳转至 ${formatClock(targetSec)}：${entry.name}`;
    return;
  }

  if (entry.preload === 'stream') {
    stopPlayback();
    activeStream = mgr.playStream(entry.url, {
      bus: entry.item?.bus || 'sfx',
      loop: loopInput.checked,
      volume: 1,
      autoplay: true,
    });
    activeStream.seek(targetSec);
    startSeekTicker();
    statusEl.textContent = `已跳转至 ${formatClock(targetSec)}：${entry.name}`;
    return;
  }

  if (!currentDecoded && entry.url) {
    currentDecoded = await decodeCachedUrl(entry.url);
  }
  if (currentDecoded) {
    const dur = currentDecoded.duration || 0;
    const clamped = Math.max(0, Math.min(Math.max(0, dur - 0.05), targetSec));
    stopPlayback();
    activeVoice = await mgr.play(currentDecoded, {
      bus: entry.item?.bus || 'combat',
      volume: 1,
      loop: loopInput.checked,
      offset: clamped,
      trimSilence: false,
    });
    voicePlaybackMeta = {
      startedAtMs: performance.now(),
      offsetSec: clamped,
      durationSec: dur,
      loop: loopInput.checked,
    };
    startSeekTicker();
    statusEl.textContent = `已跳转至 ${formatClock(clamped)}：${entry.name}`;
  }
}

function syncOutputs() {
  volumeVal.textContent = Number(volumeInput.value || 0.8).toFixed(2);
}

function stopPlayback() {
  try {
    activeVoice?.stop?.({ fadeOutMs: 12 });
  } catch { /* ignore */ }
  activeVoice = null;
  voicePlaybackMeta = null;
  try {
    activeStream?.stop?.();
  } catch { /* ignore */ }
  activeStream = null;
  if (seekTimer) {
    clearInterval(seekTimer);
    seekTimer = null;
  }
  syncSeekBar();
}

function drawPcmWaveform(samples, { durationSec = 0, analysis = null } = {}) {
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

  if (!samples || samples.length === 0) return;

  if (analysis?.analyzable && durationSec > 0) {
    const startX = (analysis.trimStart / durationSec) * w;
    const endX = (analysis.trimEnd / durationSec) * w;
    ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
    if (startX > 1) ctx.fillRect(0, 0, startX, h);
    if (endX < w - 1) ctx.fillRect(endX, 0, w - endX, h);
  }

  const bins = w;
  const step = Math.max(1, Math.floor(samples.length / bins));
  ctx.fillStyle = '#d5e4b4';
  for (let x = 0; x < bins; x++) {
    const offset = Math.floor((x / bins) * samples.length);
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

function renderMetrics(items) {
  if (!metricsEl) return;
  metricsEl.textContent = items.join(' · ');
}

async function decodeCachedUrl(url) {
  let buf = decodedCache.get(url);
  if (!buf) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const arrayBuf = await response.arrayBuffer();
    buf = await getAudioManager().decode(arrayBuf);
    decodedCache.set(url, buf);
  }
  return buf;
}

async function selectCurrentAudio() {
  const entry = getSelectedEntry();
  if (!entry) {
    emptyEl.hidden = false;
    waveCanvas.hidden = true;
    metricsEl.textContent = '';
    deleteBtn.hidden = true;
    downloadEl.hidden = true;
    titleEl.textContent = '音效';
    statusEl.textContent = '';
    return;
  }

  emptyEl.hidden = true;
  waveCanvas.hidden = false;
  const token = ++loadToken;
  titleEl.textContent = entry.name;
  deleteBtn.hidden = entry.type !== 'file';
  if (entry.url) {
    downloadEl.hidden = false;
    downloadEl.href = entry.url;
    downloadEl.download = entry.fileName;
    downloadEl.textContent = '下载';
  } else {
    downloadEl.hidden = true;
  }

  if (entry.preload === 'stream') {
    currentDecoded = null;
    currentAnalysis = null;
    drawPcmWaveform(null);
    const s = entry.item;
    renderMetrics([
      `${Number(s.duration || 0).toFixed(2)}s`,
      `${s.bitrateKbps || 96} kbps`,
      formatBytes(s.encodedBytes || 0),
    ]);
    statusEl.textContent = '';
    syncSeekBar();
    return;
  }

  statusEl.textContent = '';

  try {
    if (entry.type === 'cue') {
      const variants = entry.item.variants || [];
      const bufs = await Promise.all(variants.map((v) => decodeCachedUrl(v.url)));
      if (token !== loadToken) return;
      const mgr = getAudioManager();
      if (!registeredCues.has(entry.name)) {
        mgr.registerCue(entry.name, bufs, {
          bus: entry.item.bus || 'combat',
          gainDb: Number(entry.item.gainDb) || 0,
        });
        registeredCues.add(entry.name);
      }
      currentDecoded = bufs[0] || null;
      currentAnalysis = currentDecoded ? analyzeAudioBuffer(currentDecoded) : null;
      if (currentDecoded) {
        drawPcmWaveform(currentDecoded.getChannelData(0), { durationSec: currentDecoded.duration, analysis: currentAnalysis });
      }
      const loud = computeAudioLoudnessSummary(entry);
      const chips = [`${variants.length} 变体`];
      if (loud.rmsDb !== null) chips.push(`${loud.rmsDb.toFixed(1)} dB`);
      if (loud.peakDb !== null) chips.push(`PK ${loud.peakDb.toFixed(1)}`);
      if (variants[0]?.spectralCentroidHz) chips.push(`${variants[0].spectralCentroidHz} Hz`);
      renderMetrics(chips);
      statusEl.textContent = '';
      syncSeekBar();
      return;
    }

    const buffer = await decodeCachedUrl(entry.url);
    if (token !== loadToken) return;
    currentDecoded = buffer;
    currentAnalysis = analyzeAudioBuffer(buffer);
    drawPcmWaveform(buffer.getChannelData(0), { durationSec: buffer.duration, analysis: currentAnalysis });
    renderMetrics([
      `${buffer.duration.toFixed(2)}s`,
      `${buffer.sampleRate} Hz`,
      `PK ${currentAnalysis.peak.toFixed(2)}`,
    ]);
    statusEl.textContent = '';
    syncSeekBar();
  } catch (error) {
    if (token !== loadToken) return;
    currentDecoded = null;
    currentAnalysis = null;
    drawPcmWaveform(null);
    statusEl.textContent = error.message || '解码失败';
  }
}

async function startPlayback() {
  const { active } = getCurrentPlaybackTiming();
  if (active) {
    stopPlayback();
    return;
  }
  const entry = getSelectedEntry();
  if (!entry) return;
  const mgr = getAudioManager();
  await mgr.unlock();
  const vol = Number(volumeInput.value) || 0.8;
  mgr.setVolume(vol);

  stopPlayback();

  if (entry.preload === 'stream') {
    activeStream = mgr.playStream(entry.url, {
      bus: entry.item?.bus || 'sfx',
      loop: loopInput.checked,
      volume: 1,
      autoplay: true,
    });
    startSeekTicker();
    statusEl.textContent = '';
    return;
  }

  if (entry.type === 'cue') {
    const variants = entry.item.variants || [];
    const bufs = await Promise.all(variants.map((v) => decodeCachedUrl(v.url)));
    if (!registeredCues.has(entry.name)) {
      mgr.registerCue(entry.name, bufs, {
        bus: entry.item.bus || 'combat',
        gainDb: Number(entry.item.gainDb) || 0,
      });
      registeredCues.add(entry.name);
    }
    const voice = await mgr.playCue(entry.name, { loop: loopInput.checked, volume: 1 });
    activeVoice = voice;
    const vIdx = Number.isInteger(voice?.variant) && voice.variant >= 0 ? voice.variant : 0;
    const pickedBuf = bufs[vIdx] || bufs[0];
    if (pickedBuf) {
      drawPcmWaveform(pickedBuf.getChannelData(0), {
        durationSec: pickedBuf.duration,
        analysis: analyzeAudioBuffer(pickedBuf),
      });
      voicePlaybackMeta = {
        startedAtMs: performance.now(),
        offsetSec: 0,
        durationSec: pickedBuf.duration,
        loop: loopInput.checked,
      };
      startSeekTicker();
    }
    statusEl.textContent = '';
    return;
  }

  if (!currentDecoded) {
    await selectCurrentAudio();
  }
  if (currentDecoded) {
    activeVoice = await mgr.play(currentDecoded, {
      volume: 1,
      loop: loopInput.checked,
      trimSilence: loopInput.checked,
    });
    voicePlaybackMeta = {
      startedAtMs: performance.now(),
      offsetSec: 0,
      durationSec: currentDecoded.duration,
      loop: loopInput.checked,
    };
    startSeekTicker();
    statusEl.textContent = '';
  }
}

async function playReferencePinkNoise() {
  const mgr = getAudioManager();
  const audioCtx = await mgr.unlock();
  mgr.setVolume(Number(volumeInput.value) || 0.8);
  stopPlayback();

  const sr = audioCtx.sampleRate || 44100;
  const nSamples = sr; // 1.0s
  const buf = audioCtx.createBuffer(1, nSamples, sr);
  const ch = buf.getChannelData(0);

  // Deterministic Voss-McCartney / Paul Kellet pink noise filter
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

  // Normalize exact RMS = -16.0 dBFS with smooth 15ms edges
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

  drawPcmWaveform(ch, { durationSec: 1.0, analysis: analyzeAudioBuffer(buf) });
  activeVoice = await mgr.play(buf, { bus: 'ui_voice', volume: 1, loop: false, trimSilence: false });
  statusEl.textContent = '正在播放：1s -16.0 dBFS 校准粉噪基准音 (uiVoiceBus)';
}

async function handleAudioUpload(file) {
  if (!file) return;
  statusEl.textContent = `上传 ${file.name}...`;
  try {
    const query = new URLSearchParams({ name: file.name, category: 'sfx' });
    const data = await apiRequestJson(`/api/hgame/audio?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    });
    activeSelection = { type: 'file', id: data.item.id };
    await refreshHGameAssets();
    populateFilterOptions();
    if (filterSelect) filterSelect.value = 'lib:full';
    renderList();
    await selectCurrentAudio();
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

async function deleteActiveAudio() {
  const entry = getSelectedEntry();
  if (!entry || entry.type !== 'file') return;
  stopPlayback();
  await apiRequestJson(`/api/hgame/audio/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
  decodedCache.delete(entry.url);
  await refreshHGameAssets();
  populateFilterOptions();
  renderList();
  await selectCurrentAudio();
}

async function initAudioView() {
  if (!initialized) {
    initialized = true;
    searchInput.addEventListener('input', renderList);
    filterSelect?.addEventListener('change', () => {
      stopPlayback();
      renderList();
      void selectCurrentAudio();
    });
    uploadButton.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', () => {
      const file = uploadInput.files?.[0];
      uploadInput.value = '';
      void handleAudioUpload(file);
    });
    playBtn.addEventListener('click', () => {
      void startPlayback();
    });
    refToneBtn?.addEventListener('click', () => {
      void playReferencePinkNoise();
    });
    deleteBtn.addEventListener('click', () => {
      void deleteActiveAudio();
    });
    volumeInput.addEventListener('input', () => {
      syncOutputs();
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
    onHGameAssetsChanged((data) => {
      uploadedAudio = Array.isArray(data.audio) ? data.audio : [];
      if (!viewEl.hidden) {
        populateFilterOptions();
        renderList();
      }
    });
  }

  syncOutputs();
  try {
    const [data, cueRes, streamRes, fullRes, reportRes] = await Promise.all([
      fetchHGameAssets(),
      fetch('/assets/cn/audio/cue_table.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { cues: [] })).catch(() => ({ cues: [] })),
      fetch('/assets/cn/audio/streams_table.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { streams: [] })).catch(() => ({ streams: [] })),
      fetch('/assets/cn/audio/audio_library_full.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })),
      fetch('/assets/cn/audio/audio_loudness_report.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    uploadedAudio = Array.isArray(data.audio) ? data.audio : [];
    cueEntries = Array.isArray(cueRes.cues) ? cueRes.cues : [];
    streamEntries = Array.isArray(streamRes.streams) ? streamRes.streams : [];
    fullEntries = Array.isArray(fullRes.items) ? fullRes.items : [];
    spreadAnomalyCues = new Set((reportRes?.cueSpreadAlerts || []).map((a) => a.cueName));
  } catch (error) {
    statusEl.textContent = error.message || '读取失败';
  }
  populateFilterOptions();
  renderList();
  await selectCurrentAudio();
}

window.addEventListener('webasset:workspace-change', (event) => {
  if (event.detail?.workspace === 'audio') {
    void initAudioView();
  } else {
    stopPlayback();
  }
});

if (viewEl && !viewEl.hidden) {
  void initAudioView();
}
