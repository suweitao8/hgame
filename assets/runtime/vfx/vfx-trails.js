import {
  VFX_RENDER_ORDERS,
  createVisualPrng,
  packRgb24,
  submitRingBufferRanges,
  unpackRgb24Into,
} from './vfx-core.js';

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

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform float uIs2D;

varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vHdr;

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
  vUv = vec2(1.0 - spanT, position.y + 0.5);
  vec3 c0 = unpackRgb24(aSegMeta.x);
  vec3 c1 = unpackRgb24(aSegExtra.x);
  vColor = mix(c0, c1, spanT);
  vAlpha = mix(aSegMeta.z, aSegMeta.w, u);
  vHdr = aSegExtra.w;

  vec3 a = aSegA.xyz;
  vec3 b = aSegB.xyz;
  vec3 seg = b - a;
  float len = length(seg);
  if (len <= 0.0001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 dir = seg / len;
  vec3 side = (uIs2D > 0.5)
    ? vec3(-dir.y, dir.x, 0.0)
    : normalize(cross(dir, vec3(0.0, 1.0, 0.001)));

  float wScale = mix(aSegExtra.y, aSegExtra.z, u);
  vec3 worldPos = mix(a, b, u) + side * (position.y * w * wScale);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
}
`;

export const RIBBON_FRAGMENT_GLSL = /* glsl */ `
precision highp float;

uniform sampler2D uTrailTex;
uniform float uHasTrailTex;
uniform float uTrailFlipV;
uniform vec4 uTrailUvRect;

varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vHdr;

