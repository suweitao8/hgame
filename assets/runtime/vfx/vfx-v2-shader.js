// HGame VFX v2 Master Shader, 1D gradient LUT atlas, procedural test textures, and low-poly meshes.

export const VFX_V2_LUT_WIDTH = 256;
export const VFX_V2_LUT_ROWS = 64;

export const VFX_GRADIENT_LUT_NAMES = Object.freeze([
  'fire',        // 0: 写实烈火（黑 -> 暗红 -> 橙黄 -> 白炽）
  'smoke',       // 1: 浓烟灰白
  'lightning',   // 2: 高压蓝白电弧
  'blood',       // 3: 写实暗红血浆
  'orangeJuice', // 4: 过审鲜橙果汁
  'limeJuice',   // 5: 过审青柠果汁/毒液
  'shield',      // 6: 能量护盾青蓝
  'gold',        // 7: 圣光/暴击金黄
]);

export const VFX_COLOR_MODES = Object.freeze({
  default: -1,
  fire: 0,
  smoke: 1,
  lightning: 2,
  blood: 3,
  orangeJuice: 4,
  limeJuice: 5,
  shield: 6,
  gold: 7,
});

const DEFAULT_GRADIENT_STOPS = [
  // 0: Realistic Fire
  [[0.0, [18, 8, 6]], [0.28, [138, 26, 8]], [0.62, [248, 128, 22]], [0.86, [255, 222, 118]], [1.0, [255, 252, 240]]],
  // 1: Heavy Smoke
  [[0.0, [24, 26, 28]], [0.45, [76, 80, 86]], [0.8, [148, 152, 158]], [1.0, [216, 220, 224]]],
  // 2: High-Voltage Arc
  [[0.0, [14, 42, 128]], [0.45, [48, 148, 255]], [0.8, [156, 228, 255]], [1.0, [244, 252, 255]]],
  // 3: Realistic Dark Crimson Blood
  [[0.0, [32, 4, 6]], [0.35, [108, 8, 14]], [0.75, [168, 16, 24]], [1.0, [215, 38, 42]]],
  // 4: Approved Fresh Orange Juice
  [[0.0, [142, 46, 4]], [0.4, [238, 110, 12]], [0.8, [255, 178, 36]], [1.0, [255, 232, 118]]],
  // 5: Approved Lime Juice / Venom
  [[0.0, [22, 74, 12]], [0.4, [76, 182, 24]], [0.8, [164, 234, 48]], [1.0, [228, 255, 134]]],
  // 6: Energy Shield Cyan
  [[0.0, [10, 56, 112]], [0.45, [32, 178, 238]], [0.82, [132, 242, 255]], [1.0, [235, 254, 255]]],
  // 7: Holy / Crit Gold
  [[0.0, [118, 62, 8]], [0.45, [232, 164, 24]], [0.82, [255, 226, 98]], [1.0, [255, 252, 220]]],
];

function sampleStopsRgb(stops, t, out, offset) {
  const u = Math.max(0, Math.min(1, t));
  if (u <= stops[0][0]) {
    const c = stops[0][1];
    out[offset] = c[0];
    out[offset + 1] = c[1];
    out[offset + 2] = c[2];
    return;
  }
  const last = stops[stops.length - 1];
  if (u >= last[0]) {
    const c = last[1];
    out[offset] = c[0];
    out[offset + 1] = c[1];
    out[offset + 2] = c[2];
    return;
  }
  for (let i = 0; i < stops.length - 1; i++) {
    const t0 = stops[i][0];
    const t1 = stops[i + 1][0];
    if (u <= t1) {
      const f = (u - t0) / Math.max(1e-6, t1 - t0);
      const c0 = stops[i][1];
      const c1 = stops[i + 1][1];
      out[offset] = Math.round(c0[0] + (c1[0] - c0[0]) * f);
      out[offset + 1] = Math.round(c0[1] + (c1[1] - c0[1]) * f);
      out[offset + 2] = Math.round(c0[2] + (c1[2] - c0[2]) * f);
      return;
    }
  }
}

/**
 * Generates raw RGBA8 data for the 256x64 1D gradient LUT atlas (Straight RGBA, flipY=false).
 * @returns {Uint8Array}
 */
