/**
 * Directional shadow frustum fitter shared between the Three.js adapter
 * and procedural sky helpers without pulling sky shaders into minimal 3D builds.
 */

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
 * @property {ShadowVec3Input|null} [sunDirection=null] Defaults to light.position - light.target.position.
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
  const dirArr = normalizeShadowVec3(
    sunDirection ?? (light.position && light.target
      ? [light.position.x - light.target.position.x, light.position.y - light.target.position.y, light.position.z - light.target.position.z]
      : [0.46, 0.72, 0.52]),
    [0.46, 0.72, 0.52],
  );

  // Light looks from target + dirArr * distance toward target (cx, cy, cz).
  const dir = new THREE.Vector3(dirArr[0], dirArr[1], dirArr[2]);
  const forward = dir.clone().negate().normalize(); // view look direction (-Z of light camera)
  const worldUp = Math.abs(forward.y) > 0.99
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  const lx = cx + dir.x * distance;
  const ly = cy + dir.y * distance;
  const lz = cz + dir.z * distance;
  light.position?.set?.(lx, ly, lz);
  light.target?.position?.set?.(cx, cy, cz);
  light.target?.updateMatrixWorld?.(true);

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
        const d = px * forward.x + py * forward.y + pz * forward.z;
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
  if (snapToTexels && mapW > 0 && mapH > 0) {
    const texelX = (rightBound - left) / mapW;
    const texelY = (top - bottom) / mapH;
    if (texelX > 0) {
      left = Math.floor(left / texelX) * texelX;
      rightBound = Math.ceil(rightBound / texelX) * texelX;
    }
    if (texelY > 0) {
      bottom = Math.floor(bottom / texelY) * texelY;
      top = Math.ceil(top / texelY) * texelY;
    }
  }

  const cam = light.shadow.camera;
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
