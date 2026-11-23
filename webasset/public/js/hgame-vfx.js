import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createVfxSystem, SHURIKEN_QUALITY_TIERS, VFX_SHAPE } from '/runtime/hgame/vfx/index.js';
import {
  createSidebarSquareCard,
  createThreeViewport,
  disposeObject3D,
  fetchUnrealCatalog,
  normalizeUnrealSceneMaterials,
} from './hgame-shared.js';

const VFX_CATEGORY_ORDER = [
  'Piloto_Bench_8',
  '火焰爆破',
  '火焰与爆破',
  '刀光轨迹',
  '法阵光环',
  '法阵与护盾',
  '雷电与光束',
  '水冰与寒霜',
  '烟雾气浪',
  '3D 特效网格',
  '粒子与序列帧贴图',
];

const viewEl = document.querySelector('#vfx-view');
const searchInput = document.querySelector('#hgame-vfx-search');
const typeFilter = document.querySelector('#hgame-vfx-type-filter');
const listEl = document.querySelector('#hgame-vfx-list');
const titleEl = document.querySelector('#hgame-vfx-title');
const downloadEl = document.querySelector('#hgame-vfx-download');
const modeTabsWrap = document.querySelector('#hgame-vfx-mode-tabs');
const modeTabEls = [...document.querySelectorAll('.hgame-vfx-mode-tab')];
const copyCodeBtn = document.querySelector('#hgame-vfx-copy-code');
const emptyEl = document.querySelector('#hgame-vfx-empty');
const vfxStage = document.querySelector('#hgame-vfx-stage');
const playBtn = document.querySelector('#hgame-vfx-play-button');
const replayBtn = document.querySelector('#hgame-vfx-replay-button');
const speedWrap = document.querySelector('#hgame-vfx-speed-wrap');
const speedSelect = document.querySelector('#hgame-vfx-speed');
const qualityWrap = document.querySelector('#hgame-vfx-quality-wrap');
const qualitySelect = document.querySelector('#hgame-vfx-quality');
const gridToggleWrap = document.querySelector('#hgame-vfx-grid-toggle-wrap');
const gridToggle = document.querySelector('#hgame-vfx-grid-toggle');
const bloomToggleWrap = document.querySelector('#hgame-vfx-bloom-toggle-wrap');
const bloomToggle = document.querySelector('#hgame-vfx-bloom-toggle');
const seqGroupEl = document.querySelector('#hgame-vfx-seq-group');
const planeModeWrap = document.querySelector('#hgame-vfx-plane-mode-wrap');
const planeModeSelect = document.querySelector('#hgame-vfx-plane-mode');
const gridWrap = document.querySelector('#hgame-vfx-grid-wrap');
const gridSelect = document.querySelector('#hgame-vfx-grid');
const fpsWrap = document.querySelector('#hgame-vfx-fps-wrap');
const fpsInput = document.querySelector('#hgame-vfx-fps');
const blendWrap = document.querySelector('#hgame-vfx-blend-wrap');
const blendSelect = document.querySelector('#hgame-vfx-blend');
const colorInput = document.querySelector('#hgame-vfx-color');
const spinInput = document.querySelector('#hgame-vfx-spin');
const statusEl = document.querySelector('#hgame-vfx-status');

const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();

let initialized = false;
let vfxSystems = [];
let shurikenBenchSystems = [];
let vfxMeshes = [];
let vfxTextures = [];
let activeSelection = { kind: '', id: '' };
let activeRenderMode = 'source'; // 'source' | 'hgame'
let viewport = null;
let stageRoot = null;
let activeTexture = null;
let activeTextureMaterial = null;
let activeTexturePlane = null;
let activeTextureMode = 'billboard';
let loadToken = 0;
let isPlaying = true;
let animTimer = 0;
let currentFrame = 0;

// Active particle system simulation
let simEmitters = [];
let simElapsed = 0;
let simLoopCooldown = 0;
const simTexCache = new Map();
const simProcTexCache = new Map();
const simMeshCache = new Map();

// HGame runtime VFX state
let hgameVfx = null;
let hgameFireTimer = 0;
let hgameMeshPreview = null;

// Piloto Bench 8 + HDR Linear + Bloom + SoftDepth + Single-Pass Warp pipeline
const benchRecipeCache = new Map();
const benchTexCache = new Map();
const benchGeoCache = new Map();
let activeBenchHandle = null;
let activeBenchRecipe = null;
let benchReplayCooldown = 0;
let benchFrameCount = 0;
let benchMsAccum = 0;
let benchLastDrawCalls = 0;
let hdrPipeline = null;

function getAllItems() {
  return [
    ...shurikenBenchSystems.map(item => ({ ...item, kind: 'system' })),
    ...vfxSystems.map(item => ({ ...item, kind: 'system' })),
    ...vfxMeshes.map(item => ({ ...item, kind: 'mesh' })),
    ...vfxTextures.map(item => ({ ...item, kind: 'texture' })),
  ];
}

function getFilteredItems() {
  const query = searchInput.value.trim().toLowerCase();
  const filterVal = typeFilter?.value || 'all';
  return getAllItems().filter(item => {
    if (filterVal.startsWith('kind:') && item.kind !== filterVal.slice(5)) return false;
    if (filterVal.startsWith('cat:') && (item.category || '') !== filterVal.slice(4)) return false;
    if (filterVal !== 'all' && !filterVal.startsWith('kind:') && !filterVal.startsWith('cat:') && (item.category || '') !== filterVal) return false;
    if (!query) return true;
    return (item.name || '').toLowerCase().includes(query)
      || (item.assetName || '').toLowerCase().includes(query)
      || (item.pack || '').toLowerCase().includes(query)
      || (item.id || '').toLowerCase().includes(query)
      || (item.category || '').toLowerCase().includes(query);
  });
}

function populateCategoryFilter() {
  const pool = getAllItems();
  const counts = new Map();
  let sysCnt = 0;
  let meshCnt = 0;
  let texCnt = 0;
  for (const item of pool) {
    if (item.kind === 'system') sysCnt++;
    else if (item.kind === 'mesh') meshCnt++;
    else if (item.kind === 'texture') texCnt++;
    const cat = item.category || '其他特效';
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  const prev = typeFilter.value || 'all';
  typeFilter.replaceChildren();
  const addOpt = (val, text) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    typeFilter.appendChild(opt);
  };
  addOpt('all', `全部特效 (${pool.length})`);
  if (sysCnt > 0) addOpt('kind:system', `特效系统 (${sysCnt})`);
  if (meshCnt > 0) addOpt('kind:mesh', `3D 网格 (${meshCnt})`);
  if (texCnt > 0) addOpt('kind:texture', `贴图序列帧 (${texCnt})`);
  const ordered = [
    ...VFX_CATEGORY_ORDER.filter(c => counts.has(c)),
    ...[...counts.keys()].filter(c => !VFX_CATEGORY_ORDER.includes(c)).sort(),
  ];
  for (const cat of ordered) {
    addOpt(`cat:${cat}`, `${cat} (${counts.get(cat)})`);
  }
  const hasPrev = [...typeFilter.options].some(o => o.value === prev);
  typeFilter.value = hasPrev ? prev : 'all';
}

function getCurrentItem() {
  const all = getAllItems();
  return all.find(item => item.kind === activeSelection.kind && item.id === activeSelection.id)
    || getFilteredItems()[0]
    || all[0]
    || null;
}

function inferGridForItem(item) {
  if (!item || item.kind !== 'texture') return [1, 1];
  const val = gridSelect.value || 'auto';
  if (val !== 'auto') {
    const [c, r] = val.split('x').map(n => Math.max(1, Number.parseInt(n, 10) || 1));
    return [c, r];
  }
  const cols = Number(item.columns ?? item.cols);
  const rows = Number(item.rows);
  if (cols >= 1 && rows >= 1 && (cols > 1 || rows > 1)) return [cols, rows];
  const text = `${item.id || ''} ${item.name || ''}`;
  if (/6x3/i.test(text)) return [6, 3];
  if (/8x8|64f/i.test(text)) return [8, 8];
  if (/5x5|25f/i.test(text)) return [5, 5];
  if (/4seq|4sequence|4x4|16f|flipbook/i.test(text)) return [4, 4];
  if (/4x1/i.test(text)) return [4, 1];
  if (/2x2|4f/i.test(text)) return [2, 2];
  return [1, 1];
}

function inferPlaneModeForItem(item) {
  const selected = planeModeSelect?.value || 'auto';
  if (selected !== 'auto') return selected;
  const text = `${item?.id || ''} ${item?.name || ''} ${item?.category || ''}`;
  if (/(circle|ring|aura|shockwave|ground|runecircle|法阵|光环)/i.test(text)) return 'ground';
  return 'billboard';
}

function suggestBlendForItem(item) {
  if (item?.blend === 'normal' || item?.blend === 'additive') return item.blend;
  const text = `${item?.id || ''} ${item?.name || ''}`;
  return /(smoke|mist|cloud|dust|blood|ink|noise|alpha|debris|_ab)/i.test(text) ? 'normal' : 'additive';
}

