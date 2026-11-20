import * as THREE from 'three';
import { computeMetricBoxUV, type RawMeshData } from './metric-uv.js';

export interface VertexInput {
  pos: readonly [number, number, number];
  normal?: readonly [number, number, number];
  uv?: readonly [number, number];
  ao?: number;
  edgeWear?: number;
  wetness?: number;
  materialId: number;
}

export interface ProceduralMeshBuildResult {
  geometry: THREE.BufferGeometry;
  vertexCount: number;
  triangleCount: number;
  estimatedBytes: number;
}

function computeFaceNormal(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number]
): { nx: number; ny: number; nz: number; cx: number; cy: number; cz: number; len: number } {
  const ax = b[0] - a[0];
  const ay = b[1] - a[1];
  const az = b[2] - a[2];
  const bx = c[0] - a[0];
  const by = c[1] - a[1];
  const bz = c[2] - a[2];
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  const len = Math.hypot(cx, cy, cz);
  const inv = len > 1e-8 ? 1 / len : 0;
  return {
    nx: inv > 0 ? cx * inv : 0,
    ny: inv > 0 ? cy * inv : 1,
    nz: inv > 0 ? cz * inv : 0,
    cx,
    cy,
    cz,
    len,
  };
}

/**
 * ArrayMesh-style two-phase builder for Track A & compiled Track B prototypes.
 * Enforces CCW winding matching normals, hard-edge vertex splits, metric UV projection,
 * and automatic Uint16 / Uint32 index packing.
 */
