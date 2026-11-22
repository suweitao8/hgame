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
const refToneBtn = document.querySelector('#hgame-audio-ref-tone-button');
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
const musicBarEl = document.querySelector('#hgame-audio-music-bar');

let initialized = false;
let currentLib = 'cues'; // 'cues' | 'music' | 'streams' | 'full'
let cueEntries = [];
let musicEntries = [];
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

function isMusicCueEntry(c) {
  const name = String(c?.cueName || c?.id || '');
  return c?.category === 'bgm' || c?.category === 'stinger' || name.startsWith('bgm.') || name.startsWith('stinger.');
}

function buildActiveList() {
  if (currentLib === 'music') {
    return musicEntries.map((c) => {
      const isBgm = c.category === 'bgm' || String(c.cueName || '').startsWith('bgm.');
      return {
        type: 'cue',
        id: c.cueName,
        name: c.cueName,
        pack: isBgm ? 'BGM' : 'Stinger',
        category: isBgm ? 'bgm' : 'stinger',
        preload: isBgm ? 'stream' : 'buffer',
        badge: isBgm ? 'BGM 循环' : 'Stinger',
        url: c.url || c.variants?.[0]?.url || '',
        fileName: `${c.cueName}.mp3`,
        item: c,
      };
    });
  }
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
  if (entry.category === 'bgm' && rmsDb !== null && Math.abs(rmsDb - (-19.0)) > 1.5) {
    anomaly = true;
  }
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
    const loud = computeAudioLoudnessSummary(entry);
    const isBgmEntry = entry.category === 'bgm';
    const { button } = createSidebarSquareCard({
      name: entry.type === 'cue' && !isMusicCueEntry(entry.item)
        ? `${entry.name} (${entry.item?.variants?.length || 1}变体)`
        : entry.name,
      badge: entry.badge,
      active: selected,
      onClick: () => {
        if (!isBgmEntry) stopPlayback();
        activeSelection = { type: entry.type, id: entry.id };
        renderList();
        void selectCurrentAudio();
      },
    });
    if (isBgmEntry) {
      const it = entry.item || {};
      const lufsVal = Number.isFinite(it.measuredLufs ?? it.measuredDb) ? `${Number(it.measuredLufs ?? it.measuredDb).toFixed(1)} LUFS` : '--';
      const pkVal = Number.isFinite(it.peakDb) ? `${Number(it.peakDb).toFixed(1)} dB` : '--';
      const durVal = Number.isFinite(it.durationSec ?? it.duration) ? `${Number(it.durationSec ?? it.duration).toFixed(1)}s` : '--';
      const kbVal = Number.isFinite(it.sizeKb)
        ? `${Math.round(it.sizeKb)} KB`
        : (it.encodedBytes ? `${Math.round(it.encodedBytes / 1024)} KB` : '--');
      const row = document.createElement('div');
      row.className = 'hgame-audio-bgm-row';
      const metaSpan = document.createElement('span');
      metaSpan.className = 'hgame-audio-loud-meta';
      metaSpan.textContent = `${lufsVal} / ${pkVal} / ${durVal} / ${kbVal}`;
      const seamBtn = document.createElement('button');
      seamBtn.type = 'button';
      seamBtn.className = 'hgame-audio-seam-btn';
      seamBtn.textContent = '测接缝';
      seamBtn.title = '跳至结尾前 4.0 秒，5 秒内验听无缝循环接缝';
      seamBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        activeSelection = { type: entry.type, id: entry.id };
        renderList();
        void selectCurrentAudio();
        void playBgmSeamTest(entry.item);
      });
      row.append(metaSpan, seamBtn);
      button.append(row);
    } else {
      const metaSpan = document.createElement('span');
      metaSpan.className = 'hgame-audio-loud-meta';
      metaSpan.textContent = loud.text;
      button.append(metaSpan);
    }
    if (loud.anomaly) {
      button.dataset.loudnessAnomaly = 'true';
    }
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

function stopPlayback({ keepBgm = false } = {}) {
  try {
    activeVoice?.stop?.({ fadeOutMs: 12 });
  } catch { /* ignore */ }
  activeVoice = null;
  try {
    activeStream?.stop?.();
  } catch { /* ignore */ }
  activeStream = null;
  if (!keepBgm) {
    try {
      audioMgr?.stopBgm?.({ fadeMs: 120 });
    } catch { /* ignore */ }
  }
  renderMusicVerifyBar();
}

