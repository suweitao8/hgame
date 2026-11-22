/**
 * Pure quaternion, vector, resampling, SLERP decimation, and glTF Int16 rotation quantization helpers.
 */

export const IDENTITY_QUAT = [0, 0, 0, 1];
export const ZERO_VEC3 = [0, 0, 0];

/** Normalize a quaternion [x, y, z, w]. */
export function quatNormalize(q) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (len < 1e-12) return [0, 0, 0, 1];
  const inv = 1 / len;
  return [q[0] * inv, q[1] * inv, q[2] * inv, q[3] * inv];
}

/** Multiply two quaternions a * b. */
export function quatMul(a, b) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Inverse of a unit quaternion. */
export function quatInv(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Dot product of two quaternions. */
export function quatDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

/** Shortest-path spherical linear interpolation between unit quaternions a and b. */
export function quatSlerp(a, b, t) {
  if (t <= 0) return quatNormalize(a);
  if (t >= 1) return quatNormalize(b);
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let cosHalf = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cosHalf < 0) {
    bx = -bx; by = -by; bz = -bz; bw = -bw;
    cosHalf = -cosHalf;
  }
  if (cosHalf >= 0.9995) {
    return quatNormalize([
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ]);
  }
  const halfAngle = Math.acos(Math.min(1, Math.max(-1, cosHalf)));
  const sinHalf = Math.sqrt(Math.max(1e-12, 1 - cosHalf * cosHalf));
  const ratioA = Math.sin((1 - t) * halfAngle) / sinHalf;
  const ratioB = Math.sin(t * halfAngle) / sinHalf;
  return quatNormalize([
    a[0] * ratioA + bx * ratioB,
    a[1] * ratioA + by * ratioB,
    a[2] * ratioA + bz * ratioB,
    a[3] * ratioA + bw * ratioB,
  ]);
}

/** Rotate a 3D vector v by unit quaternion q. */
export function vec3TransformQuat(v, q) {
  const x = v[0], y = v[1], z = v[2];
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

/** Add two 3D vectors. */
export function vec3Add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Linear interpolation of 3D vectors. */
export function vec3Lerp(a, b, t) {
  if (t <= 0) return [a[0], a[1], a[2]];
  if (t >= 1) return [b[0], b[1], b[2]];
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/**
 * Sample a glTF sampler's input/output typed arrays at time t.
 * Handles LINEAR, STEP, and CUBICSPLINE (taking the value component).
 */
export function sampleTrackAtTime(times, values, stride, t, { isQuat = false, interpolation = 'LINEAR', fallback = null } = {}) {
  const count = times?.length || 0;
  if (count === 0 || !values || values.length === 0) {
    return fallback ? [...fallback] : (isQuat ? [0, 0, 0, 1] : [0, 0, 0]);
  }
  const isCubic = interpolation === 'CUBICSPLINE';
  const blockStride = isCubic ? stride * 3 : stride;
  const valOffset = isCubic ? stride : 0;

  const readAt = (idx) => {
    const base = idx * blockStride + valOffset;
    const out = new Array(stride);
    for (let k = 0; k < stride; k++) out[k] = values[base + k];
    return isQuat ? quatNormalize(out) : out;
  };

  if (count === 1 || t <= times[0]) return readAt(0);
  if (t >= times[count - 1]) return readAt(count - 1);

  // Binary search for bracketing interval [lo, lo+1]
  let lo = 0;
  let hi = count - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }

  if (interpolation === 'STEP') return readAt(lo);

  const t0 = times[lo];
  const t1 = times[hi];
  const span = t1 - t0;
  const alpha = span > 1e-8 ? (t - t0) / span : 0;
  const v0 = readAt(lo);
  const v1 = readAt(hi);
  if (isQuat) return quatSlerp(v0, v1, alpha);
  return vec3Lerp(v0, v1, alpha);
}

/**
 * Decimate redundant frames along a uniformly or arbitrarily sampled track.
 * Preserves first and last keyframes; drops intermediate frames whose interpolated error <= tolerance.
 */
export function decimateKeyframes(times, flatValues, stride, { isQuat = false, tolerance = 0.001 } = {}) {
  const count = times.length;
  if (count <= 2) {
    return { times: Float32Array.from(times), values: Float32Array.from(flatValues) };
  }

  const getVal = (i) => {
    const base = i * stride;
    const arr = new Array(stride);
    for (let k = 0; k < stride; k++) arr[k] = flatValues[base + k];
    return arr;
  };

  // Iterative Douglas-Peucker style simplification for exact error bounding
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;

  const stack = [[0, count - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop();
    if (end - start <= 1) continue;
    const t0 = times[start];
    const t1 = times[end];
    const span = Math.max(1e-8, t1 - t0);
    const v0 = getVal(start);
    const v1 = getVal(end);

    let maxErr = 0;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const alpha = (times[i] - t0) / span;
      const actual = getVal(i);
      let err = 0;
      if (isQuat) {
        const interp = quatSlerp(v0, v1, alpha);
        const dot = Math.min(1, Math.abs(quatDot(actual, interp)));
        // Chord / angular error: 2 * acos(dot) ~ 2 * sqrt(2*(1-dot))
        err = Math.acos(dot) * 2;
      } else {
        const interp = vec3Lerp(v0, v1, alpha);
        err = Math.hypot(actual[0] - interp[0], actual[1] - interp[1], actual[2] - interp[2]);
      }
      if (err > maxErr) {
        maxErr = err;
        maxIdx = i;
      }
    }

    if (maxErr > tolerance && maxIdx !== -1) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  const outTimes = [];
  const outVals = [];
  for (let i = 0; i < count; i++) {
    if (!keep[i]) continue;
    outTimes.push(times[i]);
    const base = i * stride;
    for (let k = 0; k < stride; k++) outVals.push(flatValues[base + k]);
  }
  return {
    times: Float32Array.from(outTimes),
    values: Float32Array.from(outVals),
  };
}

/**
 * Quantize unit quaternion Float32Array into glTF 2.0 standard normalized Int16Array.
 * Each component [-1, 1] maps to [-32767, 32767] per glTF spec Section 3.11.
 */
export function quantizeQuatToInt16(floatArr) {
  const out = new Int16Array(floatArr.length);
  for (let i = 0; i < floatArr.length; i++) {
    const v = Math.max(-1, Math.min(1, floatArr[i]));
    out[i] = Math.round(v * 32767);
  }
  return out;
}
