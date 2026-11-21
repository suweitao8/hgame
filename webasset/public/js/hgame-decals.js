import * as THREE from 'three';
import { loadHdriEnvironment } from './realistic-pcg.js';
import {
  apiRequestJson,
  create2MapPbrMaterial,
  createThreeViewport,
  disposeObject3D,
  draw2MapChannelCanvases,
  drawImageFittedToCanvas,
  fetchUnrealCatalog,
  loadHtmlImage,
  loadSingle2MapAssets,
} from './hgame-shared.js';

const DECAL_PACK_ORDER = [
  '混凝土贴花 Concrete',
  '弹坑焦痕 Crater',
  '街道与路面 Road',
  '血迹贴花 Blood',
];

const SURFACE_FALLBACKS = {
  concrete: { color: 0x4b504a, roughness: 0.88, cnId: 'concrete_road_01' },
  asphalt: { color: 0x262928, roughness: 0.92, cnId: 'asphalt_road_01' },
  brick: { color: 0x62463a, roughness: 0.86, cnId: 'brick_red_cn' },
};

const SURFACE_PATTERNS = {
  concrete: /(concrete|cement|plaster|stone)/i,
  asphalt: /(asphalt|road|tarmac|paving)/i,
  brick: /(brick|masonry|floorpaving|tile)/i,
};

const viewEl = document.querySelector('#decals-view');
const libTabs = Array.from(document.querySelectorAll('.hgame-decal-lib-tab'));
const searchInput = document.querySelector('#hgame-decal-search');
const packFilter = document.querySelector('#hgame-decal-pack-filter');
const listEl = document.querySelector('#hgame-decal-list');
const titleEl = document.querySelector('#hgame-decal-title');
const downloadEl = document.querySelector('#hgame-decal-download');
const modeTabs = Array.from(document.querySelectorAll('.hgame-decal-mode-tab'));
const emptyEl = document.querySelector('#hgame-decal-empty');
const stageEl = document.querySelector('#hgame-decal-stage');
const mapsRowEl = document.querySelector('#hgame-decal-maps');
const mapColorCanvas = document.querySelector('#hgame-decal-map-color');
const mapNormalCanvas = document.querySelector('#hgame-decal-map-normal');
const mapOrmCanvas = document.querySelector('#hgame-decal-map-orm');
const mapRmLabel = document.querySelector('#hgame-decal-map-rm-label');
const surfaceSelect = document.querySelector('#hgame-decal-surface');
const scaleInput = document.querySelector('#hgame-decal-scale');
const scaleValEl = document.querySelector('#hgame-decal-scale-val');
const rotInput = document.querySelector('#hgame-decal-rot');
const rotValEl = document.querySelector('#hgame-decal-rot-val');
const opacityInput = document.querySelector('#hgame-decal-opacity');
const opacityValEl = document.querySelector('#hgame-decal-opacity-val');
const tintWrap = document.querySelector('#hgame-decal-tint-wrap');
const tintSelect = document.querySelector('#hgame-decal-tint');
const statusEl = document.querySelector('#hgame-decal-status');

const texLoader = new THREE.TextureLoader();

const CN_LIBS = {
  cn_pbr: {
    baseUrl: '/assets/cn/pbr_decals',
    tableUrl: '/assets/cn/pbr_decals/pbr_decals_table.json',
    mode: 'decal',
    label: '全部 2-Texture PBR 贴花',
  },
  cn_foliage: {
    baseUrl: '/assets/cn/pbr_foliage',
    tableUrl: '/assets/cn/pbr_foliage/pbr_foliage_table.json',
    mode: 'foliage',
    label: '全部 2-Texture PBR 植被卡片',
  },
};

let currentLib = 'cn_pbr';
let cnDecals = [];
let cnFoliage = [];
let unrealDecals = [];
let baseMaterials = [];
let activeId = '';
let previewMode = 'surface';
let viewport = null;
let hdriEnv = null;
let stageRoot = null;
let decalMesh = null;
let decalMaterial = null;
let decalTextures = [];
let decalAspect = 1;
let initialized = false;
let loadToken = 0;
let catalogLoaded = false;
const baseSurfaceCache = new Map();

