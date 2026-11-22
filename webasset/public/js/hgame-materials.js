import * as THREE from 'three';
import { loadHdriEnvironment } from './realistic-pcg.js';
import {
  create2MapPbrMaterial,
  createSidebarSquareCard,
  createThreeViewport,
  disposeObject3D,
  draw2MapChannelCanvases,
  loadSingle2MapAssets,
} from './hgame-shared.js';

const BASE_URL = '/assets/cn/materials';
const TABLE_URL = '/assets/cn/materials/material_table.json';

const viewEl = document.querySelector('#materials-view');
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
const shapeSelect = document.querySelector('#hgame-material-mesh-shape');
const tileInput = document.querySelector('#hgame-material-tile');
const tileVal = document.querySelector('#hgame-material-tile-val');
const statusEl = document.querySelector('#hgame-material-status');

let initialized = false;
let matItems = [];
let selectedId = '';
let viewport = null;
let hdriEnv = null;
let previewMaterial = null;
let previewColorTex = null;
let previewNormRmTex = null;
let meshGroup = null;
let manifestLoaded = false;
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
  const sources = new Map();
  const surfaces = new Map();
  for (const m of matItems) {
    const src = m.source || 'fablibrary';
    sources.set(src, (sources.get(src) || 0) + 1);
    const st = m.surfaceType || 'other';
    surfaces.set(st, (surfaces.get(st) || 0) + 1);
  }

  const opts = [{ value: 'all', label: `全部通用无缝材质 (${matItems.length})` }];
  for (const [src, count] of sources) {
    opts.push({ value: `src:${src}`, label: `来源 · ${src} (${count})` });
  }
  for (const [st, count] of [...surfaces.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    opts.push({ value: `st:${st}`, label: `类型 · ${st} (${count})` });
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

  const items = matItems.filter(m => {
    if (filter.startsWith('src:') && (m.source || '') !== filter.slice(4)) return false;
    if (filter.startsWith('st:') && (m.surfaceType || '') !== filter.slice(3)) return false;
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
    empty.textContent = matItems.length ? '没有匹配的通用材质' : '暂无通用材质';
    listEl.append(empty);
    return;
  }

  for (const item of items) {
    const { button } = createSidebarSquareCard({
      name: item.id,
      thumbUrl: `${BASE_URL}/${item.id}/color.png`,
      badge: item.surfaceType || 'PBR',
      active: item.id === selectedId,
      onClick: () => selectMaterial(item.id),
    });
    listEl.append(button);
  }
}

function buildPreviewGeometryGroup(mat) {
  const group = new THREE.Group();
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

async function selectMaterial(id) {
  selectedId = id || '';
  renderList();

  const entry = matItems.find(m => m.id === selectedId);
  if (!entry) {
    titleEl.textContent = '通用地编 PBR 材质';
    if (downloadEl) downloadEl.hidden = true;
    mapsPanelEl.hidden = true;
    emptyEl.hidden = false;
    disposePreviewResources();
    statusEl.textContent = matItems.length ? '请从左侧列表选择一项通用材质预览' : '暂无可用材质';
    return;
  }

  const token = ++loadSeq;
  const vp = ensureViewport();
  emptyEl.hidden = true;
  mapsPanelEl.hidden = false;
  titleEl.textContent = entry.layer != null ? `${entry.id} (#${entry.layer})` : entry.id;
  if (downloadEl) {
    downloadEl.href = '/assets/cn/browser.html';
    downloadEl.removeAttribute('download');
    downloadEl.target = '_blank';
    downloadEl.textContent = '打开母库检视台';
    downloadEl.hidden = false;
  }

  statusEl.textContent = `按需加载 ${entry.id} (Color + Normal_RM)…`;

  try {
    const assets = await loadSingle2MapAssets(BASE_URL, entry.id);
    if (token !== loadSeq) return;

    disposePreviewResources();
    const { material, colorTex, normRmTex } = create2MapPbrMaterial({
      mode: 'opaque',
      assets,
      renderer: vp.renderer,
      repeat: Number(tileInput?.value || 1),
    });
    previewMaterial = material;
    previewColorTex = colorTex;
    previewNormRmTex = normRmTex;

    meshGroup = buildPreviewGeometryGroup(previewMaterial);
    vp.scene.add(meshGroup);

    draw2MapChannelCanvases(mapColorCanvas, mapNormalCanvas, mapRmCanvas, assets);

    statusEl.textContent =
      `2贴图直读 (Color+Normal_RM OpenGL +Y) · ${entry.width || 1024}×${entry.height || 1024} · ` +
      `${entry.surfaceType || ''} · ${entry.tiling || 'grid'} · ${assets.loadMs.toFixed(0)}ms · ` +
      `${entry.sourcePath || entry.assetId || entry.source || ''}`;
  } catch (err) {
    if (token !== loadSeq) return;
    statusEl.textContent = `加载失败: ${err.message}`;
  }
}

async function loadMaterialsManifest() {
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

  statusEl.textContent = '正在读取通用 PBR 材质清单…';
  try {
    const resp = await fetch(TABLE_URL, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${TABLE_URL}`);
    const json = await resp.json();
    const raw = Array.isArray(json.materials) ? json.materials : [];
    matItems = raw.filter(m => m && m.id && m.id !== '__missing__' && m.slot !== '__missing__');
    manifestLoaded = true;
    populateFilter();
    const nextId = matItems.some(m => m.id === selectedId) ? selectedId : (matItems[0]?.id || '');
    await selectMaterial(nextId);
  } catch (err) {
    statusEl.textContent = `清单加载失败: ${err.message}`;
  }
}

function init() {
  if (initialized) return;
  initialized = true;

  searchInput?.addEventListener('input', renderList);
  sourceFilter?.addEventListener('change', renderList);
  shapeSelect?.addEventListener('change', () => {
    if (!previewMaterial || !viewport) return;
    if (meshGroup) {
      viewport.scene.remove(meshGroup);
      disposeObject3D(meshGroup);
    }
    meshGroup = buildPreviewGeometryGroup(previewMaterial);
    viewport.scene.add(meshGroup);
  });

  tileInput?.addEventListener('input', () => {
    syncOutputs();
    if (previewColorTex) {
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
  if (!manifestLoaded) {
    void loadMaterialsManifest();
  }
}

window.addEventListener('webasset:open-asset', event => {
  const { workspace, id } = event.detail || {};
  if (workspace !== 'materials' || !id) return;
  selectedId = id;
  if (manifestLoaded) void selectMaterial(id);
});

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
