import * as THREE from 'three';
import {
  apiRequestJson,
  createThreeViewport,
  disposeObject3D,
  fetchUnrealCatalog,
} from './hgame-shared.js';

const DECAL_PACK_ORDER = [
  '混凝土贴花 Concrete',
  '弹坑焦痕 Crater',
  '街道与路面 Road',
  '血迹贴花 Blood',
];

const SURFACE_FALLBACKS = {
  concrete: { color: 0x4b504a, roughness: 0.88 },
  asphalt: { color: 0x262928, roughness: 0.92 },
  brick: { color: 0x62463a, roughness: 0.86 },
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
const downloadEl = document.querySelector('#hgame-decal-download');
const modeTabs = Array.from(document.querySelectorAll('.hgame-decal-mode-tab'));
const emptyEl = document.querySelector('#hgame-decal-empty');
const stageEl = document.querySelector('#hgame-decal-stage');
const mapsRowEl = document.querySelector('#hgame-decal-maps');
const mapColorImg = document.querySelector('#hgame-decal-map-color');
const mapNormalImg = document.querySelector('#hgame-decal-map-normal');
const mapOrmImg = document.querySelector('#hgame-decal-map-orm');
const surfaceSelect = document.querySelector('#hgame-decal-surface');
const scaleInput = document.querySelector('#hgame-decal-scale');
const scaleValEl = document.querySelector('#hgame-decal-scale-val');
const rotInput = document.querySelector('#hgame-decal-rot');
const rotValEl = document.querySelector('#hgame-decal-rot-val');
const opacityInput = document.querySelector('#hgame-decal-opacity');
const opacityValEl = document.querySelector('#hgame-decal-opacity-val');
const statusEl = document.querySelector('#hgame-decal-status');

const texLoader = new THREE.TextureLoader();

let decals = [];
let baseMaterials = [];
let activeId = '';
let previewMode = 'surface';
let viewport = null;
let stageRoot = null;
let decalMesh = null;
let decalMaterial = null;
let decalTextures = [];
let decalAspect = 1;
let initialized = false;
let loadToken = 0;
let baseSurfaceCache = new Map();

function syncSliderLabels() {
  scaleValEl.textContent = `${Number(scaleInput.value).toFixed(2)}×`;
  rotValEl.textContent = `${Math.round(Number(rotInput.value) || 0)}°`;
  opacityValEl.textContent = Number(opacityInput.value).toFixed(2);
}

function getFilteredDecals() {
  const query = searchInput.value.trim().toLowerCase();
  const pack = packFilter.value || 'all';
  return decals.filter(item => {
    const itemPack = item.packLabel || item.pack || '其他贴花';
    if (pack !== 'all' && itemPack !== pack) return false;
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
  return filtered[0] || decals.find(item => item.id === activeId) || decals[0] || null;
}

function populatePackFilter() {
  const counts = new Map();
  for (const item of decals) {
    const label = item.packLabel || item.pack || '其他贴花';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const prev = packFilter.value || 'all';
  packFilter.replaceChildren();
  const allOpt = document.createElement('option');
  allOpt.value = 'all';
  allOpt.textContent = `全部合集 (${decals.length})`;
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
    empty.textContent = decals.length === 0 ? '暂无 Unreal 贴花资产' : '没有匹配的贴花';
    listEl.appendChild(empty);
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

async function getBaseSurfaceMaterial(surfaceKey) {
  const key = SURFACE_FALLBACKS[surfaceKey] ? surfaceKey : 'concrete';
  if (baseSurfaceCache.has(key)) {
    return baseSurfaceCache.get(key);
  }

  const fb = SURFACE_FALLBACKS[key];
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

  decalMaterial.opacity = opacity;
  if (previewMode === 'surface') {
    decalMesh.scale.set(scale * decalAspect, scale, 1);
    decalMesh.rotation.set(-Math.PI * 0.5, 0, -rotRad);
    decalMesh.position.set(0, 0.126, 0);
  } else {
    decalMesh.scale.set(scale * decalAspect, scale, 1);
    decalMesh.rotation.set(0, 0, -rotRad);
    decalMesh.position.set(0, 1.05, 0);
  }
}

function updateMapThumbnails(item) {
  if (!item) {
    mapsRowEl.hidden = true;
    return;
  }
  mapColorImg.src = item.color || '';
  mapNormalImg.src = item.normal || item.color || '';
  mapOrmImg.src = item.orm || item.color || '';
  mapsRowEl.hidden = false;
}

function updateModeTabsUi() {
  for (const tab of modeTabs) {
    const active = tab.dataset.decalMode === previewMode;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  surfaceSelect.disabled = previewMode !== 'surface';
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

async function loadCurrentDecal() {
  const token = ++loadToken;
  const item = getCurrentDecal();
  const vp = ensureViewport();

  if (!item) {
    clearStage();
    titleEl.textContent = '贴花预览';
    downloadEl.hidden = true;
    mapsRowEl.hidden = true;
    emptyEl.hidden = false;
    statusEl.textContent = '暂无可用贴花';
    return;
  }

  emptyEl.hidden = true;
  titleEl.textContent = `${item.name}${item.packLabel ? ` · ${item.packLabel}` : ''}`;
  downloadEl.href = item.color;
  downloadEl.download = `${item.id}_color.png`;
  downloadEl.hidden = false;
  updateMapThumbnails(item);
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
      ? await getBaseSurfaceMaterial(surfaceSelect.value)
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
    if (previewMode === 'surface') {
      const slabGeo = new THREE.BoxGeometry(3.4, 0.24, 3.4);
      const slab = new THREE.Mesh(slabGeo, baseMat);
      slab.position.y = 0;
      group.add(slab);
      if (vp.gridHelper) vp.gridHelper.visible = true;
      vp.camera.position.set(1.1, 2.35, 2.35);
      vp.controls.target.set(0, 0.14, 0);
    } else {
      if (vp.gridHelper) vp.gridHelper.visible = false;
      vp.camera.position.set(0, 1.05, 2.9);
      vp.controls.target.set(0, 1.05, 0);
    }
    vp.controls.update();

    const decalGeo = new THREE.PlaneGeometry(1.75, 1.75);
    decalMesh = new THREE.Mesh(decalGeo, decalMaterial);
    group.add(decalMesh);

    stageRoot = group;
    applyTransformToDecalMesh();
    vp.scene.add(stageRoot);

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

async function initDecalsView() {
  if (!initialized) {
    initialized = true;
    syncSliderLabels();
    updateModeTabsUi();

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
  }

  const vp = ensureViewport();
  if (!viewEl.hidden) {
    vp.resize();
    vp.start();
  }

  try {
    const [unrealCatalog, curatedData] = await Promise.all([
      fetchUnrealCatalog(),
      apiRequestJson('/api/hgame/materials/curated').catch(() => ({ materials: [] })),
    ]);
    decals = Array.isArray(unrealCatalog.decals) ? unrealCatalog.decals : [];
    const unrealMats = Array.isArray(unrealCatalog.materials) ? unrealCatalog.materials : [];
    const curatedMats = Array.isArray(curatedData?.materials) ? curatedData.materials : [];
    baseMaterials = [...unrealMats, ...curatedMats];
  } catch (error) {
    decals = [];
    baseMaterials = [];
    statusEl.textContent = error.message || '读取贴花目录失败';
  }

  populatePackFilter();
  if (!activeId && decals.length > 0) {
    activeId = decals[0].id;
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
