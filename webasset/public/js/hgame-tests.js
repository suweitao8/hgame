import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {
  BucketedInstancedLodPool,
  buildBeveledBoxRaw,
  buildBufferGeometryFromRaw,
  CHINESE_LIGHTING_PRESETS,
  createAtmospherePipeline,
  createWorldPbrMaterial,
  ensurePbrGeometryAttributes,
  getQualityPreset,
  loadHdriEnvironment,
  PbrTextureArrayLoader,
} from './realistic-pcg.js';
import { apiRequestJson, disposeObject3D } from './hgame-shared.js';
import { createUnifiedLightingRig } from './unified-lighting.js';

const viewEl = document.querySelector('#tests-view');
const searchInput = document.querySelector('#hgame-test-search');
const listEl = document.querySelector('#hgame-test-list');
const titleEl = document.querySelector('#hgame-test-title');
const stageEl = document.querySelector('#hgame-test-stage');
const camTabs = [...document.querySelectorAll('.hgame-test-cam-tab')];
const resetCamBtn = document.querySelector('#hgame-test-reset-cam');
const viewpointSelect = document.querySelector('#hgame-test-viewpoint');
const lightingSelect = document.querySelector('#hgame-test-lighting');
const qualitySelect = document.querySelector('#hgame-test-quality');
const lodSelect = document.querySelector('#hgame-test-lod');
const wireframeInput = document.querySelector('#hgame-test-wireframe');
const collidersInput = document.querySelector('#hgame-test-colliders');
const statusEl = document.querySelector('#hgame-test-status');

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader();

const TEST_SCENES = [
  {
    id: 'cn_city_rural_showcase',
    name: '中国城乡双轨综合场景 (v4.1)',
    subtitle: 'Track A 地表 + Track B L1静态GLB合批 + 铰链门窗 + 远景天际线 + 4套中式光照',
    viewpoints: {
      overview: { label: '城乡全景', pos: [24, 16, 26], target: [0, 2.2, 0], walkPos: [0, 1.7, 9], walkYaw: Math.PI },
      crosswalk: { label: '城市路口与招牌', pos: [-9, 3.2, 12], target: [0, 2.2, -3], walkPos: [-4, 1.7, 5], walkYaw: Math.PI },
      shopfront: { label: '底商卷帘与防盗门', pos: [-4, 2.4, 2.5], target: [-6, 1.8, -5], walkPos: [-6, 1.7, -1], walkYaw: 0 },
      rooftop: { label: '老旧楼道与天台', pos: [11, 8.5, 6], target: [4, 4.5, -5], walkPos: [4, 4.8, -4], walkYaw: Math.PI },
      yard: { label: '乡村砖院与水泥路', pos: [16, 5.5, 16], target: [8, 1.5, 4], walkPos: [8, 1.7, 10], walkYaw: Math.PI * 0.7 },
    },
  },
  {
    id: 'cn_material_grid',
    name: '76层 2贴图 PBR 材质阵',
    subtitle: 'Color(sRGB+35%AO) + Normal_RM(Nx,Ny,R,M) 全槽位实时同屏对比',
    viewpoints: {
      overview: { label: '阵列全景', pos: [0, 15, 22], target: [0, 0.5, 0], walkPos: [0, 1.7, 12], walkYaw: Math.PI },
    },
  },
];

let initialized = false;
let activeSceneId = 'cn_city_rural_showcase';
let activeCamMode = 'orbit';
let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let atmosphere = null;
let resizeObserver = null;
let pbrLoader = null;
let texArray = null;
let cnCatalog = null;
let glbCache = new Map();
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
let animatedPivots = [];
let lodPool = null;
let lastLodSummary = { lodCounts: [0, 0, 0], culled: 0 };

const lightingRig = createUnifiedLightingRig();
const keysPressed = new Set();
let walkYaw = Math.PI;
let walkPitch = 0;
let walkDragging = false;
let walkLastX = 0;
let walkLastY = 0;

