import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let cachedAssets = null;
let cachedUnrealCatalog = null;
let pendingUnrealCatalog = null;
let cachedAnim23Catalog = null;
let pendingAnim23Catalog = null;
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

export async function fetchAnim23Catalog(force = false) {
  if (!force && cachedAnim23Catalog) return cachedAnim23Catalog;
  if (!force && pendingAnim23Catalog) return pendingAnim23Catalog;
  pendingAnim23Catalog = (async () => {
    const empty = { available: false, rig: 'humanoid_23', animations: [] };
    try {
      const response = await fetch('/api/hgame/anim23/catalog');
      const data = await response.json().catch(() => empty);
      if (!response.ok || !data.available) return empty;
      cachedAnim23Catalog = {
        available: Boolean(data.available),
        version: data.version || 3,
        rig: data.rig || 'humanoid_23',
        generatedAt: data.generatedAt || null,
        animations: Array.isArray(data.animations) ? data.animations : [],
      };
      return cachedAnim23Catalog;
    } catch {
      return empty;
    } finally {
      pendingAnim23Catalog = null;
    }
  })();
  return pendingAnim23Catalog;
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

let sharedDecodeGl = null;
let sharedDecodeFbo = null;
const single2MapCache = new Map();
const MAX_2MAP_CACHE = 16;

function ensureDecodeGl() {
  if (sharedDecodeGl) return sharedDecodeGl;
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) {
    throw new Error('需要 WebGL2 以无损读取非预乘 normal_rm.png');
  }
  sharedDecodeFbo = gl.createFramebuffer();
  sharedDecodeGl = gl;
  return sharedDecodeGl;
}

/**
 * Decode a PNG into top-down straight RGBA bytes without Canvas2D premultiplication
 * so A=0 non-metal pixels preserve intact RGB normal and roughness values.
 */
export async function decodeStraightRgba(url) {
  const resp = await fetch(url, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  const width = bmp.width;
  const height = bmp.height;
  try {
    const gl = ensureDecodeGl();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sharedDecodeFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const data = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteTexture(tex);
    return { width, height, data };
  } finally {
    bmp.close?.();
  }
}

export async function loadHtmlImage(url) {
  const resp = await fetch(url, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  const blob = await resp.blob();
  const objUrl = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error(`图像解码失败: ${url}`));
      img.src = objUrl;
    });
    return img;
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

export async function loadSingle2MapAssets(baseUrl, id) {
  const key = `${baseUrl}/${id}`;
  if (single2MapCache.has(key)) {
    const cached = single2MapCache.get(key);
    single2MapCache.delete(key);
    single2MapCache.set(key, cached);
    return cached;
  }
  const t0 = performance.now();
  const [colorImg, normRm] = await Promise.all([
    loadHtmlImage(`${key}/color.png`),
    decodeStraightRgba(`${key}/normal_rm.png`),
  ]);
  const result = { colorImg, normRm, loadMs: performance.now() - t0 };
  single2MapCache.set(key, result);
  while (single2MapCache.size > MAX_2MAP_CACHE) {
    const oldest = single2MapCache.keys().next().value;
    single2MapCache.delete(oldest);
  }
  return result;
}

function fitPreviewRect(width, height, boxSize = 128) {
  const aspect = Math.max(0.05, width / Math.max(1, height));
  const drawW = aspect >= 1 ? boxSize : Math.max(1, Math.round(boxSize * aspect));
  const drawH = aspect >= 1 ? Math.max(1, Math.round(boxSize / aspect)) : boxSize;
  return {
    drawW,
    drawH,
    offX: Math.floor((boxSize - drawW) / 2),
    offY: Math.floor((boxSize - drawH) / 2),
  };
}

function fillCheckerboard(ctx, size) {
  const step = 8;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const even = ((x / step) + (y / step)) % 2 === 0;
      ctx.fillStyle = even ? '#212922' : '#181f19';
      ctx.fillRect(x, y, step, step);
    }
  }
}

export function drawImageFittedToCanvas(canvas, img) {
  if (!canvas || !img) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width || 128;
  const h = canvas.height || 128;
  ctx.clearRect(0, 0, w, h);
  fillCheckerboard(ctx, w);
  const rect = fitPreviewRect(img.naturalWidth || img.width || 1, img.naturalHeight || img.height || 1, w);
  ctx.drawImage(img, rect.offX, rect.offY, rect.drawW, rect.drawH);
}

