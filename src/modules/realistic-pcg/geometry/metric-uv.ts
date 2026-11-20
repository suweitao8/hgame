import * as THREE from 'three';

export interface RawMeshData {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[]; // R=AO, G=EdgeWear, B=LocalWetness
  materialIds: number[];
  indices: number[];
}

export function createRawMeshData(): RawMeshData {
  return {
    positions: [],
    normals: [],
    uvs: [],
    colors: [],
    materialIds: [],
    indices: [],
  };
}

export function appendRawMesh(dst: RawMeshData, src: RawMeshData): void {
  const baseVertex = dst.positions.length / 3;
  for (let i = 0; i < src.positions.length; i++) dst.positions.push(src.positions[i]!);
  for (let i = 0; i < src.normals.length; i++) dst.normals.push(src.normals[i]!);
  for (let i = 0; i < src.uvs.length; i++) dst.uvs.push(src.uvs[i]!);
  for (let i = 0; i < src.colors.length; i++) dst.colors.push(src.colors[i]!);
  for (let i = 0; i < src.materialIds.length; i++) dst.materialIds.push(src.materialIds[i]!);
  for (let i = 0; i < src.indices.length; i++) dst.indices.push(src.indices[i]! + baseVertex);
}

export function computeMetricBoxUV(
  px: number,
  py: number,
  pz: number,
  nx: number,
  ny: number,
  nz: number
): [number, number] {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ax >= ay && ax >= az) {
    return [pz, py];
  }
  if (ay >= ax && ay >= az) {
    return [px, pz];
  }
  return [px, py];
}

export function recomputeMetricUVs(raw: RawMeshData): void {
  const count = raw.positions.length / 3;
  for (let i = 0; i < count; i++) {
    const o3 = i * 3;
    const o2 = i * 2;
    const [u, v] = computeMetricBoxUV(
      raw.positions[o3]!,
      raw.positions[o3 + 1]!,
      raw.positions[o3 + 2]!,
      raw.normals[o3]!,
      raw.normals[o3 + 1]!,
      raw.normals[o3 + 2]!
    );
    raw.uvs[o2] = u;
    raw.uvs[o2 + 1] = v;
  }
}

export function pushVertex(
  mesh: RawMeshData,
  px: number,
  py: number,
  pz: number,
  nx: number,
  ny: number,
  nz: number,
  u: number,
  v: number,
  ao: number,
  edgeWear: number,
  wetness: number,
  materialId: number
): number {
  const idx = mesh.positions.length / 3;
  mesh.positions.push(px, py, pz);
  mesh.normals.push(nx, ny, nz);
  mesh.uvs.push(u, v);
  mesh.colors.push(ao, edgeWear, wetness);
  mesh.materialIds.push(materialId);
  return idx;
}