function resizeStage() {
  if (!renderer || !camera || !stageEl) return;
  const cw = Math.max(1, stageEl.clientWidth);
  const ch = Math.max(1, stageEl.clientHeight);
  renderer.setSize(cw, ch, false);
  camera.aspect = cw / ch;
  camera.updateProjectionMatrix();
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
  camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 450);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 1.5;
  controls.maxDistance = 180;

  atmosphere = createAtmospherePipeline(renderer, scene, {
    quality: qualitySelect?.value || 'HIGH',
    initialPreset: lightingSelect?.value || 'cn_cbd_day',
    sceneHalfExtent: 45,
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

function applySlotMaterialToObject(root, fallbackSlot, slotOverrideMap = null) {
  const registry = texArray.registry;
  const wire = Boolean(wireframeInput?.checked);
  worldMat.material.wireframe = wire;
  glassMat.material.wireframe = wire;

  root.traverse(obj => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    const srcMats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const resolveSlot = (m) => {
      const raw = m?.userData?.pbrSlot || fallbackSlot;
      return slotOverrideMap?.[raw] || raw;
    };
    const primarySlot = resolveSlot(srcMats[0]);
    const primaryLayer = registry.getLayer(primarySlot);
    ensurePbrGeometryAttributes(obj.geometry, primaryLayer, [1, 1, 1], 1.0);

    if (Array.isArray(obj.material) && obj.geometry.groups?.length) {
      const idAttr = obj.geometry.getAttribute('aMaterialId');
      const idxAttr = obj.geometry.getIndex();
      let hasGlass = false;
      obj.material = obj.geometry.groups.map(grp => {
        const slot = resolveSlot(srcMats[grp.materialIndex]);
        const lid = registry.getLayer(slot);
        const lmeta = registry.getMeta(slot);
        const end = grp.start + grp.count;
        for (let i = grp.start; i < end; i++) {
          const vi = idxAttr ? idxAttr.getX(i) : i;
          idAttr.setX(vi, lid);
        }
        if (lmeta.blendMode === 'translucent') {
          hasGlass = true;
          return glassMat.material;
        }
        return worldMat.material;
      });
      idAttr.needsUpdate = true;
      if (hasGlass) obj.renderOrder = 2;
    } else {
      const lmeta = registry.getMeta(primarySlot);
      if (lmeta.blendMode === 'translucent') {
        obj.material = glassMat.material;
        obj.renderOrder = 2;
      } else {
        obj.material = worldMat.material;
      }
    }
  });
}

function buildTrackATerrain() {
  const geo = new THREE.PlaneGeometry(80, 80, 32, 32);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const reg = texArray.registry;
  const lawnId = reg.getLayer('nature_lawn_grass');
  const plazaId = reg.getLayer('plaza_stone_slab');
  const dirtId = reg.getLayer('nature_farmland_wet');
  const count = pos.count;
  const matIds = new Float32Array(count);
  const tints = new Float32Array(count * 3);
  const aos = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    uv.setXY(i, x, z);
    // Urban plaza around -12..+4, rural farmland on +x > 10
    if (x > 10 && z > -10) {
      matIds[i] = dirtId;
    } else if (x < 6 && z < 6) {
      matIds[i] = plazaId;
    } else {
      matIds[i] = lawnId;
    }
    tints[i * 3] = 1;
    tints[i * 3 + 1] = 1;
    tints[i * 3 + 2] = 1;
    aos[i] = 1;
  }
  geo.setAttribute('aMaterialId', new THREE.BufferAttribute(matIds, 1));
  geo.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));
  geo.setAttribute('aGeomAO', new THREE.BufferAttribute(aos, 1));

  const mesh = new THREE.Mesh(geo, worldMat.material);
  mesh.position.y = -0.01;
  mesh.receiveShadow = true;
  return mesh;
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

