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
