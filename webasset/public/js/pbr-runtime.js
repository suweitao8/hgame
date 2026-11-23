import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export const MAX_PBR_MATERIAL_LAYERS = 128;

export class MaterialRegistry {
  #bySlot = new Map();
  #byLayer = [];
  #missingEntry;

  constructor(materialTable) {
    if (!materialTable || !Array.isArray(materialTable.materials)) {
      throw new TypeError('MaterialRegistry requires a valid material_table.json payload');
    }
    for (const entry of materialTable.materials) {
      const rawScan = Array.isArray(entry.scanSizeMeters)
        ? Number(entry.scanSizeMeters[0])
        : Number(entry.scanSizeMeters ?? entry.physicalSizeMeters);
      const scanSizeMeters = Number.isFinite(rawScan) && rawScan > 0 ? rawScan : 1.0;
      const derivedUvScale = Number((1.0 / scanSizeMeters).toFixed(4));
      const normalized = {
        slot: String(entry.slot),
        layer: Number(entry.layer) | 0,
        category: entry.category || '',
        tiling: entry.tiling === 'stochastic' ? 'stochastic' : 'grid',
        scanSizeMeters,
        uvScale: Number.isFinite(entry.uvScale) && entry.uvScale > 0 ? entry.uvScale : derivedUvScale,
        blendMode: entry.blendMode || (entry.alphaCutout ? 'cutout' : 'opaque'),
        opacity: Number.isFinite(entry.opacity) ? entry.opacity : 1.0,
        tintable: Boolean(entry.tintable),
        alphaCutout: Boolean(entry.alphaCutout),
        emissiveColor: Array.isArray(entry.emissiveColor) ? entry.emissiveColor : [0, 0, 0],
        emissiveStrength: Number.isFinite(entry.emissiveStrength) ? entry.emissiveStrength : 0,
        source: entry.source || '',
        assetId: entry.assetId || '',
      };
      this.#bySlot.set(normalized.slot, normalized);
      this.#byLayer[normalized.layer] = normalized;
    }
    this.#missingEntry = this.#bySlot.get('__missing__') || {
      slot: '__missing__',
      layer: 0,
      category: '0_builtin',
      tiling: 'grid',
      scanSizeMeters: 1.0,
      uvScale: 1.0,
      blendMode: 'opaque',
      opacity: 1.0,
      tintable: false,
      alphaCutout: false,
      emissiveColor: [0, 0, 0],
      emissiveStrength: 0,
      source: 'builtin',
      assetId: '__missing__',
    };
  }

  has(slot) {
    return this.#bySlot.has(slot);
  }

  resolveLayer(slot) {
    return this.getLayer(slot);
  }

  getLayer(slot) {
    const entry = this.#bySlot.get(slot);
    if (!entry) {
      console.warn(`[MaterialRegistry] Missing material slot "${slot}", falling back to layer 0 (__missing__)`);
      return 0;
    }
    return entry.layer;
  }

  getMeta(slot) {
    const entry = this.#bySlot.get(slot);
    if (!entry) {
      console.warn(`[MaterialRegistry] Missing material slot "${slot}", falling back to layer 0 (__missing__)`);
      return this.#missingEntry;
    }
    return entry;
  }

  getByLayer(layer) {
    return this.#byLayer[layer] || this.#missingEntry;
  }

  listSlots({ includeMissing = false } = {}) {
    const out = [];
    for (const entry of this.#bySlot.values()) {
      if (!includeMissing && entry.slot === '__missing__') continue;
      out.push(entry);
    }
    return out;
  }

  getAlphaCutoutLayerIds() {
    const ids = new Set();
    for (const entry of this.#bySlot.values()) {
      if (entry.alphaCutout) ids.add(entry.layer);
    }
    return ids;
  }

  getTranslucentLayerIds() {
    const ids = new Set();
    for (const entry of this.#bySlot.values()) {
      if (entry.blendMode === 'translucent') ids.add(entry.layer);
    }
    return ids;
  }

  buildMaterialParamsArray() {
    const arr = new Array(MAX_PBR_MATERIAL_LAYERS);
    for (let i = 0; i < MAX_PBR_MATERIAL_LAYERS; i++) {
      const m = this.#byLayer[i];
      if (!m) {
        arr[i] = new THREE.Vector4(0, 1.0, 0, 1.0);
      } else {
        const isTranslucent = m.blendMode === 'translucent';
        const hasEmissive = (m.emissiveStrength ?? 0) > 0.001;
        const flags =
          (m.tiling === 'stochastic' ? 1 : 0) |
          (m.alphaCutout ? 2 : 0) |
          (m.tintable ? 4 : 0) |
          (isTranslucent ? 8 : 0) |
          (hasEmissive ? 16 : 0);
        arr[i] = new THREE.Vector4(flags, m.uvScale ?? 1.0, m.emissiveStrength ?? 0, m.opacity ?? 1.0);
      }
    }
    return arr;
  }

  buildMaterialEmissiveArray() {
    const arr = new Array(MAX_PBR_MATERIAL_LAYERS);
    for (let i = 0; i < MAX_PBR_MATERIAL_LAYERS; i++) {
      const m = this.#byLayer[i];
      const ec = Array.isArray(m?.emissiveColor) ? m.emissiveColor : [0, 0, 0];
      const str = Number(m?.emissiveStrength || 0);
      const op = m?.opacity ?? 1.0;
      arr[i] = new THREE.Vector4((ec[0] || 0) * str, (ec[1] || 0) * str, (ec[2] || 0) * str, op);
    }
    return arr;
  }
}

