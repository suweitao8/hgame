const TAU = Math.PI * 2;

/** @param {number} a Radians. @param {number} b Radians. @param {number} t 0..1. @returns {number} */
function lerpAngle(a, b, t) {
  if (a === b) return b;
  let delta = (b - a) % TAU;
  if (delta > Math.PI) delta -= TAU;
  else if (delta < -Math.PI) delta += TAU;
  return a + delta * t;
}

// View-layer TRS using Three.js-compatible XYZ Euler order, column-major 4x4.
// This uses floating point: NEVER feed it back into a deterministic sim.
/** @param {Float64Array} out @param {number} x @param {number} y @param {number} z @param {number} rx @param {number} ry @param {number} rz @param {number} sx @param {number} sy @param {number} sz @returns {Float64Array} */
function writeLocalMatrix(out, x, y, z, rx, ry, rz, sx, sy, sz) {
  if (rx === 0 && ry === 0) {
    if (rz === 0) {
      out[0] = sx; out[1] = 0;  out[2] = 0;  out[3] = 0;
      out[4] = 0;  out[5] = sy; out[6] = 0;  out[7] = 0;
      out[8] = 0;  out[9] = 0;  out[10] = sz; out[11] = 0;
      out[12] = x; out[13] = y; out[14] = z;  out[15] = 1;
      return out;
    }
    const e = Math.cos(rz), f = Math.sin(rz);
    out[0] = e * sx;  out[1] = f * sx; out[2] = 0;  out[3] = 0;
    out[4] = -f * sy; out[5] = e * sy; out[6] = 0;  out[7] = 0;
    out[8] = 0;       out[9] = 0;      out[10] = sz; out[11] = 0;
    out[12] = x;      out[13] = y;     out[14] = z;  out[15] = 1;
    return out;
  }
  const a = Math.cos(rx), b = Math.sin(rx);
  const c = Math.cos(ry), d = Math.sin(ry);
  const e = Math.cos(rz), f = Math.sin(rz);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  out[0] = c * e * sx;
  out[1] = (af + be * d) * sx;
  out[2] = (bf - ae * d) * sx;
  out[3] = 0;
  out[4] = -c * f * sy;
  out[5] = (ae - bf * d) * sy;
  out[6] = (be + af * d) * sy;
  out[7] = 0;
  out[8] = d * sz;
  out[9] = -b * c * sz;
  out[10] = a * c * sz;
  out[11] = 0;
  out[12] = x;
  out[13] = y;
  out[14] = z;
  out[15] = 1;
  return out;
}

/** @param {Float64Array} out @param {Float64Array} a @param {Float64Array} b @returns {Float64Array} */
export function multiplyMatrixInto(out, a, b) {
  for (let col = 0; col < 4; col++) {
    const colOffset = col * 4;
    const b0 = b[colOffset], b1 = b[colOffset + 1], b2 = b[colOffset + 2], b3 = b[colOffset + 3];
    out[colOffset]     = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[colOffset + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[colOffset + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[colOffset + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

/** @param {import('../core/entity.js').Entity} node @param {Float64Array} out @param {number} alpha @returns {Float64Array} */
export function writeEntityLocalMatrix(node, out, alpha) {
  if (alpha < 1) {
    const t = alpha <= 0 ? 0 : alpha;
    return writeLocalMatrix(
      out,
      node._prevX + (node.x - node._prevX) * t,
      node._prevY + (node.y - node._prevY) * t,
      node._prevZ + (node.z - node._prevZ) * t,
      lerpAngle(node._prevRotationX, node.rotationX, t),
      lerpAngle(node._prevRotationY, node.rotationY, t),
      lerpAngle(node._prevRotationZ, node.rotationZ, t),
      node.scaleX, node.scaleY, node.scaleZ,
    );
  }
  return writeLocalMatrix(
    out,
    node.x, node.y, node.z,
    node.rotationX, node.rotationY, node.rotationZ,
    node.scaleX, node.scaleY, node.scaleZ,
  );
}
