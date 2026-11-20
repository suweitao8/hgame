import { VFX_RENDER_ORDERS } from './vfx-core.js';
import { evaluateColorCurve, evaluateSizeCurve } from './vfx-atlas-particles.js';

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
uniform sampler2D uSceneTex;
uniform float uHasSceneTex;
uniform float uDistortion;
uniform float uIsMultiply;
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

void main() {
  vec4 texCol = (uHasTex > 0.5) ? texture2D(uTex, fract(vUv)) : vec4(1.0);
  vec3 N = normalize(vNormalView);
  vec3 V = normalize(vViewPos);
  if (uDistortion > 0.5) {
    if (uHasSceneTex < 0.5) discard;
    float ndotv = clamp(abs(dot(N, V)), 0.0, 1.0);
    float dAlpha = texCol.a * uOpacity * smoothstep(0.0, 0.28, ndotv);
    if (dAlpha < 0.005) discard;
    vec2 nOff = (uHasTex > 0.5) ? (texCol.rg * 2.0 - 1.0) : (N.xy * ndotv);
    vec2 screenUv = gl_FragCoord.xy * uInvViewport;
    vec2 refrUv = clamp(screenUv + nOff * 0.038 * dAlpha, vec2(0.002), vec2(0.998));
    gl_FragColor = vec4(texture2D(uSceneTex, refrUv).rgb, clamp(dAlpha, 0.0, 1.0));
    return;
  }

  float camFade = (uCameraFade.y > uCameraFade.x + 0.001)
    ? clamp((length(vViewPos) - uCameraFade.x) / (uCameraFade.y - uCameraFade.x), 0.0, 1.0)
    : 1.0;
  float alpha = texCol.a * uOpacity * camFade;
  vec3 baseCol = texCol.rgb * uColor * max(0.0, uHdr);
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

  if (alpha < max(0.005, uAlphaCutoff)) discard;
  if (uAlphaCutoff > 0.02) alpha = 1.0;
  if (uIsMultiply > 0.5) {
    gl_FragColor = vec4(mix(vec3(1.0), clamp(baseCol, 0.0, 1.0), clamp(alpha, 0.0, 1.0)), 1.0);
    return;
  }
  gl_FragColor = vec4(baseCol, alpha);
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
  const customGeometries = new Map();
  const customTextures = new Map();
  const customSurfaceSamples = new Map();
  const builtinGeometries = new Map();
  const slots = [];
  const scratchColor = new Float32Array(4);
  const scratchFwd = THREE?.Vector3 ? new THREE.Vector3(0, 0, 1) : null;
  const scratchDir = THREE?.Vector3 ? new THREE.Vector3(0, 1, 0) : null;
  const scratchQuat = THREE?.Quaternion ? new THREE.Quaternion() : null;
  const windVec = new Float32Array(3);
  const effectDeltas = new Float32Array(32 * 3);
  let activeSceneTex = null;
  let invViewW = 1 / 1280;
  let invViewH = 1 / 720;
  let simTime = 0;
  let totalSpawned = 0;
  let cursor = 0;
  let disposed = false;

  const MatCtor = THREE ? (THREE.ShaderMaterial || THREE.RawShaderMaterial) : null;

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
          uDistortion: { value: 0 },
          uIsMultiply: { value: 0 },
          uAlphaCutoff: { value: 0.005 },
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

    slots.push({
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
      alignToVelocity: false,
      forwardAxis: 'z',
      space: 'world',
      effectSlotIdx: 0,
      baseScale: 1,
      aspectY: 1,
      hdr: 1,
      tintR: 1,
      tintG: 1,
      tintB: 1,
      /** @type {Array<[number, number[]]> | null} */
      colorCurve: null,
      /** @type {Array<[number, number]> | null} */
      sizeCurve: null,
      /** @type {Array<[number, number]> | null} */
      sizeYCurve: null,
      /** @type {Array<[number, number]> | null} */
      velCurve: null,
      dissolveStart: 0.7,
      dissolveEnabled: false,
      mesh,
      mat,
    });
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
  function registerMesh(id, geometryOrObject3D) {
    const geo = extractGeometry(geometryOrObject3D);
    if (!id || !geo) return false;
    const key = String(id);
    customGeometries.set(key, geo);
    const samples = buildSurfaceSamples(geo);
    if (samples) customSurfaceSamples.set(key, samples);
    const tex = extractTexture(geometryOrObject3D);
    if (tex) customTextures.set(key, tex);
    return true;
  }

  /**
   * Spawns a pooled 3D mesh VFX instance.
   * @param {object} [opts]
   * @returns {number} Slot index
   */
  function spawn(opts = {}) {
    if (disposed) return -1;
    let slotIdx = -1;
    for (let n = 0; n < capacity; n++) {
      const idx = (cursor + n) % capacity;
      if (!slots[idx].active) {
        slotIdx = idx;
        break;
      }
    }
    if (slotIdx === -1) {
      slotIdx = cursor;
    }
    cursor = (slotIdx + 1) % capacity;

    const s = slots[slotIdx];
    const effSlot = Math.max(0, Math.min(31, (opts.space === 'local' ? (opts.effectSlotIdx | 0) : 0)));
    s.active = true;
    s.persistent = Boolean(opts.persistent);
    s.curveCycle = Number(opts.curveCycle ?? 0);
    s.age = 0;
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
    s.alignToVelocity = Boolean(opts.alignToVelocity);
    s.forwardAxis = opts.forwardAxis || 'z';
    s.baseScale = (opts.sizeStart ?? opts.scale ?? 1.0) * Number(opts.meshGlobalScale ?? 1.0);
    s.aspectY = Math.max(0.05, Number(opts.aspectY ?? 1.0));
    s.hdr = opts.hdr ?? 1.0;
    s.tintR = opts.tint?.[0] ?? 1.0;
    s.tintG = opts.tint?.[1] ?? 1.0;
    s.tintB = opts.tint?.[2] ?? 1.0;
    s.colorCurve = Array.isArray(opts.colorCurve) ? opts.colorCurve : null;
    s.sizeCurve = Array.isArray(opts.sizeCurve) ? opts.sizeCurve : null;
    s.sizeYCurve = Array.isArray(opts.sizeYCurve) ? opts.sizeYCurve : null;
    s.velCurve = Array.isArray(opts.velCurve) ? opts.velCurve : null;
    s.dissolveEnabled = Boolean(opts.dissolve);
    s.dissolveStart = opts.dissolve?.start ?? 0.55;

    if (s.mesh && s.mat) {
      const meshKey = String(opts.mesh || 'crystal');
      const geo = getGeometry(meshKey);
      if (geo && s.mesh.geometry !== geo) s.mesh.geometry = geo;
      const blendMode = opts.blend || (opts.additive ? 'additive' : 'alpha');
      const isDistortion = blendMode === 'distortion';
      const isMultiply = blendMode === 'multiply';
      const isPremul = blendMode === 'premultiply';
      if (THREE) {
        if (isMultiply && THREE.CustomBlending) {
          s.mat.blending = THREE.CustomBlending;
          s.mat.blendEquation = THREE.AddEquation;
          s.mat.blendSrc = THREE.DstColorFactor;
          s.mat.blendDst = THREE.ZeroFactor;
        } else if (isPremul && THREE.CustomBlending) {
          s.mat.blending = THREE.CustomBlending;
          s.mat.blendEquation = THREE.AddEquation;
          s.mat.blendSrc = THREE.OneFactor;
          s.mat.blendDst = THREE.OneMinusSrcAlphaFactor;
        } else {
          s.mat.blending = blendMode === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
        }
        s.mat.side = opts.cullMode === 'front'
          ? THREE.BackSide
          : opts.cullMode === 'back'
            ? THREE.FrontSide
            : THREE.DoubleSide;
      }
      s.mat.depthWrite = isDistortion ? false : Boolean(opts.opaque);
      s.mat.transparent = isDistortion ? true : !opts.opaque;
      s.mat.uniforms.uDistortion.value = isDistortion ? 1.0 : 0.0;
      s.mat.uniforms.uIsMultiply.value = isMultiply ? 1.0 : 0.0;
      s.mat.uniforms.uAlphaCutoff.value = opts.alphaCutoff ?? 0.005;
      const cf = opts.cameraFade || [0, 0];
      s.mat.uniforms.uCameraFade.value.set(cf[0] ?? 0, cf[1] ?? 0);
      s.mat.uniforms.uSceneTex.value = activeSceneTex;
      s.mat.uniforms.uHasSceneTex.value = activeSceneTex ? 1.0 : 0.0;
      s.mat.uniforms.uInvViewport.value.set(invViewW, invViewH);
      s.mat.uniforms.uLit.value = opts.lit ? 1.0 : 0.0;
      const em = opts.emission || [0, 0, 0];
      s.mat.uniforms.uEmission.value.setRGB(em[0] ?? 0, em[1] ?? 0, em[2] ?? 0);
      const uvScroll = opts.uvScroll || [0, 0];
      s.mat.uniforms.uUvScroll.value.set(uvScroll[0] ?? 0, uvScroll[1] ?? 0);
      const uvS = opts.uvScale || [1, 1];
      const uvO = opts.uvOffset || [0, 0];
      s.mat.uniforms.uUvST.value.set(uvS[0] ?? 1, uvS[1] ?? 1, uvO[0] ?? 0, uvO[1] ?? 0);
      const pv = opts.pivot || [0, 0, 0];
      s.mat.uniforms.uPivot.value.set(pv[0] ?? 0, pv[1] ?? 0, pv[2] ?? 0);
      const fresnel = opts.fresnel;
      s.mat.uniforms.uFresnel.value.set(fresnel?.power ?? 2.5, fresnel?.intensity ?? 0);
      const resolvedTex = opts.texture ?? customTextures.get(meshKey) ?? null;
      s.mat.uniforms.uTex.value = resolvedTex;
      s.mat.uniforms.uHasTex.value = resolvedTex ? 1 : 0;
      const dc = opts.dissolve?.edgeColor || [1, 0.7, 0.25];
      s.mat.uniforms.uDissolveColor.value.setRGB(dc[0] ?? 1, dc[1] ?? 0.7, dc[2] ?? 0.25);
      s.mat.uniforms.uDissolve.value.set(0, opts.dissolve?.edgeWidth ?? 0.08, s.dissolveEnabled ? 1 : 0);
      syncMeshSlot(s, 0);
      s.mesh.visible = isDistortion ? Boolean(activeSceneTex) : true;
    }

    totalSpawned += 1;
    return slotIdx;
  }

  function syncMeshSlot(s, t) {
    if (!s.mesh || !s.mat) return;
    const sc = s.baseScale * evaluateSizeCurve(s.sizeCurve, t);
    const scY = (s.sizeYCurve ? (s.baseScale * evaluateSizeCurve(s.sizeYCurve, t)) : sc) * s.aspectY;
    evaluateColorCurve(s.colorCurve, t, scratchColor);
    const ox = s.effectSlotIdx > 0 ? effectDeltas[s.effectSlotIdx * 3] : 0;
    const oy = s.effectSlotIdx > 0 ? effectDeltas[s.effectSlotIdx * 3 + 1] : 0;
    const oz = s.effectSlotIdx > 0 ? effectDeltas[s.effectSlotIdx * 3 + 2] : 0;
    s.mesh.position.set(s.x + ox, s.y + oy, s.z + oz);
    if (s.alignToVelocity && scratchFwd && scratchDir && scratchQuat) {
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
        s.mesh.quaternion.copy(scratchQuat);
        if (s.rotZ !== 0) s.mesh.rotateZ(s.rotZ);
      } else {
        s.mesh.rotation.set(s.rotX, s.rotY, s.rotZ);
      }
    } else {
      s.mesh.rotation.set(s.rotX, s.rotY, s.rotZ);
    }
    s.mesh.scale.set(sc, scY, sc);
    s.mat.uniforms.uTime.value = simTime;
    s.mat.uniforms.uColor.value.setRGB(scratchColor[0] * s.tintR, scratchColor[1] * s.tintG, scratchColor[2] * s.tintB);
    s.mat.uniforms.uOpacity.value = scratchColor[3];
    s.mat.uniforms.uHdr.value = s.hdr;
    if (s.dissolveEnabled) {
      const cut = t <= s.dissolveStart ? 0 : (t - s.dissolveStart) / Math.max(0.01, 1 - s.dissolveStart);
      s.mat.uniforms.uDissolve.value.x = Math.max(0, Math.min(1.05, cut));
    }
  }

  function updateSlot(slotIdx, x, y, z, vx, vy, vz) {
    if (slotIdx < 0 || slotIdx >= capacity) return;
    const s = slots[slotIdx];
    if (!s.active) return;
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

  function setSceneTexture(sceneTexture, { width = 1280, height = 720 } = {}) {
    activeSceneTex = sceneTexture || null;
    invViewW = 1 / Math.max(1, width);
    invViewH = 1 / Math.max(1, height);
    for (let i = 0; i < capacity; i++) {
      const s = slots[i];
      if (!s.mat) continue;
      s.mat.uniforms.uSceneTex.value = activeSceneTex;
      s.mat.uniforms.uHasSceneTex.value = activeSceneTex ? 1.0 : 0.0;
      s.mat.uniforms.uInvViewport.value.set(invViewW, invViewH);
      if (s.active && s.mat.uniforms.uDistortion.value > 0.5 && s.mesh) {
        s.mesh.visible = Boolean(activeSceneTex);
      }
    }
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
      const t = s.persistent
        ? (s.curveCycle > 0 ? ((s.age / s.curveCycle) % 1) : 0)
        : (s.age / s.duration);
      if (dt > 0) {
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
        s.rotX += s.spinX * dt;
        s.rotY += s.spinY * dt;
        s.rotZ += s.spinZ * dt;
      }
      syncMeshSlot(s, t);
    }
  }

  function reset() {
    simTime = 0;
    cursor = 0;
    effectDeltas.fill(0);
    for (let i = 0; i < capacity; i++) {
      slots[i].active = false;
      if (slots[i].mesh) slots[i].mesh.visible = false;
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
    return count;
  }

  return {
    capacity,
    registerMesh,
    getSurfaceSamples,
    spawn,
    updateSlot,
    setWind,
    setEffectOffset,
    setSceneTexture,
    update,
    reset,
    dispose,
    getStats() {
      return {
        capacity,
        activeCount: getActiveCount(),
        totalSpawned,
        registeredMeshes: customGeometries.size,
      };
    },
  };
}
