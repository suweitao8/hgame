import * as THREE from 'three';
import {
  buildBufferGeometryFromRaw,
  computeMetricBoxUV,
  createRawMeshData,
  pushVertex,
} from './metric-uv.js';

export interface VoxelChunkOptions {
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
  voxelSize?: number;
  origin?: [number, number, number];
}

export interface VoxelChunkData {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly voxelSize: number;
  readonly origin: [number, number, number];
  /** 0 = air, N >= 1 = solid with materialId = N - 1 */
  readonly voxels: Uint16Array;
  /** Per-voxel wetness / puddle mask [0..1] */
  readonly wetness: Float32Array;
  setVoxel(x: number, y: number, z: number, materialId: number | null, wetness?: number): void;
  getVoxel(x: number, y: number, z: number): number | null;
  isSolid(x: number, y: number, z: number): boolean;
  buildMeshGeometry(): THREE.BufferGeometry;
  dispose(): void;
}

const AO_CURVE = [1.0, 0.78, 0.58, 0.35] as const;

interface FaceDef {
  dir: [number, number, number];
  uAxis: [number, number, number];
  vAxis: [number, number, number];
  corners: ReadonlyArray<[number, number, number]>;
}

// Each face defines 4 corners in CCW order looking from outside
const FACES: ReadonlyArray<FaceDef> = [
  {
    // +Y (top)
    dir: [0, 1, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
    corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  },
  {
    // -Y (bottom)
    dir: [0, -1, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, -1],
    corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  },
  {
    // +X
    dir: [1, 0, 0],
    uAxis: [0, 0, -1],
    vAxis: [0, 1, 0],
    corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  },
  {
    // -X
    dir: [-1, 0, 0],
    uAxis: [0, 0, 1],
    vAxis: [0, 1, 0],
    corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  },
  {
    // +Z
    dir: [0, 0, 1],
    uAxis: [1, 0, 0],
    vAxis: [0, 1, 0],
    corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  },
  {
    // -Z
    dir: [0, 0, -1],
    uAxis: [-1, 0, 0],
    vAxis: [0, 1, 0],
    corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
  },
];

export function createVoxelChunk(options: VoxelChunkOptions = {}): VoxelChunkData {
  const sizeX = options.sizeX ?? 16;
  const sizeY = options.sizeY ?? 16;
  const sizeZ = options.sizeZ ?? 16;
  const voxelSize = options.voxelSize ?? 1.0;
  const origin: [number, number, number] = options.origin ?? [0, 0, 0];

  const total = sizeX * sizeY * sizeZ;
  const voxels = new Uint16Array(total);
  const wetness = new Float32Array(total);
  let lastGeometry: THREE.BufferGeometry | null = null;

  const idxOf = (x: number, y: number, z: number) => x + z * sizeX + y * sizeX * sizeZ;
  const inBounds = (x: number, y: number, z: number) =>
    x >= 0 && x < sizeX && y >= 0 && y < sizeY && z >= 0 && z < sizeZ;

  const isSolid = (x: number, y: number, z: number): boolean => {
    if (!inBounds(x, y, z)) return false;
    return voxels[idxOf(x, y, z)]! > 0;
  };

  function computeCornerAO(
    vx: number,
    vy: number,
    vz: number,
    face: FaceDef,
    corner: readonly [number, number, number]
  ): number {
    const [dx, dy, dz] = face.dir;
    // Neighbor plane one voxel step in face normal direction
    const nx = vx + dx;
    const ny = vy + dy;
    const nz = vz + dz;

    // Determine the two tangent signs along uAxis & vAxis for this corner
    const cx = corner[0] * 2 - 1;
    const cy = corner[1] * 2 - 1;
    const cz = corner[2] * 2 - 1;

    const su = cx * face.uAxis[0] + cy * face.uAxis[1] + cz * face.uAxis[2];
    const sv = cx * face.vAxis[0] + cy * face.vAxis[1] + cz * face.vAxis[2];

    const s1 = isSolid(nx + face.uAxis[0] * su, ny + face.uAxis[1] * su, nz + face.uAxis[2] * su) ? 1 : 0;
    const s2 = isSolid(nx + face.vAxis[0] * sv, ny + face.vAxis[1] * sv, nz + face.vAxis[2] * sv) ? 1 : 0;
    const c = isSolid(
      nx + face.uAxis[0] * su + face.vAxis[0] * sv,
      ny + face.uAxis[1] * su + face.vAxis[1] * sv,
      nz + face.uAxis[2] * su + face.vAxis[2] * sv
    )
      ? 1
      : 0;

    const occ = s1 && s2 ? 3 : s1 + s2 + c;
    return AO_CURVE[occ]!;
  }

  return {
    sizeX,
    sizeY,
    sizeZ,
    voxelSize,
    origin,
    voxels,
    wetness,

    setVoxel(x: number, y: number, z: number, materialId: number | null, wet = 0): void {
      if (!inBounds(x, y, z)) return;
      const idx = idxOf(x, y, z);
      voxels[idx] = materialId === null || materialId < 0 ? 0 : (materialId + 1) & 0xffff;
      wetness[idx] = Math.max(0, Math.min(1, wet));
    },

    getVoxel(x: number, y: number, z: number): number | null {
      if (!inBounds(x, y, z)) return null;
      const v = voxels[idxOf(x, y, z)]!;
      return v === 0 ? null : v - 1;
    },

    isSolid,

    buildMeshGeometry(): THREE.BufferGeometry {
      if (lastGeometry) {
        lastGeometry.dispose();
        lastGeometry = null;
      }
      const raw = createRawMeshData();

      for (let y = 0; y < sizeY; y++) {
        for (let z = 0; z < sizeZ; z++) {
          for (let x = 0; x < sizeX; x++) {
            const idx = idxOf(x, y, z);
            const rawVal = voxels[idx]!;
            if (rawVal === 0) continue;
            const matId = rawVal - 1;
            const wet = wetness[idx]!;

            for (const face of FACES) {
              const [dx, dy, dz] = face.dir;
              if (isSolid(x + dx, y + dy, z + dz)) continue; // Hidden face culling

              const aos: [number, number, number, number] = [0, 0, 0, 0];
              const vIdxs: [number, number, number, number] = [0, 0, 0, 0];
              const faceWet = dy > 0 ? wet : wet * 0.25;

              for (let c = 0; c < 4; c++) {
                const corner = face.corners[c]!;
                const px = origin[0] + (x + corner[0]) * voxelSize;
                const py = origin[1] + (y + corner[1]) * voxelSize;
                const pz = origin[2] + (z + corner[2]) * voxelSize;
                const [u, v] = computeMetricBoxUV(px, py, pz, dx, dy, dz);
                const ao = computeCornerAO(x, y, z, face, corner);
                aos[c] = ao;
                vIdxs[c] = pushVertex(raw, px, py, pz, dx, dy, dz, u, v, ao, 0.05, faceWet, matId);
              }

              // Flip quad diagonal when opposing AO sum breaks anisotropy symmetry
              if (aos[0] + aos[2] > aos[1] + aos[3]) {
                raw.indices.push(vIdxs[0], vIdxs[1], vIdxs[2], vIdxs[0], vIdxs[2], vIdxs[3]);
              } else {
                raw.indices.push(vIdxs[1], vIdxs[2], vIdxs[3], vIdxs[1], vIdxs[3], vIdxs[0]);
              }
            }
          }
        }
      }

      lastGeometry = buildBufferGeometryFromRaw(raw);
      return lastGeometry;
    },

    dispose(): void {
      if (lastGeometry) {
        lastGeometry.dispose();
        lastGeometry = null;
      }
    },
  };
}
