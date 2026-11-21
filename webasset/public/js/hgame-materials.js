import * as THREE from 'three';
import { loadHdriEnvironment } from './realistic-pcg.js';
import {
  createThreeViewport,
  disposeObject3D,
} from './hgame-shared.js';

const viewEl = document.querySelector('#materials-view');
const libTabs = [...document.querySelectorAll('.hgame-mat-lib-tab')];
const searchInput = document.querySelector('#hgame-material-search');
const sourceFilter = document.querySelector('#hgame-material-source-filter');
const listEl = document.querySelector('#hgame-material-list');
const titleEl = document.querySelector('#hgame-material-title');
const downloadEl = document.querySelector('#hgame-material-download');
const emptyEl = document.querySelector('#hgame-material-empty');
const stageEl = document.querySelector('#hgame-material-stage');
const mapsPanelEl = document.querySelector('#hgame-material-maps');
const mapColorCanvas = document.querySelector('#hgame-map-color');
const mapNormalCanvas = document.querySelector('#hgame-map-normal');
const mapRmCanvas = document.querySelector('#hgame-map-rm');
const shapeWrap = document.querySelector('#hgame-material-shape-wrap');
const shapeSelect = document.querySelector('#hgame-material-mesh-shape');
const tileInput = document.querySelector('#hgame-material-tile');
const tileVal = document.querySelector('#hgame-material-tile-val');
const bakemodeWrap = document.querySelector('#hgame-material-bakemode-wrap');
const tintWrap = document.querySelector('#hgame-material-tint-wrap');
const tintSelect = document.querySelector('#hgame-material-tint');
const statusEl = document.querySelector('#hgame-material-status');

const LIBRARIES = {
  materials: {
    label: '通用材质',
    baseUrl: '/assets/cn/materials',
    tableUrl: '/assets/cn/materials/material_table.json',
    itemsKey: 'materials',
  },
  pbr_decals: {
    label: '贴花',
    baseUrl: '/assets/cn/pbr_decals',
    tableUrl: '/assets/cn/pbr_decals/pbr_decals_table.json',
    itemsKey: 'items',
  },
  pbr_foliage: {
    label: '植被',
    baseUrl: '/assets/cn/pbr_foliage',
    tableUrl: '/assets/cn/pbr_foliage/pbr_foliage_table.json',
    itemsKey: 'items',
  },
};

let initialized = false;
let currentLib = 'materials';
const tableCache = new Map();
const decodedCache = new Map();
const MAX_DECODED_CACHE = 12;

let currentItems = [];
let selectedId = '';
let viewport = null;
let hdriEnv = null;
let previewMaterial = null;
let previewColorTex = null;
let previewNormRmTex = null;
let meshGroup = null;
let loadSeq = 0;

let decodeGl = null;
let decodeFbo = null;

function ensureDecodeGl() {
  if (decodeGl) return decodeGl;
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) {
    throw new Error('需要 WebGL2 以无损读取非预乘 normal_rm.png');
  }
  decodeFbo = gl.createFramebuffer();
  decodeGl = gl;
  return decodeGl;
}

/**
 * Decode a PNG into top-down straight RGBA bytes without Canvas2D alpha premultiplication
 * so A=0 non-metal pixels retain intact RGB normal & roughness data.
 */
async function decodeStraightRgba(url) {
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, decodeFbo);
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

