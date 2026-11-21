import * as THREE from 'three';
import { loadHdriEnvironment } from './realistic-pcg.js';
import {
  create2MapPbrMaterial,
  createThreeViewport,
  disposeObject3D,
  draw2MapChannelCanvases,
  loadSingle2MapAssets,
} from './hgame-shared.js';

const viewEl = document.querySelector('#materials-view');
const libTabs = [...document.querySelectorAll('.hgame-mat-lib-tab')];
const searchInput = document.querySelector('#hgame-material-search');
const sourceFilter = document.querySelector('#hgame-material-source-filter');
const listEl = document.querySelector('#hgame-material-list');
const titleEl = document.querySelector('#hgame-material-title');
const downloadEl = document.querySelector('#hgame-material-download');
const emptyEl = document.querySelector('#hgame-material-empty');
const stageEl = document.querySelector('#hgame-material-stage');
const mapsPanelEl = document.querySelector('#hgame-material-maps');
const mapColorCanvas = document.querySelector('#hgame-map-color');
const mapNormalCanvas = document.querySelector('#hgame-map-normal');
const mapRmCanvas = document.querySelector('#hgame-map-rm');
const shapeWrap = document.querySelector('#hgame-material-shape-wrap');
const shapeSelect = document.querySelector('#hgame-material-mesh-shape');
const tileInput = document.querySelector('#hgame-material-tile');
const tileVal = document.querySelector('#hgame-material-tile-val');
const bakemodeWrap = document.querySelector('#hgame-material-bakemode-wrap');
const statusEl = document.querySelector('#hgame-material-status');

const LIBRARIES = {
  materials: {
    label: '通用材质',
    baseUrl: '/assets/cn/materials',
    tableUrl: '/assets/cn/materials/material_table.json',
    itemsKey: 'materials',
  },
  pbr_foliage: {
    label: '植被',
    baseUrl: '/assets/cn/pbr_foliage',
    tableUrl: '/assets/cn/pbr_foliage/pbr_foliage_table.json',
    itemsKey: 'items',
  },
};

let initialized = false;
let currentLib = 'materials';
const tableCache = new Map();

let currentItems = [];
let selectedId = '';
let viewport = null;
let hdriEnv = null;
let previewMaterial = null;
let previewColorTex = null;
let previewNormRmTex = null;
let meshGroup = null;
let loadSeq = 0;

function ensureViewport() {
  if (!viewport) {
    viewport = createThreeViewport(stageEl, { background: 0x151b14, grid: true, shadows: true });
    viewport.camera.position.set(2.8, 2.1, 3.2);
    viewport.controls.target.set(0, 0.85, 0);
    viewport.controls.update();
  }
  return viewport;
}

function syncOutputs() {
  if (tileVal && tileInput) {
    tileVal.textContent = Number(tileInput.value || 1).toFixed(2);
  }
}

function disposePreviewResources() {
  if (previewMaterial) {
    previewMaterial.dispose();
    previewMaterial = null;
  }
  if (previewColorTex) {
    previewColorTex.dispose();
    previewColorTex = null;
  }
  if (previewNormRmTex) {
    previewNormRmTex.dispose();
    previewNormRmTex = null;
  }
  if (meshGroup && viewport) {
    viewport.scene.remove(meshGroup);
    disposeObject3D(meshGroup);
    meshGroup = null;
  }
}