function syncSliderLabels() {
  scaleValEl.textContent = `${Number(scaleInput.value).toFixed(2)}×`;
  rotValEl.textContent = `${Math.round(Number(rotInput.value) || 0)}°`;
  opacityValEl.textContent = Number(opacityInput.value).toFixed(2);
}

function getActiveList() {
  if (currentLib === 'cn_pbr') return cnDecals;
  if (currentLib === 'cn_foliage') return cnFoliage;
  return unrealDecals;
}

function getFilteredDecals() {
  const query = searchInput.value.trim().toLowerCase();
  const filter = packFilter.value || 'all';
  const items = getActiveList();

  return items.filter(item => {
    if (currentLib === 'cn_pbr' || currentLib === 'cn_foliage') {
      if (filter === 'tint:1' && !item.tintableGrayscale) return false;
      if (filter.startsWith('cat:') && (item.category || '') !== filter.slice(4)) return false;
      if (!query) return true;
      return (item.id || '').toLowerCase().includes(query)
        || (item.category || '').toLowerCase().includes(query)
        || (item.sourcePath || '').toLowerCase().includes(query);
    }
    const itemPack = item.packLabel || item.pack || '其他贴花';
    if (filter !== 'all' && itemPack !== filter) return false;
    if (!query) return true;
    return (item.name || '').toLowerCase().includes(query)
      || (item.assetName || '').toLowerCase().includes(query)
      || (item.category || '').toLowerCase().includes(query)
      || itemPack.toLowerCase().includes(query);
  });
}

function getCurrentDecal() {
  const filtered = getFilteredDecals();
  const found = filtered.find(item => item.id === activeId);
  if (found) return found;
  const list = getActiveList();
  return filtered[0] || list.find(item => item.id === activeId) || list[0] || null;
}

function populatePackFilter() {
  const prev = packFilter.value || 'all';
  packFilter.replaceChildren();
  const items = getActiveList();

  if (currentLib === 'cn_pbr' || currentLib === 'cn_foliage') {
    const cfg = CN_LIBS[currentLib];
    const cats = new Map();
    let tintCount = 0;
    for (const item of items) {
      const cat = item.category || 'other';
      cats.set(cat, (cats.get(cat) || 0) + 1);
      if (item.tintableGrayscale) tintCount += 1;
    }
    const addOpt = (value, text) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      packFilter.appendChild(opt);
    };
    addOpt('all', `${cfg.label} (${items.length})`);
    for (const [cat, count] of [...cats.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      addOpt(`cat:${cat}`, `分类 · ${cat} (${count})`);
    }
    if (tintCount > 0) {
      addOpt('tint:1', `可染色血迹/污渍 (${tintCount})`);
    }
    const valid = [...packFilter.options].some(o => o.value === prev);
    packFilter.value = valid ? prev : 'all';
    return;
  }

  const counts = new Map();
  for (const item of items) {
    const label = item.packLabel || item.pack || '其他贴花';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const allOpt = document.createElement('option');
  allOpt.value = 'all';
  allOpt.textContent = `全部合集 (${items.length})`;
  packFilter.appendChild(allOpt);
  const ordered = [
    ...DECAL_PACK_ORDER.filter(label => counts.has(label)),
    ...[...counts.keys()].filter(label => !DECAL_PACK_ORDER.includes(label)).sort(),
  ];
  for (const label of ordered) {
    const opt = document.createElement('option');
    opt.value = label;
    opt.textContent = `${label} (${counts.get(label)})`;
    packFilter.appendChild(opt);
  }
  packFilter.value = counts.has(prev) ? prev : 'all';
}

function renderList() {
  const filtered = getFilteredDecals();
  const current = getCurrentDecal();
  if (current) activeId = current.id;
  listEl.replaceChildren();

  if (filtered.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hgame-list-empty';
    empty.textContent = getActiveList().length === 0 ? '暂无贴花资产' : '没有匹配的贴花';
    listEl.appendChild(empty);
    return;
  }

  if (currentLib === 'cn_pbr' || currentLib === 'cn_foliage') {
    const baseUrl = CN_LIBS[currentLib].baseUrl;
    for (const item of filtered) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hgame-list-item';
      if (item.id === activeId) btn.setAttribute('aria-current', 'true');

      const thumb = document.createElement('img');
      thumb.className = 'hgame-item-thumb';
      thumb.src = `${baseUrl}/${item.id}/color.png`;
      thumb.alt = '';
      thumb.loading = 'lazy';
      btn.appendChild(thumb);

      const copy = document.createElement('span');
      copy.className = 'hgame-item-copy';
      const strong = document.createElement('strong');
      strong.textContent = item.id;
      const small = document.createElement('small');
      const dim = `${item.width || 1024}×${item.height || 1024}`;
      small.textContent = [item.category, dim, item.tintableGrayscale ? '可染色' : '']
        .filter(Boolean)
        .join(' · ');
      copy.append(strong, small);

      btn.appendChild(copy);
      btn.addEventListener('click', () => {
        activeId = item.id;
        renderList();
        void loadCurrentDecal();
      });
      listEl.appendChild(btn);
    }
    return;
  }

  const groups = new Map();
  for (const item of filtered) {
    const pack = item.packLabel || item.pack || '其他贴花';
    if (!groups.has(pack)) groups.set(pack, []);
    groups.get(pack).push(item);
  }

  const orderedPacks = [
    ...DECAL_PACK_ORDER.filter(label => groups.has(label)),
    ...[...groups.keys()].filter(label => !DECAL_PACK_ORDER.includes(label)).sort(),
  ];

  for (const pack of orderedPacks) {
    const groupHeading = document.createElement('div');
    groupHeading.className = 'hgame-list-heading';
    groupHeading.textContent = `${pack} (${groups.get(pack).length})`;
    listEl.appendChild(groupHeading);

    for (const item of groups.get(pack)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hgame-list-item';
      if (item.id === activeId) btn.setAttribute('aria-current', 'true');

      const thumbSrc = item.thumbnail || item.color || '';
      if (thumbSrc) {
        const img = document.createElement('img');
        img.className = 'hgame-item-thumb';
        img.src = thumbSrc;
        img.alt = '';
        img.loading = 'lazy';
        btn.appendChild(img);
      }

      const copy = document.createElement('span');
      copy.className = 'hgame-item-copy';
      const strong = document.createElement('strong');
      strong.textContent = item.name || item.id;
      const small = document.createElement('small');
      small.textContent = item.category ? `${item.category} · RGBA PBR` : 'RGBA PBR 贴花';
      copy.append(strong, small);

      btn.appendChild(copy);
      btn.addEventListener('click', () => {
        activeId = item.id;
        renderList();
        void loadCurrentDecal();
      });
      listEl.appendChild(btn);
    }
  }
}

