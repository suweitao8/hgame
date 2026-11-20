import * as THREE from 'three';
import type { ProceduralAssetLoader } from '../recipes/procedural-asset-loader.js';
import type { ParamMap } from '../core/safe-expr.js';

export interface PropInstanceHandle {
  poolKey: string;
  instanceId: number;
}

export interface PropInstanceData {
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  tintJitter?: number;
  wearBias?: number;
  wetnessBias?: number;
}

export interface InstancedPropPoolOptions {
  loader: ProceduralAssetLoader;
  material: THREE.Material;
  parent?: THREE.Object3D;
}

interface PoolRecord {
  poolKey: string;
  meshId: string;
  params?: ParamMap;
  materialOverrides?: Record<string, string>;
  protoGeo: THREE.BufferGeometry;
  triangleCountPerInstance: number;
  capacity: number;
  activeCount: number;
  dirty: boolean;
  mesh: THREE.InstancedMesh;
  metaArray: Float32Array;
  metaAttr: THREE.InstancedBufferAttribute;
  slotById: Map<number, number>;
  idBySlot: number[];
  dataById: Map<number, Required<PropInstanceData> & { seed: number }>;
}

function stableHashRecord(rec: Record<string, unknown> | undefined): string {
  if (!rec) return '';
  const keys = Object.keys(rec).sort();
  if (keys.length === 0) return '';
  return keys.map((k) => `${k}=${JSON.stringify(rec[k])}`).join('&');
}

function makePoolKey(
  meshId: string,
  params?: ParamMap,
  materialOverrides?: Record<string, string>
): string {
  const p = stableHashRecord(params);
  const m = stableHashRecord(materialOverrides);
  return `${meshId}|p:${p}|m:${m}`;
}

function normalizeInstanceData(
  data: PropInstanceData,
  seed: number
): Required<PropInstanceData> & { seed: number } {
  return {
    position: [data.position[0], data.position[1], data.position[2]],
    rotation: data.rotation ? [data.rotation[0], data.rotation[1], data.rotation[2]] : [0, 0, 0],
    scale: data.scale ? [data.scale[0], data.scale[1], data.scale[2]] : [1, 1, 1],
    tintJitter: Math.max(-0.35, Math.min(0.35, data.tintJitter ?? 0)),
    wearBias: Math.max(0, Math.min(1, data.wearBias ?? 0)),
    wetnessBias: Math.max(-0.5, Math.min(1, data.wetnessBias ?? 0)),
    seed,
  };
}

export class InstancedPropPool {
  readonly group: THREE.Group;
  private readonly loader: ProceduralAssetLoader;
  private readonly material: THREE.Material;
  private readonly parent?: THREE.Object3D;
  private readonly pools = new Map<string, PoolRecord>();
  private nextInstanceId = 1;
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpEuler = new THREE.Euler();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpMat = new THREE.Matrix4();

  constructor(options: InstancedPropPoolOptions) {
    this.loader = options.loader;
    this.material = options.material;
    this.parent = options.parent;
    this.group = new THREE.Group();
    this.group.name = 'InstancedPropPoolGroup';
    if (this.parent) {
      this.parent.add(this.group);
    }
  }

  private createPool(
    poolKey: string,
    meshId: string,
    capacity: number,
    params?: ParamMap,
    materialOverrides?: Record<string, string>,
    castShadow = true
  ): PoolRecord {
    const inst = this.loader.instantiateMesh(meshId, { params, materialOverrides });
    const protoGeo = inst.geometry.clone();
    const metaArray = new Float32Array(capacity * 4);
    const metaAttr = new THREE.InstancedBufferAttribute(metaArray, 4);
    protoGeo.setAttribute('aInstanceMeta', metaAttr);

    const mesh = new THREE.InstancedMesh(protoGeo, this.material, capacity);
    mesh.name = `InstancedPool_${meshId}`;
    mesh.count = 0;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);

