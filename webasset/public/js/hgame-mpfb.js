import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSidebarSquareCard, fetchAnim23Catalog } from './hgame-shared.js';
import { retargetUnrealClips } from './hgame-retarget.js';

const mpfbView = document.querySelector('#mpfb-view');
const listEl = document.querySelector('#mpfb-list');
const searchInput = document.querySelector('#mpfb-search');
const titleEl = document.querySelector('#mpfb-title');
const metricsEl = document.querySelector('#mpfb-metrics');
const emptyEl = document.querySelector('#mpfb-empty');
const stageEl = document.querySelector('#mpfb-stage');
const lodSelect = document.querySelector('#mpfb-lod');
const animSelect = document.querySelector('#mpfb-anim');
const wireframeCheck = document.querySelector('#mpfb-wireframe');
const gridCheck = document.querySelector('#mpfb-grid');

let characters = [];
let activeCharId = null;
let loadedOnce = false;
let animCatalog = null;

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let gridHelper = null;
let activeGroup = null;
let mixer = null;
let activeAction = null;
let animClock = new THREE.Clock();
let rafId = 0;

const gltfLoader = new GLTFLoader();
const animClipCache = new Map();

function ensureRenderer() {
  if (renderer || !stageEl) return;
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  stageEl.replaceChildren(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x161b22);

  const hemi = new THREE.HemisphereLight(0xf2f6ff, 0x2b313c, 1.35);
  const key = new THREE.DirectionalLight(0xfff4e0, 2.2);
  key.position.set(2.4, 4.2, 3.2);
  const rim = new THREE.DirectionalLight(0x9fc2ff, 0.85);
  rim.position.set(-2.5, 2.6, -2.8);
  scene.add(hemi, key, rim);

  gridHelper = new THREE.GridHelper(6, 12, 0x3b4656, 0x242a34);
  gridHelper.visible = Boolean(gridCheck?.checked ?? true);
  scene.add(gridHelper);

  camera = new THREE.PerspectiveCamera(36, 1, 0.05, 80);
  camera.position.set(0, 1.25, 3.1);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.9, 0);
  controls.update();

  const resize = () => {
    if (!renderer || !stageEl) return;
    const w = Math.max(320, stageEl.clientWidth || 640);
    const h = Math.max(240, stageEl.clientHeight || 480);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(stageEl);
  resize();

  const tick = () => {
    rafId = requestAnimationFrame(tick);
    if (!mpfbView || mpfbView.hidden) return;
    const dt = Math.min(0.05, animClock.getDelta());
    if (mixer && activeAction) mixer.update(dt);
    controls?.update();
    renderer.render(scene, camera);
  };
  tick();
}

function applyLodAndWireframe() {
  if (!activeGroup) return;
  const targetLod = lodSelect?.value || 'lod0';
  const wire = Boolean(wireframeCheck?.checked);

  activeGroup.traverse((obj) => {
    if (!obj.isMesh) return;
    const lv = obj.userData?.lodLevel;
    let isTier = 'lod0';
    if (lv === 1 || /lod1/i.test(obj.name)) isTier = 'lod1';
    else if (lv === 2 || /lod2/i.test(obj.name)) isTier = 'lod2';
    else if (lv === 3 || /lod3/i.test(obj.name)) isTier = 'lod3';

    obj.visible = isTier === targetLod;
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        m.wireframe = wire;
        if (isTier === 'lod3' && m.map) {
          const cols = obj.userData?.impostorCols || 8;
          const rows = obj.userData?.impostorRows || 8;
          m.map.repeat.set(1 / cols, 1 / rows);
          m.map.offset.set(0, (rows - 1) / rows);
          m.transparent = false;
          m.alphaTest = 0.45;
          m.needsUpdate = true;
        }
      }
    }
  });

  const item = characters.find((c) => c.charId === activeCharId);
  if (item && metricsEl) {
    const tri = item.tris?.[targetLod] ?? '—';
    metricsEl.textContent = `${targetLod.toUpperCase()} · ${tri} tris · ${item.boneCount || 23} bones · ${item.heightM || 1.7}m`;
  }
}

