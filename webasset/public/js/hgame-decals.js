import * as THREE from 'three';
import { loadHdriEnvironment } from './realistic-pcg.js';
import {
  analyzeWallDecalPlacement,
  apiRequestJson,
  create2MapPbrMaterial,
  createSidebarSquareCard,
  createThreeViewport,
  disposeObject3D,
  getDefaultDecalHsvMatch,
  loadHtmlImage,
  loadSingle2MapAssets,
  sampleImageHsvStats,
} from './hgame-shared.js';

const DECAL_PACK_ORDER = [
  '混凝土贴花 Concrete',
  '弹坑焦痕 Crater',
  '街道与路面 Road',
  '血迹贴花 Blood',
];

const SOURCE_PACK_LABELS = {
  Quixel_CN: 'Quixel CN 街景贴花',
  UWC_Bullet_Holes: 'UWC 多材质弹孔与斩击',
  RealisticBloodDecals: '写实喷溅血迹',
  VOL3_Blood: 'VOL3 血迹/血泊/手脚印',
  Concrete_Decals: 'Concrete 水泥弹孔与剥落',
  Crater_Decals: 'Crater 弹坑/焦痕/余烬',
  VOL2_StreetsRoads: 'Road 路面破损/补丁/胎痕',
};

const SURFACE_FALLBACKS = {
  concrete: { color: 0x4b504a, roughness: 0.88, cnId: 'concrete_road_01', uvScale: 0.5 },
  asphalt: { color: 0x262928, roughness: 0.92, cnId: 'asphalt_road_01', uvScale: 0.5 },
  brick: { color: 0x62463a, roughness: 0.86, cnId: 'brick_facade', uvScale: 1.0 },
};

const SURFACE_PATTERNS = {
  concrete: /(concrete|cement|plaster|stone)/i,
  asphalt: /(asphalt|road|tarmac|paving)/i,
  brick: /(brick|masonry|floorpaving|tile)/i,
};

const viewEl = document.querySelector('#decals-view');
const searchInput = document.querySelector('#hgame-decal-search');
const packFilter = document.querySelector('#hgame-decal-pack-filter');
const listEl = document.querySelector('#hgame-decal-list');
const titleEl = document.querySelector('#hgame-decal-title');
const modeTabs = Array.from(document.querySelectorAll('.hgame-decal-mode-tab'));
const emptyEl = document.querySelector('#hgame-decal-empty');
const stageEl = document.querySelector('#hgame-decal-stage');
const controlsEl = document.querySelector('#hgame-decal-controls');
const tintAmountInput = document.querySelector('#hgame-decal-tint-amount');
const tintValEl = document.querySelector('#hgame-decal-tint-val');

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

const FLOOR_SIZE = 6.4;
const SLAB_THICKNESS = 0.2;
const WALL_HEIGHT = 2.8;
const WALL_FRONT_Z = -1.6;
const FLOOR_DECAL_Z = 0.35;
const WALL_DECAL_Y = 1.05;
const SURFACE_EPSILON = 0.006;
const BASE_DECAL_SIZE = 1.05;
const BASE_FOLIAGE_SIZE = 0.85;

let currentLib = 'cn_pbr';
let cnDecals = [];
let cnFoliage = [];
let unrealDecals = [];
let baseMaterials = [];
let activeId = '';
let previewMode = 'surface';
let currentPlacement = 'floor';
let lastCameraKey = '';
let viewport = null;
let hdriEnv = null;
let stageRoot = null;
let decalMesh = null;
let decalMaterial = null;
let decalBuilt = null;
let decalSourceHsvStats = null;
let lastHsvCategoryKey = '';
let hsvUserOverride = false;
let decalTextures = [];
let decalAspect = 1;
let decalContentScale = 1;
let wallDecalLayout = { anchor: 'center', spanFullWidth: false };
let initialized = false;
let loadToken = 0;
let catalogLoaded = false;
const baseSurfaceCache = new Map();
const baseSurfaceStatsCache = new Map();