    const pool: PoolRecord = {
      poolKey,
      meshId,
      params,
      materialOverrides,
      protoGeo,
      triangleCountPerInstance: inst.triangleCount,
      capacity,
      activeCount: 0,
      dirty: false,
      mesh,
      metaArray,
      metaAttr,
      slotById: new Map(),
      idBySlot: [],
      dataById: new Map(),
    };
    this.pools.set(poolKey, pool);
    return pool;
  }

  private growPool(pool: PoolRecord): void {
    const nextCapacity = Math.max(2, pool.capacity * 2);
    const nextMetaArray = new Float32Array(nextCapacity * 4);
    nextMetaArray.set(pool.metaArray);

    const nextGeo = pool.protoGeo.clone();
    const nextMetaAttr = new THREE.InstancedBufferAttribute(nextMetaArray, 4);
    nextGeo.setAttribute('aInstanceMeta', nextMetaAttr);

    const nextMesh = new THREE.InstancedMesh(nextGeo, this.material, nextCapacity);
    nextMesh.name = pool.mesh.name;
    nextMesh.castShadow = pool.mesh.castShadow;
    nextMesh.receiveShadow = pool.mesh.receiveShadow;
    nextMesh.frustumCulled = false;

    for (let s = 0; s < pool.activeCount; s++) {
      pool.mesh.getMatrixAt(s, this.tmpMat);
      nextMesh.setMatrixAt(s, this.tmpMat);
    }
    nextMesh.count = pool.activeCount;
    nextMesh.instanceMatrix.needsUpdate = true;
    nextMetaAttr.needsUpdate = true;

    this.group.remove(pool.mesh);
    pool.protoGeo.dispose();
    pool.mesh.dispose();
    this.group.add(nextMesh);

    pool.capacity = nextCapacity;
    pool.protoGeo = nextGeo;
    pool.mesh = nextMesh;
    pool.metaArray = nextMetaArray;
    pool.metaAttr = nextMetaAttr;
    pool.dirty = true;
  }

  private writeSlot(
    pool: PoolRecord,
    slot: number,
    entry: Required<PropInstanceData> & { seed: number }
  ): void {
    this.tmpPos.set(entry.position[0], entry.position[1], entry.position[2]);
    this.tmpEuler.set(entry.rotation[0], entry.rotation[1], entry.rotation[2]);
    this.tmpQuat.setFromEuler(this.tmpEuler);
    this.tmpScale.set(entry.scale[0], entry.scale[1], entry.scale[2]);
    this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
    pool.mesh.setMatrixAt(slot, this.tmpMat);

    pool.metaAttr.setXYZW(
      slot,
      entry.tintJitter,
      entry.wearBias,
      entry.wetnessBias,
      entry.seed
    );
    pool.dirty = true;
  }

  spawn(
    meshId: string,
    instance: PropInstanceData,
    options: {
      params?: ParamMap;
      materialOverrides?: Record<string, string>;
      initialCapacity?: number;
      castShadow?: boolean;
    } = {}
  ): PropInstanceHandle {
    const poolKey = makePoolKey(meshId, options.params, options.materialOverrides);
    let pool = this.pools.get(poolKey);
    if (!pool) {
      const cap = Math.max(4, options.initialCapacity ?? 32);
      pool = this.createPool(
        poolKey,
        meshId,
        cap,
        options.params,
        options.materialOverrides,
        options.castShadow !== false
      );
    }
    if (pool.activeCount >= pool.capacity) {
      this.growPool(pool);
    }

    const instanceId = this.nextInstanceId++;
    const seed = ((instanceId * 2654435761) >>> 0) / 4294967296;
    const entry = normalizeInstanceData(instance, seed);
    const slot = pool.activeCount++;

    pool.slotById.set(instanceId, slot);
    pool.idBySlot[slot] = instanceId;
    pool.dataById.set(instanceId, entry);
    this.writeSlot(pool, slot, entry);

    return { poolKey, instanceId };
  }

  updateTransform(handle: PropInstanceHandle, data: Partial<PropInstanceData>): void {
    const pool = this.pools.get(handle.poolKey);
    if (!pool) return;
    const slot = pool.slotById.get(handle.instanceId);
    const existing = pool.dataById.get(handle.instanceId);
    if (slot === undefined || !existing) return;

    const updated: Required<PropInstanceData> & { seed: number } = {
      position: data.position
        ? [data.position[0], data.position[1], data.position[2]]
        : existing.position,
      rotation: data.rotation
        ? [data.rotation[0], data.rotation[1], data.rotation[2]]
        : existing.rotation,
      scale: data.scale ? [data.scale[0], data.scale[1], data.scale[2]] : existing.scale,
      tintJitter:
        data.tintJitter !== undefined
          ? Math.max(-0.35, Math.min(0.35, data.tintJitter))
          : existing.tintJitter,
      wearBias:
        data.wearBias !== undefined
          ? Math.max(0, Math.min(1, data.wearBias))
          : existing.wearBias,
      wetnessBias:
        data.wetnessBias !== undefined
          ? Math.max(-0.5, Math.min(1, data.wetnessBias))
          : existing.wetnessBias,
      seed: existing.seed,
    };

    pool.dataById.set(handle.instanceId, updated);
    this.writeSlot(pool, slot, updated);
  }

  remove(handle: PropInstanceHandle): void {
    const pool = this.pools.get(handle.poolKey);
    if (!pool) return;
    const slot = pool.slotById.get(handle.instanceId);
    if (slot === undefined) return;

    const lastSlot = pool.activeCount - 1;
    if (slot !== lastSlot) {
      const movedId = pool.idBySlot[lastSlot]!;
      const movedData = pool.dataById.get(movedId)!;
      pool.idBySlot[slot] = movedId;
      pool.slotById.set(movedId, slot);
      this.writeSlot(pool, slot, movedData);
    }

    pool.activeCount = lastSlot;
    pool.idBySlot.length = lastSlot;
    pool.slotById.delete(handle.instanceId);
    pool.dataById.delete(handle.instanceId);
    pool.dirty = true;
  }

  flush(): void {
    for (const pool of this.pools.values()) {
      if (!pool.dirty) continue;
      pool.mesh.count = pool.activeCount;
      pool.mesh.instanceMatrix.needsUpdate = true;
      pool.metaAttr.needsUpdate = true;
      pool.dirty = false;
    }
  }

  getStats(): {
    poolCount: number;
    totalInstances: number;
    totalTrianglesRendered: number;
  } {
    let totalInstances = 0;
    let totalTrianglesRendered = 0;
    for (const pool of this.pools.values()) {
      totalInstances += pool.activeCount;
      totalTrianglesRendered += pool.activeCount * pool.triangleCountPerInstance;
    }
    return {
      poolCount: this.pools.size,
      totalInstances,
      totalTrianglesRendered,
    };
  }

  dispose(): void {
    for (const pool of this.pools.values()) {
      this.group.remove(pool.mesh);
      pool.protoGeo.dispose();
      pool.mesh.dispose();
      pool.slotById.clear();
      pool.dataById.clear();
    }
    this.pools.clear();
    if (this.parent) {
      this.parent.remove(this.group);
    }
  }
}
