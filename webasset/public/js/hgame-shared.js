import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let cachedAssets = null;
let cachedUnrealCatalog = null;
let pendingUnrealCatalog = null;
let cachedUnityCatalog = null;
let pendingUnityCatalog = null;
const assetListeners = new Set();

export async function fetchHGameAssets(force = false) {
  if (!force && cachedAssets) return cachedAssets;
  const response = await fetch('/api/hgame/assets');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
  cachedAssets = data;
  return data;
}

export async function fetchUnrealCatalog(force = false) {
  if (!force && cachedUnrealCatalog) return cachedUnrealCatalog;
  if (!force && pendingUnrealCatalog) return pendingUnrealCatalog;
  pendingUnrealCatalog = (async () => {
    try {
      const response = await fetch('/api/hgame/unreal/catalog');
      const data = await response.json().catch(() => ({ available: false, characters: [], animations: [], staticModels: [], vfxSystems: [], vfxMeshes: [], vfxTextures: [], materials: [], decals: [], audio: [] }));
      if (!response.ok) return { available: false, characters: [], animations: [], staticModels: [], vfxSystems: [], vfxMeshes: [], vfxTextures: [], materials: [], decals: [], audio: [] };
      cachedUnrealCatalog = {
        available: Boolean(data.available),
        generatedAt: data.generatedAt || null,
        characters: Array.isArray(data.characters) ? data.characters : [],
        animations: Array.isArray(data.animations) ? data.animations : [],
        staticModels: Array.isArray(data.staticModels) ? data.staticModels : [],
        vfxSystems: Array.isArray(data.vfxSystems) ? data.vfxSystems : [],
        vfxMeshes: Array.isArray(data.vfxMeshes) ? data.vfxMeshes : [],
        vfxTextures: Array.isArray(data.vfxTextures) ? data.vfxTextures : [],
        materials: Array.isArray(data.materials) ? data.materials : [],
        decals: Array.isArray(data.decals) ? data.decals : [],
        audio: Array.isArray(data.audio) ? data.audio : [],
      };
      return cachedUnrealCatalog;
    } catch {
      return { available: false, characters: [], animations: [], staticModels: [], vfxSystems: [], vfxMeshes: [], vfxTextures: [], materials: [], decals: [], audio: [] };
    } finally {
      pendingUnrealCatalog = null;
    }
  })();
  return pendingUnrealCatalog;
}

export async function fetchUnityCatalog(force = false) {
  if (!force && cachedUnityCatalog) return cachedUnityCatalog;
  if (!force && pendingUnityCatalog) return pendingUnityCatalog;
  pendingUnityCatalog = (async () => {
    const empty = { available: false, vfxSystems: [], vfxMeshes: [], vfxTextures: [] };
    try {
      const response = await fetch('/api/hgame/unity/catalog');
      const data = await response.json().catch(() => empty);
      if (!response.ok) return empty;
      cachedUnityCatalog = {
        available: Boolean(data.available),
        sourceEngine: data.sourceEngine || 'unity',
        vfxSystems: Array.isArray(data.vfxSystems) ? data.vfxSystems : [],
        vfxMeshes: Array.isArray(data.vfxMeshes) ? data.vfxMeshes : [],
        vfxTextures: Array.isArray(data.vfxTextures) ? data.vfxTextures : [],
      };
      return cachedUnityCatalog;
    } catch {
      return empty;
    } finally {
      pendingUnityCatalog = null;
    }
  })();
  return pendingUnityCatalog;
}

export function onHGameAssetsChanged(listener) {
  assetListeners.add(listener);
  return () => assetListeners.delete(listener);
}

export async function refreshHGameAssets() {
  const data = await fetchHGameAssets(true);
  for (const listener of assetListeners) {
    try { listener(data); } catch { /* ignore listener errors */ }
  }
  return data;
}

export async function apiRequestJson(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `操作失败（HTTP ${response.status}）`);
  return data;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function normalizeUnrealSceneMaterials(root) {
  if (!root) return;
  root.traverse?.(node => {
    if (!node.isMesh || !node.geometry?.attributes?.color) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    const allHaveMap = mats.length > 0 && mats.every(mat => Boolean(mat?.map));
    if (!allHaveMap) return;
    node.geometry.deleteAttribute('color');
    for (const mat of mats) {
      if (mat.vertexColors) {
        mat.vertexColors = false;
        mat.needsUpdate = true;
      }
    }
  });
}