export function pushOrientedQuad(
  mesh: RawMeshData,
  p0: readonly [number, number, number],
  p1: readonly [number, number, number],
  p2: readonly [number, number, number],
  p3: readonly [number, number, number],
  outwardHint: readonly [number, number, number],
  ao: number,
  edgeWear: number,
  wetness: number,
  materialId: number,
  smoothNormal?: readonly [number, number, number]
): void {
  const ax = p1[0] - p0[0];
  const ay = p1[1] - p0[1];
  const az = p1[2] - p0[2];
  const bx = p2[0] - p0[0];
  const by = p2[1] - p0[1];
  const bz = p2[2] - p0[2];
  let cx = ay * bz - az * by;
  let cy = az * bx - ax * bz;
  let cz = ax * by - ay * bx;
  const dot = cx * outwardHint[0] + cy * outwardHint[1] + cz * outwardHint[2];
  const flip = dot < 0;
  if (flip) {
    cx = -cx;
    cy = -cy;
    cz = -cz;
  }
  const len = Math.hypot(cx, cy, cz) || 1;
  const nx = smoothNormal ? smoothNormal[0] : cx / len;
  const ny = smoothNormal ? smoothNormal[1] : cy / len;
  const nz = smoothNormal ? smoothNormal[2] : cz / len;

  const [u0, v0] = computeMetricBoxUV(p0[0], p0[1], p0[2], nx, ny, nz);
  const [u1, v1] = computeMetricBoxUV(p1[0], p1[1], p1[2], nx, ny, nz);
  const [u2, v2] = computeMetricBoxUV(p2[0], p2[1], p2[2], nx, ny, nz);
  const [u3, v3] = computeMetricBoxUV(p3[0], p3[1], p3[2], nx, ny, nz);

  const i0 = pushVertex(mesh, p0[0], p0[1], p0[2], nx, ny, nz, u0, v0, ao, edgeWear, wetness, materialId);
  const i1 = pushVertex(mesh, p1[0], p1[1], p1[2], nx, ny, nz, u1, v1, ao, edgeWear, wetness, materialId);
  const i2 = pushVertex(mesh, p2[0], p2[1], p2[2], nx, ny, nz, u2, v2, ao, edgeWear, wetness, materialId);
  const i3 = pushVertex(mesh, p3[0], p3[1], p3[2], nx, ny, nz, u3, v3, ao, edgeWear, wetness, materialId);

  if (flip) {
    mesh.indices.push(i0, i2, i1, i0, i3, i2);
  } else {
    mesh.indices.push(i0, i1, i2, i0, i2, i3);
  }
}

export function pushOrientedTri(
  mesh: RawMeshData,
  p0: readonly [number, number, number],
  p1: readonly [number, number, number],
  p2: readonly [number, number, number],
  outwardHint: readonly [number, number, number],
  ao: number,
  edgeWear: number,
  wetness: number,
  materialId: number
): void {
  const ax = p1[0] - p0[0];
  const ay = p1[1] - p0[1];
  const az = p1[2] - p0[2];
  const bx = p2[0] - p0[0];
  const by = p2[1] - p0[1];
  const bz = p2[2] - p0[2];
  let cx = ay * bz - az * by;
  let cy = az * bx - ax * bz;
  let cz = ax * by - ay * bx;
  const dot = cx * outwardHint[0] + cy * outwardHint[1] + cz * outwardHint[2];
  const flip = dot < 0;
  if (flip) {
    cx = -cx;
    cy = -cy;
    cz = -cz;
  }
  const len = Math.hypot(cx, cy, cz) || 1;
  const nx = cx / len;
  const ny = cy / len;
  const nz = cz / len;

  const [u0, v0] = computeMetricBoxUV(p0[0], p0[1], p0[2], nx, ny, nz);
  const [u1, v1] = computeMetricBoxUV(p1[0], p1[1], p1[2], nx, ny, nz);
  const [u2, v2] = computeMetricBoxUV(p2[0], p2[1], p2[2], nx, ny, nz);

  const i0 = pushVertex(mesh, p0[0], p0[1], p0[2], nx, ny, nz, u0, v0, ao, edgeWear, wetness, materialId);
  const i1 = pushVertex(mesh, p1[0], p1[1], p1[2], nx, ny, nz, u1, v1, ao, edgeWear, wetness, materialId);
  const i2 = pushVertex(mesh, p2[0], p2[1], p2[2], nx, ny, nz, u2, v2, ao, edgeWear, wetness, materialId);

  if (flip) {
    mesh.indices.push(i0, i2, i1);
  } else {
    mesh.indices.push(i0, i1, i2);
  }
}

/**
 * Generates a watertight chamfered/beveled box centered at (0, 0, 0).
 * 6 flat faces + 12 beveled edge strips + 8 corner bevel triangles (44 tris total).
 */