function ensureViewport() {
  if (!viewport) {
    viewport = createThreeViewport(stageEl, { background: 0x0f140f, grid: true, shadows: false });
    const rim = new THREE.DirectionalLight(0xd9ead3, 0.75);
    rim.position.set(-2.4, 3.0, -2.0);
    viewport.scene.add(rim);
    viewport.camera.position.set(1.1, 2.35, 2.35);
    viewport.controls.target.set(0, 0.14, 0);
    viewport.controls.update();
    loadHdriEnvironment({
      url: '/assets/cn/materials/hdri/cn_day_clear.hdr',
      renderer: viewport.renderer,
      scene: viewport.scene,
    }).then(env => {
      hdriEnv = env;
    }).catch(() => { /* non-fatal */ });
  }
  return viewport;
}

function clearStage() {
  if (stageRoot && viewport) {
    viewport.scene.remove(stageRoot);
    disposeObject3D(stageRoot);
  }
  stageRoot = null;
  decalMesh = null;
  decalMaterial = null;
  for (const tex of decalTextures) {
    tex?.dispose?.();
  }
  decalTextures = [];
}

function findMaterialForSurface(surfaceKey) {
  const rx = SURFACE_PATTERNS[surfaceKey] || SURFACE_PATTERNS.concrete;
  const direct = baseMaterials.find(m => rx.test(`${m.id || ''} ${m.name || ''} ${m.category || ''}`));
  if (direct) return direct;
  if (surfaceKey === 'concrete') {
    return baseMaterials.find(m => /floorpaving/i.test(m.id || '')) || baseMaterials[0] || null;
  }
  return baseMaterials[0] || null;
}

function configureRepeatTexture(tex, colorSpace, repeat = 2) {
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  return tex;
}