void main() {
  float alpha = vAlpha;
  vec3 col = vColor;
  if (uHasTrailTex > 0.5) {
    float localV = 1.0 - vUv.y;
    vec2 mapped = vec2(
      mix(uTrailUvRect.x, uTrailUvRect.z, clamp(vUv.x, 0.0, 1.0)),
      mix(uTrailUvRect.y, uTrailUvRect.w, localV)
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
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col * max(0.0, vHdr), alpha);
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
  const trailPoints = new Float32Array(trailCap * trailNodes * 3);
  const trailHead = new Int32Array(trailCap);
  const trailCount = new Int32Array(trailCap);
  const trailColor = new Float32Array(trailCap);
  const trailEndColor = new Float32Array(trailCap);
  const trailWidth = new Float32Array(trailCap);
  const trailEndWidthScale = new Float32Array(trailCap);
  const trailHdr = new Float32Array(trailCap);
  const trailActive = new Uint8Array(trailCap);
  const freeTrailStack = new Int32Array(trailCap);
  let freeTrailTop = trailCap;
  for (let i = 0; i < trailCap; i++) freeTrailStack[i] = trailCap - 1 - i;

  let simTime = 0;
  let disposed = false;
  const scratchRgb = new Float32Array(3);

  let slashMesh = null;
  let slashAttrs = null;
  let slashMat = null;
  let boltMesh = null;
  let boltAttrs = null;
  let boltMat = null;
  let ribbonMesh = null;
  let ribbonAttrs = null;
  let ribbonMat = null;

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
    rGeo.setAttribute('aSegA', ra0);
    rGeo.setAttribute('aSegB', ra1);
    rGeo.setAttribute('aSegMeta', ra2);
    rGeo.setAttribute('aSegExtra', ra3);
    ribbonMat = new MatCtor({
      vertexShader: RIBBON_VERTEX_GLSL,
      fragmentShader: RIBBON_FRAGMENT_GLSL,
      uniforms: {
        uIs2D: { value: is2D ? 1.0 : 0.0 },
        uTrailTex: { value: null },
        uHasTrailTex: { value: 0.0 },
        uTrailFlipV: { value: 0.0 },
        uTrailUvRect: { value: THREE.Vector4 ? new THREE.Vector4(0, 0, 1, 1) : { set() {} } },
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
    ribbonAttrs = [ra0, ra1, ra2, ra3];
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
    const count = trailCount[trackId];
    const segBase = trackId * segsPerTrail;
    const rgb = trailColor[trackId];
    const endRgb = trailEndColor[trackId];
    const w = trailWidth[trackId];
    const endScale = trailEndWidthScale[trackId];
    const hdr = trailHdr[trackId];

    for (let s = 0; s < segsPerTrail; s++) {
      const segIdx = segBase + s;
      const i4 = segIdx * 4;
      if (s >= count - 1) {
        segMeta[i4 + 1] = 0;
        segMeta[i4 + 2] = 0;
        segMeta[i4 + 3] = 0;
        continue;
      }
      const idxA = (trailHead[trackId] - 1 - s + trailNodes) % trailNodes;
      const idxB = (trailHead[trackId] - 2 - s + trailNodes) % trailNodes;
      const pA = (trackId * trailNodes + idxA) * 3;
      const pB = (trackId * trailNodes + idxB) * 3;

      const t0 = s / Math.max(1, count - 1);
      const t1 = (s + 1) / Math.max(1, count - 1);

      segA[i4] = trailPoints[pA];
      segA[i4 + 1] = trailPoints[pA + 1];
      segA[i4 + 2] = trailPoints[pA + 2];
      segA[i4 + 3] = t0;
      segB[i4] = trailPoints[pB];
      segB[i4 + 1] = trailPoints[pB + 1];
      segB[i4 + 2] = trailPoints[pB + 2];
      segB[i4 + 3] = t1;

      segMeta[i4] = rgb;
      segMeta[i4 + 1] = w;
      segMeta[i4 + 2] = Math.max(0, 1 - t0);
      segMeta[i4 + 3] = Math.max(0, 1 - t1);

      segExtra[i4] = endRgb;
      segExtra[i4 + 1] = 1 + (endScale - 1) * t0;
      segExtra[i4 + 2] = 1 + (endScale - 1) * t1;
      segExtra[i4 + 3] = hdr;
    }

    if (ribbonAttrs) {
      for (let i = 0; i < ribbonAttrs.length; i++) {
        submitRingBufferRanges(ribbonAttrs[i], segBase, segsPerTrail, totalRibbonSegs, 4);
      }
    }
  }

  /**
   * Binds an optional texture and top-down UV rect `[u0, v0, u1, v1]` for ribbon trails.
   * @param {object | null} texture
   * @param {readonly number[]} [uvRect]
   */
  function setTrailTexture(texture, uvRect = [0, 0, 1, 1]) {
    if (!ribbonMat) return;
    ribbonMat.uniforms.uTrailTex.value = texture;
    ribbonMat.uniforms.uHasTrailTex.value = texture ? 1.0 : 0.0;
    ribbonMat.uniforms.uTrailFlipV.value = texture && texture.flipY ? 1.0 : 0.0;
    ribbonMat.uniforms.uTrailUvRect.value.set(uvRect[0] ?? 0, uvRect[1] ?? 0, uvRect[2] ?? 1, uvRect[3] ?? 1);
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
    if (typeof colorOrOpts === 'object' && colorOrOpts !== null) {
      const startRgb = packRgb24(colorOrOpts.color ?? 0x38bdf8);
      const wStart = colorOrOpts.width ?? width;
      const wEnd = colorOrOpts.endWidth ?? 0;
      trailColor[id] = startRgb;
      trailEndColor[id] = colorOrOpts.endColor !== undefined ? packRgb24(colorOrOpts.endColor) : startRgb;
      trailWidth[id] = wStart;
      trailEndWidthScale[id] = wStart > 0.0001 ? Math.max(0, wEnd / wStart) : 0;
      trailHdr[id] = colorOrOpts.hdr ?? 1.0;
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

  function pushTrailPoint(trackId, x, y, z = 0) {
    if (trackId < 0 || trackId >= trailCap || !trailActive[trackId]) return;
    const h = trailHead[trackId];
    const p = (trackId * trailNodes + h) * 3;
    trailPoints[p] = x;
    trailPoints[p + 1] = y;
    trailPoints[p + 2] = z;
    trailHead[trackId] = (h + 1) % trailNodes;
    if (trailCount[trackId] < trailNodes) trailCount[trackId] += 1;
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
    slashP1.fill(0);
    boltP1.fill(0);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const m of [slashMesh, boltMesh, ribbonMesh]) {
      if (m) {
        scene?.remove?.(m);
        m.geometry?.dispose?.();
        m.material?.dispose?.();
      }
    }
  }

  return {
    slashArc,
    lightningBolt,
    setTrailTexture,
    allocTrail,
    pushTrailPoint,
    freeTrail,
    update,
    renderCanvas2D,
    reset,
    dispose,
    getStats() {
      return {
        slashCap,
        boltCap,
        trailCap,
        activeTrails: trailCap - freeTrailTop,
      };
    },
  };
}