function selectAutoResolution(availableResolutions, gameResolution = 512) {
  const gameTier = availableResolutions.includes(gameResolution)
    ? gameResolution
    : (availableResolutions.find((r) => r <= 512) || availableResolutions[0] || 256);
  const isTouchSmall =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    navigator.maxTouchPoints > 0 &&
    Math.min(window.innerWidth || 1280, window.innerHeight || 720) < 900;
  const lowMem = typeof navigator !== 'undefined' && Number(navigator.deviceMemory) > 0 && navigator.deviceMemory <= 2;
  return isTouchSmall || lowMem ? Math.min(256, gameTier) : gameTier;
}

async function uploadAtlasSlicesToTexture2DArray(
  gl,
  bitmap,
  { srcTileSize, tileSize, gridCols, layerCount, internalFormat, uploadFormat = gl.RGBA, maxAnisotropy, anisoExt },
) {
  const mipLevels = Math.floor(Math.log2(tileSize)) + 1;
  const srcSize = srcTileSize || tileSize;

  const sliceOpts = {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
    imageOrientation: 'flipY',
  };
  if (srcSize !== tileSize) {
    sliceOpts.resizeWidth = tileSize;
    sliceOpts.resizeHeight = tileSize;
    sliceOpts.resizeQuality = 'high';
  }

  // Decode all straight-alpha flipped tiles before touching shared WebGL2 state
  const slices = new Array(layerCount);
  const batchSize = 16;
  for (let start = 0; start < layerCount; start += batchSize) {
    const end = Math.min(layerCount, start + batchSize);
    const slicePromises = [];
    for (let layer = start; layer < end; layer++) {
      const col = layer % gridCols;
      const row = Math.floor(layer / gridCols);
      slicePromises.push(createImageBitmap(bitmap, col * srcSize, row * srcSize, srcSize, srcSize, sliceOpts));
    }
    const decoded = await Promise.all(slicePromises);
    for (let idx = 0; idx < decoded.length; idx++) {
      slices[start + idx] = decoded[idx];
    }
  }

  const glTex = gl.createTexture();
  if (!glTex) {
    for (const s of slices) s?.close?.();
    throw new Error('Failed to create WebGL2 TEXTURE_2D_ARRAY');
  }

  const prevFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
  const prevPremult = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
  const prevCsc = gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL);

  // Preserve straight alpha (Normal_RM stores Metallic in A=0..255; Canvas2D premultiplication zeroes RGB when A=0)
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, glTex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, mipLevels, internalFormat, tileSize, tileSize, layerCount);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

  for (let layer = 0; layer < layerCount; layer++) {
    const sliceBmp = slices[layer];
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      layer,
      tileSize,
      tileSize,
      1,
      uploadFormat,
      gl.UNSIGNED_BYTE,
      sliceBmp,
    );
    sliceBmp.close?.();
  }

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlipY);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, prevPremult);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, prevCsc);

  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  if (anisoExt && maxAnisotropy > 1) {
    gl.texParameterf(gl.TEXTURE_2D_ARRAY, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, maxAnisotropy);
  }
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

  const threeTex = new THREE.DataArrayTexture(null, tileSize, tileSize, layerCount);
  threeTex.isExternalTexture = true;
  threeTex.sourceTexture = glTex;
  threeTex.version = 0;
  return { threeTex, glTex };
}