async function loadHtmlImage(url) {
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

async function loadSingleMaterialAssets(libId, entry) {
  const cacheKey = `${libId}:${entry.id}`;
  if (decodedCache.has(cacheKey)) {
    const cached = decodedCache.get(cacheKey);
    decodedCache.delete(cacheKey);
    decodedCache.set(cacheKey, cached);
    return cached;
  }

  const lib = LIBRARIES[libId];
  const colorUrl = `${lib.baseUrl}/${entry.id}/color.png`;
  const normRmUrl = `${lib.baseUrl}/${entry.id}/normal_rm.png`;

  const t0 = performance.now();
  const [colorImg, normRm] = await Promise.all([
    loadHtmlImage(colorUrl),
    decodeStraightRgba(normRmUrl),
  ]);
  const loadMs = performance.now() - t0;

  const result = {
    colorImg,
    normRm,
    loadMs,
  };
  decodedCache.set(cacheKey, result);
  while (decodedCache.size > MAX_DECODED_CACHE) {
    const oldestKey = decodedCache.keys().next().value;
    decodedCache.delete(oldestKey);
  }
  return result;
}

function ensureViewport() {
  if (!viewport) {
    viewport = createThreeViewport(stageEl, { background: 0x151b14, grid: true, shadows: true });
    viewport.camera.position.set(2.8, 2.1, 3.2);
    viewport.controls.target.set(0, 0.85, 0);
    viewport.controls.update();
  }
  return viewport;
}

function syncOutputs() {
  if (tileVal && tileInput) {
    tileVal.textContent = Number(tileInput.value || 1).toFixed(2);
  }
}

function disposePreviewResources() {
  if (previewMaterial) {
    previewMaterial.dispose();
    previewMaterial = null;
  }
  if (previewColorTex) {
    previewColorTex.dispose();
    previewColorTex = null;
  }
  if (previewNormRmTex) {
    previewNormRmTex.dispose();
    previewNormRmTex = null;
  }
  if (meshGroup && viewport) {
    viewport.scene.remove(meshGroup);
    disposeObject3D(meshGroup);
    meshGroup = null;
  }
}

function populateFilter() {
  if (!sourceFilter) return;
  const prev = sourceFilter.value || 'all';
  const libLabel = LIBRARIES[currentLib]?.label || '材质';
  const opts = [{ value: 'all', label: `全部${libLabel} (${currentItems.length})` }];

  if (currentLib === 'materials') {
    const sources = new Map();
    const surfaces = new Map();
    for (const m of currentItems) {
      const src = m.source || 'fablibrary';
      sources.set(src, (sources.get(src) || 0) + 1);
      const st = m.surfaceType || 'other';
      surfaces.set(st, (surfaces.get(st) || 0) + 1);
    }
    for (const [src, count] of sources) {
      opts.push({ value: `src:${src}`, label: `来源 · ${src} (${count})` });
    }
    for (const [st, count] of [...surfaces.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      opts.push({ value: `st:${st}`, label: `类型 · ${st} (${count})` });
    }
  } else {
    const cats = new Map();
    let tintCount = 0;
    for (const m of currentItems) {
      const cat = m.category || 'other';
      cats.set(cat, (cats.get(cat) || 0) + 1);
      if (m.tintableGrayscale) tintCount += 1;
    }
    for (const [cat, count] of [...cats.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      opts.push({ value: `cat:${cat}`, label: `分类 · ${cat} (${count})` });
    }
    if (tintCount > 0) {
      opts.push({ value: 'tint:1', label: `可染色血迹/污渍 (${tintCount})` });
    }
  }

  sourceFilter.replaceChildren();
  for (const o of opts) {
    const el = document.createElement('option');
    el.value = o.value;
    el.textContent = o.label;
    sourceFilter.append(el);
  }
  sourceFilter.value = opts.some(o => o.value === prev) ? prev : 'all';
}

function renderList() {
  if (!listEl) return;
  const query = (searchInput?.value || '').trim().toLowerCase();
  const filter = sourceFilter?.value || 'all';

  const items = currentItems.filter(m => {
    if (filter.startsWith('src:') && (m.source || '') !== filter.slice(4)) return false;
    if (filter.startsWith('st:') && (m.surfaceType || '') !== filter.slice(3)) return false;
    if (filter.startsWith('cat:') && (m.category || '') !== filter.slice(4)) return false;
    if (filter === 'tint:1' && !m.tintableGrayscale) return false;
    if (!query) return true;
    return String(m.id || '').toLowerCase().includes(query) ||
      String(m.category || '').toLowerCase().includes(query) ||
      String(m.surfaceType || '').toLowerCase().includes(query) ||
      String(m.sourcePath || '').toLowerCase().includes(query) ||
      String(m.assetId || '').toLowerCase().includes(query) ||
      String(m.source || '').toLowerCase().includes(query);
  });

  listEl.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'hgame-list-empty';
    empty.textContent = currentItems.length ? '没有匹配的材质' : '暂无材质';
    listEl.append(empty);
    return;
  }

  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hgame-list-item';
    btn.setAttribute('aria-current', item.id === selectedId ? 'true' : 'false');
    const copy = document.createElement('span');
    copy.className = 'hgame-item-copy';
    const strong = document.createElement('strong');
    strong.textContent = item.id;
    const small = document.createElement('small');
    const dim = `${item.width || 1024}×${item.height || 1024}`;
    const flags = currentLib === 'materials'
      ? [item.surfaceType, item.category, dim]
      : [item.category, dim, item.tintableGrayscale ? '可染色' : ''];
    small.textContent = flags.filter(Boolean).join(' · ');
    copy.append(strong, small);
    btn.append(copy);
    btn.addEventListener('click', () => selectMaterial(item.id));
    listEl.append(btn);
  }
}

function fitRect(width, height, boxSize = 128) {
  const aspect = Math.max(0.05, width / Math.max(1, height));
  const drawW = aspect >= 1 ? boxSize : Math.max(1, Math.round(boxSize * aspect));
  const drawH = aspect >= 1 ? Math.max(1, Math.round(boxSize / aspect)) : boxSize;
  const offX = Math.floor((boxSize - drawW) / 2);
  const offY = Math.floor((boxSize - drawH) / 2);
  return { drawW, drawH, offX, offY };
}

function drawCheckerboard(ctx, size) {
  const step = 8;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const even = ((x / step) + (y / step)) % 2 === 0;
      ctx.fillStyle = even ? '#212922' : '#181f19';
      ctx.fillRect(x, y, step, step);
    }
  }
}