/**
 * Draw Color, OpenGL (+Y) Normal (Z reconstructed), and RM (R=Roughness, G=Metallic)
 * into 2D preview canvases directly from straight-alpha decoded bytes.
 */
export function draw2MapChannelCanvases(colorCanvas, normalCanvas, rmCanvas, assets) {
  const { width, height, data } = assets.normRm;
  const rect = fitPreviewRect(width, height, 128);

  if (colorCanvas) {
    const ctx = colorCanvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 128, 128);
      fillCheckerboard(ctx, 128);
      ctx.drawImage(assets.colorImg, rect.offX, rect.offY, rect.drawW, rect.drawH);
    }
  }

  const paintPacked = (canvas, mode) => {
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const out = ctx.createImageData(128, 128);
    const dst = out.data;
    for (let py = 0; py < 128; py++) {
      for (let px = 0; px < 128; px++) {
        const dstIdx = (py * 128 + px) * 4;
        if (px < rect.offX || px >= rect.offX + rect.drawW || py < rect.offY || py >= rect.offY + rect.drawH) {
          dst[dstIdx] = 21;
          dst[dstIdx + 1] = 27;
          dst[dstIdx + 2] = 20;
          dst[dstIdx + 3] = 255;
          continue;
        }
        const sx = Math.min(width - 1, Math.floor(((px - rect.offX) / rect.drawW) * width));
        const sy = Math.min(height - 1, Math.floor(((py - rect.offY) / rect.drawH) * height));
        const srcIdx = (sy * width + sx) * 4;
        if (mode === 'normal') {
          const r = data[srcIdx];
          const g = data[srcIdx + 1];
          const nx = (r / 255) * 2 - 1;
          const ny = (g / 255) * 2 - 1;
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
          dst[dstIdx] = r;
          dst[dstIdx + 1] = g;
          dst[dstIdx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
          dst[dstIdx + 3] = 255;
        } else {
          dst[dstIdx] = data[srcIdx + 2];     // Roughness
          dst[dstIdx + 1] = data[srcIdx + 3]; // Metallic
          dst[dstIdx + 2] = 0;
          dst[dstIdx + 3] = 255;
        }
      }
    }
    ctx.putImageData(out, 0, 0);
  };

  if (normalCanvas) paintPacked(normalCanvas, 'normal');
  if (rmCanvas) paintPacked(rmCanvas, 'rm');
}

/**
 * Create a MeshStandardMaterial unpacking HGame v5.0 2-Texture PBR maps
 * (sRGB color + straight Linear normal_rm with OpenGL +Y tangent normal, B=Roughness, A=Metallic).
 */