async function fetchImageBitmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load PBR atlas ${url}: HTTP ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
}

export class PbrTextureArrayLoader {
  #bitmapCache = new Map();
  #tableCache = null;

  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || '/assets/cn/materials').replace(/\/+$/, '');
  }

  async load({ renderer, resolution = 'auto' } = {}) {
    if (!renderer || typeof renderer.getContext !== 'function') {
      throw new TypeError('PbrTextureArrayLoader.load requires a Three.js WebGLRenderer');
    }
    const gl = renderer.getContext();
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) {
      throw new Error('PbrTextureArrayLoader requires a WebGL2 context');
    }

    const startTime = performance.now();
    if (!this.#tableCache) {
      const tableRes = await fetch(`${this.baseUrl}/material_table.json`);
      if (!tableRes.ok) {
        throw new Error(`Failed to fetch material_table.json: HTTP ${tableRes.status}`);
      }
      this.#tableCache = await tableRes.json();
    }
    const table = this.#tableCache;
    const availableRes = Array.isArray(table.resolutions) && table.resolutions.length ? table.resolutions : [512, 256];
    const gameRes = table.gameResolution || (availableRes.includes(512) ? 512 : availableRes[0]);

    const rawReq =
      resolution === 'auto'
        ? selectAutoResolution(availableRes, gameRes)
        : Math.max(16, Math.min(1024, Number(resolution) || gameRes));
    const tileSize = 1 << Math.round(Math.log2(rawReq));
    const srcTileSize = availableRes.includes(tileSize)
      ? tileSize
      : (availableRes.find((r) => r >= tileSize) || availableRes[0]);

    let cachedPack = this.#bitmapCache.get(srcTileSize);
    if (!cachedPack) {
      const [albedoBmp, normalRmBmp] = await Promise.all([
        fetchImageBitmap(`${this.baseUrl}/${srcTileSize}/albedo_array.webp`),
        fetchImageBitmap(`${this.baseUrl}/${srcTileSize}/normal_rm_array.webp`),
      ]);
      cachedPack = { albedoBmp, normalRmBmp };
      this.#bitmapCache.set(srcTileSize, cachedPack);
    }
    const { albedoBmp, normalRmBmp } = cachedPack;

    const gridCols = table.gridCols || 8;
    const layerCount = table.layerCount || table.materials.length;
    const anisoExt =
      gl.getExtension('EXT_texture_filter_anisotropic') ||
      gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
      gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
    const maxAniso = anisoExt
      ? Math.min(8, Number(gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) || 1)
      : 1;

    const [alb, nrmRm] = await Promise.all([
      uploadAtlasSlicesToTexture2DArray(gl, albedoBmp, {
        srcTileSize,
        tileSize,
        gridCols,
        layerCount,
        internalFormat: gl.SRGB8_ALPHA8,
        uploadFormat: gl.RGBA,
        maxAnisotropy: maxAniso,
        anisoExt,
      }),
      uploadAtlasSlicesToTexture2DArray(gl, normalRmBmp, {
        srcTileSize,
        tileSize,
        gridCols,
        layerCount,
        internalFormat: gl.RGBA8,
        uploadFormat: gl.RGBA,
        maxAnisotropy: maxAniso,
        anisoExt,
      }),
    ]);

    renderer.resetState?.();

    const registry = new MaterialRegistry(table);
    const loadTimeMs = performance.now() - startTime;
    // 2-map PBR: Albedo RGBA8 (4B) + Normal_RM RGBA8 (4B) = 8 bytes/px * 4/3 mip pyramid
    const estimatedMemoryMB = (tileSize * tileSize * 8 * layerCount * (4 / 3)) / (1024 * 1024);

    return {
      albedoArray: alb.threeTex,
      normalRmArray: nrmRm.threeTex,
      size: tileSize,
      tileSize,
      sourceSize: srcTileSize,
      runtimeDerived: srcTileSize !== tileSize,
      depth: layerCount,
      layerCount,
      gridCols,
      anisotropy: maxAniso,
      table,
      registry,
      loadTimeMs,
      estimatedMemoryMB,
      drawLayerToCanvas(canvas, channel, layerIdx) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (channel === 'albedo') {
          if (!albedoBmp) return;
          const col = layerIdx % gridCols;
          const row = Math.floor(layerIdx / gridCols);
          ctx.drawImage(
            albedoBmp,
            col * srcTileSize,
            row * srcTileSize,
            srcTileSize,
            srcTileSize,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          return;
        }

        if ((channel === 'normal' || channel === 'rm') && nrmRm?.glTex) {
          // Read straight-alpha RGBA8 layer directly from WebGL2 so A=0 (non-metal) never zeroes RGB
          const prevReadFbo = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
          const fbo = gl.createFramebuffer();
          const raw = new Uint8Array(tileSize * tileSize * 4);
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
          gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, nrmRm.glTex, 0, layerIdx);
          gl.readPixels(0, 0, tileSize, tileSize, gl.RGBA, gl.UNSIGNED_BYTE, raw);
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevReadFbo);
          gl.deleteFramebuffer(fbo);

          const tmpCanvas = document.createElement('canvas');
          tmpCanvas.width = tileSize;
          tmpCanvas.height = tileSize;
          const tmpCtx = tmpCanvas.getContext('2d');
          if (!tmpCtx) return;
          const img = tmpCtx.createImageData(tileSize, tileSize);
          const d = img.data;
          const rowBytes = tileSize * 4;
          for (let y = 0; y < tileSize; y++) {
            const srcOff = (tileSize - 1 - y) * rowBytes;
            const dstOff = y * rowBytes;
            for (let x = 0; x < rowBytes; x += 4) {
              const s = srcOff + x;
              const t = dstOff + x;
              if (channel === 'normal') {
                const nx = raw[s] / 127.5 - 1;
                const ny = raw[s + 1] / 127.5 - 1;
                const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
                d[t] = raw[s];
                d[t + 1] = raw[s + 1];
                d[t + 2] = Math.round(((nz + 1) * 0.5) * 255);
                d[t + 3] = 255;
              } else {
                d[t] = raw[s + 2];
                d[t + 1] = raw[s + 3];
                d[t + 2] = 0;
                d[t + 3] = 255;
              }
            }
          }
          tmpCtx.putImageData(img, 0, 0);
          ctx.drawImage(tmpCanvas, 0, 0, canvas.width, canvas.height);
        }
      },
      dispose() {
        gl.deleteTexture(alb.glTex);
        gl.deleteTexture(nrmRm.glTex);
        alb.threeTex.dispose();
        nrmRm.threeTex.dispose();
      },
    };
  }
}