/**
 * Draw Color, Normal (OpenGL +Y, Z reconstructed), and RM (R=Roughness, G=Metallic)
 * directly from decoded bytes without Canvas2D alpha premultiplication loss.
 */
function drawChannelPreviews(entry, assets) {
  const { width, height, data } = assets.normRm;
  const rect = fitRect(width, height, 128);

  if (mapColorCanvas) {
    const ctx = mapColorCanvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 128, 128);
      drawCheckerboard(ctx, 128);
      ctx.drawImage(assets.colorImg, rect.offX, rect.offY, rect.drawW, rect.drawH);
    }
  }

  if (mapNormalCanvas) {
    const ctx = mapNormalCanvas.getContext('2d');
    if (ctx) {
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
          const r = data[srcIdx];
          const g = data[srcIdx + 1];
          const nx = (r / 255) * 2 - 1;
          const ny = (g / 255) * 2 - 1;
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
          dst[dstIdx] = r;
          dst[dstIdx + 1] = g;
          dst[dstIdx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
          dst[dstIdx + 3] = 255;
        }
      }
      ctx.putImageData(out, 0, 0);
    }
  }

  if (mapRmCanvas) {
    const ctx = mapRmCanvas.getContext('2d');
    if (ctx) {
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
          dst[dstIdx] = data[srcIdx + 2];     // Roughness
          dst[dstIdx + 1] = data[srcIdx + 3]; // Metallic
          dst[dstIdx + 2] = 0;
          dst[dstIdx + 3] = 255;
        }
      }
      ctx.putImageData(out, 0, 0);
    }
  }
}

/**
 * Create a Three.js MeshStandardMaterial implementing HGame v5.0 2-Map unpacking:
 * - Color (sRGB) -> Albedo (+ Alpha)
 * - Normal_RM (Linear RGBA, Straight/Unpremultiplied) -> RG OpenGL +Y normal (reconstructed Z), B Roughness, A Metalness
 */
function create2MapPreviewMaterial({ libId, entry, assets, renderer }) {
  const isOpaque = libId === 'materials';
  const isDecal = libId === 'pbr_decals';
  const isFoliage = libId === 'pbr_foliage';

  const colorTex = new THREE.Texture(assets.colorImg);
  colorTex.colorSpace = THREE.SRGBColorSpace;
  colorTex.premultiplyAlpha = false;
  colorTex.flipY = true;
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 1);
  colorTex.anisotropy = maxAniso;

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

  const wrap = isOpaque ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  colorTex.wrapS = wrap;
  colorTex.wrapT = wrap;
  normRmTex.wrapS = wrap;
  normRmTex.wrapT = wrap;

  const tile = isOpaque ? Math.max(0.25, Number(tileInput?.value || 1)) : 1;
  colorTex.repeat.set(tile, tile);
  colorTex.needsUpdate = true;
  normRmTex.needsUpdate = true;

  const tintHex = entry.tintableGrayscale && tintSelect ? Number(tintSelect.value || 0x8b0c0c) : 0xffffff;
  const mat = new THREE.MeshStandardMaterial({
    map: colorTex,
    color: tintHex,
    roughness: 1.0,
    metalness: 1.0,
    side: isOpaque ? THREE.FrontSide : THREE.DoubleSide,
    transparent: isDecal,
    depthWrite: !isDecal,
    alphaTest: isFoliage ? 0.5 : 0.0,
    envMapIntensity: 1.0,
  });

  mat.customProgramCacheKey = () => `hgame-single-2map-${libId}`;
  mat.onBeforeCompile = shader => {
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

  return { mat, colorTex, normRmTex };
}

