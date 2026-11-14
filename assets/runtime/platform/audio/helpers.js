/**
 * @typedef {object} AudioListenerState Listener pose in world units.
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} forwardX Unit forward vector (default 0, 0, -1).
 * @property {number} forwardY
 * @property {number} forwardZ
 * @property {number} upX Unit up vector (default 0, 1, 0).
 * @property {number} upY
 * @property {number} upZ
 */

/** @typedef {{ x: number, y: number, z?: number } | readonly number[]} AudioPosition3D World-space point as `{x,y,z}` or `[x,y,z]`. */
/** @typedef {{ x: number, y: number } | readonly number[]} AudioPosition2D 2D point as `{x,y}` or `[x,y]` (pixels / world units). */
/** @typedef {[number, number, number]} Vec3Tuple */

/** Default bus gains (0..1.5). @type {Readonly<Record<string, number>>} */
export const DEFAULT_BUS_VOLUMES = Object.freeze({
  sfx: 1,
  spatial: 1,
  music: 0.75,
  ambience: 0.7,
});

/** @param {number} value @param {number} min @param {number} max @returns {number} */
export function clamp(value, min, max) {
  return value < min ? min : (value > max ? max : value);
}

/** @param {readonly number[]} values @returns {number} Median (0 for empty). */
export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) * 0.5;
}

/**
 * Normalize a vector, or return the fallback when its length is ~0.
 * @param {number} x @param {number} y @param {number} z
 * @param {number} fx Fallback x. @param {number} fy Fallback y. @param {number} fz Fallback z.
 * @returns {Vec3Tuple}
 */
export function normalizeVec3(x, y, z, fx, fy, fz) {
  const len = Math.hypot(x, y, z);
  if (!(len > 1e-8)) return [fx, fy, fz];
  return [x / len, y / len, z / len];
}

/** @param {AudioPosition3D | null | undefined} pos @returns {{ x: number, y: number, z: number } | null} */
export function parsePosition3D(pos) {
  if (!pos) return null;
  if (Array.isArray(pos)) {
    return {
      x: Number(pos[0]) || 0,
      y: Number(pos[1]) || 0,
      z: Number(pos[2]) || 0,
    };
  }
  return {
    x: Number(pos.x) || 0,
    y: Number(pos.y) || 0,
    z: Number(pos.z) || 0,
  };
}

/** @param {AudioPosition2D | null | undefined} pos @returns {{ x: number, y: number } | null} */
export function parsePosition2D(pos) {
  if (!pos) return null;
  if (Array.isArray(pos)) {
    return {
      x: Number(pos[0]) || 0,
      y: Number(pos[1]) || 0,
    };
  }
  return {
    x: Number(pos.x) || 0,
    y: Number(pos.y) || 0,
  };
}

/** @param {PannerNode | AudioListener | null | undefined} node @param {number} x @param {number} y @param {number} z @returns {void} */
export function applyAudioParamOrMethod(node, x, y, z) {
  if (!node) return;
  if (node.positionX && typeof node.positionX === 'object' && 'value' in node.positionX) {
    node.positionX.value = x;
    node.positionY.value = y;
    node.positionZ.value = z;
  } else if (typeof node.setPosition === 'function') {
    node.setPosition(x, y, z);
  }
}

/** @param {AudioListener | null | undefined} listener @param {AudioListenerState} state @returns {void} */
export function applyListenerOrientation(listener, state) {
  if (!listener) return;
  applyAudioParamOrMethod(listener, state.x, state.y, state.z);
  if (listener.forwardX && typeof listener.forwardX === 'object' && 'value' in listener.forwardX) {
    listener.forwardX.value = state.forwardX;
    listener.forwardY.value = state.forwardY;
    listener.forwardZ.value = state.forwardZ;
    listener.upX.value = state.upX;
    listener.upY.value = state.upY;
    listener.upZ.value = state.upZ;
  } else if (typeof listener.setOrientation === 'function') {
    listener.setOrientation(
      state.forwardX, state.forwardY, state.forwardZ,
      state.upX, state.upY, state.upZ,
    );
  }
}

/**
 * Smoothly move an AudioParam (or plain `{ value }`) toward a target.
 * @param {AudioParam | { value: number } | null | undefined} gainParam
 * @param {number} value Target value.
 * @param {number} currentTime AudioContext time, seconds.
 * @param {number} [timeConstant=0.01] Seconds.
 * @returns {void}
 */
export function setGainTarget(gainParam, value, currentTime, timeConstant = 0.01) {
  if (!gainParam) return;
  if (typeof gainParam.setTargetAtTime === 'function') {
    gainParam.setTargetAtTime(value, currentTime, timeConstant);
  } else {
    gainParam.value = value;
  }
}
