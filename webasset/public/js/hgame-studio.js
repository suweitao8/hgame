import { createSidebarSquareCard } from './hgame-shared.js';

const studioView = document.querySelector('#studio-view');
const historyList = document.querySelector('#studio-history-list');
const modeTabs = [...document.querySelectorAll('#studio-view .studio-mode-tab')];
const toVideoBtn = document.querySelector('#studio-to-video');
const detailPromptEl = document.querySelector('#studio-detail-prompt');
const emptyEl = document.querySelector('#studio-empty');
const previewImg = document.querySelector('#studio-preview-img');
const previewVideo = document.querySelector('#studio-preview-video');
const promptInput = document.querySelector('#studio-prompt');
const imgControls = document.querySelector('#studio-img-controls');
const imgModelSelect = document.querySelector('#studio-img-model');
const imgSizeSelect = document.querySelector('#studio-img-size');
const vidControls = document.querySelector('#studio-vid-controls');
const vidImageInput = document.querySelector('#studio-video-image');
const refPreviewWrap = document.querySelector('#studio-ref-preview-wrap');
const refPreviewImg = document.querySelector('#studio-ref-preview');
const refClearBtn = document.querySelector('#studio-ref-clear');
const vidDurationSelect = document.querySelector('#studio-vid-duration');
const vidSizeSelect = document.querySelector('#studio-vid-size');
const submitBtn = document.querySelector('#studio-submit');
const statusEl = document.querySelector('#studio-status');

let initialized = false;
let currentMode = 'image';
let historyItems = [];
let activeItemId = null;
let selectedRef = null; // { dataUrl?, localAssetId?, previewUrl }
const activePolls = new Map(); // promptId -> timerId
let liveTickTimer = 0;

function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text || '';
}

function badgeInfoForItem(item) {
  const status = item.status || (item.url ? 'done' : 'queued');
  if (status === 'queued' || status === 'running') {
    const elapsed = typeof item.startedAtMs === 'number'
      ? formatDuration(Math.max(0, Date.now() - item.startedAtMs))
      : '';
    const prefix = status === 'running' ? '生成中' : '排队中';
    return {
      state: status,
      text: elapsed ? `${prefix} ${elapsed}` : prefix,
    };
  }
  if (status === 'error') {
    return { state: 'error', text: '失败' };
  }
  return {
    state: 'done',
    text: formatDuration(item.durationMs),
  };
}

function syncLiveBadges() {
  let hasActive = false;
  for (const item of historyItems) {
    if (item.status === 'queued' || item.status === 'running') {
      hasActive = true;
      const badgeEl = historyList?.querySelector(`.studio-card-badge[data-job-id="${CSS.escape(item.id)}"]`);
      const info = badgeInfoForItem(item);
      if (badgeEl) {
        badgeEl.dataset.state = info.state;
        badgeEl.textContent = info.text;
      }
      if (item.id === activeItemId) {
        setStatus(info.text);
      }
    }
  }
  if (!hasActive && liveTickTimer) {
    clearInterval(liveTickTimer);
    liveTickTimer = 0;
  }
}

function ensureLiveTicker() {
  if (!liveTickTimer && historyItems.some((it) => it.status === 'queued' || it.status === 'running')) {
    liveTickTimer = setInterval(syncLiveBadges, 500);
  }
}