function buildPreviewGeometryGroup(libId, entry, mat) {
  const group = new THREE.Group();
  if (libId === 'materials') {
    const shape = shapeSelect?.value || 'combo';
    if (shape === 'combo') {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), mat);
      cube.position.set(-0.85, 0.72, 0);
      cube.castShadow = true;
      cube.receiveShadow = true;
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.92, 48, 32), mat);
      sphere.position.set(0.95, 0.95, 0);
      sphere.castShadow = true;
      sphere.receiveShadow = true;
      group.add(cube, sphere);
    } else if (shape === 'sphere') {
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.05, 48, 32), mat);
      sphere.position.set(0, 1.05, 0);
      sphere.castShadow = true;
      sphere.receiveShadow = true;
      group.add(sphere);
    } else {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.45, 1.45), mat);
      cube.position.set(0, 0.75, 0);
      cube.castShadow = true;
      cube.receiveShadow = true;
      group.add(cube);
    }
    return group;
  }

  // Decals & foliage: double-sided plane preserving exact native aspect ratio
  const aspect = Math.max(0.1, Number(entry.aspectRatio || (entry.width || 1) / Math.max(1, entry.height || 1)));
  const maxSpan = 2.1;
  const planeW = aspect >= 1 ? maxSpan : maxSpan * aspect;
  const planeH = aspect >= 1 ? maxSpan / aspect : maxSpan;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), mat);
  plane.position.set(0, planeH * 0.5 + 0.15, 0);
  group.add(plane);
  return group;
}

function syncControlVisibility(entry) {
  const isMaterials = currentLib === 'materials';
  if (shapeWrap) shapeWrap.hidden = !isMaterials;
  if (bakemodeWrap) bakemodeWrap.hidden = !isMaterials;
  const tileField = tileInput?.closest('label');
  if (tileField) tileField.hidden = !isMaterials;
  if (tintWrap) tintWrap.hidden = !entry?.tintableGrayscale;
}

async function selectMaterial(id) {
  selectedId = id || '';
  renderList();

  const entry = currentItems.find(m => m.id === selectedId);
  syncControlVisibility(entry);

  if (!entry) {
    titleEl.textContent = `${LIBRARIES[currentLib]?.label || '材质'} · 未选择`;
    if (downloadEl) downloadEl.hidden = true;
    mapsPanelEl.hidden = true;
    emptyEl.hidden = false;
    disposePreviewResources();
    statusEl.textContent = currentItems.length ? '请从左侧列表选择一项材质预览' : '暂无可用材质';
    return;
  }

  const token = ++loadSeq;
  const vp = ensureViewport();
  emptyEl.hidden = true;
  mapsPanelEl.hidden = false;
  titleEl.textContent = currentLib === 'materials' && entry.layer != null
    ? `${entry.id} (#${entry.layer})`
    : `${entry.id} (${entry.width || 1024}×${entry.height || 1024})`;
  if (downloadEl) {
    downloadEl.href = '/assets/cn/browser.html';
    downloadEl.removeAttribute('download');
    downloadEl.target = '_blank';
    downloadEl.textContent = '打开母库检视台';
    downloadEl.hidden = false;
  }

  statusEl.textContent = `按需加载 ${entry.id} (Color + Normal_RM)…`;

  try {
    const assets = await loadSingleMaterialAssets(currentLib, entry);
    if (token !== loadSeq) return;

    disposePreviewResources();
    const { mat, colorTex, normRmTex } = create2MapPreviewMaterial({
      libId: currentLib,
      entry,
      assets,
      renderer: vp.renderer,
    });
    previewMaterial = mat;
    previewColorTex = colorTex;
    previewNormRmTex = normRmTex;

    meshGroup = buildPreviewGeometryGroup(currentLib, entry, previewMaterial);
    vp.scene.add(meshGroup);

    drawChannelPreviews(entry, assets);

    const aspectStr = entry.aspectRatio && entry.aspectRatio !== 1
      ? ` · 比例 ${entry.aspectRatio}:1`
      : '';
    const physStr = entry.physicalSizeMeters ? ` · ${entry.physicalSizeMeters}m` : '';
    const modeStr = currentLib === 'pbr_decals'
      ? (entry.tintableGrayscale ? '双面贴花(Transparent+可染色)' : '双面贴花(Transparent)')
      : currentLib === 'pbr_foliage'
        ? '双面植被(alphaTest 0.5)'
        : `${entry.surfaceType || ''} · ${entry.tiling || 'grid'}`;

    statusEl.textContent =
      `2贴图直读 (Color+Normal_RM OpenGL +Y) · ${entry.width || 1024}×${entry.height || 1024}${aspectStr}${physStr} · ` +
      `${modeStr} · ${assets.loadMs.toFixed(0)}ms · ${entry.sourcePath || entry.assetId || entry.source || ''}`;
  } catch (err) {
    if (token !== loadSeq) return;
    statusEl.textContent = `加载失败: ${err.message}`;
  }
}

