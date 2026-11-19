import { VFX_RENDER_ORDERS } from './vfx-core.js';
import { evaluateColorCurve, evaluateSizeCurve } from './vfx-atlas-particles.js';

export const VFX_MESH_VERTEX_GLSL = /* glsl */ `
uniform vec2 uUvScroll;
uniform float uTime;

varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewPos;
varying vec3 vLocalPos;

void main() {
  vUv = uv + uUvScroll * uTime;
  vLocalPos = position;
  vNormalView = normalize(normalMatrix * normal);
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  vViewPos = -mvPos.xyz;
  gl_Position = projectionMatrix * mvPos;
}
`;

export const VFX_MESH_FRAGMENT_GLSL = /* glsl */ `
precision highp float;

uniform sampler2D uTex;
uniform float uHasTex;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uHdr;
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
  float alpha = texCol.a * uOpacity;
  vec3 baseCol = texCol.rgb * uColor * max(0.0, uHdr);

  if (uFresnel.y > 0.001) {
    vec3 N = normalize(vNormalView);
    vec3 V = normalize(vViewPos);
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

  if (alpha < 0.005) discard;
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

function buildBuiltinGeometry(THREE, shapeName) {
  if (!THREE) return null;
  const key = String(shapeName || 'crystal').toLowerCase();
  if (key === 'sphere' && THREE.SphereGeometry) {
    return new THREE.SphereGeometry(0.5, 16, 12);
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
  const builtinGeometries = new Map();
  const slots = [];
  const scratchColor = new Float32Array(4);
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
          uColor: { value: THREE.Color ? new THREE.Color(1, 1, 1) : { setRGB() {} } },
          uOpacity: { value: 1 },
          uHdr: { value: 1 },
          uUvScroll: { value: THREE.Vector2 ? new THREE.Vector2(0, 0) : { set() {} } },
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
      age: 0,
      duration: 1,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      gravity: 0,
      drag: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      spinX: 0,
      spinY: 0,
      spinZ: 0,
      baseScale: 1,
      hdr: 1,
      /** @type {Array<[number, number[]]> | null} */
      colorCurve: null,
      /** @type {Array<[number, number]> | null} */
      sizeCurve: null,
      dissolveStart: 0.7,
      dissolveEnabled: false,
      mesh,
      mat,
    });
  }

  function getGeometry(name) {
    const key = String(name || 'crystal');
    if (customGeometries.has(key)) return customGeometries.get(key);
    if (builtinGeometries.has(key)) return builtinGeometries.get(key);
    const geo = buildBuiltinGeometry(THREE, key);
    if (geo) builtinGeometries.set(key, geo);
    return geo;
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
    customGeometries.set(String(id), geo);
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
    s.active = true;
    s.age = 0;
    s.duration = Math.max(0.01, opts.duration ?? 0.8);
    s.x = opts.x ?? 0;
    s.y = opts.y ?? 0;
    s.z = opts.z ?? 0;
    s.vx = opts.vx ?? 0;
    s.vy = opts.vy ?? 0;
    s.vz = opts.vz ?? 0;
    s.gravity = opts.gravity ?? 0;
    s.drag = opts.drag ?? 0;
    s.rotX = opts.rotX ?? 0;
    s.rotY = opts.rotY ?? 0;
    s.rotZ = opts.rotZ ?? 0;
    s.spinX = opts.spinX ?? 0;
    s.spinY = opts.spinY ?? 0;
    s.spinZ = opts.spinZ ?? 0;
    s.baseScale = opts.sizeStart ?? opts.scale ?? 1.0;
    s.hdr = opts.hdr ?? 1.0;
    s.colorCurve = Array.isArray(opts.colorCurve) ? opts.colorCurve : null;
    s.sizeCurve = Array.isArray(opts.sizeCurve) ? opts.sizeCurve : null;
    s.dissolveEnabled = Boolean(opts.dissolve);
    s.dissolveStart = opts.dissolve?.start ?? 0.55;

    if (s.mesh && s.mat) {
      const geo = getGeometry(opts.mesh || 'crystal');
      if (geo && s.mesh.geometry !== geo) s.mesh.geometry = geo;
      const additive = opts.blend === 'additive' || Boolean(opts.additive);
      if (THREE) {
        s.mat.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      }
      const uvScroll = opts.uvScroll || [0, 0];
      s.mat.uniforms.uUvScroll.value.set(uvScroll[0] ?? 0, uvScroll[1] ?? 0);
      const fresnel = opts.fresnel;
      s.mat.uniforms.uFresnel.value.set(fresnel?.power ?? 2.5, fresnel?.intensity ?? 0);
      s.mat.uniforms.uTex.value = opts.texture ?? null;
      s.mat.uniforms.uHasTex.value = opts.texture ? 1 : 0;
      const dc = opts.dissolve?.edgeColor || [1, 0.7, 0.25];
      s.mat.uniforms.uDissolveColor.value.setRGB(dc[0] ?? 1, dc[1] ?? 0.7, dc[2] ?? 0.25);
      s.mat.uniforms.uDissolve.value.set(0, opts.dissolve?.edgeWidth ?? 0.08, s.dissolveEnabled ? 1 : 0);
      syncMeshSlot(s, 0);
      s.mesh.visible = true;
    }

    totalSpawned += 1;
    return slotIdx;
  }

  function syncMeshSlot(s, t) {
    if (!s.mesh || !s.mat) return;
    const sc = s.baseScale * evaluateSizeCurve(s.sizeCurve, t);
    evaluateColorCurve(s.colorCurve, t, scratchColor);
    s.mesh.position.set(s.x, s.y, s.z);
    s.mesh.rotation.set(s.rotX, s.rotY, s.rotZ);
    s.mesh.scale.set(sc, sc, sc);
    s.mat.uniforms.uTime.value = simTime;
    s.mat.uniforms.uColor.value.setRGB(scratchColor[0], scratchColor[1], scratchColor[2]);
    s.mat.uniforms.uOpacity.value = scratchColor[3];
    s.mat.uniforms.uHdr.value = s.hdr;
    if (s.dissolveEnabled) {
      const cut = t <= s.dissolveStart ? 0 : (t - s.dissolveStart) / Math.max(0.01, 1 - s.dissolveStart);
      s.mat.uniforms.uDissolve.value.x = Math.max(0, Math.min(1.05, cut));
    }
  }

  function update(visualDt) {
    const dt = Math.max(0, visualDt);
    simTime += dt;
    for (let i = 0; i < capacity; i++) {
      const s = slots[i];
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= s.duration) {
        s.active = false;
        if (s.mesh) s.mesh.visible = false;
        continue;
      }
      if (dt > 0) {
        if (s.drag > 0.001) {
          const d = Math.exp(-s.drag * dt);
          s.vx *= d;
          s.vy *= d;
          s.vz *= d;
        }
        s.vy -= s.gravity * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.z += s.vz * dt;
        s.rotX += s.spinX * dt;
        s.rotY += s.spinY * dt;
        s.rotZ += s.spinZ * dt;
      }
      syncMeshSlot(s, s.age / s.duration);
    }
  }

  function reset() {
    simTime = 0;
    cursor = 0;
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
    spawn,
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
