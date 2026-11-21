/**
 * Directional shadow frustum fitter shared between the Three.js adapter
 * and procedural sky helpers without pulling sky shaders into minimal 3D builds.
 */
import { readWorldPosition, writeWorldPosition } from './shadow3d/transform.js';

/** @typedef {[number, number, number]} ShadowVec3Tuple Direction/point [x, y, z]. */
/** @typedef {ShadowVec3Tuple|{ x: number, y: number, z: number }} ShadowVec3Input */
/**
 * @typedef {object} DirectionalLightLike
 * @property {{ x: number, y: number, z: number, set?(x: number, y: number, z: number): unknown }} [position]
 * @property {{ position: { x: number, y: number, z: number, set?(x: number, y: number, z: number): unknown }, updateMatrixWorld?(force?: boolean): void }} [target]
 * @property {{ camera: { left: number, right: number, top: number, bottom: number, near: number, far: number, updateProjectionMatrix?(): void }, mapSize?: { x: number, y: number }, bias: number, normalBias?: number }} shadow
 */
/**
 * @typedef {object} ShadowFitBounds Either {min,max} or {center,radius}.
 * @property {ShadowVec3Tuple} [min]
 * @property {ShadowVec3Tuple} [max]
 * @property {ShadowVec3Tuple} [center]
 * @property {number} [radius]
 */
/**
 * @typedef {object} ShadowFitOptions
 * @property {ShadowVec3Input|null} [sunDirection=null] Defaults to the world-space direction from the target to the light.
 * @property {number} [distance=40] Light distance from bounds centre, world units.
 * @property {number} [padding=2] World units added on each side.
 * @property {boolean} [snapToTexels=true] Snap to shadow-map texels to avoid shimmer.
 * @property {number|null} [bias=-0.0003]
 * @property {number|null} [normalBias=0.02]
 */
/**
 * @typedef {object} ShadowFrustum
 * @property {number} left
 * @property {number} right
 * @property {number} bottom
 * @property {number} top
 * @property {number} near
 * @property {number} far
 */

export function normalizeShadowVec3(input, fallback) {
  const arr = Array.isArray(input) ? input : (input ? [input.x, input.y, input.z] : fallback);
  const x = Number.isFinite(arr[0]) ? arr[0] : fallback[0];
  const y = Number.isFinite(arr[1]) ? arr[1] : fallback[1];
  const z = Number.isFinite(arr[2]) ? arr[2] : fallback[2];
  const len = Math.hypot(x, y, z);
  return len > 1e-8 ? [x / len, y / len, z / len] : [...fallback];
}

/**
 * Fits a DirectionalLight's orthographic shadow frustum tightly around scene
 * or receiver bounds and optionally snaps to shadow-map texels to avoid shimmer.
 * @param {{ Vector3: new (x?: number, y?: number, z?: number) => any }} THREE
 * @param {DirectionalLightLike} light
 * @param {ShadowFitBounds} bounds
 * @param {ShadowFitOptions} [options]
 * @returns {ShadowFrustum} The applied orthographic bounds.
 */