function renderMusicVerifyBar() {
  if (!musicBarEl) return;
  if (currentLib !== 'music') {
    musicBarEl.hidden = true;
    musicBarEl.replaceChildren();
    return;
  }
  const bgmList = musicEntries.filter((c) => c.category === 'bgm' || String(c.cueName || '').startsWith('bgm.'));
  const stingerList = musicEntries.filter((c) => c.category === 'stinger' || String(c.cueName || '').startsWith('stinger.'));
  musicBarEl.hidden = false;
  musicBarEl.replaceChildren();

  const activeBgmId = audioMgr?.getBgmState?.().cueId || null;

  const bgmLabel = document.createElement('span');
  bgmLabel.textContent = '600ms 交叉切歌:';
  musicBarEl.append(bgmLabel);

  if (bgmList.length === 0) {
    const none = document.createElement('span');
    none.textContent = '暂无 BGM（投放至 audio_ai_staging/bgm 后运行 --only-music）';
    musicBarEl.append(none);
  } else {
    for (const bgm of bgmList.slice(0, 6)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hgame-audio-music-pill';
      btn.textContent = bgm.cueName.replace(/^bgm\./, '');
      btn.setAttribute('aria-pressed', String(activeBgmId === bgm.cueName));
      btn.addEventListener('click', () => {
        void playBgmCrossfade(bgm);
      });
      musicBarEl.append(btn);
    }
  }

  if (stingerList.length > 0) {
    const stLabel = document.createElement('span');
    stLabel.textContent = '叠加 Stinger (-6dB 闪避):';
    musicBarEl.append(stLabel);
    for (const st of stingerList.slice(0, 6)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hgame-audio-music-pill';
      btn.textContent = st.cueName.replace(/^stinger\./, '');
      btn.addEventListener('click', () => {
        void playStingerOverlay(st);
      });
      musicBarEl.append(btn);
    }
  }
}

async function playBgmCrossfade(bgmItem) {
  if (!bgmItem) return;
  const mgr = getAudioManager();
  await mgr.unlock();
  mgr.setVolume(Number(volumeInput.value) || 0.8);
  stopPlayback({ keepBgm: true });
  try {
    const res = await mgr.playBgm(bgmItem, { fadeMs: 600, loop: true });
    renderMusicVerifyBar();
    if (res?.ignored) {
      statusEl.textContent = `BGM「${bgmItem.cueName}」已在播放（防重入忽略）`;
    } else {
      statusEl.textContent = `正在播放 BGM（600ms 淡入切换）：${bgmItem.cueName} · ${(bgmItem.measuredLufs ?? bgmItem.measuredDb ?? -19).toFixed(1)} LUFS`;
    }
  } catch (err) {
    statusEl.textContent = err?.message || 'BGM 播放失败';
  }
}

async function playBgmSeamTest(bgmItem) {
  if (!bgmItem) return;
  const mgr = getAudioManager();
  await mgr.unlock();
  mgr.setVolume(Number(volumeInput.value) || 0.8);
  stopPlayback({ keepBgm: true });
  const trimStart = Number(bgmItem.trimStartSec) || 0.026;
  const loopEnd = Number(bgmItem.trimEndSec) || Number(bgmItem.durationSec) || Number(bgmItem.duration) || 48;
  const startAtSec = Math.max(trimStart, loopEnd - 4.0);
  try {
    await mgr.playBgm(bgmItem, {
      fadeMs: 120,
      forceRestart: true,
      loop: true,
      startAtSec,
    });
    renderMusicVerifyBar();
    statusEl.textContent = `测接缝（结尾前 4.0s 起播）：${bgmItem.cueName} · 5 秒内可听尾接首循环点`;
  } catch (err) {
    statusEl.textContent = err?.message || '测接缝播放失败';
  }
}

