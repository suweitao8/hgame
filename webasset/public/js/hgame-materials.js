import * as THREE from 'three';
import { loadHdriEnvironment } from './realistic-pcg.js';
import {
  create2MapPbrMaterial,
  createSidebarSquareCard,
  createThreeViewport,
  disposeObject3D,
  loadSingle2MapAssets,
} from './hgame-shared.js';

const BASE_URL = '/assets/cn/materials';
const TABLE_URL = '/assets/cn/materials/material_table.json';

const viewEl = document.querySelector('#materials-view');
const searchInput = document.querySelector('#hgame-material-search');
const sourceFilter = document.querySelector('#hgame-material-source-filter');
const listEl = document.querySelector('#hgame-material-list');
const titleEl = document.querySelector('#hgame-material-title');
const emptyEl = document.querySelector('#hgame-material-empty');
const stageEl = document.querySelector('#hgame-material-stage');

let initialized = false;
let matItems = [];
let selectedId = '';
let currentUvScale = 1.0;
let currentIsGlass = false;
let viewport = null;
let hdriEnv = null;
let previewMaterial = null;
let previewColorTex = null;
let previewNormRmTex = null;
let meshGroup = null;
let manifestLoaded = false;
let loadSeq = 0;

function resolveEntryScanMeters(entry) {
  if (!entry) return 1.0;
  const raw = Array.isArray(entry.scanSizeMeters)
    ? Number(entry.scanSizeMeters[0])
    : Number(entry.scanSizeMeters ?? entry.physicalSizeMeters);
  return Number.isFinite(raw) && raw > 0 ? raw : 1.0;
}

function resolveEntryUvScale(entry) {
  if (entry && Number.isFinite(entry.uvScale) && entry.uvScale > 0) {
    return entry.uvScale;
  }
  return Number((1.0 / resolveEntryScanMeters(entry)).toFixed(4));
}

function createMetricBoxGeometry(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  // Standard metric world UV: 1.0m = 1.0 UV unit, corner-anchored at [0..w, 0..h, 0..d]
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + w * 0.5;
    const y = pos.getY(i) + h * 0.5;
    const z = pos.getZ(i) + d * 0.5;
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const nz = Math.abs(nrm.getZ(i));
    if (ny >= nx && ny >= nz) uv.setXY(i, x, z);
    else if (nx >= ny && nx >= nz) uv.setXY(i, z, y);
    else uv.setXY(i, x, y);
  }
  uv.needsUpdate = true;
  return geo;
}

function createMetricSphereGeometry(radius) {
  const geo = new THREE.SphereGeometry(radius, 48, 32);
  const uv = geo.getAttribute('uv');
  const uMeters = Math.max(1.0, Number((2 * radius).toFixed(2)));
  const vMeters = Math.max(1.0, Number((2 * radius).toFixed(2)));
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * uMeters, uv.getY(i) * vMeters);
  }
  uv.needsUpdate = true;
  return geo;
}

function ensureViewport() {
  if (!viewport) {
    viewport = createThreeViewport(stageEl, { background: 0x151b14, grid: true, shadows: true });
    viewport.camera.position.set(2.8, 2.1, 3.2);
    viewport.controls.target.set(0, 0.85, 0);
    viewport.controls.update();
  }
  return viewport;
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
    const uvScale = resolveEntryUvScale(item);
    const { button } = createSidebarSquareCard({
      name: item.id,
      thumbUrl: `${BASE_URL}/${item.id}/color.png`,
      badge: `${item.surfaceType || 'PBR'} · UV×${uvScale}`,
      active: item.id === selectedId,
      onClick: () => selectMaterial(item.id),
    });
    listEl.append(button);
  }
}

