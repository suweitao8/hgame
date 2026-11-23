import { VFX_RENDER_ORDERS } from './vfx-core.js';
import { evaluateColorCurve, evaluateSizeCurve } from './vfx-atlas-particles.js';
import { applyVfxDepthState, getVfxDepthTestIndex, VFX_DEPTH_TESTS } from './vfx-depth-state.js';
import { VFX_FLIPBOOK_GLSL } from './vfx-flipbook.js';
import {
  VFX_COMMON_GLSL,
  VFX_UBER_LUT_GLSL,
  VFX_UBER_FRAGMENT_GLSL,
  UBER_SHADER_KIND,
  createUberMaterialLut,
  compileCustomDataCurves,
  evaluateCustomDataChannel,
  resolveUberShaderKindId,
} from './vfx-shader-chunks.js';

const FULL_TEXTURE_RECT = [0, 0, 1, 1];

export const VFX_MESH_VERTEX_GLSL = /* glsl */ `
uniform vec2 uUvScroll;
uniform vec4 uUvST;
uniform vec3 uPivot;
uniform float uTime;

varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewPos;
varying vec3 vLocalPos;

void main() {
  vUv = uv * uUvST.xy + uUvST.zw + uUvScroll * uTime;
  vec3 shiftedPos = position - uPivot;
  vLocalPos = shiftedPos;
  vNormalView = normalize(normalMatrix * normal);
  vec4 mvPos = modelViewMatrix * vec4(shiftedPos, 1.0);
  vViewPos = -mvPos.xyz;
  gl_Position = projectionMatrix * mvPos;
}
`;

export const VFX_MESH_FRAGMENT_GLSL = /* glsl */ `
precision highp float;

uniform sampler2D uTex;
uniform float uHasTex;
uniform vec4 uTexRect;
uniform float uAtlasUv;
uniform float uFlipLocalV;
uniform vec4 uFlipbook;
uniform float uLifeRatio;
uniform sampler2D uSceneTex;
uniform float uHasSceneTex;
uniform sampler2D uSoftDepthTex;
uniform float uHasSoftDepth;
uniform float uSoftFade;
uniform vec2 uCamNearFar;
uniform float uDistortion;
uniform float uIsMultiply;
uniform float uOpaque;
uniform float uAlphaCutoff;
uniform vec2 uCameraFade;
uniform vec2 uInvViewport;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uHdr;
uniform float uLit;
uniform vec3 uLightDirView;
uniform vec3 uEmission;
uniform vec2 uFresnel;     // power, intensity
uniform vec3 uDissolve;    // progress [0..1], edgeWidth, enabled
uniform vec3 uDissolveColor;
uniform vec4 uCustom1;
uniform vec4 uCustom2;

varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewPos;
varying vec3 vLocalPos;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float valueNoise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
        mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
        mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

${VFX_COMMON_GLSL}

vec4 sampleAtlas(vec2 localUv) {
  vec2 texUv = mix(uTexRect.xy, uTexRect.zw, localUv);
  if (uAtlasUv > 1.5) texUv.y = 1.0 - texUv.y;
  return texture2D(uTex, texUv);
}

vec4 sampleParticleTexture() {
  if (uHasTex < 0.5) return vec4(1.0);
  vec2 localUv = fract(vUv);
  if (uAtlasUv < 0.5) return texture2D(uTex, localUv);
  if (uFlipLocalV > 0.5) localUv.y = 1.0 - localUv.y;
  if (uFlipbook.x < 1.5 && uFlipbook.y < 1.5) return sampleAtlas(localUv);

  vec2 grid = vfxFlipbookGrid(uFlipbook.xy);
  float frame = vfxFlipbookFramePosition(uLifeRatio, grid, uFlipbook.z);
  float first = floor(frame);
  vec4 color = sampleAtlas(vfxFlipbookFrameUv(first, localUv, grid));
  if (uFlipbook.w > 0.5) {
    float next = min(first + 1.0, grid.x * grid.y - 1.0);
    color = mix(color, sampleAtlas(vfxFlipbookFrameUv(next, localUv, grid)), fract(frame));
  }
  return color;
}

void main() {
  vec4 texCol = sampleParticleTexture();
  vec3 N = normalize(vNormalView);
  vec3 V = normalize(vViewPos);
  float alpha = texCol.a * uOpacity;
  if (uDistortion > 0.5) {
    if (uHasSceneTex < 0.5 || alpha < uAlphaCutoff) discard;
    float ndotv = clamp(abs(dot(N, V)), 0.0, 1.0);
    float dAlpha = alpha * smoothstep(0.0, 0.28, ndotv);
    if (dAlpha < 0.005) discard;
    vec2 nOff = (uHasTex > 0.5) ? (texCol.rg * 2.0 - 1.0) : (N.xy * ndotv);
    vec2 screenUv = gl_FragCoord.xy * uInvViewport;
    vec2 refrUv = clamp(screenUv + nOff * 0.038 * dAlpha, vec2(0.002), vec2(0.998));
    gl_FragColor = vec4(texture2D(uSceneTex, refrUv).rgb, clamp(dAlpha, 0.0, 1.0));
    return;
  }

  vec3 baseCol = texCol.rgb * uColor * max(0.0, uHdr) * max(0.0, uCustom1.x + 1.0);
  if (uLit > 0.5) {
    vec3 L = normalize(uLightDirView);
    float ndotl = max(dot(N, L), 0.0);
    float hemi = 0.5 + 0.5 * N.y;
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 28.0) * 0.45;
    baseCol = baseCol * (0.35 + 0.45 * hemi + 0.65 * ndotl) + vec3(spec) * uColor;
  }
  baseCol += texCol.rgb * uEmission;

  if (uFresnel.y > 0.001) {
    float ndotv = clamp(abs(dot(N, V)), 0.0, 1.0);
    float rim = pow(1.0 - ndotv, max(0.25, uFresnel.x)) * uFresnel.y;
    baseCol += uColor * (rim * max(1.0, uHdr));
    alpha = clamp(alpha + rim * uOpacity, 0.0, 1.0);
  }

  if (uDissolve.z > 0.5) {
    float n = valueNoise3(vLocalPos * 4.5 + vec3(0.0, vUv.y * 2.0, 0.0));
    float cut = uDissolve.x;
    if (n < cut) discard;
    float edge = 1.0 - smoothstep(cut, cut + max(0.02, uDissolve.y), n);
    baseCol = mix(baseCol, uDissolveColor * max(1.5, uHdr), edge);
  }

  if (alpha < uAlphaCutoff) discard;
  float camFade = (uCameraFade.y > uCameraFade.x + 0.001)
    ? clamp((abs(vViewPos.z) - uCameraFade.x) / (uCameraFade.y - uCameraFade.x), 0.0, 1.0)
    : 1.0;
  float softMul = vfxComputeSoftFade(uSoftDepthTex, uHasSoftDepth, gl_FragCoord.xy, uInvViewport, uCamNearFar, gl_FragCoord.z, uSoftFade);
  alpha = uOpaque > 0.5 ? 1.0 : alpha * camFade * softMul;
  if (alpha < 0.005) discard;
  if (uIsMultiply > 0.5) {
    gl_FragColor = vec4(mix(vec3(1.0), baseCol, clamp(alpha, 0.0, 1.0)), 1.0);
    return;
  }
  gl_FragColor = vec4(baseCol, alpha);
}
`;

