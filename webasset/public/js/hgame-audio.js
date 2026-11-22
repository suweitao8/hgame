import {
  analyzeAudioBuffer,
  createAudioManager,
} from '../runtime/hgame/platform/audio.js';
import {
  apiRequestJson,
  createSidebarSquareCard,
  fetchHGameAssets,
  formatBytes,
  onHGameAssetsChanged,
  refreshHGameAssets,
} from './hgame-shared.js';

const viewEl = document.querySelector('#audio-view');
const libTabs = Array.from(document.querySelectorAll('.hgame-audio-lib-tab'));
const searchInput = document.querySelector('#hgame-audio-search');
const filterSelect = document.querySelector('#hgame-audio-filter');
const uploadButton = document.querySelector('#hgame-audio-upload-button');
const uploadInput = document.querySelector('#hgame-audio-upload');
const listEl = document.querySelector('#hgame-audio-list');
const titleEl = document.querySelector('#hgame-audio-title');
const downloadEl = document.querySelector('#hgame-audio-download');
const deleteBtn = document.querySelector('#hgame-audio-delete-button');
const emptyEl = document.querySelector('#hgame-audio-empty');
const waveCanvas = document.querySelector('#hgame-audio-wave-canvas');
const metricsEl = document.querySelector('#hgame-audio-metrics');
const playBtn = document.querySelector('#hgame-audio-play-button');
const stopBtn = document.querySelector('#hgame-audio-stop-button');
const volumeInput = document.querySelector('#hgame-audio-volume');
const volumeVal = document.querySelector('#hgame-audio-volume-val');
const loopInput = document.querySelector('#hgame-audio-loop');
const statusEl = document.querySelector('#hgame-audio-status');

let initialized = false;
let currentLib = 'cues'; // 'cues' | 'streams' | 'full'
let cueEntries = [];
let streamEntries = [];
let fullEntries = [];
let uploadedAudio = [];
let activeSelection = { type: 'cue', id: '' };
let audioMgr = null;
let activeVoice = null;
let activeStream = null;
const decodedCache = new Map();
const registeredCues = new Set();
let currentDecoded = null;
let currentAnalysis = null;
let loadToken = 0;

function getAudioManager() {
  if (!audioMgr) {
    audioMgr = createAudioManager({ volume: Number(volumeInput.value) || 0.8 });
  }
  return audioMgr;
}