async function getBaseSurfaceMaterial(surfaceKey, renderer) {
  const key = SURFACE_FALLBACKS[surfaceKey] ? surfaceKey : 'concrete';
  if (baseSurfaceCache.has(key)) {
    return baseSurfaceCache.get(key);
  }

  const fb = SURFACE_FALLBACKS[key];
  if (fb.cnId) {
    try {
      const assets = await loadSingle2MapAssets('/assets/cn/materials', fb.cnId);
      const built = create2MapPbrMaterial({
        mode: 'opaque',
        assets,
        renderer,
        repeat: 2,
      });
      baseSurfaceCache.set(key, built.material);
      return built.material;
    } catch { /* fall through to unreal/fallback */ }
  }

  const matInfo = findMaterialForSurface(key);
  const mat = new THREE.MeshStandardMaterial({
    color: matInfo ? 0xffffff : fb.color,
    roughness: matInfo ? 1.0 : fb.roughness,
    metalness: 0.04,
  });

  if (matInfo?.color) {
    try {
      const [cTex, nTex, oTex] = await Promise.all([
        texLoader.loadAsync(matInfo.color),
        matInfo.normal ? texLoader.loadAsync(matInfo.normal).catch(() => null) : Promise.resolve(null),
        matInfo.orm ? texLoader.loadAsync(matInfo.orm).catch(() => null) : Promise.resolve(null),
      ]);
      mat.map = configureRepeatTexture(cTex, THREE.SRGBColorSpace, 2);
      if (nTex) mat.normalMap = configureRepeatTexture(nTex, THREE.NoColorSpace, 2);
      if (oTex) {
        configureRepeatTexture(oTex, THREE.NoColorSpace, 2);
        mat.roughnessMap = oTex;
        mat.aoMap = oTex;
        mat.aoMapIntensity = 0.6;
      }
      mat.needsUpdate = true;
    } catch {
      mat.color.setHex(fb.color);
      mat.roughness = fb.roughness;
    }
  }

  baseSurfaceCache.set(key, mat);
  return mat;
}

function applyTransformToDecalMesh() {
  if (!decalMesh || !decalMaterial) return;
  const scale = Math.max(0.25, Math.min(3, Number(scaleInput.value) || 1));
  const rotRad = ((Number(rotInput.value) || 0) * Math.PI) / 180;
  const opacity = Math.max(0.05, Math.min(1, Number(opacityInput.value) || 1));

  if (currentLib !== 'cn_foliage') {
    decalMaterial.opacity = opacity;
  }
  const wScale = decalAspect >= 1 ? scale : scale * decalAspect;
  const hScale = decalAspect >= 1 ? scale / decalAspect : scale;
  if (currentLib === 'cn_foliage') {
    const sx = wScale * 1.15;
    const sy = hScale * 1.15;
    decalMesh.scale.set(sx, sy, sx);
    if (previewMode === 'surface') {
      decalMesh.rotation.set(0, -rotRad, 0);
      decalMesh.position.set(0, 0.12 + 0.5 * 1.75 * sy, 0);
    } else {
      decalMesh.rotation.set(0, 0, -rotRad);
      decalMesh.position.set(0, 1.05, 0);
    }
    return;
  }
  if (previewMode === 'surface') {
    decalMesh.scale.set(wScale * 1.15, hScale * 1.15, 1);
    decalMesh.rotation.set(-Math.PI * 0.5, 0, -rotRad);
    decalMesh.position.set(0, 0.126, 0);
  } else {
    decalMesh.scale.set(wScale * 1.15, hScale * 1.15, 1);
    decalMesh.rotation.set(0, 0, -rotRad);
    decalMesh.position.set(0, 1.05, 0);
  }
}

function updateModeTabsUi() {
  for (const tab of modeTabs) {
    const active = tab.dataset.decalMode === previewMode;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  surfaceSelect.disabled = previewMode !== 'surface';
}

function updateLibTabsUi() {
  for (const tab of libTabs) {
    const active = tab.dataset.decalLib === currentLib;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
}

function hasUsableRoughness(tex) {
  const img = tex?.image;
  if (!img) return false;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    if (!ctx) return true;
    ctx.drawImage(img, 0, 0, 16, 16);
    const data = ctx.getImageData(0, 0, 16, 16).data;
    let maxR = 0;
    let maxG = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > maxR) maxR = data[i];
      if (data[i + 1] > maxG) maxG = data[i + 1];
    }
    return maxR > 8 && maxG > 8;
  } catch {
    return true;
  }
}

