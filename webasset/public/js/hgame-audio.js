import {
  analyzeAudioBuffer,
  createAudioManager,
} from '../runtime/hgame/platform/audio.js';
import {
  apiRequestJson,
  fetchHGameAssets,
  fetchUnrealCatalog,
  formatBytes,
  onHGameAssetsChanged,
  refreshHGameAssets,
} from './hgame-shared.js';

const AUDIO_CATEGORY_ORDER = ['动作与打击音效', '环境与爆破', '音乐 BGM', '音效'];

const viewEl = document.querySelector('#audio-view');
const searchInput = document.querySelector('#hgame-audio-search');
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
let unrealAudio = [];
let uploadedAudio = [];
let activeSelection = { type: 'unreal', id: '' };
let audioMgr = null;
let activeVoice = null;
const decodedCache = new Map();
let currentDecoded = null;
let currentAnalysis = null;
let loadToken = 0;

function getAudioManager() {
  if (!audioMgr) {
    audioMgr = createAudioManager({ volume: Number(volumeInput.value) || 0.8 });
  }
  return audioMgr;
}

function buildCatalog() {
  const unrealEntries = unrealAudio.map(item => ({
    type: 'unreal',
    id: item.id,
    name: item.name || item.id,
    category: item.category || '音效',
    sub: `${item.pack || 'Anim58'}${item.bytes ? ` · ${formatBytes(item.bytes)}` : ''}`,
    url: item.url,
    fileName: item.url.split('/').pop() || `${item.id}.wav`,
    item,
  }));
  const fileEntries = uploadedAudio.map(item => ({
    type: 'file',
    id: item.id,
    name: item.name,
    category: '已上传音频',
    sub: formatBytes(item.bytes),
    url: item.url,
    fileName: item.name,
    item,
  }));
  return [...unrealEntries, ...fileEntries];
}

function getSelectedEntry() {
  const catalog = buildCatalog();
  return catalog.find(entry => entry.type === activeSelection.type && entry.id === activeSelection.id)
    || catalog[0]
    || null;
}

function renderList() {
  const query = searchInput.value.trim().toLowerCase();
  const entries = buildCatalog().filter(entry =>
    !query
    || entry.name.toLowerCase().includes(query)
    || entry.id.toLowerCase().includes(query)
    || entry.category.toLowerCase().includes(query));

  listEl.replaceChildren();
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hgame-list-empty';
    empty.textContent = buildCatalog().length === 0 ? '暂无音频资产。' : '没有匹配的音频。';
    listEl.append(empty);
    return;
  }

  if (!entries.some(entry => entry.type === activeSelection.type && entry.id === activeSelection.id)) {
    activeSelection = { type: entries[0].type, id: entries[0].id };
  }

  const byCat = new Map();
  for (const entry of entries) {
    if (!byCat.has(entry.category)) byCat.set(entry.category, []);
    byCat.get(entry.category).push(entry);
  }
  const categories = [
    ...AUDIO_CATEGORY_ORDER.filter(cat => byCat.has(cat)),
    ...[...byCat.keys()].filter(cat => !AUDIO_CATEGORY_ORDER.includes(cat)),
  ];

  for (const cat of categories) {
    const group = byCat.get(cat);
    const heading = document.createElement('div');
    heading.className = 'hgame-list-heading';
    heading.textContent = `${cat} (${group.length})`;
    listEl.append(heading);

    for (const entry of group) {
      const selected = entry.type === activeSelection.type && entry.id === activeSelection.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hgame-list-item';
      btn.setAttribute('aria-current', selected ? 'true' : 'false');

      const badge = document.createElement('span');
      badge.className = 'hgame-item-thumb hgame-item-thumb-badge';
      badge.textContent = entry.category === '音乐 BGM' ? 'BGM' : 'WAV';

      const copy = document.createElement('span');
      copy.className = 'hgame-item-copy';
      const strong = document.createElement('strong');
      strong.textContent = entry.name;
      const small = document.createElement('small');
      small.textContent = entry.sub;
      copy.append(strong, small);

      btn.append(badge, copy);
      btn.addEventListener('click', () => {
        stopPlayback();
        activeSelection = { type: entry.type, id: entry.id };
        renderList();
        void selectCurrentAudio();
      });
      listEl.append(btn);
    }
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
  downloadEl.hidden = false;
  downloadEl.href = entry.url;
  downloadEl.download = entry.fileName;
  downloadEl.textContent = `下载 ${entry.fileName}`;
  statusEl.textContent = '正在解码并分析音频波形...';

  const cacheKey = `${entry.type}:${entry.id}`;
  try {
    let buffer = decodedCache.get(cacheKey);
    if (!buffer) {
      const response = await fetch(entry.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuf = await response.arrayBuffer();
      if (token !== loadToken) return;
      const mgr = getAudioManager();
      buffer = await mgr.decode(arrayBuf);
      decodedCache.set(cacheKey, buffer);
    }
    if (token !== loadToken) return;
    currentDecoded = buffer;
    currentAnalysis = analyzeAudioBuffer(buffer);
    const channelData = buffer.getChannelData(0);
    drawPcmWaveform(channelData, { durationSec: buffer.duration, analysis: currentAnalysis });
    renderMetrics([
      ['总时长', `${buffer.duration.toFixed(3)} s`],
      ['有效时长', `${currentAnalysis.activeDuration.toFixed(3)} s`],
      ['采样率', `${buffer.sampleRate} Hz (${buffer.numberOfChannels}ch)`],
      ['峰值 / RMS', `${currentAnalysis.peak.toFixed(2)} / ${currentAnalysis.rms.toFixed(3)}`],
    ]);
    statusEl.textContent = `${entry.category} · 静音裁剪区间 ${currentAnalysis.trimStart.toFixed(3)}s ~ ${currentAnalysis.trimEnd.toFixed(3)}s`;
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
  mgr.setVolume(Number(volumeInput.value) || 0.8);

  if (!currentDecoded) {
    await selectCurrentAudio();
  }
  if (currentDecoded) {
    stopPlayback();
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
    activeSelection = { type: 'file', id: data.item.id };
    await refreshHGameAssets();
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
  decodedCache.delete(`file:${entry.id}`);
  activeSelection = { type: 'unreal', id: unrealAudio[0]?.id || '' };
  await refreshHGameAssets();
  renderList();
  await selectCurrentAudio();
}

async function initAudioView() {
  if (!initialized) {
    initialized = true;
    searchInput.addEventListener('input', renderList);
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
    onHGameAssetsChanged(data => {
      uploadedAudio = Array.isArray(data.audio) ? data.audio : [];
      if (!viewEl.hidden) renderList();
    });
  }

  syncOutputs();
  try {
    const [data, unrealCatalog] = await Promise.all([
      fetchHGameAssets(),
      fetchUnrealCatalog(),
    ]);
    uploadedAudio = Array.isArray(data.audio) ? data.audio : [];
    unrealAudio = Array.isArray(unrealCatalog.audio) ? unrealCatalog.audio : [];
  } catch (error) {
    statusEl.textContent = error.message || '读取音频列表失败';
  }
  renderList();
  await selectCurrentAudio();
}

window.addEventListener('webasset:workspace-change', event => {
  if (event.detail?.workspace === 'audio') {
    void initAudioView();
  } else {
    stopPlayback();
  }
});

if (viewEl && !viewEl.hidden) {
  void initAudioView();
}