async function buildCnCityRuralScene(group, colGroup, token) {
  await ensureExtraMaterials();
  if (token !== buildSeq) return;

  if (lodPool) lodPool.dispose();
  lodPool = new BucketedInstancedLodPool({ hysteresis: 1.12, moveTriggerMeters: 0.5, rotTriggerDeg: 3.0 });

  const modelMap = new Map((cnCatalog?.models || []).map(m => [m.id, m]));
  const extractLodGeometry = async (id, overrideMap = null) => {
    const entry = modelMap.get(id);
    const relPath = entry?.path || entry?.lods?.[0]?.path;
    if (!entry || !relPath) return null;
    const obj = await loadGlbCached(`/assets/cn/${relPath}`);
    if (token !== buildSeq) return null;
    applySlotMaterialToObject(obj, Object.values(entry.materialSlots || {})[0] || '__missing__', overrideMap);
    const lodGeos = [null, null, null];
    obj.traverse(c => {
      if (!c.isMesh) return;
      const n = c.name || '';
      const lvl = n === 'mesh_lod1' || n.endsWith('_lod1') ? 1 : n === 'mesh_lod2' || n.endsWith('_lod2') ? 2 : 0;
      if (!lodGeos[lvl]) lodGeos[lvl] = c.geometry;
    });
    return { entry, lodGeos };
  };

  const place = async (id, pos = [0, 0, 0], rotY = 0, overrides = null) => {
    const entry = modelMap.get(id);
    const relPath = entry?.path || entry?.lods?.[0]?.path;
    if (!entry || !relPath) return null;
    const obj = await loadGlbCached(`/assets/cn/${relPath}`);
    if (token !== buildSeq) return null;
    if (entry.materialMode === 'backdrop_atlas') {
      obj.traverse(c => { if (c.isMesh) c.material = backdropMat; });
    } else {
      applySlotMaterialToObject(obj, Object.values(entry.materialSlots || {})[0] || '__missing__', overrides);
      // Show only LOD0 on individual hero/pivot placements
      obj.traverse(c => {
        const n = c.name || '';
        if (n === 'mesh_lod1' || n.endsWith('_lod1') || n === 'mesh_lod2' || n.endsWith('_lod2')) {
          c.visible = false;
        }
      });
    }
    obj.position.set(...pos);
    obj.rotation.y = rotY;
    group.add(obj);

    if (entry.bounds?.size) {
      const [sx, sy, sz] = entry.bounds.size;
      const boxGeo = new THREE.BoxGeometry(sx, sy, sz);
      const edges = new THREE.EdgesGeometry(boxGeo);
      const wire = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x6ce57f }));
      wire.position.set(pos[0], pos[1] + sy * 0.5, pos[2]);
      wire.rotation.y = rotY;
      colGroup.add(wire);
    }
    return obj;
  };

  // Track A terrain ground
  group.add(buildTrackATerrain());

  // Track B Urban & Rural Road network
  await place('road_urban_2lane_cross', [0, 0, 0], 0);
  await place('road_urban_2lane_crosswalk', [-10, 0, 0], Math.PI / 2);
  await place('road_urban_2lane_straight', [0, 0, 10], 0);
  await place('road_rural_concrete_straight', [10, 0, 0], Math.PI / 2);
  await place('road_rural_dirt_transition', [20, 0, 0], Math.PI / 2);

  // Oldtown 2-story shopfront & apartment building (-6, 0, -6)
  await place('bldg_wall_shutter_4m', [-6, 0, -5], 0);
  await place('bldg_wall_door_2m', [-9, 0, -5], 0);
  await place('bldg_wall_window_2m', [-6, 3, -5], 0, { cn_exterior_tile_white: 'cn_exterior_tile_blue' });
  await place('bldg_wall_window_2m', [-9, 3, -5], 0, { cn_exterior_tile_white: 'cn_exterior_tile_blue' });
  await place('bldg_interior_wall_2m', [-6, 0, -8], 0);
  await place('bldg_floor_slab_4x4', [-7, 3, -7], 0);
  await place('bldg_roof_flat_4x4', [-7, 6, -7], 0);
  await place('bldg_stairs_double_3m', [-10, 0, -7], 0);
  await place('window_security_grille', [-6, 3.9, -4.85], 0);

  // Animated pivots: shop shutter, security door, garage boom
  const shutter = await place('door_shop_shutter', [-6, 0, -5], 0);
  const secDoor = await place('door_cn_security', [-9, 0, -5], 0);
  const boom = await place('barrier_garage_boom', [-3, 0, 5.2], 0);
  animatedPivots = [
    { root: shutter, node: 'pivot_shutter', mode: 'slide_y', amp: 1.6 },
    { root: secDoor, node: 'pivot_door', mode: 'rot_y', amp: 1.2 },
    { root: boom, node: 'pivot_boom', mode: 'rot_z', amp: 1.1 },
  ];

  // Bucketed Instanced LOD batches (street benches + rural brick fences -> max 2 draw calls per asset!)
  const fenceAsset = await extractLodGeometry('bldg_rural_brick_fence_2m');
  if (fenceAsset) {
    const fenceTransforms = [];
    for (let i = 0; i < 10; i++) {
      fenceTransforms.push({ pos: [12 + i * 2.0, 0, -5], rot: [0, 0, 0] });
    }
    lodPool.addLodGroup(group, {
      id: 'bldg_rural_brick_fence_2m',
      geometries: fenceAsset.lodGeos,
      material: worldMat.material,
      transforms: fenceTransforms,
      boundingSphereRadius: fenceAsset.entry.bounds?.boundingSphereRadius || 1.4,
      thresholds: [0.18, 0.05],
      cullRatio: 0.005,
    });
  }
  const benchAsset = await extractLodGeometry('base_stone_bollard_bench');
  if (benchAsset) {
    const benchTransforms = [];
    for (let i = 0; i < 16; i++) {
      benchTransforms.push({ pos: [-14 + i * 2.5, 0, 6.2], rot: [0, 0, 0] });
    }
    lodPool.addLodGroup(group, {
      id: 'base_stone_bollard_bench',
      geometries: benchAsset.lodGeos,
      material: worldMat.material,
      transforms: benchTransforms,
      boundingSphereRadius: benchAsset.entry.bounds?.boundingSphereRadius || 1.0,
      thresholds: [0.18, 0.05],
      cullRatio: 0.005,
    });
  }

  // Chinese shop sign board using cn_shop_signs_color + emissive
  const signGeo = new THREE.PlaneGeometry(3.4, 0.85);
  const uv = signGeo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) / 8, 0.75 + uv.getY(i) / 4);
  }
  const signMesh = new THREE.Mesh(signGeo, shopSignMat);
  signMesh.position.set(-6, 2.75, -4.82);
  group.add(signMesh);

  // Street props & Rural yard
  await place('base_bus_shelter_frame', [-4, 0, 4.5], 0);
  await place('base_parcel_locker', [-1, 0, -5], 0);
  await place('bldg_roof_pitched_slope_4m', [13, 3, -7], 0);
  await place('bldg_greenhouse_arch_4m', [15, 0, 7], 0);
  await place('wire_catenary_8m', [-6, 5.2, 4], 0);

  // Distant horizon skyline shells
  await place('backdrop_cbd_tower_a', [-38, 0, -52], 0);
  await place('backdrop_cbd_tower_b', [18, 0, -58], 0.2);
  await place('backdrop_oldtown_block_a', [-10, 0, -44], 0);

  lightingRig.setPointLights([
    { position: [-6, 2.7, -4.2], color: [1.0, 0.82, 0.45], radius: 9.0, intensity: 2.8 },
    { position: [-4, 2.4, 4.5], color: [0.6, 0.85, 1.0], radius: 8.5, intensity: 2.4 },
    { position: [13, 2.2, -4.5], color: [1.0, 0.65, 0.28], radius: 7.5, intensity: 2.0 },
  ]);
}