function configureSurfaceCamera(vp, group, baseMat) {
  if (previewMode === 'surface') {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.24, 3.4), baseMat);
    slab.position.y = 0;
    group.add(slab);
    if (vp.gridHelper) vp.gridHelper.visible = true;
    if (currentLib === 'cn_foliage') {
      vp.camera.position.set(1.9, 2.35, 3.6);
      vp.controls.target.set(0, 0.95, 0);
    } else {
      vp.camera.position.set(1.1, 2.35, 2.35);
      vp.controls.target.set(0, 0.14, 0);
    }
  } else {
    if (vp.gridHelper) vp.gridHelper.visible = false;
    vp.camera.position.set(0, 1.05, 2.9);
    vp.controls.target.set(0, 1.05, 0);
  }
  vp.controls.update();
}

async function loadCurrentDecal() {
  const token = ++loadToken;
  const item = getCurrentDecal();
  const vp = ensureViewport();

  if (!item) {
    clearStage();
    titleEl.textContent = '贴花预览';
    downloadEl.hidden = true;
    mapsRowEl.hidden = true;
    if (tintWrap) tintWrap.hidden = true;
    emptyEl.hidden = false;
    statusEl.textContent = '暂无可用贴花';
    return;
  }

  emptyEl.hidden = true;
  const isCnLib = currentLib === 'cn_pbr' || currentLib === 'cn_foliage';
  if (tintWrap) tintWrap.hidden = !(currentLib === 'cn_pbr' && item.tintableGrayscale);
  if (opacityInput) opacityInput.disabled = currentLib === 'cn_foliage';
  if (mapRmLabel) mapRmLabel.textContent = isCnLib ? 'RM' : 'ORM';

  if (isCnLib) {
    const cfg = CN_LIBS[currentLib];
    titleEl.textContent = `${item.id} (${item.width || 1024}×${item.height || 1024})`;
    downloadEl.href = `${cfg.baseUrl}/${item.id}/color.png`;
    downloadEl.download = `${item.id}_color.png`;
    downloadEl.textContent = '下载 Color PNG';
    downloadEl.hidden = false;
    statusEl.textContent = `按需加载 ${item.id} (Color + Normal_RM)…`;

    try {
      const [assets, baseMat] = await Promise.all([
        loadSingle2MapAssets(cfg.baseUrl, item.id),
        previewMode === 'surface' ? getBaseSurfaceMaterial(surfaceSelect.value, vp.renderer) : Promise.resolve(null),
      ]);
      if (token !== loadToken) return;

      clearStage();
      decalAspect = Math.max(0.2, Math.min(4.0, Number(item.aspectRatio || (assets.normRm.width / Math.max(1, assets.normRm.height)))));
      const tintHex = item.tintableGrayscale && tintSelect ? Number(tintSelect.value || 0x8b0c0c) : 0xffffff;
      const opacity = Math.max(0.05, Math.min(1, Number(opacityInput.value) || 1));

      const built = create2MapPbrMaterial({
        mode: cfg.mode,
        assets,
        renderer: vp.renderer,
        tintHex,
        opacity,
        polygonOffset: currentLib === 'cn_pbr',
      });
      decalMaterial = built.material;
      decalTextures = [built.colorTex, built.normRmTex];

      const group = new THREE.Group();
      configureSurfaceCamera(vp, group, baseMat);
      if (currentLib === 'cn_foliage' && previewMode === 'surface') {
        const clump = new THREE.Group();
        const planeA = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 1.75), decalMaterial);
        const planeB = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 1.75), decalMaterial);
        planeB.rotation.y = Math.PI * 0.5;
        clump.add(planeA, planeB);
        decalMesh = clump;
      } else {
        decalMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 1.75), decalMaterial);
      }
      group.add(decalMesh);

      stageRoot = group;
      applyTransformToDecalMesh();
      vp.scene.add(stageRoot);

      draw2MapChannelCanvases(mapColorCanvas, mapNormalCanvas, mapOrmCanvas, assets);
      mapsRowEl.hidden = false;

      const aspectStr = decalAspect !== 1 ? ` · 比例 ${item.aspectRatio}:1` : '';
      const physStr = item.physicalSizeMeters ? ` · ${item.physicalSizeMeters}m` : '';
      const typeLabel = currentLib === 'cn_foliage' ? '2贴图植被卡片(alphaTest 0.5)' : '2贴图贴花(Transparent)';
      const tintStr = item.tintableGrayscale ? ' · 可染色灰度' : '';
      statusEl.textContent =
        `${typeLabel} · ${item.width || 1024}×${item.height || 1024}${aspectStr}${physStr}${tintStr} · ` +
        `${assets.loadMs.toFixed(0)}ms · ${item.sourcePath || item.category || ''}`;

      if (!viewEl.hidden) {
        vp.start();
        vp.resize();
      }
    } catch (error) {
      if (token !== loadToken) return;
      statusEl.textContent = error.message || '贴花贴图加载失败';
    }
    return;
  }

  // Legacy Unreal decal path
  titleEl.textContent = `${item.name}${item.packLabel ? ` · ${item.packLabel}` : ''}`;
  downloadEl.href = item.color;
  downloadEl.download = `${item.id}_color.png`;
  downloadEl.textContent = '下载 Color PNG';
  downloadEl.hidden = false;
  statusEl.textContent = `正在加载 ${item.name}…`;

  try {
    const [colorTex, normalTex, ormTex] = await Promise.all([
      texLoader.loadAsync(item.color),
      item.normal ? texLoader.loadAsync(item.normal).catch(() => null) : Promise.resolve(null),
      item.orm ? texLoader.loadAsync(item.orm).catch(() => null) : Promise.resolve(null),
    ]);
    if (token !== loadToken) {
      colorTex.dispose();
      normalTex?.dispose();
      ormTex?.dispose();
      return;
    }

    colorTex.colorSpace = THREE.SRGBColorSpace;
    if (normalTex) normalTex.colorSpace = THREE.NoColorSpace;
    if (ormTex) ormTex.colorSpace = THREE.NoColorSpace;

    const baseMat = previewMode === 'surface'
      ? await getBaseSurfaceMaterial(surfaceSelect.value, vp.renderer)
      : null;
    if (token !== loadToken) {
      colorTex.dispose();
      normalTex?.dispose();
      ormTex?.dispose();
      return;
    }

    clearStage();
    decalTextures = [colorTex, normalTex, ormTex].filter(Boolean);

    const img = colorTex.image;
    decalAspect = img && img.height > 0 ? Math.max(0.3, Math.min(3.5, img.width / img.height)) : 1;

    const validOrm = ormTex && hasUsableRoughness(ormTex) ? ormTex : null;
    decalMaterial = new THREE.MeshStandardMaterial({
      map: colorTex,
      normalMap: normalTex || null,
      normalScale: new THREE.Vector2(1.0, 1.0),
      roughnessMap: validOrm,
      roughness: validOrm ? 1.0 : 0.92,
      aoMap: validOrm,
      aoMapIntensity: validOrm ? 0.7 : 0.0,
      metalness: 0.0,
      transparent: true,
      opacity: Math.max(0.05, Math.min(1, Number(opacityInput.value) || 1)),
      alphaTest: 0.01,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
    });

    const group = new THREE.Group();
    configureSurfaceCamera(vp, group, baseMat);
    decalMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 1.75), decalMaterial);
    group.add(decalMesh);

    stageRoot = group;
    applyTransformToDecalMesh();
    vp.scene.add(stageRoot);

    drawImageFittedToCanvas(mapColorCanvas, colorTex.image);
    drawImageFittedToCanvas(mapNormalCanvas, normalTex?.image || colorTex.image);
    drawImageFittedToCanvas(mapOrmCanvas, ormTex?.image || colorTex.image);
    mapsRowEl.hidden = false;

    const dim = img ? `${img.width}×${img.height}` : '';
    const mapsLabel = [
      'Color+Alpha',
      normalTex ? 'Normal' : null,
      ormTex ? 'ORM' : null,
    ].filter(Boolean).join(' / ');
    statusEl.textContent = `${item.category || 'PBR 贴花'}${dim ? ` · ${dim}` : ''} · ${mapsLabel}`;

    if (!viewEl.hidden) {
      vp.start();
      vp.resize();
    }
  } catch (error) {
    if (token !== loadToken) return;
    statusEl.textContent = error.message || '贴花贴图加载失败';
  }
}