export function fitDirectionalShadowFrustum(THREE, light, bounds, {
  sunDirection = null,
  distance = 40,
  padding = 2,
  snapToTexels = true,
  bias = -0.0003,
  normalBias = 0.02,
} = {}) {
  if (!THREE?.Vector3 || !light?.shadow?.camera) {
    throw new TypeError('fitDirectionalShadowFrustum requires THREE.Vector3 and a DirectionalLight with shadow.camera');
  }
  if (!bounds || typeof bounds !== 'object') throw new TypeError('bounds object is required');

  let minX, minY, minZ, maxX, maxY, maxZ;
  if (Array.isArray(bounds.min) && Array.isArray(bounds.max)) {
    [minX, minY, minZ] = bounds.min;
    [maxX, maxY, maxZ] = bounds.max;
  } else if (Array.isArray(bounds.center) && Number.isFinite(bounds.radius)) {
    const r = Math.abs(bounds.radius);
    [minX, minY, minZ] = [bounds.center[0] - r, bounds.center[1] - r, bounds.center[2] - r];
    [maxX, maxY, maxZ] = [bounds.center[0] + r, bounds.center[1] + r, bounds.center[2] + r];
  } else {
    throw new TypeError('bounds must specify { min, max } or { center, radius }');
  }

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const cam = light.shadow.camera;
  const scratch = new THREE.Vector3();
  const currentDirection = sunDirection == null && light.position && light.target
    ? readWorldPosition(light, new THREE.Vector3()).sub(readWorldPosition(light.target, scratch))
    : null;
  const dirArr = normalizeShadowVec3(
    sunDirection ?? currentDirection,
    [0.46, 0.72, 0.52],
  );

  // Light looks from target + dirArr * distance toward target (cx, cy, cz).
  const dir = new THREE.Vector3(dirArr[0], dirArr[1], dirArr[2]);
  const lx = cx + dir.x * distance;
  const ly = cy + dir.y * distance;
  const lz = cz + dir.z * distance;
  const cameraUp = cam.up ?? new THREE.Vector3(0, 1, 0);
  const backward = new THREE.Vector3(lx - cx, ly - cy, lz - cz);
  if (backward.lengthSq() === 0) backward.z = 1;
  backward.normalize();
  const right = new THREE.Vector3().crossVectors(cameraUp, backward);
  // Match Three.js lookAt for a shadow direction parallel to the camera up axis.
  if (right.lengthSq() === 0) {
    if (Math.abs(cameraUp.z) === 1) backward.x += 0.0001;
    else backward.z += 0.0001;
    right.crossVectors(cameraUp, backward.normalize());
  }
  right.normalize();
  const up = new THREE.Vector3().crossVectors(backward, right);

  let left = Infinity, rightBound = -Infinity;
  let bottom = Infinity, top = -Infinity;
  let nearDist = Infinity, farDist = -Infinity;

  for (let ix = 0; ix < 2; ix++) {
    const px = (ix === 0 ? minX : maxX) - lx;
    for (let iy = 0; iy < 2; iy++) {
      const py = (iy === 0 ? minY : maxY) - ly;
      for (let iz = 0; iz < 2; iz++) {
        const pz = (iz === 0 ? minZ : maxZ) - lz;
        const u = px * right.x + py * right.y + pz * right.z;
        const v = px * up.x + py * up.y + pz * up.z;
        const d = -(px * backward.x + py * backward.y + pz * backward.z);
        if (u < left) left = u;
        if (u > rightBound) rightBound = u;
        if (v < bottom) bottom = v;
        if (v > top) top = v;
        if (d < nearDist) nearDist = d;
        if (d > farDist) farDist = d;
      }
    }
  }

  left -= padding;
  rightBound += padding;
  bottom -= padding;
  top += padding;
  nearDist = Math.max(0.1, nearDist - padding);
  farDist = Math.max(nearDist + 1, farDist + padding);

  const mapW = light.shadow.mapSize?.x ?? 0;
  const mapH = light.shadow.mapSize?.y ?? 0;
  if (snapToTexels) {
    // Reserve one texel of span so rounding the center cannot crop fitted bounds.
    if (mapW > 1 && rightBound > left) {
      const texel = (rightBound - left) / (mapW - 1);
      const worldCenter = (left + rightBound) * 0.5 + lx * right.x + ly * right.y + lz * right.z;
      const shift = Math.round(worldCenter / texel) * texel - worldCenter;
      left += shift - texel * 0.5;
      rightBound += shift + texel * 0.5;
    }
    if (mapH > 1 && top > bottom) {
      const texel = (top - bottom) / (mapH - 1);
      const worldCenter = (bottom + top) * 0.5 + lx * up.x + ly * up.y + lz * up.z;
      const shift = Math.round(worldCenter / texel) * texel - worldCenter;
      bottom += shift - texel * 0.5;
      top += shift + texel * 0.5;
    }
  }

  // Move a parented light/target in hierarchy order.
  let parent = light.parent;
  while (parent && parent !== light.target) parent = parent.parent;
  if (parent) writeWorldPosition(light.target, cx, cy, cz, scratch);
  writeWorldPosition(light, lx, ly, lz, scratch);
  if (!parent) writeWorldPosition(light.target, cx, cy, cz, scratch);

  cam.left = left;
  cam.right = rightBound;
  cam.bottom = bottom;
  cam.top = top;
  cam.near = nearDist;
  cam.far = farDist;
  cam.updateProjectionMatrix?.();

  if (bias !== null && bias !== undefined) light.shadow.bias = bias;
  if (normalBias !== null && normalBias !== undefined && 'normalBias' in light.shadow) {
    light.shadow.normalBias = normalBias;
  }
  return { left, right: rightBound, bottom, top, near: nearDist, far: farDist };
}

