import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {
  createWorldPbrMaterial,
  loadHdriEnvironment,
  PbrTextureArrayLoader,
} from './realistic-pcg.js';
import { applyCatalogMaterialToObject } from './test-scenes/showcase-common.js';
import {
  apiRequestJson,
  createSidebarSquareCard,
  createThreeViewport,
  disposeObject3D,
  drawUvWireframe,
  requestGlbSquareThumb,
} from './hgame-shared.js';

const viewEl = document.querySelector('#models-view');
const searchInput = document.querySelector('#hgame-model-search');
const filterSelect = document.querySelector('#hgame-model-pack-filter');
const uploadButton = document.querySelector('#hgame-model-upload-button');
const listEl = document.querySelector('#hgame-model-list');
const titleEl = document.querySelector('#hgame-model-title');
const downloadEl = document.querySelector('#hgame-model-download');
const modeTabs = [...document.querySelectorAll('.hgame-model-tab')];
const deleteButton = document.querySelector('#hgame-model-delete-button');
const emptyEl = document.querySelector('#hgame-model-empty');
const stageEl = document.querySelector('#hgame-model-stage');
const uvCanvas = document.querySelector('#hgame-model-uv-canvas');
const statusEl = document.querySelector('#hgame-model-status');
const paramControlsEl = document.querySelector('#hgame-model-param-controls');
const uvControlsEl = document.querySelector('#hgame-model-uv-controls');
const uvMeshSelect = document.querySelector('#hgame-model-uv-mesh');
const wireframeInput = document.querySelector('#hgame-model-wireframe');
const gridInput = document.querySelector('#hgame-model-grid');

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

let initialized = false;
let modelCatalog = [];
let selectedId = '';
let activeViewMode = '3d';
let viewport = null;
let hdriEnv = null;
let pbrLoader = null;
let texArray = null;
let worldMat = null;
let glassMat = null;
let currentMesh = null;
let currentUvTarget = null;
let manifestReady = false;
let loadSeq = 0;

if (uploadButton) uploadButton.hidden = true;
if (deleteButton) deleteButton.hidden = true;
if (paramControlsEl) paramControlsEl.hidden = true;

function ensureViewport() {
  if (!viewport) {
    viewport = createThreeViewport(stageEl, { background: 0x161c15, grid: gridInput?.checked ?? true, shadows: true });
  }
  return viewport;
}

function clearCurrentMesh() {
  if (currentMesh && viewport) {
    viewport.scene.remove(currentMesh);
    disposeObject3D(currentMesh);
    currentMesh = null;
  }
  currentUvTarget = null;
  if (uvMeshSelect) uvMeshSelect.replaceChildren();
}

function syncModeTabs() {
  for (const tab of modeTabs) {
    const selected = tab.dataset.hgameModelView === activeViewMode;
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    tab.tabIndex = selected ? 0 : -1;
  }
  const showUv = activeViewMode === 'uv';
  if (stageEl) stageEl.hidden = showUv;
  if (uvCanvas) uvCanvas.hidden = !showUv;
  if (uvControlsEl) uvControlsEl.hidden = !showUv || !currentMesh;
  if (showUv && currentUvTarget) {
    drawUvWireframe(uvCanvas, currentUvTarget, statusEl);
  }
}