async function applyAnimMode() {
  if (!activeGroup) return;
  const mode = animSelect?.value || 'rest';
  if (mixer) {
    mixer.stopAllAction();
    mixer = null;
    activeAction = null;
  }
  if (mode === 'rest') return;

  if (!animCatalog) {
    animCatalog = await fetchAnim23Catalog();
  }
  const list = animCatalog?.animations || [];
  if (!list.length) return;
  const pattern = mode === 'run' ? /A_INP_RunFwd_Loop|RunFwd|Run/i : /Idle/i;
  const entry = list.find((a) => pattern.test(a.url || a.name || a.id || '')) || list[0];
  if (!entry?.url) return;

  let animGltf = animClipCache.get(entry.url);
  if (!animGltf) {
    animGltf = await gltfLoader.loadAsync(entry.url);
    animClipCache.set(entry.url, animGltf);
  }
  const clips = retargetUnrealClips(
    { ...entry, clips: animGltf.animations, animations: animGltf.animations, scene: animGltf.scene },
    activeGroup,
    { stripRootMotion: true },
  );
  if (clips.length > 0) {
    mixer = new THREE.AnimationMixer(activeGroup);
    activeAction = mixer.clipAction(clips[0]);
    activeAction.play();
  }
}

async function selectCharacter(charId) {
  const item = characters.find((c) => c.charId === charId);
  if (!item) return;
  activeCharId = item.charId;
  renderSidebar();

  if (titleEl) titleEl.textContent = `${item.name} (${item.charId})`;
  if (emptyEl) emptyEl.hidden = true;
  if (stageEl) stageEl.hidden = false;
  ensureRenderer();

  if (activeGroup && scene) {
    scene.remove(activeGroup);
    activeGroup = null;
  }
  if (mixer) {
    mixer.stopAllAction();
    mixer = null;
    activeAction = null;
  }

  const gltf = await gltfLoader.loadAsync(item.modelUrl);
  if (activeCharId !== item.charId) return;
  activeGroup = gltf.scene;
  scene.add(activeGroup);

  controls.target.set(0, (item.heightM || 1.7) * 0.52, 0);
  camera.position.set(0, (item.heightM || 1.7) * 0.65, 2.9);
  controls.update();

  applyLodAndWireframe();
  await applyAnimMode();
}

function renderSidebar() {
  if (!listEl) return;
  const q = (searchInput?.value || '').trim().toLowerCase();
  const visible = q
    ? characters.filter((c) => `${c.name} ${c.charId} ${c.scope}`.toLowerCase().includes(q))
    : characters;
  listEl.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('span');
    empty.className = 'game-list-empty';
    empty.textContent = characters.length ? '无匹配角色' : '暂无 MPFB 角色';
    listEl.append(empty);
    return;
  }
  for (const c of visible) {
    const { button } = createSidebarSquareCard({
      name: c.name || c.charId,
      badge: `${c.tris?.lod0 || 0}`,
      active: c.charId === activeCharId,
      onClick: () => {
        void selectCharacter(c.charId);
      },
    });
    listEl.append(button);
  }
}

async function loadCharacters() {
  loadedOnce = true;
  try {
    const res = await fetch('/api/mpfb/characters', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    characters = data.characters || [];
  } catch {
    characters = [];
  }
  renderSidebar();
  if (characters.length > 0) {
    await selectCharacter(activeCharId || characters[0].charId);
  } else {
    if (emptyEl) emptyEl.hidden = false;
    if (stageEl) stageEl.hidden = true;
  }
}

searchInput?.addEventListener('input', renderSidebar);
lodSelect?.addEventListener('change', applyLodAndWireframe);
wireframeCheck?.addEventListener('change', applyLodAndWireframe);
gridCheck?.addEventListener('change', () => {
  if (gridHelper) gridHelper.visible = Boolean(gridCheck.checked);
});
animSelect?.addEventListener('change', () => {
  void applyAnimMode();
});

window.addEventListener('webasset:workspace-change', (ev) => {
  if (ev.detail?.workspace === 'mpfb' && !loadedOnce) {
    void loadCharacters();
  }
});
if (location.hash === '#mpfb') {
  void loadCharacters();
}