function applyItemDefaults(item) {
  if (!item) return;
  if (item.kind === 'system') {
    const primaryColor = item.hgamePreset?.color || '#ffffff';
    colorInput.value = /^#[0-9a-f]{6}$/i.test(primaryColor) ? primaryColor : '#ffffff';
    return;
  }
  if (item.kind === 'mesh') {
    colorInput.value = '#ffffff';
    return;
  }
  gridSelect.value = 'auto';
  if (planeModeSelect) planeModeSelect.value = 'auto';
  fpsInput.value = String(item.fps || 12);
  blendSelect.value = suggestBlendForItem(item);
  colorInput.value = '#ffffff';
}

function getActiveFrameCount(item, cols, rows) {
  const gridTotal = Math.max(1, cols * rows);
  if (gridSelect.value === 'auto' && Number(item?.frameCount) > 0) {
    return Math.min(gridTotal, Number(item.frameCount));
  }
  return gridTotal;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function renderList() {
  const items = getFilteredItems();
  listEl.replaceChildren();

  if (items.length === 0) {
    const p = document.createElement('p');
    p.className = 'hgame-list-empty';
    p.textContent = getAllItems().length === 0 ? '暂无特效资产。' : '没有匹配的特效资源。';
    listEl.append(p);
    return;
  }

  if (!items.some(item => item.kind === activeSelection.kind && item.id === activeSelection.id)) {
    activeSelection = { kind: items[0].kind, id: items[0].id };
    applyItemDefaults(items[0]);
  }

  const byCategory = new Map();
  for (const item of items) {
    const cat = item.category || (item.kind === 'mesh' ? '3D 特效网格' : '粒子与序列帧贴图');
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(item);
  }

  const categories = [
    ...VFX_CATEGORY_ORDER.filter(cat => byCategory.has(cat)),
    ...[...byCategory.keys()].filter(cat => !VFX_CATEGORY_ORDER.includes(cat)),
  ];

  for (const cat of categories) {
    const groupItems = byCategory.get(cat);
    const heading = document.createElement('div');
    heading.className = 'hgame-list-heading';
    heading.textContent = `${cat} (${groupItems.length})`;
    listEl.append(heading);

    for (const item of groupItems) {
      const selected = item.kind === activeSelection.kind && item.id === activeSelection.id;
      const badge = item.kind === 'system'
        ? (item.sourceType === 'niagara' ? 'NS' : 'VFX')
        : (item.kind === 'mesh' ? '3D' : 'TEX');
      const { button } = createSidebarSquareCard({
        name: item.name || item.id,
        thumbUrl: item.kind === 'texture' ? item.url : (item.thumbnail || ''),
        badge,
        accentColor: item.kind === 'system' ? (item.hgamePreset?.color || '#d5e4b4') : '',
        active: selected,
        onClick: () => {
          activeSelection = { kind: item.kind, id: item.id };
          applyItemDefaults(item);
          renderList();
          void loadCurrentVfx();
        },
      });
      listEl.append(button);
    }
  }
}

function ensureViewport() {
  if (!viewport) {
    viewport = createThreeViewport(vfxStage, { background: 0x0f140f, grid: true, shadows: false });
    viewport.camera.position.set(3.2, 2.5, 4.2);
    viewport.controls.target.set(0, 0.7, 0);
    viewport.controls.update();
  }
  return viewport;
}

function ensureHdrPipeline(vp) {
  if (hdrPipeline) return hdrPipeline;
  const sizeVec = new THREE.Vector2();
  vp.renderer.getSize(sizeVec);
  const pr = vp.renderer.getPixelRatio();
  const w = Math.max(1, Math.round(sizeVec.x * pr));
  const h = Math.max(1, Math.round(sizeVec.y * pr));

  const depthTex = new THREE.DepthTexture(w, h);
  depthTex.type = THREE.UnsignedIntType;
  const bgTarget = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    depthTexture: depthTex,
  });
  const grabTarget = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  });
  const hdrTarget = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  });

  const hiddenState = [];
  const warpMeshes = [];
  const scenePass = new Pass();
  scenePass.needsSwap = false;
  scenePass.render = (renderer, _writeBuffer, readBuffer) => {
    const cam = vp.camera;
    const sc = vp.scene;
    const dprW = readBuffer.width;
    const dprH = readBuffer.height;
    if (bgTarget.width !== dprW || bgTarget.height !== dprH) {
      bgTarget.setSize(dprW, dprH);
    }

    // 1. Opaque / background depth pre-pass (zero WebGL feedback loop)
    hiddenState.length = 0;
    for (let i = 0; i < sc.children.length; i++) {
      const ch = sc.children[i];
      if (ch.name && (ch.name.startsWith('ShurikenLayer_') || ch.name.startsWith('HGameVfx'))) {
        hiddenState.push([ch, ch.visible]);
        ch.visible = false;
      }
    }
    renderer.setRenderTarget(bgTarget);
    renderer.clear(true, true, true);
    renderer.render(sc, cam);
    for (let i = 0; i < hiddenState.length; i++) {
      hiddenState[i][0].visible = hiddenState[i][1];
    }

    const qTierKey = hgameVfx?.getQualityTier?.() || 'high';
    const qTier = SHURIKEN_QUALITY_TIERS[qTierKey] || SHURIKEN_QUALITY_TIERS.high;
    hgameVfx?.setDepthTexture?.(qTier.softParticles ? bgTarget.depthTexture : null, {
      near: cam.near,
      far: cam.far,
      width: dprW,
      height: dprH,
    });

    // 2. Single-pass screen grab for piloto_warp refraction
    const warpActive = Boolean(hgameVfx?.hasActiveWarp?.() && qTier.warpScale > 0);
    if (warpActive) {
      const gw = Math.max(1, Math.round(dprW * qTier.warpScale));
      const gh = Math.max(1, Math.round(dprH * qTier.warpScale));
      if (grabTarget.width !== gw || grabTarget.height !== gh) {
        grabTarget.setSize(gw, gh);
      }
      hgameVfx.setWarpMeshesVisible(false);
      hgameVfx.setSceneTexture(null);
      renderer.setRenderTarget(grabTarget);
      renderer.clear(true, true, true);
      renderer.render(sc, cam);

      hgameVfx.setSceneTexture(grabTarget.texture, { width: dprW, height: dprH });
      renderer.setRenderTarget(readBuffer);
      renderer.clear(true, true, true);
      renderer.render(sc, cam);

      hgameVfx.setWarpMeshesVisible(true);
      warpMeshes.length = 0;
      sc.traverse((obj) => {
        if (obj.visible && obj.isMesh && obj.userData?.vfxWarp) {
          warpMeshes.push(obj);
          obj.layers.enable(30);
        }
      });
      if (warpMeshes.length > 0) {
        const prevMask = cam.layers.mask;
        const prevAutoClear = renderer.autoClear;
        cam.layers.set(30);
        renderer.autoClear = false;
        renderer.render(sc, cam);
        renderer.autoClear = prevAutoClear;
        cam.layers.mask = prevMask;
        for (let i = 0; i < warpMeshes.length; i++) {
          warpMeshes[i].layers.disable(30);
        }
      }
    } else {
      hgameVfx?.setWarpMeshesVisible?.(false);
      hgameVfx?.setSceneTexture?.(null);
      renderer.setRenderTarget(readBuffer);
      renderer.clear(true, true, true);
      renderer.render(sc, cam);
    }
  };

  const composer = new EffectComposer(vp.renderer, hdrTarget);
  composer.setPixelRatio(pr);
  composer.setSize(Math.max(1, sizeVec.x), Math.max(1, sizeVec.y));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(sizeVec.x, sizeVec.y), 0.38, 0.42, 1.0);
  const outputPass = new OutputPass();
  composer.addPass(scenePass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);

  hdrPipeline = {
    composer,
    bloomPass,
    outputPass,
    bgTarget,
    grabTarget,
    hdrTarget,
    render() {
      bloomPass.enabled = bloomToggle ? bloomToggle.checked : true;
      const prevAutoReset = vp.renderer.info.autoReset;
      vp.renderer.info.autoReset = false;
      vp.renderer.info.reset();
      composer.render();
      benchLastDrawCalls = vp.renderer.info.render.calls;
      vp.renderer.info.autoReset = prevAutoReset;
    },
    resize(width, height) {
      const p = vp.renderer.getPixelRatio();
      composer.setPixelRatio(p);
      composer.setSize(Math.max(1, width), Math.max(1, height));
      bloomPass.resolution.set(Math.max(1, width), Math.max(1, height));
    },
    dispose() {
      composer.dispose();
      bgTarget.dispose();
      grabTarget.dispose();
      hdrTarget.dispose();
    },
  };
  vp.setOnResize((width, height) => hdrPipeline?.resize(width, height));
  return hdrPipeline;
}