async function switchDecalLib(libId) {
  currentLib = (libId === 'unreal' || libId === 'cn_foliage') ? libId : 'cn_pbr';
  updateLibTabsUi();
  populatePackFilter();
  const list = getActiveList();
  activeId = list[0]?.id || '';
  renderList();
  await loadCurrentDecal();
}

async function initDecalsView() {
  if (!initialized) {
    initialized = true;
    syncSliderLabels();
    updateModeTabsUi();
    updateLibTabsUi();

    for (const tab of libTabs) {
      tab.addEventListener('click', () => {
        const nextLib = tab.dataset.decalLib;
        if (nextLib && nextLib !== currentLib) {
          void switchDecalLib(nextLib);
        }
      });
    }

    searchInput.addEventListener('input', renderList);
    packFilter.addEventListener('change', () => {
      const filtered = getFilteredDecals();
      if (filtered.length > 0 && !filtered.some(item => item.id === activeId)) {
        activeId = filtered[0].id;
      }
      renderList();
      void loadCurrentDecal();
    });

    for (const tab of modeTabs) {
      tab.addEventListener('click', () => {
        const nextMode = tab.dataset.decalMode === 'flat' ? 'flat' : 'surface';
        if (nextMode === previewMode) return;
        previewMode = nextMode;
        updateModeTabsUi();
        void loadCurrentDecal();
      });
    }

    surfaceSelect.addEventListener('change', () => {
      if (previewMode === 'surface') {
        void loadCurrentDecal();
      }
    });

    const onTransformInput = () => {
      syncSliderLabels();
      applyTransformToDecalMesh();
    };
    scaleInput.addEventListener('input', onTransformInput);
    rotInput.addEventListener('input', onTransformInput);
    opacityInput.addEventListener('input', onTransformInput);
    tintSelect?.addEventListener('change', () => {
      const item = getCurrentDecal();
      if (currentLib === 'cn_pbr' && item?.tintableGrayscale && decalMaterial) {
        decalMaterial.color.setHex(Number(tintSelect.value || 0x8b0c0c));
      }
    });
  }

  const vp = ensureViewport();
  if (!viewEl.hidden) {
    vp.resize();
    vp.start();
  }

  if (!catalogLoaded) {
    try {
      const [cnResp, folResp, unrealCatalog, curatedData] = await Promise.all([
        fetch('/assets/cn/pbr_decals/pbr_decals_table.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
        fetch('/assets/cn/pbr_foliage/pbr_foliage_table.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
        fetchUnrealCatalog().catch(() => ({ decals: [], materials: [] })),
        apiRequestJson('/api/hgame/materials/curated').catch(() => ({ materials: [] })),
      ]);
      cnDecals = Array.isArray(cnResp?.items) ? cnResp.items : [];
      cnFoliage = Array.isArray(folResp?.items) ? folResp.items : [];
      unrealDecals = Array.isArray(unrealCatalog.decals) ? unrealCatalog.decals : [];
      const unrealMats = Array.isArray(unrealCatalog.materials) ? unrealCatalog.materials : [];
      const curatedMats = Array.isArray(curatedData?.materials) ? curatedData.materials : [];
      baseMaterials = [...unrealMats, ...curatedMats];
      catalogLoaded = true;
    } catch (error) {
      cnDecals = [];
      cnFoliage = [];
      unrealDecals = [];
      baseMaterials = [];
      statusEl.textContent = error.message || '读取贴花目录失败';
    }
  }

  if (!cnDecals.length && unrealDecals.length) {
    currentLib = 'unreal';
    updateLibTabsUi();
  }

  populatePackFilter();
  const list = getActiveList();
  if (!list.some(item => item.id === activeId)) {
    activeId = list[0]?.id || '';
  }
  renderList();
  await loadCurrentDecal();
}

window.addEventListener('webasset:workspace-change', event => {
  if (event.detail?.workspace === 'decals') {
    void initDecalsView();
  } else {
    viewport?.stop();
  }
});

if (viewEl && !viewEl.hidden) {
  void initDecalsView();
}