function setMode(mode) {
  currentMode = mode === 'video' ? 'video' : 'image';
  for (const tab of modeTabs) {
    const active = tab.dataset.studioMode === currentMode;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  if (imgControls) imgControls.hidden = currentMode !== 'image';
  if (vidControls) vidControls.hidden = currentMode !== 'video';
}

function renderRefImage() {
  if (!refPreviewWrap || !refPreviewImg) return;
  if (selectedRef?.previewUrl) {
    refPreviewImg.src = selectedRef.previewUrl;
    refPreviewWrap.hidden = false;
  } else {
    refPreviewImg.removeAttribute('src');
    refPreviewWrap.hidden = true;
  }
}

function clearRefImage() {
  selectedRef = null;
  if (vidImageInput) vidImageInput.value = '';
  renderRefImage();
}

function hideMediaElements() {
  if (previewImg) {
    previewImg.hidden = true;
    previewImg.removeAttribute('src');
  }
  if (previewVideo) {
    previewVideo.pause();
    previewVideo.hidden = true;
    previewVideo.removeAttribute('src');
  }
}

function showResult(item) {
  activeItemId = item?.id || null;
  if (!item) {
    if (detailPromptEl) {
      detailPromptEl.hidden = true;
      detailPromptEl.textContent = '';
    }
    if (emptyEl) emptyEl.hidden = false;
    hideMediaElements();
    if (toVideoBtn) toVideoBtn.hidden = true;
    setStatus('');
    renderHistory();
    return;
  }

  if (detailPromptEl) {
    const text = (item.prompt || '').trim() || (item.kind === 'video' ? '图生视频' : '');
    const en = item.effectivePrompt && item.effectivePrompt !== item.prompt ? item.effectivePrompt : '';
    detailPromptEl.textContent = en ? `${text}\nEN: ${en}` : text;
    detailPromptEl.hidden = !text;
  }

  const status = item.status || (item.url ? 'done' : 'queued');
  if (status !== 'done' || !item.url) {
    if (emptyEl) emptyEl.hidden = true;
    hideMediaElements();
    if (toVideoBtn) toVideoBtn.hidden = true;
    if (status === 'error') {
      setStatus(`失败: ${item.error || '未知错误'}`);
    } else {
      setStatus(badgeInfoForItem(item).text);
    }
    renderHistory();
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  if (item.kind === 'video') {
    if (previewImg) {
      previewImg.hidden = true;
      previewImg.removeAttribute('src');
    }
    if (previewVideo) {
      previewVideo.src = item.url;
      previewVideo.hidden = false;
      previewVideo.play().catch(() => {});
    }
    if (toVideoBtn) toVideoBtn.hidden = true;
  } else {
    if (previewVideo) {
      previewVideo.pause();
      previewVideo.hidden = true;
      previewVideo.removeAttribute('src');
    }
    if (previewImg) {
      previewImg.src = item.url;
      previewImg.hidden = false;
    }
    if (toVideoBtn) toVideoBtn.hidden = false;
  }
  const dur = formatDuration(item.durationMs);
  setStatus(dur ? `耗时 ${dur}` : '');
  renderHistory();
}

function renderHistory() {
  if (!historyList) return;
  historyList.replaceChildren();
  if (!historyItems.length) {
    const empty = document.createElement('span');
    empty.className = 'game-list-empty';
    empty.textContent = '暂无记录';
    historyList.append(empty);
    return;
  }
  for (const item of historyItems) {
    const status = item.status || (item.url ? 'done' : 'queued');
    const label = (item.prompt || (item.kind === 'video' ? '视频' : '图片')).slice(0, 20);
    const { button } = createSidebarSquareCard({
      name: label,
      thumbUrl: status === 'done' && item.kind === 'image' ? item.url : '',
      badge: status === 'done' ? (item.kind === 'video' ? '▶' : '✦') : '',
      active: item.id === activeItemId,
      className: 'hgame-list-item studio-history-item',
      onClick: () => showResult(item),
    });
    const thumbBox = button.querySelector('.sidebar-card-thumb');
    const badgeInfo = badgeInfoForItem(item);
    if (thumbBox && badgeInfo.text) {
      const badgeEl = document.createElement('span');
      badgeEl.className = 'studio-card-badge';
      badgeEl.dataset.state = badgeInfo.state;
      badgeEl.dataset.jobId = item.id;
      badgeEl.textContent = badgeInfo.text;
      thumbBox.append(badgeEl);
    }
    historyList.append(button);
  }
  ensureLiveTicker();
}

async function loadStudioHistory() {
  try {
    const res = await fetch('/api/comfy/config');
    const data = await res.json();
    const doneItems = (Array.isArray(data.items) ? data.items : []).map((it) => ({ ...it, status: 'done' }));
    const pendingItems = (Array.isArray(data.pending) ? data.pending : []).map((it) => ({ ...it, status: it.status || 'queued' }));
    historyItems = [...pendingItems, ...doneItems];
    renderHistory();
    if (historyItems.length && !activeItemId) {
      showResult(historyItems[0]);
    }
    for (const p of pendingItems) {
      if (p.promptId && !activePolls.has(p.promptId)) {
        void pollJob(p.promptId);
      }
    }
  } catch (err) {
    setStatus(err.message || '加载失败');
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

async function handleImageFile(file) {
  if (!file) return;
  const dataUrl = await readFileAsDataUrl(file);
  selectedRef = { dataUrl, previewUrl: dataUrl };
  renderRefImage();
}

function clearJobPoll(promptId) {
  const timer = activePolls.get(promptId);
  if (timer) {
    clearTimeout(timer);
    activePolls.delete(promptId);
  }
}

async function pollJob(promptId) {
  clearJobPoll(promptId);
  const jobId = `job-${promptId}`;
  try {
    const res = await fetch(`/api/comfy/jobs/${encodeURIComponent(promptId)}`);
    const data = await res.json();
    if (data.status === 'done' && data.item) {
      const doneItem = { ...data.item, status: 'done' };
      const idx = historyItems.findIndex((it) => it.id === jobId || it.promptId === promptId);
      const wasActive = activeItemId === jobId || activeItemId === doneItem.id;
      if (idx >= 0) {
        historyItems.splice(idx, 1, doneItem);
      } else {
        historyItems = [doneItem, ...historyItems];
      }
      if (wasActive) {
        showResult(doneItem);
      } else {
        renderHistory();
      }
      return;
    }
    if (data.status === 'error') {
      const target = historyItems.find((it) => it.id === jobId || it.promptId === promptId);
      if (target) {
        target.status = 'error';
        target.error = data.message || '未知错误';
      }
      if (activeItemId === jobId && target) {
        showResult(target);
      } else {
        renderHistory();
      }
      return;
    }
    const target = historyItems.find((it) => it.id === jobId || it.promptId === promptId);
    if (target) {
      target.status = data.status === 'running' ? 'running' : 'queued';
      if (typeof data.elapsedMs === 'number') {
        target.startedAtMs = Date.now() - data.elapsedMs;
      }
      syncLiveBadges();
    }
    const timer = setTimeout(() => { void pollJob(promptId); }, 2000);
    activePolls.set(promptId, timer);
  } catch (err) {
    const target = historyItems.find((it) => it.id === jobId || it.promptId === promptId);
    if (target) {
      target.status = 'error';
      target.error = err.message || String(err);
      if (activeItemId === jobId) showResult(target);
      else renderHistory();
    }
  }
}

async function submitGeneration() {
  const prompt = (promptInput?.value || '').trim();
  if (currentMode === 'image' && !prompt) {
    setStatus('请输入提示词');
    return;
  }
  if (currentMode === 'video' && !prompt && !selectedRef) {
    setStatus('请输入提示词或选参考图');
    return;
  }
  if (submitBtn) submitBtn.disabled = true;
  setStatus('提交中');
  try {
    let endpoint = '/api/comfy/generate/image';
    let payload;
    if (currentMode === 'image') {
      const [w, h] = (imgSizeSelect?.value || '1024x1024').split('x').map(Number);
      payload = { prompt, width: w, height: h, model: imgModelSelect?.value || 'sdxl' };
    } else {
      endpoint = '/api/comfy/generate/video';
      const [w, h] = (vidSizeSelect?.value || '608x352').split('x').map(Number);
      const duration = Number(vidDurationSelect?.value || 3);
      payload = {
        prompt,
        width: w,
        height: h,
        duration,
        ...(selectedRef?.localAssetId ? { localAssetId: selectedRef.localAssetId } : {}),
        ...(selectedRef?.dataUrl ? { imageDataUrl: selectedRef.dataUrl } : {}),
      };
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);

    const queuedItem = {
      id: `job-${data.promptId}`,
      promptId: data.promptId,
      kind: data.kind || currentMode,
      prompt,
      ...(data.effectivePrompt ? { effectivePrompt: data.effectivePrompt } : {}),
      status: 'queued',
      startedAtMs: Date.now(),
      createdAt: new Date().toISOString(),
    };
    historyItems = [queuedItem, ...historyItems];
    if (promptInput) promptInput.value = '';
    showResult(queuedItem);
    void pollJob(data.promptId);
  } catch (err) {
    setStatus(err.message || '提交失败');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

modeTabs.forEach((tab) => {
  tab.addEventListener('click', () => setMode(tab.dataset.studioMode));
});

submitBtn?.addEventListener('click', () => { void submitGeneration(); });
refClearBtn?.addEventListener('click', clearRefImage);

vidImageInput?.addEventListener('change', () => {
  const file = vidImageInput.files?.[0];
  if (file) void handleImageFile(file);
});

toVideoBtn?.addEventListener('click', () => {
  const item = historyItems.find((it) => it.id === activeItemId);
  if (!item || item.kind !== 'image' || !item.url) return;
  selectedRef = { localAssetId: item.id, previewUrl: item.url };
  renderRefImage();
  setMode('video');
});

window.addEventListener('paste', (event) => {
  if (!studioView || studioView.hidden || currentMode !== 'video') return;
  const items = Array.from(event.clipboardData?.items || []);
  const imageItem = items.find((it) => it.type.startsWith('image/'));
  const file = imageItem?.getAsFile();
  if (file) {
    event.preventDefault();
    void handleImageFile(file);
  }
});

function ensureStudioLoaded() {
  if (!initialized && studioView && !studioView.hidden) {
    initialized = true;
    setMode('image');
    void loadStudioHistory();
  }
}

window.addEventListener('webasset:workspace-change', (event) => {
  if (event.detail?.workspace === 'studio') ensureStudioLoaded();
});
ensureStudioLoaded();
