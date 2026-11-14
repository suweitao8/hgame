// Tiny collision helpers shared by the sim and the spring-arm camera probe. Pure functions, no allocations
// on the hot path except where noted.

/** Push a circle (cx,cz,r) out of an axis-aligned box. Writes the corrected position to `out`; returns true if it moved. */
export function pushCircleOutOfBox(cx, cz, r, b, out) {
  const dx = cx - b.x, dz = cz - b.z;
  const px = Math.max(-b.hx, Math.min(b.hx, dx));
  const pz = Math.max(-b.hz, Math.min(b.hz, dz));
  const ox = dx - px, oz = dz - pz;
  const d2 = ox * ox + oz * oz;
  if (d2 >= r * r) { out.x = cx; out.z = cz; return false; }
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2), k = (r - d) / d;
    out.x = cx + ox * k; out.z = cz + oz * k;
  } else {
    // Centre inside the box: exit through the nearest face.
    const ex = b.hx - Math.abs(dx), ez = b.hz - Math.abs(dz);
    if (ex < ez) { out.x = b.x + Math.sign(dx || 1) * (b.hx + r); out.z = cz; }
    else { out.x = cx; out.z = b.z + Math.sign(dz || 1) * (b.hz + r); }
  }
  return true;
}

/** True when the circle overlaps the box footprint. */
export function circleOverlapsBox(cx, cz, r, b) {
  const px = Math.max(b.x - b.hx, Math.min(b.x + b.hx, cx));
  const pz = Math.max(b.z - b.hz, Math.min(b.z + b.hz, cz));
  const dx = cx - px, dz = cz - pz;
  return dx * dx + dz * dz < r * r;
}

/**
 * Ray vs. boxes (slab test; boxes span y in [0, h]). Returns the nearest hit distance along the unit direction,
 * or null. Used as the createSpringArm3D `collisionTest` so the camera never sits inside geometry.
 */
export function rayBoxes(boxes, ox, oy, oz, dx, dy, dz, maxLen) {
  let best = null;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    let t0 = 0, t1 = maxLen;
    const slab = (o, d, lo, hi) => {
      if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
      let a = (lo - o) / d, c = (hi - o) / d;
      if (a > c) { const s = a; a = c; c = s; }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      return t0 <= t1;
    };
    if (slab(ox, dx, b.x - b.hx, b.x + b.hx) && slab(oy, dy, 0, b.h) && slab(oz, dz, b.z - b.hz, b.z + b.hz)) {
      if (best === null || t0 < best) best = t0;
    }
  }
  return best;
}