function disposeSimulation() {
  for (const em of simEmitters) {
    for (const p of em.pool) {
      if (p.mesh) {
        em.group.remove(p.mesh);
        if (!p.isSharedGeo && p.mesh.geometry) p.mesh.geometry.dispose();
        p.material?.dispose?.();
      }
    }
    em.sharedGeo?.dispose?.();
    em.ownedTexture?.dispose?.();
    stageRoot?.remove(em.group);
  }
  simEmitters = [];
  simElapsed = 0;
  simLoopCooldown = 0;
  activeBenchHandle = null;
  activeBenchRecipe = null;
  benchReplayCooldown = 0;
  benchFrameCount = 0;
  benchMsAccum = 0;
  benchLastDrawCalls = 0;
  viewport?.setRenderOverride(null);

  if (hgameMeshPreview) {
    stageRoot?.remove(hgameMeshPreview);
    disposeObject3D(hgameMeshPreview);
    hgameMeshPreview = null;
  }
  if (hgameVfx) {
    hgameVfx.dispose();
    hgameVfx = null;
  }
  hgameFireTimer = 0;
}

function clearStageRoot() {
  disposeSimulation();
  if (stageRoot && viewport) {
    viewport.scene.remove(stageRoot);
    disposeObject3D(stageRoot);
  }
  stageRoot = null;
  if (activeTexture) {
    activeTexture.dispose();
    activeTexture = null;
  }
  activeTextureMaterial = null;
  activeTexturePlane = null;
  animTimer = 0;
  currentFrame = 0;
}

function updateTextureUv(item) {
  if (!activeTexture || !item || item.kind === 'mesh' || item.kind === 'system') return;
  const [cols, rows] = inferGridForItem(item);
  const total = getActiveFrameCount(item, cols, rows);
  const frame = ((currentFrame % total) + total) % total;
  const col = frame % cols;
  const row = Math.floor(frame / cols);
  activeTexture.repeat.set(1 / cols, 1 / rows);
  activeTexture.offset.set(col / cols, 1 - (row + 1) / rows);
}

function getProceduralTexture(shape) {
  if (simProcTexCache.has(shape)) return simProcTexCache.get(shape);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const cx = 64;
  const cy = 64;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.68)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.16)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  simProcTexCache.set(shape, tex);
  return tex;
}

async function loadTextureCached(url) {
  if (!url) return null;
  if (simTexCache.has(url)) return simTexCache.get(url);
  const tex = await texLoader.loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  simTexCache.set(url, tex);
  return tex;
}

async function loadVfxMeshCached(url) {
  if (!url) return null;
  if (simMeshCache.has(url)) return simMeshCache.get(url);
  const gltf = await gltfLoader.loadAsync(url);
  normalizeUnrealSceneMaterials(gltf.scene);
  simMeshCache.set(url, gltf.scene);
  return gltf.scene;
}

function applyAppearanceToStage() {
  const tint = new THREE.Color(colorInput.value || '#ffffff');
  if (activeTextureMaterial) {
    activeTextureMaterial.color.copy(tint);
    activeTextureMaterial.blending = blendSelect.value === 'normal'
      ? THREE.NormalBlending
      : THREE.AdditiveBlending;
    activeTextureMaterial.needsUpdate = true;
  } else if (stageRoot) {
    const item = getCurrentItem();
    if (item?.kind === 'mesh') {
      stageRoot.traverse(child => {
        if (!child.isMesh || !child.material) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          if (m.color) m.color.copy(tint);
          if (m.emissive && m.emissive.getHex() > 0) m.emissive.copy(tint);
        }
      });
    }
  }
}

async function loadBenchTexture(url, isSrgb) {
  const cacheKey = `${url}::${isSrgb ? 'srgb' : 'lin'}`;
  if (benchTexCache.has(cacheKey)) return benchTexCache.get(cacheKey);
  const tex = await texLoader.loadAsync(url);
  tex.colorSpace = isSrgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  benchTexCache.set(cacheKey, tex);
  return tex;
}

async function loadBenchMeshGeo(url) {
  if (benchGeoCache.has(url)) return benchGeoCache.get(url);
  const gltf = await gltfLoader.loadAsync(url);
  let foundGeo = null;
  gltf.scene.traverse((ch) => {
    if (!foundGeo && ch.isMesh && ch.geometry) foundGeo = ch.geometry;
  });
  benchGeoCache.set(url, foundGeo);
  return foundGeo;
}

function collectBenchDependencies(recipe, colorTexKeys, dataTexKeys, meshKeys) {
  for (const l of recipe.layers || []) {
    const m = l.material || l.uberMat || {};
    for (const k of [m.mainTexKey, m.baseColorMapKey, m.emissionMapKey, l.sprite, l.flipbook?.region]) {
      if (k) colorTexKeys.add(k);
    }
    for (const k of [
      m.detailNoiseKey,
      m.alphaOverrideKey,
      m.normalMapKey,
      m.ormMapKey,
      m.detailMapKey,
      m.dissolveMapKey,
      m.distortionTextureKey,
      m.alphaTextureKey,
    ]) {
      if (k) dataTexKeys.add(k);
    }
    if (l.mesh && !['quad', 'cube', 'sphere', 'cylinder', 'crystal'].includes(l.mesh)) {
      meshKeys.add(l.mesh);
    }
    if (l.shape?.mesh) meshKeys.add(l.shape.mesh);
    for (const sub of l.subEmitters || []) {
      if (sub?.effect) collectBenchDependencies(sub.effect, colorTexKeys, dataTexKeys, meshKeys);
    }
  }
}