function createGlassReferenceCore(kind, x, y, z) {
  const coreGroup = new THREE.Group();
  const barMat = new THREE.MeshStandardMaterial({ color: 0xd99b43, roughness: 0.42, metalness: 0.25 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.55, metalness: 0.35 });
  if (kind === 'cube') {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.72, 0.42), barMat);
    pillar.position.set(x, y, z);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.14, 0.56), darkMat);
    band.position.set(x, y, z);
    coreGroup.add(pillar, band);
  } else if (kind === 'sphere') {
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), barMat);
    core.position.set(x, y, z);
    coreGroup.add(core);
  } else if (kind === 'slab') {
    const stripA = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.02, 0.18), barMat);
    stripA.position.set(x, 0.01, z - 0.18);
    const stripB = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.02, 0.18), darkMat);
    stripB.position.set(x, 0.01, z + 0.18);
    coreGroup.add(stripA, stripB);
  }
  return coreGroup;
}

function buildPreviewGeometryGroup(mat, isGlass = false) {
  const group = new THREE.Group();
  const ro = isGlass ? 2 : 0;
  // 1.0m x 1.0m x 1.0m standard metric reference cube (1m = 1 UV)
  const cube = new THREE.Mesh(createMetricBoxGeometry(1.0, 1.0, 1.0), mat);
  cube.position.set(-0.72, 0.54, -0.35);
  cube.castShadow = !isGlass;
  cube.receiveShadow = true;
  cube.renderOrder = ro;
  // 1.0m diameter sphere (radius 0.5m)
  const sphere = new THREE.Mesh(createMetricSphereGeometry(0.5), mat);
  sphere.position.set(0.72, 0.54, -0.35);
  sphere.castShadow = !isGlass;
  sphere.receiveShadow = true;
  sphere.renderOrder = ro;
  // 2.0m x 1.0m metric ground swatch in front
  const slab = new THREE.Mesh(createMetricBoxGeometry(2.0, 0.04, 1.0), mat);
  slab.position.set(0, isGlass ? 0.05 : 0.02, 0.82);
  slab.receiveShadow = true;
  slab.renderOrder = ro;
  if (isGlass) {
    group.add(
      createGlassReferenceCore('cube', -0.72, 0.54, -0.35),
      createGlassReferenceCore('sphere', 0.72, 0.54, -0.35),
      createGlassReferenceCore('slab', 0, 0.01, 0.82),
    );
  }
  group.add(cube, sphere, slab);
  return group;
}

async function selectMaterial(id) {
  selectedId = id || '';
  renderList();

  const entry = matItems.find(m => m.id === selectedId);
  if (!entry) {
    titleEl.textContent = '材质';
    emptyEl.hidden = false;
    disposePreviewResources();
    return;
  }

  const token = ++loadSeq;
  const vp = ensureViewport();
  emptyEl.hidden = true;
  titleEl.textContent = entry.layer != null ? `${entry.id} (#${entry.layer})` : entry.id;

  try {
    const assets = await loadSingle2MapAssets(BASE_URL, entry.id);
    if (token !== loadSeq) return;

    disposePreviewResources();
    currentUvScale = resolveEntryUvScale(entry);
    currentIsGlass = entry.blendMode === 'translucent' || entry.surfaceType === 'glass';
    const { material, colorTex, normRmTex } = create2MapPbrMaterial({
      mode: currentIsGlass ? 'glass' : 'opaque',
      assets,
      renderer: vp.renderer,
      repeat: 1,
      uvScale: currentUvScale,
    });
    previewMaterial = material;
    previewColorTex = colorTex;
    previewNormRmTex = normRmTex;

    meshGroup = buildPreviewGeometryGroup(previewMaterial, currentIsGlass);
    vp.scene.add(meshGroup);
  } catch (err) {
    if (token !== loadSeq) return;
    emptyEl.textContent = `加载失败: ${err.message}`;
    emptyEl.hidden = false;
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
    emptyEl.textContent = `清单加载失败: ${err.message}`;
    emptyEl.hidden = false;
  }
}

function init() {
  if (initialized) return;
  initialized = true;

  searchInput?.addEventListener('input', renderList);
  sourceFilter?.addEventListener('change', renderList);
}

function activateMaterialsWorkspace() {
  init();
  const vp = ensureViewport();
  vp.start();
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
