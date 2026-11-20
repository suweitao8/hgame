import type * as THREE from 'three';
import type { AABB, TriMeshData } from '../recipes/schema-types.js';
import type { VoxelChunkData } from './voxel-chunk-mesher.js';

/**
 * 3D greedy AABB box merger over a voxel chunk.
 * Produces minimal axis-aligned bounding boxes covering all solid cells.
 */
export function extractMergedBoxes(chunk: VoxelChunkData): AABB[] {
  const { sizeX, sizeY, sizeZ, voxelSize, origin } = chunk;
  const visited = new Uint8Array(sizeX * sizeY * sizeZ);
  const idxOf = (x: number, y: number, z: number) => x + z * sizeX + y * sizeX * sizeZ;
  const canTake = (x: number, y: number, z: number) =>
    chunk.isSolid(x, y, z) && visited[idxOf(x, y, z)] === 0;

  const boxes: AABB[] = [];

  for (let y = 0; y < sizeY; y++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let x = 0; x < sizeX; x++) {
        if (!canTake(x, y, z)) continue;

        let ex = x + 1;
        while (ex < sizeX && canTake(ex, y, z)) ex++;

        let ez = z + 1;
        outerZ: while (ez < sizeZ) {
          for (let ix = x; ix < ex; ix++) {
            if (!canTake(ix, y, ez)) break outerZ;
          }
          ez++;
        }

        let ey = y + 1;
        outerY: while (ey < sizeY) {
          for (let iz = z; iz < ez; iz++) {
            for (let ix = x; ix < ex; ix++) {
              if (!canTake(ix, ey, iz)) break outerY;
            }
          }
          ey++;
        }

        for (let iy = y; iy < ey; iy++) {
          for (let iz = z; iz < ez; iz++) {
            for (let ix = x; ix < ex; ix++) {
              visited[idxOf(ix, iy, iz)] = 1;
            }
          }
        }

        boxes.push({
          min: [
            origin[0] + x * voxelSize,
            origin[1] + y * voxelSize,
            origin[2] + z * voxelSize,
          ],
          max: [
            origin[0] + ex * voxelSize,
            origin[1] + ey * voxelSize,
            origin[2] + ez * voxelSize,
          ],
        });
      }
    }
  }

  return boxes;
}

/**
 * Extracts raw vertex/index arrays from a Three.js BufferGeometry for physics TriMesh colliders.
 */
export function extractTriMesh(geometry: THREE.BufferGeometry): TriMeshData {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) {
    return { vertices: new Float32Array(0), indices: new Uint32Array(0) };
  }
  const vertices = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    vertices[i * 3] = posAttr.getX(i);
    vertices[i * 3 + 1] = posAttr.getY(i);
    vertices[i * 3 + 2] = posAttr.getZ(i);
  }

  const indexAttr = geometry.getIndex();
  if (indexAttr) {
    const indices = new Uint32Array(indexAttr.count);
    for (let i = 0; i < indexAttr.count; i++) {
      indices[i] = indexAttr.array[i] ?? 0;
    }
    return { vertices, indices };
  }

  const indices = new Uint32Array(posAttr.count);
  for (let i = 0; i < posAttr.count; i++) indices[i] = i;
  return { vertices, indices };
}

/**
 * Extracts bounding boxes directly from geometry (single coarse AABB fallback).
 */
export function extractBoundsBox(geometry: THREE.BufferGeometry): AABB[] {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return [];
  return [
    {
      min: [bb.min.x, bb.min.y, bb.min.z],
      max: [bb.max.x, bb.max.y, bb.max.z],
    },
  ];
}

export interface PortableRapierBoxDesc {
  kind: 'cuboid';
  center: [number, number, number];
  halfExtents: [number, number, number];
}

export interface PortableRapierTriMeshDesc {
  kind: 'trimesh';
  vertices: Float32Array;
  indices: Uint32Array;
}

export interface RapierNamespaceLike {
  ColliderDesc?: {
    cuboid(hx: number, hy: number, hz: number): { setTranslation(x: number, y: number, z: number): unknown };
    trimesh(vertices: Float32Array, indices: Uint32Array): unknown;
  };
}

export function toRapierColliderDesc(
  data: AABB[] | TriMeshData,
  RAPIER?: RapierNamespaceLike
): Array<PortableRapierBoxDesc | PortableRapierTriMeshDesc | unknown> {
  if (Array.isArray(data)) {
    return data.map((box) => {
      const cx = (box.min[0] + box.max[0]) * 0.5;
      const cy = (box.min[1] + box.max[1]) * 0.5;
      const cz = (box.min[2] + box.max[2]) * 0.5;
      const hx = Math.max(0.005, (box.max[0] - box.min[0]) * 0.5);
      const hy = Math.max(0.005, (box.max[1] - box.min[1]) * 0.5);
      const hz = Math.max(0.005, (box.max[2] - box.min[2]) * 0.5);
      if (RAPIER?.ColliderDesc) {
        return RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz);
      }
      return {
        kind: 'cuboid',
        center: [cx, cy, cz],
        halfExtents: [hx, hy, hz],
      } satisfies PortableRapierBoxDesc;
    });
  }

  if (RAPIER?.ColliderDesc) {
    return [RAPIER.ColliderDesc.trimesh(data.vertices, data.indices)];
  }
  return [
    {
      kind: 'trimesh',
      vertices: data.vertices,
      indices: data.indices,
    } satisfies PortableRapierTriMeshDesc,
  ];
}
