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

  material.customProgramCacheKey = () => `hgame-single-2map-${mode}`;
  material.onBeforeCompile = shader => {
    shader.uniforms.uNormalRmMap = { value: normRmTex };
    shader.uniforms.uNormalStrength = { value: 1.0 };

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uNormalRmMap;
uniform float uNormalStrength;

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
vec4 hgNrmRmSample = texture2D(uNormalRmMap, vMapUv);`,
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

  return { material, colorTex, normRmTex };
}