/**
 * Compute camera-frustum cascade split depths using Practical Split Scheme
 * (blending logarithmic near precision and uniform far coverage).
 *
 * @param {number} near Camera near plane (> 0).
 * @param {number} far Maximum shadow range (> near).
 * @param {number} [cascades=3] Number of cascades (1..4).
 * @param {number} [lambda=0.65] Log/uniform blend factor in [0, 1].
 * @returns {number[]} Array of `cascades + 1` split distances `[near, ..., far]`.
 */
export function computeCascadeSplits(near, far, cascades = 3, lambda = 0.65) {
  const n = Math.max(1, Math.min(4, Math.floor(cascades)));
  const zNear = Math.max(0.05, Number(near) || 0.1);
  const zFar = Math.max(zNear + 1, Number(far) || 100);
  const l = Math.max(0, Math.min(1, Number(lambda) ?? 0.65));
  const splits = new Array(n + 1);
  splits[0] = zNear;
  for (let i = 1; i < n; i++) {
    const p = i / n;
    const logSplit = zNear * Math.pow(zFar / zNear, p);
    const uniformSplit = zNear + (zFar - zNear) * p;
    splits[i] = l * logSplit + (1 - l) * uniformSplit;
  }
  splits[n] = zFar;
  return splits;
}

/**
 * Multi-cascade directional shadow manager (2–4 cascades) with practical frustum splits,
 * bounding-sphere slice fitting, and world-space texel snapping to eliminate shadow shimmer.
 *
 * @param {object} THREE Three.js namespace or compatible mock.
 * @param {object} [options]
 */