export function ensurePbrGeometryAttributes(geometry, defaultMaterialId = 0, defaultTint = [1, 1, 1], defaultAO = 1.0) {
  if (!geometry) return geometry;
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) return geometry;
  const count = posAttr.count;
  if (!geometry.getAttribute('aMaterialId')) {
    const ids = new Float32Array(count);
    ids.fill(defaultMaterialId);
    geometry.setAttribute('aMaterialId', new THREE.BufferAttribute(ids, 1));
  }
  if (!geometry.getAttribute('aTint')) {
    const tints = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      tints[i * 3] = defaultTint[0];
      tints[i * 3 + 1] = defaultTint[1];
      tints[i * 3 + 2] = defaultTint[2];
    }
    geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));
  }
  if (!geometry.getAttribute('aGeomAO')) {
    const aos = new Float32Array(count);
    aos.fill(defaultAO);
    geometry.setAttribute('aGeomAO', new THREE.BufferAttribute(aos, 1));
  }
  return geometry;
}

export function buildBeveledBoxRaw(w, h, d, _bevel = 0, materialId = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  // Recompute metric box UV (1m = 1 UV)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i) + h * 0.5;
    const z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const nz = Math.abs(nrm.getZ(i));
    if (ny >= nx && ny >= nz) uv.setXY(i, x, z);
    else if (nx >= ny && nx >= nz) uv.setXY(i, z, y);
    else uv.setXY(i, x, y);
  }
  return {
    positions: new Float32Array(pos.array),
    normals: new Float32Array(nrm.array),
    uvs: new Float32Array(uv.array),
    indices: new Uint16Array(geo.getIndex().array),
    materialId,
  };
}