function populateFilter() {
  if (!filterSelect) return;
  const prev = filterSelect.value || 'all';
  const groups = new Map();
  for (const m of modelCatalog) {
    const key = m.group || 'l1_arch';
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const opts = [{ value: 'all', label: `全部静态 GLB (${modelCatalog.length})` }];
  for (const [grp, count] of groups) {
    opts.push({ value: `group:${grp}`, label: `${grp} (${count})` });
  }
  filterSelect.replaceChildren();
  for (const o of opts) {
    const el = document.createElement('option');
    el.value = o.value;
    el.textContent = o.label;
    filterSelect.append(el);
  }
  filterSelect.value = opts.some(o => o.value === prev) ? prev : 'all';
}

function renderList() {
  if (!listEl) return;
  const query = (searchInput?.value || '').trim().toLowerCase();
  const filter = filterSelect?.value || 'all';

  const items = modelCatalog.filter(m => {
    if (filter.startsWith('group:') && (m.group || 'l1_arch') !== filter.slice(6)) return false;
    if (!query) return true;
    return (
      m.id.toLowerCase().includes(query) ||
      (m.tags || []).some(t => t.toLowerCase().includes(query)) ||
      (m.quadrants || []).some(q => q.toLowerCase().includes(query))
    );
  });

  listEl.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'hgame-list-empty';
    empty.textContent = modelCatalog.length ? '没有匹配的静态 GLB 模型' : '暂无静态 GLB 资产';
    listEl.append(empty);
    return;
  }

  for (const item of items) {
    const relPath = item.path || item.lods?.[0]?.path || '';
    const { button, thumbBox, fallbackEl } = createSidebarSquareCard({
      name: item.id,
      badge: item.tier || 'GLB',
      active: item.id === selectedId,
      onClick: () => selectModel(item.id),
    });
    if (relPath) {
      requestGlbSquareThumb(`/assets/cn/${relPath}`, thumbBox, fallbackEl);
    }
    listEl.append(button);
  }
}

function bindArrayMaterials(root, entry) {
  const fallbackSlot = Object.values(entry.materialSlots || {})[0] || '__missing__';
  const wire = Boolean(wireframeInput?.checked);
  applyCatalogMaterialToObject(root, fallbackSlot, {
    texArray,
    worldMat,
    glassMat,
    wireframe: wire,
  });

  const uvTargets = [];
  root.traverse(obj => {
    if (!obj.isMesh) return;
    uvTargets.push({ name: obj.name || entry.id, geometry: obj.geometry, material: worldMat.material });
  });
  return uvTargets;
}

function setEmbeddedLodVisibility(root, targetLevel = 0) {
  let hasTarget = false;
  root.traverse(obj => {
    const n = obj.name || '';
    if (n === `mesh_lod${targetLevel}` || n.endsWith(`_lod${targetLevel}`)) {
      hasTarget = true;
    }
  });
  const activeLvl = hasTarget ? targetLevel : 0;
  root.traverse(obj => {
    const n = obj.name || '';
    if (n === 'mesh_lod1' || n.endsWith('_lod1')) {
      obj.visible = activeLvl === 1;
    } else if (n === 'mesh_lod2' || n.endsWith('_lod2')) {
      obj.visible = activeLvl === 2;
    } else if (n === 'mesh_lod0' || n.startsWith('pivot_') || n.startsWith('wheel_') || n.startsWith('light_')) {
      obj.visible = activeLvl === 0;
    }
  });
  return activeLvl;
}