function buildMaterialGridScene(group) {
  const slots = texArray.registry.listSlots({ includeMissing: true });
  const cols = 9;
  const spacing = 2.2;
  animatedPivots = [];
  for (let i = 0; i < slots.length; i++) {
    const entry = slots[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = (col - (cols - 1) * 0.5) * spacing;
    const z = (row - (Math.ceil(slots.length / cols) - 1) * 0.5) * spacing;
    const raw = buildBeveledBoxRaw(1.5, 1.5, 1.5, 0, entry.layer);
    const geo = buildBufferGeometryFromRaw(raw);
    const mat = entry.blendMode === 'translucent'
      ? glassMat.material
      : entry.alphaCutout
        ? cutoutMat.material
        : worldMat.material;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0.75, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

function applyViewpoint(vpKey) {
  const def = TEST_SCENES.find(s => s.id === activeSceneId);
  const vp = def?.viewpoints?.[vpKey] || Object.values(def?.viewpoints || {})[0];
  if (!vp || !camera || !controls) return;
  if (activeCamMode === 'walk') {
    camera.position.set(...vp.walkPos);
    walkYaw = vp.walkYaw ?? Math.PI;
    walkPitch = 0;
  } else {
    camera.position.set(...vp.pos);
    controls.target.set(...vp.target);
    controls.update();
  }
}

function populateViewpoints() {
  if (!viewpointSelect) return;
  const def = TEST_SCENES.find(s => s.id === activeSceneId);
  const vps = def?.viewpoints || {};
  viewpointSelect.replaceChildren();
  for (const [key, vp] of Object.entries(vps)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = vp.label;
    viewpointSelect.append(opt);
  }
}

function renderSceneList() {
  if (!listEl) return;
  const q = (searchInput?.value || '').trim().toLowerCase();
  listEl.replaceChildren();
  for (const item of TEST_SCENES) {
    if (q && !item.name.toLowerCase().includes(q) && !item.subtitle.toLowerCase().includes(q)) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hgame-list-item';
    btn.setAttribute('aria-current', item.id === activeSceneId ? 'true' : 'false');
    const copy = document.createElement('span');
    copy.className = 'hgame-item-copy';
    const strong = document.createElement('strong');
    strong.textContent = item.name;
    const small = document.createElement('small');
    small.textContent = item.subtitle;
    copy.append(strong, small);
    btn.append(copy);
    btn.addEventListener('click', () => {
      activeSceneId = item.id;
      renderSceneList();
      populateViewpoints();
      rebuildActiveScene();
    });
    listEl.append(btn);
  }
}

async function rebuildActiveScene() {
  const token = ++buildSeq;
  ensureRenderer();
  const preset = getQualityPreset(qualitySelect?.value || 'HIGH');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap));
  renderer.shadowMap.enabled = !preset.disableShadows;

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

  const lightName = lightingSelect?.value || 'cn_cbd_day';
  atmosphere.setPreset(lightName);
  await syncHdri(lightName);
  if (backdropMat) backdropMat.emissiveIntensity = lightName === 'cn_horror_night' ? 2.2 : 0.35;
  if (shopSignMat) shopSignMat.emissiveIntensity = lightName === 'cn_horror_night' ? 2.4 : 0.45;

  if (sceneGroup) { scene.remove(sceneGroup); disposeObject3D(sceneGroup); }
  if (colliderGroup) { scene.remove(colliderGroup); disposeObject3D(colliderGroup); }
  sceneGroup = new THREE.Group();
  colliderGroup = new THREE.Group();
  colliderGroup.visible = Boolean(collidersInput?.checked);
  scene.add(sceneGroup, colliderGroup);

  const def = TEST_SCENES.find(s => s.id === activeSceneId);
  if (titleEl && def) titleEl.textContent = def.name;

  if (activeSceneId === 'cn_material_grid') {
    buildMaterialGridScene(sceneGroup);
  } else {
    await buildCnCityRuralScene(sceneGroup, colliderGroup, token);
  }
  if (token !== buildSeq) return;

  applyViewpoint(viewpointSelect?.value || 'overview');
  if (lodPool) {
    const qName = qualitySelect?.value || 'HIGH';
    const lodBias = qName === 'LOW' ? 1.5 : qName === 'LOWEST' ? 1.5 : qName === 'ORIGINAL' ? 0.75 : 1.0;
    const res = lodPool.update(camera, { lodBias, forcedLod: lodSelect?.value || 'auto', force: true });
    if (res) lastLodSummary = res;
  }
  renderer.render(scene, camera);
  const info = renderer.info.render;
  const lc = lastLodSummary.lodCounts;
  statusEl.textContent = `DrawCalls: ${info.calls} · 三角面: ${info.triangles.toLocaleString()} · LOD桶[L0:${lc[0]}/L1:${lc[1]}/L2:${lc[2]}] · 2贴图PBR ${texArray.tileSize}px (${texArray.layerCount}层)`;
}

function tick(now) {
  animFrameId = requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - (lastFrameTime || now)) / 1000);
  lastFrameTime = now;
  elapsedSec += dt;

  // Animate pivot_* nodes cleanly via transform matrices
  const wave = 0.5 - 0.5 * Math.cos(elapsedSec * 1.4);
  for (const p of animatedPivots) {
    if (!p.root) continue;
    const node = p.root.getObjectByName(p.node);
    if (!node) continue;
    if (p.mode === 'rot_y') node.rotation.y = wave * p.amp;
    else if (p.mode === 'rot_z') node.rotation.z = wave * p.amp;
    else if (p.mode === 'slide_y') node.position.y = wave * p.amp;
  }

  if (activeCamMode === 'walk' && camera) {
    const spd = 7 * dt;
    const fwd = new THREE.Vector3(-Math.sin(walkYaw), 0, -Math.cos(walkYaw));
    const right = new THREE.Vector3(Math.cos(walkYaw), 0, -Math.sin(walkYaw));
    if (keysPressed.has('KeyW')) camera.position.addScaledVector(fwd, spd);
    if (keysPressed.has('KeyS')) camera.position.addScaledVector(fwd, -spd);
    if (keysPressed.has('KeyD')) camera.position.addScaledVector(right, spd);
    if (keysPressed.has('KeyA')) camera.position.addScaledVector(right, -spd);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = walkYaw;
    camera.rotation.x = walkPitch;
  } else {
    controls?.update();
  }

  if (lodPool && camera) {
    const qName = qualitySelect?.value || 'HIGH';
    const lodBias = qName === 'LOW' || qName === 'LOWEST' ? 1.5 : qName === 'ORIGINAL' ? 0.75 : 1.0;
    const res = lodPool.update(camera, { lodBias, forcedLod: lodSelect?.value || 'auto' });
    if (res) lastLodSummary = res;
  }

  renderer?.render(scene, camera);
}