export const VFX_MESH_INSTANCED_VS = /* glsl */ `
attribute vec4 aInstPosScale;   // x, y, z, scaleX
attribute vec4 aInstQuat;       // qx, qy, qz, qw
attribute vec4 aInstScaleInfo;  // scaleY, scaleZ, lifeRatio, flipLocalV
attribute vec4 aInstPivot;      // px, py, pz, hdr
attribute vec4 aInstColor;      // r, g, b, a
attribute vec4 aInstCustom1;    // c1.xyzw
attribute vec4 aInstCustom2;    // c2.xyzw
attribute vec4 aInstMeta;       // uberMatRow, fbCols, fbRows, fbCyclesAndBlend

uniform sampler2D uMaterialLut;
uniform sampler2D uAtlasTex;
uniform float uHasAtlas;
uniform float uFlipV;
uniform float uTime;

varying vec2 vUv;
varying float vLifeRatio;
varying vec4 vInstColor;
varying vec4 vCustom1;
varying vec4 vMeta;
varying float vFlipLocalV;
varying vec3 vNormalView;
varying vec3 vViewDirView;
varying vec3 vNormalWs;
varying vec3 vViewDirWs;

${VFX_COMMON_GLSL}
${VFX_UBER_LUT_GLSL}

vec3 vfxQuatRotate(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

void main() {
  vUv = uv;
  vLifeRatio = aInstScaleInfo.z;
  vInstColor = vec4(aInstColor.rgb * max(0.0, aInstPivot.w), aInstColor.a);
  vCustom1 = aInstCustom1;
  vMeta = aInstMeta;
  vFlipLocalV = aInstScaleInfo.w;

  vec3 pos = position + aInstPivot.xyz;
  vec3 nrm = normalize(normal);

  if (aInstMeta.x > -0.5 && abs(aInstCustom2.x) > 1e-5) {
    vec2 topUv = aInstScaleInfo.w > 0.5 ? vec2(uv.x, 1.0 - uv.y) : uv;
    vec2 vtxUv0 = topUv;
    if (aInstMeta.y > 1.5 || aInstMeta.z > 1.5) {
      vec2 fbG = vfxFlipbookGrid(aInstMeta.yz);
      float fbCyc = mod(aInstMeta.w, 4096.0);
      float fPos = vfxFlipbookFramePosition(aInstScaleInfo.z, fbG, fbCyc);
      vtxUv0 = vfxFlipbookFrameUv(floor(fPos), topUv, fbG);
    }
    pos = vfxEvalUberVertexOffset(
      uMaterialLut, uAtlasTex, uHasAtlas, uFlipV, aInstMeta.x,
      vtxUv0, pos, nrm, aInstCustom2.x, uTime
    );
  }

  vec3 sc = vec3(aInstPosScale.w, aInstScaleInfo.x, aInstScaleInfo.y);
  vec3 safeSc = vec3(
    abs(sc.x) > 1e-4 ? sc.x : (sc.x < 0.0 ? -1e-4 : 1e-4),
    abs(sc.y) > 1e-4 ? sc.y : (sc.y < 0.0 ? -1e-4 : 1e-4),
    abs(sc.z) > 1e-4 ? sc.z : (sc.z < 0.0 ? -1e-4 : 1e-4)
  );
  vec3 worldPos = vfxQuatRotate(aInstQuat, pos * sc) + aInstPosScale.xyz;
  vec3 worldNrm = normalize(vfxQuatRotate(aInstQuat, nrm / safeSc));
  float isOddFlip = (sc.x * sc.y * sc.z) < 0.0 ? 2.0 : 0.0;
  vFlipLocalV = aInstScaleInfo.w + isOddFlip;
  vec4 mvPos = viewMatrix * vec4(worldPos, 1.0);

  vNormalWs = worldNrm;
  vViewDirWs = cameraPosition - worldPos;
  vNormalView = normalize((viewMatrix * vec4(worldNrm, 0.0)).xyz);
  vViewDirView = normalize(-mvPos.xyz);
  gl_Position = projectionMatrix * mvPos;
}
`;

export const VFX_MESH_INSTANCED_FS = /* glsl */ `
precision highp float;

uniform sampler2D uMaterialLut;
uniform sampler2D uAtlasTex;
uniform sampler2D uSceneTex;
uniform sampler2D uSoftDepthTex;
uniform float uHasAtlas;
uniform float uFlipV;
uniform float uHasSceneTex;
uniform float uHasSoftDepth;
uniform float uTime;
uniform float uIsMultiply;
uniform float uIsPremultiply;
uniform float uIsAdditive;
uniform float uOpaque;
uniform vec2 uInvViewport;
uniform vec2 uCamNearFar;
uniform vec3 uLightDirWs;

varying vec2 vUv;
varying float vLifeRatio;
varying vec4 vInstColor;
varying vec4 vCustom1;
varying vec4 vMeta;
varying float vFlipLocalV;
varying vec3 vNormalView;
varying vec3 vViewDirView;
varying vec3 vNormalWs;
varying vec3 vViewDirWs;

${VFX_COMMON_GLSL}
${VFX_UBER_LUT_GLSL}
${VFX_UBER_FRAGMENT_GLSL}

void main() {
  float rowIdx = vMeta.x;
  if (rowIdx < -0.5) discard;
  vec4 hdr = vfxReadMatTexel(uMaterialLut, rowIdx, 0.0);
  float shaderKind = hdr.x;

  float flipLocalVFlag = mod(vFlipLocalV, 2.0);
  float isOddFlip = floor(vFlipLocalV / 2.0);
  bool effFrontFacing = isOddFlip > 0.5 ? !gl_FrontFacing : gl_FrontFacing;

  vec2 uvBase = flipLocalVFlag > 0.5 ? vec2(vUv.x, 1.0 - vUv.y) : vUv;
  vec2 uv0 = uvBase;
  vec2 uvBlend = uvBase;
  float flipBlendFrac = 0.0;
  bool hasFlipBlend = false;
  if (vMeta.y > 1.5 || vMeta.z > 1.5) {
    vec2 fbG = vfxFlipbookGrid(vMeta.yz);
    float fbBlendFlag = floor(vMeta.w / 4096.0);
    float fbCyc = vMeta.w - fbBlendFlag * 4096.0;
    float fPos = vfxFlipbookFramePosition(vLifeRatio, fbG, fbCyc);
    float f0 = floor(fPos);
    uv0 = vfxFlipbookFrameUv(f0, uvBase, fbG);
    if (fbBlendFlag > 0.5) {
      float f1 = min(fbG.x * fbG.y - 1.0, f0 + 1.0);
      uvBlend = vfxFlipbookFrameUv(f1, uvBase, fbG);
      flipBlendFrac = fract(fPos);
      hasFlipBlend = true;
    }
  }

  if (shaderKind > 1.5 && shaderKind < 2.5) {
    gl_FragColor = vfxEvalPilotoWarpFragment(
      uMaterialLut, uAtlasTex, uSceneTex, uHasAtlas, uHasSceneTex, uFlipV,
      rowIdx, uv0, vInstColor, uTime,
      uSoftDepthTex, uHasSoftDepth, gl_FragCoord.xy, uInvViewport, uCamNearFar
    );
    return;
  }

  vec4 res;
  if (shaderKind > 2.5) {
    res = vfxEvalPbrFxFragment(
      uMaterialLut, uAtlasTex, uHasAtlas, uFlipV, rowIdx,
      uv0, vInstColor, vCustom1, uTime,
      vViewDirWs, vNormalWs, uLightDirWs, effFrontFacing
    );
  } else {
    res = vfxEvalUberFragment(
      uMaterialLut, uAtlasTex, uHasAtlas, uFlipV, rowIdx,
      uv0, uvBlend, flipBlendFrac, hasFlipBlend,
      vInstColor, vCustom1, uTime,
      vViewDirView, vNormalView, effFrontFacing,
      uSoftDepthTex, uHasSoftDepth, gl_FragCoord.xy, uInvViewport, uCamNearFar
    );
  }

  if (uOpaque > 0.5) {
    gl_FragColor = vec4(res.rgb, 1.0);
    return;
  }
  if (uIsMultiply > 0.5) {
    gl_FragColor = vec4(mix(vec3(1.0), res.rgb, clamp(res.a, 0.0, 1.0)), 1.0);
    return;
  }
  if (uIsPremultiply > 0.5) {
    gl_FragColor = res;
    return;
  }
  vec3 outRgb = res.rgb;
  float outA = res.a;
  float peak = max(outRgb.r, max(outRgb.g, outRgb.b));
  if (uIsAdditive > 0.5 && peak > 1.0 && outA > 0.0 && outA < 1.0) {
    float boost = min(peak, 1.0 / outA);
    outRgb /= boost;
    outA *= boost;
  }
  gl_FragColor = vec4(outRgb, outA);
}
`;

function extractGeometry(geometryOrObj) {
  if (!geometryOrObj) return null;
  if (geometryOrObj.isBufferGeometry) return geometryOrObj;
  if (geometryOrObj.geometry?.isBufferGeometry) return geometryOrObj.geometry;
  let found = null;
  if (typeof geometryOrObj.traverse === 'function') {
    geometryOrObj.traverse((child) => {
      if (!found && child.geometry?.isBufferGeometry) found = child.geometry;
    });
  }
  return found;
}

function extractTexture(geometryOrObj) {
  if (!geometryOrObj) return null;
  if (geometryOrObj.material?.map?.isTexture) return geometryOrObj.material.map;
  let found = null;
  if (typeof geometryOrObj.traverse === 'function') {
    geometryOrObj.traverse((child) => {
      if (!found && child.material?.map?.isTexture) found = child.material.map;
    });
  }
  return found;
}

function buildBuiltinGeometry(THREE, shapeName) {
  if (!THREE) return null;
  const key = String(shapeName || 'crystal').toLowerCase();
  if (key === 'quad' && THREE.PlaneGeometry) {
    return new THREE.PlaneGeometry(1, 1);
  }
  if (key === 'cube' && THREE.BoxGeometry) {
    return new THREE.BoxGeometry(1, 1, 1);
  }
  if ((key === 'sphere' || key === 'distortion') && THREE.SphereGeometry) {
    return new THREE.SphereGeometry(0.5, 20, 14);
  }
  if (key === 'hemisphere' && THREE.SphereGeometry) {
    return new THREE.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
  }
  if (key === 'ring' && THREE.RingGeometry) {
    const g = new THREE.RingGeometry(0.32, 0.5, 24);
    if (g.rotateX) g.rotateX(-Math.PI * 0.5);
    return g;
  }
  if (key === 'disc' && THREE.CircleGeometry) {
    const g = new THREE.CircleGeometry(0.5, 24);
    if (g.rotateX) g.rotateX(-Math.PI * 0.5);
    return g;
  }
  if (key === 'cone' && THREE.ConeGeometry) {
    return new THREE.ConeGeometry(0.35, 1.0, 10, 1, true);
  }
  if (key === 'cylinder' && THREE.CylinderGeometry) {
    return new THREE.CylinderGeometry(0.45, 0.45, 1.0, 16, 1, true);
  }
  if (THREE.OctahedronGeometry) {
    const g = new THREE.OctahedronGeometry(0.35, 0);
    if (g.scale) g.scale(0.6, 1.6, 0.6);
    return g;
  }
  return THREE.BoxGeometry ? new THREE.BoxGeometry(0.4, 1.0, 0.4) : null;
}

