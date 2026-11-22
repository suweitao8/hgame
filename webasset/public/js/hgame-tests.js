import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {
  CHINESE_LIGHTING_PRESETS,
  createAtmospherePipeline,
  createWorldPbrMaterial,
  getQualityPreset,
  loadHdriEnvironment,
  PbrTextureArrayLoader,
} from './realistic-pcg.js';
import { apiRequestJson, createSidebarSquareCard, disposeObject3D } from './hgame-shared.js';
import { createUnifiedLightingRig } from './unified-lighting.js';
import { createUnrealCameraRig } from './unreal-fly-controls.js';
import { buildCharacterShowcaseScene } from './test-scenes/character-showcase.js';
import { buildMaterialShowcaseScene } from './test-scenes/material-showcase.js';
import { applyForcedLodToModel, buildModelShowcaseScene } from './test-scenes/model-showcase.js';
import { buildDecalFoliageShowcaseScene } from './test-scenes/decal-foliage-showcase.js';
import { buildCityRuralShowcaseScene } from './test-scenes/city-rural-showcase.js';

const viewEl = document.querySelector('#tests-view');
const searchInput = document.querySelector('#hgame-test-search');
const listEl = document.querySelector('#hgame-test-list');
const titleEl = document.querySelector('#hgame-test-title');
const stageEl = document.querySelector('#hgame-test-stage');
const camTabs = [...document.querySelectorAll('.hgame-test-cam-tab')];
const lockCamBtn = document.querySelector('#hgame-test-lock-cam');
const resetCamBtn = document.querySelector('#hgame-test-reset-cam');
const viewpointSelect = document.querySelector('#hgame-test-viewpoint');
const lightingSelect = document.querySelector('#hgame-test-lighting');
const qualitySelect = document.querySelector('#hgame-test-quality');
const lodSelect = document.querySelector('#hgame-test-lod');
const wireframeInput = document.querySelector('#hgame-test-wireframe');
const collidersInput = document.querySelector('#hgame-test-colliders');
const statusEl = document.querySelector('#hgame-test-status');

const flyHudEl = document.querySelector('#hgame-test-fly-hud');
const flyHintEl = document.querySelector('#hgame-test-fly-hint');
const flySpeedEl = document.querySelector('#hgame-test-fly-speed');
const crosshairEl = document.querySelector('#hgame-test-crosshair');
const inspectorEl = document.querySelector('#hgame-test-inspector');
const inspectorTitleEl = document.querySelector('#hgame-inspector-title');
const inspectorSubEl = document.querySelector('#hgame-inspector-subtitle');
const inspectorMetaEl = document.querySelector('#hgame-inspector-meta');
const inspectorCloseBtn = document.querySelector('#hgame-inspector-close');
const inspectorFocusBtn = document.querySelector('#hgame-inspector-focus');
const inspectorOpenBtn = document.querySelector('#hgame-inspector-open');

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader();

const TEST_SCENES = [
  {
    id: 'cn_character_showcase',
    name: '预览-角色',
    thumb: '/previews/test_character.png',
    assetKind: 'characters',
  },
  {
    id: 'cn_material_showcase',
    name: '预览-材质',
    thumb: '/previews/test_material.png',
    assetKind: 'materials',
  },
  {
    id: 'cn_model_showcase',
    name: '预览-模型',
    thumb: '/previews/test_model.png',
    assetKind: 'models',
  },
  {
    id: 'cn_decal_foliage_showcase',
    name: '预览-贴花',
    thumb: '/previews/test_decal.png',
    assetKind: 'decals',
  },
  {
    id: 'cn_city_rural_showcase',
    name: '预览-场景',
    thumb: '/previews/test_city.png',
    assetKind: 'composite',
  },
];

let initialized = false;
let activeSceneId = 'cn_material_showcase';
let renderer = null;
let scene = null;
let camera = null;
let orbitControls = null;
let cameraRig = null;
let atmosphere = null;
let resizeObserver = null;
let pbrLoader = null;
let texArray = null;
let cnCatalog = null;
const glbCache = new Map();