function init() {
  if (initialized) return;
  initialized = true;
  renderSceneList();
  populateViewpoints();

  searchInput?.addEventListener('input', renderSceneList);
  viewpointSelect?.addEventListener('change', () => applyViewpoint(viewpointSelect.value));
  resetCamBtn?.addEventListener('click', () => applyViewpoint(viewpointSelect?.value || 'overview'));
  lightingSelect?.addEventListener('change', () => rebuildActiveScene());
  qualitySelect?.addEventListener('change', () => rebuildActiveScene());
  lodSelect?.addEventListener('change', () => rebuildActiveScene());
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
      activeCamMode = tab.dataset.testCam || 'orbit';
      for (const t of camTabs) {
        const sel = t.dataset.testCam === activeCamMode;
        t.setAttribute('aria-selected', sel ? 'true' : 'false');
        t.tabIndex = sel ? 0 : -1;
      }
      if (controls) controls.enabled = activeCamMode === 'orbit';
      applyViewpoint(viewpointSelect?.value || 'overview');
    });
  }

  window.addEventListener('keydown', e => keysPressed.add(e.code));
  window.addEventListener('keyup', e => keysPressed.delete(e.code));
  stageEl?.addEventListener('pointerdown', e => {
    if (activeCamMode !== 'walk') return;
    walkDragging = true;
    walkLastX = e.clientX;
    walkLastY = e.clientY;
  });
  window.addEventListener('pointermove', e => {
    if (!walkDragging || activeCamMode !== 'walk') return;
    walkYaw -= (e.clientX - walkLastX) * 0.004;
    walkPitch = Math.max(-1.2, Math.min(1.2, walkPitch - (e.clientY - walkLastY) * 0.004));
    walkLastX = e.clientX;
    walkLastY = e.clientY;
  });
  window.addEventListener('pointerup', () => { walkDragging = false; });
}

function activateTestsWorkspace() {
  init();
  rebuildActiveScene().catch(err => { if (statusEl) statusEl.textContent = err.message; });
  if (!animFrameId) animFrameId = requestAnimationFrame(tick);
}

window.addEventListener('webasset:workspace-change', event => {
  if (event.detail?.workspace === 'tests') {
    activateTestsWorkspace();
  } else if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = 0;
  }
});

if (viewEl && !viewEl.hidden) {
  activateTestsWorkspace();
}