async function switchLibrary(libId) {
  if (!LIBRARIES[libId]) return;
  currentLib = libId;
  for (const tab of libTabs) {
    const active = tab.dataset.matLib === libId;
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.tabIndex = active ? 0 : -1;
  }

  const vp = ensureViewport();
  if (!hdriEnv) {
    loadHdriEnvironment({
      url: '/assets/cn/materials/hdri/cn_day_clear.hdr',
      renderer: vp.renderer,
      scene: vp.scene,
    }).then(env => {
      hdriEnv = env;
    }).catch(() => { /* non-fatal if HDRI unavailable */ });
  }

  const token = ++loadSeq;
  statusEl.textContent = `正在读取 ${LIBRARIES[libId].label} 清单…`;

  try {
    let items = tableCache.get(libId);
    if (!items) {
      const cfg = LIBRARIES[libId];
      const resp = await fetch(cfg.tableUrl, { cache: 'no-cache' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${cfg.tableUrl}`);
      const json = await resp.json();
      const raw = Array.isArray(json[cfg.itemsKey]) ? json[cfg.itemsKey] : [];
      items = raw.filter(m => m && m.id && m.id !== '__missing__' && m.slot !== '__missing__');
      tableCache.set(libId, items);
    }
    if (token !== loadSeq && currentLib !== libId) return;

    currentItems = items;
    populateFilter();
    const nextId = currentItems.some(m => m.id === selectedId) ? selectedId : (currentItems[0]?.id || '');
    await selectMaterial(nextId);
  } catch (err) {
    statusEl.textContent = `清单加载失败: ${err.message}`;
  }
}

function init() {
  if (initialized) return;
  initialized = true;

  for (const tab of libTabs) {
    tab.addEventListener('click', () => {
      const targetLib = tab.dataset.matLib;
      if (targetLib && targetLib !== currentLib) {
        switchLibrary(targetLib);
      }
    });
  }

  searchInput?.addEventListener('input', renderList);
  sourceFilter?.addEventListener('change', renderList);
  shapeSelect?.addEventListener('change', () => {
    const entry = currentItems.find(m => m.id === selectedId);
    if (!entry || !previewMaterial || !viewport) return;
    if (meshGroup) {
      viewport.scene.remove(meshGroup);
      disposeObject3D(meshGroup);
    }
    meshGroup = buildPreviewGeometryGroup(currentLib, entry, previewMaterial);
    viewport.scene.add(meshGroup);
  });

  tileInput?.addEventListener('input', () => {
    syncOutputs();
    if (currentLib === 'materials' && previewColorTex) {
      const tile = Math.max(0.25, Number(tileInput.value || 1));
      previewColorTex.repeat.set(tile, tile);
    }
  });

  tintSelect?.addEventListener('change', () => {
    const entry = currentItems.find(m => m.id === selectedId);
    if (entry?.tintableGrayscale && previewMaterial) {
      previewMaterial.color.setHex(Number(tintSelect.value || 0x8b0c0c));
    }
  });
}

function activateMaterialsWorkspace() {
  init();
  const vp = ensureViewport();
  vp.start();
  syncOutputs();
  if (!currentItems.length) {
    switchLibrary(currentLib);
  }
}

window.addEventListener('webasset:workspace-change', event => {
  if (event.detail?.workspace === 'materials') {
    activateMaterialsWorkspace();
  } else {
    viewport?.stop();
  }
});

if (viewEl && !viewEl.hidden) {
  activateMaterialsWorkspace();
}
