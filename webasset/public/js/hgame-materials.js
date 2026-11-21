import * as THREE from 'three';
import {
  buildBeveledBoxRaw,
  buildBufferGeometryFromRaw,
  createWorldPbrMaterial,
  ensurePbrGeometryAttributes,
  loadHdriEnvironment,
  PbrTextureArrayLoader,
} from './realistic-pcg.js';
import {
  createThreeViewport,
  disposeObject3D,
} from './hgame-shared.js';

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
const resSelect = document.querySelector('#hgame-material-bakemode');
const statusEl = document.querySelector('#hgame-material-status');

let initialized = false;
let matSummaries = [];
let selectedId = '';
let viewport = null;
let hdriEnv = null;
let pbrLoader = null;
let texArray = null;
let worldMat = null;
let meshGroup = null;
let manifestReady = false;
let loadSeq = 0;

function ensureViewport() {
  if (!viewport) {
    viewport = createThreeViewport(stageEl, { background: 0x151b14, grid: true, shadows: true });
    viewport.camera.position.set(2.8, 2.1, 3.2);
    viewport.controls.target.set(0, 0.75, 0);
    viewport.controls.update();
  }
  return viewport;
}

function syncOutputs() {
  if (tileVal && tileInput) {
    tileVal.textContent = Number(tileInput.value || 1).toFixed(2);
  }
}

function populateFilter() {
  if (!sourceFilter) return;
  const prev = sourceFilter.value || 'all';
  const sources = new Map();
  for (const m of matSummaries) {
    const s = m.source || 'cc0';
    sources.set(s, (sources.get(s) || 0) + 1);
  }
  const opts = [{ value: 'all', label: `全部 CC0 PBR 材质 (${matSummaries.length})` }];
  for (const [src, count] of sources) {
    opts.push({ value: `src:${src}`, label: `${src} (${count})` });
  }
  opts.push({ value: 'tiling:stochastic', label: '防重复 · stochastic' });
  opts.push({ value: 'tiling:grid', label: '对齐平铺 · grid' });
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

  const items = matSummaries.filter(m => {
    if (filter.startsWith('src:') && (m.source || '') !== filter.slice(4)) return false;
    if (filter.startsWith('tiling:') && (m.tiling || 'grid') !== filter.slice(7)) return false;
    if (!query) return true;
    return m.slot.toLowerCase().includes(query) ||
      String(m.assetId || '').toLowerCase().includes(query) ||
      String(m.source || '').toLowerCase().includes(query);
  });

  listEl.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'hgame-list-empty';
    empty.textContent = matSummaries.length ? '没有匹配的 PBR 材质' : '暂无 PBR 材质';
    listEl.append(empty);
    return;
  }

  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hgame-list-item';
    btn.setAttribute('aria-current', item.slot === selectedId ? 'true' : 'false');
    const copy = document.createElement('span');
    copy.className = 'hgame-item-copy';
    const strong = document.createElement('strong');
    strong.textContent = item.slot;
    const small = document.createElement('small');
    const flags = [item.source, item.assetId, item.tiling];
    if (item.alphaCutout) flags.push('镂空');
    if (item.tintable) flags.push('可染色');
    small.textContent = flags.filter(Boolean).join(' · ');
    copy.append(strong, small);
    btn.append(copy);
    btn.addEventListener('click', () => selectMaterial(item.slot));
    listEl.append(btn);
  }
}

function createSampleGeometry(kind, layerId, slotName = '') {
  if (kind === 'sphere') {
    const geo = new THREE.SphereGeometry(0.95, 48, 32);
    return ensurePbrGeometryAttributes(geo, layerId, [1, 1, 1], 1.0);
  }
  const box = new THREE.BoxGeometry(1.3, 1.3, 1.3);
  ensurePbrGeometryAttributes(box, layerId, [1, 1, 1], 1.0);
  if ((slotName === 'grass_side' || slotName === 'snow_side') && texArray?.registry) {
    const topSlot = slotName === 'snow_side' ? 'snow' : 'grass_top';
    const topLayer = texArray.registry.getLayer(topSlot);
    const botLayer = texArray.registry.getLayer('dirt');
    const nrm = box.getAttribute('normal');
    const matAttr = box.getAttribute('aMaterialId');
    for (let i = 0; i < nrm.count; i++) {
      const ny = nrm.getY(i);
      if (ny > 0.5) matAttr.setX(i, topLayer);
      else if (ny < -0.5) matAttr.setX(i, botLayer);
      else matAttr.setX(i, layerId);
    }
    matAttr.needsUpdate = true;
  }
  return box;
}