function meshLifeRatio(slot, age = slot.age) {
  if (!slot.persistent) return Math.min(1, age / slot.duration);
  return slot.curveCycle > 0 ? (age / slot.curveCycle) % 1 : 0;
}

/**
 * Pooled 3D Mesh VFX renderer for `renderMode: 'mesh'` layers (shields, ice lances, shock domes).
 * Supports custom GLBs, built-in geometries, UV scrolling, Fresnel rim glow, and procedural dissolve.
 * @param {object} [options]
 * @param {string} [options.mode='headless']
 * @param {object | null} [options.THREE=null]
 * @param {object | null} [options.scene=null]
 * @param {number} [options.maxMeshes=64]
 */
export function createMeshVfxPool({
  mode = 'headless',
  THREE = /** @type {object | null} */ (null),
  scene = /** @type {object | null} */ (null),
  maxMeshes = 64,
} = {}) {
  const capacity = Math.max(1, maxMeshes | 0);
  const instCapacity = Math.max(capacity * 4, 256);
  const customGeometries = new Map();
  const customTextures = new Map();
  const customSurfaceSamples = new Map();
  const builtinGeometries = new Map();
  const slots = [];
  const instSlots = [];
  const instBatches = new Map();
  const scratchColor = new Float32Array(4);
  const scratchC1 = new Float32Array(4);
  const scratchC2 = new Float32Array(4);
  const scratchFwd = THREE?.Vector3 ? new THREE.Vector3(0, 0, 1) : null;
  const scratchDir = THREE?.Vector3 ? new THREE.Vector3(0, 1, 0) : null;
  const scratchQuat = THREE?.Quaternion ? new THREE.Quaternion() : null;
  const scratchQuat2 = THREE?.Quaternion ? new THREE.Quaternion() : null;
  const scratchTrQuat = THREE?.Quaternion ? new THREE.Quaternion() : null;
  const scratchEuler = THREE?.Euler ? new THREE.Euler() : null;
  const windVec = new Float32Array(3);
  const effectDeltas = new Float32Array(32 * 3);
  const uberLut = THREE && THREE.DataTexture ? createUberMaterialLut(THREE) : null;
  const uberMatCache = new Map();
  let atlasRevision = 0;
  let activeAtlasTex = null;
  let atlasRegions = null;
  let atlasFlipVOverride = null;
  let activeSceneTex = null;
  let activeDepthTex = null;
  let softNear = 0.1;
  let softFar = 200;
  let softFadeDist = 0.45;
  let qualityTier = 'high';
  let invViewW = 1 / 1280;
  let invViewH = 1 / 720;
  let simTime = 0;
  let totalSpawned = 0;
  let cursor = 0;
  let instCursor = 0;
  let disposed = false;

  const MatCtor = THREE ? (THREE.ShaderMaterial || THREE.RawShaderMaterial) : null;

  function makeMeshSlot(mesh, mat) {
    return {
      active: false,
      persistent: false,
      curveCycle: 0,
      age: 0,
      duration: 1,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      accelX: 0,
      accelZ: 0,
      windMul: 0,
      gravity: 0,
      drag: 0,
      orbitalY: 0,
      centerX: 0,
      centerZ: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      dirX: 0,
      dirY: 1,
      dirZ: 0,
      hasDir: false,
      spinX: 0,
      spinY: 0,
      spinZ: 0,
      transformRot: null,
      flipX: 1,
      flipY: 1,
      flipZ: 1,
      alignToVelocity: false,
      forwardAxis: 'z',
      space: 'world',
      effectSlotIdx: 0,
      baseScale: 1,
      aspectY: 1,
      aspectZ: 1,
      hdr: 1,
      tintR: 1,
      tintG: 1,
      tintB: 1,
      blend: 'alpha',
      colorCurve: null,
      sizeCurve: null,
      sizeYCurve: null,
      sizeZCurve: null,
      velCurve: null,
      clampVelocity: null,
      rotationBySpeed: null,
      compiledCustom: null,
      custom1: new Float32Array(4),
      custom2: new Float32Array(4),
      randSeed: 0.5,
      uberMat: null,
      uberMatRow: -1,
      instBatch: null,
      flipLocalV: 1,
      pivotX: 0,
      pivotY: 0,
      pivotZ: 0,
      fbCols: 1,
      fbRows: 1,
      fbCycles: 1,
      fbBlend: 0,
      dissolveStart: 0.7,
      dissolveEnabled: false,
      mesh,
      mat,
    };
  }

  for (let i = 0; i < capacity; i++) {
    let mesh = null;
    let mat = null;
    if (mode === '3d' && THREE && scene && THREE.Mesh && MatCtor) {
      mat = new MatCtor({
        vertexShader: VFX_MESH_VERTEX_GLSL,
        fragmentShader: VFX_MESH_FRAGMENT_GLSL,
        uniforms: {
          uTex: { value: null },
          uHasTex: { value: 0 },
          uSceneTex: { value: null },
          uHasSceneTex: { value: 0 },
          uSoftDepthTex: { value: null },
          uHasSoftDepth: { value: 0 },
          uSoftFade: { value: softFadeDist },
          uCamNearFar: { value: THREE.Vector2 ? new THREE.Vector2(softNear, softFar) : { set() {} } },
          uDistortion: { value: 0 },
          uIsMultiply: { value: 0 },
          uOpaque: { value: 0.0 },
          uTexRect: { value: THREE.Vector4 ? new THREE.Vector4(0, 0, 1, 1) : { set() {} } },
          uAtlasUv: { value: 0.0 },
          uFlipLocalV: { value: 1.0 },
          uFlipbook: { value: THREE.Vector4 ? new THREE.Vector4(1, 1, 1, 0) : { set() {} } },
          uLifeRatio: { value: 0 },
          uAlphaCutoff: { value: 0.0 },
          uCameraFade: { value: THREE.Vector2 ? new THREE.Vector2(0, 0) : { set() {} } },
          uInvViewport: { value: THREE.Vector2 ? new THREE.Vector2(invViewW, invViewH) : { set() {} } },
          uColor: { value: THREE.Color ? new THREE.Color(1, 1, 1) : { setRGB() {} } },
          uOpacity: { value: 1 },
          uHdr: { value: 1 },
          uLit: { value: 0 },
          uLightDirView: { value: THREE.Vector3 ? new THREE.Vector3(0.4, 0.8, 0.45) : { set() {} } },
          uEmission: { value: THREE.Color ? new THREE.Color(0, 0, 0) : { setRGB() {} } },
          uUvScroll: { value: THREE.Vector2 ? new THREE.Vector2(0, 0) : { set() {} } },
          uUvST: { value: THREE.Vector4 ? new THREE.Vector4(1, 1, 0, 0) : { set() {} } },
          uPivot: { value: THREE.Vector3 ? new THREE.Vector3(0, 0, 0) : { set() {} } },
          uTime: { value: 0 },
          uFresnel: { value: THREE.Vector2 ? new THREE.Vector2(2.5, 0) : { set() {} } },
          uDissolve: { value: THREE.Vector3 ? new THREE.Vector3(0, 0.08, 0) : { set() {} } },
          uDissolveColor: { value: THREE.Color ? new THREE.Color(1, 0.6, 0.2) : { setRGB() {} } },
          uCustom1: { value: THREE.Vector4 ? new THREE.Vector4(0, 0, 0, 0) : { set() {} } },
          uCustom2: { value: THREE.Vector4 ? new THREE.Vector4(0, 0, 0, 0) : { set() {} } },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
      });
      const defaultGeo = getGeometry('crystal');
      mesh = new THREE.Mesh(defaultGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = VFX_RENDER_ORDERS.PARTICLES;
      mesh.name = `HGameVfxMesh_${i}`;
      scene.add(mesh);
    }

    slots.push(makeMeshSlot(mesh, mat));
  }

  for (let i = 0; i < instCapacity; i++) {
    instSlots.push(makeMeshSlot(null, null));
  }

  function buildSurfaceSamples(geo) {
    const posAttr = geo?.attributes?.position || geo?.getAttribute?.('position');
    if (!posAttr || !posAttr.array) return null;
    const pos = posAttr.array;
    const idx = geo.index?.array || null;
    const triCount = idx ? ((idx.length / 3) | 0) : ((posAttr.count / 3) | 0);
    if (triCount <= 0) return null;
    const sampleCount = Math.min(128, triCount);
    const points = new Float32Array(sampleCount * 3);
    const normals = new Float32Array(sampleCount * 3);
    const step = triCount / sampleCount;
    for (let s = 0; s < sampleCount; s++) {
      const tri = Math.min(triCount - 1, Math.floor((s + 0.5) * step));
      const i0 = idx ? idx[tri * 3] : tri * 3;
      const i1 = idx ? idx[tri * 3 + 1] : tri * 3 + 1;
      const i2 = idx ? idx[tri * 3 + 2] : tri * 3 + 2;
      const ax = pos[i0 * 3], ay = pos[i0 * 3 + 1], az = pos[i0 * 3 + 2];
      const bx = pos[i1 * 3], by = pos[i1 * 3 + 1], bz = pos[i1 * 3 + 2];
      const cx = pos[i2 * 3], cy = pos[i2 * 3 + 1], cz = pos[i2 * 3 + 2];
      points[s * 3] = (ax + bx + cx) / 3;
      points[s * 3 + 1] = (ay + by + cy) / 3;
      points[s * 3 + 2] = (az + bz + cz) / 3;
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-6) {
        nx /= len; ny /= len; nz /= len;
      } else {
        nx = 0; ny = 1; nz = 0;
      }
      normals[s * 3] = nx;
      normals[s * 3 + 1] = ny;
      normals[s * 3 + 2] = nz;
    }
    return { count: sampleCount, points, normals };
  }

  function getGeometry(name) {
    const key = String(name || 'crystal');
    if (customGeometries.has(key)) return customGeometries.get(key);
    if (builtinGeometries.has(key)) return builtinGeometries.get(key);
    const geo = buildBuiltinGeometry(THREE, key);
    if (geo) builtinGeometries.set(key, geo);
    return geo;
  }

  function getSurfaceSamples(name) {
    const key = String(name || 'crystal');
    if (customSurfaceSamples.has(key)) return customSurfaceSamples.get(key);
    const geo = getGeometry(key);
    const samples = buildSurfaceSamples(geo);
    if (samples) customSurfaceSamples.set(key, samples);
    return samples;
  }

  /**
   * Registers a custom Three.js BufferGeometry or Object3D/GLTF scene root for mesh VFX layers.
   * @param {string} id
   * @param {object} geometryOrObject3D
   * @returns {boolean}
   */
  function registerMesh(id, geometryOrObject3D, options = {}) {
    const geo = extractGeometry(geometryOrObject3D);
    if (!id || !geo) return false;
    const key = String(id);
    if (options?.topDownUv && geo.userData) {
      geo.userData.topDownUv = true;
    }
    customGeometries.set(key, geo);
    const samples = buildSurfaceSamples(geo);
    if (samples) customSurfaceSamples.set(key, samples);
    const tex = extractTexture(geometryOrObject3D);
    if (tex) customTextures.set(key, tex);
    return true;
  }

  const customCurveCache = new WeakMap();
  function resolveCompiledCustomData(customData) {
    if (!customData || typeof customData !== 'object') return null;
    if (customCurveCache.has(customData)) return customCurveCache.get(customData);
    const compiled = compileCustomDataCurves(customData);
    customCurveCache.set(customData, compiled);
    return compiled;
  }

  function registerUberMaterial(matSpec) {
    if (!uberLut || !matSpec || typeof matSpec !== 'object') return -1;
    let entry = uberMatCache.get(matSpec);
    if (entry && entry.rev === atlasRevision) return entry.row;
    const key = entry ? entry.key : (matSpec.key || matSpec.name || `uber_mesh_${uberMatCache.size}`);
    const row = uberLut.allocateRow(key, matSpec, atlasRegions);
    uberMatCache.set(matSpec, { row, rev: atlasRevision, key });
    return row;
  }

  function getOrCreateInstBatch(meshKey, blendMode, cullMode, depthTest, depthWrite, opaque, shaderKindId, sortingOrder = 0) {
    const key = `${meshKey}|${blendMode}|${cullMode || 'none'}|${depthTest}|${depthWrite ? 1 : 0}|${opaque ? 1 : 0}|${shaderKindId}|${sortingOrder}`;
    let batch = instBatches.get(key);
    if (batch) return batch;
    const baseGeo = getGeometry(meshKey);
    if (!baseGeo || !THREE?.InstancedBufferGeometry || !MatCtor) return null;

    const geo = new THREE.InstancedBufferGeometry();
    if (baseGeo.index) geo.index = baseGeo.index;
    if (baseGeo.attributes?.position) geo.attributes.position = baseGeo.attributes.position;
    if (baseGeo.attributes?.uv) geo.attributes.uv = baseGeo.attributes.uv;
    if (baseGeo.attributes?.normal) geo.attributes.normal = baseGeo.attributes.normal;
    geo.instanceCount = 0;

    const cap = instCapacity;
    const posScale = new Float32Array(cap * 4);
    const quat = new Float32Array(cap * 4);
    const scaleInfo = new Float32Array(cap * 4);
    const pivot = new Float32Array(cap * 4);
    const color = new Float32Array(cap * 4);
    const custom1 = new Float32Array(cap * 4);
    const custom2 = new Float32Array(cap * 4);
    const meta = new Float32Array(cap * 4);

    const makeAttr = (arr, name) => {
      const a = new THREE.InstancedBufferAttribute(arr, 4);
      if (THREE.DynamicDrawUsage) a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    };
    const attrs = [
      makeAttr(posScale, 'aInstPosScale'),
      makeAttr(quat, 'aInstQuat'),
      makeAttr(scaleInfo, 'aInstScaleInfo'),
      makeAttr(pivot, 'aInstPivot'),
      makeAttr(color, 'aInstColor'),
      makeAttr(custom1, 'aInstCustom1'),
      makeAttr(custom2, 'aInstCustom2'),
      makeAttr(meta, 'aInstMeta'),
    ];

    const isDistortion = blendMode === 'distortion';
    const isMultiply = !opaque && blendMode === 'multiply' && Boolean(THREE?.CustomBlending);
    const isPremul = !opaque && blendMode === 'premultiply' && Boolean(THREE?.CustomBlending);

    const uniforms = {
      uMaterialLut: { value: uberLut ? uberLut.texture : null },
      uAtlasTex: { value: activeAtlasTex },
      uHasAtlas: { value: activeAtlasTex ? 1.0 : 0.0 },
      uFlipV: {
        value: atlasFlipVOverride !== null
          ? (atlasFlipVOverride ? 1.0 : 0.0)
          : (activeAtlasTex && activeAtlasTex.flipY ? 1.0 : 0.0),
      },
      uSceneTex: { value: activeSceneTex },
      uHasSceneTex: { value: activeSceneTex && qualityTier !== 'low' ? 1.0 : 0.0 },
      uSoftDepthTex: { value: activeDepthTex },
      uHasSoftDepth: { value: activeDepthTex && qualityTier !== 'low' ? 1.0 : 0.0 },
      uTime: { value: simTime },
      uIsMultiply: { value: isMultiply ? 1.0 : 0.0 },
      uIsPremultiply: { value: isPremul ? 1.0 : 0.0 },
      uIsAdditive: { value: blendMode === 'additive' ? 1.0 : 0.0 },
      uOpaque: { value: opaque ? 1.0 : 0.0 },
      uInvViewport: { value: THREE.Vector2 ? new THREE.Vector2(invViewW, invViewH) : { set() {} } },
      uCamNearFar: { value: THREE.Vector2 ? new THREE.Vector2(softNear, softFar) : { set() {} } },
      uLightDirWs: { value: THREE.Vector3 ? new THREE.Vector3(0.45, 0.82, 0.35) : { set() {} } },
    };

    const blendCfg = opaque
      ? { blending: THREE.NoBlending }
      : isMultiply
        ? {
            blending: THREE.CustomBlending,
            blendEquation: THREE.AddEquation,
            blendSrc: THREE.DstColorFactor,
            blendDst: THREE.ZeroFactor,
            blendSrcAlpha: THREE.ZeroFactor,
            blendDstAlpha: THREE.OneFactor,
          }
        : isPremul
          ? {
              blending: THREE.CustomBlending,
              blendEquation: THREE.AddEquation,
              blendSrc: THREE.OneFactor,
              blendDst: THREE.OneMinusSrcAlphaFactor,
            }
          : {
              blending: blendMode === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
            };

    const mat = new MatCtor({
      vertexShader: VFX_MESH_INSTANCED_VS,
      fragmentShader: VFX_MESH_INSTANCED_FS,
      uniforms,
      transparent: !opaque,
      side: cullMode === 'front' ? THREE.BackSide : cullMode === 'back' ? THREE.FrontSide : THREE.DoubleSide,
      extensions: { derivatives: true },
      ...blendCfg,
    });
    applyVfxDepthState(mat, THREE, depthTest, depthWrite);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = isDistortion ? (VFX_RENDER_ORDERS.PARTICLES + 2) : (VFX_RENDER_ORDERS.PARTICLES + sortingOrder * 0.01);
    mesh.name = `HGameVfxMeshInst_${instBatches.size}`;
    scene.add(mesh);

    batch = {
      key,
      isDistortion,
      posScale,
      quat,
      scaleInfo,
      pivot,
      color,
      custom1,
      custom2,
      meta,
      attrs,
      geo,
      mat,
      mesh,
      activeCount: 0,
    };
    instBatches.set(key, batch);
    return batch;
  }

  function getSlotByHandle(slotIdx) {
    if (slotIdx < 0) return null;
    if (slotIdx < capacity) return slots[slotIdx];
    const i = slotIdx - capacity;
    return i < instSlots.length ? instSlots[i] : null;
  }

  /**
   * Spawns a pooled 3D mesh VFX instance.
   * @param {object} [opts]
   * @returns {number} Slot index
   */
  function spawn(opts = {}) {
    if (disposed) return -1;
    const useInstanced = Boolean(opts.uberMat && mode === '3d' && THREE && scene && THREE.InstancedBufferGeometry);
    let slotIdx = -1;
    let s = null;
    if (useInstanced) {
      for (let n = 0; n < instSlots.length; n++) {
        const idx = (instCursor + n) % instSlots.length;
        if (!instSlots[idx].active) {
          slotIdx = capacity + idx;
          instCursor = (idx + 1) % instSlots.length;
          s = instSlots[idx];
          break;
        }
      }
      if (!s) {
        slotIdx = capacity + instCursor;
        s = instSlots[instCursor];
        instCursor = (instCursor + 1) % instSlots.length;
      }
    } else {
      for (let n = 0; n < capacity; n++) {
        const idx = (cursor + n) % capacity;
        if (!slots[idx].active) {
          slotIdx = idx;
          break;
        }
      }
      if (slotIdx === -1) slotIdx = cursor;
      cursor = (slotIdx + 1) % capacity;
      s = slots[slotIdx];
    }

    const effSlot = Math.max(0, Math.min(31, (opts.space === 'local' ? (opts.effectSlotIdx | 0) : 0)));
    s.active = true;
    s.persistent = Boolean(opts.persistent);
    s.curveCycle = Number(opts.curveCycle ?? 0);
    s.age = Number.isFinite(opts.initialAge) ? Math.max(0, opts.initialAge) : 0;
    s.duration = Math.max(0.01, opts.duration ?? 0.8);
    s.space = opts.space === 'local' ? 'local' : 'world';
    s.effectSlotIdx = effSlot;
    s.x = (opts.x ?? 0) - (effSlot > 0 ? effectDeltas[effSlot * 3] : 0);
    s.y = (opts.y ?? 0) - (effSlot > 0 ? effectDeltas[effSlot * 3 + 1] : 0);
    s.z = (opts.z ?? 0) - (effSlot > 0 ? effectDeltas[effSlot * 3 + 2] : 0);
    s.vx = opts.vx ?? 0;
    s.vy = opts.vy ?? 0;
    s.vz = opts.vz ?? 0;
    s.accelX = opts.accelX ?? 0;
    s.accelZ = opts.accelZ ?? 0;
    s.windMul = opts.windMul ?? 0;
    s.gravity = opts.gravity ?? 0;
    s.drag = opts.drag ?? 0;
    s.orbitalY = opts.orbitalY ?? 0;
    s.centerX = (opts.centerX ?? opts.x ?? 0) - (effSlot > 0 ? effectDeltas[effSlot * 3] : 0);
    s.centerZ = (opts.centerZ ?? opts.z ?? 0) - (effSlot > 0 ? effectDeltas[effSlot * 3 + 2] : 0);
    s.rotX = opts.rotX ?? 0;
    s.rotY = opts.rotY ?? 0;
    s.rotZ = opts.rotZ ?? 0;
    s.hasDir = opts.dirX !== undefined || opts.dirY !== undefined || opts.dirZ !== undefined;
    s.dirX = opts.dirX ?? 0;
    s.dirY = opts.dirY ?? 1;
    s.dirZ = opts.dirZ ?? 0;
    s.spinX = opts.spinX ?? 0;
    s.spinY = opts.spinY ?? 0;
    s.spinZ = opts.spinZ ?? 0;
    s.transformRot = Array.isArray(opts.transformRot) && opts.transformRot.length >= 4 ? opts.transformRot : null;
    s.flipX = (opts.flipX ?? 1) < 0 ? -1 : 1;
    s.flipY = (opts.flipY ?? 1) < 0 ? -1 : 1;
    s.flipZ = (opts.flipZ ?? 1) < 0 ? -1 : 1;
    s.alignToVelocity = Boolean(opts.alignToVelocity);
    s.forwardAxis = opts.forwardAxis || 'z';
    const meshGlobalScale = Math.max(1e-4, Number(opts.meshGlobalScale ?? 1.0));
    s.meshGlobalScale = meshGlobalScale;
    s.baseScale = (opts.sizeStart ?? opts.scale ?? 1.0) * meshGlobalScale;
    s.aspectY = Math.max(0.05, Number(opts.aspectY ?? 1.0));
    s.aspectZ = Math.max(0.05, Number(opts.aspectZ ?? 1.0));
    s.hdr = opts.hdr ?? 1.0;
    s.tintR = opts.tint?.[0] ?? 1.0;
    s.tintG = opts.tint?.[1] ?? 1.0;
    s.tintB = opts.tint?.[2] ?? 1.0;
    s.blend = opts.blend || (opts.additive ? 'additive' : 'alpha');
    s.colorCurve = Array.isArray(opts.colorCurve) ? opts.colorCurve : null;
    s.sizeCurve = Array.isArray(opts.sizeCurve) ? opts.sizeCurve : null;
    s.sizeYCurve = Array.isArray(opts.sizeYCurve) ? opts.sizeYCurve : null;
    s.sizeZCurve = Array.isArray(opts.sizeZCurve) ? opts.sizeZCurve : null;
    s.velCurve = Array.isArray(opts.velCurve) ? opts.velCurve : null;
    s.clampVelocity = opts.clampVelocity && Number(opts.clampVelocity.limit) > 0 ? opts.clampVelocity : null;
    s.rotationBySpeed = opts.rotationBySpeed && opts.rotationBySpeed.enabled ? opts.rotationBySpeed : null;
    s.compiledCustom = resolveCompiledCustomData(opts.customData);
    s.randSeed = Number.isFinite(opts.phase) ? opts.phase : ((totalSpawned * 0.61803398875) % 1);
    if (!s.compiledCustom && (Array.isArray(opts.custom1) || Array.isArray(opts.custom2))) {
      s.custom1.set([opts.custom1?.[0] ?? 0, opts.custom1?.[1] ?? 0, opts.custom1?.[2] ?? 0, opts.custom1?.[3] ?? 0]);
      s.custom2.set([opts.custom2?.[0] ?? 0, opts.custom2?.[1] ?? 0, opts.custom2?.[2] ?? 0, opts.custom2?.[3] ?? 0]);
    } else {
      s.custom1.fill(0);
      s.custom2.fill(0);
    }
    s.dissolveEnabled = Boolean(opts.dissolve);
    s.dissolveStart = opts.dissolve?.start ?? 0.55;
    s.uberMat = opts.uberMat || null;
    s.uberMatRow = s.uberMat ? registerUberMaterial(s.uberMat) : -1;
    const pv = opts.pivot || [0, 0, 0];
    s.pivotX = pv[0] ?? 0;
    s.pivotY = pv[1] ?? 0;
    s.pivotZ = pv[2] ?? 0;
    const fb = opts.flipbook;
    s.fbCols = Math.max(1, fb?.cols | 0);
    s.fbRows = Math.max(1, fb?.rows | 0);
    s.fbCycles = fb?.cycles ?? 1;
    s.fbBlend = (s.fbCols > 1 || s.fbRows > 1) && fb?.blend !== false ? 1 : 0;

    if (s.age > 0) {
      const steps = Math.min(32, Math.ceil(s.age * 60));
      const step = s.age / steps;
      for (let i = 1; i <= steps; i++) advanceMeshMotion(s, step, meshLifeRatio(s, i * step));
    }

    if (useInstanced) {
      const meshKey = String(opts.mesh || 'crystal');
      const blendMode = s.blend;
      const isDistortion = blendMode === 'distortion';
      const opaque = !isDistortion && Boolean(opts.opaque);
      const depthTest = getVfxDepthTestIndex(opts.depthTest);
      const depthWrite = depthTest !== 0 && (opts.depthWrite ?? opaque);
      const shaderKindId = resolveUberShaderKindId(opts.uberMat.shaderKind);
      const sortOrd = !isDistortion && Number.isFinite(opts.sortingOrder) ? (opts.sortingOrder | 0) : 0;
      s.instBatch = getOrCreateInstBatch(meshKey, blendMode, opts.cullMode || 'none', depthTest, depthWrite, opaque, shaderKindId, sortOrd);
      const geo = getGeometry(meshKey);
      s.flipLocalV = geo?.userData?.topDownUv ? 0 : 1;
      if (s.instBatch) {
        pushSlotToBatch(s, s.instBatch, meshLifeRatio(s));
        commitInstBatch(s.instBatch);
      }
    } else if (s.mesh && s.mat) {
      s.instBatch = null;
      const meshKey = String(opts.mesh || 'crystal');
      const geo = getGeometry(meshKey);
      if (geo && s.mesh.geometry !== geo) s.mesh.geometry = geo;
      const blendMode = s.blend;
      const isDistortion = blendMode === 'distortion';
      const opaque = !isDistortion && Boolean(opts.opaque);
      const isMultiply = !opaque && blendMode === 'multiply' && Boolean(THREE?.CustomBlending);
      const isPremul = !opaque && blendMode === 'premultiply' && Boolean(THREE?.CustomBlending);
      if (THREE) {
        if (opaque) {
          s.mat.blending = THREE.NoBlending;
        } else if (isMultiply) {
          s.mat.blending = THREE.CustomBlending;
          s.mat.blendEquation = THREE.AddEquation;
          s.mat.blendSrc = THREE.DstColorFactor;
          s.mat.blendDst = THREE.ZeroFactor;
          s.mat.blendSrcAlpha = THREE.ZeroFactor;
          s.mat.blendDstAlpha = THREE.OneFactor;
        } else if (isPremul) {
          s.mat.blending = THREE.CustomBlending;
          s.mat.blendEquation = THREE.AddEquation;
          s.mat.blendSrc = THREE.OneFactor;
          s.mat.blendDst = THREE.OneMinusSrcAlphaFactor;
          s.mat.blendSrcAlpha = THREE.OneFactor;
          s.mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
        } else {
          s.mat.blending = blendMode === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
        }
        s.mat.side = opts.cullMode === 'front'
          ? THREE.BackSide
          : opts.cullMode === 'back'
            ? THREE.FrontSide
            : THREE.DoubleSide;
      }
      applyVfxDepthState(s.mat, THREE, getVfxDepthTestIndex(opts.depthTest), opts.depthWrite ?? opaque);
      s.mat.transparent = !opaque;
      s.mat.uniforms.uDistortion.value = isDistortion ? 1.0 : 0.0;
      s.mat.uniforms.uIsMultiply.value = isMultiply ? 1.0 : 0.0;
      s.mat.uniforms.uOpaque.value = opaque ? 1.0 : 0.0;
      s.mat.uniforms.uAlphaCutoff.value = opts.alphaCutoff ?? 0.0;
      const cf = opts.cameraFade || [0, 0];
      s.mat.uniforms.uCameraFade.value.set(cf[0] ?? 0, cf[1] ?? 0);
      s.mat.uniforms.uSceneTex.value = activeSceneTex;
      s.mat.uniforms.uHasSceneTex.value = activeSceneTex && qualityTier !== 'low' ? 1.0 : 0.0;
      s.mat.uniforms.uSoftDepthTex.value = activeDepthTex;
      s.mat.uniforms.uHasSoftDepth.value = activeDepthTex && qualityTier !== 'low' ? 1.0 : 0.0;
      s.mat.uniforms.uSoftFade.value = softFadeDist;
      s.mat.uniforms.uCamNearFar.value.set(softNear, softFar);
      s.mat.uniforms.uInvViewport.value.set(invViewW, invViewH);
      s.mat.uniforms.uLit.value = opts.lit ? 1.0 : 0.0;
      const em = opts.emission || [0, 0, 0];
      s.mat.uniforms.uEmission.value.setRGB(em[0] ?? 0, em[1] ?? 0, em[2] ?? 0);
      const uvScroll = opts.uvScroll || [0, 0];
      s.mat.uniforms.uUvScroll.value.set(uvScroll[0] ?? 0, uvScroll[1] ?? 0);
      const uvS = opts.uvScale || [1, 1];
      const uvO = opts.uvOffset || [0, 0];
      s.mat.uniforms.uUvST.value.set(uvS[0] ?? 1, uvS[1] ?? 1, uvO[0] ?? 0, uvO[1] ?? 0);
      s.mat.uniforms.uPivot.value.set(s.pivotX, s.pivotY, s.pivotZ);
      const fresnel = opts.fresnel;
      s.mat.uniforms.uFresnel.value.set(fresnel?.power ?? 2.5, fresnel?.intensity ?? 0);
      const resolvedTex = opts.useTexture === false ? null : (opts.texture ?? customTextures.get(meshKey) ?? null);
      s.mat.uniforms.uTex.value = resolvedTex;
      s.mat.uniforms.uHasTex.value = resolvedTex ? 1 : 0;
      const hasSheet = s.fbCols > 1 || s.fbRows > 1;
      const texRect = resolvedTex ? (opts.textureRect ?? (hasSheet ? FULL_TEXTURE_RECT : null)) : null;
      s.mat.uniforms.uAtlasUv.value = texRect ? (resolvedTex?.flipY ? 2 : 1) : 0;
      s.mat.uniforms.uFlipLocalV.value = (opts.texture && opts.textureRect) || resolvedTex?.flipY ? 1 : 0;
      if (texRect) s.mat.uniforms.uTexRect.value.set(texRect[0], texRect[1], texRect[2], texRect[3]);
      s.mat.uniforms.uFlipbook.value.set(s.fbCols, s.fbRows, s.fbCycles, s.fbBlend);
      const dc = opts.dissolve?.edgeColor || [1, 0.7, 0.25];
      s.mat.uniforms.uDissolveColor.value.setRGB(dc[0] ?? 1, dc[1] ?? 0.7, dc[2] ?? 0.25);
      s.mat.uniforms.uDissolve.value.set(0, opts.dissolve?.edgeWidth ?? 0.08, s.dissolveEnabled ? 1 : 0);
      syncMeshSlot(s, meshLifeRatio(s));
      s.mesh.visible = isDistortion ? (qualityTier !== 'low' && Boolean(activeSceneTex)) : true;
    }

    totalSpawned += 1;
    return slotIdx;
  }

  function computeSlotQuat(s) {
    if (!scratchQuat || !scratchEuler) return;
    if (s.alignToVelocity && scratchFwd && scratchDir) {
      const spd = Math.hypot(s.vx, s.vy, s.vz);
      const ax = spd > 0.001 ? s.vx : (s.hasDir ? s.dirX : 0);
      const ay = spd > 0.001 ? s.vy : (s.hasDir ? s.dirY : 0);
      const az = spd > 0.001 ? s.vz : (s.hasDir ? s.dirZ : 0);
      const dLen = Math.hypot(ax, ay, az);
      if (dLen > 0.001) {
        if (s.forwardAxis === 'y') scratchFwd.set(0, 1, 0);
        else if (s.forwardAxis === 'x') scratchFwd.set(1, 0, 0);
        else scratchFwd.set(0, 0, 1);
        scratchDir.set(ax / dLen, ay / dLen, az / dLen);
        scratchQuat.setFromUnitVectors(scratchFwd, scratchDir);
        if ((s.rotX !== 0 || s.rotY !== 0 || s.rotZ !== 0) && scratchQuat2) {
          scratchEuler.set(s.rotX, s.rotY, s.rotZ, 'YXZ');
          scratchQuat2.setFromEuler(scratchEuler);
          scratchQuat.multiply(scratchQuat2);
        }
        return;
      }
    }
    scratchEuler.set(s.rotX, s.rotY, s.rotZ, s.transformRot ? 'YXZ' : 'XYZ');
    scratchQuat.setFromEuler(scratchEuler);
    if (s.transformRot && scratchTrQuat) {
      scratchTrQuat.set(s.transformRot[0], s.transformRot[1], s.transformRot[2], s.transformRot[3]);
      scratchQuat.premultiply(scratchTrQuat);
    }
  }

  function pushSlotToBatch(s, batch, t) {
    const idx = batch.activeCount;
    if (idx >= instCapacity) return;
    batch.activeCount = idx + 1;
    const i4 = idx * 4;

    const sc = s.baseScale * evaluateSizeCurve(s.sizeCurve, t) * s.flipX;
    const scY = (s.sizeYCurve ? (s.baseScale * evaluateSizeCurve(s.sizeYCurve, t)) : Math.abs(sc)) * s.aspectY * s.flipY;
    const scZ = (s.sizeZCurve ? (s.baseScale * evaluateSizeCurve(s.sizeZCurve, t)) : Math.abs(sc)) * s.aspectZ * s.flipZ;
    evaluateColorCurve(s.colorCurve, t, scratchColor);
    const ox = s.effectSlotIdx > 0 ? effectDeltas[s.effectSlotIdx * 3] : 0;
    const oy = s.effectSlotIdx > 0 ? effectDeltas[s.effectSlotIdx * 3 + 1] : 0;
    const oz = s.effectSlotIdx > 0 ? effectDeltas[s.effectSlotIdx * 3 + 2] : 0;

    batch.posScale[i4] = s.x + ox;
    batch.posScale[i4 + 1] = s.y + oy;
    batch.posScale[i4 + 2] = s.z + oz;
    batch.posScale[i4 + 3] = sc;

    computeSlotQuat(s);
    if (scratchQuat) {
      batch.quat[i4] = scratchQuat.x;
      batch.quat[i4 + 1] = scratchQuat.y;
      batch.quat[i4 + 2] = scratchQuat.z;
      batch.quat[i4 + 3] = scratchQuat.w;
    } else {
      batch.quat[i4] = 0; batch.quat[i4 + 1] = 0; batch.quat[i4 + 2] = 0; batch.quat[i4 + 3] = 1;
    }

    batch.scaleInfo[i4] = scY;
    batch.scaleInfo[i4 + 1] = scZ;
    batch.scaleInfo[i4 + 2] = t;
    batch.scaleInfo[i4 + 3] = s.flipLocalV + ((sc * scY * scZ) < 0 ? 2 : 0);

    batch.pivot[i4] = s.pivotX;
    batch.pivot[i4 + 1] = s.pivotY;
    batch.pivot[i4 + 2] = s.pivotZ;
    batch.pivot[i4 + 3] = s.hdr;

    batch.color[i4] = scratchColor[0] * s.tintR;
    batch.color[i4 + 1] = scratchColor[1] * s.tintG;
    batch.color[i4 + 2] = scratchColor[2] * s.tintB;
    batch.color[i4 + 3] = scratchColor[3];

    if (s.compiledCustom) {
      evaluateCustomDataChannel(s.compiledCustom.custom1, t, s.randSeed, batch.custom1, i4);
      evaluateCustomDataChannel(s.compiledCustom.custom2, t, s.randSeed, batch.custom2, i4);
    } else {
      batch.custom1[i4] = s.custom1[0]; batch.custom1[i4 + 1] = s.custom1[1];
      batch.custom1[i4 + 2] = s.custom1[2]; batch.custom1[i4 + 3] = s.custom1[3];
      batch.custom2[i4] = s.custom2[0]; batch.custom2[i4 + 1] = s.custom2[1];
      batch.custom2[i4 + 2] = s.custom2[2]; batch.custom2[i4 + 3] = s.custom2[3];
    }
    if (s.meshGlobalScale !== 1.0) {
      batch.custom2[i4] /= s.meshGlobalScale;
    }

    const row = s.uberMat ? registerUberMaterial(s.uberMat) : s.uberMatRow;
    batch.meta[i4] = row;
    batch.meta[i4 + 1] = s.fbCols;
    batch.meta[i4 + 2] = s.fbRows;
    batch.meta[i4 + 3] = (s.fbCycles & 4095) + s.fbBlend * 4096;
  }

  function commitInstBatch(batch) {
    batch.geo.instanceCount = batch.activeCount;
    batch.mat.uniforms.uTime.value = simTime;
    batch.mesh.visible = batch.activeCount > 0
      && (batch.isDistortion ? (qualityTier !== 'low' && Boolean(activeSceneTex)) : true);
    if (batch.activeCount > 0) {
      for (let a = 0; a < batch.attrs.length; a++) {
        batch.attrs[a].needsUpdate = true;
      }
    }
  }

  function syncMeshSlot(s, t) {
    if (!s.mesh || !s.mat) return;
    const sc = s.baseScale * evaluateSizeCurve(s.sizeCurve, t) * s.flipX;
    const scY = (s.sizeYCurve ? (s.baseScale * evaluateSizeCurve(s.sizeYCurve, t)) : Math.abs(sc)) * s.aspectY * s.flipY;
    const scZ = (s.sizeZCurve ? (s.baseScale * evaluateSizeCurve(s.sizeZCurve, t)) : Math.abs(sc)) * s.aspectZ * s.flipZ;
    evaluateColorCurve(s.colorCurve, t, scratchColor);
    const ox = s.effectSlotIdx > 0 ? effectDeltas[s.effectSlotIdx * 3] : 0;
    const oy = s.effectSlotIdx > 0 ? effectDeltas[s.effectSlotIdx * 3 + 1] : 0;
    const oz = s.effectSlotIdx > 0 ? effectDeltas[s.effectSlotIdx * 3 + 2] : 0;
    s.mesh.position.set(s.x + ox, s.y + oy, s.z + oz);
    if (scratchQuat) {
      computeSlotQuat(s);
      s.mesh.quaternion.copy(scratchQuat);
    } else {
      s.mesh.rotation.set(s.rotX, s.rotY, s.rotZ);
    }
    s.mesh.scale.set(sc, scY, scZ);
    s.mat.uniforms.uTime.value = simTime;
    s.mat.uniforms.uLifeRatio.value = t;
    s.mat.uniforms.uColor.value.setRGB(scratchColor[0] * s.tintR, scratchColor[1] * s.tintG, scratchColor[2] * s.tintB);
    s.mat.uniforms.uOpacity.value = scratchColor[3];
    s.mat.uniforms.uHdr.value = s.hdr;
    if (s.dissolveEnabled) {
      const cut = t <= s.dissolveStart ? 0 : (t - s.dissolveStart) / Math.max(0.01, 1 - s.dissolveStart);
      s.mat.uniforms.uDissolve.value.x = Math.max(0, Math.min(1.05, cut));
    }
  }

  function updateSlot(slotIdx, x, y, z, vx, vy, vz) {
    const s = getSlotByHandle(slotIdx);
    if (!s || !s.active) return;
    const ox = s.effectSlotIdx > 0 ? effectDeltas[s.effectSlotIdx * 3] : 0;
    const oy = s.effectSlotIdx > 0 ? effectDeltas[s.effectSlotIdx * 3 + 1] : 0;
    const oz = s.effectSlotIdx > 0 ? effectDeltas[s.effectSlotIdx * 3 + 2] : 0;
    s.x = x - ox;
    s.y = y - oy;
    s.z = z - oz;
    s.vx = vx;
    s.vy = vy;
    s.vz = vz;
  }

  /** Copies the slot's current world position and velocity into caller-owned buffers. */
  function readSlotMotion(slotIdx, position, velocity) {
    const s = getSlotByHandle(slotIdx);
    if (!s?.active) return;
    const base = s.effectSlotIdx * 3;
    position[0] = s.x + effectDeltas[base];
    position[1] = s.y + effectDeltas[base + 1];
    position[2] = s.z + effectDeltas[base + 2];
    velocity[0] = s.vx;
    velocity[1] = s.vy;
    velocity[2] = s.vz;
  }

  function setWind(wx = 0, wy = 0, wz = 0) {
    windVec[0] = wx;
    windVec[1] = wy;
    windVec[2] = wz;
  }

  function setEffectOffset(slotIdx, x = 0, y = 0, z = 0) {
    const idx = slotIdx | 0;
    if (idx <= 0 || idx >= 32) return;
    effectDeltas[idx * 3] = x;
    effectDeltas[idx * 3 + 1] = y;
    effectDeltas[idx * 3 + 2] = z;
  }

  function setAtlas(textureOrCanvas, newRegions, options = {}) {
    atlasFlipVOverride = typeof options?.flipV === 'boolean' ? options.flipV : null;
    if (textureOrCanvas && (textureOrCanvas.isTexture || textureOrCanvas.isCompressedTexture)) {
      activeAtlasTex = textureOrCanvas;
    } else if (THREE && THREE.CanvasTexture && textureOrCanvas) {
      activeAtlasTex = new THREE.CanvasTexture(textureOrCanvas);
      activeAtlasTex.flipY = false;
      activeAtlasTex.needsUpdate = true;
    } else {
      activeAtlasTex = textureOrCanvas || null;
    }
    if (newRegions) atlasRegions = { ...newRegions };
    atlasRevision += 1;
    if (uberLut && uberMatCache.size > 0) {
      for (const [spec, entry] of uberMatCache) {
        uberLut.packRow(entry.row, spec, atlasRegions);
        entry.rev = atlasRevision;
      }
      uberLut.texture.needsUpdate = true;
    }
    for (const batch of instBatches.values()) {
      batch.mat.uniforms.uAtlasTex.value = activeAtlasTex;
      batch.mat.uniforms.uHasAtlas.value = activeAtlasTex ? 1.0 : 0.0;
      batch.mat.uniforms.uFlipV.value = atlasFlipVOverride !== null
        ? (atlasFlipVOverride ? 1.0 : 0.0)
        : (activeAtlasTex && activeAtlasTex.flipY ? 1.0 : 0.0);
    }
  }

  function setDepthTexture(depthTexture, { near = 0.1, far = 200, width = 1280, height = 720, softFade = 0.45 } = {}) {
    activeDepthTex = depthTexture || null;
    softNear = near;
    softFar = far;
    softFadeDist = softFade;
    invViewW = 1 / Math.max(1, width);
    invViewH = 1 / Math.max(1, height);
    const hasSoft = activeDepthTex && qualityTier !== 'low' ? 1.0 : 0.0;
    for (let i = 0; i < capacity; i++) {
      const s = slots[i];
      if (!s.mat) continue;
      s.mat.uniforms.uSoftDepthTex.value = activeDepthTex;
      s.mat.uniforms.uHasSoftDepth.value = hasSoft;
      s.mat.uniforms.uSoftFade.value = softFadeDist;
      s.mat.uniforms.uCamNearFar.value.set(softNear, softFar);
      s.mat.uniforms.uInvViewport.value.set(invViewW, invViewH);
    }
    for (const batch of instBatches.values()) {
      batch.mat.uniforms.uSoftDepthTex.value = activeDepthTex;
      batch.mat.uniforms.uHasSoftDepth.value = hasSoft;
      batch.mat.uniforms.uCamNearFar.value.set(softNear, softFar);
      batch.mat.uniforms.uInvViewport.value.set(invViewW, invViewH);
    }
  }

  function setSceneTexture(sceneTexture, { width = 1280, height = 720 } = {}) {
    activeSceneTex = sceneTexture || null;
    invViewW = 1 / Math.max(1, width);
    invViewH = 1 / Math.max(1, height);
    const hasScene = activeSceneTex && qualityTier !== 'low' ? 1.0 : 0.0;
    for (let i = 0; i < capacity; i++) {
      const s = slots[i];
      if (!s.mat) continue;
      s.mat.uniforms.uSceneTex.value = activeSceneTex;
      s.mat.uniforms.uHasSceneTex.value = hasScene;
      s.mat.uniforms.uInvViewport.value.set(invViewW, invViewH);
      if (s.active && s.mat.uniforms.uDistortion.value > 0.5 && s.mesh) {
        s.mesh.visible = Boolean(hasScene);
      }
    }
    for (const batch of instBatches.values()) {
      batch.mat.uniforms.uSceneTex.value = activeSceneTex;
      batch.mat.uniforms.uHasSceneTex.value = hasScene;
      batch.mat.uniforms.uInvViewport.value.set(invViewW, invViewH);
      if (batch.isDistortion) {
        batch.mesh.visible = batch.activeCount > 0 && Boolean(hasScene);
      }
    }
  }

  function setQualityTier(tier = 'high') {
    qualityTier = tier === 'low' ? 'low' : (tier === 'medium' ? 'medium' : 'high');
    setDepthTexture(activeDepthTex, { near: softNear, far: softFar, width: Math.round(1 / invViewW), height: Math.round(1 / invViewH), softFade: softFadeDist });
    setSceneTexture(activeSceneTex, { width: Math.round(1 / invViewW), height: Math.round(1 / invViewH) });
  }

  function hasActiveDistortion() {
    if (disposed || qualityTier === 'low') return false;
    for (let i = 0; i < capacity; i++) {
      if (slots[i].active && slots[i].blend === 'distortion') return true;
    }
    for (let i = 0; i < instSlots.length; i++) {
      if (instSlots[i].active && instSlots[i].blend === 'distortion') return true;
    }
    return false;
  }

  function advanceMeshMotion(s, dt, t) {
    if (s.drag > 0.001) {
      const d = Math.exp(-s.drag * dt);
      s.vx *= d;
      s.vy *= d;
      s.vz *= d;
    }
    const ax = s.accelX + windVec[0] * s.windMul;
    const ay = -s.gravity + windVec[1] * s.windMul;
    const az = s.accelZ + windVec[2] * s.windMul;
    s.vx += ax * dt;
    s.vy += ay * dt;
    s.vz += az * dt;
    if (s.clampVelocity && s.clampVelocity.limit > 0) {
      const spd = Math.hypot(s.vx, s.vy, s.vz);
      const lim = s.clampVelocity.limit;
      if (spd > lim) {
        const cDampen = Math.max(0, Math.min(1, Number(s.clampVelocity.dampen ?? 1)));
        const nextSpd = spd - (spd - lim) * cDampen;
        const sc = nextSpd / spd;
        s.vx *= sc;
        s.vy *= sc;
        s.vz *= sc;
      }
    }
    const vScale = s.velCurve ? evaluateSizeCurve(s.velCurve, t) : 1.0;
    s.x += s.vx * vScale * dt;
    s.y += s.vy * vScale * dt;
    s.z += s.vz * vScale * dt;
    if (Math.abs(s.orbitalY) > 0.0001) {
      const oa = s.orbitalY * dt;
      const oc = Math.cos(oa);
      const os = Math.sin(oa);
      const rx = s.x - s.centerX;
      const rz = s.z - s.centerZ;
      s.x = s.centerX + rx * oc - rz * os;
      s.z = s.centerZ + rx * os + rz * oc;
      const vx = s.vx;
      const vz = s.vz;
      s.vx = vx * oc - vz * os;
      s.vz = vx * os + vz * oc;
    }
    if (s.rotationBySpeed) {
      const spd = Math.hypot(s.vx, s.vy, s.vz);
      const minS = Number(s.rotationBySpeed.minSpeed ?? 0);
      const maxS = Math.max(minS + 1e-4, Number(s.rotationBySpeed.maxSpeed ?? 10));
      const rFrac = Math.max(0, Math.min(1, (spd - minS) / (maxS - minS)));
      const minW = Number(s.rotationBySpeed.minAngularVel ?? 0);
      const maxW = Number(s.rotationBySpeed.maxAngularVel ?? 0);
      s.rotZ += (minW + (maxW - minW) * rFrac) * dt;
    }
    s.rotX += s.spinX * dt;
    s.rotY += s.spinY * dt;
    s.rotZ += s.spinZ * dt;
  }

  function update(visualDt) {
    const dt = Math.max(0, visualDt);
    simTime += dt;
    for (let i = 0; i < capacity; i++) {
      const s = slots[i];
      if (!s.active) continue;
      s.age += dt;
      if (!s.persistent && s.age >= s.duration) {
        s.active = false;
        if (s.mesh) s.mesh.visible = false;
        continue;
      }
      const t = meshLifeRatio(s);
      if (dt > 0) advanceMeshMotion(s, dt, t);
      syncMeshSlot(s, t);
    }
    for (const batch of instBatches.values()) {
      batch.activeCount = 0;
    }
    for (let i = 0; i < instSlots.length; i++) {
      const s = instSlots[i];
      if (!s.active) continue;
      s.age += dt;
      if (!s.persistent && s.age >= s.duration) {
        s.active = false;
        continue;
      }
      const t = meshLifeRatio(s);
      if (dt > 0) advanceMeshMotion(s, dt, t);
      if (s.instBatch) pushSlotToBatch(s, s.instBatch, t);
    }
    for (const batch of instBatches.values()) {
      commitInstBatch(batch);
    }
  }

  function reset() {
    simTime = 0;
    cursor = 0;
    instCursor = 0;
    effectDeltas.fill(0);
    for (let i = 0; i < capacity; i++) {
      slots[i].active = false;
      if (slots[i].mesh) slots[i].mesh.visible = false;
    }
    for (let i = 0; i < instSlots.length; i++) {
      instSlots[i].active = false;
    }
    for (const batch of instBatches.values()) {
      batch.activeCount = 0;
      batch.geo.instanceCount = 0;
      batch.mesh.visible = false;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (let i = 0; i < capacity; i++) {
      const s = slots[i];
      if (s.mesh) scene?.remove?.(s.mesh);
      s.mat?.dispose?.();
      s.active = false;
    }
    for (let i = 0; i < instSlots.length; i++) instSlots[i].active = false;
    for (const batch of instBatches.values()) {
      scene?.remove?.(batch.mesh);
      batch.geo?.dispose?.();
      batch.mat?.dispose?.();
    }
    instBatches.clear();
    uberMatCache.clear();
    uberLut?.dispose?.();
    for (const geo of builtinGeometries.values()) {
      geo?.dispose?.();
    }
    builtinGeometries.clear();
    customGeometries.clear();
    customSurfaceSamples.clear();
    customTextures.clear();
  }

  function getActiveCount() {
    let count = 0;
    for (let i = 0; i < capacity; i++) {
      if (slots[i].active) count += 1;
    }
    for (let i = 0; i < instSlots.length; i++) {
      if (instSlots[i].active) count += 1;
    }
    return count;
  }

  return {
    capacity,
    registerMesh,
    registerUberMaterial,
    getSurfaceSamples,
    spawn,
    readSlotMotion,
    updateSlot,
    setWind,
    setEffectOffset,
    setAtlas,
    setDepthTexture,
    setSceneTexture,
    setQualityTier,
    hasActiveDistortion,
    update,
    reset,
    dispose,
    getStats() {
      return {
        capacity,
        activeCount: getActiveCount(),
        instancedBatches: instBatches.size,
        totalSpawned,
        registeredMeshes: customGeometries.size,
      };
    },
  };
}
