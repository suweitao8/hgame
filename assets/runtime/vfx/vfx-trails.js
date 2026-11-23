import {
  VFX_RENDER_ORDERS,
  createVisualPrng,
  packRgb24,
  submitRingBufferRanges,
  unpackRgb24Into,
} from './vfx-core.js';
import { evaluateColorCurve, evaluateSizeCurve } from './vfx-atlas-particles.js';
import {
  VFX_COMMON_GLSL,
  VFX_UBER_LUT_GLSL,
  VFX_UBER_FRAGMENT_GLSL,
  createUberMaterialLut,
} from './vfx-shader-chunks.js';

export const SLASH_VERTEX_GLSL = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec2 uv;
attribute vec4 aSlashP0; // x, y, z, spawnTime
attribute vec4 aSlashP1; // yawRad, sweepRad, radius, duration
attribute vec4 aSlashP2; // rgb24, innerRatio, flipDir, thickness

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform float uTime;
uniform float uIs2D;

varying vec2 vUv;
varying vec3 vColor;
varying float vProgress;
varying float vSweep;
varying float vInner;
varying float vFlip;
varying float vThickness;

vec3 unpackRgb24(float v) {
  float r = floor(v / 65536.0);
  float rem = v - r * 65536.0;
  float g = floor(rem / 256.0);
  float b = rem - g * 256.0;
  return vec3(r, g, b) / 255.0;
}

