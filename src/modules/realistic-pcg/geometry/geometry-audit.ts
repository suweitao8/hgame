import * as THREE from 'three';

export interface GeometryAuditReport {
  valid: boolean;
  vertexCount: number;
  triangleCount: number;
  degenerateTriangles: number;
  invalidNormals: number;
  invertedWindingTriangles: number;
  invalidUVs: number;
  invertedWindingRatio: number;
  issues: string[];
}

export function auditGeometry(
  geometry: THREE.BufferGeometry,
  options: { minArea?: number; normalTolerance?: number } = {}
): GeometryAuditReport {
  const minArea = options.minArea ?? 1e-7;
  const normalTolerance = options.normalTolerance ?? 0.02;

  const pos = geometry.getAttribute('position');
  const nrm = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const idx = geometry.getIndex();

  const issues: string[] = [];
  if (!pos || !nrm) {
    return {
      valid: false,
      vertexCount: pos?.count ?? 0,
      triangleCount: 0,
      degenerateTriangles: 0,
      invalidNormals: 1,
      invertedWindingTriangles: 0,
      invalidUVs: 0,
      invertedWindingRatio: 0,
      issues: ['Geometry missing required position or normal attribute'],
    };
  }

  const vCount = pos.count;
  let invalidNormals = 0;
  let invalidUVs = 0;

  for (let i = 0; i < vCount; i++) {
    const nx = nrm.getX(i);
    const ny = nrm.getY(i);
    const nz = nrm.getZ(i);
    const len = Math.hypot(nx, ny, nz);
    if (!Number.isFinite(len) || Math.abs(len - 1.0) > normalTolerance) {
      invalidNormals++;
    }
    if (uv) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      if (!Number.isFinite(u) || !Number.isFinite(v)) {
        invalidUVs++;
      }
    }
  }

  const idxCount = idx ? idx.count : vCount;
  const triangleCount = Math.floor(idxCount / 3);
  let degenerateTriangles = 0;
  let invertedWindingTriangles = 0;

  for (let t = 0; t < triangleCount; t++) {
    const b = t * 3;
    const i0 = idx ? idx.getX(b) : b;
    const i1 = idx ? idx.getX(b + 1) : b + 1;
    const i2 = idx ? idx.getX(b + 2) : b + 2;

    const x0 = pos.getX(i0);
    const y0 = pos.getY(i0);
    const z0 = pos.getZ(i0);
    const x1 = pos.getX(i1);
    const y1 = pos.getY(i1);
    const z1 = pos.getZ(i1);
    const x2 = pos.getX(i2);
    const y2 = pos.getY(i2);
    const z2 = pos.getZ(i2);

    const ax = x1 - x0;
    const ay = y1 - y0;
    const az = z1 - z0;
    const bx = x2 - x0;
    const by = y2 - y0;
    const bz = z2 - z0;

    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const area = 0.5 * Math.hypot(cx, cy, cz);

    if (!Number.isFinite(area) || area < minArea) {
      degenerateTriangles++;
      continue;
    }

    const anx = nrm.getX(i0) + nrm.getX(i1) + nrm.getX(i2);
    const any = nrm.getY(i0) + nrm.getY(i1) + nrm.getY(i2);
    const anz = nrm.getZ(i0) + nrm.getZ(i1) + nrm.getZ(i2);
    const dot = cx * anx + cy * any + cz * anz;
    if (dot < 0) {
      invertedWindingTriangles++;
    }
  }

  if (degenerateTriangles > 0) issues.push(`Found ${degenerateTriangles} degenerate triangle(s)`);
  if (invalidNormals > 0) issues.push(`Found ${invalidNormals} invalid/non-unit normal(s)`);
  if (invertedWindingTriangles > 0) issues.push(`Found ${invertedWindingTriangles} inverted-winding triangle(s)`);
  if (invalidUVs > 0) issues.push(`Found ${invalidUVs} non-finite UV(s)`);

  const valid = issues.length === 0;
  const invertedWindingRatio = triangleCount > 0 ? invertedWindingTriangles / triangleCount : 0;

  return {
    valid,
    vertexCount: vCount,
    triangleCount,
    degenerateTriangles,
    invalidNormals,
    invertedWindingTriangles,
    invalidUVs,
    invertedWindingRatio,
    issues,
  };
}