export function disposeObject3D(root) {
  if (!root) return;
  root.traverse?.(node => {
    node.geometry?.dispose?.();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose?.();
      }
      material.dispose?.();
    }
  });
}

export function createThreeViewport(container, { background = 0x161c15, grid = true, shadows = false } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);

  const hemi = new THREE.HemisphereLight(0xf4f8ff, 0x3b4837, 1.8);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xfff6e5, 2.5);
  keyLight.position.set(5, 9, 7);
  if (shadows) {
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 40;
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 8;
    keyLight.shadow.camera.bottom = -8;
    keyLight.shadow.bias = -0.0005;
  }
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x9fc2ff, 0.9);
  fillLight.position.set(-5, 4, -5);
  scene.add(fillLight);

  const gridHelper = new THREE.GridHelper(12, 12, 0x5c7252, 0x2c3629);
  gridHelper.visible = Boolean(grid);
  scene.add(gridHelper);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 500);
  camera.position.set(3.2, 2.2, 3.8);

  const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, powerPreference: 'default' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  if (shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  container.replaceChildren(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.8, 0);
  controls.update();

  function resize() {
    const width = Math.max(1, container.clientWidth || 640);
    const height = Math.max(1, container.clientHeight || 420);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  resize();

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  let inView = true;
  let intersectionObserver = null;
  if ('IntersectionObserver' in window) {
    intersectionObserver = new IntersectionObserver(entries => {
      inView = entries.some(entry => entry.isIntersecting);
    });
    intersectionObserver.observe(container);
  }

  let rafId = 0;
  let running = false;
  let lastTime = performance.now();
  let onTick = null;

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    if (document.hidden || !inView) return;
    onTick?.(dt, now / 1000);
    controls.update();
    renderer.render(scene, camera);
  }

  return {
    THREE,
    scene,
    camera,
    renderer,
    controls,
    gridHelper,
    resize,
    frameObject(object) {
      const bounds = new THREE.Box3().setFromObject(object);
      const center = bounds.isEmpty() ? new THREE.Vector3(0, 0.5, 0) : bounds.getCenter(new THREE.Vector3());
      const size = Math.max(bounds.isEmpty() ? 1 : bounds.getSize(new THREE.Vector3()).length(), 0.2);
      camera.near = Math.max(size / 5000, 0.01);
      camera.far = Math.max(size * 80, 100);
      camera.updateProjectionMatrix();
      camera.position.copy(center).add(new THREE.Vector3(size * 0.9, size * 0.45, size * 1.25));
      controls.target.copy(center);
      controls.minDistance = size * 0.2;
      controls.maxDistance = size * 12;
      controls.update();
    },
    start(callback) {
      onTick = callback || null;
      if (running) return;
      running = true;
      lastTime = performance.now();
      resize();
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },
    dispose() {
      this.stop();
      resizeObserver.disconnect();
      intersectionObserver?.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      container.replaceChildren();
    },
  };
}