export function create2MapPbrMaterial({
  mode = 'opaque',
  assets,
  renderer,
  repeat = 1,
  tintHex = 0xffffff,
  opacity = 1,
  polygonOffset = false,
  side,
}) {
  const isOpaque = mode === 'opaque';
  const isDecal = mode === 'decal';
  const isFoliage = mode === 'foliage';

  const maxAniso = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  const wrap = isOpaque ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  const repeatArr = Array.isArray(repeat)
    ? [Math.max(0.25, Number(repeat[0]) || 1), Math.max(0.25, Number(repeat[1]) || 1)]
    : [Math.max(0.25, Number(repeat) || 1), Math.max(0.25, Number(repeat) || 1)];

  const colorTex = new THREE.Texture(assets.colorImg);
  colorTex.colorSpace = THREE.SRGBColorSpace;
  colorTex.premultiplyAlpha = false;
  colorTex.flipY = true;
  colorTex.anisotropy = maxAniso;
  colorTex.wrapS = wrap;
  colorTex.wrapT = wrap;
  if (isOpaque) {
    colorTex.repeat.set(repeatArr[0], repeatArr[1]);
  } else {
    colorTex.repeat.set(1, 1);
  }
  colorTex.needsUpdate = true;

  const normRmTex = new THREE.DataTexture(
    assets.normRm.data,
    assets.normRm.width,
    assets.normRm.height,
    THREE.RGBAFormat,
  );
  normRmTex.colorSpace = THREE.NoColorSpace;
  normRmTex.premultiplyAlpha = false;
  normRmTex.flipY = true;
  normRmTex.generateMipmaps = true;
  normRmTex.minFilter = THREE.LinearMipmapLinearFilter;
  normRmTex.magFilter = THREE.LinearFilter;
  normRmTex.anisotropy = maxAniso;
  normRmTex.wrapS = wrap;
  normRmTex.wrapT = wrap;
  normRmTex.needsUpdate = true;

  const material = new THREE.MeshStandardMaterial({
    map: colorTex,
    color: tintHex,
    roughness: 1.0,
    metalness: 1.0,
    side: side ?? (isOpaque ? THREE.FrontSide : THREE.DoubleSide),
    transparent: isDecal,
    opacity: isDecal ? opacity : 1.0,
    depthWrite: !isDecal,
    alphaTest: isFoliage ? 0.5 : (isDecal ? 0.01 : 0.0),
    polygonOffset,
    polygonOffsetFactor: polygonOffset ? -4 : 0,
    polygonOffsetUnits: polygonOffset ? -4 : 0,
    envMapIntensity: 1.0,
  });

  const uHsvMatchTarget = new THREE.Vector4(0, 0, 0.5, 0);
  const uHsvMatchSource = new THREE.Vector4(0, 0, 0.5, 1);

  material.customProgramCacheKey = () => `hgame-single-2map-${mode}`;
  material.onBeforeCompile = shader => {
    shader.uniforms.uNormalRmMap = { value: normRmTex };
    shader.uniforms.uNormalStrength = { value: 1.0 };
    shader.uniforms.uHsvMatchTarget = { value: uHsvMatchTarget };
    shader.uniforms.uHsvMatchSource = { value: uHsvMatchSource };

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uNormalRmMap;
uniform float uNormalStrength;
uniform vec4 uHsvMatchTarget;
uniform vec4 uHsvMatchSource;

vec3 hgRgb2Hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-5;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hgHsv2Rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

mat3 hgameCotangentFrame(vec3 eyePos, vec3 surfNorm, vec2 uv) {
  vec3 q0 = dFdx(eyePos.xyz);
  vec3 q1 = dFdy(eyePos.xyz);
  vec2 st0 = dFdx(uv.st);
  vec2 st1 = dFdy(uv.st);
  vec3 N = surfNorm;
  vec3 q1perp = cross(q1, N);
  vec3 q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float scale = (det == 0.0) ? 0.0 : inversesqrt(det);
  return mat3(T * scale, B * scale, N);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
vec4 hgNrmRmSample = texture2D(uNormalRmMap, vMapUv);
if (uHsvMatchTarget.w > 0.001) {
  vec3 hgSrgb = pow(max(diffuseColor.rgb, vec3(0.0001)), vec3(1.0 / 2.2));
  vec3 hgHsv = hgRgb2Hsv(hgSrgb);
  float relLuma = hgHsv.z / max(uHsvMatchSource.z, 0.08);
  float creviceW = mix(1.0, mix(0.22, 1.0, smoothstep(0.10, 0.58, relLuma)), step(0.5, uHsvMatchSource.w));
  float amt = clamp(uHsvMatchTarget.w, 0.0, 1.0) * creviceW;
  float dh = fract(uHsvMatchTarget.x - hgHsv.x + 0.5) - 0.5;
  float targetSatGate = smoothstep(0.015, 0.12, uHsvMatchTarget.y);
  float nextH = fract(hgHsv.x + dh * amt * mix(0.35, 1.0, targetSatGate));
  float nextS = clamp(hgHsv.y + (uHsvMatchTarget.y - uHsvMatchSource.y) * amt, 0.0, 1.0);
  float vRatio = clamp(uHsvMatchTarget.z / max(uHsvMatchSource.z, 0.06), 0.45, 1.85);
  float nextV = clamp(hgHsv.z * mix(1.0, vRatio, amt), 0.0, 1.0);
  vec3 hgAdjSrgb = hgHsv2Rgb(vec3(nextH, nextS, nextV));
  diffuseColor.rgb = pow(max(hgAdjSrgb, vec3(0.0001)), vec3(2.2));
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        'float roughnessFactor = clamp(hgNrmRmSample.b, 0.04, 1.0);',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        'float metalnessFactor = clamp(hgNrmRmSample.a, 0.0, 1.0);',
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
vec2 hgNxy = hgNrmRmSample.rg * 2.0 - 1.0;
float hgNz = sqrt(max(0.0, 1.0 - dot(hgNxy, hgNxy)));
vec3 hgMapN = vec3(hgNxy * uNormalStrength, hgNz);
mat3 hgTbn = hgameCotangentFrame(-vViewPosition, normal, vMapUv);
normal = normalize(hgTbn * hgMapN);`,
      );
  };

  return {
    material,
    colorTex,
    normRmTex,
    setHsvMatch({ targetStats = null, sourceStats = null, strength = 0, creviceProtect = true } = {}) {
      if (!targetStats || !sourceStats || strength <= 0) {
        uHsvMatchTarget.w = 0;
        return;
      }
      uHsvMatchTarget.set(targetStats.h, targetStats.s, targetStats.v, Math.max(0, Math.min(1, Number(strength) || 0)));
      uHsvMatchSource.set(sourceStats.h, sourceStats.s, sourceStats.v, creviceProtect ? 1 : 0);
    },
  };
}

function rgbToHsv01(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-5) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  const s = max <= 1e-5 ? 0 : d / max;
  return { h, s, v: max };
}

/**
 * Sample representative sRGB HSV statistics from an image.
 * When skipDarkCrevices is true (for crack/stain decals), prioritizes the upper-brightness
 * substrate/apron pixels so dark crack interiors do not skew the overall value.
 */
export function sampleImageHsvStats(img, { skipDarkCrevices = false } = {}) {
  const fallback = { h: 0, s: 0, v: 0.5 };
  if (!img) return fallback;
  try {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;

    const samples = [];
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a <= 24) continue;
      const hsv = rgbToHsv01(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
      samples.push({ ...hsv, w: a / 255 });
    }
    if (!samples.length) return fallback;

    let chosen = samples;
    if (skipDarkCrevices && samples.length >= 12) {
      const sorted = [...samples].sort((a, b) => a.v - b.v);
      const start = Math.floor(sorted.length * 0.45);
      const end = Math.max(start + 1, Math.floor(sorted.length * 0.92));
      chosen = sorted.slice(start, end);
    }

    let sumW = 0;
    let sumS = 0;
    let sumV = 0;
    let sumCos = 0;
    let sumSin = 0;
    let sumHueW = 0;
    for (const p of chosen) {
      sumW += p.w;
      sumS += p.s * p.w;
      sumV += p.v * p.w;
      const hw = p.w * (0.04 + p.s);
      const ang = p.h * Math.PI * 2;
      sumCos += Math.cos(ang) * hw;
      sumSin += Math.sin(ang) * hw;
      sumHueW += hw;
    }
    if (sumW <= 0) return fallback;
    let meanH = Math.atan2(sumSin, sumCos) / (Math.PI * 2);
    if (meanH < 0) meanH += 1;
    return {
      h: sumHueW > 0 ? meanH : 0,
      s: sumS / sumW,
      v: sumV / sumW,
    };
  } catch {
    return fallback;
  }
}

export function getDefaultDecalHsvMatch(item, lib = 'cn_pbr') {
  if (!item || lib === 'cn_foliage' || lib === 'unreal') return { enabled: false, amount: 0 };
  const cat = item.category || '';
  if (cat === 'crack') return { enabled: true, amount: 0.75 };
  if (cat === 'stain' || cat === 'leak') return { enabled: true, amount: 0.4 };
  return { enabled: false, amount: 0 };
}

/**
 * Inspect alpha edges of a wall decal color image to classify whether it is:
 * - 'full': top-to-bottom stain (needs full wall-height scaling)
 * - 'top': top-edge drip/leak (flush to wall top edge, optional full-width strip)
 * - 'center': localized mid-wall crack/mark
 */
export function analyzeWallDecalPlacement(img, aspect = 1) {
  const fallback = { anchor: 'center', spanFullWidth: false };
  if (!img) return fallback;
  try {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;

    let topMax = 0;
    let sideMax = 0;
    let lastContentRow = 0;
    for (let y = 0; y < size; y++) {
      let rowMax = 0;
      for (let x = 0; x < size; x++) {
        const a = data[(y * size + x) * 4 + 3];
        if (a > rowMax) rowMax = a;
        if ((x <= 1 || x >= size - 2) && a > sideMax) sideMax = a;
      }
      if (y <= 1 && rowMax > topMax) topMax = rowMax;
      if (rowMax > 36) lastContentRow = y / (size - 1);
    }

    if (topMax <= 40) return fallback;
    const spanFullWidth = aspect >= 1.4 && sideMax > 40;
    if (!spanFullWidth && lastContentRow >= 0.85) {
      return { anchor: 'full', spanFullWidth: sideMax > 40 };
    }
    return { anchor: 'top', spanFullWidth };
  } catch {
    return fallback;
  }
}

/**
 * Create a unified 2-column square sidebar card with ONLY a 1:1 preview box and a single name.
 */
export function createSidebarSquareCard({
  name = '',
  thumbUrl = '',
  badge = '',
  accentColor = '',
  active = false,
  className = 'hgame-list-item',
  onClick = null,
} = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.title = name;
  btn.setAttribute('aria-current', active ? 'true' : 'false');

  const thumbBox = document.createElement('span');
  thumbBox.className = 'sidebar-card-thumb';

  let imgEl = null;
  let fallbackEl = null;

  if (thumbUrl) {
    imgEl = document.createElement('img');
    imgEl.src = thumbUrl;
    imgEl.alt = '';
    imgEl.loading = 'lazy';
    imgEl.decoding = 'async';
    thumbBox.append(imgEl);
  }

  if (!thumbUrl || badge) {
    fallbackEl = document.createElement('span');
    fallbackEl.className = 'sidebar-card-badge';
    fallbackEl.textContent = badge || (name ? name.slice(0, 2).toUpperCase() : '?');
    if (accentColor) fallbackEl.style.color = accentColor;
    if (thumbUrl) fallbackEl.hidden = true;
    thumbBox.append(fallbackEl);
  }

  if (imgEl && fallbackEl) {
    imgEl.addEventListener('error', () => {
      imgEl.hidden = true;
      fallbackEl.hidden = false;
    });
    imgEl.addEventListener('load', () => {
      imgEl.hidden = false;
      fallbackEl.hidden = true;
    });
  }

  const label = document.createElement('strong');
  label.className = 'sidebar-card-name';
  label.textContent = name;

  btn.append(thumbBox, label);
  if (onClick) btn.addEventListener('click', onClick);
  return { button: btn, thumbBox, imgEl, fallbackEl, label };
}

const glbThumbCache = new Map();
const glbThumbQueue = [];
let glbThumbRunning = false;
let glbThumbContext = null;

async function ensureGlbThumbContext() {
  if (glbThumbContext) return glbThumbContext;
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ]);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setPixelRatio(1);
  renderer.setSize(128, 128, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x161c15);
  scene.add(new THREE.HemisphereLight(0xf4f8ff, 0x3b4837, 1.9));
  const key = new THREE.DirectionalLight(0xfff6e5, 2.4);
  key.position.set(4, 7, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fc2ff, 0.85);
  fill.position.set(-4, 3, -4);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 400);
  glbThumbContext = { loader, renderer, scene, camera };
  return glbThumbContext;
}

async function drainGlbThumbQueue() {
  if (glbThumbRunning) return;
  glbThumbRunning = true;
  try {
    while (glbThumbQueue.length > 0) {
      const task = glbThumbQueue.shift();
      if (!task) continue;
      const { url, onDone } = task;
      if (glbThumbCache.has(url)) {
        onDone(glbThumbCache.get(url));
        continue;
      }
      try {
        const ctx = await ensureGlbThumbContext();
        const gltf = await ctx.loader.loadAsync(url);
        const root = gltf.scene;
        // Hide LOD1/LOD2 sub-meshes for clean LOD0 thumb
        root.traverse(c => {
          const n = c.name || '';
          if (n === 'mesh_lod1' || n.endsWith('_lod1') || n === 'mesh_lod2' || n.endsWith('_lod2')) {
            c.visible = false;
          }
          if (c.isMesh && (!c.material || Array.isArray(c.material) && !c.material.length)) {
            c.material = new THREE.MeshStandardMaterial({ color: 0xb6c2ad, roughness: 0.65, metalness: 0.15 });
          }
        });
        ctx.scene.add(root);
        const box = new THREE.Box3().setFromObject(root);
        const center = box.isEmpty() ? new THREE.Vector3(0, 0.5, 0) : box.getCenter(new THREE.Vector3());
        const size = Math.max(box.isEmpty() ? 1 : box.getSize(new THREE.Vector3()).length(), 0.25);
        ctx.camera.near = Math.max(size / 2000, 0.01);
        ctx.camera.far = Math.max(size * 40, 80);
        ctx.camera.updateProjectionMatrix();
        ctx.camera.position.copy(center).add(new THREE.Vector3(size * 0.78, size * 0.45, size * 0.98));
        ctx.camera.lookAt(center);
        ctx.renderer.render(ctx.scene, ctx.camera);
        const dataUrl = ctx.renderer.domElement.toDataURL('image/png');
        ctx.scene.remove(root);
        disposeObject3D(root);
        glbThumbCache.set(url, dataUrl);
        onDone(dataUrl);
      } catch {
        glbThumbCache.set(url, '');
      }
      await new Promise(r => setTimeout(r, 8));
    }
  } finally {
    glbThumbRunning = false;
  }
}

export function requestGlbSquareThumb(url, thumbBox, fallbackEl) {
  if (!url || !thumbBox) return;
  const applyUrl = (dataUrl) => {
    if (!dataUrl || !thumbBox.isConnected) return;
    let img = thumbBox.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      img.alt = '';
      thumbBox.prepend(img);
    }
    img.src = dataUrl;
    img.hidden = false;
    if (fallbackEl) fallbackEl.hidden = true;
  };
  if (glbThumbCache.has(url)) {
    applyUrl(glbThumbCache.get(url));
    return;
  }
  glbThumbQueue.push({ url, onDone: applyUrl });
  void drainGlbThumbQueue();
}

export const CHARACTER_HEIGHT_TIERS = Object.freeze({
  small: { key: 'small', label: '小动物', baseHeight: 1.0 },
  human: { key: 'human', label: '人', baseHeight: 1.75 },
  medium_monster: { key: 'medium_monster', label: '中型怪物', baseHeight: 2.3 },
  large_monster: { key: 'large_monster', label: '大型怪物', baseHeight: 3.0 },
});

function inferTierFromHeight(height) {
  if (height >= 2.65) return CHARACTER_HEIGHT_TIERS.large_monster;
  if (height >= 2.05) return CHARACTER_HEIGHT_TIERS.medium_monster;
  if (height >= 1.35) return CHARACTER_HEIGHT_TIERS.human;
  return CHARACTER_HEIGHT_TIERS.small;
}

export const CHARACTER_PHYSICAL_PROFILES = Object.freeze({
  // 1.00m 档：小动物（猫狗统一按 1.00m 设计）
  maodie: { tier: 'small', height: 1.00, role: '小动物 · 猫' },
  chouju: { tier: 'small', height: 1.00, role: '小动物 · 猫' },
  bananacat: { tier: 'small', height: 1.00, role: '小动物 · 香蕉猫' },
  'cat-knight': { tier: 'small', height: 1.00, role: '小动物 · 猫骑士' },
  'daodun-dog': { tier: 'small', height: 1.00, role: '小动物 · 柴犬战士' },
  // 1.75m 档：人 / 拟人角色（围绕 1.75m 上下浮动）
  'character-5bf3a802-2692-43f1-8598-cc3294c9f0b3': { tier: 'human', height: 1.66, role: '初中少年' }, // 阿伟
  nailong: { tier: 'human', height: 1.68, role: '拟人幼龙' },
  dafeiyu: { tier: 'human', height: 1.68, role: '二次元少女' },
  grok: { tier: 'human', height: 1.68, role: '哥特少女' },
  claude: { tier: 'human', height: 1.70, role: '少女' },
  'character-0eef1539-efff-4ea8-b926-a27e2060b9ae': { tier: 'human', height: 1.70, role: '奇幻少女' }, // Gemini
  doubao: { tier: 'human', height: 1.71, role: '青年女性' },
  naiwa: { tier: 'human', height: 1.72, role: '拟人奶蛙' },
  'character-b3a75eb1-1ce2-4218-875b-5b463191d6f6': { tier: 'human', height: 1.72, role: '国风女性' }, // 千问
  gpt: { tier: 'human', height: 1.73, role: '银发御姐' },
  haoge: { tier: 'human', height: 1.75, role: '中年男性' },
  'character-3dca756f-0ef7-4d03-a008-11decc26c3cc': { tier: 'human', height: 1.75, role: '男青年' }, // 杰哥
  'character-6ce0c029-9a8c-4fbc-8f78-dce1da81ef0d': { tier: 'human', height: 1.76, role: '高大女性' }, // 雨姐
  liuhuaqiang: { tier: 'human', height: 1.78, role: '成年硬汉' },
  'character-1efd121d-1f9e-4ab0-9164-8f2ca240da4b': { tier: 'human', height: 1.80, role: '魁梧男性' }, // 梁子
  'character-2dec31e2-0a13-4c28-b0ca-202fb40d4875': { tier: 'human', height: 1.82, role: '肌肉猛男' }, // 阿诺
  'character-5a7a1e23-8ba6-4ccb-9cb4-38df4d3f0b03': { tier: 'human', height: 1.84, role: '高大西装男' }, // 梁圣
});

function formatTierSpec(height, role, tierKey) {
  const tier = CHARACTER_HEIGHT_TIERS[tierKey] || inferTierFromHeight(height);
  return {
    height,
    role,
    tier: tier.key,
    tierLabel: tier.label,
    tierHeight: tier.baseHeight,
  };
}

export function resolveCharacterScaleSpec(ch) {
  const id = String(ch?.id || '').trim();
  const explicitHeight = Number(ch?.height ?? ch?.scaleHeight);
  const explicitTier = ch?.sizeTier && CHARACTER_HEIGHT_TIERS[ch.sizeTier] ? ch.sizeTier : null;
  const direct = CHARACTER_PHYSICAL_PROFILES[id];
  if (Number.isFinite(explicitHeight) && explicitHeight > 0.1) {
    return formatTierSpec(explicitHeight, direct?.role || String(ch?.role || '角色'), explicitTier || direct?.tier);
  }
  if (explicitTier) {
    const tierObj = CHARACTER_HEIGHT_TIERS[explicitTier];
    return formatTierSpec(tierObj.baseHeight, direct?.role || tierObj.label, explicitTier);
  }
  if (direct) return formatTierSpec(direct.height, direct.role, direct.tier);

  const text = [ch?.id, ch?.name, ...(ch?.aliases || []), ...(ch?.keywords || [])].join(' ').toLowerCase();
  if (/巨兽|泰坦|boss|titan|colossus|giant|大型怪/.test(text)) {
    return formatTierSpec(3.0, '大型怪物', 'large_monster');
  }
  if (/怪物|妖|魔|狼人|兽人|精英|ogre|orc|troll|monster|中型怪/.test(text)) {
    return formatTierSpec(2.3, '中型怪物', 'medium_monster');
  }
  if (/cat|dog|猫|狗|犬|橘|kitty|meow|shiba|cheems|小动物/.test(text)) {
    return formatTierSpec(1.0, '小动物', 'small');
  }
  if (/frog|蛙|dragon|dino|龙/.test(text)) return formatTierSpec(1.70, '拟人吉祥物', 'human');
  if (/少年|男孩|kid|child|student|初中|阿伟/.test(text)) return formatTierSpec(1.66, '少年', 'human');
  if (String(ch?.gender || '').toLowerCase() === 'female' || /女|姐|girl|少女/.test(text)) {
    return formatTierSpec(1.70, '女性', 'human');
  }
  return formatTierSpec(1.75, '成年人', 'human');
}

export function fitCharacterToIdentityScale(root, character, { groundY = 0, centerXZ = false } = {}) {
  const spec = resolveCharacterScaleSpec(character);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) {
    return { height: spec.height, role: spec.role, groundOffset: groundY };
  }
  const rawSize = box.getSize(new THREE.Vector3());
  const rawHeight = Math.max(0.08, rawSize.y);
  const scaleFactor = spec.height / rawHeight;
  root.scale.multiplyScalar(scaleFactor);
  root.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(root);
  const center = scaledBox.getCenter(new THREE.Vector3());
  if (centerXZ) {
    root.position.set(-center.x, groundY - scaledBox.min.y, -center.z);
  } else {
    root.position.y += groundY - scaledBox.min.y;
  }
  return {
    height: scaledBox.getSize(new THREE.Vector3()).y,
    role: spec.role,
    groundOffset: root.position.y,
  };
}