function inferDecalPlacement(item, lib = currentLib) {
  if (lib === 'cn_foliage') return 'floor';
  if (!item) return 'floor';
  if (item.placement === 'wall' || item.placement === 'floor') return item.placement;
  if (lib === 'cn_pbr') {
    if (
      item.category === 'leak'
      || item.category === 'bullet_concrete'
      || item.category === 'damage_concrete'
      || /(?:^|_)wall(?:_|$)|handprint|drip/i.test(item.id || '')
    ) {
      return 'wall';
    }
    return 'floor';
  }
  if (item.pack === 'Concrete_Decals' || /handprint/i.test(`${item.id || ''} ${item.name || ''}`)) {
    return 'wall';
  }
  return 'floor';
}

function resolvePlacement(item) {
  return inferDecalPlacement(item, currentLib);
}

function syncSliderLabels() {
  if (tintValEl && tintAmountInput) {
    tintValEl.textContent = `${Math.round((Number(tintAmountInput.value) || 0) * 100)}%`;
  }
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
      if (filter.startsWith('pack:') && (item.sourcePack || '') !== filter.slice(5)) return false;
      if (filter.startsWith('cat:') && (item.category || '') !== filter.slice(4)) return false;
      if (!query) return true;
      return (item.id || '').toLowerCase().includes(query)
        || (item.category || '').toLowerCase().includes(query)
        || (item.sourcePack || '').toLowerCase().includes(query)
        || (item.surfaceType || '').toLowerCase().includes(query)
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
  const prev = currentLib === 'cn_foliage' ? 'lib:cn_foliage' : (packFilter.value || 'all');
  packFilter.replaceChildren();
  const items = getActiveList();

  if (currentLib === 'cn_pbr' || currentLib === 'cn_foliage') {
    const cfg = CN_LIBS[currentLib];
    const packs = new Map();
    const cats = new Map();
    let tintCount = 0;
    for (const item of items) {
      const sp = item.sourcePack || '';
      if (sp) packs.set(sp, (packs.get(sp) || 0) + 1);
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
    addOpt('all', `全部贴花 (${cnDecals.length})`);
    if (cnFoliage.length > 0) {
      addOpt('lib:cn_foliage', `植被卡片 (${cnFoliage.length})`);
    }
    if (tintCount > 0) {
      addOpt('tint:1', `可染色血迹/果汁 (${tintCount})`);
    }
    for (const [sp, count] of packs.entries()) {
      const spLabel = SOURCE_PACK_LABELS[sp] || sp;
      addOpt(`pack:${sp}`, `来源 · ${spLabel} (${count})`);
    }
    for (const [cat, count] of [...cats.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      addOpt(`cat:${cat}`, `分类 · ${cat} (${count})`);
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
      const { button } = createSidebarSquareCard({
        name: item.id,
        thumbUrl: `${baseUrl}/${item.id}/color.png`,
        badge: item.category || 'DECAL',
        active: item.id === activeId,
        onClick: () => {
          activeId = item.id;
          renderList();
          void loadCurrentDecal();
        },
      });
      listEl.appendChild(button);
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
      const thumbSrc = item.thumbnail || item.color || '';
      const { button } = createSidebarSquareCard({
        name: item.name || item.id,
        thumbUrl: thumbSrc,
        badge: item.category || 'UE',
        active: item.id === activeId,
        onClick: () => {
          activeId = item.id;
          renderList();
          void loadCurrentDecal();
        },
      });
      listEl.appendChild(button);
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
    stageRoot.traverse?.(node => {
      node.geometry?.dispose?.();
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of mats) {
        if (!mat || mat.userData?.sharedBaseSurface) continue;
        for (const val of Object.values(mat)) {
          if (val?.isTexture) val.dispose?.();
        }
        mat.dispose?.();
      }
    });
  }
  stageRoot = null;
  decalMesh = null;
  decalMaterial = null;
  decalBuilt = null;
  decalSourceHsvStats = null;
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

function configureRepeatTexture(tex, colorSpace, repeatX = 4, repeatY = repeatX) {
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  return tex;
}

async function getBaseSurfaceMaterial(surfaceKey, renderer, role = 'floor') {
  const requestedKey = SURFACE_FALLBACKS[surfaceKey] ? surfaceKey : 'concrete';
  // Asphalt is road-only; give the vertical backdrop wall a realistic concrete finish.
  const effectiveKey = role === 'wall' && requestedKey === 'asphalt' ? 'concrete' : requestedKey;
  const cacheKey = `${effectiveKey}:${role}`;
  if (baseSurfaceCache.has(cacheKey)) {
    return baseSurfaceCache.get(cacheKey);
  }

  const repeatVec = role === 'wall' ? [3.2, 1.4] : [3.2, 3.2];
  const fb = SURFACE_FALLBACKS[effectiveKey];
  if (fb.cnId) {
    try {
      const assets = await loadSingle2MapAssets('/assets/cn/materials', fb.cnId);
      const built = create2MapPbrMaterial({
        mode: 'opaque',
        assets,
        renderer,
        repeat: repeatVec,
        uvScale: fb.uvScale ?? 0.5,
      });
      built.material.userData.sharedBaseSurface = true;
      baseSurfaceCache.set(cacheKey, built.material);
      baseSurfaceStatsCache.set(cacheKey, sampleImageHsvStats(assets.colorImg));
      return built.material;
    } catch { /* fall through to unreal/fallback */ }
  }

  const matInfo = findMaterialForSurface(effectiveKey);
  const mat = new THREE.MeshStandardMaterial({
    color: matInfo ? 0xffffff : fb.color,
    roughness: matInfo ? 1.0 : fb.roughness,
    metalness: 0.04,
  });
  mat.userData.sharedBaseSurface = true;

  if (matInfo?.color) {
    try {
      const [cTex, nTex, oTex] = await Promise.all([
        texLoader.loadAsync(matInfo.color),
        matInfo.normal ? texLoader.loadAsync(matInfo.normal).catch(() => null) : Promise.resolve(null),
        matInfo.orm ? texLoader.loadAsync(matInfo.orm).catch(() => null) : Promise.resolve(null),
      ]);
      mat.map = configureRepeatTexture(cTex, THREE.SRGBColorSpace, repeatVec[0], repeatVec[1]);
      if (nTex) mat.normalMap = configureRepeatTexture(nTex, THREE.NoColorSpace, repeatVec[0], repeatVec[1]);
      if (oTex) {
        configureRepeatTexture(oTex, THREE.NoColorSpace, repeatVec[0], repeatVec[1]);
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

  baseSurfaceCache.set(cacheKey, mat);
  return mat;
}

function measureAlphaContentScale(img) {
  if (!img) return 1;
  try {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 1;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    let minX = size;
    let maxX = -1;
    let minY = size;
    let maxY = -1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (data[(y * size + x) * 4 + 3] > 12) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX) return 1;
    const spanX = (maxX - minX + 1) / size;
    const spanY = (maxY - minY + 1) / size;
    const visualFill = Math.max(0.45, Math.sqrt(spanX * spanY));
    return Math.min(1.65, 1 / visualFill);
  } catch {
    return 1;
  }
}

function applyTransformToDecalMesh() {
  if (!decalMesh || !decalMaterial) return;
  const scale = 1;
  const rotRad = 0;
  const opacity = 1;

  if (currentLib !== 'cn_foliage') {
    decalMaterial.opacity = opacity;
  }

  const aspectFactor = Math.sqrt(Math.max(0.25, Math.min(4.0, decalAspect)));
  if (currentLib === 'cn_foliage') {
    const base = previewMode === 'surface' ? BASE_FOLIAGE_SIZE : 1.75;
    const sx = base * scale * aspectFactor;
    const sy = (base * scale) / aspectFactor;
    decalMesh.scale.set(sx, sy, 1);
    if (previewMode === 'surface') {
      decalMesh.rotation.set(-Math.PI * 0.5, 0, -rotRad);
      decalMesh.position.set(0, SURFACE_EPSILON, FLOOR_DECAL_Z);
    } else {
      decalMesh.rotation.set(0, 0, -rotRad);
      decalMesh.position.set(0, 1.05, 0);
    }
    return;
  }

  if (previewMode === 'surface') {
    const item = getCurrentDecal();
    const phys = item?.physicalSizeMeters;
    let wMeters;
    let hMeters;
    if (Array.isArray(phys) && phys.length >= 2 && Number(phys[0]) > 0 && Number(phys[1]) > 0) {
      wMeters = Number(phys[0]) * scale;
      hMeters = Number(phys[1]) * scale;
    } else if (Number.isFinite(Number(phys)) && Number(phys) > 0) {
      const p = Number(phys) * scale;
      wMeters = p * aspectFactor;
      hMeters = p / aspectFactor;
    } else {
      const effective = BASE_DECAL_SIZE * decalContentScale * scale;
      wMeters = effective * aspectFactor;
      hMeters = effective / aspectFactor;
    }
    if (currentPlacement === 'wall') {
      let centerY = WALL_DECAL_Y;
      if (wallDecalLayout.anchor === 'full') {
        hMeters = WALL_HEIGHT * scale;
        wMeters = Math.min(FLOOR_SIZE, hMeters * decalAspect);
        centerY = Math.max(hMeters * 0.5, WALL_HEIGHT - hMeters * 0.5);
      } else if (wallDecalLayout.anchor === 'top') {
        if (wallDecalLayout.spanFullWidth) {
          wMeters = Math.min(FLOOR_SIZE, WALL_HEIGHT * 0.72 * decalAspect * scale);
          hMeters = Math.min(WALL_HEIGHT, wMeters / decalAspect);
        } else {
          hMeters = Math.min(WALL_HEIGHT, 2.2 * scale);
          wMeters = Math.min(FLOOR_SIZE, hMeters * decalAspect);
        }
        centerY = WALL_HEIGHT - hMeters * 0.5;
      }
      decalMesh.scale.set(wMeters, hMeters, 1);
      decalMesh.rotation.set(0, 0, -rotRad);
      decalMesh.position.set(0, centerY, WALL_FRONT_Z + SURFACE_EPSILON);
    } else {
      decalMesh.scale.set(wMeters, hMeters, 1);
      decalMesh.rotation.set(-Math.PI * 0.5, 0, -rotRad);
      decalMesh.position.set(0, SURFACE_EPSILON, FLOOR_DECAL_Z);
    }
  } else {
    const flatBase = 1.75 * decalContentScale * scale;
    decalMesh.scale.set(flatBase * aspectFactor, flatBase / aspectFactor, 1);
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
  const isCnLib = currentLib === 'cn_pbr' || currentLib === 'cn_foliage';
  if (controlsEl) {
    controlsEl.hidden = !(isCnLib && previewMode === 'surface');
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

function sanitizeDecalNormalTexture(normalTex, colorTex) {
  if (!normalTex?.image) return { texture: null, status: 'none' };
  const img = normalTex.image;
  const w = img.naturalWidth || img.width || 0;
  const h = img.naturalHeight || img.height || 0;
  if (!w || !h) return { texture: normalTex, status: 'ok' };

  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { texture: normalTex, status: 'ok' };
    ctx.drawImage(img, 0, 0, w, h);
    const nImgData = ctx.getImageData(0, 0, w, h);
    const nData = nImgData.data;

    let alphaData = null;
    const cImg = colorTex?.image;
    if (cImg) {
      const cCanvas = document.createElement('canvas');
      cCanvas.width = w;
      cCanvas.height = h;
      const cCtx = cCanvas.getContext('2d', { willReadFrequently: true });
      if (cCtx) {
        cCtx.drawImage(cImg, 0, 0, w, h);
        alphaData = cCtx.getImageData(0, 0, w, h).data;
      }
    }

    const total = w * h;
    let opaqueCount = 0;
    let invalidOpaque = 0;
    let invalidTotal = 0;
    for (let i = 0; i < total; i++) {
      const idx = i * 4;
      const b = nData[idx + 2];
      // Valid OpenGL/DirectX tangent-space normals always have Z >= 0 (B >= 128).
      // Unreal placeholder/unbaked normal maps such as (0, 255, 0) encode B = 0 (Z = -1),
      // which flips surface lighting black from the front and bright from behind.
      const invalid = b < 120;
      if (invalid) invalidTotal++;
      const isOpaque = !alphaData || alphaData[idx + 3] > 20;
      if (isOpaque) {
        opaqueCount++;
        if (invalid) invalidOpaque++;
      }
    }

    if (invalidTotal === 0) {
      return { texture: normalTex, status: 'ok' };
    }

    if (opaqueCount === 0 || invalidOpaque > opaqueCount * 0.5) {
      normalTex.dispose();
      return { texture: null, status: 'stripped' };
    }

    for (let i = 0; i < total; i++) {
      const idx = i * 4;
      if (nData[idx + 2] < 120) {
        nData[idx] = 128;
        nData[idx + 1] = 128;
        nData[idx + 2] = 255;
        nData[idx + 3] = 255;
      }
    }
    ctx.putImageData(nImgData, 0, 0);
    const cleanTex = new THREE.CanvasTexture(canvas);
    cleanTex.colorSpace = THREE.NoColorSpace;
    cleanTex.wrapS = THREE.ClampToEdgeWrapping;
    cleanTex.wrapT = THREE.ClampToEdgeWrapping;
    cleanTex.anisotropy = normalTex.anisotropy || 1;
    cleanTex.needsUpdate = true;
    normalTex.dispose();
    return { texture: cleanTex, status: 'cleaned' };
  } catch {
    return { texture: normalTex, status: 'ok' };
  }
}

function startViewport(vp) {
  if (!viewEl.hidden) {
    vp.start();
    vp.resize();
  }
}

function configureSurfaceCamera(vp, group, floorMat, wallMat, { forceCamera = false } = {}) {
  const cameraKey = previewMode === 'surface'
    ? `surface:${currentLib === 'cn_foliage' ? 'foliage' : currentPlacement}`
    : 'flat';
  const shouldMoveCamera = forceCamera || cameraKey !== lastCameraKey;
  lastCameraKey = cameraKey;

  if (previewMode === 'surface') {
    const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(FLOOR_SIZE, SLAB_THICKNESS, FLOOR_SIZE), floorMat);
    floorMesh.position.set(0, -SLAB_THICKNESS * 0.5, 0);
    group.add(floorMesh);

    const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(FLOOR_SIZE, WALL_HEIGHT, SLAB_THICKNESS), wallMat || floorMat);
    wallMesh.position.set(0, WALL_HEIGHT * 0.5, WALL_FRONT_Z - SLAB_THICKNESS * 0.5);
    group.add(wallMesh);

    if (vp.gridHelper) {
      vp.gridHelper.visible = true;
      vp.gridHelper.position.y = -SLAB_THICKNESS - 0.005;
    }
    if (shouldMoveCamera) {
      if (currentLib === 'cn_foliage') {
        vp.camera.position.set(1.1, 1.55, 2.55);
        vp.controls.target.set(0, 0.4, 0.1);
      } else if (currentPlacement === 'wall') {
        vp.camera.position.set(1.0, 1.35, 1.35);
        vp.controls.target.set(0, 0.85, -1.4);
      } else {
        vp.camera.position.set(1.1, 1.55, 2.55);
        vp.controls.target.set(0, 0.4, 0.1);
      }
      vp.controls.update();
    }
  } else {
    if (vp.gridHelper) vp.gridHelper.visible = false;
    if (shouldMoveCamera) {
      vp.camera.position.set(0, 1.05, 2.9);
      vp.controls.target.set(0, 1.05, 0);
      vp.controls.update();
    }
  }
}

function getActiveBaseStatsKey() {
  const role = currentPlacement === 'wall' ? 'wall' : 'floor';
  return `concrete:${role}`;
}

function syncHsvMatchDefaults(item) {
  const isCnLib = currentLib === 'cn_pbr' || currentLib === 'cn_foliage';
  const showHsv = isCnLib && previewMode === 'surface';
  if (controlsEl) controlsEl.hidden = !showHsv;
  if (!showHsv || !tintAmountInput) return;

  const catKey = `${currentLib}:${item?.category || ''}`;
  if (catKey !== lastHsvCategoryKey) {
    lastHsvCategoryKey = catKey;
    hsvUserOverride = false;
  }
  if (!hsvUserOverride) {
    const def = getDefaultDecalHsvMatch(item, currentLib);
    tintAmountInput.value = String(def.tint ?? 0);
  }
  syncSliderLabels();
}

function applyHsvMatchToActiveDecal() {
  if (!decalBuilt || !decalSourceHsvStats) return;
  const active = previewMode === 'surface';
  const tintStrength = active ? Math.max(0, Math.min(1, Number(tintAmountInput?.value) || 0)) : 0;
  const targetStats = baseSurfaceStatsCache.get(getActiveBaseStatsKey()) || null;
  decalBuilt.setHsvMatch({
    targetStats,
    sourceStats: decalSourceHsvStats,
    valStrength: tintStrength,
    tintStrength,
    creviceProtect: true,
  });
}

async function loadCurrentDecal({ forceCamera = false } = {}) {
  const token = ++loadToken;
  const item = getCurrentDecal();
  const vp = ensureViewport();

  if (!item) {
    clearStage();
    titleEl.textContent = '贴花';
    emptyEl.hidden = false;
    if (controlsEl) controlsEl.hidden = true;
    return;
  }

  currentPlacement = resolvePlacement(item);
  updateModeTabsUi();
  emptyEl.hidden = true;
  const isCnLib = currentLib === 'cn_pbr' || currentLib === 'cn_foliage';

  if (isCnLib) {
    const cfg = CN_LIBS[currentLib];
    titleEl.textContent = `${item.id} (${item.width || 1024}×${item.height || 1024})`;

    try {
      const [assets, floorMat, wallMat] = await Promise.all([
        loadSingle2MapAssets(cfg.baseUrl, item.id),
        previewMode === 'surface' ? getBaseSurfaceMaterial('concrete', vp.renderer, 'floor') : Promise.resolve(null),
        previewMode === 'surface' ? getBaseSurfaceMaterial('concrete', vp.renderer, 'wall') : Promise.resolve(null),
      ]);
      if (token !== loadToken) return;

      clearStage();
      decalAspect = Math.max(0.2, Math.min(4.0, Number(item.aspectRatio || (assets.normRm.width / Math.max(1, assets.normRm.height)))));
      decalContentScale = currentLib === 'cn_foliage' ? 1 : measureAlphaContentScale(assets.colorImg);
      wallDecalLayout = currentPlacement === 'wall' ? analyzeWallDecalPlacement(assets.colorImg, decalAspect) : { anchor: 'center', spanFullWidth: false };
      const tintHex = item.tintableGrayscale ? 0x8b0c0c : 0xffffff;

      const built = create2MapPbrMaterial({
        mode: cfg.mode,
        assets,
        renderer: vp.renderer,
        tintHex,
        opacity: 1,
        polygonOffset: isCnLib,
        side: previewMode === 'surface' ? THREE.FrontSide : THREE.DoubleSide,
      });
      decalBuilt = built;
      decalMaterial = built.material;
      decalTextures = [built.colorTex, built.normRmTex];
      decalSourceHsvStats = sampleImageHsvStats(assets.colorImg, { skipDarkCrevices: true });
      syncHsvMatchDefaults(item);
      applyHsvMatchToActiveDecal();

      const group = new THREE.Group();
      configureSurfaceCamera(vp, group, floorMat, wallMat, { forceCamera });
      decalMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), decalMaterial);
      group.add(decalMesh);

      stageRoot = group;
      applyTransformToDecalMesh();
      vp.scene.add(stageRoot);

      startViewport(vp);
    } catch (error) {
      if (token !== loadToken) return;
      emptyEl.textContent = error.message || '贴花贴图加载失败';
      emptyEl.hidden = false;
    }
    return;
  }

  // Legacy Unreal decal path
  titleEl.textContent = `${item.name}${item.packLabel ? ` · ${item.packLabel}` : ''}`;

  try {
    const [colorTex, rawNormalTex, ormTex] = await Promise.all([
      texLoader.loadAsync(item.color),
      item.normal ? texLoader.loadAsync(item.normal).catch(() => null) : Promise.resolve(null),
      item.orm ? texLoader.loadAsync(item.orm).catch(() => null) : Promise.resolve(null),
    ]);
    if (token !== loadToken) {
      colorTex.dispose();
      rawNormalTex?.dispose();
      ormTex?.dispose();
      return;
    }

    colorTex.colorSpace = THREE.SRGBColorSpace;
    if (rawNormalTex) rawNormalTex.colorSpace = THREE.NoColorSpace;
    if (ormTex) ormTex.colorSpace = THREE.NoColorSpace;

    const { texture: normalTex } = sanitizeDecalNormalTexture(rawNormalTex, colorTex);

    const [floorMat, wallMat] = previewMode === 'surface'
      ? await Promise.all([
        getBaseSurfaceMaterial('concrete', vp.renderer, 'floor'),
        getBaseSurfaceMaterial('concrete', vp.renderer, 'wall'),
      ])
      : [null, null];
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
    decalContentScale = measureAlphaContentScale(img);
    wallDecalLayout = currentPlacement === 'wall' ? analyzeWallDecalPlacement(img, decalAspect) : { anchor: 'center', spanFullWidth: false };

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
      opacity: 1,
      alphaTest: 0.01,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      side: previewMode === 'surface' ? THREE.FrontSide : THREE.DoubleSide,
    });

    const group = new THREE.Group();
    configureSurfaceCamera(vp, group, floorMat, wallMat, { forceCamera });
    decalMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), decalMaterial);
    group.add(decalMesh);

    stageRoot = group;
    applyTransformToDecalMesh();
    vp.scene.add(stageRoot);

    startViewport(vp);
  } catch (error) {
    if (token !== loadToken) return;
    emptyEl.textContent = error.message || '贴花贴图加载失败';
    emptyEl.hidden = false;
  }
}