function populateFilter() {
  if (!sourceFilter) return;
  const prev = sourceFilter.value || 'all';
  const libLabel = LIBRARIES[currentLib]?.label || '材质';
  const opts = [{ value: 'all', label: `全部${libLabel} (${currentItems.length})` }];

  if (currentLib === 'materials') {
    const sources = new Map();
    const surfaces = new Map();
    for (const m of currentItems) {
      const src = m.source || 'fablibrary';
      sources.set(src, (sources.get(src) || 0) + 1);
      const st = m.surfaceType || 'other';
      surfaces.set(st, (surfaces.get(st) || 0) + 1);
    }
    for (const [src, count] of sources) {
      opts.push({ value: `src:${src}`, label: `来源 · ${src} (${count})` });
    }
    for (const [st, count] of [...surfaces.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      opts.push({ value: `st:${st}`, label: `类型 · ${st} (${count})` });
    }
  } else {
    const cats = new Map();
    for (const m of currentItems) {
      const cat = m.category || 'other';
      cats.set(cat, (cats.get(cat) || 0) + 1);
    }
    for (const [cat, count] of [...cats.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      opts.push({ value: `cat:${cat}`, label: `分类 · ${cat} (${count})` });
    }
  }

  sourceFilter.replaceChildren();
  for (const o of opts) {
    const el = document.createElement('option');
    el.value = o.value;
    el.textContent = o.label;
    sourceFilter.append(el);
  }
  sourceFilter.value = opts.some(o => o.value === prev) ? prev : 'all';
}

function renderList() {
  if (!listEl) return;
  const query = (searchInput?.value || '').trim().toLowerCase();
  const filter = sourceFilter?.value || 'all';

  const items = currentItems.filter(m => {
    if (filter.startsWith('src:') && (m.source || '') !== filter.slice(4)) return false;
    if (filter.startsWith('st:') && (m.surfaceType || '') !== filter.slice(3)) return false;
    if (filter.startsWith('cat:') && (m.category || '') !== filter.slice(4)) return false;
    if (!query) return true;
    return String(m.id || '').toLowerCase().includes(query) ||
      String(m.category || '').toLowerCase().includes(query) ||
      String(m.surfaceType || '').toLowerCase().includes(query) ||
      String(m.sourcePath || '').toLowerCase().includes(query) ||
      String(m.assetId || '').toLowerCase().includes(query) ||
      String(m.source || '').toLowerCase().includes(query);
  });

  listEl.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'hgame-list-empty';
    empty.textContent = currentItems.length ? '没有匹配的材质' : '暂无材质';
    listEl.append(empty);
    return;
  }

  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hgame-list-item';
    btn.setAttribute('aria-current', item.id === selectedId ? 'true' : 'false');
    const copy = document.createElement('span');
    copy.className = 'hgame-item-copy';
    const strong = document.createElement('strong');
    strong.textContent = item.id;
    const small = document.createElement('small');
    const dim = `${item.width || 1024}×${item.height || 1024}`;
    const flags = currentLib === 'materials'
      ? [item.surfaceType, item.category, dim]
      : [item.category, dim];
    small.textContent = flags.filter(Boolean).join(' · ');
    copy.append(strong, small);
    btn.append(copy);
    btn.addEventListener('click', () => selectMaterial(item.id));
    listEl.append(btn);
  }
}

function buildPreviewGeometryGroup(libId, entry, mat) {
  const group = new THREE.Group();
  if (libId === 'materials') {
    const shape = shapeSelect?.value || 'combo';
    if (shape === 'combo') {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), mat);
      cube.position.set(-0.85, 0.72, 0);
      cube.castShadow = true;
      cube.receiveShadow = true;
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.92, 48, 32), mat);
      sphere.position.set(0.95, 0.95, 0);
      sphere.castShadow = true;
      sphere.receiveShadow = true;
      group.add(cube, sphere);
    } else if (shape === 'sphere') {
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.05, 48, 32), mat);
      sphere.position.set(0, 1.05, 0);
      sphere.castShadow = true;
      sphere.receiveShadow = true;
      group.add(sphere);
    } else {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.45, 1.45), mat);
      cube.position.set(0, 0.75, 0);
      cube.castShadow = true;
      cube.receiveShadow = true;
      group.add(cube);
    }
    return group;
  }

  const aspect = Math.max(0.1, Number(entry.aspectRatio || (entry.width || 1) / Math.max(1, entry.height || 1)));
  const maxSpan = 2.1;
  const planeW = aspect >= 1 ? maxSpan : maxSpan * aspect;
  const planeH = aspect >= 1 ? maxSpan / aspect : maxSpan;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), mat);
  plane.position.set(0, planeH * 0.5 + 0.15, 0);
  group.add(plane);
  return group;
}

function syncControlVisibility() {
  const isMaterials = currentLib === 'materials';
  if (shapeWrap) shapeWrap.hidden = !isMaterials;
  if (bakemodeWrap) bakemodeWrap.hidden = !isMaterials;
  const tileField = tileInput?.closest('label');
  if (tileField) tileField.hidden = !isMaterials;
}