export function buildBufferGeometryFromRaw(raw) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(raw.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(raw.normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(raw.uvs, 2));
  if (raw.indices) geo.setIndex(new THREE.BufferAttribute(raw.indices, 1));
  ensurePbrGeometryAttributes(geo, raw.materialId || 0);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export function createWorldPbrMaterial({
  textureArrays,
  registry,
  alphaCutout = false,
  translucent = false,
  alphaTest = 0.5,
  normalStrength = 1.0,
  macroStrength = 0.04,
  uvMultiplier = 1.0,
  fastShader = false,
  disableMicroDetail = false,
  lightingRig = null,
} = {}) {
  if (!textureArrays?.albedoArray || !textureArrays?.normalRmArray) {
    throw new TypeError('createWorldPbrMaterial requires 2-map textureArrays { albedoArray, normalRmArray }');
  }
  const reg = registry || textureArrays.registry;

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 1.0,
    side: alphaCutout ? THREE.DoubleSide : THREE.FrontSide,
    transparent: Boolean(translucent),
    depthWrite: !translucent,
    envMapIntensity: 1.0,
  });

  if (fastShader) material.defines.HG_FAST_SHADER = 1;
  if (disableMicroDetail) material.defines.HG_NO_DETAIL = 1;
  if (alphaCutout) material.defines.ALPHA_CUTOUT = 1;

  const zeroLights = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 1));
  const zeroColors = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 0));

  const uniforms = {
    uAlbedoArray: { value: textureArrays.albedoArray },
    uNormalRmArray: { value: textureArrays.normalRmArray },
    uMaterialParams: { value: reg.buildMaterialParamsArray() },
    uMaterialEmissive: { value: reg.buildMaterialEmissiveArray() },
    uNormalStrength: { value: normalStrength },
    uMacroStrength: { value: macroStrength },
    uAlphaTest: { value: alphaTest },
    uUvMultiplier: { value: uvMultiplier },
    uTorchCount: lightingRig ? lightingRig.torchCountUniform : { value: 0 },
    uTorchPosRadius: { value: lightingRig ? lightingRig.torchPosRadius : zeroLights },
    uTorchColor: { value: lightingRig ? lightingRig.torchColor : zeroColors },
  };

  material.customProgramCacheKey = () =>
    `hgame-2map-pbr-v41:${alphaCutout ? 'cut' : 'opq'}:${translucent ? 'tr' : 'solid'}:${fastShader ? 'fast' : 'hq'}:${disableMicroDetail ? 'nodet' : 'det'}`;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aMaterialId;
attribute vec3 aTint;
attribute float aGeomAO;
#ifdef USE_INSTANCING
  attribute vec4 aInstanceMeta;
  varying vec4 vPbrInstanceMeta;
#endif
varying float vPbrMatId;
varying vec2 vPbrUv;
varying vec3 vPbrWorldPos;
varying vec3 vPbrWorldNormal;
varying vec3 vPbrTint;
varying float vPbrGeomAO;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vPbrMatId = aMaterialId;
vPbrUv = uv;
vPbrTint = aTint;
vPbrGeomAO = aGeomAO;
#ifdef USE_INSTANCING
  vPbrInstanceMeta = aInstanceMeta;
#endif`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vec4 pbrWorld = vec4(transformed, 1.0);
vec3 pbrWNormal = objectNormal;
#ifdef USE_INSTANCING
  pbrWorld = instanceMatrix * pbrWorld;
  pbrWNormal = mat3(instanceMatrix) * pbrWNormal;