export function drawUvWireframe(canvas, mesh, statusEl) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#171e18';
  ctx.fillRect(0, 0, width, height);
  const boxSize = Math.min(width - 40, height - 40);
  const x = (width - boxSize) / 2;
  const y = (height - boxSize) / 2;
  ctx.fillStyle = '#263127';
  ctx.fillRect(x, y, boxSize, boxSize);
  if (!mesh?.geometry?.attributes?.uv) return;

  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const image = material?.map?.image;
  if (image) {
    try { ctx.drawImage(image, x, y, boxSize, boxSize); } catch { /* ignore */ }
  }

  const uv = mesh.geometry.getAttribute('uv');
  const index = mesh.geometry.index;
  const count = index ? index.count : uv.count;
  const max = Math.min(count - (count % 3), 300000);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, boxSize, boxSize);
  ctx.clip();
  ctx.strokeStyle = '#d6f59b';
  ctx.lineWidth = 1;
  for (let i = 0; i < max; i += 3) {
    ctx.beginPath();
    for (let j = 0; j < 3; j++) {
      const vertex = index ? index.getX(i + j) : i + j;
      const u = uv.getX(vertex);
      const v = uv.getY(vertex);
      if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
      const px = x + u * boxSize;
      const py = y + v * boxSize;
      if (j === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = '#9eb794';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, boxSize, boxSize);
  if (statusEl) {
    statusEl.textContent = `UV：${mesh.name || '未命名网格'} · ${Math.floor(max / 3).toLocaleString()} 个三角面`;
  }
}

export function getTransparentMaterialIds(loader) {
  const ids = new Set();
  if (!loader) return ids;
  for (const name of loader.listMaterialIds()) {
    const meta = loader.getMaterialMeta?.(name);
    if (meta?.alphaCutout === true) {
      ids.add(loader.getMaterialId(name));
    }
  }
  return ids;
}

export function getTranslucentMaterialIds(loader) {
  const ids = new Set();
  if (!loader) return ids;
  for (const name of loader.listMaterialIds()) {
    const meta = loader.getMaterialMeta?.(name);
    if (meta?.blendMode === 'translucent') {
      ids.add(loader.getMaterialId(name));
    }
  }
  return ids;
}

export function splitGeometryByRenderPass(geometry, cutoutIds, translucentIds) {
  if (!geometry) return { opaque: null, transparent: null, translucent: null };
  const matAttr = geometry.getAttribute('aMaterialId');
  const idxAttr = geometry.getIndex();
  const posAttr = geometry.getAttribute('position');
  if (!matAttr || !posAttr) return { opaque: geometry, transparent: null, translucent: null };
  const hasCutout = cutoutIds && cutoutIds.size > 0;
  const hasTrans = translucentIds && translucentIds.size > 0;
  if (!hasCutout && !hasTrans) return { opaque: geometry, transparent: null, translucent: null };

  const count = idxAttr ? idxAttr.count : posAttr.count;
  const opaqueIdx = [];
  const cutoutIdx = [];
  const transIdx = [];
  for (let i = 0; i < count; i += 3) {
    const v0 = idxAttr ? idxAttr.getX(i) : i;
    const v1 = idxAttr ? idxAttr.getX(i + 1) : i + 1;
    const v2 = idxAttr ? idxAttr.getX(i + 2) : i + 2;
    const mId = Math.round(matAttr.getX(v0));
    if (hasTrans && translucentIds.has(mId)) {
      transIdx.push(v0, v1, v2);
    } else if (hasCutout && cutoutIds.has(mId)) {
      cutoutIdx.push(v0, v1, v2);
    } else {
      opaqueIdx.push(v0, v1, v2);
    }
  }

  const nonEmptyCount = (opaqueIdx.length > 0 ? 1 : 0) + (cutoutIdx.length > 0 ? 1 : 0) + (transIdx.length > 0 ? 1 : 0);
  if (nonEmptyCount <= 1) {
    if (cutoutIdx.length > 0) return { opaque: null, transparent: geometry, translucent: null };
    if (transIdx.length > 0) return { opaque: null, transparent: null, translucent: geometry };
    return { opaque: geometry, transparent: null, translucent: null };
  }

  const buildSub = indices => {
    if (!indices.length) return null;
    const sub = geometry.clone();
    sub.setIndex(indices);
    return sub;
  };
  return {
    opaque: buildSub(opaqueIdx),
    transparent: buildSub(cutoutIdx),
    translucent: buildSub(transIdx),
  };
}

export function splitGeometryByTransparent(geometry, transparentIds) {
  if (!geometry || !transparentIds || transparentIds.size === 0) {
    return { opaque: geometry, transparent: null };
  }
  const matAttr = geometry.getAttribute('aMaterialId');
  const idxAttr = geometry.getIndex();
  const posAttr = geometry.getAttribute('position');
  if (!matAttr || !posAttr) return { opaque: geometry, transparent: null };

  const count = idxAttr ? idxAttr.count : posAttr.count;
  const opaqueIdx = [];
  const transIdx = [];
  for (let i = 0; i < count; i += 3) {
    const v0 = idxAttr ? idxAttr.getX(i) : i;
    const v1 = idxAttr ? idxAttr.getX(i + 1) : i + 1;
    const v2 = idxAttr ? idxAttr.getX(i + 2) : i + 2;
    const mId = Math.round(matAttr.getX(v0));
    if (transparentIds.has(mId)) {
      transIdx.push(v0, v1, v2);
    } else {
      opaqueIdx.push(v0, v1, v2);
    }
  }

  if (transIdx.length === 0) return { opaque: geometry, transparent: null };
  if (opaqueIdx.length === 0) return { opaque: null, transparent: geometry };

  const buildSub = indices => {
    const sub = geometry.clone();
    sub.setIndex(indices);
    return sub;
  };
  return {
    opaque: buildSub(opaqueIdx),
    transparent: buildSub(transIdx),
  };
}