export class ProceduralMeshBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private colors: number[] = [];
  private materialIds: number[] = [];
  private indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  reset(): void {
    this.positions.length = 0;
    this.normals.length = 0;
    this.uvs.length = 0;
    this.colors.length = 0;
    this.materialIds.length = 0;
    this.indices.length = 0;
  }

  private pushSingleVertex(
    v: VertexInput,
    fallbackNormal: readonly [number, number, number],
    tileMeters: number
  ): number {
    const idx = this.positions.length / 3;
    const nrm = v.normal ?? fallbackNormal;
    const nLen = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
    const nx = nrm[0] / nLen;
    const ny = nrm[1] / nLen;
    const nz = nrm[2] / nLen;

    let u: number;
    let tv: number;
    if (v.uv) {
      u = v.uv[0];
      tv = v.uv[1];
    } else {
      const safeTile = Math.max(0.001, tileMeters);
      const [mu, mv] = computeMetricBoxUV(v.pos[0], v.pos[1], v.pos[2], nx, ny, nz);
      u = mu / safeTile;
      tv = mv / safeTile;
    }

    this.positions.push(v.pos[0], v.pos[1], v.pos[2]);
    this.normals.push(nx, ny, nz);
    this.uvs.push(u, tv);
    this.colors.push(v.ao ?? 1.0, v.edgeWear ?? 0.0, v.wetness ?? 0.0);
    this.materialIds.push(v.materialId);
    return idx;
  }

  pushTriangle(a: VertexInput, b: VertexInput, c: VertexInput, tileMeters = 1.0): void {
    const face = computeFaceNormal(a.pos, b.pos, c.pos);
    if (face.len < 1e-7) return; // Skip zero-area degenerate triangles

    const refN = a.normal ?? b.normal ?? c.normal;
    let v1 = a;
    let v2 = b;
    let v3 = c;
    let fallback: [number, number, number] = [face.nx, face.ny, face.nz];

    if (refN) {
      const dot = face.cx * refN[0] + face.cy * refN[1] + face.cz * refN[2];
      if (dot < 0) {
        v2 = c;
        v3 = b;
        fallback = [-face.nx, -face.ny, -face.nz];
      }
    }

    const i0 = this.pushSingleVertex(v1, fallback, tileMeters);
    const i1 = this.pushSingleVertex(v2, fallback, tileMeters);
    const i2 = this.pushSingleVertex(v3, fallback, tileMeters);
    this.indices.push(i0, i1, i2);
  }

  pushQuad(
    a: VertexInput,
    b: VertexInput,
    c: VertexInput,
    d: VertexInput,
    options: { tileMeters?: number; flipDiagonal?: boolean } = {}
  ): void {
    const tileMeters = options.tileMeters ?? 1.0;
    const face = computeFaceNormal(a.pos, b.pos, c.pos);
    if (face.len < 1e-7) return;

    const refN = a.normal ?? b.normal ?? c.normal ?? d.normal;
    let va = a;
    let vb = b;
    let vc = c;
    let vd = d;
    let fallback: [number, number, number] = [face.nx, face.ny, face.nz];

    if (refN) {
      const dot = face.cx * refN[0] + face.cy * refN[1] + face.cz * refN[2];
      if (dot < 0) {
        vb = d;
        vd = b;
        fallback = [-face.nx, -face.ny, -face.nz];
      }
    }

    const i0 = this.pushSingleVertex(va, fallback, tileMeters);
    const i1 = this.pushSingleVertex(vb, fallback, tileMeters);
    const i2 = this.pushSingleVertex(vc, fallback, tileMeters);
    const i3 = this.pushSingleVertex(vd, fallback, tileMeters);

    if (options.flipDiagonal) {
      this.indices.push(i1, i2, i3, i1, i3, i0);
    } else {
      this.indices.push(i0, i1, i2, i0, i2, i3);
    }
  }

  appendRaw(raw: RawMeshData): void {
    const base = this.vertexCount;
    for (let i = 0; i < raw.positions.length; i++) this.positions.push(raw.positions[i]!);
    for (let i = 0; i < raw.normals.length; i++) this.normals.push(raw.normals[i]!);
    for (let i = 0; i < raw.uvs.length; i++) this.uvs.push(raw.uvs[i]!);
    for (let i = 0; i < raw.colors.length; i++) this.colors.push(raw.colors[i]!);
    for (let i = 0; i < raw.materialIds.length; i++) this.materialIds.push(raw.materialIds[i]!);
    for (let i = 0; i < raw.indices.length; i++) this.indices.push(raw.indices[i]! + base);
  }

  appendGeometry(
    source: THREE.BufferGeometry,
    options: {
      matrix?: THREE.Matrix4;
      materialId: number;
      tileMeters?: number;
      edgeWear?: number;
      wetness?: number;
      recomputeMetricUV?: boolean;
    }
  ): void {
    const posAttr = source.getAttribute('position');
    if (!posAttr) return;
    const nrmAttr = source.getAttribute('normal');
    const uvAttr = source.getAttribute('uv');
    const colAttr = source.getAttribute('color');
    const idxAttr = source.getIndex();

    const m = options.matrix;
    const e = m?.elements;
    const tileMeters = Math.max(0.001, options.tileMeters ?? 1.0);
    const recomputeUV = options.recomputeMetricUV !== false;

    let det = 1;
    let nMat: THREE.Matrix3 | null = null;
    if (m) {
      const m3 = new THREE.Matrix3().setFromMatrix4(m);
      det = m3.determinant();
      nMat = m3.clone().invert().transpose();
    }
    const ne = nMat?.elements;
    const baseVertex = this.vertexCount;

    for (let i = 0; i < posAttr.count; i++) {
      let px = posAttr.getX(i);
      let py = posAttr.getY(i);
      let pz = posAttr.getZ(i);
      if (e) {
        const tx = e[0]! * px + e[4]! * py + e[8]! * pz + e[12]!;
        const ty = e[1]! * px + e[5]! * py + e[9]! * pz + e[13]!;
        const tz = e[2]! * px + e[6]! * py + e[10]! * pz + e[14]!;
        px = tx;
        py = ty;
        pz = tz;
      }

      let nx = nrmAttr ? nrmAttr.getX(i) : 0;
      let ny = nrmAttr ? nrmAttr.getY(i) : 1;
      let nz = nrmAttr ? nrmAttr.getZ(i) : 0;
      if (ne) {
        const tnx = ne[0]! * nx + ne[3]! * ny + ne[6]! * nz;
        const tny = ne[1]! * nx + ne[4]! * ny + ne[7]! * nz;
        const tnz = ne[2]! * nx + ne[5]! * ny + ne[8]! * nz;
        nx = tnx;
        ny = tny;
        nz = tnz;
      }
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;

      let u: number;
      let v: number;
      if (recomputeUV || !uvAttr) {
        const [mu, mv] = computeMetricBoxUV(px, py, pz, nx, ny, nz);
        u = mu / tileMeters;
        v = mv / tileMeters;
      } else {
        u = uvAttr.getX(i);
        v = uvAttr.getY(i);
      }

      this.positions.push(px, py, pz);
      this.normals.push(nx, ny, nz);
      this.uvs.push(u, v);
      this.colors.push(
        colAttr ? colAttr.getX(i) : 1.0,
        options.edgeWear !== undefined ? options.edgeWear : colAttr ? colAttr.getY(i) : 0.0,
        options.wetness !== undefined ? options.wetness : colAttr ? colAttr.getZ(i) : 0.0
      );
      this.materialIds.push(options.materialId);
    }

    const flipWinding = det < 0;
    const total = idxAttr ? idxAttr.count : posAttr.count;
    for (let i = 0; i + 2 < total; i += 3) {
      const a = baseVertex + (idxAttr ? (idxAttr.array[i] ?? 0) : i);
      const b = baseVertex + (idxAttr ? (idxAttr.array[i + 1] ?? 0) : i + 1);
      const c = baseVertex + (idxAttr ? (idxAttr.array[i + 2] ?? 0) : i + 2);
      if (flipWinding) {
        this.indices.push(a, c, b);
      } else {
        this.indices.push(a, b, c);
      }
    }
  }

  build(): ProceduralMeshBuildResult {
    const geometry = new THREE.BufferGeometry();
    const vCount = this.vertexCount;
    const tCount = this.triangleCount;

    const posArr = new Float32Array(this.positions);
    const nrmArr = new Float32Array(this.normals);
    const uvArr = new Float32Array(this.uvs);
    const colArr = new Float32Array(this.colors);
    const matArr = new Float32Array(this.materialIds);

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nrmArr, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
    geometry.setAttribute('aMaterialId', new THREE.Float32BufferAttribute(matArr, 1));

    let indexBytes: number;
    if (vCount <= 65535) {
      const idxArr = new Uint16Array(this.indices);
      geometry.setIndex(new THREE.Uint16BufferAttribute(idxArr, 1));
      indexBytes = idxArr.byteLength;
    } else {
      const idxArr = new Uint32Array(this.indices);
      geometry.setIndex(new THREE.Uint32BufferAttribute(idxArr, 1));
      indexBytes = idxArr.byteLength;
    }

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const estimatedBytes =
      posArr.byteLength +
      nrmArr.byteLength +
      uvArr.byteLength +
      colArr.byteLength +
      matArr.byteLength +
      indexBytes;

    return {
      geometry,
      vertexCount: vCount,
      triangleCount: tCount,
      estimatedBytes,
    };
  }
}