function rebuildPreviewMaterialAndMesh() {
  if (!texArray || !selectedId) return;
  const vp = ensureViewport();
  const entry = matSummaries.find(m => m.slot === selectedId);
  const layerId = texArray.registry.getLayer(selectedId);

  if (worldMat) {
    worldMat.dispose();
    worldMat = null;
  }
  worldMat = createWorldPbrMaterial({
    textureArrays: texArray,
    registry: texArray.registry,
    alphaCutout: Boolean(entry?.alphaCutout),
    uvMultiplier: Number(tileInput?.value || 1),
  });

  if (meshGroup) {
    vp.scene.remove(meshGroup);
    disposeObject3D(meshGroup);
    meshGroup = null;
  }

  meshGroup = new THREE.Group();
  const shape = shapeSelect?.value || 'combo';
  if (shape === 'combo') {
    const cube = new THREE.Mesh(createSampleGeometry('cube', layerId, selectedId), worldMat.material);
    cube.position.set(-0.85, 0.72, 0);
    cube.castShadow = true;
    cube.receiveShadow = true;
    const sphere = new THREE.Mesh(createSampleGeometry('sphere', layerId, selectedId), worldMat.material);
    sphere.position.set(0.95, 0.95, 0);
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    meshGroup.add(cube, sphere);
  } else {
    const m = new THREE.Mesh(createSampleGeometry(shape, layerId, selectedId), worldMat.material);
    m.position.set(0, 0.95, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    meshGroup.add(m);
  }
  vp.scene.add(meshGroup);

  texArray.drawLayerToCanvas(mapColorCanvas, 'albedo', layerId);
  texArray.drawLayerToCanvas(mapNormalCanvas, 'normal', layerId);
  texArray.drawLayerToCanvas(mapRmCanvas, 'rm', layerId);

  const mipTag = texArray.runtimeDerived ? ` (由${texArray.sourceSize}衍生)` : '';
  statusEl.textContent =
    `2贴图 PBR (Color+Normal_RM) · ${texArray.tileSize}px${mipTag} · ${texArray.layerCount}层 · ` +
    `加载 ${texArray.loadTimeMs.toFixed(0)}ms · ${texArray.anisotropy}x Aniso · ${entry?.source || ''}:${entry?.assetId || ''}`;
}

function selectMaterial(slot) {
  selectedId = slot || '';
  renderList();
  const entry = matSummaries.find(m => m.slot === selectedId);
  if (!entry || !texArray) {
    titleEl.textContent = '通用地编 PBR 材质';
    if (downloadEl) downloadEl.hidden = true;
    mapsPanelEl.hidden = true;
    emptyEl.hidden = false;
    if (meshGroup && viewport) {
      viewport.scene.remove(meshGroup);
      disposeObject3D(meshGroup);
      meshGroup = null;
    }
    if (statusEl && texArray && matSummaries.length === 0) {
      statusEl.textContent = '暂无通用 PBR 材质（通用地面/墙面无缝材质；除玻璃外无透明通道）';
    }
    return;
  }

  emptyEl.hidden = true;
  mapsPanelEl.hidden = false;
  titleEl.textContent = `${entry.slot} (#${entry.layer})`;
  if (downloadEl) {
    downloadEl.href = '/assets/cn/browser.html';
    downloadEl.removeAttribute('download');
    downloadEl.target = '_blank';
    downloadEl.textContent = '打开母库检视台';
    downloadEl.hidden = false;
  }

  syncOutputs();
  rebuildPreviewMaterialAndMesh();
}

async function loadPbrMaterials() {
  const token = ++loadSeq;
  const vp = ensureViewport();
  statusEl.textContent = '正在加载 2贴图 PBR 图集并切片上传至 TEXTURE_2D_ARRAY…';

  if (!pbrLoader) {
    pbrLoader = new PbrTextureArrayLoader({ baseUrl: '/assets/cn/materials' });
  }
  const rawVal = resSelect?.value;
  const requestedRes = ['512', '256', '128', '64', '16'].includes(rawVal) ? Number(rawVal) : 'auto';
  const nextTex = await pbrLoader.load({ renderer: vp.renderer, resolution: requestedRes });
  if (token !== loadSeq) {
    nextTex.dispose();
    return;
  }
  if (texArray) texArray.dispose();
  texArray = nextTex;

  if (!hdriEnv) {
    try {
      hdriEnv = await loadHdriEnvironment({
        url: '/assets/cn/materials/hdri/cn_day_clear.hdr',
        renderer: vp.renderer,
        scene: vp.scene,
      });
    } catch { /* non-fatal if HDRI unavailable */ }
  }

  matSummaries = texArray.registry.listSlots({ includeMissing: false });
  populateFilter();
  manifestReady = true;
  renderList();
  const nextId = matSummaries.some(m => m.slot === selectedId) ? selectedId : (matSummaries[0]?.slot || '');
  selectMaterial(nextId);
}

function init() {
  if (initialized) return;
  initialized = true;

  searchInput?.addEventListener('input', renderList);
  sourceFilter?.addEventListener('change', renderList);
  shapeSelect?.addEventListener('change', rebuildPreviewMaterialAndMesh);
  tileInput?.addEventListener('input', () => {
    syncOutputs();
    if (worldMat) worldMat.setUvMultiplier(Number(tileInput.value || 1));
  });
  resSelect?.addEventListener('change', () => {
    loadPbrMaterials().catch(err => { statusEl.textContent = err.message; });
  });
}

function activateMaterialsWorkspace() {
  init();
  const vp = ensureViewport();
  vp.start();
  syncOutputs();
  if (!manifestReady) {
    loadPbrMaterials().catch(err => { statusEl.textContent = err.message; });
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