#endif
pbrWorld = modelMatrix * pbrWorld;
vPbrWorldPos = pbrWorld.xyz;
vPbrWorldNormal = normalize(mat3(modelMatrix) * pbrWNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform highp sampler2DArray uAlbedoArray;
uniform highp sampler2DArray uNormalRmArray;
uniform vec4 uMaterialParams[${MAX_PBR_MATERIAL_LAYERS}];
uniform vec4 uMaterialEmissive[${MAX_PBR_MATERIAL_LAYERS}];
uniform float uNormalStrength;
uniform float uMacroStrength;
uniform float uAlphaTest;
uniform float uUvMultiplier;
uniform int uTorchCount;
uniform vec4 uTorchPosRadius[8];
uniform vec4 uTorchColor[8];

varying float vPbrMatId;
varying vec2 vPbrUv;
varying vec3 vPbrWorldPos;
varying vec3 vPbrWorldNormal;
varying vec3 vPbrTint;
varying float vPbrGeomAO;
#ifdef USE_INSTANCING
  varying vec4 vPbrInstanceMeta;
#endif

mat3 pbrFastWorldTangentFrame(vec3 worldN) {
  vec3 upVec = abs(worldN.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
  vec3 T = normalize(cross(upVec, worldN));
  vec3 B = cross(worldN, T);
  return mat3(T, B, worldN);
}

mat3 pbrCotangentFrame(vec3 eyePos, vec3 surfNorm, vec2 uv) {
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
        '#include <color_fragment>',
        `int pbrLayerIdx = clamp(int(floor(vPbrMatId + 0.5)), 0, ${MAX_PBR_MATERIAL_LAYERS - 1});
float pbrLayerF = float(pbrLayerIdx);
vec4 pbrMatParam = uMaterialParams[pbrLayerIdx];
int pbrFlags = int(pbrMatParam.x + 0.5);
bool pbrIsStochastic = (pbrFlags & 1) != 0;
bool pbrIsAlphaCutout = (pbrFlags & 2) != 0;
vec2 pbrBaseUv = vPbrUv * max(0.01, pbrMatParam.y) * max(0.01, uUvMultiplier);

vec4 pbrAlbedoSample;
vec4 pbrNrmSample;
mat2 pbrUvRot = mat2(1.0, 0.0, 0.0, 1.0);

if (pbrIsStochastic) {
  vec2 tileUv = pbrBaseUv;
  vec2 cell = floor(tileUv);
  vec2 f = fract(tileUv);
  float edgeFade = sin(f.x * 3.14159265) * sin(f.y * 3.14159265);
  ivec2 ic = ivec2(cell);
  uint h0 = uint(ic.x * 374761393 + ic.y * 668265263);
  h0 = (h0 ^ (h0 >> 13u)) * 1274126177u;
  vec2 j0 = (vec2(float((h0 >> 8u) & 255u), float((h0 >> 24u) & 255u)) / 255.0 - 0.5) * 0.35;
  vec2 sUv = tileUv + j0 * (edgeFade * edgeFade);
  pbrAlbedoSample = textureGrad(uAlbedoArray, vec3(sUv, pbrLayerF), dFdx(tileUv), dFdy(tileUv));
  pbrNrmSample = textureGrad(uNormalRmArray, vec3(sUv, pbrLayerF), dFdx(tileUv), dFdy(tileUv));
} else {
  pbrAlbedoSample = texture(uAlbedoArray, vec3(pbrBaseUv, pbrLayerF));
  pbrNrmSample = texture(uNormalRmArray, vec3(pbrBaseUv, pbrLayerF));
}

if (pbrIsAlphaCutout && pbrAlbedoSample.a < uAlphaTest) {
  discard;
}

vec3 pbrTint = max(vPbrTint, vec3(0.0));
#ifdef USE_INSTANCING
  pbrTint *= (1.0 + clamp(vPbrInstanceMeta.x, -0.2, 0.2));
#endif
vec3 pbrBaseColor = pbrAlbedoSample.rgb * pbrTint;

if (pbrIsStochastic && uMacroStrength > 0.001) {
  float macroWave = sin(vPbrWorldPos.x * 0.21 + vPbrWorldPos.z * 0.17)
                  * cos(vPbrWorldPos.z * 0.27 - vPbrWorldPos.x * 0.13);
  pbrBaseColor *= (1.0 + clamp(uMacroStrength, 0.0, 0.08) * macroWave);
}

diffuseColor.rgb = pbrBaseColor;
vec4 pbrEmissiveMeta = uMaterialEmissive[pbrLayerIdx];
bool pbrIsTranslucentLayer = (pbrFlags & 8) != 0;
bool pbrHasEmissive = (pbrFlags & 16) != 0;
if (pbrIsTranslucentLayer) {
  diffuseColor.a = clamp(pbrEmissiveMeta.a, 0.08, 0.95);
}
float pbrRoughness = pbrIsTranslucentLayer ? 0.08 : clamp(pbrNrmSample.b, 0.04, 1.0);
float pbrMetalness = clamp(pbrNrmSample.a, 0.0, 1.0);
float pbrMicroAO   = mix(1.0, 0.88, pbrRoughness * pbrRoughness);
float pbrLuma = dot(pbrAlbedoSample.rgb, vec3(0.299, 0.587, 0.114));`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = pbrRoughness;`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `float metalnessFactor = pbrMetalness;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#ifndef HG_NO_DETAIL
  vec2 pbrNxy = pbrNrmSample.rg * 2.0 - 1.0;
  float pbrNz = sqrt(max(0.0, 1.0 - dot(pbrNxy, pbrNxy)));
  vec3 pbrMapN = vec3((transpose(pbrUvRot) * pbrNxy) * uNormalStrength, pbrNz);
  #ifdef HG_FAST_SHADER
    vec3 pbrWorldN = normalize(vPbrWorldNormal);
    vec3 pbrFastWorldN = normalize(pbrFastWorldTangentFrame(pbrWorldN) * pbrMapN);
    normal = normalize((viewMatrix * vec4(pbrFastWorldN, 0.0)).xyz);
  #else
    mat3 pbrTbn = pbrCotangentFrame(-vViewPosition, normal, pbrBaseUv);
    normal = normalize(pbrTbn * pbrMapN);
  #endif
#endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
if (pbrHasEmissive) {
  float pbrEmMask = smoothstep(0.28, 0.72, pbrLuma);
  totalEmissiveRadiance += pbrEmissiveMeta.rgb * mix(0.25, 1.0, pbrEmMask);
}`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
float pbrTotalAO = clamp(vPbrGeomAO * pbrMicroAO, 0.25, 1.0);
reflectedLight.indirectDiffuse *= pbrTotalAO;
#if defined(USE_ENVMAP) && defined(STANDARD)
  float pbrDotNV = saturate(dot(geometryNormal, geometryViewDir));
  reflectedLight.indirectSpecular *= computeSpecularOcclusion(pbrDotNV, pbrTotalAO, material.roughness);
#endif
for (int tlIdx = 0; tlIdx < 8; tlIdx++) {
  if (tlIdx >= uTorchCount) break;
  vec4 tp = uTorchPosRadius[tlIdx];
  vec4 tc = uTorchColor[tlIdx];
  vec3 toLight = tp.xyz - vPbrWorldPos;
  float d = length(toLight);
  if (d < tp.w) {
    float att = pow(clamp(1.0 - d / tp.w, 0.0, 1.0), 2.0);
    vec3 lDirW = toLight / max(d, 0.001);
    float ndl = max(dot(normalize(vPbrWorldNormal), lDirW), 0.15);
    reflectedLight.directDiffuse += diffuseColor.rgb * tc.rgb * (tc.a * att * ndl / 3.14159);
  }
}`,
      );
  };

  return {
    material,
    setNormalStrength(v) {
      uniforms.uNormalStrength.value = Math.max(0, v);
    },
    setMacroStrength(v) {
      uniforms.uMacroStrength.value = Math.max(0, Math.min(0.08, v));
    },
    setUvMultiplier(v) {
      uniforms.uUvMultiplier.value = Math.max(0.05, v);
    },
    syncTextureArray(nextArrays, nextRegistry) {
      uniforms.uAlbedoArray.value = nextArrays.albedoArray;
      uniforms.uNormalRmArray.value = nextArrays.normalRmArray;
      const reg2 = nextRegistry || nextArrays.registry;
      if (reg2) {
        const nextParams = reg2.buildMaterialParamsArray();
        const nextEmissive = reg2.buildMaterialEmissiveArray();
        for (let i = 0; i < MAX_PBR_MATERIAL_LAYERS; i++) {
          uniforms.uMaterialParams.value[i].copy(nextParams[i]);
          uniforms.uMaterialEmissive.value[i].copy(nextEmissive[i]);
        }
      }
    },
    dispose() {
      material.dispose();
    },
  };
}

export async function loadHdriEnvironment({ url = '/assets/cn/materials/hdri/cn_day_clear.hdr', renderer, scene, setBackground = false } = {}) {
  if (!renderer || !scene) throw new TypeError('loadHdriEnvironment requires renderer and scene');
  const hdrLoader = new HDRLoader();
  const hdrTex = await hdrLoader.loadAsync(url);
  hdrTex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envTarget = pmrem.fromEquirectangular(hdrTex);
  scene.environment = envTarget.texture;
  if (setBackground) scene.background = envTarget.texture;
  hdrTex.dispose();
  pmrem.dispose();
  return {
    texture: envTarget.texture,
    dispose() {
      if (scene.environment === envTarget.texture) scene.environment = null;
      if (scene.background === envTarget.texture) scene.background = null;
      envTarget.dispose();
    },
  };
}