async function selectMaterial(id) {
  selectedId = id || '';
  renderList();

  const entry = currentItems.find(m => m.id === selectedId);
  syncControlVisibility();

  if (!entry) {
    titleEl.textContent = `${LIBRARIES[currentLib]?.label || '材质'} · 未选择`;
    if (downloadEl) downloadEl.hidden = true;
    mapsPanelEl.hidden = true;
    emptyEl.hidden = false;
    disposePreviewResources();
    statusEl.textContent = currentItems.length ? '请从左侧列表选择一项材质预览' : '暂无可用材质';
    return;
  }

  const token = ++loadSeq;
  const vp = ensureViewport();
  const cfg = LIBRARIES[currentLib];
  emptyEl.hidden = true;
  mapsPanelEl.hidden = false;
  titleEl.textContent = currentLib === 'materials' && entry.layer != null
    ? `${entry.id} (#${entry.layer})`
    : `${entry.id} (${entry.width || 1024}×${entry.height || 1024})`;
  if (downloadEl) {
    downloadEl.href = '/assets/cn/browser.html';
    downloadEl.removeAttribute('download');
    downloadEl.target = '_blank';
    downloadEl.textContent = '打开母库检视台';
    downloadEl.hidden = false;
  }

  statusEl.textContent = `按需加载 ${entry.id} (Color + Normal_RM)…`;

  try {
    const assets = await loadSingle2MapAssets(cfg.baseUrl, entry.id);
    if (token !== loadSeq) return;

    disposePreviewResources();
    const { material, colorTex, normRmTex } = create2MapPbrMaterial({
      mode: currentLib === 'pbr_foliage' ? 'foliage' : 'opaque',
      assets,
      renderer: vp.renderer,
      repeat: Number(tileInput?.value || 1),
    });
    previewMaterial = material;
    previewColorTex = colorTex;
    previewNormRmTex = normRmTex;

    meshGroup = buildPreviewGeometryGroup(currentLib, entry, previewMaterial);
    vp.scene.add(meshGroup);

    draw2MapChannelCanvases(mapColorCanvas, mapNormalCanvas, mapRmCanvas, assets);

    const physStr = entry.physicalSizeMeters ? ` · ${entry.physicalSizeMeters}m` : '';
    const modeStr = currentLib === 'pbr_foliage'
      ? '双面植被(alphaTest 0.5)'
      : `${entry.surfaceType || ''} · ${entry.tiling || 'grid'}`;

    statusEl.textContent =
      `2贴图直读 (Color+Normal_RM OpenGL +Y) · ${entry.width || 1024}×${entry.height || 1024}${physStr} · ` +
      `${modeStr} · ${assets.loadMs.toFixed(0)}ms · ${entry.sourcePath || entry.assetId || entry.source || ''}`;
  } catch (err) {
    if (token !== loadSeq) return;
    statusEl.textContent = `加载失败: ${err.message}`;
  }
}

async function switchLibrary(libId) {
  if (!LIBRARIES[libId]) return;
  currentLib = libId;
  for (const tab of libTabs) {
    const active = tab.dataset.matLib === libId;
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.tabIndex = active ? 0 : -1;
  }

  const vp = ensureViewport();
  if (!hdriEnv) {
    loadHdriEnvironment({
      url: '/assets/cn/materials/hdri/cn_day_clear.hdr',
      renderer: vp.renderer,
      scene: vp.scene,
    }).then(env => {
      hdriEnv = env;
    }).catch(() => { /* non-fatal if HDRI unavailable */ });
  }

  const token = ++loadSeq;
  statusEl.textContent = `正在读取 ${LIBRARIES[libId].label} 清单…`;

  try {
    let items = tableCache.get(libId);
    if (!items) {
      const cfg = LIBRARIES[libId];
      const resp = await fetch(cfg.tableUrl, { cache: 'no-cache' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${cfg.tableUrl}`);
      const json = await resp.json();
      const raw = Array.isArray(json[cfg.itemsKey]) ? json[cfg.itemsKey] : [];
      items = raw.filter(m => m && m.id && m.id !== '__missing__' && m.slot !== '__missing__');
      tableCache.set(libId, items);
    }
    if (token !== loadSeq && currentLib !== libId) return;

    currentItems = items;
    populateFilter();
    const nextId = currentItems.some(m => m.id === selectedId) ? selectedId : (currentItems[0]?.id || '');
    await selectMaterial(nextId);
  } catch (err) {
    statusEl.textContent = `清单加载失败: ${err.message}`;
  }
}

function init() {
  if (initialized) return;
  initialized = true;

  for (const tab of libTabs) {
    tab.addEventListener('click', () => {
      const targetLib = tab.dataset.matLib;
      if (targetLib && targetLib !== currentLib) {
        switchLibrary(targetLib);
      }
    });
  }

  searchInput?.addEventListener('input', renderList);
  sourceFilter?.addEventListener('change', renderList);
  shapeSelect?.addEventListener('change', () => {
    const entry = currentItems.find(m => m.id === selectedId);
    if (!entry || !previewMaterial || !viewport) return;
    if (meshGroup) {
      viewport.scene.remove(meshGroup);
      disposeObject3D(meshGroup);
    }
    meshGroup = buildPreviewGeometryGroup(currentLib, entry, previewMaterial);
    viewport.scene.add(meshGroup);
  });

  tileInput?.addEventListener('input', () => {
    syncOutputs();
    if (currentLib === 'materials' && previewColorTex) {
      const tile = Math.max(0.25, Number(tileInput.value || 1));
      previewColorTex.repeat.set(tile, tile);
    }
  });
}

function activateMaterialsWorkspace() {
  init();
  const vp = ensureViewport();
  vp.start();
  syncOutputs();
  if (!currentItems.length) {
    switchLibrary(currentLib);
  }
}

window.addEventListener('webasset:workspace-change', event => {
  if (event.detail?.workspace === 'materials') {
    activateMaterialsWorkspace();
  } else {
    viewport?.stop();
  }
});

if (viewEl && !viewEl.hidden) {
  activateMaterialsWorkspace();
}