function syncControlsVisibility(item) {
  const isTexture = item?.kind === 'texture';
  const isSystem = item?.kind === 'system';
  const isBench = Boolean(item?.isShurikenBench);
  const isEmitterTex = isTexture && activeTextureMode === 'emitter';
  if (modeTabsWrap) modeTabsWrap.hidden = !isSystem || isBench;
  if (copyCodeBtn) copyCodeBtn.hidden = !isSystem;
  if (speedWrap) speedWrap.hidden = !isBench;
  if (qualityWrap) qualityWrap.hidden = !isBench;
  if (gridToggleWrap) gridToggleWrap.hidden = !isBench;
  if (bloomToggleWrap) bloomToggleWrap.hidden = !isBench;
  if (seqGroupEl) seqGroupEl.hidden = !isTexture;
  if (planeModeWrap) planeModeWrap.hidden = !isTexture;
  gridWrap.hidden = !isTexture || isEmitterTex;
  fpsWrap.hidden = !isTexture || isEmitterTex;
  blendWrap.hidden = !isTexture;
  if (replayBtn) replayBtn.hidden = !(isSystem || isEmitterTex);
  playBtn.textContent = isPlaying ? '暂停' : '播放';

  for (const tab of modeTabEls) {
    const selected = tab.dataset.hgameVfxMode === activeRenderMode;
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    tab.tabIndex = selected ? 0 : -1;
  }
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function sampleCurve(curve, t) {
  if (!curve) return 1.0;
  const keys = curve.keys;
  let kVal = 1.0;
  if (Array.isArray(keys) && keys.length > 0) {
    if (t <= keys[0][0]) {
      kVal = keys[0][1];
    } else if (t >= keys[keys.length - 1][0]) {
      kVal = keys[keys.length - 1][1];
    } else {
      for (let i = 0; i < keys.length - 1; i++) {
        const [t0, v0] = keys[i];
        const [t1, v1] = keys[i + 1];
        if (t >= t0 && t <= t1) {
          const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
          kVal = v0 + (v1 - v0) * u;
          break;
        }
      }
    }
  }
  return kVal;
}

function sampleMinMaxCurve(curve, t, randFactor = 0.5) {
  if (!curve) return 0;
  const base = curve.min + (curve.max - curve.min) * randFactor;
  if (curve.mode === 1 || curve.mode === 2) {
    return base * sampleCurve(curve, t);
  }
  return base;
}

function sampleGradientColor(grad, t, outColor) {
  if (!grad) {
    outColor.setRGB(1, 1, 1);
    return 1;
  }
  const cks = grad.colorKeys || [[0, [1, 1, 1]], [1, [1, 1, 1]]];
  let r = 1;
  let g = 1;
  let b = 1;
  if (t <= cks[0][0]) {
    [r, g, b] = cks[0][1];
  } else if (t >= cks[cks.length - 1][0]) {
    [r, g, b] = cks[cks.length - 1][1];
  } else {
    for (let i = 0; i < cks.length - 1; i++) {
      const [t0, c0] = cks[i];
      const [t1, c1] = cks[i + 1];
      if (t >= t0 && t <= t1) {
        const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
        r = c0[0] + (c1[0] - c0[0]) * u;
        g = c0[1] + (c1[1] - c0[1]) * u;
        b = c0[2] + (c1[2] - c0[2]) * u;
        break;
      }
    }
  }
  outColor.setRGB(r, g, b, THREE.SRGBColorSpace);

  const aks = grad.alphaKeys || [[0, 1], [1, 1]];
  let a = 1;
  if (t <= aks[0][0]) {
    a = aks[0][1];
  } else if (t >= aks[aks.length - 1][0]) {
    a = aks[aks.length - 1][1];
  } else {
    for (let i = 0; i < aks.length - 1; i++) {
      const [t0, a0] = aks[i];
      const [t1, a1] = aks[i + 1];
      if (t >= t0 && t <= t1) {
        const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
        a = a0 + (a1 - a0) * u;
        break;
      }
    }
  }
  return a;
}

function sampleShapeSpawn(shape) {
  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3(0, 0, 1);
  if (!shape || !shape.enabled) return { pos, dir };

  const rad = shape.radius ?? 0.5;
  const arcRad = THREE.MathUtils.degToRad(shape.arc ?? 360);

  if (shape.type === 0 || shape.type === 2) {
    // Sphere (0) or Hemisphere (2) in local space (Z+ up)
    const theta = Math.random() * arcRad;
    const zMin = shape.type === 2 ? 0 : -1;
    const z = zMin + Math.random() * (1 - zMin);
    const rXY = Math.sqrt(Math.max(0, 1 - z * z));
    dir.set(rXY * Math.cos(theta), rXY * Math.sin(theta), z).normalize();
    const r = rad * Math.cbrt(Math.random());
    pos.copy(dir).multiplyScalar(r);
  } else if (shape.type === 4) {
    // Cone emitting along +Z
    const halfAngle = THREE.MathUtils.degToRad(shape.angle ?? 25);
    const phi = Math.random() * arcRad;
    const baseR = rad * Math.sqrt(Math.random());
    pos.set(baseR * Math.cos(phi), baseR * Math.sin(phi), 0);
    const tilt = halfAngle * Math.sqrt(Math.random());
    dir.set(Math.sin(tilt) * Math.cos(phi), Math.sin(tilt) * Math.sin(phi), Math.cos(tilt)).normalize();
  } else if (shape.type === 10) {
    // Circle in XY
    const phi = Math.random() * arcRad;
    const r = rad * Math.sqrt(Math.random());
    pos.set(r * Math.cos(phi), r * Math.sin(phi), 0);
    dir.set(Math.cos(phi), Math.sin(phi), 0).normalize();
  } else if (shape.type === 5) {
    // Box
    const sx = shape.scale?.[0] ?? 1;
    const sy = shape.scale?.[1] ?? 1;
    const sz = shape.scale?.[2] ?? 1;
    pos.set((Math.random() - 0.5) * sx, (Math.random() - 0.5) * sy, (Math.random() - 0.5) * sz);
    dir.set(0, 0, 1);
  }

  if (shape.randomDirectionAmount > 0) {
    const rnd = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    dir.lerp(rnd, shape.randomDirectionAmount).normalize();
  }
  return { pos, dir };
}

function spawnVfxParticle(em) {
  const slot = em.pool.find(p => !p.alive);
  if (!slot) return;
  const cfg = em.cfg;

  slot.alive = true;
  slot.age = 0;
  slot.life = Math.max(0.05, randRange(cfg.lifetime?.min ?? 0.5, cfg.lifetime?.max ?? 0.5));
  slot.sizeBase = randRange(cfg.startSize?.min ?? 1, cfg.startSize?.max ?? 1);
  slot.sizeRand = Math.random();
  slot.rotRand = Math.random();
  slot.rotZ = randRange(cfg.startRotation?.min ?? 0, cfg.startRotation?.max ?? 0);

  const { pos, dir } = sampleShapeSpawn(cfg.shape);
  slot.pos.copy(pos);
  const spd = randRange(cfg.startSpeed?.min ?? 0, cfg.startSpeed?.max ?? 0);
  slot.vel.copy(dir).multiplyScalar(spd);

  // Start color
  const sc = cfg.startColor;
  if (sc && sc.mode === 2) {
    const f = Math.random();
    slot.startRgb.setRGB(
      THREE.MathUtils.lerp(sc.colorMin[0], sc.colorMax[0], f),
      THREE.MathUtils.lerp(sc.colorMin[1], sc.colorMax[1], f),
      THREE.MathUtils.lerp(sc.colorMin[2], sc.colorMax[2], f),
      THREE.SRGBColorSpace,
    );
    slot.startAlpha = THREE.MathUtils.lerp(sc.colorMin[3], sc.colorMax[3], f);
  } else if (sc?.colorMax) {
    slot.startRgb.setRGB(sc.colorMax[0], sc.colorMax[1], sc.colorMax[2], THREE.SRGBColorSpace);
    slot.startAlpha = sc.colorMax[3] ?? 1;
  } else {
    slot.startRgb.setRGB(1, 1, 1);
    slot.startAlpha = 1;
  }

  slot.mesh.position.copy(slot.pos);
  slot.mesh.visible = true;
}

function resetEmitterTimers(em) {
  em.emTime = 0;
  em.spawnAcc = 0;
  em.burstStates = (em.cfg.bursts || []).map(b => ({
    ...b,
    fired: 0,
    nextTime: b.time || 0,
  }));
}

async function buildVfxSimulation(emitters, targetRoot) {
  for (const cfg of emitters) {
    const group = new THREE.Group();
    if (cfg.transform) {
      group.position.set(...(cfg.transform.position || [0, 0, 0]));
      group.quaternion.set(...(cfg.transform.quaternion || [0, 0, 0, 1]));
      group.scale.set(...(cfg.transform.scale || [1, 1, 1]));
    }
    targetRoot.add(group);

    const rd = cfg.renderer || {};
    const uv = cfg.uvAnimation;
    const subCols = uv?.tilesX || 1;
    const subRows = uv?.tilesY || 1;

    let tex = null;
    let ownedTexture = null;
    if (rd.textureUrl) {
      try {
        const baseTex = await loadTextureCached(rd.textureUrl);
        if (subCols > 1 || subRows > 1) {
          tex = baseTex.clone();
          tex.needsUpdate = true;
          tex.repeat.set(1 / subCols, 1 / subRows);
          ownedTexture = tex;
        } else {
          tex = baseTex;
        }
      } catch {
        tex = getProceduralTexture('glow');
      }
    } else if (rd.mode !== 4) {
      tex = getProceduralTexture('glow');
    }

    let meshTemplate = null;
    if (rd.mode === 4 && rd.meshKind === 'glb' && rd.meshUrl) {
      try {
        meshTemplate = await loadVfxMeshCached(rd.meshUrl);
      } catch {
        meshTemplate = null;
      }
    }

    const burstTotal = (cfg.bursts || []).reduce((acc, b) => acc + (b.maxCount || 1) * (b.cycles || 1), 0);
    const rateMax = cfg.rateOverTime?.max || 0;
    const ltMax = cfg.lifetime?.max || 1;
    const poolCap = Math.min(96, Math.max(4, Math.ceil(rateMax * ltMax * 1.4) + burstTotal + 2));

    const sharedGeo = meshTemplate ? null : new THREE.PlaneGeometry(1, 1);
    const isAdditive = rd.blend !== 'normal';
    const matTint = rd.tint
      ? new THREE.Color().setRGB(rd.tint[0], rd.tint[1], rd.tint[2], THREE.SRGBColorSpace)
      : new THREE.Color(1, 1, 1);
    const matAlpha = rd.tint?.[3] ?? 1;

    const pool = [];
    for (let i = 0; i < poolCap; i++) {
      let mesh;
      let mat = null;
      if (meshTemplate) {
        mesh = meshTemplate.clone();
        mesh.traverse(ch => {
          if (!ch.isMesh) return;
          const m = new THREE.MeshBasicMaterial({
            map: tex || null,
            color: matTint.clone(),
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: isAdditive ? THREE.AdditiveBlending : THREE.NormalBlending,
          });
          ch.material = m;
          mat = m;
        });
      } else {
        mat = new THREE.MeshBasicMaterial({
          map: tex,
          color: matTint.clone(),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: isAdditive ? THREE.AdditiveBlending : THREE.NormalBlending,
        });
        mesh = new THREE.Mesh(sharedGeo, mat);
      }
      mesh.visible = false;
      group.add(mesh);
      pool.push({
        alive: false,
        age: 0,
        life: 0.5,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        sizeBase: 1,
        sizeRand: 0.5,
        rotRand: 0.5,
        rotZ: 0,
        startRgb: new THREE.Color(1, 1, 1),
        startAlpha: 1,
        mesh,
        material: mat,
        isSharedGeo: !meshTemplate,
      });
    }

    const em = {
      cfg,
      group,
      pool,
      sharedGeo,
      ownedTexture,
      matTint,
      matAlpha,
      subCols,
      subRows,
      hasMeshTemplate: Boolean(meshTemplate),
      emTime: 0,
      spawnAcc: 0,
      burstStates: [],
    };
    resetEmitterTimers(em);
    simEmitters.push(em);

    // Fire t=0 bursts immediately
    stepEmitterEmission(em, 0);
  }
}

function stepEmitterEmission(em, dt) {
  const cfg = em.cfg;
  const delay = cfg.startDelay?.min || 0;
  em.emTime += dt * (cfg.simulationSpeed || 1);
  if (em.emTime < delay) return;
  const localT = em.emTime - delay;
  const dur = cfg.duration || 1.0;

  if (!cfg.looping && localT > dur + 0.001) return;
  const cycleT = cfg.looping ? (localT % dur) : localT;

  // Handle bursts
  for (const b of em.burstStates) {
    const maxCycles = b.cycles || 1;
    while (b.fired < maxCycles && localT >= b.nextTime - 1e-5) {
      const count = Math.round(randRange(b.minCount || 0, b.maxCount || 0));
      for (let i = 0; i < count; i++) spawnVfxParticle(em);
      b.fired += 1;
      b.nextTime += Math.max(0.01, b.interval || 0.01);
    }
  }

  // Handle rateOverTime
  const rate = cfg.rateOverTime?.max || 0;
  if (rate > 0) {
    em.spawnAcc += sampleMinMaxCurve(cfg.rateOverTime, Math.min(1, cycleT / dur), 0.5) * dt;
    while (em.spawnAcc >= 1) {
      em.spawnAcc -= 1;
      spawnVfxParticle(em);
    }
  }
}

const _tmpVec = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpInvQuat = new THREE.Quaternion();
const _tmpMat4 = new THREE.Matrix4();
const _axisX = new THREE.Vector3();
const _axisY = new THREE.Vector3();
const _axisZ = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _worldPos = new THREE.Vector3();
const _worldVel = new THREE.Vector3();
const _colGrad = new THREE.Color();
const _colWork = new THREE.Color();
const _eulerZ = new THREE.Euler(0, 0, 0, 'XYZ');

function tickVfxEmitters(dt, item) {
  const userTint = new THREE.Color(colorInput.value || '#ffffff');
  const useTintOverride = colorInput.value && colorInput.value.toLowerCase() !== '#ffffff';
  const simLooping = Boolean(item?.loop);

  let anyAlive = false;
  let anyActiveEmission = false;

  for (const em of simEmitters) {
    const cfg = em.cfg;
    const rd = cfg.renderer || {};
    stepEmitterEmission(em, dt);

    if (cfg.looping || em.emTime <= (cfg.startDelay?.min || 0) + (cfg.duration || 1)) {
      anyActiveEmission = true;
    }

    // World gravity transformed into emitter local space
    const gravMod = cfg.gravityModifier?.max || 0;
    if (gravMod !== 0) {
      _tmpInvQuat.copy(em.group.quaternion).invert();
      _tmpVec.set(0, -9.81 * gravMod, 0).applyQuaternion(_tmpInvQuat);
    }

    const totalSub = em.subCols * em.subRows;
    const worldQuat = em.group.getWorldQuaternion(_tmpQuat);
    const invWorldQuat = worldQuat.clone().invert();

    for (const p of em.pool) {
      if (!p.alive) continue;
      p.age += dt * (cfg.simulationSpeed || 1);
      if (p.age >= p.life) {
        p.alive = false;
        p.mesh.visible = false;
        continue;
      }
      anyAlive = true;
      const t = Math.min(1, p.age / p.life);

      // Forces / Gravity
      if (gravMod !== 0) {
        p.vel.addScaledVector(_tmpVec, dt);
      }
      if (cfg.forceOverLifetime) {
        const fx = sampleMinMaxCurve(cfg.forceOverLifetime.x, t, 0.5);
        const fy = sampleMinMaxCurve(cfg.forceOverLifetime.y, t, 0.5);
        const fz = -sampleMinMaxCurve(cfg.forceOverLifetime.z, t, 0.5);
        p.vel.x += fx * dt;
        p.vel.y += fy * dt;
        p.vel.z += fz * dt;
      }

      // Integrate velocity
      p.pos.addScaledVector(p.vel, dt);
      if (cfg.velocityOverLifetime) {
        const vx = sampleMinMaxCurve(cfg.velocityOverLifetime.x, t, 0.5);
        const vy = sampleMinMaxCurve(cfg.velocityOverLifetime.y, t, 0.5);
        const vz = -sampleMinMaxCurve(cfg.velocityOverLifetime.z, t, 0.5);
        p.pos.x += vx * dt;
        p.pos.y += vy * dt;
        p.pos.z += vz * dt;
      }
      p.mesh.position.copy(p.pos);

      // Rotation over lifetime (local Z spin around emitter Z)
      if (cfg.rotationOverLifetime?.z) {
        const rotRate = sampleMinMaxCurve(cfg.rotationOverLifetime.z, t, p.rotRand);
        p.rotZ += rotRate * dt;
      }

      // Size over lifetime
      let sx = p.sizeBase;
      let sy = p.sizeBase;
      let sz = p.sizeBase;
      if (cfg.sizeOverLifetime) {
        sx *= sampleMinMaxCurve(cfg.sizeOverLifetime.x, t, p.sizeRand);
        sy *= sampleMinMaxCurve(cfg.sizeOverLifetime.y, t, p.sizeRand);
        sz *= sampleMinMaxCurve(cfg.sizeOverLifetime.z, t, p.sizeRand);
      }

      if (em.hasMeshTemplate) {
        const gs = rd.meshGlobalScale || 1.0;
        p.mesh.scale.set(Math.max(0.005, sx * gs), Math.max(0.005, sy * gs), Math.max(0.005, sz * gs));
        p.mesh.rotation.set(0, 0, -p.rotZ);
      } else if (rd.mode === 4) {
        // Mesh Quad in emitter local XY plane
        p.mesh.scale.set(Math.max(0.005, sx), Math.max(0.005, sy), 1);
        p.mesh.rotation.set(0, 0, -p.rotZ);
      } else if (rd.mode === 1 && viewport?.camera) {
        // StretchedBillboard: align quad X along velocity in view plane
        _worldVel.copy(p.vel).applyQuaternion(worldQuat);
        const speed = _worldVel.length();
        if (speed > 1e-4) {
          p.mesh.getWorldPosition(_worldPos);
          _toCam.copy(viewport.camera.position).sub(_worldPos).normalize();
          _axisX.copy(_worldVel).normalize();
          _axisY.crossVectors(_toCam, _axisX);
          if (_axisY.lengthSq() < 1e-5) _axisY.set(0, 1, 0);
          _axisY.normalize();
          _axisZ.crossVectors(_axisX, _axisY).normalize();
          _tmpMat4.makeBasis(_axisX, _axisY, _axisZ);
          p.mesh.quaternion.setFromRotationMatrix(_tmpMat4).premultiply(invWorldQuat);
        } else {
          p.mesh.quaternion.copy(viewport.camera.quaternion).premultiply(invWorldQuat);
        }
        const stretchLen = sx * (rd.lengthScale ?? 1) + speed * (rd.velocityScale ?? 0) * 0.25;
        p.mesh.scale.set(Math.max(0.01, stretchLen), Math.max(0.01, sy), 1);
      } else if (viewport?.camera) {
        // Standard Billboard (mode 0) facing camera + local Z spin
        _eulerZ.set(0, 0, -p.rotZ);
        _tmpMat4.makeRotationFromEuler(_eulerZ);
        p.mesh.quaternion
          .copy(viewport.camera.quaternion)
          .premultiply(invWorldQuat)
          .multiply(new THREE.Quaternion().setFromRotationMatrix(_tmpMat4));
        p.mesh.scale.set(Math.max(0.005, sx), Math.max(0.005, sy), 1);
      }

      // Color = startColor * colorOverLifetime * matTint
      const lifeAlpha = cfg.colorOverLifetime ? sampleGradientColor(cfg.colorOverLifetime.gradient, t, _colGrad) : 1;
      if (!cfg.colorOverLifetime) _colGrad.setRGB(1, 1, 1);

      _colWork.copy(p.startRgb).multiply(_colGrad).multiply(em.matTint);
      if (useTintOverride) _colWork.lerp(userTint, 0.75);
      const finalAlpha = Math.max(0, Math.min(1, p.startAlpha * lifeAlpha * em.matAlpha));

      p.mesh.traverse?.(ch => {
        if (ch.material) {
          ch.material.color?.copy(_colWork);
          ch.material.opacity = finalAlpha;
        }
      });
      if (p.material) {
        p.material.color.copy(_colWork);
        p.material.opacity = finalAlpha;
        if (totalSub > 1 && p.material.map) {
          const cycles = cfg.uvAnimation?.cycles || 1;
          const u = (t * cycles) % 1;
          const frame = Math.min(totalSub - 1, Math.floor(u * totalSub));
          const col = frame % em.subCols;
          const row = Math.floor(frame / em.subCols);
          p.material.map.offset.set(col / em.subCols, 1 - (row + 1) / em.subRows);
        }
      }
    }
  }

  // Auto-replay one-shot bursts smoothly for preview inspection
  if (!simLooping && !anyAlive && !anyActiveEmission) {
    simLoopCooldown += dt;
    if (simLoopCooldown >= 0.45) {
      simLoopCooldown = 0;
      for (const em of simEmitters) {
        resetEmitterTimers(em);
        stepEmitterEmission(em, 0);
      }
      tickVfxEmitters(0.016, item);
    }
  }
}

function triggerHGamePreset(item) {
  if (!hgameVfx || !item?.hgamePreset) return;
  const p = item.hgamePreset;
  const tintHex = colorInput.value && colorInput.value !== '#ffffff'
    ? Number.parseInt(colorInput.value.slice(1), 16)
    : (p.colorInt ?? 0xfb923c);

  if (p.recipe === 'slash') {
    hgameVfx.slashArc({
      x: 0, y: 0.9, z: 0,
      yawRad: (simElapsed * 1.4) % (Math.PI * 2),
      sweepRad: 2.3,
      radius: 1.9,
      color: tintHex,
      duration: 0.28,
    });
  } else if (p.recipe === 'telegraph') {
    hgameVfx.spawnTelegraph({
      shape: 'ring',
      x: 0, y: 0.04, z: 0,
      radius: 1.65,
      innerRatio: 0.65,
      color: tintHex,
      duration: Math.max(0.8, p.durationMax || 1.0),
    });
  }

  hgameVfx.burstParticles({
    x: 0,
    y: p.recipe === 'telegraph' ? 0.2 : 0.9,
    z: 0,
    count: p.count || 20,
    color: tintHex,
    shape: p.shapeId ?? VFX_SHAPE.GLOW_ORB,
    speedMin: p.speedMin || 2.0,
    speedMax: p.speedMax || 6.5,
    sizeStart: p.sizeStart || 0.35,
    sizeEnd: p.sizeEnd || 0.05,
    durationMin: p.durationMin || 0.25,
    durationMax: p.durationMax || 0.65,
    gravity: p.gravity ?? 2.0,
    drag: p.drag ?? 2.2,
    stretch: p.shapeId === VFX_SHAPE.HIT_SPARK ? 1.1 : 0.35,
    additive: p.additive !== false,
  });
}

function replayActiveVfx() {
  const item = getCurrentItem();
  if (!item) return;
  if (item.isShurikenBench && hgameVfx && activeBenchRecipe) {
    hgameVfx.reset();
    benchReplayCooldown = 0;
    const playY = item.id.includes('shield') ? 1.0 : 0.2;
    activeBenchHandle = hgameVfx.playEffect(activeBenchRecipe, { x: 0, y: playY, z: 0 });
    hgameVfx.update(0.016);
    const st = hgameVfx.getStats();
    const s = st.shuriken || {};
    window.__HGAME_VFX_BENCH__ = {
      id: item.id,
      qualityTier: qualitySelect?.value || 'high',
      speed: Math.max(0.1, Number(speedSelect?.value || 1.0)),
      activeParticles: s.activeParticles ?? 0,
      activeDrawCalls: s.activeDrawCalls ?? 0,
      shaderVariants: st.shaderVariants ?? 0,
      simMs: 0,
      isActive: Boolean(activeBenchHandle?.isActive?.()),
    };
    return;
  }
  if (item.kind === 'system' && activeRenderMode === 'hgame') {
    triggerHGamePreset(item);
    hgameFireTimer = 0;
    return;
  }
  for (const em of simEmitters) {
    for (const p of em.pool) {
      p.alive = false;
      p.mesh.visible = false;
    }
    resetEmitterTimers(em);
    stepEmitterEmission(em, 0);
  }
  simLoopCooldown = 0;
  tickVfxEmitters(0.016, item);
}

function buildHGameSnippet(item) {
  const p = item?.hgamePreset || {};
  const colorLit = `0x${(p.color || '#fb923c').replace('#', '')}`;
  const shapeKey = Object.keys(VFX_SHAPE).find(k => VFX_SHAPE[k] === (p.shapeId ?? 0)) || 'GLOW_ORB';
  const lines = [
    `// 来源 Unreal VFX: ${item.assetName || item.id}`,
    `import { createVfxSystem, VFX_SHAPE } from '../vendor/hgame/index.js';`,
    ``,
    `const vfx = createVfxSystem({ mode: '3d', sceneOrAdapter: scene, THREE });`,
  ];
  if (p.recipe === 'slash') {
    lines.push(`vfx.slashArc({ x: 0, y: 0.9, z: 0, yawRad: 0, sweepRad: 2.3, radius: 1.9, color: ${colorLit}, duration: 0.28 });`);
  } else if (p.recipe === 'telegraph') {
    lines.push(`vfx.spawnTelegraph({ shape: 'ring', x: 0, y: 0.04, z: 0, radius: 1.65, innerRatio: 0.65, color: ${colorLit}, duration: ${(p.durationMax || 1.0).toFixed(2)} });`);
  }
  lines.push(
    `vfx.burstParticles({`,
    `  x: 0, y: 0.9, z: 0,`,
    `  count: ${p.count || 20},`,
    `  color: ${colorLit},`,
    `  shape: VFX_SHAPE.${shapeKey},`,
    `  speedMin: ${p.speedMin ?? 2.5}, speedMax: ${p.speedMax ?? 7.5},`,
    `  sizeStart: ${p.sizeStart ?? 0.35}, sizeEnd: ${p.sizeEnd ?? 0.05},`,
    `  durationMin: ${p.durationMin ?? 0.25}, durationMax: ${p.durationMax ?? 0.65},`,
    `  gravity: ${p.gravity ?? 0}, drag: ${p.drag ?? 2.2}, additive: ${p.additive !== false}`,
    `});`,
  );
  return lines.join('\n');
}

function tickVfx(dt) {
  const item = getCurrentItem();
  if (!item || !stageRoot || !isPlaying) return;

  simElapsed += dt;

  if (spinInput.checked) {
    stageRoot.rotation.y += dt * 0.65;
  }

  if (item.isShurikenBench && hgameVfx) {
    const t0 = performance.now();
    const speedMul = Math.max(0.1, Number(speedSelect?.value || 1.0));
    const simDt = dt * speedMul;
    hgameVfx.update(simDt);
    if (!activeBenchRecipe?.loop && activeBenchHandle && !activeBenchHandle.isActive()) {
      const curStats = hgameVfx.getStats();
      if ((curStats.shuriken?.activeParticles ?? 0) === 0) {
        benchReplayCooldown += dt;
        if (benchReplayCooldown >= 0.55) {
          replayActiveVfx();
        }
      }
    }
    const elapsedMs = performance.now() - t0;
    const st = hgameVfx.getStats();
    const s = st.shuriken || {};
    const qVal = qualitySelect?.value || 'high';
    window.__HGAME_VFX_BENCH__ = {
      id: item.id,
      qualityTier: qVal,
      speed: speedMul,
      activeParticles: s.activeParticles ?? 0,
      activeDrawCalls: benchLastDrawCalls || (s.activeDrawCalls ?? 0),
      shaderVariants: st.shaderVariants ?? 0,
      simMs: Number(elapsedMs.toFixed(3)),
      isActive: Boolean(activeBenchHandle?.isActive?.()),
    };
    benchFrameCount += 1;
    benchMsAccum += elapsedMs;
    if (benchFrameCount >= 12) {
      const avgMs = benchMsAccum / benchFrameCount;
      statusEl.textContent = `Piloto_Bench_8 (${qVal.toUpperCase()}) · 活跃粒子 ${s.activeParticles ?? 0} · DrawCalls ${benchLastDrawCalls} · 模拟 ${avgMs.toFixed(2)}ms · 着色变体 ${st.shaderVariants ?? 0}`;
      window.__HGAME_VFX_BENCH__.simMs = Number(avgMs.toFixed(3));
      benchFrameCount = 0;
      benchMsAccum = 0;
    }
    return;
  }

  if (item.kind === 'system') {
    if (activeRenderMode === 'hgame' && hgameVfx) {
      hgameVfx.update(dt);
      const interval = Math.max(0.45, Math.min(1.5, (item.duration || 0.7) * 0.85));
      hgameFireTimer += dt;
      if (hgameFireTimer >= interval) {
        hgameFireTimer = 0;
        triggerHGamePreset(item);
      }
      if (hgameMeshPreview) {
        hgameMeshPreview.rotation.y += dt * 1.1;
      }
    } else {
      tickVfxEmitters(dt, item);
    }
    return;
  }

  if (item.kind === 'texture') {
    if (activeTextureMode === 'emitter') {
      tickVfxEmitters(dt, item);
      return;
    }
    if (activeTexturePlane) {
      if (activeTextureMode === 'billboard' && viewport?.camera) {
        activeTexturePlane.quaternion.copy(viewport.camera.quaternion);
      } else if (activeTextureMode === 'ground') {
        activeTexturePlane.rotation.set(-Math.PI * 0.5, 0, simElapsed * 0.35);
      }
    }
    if (activeTexture) {
      const [cols, rows] = inferGridForItem(item);
      const total = getActiveFrameCount(item, cols, rows);
      if (total > 1) {
        const fps = Math.max(1, Math.min(60, Number(fpsInput.value) || 12));
        animTimer += dt;
        const stepDur = 1 / fps;
        if (animTimer >= stepDur) {
          const steps = Math.floor(animTimer / stepDur);
          animTimer -= steps * stepDur;
          currentFrame = (currentFrame + steps) % total;
          updateTextureUv(item);
        }
      }
    }
  }
}

async function loadCurrentVfx() {
  const item = getCurrentItem();
  if (!item) {
    clearStageRoot();
    emptyEl.hidden = false;
    titleEl.textContent = '特效';
    downloadEl.hidden = true;
    syncControlsVisibility(null);
    statusEl.textContent = '未检测到特效资源';
    return;
  }

  emptyEl.hidden = true;
  titleEl.textContent = item.name || item.id;

  if (item.kind === 'texture') {
    activeTextureMode = inferPlaneModeForItem(item);
  }
  syncControlsVisibility(item);

  if (item.url) {
    const fileName = item.url.split('/').pop() || `${item.id}.${item.kind === 'mesh' ? 'glb' : 'png'}`;
    downloadEl.href = item.url;
    downloadEl.download = fileName;
    downloadEl.textContent = `下载 ${fileName}`;
    downloadEl.hidden = false;
  } else if (item.hgamePreset?.meshUrl) {
    const fileName = item.hgamePreset.meshUrl.split('/').pop();
    downloadEl.href = item.hgamePreset.meshUrl;
    downloadEl.download = fileName;
    downloadEl.textContent = `网格 ${fileName}`;
    downloadEl.hidden = false;
  } else {
    downloadEl.hidden = true;
  }

  const vp = ensureViewport();
  if (!viewEl.hidden) {
    vp.resize();
    vp.start(tickVfx);
  }
  const token = ++loadToken;
  statusEl.textContent = `正在加载 ${item.name}...`;

  try {
    if (item.isShurikenBench) {
      clearStageRoot();
      stageRoot = new THREE.Group();
      vp.scene.add(stageRoot);
      if (vp.gridHelper) {
        vp.gridHelper.visible = gridToggle ? gridToggle.checked : true;
      }

      let recipe = benchRecipeCache.get(item.id);
      if (!recipe) {
        const res = await fetch(item.recipeUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        recipe = await res.json();
        benchRecipeCache.set(item.id, recipe);
      }
      if (token !== loadToken) return;

      const colorTexKeys = new Set();
      const dataTexKeys = new Set();
      const meshKeys = new Set();
      collectBenchDependencies(recipe, colorTexKeys, dataTexKeys, meshKeys);

      const loadTasks = [];
      const loadedTex = new Map();
      const loadedGeo = new Map();

      for (const k of new Set([...colorTexKeys, ...dataTexKeys])) {
        const rel = item.textureMap?.[k];
        if (!rel) continue;
        const texUrl = `${item.catalogBaseUrl}/${rel}`;
        const isSrgb = colorTexKeys.has(k);
        loadTasks.push(
          loadBenchTexture(texUrl, isSrgb).then(t => loadedTex.set(k, t)),
        );
      }
      for (const mk of meshKeys) {
        const rel = item.meshMap?.[mk];
        if (!rel) continue;
        const meshUrl = `${item.catalogBaseUrl}/${rel}`;
        loadTasks.push(
          loadBenchMeshGeo(meshUrl).then(g => { if (g) loadedGeo.set(mk, g); }),
        );
      }
      await Promise.all(loadTasks);
      if (token !== loadToken) return;

      hgameVfx = createVfxSystem({
        mode: '3d',
        sceneOrAdapter: vp.scene,
        THREE,
        maxParticles: 4096,
        maxFloatingGlyphs: 64,
      });
      for (const [k, tex] of loadedTex.entries()) {
        hgameVfx.registerTexture(k, tex);
      }
      for (const [mk, geo] of loadedGeo.entries()) {
        hgameVfx.registerMesh(mk, geo);
      }
      hgameVfx.setQualityTier(qualitySelect?.value || 'high');
      hgameVfx.registerEffect(recipe);
      activeBenchRecipe = recipe;
      const playY = item.id.includes('shield') ? 1.0 : 0.2;
      activeBenchHandle = hgameVfx.playEffect(recipe, { x: 0, y: playY, z: 0 });
      hgameVfx.update(0.016);

      const pipe = ensureHdrPipeline(vp);
      vp.setRenderOverride(() => pipe.render());
      vp.camera.position.set(4.5, 3.2, 6.2);
      vp.controls.target.set(0, playY + 0.5, 0);
      vp.controls.update();

      const st = hgameVfx.getStats();
      statusEl.textContent = `Piloto_Bench_8 · ${recipe.layers.length} 层 · 活跃粒子 ${st.shuriken?.activeParticles ?? 0} · 变体 ${st.shaderVariants ?? 0}`;
      window.__HGAME_VFX_BENCH__ = {
        id: item.id,
        qualityTier: qualitySelect?.value || 'high',
        speed: Number(speedSelect?.value || 1.0),
        activeParticles: st.shuriken?.activeParticles ?? 0,
        activeDrawCalls: st.shuriken?.activeDrawCalls ?? 0,
        shaderVariants: st.shaderVariants ?? 0,
        simMs: 0,
        isActive: Boolean(activeBenchHandle?.isActive?.()),
      };
    } else if (item.kind === 'system') {
      clearStageRoot();
      stageRoot = new THREE.Group();
      stageRoot.position.y = item.category === '法阵光环' ? 0.03 : 0.85;
      vp.scene.add(stageRoot);

      if (activeRenderMode === 'hgame') {
        hgameVfx = createVfxSystem({
          mode: '3d',
          sceneOrAdapter: vp.scene,
          THREE,
          maxParticles: 4096,
          maxFloatingGlyphs: 128,
        });
        if (item.hgamePreset?.meshUrl) {
          const tpl = await loadVfxMeshCached(item.hgamePreset.meshUrl);
          if (token !== loadToken) return;
          hgameMeshPreview = tpl.clone();
          hgameMeshPreview.position.y = item.category === '法阵光环' ? 0.04 : 0.9;
          hgameMeshPreview.rotation.x = -Math.PI * 0.5;
          hgameMeshPreview.scale.setScalar(item.category === '法阵光环' ? 2.5 : 4.2);
          const col = new THREE.Color(item.hgamePreset.color || '#ffffff');
          hgameMeshPreview.traverse(ch => {
            if (!ch.isMesh) return;
            ch.material = new THREE.MeshBasicMaterial({
              color: col,
              transparent: true,
              opacity: 0.7,
              depthWrite: false,
              side: THREE.DoubleSide,
              blending: THREE.AdditiveBlending,
            });
          });
          stageRoot.add(hgameMeshPreview);
        }
        triggerHGamePreset(item);
        vp.camera.position.set(3.2, 2.6, 4.2);
        vp.controls.target.set(0, item.category === '法阵光环' ? 0.1 : 0.8, 0);
        vp.controls.update();
        statusEl.textContent = `HGame 原生还原 (${item.hgamePreset?.recipe || 'burst'}) · 映射自 ${item.assetName}`;
      } else {
        await buildVfxSimulation(item.emitters || [], stageRoot);
        if (token !== loadToken) {
          clearStageRoot();
          return;
        }
        if (item.category === '法阵光环') {
          vp.camera.position.set(0, 3.8, 3.6);
          vp.controls.target.set(0, 0.05, 0);
        } else {
          vp.camera.position.set(3.4, 2.5, 4.2);
          vp.controls.target.set(0, 0.85, 0);
        }
        vp.controls.update();
        tickVfxEmitters(0.04, item);
        const meshCnt = (item.emitters || []).filter(e => e.renderer?.mode === 4).length;
        const texCnt = new Set((item.emitters || []).map(e => e.renderer?.textureUrl).filter(Boolean)).size;
        statusEl.textContent = `Unreal VFX · ${item.emitterCount || 0} 发射器 · ${meshCnt} 网格/面片层 · ${texCnt} 贴图`;
      }
    } else if (item.kind === 'mesh') {
      const gltf = await gltfLoader.loadAsync(item.url);
      if (token !== loadToken) {
        disposeObject3D(gltf.scene);
        return;
      }
      clearStageRoot();
      normalizeUnrealSceneMaterials(gltf.scene);
      let meshCount = 0;
      gltf.scene.traverse(child => {
        if (!child.isMesh) return;
        meshCount += 1;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          m.side = THREE.DoubleSide;
        }
      });
      stageRoot = new THREE.Group();
      stageRoot.add(gltf.scene);
      vp.scene.add(stageRoot);
      applyAppearanceToStage();
      vp.frameObject(stageRoot);
      statusEl.textContent = `Unreal 3D 特效网格 · ${meshCount} 网格 · ${formatBytes(item.bytes)}`;
    } else {
      const tex = await texLoader.loadAsync(item.url);
      if (token !== loadToken) {
        tex.dispose();
        return;
      }
      clearStageRoot();
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      activeTexture = tex;

      const [cols, rows] = inferGridForItem(item);
      const mode = inferPlaneModeForItem(item);
      activeTextureMode = mode;
      syncControlsVisibility(item);

      stageRoot = new THREE.Group();
      vp.scene.add(stageRoot);

      if (mode === 'emitter') {
        await buildVfxSimulation([{
          name: item.name,
          transform: { position: [0, 0.5, 0], quaternion: [0.70711, 0, 0, 0.70711], scale: [1, 1, 1] },
          duration: 1.0,
          simulationSpeed: 1.0,
          looping: true,
          startDelay: { min: 0, max: 0 },
          lifetime: { min: 0.55, max: 0.95 },
          startSpeed: { min: 0.8, max: 1.8 },
          startSize: { min: 0.5, max: 0.85 },
          startRotation: { min: 0, max: 6.283 },
          gravityModifier: { min: 0, max: 0 },
          startColor: { mode: 0, colorMax: [1, 1, 1, 1] },
          rateOverTime: { mode: 0, min: 14, max: 14 },
          bursts: [],
          shape: { enabled: true, type: 4, angle: 22, radius: 0.2, arc: 360 },
          uvAnimation: (cols > 1 || rows > 1) ? { tilesX: cols, tilesY: rows, cycles: 1 } : null,
          renderer: {
            mode: 0,
            blend: blendSelect.value === 'normal' ? 'normal' : 'additive',
            tint: [1, 1, 1, 1],
            textureUrl: item.url,
          },
        }], stageRoot);
        if (token !== loadToken) {
          clearStageRoot();
          return;
        }
        vp.camera.position.set(2.8, 2.0, 3.4);
        vp.controls.target.set(0, 1.0, 0);
        vp.controls.update();
        statusEl.textContent = `粒子喷射预览 · ${cols}×${rows} · ${item.name}`;
      } else {
        activeTextureMaterial = new THREE.MeshBasicMaterial({
          map: tex,
          color: new THREE.Color(colorInput.value || '#ffffff'),
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: blendSelect.value === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending,
        });

        const img = tex.image;
        const cellW = img ? img.width / cols : 1;
        const cellH = img ? img.height / rows : 1;
        const aspect = cellH > 0 ? Math.max(0.25, Math.min(3.2, cellW / cellH)) : 1;
        const planeH = 2.0;
        const planeW = planeH * aspect;
        const geo = new THREE.PlaneGeometry(planeW, planeH);
        const plane = new THREE.Mesh(geo, activeTextureMaterial);
        if (mode === 'ground') {
          plane.position.y = 0.04;
          plane.rotation.x = -Math.PI * 0.5;
          vp.camera.position.set(0, 3.2, 2.4);
          vp.controls.target.set(0, 0.05, 0);
        } else {
          plane.position.y = 1.05;
          plane.quaternion.copy(vp.camera.quaternion);
          vp.camera.position.set(0, 1.35, 3.2);
          vp.controls.target.set(0, 1.05, 0);
        }
        vp.controls.update();
        activeTexturePlane = plane;
        stageRoot.add(plane);
        updateTextureUv(item);

        const dim = img ? `${img.width}×${img.height}` : '';
        const activeTotal = getActiveFrameCount(item, cols, rows);
        const modeLabel = mode === 'ground' ? '贴地水平' : '朝向相机';
        const seqLabel = activeTotal > 1 ? `序列帧 ${cols}×${rows} (${activeTotal}帧)` : '单帧贴图';
        statusEl.textContent = `${modeLabel} · ${seqLabel}${dim ? ` · ${dim}` : ''} · ${formatBytes(item.bytes)}`;
      }
    }

    if (!viewEl.hidden) {
      vp.start(tickVfx);
      vp.resize();
    }
  } catch (error) {
    if (token !== loadToken) return;
    statusEl.textContent = error.message || '特效资源加载失败';
  }
}

async function initVfxView() {
  if (!initialized) {
    initialized = true;
    searchInput.addEventListener('input', renderList);
    typeFilter.addEventListener('change', () => {
      const filtered = getFilteredItems();
      if (filtered.length > 0 && !filtered.some(it => it.kind === activeSelection.kind && it.id === activeSelection.id)) {
        activeSelection = { kind: filtered[0].kind, id: filtered[0].id };
        applyItemDefaults(filtered[0]);
      }
      renderList();
      void loadCurrentVfx();
    });
    for (const tab of modeTabEls) {
      tab.addEventListener('click', () => {
        const nextMode = tab.dataset.hgameVfxMode || 'source';
        if (nextMode === activeRenderMode) return;
        activeRenderMode = nextMode;
        void loadCurrentVfx();
      });
    }
    copyCodeBtn?.addEventListener('click', async () => {
      const item = getCurrentItem();
      if (!item || item.kind !== 'system') return;
      const code = buildHGameSnippet(item);
      try {
        await navigator.clipboard.writeText(code);
        statusEl.textContent = `已复制 ${item.name} 的 HGame createVfxSystem 调用代码`;
      } catch {
        statusEl.textContent = '剪贴板不可用，请检查浏览器权限';
      }
    });
    playBtn.addEventListener('click', () => {
      isPlaying = !isPlaying;
      playBtn.textContent = isPlaying ? '暂停' : '播放';
    });
    replayBtn?.addEventListener('click', replayActiveVfx);
    qualitySelect?.addEventListener('change', () => {
      if (hgameVfx?.setQualityTier) {
        hgameVfx.setQualityTier(qualitySelect.value || 'high');
      }
    });
    gridToggle?.addEventListener('change', () => {
      if (viewport?.gridHelper) viewport.gridHelper.visible = gridToggle.checked;
    });
    bloomToggle?.addEventListener('change', () => {
      if (hdrPipeline?.bloomPass) hdrPipeline.bloomPass.enabled = bloomToggle.checked;
    });
    planeModeSelect?.addEventListener('change', () => {
      void loadCurrentVfx();
    });
    gridSelect.addEventListener('change', () => {
      currentFrame = 0;
      const item = getCurrentItem();
      if (item) {
        updateTextureUv(item);
        const [cols, rows] = inferGridForItem(item);
        statusEl.textContent = `${cols * rows > 1 ? `序列帧 ${cols}×${rows}` : '单帧'} · ${item.name}`;
      }
    });
    blendSelect.addEventListener('change', () => {
      if (activeTextureMode === 'emitter') void loadCurrentVfx();
      else applyAppearanceToStage();
    });
    colorInput.addEventListener('input', applyAppearanceToStage);
  }

  const vp = ensureViewport();
  if (!viewEl.hidden) {
    vp.resize();
    vp.start(tickVfx);
  }
  try {
    const [unrealRes, vfxBenchRes] = await Promise.all([
      fetchUnrealCatalog().catch(() => ({})),
      fetch('/api/hgame/vfx/catalog').then(r => (r.ok ? r.json() : { available: false })).catch(() => ({ available: false })),
    ]);
    const unrealCatalog = unrealRes || {};
    shurikenBenchSystems = (vfxBenchRes?.available && Array.isArray(vfxBenchRes.effects))
      ? vfxBenchRes.effects.map(ef => ({
          id: ef.id,
          name: ef.name,
          category: 'Piloto_Bench_8',
          group: 'Piloto_Bench_8',
          layerCount: ef.layerCount,
          duration: ef.duration,
          loop: ef.loop,
          isShurikenBench: true,
          recipeUrl: `${vfxBenchRes.baseUrl}/${ef.recipeFile}`,
          catalogBaseUrl: vfxBenchRes.baseUrl,
          textureMap: vfxBenchRes.textures || {},
          meshMap: vfxBenchRes.meshes || {},
          hgamePreset: { color: '#ff944d' },
        }))
      : [];
    vfxSystems = Array.isArray(unrealCatalog.vfxSystems) ? unrealCatalog.vfxSystems : [];
    vfxMeshes = Array.isArray(unrealCatalog.vfxMeshes) ? unrealCatalog.vfxMeshes : [];
    vfxTextures = Array.isArray(unrealCatalog.vfxTextures) ? unrealCatalog.vfxTextures : [];
  } catch (error) {
    shurikenBenchSystems = [];
    vfxSystems = [];
    vfxMeshes = [];
    vfxTextures = [];
    statusEl.textContent = error.message || '读取特效目录失败';
  }

  populateCategoryFilter();
  const initialItem = getCurrentItem() || getFilteredItems()[0] || null;
  if (initialItem) {
    activeSelection = { kind: initialItem.kind, id: initialItem.id };
    applyItemDefaults(initialItem);
  }
  renderList();
  ensureViewport();
  await loadCurrentVfx();
}

window.addEventListener('webasset:workspace-change', event => {
  if (event.detail?.workspace === 'vfx') {
    void initVfxView();
  } else {
    viewport?.stop();
  }
});

if (viewEl && !viewEl.hidden) {
  void initVfxView();
}