export function buildVfxGradientLutBytes() {
  const bytes = new Uint8Array(VFX_V2_LUT_WIDTH * VFX_V2_LUT_ROWS * 4);
  for (let row = 0; row < VFX_V2_LUT_ROWS; row++) {
    const stops = DEFAULT_GRADIENT_STOPS[row % DEFAULT_GRADIENT_STOPS.length];
    const rowBase = row * VFX_V2_LUT_WIDTH * 4;
    for (let x = 0; x < VFX_V2_LUT_WIDTH; x++) {
      const off = rowBase + x * 4;
      sampleStopsRgb(stops, x / (VFX_V2_LUT_WIDTH - 1), bytes, off);
      bytes[off + 3] = 255;
    }
  }
  return bytes;
}

/**
 * Creates a Three.js DataTexture for the 256x64 1D gradient LUT atlas.
 * @param {object} THREE
 * @returns {object | null}
 */
export function createVfxGradientLutTexture(THREE) {
  if (!THREE?.DataTexture) return null;
  const bytes = buildVfxGradientLutBytes();
  const tex = new THREE.DataTexture(bytes, VFX_V2_LUT_WIDTH, VFX_V2_LUT_ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.premultiplyAlpha = false;
  if (THREE.NoColorSpace !== undefined) tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function hash2i(ix, iy, period) {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  let n = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function tileableValueNoise(u, v, freq) {
  const fx = u * freq;
  const fy = v * freq;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2i(ix, iy, freq);
  const b = hash2i(ix + 1, iy, freq);
  const c = hash2i(ix, iy + 1, freq);
  const d = hash2i(ix + 1, iy + 1, freq);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

function fbmTileable(u, v, baseFreq = 4) {
  return (
    tileableValueNoise(u, v, baseFreq) * 0.55 +
    tileableValueNoise(u, v, baseFreq * 2) * 0.28 +
    tileableValueNoise(u, v, baseFreq * 4) * 0.17
  );
}

function makeDataTex(THREE, bytes, width, height, { repeat = false, srgb = false, flipY = false } = {}) {
  const tex = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.flipY = flipY;
  tex.premultiplyAlpha = false;
  if (srgb && THREE.SRGBColorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
  else if (!srgb && THREE.NoColorSpace !== undefined) tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates procedural default test textures (4x4 fire/smoke flipbook, channel-packed noise, soft disc, slash arc)
 * so v2 benchmark presets run cleanly without external Unreal assets.
 * @param {object} THREE
 */
export function createVfxV2DefaultTextures(THREE) {
  if (!THREE?.DataTexture) return null;

  // 1. 256x256 4x4 fire->smoke organic flipbook (top row = frame 0..3 when flipY=true)
  const fbSize = 256;
  const cols = 4;
  const rows = 4;
  const cell = fbSize / cols;
  const fbBytes = new Uint8Array(fbSize * fbSize * 4);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const frameIdx = row * cols + col;
      const t = frameIdx / (cols * rows - 1);
      for (let py = 0; py < cell; py++) {
        for (let px = 0; px < cell; px++) {
          const u = (px + 0.5) / cell;
          const v = (py + 0.5) / cell;
          const dx = u - 0.5;
          const dy = v - 0.5;
          const dist = Math.hypot(dx, dy) * 2.0;
          const n = fbmTileable(u + t * 0.18, v - t * 0.32, 4);
          const radius = 0.42 + t * 0.42;
          const mask = Math.max(0, Math.min(1, (radius + (n - 0.5) * 0.48 - dist) * 3.0));
          const core = Math.max(0, Math.min(1, mask * (0.45 + 0.55 * n) * (1.0 - t * 0.35)));
          const gx = col * cell + px;
          const gy = row * cell + py;
          const off = (gy * fbSize + gx) * 4;
          const lum = Math.round(Math.max(0, Math.min(1, core + 0.28 * mask * n)) * 255);
          fbBytes[off] = lum;
          fbBytes[off + 1] = lum;
          fbBytes[off + 2] = lum;
          fbBytes[off + 3] = Math.round(mask * (1.0 - Math.pow(t, 2.5) * 0.65) * 255);
        }
      }
    }
  }

  // 2. 128x128 Channel-Packed Noise (R: radial/streak mask, G: dissolve noise, B: UV distortion)
  const nSize = 128;
  const nBytes = new Uint8Array(nSize * nSize * 4);
  for (let y = 0; y < nSize; y++) {
    const v = (y + 0.5) / nSize;
    for (let x = 0; x < nSize; x++) {
      const u = (x + 0.5) / nSize;
      const mask = Math.max(0, Math.min(1, Math.sin(v * Math.PI) * (0.6 + 0.4 * fbmTileable(u * 2.0, v, 4))));
      const dissolveN = fbmTileable(u, v, 4);
      const distortN = fbmTileable(u + 0.37, v + 0.61, 6);
      const off = (y * nSize + x) * 4;
      nBytes[off] = Math.round(mask * 255);
      nBytes[off + 1] = Math.round(dissolveN * 255);
      nBytes[off + 2] = Math.round(distortN * 255);
      nBytes[off + 3] = 255;
    }
  }

  // 3. 64x64 Soft radial disc / droplet
  const dSize = 64;
  const dBytes = new Uint8Array(dSize * dSize * 4);
  for (let y = 0; y < dSize; y++) {
    const dy = (y + 0.5) / dSize - 0.5;
    for (let x = 0; x < dSize; x++) {
      const dx = (x + 0.5) / dSize - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2.0);
      const a = Math.pow(Math.max(0, 1 - r), 1.8);
      const c = Math.round(Math.min(1, 0.45 + 0.55 * (1 - r)) * 255);
      const off = (y * dSize + x) * 4;
      dBytes[off] = c;
      dBytes[off + 1] = c;
      dBytes[off + 2] = c;
      dBytes[off + 3] = Math.round(a * 255);
    }
  }

  // 4. 128x128 Slash arc streak texture
  const sSize = 128;
  const sBytes = new Uint8Array(sSize * sSize * 4);
  for (let y = 0; y < sSize; y++) {
    const v = (y + 0.5) / sSize;
    const edgeV = Math.sin(v * Math.PI);
    const blade = Math.pow(edgeV, 1.4);
    for (let x = 0; x < sSize; x++) {
      const u = (x + 0.5) / sSize;
      const sweep = Math.sin(u * Math.PI);
      const streak = 0.65 + 0.35 * fbmTileable(u * 1.5, v * 4.0, 4);
      const val = Math.max(0, Math.min(1, blade * Math.pow(sweep, 0.7) * streak));
      const off = (y * sSize + x) * 4;
      const b = Math.round(val * 255);
      sBytes[off] = b;
      sBytes[off + 1] = b;
      sBytes[off + 2] = b;
      sBytes[off + 3] = Math.round(Math.min(1, val * 1.3) * 255);
    }
  }

  const textures = {
    fire_flipbook: makeDataTex(THREE, fbBytes, fbSize, fbSize, { repeat: false, srgb: false, flipY: true }),
    noise_packed: makeDataTex(THREE, nBytes, nSize, nSize, { repeat: true, srgb: false, flipY: false }),
    soft_disc: makeDataTex(THREE, dBytes, dSize, dSize, { repeat: false, srgb: false, flipY: false }),
    slash_arc: makeDataTex(THREE, sBytes, sSize, sSize, { repeat: true, srgb: false, flipY: false }),
  };

  return {
    textures,
    resolve(keyOrPath) {
      if (!keyOrPath) return null;
      const s = String(keyOrPath).toLowerCase();
      if (s.includes('flipbook') || s.includes('fire')) return textures.fire_flipbook;
      if (s.includes('noise')) return textures.noise_packed;
      if (s.includes('slash') || s.includes('arc')) return textures.slash_arc;
      return textures.soft_disc;
    },
    dispose() {
      for (const tex of Object.values(textures)) tex.dispose?.();
    },
  };
}

function buildCurvedSlashArcGeometry(THREE, innerR = 0.62, outerR = 1.0, arcRad = Math.PI * 1.15, segs = 28) {
  const pos = new Float32Array((segs + 1) * 2 * 3);
  const norm = new Float32Array((segs + 1) * 2 * 3);
  const uv = new Float32Array((segs + 1) * 2 * 2);
  const indices = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const ang = (t - 0.5) * arcRad;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const taper = Math.sin(t * Math.PI);
    const rIn = innerR + (1 - taper) * (outerR - innerR) * 0.45;
    const vBase = i * 6;
    pos[vBase] = ca * rIn;
    pos[vBase + 1] = (t - 0.5) * 0.14;
    pos[vBase + 2] = sa * rIn;
    pos[vBase + 3] = ca * outerR;
    pos[vBase + 4] = (t - 0.5) * 0.14;
    pos[vBase + 5] = sa * outerR;

    norm[vBase] = 0; norm[vBase + 1] = 1; norm[vBase + 2] = 0;
    norm[vBase + 3] = 0; norm[vBase + 4] = 1; norm[vBase + 5] = 0;

    const uBase = i * 4;
    uv[uBase] = t; uv[uBase + 1] = 0;
    uv[uBase + 2] = t; uv[uBase + 3] = 1;

    if (i < segs) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Builds reusable low-poly VFX geometries for sprite/mesh emitters.
 * @param {object} THREE
 */
export function createVfxV2MeshGeometries(THREE) {
  if (!THREE?.BufferGeometry) return null;
  const quad = new THREE.PlaneGeometry(1, 1);
  const ring = new THREE.RingGeometry(0.68, 1.0, 32, 1);
  ring.rotateX(-Math.PI * 0.5);
  const arc = buildCurvedSlashArcGeometry(THREE);
  const sphere = new THREE.SphereGeometry(1, 20, 14);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const shard = new THREE.OctahedronGeometry(0.5, 0);
  shard.scale(0.85, 1.35, 0.55);

  const map = { quad, ring, arc, sphere, cube, shard };
  return {
    get(kind) {
      return map[kind] || map.quad;
    },
    dispose() {
      for (const g of Object.values(map)) g.dispose?.();
    },
  };
}

/**
 * Computes active shader macro list for a material config & quality tier.
 * @param {object} [materialCfg]
 * @param {'high' | 'med' | 'low'} [qualityTier='high']
 */
export function getVfxMasterDefines(materialCfg = {}, qualityTier = 'high') {
  const mat = materialCfg || {};
  /** @type {Record<string, number>} */
  const defines = {};
  if (mat.flipbook && (Number(mat.flipbook.cols) > 1 || Number(mat.flipbook.rows) > 1)) {
    defines.USE_FLIPBOOK = 1;
  }
  if (
    mat.noiseTex ||
    (Array.isArray(mat.uvScroll) && (mat.uvScroll[0] !== 0 || mat.uvScroll[1] !== 0)) ||
    (Array.isArray(mat.noiseScroll) && (mat.noiseScroll[0] !== 0 || mat.noiseScroll[1] !== 0)) ||
    Number(mat.distortionStrength) > 0 ||
    Number(mat.dissolveEdgeWidth) > 0
  ) {
    defines.USE_NOISE_DISSOLVE = 1;
  }
  if (Number.isFinite(mat.lutRow) && Number(mat.lutRow) >= 0) {
    defines.USE_GRADIENT_LUT = 1;
  }
  if (Number(mat.fresnelPower) > 0.01) {
    defines.USE_MESH_FRESNEL = 1;
  }
  if (qualityTier === 'high' && Number(mat.softParticleDepth) > 0.001) {
    defines.USE_SOFT_PARTICLES = 1;
  }
  return defines;
}

export const VFX_MASTER_VERTEX_GLSL = /* glsl */ `
precision highp float;

attribute vec4 aCustom; // x=age01, y=seed, z=dissolve, w=additive

uniform float uTime;
uniform vec2 uUvScroll;
uniform float uCameraOffset;

varying vec2 vUv;
varying vec4 vCustom;
varying vec3 vNormalView;
varying vec3 vViewPos;

void main() {
  vCustom = aCustom;
  vUv = uv + uUvScroll * uTime;

  vec4 localPos = vec4(position, 1.0);
  vec3 localNormal = normal;
  #ifdef USE_INSTANCING
    localPos = instanceMatrix * localPos;
    localNormal = mat3(instanceMatrix) * localNormal;
  #endif

  vec4 mvPos = modelViewMatrix * localPos;
  if (uCameraOffset > 0.0001) {
    float viewLen = length(mvPos.xyz);
    if (viewLen > 0.001) {
      mvPos.xyz += (-mvPos.xyz / viewLen) * uCameraOffset;
    }
  }
  vViewPos = -mvPos.xyz;
  vNormalView = normalize(normalMatrix * localNormal);
  gl_Position = projectionMatrix * mvPos;
}
`;

export const VFX_MASTER_FRAGMENT_GLSL = /* glsl */ `
precision highp float;

uniform sampler2D uMainTex;
uniform float uHasMainTex;
uniform sampler2D uNoiseTex;
uniform float uHasNoiseTex;
uniform sampler2D uGradientLut;
uniform sampler2D uDepthTex;
uniform float uHasDepthTex;

uniform float uTime;
uniform vec2 uNoiseScroll;
uniform float uDistortionStrength;
uniform float uDissolveEdgeWidth;
uniform vec3 uDissolveEdgeColor;
uniform float uEmissiveBoost;
uniform float uLutRow;
uniform vec3 uTint;
uniform float uFresnelPower;
uniform float uSoftParticleDepth;
uniform float uBlendMode; // 0=alpha, 1=additive, 2=pma
uniform float uOpacityScale;
uniform vec2 uInvViewport;
uniform vec2 uCameraProj; // x=near, y=far

uniform vec4 uFlipbook;      // x=cols, y=rows, z=fps, w=frameBlend
uniform vec4 uFlipbookExtra; // x=randomStart, y=totalFrames, z=fpsCyclesScale, w=loop

varying vec2 vUv;
varying vec4 vCustom;
varying vec3 vNormalView;
varying vec3 vViewPos;

#ifdef USE_FLIPBOOK
vec2 computeFlipbookCellUv(float frameIdx, vec2 cellUv, float cols, float rows) {
  float col = mod(frameIdx, cols);
  float row = floor(frameIdx / cols);
  return vec2(
    (col + cellUv.x) / cols,
    (rows - 1.0 - row + cellUv.y) / rows
  );
}

vec4 sampleFlipbookMain(vec2 localUv) {
  float cols = max(1.0, uFlipbook.x);
  float rows = max(1.0, uFlipbook.y);
  float total = max(1.0, uFlipbookExtra.y);
  float startOff = uFlipbookExtra.x > 0.5 ? floor(vCustom.y * total) : 0.0;
  float cycles = uFlipbookExtra.z > 0.0 ? uFlipbookExtra.z : total;
  float rawFrame = vCustom.x * cycles + startOff;
  float framePos = uFlipbookExtra.w > 0.5 ? mod(rawFrame, total) : clamp(rawFrame, 0.0, total - 1.0);
  float f0 = floor(framePos);
  vec4 c0 = texture2D(uMainTex, computeFlipbookCellUv(f0, localUv, cols, rows));
  if (uFlipbook.w > 0.5) {
    float f1 = uFlipbookExtra.w > 0.5 ? mod(f0 + 1.0, total) : min(f0 + 1.0, total - 1.0);
    vec4 c1 = texture2D(uMainTex, computeFlipbookCellUv(f1, localUv, cols, rows));
    return mix(c0, c1, fract(framePos));
  }
  return c0;
}
#endif

#ifdef USE_SOFT_PARTICLES
float linearizeViewDepth(float rawDepth) {
  float zNdc = rawDepth * 2.0 - 1.0;
  return (2.0 * uCameraProj.x * uCameraProj.y) /
    max(0.0001, (uCameraProj.y + uCameraProj.x - zNdc * (uCameraProj.y - uCameraProj.x)));
}
#endif

void main() {
  vec2 mainUv = fract(vUv);
  float auxMask = 1.0;
  float dissolveNoise = 0.5;
  float hotBand = 0.0;

  #ifdef USE_NOISE_DISSOLVE
    if (uHasNoiseTex > 0.5) {
      vec2 nUv = vUv + uNoiseScroll * uTime + vec2(vCustom.y * 0.37, vCustom.y * 0.73);
      vec4 nSample = texture2D(uNoiseTex, nUv);
      auxMask = nSample.r;
      dissolveNoise = nSample.g;
      float distort = nSample.b - 0.5;
      mainUv = clamp(mainUv + vec2(distort, nSample.g - 0.5) * uDistortionStrength, vec2(0.001), vec2(0.999));
    }
  #endif

  vec4 texCol = vec4(1.0);
  if (uHasMainTex > 0.5) {
    #ifdef USE_FLIPBOOK
      texCol = sampleFlipbookMain(mainUv);
    #else
      texCol = texture2D(uMainTex, mainUv);
    #endif
  }

  vec3 baseRgb = texCol.rgb;
  float alpha = texCol.a * uOpacityScale;

  #ifdef USE_NOISE_DISSOLVE
    alpha *= mix(1.0, auxMask, step(0.5, uHasNoiseTex) * 0.25);
    float cut = clamp(vCustom.z, 0.0, 1.0);
    if (cut > 0.001) {
      float edgeW = max(0.015, uDissolveEdgeWidth);
      float edgeMask = smoothstep(cut, cut + edgeW, dissolveNoise);
      alpha *= edgeMask;
      hotBand = edgeMask * (1.0 - smoothstep(cut + edgeW, cut + edgeW * 2.3, dissolveNoise));
    }
  #endif

  #ifdef USE_GRADIENT_LUT
    if (uLutRow >= -0.5) {
      float lum = clamp(dot(texCol.rgb, vec3(0.299, 0.587, 0.114)), 0.002, 0.998);
      float rowV = (uLutRow + 0.5) / 64.0;
      baseRgb = texture2D(uGradientLut, vec2(lum, rowV)).rgb;
    }
  #endif

  float emissiveScale = (uBlendMode > 1.5)
    ? mix(1.0, max(1.0, uEmissiveBoost), clamp(vCustom.w, 0.0, 1.0))
    : max(0.0, uEmissiveBoost);
  vec3 finalRgb = baseRgb * uTint * emissiveScale;

  #ifdef USE_NOISE_DISSOLVE
    finalRgb += uDissolveEdgeColor * max(1.0, uEmissiveBoost) * hotBand;
  #endif

  #ifdef USE_MESH_FRESNEL
    vec3 N = normalize(vNormalView);
    vec3 V = normalize(vViewPos);
    float ndotv = clamp(abs(dot(N, V)), 0.0, 1.0);
    float fresnel = pow(1.0 - ndotv, max(0.25, uFresnelPower));
    finalRgb += uTint * (fresnel * max(1.0, uEmissiveBoost));
    alpha = clamp(alpha * (0.2 + 0.8 * fresnel), 0.0, 1.0);
  #endif

  #ifdef USE_SOFT_PARTICLES
    if (uHasDepthTex > 0.5 && uSoftParticleDepth > 0.001) {
      vec2 screenUv = gl_FragCoord.xy * uInvViewport;
      float rawDepth = texture2D(uDepthTex, screenUv).r;
      if (rawDepth < 0.99999) {
        float sceneZ = linearizeViewDepth(rawDepth);
        float partZ = abs(vViewPos.z);
        float softFade = clamp((sceneZ - partZ) / uSoftParticleDepth, 0.0, 1.0);
        alpha *= softFade;
      }
    }
  #endif

  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha < 0.004) discard;

  if (uBlendMode > 1.5) {
    // PMA single-drawcall Fire(additive=1) -> Smoke(additive=0)
    gl_FragColor = vec4(finalRgb * alpha, alpha * (1.0 - clamp(vCustom.w, 0.0, 1.0)));
  } else if (uBlendMode > 0.5) {
    gl_FragColor = vec4(finalRgb * alpha, alpha);
  } else {
    gl_FragColor = vec4(finalRgb, alpha);
  }
}
`;

/**
 * Instantiates a configured Three.js ShaderMaterial using VFX Master Shader v2.
 * @param {any} THREE
 * @param {Record<string, any>} [materialCfg]
 * @param {{ qualityTier?: 'high' | 'med' | 'low', mainTex?: any, noiseTex?: any, gradientLut?: any, depthTex?: any, avgLifetime?: number }} [options]
 */
export function createVfxMasterMaterial(THREE, materialCfg = {}, {
  qualityTier = 'high',
  mainTex = null,
  noiseTex = null,
  gradientLut = null,
  depthTex = null,
  avgLifetime = 1.0,
} = {}) {
  const mat = materialCfg || {};
  const defines = getVfxMasterDefines(mat, qualityTier);
  const blendModeStr = mat.blendMode || 'alpha';
  const blendIdx = blendModeStr === 'pma' ? 2 : blendModeStr === 'additive' ? 1 : 0;
  const cols = Math.max(1, Number(mat.flipbook?.cols) || 1);
  const rows = Math.max(1, Number(mat.flipbook?.rows) || 1);
  const totalFrames = cols * rows;
  const fps = Math.max(0, Number(mat.flipbook?.fps) || 0);
  const fpsCyclesScale = fps > 0 ? fps * Math.max(0.05, avgLifetime) : totalFrames;

  const uniforms = {
    uMainTex: { value: mainTex },
    uHasMainTex: { value: mainTex ? 1.0 : 0.0 },
    uNoiseTex: { value: noiseTex },
    uHasNoiseTex: { value: noiseTex ? 1.0 : 0.0 },
    uGradientLut: { value: gradientLut },
    uDepthTex: { value: depthTex },
    uHasDepthTex: { value: depthTex ? 1.0 : 0.0 },
    uTime: { value: 0.0 },
    uUvScroll: { value: new THREE.Vector2(Number(mat.uvScroll?.[0]) || 0, Number(mat.uvScroll?.[1]) || 0) },
    uNoiseScroll: { value: new THREE.Vector2(Number(mat.noiseScroll?.[0]) || 0, Number(mat.noiseScroll?.[1]) || 0) },
    uDistortionStrength: { value: Number(mat.distortionStrength) || 0 },
    uDissolveEdgeWidth: { value: Number(mat.dissolveEdgeWidth) || 0.1 },
    uDissolveEdgeColor: {
      value: new THREE.Vector3(
        Number(mat.dissolveEdgeColor?.[0] ?? 4.0),
        Number(mat.dissolveEdgeColor?.[1] ?? 1.4),
        Number(mat.dissolveEdgeColor?.[2] ?? 0.25),
      ),
    },
    uEmissiveBoost: { value: Number(mat.emissiveBoost ?? 1.0) },
    uLutRow: { value: Number.isFinite(mat.lutRow) ? Number(mat.lutRow) : -1.0 },
    uTint: {
      value: new THREE.Vector3(
        Number(mat.tint?.[0] ?? 1.0),
        Number(mat.tint?.[1] ?? 1.0),
        Number(mat.tint?.[2] ?? 1.0),
      ),
    },
    uFresnelPower: { value: Number(mat.fresnelPower) || 0 },
    uSoftParticleDepth: { value: Number(mat.softParticleDepth) || 0 },
    uBlendMode: { value: blendIdx },
    uOpacityScale: { value: 1.0 },
    uCameraOffset: { value: Number(mat.cameraOffset) || 0 },
    uInvViewport: { value: new THREE.Vector2(1 / 960, 1 / 540) },
    uCameraProj: { value: new THREE.Vector2(0.05, 500) },
    uFlipbook: {
      value: new THREE.Vector4(
        cols,
        rows,
        fps,
        mat.flipbook?.frameBlend !== false ? 1.0 : 0.0,
      ),
    },
    uFlipbookExtra: {
      value: new THREE.Vector4(
        mat.flipbook?.randomStart ? 1.0 : 0.0,
        totalFrames,
        fpsCyclesScale,
        mat.flipbook?.loop ? 1.0 : 0.0,
      ),
    },
  };

  const material = new THREE.ShaderMaterial({
    defines,
    uniforms,
    vertexShader: VFX_MASTER_VERTEX_GLSL,
    fragmentShader: VFX_MASTER_FRAGMENT_GLSL,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: mat.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });

  if (blendModeStr === 'pma') {
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendEquation = THREE.AddEquation;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    material.blendEquationAlpha = THREE.AddEquation;
  } else if (blendModeStr === 'additive') {
    material.blending = THREE.AdditiveBlending;
  } else {
    material.blending = THREE.NormalBlending;
  }

  return {
    material,
    defines,
    variantKey: Object.keys(defines).sort().join('+') || 'BASE',
  };
}