async function switchDecalLib(libId) {
  currentLib = (libId === 'unreal' || libId === 'cn_foliage') ? libId : 'cn_pbr';
  populatePackFilter();
  const list = getActiveList();
  activeId = list[0]?.id || '';
  renderList();
  await loadCurrentDecal({ forceCamera: true });
}

async function initDecalsView() {
  if (!initialized) {
    initialized = true;
    syncSliderLabels();
    updateModeTabsUi();

    searchInput.addEventListener('input', renderList);
    packFilter.addEventListener('change', () => {
      const val = packFilter.value || 'all';
      if (val === 'lib:cn_foliage' && currentLib !== 'cn_foliage') {
        void switchDecalLib('cn_foliage');
        return;
      }
      if (val !== 'lib:cn_foliage' && currentLib === 'cn_foliage') {
        currentLib = 'cn_pbr';
        populatePackFilter();
        packFilter.value = [...packFilter.options].some(o => o.value === val) ? val : 'all';
      }
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
        void loadCurrentDecal({ forceCamera: true });
      });
    }

    tintAmountInput?.addEventListener('input', () => {
      hsvUserOverride = true;
      syncSliderLabels();
      applyHsvMatchToActiveDecal();
    });
  }

  const vp = ensureViewport();
  startViewport(vp);

  if (!catalogLoaded) {
    try {
      const [cnResp, folResp, curatedData] = await Promise.all([
        fetch('/assets/cn/pbr_decals/pbr_decals_table.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
        fetch('/assets/cn/pbr_foliage/pbr_foliage_table.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
        apiRequestJson('/api/hgame/materials/curated').catch(() => ({ materials: [] })),
      ]);
      cnDecals = Array.isArray(cnResp?.items) ? cnResp.items : [];
      cnFoliage = Array.isArray(folResp?.items) ? folResp.items : [];
      unrealDecals = [];
      const curatedMats = Array.isArray(curatedData?.materials) ? curatedData.materials : [];
      baseMaterials = [...curatedMats];
      catalogLoaded = true;
    } catch (error) {
      cnDecals = [];
      cnFoliage = [];
      unrealDecals = [];
      baseMaterials = [];
      emptyEl.textContent = error.message || '读取贴花目录失败';
      emptyEl.hidden = false;
    }
  }

  if (!cnDecals.length && unrealDecals.length) {
    currentLib = 'unreal';
  }

  populatePackFilter();
  const list = getActiveList();
  if (!list.some(item => item.id === activeId)) {
    activeId = list[0]?.id || '';
  }
  renderList();
  await loadCurrentDecal();
}

window.addEventListener('webasset:open-asset', event => {
  const { workspace, id, kind } = event.detail || {};
  if (workspace !== 'decals' || !id) return;
  if (kind === 'cn_foliage' || kind === 'cn_pbr') {
    currentLib = kind;
  }
  activeId = id;
  if (catalogLoaded) {
    populatePackFilter();
    renderList();
    void loadCurrentDecal();
  }
});

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