export function buildBeveledBoxRaw(
  width: number,
  height: number,
  depth: number,
  bevel: number,
  materialId: number,
  edgeWear = 0.65,
  ao = 1.0,
  wetness = 0.0
): RawMeshData {
  const mesh = createRawMeshData();
  const hx = Math.max(0.005, width * 0.5);
  const hy = Math.max(0.005, height * 0.5);
  const hz = Math.max(0.005, depth * 0.5);
  const b = Math.max(0, Math.min(bevel, hx * 0.45, hy * 0.45, hz * 0.45));

  if (b < 0.001) {
    // Plain box fallback if bevel is essentially 0
    const p = (sx: number, sy: number, sz: number): [number, number, number] => [sx * hx, sy * hy, sz * hz];
    pushOrientedQuad(mesh, p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), [1, 0, 0], ao, edgeWear * 0.25, wetness, materialId);
    pushOrientedQuad(mesh, p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), [-1, 0, 0], ao, edgeWear * 0.25, wetness, materialId);
    pushOrientedQuad(mesh, p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1), [0, 1, 0], ao, edgeWear * 0.25, wetness, materialId);
    pushOrientedQuad(mesh, p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1), [0, -1, 0], ao, edgeWear * 0.25, wetness, materialId);
    pushOrientedQuad(mesh, p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), [0, 0, 1], ao, edgeWear * 0.25, wetness, materialId);
    pushOrientedQuad(mesh, p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), [0, 0, -1], ao, edgeWear * 0.25, wetness, materialId);
    return mesh;
  }

  const ix = hx - b;
  const iy = hy - b;
  const iz = hz - b;

  // 3 inset vertices per octant (sx, sy, sz) in {-1, +1}
  const vx = (sx: number, sy: number, sz: number): [number, number, number] => [sx * hx, sy * iy, sz * iz];
  const vy = (sx: number, sy: number, sz: number): [number, number, number] => [sx * ix, sy * hy, sz * iz];
  const vz = (sx: number, sy: number, sz: number): [number, number, number] => [sx * ix, sy * iy, sz * hz];

  const faceWear = edgeWear * 0.1;

  // 6 flat faces
  for (const s of [-1, 1] as const) {
    pushOrientedQuad(mesh, vx(s, -1, 1), vx(s, -1, -1), vx(s, 1, -1), vx(s, 1, 1), [s, 0, 0], ao, faceWear, wetness, materialId);
    pushOrientedQuad(mesh, vy(-1, s, 1), vy(1, s, 1), vy(1, s, -1), vy(-1, s, -1), [0, s, 0], ao, faceWear, wetness, materialId);
    pushOrientedQuad(mesh, vz(-1, -1, s), vz(1, -1, s), vz(1, 1, s), vz(-1, 1, s), [0, 0, s], ao, faceWear, wetness, materialId);
  }

  // 12 edge chamfers (high edgeWear for crisp specular rim highlights)
  for (const sy of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      // Edges parallel to X
      pushOrientedQuad(mesh, vy(-1, sy, sz), vy(1, sy, sz), vz(1, sy, sz), vz(-1, sy, sz), [0, sy, sz], ao, edgeWear, wetness, materialId);
    }
  }
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      // Edges parallel to Y
      pushOrientedQuad(mesh, vx(sx, -1, sz), vx(sx, 1, sz), vz(sx, 1, sz), vz(sx, -1, sz), [sx, 0, sz], ao, edgeWear, wetness, materialId);
    }
  }
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      // Edges parallel to Z
      pushOrientedQuad(mesh, vx(sx, sy, -1), vx(sx, sy, 1), vy(sx, sy, 1), vy(sx, sy, -1), [sx, sy, 0], ao, edgeWear, wetness, materialId);
    }
  }

  // 8 corner bevel triangles
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        pushOrientedTri(mesh, vx(sx, sy, sz), vy(sx, sy, sz), vz(sx, sy, sz), [sx, sy, sz], ao, edgeWear, wetness, materialId);
      }
    }
  }

  return mesh;
}

export function buildBufferGeometryFromRaw(raw: RawMeshData): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(raw.positions), 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(raw.normals), 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(raw.uvs), 2));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(raw.colors), 3));
  geom.setAttribute('aMaterialId', new THREE.Float32BufferAttribute(new Float32Array(raw.materialIds), 1));
  geom.setIndex(new THREE.Uint32BufferAttribute(new Uint32Array(raw.indices), 1));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}