async function selectModel(id) {
  selectedId = id || '';
  renderList();
  const entry = modelCatalog.find(m => m.id === selectedId);
  const relPath = entry?.path || entry?.lods?.[0]?.path;
  const lod0 = entry?.lods?.[0];
  if (!entry || !relPath || !texArray) {
    clearCurrentMesh();
    if (titleEl) titleEl.textContent = '静态 GLB 模型';
    if (downloadEl) downloadEl.hidden = true;
    if (emptyEl) emptyEl.hidden = false;
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  if (titleEl) titleEl.textContent = `${entry.id} (${entry.tier})`;
  const glbUrl = `/assets/cn/${relPath}`;
  if (downloadEl) {
    downloadEl.href = glbUrl;
    downloadEl.download = `${entry.id}.glb`;
    downloadEl.textContent = `${entry.id}.glb (${entry.fileKB || lod0?.fileKB || 0} KB)`;
    downloadEl.hidden = false;
  }

  const token = ++loadSeq;
  const vp = ensureViewport();
  const gltf = await gltfLoader.loadAsync(glbUrl);
  if (token !== loadSeq) return;

  clearCurrentMesh();
  const root = gltf.scene;
  const uvTargets = bindArrayMaterials(root, entry);
  setEmbeddedLodVisibility(root, 0);
  vp.scene.add(root);
  currentMesh = root;
  currentUvTarget = uvTargets[0] || null;

  if (uvMeshSelect) {
    uvMeshSelect.replaceChildren();
    uvTargets.forEach((t, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = t.name;
      uvMeshSelect.append(opt);
    });
  }

  vp.frameObject(root);
  const b = entry.bounds?.size || [0, 0, 0];
  const lodSummary = (entry.lods || []).map(l => `L${l.level}:${l.tris}`).join('/');
  statusEl.textContent = `${lodSummary || `${lod0?.tris || 0} tris`} · ${lod0?.gpuVerts || 0} 顶点 · ${lod0?.submeshes || 1} Submesh · ${b[0].toFixed(2)}×${b[1].toFixed(2)}×${b[2].toFixed(2)}m`;
  if (activeViewMode === 'uv' && currentUvTarget) {
    if (uvControlsEl) uvControlsEl.hidden = false;
    drawUvWireframe(uvCanvas, currentUvTarget, statusEl);
  }
}

async function loadCnModelLibrary() {
  const token = ++loadSeq;
  const vp = ensureViewport();
  statusEl.textContent = '正在加载 hgame-assets-cn 静态母库与 2贴图 PBR 阵列…';

  if (!pbrLoader) {
    pbrLoader = new PbrTextureArrayLoader({ baseUrl: '/assets/cn/materials' });
  }
  if (!texArray) {
    texArray = await pbrLoader.load({ renderer: vp.renderer, resolution: 256 });
  }
  if (token !== loadSeq) return;

  if (!hdriEnv) {
    try {
      hdriEnv = await loadHdriEnvironment({
        url: '/assets/cn/materials/hdri/cn_day_clear.hdr',
        renderer: vp.renderer,
        scene: vp.scene,
      });
    } catch { /* non-fatal */ }
  }

  if (!worldMat) {
    worldMat = createWorldPbrMaterial({ textureArrays: texArray, registry: texArray.registry });
  }
  if (!glassMat) {
    glassMat = createWorldPbrMaterial({ textureArrays: texArray, registry: texArray.registry, translucent: true });
  }

  const catalog = await apiRequestJson('/api/hgame/cn/catalog');
  if (token !== loadSeq) return;
  modelCatalog = Array.isArray(catalog.models) ? catalog.models : [];
  populateFilter();
  manifestReady = true;
  renderList();
  const nextId = modelCatalog.some(m => m.id === selectedId) ? selectedId : (modelCatalog[0]?.id || '');
  await selectModel(nextId);
}

function init() {
  if (initialized) return;
  initialized = true;
  searchInput?.addEventListener('input', renderList);
  filterSelect?.addEventListener('change', renderList);
  wireframeInput?.addEventListener('change', () => {
    const wire = Boolean(wireframeInput.checked);
    if (worldMat) worldMat.material.wireframe = wire;
    if (glassMat) glassMat.material.wireframe = wire;
  });
  gridInput?.addEventListener('change', () => {
    if (viewport) viewport.gridHelper.visible = Boolean(gridInput.checked);
  });
  for (const tab of modeTabs) {
    tab.addEventListener('click', () => {
      activeViewMode = tab.dataset.hgameModelView || '3d';
      syncModeTabs();
    });
  }
}

function activateModelsWorkspace() {
  init();
  const vp = ensureViewport();
  vp.start();
  syncModeTabs();
  if (!manifestReady) {
    loadCnModelLibrary().catch(err => { statusEl.textContent = err.message; });
  }
}

window.addEventListener('webasset:open-asset', event => {
  const { workspace, id } = event.detail || {};
  if (workspace !== 'models' || !id) return;
  selectedId = id;
  if (manifestReady) void selectModel(id);
});

window.addEventListener('webasset:workspace-change', event => {
  if (event.detail?.workspace === 'models') {
    activateModelsWorkspace();
  } else {
    viewport?.stop();
  }
});

if (viewEl && !viewEl.hidden) {
  activateModelsWorkspace();
}