void main() {
  float age = uTime - aSlashP0.w;
  float dur = aSlashP1.w;
  if (dur <= 0.0 || age < 0.0 || age >= dur) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vProgress = age / dur;
  vUv = uv * 2.0 - 1.0;
  vColor = unpackRgb24(aSlashP2.x);
  vSweep = aSlashP1.y;
  vInner = aSlashP2.y;
  vFlip = aSlashP2.z;
  vThickness = aSlashP2.w;

  float yaw = aSlashP1.x;
  float radius = aSlashP1.z;
  float c = cos(yaw);
  float s = sin(yaw);
  vec2 local = position.xy * (radius * 2.0);

  vec3 worldPos;
  if (uIs2D > 0.5) {
    worldPos = vec3(
      aSlashP0.x + local.x * c - local.y * s,
      aSlashP0.y + local.x * s + local.y * c,
      aSlashP0.z
    );
  } else {
    worldPos = vec3(
      aSlashP0.x + local.x * c - local.y * s,
      aSlashP0.y,
      aSlashP0.z + local.x * s + local.y * c
    );
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
}
`;

export const SLASH_FRAGMENT_GLSL = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec3 vColor;
varying float vProgress;
varying float vSweep;
varying float vInner;
varying float vFlip;
varying float vThickness;

void main() {
  float r = length(vUv);
  if (r > 1.0 || r < vInner * 0.7) discard;

  float ang = atan(vUv.y, vUv.x);
  float normAng = clamp((ang + vSweep * 0.5) / max(0.01, vSweep), 0.0, 1.0);
  if (vFlip > 0.5) normAng = 1.0 - normAng;

  float u = 1.0 - vProgress;
  float head = 1.0 - u * u * u * u * u;
  float tail = smoothstep(0.15, 1.0, vProgress) * 0.92;
  if (normAng > head || normAng < tail) discard;

  float arcT = (normAng - tail) / max(0.001, head - tail);
  float bandWidth = (1.0 - vInner) * mix(0.25, 1.0, arcT) * vThickness;
  float midR = mix(vInner + bandWidth * 0.5, 0.96 - bandWidth * 0.5, arcT);
  float radial = 1.0 - smoothstep(bandWidth * 0.35, bandWidth * 0.65, abs(r - midR));

  float streak = 0.78 + 0.22 * sin(r * 38.0 + normAng * 12.0);
  float edgeHot = smoothstep(midR, 0.98, r) * arcT;
  float alpha = radial * streak * (1.0 - vProgress * vProgress) * smoothstep(0.0, 0.2, arcT);
  if (alpha < 0.01) discard;

  vec3 col = mix(vColor, vec3(1.0), edgeHot * 0.75);
  gl_FragColor = vec4(col, alpha);
}
`;

export const LIGHTNING_VERTEX_GLSL = /* glsl */ `
precision highp float;

attribute vec3 position; // x in [0..1] along bolt, y in [-0.5..0.5] across width
attribute vec4 aBoltP0;  // x0, y0, z0, spawnTime
attribute vec4 aBoltP1;  // x1, y1, z1, duration
attribute vec4 aBoltP2;  // rgb24, thickness, seed, jitterAmp

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform float uTime;
uniform float uIs2D;

varying vec2 vBoltUv;
varying vec3 vColor;
varying float vAlpha;

vec3 unpackRgb24(float v) {
  float r = floor(v / 65536.0);
  float rem = v - r * 65536.0;
  float g = floor(rem / 256.0);
  float b = rem - g * 256.0;
  return vec3(r, g, b) / 255.0;
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

void main() {
  float age = uTime - aBoltP0.w;
  float dur = aBoltP1.w;
  if (dur <= 0.0 || age < 0.0 || age >= dur) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  float t = age / dur;
  vAlpha = 1.0 - t * t;
  vBoltUv = vec2(position.x, position.y + 0.5);
  vColor = unpackRgb24(aBoltP2.x);

  vec3 a = aBoltP0.xyz;
  vec3 b = aBoltP1.xyz;
  vec3 seg = b - a;
  float len = max(0.001, length(seg));
  vec3 dir = seg / len;

  float stepFrame = floor(uTime * 35.0) + aBoltP2.z * 97.0;
  float segId = floor(position.x * 16.0);
  float n1 = hash11(segId * 13.7 + stepFrame * 7.3) * 2.0 - 1.0;
  float n2 = hash11(segId * 29.1 + stepFrame * 11.9) * 2.0 - 1.0;
  float env = sin(position.x * 3.14159265);
  float amp = aBoltP2.w * env * min(1.0, len * 0.35);

  vec3 side = (uIs2D > 0.5)
    ? vec3(-dir.y, dir.x, 0.0)
    : normalize(cross(dir, vec3(0.0, 1.0, 0.001)));
  vec3 up = (uIs2D > 0.5)
    ? vec3(0.0, 0.0, 1.0)
    : cross(side, dir);

  vec3 center = mix(a, b, position.x) + side * (n1 * amp) + up * (n2 * amp * 0.45);
  vec3 worldPos = center + side * (position.y * aBoltP2.y * (1.0 - t * 0.35));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
}
`;

export const LIGHTNING_FRAGMENT_GLSL = /* glsl */ `
precision highp float;

varying vec2 vBoltUv;
varying vec3 vColor;
varying float vAlpha;

void main() {
  float d = abs(vBoltUv.y - 0.5) * 2.0;
  float core = exp(-7.5 * d * d);
  float glow = exp(-2.4 * d * d) * 0.7;
  float alpha = (core + glow) * vAlpha;
  if (alpha < 0.01) discard;
  vec3 col = mix(vColor, vec3(1.0), core * 0.85);
  gl_FragColor = vec4(col, alpha);
}
`;

export const RIBBON_VERTEX_GLSL = /* glsl */ `
precision highp float;

attribute vec3 position; // x in [-0.5..0.5] along segment, y in [-0.5..0.5] across width
attribute vec4 aSegA;    // x0, y0, z0, t0 (head-to-tail [0..1])
attribute vec4 aSegB;    // x1, y1, z1, t1
attribute vec4 aSegMeta; // rgb24, width, alpha0, alpha1
attribute vec4 aSegExtra; // endRgb24, widthScale0, widthScale1, hdr
attribute vec4 aSegUvRect; // u0, v0, u1, v1 (atlas UV override, z<=x means use uTrailUvRect)
attribute float aSegMatRow;
attribute vec4 aSegTanA; // tanAx, tanAy, tanAz, texScaleX
attribute vec4 aSegTanB; // tanBx, tanBy, tanBz, texScaleY
attribute vec4 aSegCustom1;

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform float uIs2D;

varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vHdr;
varying vec4 vUvRect;
varying float vUberMatRow;
varying vec4 vCustom1;
varying vec3 vNormalView;
varying vec3 vViewDirView;

vec3 unpackRgb24(float v) {
  float r = floor(v / 65536.0);
  float rem = v - r * 65536.0;
  float g = floor(rem / 256.0);
  float b = rem - g * 256.0;
  return vec3(r, g, b) / 255.0;
}

void main() {
  float w = aSegMeta.y;
  if (w <= 0.0001 || (aSegMeta.z <= 0.001 && aSegMeta.w <= 0.001)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  float u = clamp(position.x + 0.5, 0.0, 1.0);
  float spanT = mix(aSegA.w, aSegB.w, u);
  vUv = aSegMatRow > -0.5
    ? vec2(spanT * aSegTanA.w, (position.y + 0.5) * aSegTanB.w)
    : vec2(mix(0.76, 0.24, spanT), position.y + 0.5);
  vec3 c0 = unpackRgb24(aSegMeta.x);
  vec3 c1 = unpackRgb24(aSegExtra.x);
  vColor = mix(c0, c1, u);
  vAlpha = mix(aSegMeta.z, aSegMeta.w, u);
  vHdr = aSegExtra.w;
  vUvRect = aSegUvRect;
  vUberMatRow = aSegMatRow;
  vCustom1 = aSegCustom1;

  vec3 a = aSegA.xyz;
  vec3 b = aSegB.xyz;
  vec3 seg = b - a;
  float len = length(seg);
  if (len <= 0.0001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  if (uIs2D > 0.5) {
    vec2 dir2 = seg.xy / len;
    vec2 tA = length(aSegTanA.xy) > 0.0001 ? normalize(aSegTanA.xy) : dir2;
    vec2 tB = length(aSegTanB.xy) > 0.0001 ? normalize(aSegTanB.xy) : dir2;
    vec2 sideA = vec2(-tA.y, tA.x);
    vec2 sideB = vec2(-tB.y, tB.x);
    vec3 pA = a + vec3(sideA * (position.y * w * aSegExtra.y), 0.0);
    vec3 pB = b + vec3(sideB * (position.y * w * aSegExtra.z), 0.0);
    vec3 worldPos = mix(pA, pB, u);
    vNormalView = vec3(0.0, 0.0, 1.0);
    vViewDirView = vec3(0.0, 0.0, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
  } else {
    vec4 mvA = modelViewMatrix * vec4(a, 1.0);
    vec4 mvB = modelViewMatrix * vec4(b, 1.0);
    vec2 vdir = mvB.xy - mvA.xy;
    float vlen = length(vdir);
    vec2 fallbackSide = vlen > 0.0001 ? (vec2(-vdir.y, vdir.x) / vlen) : vec2(1.0, 0.0);
    vec2 vtA = (mat3(modelViewMatrix) * aSegTanA.xyz).xy;
    vec2 vtB = (mat3(modelViewMatrix) * aSegTanB.xyz).xy;
    float ltA = length(vtA);
    float ltB = length(vtB);
    vec2 vsideA = ltA > 0.0001 ? (vec2(-vtA.y, vtA.x) / ltA) : fallbackSide;
    vec2 vsideB = ltB > 0.0001 ? (vec2(-vtB.y, vtB.x) / ltB) : fallbackSide;
    float tipKeep = smoothstep(0.001, 0.012, w);
    float wA = max(w * aSegExtra.y, abs(mvA.z) * 0.0038 * max(0.16, 1.0 - aSegA.w * 0.84) * tipKeep * min(1.0, aSegExtra.y * 4.0));
    float wB = max(w * aSegExtra.z, abs(mvB.z) * 0.0038 * max(0.16, 1.0 - aSegB.w * 0.84) * tipKeep * min(1.0, aSegExtra.z * 4.0));
    vec2 edgeA = mvA.xy + vsideA * (position.y * wA);
    vec2 edgeB = mvB.xy + vsideB * (position.y * wB);
    vec4 mvPos = mix(mvA, mvB, u);
    mvPos.xy = mix(edgeA, edgeB, u);
    vNormalView = vec3(0.0, 0.0, 1.0);
    vViewDirView = -mvPos.xyz;
    gl_Position = projectionMatrix * mvPos;
  }
}
`;

export const RIBBON_FRAGMENT_GLSL = /* glsl */ `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
precision highp float;

uniform sampler2D uTrailTex;
uniform sampler2D uMaterialLut;
uniform sampler2D uAtlasTex;
uniform float uTime;
uniform float uHasAtlas;
uniform float uFlipV;
uniform float uHasTrailTex;
uniform float uTrailFlipV;
uniform vec4 uTrailUvRect;
uniform sampler2D uSoftDepthTex;
uniform float uHasSoftDepth;
uniform float uSoftFade;
uniform float uIsMultiply;
uniform float uIsPremultiply;
uniform float uIsAdditive;
uniform vec2 uInvViewport;
uniform vec2 uCamNearFar;
uniform vec4 uCustom1;
uniform vec4 uCustom2;

varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vHdr;
varying vec4 vUvRect;
varying float vUberMatRow;
varying vec4 vCustom1;
varying vec3 vNormalView;
varying vec3 vViewDirView;

${VFX_COMMON_GLSL}
${VFX_UBER_LUT_GLSL}
${VFX_UBER_FRAGMENT_GLSL}

void main() {
  if (vUberMatRow > -0.5) {
    vec4 effCustom1 = (abs(vCustom1.x) + abs(vCustom1.y) + abs(vCustom1.z) + abs(vCustom1.w) > 0.0001) ? vCustom1 : uCustom1;
    vec4 uRes = vfxEvalUberFragment(
      uMaterialLut,
      uAtlasTex,
      uHasAtlas,
      uFlipV,
      vUberMatRow,
      vec2(vUv.x, 1.0 - vUv.y),
      vec2(vUv.x, 1.0 - vUv.y),
      0.0,
      false,
      vec4(vColor, vAlpha),
      effCustom1,
      uTime,
      vViewDirView,
      vNormalView,
      true,
      uSoftDepthTex,
      uHasSoftDepth,
      gl_FragCoord.xy,
      uInvViewport,
      uCamNearFar
    );
    if (uIsMultiply > 0.5) {
      gl_FragColor = vec4(mix(vec3(1.0), uRes.rgb, clamp(uRes.a, 0.0, 1.0)), 1.0);
      return;
    }
    if (uIsPremultiply > 0.5) {
      gl_FragColor = vec4(uRes.rgb * max(0.0, vHdr), uRes.a);
      return;
    }
    vec3 outRgb = uRes.rgb * max(0.0, vHdr);
    float outA = uRes.a;
    float peak = max(outRgb.r, max(outRgb.g, outRgb.b));
    if (uIsAdditive > 0.5 && peak > 1.0 && outA > 0.0 && outA < 1.0) {
      float boost = min(peak, 1.0 / outA);
      outRgb /= boost;
      outA *= boost;
    }
    gl_FragColor = vec4(outRgb, outA);
    return;
  }
  float alpha = vAlpha;
  vec3 col = vColor;
  vec4 uvRect = (vUvRect.z > vUvRect.x && vUvRect.w > vUvRect.y) ? vUvRect : uTrailUvRect;
  if (uHasTrailTex > 0.5 && uvRect.z > uvRect.x && uvRect.w > uvRect.y) {
    float localV = mix(0.08, 0.92, 1.0 - vUv.y);
    vec2 mapped = vec2(
      mix(uvRect.x, uvRect.z, clamp(vUv.x, 0.0, 1.0)),
      mix(uvRect.y, uvRect.w, localV)
    );
    if (uTrailFlipV > 0.5) mapped.y = 1.0 - mapped.y;
    vec4 texCol = texture2D(uTrailTex, mapped);
    alpha *= texCol.a;
    col *= texCol.rgb;
  } else {
    float d = abs(vUv.y - 0.5) * 2.0;
    float edge = 1.0 - smoothstep(0.25, 1.0, d);
    alpha *= edge;
    col = mix(col, vec3(1.0), edge * 0.35);
  }
  float soft = vfxComputeSoftFade(uSoftDepthTex, uHasSoftDepth, gl_FragCoord.xy, uInvViewport, uCamNearFar, gl_FragCoord.z, uSoftFade);
  alpha *= soft;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col * max(0.0, vHdr) * max(0.0, uCustom1.x + 1.0), alpha);
}
`;

function createBoltStripGeometry(THREE, segments = 16) {
  const verts = new Float32Array((segments + 1) * 2 * 3);
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const x = i / segments;
    const base = i * 6;
    verts[base] = x;
    verts[base + 1] = -0.5;
    verts[base + 2] = 0;
    verts[base + 3] = x;
    verts[base + 4] = 0.5;
    verts[base + 5] = 0;
    if (i < segments) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * Creates procedural slash arc, lightning bolt, and instanced ribbon trail pools.
 */
export function createTrailsSystem({
  mode = 'headless',
  THREE = /** @type {object | null} */ (null),
  scene = /** @type {object | null} */ (null),
  is2D = mode === 'webgl2d' || mode === 'canvas2d',
  maxSlashes = mode === 'canvas2d' ? 128 : 512,
  maxBolts = mode === 'canvas2d' ? 64 : 256,
  maxTrails = mode === 'canvas2d' ? 256 : 1024,
  trailNodes = 8,
  atlasRegions = /** @type {Record<string, readonly number[]> | null} */ (null),
  prng = createVisualPrng(0x71a11c0d),
} = {}) {
  const slashCap = Math.max(1, maxSlashes | 0);
  const boltCap = Math.max(1, maxBolts | 0);
  const trailCap = Math.max(1, maxTrails | 0);
  const segsPerTrail = Math.max(2, (trailNodes | 0) - 1);
  const totalRibbonSegs = trailCap * segsPerTrail;

  const slashP0 = new Float32Array(slashCap * 4);
  const slashP1 = new Float32Array(slashCap * 4);
  const slashP2 = new Float32Array(slashCap * 4);
  let slashCursor = 0;
  let slashDirtyStart = 0;
  let slashDirtyCount = 0;
  let slashTotal = 0;

  const boltP0 = new Float32Array(boltCap * 4);
  const boltP1 = new Float32Array(boltCap * 4);
  const boltP2 = new Float32Array(boltCap * 4);
  let boltCursor = 0;
  let boltDirtyStart = 0;
  let boltDirtyCount = 0;
  let boltTotal = 0;

  const segA = new Float32Array(totalRibbonSegs * 4);
  const segB = new Float32Array(totalRibbonSegs * 4);
  const segMeta = new Float32Array(totalRibbonSegs * 4);
  const segExtra = new Float32Array(totalRibbonSegs * 4);
  const segUv = new Float32Array(totalRibbonSegs * 4);
  const segMatRow = new Float32Array(totalRibbonSegs);
  segMatRow.fill(-1);
  const segTanA = new Float32Array(totalRibbonSegs * 4);
  const segTanB = new Float32Array(totalRibbonSegs * 4);
  const segCustom1 = new Float32Array(totalRibbonSegs * 4);
  const segA_N = new Float32Array(totalRibbonSegs * 4);
  const segB_N = new Float32Array(totalRibbonSegs * 4);
  const segMeta_N = new Float32Array(totalRibbonSegs * 4);
  const segExtra_N = new Float32Array(totalRibbonSegs * 4);
  const segUv_N = new Float32Array(totalRibbonSegs * 4);
  const segMatRow_N = new Float32Array(totalRibbonSegs);
  segMatRow_N.fill(-1);
  const segTanA_N = new Float32Array(totalRibbonSegs * 4);
  const segTanB_N = new Float32Array(totalRibbonSegs * 4);
  const segCustom1_N = new Float32Array(totalRibbonSegs * 4);
  const trailPoints = new Float32Array(trailCap * trailNodes * 3);
  const trailPointTimes = new Float32Array(trailCap * trailNodes);
  const trailHead = new Int32Array(trailCap);
  const trailCount = new Int32Array(trailCap);
  const trailColor = new Float32Array(trailCap);
  const trailEndColor = new Float32Array(trailCap);
  const trailColorCurves = new Array(trailCap).fill(null);
  const trailLifeMul = new Float32Array(trailCap * 4);
  trailLifeMul.fill(1);
  const trailWidth = new Float32Array(trailCap);
  const trailWidthScale = new Float32Array(trailCap);
  const trailEndWidthScale = new Float32Array(trailCap);
  const trailWidthCurves = new Array(trailCap).fill(null);
  const trailHdr = new Float32Array(trailCap);
  const trailOpacity = new Float32Array(trailCap);
  const trailLifetime = new Float32Array(trailCap);
  const trailUvRect = new Float32Array(trailCap * 4);
  const trailTexScale = new Float32Array(trailCap * 2);
  const trailCustom1 = new Float32Array(trailCap * 4);
  const trailIsNormal = new Uint8Array(trailCap);
  const trailMatRow = new Float32Array(trailCap);
  trailMatRow.fill(-1);
  const trailActive = new Uint8Array(trailCap);
  let atlasRegionMap = atlasRegions || null;
  let activeAtlasTex = null;
  let atlasFlipVOverride = null;
  const uberLut = (THREE && THREE.DataTexture) ? createUberMaterialLut(THREE) : null;
  const registeredUberMats = [];
  const timeUniform = { value: 0 };
  const freeTrailStack = new Int32Array(trailCap);
  let freeTrailTop = trailCap;
  for (let i = 0; i < trailCap; i++) freeTrailStack[i] = trailCap - 1 - i;

  let simTime = 0;
  let disposed = false;
  const scratchRgb = new Float32Array(3);
  const scratchBaseRgb = new Float32Array(3);
  const scratchEndRgb = new Float32Array(3);
  const scratchCurve0 = new Float32Array(4);
  const scratchCurve1 = new Float32Array(4);

  let slashMesh = null;
  let slashAttrs = null;
  let slashMat = null;
  let boltMesh = null;
  let boltAttrs = null;
  let boltMat = null;
  let ribbonMesh = null;
  let ribbonAttrs = null;
  let ribbonMat = null;
  let ribbonNormalMesh = null;
  let ribbonNormalAttrs = null;
  let ribbonNormalMat = null;

  if (mode === '3d' && THREE && scene && THREE.InstancedBufferGeometry && THREE.PlaneGeometry) {
    const MatCtor = THREE.RawShaderMaterial || THREE.ShaderMaterial;

    // 1. SlashArcPool
    const baseQuad = new THREE.PlaneGeometry(1, 1);
    const sGeo = new THREE.InstancedBufferGeometry();
    sGeo.index = baseQuad.index;
    sGeo.attributes.position = baseQuad.attributes.position;
    sGeo.attributes.uv = baseQuad.attributes.uv;
    sGeo.instanceCount = slashCap;
    const sa0 = new THREE.InstancedBufferAttribute(slashP0, 4);
    const sa1 = new THREE.InstancedBufferAttribute(slashP1, 4);
    const sa2 = new THREE.InstancedBufferAttribute(slashP2, 4);
    sGeo.setAttribute('aSlashP0', sa0);
    sGeo.setAttribute('aSlashP1', sa1);
    sGeo.setAttribute('aSlashP2', sa2);
    slashMat = new MatCtor({
      vertexShader: SLASH_VERTEX_GLSL,
      fragmentShader: SLASH_FRAGMENT_GLSL,
      uniforms: { uTime: { value: 0 }, uIs2D: { value: is2D ? 1.0 : 0.0 } },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    slashMesh = new THREE.Mesh(sGeo, slashMat);
    slashMesh.frustumCulled = false;
    slashMesh.renderOrder = VFX_RENDER_ORDERS.TRAILS;
    slashMesh.name = 'HGameVfxSlashArcs';
    scene.add(slashMesh);
    slashAttrs = [sa0, sa1, sa2];

    // 2. LightningBoltPool
    const bGeo = createBoltStripGeometry(THREE, 16);
    bGeo.instanceCount = boltCap;
    const ba0 = new THREE.InstancedBufferAttribute(boltP0, 4);
    const ba1 = new THREE.InstancedBufferAttribute(boltP1, 4);
    const ba2 = new THREE.InstancedBufferAttribute(boltP2, 4);
    bGeo.setAttribute('aBoltP0', ba0);
    bGeo.setAttribute('aBoltP1', ba1);
    bGeo.setAttribute('aBoltP2', ba2);
    boltMat = new MatCtor({
      vertexShader: LIGHTNING_VERTEX_GLSL,
      fragmentShader: LIGHTNING_FRAGMENT_GLSL,
      uniforms: { uTime: { value: 0 }, uIs2D: { value: is2D ? 1.0 : 0.0 } },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    boltMesh = new THREE.Mesh(bGeo, boltMat);
    boltMesh.frustumCulled = false;
    boltMesh.renderOrder = VFX_RENDER_ORDERS.TRAILS;
    boltMesh.name = 'HGameVfxLightningBolts';
    scene.add(boltMesh);
    boltAttrs = [ba0, ba1, ba2];

    // 3. RibbonTrailPool (7,168 instanced quad segments)
    const rGeo = new THREE.InstancedBufferGeometry();
    rGeo.index = baseQuad.index;
    rGeo.attributes.position = baseQuad.attributes.position;
    rGeo.instanceCount = totalRibbonSegs;
    const ra0 = new THREE.InstancedBufferAttribute(segA, 4);
    const ra1 = new THREE.InstancedBufferAttribute(segB, 4);
    const ra2 = new THREE.InstancedBufferAttribute(segMeta, 4);
    const ra3 = new THREE.InstancedBufferAttribute(segExtra, 4);
    const ra4 = new THREE.InstancedBufferAttribute(segUv, 4);
    const ra5 = new THREE.InstancedBufferAttribute(segMatRow, 1);
    const ra6 = new THREE.InstancedBufferAttribute(segTanA, 4);
    const ra7 = new THREE.InstancedBufferAttribute(segTanB, 4);
    const ra8 = new THREE.InstancedBufferAttribute(segCustom1, 4);
    rGeo.setAttribute('aSegA', ra0);
    rGeo.setAttribute('aSegB', ra1);
    rGeo.setAttribute('aSegMeta', ra2);
    rGeo.setAttribute('aSegExtra', ra3);
    rGeo.setAttribute('aSegUvRect', ra4);
    rGeo.setAttribute('aSegMatRow', ra5);
    rGeo.setAttribute('aSegTanA', ra6);
    rGeo.setAttribute('aSegTanB', ra7);
    rGeo.setAttribute('aSegCustom1', ra8);
    ribbonMat = new MatCtor({
      vertexShader: RIBBON_VERTEX_GLSL,
      fragmentShader: RIBBON_FRAGMENT_GLSL,
      uniforms: {
        uTime: timeUniform,
        uIs2D: { value: is2D ? 1.0 : 0.0 },
        uMaterialLut: { value: uberLut ? uberLut.texture : null },
        uAtlasTex: { value: activeAtlasTex },
        uHasAtlas: { value: activeAtlasTex ? 1.0 : 0.0 },
        uFlipV: { value: 0.0 },
        uTrailTex: { value: null },
        uHasTrailTex: { value: 0.0 },
        uTrailFlipV: { value: 0.0 },
        uTrailUvRect: { value: THREE.Vector4 ? new THREE.Vector4(0, 0, 1, 1) : { set() {} } },
        uSoftDepthTex: { value: null },
        uHasSoftDepth: { value: 0.0 },
        uSoftFade: { value: 0.45 },
        uIsMultiply: { value: 0.0 },
        uIsPremultiply: { value: 0.0 },
        uIsAdditive: { value: 1.0 },
        uInvViewport: { value: THREE.Vector2 ? new THREE.Vector2(1 / 1280, 1 / 720) : { set() {} } },
        uCamNearFar: { value: THREE.Vector2 ? new THREE.Vector2(0.1, 200) : { set() {} } },
        uCustom1: { value: THREE.Vector4 ? new THREE.Vector4(0, 0, 0, 0) : { set() {} } },
        uCustom2: { value: THREE.Vector4 ? new THREE.Vector4(0, 0, 0, 0) : { set() {} } },
      },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    ribbonMesh = new THREE.Mesh(rGeo, ribbonMat);
    ribbonMesh.frustumCulled = false;
    ribbonMesh.renderOrder = VFX_RENDER_ORDERS.TRAILS;
    ribbonMesh.name = 'HGameVfxRibbonTrails';
    scene.add(ribbonMesh);
    ribbonAttrs = [ra0, ra1, ra2, ra3, ra4, ra5, ra6, ra7, ra8];

    // 3b. Alpha-blended RibbonTrailPool
    const rGeoN = new THREE.InstancedBufferGeometry();
    rGeoN.index = baseQuad.index;
    rGeoN.attributes.position = baseQuad.attributes.position;
    rGeoN.instanceCount = totalRibbonSegs;
    const rn0 = new THREE.InstancedBufferAttribute(segA_N, 4);
    const rn1 = new THREE.InstancedBufferAttribute(segB_N, 4);
    const rn2 = new THREE.InstancedBufferAttribute(segMeta_N, 4);
    const rn3 = new THREE.InstancedBufferAttribute(segExtra_N, 4);
    const rn4 = new THREE.InstancedBufferAttribute(segUv_N, 4);
    const rn5 = new THREE.InstancedBufferAttribute(segMatRow_N, 1);
    const rn6 = new THREE.InstancedBufferAttribute(segTanA_N, 4);
    const rn7 = new THREE.InstancedBufferAttribute(segTanB_N, 4);
    const rn8 = new THREE.InstancedBufferAttribute(segCustom1_N, 4);
    rGeoN.setAttribute('aSegA', rn0);
    rGeoN.setAttribute('aSegB', rn1);
    rGeoN.setAttribute('aSegMeta', rn2);
    rGeoN.setAttribute('aSegExtra', rn3);
    rGeoN.setAttribute('aSegUvRect', rn4);
    rGeoN.setAttribute('aSegMatRow', rn5);
    rGeoN.setAttribute('aSegTanA', rn6);
    rGeoN.setAttribute('aSegTanB', rn7);
    rGeoN.setAttribute('aSegCustom1', rn8);
    ribbonNormalMat = new MatCtor({
      vertexShader: RIBBON_VERTEX_GLSL,
      fragmentShader: RIBBON_FRAGMENT_GLSL,
      uniforms: {
        uTime: timeUniform,
        uIs2D: { value: is2D ? 1.0 : 0.0 },
        uMaterialLut: { value: uberLut ? uberLut.texture : null },
        uAtlasTex: { value: activeAtlasTex },
        uHasAtlas: { value: activeAtlasTex ? 1.0 : 0.0 },
        uFlipV: { value: 0.0 },
        uTrailTex: { value: null },
        uHasTrailTex: { value: 0.0 },
        uTrailFlipV: { value: 0.0 },
        uTrailUvRect: { value: THREE.Vector4 ? new THREE.Vector4(0, 0, 1, 1) : { set() {} } },
        uSoftDepthTex: { value: null },
        uHasSoftDepth: { value: 0.0 },
        uSoftFade: { value: 0.45 },
        uIsMultiply: { value: 0.0 },
        uIsPremultiply: { value: 0.0 },
        uIsAdditive: { value: 0.0 },
        uInvViewport: { value: THREE.Vector2 ? new THREE.Vector2(1 / 1280, 1 / 720) : { set() {} } },
        uCamNearFar: { value: THREE.Vector2 ? new THREE.Vector2(0.1, 200) : { set() {} } },
        uCustom1: { value: THREE.Vector4 ? new THREE.Vector4(0, 0, 0, 0) : { set() {} } },
        uCustom2: { value: THREE.Vector4 ? new THREE.Vector4(0, 0, 0, 0) : { set() {} } },
      },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    ribbonNormalMesh = new THREE.Mesh(rGeoN, ribbonNormalMat);
    ribbonNormalMesh.frustumCulled = false;
    ribbonNormalMesh.renderOrder = VFX_RENDER_ORDERS.TRAILS;
    ribbonNormalMesh.name = 'HGameVfxRibbonTrailsNormal';
    scene.add(ribbonNormalMesh);
    ribbonNormalAttrs = [rn0, rn1, rn2, rn3, rn4, rn5, rn6, rn7, rn8];
  }

  function slashArc(opts = {}) {
    const idx = slashCursor;
    const i4 = idx * 4;
    slashP0[i4] = opts.x ?? 0;
    slashP0[i4 + 1] = opts.y ?? 0;
    slashP0[i4 + 2] = opts.z ?? 0;
    slashP0[i4 + 3] = simTime;

    slashP1[i4] = opts.yawRad ?? opts.angle ?? 0;
    slashP1[i4 + 1] = opts.sweepRad ?? 2.1;
    slashP1[i4 + 2] = opts.radius ?? 2.6;
    slashP1[i4 + 3] = opts.duration ?? 0.16;

    slashP2[i4] = opts.rgb24 !== undefined ? opts.rgb24 : packRgb24(opts.color ?? 0x38bdf8);
    slashP2[i4 + 1] = opts.innerRatio ?? 0.52;
    slashP2[i4 + 2] = opts.flip ? 1.0 : 0.0;
    slashP2[i4 + 3] = opts.thickness ?? 1.0;

    if (slashDirtyCount === 0) slashDirtyStart = idx;
    slashDirtyCount = Math.min(slashCap, slashDirtyCount + 1);
    slashCursor = (idx + 1) % slashCap;
    slashTotal += 1;
  }

  function lightningBolt(opts = {}) {
    const idx = boltCursor;
    const i4 = idx * 4;
    boltP0[i4] = opts.x0 ?? 0;
    boltP0[i4 + 1] = opts.y0 ?? 0;
    boltP0[i4 + 2] = opts.z0 ?? 0;
    boltP0[i4 + 3] = simTime;

    boltP1[i4] = opts.x1 ?? 1;
    boltP1[i4 + 1] = opts.y1 ?? 0;
    boltP1[i4 + 2] = opts.z1 ?? 0;
    boltP1[i4 + 3] = opts.duration ?? 0.14;

    boltP2[i4] = opts.rgb24 !== undefined ? opts.rgb24 : packRgb24(opts.color ?? 0x60a5fa);
    boltP2[i4 + 1] = opts.thickness ?? 0.22;
    boltP2[i4 + 2] = opts.seed !== undefined ? opts.seed : prng.nextFloat();
    boltP2[i4 + 3] = opts.jitter ?? 0.45;

    if (boltDirtyCount === 0) boltDirtyStart = idx;
    boltDirtyCount = Math.min(boltCap, boltDirtyCount + 1);
    boltCursor = (idx + 1) % boltCap;
    boltTotal += 1;
  }

  function syncTrailSegments(trackId) {
    let count = trailCount[trackId];
    const life = trailLifetime[trackId];
    if (life > 0 && count > 1) {
      while (count > 1) {
        const oldestIdx = (trailHead[trackId] - count + trailNodes * 2) % trailNodes;
        const ageOld = simTime - trailPointTimes[trackId * trailNodes + oldestIdx];
        if (ageOld > life) count -= 1;
        else break;
      }
      trailCount[trackId] = count;
    }

    const segBase = trackId * segsPerTrail;
    const rgb = trailColor[trackId];
    const endRgb = trailEndColor[trackId];
    unpackRgb24Into(rgb, scratchBaseRgb);
    unpackRgb24Into(endRgb, scratchEndRgb);
    const cCurve = trailColorCurves[trackId];
    const lmBase = trackId * 4;
    const lifeR = trailLifeMul[lmBase];
    const lifeG = trailLifeMul[lmBase + 1];
    const lifeB = trailLifeMul[lmBase + 2];
    const lifeA = trailLifeMul[lmBase + 3];
    const w = trailWidth[trackId] * trailWidthScale[trackId];
    const endScale = trailEndWidthScale[trackId];
    const hdr = trailHdr[trackId];

    const isNormal = trailIsNormal[trackId] === 1;
    const matRow = trailMatRow[trackId];
    const dstA = isNormal ? segA_N : segA;
    const dstB = isNormal ? segB_N : segB;
    const dstMeta = isNormal ? segMeta_N : segMeta;
    const dstExtra = isNormal ? segExtra_N : segExtra;
    const dstUv = isNormal ? segUv_N : segUv;
    const dstMatRow = isNormal ? segMatRow_N : segMatRow;
    const dstTanA = isNormal ? segTanA_N : segTanA;
    const dstTanB = isNormal ? segTanB_N : segTanB;
    const dstCustom1 = isNormal ? segCustom1_N : segCustom1;
    const otherMeta = isNormal ? segMeta : segMeta_N;
    const dstAttrs = isNormal ? ribbonNormalAttrs : ribbonAttrs;
    const otherAttrs = isNormal ? ribbonAttrs : ribbonNormalAttrs;
    const uvBase = trackId * 4;
    const uv0 = trailUvRect[uvBase];
    const uv1 = trailUvRect[uvBase + 1];
    const uv2 = trailUvRect[uvBase + 2];
    const uv3 = trailUvRect[uvBase + 3];
    const tsBase = trackId * 2;
    const tsX = trailTexScale[tsBase] || 1;
    const tsY = trailTexScale[tsBase + 1] || 1;
    const c1Base = trackId * 4;
    const c1x = trailCustom1[c1Base];
    const c1y = trailCustom1[c1Base + 1];
    const c1z = trailCustom1[c1Base + 2];
    const c1w = trailCustom1[c1Base + 3];

    for (let s = 0; s < segsPerTrail; s++) {
      const segIdx = segBase + s;
      const i4 = segIdx * 4;
      otherMeta[i4 + 1] = 0;
      otherMeta[i4 + 2] = 0;
      otherMeta[i4 + 3] = 0;
      if (s >= count - 1) {
        dstMeta[i4 + 1] = 0;
        dstMeta[i4 + 2] = 0;
        dstMeta[i4 + 3] = 0;
        dstMatRow[segIdx] = -1;
        continue;
      }
      dstMatRow[segIdx] = matRow;
      const idxA = (trailHead[trackId] - 1 - s + trailNodes * 2) % trailNodes;
      const idxB = (trailHead[trackId] - 2 - s + trailNodes * 2) % trailNodes;
      const pA = (trackId * trailNodes + idxA) * 3;
      const pB = (trackId * trailNodes + idxB) * 3;

      const invSegs = 1 / Math.max(1, count - 1);
      const t0 = life > 0
        ? Math.max(0, Math.min(1, (simTime - trailPointTimes[trackId * trailNodes + idxA]) / life))
        : (s * invSegs);
      const t1 = life > 0
        ? Math.max(0, Math.min(1, (simTime - trailPointTimes[trackId * trailNodes + idxB]) / life))
        : ((s + 1) * invSegs);

      const ax = trailPoints[pA];
      const ay = trailPoints[pA + 1];
      const az = trailPoints[pA + 2];
      const bx = trailPoints[pB];
      const by = trailPoints[pB + 1];
      const bz = trailPoints[pB + 2];

      dstA[i4] = ax;
      dstA[i4 + 1] = ay;
      dstA[i4 + 2] = az;
      dstA[i4 + 3] = t0;
      dstB[i4] = bx;
      dstB[i4 + 1] = by;
      dstB[i4 + 2] = bz;
      dstB[i4 + 3] = t1;

      const segDx = bx - ax;
      const segDy = by - ay;
      const segDz = bz - az;

      let tAx = segDx;
      let tAy = segDy;
      let tAz = segDz;
      if (s > 0) {
        const idxPrev = (trailHead[trackId] - s + trailNodes * 2) % trailNodes;
        const pPrev = (trackId * trailNodes + idxPrev) * 3;
        tAx = bx - trailPoints[pPrev];
        tAy = by - trailPoints[pPrev + 1];
        tAz = bz - trailPoints[pPrev + 2];
      }
      const lenA = Math.hypot(tAx, tAy, tAz);
      if (lenA > 1e-6) {
        tAx /= lenA; tAy /= lenA; tAz /= lenA;
      } else {
        const segLen = Math.hypot(segDx, segDy, segDz) || 1;
        tAx = segDx / segLen; tAy = segDy / segLen; tAz = segDz / segLen;
      }

      let tBx = segDx;
      let tBy = segDy;
      let tBz = segDz;
      if (s + 1 < count - 1) {
        const idxNext = (trailHead[trackId] - 3 - s + trailNodes * 2) % trailNodes;
        const pNext = (trackId * trailNodes + idxNext) * 3;
        tBx = trailPoints[pNext] - ax;
        tBy = trailPoints[pNext + 1] - ay;
        tBz = trailPoints[pNext + 2] - az;
      }
      const lenB = Math.hypot(tBx, tBy, tBz);
      if (lenB > 1e-6) {
        tBx /= lenB; tBy /= lenB; tBz /= lenB;
      } else {
        const segLen = Math.hypot(segDx, segDy, segDz) || 1;
        tBx = segDx / segLen; tBy = segDy / segLen; tBz = segDz / segLen;
      }

      dstTanA[i4] = tAx;
      dstTanA[i4 + 1] = tAy;
      dstTanA[i4 + 2] = tAz;
      dstTanA[i4 + 3] = tsX;
      dstTanB[i4] = tBx;
      dstTanB[i4 + 1] = tBy;
      dstTanB[i4 + 2] = tBz;
      dstTanB[i4 + 3] = tsY;
      dstCustom1[i4] = c1x;
      dstCustom1[i4 + 1] = c1y;
      dstCustom1[i4 + 2] = c1z;
      dstCustom1[i4 + 3] = c1w;

      dstMeta[i4 + 1] = w;
      const op = trailOpacity[trackId] * lifeA;
      if (cCurve) {
        evaluateColorCurve(cCurve, t0, scratchCurve0);
        evaluateColorCurve(cCurve, t1, scratchCurve1);
        dstMeta[i4] = packRgb24(
          Math.round(scratchBaseRgb[0] * scratchCurve0[0] * lifeR * 255),
          Math.round(scratchBaseRgb[1] * scratchCurve0[1] * lifeG * 255),
          Math.round(scratchBaseRgb[2] * scratchCurve0[2] * lifeB * 255),
        );
        dstExtra[i4] = packRgb24(
          Math.round(scratchBaseRgb[0] * scratchCurve1[0] * lifeR * 255),
          Math.round(scratchBaseRgb[1] * scratchCurve1[1] * lifeG * 255),
          Math.round(scratchBaseRgb[2] * scratchCurve1[2] * lifeB * 255),
        );
        dstMeta[i4 + 2] = Math.max(0, Math.min(1, scratchCurve0[3] * op));
        dstMeta[i4 + 3] = Math.max(0, Math.min(1, scratchCurve1[3] * op));
      } else {
        const smooth = (x) => {
          const sv = Math.max(0, Math.min(1, (x - 0.04) / 0.28));
          return sv * sv * (3 - 2 * sv);
        };
        const s0 = smooth(t0);
        const s1 = smooth(t1);
        dstMeta[i4] = packRgb24(
          Math.round((scratchBaseRgb[0] + (scratchEndRgb[0] - scratchBaseRgb[0]) * s0) * lifeR * 255),
          Math.round((scratchBaseRgb[1] + (scratchEndRgb[1] - scratchBaseRgb[1]) * s0) * lifeG * 255),
          Math.round((scratchBaseRgb[2] + (scratchEndRgb[2] - scratchBaseRgb[2]) * s0) * lifeB * 255),
        );
        dstExtra[i4] = packRgb24(
          Math.round((scratchBaseRgb[0] + (scratchEndRgb[0] - scratchBaseRgb[0]) * s1) * lifeR * 255),
          Math.round((scratchBaseRgb[1] + (scratchEndRgb[1] - scratchBaseRgb[1]) * s1) * lifeG * 255),
          Math.round((scratchBaseRgb[2] + (scratchEndRgb[2] - scratchBaseRgb[2]) * s1) * lifeB * 255),
        );
        if (isNormal) {
          const evalNormalAlpha = (t) => (
            t <= 0.06 ? (0.35 + 0.65 * (t / 0.06))
              : t <= 0.86 ? 1.0
              : Math.max(0, (1.0 - t) / 0.14)
          );
          dstMeta[i4 + 2] = evalNormalAlpha(t0) * op;
          dstMeta[i4 + 3] = evalNormalAlpha(t1) * op;
        } else {
          const headFade = (t) => Math.min(1, t / 0.08);
          dstMeta[i4 + 2] = Math.max(0, 1 - t0 * t0) * headFade(t0) * op;
          dstMeta[i4 + 3] = Math.max(0, 1 - t1 * t1) * headFade(t1) * op;
        }
      }

      const wCurve = trailWidthCurves[trackId];
      dstExtra[i4 + 1] = wCurve ? evaluateSizeCurve(wCurve, t0) : (1 + (endScale - 1) * t0);
      dstExtra[i4 + 2] = wCurve ? evaluateSizeCurve(wCurve, t1) : (1 + (endScale - 1) * t1);
      dstExtra[i4 + 3] = hdr;
      dstUv[i4] = uv0;
      dstUv[i4 + 1] = uv1;
      dstUv[i4 + 2] = uv2;
      dstUv[i4 + 3] = uv3;
    }

    if (dstAttrs) {
      for (let i = 0; i < dstAttrs.length; i++) {
        submitRingBufferRanges(dstAttrs[i], segBase, segsPerTrail, totalRibbonSegs, i === 5 ? 1 : 4);
      }
    }
    if (otherAttrs) {
      submitRingBufferRanges(otherAttrs[2], segBase, segsPerTrail, totalRibbonSegs, 4);
    }
  }

  function registerUberMaterial(matSpec) {
    if (!uberLut || !matSpec) return -1;
    const key = matSpec.key || JSON.stringify(matSpec);
    const idx = uberLut.allocateRow(key, matSpec, atlasRegionMap);
    registeredUberMats.push({ key, matSpec });
    return idx;
  }

  function setAtlas(texture, regions = null, opts = {}) {
    activeAtlasTex = texture || null;
    if (regions) atlasRegionMap = regions;
    if (opts && opts.flipV !== undefined) {
      atlasFlipVOverride = Boolean(opts.flipV);
    }
    const flipVal = atlasFlipVOverride !== null
      ? (atlasFlipVOverride ? 1.0 : 0.0)
      : (activeAtlasTex && activeAtlasTex.flipY ? 1.0 : 0.0);
    for (const mat of [ribbonMat, ribbonNormalMat]) {
      if (!mat) continue;
      mat.uniforms.uAtlasTex.value = activeAtlasTex;
      mat.uniforms.uHasAtlas.value = activeAtlasTex ? 1.0 : 0.0;
      mat.uniforms.uFlipV.value = flipVal;
    }
    if (uberLut && atlasRegionMap) {
      for (let i = 0; i < registeredUberMats.length; i++) {
        const entry = registeredUberMats[i];
        uberLut.allocateRow(entry.key, entry.matSpec, atlasRegionMap);
      }
    }
  }

  /**
   * Binds an optional texture and top-down UV rect `[u0, v0, u1, v1]` for ribbon trails.
   * @param {object | null} texture
   * @param {readonly number[]} [uvRect]
   */
  function setTrailTexture(texture, uvRect = [0, 0, 1, 1]) {
    for (const mat of [ribbonMat, ribbonNormalMat]) {
      if (!mat) continue;
      mat.uniforms.uTrailTex.value = texture;
      mat.uniforms.uHasTrailTex.value = texture ? 1.0 : 0.0;
      mat.uniforms.uTrailFlipV.value = texture && texture.flipY ? 1.0 : 0.0;
      mat.uniforms.uTrailUvRect.value.set(uvRect[0] ?? 0, uvRect[1] ?? 0, uvRect[2] ?? 1, uvRect[3] ?? 1);
    }
  }

  /**
   * Registers an atlas region dictionary (`{ [spriteKey]: [u0, v0, u1, v1] }`) for per-trail sprites.
   * @param {Record<string, readonly number[]> | null} regions
   */
  function setAtlasRegions(regions) {
    atlasRegionMap = regions || null;
  }

  /**
   * Allocates a ribbon trail slot.
   * @param {number | object} [colorOrOpts=0x38bdf8]
   * @param {number} [width=0.25]
   */
  function allocTrail(colorOrOpts = 0x38bdf8, width = 0.25) {
    if (freeTrailTop <= 0) return -1;
    const id = freeTrailStack[--freeTrailTop];
    trailActive[id] = 1;
    trailHead[id] = 0;
    trailCount[id] = 0;
    trailWidthScale[id] = 1;
    trailEndWidthScale[id] = 0;
    trailWidthCurves[id] = null;
    trailColorCurves[id] = null;
    trailOpacity[id] = 1;
    trailLifetime[id] = 0;
    trailIsNormal[id] = 0;
    trailMatRow[id] = -1;
    const uvBase = id * 4;
    trailLifeMul[uvBase] = 1;
    trailLifeMul[uvBase + 1] = 1;
    trailLifeMul[uvBase + 2] = 1;
    trailLifeMul[uvBase + 3] = 1;
    trailUvRect[uvBase] = 0;
    trailUvRect[uvBase + 1] = 0;
    trailUvRect[uvBase + 2] = 0;
    trailUvRect[uvBase + 3] = 0;
    const tsBase = id * 2;
    trailTexScale[tsBase] = 1;
    trailTexScale[tsBase + 1] = 1;
    trailCustom1[uvBase] = 0;
    trailCustom1[uvBase + 1] = 0;
    trailCustom1[uvBase + 2] = 0;
    trailCustom1[uvBase + 3] = 0;
    if (typeof colorOrOpts === 'object' && colorOrOpts !== null) {
      const startRgb = packRgb24(colorOrOpts.color ?? 0x38bdf8);
      const wStart = colorOrOpts.width ?? width;
      const wEnd = colorOrOpts.endWidth ?? 0;
      trailColor[id] = startRgb;
      trailEndColor[id] = colorOrOpts.endColor !== undefined ? packRgb24(colorOrOpts.endColor) : startRgb;
      trailWidth[id] = wStart;
      trailEndWidthScale[id] = wStart > 0.0001 ? Math.max(0, wEnd / wStart) : 0;
      trailWidthCurves[id] = Array.isArray(colorOrOpts.widthCurve) && colorOrOpts.widthCurve.length > 0 ? colorOrOpts.widthCurve : null;
      trailColorCurves[id] = Array.isArray(colorOrOpts.colorCurve) && colorOrOpts.colorCurve.length >= 2 ? colorOrOpts.colorCurve : null;
      trailHdr[id] = colorOrOpts.hdr ?? 1.0;
      trailOpacity[id] = Math.max(0, Math.min(1, colorOrOpts.alpha ?? 1.0));
      trailLifetime[id] = Math.max(0, colorOrOpts.lifetime ?? 0);
      trailIsNormal[id] = colorOrOpts.blend === 'alpha' ? 1 : 0;
      if (colorOrOpts.uberMat) {
        trailMatRow[id] = registerUberMaterial(colorOrOpts.uberMat);
      }
      if (Array.isArray(colorOrOpts.textureScale)) {
        trailTexScale[tsBase] = Number(colorOrOpts.textureScale[0] ?? 1) || 1;
        trailTexScale[tsBase + 1] = Number(colorOrOpts.textureScale[1] ?? 1) || 1;
      }
      if (Array.isArray(colorOrOpts.custom1)) {
        trailCustom1[uvBase] = Number(colorOrOpts.custom1[0] ?? 0) || 0;
        trailCustom1[uvBase + 1] = Number(colorOrOpts.custom1[1] ?? 0) || 0;
        trailCustom1[uvBase + 2] = Number(colorOrOpts.custom1[2] ?? 0) || 0;
        trailCustom1[uvBase + 3] = Number(colorOrOpts.custom1[3] ?? 0) || 0;
      }
      const rect = colorOrOpts.uvRect || (colorOrOpts.sprite && atlasRegionMap?.[colorOrOpts.sprite]);
      if (rect) {
        trailUvRect[uvBase] = rect[0] ?? 0;
        trailUvRect[uvBase + 1] = rect[1] ?? 0;
        trailUvRect[uvBase + 2] = rect[2] ?? 1;
        trailUvRect[uvBase + 3] = rect[3] ?? 1;
      }
    } else {
      const rgb = packRgb24(colorOrOpts);
      trailColor[id] = rgb;
      trailEndColor[id] = rgb;
      trailWidth[id] = width;
      trailEndWidthScale[id] = 0;
      trailHdr[id] = 1.0;
    }
    return id;
  }

  function setTrailWidthScale(trackId, scale = 1) {
    if (trackId < 0 || trackId >= trailCap || !trailActive[trackId]) return;
    trailWidthScale[trackId] = Math.max(0, scale);
  }

  function setTrailLifeMod(trackId, r = 1, g = 1, b = 1, a = 1) {
    if (trackId < 0 || trackId >= trailCap || !trailActive[trackId]) return;
    const lm = trackId * 4;
    trailLifeMul[lm] = r;
    trailLifeMul[lm + 1] = g;
    trailLifeMul[lm + 2] = b;
    trailLifeMul[lm + 3] = a;
  }

  function pushTrailPoint(trackId, x, y, z = 0, timeOverride = undefined) {
    if (trackId < 0 || trackId >= trailCap || !trailActive[trackId]) return;
    const h = trailHead[trackId];
    const p = (trackId * trailNodes + h) * 3;
    trailPoints[p] = x;
    trailPoints[p + 1] = y;
    trailPoints[p + 2] = z;
    trailPointTimes[trackId * trailNodes + h] = timeOverride !== undefined ? timeOverride : simTime;
    trailHead[trackId] = (h + 1) % trailNodes;
    if (trailCount[trackId] < trailNodes) trailCount[trackId] += 1;
    syncTrailSegments(trackId);
  }

  function updateTrailHead(trackId, x, y, z = 0, timeOverride = undefined) {
    if (trackId < 0 || trackId >= trailCap || !trailActive[trackId]) return;
    if (trailCount[trackId] === 0) {
      pushTrailPoint(trackId, x, y, z, timeOverride);
      return;
    }
    const idx = (trailHead[trackId] - 1 + trailNodes) % trailNodes;
    const p = (trackId * trailNodes + idx) * 3;
    trailPoints[p] = x;
    trailPoints[p + 1] = y;
    trailPoints[p + 2] = z;
    trailPointTimes[trackId * trailNodes + idx] = timeOverride !== undefined ? timeOverride : simTime;
    syncTrailSegments(trackId);
  }

  function setDepthTexture(depthTexture, { near = 0.1, far = 200, width = 1280, height = 720, softFade = 0.45 } = {}) {
    for (const mat of [ribbonMat, ribbonNormalMat]) {
      if (!mat) continue;
      mat.uniforms.uSoftDepthTex.value = depthTexture || null;
      mat.uniforms.uHasSoftDepth.value = depthTexture ? 1.0 : 0.0;
      mat.uniforms.uSoftFade.value = softFade;
      mat.uniforms.uInvViewport.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
      mat.uniforms.uCamNearFar.value.set(near, far);
    }
  }

  function setTrailPoints(trackId, px, py, pz, indices, startIdx, endIdx) {
    if (trackId < 0 || trackId >= trailCap || !trailActive[trackId]) return;
    trailHead[trackId] = 0;
    trailCount[trackId] = 0;
    const n = Math.min(trailNodes, endIdx - startIdx);
    for (let k = 0; k < n; k++) {
      const idx = indices[startIdx + k];
      const h = trailHead[trackId];
      const p = (trackId * trailNodes + h) * 3;
      trailPoints[p] = px[idx];
      trailPoints[p + 1] = py[idx];
      trailPoints[p + 2] = pz[idx];
      trailPointTimes[trackId * trailNodes + h] = simTime;
      trailHead[trackId] = (h + 1) % trailNodes;
      trailCount[trackId] += 1;
    }
    syncTrailSegments(trackId);
  }

  function freeTrail(trackId) {
    if (trackId < 0 || trackId >= trailCap || !trailActive[trackId]) return;
    trailActive[trackId] = 0;
    trailCount[trackId] = 0;
    syncTrailSegments(trackId);
    freeTrailStack[freeTrailTop++] = trackId;
  }

  function flushDirty() {
    if (slashDirtyCount > 0 && slashAttrs) {
      for (let i = 0; i < 3; i++) {
        submitRingBufferRanges(slashAttrs[i], slashDirtyStart, slashDirtyCount, slashCap, 4);
      }
    }
    slashDirtyCount = 0;

    if (boltDirtyCount > 0 && boltAttrs) {
      for (let i = 0; i < 3; i++) {
        submitRingBufferRanges(boltAttrs[i], boltDirtyStart, boltDirtyCount, boltCap, 4);
      }
    }
    boltDirtyCount = 0;
  }

  function update(visualDt) {
    simTime += Math.max(0, visualDt);
    timeUniform.value = simTime;
    flushDirty();
    if (slashMat) slashMat.uniforms.uTime.value = simTime;
    if (boltMat) boltMat.uniforms.uTime.value = simTime;
  }

  function renderCanvas2D(ctx, camera, viewWidth, viewHeight) {
    if (!ctx || disposed) return;
    const camX = camera?.x ?? 0;
    const camY = camera?.y ?? 0;
    const zoom = camera?.zoom ?? 1;
    const halfW = viewWidth * 0.5;
    const halfH = viewHeight * 0.5;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const sCount = Math.min(slashTotal, slashCap);
    for (let i = 0; i < sCount; i++) {
      const i4 = i * 4;
      const age = simTime - slashP0[i4 + 3];
      const dur = slashP1[i4 + 3];
      if (dur <= 0 || age < 0 || age >= dur) continue;
      const t = age / dur;
      const sx = (slashP0[i4] - camX) * zoom + halfW;
      const sy = (slashP0[i4 + 1] - camY) * zoom + halfH;
      const yaw = slashP1[i4];
      const sweep = slashP1[i4 + 1];
      const rad = slashP1[i4 + 2] * zoom;
      unpackRgb24Into(slashP2[i4], scratchRgb);
      ctx.globalAlpha = 1 - t * t;
      ctx.strokeStyle = `rgb(${(scratchRgb[0] * 255) | 0},${(scratchRgb[1] * 255) | 0},${(scratchRgb[2] * 255) | 0})`;
      ctx.lineWidth = Math.max(2, rad * (1 - slashP2[i4 + 1]) * (1 - t * 0.5));
      ctx.beginPath();
      ctx.arc(sx, sy, rad * 0.85, yaw - sweep * 0.5, yaw + sweep * 0.5);
      ctx.stroke();
    }

    const bCount = Math.min(boltTotal, boltCap);
    for (let i = 0; i < bCount; i++) {
      const i4 = i * 4;
      const age = simTime - boltP0[i4 + 3];
      const dur = boltP1[i4 + 3];
      if (dur <= 0 || age < 0 || age >= dur) continue;
      const t = age / dur;
      const x0 = (boltP0[i4] - camX) * zoom + halfW;
      const y0 = (boltP0[i4 + 1] - camY) * zoom + halfH;
      const x1 = (boltP1[i4] - camX) * zoom + halfW;
      const y1 = (boltP1[i4 + 1] - camY) * zoom + halfH;
      unpackRgb24Into(boltP2[i4], scratchRgb);
      ctx.globalAlpha = 1 - t * t;
      ctx.strokeStyle = `rgb(${(scratchRgb[0] * 255) | 0},${(scratchRgb[1] * 255) | 0},${(scratchRgb[2] * 255) | 0})`;
      ctx.lineWidth = Math.max(1.5, boltP2[i4 + 1] * zoom);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo((x0 + x1) * 0.5 + (prng.nextFloat() - 0.5) * 14, (y0 + y1) * 0.5 + (prng.nextFloat() - 0.5) * 14);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    ctx.restore();
  }

  function reset() {
    simTime = 0;
    slashCursor = slashDirtyStart = slashDirtyCount = slashTotal = 0;
    boltCursor = boltDirtyStart = boltDirtyCount = boltTotal = 0;
    freeTrailTop = trailCap;
    for (let i = 0; i < trailCap; i++) {
      freeTrailStack[i] = trailCap - 1 - i;
      trailActive[i] = 0;
      trailCount[i] = 0;
    }
    segMeta.fill(0);
    segMeta_N.fill(0);
    segMatRow.fill(-1);
    segMatRow_N.fill(-1);
    trailMatRow.fill(-1);
    slashP1.fill(0);
    boltP1.fill(0);
    if (ribbonAttrs) {
      submitRingBufferRanges(ribbonAttrs[2], 0, totalRibbonSegs, totalRibbonSegs, 4);
      submitRingBufferRanges(ribbonAttrs[5], 0, totalRibbonSegs, totalRibbonSegs, 1);
    }
    if (ribbonNormalAttrs) {
      submitRingBufferRanges(ribbonNormalAttrs[2], 0, totalRibbonSegs, totalRibbonSegs, 4);
      submitRingBufferRanges(ribbonNormalAttrs[5], 0, totalRibbonSegs, totalRibbonSegs, 1);
    }
    if (slashAttrs) submitRingBufferRanges(slashAttrs[1], 0, slashCap, slashCap, 4);
    if (boltAttrs) submitRingBufferRanges(boltAttrs[1], 0, boltCap, boltCap, 4);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const m of [slashMesh, boltMesh, ribbonMesh, ribbonNormalMesh]) {
      if (m) {
        scene?.remove?.(m);
        m.geometry?.dispose?.();
        m.material?.dispose?.();
      }
    }
    uberLut?.dispose?.();
  }

  return {
    slashArc,
    lightningBolt,
    setAtlas,
    registerUberMaterial,
    setTrailTexture,
    setDepthTexture,
    setTrailPoints,
    setAtlasRegions,
    setTrailWidthScale,
    setTrailLifeMod,
    allocTrail,
    pushTrailPoint,
    updateTrailHead,
    freeTrail,
    update,
    renderCanvas2D,
    reset,
    dispose,
    getTime: () => simTime,
    getStats() {
      return {
        slashCap,
        boltCap,
        trailCap,
        trailNodes,
        activeTrails: trailCap - freeTrailTop,
      };
    },
  };
}