export function createCascadedShadowMap3D(THREE, {
  cascades = 3,
  maxFar = 120,
  lambda = 0.65,
  mapSize = 1024,
  lightDirection = [0.46, 0.72, 0.52],
  color = 0xfff5e4,
  intensity = 1.0,
  shadowBias = -0.0004,
  normalBias = 0.02,
  scene = null,
} = {}) {
  if (!THREE?.DirectionalLight || !THREE?.Vector3) {
    throw new TypeError('createCascadedShadowMap3D requires THREE.DirectionalLight and THREE.Vector3');
  }
  const cascadeCount = Math.max(1, Math.min(4, Math.floor(cascades)));
  let dir = normalizeShadowVec3(lightDirection, [0.46, 0.72, 0.52]);
  let currentMaxFar = Math.max(5, Number(maxFar) || 120);
  let currentLambda = Math.max(0, Math.min(1, Number(lambda) ?? 0.65));
  let currentMapSize = Math.max(64, Math.floor(mapSize) || 1024);
  let disposed = false;

  const lights = [];
  for (let i = 0; i < cascadeCount; i++) {
    const light = new THREE.DirectionalLight(color, i === 0 ? intensity : 0);
    light.name = `hgame_csm_cascade_${i}`;
    light.castShadow = true;
    light.position.set?.(dir[0] * 50, dir[1] * 50, dir[2] * 50);
    if (light.shadow?.mapSize?.set) light.shadow.mapSize.set(currentMapSize, currentMapSize);
    if (light.shadow) {
      light.shadow.bias = shadowBias;
      if ('normalBias' in light.shadow) light.shadow.normalBias = normalBias;
    }
    if (scene) {
      scene.add?.(light);
      if (light.target) scene.add?.(light.target);
    }
    lights.push(light);
  }

  let latestSplits = computeCascadeSplits(0.1, currentMaxFar, cascadeCount, currentLambda);
  const scratchForward = new THREE.Vector3();
  const scratchRight = new THREE.Vector3();
  const scratchUp = new THREE.Vector3();
  const scratchCenter = new THREE.Vector3();
  const appliedCsmMaterials = new WeakSet();
  const csmUniforms = {
    uCsmCascadeCount: { value: cascadeCount },
    uCsmSplits: { value: [latestSplits[1] ?? currentMaxFar, latestSplits[2] ?? currentMaxFar, latestSplits[3] ?? currentMaxFar, latestSplits[4] ?? currentMaxFar] },
    uCsmShadowMatrix1: { value: THREE.Matrix4 ? new THREE.Matrix4() : null },
    uCsmShadowMatrix2: { value: THREE.Matrix4 ? new THREE.Matrix4() : null },
    uCsmShadowMatrix3: { value: THREE.Matrix4 ? new THREE.Matrix4() : null },
    tCsmShadowMap1: { value: null },
    tCsmShadowMap2: { value: null },
    tCsmShadowMap3: { value: null },
  };

  function syncCascadeUniforms() {
    csmUniforms.uCsmSplits.value = [
      latestSplits[1] ?? currentMaxFar,
      latestSplits[2] ?? currentMaxFar,
      latestSplits[3] ?? currentMaxFar,
      latestSplits[4] ?? currentMaxFar,
    ];
    for (let i = 1; i < Math.min(4, cascadeCount); i++) {
      const s = lights[i]?.shadow;
      if (s?.matrix && csmUniforms[`uCsmShadowMatrix${i}`]?.value?.copy) {
        csmUniforms[`uCsmShadowMatrix${i}`].value.copy(s.matrix);
      }
      const tex = s?.map?.depthTexture ?? s?.map?.texture ?? null;
      if (csmUniforms[`tCsmShadowMap${i}`]) csmUniforms[`tCsmShadowMap${i}`].value = tex;
    }
  }

  function update(camera) {
    if (disposed || !camera) return { splits: [...latestSplits], frustums: [] };
    const camNear = Math.max(0.05, Number(camera.near) || 0.1);
    const camFar = Math.max(camNear + 1, Math.min(Number(camera.far) || currentMaxFar, currentMaxFar));
    latestSplits = computeCascadeSplits(camNear, camFar, cascadeCount, currentLambda);

    const fovRad = ((camera.fov ?? 60) * Math.PI) / 180;
    const tanHalfFov = Math.tan(fovRad * 0.5);
    const aspect = Math.max(0.1, Number(camera.aspect) || 16 / 9);
    camera.updateMatrixWorld?.();

    const m = camera.matrixWorld?.elements;
    if (m) {
      scratchRight.set(m[0], m[1], m[2]).normalize();
      scratchUp.set(m[4], m[5], m[6]).normalize();
      scratchForward.set(-m[8], -m[9], -m[10]).normalize();
    } else {
      scratchRight.set(1, 0, 0);
      scratchUp.set(0, 1, 0);
      scratchForward.set(0, 0, -1);
    }
    const camPos = camera.position ?? { x: 0, y: 0, z: 0 };
    const frustums = new Array(cascadeCount);

    for (let i = 0; i < cascadeCount; i++) {
      const z0 = latestSplits[i];
      const z1 = latestSplits[i + 1];
      const sliceMid = (z0 + z1) * 0.5;
      const farHalfH = z1 * tanHalfFov;
      const farHalfW = farHalfH * aspect;
      const dx = farHalfW;
      const dy = farHalfH;
      const dz = (z1 - z0) * 0.5;
      const radius = Math.max(1, Math.hypot(dx, dy, dz));
      scratchCenter.set(
        (camPos.x ?? 0) + scratchForward.x * sliceMid,
        (camPos.y ?? 0) + scratchForward.y * sliceMid,
        (camPos.z ?? 0) + scratchForward.z * sliceMid,
      );
      frustums[i] = fitDirectionalShadowFrustum(THREE, lights[i], {
        center: [scratchCenter.x, scratchCenter.y, scratchCenter.z],
        radius,
      }, {
        sunDirection: dir,
        distance: Math.max(radius * 2, 40),
        padding: 1.08, // 8% overlap band across cascade split transitions
        snapToTexels: true,
        bias: shadowBias,
        normalBias,
      });
    }
    syncCascadeUniforms();
    return { splits: [...latestSplits], frustums };
  }

  /**
   * Inject multi-cascade shadow sampling onto a PBR material so far cascades (`1..N-1`)
   * darken `lights[0]`'s single illumination cleanly without duplicating diffuse/specular lights.
   */
  function applyToMaterial(material) {
    if (!material || typeof material !== 'object' || appliedCsmMaterials.has(material)) return material;
    appliedCsmMaterials.add(material);
    syncCascadeUniforms();
    const prevCompile = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey;
    material.customProgramCacheKey = () => {
      const base = typeof prevKey === 'function' ? prevKey.call(material) : '';
      return `${base}:hgame-csm-${cascadeCount}`;
    };
    material.onBeforeCompile = (shader, renderer) => {
      if (typeof prevCompile === 'function') prevCompile.call(material, shader, renderer);
      Object.assign(shader.uniforms, csmUniforms);
      if (shader.vertexShader.includes('#include <project_vertex>')) {
        shader.vertexShader = 'varying vec3 vCsmWorldPos;\nvarying float vCsmViewZ;\n' +
          shader.vertexShader.replace(
            '#include <project_vertex>',
            '#include <project_vertex>\n{\n  vec4 _csmWp = vec4(transformed, 1.0);\n  #ifdef USE_INSTANCING\n    _csmWp = instanceMatrix * _csmWp;\n  #endif\n  vCsmWorldPos = (modelMatrix * _csmWp).xyz;\n  vCsmViewZ = -mvPosition.z;\n}',
          );
      }
      if (shader.fragmentShader.includes('#include <lights_fragment_end>')) {
        const decls = [
          'varying vec3 vCsmWorldPos;',
          'varying float vCsmViewZ;',
          'uniform int uCsmCascadeCount;',
          'uniform float uCsmSplits[4];',
          'uniform mat4 uCsmShadowMatrix1;',
          'uniform mat4 uCsmShadowMatrix2;',
          'uniform mat4 uCsmShadowMatrix3;',
          'uniform sampler2D tCsmShadowMap1;',
          'uniform sampler2D tCsmShadowMap2;',
          'uniform sampler2D tCsmShadowMap3;',
          'float hgameSampleCascadeShadow(sampler2D smap, mat4 mat, vec3 wp) {',
          '  vec4 sc = mat * vec4(wp, 1.0);',
          '  vec3 p = sc.xyz / max(sc.w, 0.0001);',
          '  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z <= 0.0 || p.z >= 1.0) return 1.0;',
          '  float d = texture2D(smap, p.xy).r;',
          '  return (p.z - 0.0025) > d ? 0.25 : 1.0;',
          '}',
        ].join('\n');
        const body = [
          '#include <lights_fragment_end>',
          'if (uCsmCascadeCount > 1 && vCsmViewZ > uCsmSplits[0] * 0.92) {',
          '  float _csmFactor = 1.0;',
          '  if (vCsmViewZ <= uCsmSplits[1]) {',
          '    _csmFactor = hgameSampleCascadeShadow(tCsmShadowMap1, uCsmShadowMatrix1, vCsmWorldPos);',
          '  } else if (uCsmCascadeCount > 2 && vCsmViewZ <= uCsmSplits[2]) {',
          '    _csmFactor = hgameSampleCascadeShadow(tCsmShadowMap2, uCsmShadowMatrix2, vCsmWorldPos);',
          '  } else if (uCsmCascadeCount > 3 && vCsmViewZ <= uCsmSplits[3]) {',
          '    _csmFactor = hgameSampleCascadeShadow(tCsmShadowMap3, uCsmShadowMatrix3, vCsmWorldPos);',
          '  }',
          '  reflectedLight.directDiffuse *= _csmFactor;',
          '  reflectedLight.directSpecular *= _csmFactor;',
          '}',
        ].join('\n');
        shader.fragmentShader = decls + '\n' +
          shader.fragmentShader.replace('#include <lights_fragment_end>', body);
      }
    };
    material.needsUpdate = true;
    return material;
  }

  function setDirection(nextDir) {
    dir = normalizeShadowVec3(nextDir, dir);
    for (const light of lights) {
      light.position.set?.(dir[0] * 50, dir[1] * 50, dir[2] * 50);
    }
  }

  function setMapSize(nextSize) {
    const s = Math.max(64, Math.floor(nextSize) || currentMapSize);
    if (s === currentMapSize) return;
    currentMapSize = s;
    for (const light of lights) {
      light.shadow?.mapSize?.set?.(s, s);
      if (light.shadow?.map) {
        light.shadow.map.dispose?.();
        light.shadow.map = null;
      }
    }
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    for (const light of lights) {
      light.removeFromParent?.();
      light.target?.removeFromParent?.();
      light.shadow?.map?.dispose?.();
      light.dispose?.();
    }
    lights.length = 0;
    return true;
  }

  return {
    get cascades() { return cascadeCount; },
    get lights() { return lights.slice(); },
    get splits() { return [...latestSplits]; },
    get direction() { return [...dir]; },
    update,
    applyToMaterial,
    setDirection,
    setMapSize,
    dispose,
  };
}