async function playStingerOverlay(stingerItem) {
  if (!stingerItem) return;
  const mgr = getAudioManager();
  await mgr.unlock();
  mgr.setVolume(Number(volumeInput.value) || 0.8);
  const url = stingerItem.url || stingerItem.variants?.[0]?.url;
  if (!url) return;
  const buf = await decodeCachedUrl(url);
  if (!registeredCues.has(stingerItem.cueName)) {
    mgr.registerCue(stingerItem.cueName, [buf], {
      bus: stingerItem.bus || 'ui_voice',
      gainDb: Number(stingerItem.gainDb) || 0,
      ducking: stingerItem.ducking !== false,
    });
    registeredCues.add(stingerItem.cueName);
  }
  activeVoice = await mgr.playCue(stingerItem.cueName, { loop: false, volume: 1, ducking: true });
  statusEl.textContent = `叠加 Stinger：${stingerItem.cueName}（bgmBus 已压低 -6 dB，播完后 400ms 恢复）`;
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
    if (entry.category === 'bgm') {
      const lufs = Number(s.measuredLufs ?? s.measuredDb);
      const pk = Number(s.peakDb);
      const dur = Number(s.durationSec ?? s.duration ?? 0);
      const kb = Number(s.sizeKb) || (s.encodedBytes ? s.encodedBytes / 1024 : 0);
      renderMetrics([
        ['加载策略', '流式循环 BGM (preload: stream · 零卡顿接缝)'],
        ['响度 / 峰值', `${Number.isFinite(lufs) ? `${lufs.toFixed(1)} LUFS` : '--'} / ${Number.isFinite(pk) ? `${pk.toFixed(1)} dBTP` : '--'}`],
        ['时长 / BPM', `${dur.toFixed(2)} s · ${s.bpm ? `${s.bpm} BPM` : '无 BPM'}`],
        ['体积 / 裁剪', `${kb.toFixed(1)} KB · ${Number(s.trimStartSec || 0).toFixed(3)}s~${Number(s.trimEndSec || dur).toFixed(3)}s`],
      ]);
      statusEl.textContent = `BGM 「${entry.name}」就绪 · 点「播放」切歌，点「测接缝」5 秒验听循环点`;
    } else {
      renderMetrics([
        ['加载策略', '流式长音轨 (preload: stream · 不进首包)'],
        ['时长', `${Number(s.duration || 0).toFixed(2)} s`],
        ['编码', `MP3 44.1 kHz Stereo · ${s.bitrateKbps || 96} kbps`],
        ['体积', formatBytes(s.encodedBytes || 0)],
      ]);
      statusEl.textContent = `${entry.pack} · 流式按需加载就绪（点击「播放」发起流式拉取）`;
    }
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
      const srcCnt = entry.item.totalSourceVariants || variants.length;
      const loud = computeAudioLoudnessSummary(entry);
      renderMetrics([
        ['加载策略', `内存 SFX · 总线 ${entry.item.bus || 'combat'} (${loud.tier})`],
        ['响度 / 峰值', loud.text],
        ['变体抽样', `${variants.length} 精选 / ${srcCnt} 源变体`],
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

  const isStinger = entry.category === 'stinger';
  if (entry.category === 'bgm') {
    await playBgmCrossfade(entry.item);
    return;
  }

  stopPlayback({ keepBgm: isStinger });

  if (entry.preload === 'stream') {
    activeStream = mgr.playStream(entry.url, {
      bus: entry.item?.bus || 'bgm',
      loop: loopInput.checked,
      volume: 1,
      autoplay: true,
    });
    statusEl.textContent = `正在流式播放：${entry.name} (MP3 Stereo 96 kbps)`;
    return;
  }

  if (isStinger) {
    await playStingerOverlay(entry.item);
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
        renderMusicVerifyBar();
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
    refToneBtn?.addEventListener('click', () => {
      void playReferencePinkNoise();
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
    const [data, cueRes, musicRes, streamRes, fullRes, reportRes] = await Promise.all([
      fetchHGameAssets(),
      fetch('/assets/cn/audio/cue_table.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { cues: [] })).catch(() => ({ cues: [] })),
      fetch('/assets/cn/audio/music_table.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { tracks: [] })).catch(() => ({ tracks: [] })),
      fetch('/assets/cn/audio/streams_table.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { streams: [] })).catch(() => ({ streams: [] })),
      fetch('/assets/cn/audio/audio_library_full.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })),
      fetch('/assets/cn/audio/audio_loudness_report.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    uploadedAudio = Array.isArray(data.audio) ? data.audio : [];
    cueEntries = Array.isArray(cueRes.cues) ? cueRes.cues : [];
    musicEntries = Array.isArray(musicRes.tracks)
      ? musicRes.tracks
      : [...(Array.isArray(musicRes.bgm) ? musicRes.bgm : []), ...(Array.isArray(musicRes.stingers) ? musicRes.stingers : [])];
    streamEntries = Array.isArray(streamRes.streams) ? streamRes.streams : [];
    fullEntries = Array.isArray(fullRes.items) ? fullRes.items : [];
    spreadAnomalyCues = new Set((reportRes?.cueSpreadAlerts || []).map((a) => a.cueName));
  } catch (error) {
    statusEl.textContent = error.message || '读取音频列表失败';
  }
  updateLibTabsUi();
  populateFilterOptions();
  renderList();
  renderMusicVerifyBar();
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