let worldMat = null;
let cutoutMat = null;
let glassMat = null;
let backdropMat = null;
let shopSignMat = null;

let sceneGroup = null;
let colliderGroup = null;
let hdriEnv = null;
let activeHdriUrl = '';
let animFrameId = 0;
let lastFrameTime = 0;
let elapsedSec = 0;
let buildSeq = 0;

let activeViewpoints = {};
let activeExhibits = [];
let activeAnimatedPivots = [];
let activeMixers = [];
let activeLodPool = null;
let activeModelRoots = [];
let activeSceneDispose = null;
let activeSummaryText = '';
let selectedExhibit = null;
let lastLodSummary = { lodCounts: [0, 0, 0], culled: 0 };
const liveSceneThumbs = new Map();

const lightingRig = createUnifiedLightingRig();

function isWorkspaceActive() {
  return Boolean(viewEl && !viewEl.hidden);
}

function resizeStage() {
  if (!renderer || !camera || !stageEl) return;
  const cw = Math.max(1, stageEl.clientWidth);
  const ch = Math.max(1, stageEl.clientHeight);
  renderer.setSize(cw, ch, false);
  camera.aspect = cw / ch;
  camera.updateProjectionMatrix();
}

function updateCamTabsUi(mode) {
  for (const t of camTabs) {
    const sel = t.dataset.testCam === mode;
    t.setAttribute('aria-selected', sel ? 'true' : 'false');
    t.tabIndex = sel ? 0 : -1;
  }
  if (lockCamBtn) lockCamBtn.hidden = mode !== 'fly';
}