function updateLibTabsUi() {
  for (const tab of libTabs) {
    const active = tab.dataset.audioLib === currentLib;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
}

function buildActiveList() {
  if (currentLib === 'cues') {
    return cueEntries.map((c) => ({
      type: 'cue',
      id: c.cueName,
      name: c.cueName,
      pack: c.pack || (c.surfaceType ? `材质:${c.surfaceType}` : 'SFX'),
      category: c.category || 'sfx',
      preload: 'buffer',
      badge: '内存 SFX',
      url: c.variants?.[0]?.url || '',
      fileName: `${c.cueName}.mp3`,
      item: c,
    }));
  }
  if (currentLib === 'streams') {
    return streamEntries.map((s) => ({
      type: 'stream',
      id: s.id,
      name: s.name || s.id,
      pack: s.pack || 'Streams',
      category: s.pack || '流式音轨',
      preload: 'stream',
      badge: '流式音轨',
      url: s.url,
      fileName: `${s.name || s.id}.mp3`,
      item: s,
    }));
  }
  const uploaded = uploadedAudio.map((item) => ({
    type: 'file',
    id: item.id,
    name: item.name,
    pack: '已上传音频',
    category: '已上传音频',
    preload: 'buffer',
    badge: '已上传',
    url: item.url,
    fileName: item.name,
    item,
  }));
  const fullMapped = fullEntries.map((f) => ({
    type: f.preload === 'stream' ? 'stream' : 'sfx_item',
    id: f.id,
    name: f.name || f.id,
    pack: f.pack || 'Anim58',
    category: f.preload === 'stream' ? '流式长音轨 (>=4s)' : '内存 SFX (<4s)',
    preload: f.preload || 'buffer',
    badge: f.preload === 'stream' ? '流式音轨' : '内存 SFX',
    url: f.url,
    fileName: `${f.name || f.id}.mp3`,
    item: f,
  }));
  return [...uploaded, ...fullMapped];
}

function populateFilterOptions() {
  if (!filterSelect) return;
  const prev = filterSelect.value || 'all';
  filterSelect.replaceChildren();
  const entries = buildActiveList();
  const packs = new Map();
  let surfaceCount = 0;
  for (const e of entries) {
    if (e.pack) packs.set(e.pack, (packs.get(e.pack) || 0) + 1);
    if (e.category === 'footstep_surface' || e.category === 'impact_surface') surfaceCount++;
  }
  const addOpt = (val, text) => {
    const o = document.createElement('option');
    o.value = val;
    o.textContent = text;
    filterSelect.append(o);
  };
  addOpt('all', `全部 (${entries.length})`);
  if (surfaceCount > 0) {
    addOpt('surface', `10 材质脚步与受击 (${surfaceCount})`);
  }
  for (const [p, cnt] of [...packs.entries()].sort((a, b) => b[1] - a[1])) {
    addOpt(`pack:${p}`, `${p} (${cnt})`);
  }
  const hasPrev = [...filterSelect.options].some((o) => o.value === prev);
  filterSelect.value = hasPrev ? prev : 'all';
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

function renderList() {
  const entries = getFilteredList();
  listEl.replaceChildren();
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hgame-list-empty';
    empty.textContent = buildActiveList().length === 0 ? '暂无音频资产。' : '没有匹配的音频。';
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
    const { button } = createSidebarSquareCard({
      name: entry.type === 'cue'
        ? `${entry.name} (${entry.item?.variants?.length || 1}变体)`
        : entry.name,
      badge: entry.badge,
      active: selected,
      onClick: () => {
        stopPlayback();
        activeSelection = { type: entry.type, id: entry.id };
        renderList();
        void selectCurrentAudio();
      },
    });
    listEl.append(button);
  }
  if (entries.length > MAX_RENDER) {
    const hint = document.createElement('p');
    hint.className = 'hgame-list-empty';
    hint.textContent = `仅显示前 ${MAX_RENDER} / ${entries.length} 条，请输入关键词精确定位。`;
    listEl.append(hint);
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
  try {
    activeStream?.stop?.();
  } catch { /* ignore */ }
  activeStream = null;
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
    metricsEl.replaceChildren();
    deleteBtn.hidden = true;
    downloadEl.hidden = true;
    titleEl.textContent = '音效预览';
    statusEl.textContent = '暂无音频资产，可点击 ＋ 上传音频';
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
    downloadEl.textContent = `下载 ${entry.fileName}`;
  } else {
    downloadEl.hidden = true;
  }

  // Strictly defer network fetch for stream tracks until user clicks Play
  if (entry.preload === 'stream') {
    currentDecoded = null;
    currentAnalysis = null;
    drawPcmWaveform(null);
    const s = entry.item;
    renderMetrics([
      ['加载策略', '流式长音轨 (preload: stream · 不进首包)'],
      ['时长', `${Number(s.duration || 0).toFixed(2)} s`],
      ['编码', `MP3 44.1 kHz Stereo · ${s.bitrateKbps || 96} kbps`],
      ['体积', formatBytes(s.encodedBytes || 0)],
    ]);
    statusEl.textContent = `${entry.pack} · 流式按需加载就绪（点击「播放」发起流式拉取）`;
    return;
  }

  statusEl.textContent = entry.type === 'cue'
    ? `正在解码 Cue 组 (${entry.item.variants?.length || 1} 变体)...`
    : '正在解码并分析音频波形...';

  try {
    if (entry.type === 'cue') {
      const variants = entry.item.variants || [];
      const bufs = await Promise.all(variants.map((v) => decodeCachedUrl(v.url)));
      if (token !== loadToken) return;
      const mgr = getAudioManager();
      if (!registeredCues.has(entry.name)) {
        mgr.registerCue(entry.name, bufs, { bus: 'sfx' });
        registeredCues.add(entry.name);
      }
      currentDecoded = bufs[0] || null;
      currentAnalysis = currentDecoded ? analyzeAudioBuffer(currentDecoded) : null;
      if (currentDecoded) {
        drawPcmWaveform(currentDecoded.getChannelData(0), { durationSec: currentDecoded.duration, analysis: currentAnalysis });
      }
      const srcCnt = entry.item.totalSourceVariants || variants.length;
      renderMetrics([
        ['加载策略', '内存 SFX (preload: buffer · registerCue)'],
        ['变体抽样', `${variants.length} 精选 / ${srcCnt} 源变体`],
        ['编码', 'MP3 44.1 kHz Mono · 64 kbps · -14 LUFS'],
        ['首变体频谱质心', `${variants[0]?.spectralCentroidHz || 0} Hz`],
      ]);
      statusEl.textContent = `Cue 「${entry.name}」就绪（${variants.length} 变体）· 点击「播放」自动防重复随机试听`;
      return;
    }

    const buffer = await decodeCachedUrl(entry.url);
    if (token !== loadToken) return;
    currentDecoded = buffer;
    currentAnalysis = analyzeAudioBuffer(buffer);
    drawPcmWaveform(buffer.getChannelData(0), { durationSec: buffer.duration, analysis: currentAnalysis });
    renderMetrics([
      ['加载策略', entry.type === 'file' ? '本地上传资产' : '内存 SFX (preload: buffer)'],
      ['总时长', `${buffer.duration.toFixed(3)} s`],
      ['采样率', `${buffer.sampleRate} Hz (${buffer.numberOfChannels}ch)`],
      ['峰值 / RMS', `${currentAnalysis.peak.toFixed(2)} / ${currentAnalysis.rms.toFixed(3)}`],
    ]);
    statusEl.textContent = `${entry.pack} · 静音裁剪 ${currentAnalysis.trimStart.toFixed(3)}s ~ ${currentAnalysis.trimEnd.toFixed(3)}s`;
  } catch (error) {
    if (token !== loadToken) return;
    currentDecoded = null;
    currentAnalysis = null;
    drawPcmWaveform(null);
    statusEl.textContent = error.message || '音频解码失败';
  }
}

async function startPlayback() {
  const entry = getSelectedEntry();
  if (!entry) return;
  const mgr = getAudioManager();
  await mgr.unlock();
  const vol = Number(volumeInput.value) || 0.8;
  mgr.setVolume(vol);

  stopPlayback();

  if (entry.preload === 'stream') {
    activeStream = mgr.playStream(entry.url, {
      bus: 'music',
      loop: loopInput.checked,
      volume: 1,
      autoplay: true,
    });
    statusEl.textContent = `正在流式播放：${entry.name} (MP3 Stereo 96 kbps)`;
    return;
  }

  if (entry.type === 'cue') {
    const variants = entry.item.variants || [];
    const bufs = await Promise.all(variants.map((v) => decodeCachedUrl(v.url)));
    if (!registeredCues.has(entry.name)) {
      mgr.registerCue(entry.name, bufs, { bus: 'sfx' });
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
    }
    statusEl.textContent = `正在防重复随机试听：${entry.name} · 变体 #${vIdx + 1}/${variants.length} (${variants[vIdx]?.spectralCentroidHz || 0} Hz)`;
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
    statusEl.textContent = loopInput.checked ? '正在循环播放（已裁剪首尾静音）' : '正在播放音频';
  }
}

async function handleAudioUpload(file) {
  if (!file) return;
  statusEl.textContent = `正在上传 ${file.name}...`;
  try {
    const query = new URLSearchParams({ name: file.name, category: 'sfx' });
    const data = await apiRequestJson(`/api/hgame/audio?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    });
    currentLib = 'full';
    updateLibTabsUi();
    activeSelection = { type: 'file', id: data.item.id };
    await refreshHGameAssets();
    populateFilterOptions();
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
    for (const tab of libTabs) {
      tab.addEventListener('click', () => {
        const next = tab.dataset.audioLib || 'cues';
        if (next === currentLib) return;
        stopPlayback();
        currentLib = next;
        updateLibTabsUi();
        populateFilterOptions();
        renderList();
        void selectCurrentAudio();
      });
    }
    searchInput.addEventListener('input', renderList);
    filterSelect?.addEventListener('change', renderList);
    uploadButton.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', () => {
      const file = uploadInput.files?.[0];
      uploadInput.value = '';
      void handleAudioUpload(file);
    });
    playBtn.addEventListener('click', () => {
      void startPlayback();
    });
    stopBtn.addEventListener('click', () => {
      stopPlayback();
      statusEl.textContent = '已停止播放';
    });
    deleteBtn.addEventListener('click', () => {
      void deleteActiveAudio();
    });
    volumeInput.addEventListener('input', () => {
      syncOutputs();
      audioMgr?.setVolume(Number(volumeInput.value) || 0.8);
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
    const [data, cueRes, streamRes, fullRes] = await Promise.all([
      fetchHGameAssets(),
      fetch('/assets/cn/audio/cue_table.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { cues: [] })).catch(() => ({ cues: [] })),
      fetch('/assets/cn/audio/streams_table.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { streams: [] })).catch(() => ({ streams: [] })),
      fetch('/assets/cn/audio/audio_library_full.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })),
    ]);
    uploadedAudio = Array.isArray(data.audio) ? data.audio : [];
    cueEntries = Array.isArray(cueRes.cues) ? cueRes.cues : [];
    streamEntries = Array.isArray(streamRes.streams) ? streamRes.streams : [];
    fullEntries = Array.isArray(fullRes.items) ? fullRes.items : [];
  } catch (error) {
    statusEl.textContent = error.message || '读取音频列表失败';
  }
  updateLibTabsUi();
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