function updateHudUi(hud) {
  if (!flyHudEl || !hud) return;
  const isFly = hud.mode === 'fly';
  flyHudEl.hidden = false;
  if (flyHintEl) {
    if (hud.hoveredExhibit) {
      flyHintEl.textContent = `悬停: ${hud.hoveredExhibit.title} · 左键拾取 / F 聚焦`;
    } else if (isFly) {
      flyHintEl.textContent = hud.pointerLocked
        ? '准星锁定中 · WASD 飞行 · Q/E 升降 · Shift 加速 · 滚轮调速 · Esc 退出'
        : '右键+WASD 飞行 · Q/E 升降 · Shift 加速 · 滚轮调速 · F 聚焦 · 左键拾取';
    } else {
      flyHintEl.textContent = '轨道视角 · 左键旋转 · 右键平移 · 滚轮缩放 · 左键点击展品';
    }
  }
  if (flySpeedEl) {
    const p = hud.position;
    const coords = p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})` : '';
    flySpeedEl.textContent = isFly
      ? `${hud.flySpeed.toFixed(1)}${hud.sprinting ? '×3' : ''} m/s ${coords}`
      : `Orbit ${coords}`;
  }
  if (crosshairEl) crosshairEl.hidden = !hud.pointerLocked;
}

function renderInspector(exhibit) {
  selectedExhibit = exhibit || null;
  if (!inspectorEl) return;
  if (!exhibit) {
    inspectorEl.hidden = true;
    return;
  }
  inspectorEl.hidden = false;
  if (inspectorTitleEl) inspectorTitleEl.textContent = exhibit.title || exhibit.id || '';
  if (inspectorSubEl) inspectorSubEl.textContent = exhibit.subtitle || '';
  if (inspectorMetaEl) {
    inspectorMetaEl.replaceChildren();
    for (const [k, v] of Object.entries(exhibit.meta || {})) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = String(v);
      inspectorMetaEl.append(dt, dd);
    }
  }
  if (inspectorOpenBtn) {
    inspectorOpenBtn.hidden = !exhibit.workspace;
  }
}

function ensureRenderer() {
  if (renderer) return;
  const w = Math.max(320, stageEl.clientWidth || 960);
  const h = Math.max(240, stageEl.clientHeight || 560);
  const preset = getQualityPreset(qualitySelect?.value || 'HIGH');

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap));
  renderer.setSize(w, h, false);
  stageEl.replaceChildren(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(52, w / h, 0.08, 600);

  orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.08;
  orbitControls.maxPolarAngle = Math.PI * 0.495;
  orbitControls.minDistance = 0.8;
  orbitControls.maxDistance = 260;

  cameraRig = createUnrealCameraRig({
    camera,
    domElement: renderer.domElement,
    orbitControls,
    isActive: isWorkspaceActive,
    onModeChange: (mode) => updateCamTabsUi(mode),
    onHudUpdate: (hud) => updateHudUi(hud),
    onSelectExhibit: (ex) => renderInspector(ex),
    onHotbarViewpoint: (idx) => {
      if (!viewpointSelect) return;
      const opt = viewpointSelect.options[idx];
      if (!opt) return;
      viewpointSelect.value = opt.value;
      applyViewpoint(opt.value);
    },
  });
  updateCamTabsUi(cameraRig.mode);

  atmosphere = createAtmospherePipeline(renderer, scene, {
    quality: qualitySelect?.value || 'HIGH',
    initialPreset: lightingSelect?.value || 'cn_cbd_day',
    sceneHalfExtent: 65,
  });

  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(resizeStage);
    resizeObserver.observe(stageEl);
  }
}

async function syncHdri(presetName) {
  const preset = CHINESE_LIGHTING_PRESETS[presetName] || CHINESE_LIGHTING_PRESETS.cn_cbd_day;
  if (activeHdriUrl === preset.hdri) return;
  activeHdriUrl = preset.hdri;
  try {
    const nextEnv = await loadHdriEnvironment({ url: preset.hdri, renderer, scene });
    if (hdriEnv) hdriEnv.dispose();
    hdriEnv = nextEnv;
  } catch { /* non-fatal */ }
}

async function loadGlbCached(url) {
  if (!glbCache.has(url)) {
    const gltf = await gltfLoader.loadAsync(url);
    glbCache.set(url, gltf);
  }
  return glbCache.get(url).scene.clone(true);
}

async function ensureExtraMaterials() {
  if (!backdropMat) {
    const [colTex, emTex] = await Promise.all([
      texLoader.loadAsync('/assets/cn/decals/cn_backdrop_windows_color.png'),
      texLoader.loadAsync('/assets/cn/decals/cn_backdrop_windows_emissive.png'),
    ]);
    colTex.colorSpace = THREE.SRGBColorSpace;
    emTex.colorSpace = THREE.SRGBColorSpace;
    backdropMat = new THREE.MeshStandardMaterial({
      map: colTex,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: emTex,
      emissiveIntensity: 1.4,
      roughness: 0.55,
      metalness: 0.25,
    });
  }
  if (!shopSignMat) {
    const [colTex, emTex] = await Promise.all([
      texLoader.loadAsync('/assets/cn/decals/cn_shop_signs_color.png'),
      texLoader.loadAsync('/assets/cn/decals/cn_shop_signs_emissive.png'),
    ]);
    colTex.colorSpace = THREE.SRGBColorSpace;
    emTex.colorSpace = THREE.SRGBColorSpace;
    shopSignMat = new THREE.MeshStandardMaterial({
      map: colTex,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: emTex,
      emissiveIntensity: 1.5,
      roughness: 0.4,
    });
  }
}

function populateViewpoints(viewpoints = {}) {
  activeViewpoints = viewpoints;
  if (!viewpointSelect) return;
  const prev = viewpointSelect.value;
  viewpointSelect.replaceChildren();
  for (const [key, vp] of Object.entries(viewpoints)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = vp.label;
    viewpointSelect.append(opt);
  }
  if (prev && Object.hasOwn(viewpoints, prev)) {
    viewpointSelect.value = prev;
  }
}

function applyViewpoint(vpKey) {
  const vp = activeViewpoints[vpKey] || Object.values(activeViewpoints)[0];
  if (!vp || !cameraRig) return;
  cameraRig.setPose(vp.pos, vp.target);
}

function renderSceneList() {
  if (!listEl) return;
  const q = (searchInput?.value || '').trim().toLowerCase();
  listEl.replaceChildren();
  for (const item of TEST_SCENES) {
    if (q && !item.name.toLowerCase().includes(q) && !item.id.toLowerCase().includes(q)) continue;
    const { button } = createSidebarSquareCard({
      name: item.name,
      thumbUrl: liveSceneThumbs.get(item.id) || item.thumb,
      badge: item.name.replace(/^预览[- ]?/, ''),
      active: item.id === activeSceneId,
      onClick: () => {
        activeSceneId = item.id;
        renderSceneList();
        void rebuildActiveScene();
      },
    });
    listEl.append(button);
  }
}

function updateStatusBar() {
  if (!renderer || !statusEl || !texArray) return;
  const info = renderer.info.render;
  const parts = [
    activeSummaryText,
    `DrawCalls: ${info.calls}`,
    `三角面: ${info.triangles.toLocaleString()}`,
  ];
  if (activeLodPool) {
    const lc = lastLodSummary.lodCounts;
    parts.push(`LOD桶[L0:${lc[0]}/L1:${lc[1]}/L2:${lc[2]}]`);
  }
  parts.push(`2贴图PBR ${texArray.tileSize}px (${texArray.layerCount}层)`);
  statusEl.textContent = parts.filter(Boolean).join(' · ');
}

async function rebuildActiveScene() {
  const token = ++buildSeq;
  ensureRenderer();
  const preset = getQualityPreset(qualitySelect?.value || 'HIGH');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap));
  renderer.shadowMap.enabled = !preset.disableShadows;

  if (statusEl) statusEl.textContent = '正在加载场景资产…';

  if (!pbrLoader) pbrLoader = new PbrTextureArrayLoader({ baseUrl: '/assets/cn/materials' });
  if (!texArray || texArray.tileSize !== preset.textureRes) {
    if (texArray) texArray.dispose();
    texArray = await pbrLoader.load({ renderer, resolution: preset.textureRes });
  }
  if (token !== buildSeq) return;

  if (!cnCatalog) {
    cnCatalog = await apiRequestJson('/api/hgame/cn/catalog');
  }
  if (token !== buildSeq) return;

  if (worldMat) worldMat.dispose();
  if (cutoutMat) cutoutMat.dispose();
  if (glassMat) glassMat.dispose();
  worldMat = createWorldPbrMaterial({
    textureArrays: texArray,
    registry: texArray.registry,
    fastShader: preset.fastShader,
    disableMicroDetail: preset.disableMicroDetail,
    lightingRig,
  });
  cutoutMat = createWorldPbrMaterial({
    textureArrays: texArray,
    registry: texArray.registry,
    alphaCutout: true,
    fastShader: preset.fastShader,
    disableMicroDetail: preset.disableMicroDetail,
    lightingRig,
  });
  glassMat = createWorldPbrMaterial({
    textureArrays: texArray,
    registry: texArray.registry,
    translucent: true,
    fastShader: preset.fastShader,
    lightingRig,
  });

  const wire = Boolean(wireframeInput?.checked);
  worldMat.material.wireframe = wire;
  cutoutMat.material.wireframe = wire;
  glassMat.material.wireframe = wire;

  const lightName = lightingSelect?.value || 'cn_cbd_day';
  atmosphere.setPreset(lightName);
  await syncHdri(lightName);
  if (token !== buildSeq) return;

  if (activeSceneDispose) {
    try { activeSceneDispose(); } catch { /* ignore */ }
    activeSceneDispose = null;
  }
  if (sceneGroup) { scene.remove(sceneGroup); disposeObject3D(sceneGroup); }
  if (colliderGroup) { scene.remove(colliderGroup); disposeObject3D(colliderGroup); }
  sceneGroup = new THREE.Group();
  colliderGroup = new THREE.Group();
  colliderGroup.visible = Boolean(collidersInput?.checked);
  scene.add(sceneGroup, colliderGroup);

  activeExhibits = [];
  activeAnimatedPivots = [];
  activeMixers = [];
  activeLodPool = null;
  activeModelRoots = [];
  activeSummaryText = '';
  lightingRig.setPointLights([]);
  renderInspector(null);

  const def = TEST_SCENES.find(s => s.id === activeSceneId);
  if (titleEl && def) titleEl.textContent = def.name;

  let result;
  if (activeSceneId === 'cn_character_showcase') {
    result = await buildCharacterShowcaseScene({
      group: sceneGroup,
      gltfLoader,
      token,
      getToken: () => buildSeq,
    });
  } else if (activeSceneId === 'cn_material_showcase') {
    result = buildMaterialShowcaseScene({
      group: sceneGroup,
      texArray,
      worldMat,
      cutoutMat,
      glassMat,
    });
  } else if (activeSceneId === 'cn_model_showcase') {
    await ensureExtraMaterials();
    if (token !== buildSeq) return;
    if (backdropMat) backdropMat.emissiveIntensity = lightName === 'cn_horror_night' ? 2.2 : 0.35;
    result = await buildModelShowcaseScene({
      group: sceneGroup,
      colliderGroup,
      cnCatalog,
      texArray,
      worldMat,
      cutoutMat,
      glassMat,
      backdropMat,
      wireframe: wire,
      lodMode: lodSelect?.value || 'auto',
      loadGlbCached,
      token,
      getToken: () => buildSeq,
    });
  } else if (activeSceneId === 'cn_decal_foliage_showcase') {
    result = await buildDecalFoliageShowcaseScene({
      group: sceneGroup,
      renderer,
      texArray,
      worldMat,
      token,
      getToken: () => buildSeq,
    });
  } else {
    await ensureExtraMaterials();
    if (token !== buildSeq) return;
    if (backdropMat) backdropMat.emissiveIntensity = lightName === 'cn_horror_night' ? 2.2 : 0.35;
    if (shopSignMat) shopSignMat.emissiveIntensity = lightName === 'cn_horror_night' ? 2.4 : 0.45;
    result = await buildCityRuralShowcaseScene({
      group: sceneGroup,
      colliderGroup,
      cnCatalog,
      texArray,
      worldMat,
      cutoutMat,
      glassMat,
      backdropMat,
      shopSignMat,
      lightingRig,
      wireframe: wire,
      loadGlbCached,
      token,
      getToken: () => buildSeq,
    });
  }
  if (token !== buildSeq || !result) return;

  activeExhibits = result.exhibits || [];
  activeAnimatedPivots = result.animatedPivots || [];
  activeMixers = result.mixers || [];
  activeLodPool = result.lodPool || null;
  activeModelRoots = result.modelRoots || [];
  activeSceneDispose = result.dispose || null;
  activeSummaryText = result.summaryText || '';

  populateViewpoints(result.viewpoints || {});
  const initialVp = result.viewpoints?.overview || Object.values(result.viewpoints || {})[0];
  if (initialVp) {
    cameraRig.setDefaultFocus(initialVp.pos, initialVp.target);
    cameraRig.setPose(initialVp.pos, initialVp.target);
  }
  cameraRig.setExhibits(activeExhibits);

  if (activeLodPool) {
    const qName = qualitySelect?.value || 'HIGH';
    const lodBias = qName === 'LOW' || qName === 'LOWEST' ? 1.5 : qName === 'ORIGINAL' ? 0.75 : 1.0;
    const res = activeLodPool.update(camera, { lodBias, forcedLod: lodSelect?.value || 'auto', force: true });
    if (res) lastLodSummary = res;
  }

  renderer.render(scene, camera);
  updateStatusBar();
}

function tick(now) {
  animFrameId = requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - (lastFrameTime || now)) / 1000);
  lastFrameTime = now;
  elapsedSec += dt;

  const wave = 0.5 - 0.5 * Math.cos(elapsedSec * 1.4);
  for (const p of activeAnimatedPivots) {
    if (!p.root) continue;
    const node = p.root.getObjectByName(p.node);
    if (!node) continue;
    if (p.mode === 'rot_y') node.rotation.y = wave * p.amp;
    else if (p.mode === 'rot_z') node.rotation.z = wave * p.amp;
    else if (p.mode === 'slide_y') node.position.y = wave * p.amp;
  }

  for (const m of activeMixers) {
    m.update(dt);
  }

  cameraRig?.update(dt);

  if (activeLodPool && camera) {
    const qName = qualitySelect?.value || 'HIGH';
    const lodBias = qName === 'LOW' || qName === 'LOWEST' ? 1.5 : qName === 'ORIGINAL' ? 0.75 : 1.0;
    const res = activeLodPool.update(camera, { lodBias, forcedLod: lodSelect?.value || 'auto' });
    if (res) lastLodSummary = res;
  }

  renderer?.render(scene, camera);
}

function openSelectedInWorkspace() {
  if (!selectedExhibit?.workspace) return;
  const { workspace, id, kind } = selectedExhibit;
  const navTab = document.querySelector(`[data-workspace="${workspace}"]`);
  navTab?.click();
  window.dispatchEvent(new CustomEvent('webasset:open-asset', {
    detail: { workspace, id, kind },
  }));
}

function init() {
  if (initialized) return;
  initialized = true;
  renderSceneList();

  searchInput?.addEventListener('input', renderSceneList);
  viewpointSelect?.addEventListener('change', () => applyViewpoint(viewpointSelect.value));
  resetCamBtn?.addEventListener('click', () => applyViewpoint(viewpointSelect?.value || 'overview'));
  lockCamBtn?.addEventListener('click', () => cameraRig?.togglePointerLock());
  lightingSelect?.addEventListener('change', () => rebuildActiveScene());
  qualitySelect?.addEventListener('change', () => rebuildActiveScene());
  lodSelect?.addEventListener('change', () => {
    const lodVal = lodSelect.value || 'auto';
    if (activeModelRoots.length) {
      for (const root of activeModelRoots) applyForcedLodToModel(root, lodVal);
      updateStatusBar();
    } else if (activeLodPool && camera) {
      const res = activeLodPool.update(camera, { forcedLod: lodVal, force: true });
      if (res) lastLodSummary = res;
      updateStatusBar();
    }
  });
  wireframeInput?.addEventListener('change', () => {
    const w = Boolean(wireframeInput.checked);
    if (worldMat) worldMat.material.wireframe = w;
    if (cutoutMat) cutoutMat.material.wireframe = w;
    if (glassMat) glassMat.material.wireframe = w;
  });
  collidersInput?.addEventListener('change', () => {
    if (colliderGroup) colliderGroup.visible = Boolean(collidersInput.checked);
  });

  for (const tab of camTabs) {
    tab.addEventListener('click', () => {
      const next = tab.dataset.testCam || 'fly';
      cameraRig?.setMode(next, { preservePose: true });
    });
  }

  inspectorCloseBtn?.addEventListener('click', () => {
    cameraRig?.selectExhibit(null);
  });
  inspectorFocusBtn?.addEventListener('click', () => {
    if (selectedExhibit) cameraRig?.focusExhibit(selectedExhibit);
  });
  inspectorOpenBtn?.addEventListener('click', openSelectedInWorkspace);
}

function activateTestsWorkspace() {
  init();
  rebuildActiveScene().catch(err => {
    if (statusEl) statusEl.textContent = err.message;
  });
  if (!animFrameId) animFrameId = requestAnimationFrame(tick);
}

window.addEventListener('webasset:workspace-change', event => {
  if (event.detail?.workspace === 'tests') {
    activateTestsWorkspace();
  } else {
    if (document.pointerLockElement) document.exitPointerLock?.();
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = 0;
    }
  }
});

if (viewEl && !viewEl.hidden) {
  activateTestsWorkspace();
}
