// src/modules/realistic-pcg/lookdev/lookdev-scene.ts
import * as THREE13 from "three";

// src/modules/realistic-pcg/core/quality-presets.ts
var REALISTIC_QUALITY_PRESETS = {
  HIGH: {
    tier: "HIGH",
    textureSize: 512,
    shadowMapSize: 2048,
    anisotropy: 8,
    pixelRatioCap: 2,
    frameBudgetMs: 8,
    enableTriplanar: true,
    enableMicroDetail: true,
    maxMaterials: 16,
    maxTextureMemoryMB: 96,
    skeletalMaxTriangles: 3e4,
    skeletalMaxTextureSize: 1024
  },
  LOW: {
    tier: "LOW",
    textureSize: 256,
    shadowMapSize: 1024,
    anisotropy: 2,
    pixelRatioCap: 1.5,
    frameBudgetMs: 8,
    enableTriplanar: false,
    enableMicroDetail: true,
    maxMaterials: 16,
    maxTextureMemoryMB: 24,
    skeletalMaxTriangles: 12e3,
    skeletalMaxTextureSize: 1024
  }
};
function getQualityPreset(tier) {
  return REALISTIC_QUALITY_PRESETS[tier];
}

// src/modules/realistic-pcg/geometry/collider-exporter.ts
function extractMergedBoxes(chunk) {
  const { sizeX, sizeY, sizeZ, voxelSize, origin } = chunk;
  const visited = new Uint8Array(sizeX * sizeY * sizeZ);
  const idxOf = (x, y, z) => x + z * sizeX + y * sizeX * sizeZ;
  const canTake = (x, y, z) => chunk.isSolid(x, y, z) && visited[idxOf(x, y, z)] === 0;
  const boxes = [];
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
            origin[2] + z * voxelSize
          ],
          max: [
            origin[0] + ex * voxelSize,
            origin[1] + ey * voxelSize,
            origin[2] + ez * voxelSize
          ]
        });
      }
    }
  }
  return boxes;
}
function extractTriMesh(geometry) {
  const posAttr = geometry.getAttribute("position");
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
    const indices2 = new Uint32Array(indexAttr.count);
    for (let i = 0; i < indexAttr.count; i++) {
      indices2[i] = indexAttr.array[i] ?? 0;
    }
    return { vertices, indices: indices2 };
  }
  const indices = new Uint32Array(posAttr.count);
  for (let i = 0; i < posAttr.count; i++) indices[i] = i;
  return { vertices, indices };
}
function extractBoundsBox(geometry) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return [];
  return [
    {
      min: [bb.min.x, bb.min.y, bb.min.z],
      max: [bb.max.x, bb.max.y, bb.max.z]
    }
  ];
}

// src/modules/realistic-pcg/geometry/metric-uv.ts
import * as THREE from "three";
function createRawMeshData() {
  return {
    positions: [],
    normals: [],
    uvs: [],
    colors: [],
    materialIds: [],
    indices: []
  };
}
function appendRawMesh(dst, src) {
  const baseVertex = dst.positions.length / 3;
  for (let i = 0; i < src.positions.length; i++) dst.positions.push(src.positions[i]);
  for (let i = 0; i < src.normals.length; i++) dst.normals.push(src.normals[i]);
  for (let i = 0; i < src.uvs.length; i++) dst.uvs.push(src.uvs[i]);
  for (let i = 0; i < src.colors.length; i++) dst.colors.push(src.colors[i]);
  for (let i = 0; i < src.materialIds.length; i++) dst.materialIds.push(src.materialIds[i]);
  for (let i = 0; i < src.indices.length; i++) dst.indices.push(src.indices[i] + baseVertex);
}
function computeMetricBoxUV(px, py, pz, nx, ny, nz) {
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
function recomputeMetricUVs(raw) {
  const count = raw.positions.length / 3;
  for (let i = 0; i < count; i++) {
    const o3 = i * 3;
    const o2 = i * 2;
    const [u, v] = computeMetricBoxUV(
      raw.positions[o3],
      raw.positions[o3 + 1],
      raw.positions[o3 + 2],
      raw.normals[o3],
      raw.normals[o3 + 1],
      raw.normals[o3 + 2]
    );
    raw.uvs[o2] = u;
    raw.uvs[o2 + 1] = v;
  }
}
function pushVertex(mesh, px, py, pz, nx, ny, nz, u, v, ao, edgeWear, wetness, materialId) {
  const idx = mesh.positions.length / 3;
  mesh.positions.push(px, py, pz);
  mesh.normals.push(nx, ny, nz);
  mesh.uvs.push(u, v);
  mesh.colors.push(ao, edgeWear, wetness);
  mesh.materialIds.push(materialId);
  return idx;
}
function pushOrientedQuad(mesh, p0, p1, p2, p3, outwardHint, ao, edgeWear, wetness, materialId, smoothNormal) {
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
function pushOrientedTri(mesh, p0, p1, p2, outwardHint, ao, edgeWear, wetness, materialId) {
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
function buildBeveledBoxRaw(width, height, depth, bevel, materialId, edgeWear = 0.65, ao = 1, wetness = 0) {
  const mesh = createRawMeshData();
  const hx = Math.max(5e-3, width * 0.5);
  const hy = Math.max(5e-3, height * 0.5);
  const hz = Math.max(5e-3, depth * 0.5);
  const b = Math.max(0, Math.min(bevel, hx * 0.45, hy * 0.45, hz * 0.45));
  if (b < 1e-3) {
    const p = (sx, sy, sz) => [sx * hx, sy * hy, sz * hz];
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
  const vx = (sx, sy, sz) => [sx * hx, sy * iy, sz * iz];
  const vy = (sx, sy, sz) => [sx * ix, sy * hy, sz * iz];
  const vz = (sx, sy, sz) => [sx * ix, sy * iy, sz * hz];
  const faceWear = edgeWear * 0.1;
  for (const s of [-1, 1]) {
    pushOrientedQuad(mesh, vx(s, -1, 1), vx(s, -1, -1), vx(s, 1, -1), vx(s, 1, 1), [s, 0, 0], ao, faceWear, wetness, materialId);
    pushOrientedQuad(mesh, vy(-1, s, 1), vy(1, s, 1), vy(1, s, -1), vy(-1, s, -1), [0, s, 0], ao, faceWear, wetness, materialId);
    pushOrientedQuad(mesh, vz(-1, -1, s), vz(1, -1, s), vz(1, 1, s), vz(-1, 1, s), [0, 0, s], ao, faceWear, wetness, materialId);
  }
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) {
      pushOrientedQuad(mesh, vy(-1, sy, sz), vy(1, sy, sz), vz(1, sy, sz), vz(-1, sy, sz), [0, sy, sz], ao, edgeWear, wetness, materialId);
    }
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      pushOrientedQuad(mesh, vx(sx, -1, sz), vx(sx, 1, sz), vz(sx, 1, sz), vz(sx, -1, sz), [sx, 0, sz], ao, edgeWear, wetness, materialId);
    }
  }
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      pushOrientedQuad(mesh, vx(sx, sy, -1), vx(sx, sy, 1), vy(sx, sy, 1), vy(sx, sy, -1), [sx, sy, 0], ao, edgeWear, wetness, materialId);
    }
  }
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        pushOrientedTri(mesh, vx(sx, sy, sz), vy(sx, sy, sz), vz(sx, sy, sz), [sx, sy, sz], ao, edgeWear, wetness, materialId);
      }
    }
  }
  return mesh;
}
function buildBufferGeometryFromRaw(raw) {
  const geom = new THREE.BufferGeometry();
  const vCount = raw.positions.length / 3;
  geom.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(raw.positions), 3));
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(raw.normals), 3));
  geom.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(raw.uvs), 2));
  geom.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(raw.colors), 3));
  geom.setAttribute("aMaterialId", new THREE.Float32BufferAttribute(new Float32Array(raw.materialIds), 1));
  if (vCount <= 65535) {
    geom.setIndex(new THREE.Uint16BufferAttribute(new Uint16Array(raw.indices), 1));
  } else {
    geom.setIndex(new THREE.Uint32BufferAttribute(new Uint32Array(raw.indices), 1));
  }
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

// src/modules/realistic-pcg/geometry/instanced-prop-pool.ts
import * as THREE2 from "three";
function stableHashRecord(rec) {
  if (!rec) return "";
  const keys = Object.keys(rec).sort();
  if (keys.length === 0) return "";
  return keys.map((k) => `${k}=${JSON.stringify(rec[k])}`).join("&");
}
function makePoolKey(meshId, params2, materialOverrides) {
  const p = stableHashRecord(params2);
  const m = stableHashRecord(materialOverrides);
  return `${meshId}|p:${p}|m:${m}`;
}
function normalizeInstanceData(data, seed) {
  return {
    position: [data.position[0], data.position[1], data.position[2]],
    rotation: data.rotation ? [data.rotation[0], data.rotation[1], data.rotation[2]] : [0, 0, 0],
    scale: data.scale ? [data.scale[0], data.scale[1], data.scale[2]] : [1, 1, 1],
    tintJitter: Math.max(-0.35, Math.min(0.35, data.tintJitter ?? 0)),
    wearBias: Math.max(0, Math.min(1, data.wearBias ?? 0)),
    wetnessBias: Math.max(-0.5, Math.min(1, data.wetnessBias ?? 0)),
    seed
  };
}
var InstancedPropPool = class {
  group;
  loader;
  material;
  parent;
  pools = /* @__PURE__ */ new Map();
  nextInstanceId = 1;
  tmpPos = new THREE2.Vector3();
  tmpEuler = new THREE2.Euler();
  tmpQuat = new THREE2.Quaternion();
  tmpScale = new THREE2.Vector3();
  tmpMat = new THREE2.Matrix4();
  constructor(options) {
    this.loader = options.loader;
    this.material = options.material;
    this.parent = options.parent;
    this.group = new THREE2.Group();
    this.group.name = "InstancedPropPoolGroup";
    if (this.parent) {
      this.parent.add(this.group);
    }
  }
  createPool(poolKey, meshId, capacity, params2, materialOverrides, castShadow = true) {
    const inst = this.loader.instantiateMesh(meshId, { params: params2, materialOverrides });
    const protoGeo = inst.geometry.clone();
    const metaArray = new Float32Array(capacity * 4);
    const metaAttr = new THREE2.InstancedBufferAttribute(metaArray, 4);
    protoGeo.setAttribute("aInstanceMeta", metaAttr);
    const mesh = new THREE2.InstancedMesh(protoGeo, this.material, capacity);
    mesh.name = `InstancedPool_${meshId}`;
    mesh.count = 0;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const pool = {
      poolKey,
      meshId,
      params: params2,
      materialOverrides,
      protoGeo,
      triangleCountPerInstance: inst.triangleCount,
      capacity,
      activeCount: 0,
      dirty: false,
      mesh,
      metaArray,
      metaAttr,
      slotById: /* @__PURE__ */ new Map(),
      idBySlot: [],
      dataById: /* @__PURE__ */ new Map()
    };
    this.pools.set(poolKey, pool);
    return pool;
  }
  growPool(pool) {
    const nextCapacity = Math.max(2, pool.capacity * 2);
    const nextMetaArray = new Float32Array(nextCapacity * 4);
    nextMetaArray.set(pool.metaArray);
    const nextGeo = pool.protoGeo.clone();
    const nextMetaAttr = new THREE2.InstancedBufferAttribute(nextMetaArray, 4);
    nextGeo.setAttribute("aInstanceMeta", nextMetaAttr);
    const nextMesh = new THREE2.InstancedMesh(nextGeo, this.material, nextCapacity);
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
  writeSlot(pool, slot, entry) {
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
  spawn(meshId, instance, options = {}) {
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
    const seed = (instanceId * 2654435761 >>> 0) / 4294967296;
    const entry = normalizeInstanceData(instance, seed);
    const slot = pool.activeCount++;
    pool.slotById.set(instanceId, slot);
    pool.idBySlot[slot] = instanceId;
    pool.dataById.set(instanceId, entry);
    this.writeSlot(pool, slot, entry);
    return { poolKey, instanceId };
  }
  updateTransform(handle, data) {
    const pool = this.pools.get(handle.poolKey);
    if (!pool) return;
    const slot = pool.slotById.get(handle.instanceId);
    const existing = pool.dataById.get(handle.instanceId);
    if (slot === void 0 || !existing) return;
    const updated = {
      position: data.position ? [data.position[0], data.position[1], data.position[2]] : existing.position,
      rotation: data.rotation ? [data.rotation[0], data.rotation[1], data.rotation[2]] : existing.rotation,
      scale: data.scale ? [data.scale[0], data.scale[1], data.scale[2]] : existing.scale,
      tintJitter: data.tintJitter !== void 0 ? Math.max(-0.35, Math.min(0.35, data.tintJitter)) : existing.tintJitter,
      wearBias: data.wearBias !== void 0 ? Math.max(0, Math.min(1, data.wearBias)) : existing.wearBias,
      wetnessBias: data.wetnessBias !== void 0 ? Math.max(-0.5, Math.min(1, data.wetnessBias)) : existing.wetnessBias,
      seed: existing.seed
    };
    pool.dataById.set(handle.instanceId, updated);
    this.writeSlot(pool, slot, updated);
  }
  remove(handle) {
    const pool = this.pools.get(handle.poolKey);
    if (!pool) return;
    const slot = pool.slotById.get(handle.instanceId);
    if (slot === void 0) return;
    const lastSlot = pool.activeCount - 1;
    if (slot !== lastSlot) {
      const movedId = pool.idBySlot[lastSlot];
      const movedData = pool.dataById.get(movedId);
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
  flush() {
    for (const pool of this.pools.values()) {
      if (!pool.dirty) continue;
      pool.mesh.count = pool.activeCount;
      pool.mesh.instanceMatrix.needsUpdate = true;
      pool.metaAttr.needsUpdate = true;
      pool.dirty = false;
    }
  }
  getStats() {
    let totalInstances = 0;
    let totalTrianglesRendered = 0;
    for (const pool of this.pools.values()) {
      totalInstances += pool.activeCount;
      totalTrianglesRendered += pool.activeCount * pool.triangleCountPerInstance;
    }
    return {
      poolCount: this.pools.size,
      totalInstances,
      totalTrianglesRendered
    };
  }
  dispose() {
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
};

// src/modules/realistic-pcg/geometry/mesh-builder.ts
import * as THREE3 from "three";
function computeFaceNormal(a, b, c) {
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
    len
  };
}
var ProceduralMeshBuilder = class {
  positions = [];
  normals = [];
  uvs = [];
  colors = [];
  materialIds = [];
  indices = [];
  get vertexCount() {
    return this.positions.length / 3;
  }
  get triangleCount() {
    return this.indices.length / 3;
  }
  reset() {
    this.positions.length = 0;
    this.normals.length = 0;
    this.uvs.length = 0;
    this.colors.length = 0;
    this.materialIds.length = 0;
    this.indices.length = 0;
  }
  pushSingleVertex(v, fallbackNormal, tileMeters) {
    const idx = this.positions.length / 3;
    const nrm = v.normal ?? fallbackNormal;
    const nLen = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
    const nx = nrm[0] / nLen;
    const ny = nrm[1] / nLen;
    const nz = nrm[2] / nLen;
    let u;
    let tv;
    if (v.uv) {
      u = v.uv[0];
      tv = v.uv[1];
    } else {
      const safeTile = Math.max(1e-3, tileMeters);
      const [mu, mv] = computeMetricBoxUV(v.pos[0], v.pos[1], v.pos[2], nx, ny, nz);
      u = mu / safeTile;
      tv = mv / safeTile;
    }
    this.positions.push(v.pos[0], v.pos[1], v.pos[2]);
    this.normals.push(nx, ny, nz);
    this.uvs.push(u, tv);
    this.colors.push(v.ao ?? 1, v.edgeWear ?? 0, v.wetness ?? 0);
    this.materialIds.push(v.materialId);
    return idx;
  }
  pushTriangle(a, b, c, tileMeters = 1) {
    const face = computeFaceNormal(a.pos, b.pos, c.pos);
    if (face.len < 1e-7) return;
    const refN = a.normal ?? b.normal ?? c.normal;
    let v1 = a;
    let v2 = b;
    let v3 = c;
    let fallback = [face.nx, face.ny, face.nz];
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
  pushQuad(a, b, c, d, options = {}) {
    const tileMeters = options.tileMeters ?? 1;
    const face = computeFaceNormal(a.pos, b.pos, c.pos);
    if (face.len < 1e-7) return;
    const refN = a.normal ?? b.normal ?? c.normal ?? d.normal;
    let va = a;
    let vb = b;
    let vc = c;
    let vd = d;
    let fallback = [face.nx, face.ny, face.nz];
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
  appendRaw(raw) {
    const base = this.vertexCount;
    for (let i = 0; i < raw.positions.length; i++) this.positions.push(raw.positions[i]);
    for (let i = 0; i < raw.normals.length; i++) this.normals.push(raw.normals[i]);
    for (let i = 0; i < raw.uvs.length; i++) this.uvs.push(raw.uvs[i]);
    for (let i = 0; i < raw.colors.length; i++) this.colors.push(raw.colors[i]);
    for (let i = 0; i < raw.materialIds.length; i++) this.materialIds.push(raw.materialIds[i]);
    for (let i = 0; i < raw.indices.length; i++) this.indices.push(raw.indices[i] + base);
  }
  appendGeometry(source, options) {
    const posAttr = source.getAttribute("position");
    if (!posAttr) return;
    const nrmAttr = source.getAttribute("normal");
    const uvAttr = source.getAttribute("uv");
    const colAttr = source.getAttribute("color");
    const idxAttr = source.getIndex();
    const m = options.matrix;
    const e = m?.elements;
    const tileMeters = Math.max(1e-3, options.tileMeters ?? 1);
    const recomputeUV = options.recomputeMetricUV !== false;
    let det = 1;
    let nMat = null;
    if (m) {
      const m3 = new THREE3.Matrix3().setFromMatrix4(m);
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
        const tx = e[0] * px + e[4] * py + e[8] * pz + e[12];
        const ty = e[1] * px + e[5] * py + e[9] * pz + e[13];
        const tz = e[2] * px + e[6] * py + e[10] * pz + e[14];
        px = tx;
        py = ty;
        pz = tz;
      }
      let nx = nrmAttr ? nrmAttr.getX(i) : 0;
      let ny = nrmAttr ? nrmAttr.getY(i) : 1;
      let nz = nrmAttr ? nrmAttr.getZ(i) : 0;
      if (ne) {
        const tnx = ne[0] * nx + ne[3] * ny + ne[6] * nz;
        const tny = ne[1] * nx + ne[4] * ny + ne[7] * nz;
        const tnz = ne[2] * nx + ne[5] * ny + ne[8] * nz;
        nx = tnx;
        ny = tny;
        nz = tnz;
      }
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;
      let u;
      let v;
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
        colAttr ? colAttr.getX(i) : 1,
        options.edgeWear !== void 0 ? options.edgeWear : colAttr ? colAttr.getY(i) : 0,
        options.wetness !== void 0 ? options.wetness : colAttr ? colAttr.getZ(i) : 0
      );
      this.materialIds.push(options.materialId);
    }
    const flipWinding = det < 0;
    const total = idxAttr ? idxAttr.count : posAttr.count;
    for (let i = 0; i + 2 < total; i += 3) {
      const a = baseVertex + (idxAttr ? idxAttr.array[i] ?? 0 : i);
      const b = baseVertex + (idxAttr ? idxAttr.array[i + 1] ?? 0 : i + 1);
      const c = baseVertex + (idxAttr ? idxAttr.array[i + 2] ?? 0 : i + 2);
      if (flipWinding) {
        this.indices.push(a, c, b);
      } else {
        this.indices.push(a, b, c);
      }
    }
  }
  build() {
    const geometry = new THREE3.BufferGeometry();
    const vCount = this.vertexCount;
    const tCount = this.triangleCount;
    const posArr = new Float32Array(this.positions);
    const nrmArr = new Float32Array(this.normals);
    const uvArr = new Float32Array(this.uvs);
    const colArr = new Float32Array(this.colors);
    const matArr = new Float32Array(this.materialIds);
    geometry.setAttribute("position", new THREE3.Float32BufferAttribute(posArr, 3));
    geometry.setAttribute("normal", new THREE3.Float32BufferAttribute(nrmArr, 3));
    geometry.setAttribute("uv", new THREE3.Float32BufferAttribute(uvArr, 2));
    geometry.setAttribute("color", new THREE3.Float32BufferAttribute(colArr, 3));
    geometry.setAttribute("aMaterialId", new THREE3.Float32BufferAttribute(matArr, 1));
    let indexBytes;
    if (vCount <= 65535) {
      const idxArr = new Uint16Array(this.indices);
      geometry.setIndex(new THREE3.Uint16BufferAttribute(idxArr, 1));
      indexBytes = idxArr.byteLength;
    } else {
      const idxArr = new Uint32Array(this.indices);
      geometry.setIndex(new THREE3.Uint32BufferAttribute(idxArr, 1));
      indexBytes = idxArr.byteLength;
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const estimatedBytes = posArr.byteLength + nrmArr.byteLength + uvArr.byteLength + colArr.byteLength + matArr.byteLength + indexBytes;
    return {
      geometry,
      vertexCount: vCount,
      triangleCount: tCount,
      estimatedBytes
    };
  }
};

// src/modules/realistic-pcg/geometry/voxel-chunk-mesher.ts
var AO_CURVE = [1, 0.78, 0.58, 0.35];
var FACES = [
  {
    // +Y (top)
    dir: [0, 1, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, 1],
    corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]
  },
  {
    // -Y (bottom)
    dir: [0, -1, 0],
    uAxis: [1, 0, 0],
    vAxis: [0, 0, -1],
    corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]
  },
  {
    // +X
    dir: [1, 0, 0],
    uAxis: [0, 0, -1],
    vAxis: [0, 1, 0],
    corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]]
  },
  {
    // -X
    dir: [-1, 0, 0],
    uAxis: [0, 0, 1],
    vAxis: [0, 1, 0],
    corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]
  },
  {
    // +Z
    dir: [0, 0, 1],
    uAxis: [1, 0, 0],
    vAxis: [0, 1, 0],
    corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]
  },
  {
    // -Z
    dir: [0, 0, -1],
    uAxis: [-1, 0, 0],
    vAxis: [0, 1, 0],
    corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]
  }
];
function createVoxelChunk(options = {}) {
  const sizeX = options.sizeX ?? 16;
  const sizeY = options.sizeY ?? 16;
  const sizeZ = options.sizeZ ?? 16;
  const voxelSize = options.voxelSize ?? 1;
  const origin = options.origin ?? [0, 0, 0];
  const total = sizeX * sizeY * sizeZ;
  const voxels = new Uint16Array(total);
  const wetness = new Float32Array(total);
  let lastGeometry = null;
  const idxOf = (x, y, z) => x + z * sizeX + y * sizeX * sizeZ;
  const inBounds = (x, y, z) => x >= 0 && x < sizeX && y >= 0 && y < sizeY && z >= 0 && z < sizeZ;
  const isSolid = (x, y, z) => {
    if (!inBounds(x, y, z)) return false;
    return voxels[idxOf(x, y, z)] > 0;
  };
  function computeCornerAO(vx, vy, vz, face, corner) {
    const [dx, dy, dz] = face.dir;
    const nx = vx + dx;
    const ny = vy + dy;
    const nz = vz + dz;
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
    ) ? 1 : 0;
    const occ = s1 && s2 ? 3 : s1 + s2 + c;
    return AO_CURVE[occ];
  }
  return {
    sizeX,
    sizeY,
    sizeZ,
    voxelSize,
    origin,
    voxels,
    wetness,
    setVoxel(x, y, z, materialId, wet = 0) {
      if (!inBounds(x, y, z)) return;
      const idx = idxOf(x, y, z);
      voxels[idx] = materialId === null || materialId < 0 ? 0 : materialId + 1 & 65535;
      wetness[idx] = Math.max(0, Math.min(1, wet));
    },
    getVoxel(x, y, z) {
      if (!inBounds(x, y, z)) return null;
      const v = voxels[idxOf(x, y, z)];
      return v === 0 ? null : v - 1;
    },
    isSolid,
    buildMeshGeometry() {
      if (lastGeometry) {
        lastGeometry.dispose();
        lastGeometry = null;
      }
      const builder = new ProceduralMeshBuilder();
      for (let y = 0; y < sizeY; y++) {
        for (let z = 0; z < sizeZ; z++) {
          for (let x = 0; x < sizeX; x++) {
            const idx = idxOf(x, y, z);
            const rawVal = voxels[idx];
            if (rawVal === 0) continue;
            const matId = rawVal - 1;
            const wet = wetness[idx];
            for (const face of FACES) {
              const [dx, dy, dz] = face.dir;
              if (isSolid(x + dx, y + dy, z + dz)) continue;
              const aos = [0, 0, 0, 0];
              const verts = [
                null,
                null,
                null,
                null
              ];
              const faceWet = dy > 0 ? wet : wet * 0.25;
              for (let c = 0; c < 4; c++) {
                const corner = face.corners[c];
                const px = origin[0] + (x + corner[0]) * voxelSize;
                const py = origin[1] + (y + corner[1]) * voxelSize;
                const pz = origin[2] + (z + corner[2]) * voxelSize;
                const ao = computeCornerAO(x, y, z, face, corner);
                aos[c] = ao;
                verts[c] = {
                  pos: [px, py, pz],
                  normal: face.dir,
                  ao,
                  edgeWear: 0.05,
                  wetness: faceWet,
                  materialId: matId
                };
              }
              const flipDiagonal = aos[0] + aos[2] <= aos[1] + aos[3];
              builder.pushQuad(verts[0], verts[1], verts[2], verts[3], { flipDiagonal });
            }
          }
        }
      }
      lastGeometry = builder.build().geometry;
      return lastGeometry;
    },
    dispose() {
      if (lastGeometry) {
        lastGeometry.dispose();
        lastGeometry = null;
      }
    }
  };
}

// src/modules/realistic-pcg/lighting/atmosphere-pipeline.ts
import * as THREE5 from "three";

// src/modules/realistic-pcg/lighting/procedural-ibl.ts
import * as THREE4 from "three";
var PROCEDURAL_LIGHTING_PRESETS = {
  OVERCAST_WET: {
    name: "OVERCAST_WET",
    zenithColor: "#4c5b6c",
    horizonColor: "#98a6b5",
    groundColor: "#222624",
    sunColor: "#e8eff5",
    sunDirection: [-0.72, 0.52, 0.46],
    sunIntensity: 2.15,
    hemiIntensity: 0.68,
    fogColor: "#84919e",
    fogDensity: 0.01,
    mieG: 0.72,
    mieStrength: 0.18,
    cloudDensity: 0.72,
    exposure: 1
  },
  GOLDEN_HOUR: {
    name: "GOLDEN_HOUR",
    zenithColor: "#2c4870",
    horizonColor: "#db8c54",
    groundColor: "#2a221c",
    sunColor: "#ffbe7d",
    sunDirection: [-0.82, 0.24, 0.52],
    sunIntensity: 3.1,
    hemiIntensity: 0.52,
    fogColor: "#b58463",
    fogDensity: 0.01,
    mieG: 0.84,
    mieStrength: 0.42,
    cloudDensity: 0.35,
    exposure: 1
  },
  NOON_CLEAR: {
    name: "NOON_CLEAR",
    zenithColor: "#2a62b5",
    horizonColor: "#9bc4e8",
    groundColor: "#2b2d26",
    sunColor: "#fff8ec",
    sunDirection: [0.35, 0.88, 0.32],
    sunIntensity: 3.6,
    hemiIntensity: 0.58,
    fogColor: "#9ab7cf",
    fogDensity: 65e-4,
    mieG: 0.78,
    mieStrength: 0.22,
    cloudDensity: 0.2,
    exposure: 1
  }
};
var SKY_VERT = `
varying vec3 vWorldDir;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWorldDir = normalize( position );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;
var SKY_FRAG = `
uniform vec3 uZenithColor;
uniform vec3 uHorizonColor;
uniform vec3 uGroundColor;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uMieG;
uniform float uMieStrength;
uniform float uCloudDensity;
uniform float uTime;

varying vec3 vWorldDir;

float hash21( vec2 p ) {
  p = fract( p * vec2( 127.1, 311.7 ) );
  p += dot( p, p + 34.23 );
  return fract( p.x * p.y );
}

float vnoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( hash21( i ), hash21( i + vec2( 1.0, 0.0 ) ), u.x ),
    mix( hash21( i + vec2( 0.0, 1.0 ) ), hash21( i + vec2( 1.0, 1.0 ) ), u.x ),
    u.y
  );
}

float fbmClouds( vec2 p ) {
  float v = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 4; i++ ) {
    v += a * vnoise( p );
    p *= 2.07;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 dir = normalize( vWorldDir );
  vec3 sunDir = normalize( uSunDir );

  // Rayleigh gradient + dark ground hemisphere bounce
  float up = clamp( dir.y, 0.0, 1.0 );
  float down = clamp( -dir.y, 0.0, 1.0 );
  vec3 skyCol = mix( uHorizonColor, uZenithColor, pow( up, 0.55 ) );
  skyCol = mix( skyCol, uGroundColor, pow( down, 0.45 ) );

  // Mie forward scattering + solar disc
  float cosTheta = max( 0.0, dot( dir, sunDir ) );
  float g2 = uMieG * uMieG;
  float mie = ( 1.0 - g2 ) / ( 4.0 * 3.14159 * pow( max( 0.01, 1.0 + g2 - 2.0 * uMieG * cosTheta ), 1.5 ) );
  float sunDisc = smoothstep( 0.9988, 0.9997, cosTheta ) * ( 1.0 - uCloudDensity * 0.75 );
  skyCol += uSunColor * ( mie * uMieStrength + sunDisc * 4.5 ) * smoothstep( -0.05, 0.15, dir.y );

  // Procedural cloud deck above horizon
  if ( dir.y > 0.02 && uCloudDensity > 0.01 ) {
    vec2 cloudUv = dir.xz / ( dir.y + 0.25 ) * 1.4 + vec2( uTime * 0.008, uTime * 0.004 );
    float c = fbmClouds( cloudUv );
    float cMask = smoothstep( 0.42 - uCloudDensity * 0.2, 0.78, c ) * smoothstep( 0.02, 0.22, dir.y );
    vec3 cloudShade = mix( uHorizonColor * 0.75, uZenithColor * 1.1 + uSunColor * 0.18, 0.6 );
    skyCol = mix( skyCol, cloudShade, cMask * uCloudDensity );
  }

  gl_FragColor = vec4( max( skyCol, vec3( 0.0 ) ), 1.0 );
}`;
function normalizeDir(v) {
  return new THREE4.Vector3(v[0], v[1], v[2]).normalize();
}
function createProceduralIBL(initialPreset = "OVERCAST_WET") {
  let currentPreset = PROCEDURAL_LIGHTING_PRESETS[initialPreset];
  const uniforms = {
    uZenithColor: { value: new THREE4.Color(currentPreset.zenithColor) },
    uHorizonColor: { value: new THREE4.Color(currentPreset.horizonColor) },
    uGroundColor: { value: new THREE4.Color(currentPreset.groundColor) },
    uSunColor: { value: new THREE4.Color(currentPreset.sunColor) },
    uSunDir: { value: normalizeDir(currentPreset.sunDirection) },
    uMieG: { value: currentPreset.mieG },
    uMieStrength: { value: currentPreset.mieStrength },
    uCloudDensity: { value: currentPreset.cloudDensity },
    uTime: { value: 0 }
  };
  const skyGeo = new THREE4.SphereGeometry(240, 32, 20);
  const skyMat = new THREE4.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE4.BackSide,
    depthWrite: false,
    toneMapped: false
  });
  const skyMesh = new THREE4.Mesh(skyGeo, skyMat);
  skyMesh.name = "ProceduralSkyDome";
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -10;
  let pmremGen = null;
  let envRenderTarget = null;
  let iblScene = null;
  let iblSkyMesh = null;
  function bakeEnvironment(renderer, targetScene) {
    if (!pmremGen) {
      pmremGen = new THREE4.PMREMGenerator(renderer);
    }
    if (!iblScene) {
      iblScene = new THREE4.Scene();
      iblSkyMesh = new THREE4.Mesh(skyGeo, skyMat);
      iblScene.add(iblSkyMesh);
    }
    if (envRenderTarget) {
      envRenderTarget.dispose();
      envRenderTarget = null;
    }
    envRenderTarget = pmremGen.fromScene(iblScene, 0.04, 0.5, 500);
    targetScene.environment = envRenderTarget.texture;
  }
  return {
    skyMesh,
    get environmentTexture() {
      return envRenderTarget?.texture ?? null;
    },
    getPreset() {
      return currentPreset;
    },
    setPreset(name, renderer, targetScene) {
      currentPreset = PROCEDURAL_LIGHTING_PRESETS[name];
      uniforms.uZenithColor.value.set(currentPreset.zenithColor);
      uniforms.uHorizonColor.value.set(currentPreset.horizonColor);
      uniforms.uGroundColor.value.set(currentPreset.groundColor);
      uniforms.uSunColor.value.set(currentPreset.sunColor);
      uniforms.uSunDir.value.copy(normalizeDir(currentPreset.sunDirection));
      uniforms.uMieG.value = currentPreset.mieG;
      uniforms.uMieStrength.value = currentPreset.mieStrength;
      uniforms.uCloudDensity.value = currentPreset.cloudDensity;
      bakeEnvironment(renderer, targetScene);
    },
    update(timeSec, cameraPos) {
      uniforms.uTime.value = timeSec;
      if (cameraPos) {
        skyMesh.position.copy(cameraPos);
      }
    },
    dispose() {
      if (envRenderTarget) {
        envRenderTarget.dispose();
        envRenderTarget = null;
      }
      if (pmremGen) {
        pmremGen.dispose();
        pmremGen = null;
      }
      skyGeo.dispose();
      skyMat.dispose();
      iblScene = null;
      iblSkyMesh = null;
    }
  };
}

// src/modules/realistic-pcg/lighting/atmosphere-pipeline.ts
function createAtmospherePipeline(renderer, scene, options = {}) {
  let qualityTier = options.quality ?? "HIGH";
  const extent = options.sceneHalfExtent ?? 22;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE5.PCFSoftShadowMap;
  renderer.toneMapping = THREE5.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  const ibl = createProceduralIBL(options.initialPreset ?? "OVERCAST_WET");
  scene.add(ibl.skyMesh);
  const sunLight = new THREE5.DirectionalLight("#ffffff", 2);
  sunLight.castShadow = true;
  sunLight.shadow.bias = -4e-4;
  sunLight.shadow.normalBias = 0.025;
  sunLight.shadow.camera.left = -extent;
  sunLight.shadow.camera.right = extent;
  sunLight.shadow.camera.top = extent;
  sunLight.shadow.camera.bottom = -extent;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 90;
  sunLight.shadow.camera.updateProjectionMatrix();
  scene.add(sunLight);
  scene.add(sunLight.target);
  const hemiLight = new THREE5.HemisphereLight("#8d99a6", "#222624", 0.65);
  scene.add(hemiLight);
  function applyShadowMapResolution(tier) {
    const preset = getQualityPreset(tier);
    sunLight.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    if (sunLight.shadow.map) {
      sunLight.shadow.map.dispose();
      sunLight.shadow.map = null;
    }
  }
  function applyPreset(name) {
    ibl.setPreset(name, renderer, scene);
    const p = ibl.getPreset();
    const dir = new THREE5.Vector3(p.sunDirection[0], p.sunDirection[1], p.sunDirection[2]).normalize();
    sunLight.position.copy(dir.multiplyScalar(36));
    sunLight.target.position.set(0, 0, 0);
    sunLight.color.set(p.sunColor);
    sunLight.intensity = p.sunIntensity;
    hemiLight.color.set(p.horizonColor);
    hemiLight.groundColor.set(p.groundColor);
    hemiLight.intensity = p.hemiIntensity;
    scene.fog = new THREE5.FogExp2(p.fogColor, p.fogDensity);
    renderer.toneMappingExposure = p.exposure;
  }
  applyShadowMapResolution(qualityTier);
  applyPreset(options.initialPreset ?? "OVERCAST_WET");
  return {
    sunLight,
    hemiLight,
    ibl,
    setPreset: applyPreset,
    setQuality(tier) {
      if (tier === qualityTier) return;
      qualityTier = tier;
      applyShadowMapResolution(tier);
    },
    update(timeSec, cameraPos) {
      ibl.update(timeSec, cameraPos);
    },
    dispose() {
      scene.remove(ibl.skyMesh);
      scene.remove(sunLight);
      scene.remove(sunLight.target);
      scene.remove(hemiLight);
      if (sunLight.shadow.map) {
        sunLight.shadow.map.dispose();
        sunLight.shadow.map = null;
      }
      scene.environment = null;
      scene.fog = null;
      ibl.dispose();
    }
  };
}

// src/modules/realistic-pcg/materials/world-pbr-shader.ts
import * as THREE6 from "three";
var MAX_MATERIAL_SLOTS = 16;
function biomeModeToInt(mode) {
  if (mode === "desert_dust") return 1;
  if (mode === "clean_indoor") return 2;
  return 0;
}
function buildTileMetersArray(texArray) {
  const arr = new Array(MAX_MATERIAL_SLOTS).fill(1);
  const src = texArray.tileMetersById;
  const n = Math.min(MAX_MATERIAL_SLOTS, src.length);
  for (let i = 0; i < n; i++) {
    arr[i] = src[i] > 0.01 ? src[i] : 1;
  }
  return arr;
}
function createWorldPbrMaterial(options) {
  const useTriplanar = Boolean(options.useTriplanar);
  const tileMeters = buildTileMetersArray(options.textureArray);
  const uniforms = {
    uAlbedoArray: { value: options.textureArray.albedoArray },
    uNormalArray: { value: options.textureArray.normalArray },
    uOrmArray: { value: options.textureArray.ormArray },
    uTileMeters: { value: tileMeters },
    uGlobalWetness: { value: options.globalWetness ?? 0.45 },
    uGroundHeight: { value: options.groundHeight ?? 0 },
    uNormalStrength: { value: options.normalStrength ?? 1 },
    uMacroStrength: { value: options.macroStrength ?? 0.14 },
    uBiomeMode: { value: biomeModeToInt(options.biomeMode ?? "wet_moss") },
    uBiomeStrength: { value: options.biomeStrength ?? 1 },
    uTime: { value: 0 }
  };
  const material = new THREE6.MeshStandardMaterial({
    color: 16777215,
    roughness: 1,
    metalness: 1,
    vertexColors: true,
    envMapIntensity: options.envMapIntensity ?? 1
  });
  material.customProgramCacheKey = () => useTriplanar ? "hgame-world-pbr-triplanar-v2" : "hgame-world-pbr-metric-v2";
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (useTriplanar) {
      shader.fragmentShader = "#define HG_USE_TRIPLANAR 1\n" + shader.fragmentShader;
    }
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
attribute float aMaterialId;
varying float vPcgMatId;
varying vec2 vPcgUv;
varying vec3 vPcgWorldPos;
varying vec3 vPcgWorldNormal;
#ifdef USE_INSTANCING
  attribute vec4 aInstanceMeta;
  varying vec4 vPcgInstanceMeta;
#endif`
    ).replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>
vPcgUv = uv;
vPcgMatId = aMaterialId;
#ifdef USE_INSTANCING
  vPcgInstanceMeta = aInstanceMeta;
#endif`
    ).replace(
      "#include <project_vertex>",
      `#include <project_vertex>
vec4 pcgWorld = vec4( transformed, 1.0 );
vec3 pcgWNormal = objectNormal;
#ifdef USE_INSTANCING
  pcgWorld = instanceMatrix * pcgWorld;
  pcgWNormal = mat3( instanceMatrix ) * pcgWNormal;
#endif
pcgWorld = modelMatrix * pcgWorld;
vPcgWorldPos = pcgWorld.xyz;
vPcgWorldNormal = normalize( mat3( modelMatrix ) * pcgWNormal );`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
uniform highp sampler2DArray uAlbedoArray;
uniform highp sampler2DArray uNormalArray;
uniform highp sampler2DArray uOrmArray;
uniform float uTileMeters[${MAX_MATERIAL_SLOTS}];
uniform float uGlobalWetness;
uniform float uGroundHeight;
uniform float uNormalStrength;
uniform float uMacroStrength;
uniform int uBiomeMode;
uniform float uBiomeStrength;
uniform float uTime;

varying float vPcgMatId;
varying vec2 vPcgUv;
varying vec3 vPcgWorldPos;
varying vec3 vPcgWorldNormal;
#ifdef USE_INSTANCING
  varying vec4 vPcgInstanceMeta;
#endif

float pcgHash21( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}

float pcgNoise2( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  float a = pcgHash21( i );
  float b = pcgHash21( i + vec2( 1.0, 0.0 ) );
  float c = pcgHash21( i + vec2( 0.0, 1.0 ) );
  float d = pcgHash21( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}

// Raindrop concentric ripples on standing puddles (inspired by saltline ground shader)
vec2 pcgRainRipple( vec2 xz, float t ) {
  vec2 cell = floor( xz * 1.35 );
  vec2 f = fract( xz * 1.35 ) - 0.5;
  float rnd = pcgHash21( cell );
  float phase = fract( t * 0.65 + rnd );
  vec2 center = vec2( pcgHash21( cell + 3.1 ), pcgHash21( cell + 7.9 ) ) - 0.5;
  vec2 d = f - center * 0.45;
  float dist = length( d );
  float ring = sin( ( dist - phase * 0.48 ) * 46.0 ) * exp( -dist * 9.0 ) * ( 1.0 - phase );
  float env = smoothstep( 0.48, 0.05, dist );
  return normalize( d + 1e-4 ) * ring * env * 0.045;
}

mat3 pcgTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
  vec3 q0 = dFdx( eye_pos.xyz );
  vec3 q1 = dFdy( eye_pos.xyz );
  vec2 st0 = dFdx( uv.st );
  vec2 st1 = dFdy( uv.st );
  vec3 N = surf_norm;
  vec3 q1perp = cross( q1, N );
  vec3 q0perp = cross( N, q0 );
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max( dot( T, T ), dot( B, B ) );
  float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
  return mat3( T * scale, B * scale, N );
}`
    ).replace(
      "#include <color_fragment>",
      `// Vertex color carries packed PBR metadata: R=GeomAO, G=EdgeWear, B=LocalWetness
int pcgLayerIdx = clamp( int( floor( vPcgMatId + 0.5 ) ), 0, ${MAX_MATERIAL_SLOTS - 1} );
float pcgLayerF = float( pcgLayerIdx );
float pcgTile = max( 0.01, uTileMeters[ pcgLayerIdx ] );
vec2 pcgSampleUv = vPcgUv / pcgTile;

#ifdef HG_USE_TRIPLANAR
  vec3 pcgBlendW = pow( abs( normalize( vPcgWorldNormal ) ), vec3( 6.0 ) );
  pcgBlendW /= max( 1e-4, pcgBlendW.x + pcgBlendW.y + pcgBlendW.z );
  vec2 pcgUvX = vPcgWorldPos.zy / pcgTile;
  vec2 pcgUvY = vPcgWorldPos.xz / pcgTile;
  vec2 pcgUvZ = vPcgWorldPos.xy / pcgTile;
  vec4 pcgAlb = texture( uAlbedoArray, vec3( pcgUvX, pcgLayerF ) ) * pcgBlendW.x
              + texture( uAlbedoArray, vec3( pcgUvY, pcgLayerF ) ) * pcgBlendW.y
              + texture( uAlbedoArray, vec3( pcgUvZ, pcgLayerF ) ) * pcgBlendW.z;
  vec3 pcgNrm = texture( uNormalArray, vec3( pcgUvX, pcgLayerF ) ).xyz * pcgBlendW.x
              + texture( uNormalArray, vec3( pcgUvY, pcgLayerF ) ).xyz * pcgBlendW.y
              + texture( uNormalArray, vec3( pcgUvZ, pcgLayerF ) ).xyz * pcgBlendW.z;
  vec4 pcgOrm = texture( uOrmArray, vec3( pcgUvX, pcgLayerF ) ) * pcgBlendW.x
              + texture( uOrmArray, vec3( pcgUvY, pcgLayerF ) ) * pcgBlendW.y
              + texture( uOrmArray, vec3( pcgUvZ, pcgLayerF ) ) * pcgBlendW.z;
#else
  vec4 pcgAlb = texture( uAlbedoArray, vec3( pcgSampleUv, pcgLayerF ) );
  vec3 pcgNrm = texture( uNormalArray, vec3( pcgSampleUv, pcgLayerF ) ).xyz;
  vec4 pcgOrm = texture( uOrmArray, vec3( pcgSampleUv, pcgLayerF ) );
#endif

vec3 pcgAlbedo = pcgAlb.rgb;
float pcgHeight = pcgAlb.a;
float pcgTexAO = pcgOrm.r;
float pcgRoughness = pcgOrm.g;
float pcgMetalness = pcgOrm.b;
float pcgPorosity = pcgOrm.a;

float pcgGeomAO = 1.0;
float pcgEdgeWear = 0.0;
float pcgLocalWet = 0.0;
#ifdef USE_COLOR
  pcgGeomAO = clamp( vColor.r, 0.2, 1.0 );
  pcgEdgeWear = clamp( vColor.g, 0.0, 1.0 );
  pcgLocalWet = clamp( vColor.b, 0.0, 1.0 );
#endif

float pcgInstSeed = 0.0;
#ifdef USE_INSTANCING
  pcgAlbedo *= ( 1.0 + clamp( vPcgInstanceMeta.x, -0.35, 0.35 ) );
  pcgEdgeWear = clamp( pcgEdgeWear + vPcgInstanceMeta.y * 0.4, 0.0, 1.0 );
  pcgLocalWet = clamp( pcgLocalWet + vPcgInstanceMeta.z, 0.0, 1.0 );
  pcgInstSeed = vPcgInstanceMeta.w;
#endif

// 1. Macro world-space variation (8m + 24m)
vec2 pcgMacroSeedOff = vec2( pcgInstSeed * 17.3, pcgInstSeed * 9.7 );
float pcgMacro8 = pcgNoise2( vPcgWorldPos.xz * 0.125 + pcgMacroSeedOff );
float pcgMacro24 = pcgNoise2( vPcgWorldPos.xz * 0.0416667 + vec2( 7.3, 19.1 ) + pcgMacroSeedOff );
float pcgMacroVar = ( pcgMacro8 * 0.65 + pcgMacro24 * 0.35 ) * 2.0 - 1.0;
pcgAlbedo *= ( 1.0 + pcgMacroVar * uMacroStrength );

vec3 pcgWorldN = normalize( vPcgWorldNormal );
float pcgPuddleMask = 0.0;

if ( uBiomeMode == 0 ) {
  // ---- BIOME 0: wet_moss (rain dampness, standing puddles, moss & ground mud) ----
  float pcgWetness = clamp( ( uGlobalWetness * 0.85 + pcgLocalWet * 0.85 ) * uBiomeStrength, 0.0, 1.0 );
  pcgAlbedo *= mix( 1.0, 1.0 - pcgPorosity * 0.42, pcgWetness );
  pcgRoughness = mix( pcgRoughness, max( 0.16, pcgRoughness * ( 1.0 - pcgPorosity * 0.48 ) ), pcgWetness );

  float pcgPuddleNoise = pcgNoise2( vPcgWorldPos.xz * 0.32 + vec2( 3.1, 5.7 ) );
  float pcgUpFlat = smoothstep( 0.85, 0.96, pcgWorldN.y );
  float pcgPuddleDriver = clamp( uGlobalWetness * 0.55 + pcgLocalWet * 0.95, 0.0, 1.3 );
  pcgPuddleMask = smoothstep( 0.42, 0.64, pcgPuddleNoise * 0.35 + pcgLocalWet * 0.85 )
                * pcgUpFlat
                * smoothstep( 0.30, 0.68, pcgPuddleDriver )
                * uBiomeStrength;
  pcgAlbedo = mix( pcgAlbedo, pcgAlbedo * 0.40, pcgPuddleMask * 0.88 );
  pcgRoughness = mix( pcgRoughness, 0.04, pcgPuddleMask );

  float pcgMossNoise = pcgNoise2( vPcgWorldPos.xz * 0.45 + vec2( 11.4, 2.8 ) );
  float pcgUpMask = smoothstep( 0.60, 0.88, pcgWorldN.y );
  float pcgMossMask = pcgUpMask * smoothstep( 0.52, 0.82, pcgMossNoise * 0.7 + ( 1.0 - pcgHeight ) * 0.35 ) * ( 1.0 - pcgPuddleMask ) * ( 1.0 - pcgMetalness ) * uBiomeStrength;
  vec3 pcgMossCol = vec3( 0.055, 0.085, 0.035 );
  pcgAlbedo = mix( pcgAlbedo, pcgMossCol, pcgMossMask * 0.40 );
  pcgRoughness = mix( pcgRoughness, 0.92, pcgMossMask * 0.35 );

  float pcgGroundProx = 1.0 - smoothstep( uGroundHeight, uGroundHeight + 0.6, vPcgWorldPos.y );
  float pcgGrimeMask = pcgGroundProx * ( 0.55 + 0.45 * pcgMacro8 ) * uBiomeStrength;
  pcgAlbedo = mix( pcgAlbedo, pcgAlbedo * 0.68, pcgGrimeMask * 0.65 );
  pcgRoughness = mix( pcgRoughness, 0.86, pcgGrimeMask * 0.25 );
} else if ( uBiomeMode == 1 ) {
  // ---- BIOME 1: desert_dust (inspired by worm-rider shared sand/dust PBR overlay) ----
  float pcgDustNoise = pcgNoise2( vPcgWorldPos.xz * 0.22 + vec2( 5.1, 8.7 ) );
  float pcgStreak = pcgNoise2( vec2( ( abs( pcgWorldN.x ) > abs( pcgWorldN.z ) ? vPcgWorldPos.z : vPcgWorldPos.x ) * 0.9, vPcgWorldPos.y * 0.35 ) );
  float pcgDustStreak = mix( 1.0, 0.6 + 0.8 * pcgStreak, 1.0 - abs( pcgWorldN.y ) );
  float pcgUpDust = smoothstep( 0.45, 0.96, pcgWorldN.y ) * 0.72;
  float pcgLowDust = ( 1.0 - smoothstep( uGroundHeight, uGroundHeight + 1.4, vPcgWorldPos.y ) ) * 0.65;
  float pcgDustMask = clamp( ( max( pcgUpDust, pcgLowDust ) + 0.08 ) * ( 0.22 + 1.9 * pcgDustNoise * pcgDustNoise ) * pcgDustStreak * uBiomeStrength, 0.0, 0.92 );
  vec3 pcgDustCol = vec3( 0.43, 0.23, 0.11 ) * ( 0.82 + 0.36 * pcgMacro8 );
  pcgAlbedo = mix( pcgAlbedo, pcgDustCol, pcgDustMask );
  pcgRoughness = mix( pcgRoughness, 0.95, pcgDustMask );
  pcgMetalness *= ( 1.0 - pcgDustMask );
} else {
  // ---- BIOME 2: clean_indoor (architectural dry interior, minimal contact shadow grime) ----
  float pcgGroundProx = 1.0 - smoothstep( uGroundHeight, uGroundHeight + 0.25, vPcgWorldPos.y );
  pcgAlbedo *= ( 1.0 - pcgGroundProx * 0.08 * uBiomeStrength );
}

// 3. Edge wear highlight
pcgAlbedo *= ( 1.0 + pcgEdgeWear * 0.13 );
pcgRoughness = clamp( pcgRoughness - pcgEdgeWear * 0.14, 0.04, 0.98 );

diffuseColor.rgb = clamp( pcgAlbedo, 0.01, 0.96 );`
    ).replace(
      "#include <roughnessmap_fragment>",
      `float roughnessFactor = clamp( pcgRoughness, 0.04, 0.98 );`
    ).replace(
      "#include <metalnessmap_fragment>",
      `float metalnessFactor = clamp( pcgMetalness, 0.0, 1.0 );`
    ).replace(
      "#include <normal_fragment_maps>",
      `vec3 pcgMapN = pcgNrm * 2.0 - 1.0;
pcgMapN.xy *= uNormalStrength;
mat3 pcgTbn = pcgTangentFrame( -vViewPosition, normal, pcgSampleUv );
normal = normalize( pcgTbn * pcgMapN );
if ( pcgPuddleMask > 0.001 ) {
  vec2 pcgRip = pcgRainRipple( vPcgWorldPos.xz, uTime ) * smoothstep( 0.2, 0.9, uGlobalWetness );
  vec3 pcgRipWorld = normalize( vec3( pcgRip.x, 1.0, pcgRip.y ) );
  vec3 pcgViewUp = normalize( ( viewMatrix * vec4( pcgRipWorld, 0.0 ) ).xyz );
  normal = normalize( mix( normal, pcgViewUp, pcgPuddleMask * 0.94 ) );
}`
    ).replace(
      "#include <aomap_fragment>",
      `#include <aomap_fragment>
float pcgTotalAO = clamp( pcgTexAO * pcgGeomAO, 0.15, 1.0 );
reflectedLight.indirectDiffuse *= pcgTotalAO;
#if defined( USE_ENVMAP ) && defined( STANDARD )
  float pcgDotNV = saturate( dot( geometryNormal, geometryViewDir ) );
  reflectedLight.indirectSpecular *= computeSpecularOcclusion( pcgDotNV, pcgTotalAO, material.roughness );
#endif`
    );
  };
  return {
    material,
    setWetness(wetness) {
      uniforms.uGlobalWetness.value = Math.max(0, Math.min(1, wetness));
    },
    setGroundHeight(height) {
      uniforms.uGroundHeight.value = height;
    },
    setNormalStrength(strength) {
      uniforms.uNormalStrength.value = Math.max(0, strength);
    },
    setBiomeMode(mode) {
      uniforms.uBiomeMode.value = biomeModeToInt(mode);
    },
    setBiomeStrength(strength) {
      uniforms.uBiomeStrength.value = Math.max(0, Math.min(1, strength));
    },
    setTime(timeSec) {
      uniforms.uTime.value = timeSec;
    },
    syncTextureArray(texArray) {
      uniforms.uAlbedoArray.value = texArray.albedoArray;
      uniforms.uNormalArray.value = texArray.normalArray;
      uniforms.uOrmArray.value = texArray.ormArray;
      const updated = buildTileMetersArray(texArray);
      for (let i = 0; i < MAX_MATERIAL_SLOTS; i++) {
        uniforms.uTileMeters.value[i] = updated[i];
      }
    },
    dispose() {
      material.dispose();
    }
  };
}

// src/modules/realistic-pcg/materials/texture-array-baker.ts
import * as THREE8 from "three";

// src/modules/realistic-pcg/core/prng.ts
function hash2i(ix, iy, seed) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(seed | 0, 1442695041) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return (h ^ h >>> 16) >>> 0;
}
function hash3i(ix, iy, iz, seed) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(iz | 0, 2147483647) + Math.imul(seed | 0, 1442695041) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return (h ^ h >>> 16) >>> 0;
}
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function grad2Dot(hash, dx, dy) {
  switch (hash & 7) {
    case 0:
      return dx + dy;
    case 1:
      return -dx + dy;
    case 2:
      return dx - dy;
    case 3:
      return -dx - dy;
    case 4:
      return dx;
    case 5:
      return -dx;
    case 6:
      return dy;
    default:
      return -dy;
  }
}
function wrapInt(i, period) {
  const r = i % period;
  return r < 0 ? r + period : r;
}
function perlin2DPeriodic(u, v, periodX, periodY, seed) {
  const px = periodX < 1 ? 1 : periodX + 0.5 | 0;
  const py = periodY < 1 ? 1 : periodY + 0.5 | 0;
  const x = u * px;
  const y = v * py;
  const x0 = x >= 0 ? x | 0 : Math.floor(x);
  const y0 = y >= 0 ? y | 0 : Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const wx0 = wrapInt(x0, px);
  const wy0 = wrapInt(y0, py);
  const wx1 = wx0 + 1 >= px ? 0 : wx0 + 1;
  const wy1 = wy0 + 1 >= py ? 0 : wy0 + 1;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const n00 = grad2Dot(hash2i(wx0, wy0, seed), fx, fy);
  const n10 = grad2Dot(hash2i(wx1, wy0, seed), fx - 1, fy);
  const n01 = grad2Dot(hash2i(wx0, wy1, seed), fx, fy - 1);
  const n11 = grad2Dot(hash2i(wx1, wy1, seed), fx - 1, fy - 1);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}
function fillFbm2DRows(out, size, yStart, yEnd, scale, octaves, persistence, lacunarity, seed) {
  const invSize = 1 / size;
  const baseFreq = Math.max(1, Math.round(scale));
  const lac = Math.max(1, Math.round(lacunarity));
  const octFreqs = new Int32Array(octaves);
  const octAmps = new Float32Array(octaves);
  const octSeeds = new Int32Array(octaves);
  let maxAmp = 0;
  let amp = 1;
  let freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    octFreqs[o] = freq;
    octAmps[o] = amp;
    octSeeds[o] = seed + o * 1013 | 0;
    maxAmp += amp;
    amp *= persistence;
    freq *= lac;
  }
  const invMaxAmp = maxAmp > 0 ? 0.5 / maxAmp : 0;
  for (let y = yStart; y < yEnd; y++) {
    const v = (y + 0.5) * invSize;
    const rowOff = y * size;
    out.fill(0, rowOff, rowOff + size);
    for (let o = 0; o < octaves; o++) {
      const p = octFreqs[o];
      const oAmp = octAmps[o];
      const oSeed = octSeeds[o];
      const py = v * p;
      const y0 = py | 0;
      const fy = py - y0;
      const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
      const wy0 = y0 % p;
      const wy1 = wy0 + 1 >= p ? 0 : wy0 + 1;
      const ySeed0 = Math.imul(wy0, 668265263) + Math.imul(oSeed, 1442695041) | 0;
      const ySeed1 = Math.imul(wy1, 668265263) + Math.imul(oSeed, 1442695041) | 0;
      for (let x = 0; x < size; x++) {
        const px = (x + 0.5) * invSize * p;
        const x0 = px | 0;
        const fx = px - x0;
        const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
        const wx0 = x0 % p;
        const wx1 = wx0 + 1 >= p ? 0 : wx0 + 1;
        const xMul0 = Math.imul(wx0, 374761393);
        const xMul1 = Math.imul(wx1, 374761393);
        let h00 = xMul0 + ySeed0 | 0;
        h00 = Math.imul(h00 ^ h00 >>> 13, 1274126177);
        h00 ^= h00 >>> 16;
        let h10 = xMul1 + ySeed0 | 0;
        h10 = Math.imul(h10 ^ h10 >>> 13, 1274126177);
        h10 ^= h10 >>> 16;
        let h01 = xMul0 + ySeed1 | 0;
        h01 = Math.imul(h01 ^ h01 >>> 13, 1274126177);
        h01 ^= h01 >>> 16;
        let h11 = xMul1 + ySeed1 | 0;
        h11 = Math.imul(h11 ^ h11 >>> 13, 1274126177);
        h11 ^= h11 >>> 16;
        const n00 = grad2Dot(h00, fx, fy);
        const n10 = grad2Dot(h10, fx - 1, fy);
        const n01 = grad2Dot(h01, fx, fy - 1);
        const n11 = grad2Dot(h11, fx - 1, fy - 1);
        const nx0 = n00 + (n10 - n00) * sx;
        const nx1 = n01 + (n11 - n01) * sx;
        out[rowOff + x] += (nx0 + (nx1 - nx0) * sy) * oAmp;
      }
    }
    for (let x = 0; x < size; x++) {
      const val = out[rowOff + x] * invMaxAmp + 0.5;
      out[rowOff + x] = val < 0 ? 0 : val > 1 ? 1 : val;
    }
  }
}
function fbm2DPeriodic(u, v, scale, octaves, persistence, lacunarity, seed) {
  let sum = 0;
  let amp = 1;
  let maxAmp = 0;
  let freq = Math.max(1, Math.round(scale));
  const lac = Math.max(1, Math.round(lacunarity));
  for (let o = 0; o < octaves; o++) {
    sum += perlin2DPeriodic(u, v, freq, freq, seed + o * 1013 | 0) * amp;
    maxAmp += amp;
    amp *= persistence;
    freq *= lac;
  }
  const normalized = maxAmp > 0 ? sum / maxAmp : 0;
  return Math.max(0, Math.min(1, normalized * 0.5 + 0.5));
}
function worley2DPeriodic(u, v, scale, jitter, seed, out = { f1: 0, f2: 0, f2MinusF1: 0, cellRand: 0 }) {
  const period = Math.max(1, Math.round(scale));
  const x = u * period;
  const y = v * period;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const fx = x - cx;
  const fy = y - cy;
  let f1Sq = 1e9;
  let f2Sq = 1e9;
  let bestHash = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const wy = wrapInt(cy + dy, period);
    for (let dx = -1; dx <= 1; dx++) {
      const wx = wrapInt(cx + dx, period);
      const h1 = hash2i(wx, wy, seed);
      const h2 = hash2i(wx, wy, seed + 7919 | 0);
      const jx = ((h1 & 65535) / 65535 - 0.5) * jitter + 0.5;
      const jy = ((h2 & 65535) / 65535 - 0.5) * jitter + 0.5;
      const px = dx + jx - fx;
      const py = dy + jy - fy;
      const dSq = px * px + py * py;
      if (dSq < f1Sq) {
        f2Sq = f1Sq;
        f1Sq = dSq;
        bestHash = h1;
      } else if (dSq < f2Sq) {
        f2Sq = dSq;
      }
    }
  }
  const f1 = Math.min(1, Math.sqrt(f1Sq));
  const f2 = Math.min(1.414, Math.sqrt(f2Sq));
  out.f1 = f1;
  out.f2 = Math.min(1, f2);
  out.f2MinusF1 = Math.max(0, Math.min(1, f2 - f1));
  out.cellRand = (bestHash >>> 16 & 65535) / 65535;
  return out;
}
var GRAD3 = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1]
];
function grad3Dot(hash, dx, dy, dz) {
  const g = GRAD3[hash % 12];
  return g[0] * dx + g[1] * dy + g[2] * dz;
}
function noise3D(x, y, z, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const sx = fade(fx);
  const sy = fade(fy);
  const sz = fade(fz);
  const n000 = grad3Dot(hash3i(x0, y0, z0, seed), fx, fy, fz);
  const n100 = grad3Dot(hash3i(x0 + 1, y0, z0, seed), fx - 1, fy, fz);
  const n010 = grad3Dot(hash3i(x0, y0 + 1, z0, seed), fx, fy - 1, fz);
  const n110 = grad3Dot(hash3i(x0 + 1, y0 + 1, z0, seed), fx - 1, fy - 1, fz);
  const n001 = grad3Dot(hash3i(x0, y0, z0 + 1, seed), fx, fy, fz - 1);
  const n101 = grad3Dot(hash3i(x0 + 1, y0, z0 + 1, seed), fx - 1, fy, fz - 1);
  const n011 = grad3Dot(hash3i(x0, y0 + 1, z0 + 1, seed), fx, fy - 1, fz - 1);
  const n111 = grad3Dot(hash3i(x0 + 1, y0 + 1, z0 + 1, seed), fx - 1, fy - 1, fz - 1);
  const nx00 = lerp(n000, n100, sx);
  const nx10 = lerp(n010, n110, sx);
  const nx01 = lerp(n001, n101, sx);
  const nx11 = lerp(n011, n111, sx);
  return lerp(lerp(nx00, nx10, sy), lerp(nx01, nx11, sy), sz);
}
function fbm3D(x, y, z, octaves, persistence, lacunarity, seed) {
  let sum = 0;
  let amp = 1;
  let maxAmp = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise3D(x * freq, y * freq, z * freq, seed + o * 2029 | 0) * amp;
    maxAmp += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return maxAmp > 0 ? sum / maxAmp : 0;
}

// src/modules/realistic-pcg/core/safe-expr.ts
function tokenize(input) {
  const tokens = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i];
    if (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ kind: "op", op: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (ch === "$") {
      i++;
      const start = i;
      while (i < n && /[A-Za-z0-9_]/.test(input[i])) i++;
      if (i === start) {
        throw new Error(`Invalid parameter reference '$' at position ${start - 1} in "${input}"`);
      }
      tokens.push({ kind: "var", name: input.slice(start, i) });
      continue;
    }
    if (ch >= "0" && ch <= "9" || ch === ".") {
      const start = i;
      let dotCount = ch === "." ? 1 : 0;
      i++;
      while (i < n) {
        const c = input[i];
        if (c >= "0" && c <= "9") {
          i++;
        } else if (c === "." && dotCount === 0) {
          dotCount = 1;
          i++;
        } else {
          break;
        }
      }
      const numStr = input.slice(start, i);
      const val = Number(numStr);
      if (!Number.isFinite(val)) {
        throw new Error(`Invalid number literal "${numStr}" in "${input}"`);
      }
      tokens.push({ kind: "num", value: val });
      continue;
    }
    throw new Error(`Unexpected character "${ch}" at position ${i} in "${input}"`);
  }
  return tokens;
}
function extractExprParamRefs(exprText) {
  const body = exprText.startsWith("expr:") ? exprText.slice(5) : exprText;
  const tokens = tokenize(body);
  const refs = /* @__PURE__ */ new Set();
  for (const t of tokens) {
    if (t.kind === "var") refs.add(t.name);
  }
  return [...refs];
}
function evaluateSafeExpr(exprText, params2 = {}) {
  const body = exprText.startsWith("expr:") ? exprText.slice(5) : exprText;
  const tokens = tokenize(body);
  if (tokens.length === 0) {
    throw new Error(`Empty expression "${exprText}"`);
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];
  function parseExpression() {
    let left = parseTerm();
    while (true) {
      const t = peek();
      if (t && t.kind === "op" && (t.op === "+" || t.op === "-")) {
        consume();
        const right = parseTerm();
        left = t.op === "+" ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  }
  function parseTerm() {
    let left = parseUnary();
    while (true) {
      const t = peek();
      if (t && t.kind === "op" && (t.op === "*" || t.op === "/")) {
        consume();
        const right = parseUnary();
        if (t.op === "/") {
          if (right === 0) throw new Error(`Division by zero in expression "${exprText}"`);
          left = left / right;
        } else {
          left = left * right;
        }
      } else {
        break;
      }
    }
    return left;
  }
  function parseUnary() {
    const t = peek();
    if (t && t.kind === "op" && (t.op === "+" || t.op === "-")) {
      consume();
      const val = parseUnary();
      return t.op === "-" ? -val : val;
    }
    return parsePrimary();
  }
  function parsePrimary() {
    const t = consume();
    if (!t) {
      throw new Error(`Unexpected end of expression "${exprText}"`);
    }
    if (t.kind === "num") return t.value;
    if (t.kind === "var") {
      if (!(t.name in params2)) {
        throw new Error(`Missing parameter "$${t.name}" in expression "${exprText}"`);
      }
      const v = params2[t.name];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new Error(`Parameter "$${t.name}" must be a finite number (got ${typeof v})`);
      }
      return v;
    }
    if (t.kind === "lparen") {
      const val = parseExpression();
      const close = consume();
      if (!close || close.kind !== "rparen") {
        throw new Error(`Missing closing parenthesis in expression "${exprText}"`);
      }
      return val;
    }
    throw new Error(`Unexpected token in expression "${exprText}"`);
  }
  const result = parseExpression();
  if (pos < tokens.length) {
    throw new Error(`Trailing tokens in expression "${exprText}"`);
  }
  if (!Number.isFinite(result)) {
    throw new Error(`Non-finite expression result in "${exprText}"`);
  }
  return result;
}
function resolveParamValue(raw, params2 = {}) {
  if (typeof raw === "string") {
    if (raw.startsWith("expr:")) {
      return evaluateSafeExpr(raw, params2);
    }
    if (raw.startsWith("$")) {
      const key = raw.slice(1);
      if (!(key in params2)) {
        throw new Error(`Missing parameter "${raw}"`);
      }
      return params2[key];
    }
  }
  return raw;
}
function resolveNumber(raw, params2 = {}, fallback) {
  if (raw === void 0 && fallback !== void 0) return fallback;
  const v = resolveParamValue(raw, params2);
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`Expected finite numeric value, got ${JSON.stringify(raw)} -> ${String(v)}`);
  }
  return v;
}
function resolveBoolean(raw, params2 = {}, fallback = false) {
  if (raw === void 0) return fallback;
  if (typeof raw === "string" && raw.startsWith("!")) {
    return !resolveBoolean(raw.slice(1).trim(), params2, !fallback);
  }
  const v = resolveParamValue(raw, params2);
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  throw new Error(`Expected boolean value, got ${JSON.stringify(raw)}`);
}
function resolveVec3(raw, params2 = {}, fallback = [0, 0, 0]) {
  if (raw === void 0) return fallback;
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw new Error(`Expected 3-element vector, got ${JSON.stringify(raw)}`);
  }
  return [
    resolveNumber(raw[0], params2),
    resolveNumber(raw[1], params2),
    resolveNumber(raw[2], params2)
  ];
}

// src/modules/realistic-pcg/recipes/schema-validator.ts
var VALID_MAT_OPS = /* @__PURE__ */ new Set([
  "fbm",
  "worley",
  "brick_pattern",
  "wood_grain",
  "plank_pattern",
  "stripes",
  "speckle",
  "corrugated_wave",
  "edge_wear_mask",
  "vertical_streak",
  "rivet_grid",
  "sand_ripples",
  "fabric_weave",
  "remap",
  "clamp",
  "invert",
  "power",
  "domain_warp",
  "blur",
  "height_to_normal",
  "blend",
  "mix_scalar",
  "mix_color",
  "color_ramp"
]);
var VALID_MESH_OPS = /* @__PURE__ */ new Set([
  "beveled_box",
  "beveled_wall_opening",
  "cylinder",
  "stairs",
  "displaced_rock",
  "extrude_profile",
  "corrugated_panel",
  "pipe_segment",
  "ref"
]);
var HEX_COLOR_RE = /^#([0-9a-fA-F]{6})$/;
function parseHexColor(hex) {
  const m = HEX_COLOR_RE.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
function srgbChannelToLinear(c8) {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function hexLinearLuminance(hex) {
  const rgb = parseHexColor(hex);
  if (!rgb) return null;
  const r = srgbChannelToLinear(rgb[0]);
  const g = srgbChannelToLinear(rgb[1]);
  const b = srgbChannelToLinear(rgb[2]);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function collectParamAndExprIssues(value, params2, recipeId, fieldPath, issues) {
  if (typeof value === "string") {
    const trimmed = value.startsWith("!") ? value.slice(1).trim() : value;
    if (trimmed.startsWith("expr:")) {
      try {
        const refs = extractExprParamRefs(trimmed);
        for (const r of refs) {
          if (!(r in params2)) {
            issues.push({
              severity: "error",
              recipeId,
              path: fieldPath,
              message: `Unknown parameter "$${r}" in expression "${value}"`
            });
          }
        }
      } catch (err) {
        issues.push({
          severity: "error",
          recipeId,
          path: fieldPath,
          message: err instanceof Error ? err.message : String(err)
        });
      }
    } else if (trimmed.startsWith("$")) {
      const name = trimmed.slice(1);
      if (!(name in params2)) {
        issues.push({
          severity: "error",
          recipeId,
          path: fieldPath,
          message: `Unknown parameter reference "${value}"`
        });
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(
      (v, idx) => collectParamAndExprIssues(v, params2, recipeId, `${fieldPath}[${idx}]`, issues)
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      collectParamAndExprIssues(v, params2, recipeId, `${fieldPath}.${k}`, issues);
    }
  }
}
function isNodeRefString(s) {
  return !s.startsWith("#") && !s.startsWith("$") && !s.startsWith("expr:");
}
function collectNodeDeps(args, nodeIds, recipeId, fieldPath, issues) {
  const deps = [];
  const checkRef = (val, subPath) => {
    if (typeof val !== "string" || !isNodeRefString(val)) return;
    const baseId = val.split(".")[0];
    if (!nodeIds.has(baseId)) {
      issues.push({
        severity: "error",
        recipeId,
        path: subPath,
        message: `Unknown node reference "${val}"`
      });
    } else {
      deps.push(baseId);
    }
  };
  for (const key of ["input", "a", "b", "mask", "warpX", "warpY"]) {
    if (key in args) checkRef(args[key], `${fieldPath}.${key}`);
  }
  return deps;
}
function validateMaterialRecipe(raw) {
  const issues = [];
  if (!raw || typeof raw !== "object") {
    issues.push({ severity: "error", recipeId: "<unknown>", path: "$", message: "Recipe must be an object" });
    return issues;
  }
  const r = raw;
  const id = typeof r.id === "string" && r.id ? r.id : "<unknown>";
  if (r.format !== "hgame.material" || r.version !== 1) {
    issues.push({
      severity: "error",
      recipeId: id,
      path: "format",
      message: 'Expected format="hgame.material" and version=1'
    });
  }
  if (!r.meta || typeof r.meta.tileMeters !== "number" || r.meta.tileMeters <= 0) {
    issues.push({
      severity: "error",
      recipeId: id,
      path: "meta.tileMeters",
      message: "meta.tileMeters must be a positive number"
    });
  }
  if (!r.meta || typeof r.meta.seed !== "number" || !Number.isFinite(r.meta.seed)) {
    issues.push({
      severity: "error",
      recipeId: id,
      path: "meta.seed",
      message: "meta.seed must be a finite number"
    });
  }
  if (!Array.isArray(r.nodes) || r.nodes.length === 0) {
    issues.push({ severity: "error", recipeId: id, path: "nodes", message: "nodes must be a non-empty array" });
    return issues;
  }
  if (!r.outputs || typeof r.outputs !== "object") {
    issues.push({ severity: "error", recipeId: id, path: "outputs", message: "outputs object is required" });
    return issues;
  }
  const params2 = r.params ?? {};
  const nodeIds = /* @__PURE__ */ new Set();
  const nodeMap = /* @__PURE__ */ new Map();
  for (let i = 0; i < r.nodes.length; i++) {
    const node = r.nodes[i];
    if (!node || typeof node.id !== "string" || !node.id) {
      issues.push({ severity: "error", recipeId: id, path: `nodes[${i}].id`, message: "Node id is required" });
      continue;
    }
    if (nodeIds.has(node.id)) {
      issues.push({
        severity: "error",
        recipeId: id,
        path: `nodes[${i}].id`,
        message: `Duplicate node id "${node.id}"`
      });
    }
    nodeIds.add(node.id);
    nodeMap.set(node.id, node);
    if (!VALID_MAT_OPS.has(node.op)) {
      issues.push({
        severity: "error",
        recipeId: id,
        path: `nodes[${i}].op`,
        message: `Unsupported material op "${String(node.op)}"`
      });
    }
    collectParamAndExprIssues(node.args ?? {}, params2, id, `nodes[${i}].args`, issues);
  }
  const adj = /* @__PURE__ */ new Map();
  for (const [nid, node] of nodeMap.entries()) {
    const deps = collectNodeDeps(node.args ?? {}, nodeIds, id, `nodes.${nid}.args`, issues);
    adj.set(nid, deps);
  }
  const color = /* @__PURE__ */ new Map();
  const dfsCycle = (u) => {
    const c = color.get(u) ?? 0;
    if (c === 1) return true;
    if (c === 2) return false;
    color.set(u, 1);
    for (const dep of adj.get(u) ?? []) {
      if (dfsCycle(dep)) return true;
    }
    color.set(u, 2);
    return false;
  };
  for (const nid of nodeMap.keys()) {
    if (dfsCycle(nid)) {
      issues.push({
        severity: "error",
        recipeId: id,
        path: `nodes.${nid}`,
        message: `Cycle detected in material node DAG involving "${nid}"`
      });
      break;
    }
  }
  const reqOutputs = [
    "albedo",
    "height",
    "normal",
    "ao",
    "roughness",
    "metalness",
    "porosity"
  ];
  for (const outKey of reqOutputs) {
    const val = r.outputs[outKey];
    if (val === void 0) {
      issues.push({
        severity: "error",
        recipeId: id,
        path: `outputs.${outKey}`,
        message: `Missing required output "${outKey}"`
      });
      continue;
    }
    collectParamAndExprIssues(val, params2, id, `outputs.${outKey}`, issues);
    if (typeof val === "string" && isNodeRefString(val)) {
      const baseId = val.split(".")[0];
      if (!nodeIds.has(baseId)) {
        issues.push({
          severity: "error",
          recipeId: id,
          path: `outputs.${outKey}`,
          message: `Output "${outKey}" references unknown node "${val}"`
        });
      }
    } else if (val && typeof val === "object") {
      if (!VALID_MAT_OPS.has(val.op)) {
        issues.push({
          severity: "error",
          recipeId: id,
          path: `outputs.${outKey}.op`,
          message: `Unsupported inline output op "${String(val.op)}"`
        });
      }
      const inlineArgs = val.args ?? val;
      collectNodeDeps(inlineArgs, nodeIds, id, `outputs.${outKey}`, issues);
    }
  }
  if (r.outputs.roughness === 0 || r.outputs.roughness === 0) {
    issues.push({
      severity: "error",
      recipeId: id,
      path: "outputs.roughness",
      message: "Roughness cannot be constant 0.0"
    });
  }
  const isPureNonMetal = typeof r.outputs.metalness === "number" && r.outputs.metalness < 0.5;
  if (isPureNonMetal) {
    const checkHexList = (val, loc) => {
      if (typeof val === "string" && val.startsWith("#")) {
        const luma = hexLinearLuminance(val);
        if (luma === null) {
          issues.push({ severity: "error", recipeId: id, path: loc, message: `Invalid hex color "${val}"` });
        } else if (luma < 0.04 || luma > 0.85) {
          issues.push({
            severity: "error",
            recipeId: id,
            path: loc,
            message: `Non-metal linear albedo luminance (${luma.toFixed(4)}) for "${val}" must be within [0.04, 0.85]`
          });
        }
      } else if (Array.isArray(val)) {
        val.forEach((v, idx) => checkHexList(v, `${loc}[${idx}]`));
      } else if (val && typeof val === "object") {
        for (const [k, v] of Object.entries(val)) checkHexList(v, `${loc}.${k}`);
      }
    };
    checkHexList(r.nodes, "nodes");
    checkHexList(r.outputs.albedo, "outputs.albedo");
  }
  return issues;
}
var VALID_RENDER_MODES = /* @__PURE__ */ new Set(["merge_chunk", "instanced_prop", "standalone"]);
function validateMeshRecipe(raw, knownMaterialIds, knownMeshIds) {
  const issues = [];
  if (!raw || typeof raw !== "object") {
    issues.push({ severity: "error", recipeId: "<unknown>", path: "$", message: "Mesh recipe must be an object" });
    return issues;
  }
  const r = raw;
  const id = typeof r.id === "string" && r.id ? r.id : "<unknown>";
  if (r.format !== "hgame.mesh" || r.version !== 1) {
    issues.push({
      severity: "error",
      recipeId: id,
      path: "format",
      message: 'Expected format="hgame.mesh" and version=1'
    });
  }
  if (!r.meta || r.meta.unit !== "meter") {
    issues.push({ severity: "error", recipeId: id, path: "meta.unit", message: 'meta.unit must be "meter"' });
  }
  if (r.meta?.renderMode !== void 0 && !VALID_RENDER_MODES.has(r.meta.renderMode)) {
    issues.push({
      severity: "error",
      recipeId: id,
      path: "meta.renderMode",
      message: `Invalid renderMode "${String(r.meta.renderMode)}" (expected merge_chunk | instanced_prop | standalone)`
    });
  }
  if (!r.materialSlots || typeof r.materialSlots !== "object") {
    issues.push({
      severity: "error",
      recipeId: id,
      path: "materialSlots",
      message: "materialSlots map is required"
    });
    return issues;
  }
  for (const [slotName, matId] of Object.entries(r.materialSlots)) {
    if (knownMaterialIds && !knownMaterialIds.has(matId)) {
      issues.push({
        severity: "error",
        recipeId: id,
        path: `materialSlots.${slotName}`,
        message: `Material slot "${slotName}" references unknown material "${matId}"`
      });
    }
  }
  if (!Array.isArray(r.parts) || r.parts.length === 0) {
    issues.push({ severity: "error", recipeId: id, path: "parts", message: "parts must be a non-empty array" });
    return issues;
  }
  const params2 = r.params ?? {};
  const slotNames = new Set(Object.keys(r.materialSlots));
  for (let i = 0; i < r.parts.length; i++) {
    const part = r.parts[i];
    if (!part || typeof part.id !== "string" || !part.id) {
      issues.push({ severity: "error", recipeId: id, path: `parts[${i}].id`, message: "Part id is required" });
      continue;
    }
    if (!VALID_MESH_OPS.has(part.op)) {
      issues.push({
        severity: "error",
        recipeId: id,
        path: `parts[${i}].op`,
        message: `Unsupported mesh op "${String(part.op)}"`
      });
    }
    collectParamAndExprIssues(part.when, params2, id, `parts[${i}].when`, issues);
    collectParamAndExprIssues(part.args, params2, id, `parts[${i}].args`, issues);
    collectParamAndExprIssues(part.transform, params2, id, `parts[${i}].transform`, issues);
    collectParamAndExprIssues(part.repeat, params2, id, `parts[${i}].repeat`, issues);
    collectParamAndExprIssues(part.params, params2, id, `parts[${i}].params`, issues);
    collectParamAndExprIssues(part.vertexMeta, params2, id, `parts[${i}].vertexMeta`, issues);
    if (part.op === "ref") {
      if (!part.ref || typeof part.ref !== "string") {
        issues.push({
          severity: "error",
          recipeId: id,
          path: `parts[${i}].ref`,
          message: "ref part must specify target mesh id"
        });
      } else if (knownMeshIds && !knownMeshIds.has(part.ref)) {
        issues.push({
          severity: "error",
          recipeId: id,
          path: `parts[${i}].ref`,
          message: `ref targets unknown mesh "${part.ref}"`
        });
      }
      if (part.materialOverrides) {
        for (const [k, v] of Object.entries(part.materialOverrides)) {
          if (typeof v === "string" && v.startsWith("$")) {
            const slot = v.slice(1);
            if (!slotNames.has(slot)) {
              issues.push({
                severity: "error",
                recipeId: id,
                path: `parts[${i}].materialOverrides.${k}`,
                message: `Unknown material slot "${v}"`
              });
            }
          } else if (knownMaterialIds && !knownMaterialIds.has(v)) {
            issues.push({
              severity: "error",
              recipeId: id,
              path: `parts[${i}].materialOverrides.${k}`,
              message: `Override references unknown material "${v}"`
            });
          }
        }
      }
    } else {
      if (!part.material) {
        issues.push({
          severity: "error",
          recipeId: id,
          path: `parts[${i}].material`,
          message: "Non-ref part must specify a material or $slot"
        });
      } else if (part.material.startsWith("$")) {
        const slot = part.material.slice(1);
        if (!slotNames.has(slot)) {
          issues.push({
            severity: "error",
            recipeId: id,
            path: `parts[${i}].material`,
            message: `Unknown material slot "${part.material}"`
          });
        }
      } else if (knownMaterialIds && !knownMaterialIds.has(part.material)) {
        issues.push({
          severity: "error",
          recipeId: id,
          path: `parts[${i}].material`,
          message: `Unknown material "${part.material}"`
        });
      }
    }
  }
  return issues;
}

// src/modules/realistic-pcg/recipes/material-graph-eval.ts
var LUT_SIZE = 4096;
var SRGB_TO_LIN_LUT = new Float32Array(LUT_SIZE);
var LIN_TO_SRGB_LUT = new Float32Array(LUT_SIZE);
for (let i = 0; i < LUT_SIZE; i++) {
  const x = i / (LUT_SIZE - 1);
  SRGB_TO_LIN_LUT[i] = x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  LIN_TO_SRGB_LUT[i] = x <= 31308e-7 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}
function fastSrgbToLinear(s) {
  const idx = s <= 0 ? 0 : s >= 1 ? LUT_SIZE - 1 : s * (LUT_SIZE - 1) + 0.5 | 0;
  return SRGB_TO_LIN_LUT[idx];
}
function linearToSrgbChannel(lin) {
  const idx = lin <= 0 ? 0 : lin >= 1 ? LUT_SIZE - 1 : lin * (LUT_SIZE - 1) + 0.5 | 0;
  return LIN_TO_SRGB_LUT[idx];
}
function hexToSrgbNorm(hex) {
  const rgb = parseHexColor(hex);
  if (!rgb) throw new Error(`Invalid hex color "${hex}"`);
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}
function hexToLinear(hex) {
  const rgb = parseHexColor(hex);
  if (!rgb) throw new Error(`Invalid hex color "${hex}"`);
  return [
    srgbChannelToLinear(rgb[0]),
    srgbChannelToLinear(rgb[1]),
    srgbChannelToLinear(rgb[2])
  ];
}
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
function wrapIdx(i, n) {
  const r = i % n;
  return r < 0 ? r + n : r;
}
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function createMaterialBakeJob(recipe, size, paramOverrides) {
  const params2 = { ...recipe.params ?? {}, ...paramOverrides ?? {} };
  const seed = recipe.meta.seed | 0;
  const pixelCount = size * size;
  const invSize = 1 / size;
  const ports = /* @__PURE__ */ new Map();
  const execList = [];
  const added = /* @__PURE__ */ new Set();
  const nodeById = /* @__PURE__ */ new Map();
  for (const n of recipe.nodes) nodeById.set(n.id, n);
  const visit = (id) => {
    if (added.has(id)) return;
    const node = nodeById.get(id);
    if (!node) return;
    for (const k of ["input", "a", "b", "mask", "warpX", "warpY"]) {
      const ref = node.args[k];
      if (typeof ref === "string" && !ref.startsWith("#") && !ref.startsWith("$")) {
        visit(ref.split(".")[0]);
      }
    }
    added.add(id);
    execList.push({ id: node.id, op: node.op, args: node.args });
  };
  for (const n of recipe.nodes) visit(n.id);
  const outputInlineId = {};
  const outputKeys = [
    "albedo",
    "height",
    "normal",
    "ao",
    "roughness",
    "metalness",
    "porosity"
  ];
  for (const ok of outputKeys) {
    const spec = recipe.outputs[ok];
    if (spec && typeof spec === "object") {
      const synId = `__out_${ok}`;
      const args = spec.args ? spec.args : { ...spec };
      execList.push({ id: synId, op: spec.op, args });
      outputInlineId[ok] = synId;
    }
  }
  const resolveScalarBuf = (ref, fallback = 0) => {
    if (typeof ref === "number") return ref;
    if (typeof ref === "string") {
      if (ref.startsWith("$") || ref.startsWith("expr:")) {
        return resolveNumber(ref, params2, fallback);
      }
      const p = ports.get(ref);
      if (!p) throw new Error(`Missing material port "${ref}" in "${recipe.id}"`);
      if (p.kind !== "scalar") {
        throw new Error(`Expected scalar port for "${ref}", got color`);
      }
      return p.data;
    }
    return fallback;
  };
  const resolveColorOrScalarBuf = (ref) => {
    if (typeof ref === "number") return { kind: "const_scalar", val: ref };
    if (typeof ref === "string") {
      if (ref.startsWith("#")) {
        return { kind: "const_color", rgb: hexToSrgbNorm(ref) };
      }
      if (ref.startsWith("$") || ref.startsWith("expr:")) {
        return { kind: "const_scalar", val: resolveNumber(ref, params2) };
      }
      const p = ports.get(ref);
      if (!p) throw new Error(`Missing material port "${ref}" in "${recipe.id}"`);
      return p;
    }
    return { kind: "const_scalar", val: 0 };
  };
  let nodeIdx = 0;
  let rowIdx = 0;
  let blurPhase = 0;
  let blurTmp = null;
  let curBuffers = {};
  let packedResult = null;
  let packRow = 0;
  let albedoOut = null;
  let normalOut = null;
  let ormOut = null;
  let minRough = 1;
  let maxRough = 0;
  let minLuma = 1;
  let maxLuma = 0;
  const CHUNK_ROWS = 16;
  const worleyScratch = { f1: 0, f2: 0, f2MinusF1: 0, cellRand: 0 };
  function initNodeBuffers(node) {
    curBuffers = {};
    blurPhase = 0;
    blurTmp = null;
    if (node.op === "worley") {
      const main = new Float32Array(pixelCount);
      const f1 = new Float32Array(pixelCount);
      const f2 = new Float32Array(pixelCount);
      const f2mf1 = new Float32Array(pixelCount);
      const cellRand = new Float32Array(pixelCount);
      const edge = new Float32Array(pixelCount);
      curBuffers = { main, f1, f2, f2mf1, cellRand, edge };
      ports.set(node.id, { kind: "scalar", data: main });
      ports.set(`${node.id}.f1`, { kind: "scalar", data: f1 });
      ports.set(`${node.id}.f2`, { kind: "scalar", data: f2 });
      ports.set(`${node.id}.f2_minus_f1`, { kind: "scalar", data: f2mf1 });
      ports.set(`${node.id}.cellRand`, { kind: "scalar", data: cellRand });
      ports.set(`${node.id}.edge`, { kind: "scalar", data: edge });
    } else if (node.op === "brick_pattern") {
      const height = new Float32Array(pixelCount);
      const mask = new Float32Array(pixelCount);
      const cellRand = new Float32Array(pixelCount);
      curBuffers = { height, mask, cellRand };
      ports.set(node.id, { kind: "scalar", data: height });
      ports.set(`${node.id}.height`, { kind: "scalar", data: height });
      ports.set(`${node.id}.mask`, { kind: "scalar", data: mask });
      ports.set(`${node.id}.cellRand`, { kind: "scalar", data: cellRand });
    } else if (node.op === "wood_grain") {
      const height = new Float32Array(pixelCount);
      const grain = new Float32Array(pixelCount);
      const mask = new Float32Array(pixelCount);
      curBuffers = { height, grain, mask };
      ports.set(node.id, { kind: "scalar", data: height });
      ports.set(`${node.id}.height`, { kind: "scalar", data: height });
      ports.set(`${node.id}.grain`, { kind: "scalar", data: grain });
      ports.set(`${node.id}.mask`, { kind: "scalar", data: mask });
    } else if (node.op === "plank_pattern") {
      const height = new Float32Array(pixelCount);
      const mask = new Float32Array(pixelCount);
      const cellRand = new Float32Array(pixelCount);
      const nails = new Float32Array(pixelCount);
      curBuffers = { height, mask, cellRand, nails };
      ports.set(node.id, { kind: "scalar", data: height });
      ports.set(`${node.id}.height`, { kind: "scalar", data: height });
      ports.set(`${node.id}.mask`, { kind: "scalar", data: mask });
      ports.set(`${node.id}.cellRand`, { kind: "scalar", data: cellRand });
      ports.set(`${node.id}.nails`, { kind: "scalar", data: nails });
    } else if (node.op === "corrugated_wave") {
      const height = new Float32Array(pixelCount);
      const ridge = new Float32Array(pixelCount);
      const edge = new Float32Array(pixelCount);
      curBuffers = { height, ridge, edge };
      ports.set(node.id, { kind: "scalar", data: height });
      ports.set(`${node.id}.height`, { kind: "scalar", data: height });
      ports.set(`${node.id}.ridge`, { kind: "scalar", data: ridge });
      ports.set(`${node.id}.edge`, { kind: "scalar", data: edge });
    } else if (node.op === "rivet_grid") {
      const height = new Float32Array(pixelCount);
      const mask = new Float32Array(pixelCount);
      curBuffers = { height, mask };
      ports.set(node.id, { kind: "scalar", data: height });
      ports.set(`${node.id}.height`, { kind: "scalar", data: height });
      ports.set(`${node.id}.mask`, { kind: "scalar", data: mask });
    } else if (node.op === "height_to_normal" || node.op === "mix_color" || node.op === "color_ramp") {
      const rgb = new Float32Array(pixelCount * 3);
      curBuffers = { rgb };
      ports.set(node.id, { kind: "color", data: rgb });
    } else if (node.op === "blend") {
      const aSrc = resolveColorOrScalarBuf(node.args.a);
      const bSrc = resolveColorOrScalarBuf(node.args.b);
      if (aSrc.kind === "color" || aSrc.kind === "const_color" || bSrc.kind === "color" || bSrc.kind === "const_color") {
        const rgb = new Float32Array(pixelCount * 3);
        curBuffers = { rgb };
        ports.set(node.id, { kind: "color", data: rgb });
      } else {
        const out = new Float32Array(pixelCount);
        curBuffers = { out };
        ports.set(node.id, { kind: "scalar", data: out });
      }
    } else {
      const out = new Float32Array(pixelCount);
      curBuffers = { out };
      ports.set(node.id, { kind: "scalar", data: out });
      if (node.op === "blur") {
        blurTmp = new Float32Array(pixelCount);
      }
    }
  }
  function processNodeRows(node, yStart, yEnd) {
    const args = node.args;
    switch (node.op) {
      case "fbm": {
        const scale = resolveNumber(args.scale, params2, 8);
        const octaves = Math.max(1, Math.min(8, Math.round(resolveNumber(args.octaves, params2, 4))));
        const persistence = resolveNumber(args.persistence, params2, 0.5);
        const lacunarity = resolveNumber(args.lacunarity, params2, 2);
        const out = curBuffers.out;
        fillFbm2DRows(out, size, yStart, yEnd, scale, octaves, persistence, lacunarity, seed);
        return true;
      }
      case "worley": {
        const scale = resolveNumber(args.scale, params2, 8);
        const mode = String(args.mode ?? "f1");
        const jitter = resolveNumber(args.jitter, params2, 0.9);
        const main = curBuffers.main;
        const f1B = curBuffers.f1;
        const f2B = curBuffers.f2;
        const f2mf1B = curBuffers.f2mf1;
        const crB = curBuffers.cellRand;
        const edgeB = curBuffers.edge;
        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            worley2DPeriodic(u, v, scale, jitter, seed + 17, worleyScratch);
            const idx = rowOff + x;
            f1B[idx] = worleyScratch.f1;
            f2B[idx] = worleyScratch.f2;
            f2mf1B[idx] = worleyScratch.f2MinusF1;
            crB[idx] = worleyScratch.cellRand;
            const e = 1 - smoothstep(0.02, 0.16, worleyScratch.f2MinusF1);
            edgeB[idx] = e;
            main[idx] = mode === "f2" ? worleyScratch.f2 : mode === "f2_minus_f1" ? worleyScratch.f2MinusF1 : mode === "cell_rand" ? worleyScratch.cellRand : mode === "edge" ? e : worleyScratch.f1;
          }
        }
        return true;
      }
      case "brick_pattern": {
        const rows = Math.max(1, Math.round(resolveNumber(args.rows, params2, 8)));
        const cols = Math.max(1, Math.round(resolveNumber(args.cols, params2, 4)));
        const stagger = resolveNumber(args.stagger, params2, 0.5);
        const mortar = Math.max(2e-3, resolveNumber(args.mortar, params2, 0.04));
        const bevel = Math.max(2e-3, resolveNumber(args.bevel, params2, 0.03));
        const variation = resolveNumber(args.variation, params2, 0.35);
        const heightB = curBuffers.height;
        const maskB = curBuffers.mask;
        const crB = curBuffers.cellRand;
        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const gy = v * rows;
          const row = Math.floor(gy);
          const fy = gy - row;
          const wRow = wrapIdx(row, rows);
          const rowShift = (wRow & 1) === 1 ? stagger : 0;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const gx = u * cols + rowShift;
            const col = Math.floor(gx);
            const fx = gx - col;
            const wCol = wrapIdx(col, cols);
            const cellH = hash2i(wCol, wRow, seed + 307);
            const randVal = (cellH & 65535) / 65535;
            const randHeight = 1 - variation * 0.35 + (randVal - 0.5) * variation * 0.4;
            const mortarX = mortar * (cols / rows);
            const mortarY = mortar;
            const dx = Math.min(fx, 1 - fx) - mortarX * 0.5;
            const dy = Math.min(fy, 1 - fy) - mortarY * 0.5;
            const dEdge = Math.min(dx, dy);
            const mask = dEdge > 0 ? smoothstep(0, bevel * 0.4, dEdge) : 0;
            const bevelRamp = dEdge > 0 ? smoothstep(0, bevel, dEdge) : 0;
            const idx = rowOff + x;
            maskB[idx] = mask;
            crB[idx] = randVal;
            heightB[idx] = clamp01(0.18 + mask * bevelRamp * 0.72 * randHeight);
          }
        }
        return true;
      }
      case "wood_grain": {
        const scale = resolveNumber(args.scale, params2, 6);
        const ringScale = resolveNumber(args.ringScale, params2, 18);
        const distortion = resolveNumber(args.distortion, params2, 0.35);
        const knots = Math.max(0, Math.round(resolveNumber(args.knots, params2, 2)));
        const stretchX = Math.max(1, Math.round(resolveNumber(args.stretchX, params2, 1)));
        const stretchY = Math.max(1, Math.round(resolveNumber(args.stretchY, params2, 6)));
        const heightB = curBuffers.height;
        const grainB = curBuffers.grain;
        const maskB = curBuffers.mask;
        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const warp = perlin2DPeriodic(u, v, scale * stretchX, scale * stretchY, seed + 51);
            let ringCoord = u * ringScale + warp * distortion * 4;
            let knotMask = 0;
            for (let k = 0; k < knots; k++) {
              const kh = hash2i(k, 13, seed + 911);
              const ku = (kh & 65535) / 65535;
              const kv = (kh >>> 16 & 65535) / 65535;
              let du = u - ku;
              let dv = v - kv;
              if (du > 0.5) du -= 1;
              if (du < -0.5) du += 1;
              if (dv > 0.5) dv -= 1;
              if (dv < -0.5) dv += 1;
              const dist = Math.sqrt(du * du * 18 + dv * dv * 3);
              if (dist < 0.35) {
                const influence = 1 - dist / 0.35;
                ringCoord += influence * 2.5;
                knotMask = Math.max(knotMask, influence * influence);
              }
            }
            const ringWave = 0.5 + 0.5 * Math.sin(ringCoord * Math.PI * 2);
            const fine = perlin2DPeriodic(u, v, scale * 6, scale * 2, seed + 131) * 0.5 + 0.5;
            const g = clamp01(ringWave * 0.65 + fine * 0.35);
            const idx = rowOff + x;
            grainB[idx] = g;
            maskB[idx] = clamp01(1 - knotMask * 0.7);
            heightB[idx] = clamp01(0.35 + g * 0.55 - knotMask * 0.18);
          }
        }
        return true;
      }
      case "plank_pattern": {
        const planks = Math.max(1, Math.round(resolveNumber(args.planks, params2, 6)));
        const joints = Math.max(1, Math.round(resolveNumber(args.joints, params2, 2)));
        const gap = Math.max(2e-3, resolveNumber(args.gap, params2, 0.015));
        const bevel = Math.max(2e-3, resolveNumber(args.bevel, params2, 0.025));
        const variation = resolveNumber(args.variation, params2, 0.4);
        const showNails = resolveBoolean(args.nails, params2, true);
        const heightB = curBuffers.height;
        const maskB = curBuffers.mask;
        const crB = curBuffers.cellRand;
        const nailsB = curBuffers.nails;
        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const px = u * planks;
            const plankIdx = Math.floor(px);
            const fx = px - plankIdx;
            const wPlank = wrapIdx(plankIdx, planks);
            const staggerV = (hash2i(wPlank, 3, seed + 401) & 65535) / 65535 * 0.8;
            const py = (v + staggerV) * joints;
            const jointIdx = Math.floor(py);
            const fy = py - jointIdx;
            const wJoint = wrapIdx(jointIdx, joints);
            const cellH = hash2i(wPlank, wJoint, seed + 701);
            const randVal = (cellH & 65535) / 65535;
            const dx = Math.min(fx, 1 - fx) - gap * 0.5 * planks;
            const dy = Math.min(fy, 1 - fy) - gap * 0.5 * joints;
            const dEdge = Math.min(dx, dy);
            const mask = dEdge > 0 ? smoothstep(0, bevel * 0.5, dEdge) : 0;
            const bev = dEdge > 0 ? smoothstep(0, bevel, dEdge) : 0;
            let nail = 0;
            if (showNails && mask > 0.5) {
              const ny1 = Math.abs(fy - 0.08) * (1 / joints);
              const ny2 = Math.abs(fy - 0.92) * (1 / joints);
              const nx1 = Math.abs(fx - 0.25) / planks;
              const nx2 = Math.abs(fx - 0.75) / planks;
              const dNail = Math.min(
                Math.hypot(nx1, ny1),
                Math.hypot(nx2, ny1),
                Math.hypot(nx1, ny2),
                Math.hypot(nx2, ny2)
              );
              nail = 1 - smoothstep(5e-3, 0.011, dNail);
            }
            const idx = rowOff + x;
            maskB[idx] = mask;
            crB[idx] = randVal;
            nailsB[idx] = nail;
            const fiber = perlin2DPeriodic(u, v, planks * 14, joints * 3, seed + 557) * 0.06;
            const plankBias = 1 - variation * 0.25 + (randVal - 0.5) * variation * 0.3;
            heightB[idx] = clamp01(0.12 + mask * bev * 0.78 * plankBias + fiber * mask - nail * 0.22);
          }
        }
        return true;
      }
      case "corrugated_wave": {
        const count = Math.max(1, Math.round(resolveNumber(args.count, params2, 5)));
        const axis = String(args.axis ?? "x");
        const fin = clamp01(resolveNumber(args.fin, params2, 0.26));
        const slope = Math.max(0.02, clamp01(resolveNumber(args.slope, params2, 0.24)));
        const fout = clamp01(resolveNumber(args.fout, params2, 0.26));
        const depth = clamp01(resolveNumber(args.depth, params2, 1));
        const heightB = curBuffers.height;
        const ridgeB = curBuffers.ridge;
        const edgeB = curBuffers.edge;
        const t1 = fin;
        const t2 = t1 + slope;
        const t3 = t2 + fout;
        const t4 = Math.min(1, t3 + slope);
        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const coord = axis === "y" ? v : u;
            const ph = coord * count % 1;
            let h = 0;
            let ridge = 0;
            let edge = 0;
            if (ph < t1) {
              h = 0;
            } else if (ph < t2) {
              const t = (ph - t1) / slope;
              h = smoothstep(0, 1, t);
              ridge = smoothstep(0.45, 0.95, t);
              edge = Math.sin(t * Math.PI);
            } else if (ph < t3) {
              h = 1;
              ridge = 1;
              const dEdge = Math.min(ph - t2, t3 - ph);
              edge = 1 - smoothstep(0, 0.04, dEdge);
            } else if (ph < t4) {
              const t = 1 - (ph - t3) / Math.max(0.01, t4 - t3);
              h = smoothstep(0, 1, t);
              ridge = smoothstep(0.45, 0.95, t);
              edge = Math.sin(t * Math.PI);
            }
            const idx = rowOff + x;
            heightB[idx] = h * depth;
            ridgeB[idx] = ridge;
            edgeB[idx] = edge;
          }
        }
        return true;
      }
      case "edge_wear_mask": {
        const src = resolveScalarBuf(args.input, 0.5);
        const low = resolveNumber(args.low, params2, 0.35);
        const high = resolveNumber(args.high, params2, 0.65);
        const noiseScale = Math.max(2, Math.round(resolveNumber(args.noiseScale, params2, 10)));
        const spread = resolveNumber(args.spread, params2, 0.45);
        const out = curBuffers.out;
        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const ym = y === 0 ? size - 1 : y - 1;
          const yp = y + 1 >= size ? 0 : y + 1;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const idx = rowOff + x;
            const val = typeof src === "number" ? src : src[idx];
            let grad = 0;
            if (typeof src !== "number") {
              const xm = x === 0 ? size - 1 : x - 1;
              const xp = x + 1 >= size ? 0 : x + 1;
              const dx = src[rowOff + xp] - src[rowOff + xm];
              const dy = src[yp * size + x] - src[ym * size + x];
              grad = Math.min(1, Math.hypot(dx, dy) * 3.5);
            }
            const n = fbm2DPeriodic((x + 0.5) * invSize, v, noiseScale, 3, 0.55, 2, seed + 433);
            const raw = clamp01(val * 0.65 + grad * 0.55 + (n - 0.5) * spread);
            out[idx] = smoothstep(low, high, raw);
          }
        }
        return true;
      }
      case "vertical_streak": {
        const scaleX = Math.max(2, Math.round(resolveNumber(args.scaleX, params2, 14)));
        const scaleY = Math.max(1, Math.round(resolveNumber(args.scaleY, params2, 3)));
        const threshold = resolveNumber(args.threshold, params2, 0.54);
        const decayPerTile = resolveNumber(args.decay, params2, 0.16);
        const seedOff = Math.round(resolveNumber(args.seedOffset, params2, 0));
        const srcInput = args.input ? resolveScalarBuf(args.input, 0) : null;
        const out = curBuffers.out;
        const dec = Math.exp(-0.693 / Math.max(0.02, decayPerTile * size));
        if (yStart === 0) {
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const colMask = smoothstep(
              0.25,
              0.78,
              perlin2DPeriodic(u, 0.37, scaleX, 1, seed + 811 + seedOff) * 0.5 + 0.5
            );
            let streak = 0;
            for (let pass = 0; pass < 2; pass++) {
              for (let y = size - 1; y >= 0; y--) {
                const v = (y + 0.5) * invSize;
                const i = y * size + x;
                const n = fbm2DPeriodic(u, v, scaleX, 3, 0.52, 2, seed + 887 + seedOff);
                const base = srcInput ? typeof srcInput === "number" ? srcInput : srcInput[i] : n;
                const src = smoothstep(threshold - 0.06, threshold + 0.06, base * 0.65 + n * 0.35);
                streak = Math.max(src * colMask, streak * dec);
                if (pass === 1) {
                  out[i] = clamp01(streak * streak * (1 - src * 0.45));
                }
              }
            }
          }
          rowIdx = size;
        }
        return true;
      }
      case "rivet_grid": {
        const cols = Math.max(1, Math.round(resolveNumber(args.cols, params2, 4)));
        const rows = Math.max(1, Math.round(resolveNumber(args.rows, params2, 2)));
        const radius = Math.max(0.01, resolveNumber(args.radius, params2, 0.08));
        const heightB = curBuffers.height;
        const maskB = curBuffers.mask;
        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const fy = v * rows % 1 - 0.5;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const fx = u * cols % 1 - 0.5;
            const d = Math.hypot(fx, fy) / radius;
            const m = d < 1 ? 1 - smoothstep(0.75, 1, d) : 0;
            const dome = d < 1 ? Math.sqrt(Math.max(0, 1 - d * d)) : 0;
            const idx = rowOff + x;
            maskB[idx] = m;
            heightB[idx] = dome;
          }
        }
        return true;
      }
      case "sand_ripples": {
        const freq = resolveNumber(args.freq, params2, 16);
        const warpScale = Math.max(1, Math.round(resolveNumber(args.warpScale, params2, 3)));
        const warpStrength = resolveNumber(args.warpStrength, params2, 4.2);
        const sharpness = resolveNumber(args.sharpness, params2, 1.7);
        const grainScale = Math.max(4, Math.round(resolveNumber(args.grainScale, params2, 28)));
        const out = curBuffers.out;
        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const w = fbm2DPeriodic(u, v, warpScale, 3, 0.5, 2, seed + 101);
            const w2 = fbm2DPeriodic(u, v, warpScale * 3, 2, 0.5, 2, seed + 211);
            const rr = 0.5 + 0.5 * Math.sin((v * freq + w * warpStrength + w2 * 1.1) * Math.PI * 2);
            const patch = smoothstep(0.25, 0.62, w + 0.15);
            const rip = Math.pow(rr, sharpness) * patch;
            const fine = fbm2DPeriodic(u, v, grainScale, 2, 0.5, 2, seed + 313);
            out[rowOff + x] = clamp01(rip * 0.72 + fine * 0.28);
          }
        }
        return true;
      }
      case "fabric_weave": {
        let threads = Math.max(4, Math.round(resolveNumber(args.threads, params2, 48)));
        threads = threads + 1 & ~1;
        const slub = resolveNumber(args.slub, params2, 0.3);
        const out = curBuffers.out;
        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const py = v * threads;
          const iy = Math.floor(py);
          const fy = py - iy;
          const wy = 0.75 + slub * ((hash2i(3, wrapIdx(iy, threads), seed + 53) & 65535) / 65535 - 0.5) * 1.4;
          const ty = Math.max(0, 1 - Math.abs(fy - 0.5) * 2 / wy);
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const px = u * threads;
            const ix = Math.floor(px);
            const fx = px - ix;
            const over = (ix + iy & 1) === 1;
            const wx = 0.75 + slub * ((hash2i(wrapIdx(ix, threads), 7, seed + 59) & 65535) / 65535 - 0.5) * 1.4;
            const tx = Math.max(0, 1 - Math.abs(fx - 0.5) * 2 / wx);
            const warp = Math.sqrt(tx) * (over ? 1 : 0.52) * (0.62 + 0.38 * Math.sin(fy * Math.PI));
            const weft = Math.sqrt(ty) * (over ? 0.52 : 1) * (0.62 + 0.38 * Math.sin(fx * Math.PI));
            const n = perlin2DPeriodic(u, v, threads, threads, seed + 61) * 0.5 * 0.16 * slub;
            out[rowOff + x] = clamp01(Math.max(warp, weft) + n);
          }
        }
        return true;
      }
      case "stripes": {
        const count = Math.max(1, Math.round(resolveNumber(args.count, params2, 12)));
        const axis = String(args.axis ?? "x");
        const width = resolveNumber(args.width, params2, 0.5);
        const softness = Math.max(5e-3, resolveNumber(args.softness, params2, 0.15));
        const noiseAmt = resolveNumber(args.noise, params2, 0.08);
        const out = curBuffers.out;
        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const coord = axis === "y" ? v : axis === "diag" ? u + v : u;
            const n = noiseAmt > 0 ? perlin2DPeriodic(u, v, count * 2, count * 2, seed + 99) * noiseAmt : 0;
            const phase = (coord * count + n) % 1;
            const p = phase < 0 ? phase + 1 : phase;
            const dist = Math.abs(p - 0.5) * 2;
            out[rowOff + x] = 1 - smoothstep(width - softness, width + softness, dist);
          }
        }
        return true;
      }
      case "speckle": {
        const scale = Math.max(2, Math.round(resolveNumber(args.scale, params2, 32)));
        const density = clamp01(resolveNumber(args.density, params2, 0.35));
        const softness = clamp01(resolveNumber(args.softness, params2, 0.5));
        const seedOff = Math.round(resolveNumber(args.seedOffset, params2, 0));
        const out = curBuffers.out;
        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const gy = v * scale;
          const iy = wrapIdx(Math.floor(gy), scale);
          const fy = gy - Math.floor(gy) - 0.5;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const u = (x + 0.5) * invSize;
            const gx = u * scale;
            const ix = wrapIdx(Math.floor(gx), scale);
            const fx = gx - Math.floor(gx) - 0.5;
            const h = hash2i(ix, iy, seed + 613 + seedOff);
            const active = (h & 65535) / 65535 < density;
            if (!active) {
              out[rowOff + x] = 0;
            } else {
              const rMax = 0.25 + (h >>> 16 & 255) / 255 * 0.25;
              const ox = ((h >>> 24 & 15) / 15 - 0.5) * 0.25;
              const oy = ((h >>> 28 & 15) / 15 - 0.5) * 0.25;
              const d = Math.hypot(fx - ox, fy - oy);
              out[rowOff + x] = 1 - smoothstep(rMax * (1 - softness * 0.8), rMax, d);
            }
          }
        }
        return true;
      }
      case "remap": {
        const src = resolveScalarBuf(args.input, 0);
        const inMin = resolveNumber(args.inMin, params2, 0);
        const inMax = resolveNumber(args.inMax, params2, 1);
        const outMin = resolveNumber(args.outMin, params2, 0);
        const outMax = resolveNumber(args.outMax, params2, 1);
        const invRange = 1 / (Math.abs(inMax - inMin) < 1e-6 ? 1e-6 : inMax - inMin);
        const out = curBuffers.out;
        if (typeof src === "number") {
          const t = clamp01((src - inMin) * invRange);
          const val = outMin + t * (outMax - outMin);
          out.fill(val, yStart * size, yEnd * size);
        } else {
          const start = yStart * size;
          const end = yEnd * size;
          for (let i = start; i < end; i++) {
            const t = clamp01((src[i] - inMin) * invRange);
            out[i] = outMin + t * (outMax - outMin);
          }
        }
        return true;
      }
      case "clamp": {
        const src = resolveScalarBuf(args.input, 0);
        const minV = resolveNumber(args.min, params2, 0);
        const maxV = resolveNumber(args.max, params2, 1);
        const out = curBuffers.out;
        const start = yStart * size;
        const end = yEnd * size;
        if (typeof src === "number") {
          out.fill(Math.max(minV, Math.min(maxV, src)), start, end);
        } else {
          for (let i = start; i < end; i++) {
            const v = src[i];
            out[i] = v < minV ? minV : v > maxV ? maxV : v;
          }
        }
        return true;
      }
      case "invert": {
        const src = resolveScalarBuf(args.input, 0);
        const out = curBuffers.out;
        const start = yStart * size;
        const end = yEnd * size;
        if (typeof src === "number") {
          out.fill(1 - src, start, end);
        } else {
          for (let i = start; i < end; i++) out[i] = 1 - src[i];
        }
        return true;
      }
      case "power": {
        const src = resolveScalarBuf(args.input, 0);
        const exp = resolveNumber(args.exp, params2, 1);
        const out = curBuffers.out;
        const start = yStart * size;
        const end = yEnd * size;
        if (typeof src === "number") {
          out.fill(Math.pow(Math.max(0, src), exp), start, end);
        } else {
          for (let i = start; i < end; i++) out[i] = Math.pow(Math.max(0, src[i]), exp);
        }
        return true;
      }
      case "domain_warp": {
        const src = resolveScalarBuf(args.input, 0);
        const warpX = args.warpX ? resolveScalarBuf(args.warpX, 0.5) : null;
        const warpY = args.warpY ? resolveScalarBuf(args.warpY, 0.5) : null;
        const strength = resolveNumber(args.strength, params2, 0.04);
        const warpScale = resolveNumber(args.scale, params2, 4);
        const out = curBuffers.out;
        if (typeof src === "number") {
          out.fill(src, yStart * size, yEnd * size);
          return true;
        }
        for (let y = yStart; y < yEnd; y++) {
          const v = (y + 0.5) * invSize;
          const rowOff = y * size;
          for (let x = 0; x < size; x++) {
            const idx = rowOff + x;
            const u = (x + 0.5) * invSize;
            const wx = warpX !== null ? (typeof warpX === "number" ? warpX : warpX[idx]) - 0.5 : perlin2DPeriodic(u, v, warpScale, warpScale, seed + 193);
            const wy = warpY !== null ? (typeof warpY === "number" ? warpY : warpY[idx]) - 0.5 : perlin2DPeriodic(u, v, warpScale, warpScale, seed + 389);
            const sx = (u + wx * strength) * size - 0.5;
            const sy = (v + wy * strength) * size - 0.5;
            const x0 = Math.floor(sx);
            const y0 = Math.floor(sy);
            const tx = sx - x0;
            const ty = sy - y0;
            const ix0 = wrapIdx(x0, size);
            const ix1 = ix0 + 1 >= size ? 0 : ix0 + 1;
            const iy0 = wrapIdx(y0, size);
            const iy1 = iy0 + 1 >= size ? 0 : iy0 + 1;
            const v00 = src[iy0 * size + ix0];
            const v10 = src[iy0 * size + ix1];
            const v01 = src[iy1 * size + ix0];
            const v11 = src[iy1 * size + ix1];
            const a = v00 + (v10 - v00) * tx;
            const b = v01 + (v11 - v01) * tx;
            out[idx] = a + (b - a) * ty;
          }
        }
        return true;
      }
      case "blur": {
        const src = resolveScalarBuf(args.input, 0);
        const radius = Math.max(1, Math.min(8, Math.round(resolveNumber(args.radius, params2, 2))));
        const out = curBuffers.out;
        if (typeof src === "number") {
          out.fill(src, yStart * size, yEnd * size);
          return true;
        }
        const tmp = blurTmp;
        const invKernel = 1 / (radius * 2 + 1);
        if (blurPhase === 0) {
          for (let y = yStart; y < yEnd; y++) {
            const rowOff = y * size;
            for (let x = 0; x < size; x++) {
              let sum = 0;
              for (let dx = -radius; dx <= radius; dx++) {
                sum += src[rowOff + wrapIdx(x + dx, size)];
              }
              tmp[rowOff + x] = sum * invKernel;
            }
          }
          if (yEnd >= size) {
            blurPhase = 1;
            rowIdx = 0;
            return false;
          }
          return true;
        } else {
          for (let y = yStart; y < yEnd; y++) {
            const rowOff = y * size;
            for (let x = 0; x < size; x++) {
              let sum = 0;
              for (let dy = -radius; dy <= radius; dy++) {
                sum += tmp[wrapIdx(y + dy, size) * size + x];
              }
              out[rowOff + x] = sum * invKernel;
            }
          }
          return true;
        }
      }
      case "height_to_normal": {
        const src = resolveScalarBuf(args.input, 0.5);
        const strength = resolveNumber(args.strength, params2, 2);
        const rgb = curBuffers.rgb;
        if (typeof src === "number") {
          for (let y = yStart; y < yEnd; y++) {
            const rowOff = y * size * 3;
            for (let x = 0; x < size; x++) {
              const o = rowOff + x * 3;
              rgb[o] = 0.5;
              rgb[o + 1] = 0.5;
              rgb[o + 2] = 1;
            }
          }
          return true;
        }
        for (let y = yStart; y < yEnd; y++) {
          const ym = y === 0 ? size - 1 : y - 1;
          const yp = y + 1 >= size ? 0 : y + 1;
          const rowM = ym * size;
          const rowC = y * size;
          const rowP = yp * size;
          for (let x = 0; x < size; x++) {
            const xm = x === 0 ? size - 1 : x - 1;
            const xp = x + 1 >= size ? 0 : x + 1;
            const tl = src[rowM + xm];
            const t = src[rowM + x];
            const tr = src[rowM + xp];
            const l = src[rowC + xm];
            const r = src[rowC + xp];
            const bl = src[rowP + xm];
            const b = src[rowP + x];
            const br = src[rowP + xp];
            const dX = tr + 2 * r + br - (tl + 2 * l + bl);
            const dY = bl + 2 * b + br - (tl + 2 * t + tr);
            const nx = -dX * strength;
            const ny = dY * strength;
            const nz = 1;
            const invLen = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
            const o = (rowC + x) * 3;
            rgb[o] = nx * invLen * 0.5 + 0.5;
            rgb[o + 1] = ny * invLen * 0.5 + 0.5;
            rgb[o + 2] = nz * invLen * 0.5 + 0.5;
          }
        }
        return true;
      }
      case "blend": {
        const mode = String(args.mode ?? "multiply");
        const strength = clamp01(resolveNumber(args.strength, params2, 1));
        const aSrc = resolveColorOrScalarBuf(args.a);
        const bSrc = resolveColorOrScalarBuf(args.b);
        const blendOp = (a, b) => {
          switch (mode) {
            case "add":
              return clamp01(a + b * strength);
            case "sub":
              return clamp01(a - b * strength);
            case "min":
              return a + (Math.min(a, b) - a) * strength;
            case "max":
              return a + (Math.max(a, b) - a) * strength;
            case "screen":
              return a + (1 - (1 - a) * (1 - b) - a) * strength;
            case "overlay": {
              const ov = a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
              return a + (ov - a) * strength;
            }
            case "multiply":
            default:
              return a + (a * b - a) * strength;
          }
        };
        if (curBuffers.rgb) {
          const rgb = curBuffers.rgb;
          const start = yStart * size;
          const end = yEnd * size;
          for (let i = start; i < end; i++) {
            const o = i * 3;
            for (let c = 0; c < 3; c++) {
              const av = aSrc.kind === "color" ? aSrc.data[o + c] : aSrc.kind === "const_color" ? aSrc.rgb[c] : aSrc.kind === "scalar" ? aSrc.data[i] : aSrc.val;
              const bv = bSrc.kind === "color" ? bSrc.data[o + c] : bSrc.kind === "const_color" ? bSrc.rgb[c] : bSrc.kind === "scalar" ? bSrc.data[i] : bSrc.val;
              rgb[o + c] = blendOp(av, bv);
            }
          }
        } else {
          const out = curBuffers.out;
          const start = yStart * size;
          const end = yEnd * size;
          for (let i = start; i < end; i++) {
            const av = aSrc.kind === "scalar" ? aSrc.data[i] : aSrc.kind === "const_scalar" ? aSrc.val : 0;
            const bv = bSrc.kind === "scalar" ? bSrc.data[i] : bSrc.kind === "const_scalar" ? bSrc.val : 0;
            out[i] = blendOp(av, bv);
          }
        }
        return true;
      }
      case "mix_scalar": {
        const aSrc = resolveScalarBuf(args.a, 0);
        const bSrc = resolveScalarBuf(args.b, 1);
        const mSrc = resolveScalarBuf(args.mask, 0.5);
        const out = curBuffers.out;
        const start = yStart * size;
        const end = yEnd * size;
        for (let i = start; i < end; i++) {
          const a = typeof aSrc === "number" ? aSrc : aSrc[i];
          const b = typeof bSrc === "number" ? bSrc : bSrc[i];
          const m = typeof mSrc === "number" ? mSrc : mSrc[i];
          out[i] = a + (b - a) * clamp01(m);
        }
        return true;
      }
      case "mix_color": {
        const aSrc = resolveColorOrScalarBuf(args.a);
        const bSrc = resolveColorOrScalarBuf(args.b);
        const mSrc = resolveScalarBuf(args.mask, 0.5);
        const rgb = curBuffers.rgb;
        const start = yStart * size;
        const end = yEnd * size;
        const aLin = aSrc.kind === "const_color" ? aSrc.rgb.map((v) => fastSrgbToLinear(v)) : null;
        const bLin = bSrc.kind === "const_color" ? bSrc.rgb.map((v) => fastSrgbToLinear(v)) : null;
        for (let i = start; i < end; i++) {
          const m = clamp01(typeof mSrc === "number" ? mSrc : mSrc[i]);
          const o = i * 3;
          for (let c = 0; c < 3; c++) {
            const av = aLin ? aLin[c] : aSrc.kind === "color" ? fastSrgbToLinear(aSrc.data[o + c]) : aSrc.kind === "scalar" ? aSrc.data[i] : 0;
            const bv = bLin ? bLin[c] : bSrc.kind === "color" ? fastSrgbToLinear(bSrc.data[o + c]) : bSrc.kind === "scalar" ? bSrc.data[i] : 0;
            rgb[o + c] = linearToSrgbChannel(av + (bv - av) * m);
          }
        }
        return true;
      }
      case "color_ramp": {
        const inSrc = resolveScalarBuf(args.input, 0.5);
        const rawStops = args.stops ?? [
          [0, "#444444"],
          [1, "#aaaaaa"]
        ];
        const stops = rawStops.map(([t, hex]) => ({ t: Number(t), lin: hexToLinear(hex) })).sort((a, b) => a.t - b.t);
        const rgb = curBuffers.rgb;
        const start = yStart * size;
        const end = yEnd * size;
        const lastStop = stops[stops.length - 1];
        const firstStop = stops[0];
        for (let i = start; i < end; i++) {
          const x = typeof inSrc === "number" ? inSrc : inSrc[i];
          let rLin;
          let gLin;
          let bLin;
          if (x <= firstStop.t) {
            [rLin, gLin, bLin] = firstStop.lin;
          } else if (x >= lastStop.t) {
            [rLin, gLin, bLin] = lastStop.lin;
          } else {
            let s0 = firstStop;
            let s1 = lastStop;
            for (let k = 0; k < stops.length - 1; k++) {
              if (x >= stops[k].t && x <= stops[k + 1].t) {
                s0 = stops[k];
                s1 = stops[k + 1];
                break;
              }
            }
            const span = Math.max(1e-6, s1.t - s0.t);
            const f = (x - s0.t) / span;
            rLin = s0.lin[0] + (s1.lin[0] - s0.lin[0]) * f;
            gLin = s0.lin[1] + (s1.lin[1] - s0.lin[1]) * f;
            bLin = s0.lin[2] + (s1.lin[2] - s0.lin[2]) * f;
          }
          const o = i * 3;
          rgb[o] = linearToSrgbChannel(rLin);
          rgb[o + 1] = linearToSrgbChannel(gLin);
          rgb[o + 2] = linearToSrgbChannel(bLin);
        }
        return true;
      }
    }
  }
  function resolveOutputSource(key) {
    const syn = outputInlineId[key];
    if (syn) return resolveColorOrScalarBuf(syn);
    return resolveColorOrScalarBuf(recipe.outputs[key]);
  }
  function packRows(yStart, yEnd) {
    if (!albedoOut) {
      albedoOut = new Uint8Array(pixelCount * 4);
      normalOut = new Uint8Array(pixelCount * 4);
      ormOut = new Uint8Array(pixelCount * 4);
    }
    const albSrc = resolveOutputSource("albedo");
    const hgtSrc = resolveOutputSource("height");
    const nrmSrc = resolveOutputSource("normal");
    const aoSrc = resolveOutputSource("ao");
    const rghSrc = resolveOutputSource("roughness");
    const metSrc = resolveOutputSource("metalness");
    const porSrc = resolveOutputSource("porosity");
    const start = yStart * size;
    const end = yEnd * size;
    const readScalar = (src, i, def) => {
      if (src.kind === "scalar") return src.data[i];
      if (src.kind === "const_scalar") return src.val;
      if (src.kind === "color") return src.data[i * 3];
      return def;
    };
    for (let i = start; i < end; i++) {
      const o3 = i * 3;
      const o4 = i * 4;
      let rS = 0.5;
      let gS = 0.5;
      let bS = 0.5;
      if (albSrc.kind === "color") {
        rS = albSrc.data[o3];
        gS = albSrc.data[o3 + 1];
        bS = albSrc.data[o3 + 2];
      } else if (albSrc.kind === "const_color") {
        rS = albSrc.rgb[0];
        gS = albSrc.rgb[1];
        bS = albSrc.rgb[2];
      } else if (albSrc.kind === "scalar") {
        rS = gS = bS = albSrc.data[i];
      }
      const metal = clamp01(readScalar(metSrc, i, 0));
      let rLin = fastSrgbToLinear(rS);
      let gLin = fastSrgbToLinear(gS);
      let bLin = fastSrgbToLinear(bS);
      let luma = 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
      if (metal < 0.5) {
        if (luma < 0.04) {
          const boost = luma > 1e-4 ? 0.04 / luma : 1;
          if (luma <= 1e-4) {
            rLin = gLin = bLin = 0.04;
          } else {
            rLin *= boost;
            gLin *= boost;
            bLin *= boost;
          }
          luma = 0.04;
          rS = linearToSrgbChannel(rLin);
          gS = linearToSrgbChannel(gLin);
          bS = linearToSrgbChannel(bLin);
        } else if (luma > 0.85) {
          const scale = 0.85 / luma;
          rLin *= scale;
          gLin *= scale;
          bLin *= scale;
          luma = 0.85;
          rS = linearToSrgbChannel(rLin);
          gS = linearToSrgbChannel(gLin);
          bS = linearToSrgbChannel(bLin);
        }
      }
      if (luma < minLuma) minLuma = luma;
      if (luma > maxLuma) maxLuma = luma;
      const hgt = clamp01(readScalar(hgtSrc, i, 0.5));
      albedoOut[o4] = Math.round(clamp01(rS) * 255);
      albedoOut[o4 + 1] = Math.round(clamp01(gS) * 255);
      albedoOut[o4 + 2] = Math.round(clamp01(bS) * 255);
      albedoOut[o4 + 3] = Math.round(hgt * 255);
      if (nrmSrc.kind === "color") {
        normalOut[o4] = Math.round(clamp01(nrmSrc.data[o3]) * 255);
        normalOut[o4 + 1] = Math.round(clamp01(nrmSrc.data[o3 + 1]) * 255);
        normalOut[o4 + 2] = Math.round(clamp01(nrmSrc.data[o3 + 2]) * 255);
      } else {
        normalOut[o4] = 128;
        normalOut[o4 + 1] = 128;
        normalOut[o4 + 2] = 255;
      }
      normalOut[o4 + 3] = 255;
      const ao = clamp01(readScalar(aoSrc, i, 1));
      const rough = Math.max(0.05, Math.min(1, readScalar(rghSrc, i, 0.7)));
      const por = clamp01(readScalar(porSrc, i, 0.3));
      if (rough < minRough) minRough = rough;
      if (rough > maxRough) maxRough = rough;
      ormOut[o4] = Math.round(ao * 255);
      ormOut[o4 + 1] = Math.round(rough * 255);
      ormOut[o4 + 2] = Math.round(metal * 255);
      ormOut[o4 + 3] = Math.round(por * 255);
    }
  }
  return {
    id: recipe.id,
    size,
    step(budgetMs = 8) {
      if (packedResult) return true;
      const sliceStart = performance.now();
      while (nodeIdx < execList.length) {
        const node = execList[nodeIdx];
        if (rowIdx === 0 && blurPhase === 0) {
          initNodeBuffers(node);
        }
        while (rowIdx < size) {
          const yEnd = Math.min(size, rowIdx + CHUNK_ROWS);
          const finishedPhase = processNodeRows(node, rowIdx, yEnd);
          if (!finishedPhase) {
            if (performance.now() - sliceStart >= budgetMs) return false;
            continue;
          }
          rowIdx = yEnd;
          if (performance.now() - sliceStart >= budgetMs) {
            return false;
          }
        }
        nodeIdx++;
        rowIdx = 0;
        blurPhase = 0;
      }
      while (packRow < size) {
        const yEnd = Math.min(size, packRow + CHUNK_ROWS * 2);
        packRows(packRow, yEnd);
        packRow = yEnd;
        if (packRow < size && performance.now() - sliceStart >= budgetMs) {
          return false;
        }
      }
      packedResult = {
        id: recipe.id,
        size,
        albedoData: albedoOut,
        normalData: normalOut,
        ormData: ormOut,
        stats: {
          minRoughness: minRough,
          maxRoughness: maxRough,
          minLinearLuma: minLuma,
          maxLinearLuma: maxLuma
        }
      };
      return true;
    },
    getResult() {
      while (!packedResult) {
        this.step(Infinity);
      }
      return packedResult;
    }
  };
}

// src/modules/realistic-pcg/materials/gpu-material-baker.ts
import * as THREE7 from "three";
var GLSL_NOISE_LIB = (
  /* glsl */
  `
precision highp float;

float h12(vec2 p, float s) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + s * 0.0173);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 h22(vec2 p, float s) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973) + s * 0.0137);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float pnoise(vec2 uv, vec2 per, float s) {
  vec2 p = uv * per;
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = h12(mod(i, per), s);
  float b = h12(mod(i + vec2(1.0, 0.0), per), s);
  float c = h12(mod(i + vec2(0.0, 1.0), per), s);
  float d = h12(mod(i + vec2(1.0, 1.0), per), s);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float pfbm(vec2 uv, vec2 freq, int octaves, float pers, float lac, float s) {
  float sum = 0.0;
  float amp = 1.0;
  float norm = 0.0;
  vec2 f = max(vec2(1.0), floor(freq + 0.5));
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * pnoise(uv, f, s + float(i) * 19.0);
    norm += amp;
    amp *= pers;
    f *= lac;
  }
  return clamp(sum / max(1e-4, norm), 0.0, 1.0);
}

vec4 pworley(vec2 uv, float scale, float jitter, float s) {
  float per = max(1.0, floor(scale + 0.5));
  vec2 p = uv * per;
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 9.0;
  float d2 = 9.0;
  float cid = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 c = mod(i + g, per);
      vec2 rnd = (h22(c, s) - 0.5) * jitter + 0.5;
      vec2 r = g + rnd - f;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        cid = h12(c + 7.3, s);
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  float f1 = min(1.0, sqrt(d1));
  float f2 = min(1.0, sqrt(d2));
  return vec4(f1, f2, clamp(f2 - f1, 0.0, 1.0), cid);
}

vec3 pbrick(vec2 uv, float rows, float cols, float stagger, float mortar, float bevel, float variation, float s) {
  float gy = uv.y * rows;
  float r = floor(gy);
  float fy = gy - r;
  float wr = mod(r, rows);
  float shift = mod(wr, 2.0) >= 1.0 ? stagger : 0.0;
  float gx = uv.x * cols + shift;
  float c = floor(gx);
  float fx = gx - c;
  float wc = mod(c, cols);
  float cellRand = h12(vec2(wc, wr), s + 3.1);
  float mx = mortar * (cols / rows);
  float dx = min(fx, 1.0 - fx) - mx * 0.5;
  float dy = min(fy, 1.0 - fy) - mortar * 0.5;
  float dEdge = min(dx, dy);
  float mask = dEdge > 0.0 ? smoothstep(0.0, max(1e-4, bevel * 0.4), dEdge) : 0.0;
  float bev = dEdge > 0.0 ? smoothstep(0.0, max(1e-4, bevel), dEdge) : 0.0;
  float rh = 1.0 - variation * 0.35 + (cellRand - 0.5) * variation * 0.4;
  float h = clamp(0.18 + mask * bev * 0.72 * rh, 0.0, 1.0);
  return vec3(h, mask, cellRand);
}

vec4 pplank(vec2 uv, float planks, float joints, float gap, float bevel, float variation, float nailsOn, float s) {
  float px = uv.x * planks;
  float pi = floor(px);
  float fx = px - pi;
  float wp = mod(pi, planks);
  float stag = h12(vec2(wp, 3.0), s + 4.1) * 0.8;
  float py = (uv.y + stag) * joints;
  float ji = floor(py);
  float fy = py - ji;
  float wj = mod(ji, joints);
  float cellRand = h12(vec2(wp, wj), s + 7.1);
  float dx = min(fx, 1.0 - fx) - gap * 0.5 * planks;
  float dy = min(fy, 1.0 - fy) - gap * 0.5 * joints;
  float dEdge = min(dx, dy);
  float mask = dEdge > 0.0 ? smoothstep(0.0, max(1e-4, bevel * 0.5), dEdge) : 0.0;
  float bev = dEdge > 0.0 ? smoothstep(0.0, max(1e-4, bevel), dEdge) : 0.0;
  float nail = 0.0;
  if (nailsOn > 0.5 && mask > 0.5) {
    float ny = min(abs(fy - 0.08), abs(fy - 0.92)) / joints;
    float nx = min(abs(fx - 0.25), abs(fx - 0.75)) / planks;
    nail = 1.0 - smoothstep(0.005, 0.011, length(vec2(nx, ny)));
  }
  float pb = 1.0 - variation * 0.25 + (cellRand - 0.5) * variation * 0.3;
  float fiber = (pnoise(uv, vec2(planks * 14.0, joints * 3.0), s + 5.7) - 0.5) * 0.12;
  float h = clamp(0.12 + mask * bev * 0.78 * pb + fiber * mask - nail * 0.22, 0.0, 1.0);
  return vec4(h, mask, cellRand, nail);
}

vec3 pwood(vec2 uv, float scale, float ringScale, float distortion, float sx, float sy, float s) {
  float warp = (pnoise(uv, vec2(scale * sx, scale * sy), s + 5.1) - 0.5) * 2.0;
  float rc = uv.x * ringScale + warp * distortion * 4.0;
  float ringWave = 0.5 + 0.5 * sin(rc * 6.2831853);
  float fine = pnoise(uv, vec2(scale * 6.0, scale * 2.0), s + 13.1);
  float g = clamp(ringWave * 0.65 + fine * 0.35, 0.0, 1.0);
  return vec3(clamp(0.35 + g * 0.55, 0.0, 1.0), g, 1.0);
}

vec3 pcorrugated(vec2 uv, float count, float axisY, float fin, float slope, float fout, float depth) {
  float coord = axisY > 0.5 ? uv.y : uv.x;
  float ph = fract(coord * count);
  float t1 = fin;
  float t2 = t1 + slope;
  float t3 = t2 + fout;
  float t4 = min(1.0, t3 + slope);
  float h = 0.0;
  float ridge = 0.0;
  float edge = 0.0;
  if (ph < t1) {
    h = 0.0;
  } else if (ph < t2) {
    float t = (ph - t1) / max(1e-4, slope);
    h = smoothstep(0.0, 1.0, t);
    ridge = smoothstep(0.45, 0.95, t);
    edge = sin(t * 3.1415926);
  } else if (ph < t3) {
    h = 1.0;
    ridge = 1.0;
    float dEdge = min(ph - t2, t3 - ph);
    edge = 1.0 - smoothstep(0.0, 0.04, dEdge);
  } else if (ph < t4) {
    float t = 1.0 - (ph - t3) / max(1e-4, t4 - t3);
    h = smoothstep(0.0, 1.0, t);
    ridge = smoothstep(0.45, 0.95, t);
    edge = sin(t * 3.1415926);
  }
  return vec3(h * depth, ridge, edge);
}

float pweave(vec2 uv, float threads, float slub, float s) {
  vec2 p = uv * threads;
  vec2 i = floor(p);
  vec2 f = fract(p);
  float over = mod(i.x + i.y, 2.0);
  float wx = 0.75 + slub * (h12(vec2(mod(i.x, threads), 7.0), s + 5.9) - 0.5) * 1.4;
  float wy = 0.75 + slub * (h12(vec2(3.0, mod(i.y, threads)), s + 5.3) - 0.5) * 1.4;
  float tx = max(0.0, 1.0 - abs(f.x - 0.5) * 2.0 / max(0.1, wx));
  float ty = max(0.0, 1.0 - abs(f.y - 0.5) * 2.0 / max(0.1, wy));
  float warp = sqrt(tx) * (over >= 0.5 ? 1.0 : 0.52) * (0.62 + 0.38 * sin(f.y * 3.1415926));
  float weft = sqrt(ty) * (over >= 0.5 ? 0.52 : 1.0) * (0.62 + 0.38 * sin(f.x * 3.1415926));
  float n = (pnoise(uv, vec2(threads), s + 6.1) - 0.5) * 0.16 * slub;
  return clamp(max(warp, weft) + n, 0.0, 1.0);
}

float psand(vec2 uv, float freq, float warpScale, float warpStrength, float sharpness, float grainScale, float s) {
  float w = pfbm(uv, vec2(warpScale), 3, 0.5, 2.0, s + 10.1);
  float w2 = pfbm(uv, vec2(warpScale * 3.0), 2, 0.5, 2.0, s + 21.1);
  float rr = 0.5 + 0.5 * sin((uv.y * freq + w * warpStrength + w2 * 1.1) * 6.2831853);
  float patchM = smoothstep(0.25, 0.62, w + 0.15);
  float rip = pow(max(0.0, rr), sharpness) * patchM;
  float fine = pfbm(uv, vec2(grainScale), 2, 0.5, 2.0, s + 31.3);
  return clamp(rip * 0.72 + fine * 0.28, 0.0, 1.0);
}

vec2 privet(vec2 uv, float cols, float rows, float rad) {
  vec2 f = fract(uv * vec2(cols, rows)) - 0.5;
  float d = length(f) / max(0.005, rad);
  float m = d < 1.0 ? (1.0 - smoothstep(0.75, 1.0, d)) : 0.0;
  float dome = d < 1.0 ? sqrt(max(0.0, 1.0 - d * d)) : 0.0;
  return vec2(dome, m);
}

float pspeckle(vec2 uv, float scale, float density, float softness, float s) {
  float per = max(2.0, floor(scale + 0.5));
  vec2 g = uv * per;
  vec2 ig = mod(floor(g), per);
  vec2 fg = fract(g) - 0.5;
  float h = h12(ig, s + 6.13);
  if (h >= density) return 0.0;
  vec2 r2 = h22(ig, s + 9.7);
  float rMax = 0.25 + r2.x * 0.25;
  vec2 off = (r2 - 0.5) * 0.25;
  float d = length(fg - off);
  return 1.0 - smoothstep(rMax * (1.0 - softness * 0.8), rMax, d);
}

float pstripes(vec2 uv, float count, float axisMode, float width, float softness, float noiseAmt, float s) {
  float coord = axisMode > 1.5 ? (uv.x + uv.y) : (axisMode > 0.5 ? uv.y : uv.x);
  float n = noiseAmt > 0.0 ? (pnoise(uv, vec2(count * 2.0), s + 9.9) - 0.5) * 2.0 * noiseAmt : 0.0;
  float p = fract(coord * count + n);
  float dist = abs(p - 0.5) * 2.0;
  return 1.0 - smoothstep(width - softness, width + softness, dist);
}

float srgbToLin(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}
vec3 srgbToLin3(vec3 c) {
  return vec3(srgbToLin(c.r), srgbToLin(c.g), srgbToLin(c.b));
}
float linToSrgb(float c) {
  c = clamp(c, 0.0, 1.0);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}
vec3 linToSrgb3(vec3 c) {
  return vec3(linToSrgb(c.r), linToSrgb(c.g), linToSrgb(c.b));
}

vec2 packH16(float h) {
  h = clamp(h, 0.0, 1.0);
  float s = h * 255.0;
  float hi = floor(s) / 255.0;
  float lo = fract(s);
  return vec2(hi, lo);
}
float unpackH16(vec2 rg) {
  return rg.r + rg.g / 255.0;
}
`
);
function fLit(n) {
  if (!Number.isFinite(n)) return "0.0";
  const s = n.toFixed(6);
  return s.includes(".") ? s : s + ".0";
}
function hexToGlslVec3(hex) {
  const rgb = parseHexColor(hex);
  if (!rgb) return "vec3(0.5)";
  return `vec3(${fLit(rgb[0] / 255)}, ${fLit(rgb[1] / 255)}, ${fLit(rgb[2] / 255)})`;
}
function hexToGlslLinVec3(hex) {
  const rgb = parseHexColor(hex);
  if (!rgb) return "vec3(0.2)";
  return `vec3(${fLit(srgbChannelToLinear(rgb[0]))}, ${fLit(srgbChannelToLinear(rgb[1]))}, ${fLit(srgbChannelToLinear(rgb[2]))})`;
}
function sanitizeId(id) {
  return "n_" + id.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+/, "");
}
function createGpuMaterialBaker(renderer) {
  const scene = new THREE7.Scene();
  const camera = new THREE7.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = new THREE7.PlaneGeometry(2, 2);
  const quadMesh = new THREE7.Mesh(quadGeo);
  quadMesh.frustumCulled = false;
  scene.add(quadMesh);
  let cachedSize = 0;
  let mrtRT = null;
  let outRT = null;
  function ensureTargets(size) {
    if (cachedSize === size && mrtRT && outRT) return;
    mrtRT?.dispose();
    outRT?.dispose();
    const opts = {
      format: THREE7.RGBAFormat,
      type: THREE7.UnsignedByteType,
      wrapS: THREE7.RepeatWrapping,
      wrapT: THREE7.RepeatWrapping,
      minFilter: THREE7.LinearFilter,
      magFilter: THREE7.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false
    };
    mrtRT = new THREE7.WebGLRenderTarget(size, size, { ...opts, count: 3 });
    outRT = new THREE7.WebGLRenderTarget(size, size, opts);
    cachedSize = size;
  }
  function compileGraphBody(recipe, params2, size) {
    const seedF = recipe.meta.seed % 9973 * 0.01;
    const nodeById = /* @__PURE__ */ new Map();
    for (const n of recipe.nodes) nodeById.set(n.id, n);
    const execList = [];
    const added = /* @__PURE__ */ new Set();
    const visit = (id) => {
      if (added.has(id)) return;
      const n = nodeById.get(id);
      if (!n) return;
      for (const k of ["input", "a", "b", "mask", "warpX", "warpY"]) {
        const ref = n.args[k];
        if (typeof ref === "string" && !ref.startsWith("#") && !ref.startsWith("$")) {
          visit(ref.split(".")[0]);
        }
      }
      added.add(id);
      execList.push(n);
    };
    for (const n of recipe.nodes) visit(n.id);
    const outputKeys = [
      "albedo",
      "height",
      "normal",
      "ao",
      "roughness",
      "metalness",
      "porosity"
    ];
    const inlineNames = {};
    for (const ok of outputKeys) {
      const spec = recipe.outputs[ok];
      if (spec && typeof spec === "object") {
        const synId = `inline_out_${ok}`;
        const args = spec.args ? spec.args : { ...spec };
        execList.push({ id: synId, op: spec.op, args });
        inlineNames[ok] = synId;
      }
    }
    const colorVars = /* @__PURE__ */ new Set();
    const lines = [];
    let hasBlur = false;
    let normalStrength = 2;
    let heightNodeName = "";
    const refScalar = (ref, def = 0) => {
      if (typeof ref === "number") return fLit(ref);
      if (typeof ref === "string") {
        if (ref.startsWith("$") || ref.startsWith("expr:")) {
          return fLit(resolveNumber(ref, params2, def));
        }
        const [base, sub] = ref.split(".");
        const v = sanitizeId(base);
        if (sub) return `${v}_${sub}`;
        return v;
      }
      return fLit(def);
    };
    const refColor = (ref) => {
      if (typeof ref === "string") {
        if (ref.startsWith("#")) return hexToGlslVec3(ref);
        if (ref.startsWith("$") || ref.startsWith("expr:")) {
          return `vec3(${fLit(resolveNumber(ref, params2, 0.5))})`;
        }
        const v = sanitizeId(ref.split(".")[0]);
        return colorVars.has(v) ? v : `vec3(${refScalar(ref, 0.5)})`;
      }
      if (typeof ref === "number") return `vec3(${fLit(ref)})`;
      return "vec3(0.5)";
    };
    const isColorRef = (ref) => {
      if (typeof ref !== "string") return false;
      if (ref.startsWith("#")) return true;
      return colorVars.has(sanitizeId(ref.split(".")[0]));
    };
    for (const node of execList) {
      const v = sanitizeId(node.id);
      const args = node.args;
      switch (node.op) {
        case "fbm": {
          const scale = resolveNumber(args.scale, params2, 8);
          const oct = Math.max(1, Math.min(8, Math.round(resolveNumber(args.octaves, params2, 4))));
          const pers = resolveNumber(args.persistence, params2, 0.5);
          const lac = resolveNumber(args.lacunarity, params2, 2);
          lines.push(`float ${v} = pfbm(uv, vec2(${fLit(scale)}), ${oct}, ${fLit(pers)}, ${fLit(lac)}, ${fLit(seedF)});`);
          break;
        }
        case "worley": {
          const scale = resolveNumber(args.scale, params2, 8);
          const jitter = resolveNumber(args.jitter, params2, 0.9);
          const mode = String(args.mode ?? "f1");
          lines.push(`vec4 ${v}_w = pworley(uv, ${fLit(scale)}, ${fLit(jitter)}, ${fLit(seedF + 0.17)});`);
          lines.push(`float ${v}_f1 = ${v}_w.x; float ${v}_f2 = ${v}_w.y; float ${v}_f2_minus_f1 = ${v}_w.z; float ${v}_cellRand = ${v}_w.w;`);
          lines.push(`float ${v}_edge = 1.0 - smoothstep(0.02, 0.16, ${v}_f2_minus_f1);`);
          const mainPick = mode === "f2" ? `${v}_f2` : mode === "f2_minus_f1" ? `${v}_f2_minus_f1` : mode === "cell_rand" ? `${v}_cellRand` : mode === "edge" ? `${v}_edge` : `${v}_f1`;
          lines.push(`float ${v} = ${mainPick};`);
          break;
        }
        case "brick_pattern": {
          const rows = resolveNumber(args.rows, params2, 8);
          const cols = resolveNumber(args.cols, params2, 4);
          const stagger = resolveNumber(args.stagger, params2, 0.5);
          const mortar = resolveNumber(args.mortar, params2, 0.04);
          const bevel = resolveNumber(args.bevel, params2, 0.03);
          const variation = resolveNumber(args.variation, params2, 0.35);
          lines.push(`vec3 ${v}_b = pbrick(uv, ${fLit(rows)}, ${fLit(cols)}, ${fLit(stagger)}, ${fLit(mortar)}, ${fLit(bevel)}, ${fLit(variation)}, ${fLit(seedF)});`);
          lines.push(`float ${v} = ${v}_b.x; float ${v}_height = ${v}_b.x; float ${v}_mask = ${v}_b.y; float ${v}_cellRand = ${v}_b.z;`);
          break;
        }
        case "plank_pattern": {
          const planks = resolveNumber(args.planks, params2, 6);
          const joints = resolveNumber(args.joints, params2, 2);
          const gap = resolveNumber(args.gap, params2, 0.015);
          const bevel = resolveNumber(args.bevel, params2, 0.025);
          const variation = resolveNumber(args.variation, params2, 0.4);
          const nails = resolveBoolean(args.nails, params2, true) ? 1 : 0;
          lines.push(`vec4 ${v}_p = pplank(uv, ${fLit(planks)}, ${fLit(joints)}, ${fLit(gap)}, ${fLit(bevel)}, ${fLit(variation)}, ${fLit(nails)}, ${fLit(seedF)});`);
          lines.push(`float ${v} = ${v}_p.x; float ${v}_height = ${v}_p.x; float ${v}_mask = ${v}_p.y; float ${v}_cellRand = ${v}_p.z; float ${v}_nails = ${v}_p.w;`);
          break;
        }
        case "wood_grain": {
          const scale = resolveNumber(args.scale, params2, 6);
          const ringScale = resolveNumber(args.ringScale, params2, 18);
          const distortion = resolveNumber(args.distortion, params2, 0.35);
          const sx = resolveNumber(args.stretchX, params2, 1);
          const sy = resolveNumber(args.stretchY, params2, 6);
          lines.push(`vec3 ${v}_wg = pwood(uv, ${fLit(scale)}, ${fLit(ringScale)}, ${fLit(distortion)}, ${fLit(sx)}, ${fLit(sy)}, ${fLit(seedF)});`);
          lines.push(`float ${v} = ${v}_wg.x; float ${v}_height = ${v}_wg.x; float ${v}_grain = ${v}_wg.y; float ${v}_mask = ${v}_wg.z;`);
          break;
        }
        case "corrugated_wave": {
          const count = resolveNumber(args.count, params2, 5);
          const axisY = String(args.axis ?? "x") === "y" ? 1 : 0;
          const fin = resolveNumber(args.fin, params2, 0.26);
          const slope = resolveNumber(args.slope, params2, 0.24);
          const fout = resolveNumber(args.fout, params2, 0.26);
          const depth = resolveNumber(args.depth, params2, 1);
          lines.push(`vec3 ${v}_cw = pcorrugated(uv, ${fLit(count)}, ${fLit(axisY)}, ${fLit(fin)}, ${fLit(slope)}, ${fLit(fout)}, ${fLit(depth)});`);
          lines.push(`float ${v} = ${v}_cw.x; float ${v}_height = ${v}_cw.x; float ${v}_ridge = ${v}_cw.y; float ${v}_edge = ${v}_cw.z;`);
          break;
        }
        case "edge_wear_mask": {
          const src = refScalar(args.input, 0.5);
          const low = resolveNumber(args.low, params2, 0.35);
          const high = resolveNumber(args.high, params2, 0.65);
          const ns = resolveNumber(args.noiseScale, params2, 10);
          const spread = resolveNumber(args.spread, params2, 0.45);
          lines.push(`float ${v}_n = pfbm(uv, vec2(${fLit(ns)}), 3, 0.55, 2.0, ${fLit(seedF + 0.43)});`);
          lines.push(`float ${v} = smoothstep(${fLit(low)}, ${fLit(high)}, clamp(${src} * 0.8 + (${v}_n - 0.5) * ${fLit(spread)}, 0.0, 1.0));`);
          break;
        }
        case "vertical_streak": {
          const scaleX = resolveNumber(args.scaleX, params2, 14);
          const scaleY = resolveNumber(args.scaleY, params2, 3);
          const thresh = resolveNumber(args.threshold, params2, 0.54);
          const seedOff = resolveNumber(args.seedOffset, params2, 0) * 0.01;
          const baseSrc = args.input ? refScalar(args.input, 0.5) : "0.5";
          lines.push(`float ${v}_col = smoothstep(0.25, 0.78, pnoise(vec2(uv.x, 0.37), vec2(${fLit(scaleX)}, 1.0), ${fLit(seedF + 0.81 + seedOff)}));`);
          lines.push(`float ${v}_acc = 0.0; for (int k = 0; k < 6; k++) { float dy = float(k) * 0.035; float n = pfbm(vec2(uv.x, fract(uv.y + dy)), vec2(${fLit(scaleX)}, ${fLit(scaleY)}), 3, 0.52, 2.0, ${fLit(seedF + 0.88 + seedOff)}); float src = smoothstep(${fLit(thresh - 0.06)}, ${fLit(thresh + 0.06)}, ${baseSrc} * 0.5 + n * 0.5); ${v}_acc = max(${v}_acc, src * ${v}_col * pow(0.84, float(k))); }`);
          lines.push(`float ${v} = clamp(${v}_acc * ${v}_acc, 0.0, 1.0);`);
          break;
        }
        case "rivet_grid": {
          const cols = resolveNumber(args.cols, params2, 4);
          const rows = resolveNumber(args.rows, params2, 2);
          const rad = resolveNumber(args.radius, params2, 0.08);
          lines.push(`vec2 ${v}_rv = privet(uv, ${fLit(cols)}, ${fLit(rows)}, ${fLit(rad)});`);
          lines.push(`float ${v} = ${v}_rv.x; float ${v}_height = ${v}_rv.x; float ${v}_mask = ${v}_rv.y;`);
          break;
        }
        case "sand_ripples": {
          const freq = resolveNumber(args.freq, params2, 16);
          const ws = resolveNumber(args.warpScale, params2, 3);
          const wstr = resolveNumber(args.warpStrength, params2, 4.2);
          const sharp = resolveNumber(args.sharpness, params2, 1.7);
          const gs = resolveNumber(args.grainScale, params2, 28);
          lines.push(`float ${v} = psand(uv, ${fLit(freq)}, ${fLit(ws)}, ${fLit(wstr)}, ${fLit(sharp)}, ${fLit(gs)}, ${fLit(seedF)});`);
          break;
        }
        case "fabric_weave": {
          const threads = resolveNumber(args.threads, params2, 48);
          const slub = resolveNumber(args.slub, params2, 0.3);
          lines.push(`float ${v} = pweave(uv, ${fLit(threads)}, ${fLit(slub)}, ${fLit(seedF)});`);
          break;
        }
        case "stripes": {
          const count = resolveNumber(args.count, params2, 12);
          const axis = String(args.axis ?? "x");
          const axisMode = axis === "diag" ? 2 : axis === "y" ? 1 : 0;
          const width = resolveNumber(args.width, params2, 0.5);
          const soft = resolveNumber(args.softness, params2, 0.15);
          const n = resolveNumber(args.noise, params2, 0.08);
          lines.push(`float ${v} = pstripes(uv, ${fLit(count)}, ${fLit(axisMode)}, ${fLit(width)}, ${fLit(soft)}, ${fLit(n)}, ${fLit(seedF)});`);
          break;
        }
        case "speckle": {
          const scale = resolveNumber(args.scale, params2, 32);
          const density = resolveNumber(args.density, params2, 0.35);
          const soft = resolveNumber(args.softness, params2, 0.5);
          const soff = resolveNumber(args.seedOffset, params2, 0) * 0.01;
          lines.push(`float ${v} = pspeckle(uv, ${fLit(scale)}, ${fLit(density)}, ${fLit(soft)}, ${fLit(seedF + soff)});`);
          break;
        }
        case "remap": {
          const src = refScalar(args.input, 0);
          const i0 = resolveNumber(args.inMin, params2, 0);
          const i1 = resolveNumber(args.inMax, params2, 1);
          const o0 = resolveNumber(args.outMin, params2, 0);
          const o1 = resolveNumber(args.outMax, params2, 1);
          const span = Math.abs(i1 - i0) < 1e-5 ? 1e-5 : i1 - i0;
          lines.push(`float ${v} = mix(${fLit(o0)}, ${fLit(o1)}, clamp((${src} - ${fLit(i0)}) / ${fLit(span)}, 0.0, 1.0));`);
          break;
        }
        case "clamp": {
          const src = refScalar(args.input, 0);
          const mn = resolveNumber(args.min, params2, 0);
          const mx = resolveNumber(args.max, params2, 1);
          lines.push(`float ${v} = clamp(${src}, ${fLit(mn)}, ${fLit(mx)});`);
          break;
        }
        case "invert": {
          lines.push(`float ${v} = 1.0 - (${refScalar(args.input, 0)});`);
          break;
        }
        case "power": {
          const exp = resolveNumber(args.exp, params2, 1);
          lines.push(`float ${v} = pow(max(0.0, ${refScalar(args.input, 0)}), ${fLit(exp)});`);
          break;
        }
        case "blur": {
          hasBlur = true;
          lines.push(`float ${v} = ${refScalar(args.input, 0)};`);
          break;
        }
        case "domain_warp": {
          lines.push(`float ${v} = ${refScalar(args.input, 0.5)};`);
          break;
        }
        case "height_to_normal": {
          normalStrength = resolveNumber(args.strength, params2, 2);
          heightNodeName = typeof args.input === "string" ? args.input : "";
          colorVars.add(v);
          lines.push(`vec3 ${v} = vec3(0.5, 0.5, 1.0);`);
          break;
        }
        case "mix_scalar": {
          lines.push(`float ${v} = mix(${refScalar(args.a, 0)}, ${refScalar(args.b, 1)}, clamp(${refScalar(args.mask, 0.5)}, 0.0, 1.0));`);
          break;
        }
        case "mix_color": {
          colorVars.add(v);
          const aC = refColor(args.a);
          const bC = refColor(args.b);
          const m = `clamp(${refScalar(args.mask, 0.5)}, 0.0, 1.0)`;
          lines.push(`vec3 ${v} = linToSrgb3(mix(srgbToLin3(${aC}), srgbToLin3(${bC}), ${m}));`);
          break;
        }
        case "color_ramp": {
          colorVars.add(v);
          const inp = refScalar(args.input, 0.5);
          const rawStops = args.stops ?? [[0, "#444444"], [1, "#aaaaaa"]];
          const stops = [...rawStops].sort((a, b) => a[0] - b[0]);
          lines.push(`vec3 ${v}_lin = ${hexToGlslLinVec3(stops[0][1])};`);
          for (let sIdx = 0; sIdx < stops.length - 1; sIdx++) {
            const s0 = stops[sIdx];
            const s1 = stops[sIdx + 1];
            const span = Math.max(1e-5, s1[0] - s0[0]);
            lines.push(
              `if (${inp} >= ${fLit(s0[0])}) { ${v}_lin = mix(${hexToGlslLinVec3(s0[1])}, ${hexToGlslLinVec3(s1[1])}, clamp((${inp} - ${fLit(s0[0])}) / ${fLit(span)}, 0.0, 1.0)); }`
            );
          }
          lines.push(`vec3 ${v} = linToSrgb3(${v}_lin);`);
          break;
        }
        case "blend": {
          const mode = String(args.mode ?? "multiply");
          const str = Math.max(0, Math.min(1, resolveNumber(args.strength, params2, 1)));
          const isCol = isColorRef(args.a) || isColorRef(args.b);
          const fn = (a, b) => {
            switch (mode) {
              case "add":
                return `clamp(${a} + ${b} * ${fLit(str)}, 0.0, 1.0)`;
              case "sub":
                return `clamp(${a} - ${b} * ${fLit(str)}, 0.0, 1.0)`;
              case "min":
                return `mix(${a}, min(${a}, ${b}), ${fLit(str)})`;
              case "max":
                return `mix(${a}, max(${a}, ${b}), ${fLit(str)})`;
              case "screen":
                return `mix(${a}, 1.0 - (1.0 - ${a}) * (1.0 - ${b}), ${fLit(str)})`;
              case "overlay":
                return `mix(${a}, (${a} < 0.5 ? 2.0 * ${a} * ${b} : 1.0 - 2.0 * (1.0 - ${a}) * (1.0 - ${b})), ${fLit(str)})`;
              default:
                return `mix(${a}, ${a} * ${b}, ${fLit(str)})`;
            }
          };
          if (isCol) {
            colorVars.add(v);
            lines.push(`vec3 ${v} = ${fn(refColor(args.a), refColor(args.b))};`);
          } else {
            lines.push(`float ${v} = ${fn(refScalar(args.a, 0), refScalar(args.b, 0))};`);
          }
          break;
        }
      }
    }
    const outExprColor = (k) => {
      const syn = inlineNames[k];
      if (syn) return refColor(syn);
      return refColor(recipe.outputs[k]);
    };
    const outExprScalar = (k, def) => {
      const syn = inlineNames[k];
      if (syn) return refScalar(syn, def);
      return refScalar(recipe.outputs[k], def);
    };
    return {
      body: lines.join("\n"),
      heightVar: heightNodeName ? refScalar(heightNodeName, 0.5) : outExprScalar("height", 0.5),
      normalStrength,
      albedoExpr: outExprColor("albedo"),
      aoExpr: outExprScalar("ao", 1),
      roughExpr: outExprScalar("roughness", 0.7),
      metalExpr: outExprScalar("metalness", 0),
      porosityExpr: outExprScalar("porosity", 0.3),
      hasBlur
    };
  }
  const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const sharedNormalMat = new THREE7.ShaderMaterial({
    vertexShader: VERT,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tH: { value: null },
      uPx: { value: 1 / 512 },
      uStr: { value: 2 }
    },
    fragmentShader: `${GLSL_NOISE_LIB}
varying vec2 vUv;
uniform sampler2D tH;
uniform float uPx;
uniform float uStr;
float sampleH(vec2 uv) { return unpackH16(texture2D(tH, uv).rg); }
void main() {
  float tl = sampleH(vUv + vec2(-uPx, -uPx));
  float t  = sampleH(vUv + vec2( 0.0, -uPx));
  float tr = sampleH(vUv + vec2( uPx, -uPx));
  float l  = sampleH(vUv + vec2(-uPx,  0.0));
  float r  = sampleH(vUv + vec2( uPx,  0.0));
  float bl = sampleH(vUv + vec2(-uPx,  uPx));
  float b  = sampleH(vUv + vec2( 0.0,  uPx));
  float br = sampleH(vUv + vec2( uPx,  uPx));
  float dX = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float dY = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
  vec3 n = normalize(vec3(-dX * uStr, dY * uStr, 1.0));
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}`
  });
  return {
    bakeMaterial(recipe, size, paramOverrides) {
      ensureTargets(size);
      const params2 = { ...recipe.params ?? {}, ...paramOverrides ?? {} };
      const compiled = compileGraphBody(recipe, params2, size);
      const prevRT = renderer.getRenderTarget();
      const dagMat = new THREE7.ShaderMaterial({
        vertexShader: VERT,
        glslVersion: THREE7.GLSL3,
        depthTest: false,
        depthWrite: false,
        fragmentShader: `${GLSL_NOISE_LIB}
varying vec2 vUv;
layout(location = 0) out vec4 oAlbedo;
layout(location = 1) out vec4 oOrm;
layout(location = 2) out vec4 oHeight;
void main() {
  vec2 uv = vUv;
  ${compiled.body}
  float hOut = clamp(${compiled.heightVar}, 0.0, 1.0);
  vec2 h16 = packH16(hOut);
  float met = clamp(${compiled.metalExpr}, 0.0, 1.0);
  vec3 albS = clamp(${compiled.albedoExpr}, 0.0, 1.0);
  if (met < 0.5) {
    vec3 lin = srgbToLin3(albS);
    float luma = dot(lin, vec3(0.2126, 0.7152, 0.0722));
    if (luma < 0.04) {
      lin = luma > 1e-4 ? lin * (0.04 / luma) : vec3(0.04);
      albS = linToSrgb3(lin);
    } else if (luma > 0.85) {
      lin *= 0.85 / luma;
      albS = linToSrgb3(lin);
    }
  }
  float ao = clamp(${compiled.aoExpr}, 0.0, 1.0);
  float rgh = clamp(${compiled.roughExpr}, 0.05, 1.0);
  float por = clamp(${compiled.porosityExpr}, 0.0, 1.0);
  oAlbedo = vec4(albS, hOut);
  oOrm = vec4(ao, rgh, met, por);
  oHeight = vec4(h16.x, h16.y, met, hOut);
}`
      });
      quadMesh.material = dagMat;
      renderer.setRenderTarget(mrtRT);
      renderer.render(scene, camera);
      dagMat.dispose();
      const albedoData = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(mrtRT, 0, 0, size, size, albedoData, void 0, 0);
      const ormData = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(mrtRT, 0, 0, size, size, ormData, void 0, 1);
      sharedNormalMat.uniforms.tH.value = mrtRT.textures[2];
      sharedNormalMat.uniforms.uPx.value = 1 / size;
      sharedNormalMat.uniforms.uStr.value = compiled.normalStrength;
      quadMesh.material = sharedNormalMat;
      renderer.setRenderTarget(outRT);
      renderer.render(scene, camera);
      const normalData = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(outRT, 0, 0, size, size, normalData);
      renderer.setRenderTarget(prevRT);
      let minR = 1;
      let maxR = 0;
      let minL = 1;
      let maxL = 0;
      for (let i = 0; i < ormData.length; i += 16) {
        const r = ormData[i + 1] / 255;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        const rl = srgbChannelToLinear(albedoData[i]);
        const gl = srgbChannelToLinear(albedoData[i + 1]);
        const bl = srgbChannelToLinear(albedoData[i + 2]);
        const luma = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
        if (luma < minL) minL = luma;
        if (luma > maxL) maxL = luma;
      }
      return {
        id: recipe.id,
        size,
        albedoData,
        normalData,
        ormData,
        stats: {
          minRoughness: minR,
          maxRoughness: maxR,
          minLinearLuma: minL,
          maxLinearLuma: maxL
        }
      };
    },
    dispose() {
      mrtRT?.dispose();
      outRT?.dispose();
      mrtRT = null;
      outRT = null;
      sharedNormalMat.dispose();
      quadGeo.dispose();
      scene.clear();
    }
  };
}

// src/modules/realistic-pcg/materials/texture-array-baker.ts
function createArrayTex(data, size, depth, colorSpace, anisotropy) {
  const tex = new THREE8.DataArrayTexture(data, size, size, depth);
  tex.format = THREE8.RGBAFormat;
  tex.type = THREE8.UnsignedByteType;
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE8.RepeatWrapping;
  tex.wrapT = THREE8.RepeatWrapping;
  tex.minFilter = THREE8.LinearMipmapLinearFilter;
  tex.magFilter = THREE8.LinearFilter;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
function nextFrameYield() {
  if (typeof MessageChannel === "function") {
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        ch.port2.close();
        resolve();
      };
      ch.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}
function copyLayerToArray(dst, src, layerIdx, layerByteLength) {
  dst.set(src, layerIdx * layerByteLength);
}
function uploadLayerSubImage3D(renderer, tex, layerIdx, size, data) {
  try {
    const props = renderer.properties?.get(tex);
    const gl = renderer.getContext?.();
    if (!props?.__webglTexture || !gl || typeof gl.texSubImage3D !== "function") {
      return false;
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, props.__webglTexture);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      layerIdx,
      size,
      size,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data
    );
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    return true;
  } catch {
    return false;
  }
}
function canUseGpuBake(renderer, mode) {
  if (mode === "cpu") return false;
  return Boolean(
    renderer && typeof renderer.setRenderTarget === "function" && typeof renderer.readRenderTargetPixels === "function"
  );
}
async function bakeMaterialArrayAsync(recipes, preset, options = {}) {
  const startTime = performance.now();
  const size = preset.textureSize;
  const maxLayers = Math.max(preset.maxMaterials, recipes.length);
  const layerBytes = size * size * 4;
  const totalBytes = layerBytes * maxLayers;
  const albedoAll = new Uint8Array(totalBytes);
  const normalAll = new Uint8Array(totalBytes);
  const ormAll = new Uint8Array(totalBytes);
  if (recipes.length === 0) {
    for (let p = 0; p < layerBytes; p += 4) {
      albedoAll[p] = 128;
      albedoAll[p + 1] = 128;
      albedoAll[p + 2] = 128;
      albedoAll[p + 3] = 128;
      normalAll[p] = 128;
      normalAll[p + 1] = 128;
      normalAll[p + 2] = 255;
      normalAll[p + 3] = 255;
      ormAll[p] = 255;
      ormAll[p + 1] = 204;
      ormAll[p + 2] = 0;
      ormAll[p + 3] = 128;
    }
  }
  const bakeMode = options.bakeMode ?? "auto";
  const useGpu = canUseGpuBake(options.renderer, bakeMode);
  let gpuBaker = null;
  let actualBackend = "cpu";
  if (useGpu && options.renderer) {
    try {
      gpuBaker = createGpuMaterialBaker(options.renderer);
      actualBackend = "gpu";
    } catch {
      gpuBaker = null;
      actualBackend = "cpu";
    }
  }
  const layers = /* @__PURE__ */ new Map();
  const tileMetersById = new Float32Array(maxLayers);
  tileMetersById.fill(1);
  let maxSliceMs = 0;
  let gpuSliceAccumMs = 0;
  const totalJobs = Math.max(1, recipes.length);
  for (let i = 0; i < recipes.length; i++) {
    const recipe = recipes[i];
    let baked = null;
    if (gpuBaker) {
      try {
        const t0 = performance.now();
        baked = gpuBaker.bakeMaterial(recipe, size);
        const dt = performance.now() - t0;
        if (dt > maxSliceMs) maxSliceMs = dt;
        gpuSliceAccumMs += dt;
        if (gpuSliceAccumMs >= preset.frameBudgetMs && i + 1 < recipes.length) {
          gpuSliceAccumMs = 0;
          await nextFrameYield();
        }
      } catch {
        baked = null;
        actualBackend = "cpu";
      }
    }
    if (!baked) {
      const job = createMaterialBakeJob(recipe, size);
      while (true) {
        const t0 = performance.now();
        const done = job.step(preset.frameBudgetMs);
        const dt = performance.now() - t0;
        if (dt > maxSliceMs) maxSliceMs = dt;
        if (done) break;
        options.onProgress?.((i + 0.5) / totalJobs);
        await nextFrameYield();
      }
      baked = job.getResult();
    }
    copyLayerToArray(albedoAll, baked.albedoData, i, layerBytes);
    copyLayerToArray(normalAll, baked.normalData, i, layerBytes);
    copyLayerToArray(ormAll, baked.ormData, i, layerBytes);
    tileMetersById[i] = recipe.meta.tileMeters;
    layers.set(recipe.id, {
      id: recipe.id,
      materialId: i,
      tileMeters: recipe.meta.tileMeters,
      recipe,
      stats: baked.stats
    });
    options.onProgress?.((i + 1) / totalJobs);
  }
  if (gpuBaker) {
    gpuBaker.dispose();
    gpuBaker = null;
  }
  const maxAniso = options.renderer?.capabilities?.getMaxAnisotropy?.() ?? preset.anisotropy;
  const aniso = Math.min(preset.anisotropy, maxAniso);
  const albedoArray = createArrayTex(albedoAll, size, maxLayers, THREE8.SRGBColorSpace, aniso);
  const normalArray = createArrayTex(normalAll, size, maxLayers, THREE8.NoColorSpace, 1);
  const ormArray = createArrayTex(ormAll, size, maxLayers, THREE8.NoColorSpace, 1);
  const bakeTimeMs = performance.now() - startTime;
  const estimatedMemoryMB = totalBytes * 3 * (4 / 3) / (1024 * 1024);
  let nextSlot = recipes.length;
  return {
    albedoArray,
    normalArray,
    ormArray,
    size,
    depth: maxLayers,
    bakeBackend: actualBackend,
    layers,
    tileMetersById,
    estimatedMemoryMB,
    bakeTimeMs,
    maxSliceMs,
    async updateLayer(recipe, renderer, paramOverrides) {
      const existing = layers.get(recipe.id);
      let slot;
      if (existing) {
        slot = existing.materialId;
      } else {
        if (nextSlot >= maxLayers) {
          throw new Error(`Material array capacity (${maxLayers}) exceeded when registering "${recipe.id}"`);
        }
        slot = nextSlot++;
      }
      const activeRenderer = renderer ?? options.renderer ?? null;
      let baked = null;
      if (canUseGpuBake(activeRenderer, bakeMode) && activeRenderer) {
        const tempBaker = createGpuMaterialBaker(activeRenderer);
        try {
          baked = tempBaker.bakeMaterial(recipe, size, paramOverrides);
        } catch {
          baked = null;
        } finally {
          tempBaker.dispose();
        }
      }
      if (!baked) {
        const job = createMaterialBakeJob(recipe, size, paramOverrides);
        while (!job.step(preset.frameBudgetMs)) {
          await nextFrameYield();
        }
        baked = job.getResult();
      }
      copyLayerToArray(albedoAll, baked.albedoData, slot, layerBytes);
      copyLayerToArray(normalAll, baked.normalData, slot, layerBytes);
      copyLayerToArray(ormAll, baked.ormData, slot, layerBytes);
      tileMetersById[slot] = recipe.meta.tileMeters;
      layers.set(recipe.id, {
        id: recipe.id,
        materialId: slot,
        tileMeters: recipe.meta.tileMeters,
        recipe,
        stats: baked.stats
      });
      const subOk = activeRenderer !== null && uploadLayerSubImage3D(activeRenderer, albedoArray, slot, size, baked.albedoData) && uploadLayerSubImage3D(activeRenderer, normalArray, slot, size, baked.normalData) && uploadLayerSubImage3D(activeRenderer, ormArray, slot, size, baked.ormData);
      if (!subOk) {
        albedoArray.needsUpdate = true;
        normalArray.needsUpdate = true;
        ormArray.needsUpdate = true;
      }
      return slot;
    },
    dispose() {
      albedoArray.dispose();
      normalArray.dispose();
      ormArray.dispose();
      layers.clear();
    }
  };
}

// src/modules/realistic-pcg/recipes/mesh-recipe-eval.ts
import * as THREE9 from "three";

// src/modules/realistic-pcg/geometry/primitive-ops.ts
function opBeveledBox(args, params2, materialId, edgeWear, ao, wetness) {
  const [w, h, d] = resolveVec3(args.size, params2, [1, 1, 1]);
  const bevel = resolveNumber(args.bevel, params2, 0.02);
  return buildBeveledBoxRaw(w, h, d, bevel, materialId, edgeWear, ao, wetness);
}
function opBeveledWallOpening(args, params2, materialId, edgeWear, ao, wetness) {
  const width = Math.max(0.1, resolveNumber(args.width, params2, 4));
  const height = Math.max(0.1, resolveNumber(args.height, params2, 2.5));
  const thickness = Math.max(0.05, resolveNumber(args.thickness, params2, 0.35));
  const bevel = resolveNumber(args.bevel, params2, 0.02);
  const rawOpenings = Array.isArray(args.openings) ? args.openings : [];
  const activeOpenings = [];
  for (const o of rawOpenings) {
    if (o.when !== void 0 && !resolveBoolean(o.when, params2, true)) continue;
    const ox = resolveNumber(o.x, params2, 0);
    const oy = resolveNumber(o.y, params2, 0);
    const ow = Math.max(0.1, resolveNumber(o.w, params2, 1));
    const oh = Math.max(0.1, resolveNumber(o.h, params2, 1));
    const x0 = Math.max(-width * 0.5 + 0.05, ox - ow * 0.5);
    const x1 = Math.min(width * 0.5 - 0.05, ox + ow * 0.5);
    const y0 = Math.max(0, oy);
    const y1 = Math.min(height - 0.05, oy + oh);
    if (x1 > x0 + 0.05 && y1 > y0 + 0.05) {
      activeOpenings.push({ x0, x1, y0, y1 });
    }
  }
  const out = createRawMeshData();
  const addSubBlock = (x0, x1, y0, y1) => {
    const bw = x1 - x0;
    const bh = y1 - y0;
    if (bw <= 5e-3 || bh <= 5e-3) return;
    const block = buildBeveledBoxRaw(bw, bh, thickness, bevel, materialId, edgeWear, ao, wetness);
    const cx = (x0 + x1) * 0.5;
    const cy = (y0 + y1) * 0.5;
    for (let i = 0; i < block.positions.length; i += 3) {
      block.positions[i] = block.positions[i] + cx;
      block.positions[i + 1] = block.positions[i + 1] + cy;
    }
    appendRawMesh(out, block);
  };
  if (activeOpenings.length === 0) {
    addSubBlock(-width * 0.5, width * 0.5, 0, height);
    return out;
  }
  const xs = /* @__PURE__ */ new Set([-width * 0.5, width * 0.5]);
  const ys = /* @__PURE__ */ new Set([0, height]);
  for (const o of activeOpenings) {
    xs.add(o.x0);
    xs.add(o.x1);
    ys.add(o.y0);
    ys.add(o.y1);
  }
  const sortedX = [...xs].sort((a, b) => a - b);
  const sortedY = [...ys].sort((a, b) => a - b);
  for (let xi = 0; xi < sortedX.length - 1; xi++) {
    const x0 = sortedX[xi];
    const x1 = sortedX[xi + 1];
    const midX = (x0 + x1) * 0.5;
    for (let yi = 0; yi < sortedY.length - 1; yi++) {
      const y0 = sortedY[yi];
      const y1 = sortedY[yi + 1];
      const midY = (y0 + y1) * 0.5;
      const insideOpening = activeOpenings.some(
        (o) => midX > o.x0 && midX < o.x1 && midY > o.y0 && midY < o.y1
      );
      if (!insideOpening) {
        addSubBlock(x0, x1, y0, y1);
      }
    }
  }
  return out;
}
function opCylinder(args, params2, materialId, edgeWear, ao, wetness) {
  const radiusTop = Math.max(0.01, resolveNumber(args.radiusTop ?? args.radius, params2, 0.25));
  const radiusBottom = Math.max(0.01, resolveNumber(args.radiusBottom ?? args.radius, params2, radiusTop));
  const height = Math.max(0.02, resolveNumber(args.height, params2, 1));
  const segments = Math.max(6, Math.min(48, Math.round(resolveNumber(args.segments, params2, 16))));
  const mesh = createRawMeshData();
  const hy = height * 0.5;
  const avgR = (radiusTop + radiusBottom) * 0.5;
  const circum = Math.PI * 2 * avgR;
  const topRing = [];
  const botRing = [];
  const topCapRing = [];
  const botCapRing = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const theta = t * Math.PI * 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const u = t * circum;
    const tx = radiusTop * cos;
    const tz = radiusTop * sin;
    const bx = radiusBottom * cos;
    const bz = radiusBottom * sin;
    const slopeY = (radiusBottom - radiusTop) / height;
    const nLen = Math.hypot(cos, slopeY, sin) || 1;
    const nx = cos / nLen;
    const ny = slopeY / nLen;
    const nz = sin / nLen;
    topRing.push(pushVertex(mesh, tx, hy, tz, nx, ny, nz, u, hy, ao, edgeWear * 0.5, wetness, materialId));
    botRing.push(pushVertex(mesh, bx, -hy, bz, nx, ny, nz, u, -hy, ao, edgeWear * 0.5, wetness, materialId));
    if (i < segments) {
      topCapRing.push(pushVertex(mesh, tx, hy, tz, 0, 1, 0, tx, tz, ao, edgeWear * 0.7, wetness, materialId));
      botCapRing.push(pushVertex(mesh, bx, -hy, bz, 0, -1, 0, bx, bz, ao, edgeWear * 0.7, wetness, materialId));
    }
  }
  for (let i = 0; i < segments; i++) {
    const t0 = topRing[i];
    const t1 = topRing[i + 1];
    const b0 = botRing[i];
    const b1 = botRing[i + 1];
    mesh.indices.push(b0, t0, t1, b0, t1, b1);
  }
  const topCenter = pushVertex(mesh, 0, hy, 0, 0, 1, 0, 0, 0, ao, edgeWear * 0.1, wetness, materialId);
  const botCenter = pushVertex(mesh, 0, -hy, 0, 0, -1, 0, 0, 0, ao, edgeWear * 0.1, wetness, materialId);
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    mesh.indices.push(topCenter, topCapRing[next], topCapRing[i]);
    mesh.indices.push(botCenter, botCapRing[i], botCapRing[next]);
  }
  return mesh;
}
function opStairs(args, params2, materialId, edgeWear, ao, wetness) {
  const width = Math.max(0.2, resolveNumber(args.width, params2, 2));
  const height = Math.max(0.2, resolveNumber(args.height, params2, 1.5));
  const depth = Math.max(0.2, resolveNumber(args.depth, params2, 2.4));
  const steps = Math.max(2, Math.min(32, Math.round(resolveNumber(args.steps, params2, 6))));
  const bevel = resolveNumber(args.bevel, params2, 0.018);
  const out = createRawMeshData();
  const stepH = height / steps;
  const stepD = depth / steps;
  for (let s = 0; s < steps; s++) {
    const blockH = (s + 1) * stepH;
    const cz = depth * 0.5 - (s + 0.5) * stepD;
    const cy = blockH * 0.5;
    const stepAO = ao * (0.72 + 0.28 * ((s + 1) / steps));
    const stepBox = buildBeveledBoxRaw(width, blockH, stepD, bevel, materialId, edgeWear, stepAO, wetness);
    for (let i = 0; i < stepBox.positions.length; i += 3) {
      stepBox.positions[i + 1] = stepBox.positions[i + 1] + cy;
      stepBox.positions[i + 2] = stepBox.positions[i + 2] + cz;
    }
    appendRawMesh(out, stepBox);
  }
  return out;
}
function opDisplacedRock(args, params2, materialId, edgeWear, ao, wetness) {
  const radius = Math.max(0.1, resolveNumber(args.radius, params2, 0.8));
  const detail = Math.max(1, Math.min(3, Math.round(resolveNumber(args.detail, params2, 2))));
  const noiseScale = resolveNumber(args.noiseScale, params2, 1.8);
  const displacement = resolveNumber(args.displacement, params2, 0.28);
  const squashY = resolveNumber(args.squashY, params2, 0.72);
  const seed = Math.round(resolveNumber(args.seed, params2, 771));
  const t = (1 + Math.sqrt(5)) / 2;
  const baseVerts = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1]
  ].map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  });
  let tris = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1]
  ];
  const midCache = /* @__PURE__ */ new Map();
  const getMid = (a, b) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const cached = midCache.get(key);
    if (cached !== void 0) return cached;
    const va = baseVerts[a];
    const vb = baseVerts[b];
    const mx = va[0] + vb[0];
    const my = va[1] + vb[1];
    const mz = va[2] + vb[2];
    const l = Math.hypot(mx, my, mz) || 1;
    const idx = baseVerts.length;
    baseVerts.push([mx / l, my / l, mz / l]);
    midCache.set(key, idx);
    return idx;
  };
  for (let d = 0; d < detail; d++) {
    const nextTris = [];
    for (const [a, b, c] of tris) {
      const ab = getMid(a, b);
      const bc = getMid(b, c);
      const ca = getMid(c, a);
      nextTris.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    tris = nextTris;
  }
  const displaced = baseVerts.map(([vx, vy, vz]) => {
    const n = fbm3D(vx * noiseScale, vy * noiseScale, vz * noiseScale, 4, 0.5, 2.05, seed);
    const ridge = 1 - Math.abs(n);
    const r = radius * (1 + n * displacement + (ridge - 0.5) * displacement * 0.35);
    const yFlat = vy < -0.35 ? -0.35 * squashY + (vy + 0.35) * squashY * 0.4 : vy * squashY;
    return [vx * r, yFlat * r, vz * r];
  });
  let minY = Infinity;
  for (const p of displaced) {
    if (p[1] < minY) minY = p[1];
  }
  for (const p of displaced) {
    p[1] -= minY;
  }
  const normAcc = displaced.map(() => [0, 0, 0]);
  for (const [ia, ib, ic] of tris) {
    const a = displaced[ia];
    const b = displaced[ib];
    const c = displaced[ic];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    normAcc[ia][0] += nx;
    normAcc[ia][1] += ny;
    normAcc[ia][2] += nz;
    normAcc[ib][0] += nx;
    normAcc[ib][1] += ny;
    normAcc[ib][2] += nz;
    normAcc[ic][0] += nx;
    normAcc[ic][1] += ny;
    normAcc[ic][2] += nz;
  }
  const mesh = createRawMeshData();
  for (let i = 0; i < displaced.length; i++) {
    const p = displaced[i];
    const n = normAcc[i];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const nx = n[0] / l;
    const ny = n[1] / l;
    const nz = n[2] / l;
    const hNorm = Math.min(1, p[1] / Math.max(0.1, radius * squashY * 2));
    const vAO = ao * (0.48 + 0.52 * Math.sqrt(hNorm));
    const vWear = Math.max(0, Math.min(1, edgeWear * (0.5 + ny * 0.5)));
    pushVertex(mesh, p[0], p[1], p[2], nx, ny, nz, p[0], p[2], vAO, vWear, wetness, materialId);
  }
  for (const [ia, ib, ic] of tris) {
    mesh.indices.push(ia, ib, ic);
  }
  return mesh;
}
function opExtrudeProfile(args, params2, materialId, edgeWear, ao, wetness) {
  const rawProfile = Array.isArray(args.profile) ? args.profile : [];
  const depth = Math.max(0.02, resolveNumber(args.depth, params2, 0.4));
  const pts = rawProfile.map((pt) => [
    resolveNumber(pt[0], params2, 0),
    resolveNumber(pt[1], params2, 0)
  ]);
  if (pts.length < 3) {
    return buildBeveledBoxRaw(0.5, 0.5, depth, 0.015, materialId, edgeWear, ao, wetness);
  }
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    area += x0 * y1 - x1 * y0;
  }
  if (area < 0) pts.reverse();
  const mesh = createRawMeshData();
  const hz = depth * 0.5;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const outX = dy / len;
    const outY = -dx / len;
    pushOrientedQuad(
      mesh,
      [x0, y0, -hz],
      [x1, y1, -hz],
      [x1, y1, hz],
      [x0, y0, hz],
      [outX, outY, 0],
      ao,
      edgeWear * 0.65,
      wetness,
      materialId
    );
  }
  const remaining = pts.map((_, idx) => idx);
  const cross2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const ptInTri = (p, a, b, c) => {
    const c1 = cross2(a, b, p);
    const c2 = cross2(b, c, p);
    const c3 = cross2(c, a, p);
    return c1 >= -1e-6 && c2 >= -1e-6 && c3 >= -1e-6;
  };
  let guard = pts.length * 4;
  while (remaining.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const iPrev = remaining[(i - 1 + remaining.length) % remaining.length];
      const iCur = remaining[i];
      const iNext = remaining[(i + 1) % remaining.length];
      const a = pts[iPrev];
      const b = pts[iCur];
      const c = pts[iNext];
      if (cross2(a, b, c) <= 1e-6) continue;
      let hasInside = false;
      for (let j = 0; j < remaining.length; j++) {
        const idx = remaining[j];
        if (idx === iPrev || idx === iCur || idx === iNext) continue;
        if (ptInTri(pts[idx], a, b, c)) {
          hasInside = true;
          break;
        }
      }
      if (hasInside) continue;
      pushOrientedTri(mesh, [a[0], a[1], hz], [b[0], b[1], hz], [c[0], c[1], hz], [0, 0, 1], ao, edgeWear * 0.15, wetness, materialId);
      pushOrientedTri(mesh, [a[0], a[1], -hz], [c[0], c[1], -hz], [b[0], b[1], -hz], [0, 0, -1], ao, edgeWear * 0.15, wetness, materialId);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (remaining.length === 3) {
    const a = pts[remaining[0]];
    const b = pts[remaining[1]];
    const c = pts[remaining[2]];
    pushOrientedTri(mesh, [a[0], a[1], hz], [b[0], b[1], hz], [c[0], c[1], hz], [0, 0, 1], ao, edgeWear * 0.15, wetness, materialId);
    pushOrientedTri(mesh, [a[0], a[1], -hz], [c[0], c[1], -hz], [b[0], b[1], -hz], [0, 0, -1], ao, edgeWear * 0.15, wetness, materialId);
  }
  return mesh;
}
function opCorrugatedPanel(args, params2, materialId, edgeWear, ao, wetness) {
  const width = Math.max(0.2, resolveNumber(args.width, params2, 4));
  const height = Math.max(0.2, resolveNumber(args.height, params2, 2.3));
  const pitch = Math.max(0.08, resolveNumber(args.pitch, params2, 0.278));
  const fin = Math.max(0.01, resolveNumber(args.fin, params2, 0.07));
  const slope = Math.max(0.01, resolveNumber(args.slope, params2, 0.068));
  const fout = Math.max(0.01, resolveNumber(args.fout, params2, 0.072));
  const depth = Math.max(8e-3, resolveNumber(args.depth, params2, 0.036));
  const thick = Math.max(8e-3, resolveNumber(args.thickness, params2, 0.014));
  const mesh = createRawMeshData();
  const count = Math.max(1, Math.round(width / pitch));
  const actualPitch = width / count;
  const scale = actualPitch / (fin + slope + fout + slope);
  const fIn = fin * scale;
  const fSlope = slope * scale;
  const fOut = fout * scale;
  const hy = height * 0.5;
  const hz = depth * 0.5;
  for (let i = 0; i < count; i++) {
    const x0 = -width * 0.5 + i * actualPitch;
    const x1 = x0 + fIn;
    const x2 = x1 + fSlope;
    const x3 = x2 + fOut;
    const x4 = x0 + actualPitch;
    const segs = [
      [x0, -hz, x1, -hz, 0.15],
      [x1, -hz, x2, hz, 0.65],
      [x2, hz, x3, hz, 0.9],
      [x3, hz, x4, -hz, 0.65]
    ];
    for (const [ax, az, bx, bz, wearScale] of segs) {
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      pushOrientedQuad(
        mesh,
        [ax, -hy, az],
        [bx, -hy, bz],
        [bx, hy, bz],
        [ax, hy, az],
        [nx, 0, nz],
        ao,
        edgeWear * wearScale,
        wetness,
        materialId
      );
      pushOrientedQuad(
        mesh,
        [bx, -hy, bz - thick],
        [ax, -hy, az - thick],
        [ax, hy, az - thick],
        [bx, hy, bz - thick],
        [-nx, 0, -nz],
        ao,
        edgeWear * wearScale * 0.5,
        wetness,
        materialId
      );
    }
  }
  return mesh;
}
function opPipeSegment(args, params2, materialId, edgeWear, ao, wetness) {
  const radius = Math.max(0.02, resolveNumber(args.radius, params2, 0.11));
  const length = Math.max(0.2, resolveNumber(args.length, params2, 2));
  const bendAngle = resolveNumber(args.bendAngle, params2, 0);
  const bendRadius = Math.max(radius * 1.5, resolveNumber(args.bendRadius, params2, 0.4));
  const flangeRadius = resolveNumber(args.flangeRadius, params2, radius + 0.045);
  const flangeThickness = resolveNumber(args.flangeThickness, params2, 0.06);
  const segments = Math.max(8, Math.min(28, Math.round(resolveNumber(args.segments, params2, 14))));
  const out = createRawMeshData();
  if (Math.abs(bendAngle) < 0.01) {
    const pipe = opCylinder(
      { radiusTop: radius, radiusBottom: radius, height: length, segments },
      params2,
      materialId,
      edgeWear,
      ao,
      wetness
    );
    for (let i = 0; i < pipe.positions.length; i += 3) {
      const px = pipe.positions[i];
      const py = pipe.positions[i + 1];
      pipe.positions[i] = py;
      pipe.positions[i + 1] = -px;
      const nx = pipe.normals[i];
      const ny = pipe.normals[i + 1];
      pipe.normals[i] = ny;
      pipe.normals[i + 1] = -nx;
    }
    appendRawMesh(out, pipe);
    for (const sx of [-1, 1]) {
      const flange = opCylinder(
        { radiusTop: flangeRadius, radiusBottom: flangeRadius, height: flangeThickness, segments },
        params2,
        materialId,
        edgeWear * 1.1,
        ao,
        wetness
      );
      const xOff = sx * (length * 0.5 - flangeThickness * 0.5);
      for (let i = 0; i < flange.positions.length; i += 3) {
        const px = flange.positions[i];
        const py = flange.positions[i + 1];
        flange.positions[i] = py + xOff;
        flange.positions[i + 1] = -px;
        const nx = flange.normals[i];
        const ny = flange.normals[i + 1];
        flange.normals[i] = ny;
        flange.normals[i + 1] = -nx;
      }
      appendRawMesh(out, flange);
    }
    return out;
  }
  const arcSteps = Math.max(6, Math.round(Math.abs(bendAngle) * 10));
  const rings = [];
  for (let s = 0; s <= arcSteps; s++) {
    const t = s / arcSteps;
    const ang = t * bendAngle;
    const cx = Math.sin(ang) * bendRadius;
    const cz = bendRadius - Math.cos(ang) * bendRadius;
    const tx = Math.cos(ang);
    const tz = Math.sin(ang);
    const rx = -tz;
    const rz = tx;
    const ring = [];
    for (let k = 0; k <= segments; k++) {
      const phi = k / segments * Math.PI * 2;
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);
      const nx = rx * cosP;
      const ny = sinP;
      const nz = rz * cosP;
      const px = cx + nx * radius;
      const py = ny * radius;
      const pz = cz + nz * radius;
      ring.push(
        pushVertex(
          out,
          px,
          py,
          pz,
          nx,
          ny,
          nz,
          t * bendRadius * Math.abs(bendAngle),
          k / segments * Math.PI * 2 * radius,
          ao,
          edgeWear,
          wetness,
          materialId
        )
      );
    }
    rings.push(ring);
  }
  for (let s = 0; s < arcSteps; s++) {
    const r0 = rings[s];
    const r1 = rings[s + 1];
    for (let k = 0; k < segments; k++) {
      out.indices.push(r0[k], r1[k], r1[k + 1], r0[k], r1[k + 1], r0[k + 1]);
    }
  }
  return out;
}

// src/modules/realistic-pcg/recipes/mesh-recipe-eval.ts
function applyTransformToRaw(raw, pos, rot, scale) {
  const mat = new THREE9.Matrix4();
  const q = new THREE9.Quaternion().setFromEuler(new THREE9.Euler(rot[0], rot[1], rot[2]));
  mat.compose(new THREE9.Vector3(pos[0], pos[1], pos[2]), q, new THREE9.Vector3(scale[0], scale[1], scale[2]));
  const e = mat.elements;
  const v = new THREE9.Vector3();
  const nMat = new THREE9.Matrix4().compose(
    new THREE9.Vector3(0, 0, 0),
    q,
    new THREE9.Vector3(1 / (scale[0] || 1), 1 / (scale[1] || 1), 1 / (scale[2] || 1))
  );
  const ne = nMat.elements;
  for (let i = 0; i < raw.positions.length; i += 3) {
    const x = raw.positions[i];
    const y = raw.positions[i + 1];
    const z = raw.positions[i + 2];
    v.set(
      e[0] * x + e[4] * y + e[8] * z + e[12],
      e[1] * x + e[5] * y + e[9] * z + e[13],
      e[2] * x + e[6] * y + e[10] * z + e[14]
    );
    raw.positions[i] = v.x;
    raw.positions[i + 1] = v.y;
    raw.positions[i + 2] = v.z;
    const nx = raw.normals[i];
    const ny = raw.normals[i + 1];
    const nz = raw.normals[i + 2];
    const tnx = ne[0] * nx + ne[4] * ny + ne[8] * nz;
    const tny = ne[1] * nx + ne[5] * ny + ne[9] * nz;
    const tnz = ne[2] * nx + ne[6] * ny + ne[10] * nz;
    const nLen = Math.hypot(tnx, tny, tnz) || 1;
    raw.normals[i] = tnx / nLen;
    raw.normals[i + 1] = tny / nLen;
    raw.normals[i + 2] = tnz / nLen;
  }
  if (scale[0] * scale[1] * scale[2] < 0) {
    for (let i = 0; i < raw.indices.length; i += 3) {
      const tmp = raw.indices[i + 1];
      raw.indices[i + 1] = raw.indices[i + 2];
      raw.indices[i + 2] = tmp;
    }
  }
}
function applyGroundAO(raw, aoFloor = 0.42, heightSpan = 0.75) {
  for (let i = 0; i < raw.positions.length; i += 3) {
    const y = raw.positions[i + 1];
    const t = Math.max(0, Math.min(1, y / heightSpan));
    const factor = aoFloor + (1 - aoFloor) * Math.sqrt(t);
    raw.colors[i] = Math.min(raw.colors[i], factor);
  }
}
function cloneRaw(raw) {
  return {
    positions: raw.positions.slice(),
    normals: raw.normals.slice(),
    uvs: raw.uvs.slice(),
    colors: raw.colors.slice(),
    materialIds: raw.materialIds.slice(),
    indices: raw.indices.slice()
  };
}
function resolveSlotMaterialName(ref, slots, overrides) {
  if (!ref) {
    const first = Object.values(slots)[0];
    if (!first) throw new Error("No material specified and materialSlots is empty");
    return first;
  }
  if (ref.startsWith("$")) {
    const slotKey = ref.slice(1);
    if (overrides && overrides[slotKey]) {
      const ov = overrides[slotKey];
      return ov.startsWith("$") ? slots[ov.slice(1)] ?? ov : ov;
    }
    const found = slots[slotKey];
    if (!found) throw new Error(`Missing materialSlot "${slotKey}"`);
    return found;
  }
  return ref;
}
function evaluateRecipeRaw(recipe, ctx, paramOverrides, materialOverrides, visitStack, partTriangles) {
  if (visitStack.has(recipe.id)) {
    throw new Error(`Cyclic mesh ref detected at "${recipe.id}"`);
  }
  visitStack.add(recipe.id);
  const params2 = { ...recipe.params ?? {}, ...paramOverrides ?? {} };
  const mergedSlots = { ...recipe.materialSlots };
  if (materialOverrides) {
    for (const [k, v] of Object.entries(materialOverrides)) {
      mergedSlots[k] = v;
    }
  }
  const out = createRawMeshData();
  for (const part of recipe.parts) {
    if (part.when !== void 0 && !resolveBoolean(part.when, params2, true)) {
      continue;
    }
    const basePartRaw = evaluateSinglePart(part, recipe, params2, mergedSlots, ctx, visitStack, partTriangles);
    const repeatedRaw = createRawMeshData();
    const count = part.repeat ? Math.max(1, Math.round(resolveNumber(part.repeat.count, params2, 1))) : 1;
    const stepPos = part.repeat?.stepPos ? resolveVec3(part.repeat.stepPos, params2, [0, 0, 0]) : [0, 0, 0];
    const stepRot = part.repeat?.stepRot ? resolveVec3(part.repeat.stepRot, params2, [0, 0, 0]) : [0, 0, 0];
    const circleRadius = part.repeat?.radius !== void 0 ? resolveNumber(part.repeat.radius, params2, 0) : 0;
    const angleStep = part.repeat?.angleStep !== void 0 ? resolveNumber(part.repeat.angleStep, params2, 0) : 0;
    for (let rIdx = 0; rIdx < count; rIdx++) {
      const copy = count === 1 ? basePartRaw : cloneRaw(basePartRaw);
      if (part.repeat) {
        let px = stepPos[0] * rIdx;
        let py = stepPos[1] * rIdx;
        let pz = stepPos[2] * rIdx;
        let rx = stepRot[0] * rIdx;
        let ry = stepRot[1] * rIdx;
        let rz = stepRot[2] * rIdx;
        if (circleRadius !== 0 && angleStep !== 0) {
          const ang = angleStep * rIdx;
          px += Math.cos(ang) * circleRadius;
          pz += Math.sin(ang) * circleRadius;
          ry += -ang;
        }
        applyTransformToRaw(copy, [px, py, pz], [rx, ry, rz], [1, 1, 1]);
      }
      appendRawMesh(repeatedRaw, copy);
    }
    const pos = resolveVec3(part.transform?.pos, params2, [0, 0, 0]);
    const rot = resolveVec3(part.transform?.rot, params2, [0, 0, 0]);
    const scale = resolveVec3(part.transform?.scale, params2, [1, 1, 1]);
    if (pos[0] !== 0 || pos[1] !== 0 || pos[2] !== 0 || rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0 || scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1) {
      applyTransformToRaw(repeatedRaw, pos, rot, scale);
    }
    const finalPartRaw = createRawMeshData();
    if (part.mirror) {
      if (part.mirror.keepOriginal !== false) {
        appendRawMesh(finalPartRaw, repeatedRaw);
      }
      const m = cloneRaw(repeatedRaw);
      const sx = part.mirror.axis === "x" ? -1 : 1;
      const sy = part.mirror.axis === "y" ? -1 : 1;
      const sz = part.mirror.axis === "z" ? -1 : 1;
      applyTransformToRaw(m, [0, 0, 0], [0, 0, 0], [sx, sy, sz]);
      appendRawMesh(finalPartRaw, m);
    } else {
      appendRawMesh(finalPartRaw, repeatedRaw);
    }
    if (part.op !== "displaced_rock" && part.op !== "cylinder") {
      recomputeMetricUVs(finalPartRaw);
    }
    if (part.vertexMeta?.groundAO && resolveBoolean(part.vertexMeta.groundAO, params2, false)) {
      const aoFloor = resolveNumber(part.vertexMeta.aoFloor, params2, 0.42);
      applyGroundAO(finalPartRaw, aoFloor, 0.65);
    }
    partTriangles.push({ id: `${recipe.id}:${part.id}`, triangles: finalPartRaw.indices.length / 3 });
    appendRawMesh(out, finalPartRaw);
  }
  visitStack.delete(recipe.id);
  return out;
}
function evaluateSinglePart(part, parentRecipe, params2, mergedSlots, ctx, visitStack, partTriangles) {
  if (part.op === "ref") {
    if (!part.ref) throw new Error(`Part "${part.id}" in "${parentRecipe.id}" is op="ref" without ref target`);
    const target = ctx.recipes.get(part.ref);
    if (!target) throw new Error(`Unknown ref mesh "${part.ref}" in "${parentRecipe.id}"`);
    const subParams = {};
    if (part.params) {
      for (const [k, v] of Object.entries(part.params)) {
        subParams[k] = resolveParamValue(v, params2);
      }
    }
    const subMatOverrides = {};
    if (part.materialOverrides) {
      for (const [k, v] of Object.entries(part.materialOverrides)) {
        subMatOverrides[k] = resolveSlotMaterialName(v, mergedSlots);
      }
    }
    return evaluateRecipeRaw(target, ctx, subParams, subMatOverrides, visitStack, partTriangles);
  }
  const matName = resolveSlotMaterialName(part.material, mergedSlots);
  const materialId = ctx.resolveMaterialId(matName);
  const edgeWear = resolveNumber(part.vertexMeta?.edgeWear, params2, 0.5);
  const wetness = resolveNumber(part.vertexMeta?.wetness, params2, 0);
  const ao = 1;
  const args = part.args ?? {};
  switch (part.op) {
    case "beveled_box":
      return opBeveledBox(args, params2, materialId, edgeWear, ao, wetness);
    case "beveled_wall_opening":
      return opBeveledWallOpening(args, params2, materialId, edgeWear, ao, wetness);
    case "cylinder":
      return opCylinder(args, params2, materialId, edgeWear, ao, wetness);
    case "stairs":
      return opStairs(args, params2, materialId, edgeWear, ao, wetness);
    case "displaced_rock":
      return opDisplacedRock(args, params2, materialId, edgeWear, ao, wetness);
    case "extrude_profile":
      return opExtrudeProfile(args, params2, materialId, edgeWear, ao, wetness);
    case "corrugated_panel":
      return opCorrugatedPanel(args, params2, materialId, edgeWear, ao, wetness);
    case "pipe_segment":
      return opPipeSegment(args, params2, materialId, edgeWear, ao, wetness);
    default:
      throw new Error(`Unsupported mesh op "${String(part.op)}"`);
  }
}
function evaluateMeshRecipe(recipe, ctx, options = {}) {
  const partTriangles = [];
  const raw = evaluateRecipeRaw(
    recipe,
    ctx,
    options.params,
    options.materialOverrides,
    /* @__PURE__ */ new Set(),
    partTriangles
  );
  const geometry = buildBufferGeometryFromRaw(raw);
  const matSet = /* @__PURE__ */ new Set();
  for (const m of raw.materialIds) matSet.add(m);
  return {
    geometry,
    triangleCount: raw.indices.length / 3,
    partCount: partTriangles.length,
    partTriangles,
    materialIdsUsed: [...matSet]
  };
}

// src/modules/realistic-pcg/recipes/procedural-asset-loader.ts
function stableStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}
function resolveRelativeUrl(baseUrl, relPath) {
  const idx = baseUrl.lastIndexOf("/");
  const dir = idx >= 0 ? baseUrl.slice(0, idx + 1) : "";
  return dir + relPath;
}
var ProceduralAssetLoader = class {
  preset;
  renderer;
  bakeMode;
  fetchJson;
  materialRecipes = /* @__PURE__ */ new Map();
  meshRecipes = /* @__PURE__ */ new Map();
  meshCache = /* @__PURE__ */ new Map();
  textureArray = null;
  constructor(options = {}) {
    this.preset = getQualityPreset(options.quality ?? "HIGH");
    this.renderer = options.renderer ?? null;
    this.bakeMode = options.bakeMode ?? "auto";
    this.fetchJson = options.fetchJson ?? (async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
      return res.json();
    });
  }
  getQualityPreset() {
    return this.preset;
  }
  getTextureArray() {
    return this.textureArray;
  }
  hasMaterial(id) {
    return this.materialRecipes.has(id);
  }
  hasMesh(id) {
    return this.meshRecipes.has(id);
  }
  getMaterialId(id) {
    const info = this.textureArray?.layers.get(id);
    if (!info) {
      throw new Error(`Material "${id}" is not registered in TextureArray`);
    }
    return info.materialId;
  }
  getMaterialRecipe(id) {
    return this.materialRecipes.get(id);
  }
  getMeshRecipe(id) {
    return this.meshRecipes.get(id);
  }
  listMaterialIds() {
    return [...this.materialRecipes.keys()];
  }
  listMeshIds() {
    return [...this.meshRecipes.keys()];
  }
  getCachedMeshCount() {
    return this.meshCache.size;
  }
  async loadFromRecipes(mats, meshes, onProgress) {
    this.materialRecipes.clear();
    this.meshRecipes.clear();
    this.clearMeshCache();
    if (this.textureArray) {
      this.textureArray.dispose();
      this.textureArray = null;
    }
    for (const mat of mats) this.materialRecipes.set(mat.id, mat);
    for (const mesh of meshes) this.meshRecipes.set(mesh.id, mesh);
    this.textureArray = await bakeMaterialArrayAsync(mats, this.preset, {
      onProgress,
      renderer: this.renderer,
      bakeMode: this.bakeMode
    });
  }
  async loadManifest(manifestUrl2, onProgress) {
    const manifest = await this.fetchJson(manifestUrl2);
    if (manifest.format !== "hgame.manifest" || manifest.version !== 1) {
      throw new Error(`Invalid manifest at ${manifestUrl2}`);
    }
    const [mats, meshes] = await Promise.all([
      Promise.all(
        manifest.materials.map(
          (m) => this.fetchJson(resolveRelativeUrl(manifestUrl2, m.path))
        )
      ),
      Promise.all(
        manifest.meshes.map(
          (m) => this.fetchJson(resolveRelativeUrl(manifestUrl2, m.path))
        )
      )
    ]);
    await this.loadFromRecipes(mats, meshes, onProgress);
  }
  async setQuality(tier, onProgress, overrideBakeMode) {
    this.preset = getQualityPreset(tier);
    if (overrideBakeMode) this.bakeMode = overrideBakeMode;
    if (this.textureArray) {
      this.textureArray.dispose();
      this.textureArray = null;
    }
    const mats = [...this.materialRecipes.values()];
    this.textureArray = await bakeMaterialArrayAsync(mats, this.preset, {
      onProgress,
      renderer: this.renderer,
      bakeMode: this.bakeMode
    });
    return this.textureArray;
  }
  async setBakeMode(mode, onProgress) {
    return this.setQuality(this.preset.tier, onProgress, mode);
  }
  async registerMaterialRecipe(recipe) {
    this.materialRecipes.set(recipe.id, recipe);
    if (!this.textureArray) {
      this.textureArray = await bakeMaterialArrayAsync([recipe], this.preset, {
        renderer: this.renderer,
        bakeMode: this.bakeMode
      });
      return this.getMaterialId(recipe.id);
    }
    return this.textureArray.updateLayer(recipe, this.renderer);
  }
  registerMeshRecipe(recipe) {
    this.meshRecipes.set(recipe.id, recipe);
    for (const [key, entry] of this.meshCache.entries()) {
      if (key.startsWith(`${recipe.id}|`) || this.meshUsesRef(key.split("|")[0], recipe.id)) {
        entry.geometry.dispose();
        this.meshCache.delete(key);
      }
    }
  }
  meshUsesRef(rootId, targetId, seen = /* @__PURE__ */ new Set()) {
    if (seen.has(rootId)) return false;
    seen.add(rootId);
    const r = this.meshRecipes.get(rootId);
    if (!r) return false;
    for (const p of r.parts) {
      if (p.op === "ref" && p.ref) {
        if (p.ref === targetId) return true;
        if (this.meshUsesRef(p.ref, targetId, seen)) return true;
      }
    }
    return false;
  }
  instantiateMesh(meshId, options = {}) {
    const recipe = this.meshRecipes.get(meshId);
    if (!recipe) {
      throw new Error(`Unknown mesh recipe "${meshId}"`);
    }
    const cacheKey = `${meshId}|${stableStringify(options.params ?? {})}|${stableStringify(
      options.materialOverrides ?? {}
    )}`;
    const cached = this.meshCache.get(cacheKey);
    if (cached) return cached;
    const evaluated = evaluateMeshRecipe(
      recipe,
      {
        recipes: this.meshRecipes,
        resolveMaterialId: (matName) => this.getMaterialId(matName)
      },
      options
    );
    const colliderMode = recipe.meta.collider ?? "auto_boxes";
    const colliders = colliderMode === "trimesh" ? extractTriMesh(evaluated.geometry) : colliderMode === "none" ? [] : extractBoundsBox(evaluated.geometry);
    const asset = {
      geometry: evaluated.geometry,
      colliders,
      cacheKey,
      triangleCount: evaluated.triangleCount
    };
    this.meshCache.set(cacheKey, asset);
    return asset;
  }
  clearMeshCache() {
    for (const entry of this.meshCache.values()) {
      entry.geometry.dispose();
    }
    this.meshCache.clear();
  }
  dispose() {
    this.clearMeshCache();
    if (this.textureArray) {
      this.textureArray.dispose();
      this.textureArray = null;
    }
    this.materialRecipes.clear();
    this.meshRecipes.clear();
  }
};

// src/modules/realistic-pcg/skeletal/skeletal-loader.ts
import * as THREE11 from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// src/modules/realistic-pcg/skeletal/dummy-humanoid.ts
import * as THREE10 from "three";
function mergeSkinnedParts(parts, bones) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const skinIndices = [];
  const skinWeights = [];
  const indices = [];
  bones[0].updateMatrixWorld(true);
  const tmpColor = new THREE10.Color();
  const tmpVec = new THREE10.Vector3();
  for (const part of parts) {
    const bone = bones[part.boneIndex];
    const boneWorldPos = new THREE10.Vector3();
    boneWorldPos.setFromMatrixPosition(bone.matrixWorld);
    tmpColor.setHex(part.colorHex);
    const g = part.geom;
    const posAttr = g.getAttribute("position");
    const nrmAttr = g.getAttribute("normal");
    const uvAttr = g.getAttribute("uv");
    const idxAttr = g.getIndex();
    const baseVert = positions.length / 3;
    for (let i = 0; i < posAttr.count; i++) {
      tmpVec.set(
        posAttr.getX(i) + part.offset[0] + boneWorldPos.x,
        posAttr.getY(i) + part.offset[1] + boneWorldPos.y,
        posAttr.getZ(i) + part.offset[2] + boneWorldPos.z
      );
      positions.push(tmpVec.x, tmpVec.y, tmpVec.z);
      normals.push(nrmAttr.getX(i), nrmAttr.getY(i), nrmAttr.getZ(i));
      uvs.push(uvAttr ? uvAttr.getX(i) : 0, uvAttr ? uvAttr.getY(i) : 0);
      colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
      skinIndices.push(part.boneIndex, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }
    if (idxAttr) {
      for (let i = 0; i < idxAttr.count; i++) {
        indices.push(idxAttr.array[i] + baseVert);
      }
    } else {
      for (let i = 0; i < posAttr.count; i++) {
        indices.push(baseVert + i);
      }
    }
    g.dispose();
  }
  const out = new THREE10.BufferGeometry();
  out.setAttribute("position", new THREE10.Float32BufferAttribute(new Float32Array(positions), 3));
  out.setAttribute("normal", new THREE10.Float32BufferAttribute(new Float32Array(normals), 3));
  out.setAttribute("uv", new THREE10.Float32BufferAttribute(new Float32Array(uvs), 2));
  out.setAttribute("color", new THREE10.Float32BufferAttribute(new Float32Array(colors), 3));
  out.setAttribute("skinIndex", new THREE10.Uint16BufferAttribute(new Uint16Array(skinIndices), 4));
  out.setAttribute("skinWeight", new THREE10.Float32BufferAttribute(new Float32Array(skinWeights), 4));
  out.setIndex(new THREE10.Uint32BufferAttribute(new Uint32Array(indices), 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
function createDummyHumanoid() {
  const root = new THREE10.Group();
  root.name = "DummyHumanoid";
  const hips = new THREE10.Bone();
  hips.name = "Hips";
  hips.position.set(0, 0.92, 0);
  const spine = new THREE10.Bone();
  spine.name = "Spine";
  spine.position.set(0, 0.14, 0);
  hips.add(spine);
  const chest = new THREE10.Bone();
  chest.name = "Chest";
  chest.position.set(0, 0.24, 0);
  spine.add(chest);
  const head = new THREE10.Bone();
  head.name = "Head";
  head.position.set(0, 0.24, 0);
  chest.add(head);
  const leftArm = new THREE10.Bone();
  leftArm.name = "LeftArm";
  leftArm.position.set(-0.23, 0.16, 0);
  chest.add(leftArm);
  const leftForearm = new THREE10.Bone();
  leftForearm.name = "LeftForearm";
  leftForearm.position.set(0, -0.27, 0);
  leftArm.add(leftForearm);
  const rightArm = new THREE10.Bone();
  rightArm.name = "RightArm";
  rightArm.position.set(0.23, 0.16, 0);
  chest.add(rightArm);
  const rightForearm = new THREE10.Bone();
  rightForearm.name = "RightForearm";
  rightForearm.position.set(0, -0.27, 0);
  rightArm.add(rightForearm);
  const leftThigh = new THREE10.Bone();
  leftThigh.name = "LeftThigh";
  leftThigh.position.set(-0.1, -0.04, 0);
  hips.add(leftThigh);
  const leftShin = new THREE10.Bone();
  leftShin.name = "LeftShin";
  leftShin.position.set(0, -0.44, 0);
  leftThigh.add(leftShin);
  const rightThigh = new THREE10.Bone();
  rightThigh.name = "RightThigh";
  rightThigh.position.set(0.1, -0.04, 0);
  hips.add(rightThigh);
  const rightShin = new THREE10.Bone();
  rightShin.name = "RightShin";
  rightShin.position.set(0, -0.44, 0);
  rightThigh.add(rightShin);
  const bones = [
    hips,
    spine,
    chest,
    head,
    leftArm,
    leftForearm,
    rightArm,
    rightForearm,
    leftThigh,
    leftShin,
    rightThigh,
    rightShin
  ];
  root.add(hips);
  const bodyParts = [
    { geom: new THREE10.BoxGeometry(0.28, 0.14, 0.18), boneIndex: 0, offset: [0, 0.02, 0], colorHex: 6044712 },
    { geom: new THREE10.BoxGeometry(0.26, 0.24, 0.17), boneIndex: 1, offset: [0, 0.1, 0], colorHex: 3889218 },
    { geom: new THREE10.BoxGeometry(0.34, 0.25, 0.2), boneIndex: 2, offset: [0, 0.06, 0], colorHex: 3889218 },
    { geom: new THREE10.SphereGeometry(0.11, 14, 12), boneIndex: 3, offset: [0, 0.11, 0], colorHex: 12751733 },
    { geom: new THREE10.CylinderGeometry(0.055, 0.048, 0.27, 10), boneIndex: 4, offset: [0, -0.135, 0], colorHex: 3889218 },
    { geom: new THREE10.CylinderGeometry(0.045, 0.038, 0.25, 10), boneIndex: 5, offset: [0, -0.125, 0], colorHex: 6044712 },
    { geom: new THREE10.CylinderGeometry(0.055, 0.048, 0.27, 10), boneIndex: 6, offset: [0, -0.135, 0], colorHex: 3889218 },
    { geom: new THREE10.CylinderGeometry(0.045, 0.038, 0.25, 10), boneIndex: 7, offset: [0, -0.125, 0], colorHex: 6044712 },
    { geom: new THREE10.CylinderGeometry(0.075, 0.062, 0.42, 10), boneIndex: 8, offset: [0, -0.21, 0], colorHex: 3889218 },
    { geom: new THREE10.CylinderGeometry(0.058, 0.05, 0.38, 10), boneIndex: 9, offset: [0, -0.19, 0], colorHex: 6044712 },
    { geom: new THREE10.BoxGeometry(0.1, 0.08, 0.22), boneIndex: 9, offset: [0, -0.4, 0.04], colorHex: 4533534 },
    { geom: new THREE10.CylinderGeometry(0.075, 0.062, 0.42, 10), boneIndex: 10, offset: [0, -0.21, 0], colorHex: 3889218 },
    { geom: new THREE10.CylinderGeometry(0.058, 0.05, 0.38, 10), boneIndex: 11, offset: [0, -0.19, 0], colorHex: 6044712 },
    { geom: new THREE10.BoxGeometry(0.1, 0.08, 0.22), boneIndex: 11, offset: [0, -0.4, 0.04], colorHex: 4533534 }
  ];
  const armorParts = [
    { geom: new THREE10.BoxGeometry(0.08, 0.06, 0.2), boneIndex: 0, offset: [0, 0.06, 0.01], colorHex: 9146519 },
    { geom: new THREE10.BoxGeometry(0.18, 0.14, 0.22), boneIndex: 2, offset: [0, 0.09, 0], colorHex: 9146519 },
    { geom: new THREE10.CylinderGeometry(0.125, 0.13, 0.11, 14), boneIndex: 3, offset: [0, 0.16, 0], colorHex: 9146519 }
  ];
  const bodyMat = new THREE10.MeshStandardMaterial({
    color: 16777215,
    vertexColors: true,
    roughness: 0.28,
    metalness: 0.06
  });
  const armorMat = new THREE10.MeshStandardMaterial({
    color: 16777215,
    vertexColors: true,
    roughness: 0.24,
    metalness: 0.88
  });
  const bodyGeo = mergeSkinnedParts(bodyParts, bones);
  const armorGeo = mergeSkinnedParts(armorParts, bones);
  const skeleton = new THREE10.Skeleton(bones);
  const bodyMesh = new THREE10.SkinnedMesh(bodyGeo, bodyMat);
  bodyMesh.name = "DummyBody";
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyMesh.bind(skeleton);
  const armorMesh = new THREE10.SkinnedMesh(armorGeo, armorMat);
  armorMesh.name = "DummyArmor";
  armorMesh.castShadow = true;
  armorMesh.receiveShadow = true;
  armorMesh.bind(skeleton);
  root.add(bodyMesh);
  root.add(armorMesh);
  const qIdentity = [0, 0, 0, 1];
  const qChestUp = new THREE10.Quaternion().setFromEuler(new THREE10.Euler(-0.04, 0, 0));
  const qArmIdleL = new THREE10.Quaternion().setFromEuler(new THREE10.Euler(0.06, 0, 0.08));
  const qArmIdleR = new THREE10.Quaternion().setFromEuler(new THREE10.Euler(-0.04, 0, -0.08));
  const idleClip = new THREE10.AnimationClip("Idle", 2.4, [
    new THREE10.VectorKeyframeTrack("Hips.position", [0, 1.2, 2.4], [0, 0.92, 0, 0, 0.938, 0, 0, 0.92, 0]),
    new THREE10.QuaternionKeyframeTrack("Chest.quaternion", [0, 1.2, 2.4], [
      ...qIdentity,
      qChestUp.x,
      qChestUp.y,
      qChestUp.z,
      qChestUp.w,
      ...qIdentity
    ]),
    new THREE10.QuaternionKeyframeTrack("LeftArm.quaternion", [0, 1.2, 2.4], [
      qArmIdleL.x,
      qArmIdleL.y,
      qArmIdleL.z,
      qArmIdleL.w,
      0,
      0,
      0.06,
      1,
      qArmIdleL.x,
      qArmIdleL.y,
      qArmIdleL.z,
      qArmIdleL.w
    ]),
    new THREE10.QuaternionKeyframeTrack("RightArm.quaternion", [0, 1.2, 2.4], [
      qArmIdleR.x,
      qArmIdleR.y,
      qArmIdleR.z,
      qArmIdleR.w,
      0,
      0,
      -0.06,
      1,
      qArmIdleR.x,
      qArmIdleR.y,
      qArmIdleR.z,
      qArmIdleR.w
    ])
  ]);
  const qFwd = new THREE10.Quaternion().setFromEuler(new THREE10.Euler(0.35, 0, 0));
  const qBwd = new THREE10.Quaternion().setFromEuler(new THREE10.Euler(-0.35, 0, 0));
  const qKnee = new THREE10.Quaternion().setFromEuler(new THREE10.Euler(0.45, 0, 0));
  const walkClip = new THREE10.AnimationClip("Walk", 1.2, [
    new THREE10.VectorKeyframeTrack("Hips.position", [0, 0.3, 0.6, 0.9, 1.2], [
      0,
      0.91,
      0,
      0,
      0.94,
      0,
      0,
      0.91,
      0,
      0,
      0.94,
      0,
      0,
      0.91,
      0
    ]),
    new THREE10.QuaternionKeyframeTrack("LeftThigh.quaternion", [0, 0.6, 1.2], [
      qFwd.x,
      qFwd.y,
      qFwd.z,
      qFwd.w,
      qBwd.x,
      qBwd.y,
      qBwd.z,
      qBwd.w,
      qFwd.x,
      qFwd.y,
      qFwd.z,
      qFwd.w
    ]),
    new THREE10.QuaternionKeyframeTrack("RightThigh.quaternion", [0, 0.6, 1.2], [
      qBwd.x,
      qBwd.y,
      qBwd.z,
      qBwd.w,
      qFwd.x,
      qFwd.y,
      qFwd.z,
      qFwd.w,
      qBwd.x,
      qBwd.y,
      qBwd.z,
      qBwd.w
    ]),
    new THREE10.QuaternionKeyframeTrack("LeftShin.quaternion", [0, 0.3, 0.6, 1.2], [
      ...qIdentity,
      qKnee.x,
      qKnee.y,
      qKnee.z,
      qKnee.w,
      ...qIdentity,
      ...qIdentity
    ]),
    new THREE10.QuaternionKeyframeTrack("LeftArm.quaternion", [0, 0.6, 1.2], [
      qBwd.x,
      qBwd.y,
      qBwd.z,
      qBwd.w,
      qFwd.x,
      qFwd.y,
      qFwd.z,
      qFwd.w,
      qBwd.x,
      qBwd.y,
      qBwd.z,
      qBwd.w
    ]),
    new THREE10.QuaternionKeyframeTrack("RightArm.quaternion", [0, 0.6, 1.2], [
      qFwd.x,
      qFwd.y,
      qFwd.z,
      qFwd.w,
      qBwd.x,
      qBwd.y,
      qBwd.z,
      qBwd.w,
      qFwd.x,
      qFwd.y,
      qFwd.z,
      qFwd.w
    ])
  ]);
  return { root, animations: [idleClip, walkClip] };
}

// src/modules/realistic-pcg/skeletal/skeletal-loader.ts
function disposeObjectResources(root) {
  const disposedGeoms = /* @__PURE__ */ new Set();
  const disposedMats = /* @__PURE__ */ new Set();
  const disposedTexs = /* @__PURE__ */ new Set();
  root.traverse((obj) => {
    const mesh = obj;
    if (mesh.isMesh) {
      if (mesh.geometry && !disposedGeoms.has(mesh.geometry)) {
        mesh.geometry.dispose();
        disposedGeoms.add(mesh.geometry);
      }
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m || disposedMats.has(m)) continue;
        disposedMats.add(m);
        const std = m;
        for (const tex of [std.map, std.normalMap, std.roughnessMap, std.metalnessMap, std.aoMap]) {
          if (tex && !disposedTexs.has(tex)) {
            tex.dispose();
            disposedTexs.add(tex);
          }
        }
        m.dispose();
      }
    }
  });
}
function wrapLoadedScene(modelRoot, animations, normalizer, quality, targetHeightMeters) {
  const wrapper = new THREE11.Group();
  wrapper.name = "SkeletalActorWrapper";
  wrapper.add(modelRoot);
  const audit = normalizer.applyToObject(modelRoot, {
    targetHeightMeters,
    quality
  });
  const mixer = new THREE11.AnimationMixer(modelRoot);
  const actions = /* @__PURE__ */ new Map();
  for (const clip of animations) {
    actions.set(clip.name, mixer.clipAction(clip));
  }
  const clipNames = animations.map((c) => c.name);
  let activeAction = null;
  const playClip = (name) => {
    const targetName = name && actions.has(name) ? name : clipNames[0];
    if (!targetName) return;
    const next = actions.get(targetName);
    if (activeAction === next) return;
    if (activeAction) {
      activeAction.crossFadeTo(next, 0.25, true);
    }
    next.reset().play();
    activeAction = next;
  };
  if (clipNames.length > 0) {
    playClip(clipNames[0]);
  }
  return {
    wrapper,
    modelRoot,
    mixer,
    clipNames,
    audit,
    playClip,
    update(dt) {
      mixer.update(dt);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(modelRoot);
      disposeObjectResources(modelRoot);
      wrapper.clear();
    }
  };
}
async function loadSkeletalFromGlbBuffer(buffer, normalizer, options = {}) {
  const loader = new GLTFLoader();
  const gltf = await new Promise(
    (resolve, reject) => {
      loader.parse(buffer, "", resolve, reject);
    }
  );
  return wrapLoadedScene(
    gltf.scene,
    gltf.animations ?? [],
    normalizer,
    options.quality ?? "HIGH",
    options.targetHeightMeters ?? 1.75
  );
}
function createNormalizedDummyActor(normalizer, options = {}) {
  const { root, animations } = createDummyHumanoid();
  return wrapLoadedScene(
    root,
    animations,
    normalizer,
    options.quality ?? "HIGH",
    options.targetHeightMeters ?? 1.75
  );
}

// src/modules/realistic-pcg/skeletal/tripo-normalizer.ts
import * as THREE12 from "three";
var DEFAULT_TRIPO_CONFIG = {
  albedoSaturation: 0.85,
  albedoMinLuma: 0.05,
  albedoMaxLuma: 0.82,
  roughnessMin: 0.42,
  roughnessMax: 0.95,
  metalnessScale: 0.85,
  normalScale: 1.15,
  envMapIntensity: 1,
  castShadow: true,
  receiveShadow: true
};
function createTripoMaterialNormalizer(initialConfig = {}) {
  const config = { ...DEFAULT_TRIPO_CONFIG, ...initialConfig };
  let enabled = true;
  const sharedUniforms = {
    uTripoNormEnabled: { value: 1 },
    uTripoAlbedoSat: { value: config.albedoSaturation },
    uTripoAlbedoMinLuma: { value: config.albedoMinLuma },
    uTripoAlbedoMaxLuma: { value: config.albedoMaxLuma },
    uTripoRoughMin: { value: config.roughnessMin },
    uTripoRoughMax: { value: config.roughnessMax },
    uTripoMetalScale: { value: config.metalnessScale }
  };
  function patchMaterial(mat) {
    const std = mat;
    if (!("roughness" in std) || std.userData.__tripoNormalized) return;
    std.userData.__tripoNormalized = true;
    std.envMapIntensity = config.envMapIntensity;
    if (std.normalScale && typeof std.normalScale.set === "function") {
      std.normalScale.set(config.normalScale, config.normalScale);
    }
    const prevKey = typeof std.customProgramCacheKey === "function" ? std.customProgramCacheKey() : "";
    std.customProgramCacheKey = () => `${prevKey}|tripo-norm-v1`;
    const prevOnBeforeCompile = std.onBeforeCompile;
    std.onBeforeCompile = (shader, renderer) => {
      if (typeof prevOnBeforeCompile === "function") {
        prevOnBeforeCompile.call(std, shader, renderer);
      }
      Object.assign(shader.uniforms, sharedUniforms);
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
uniform float uTripoNormEnabled;
uniform float uTripoAlbedoSat;
uniform float uTripoAlbedoMinLuma;
uniform float uTripoAlbedoMaxLuma;
uniform float uTripoRoughMin;
uniform float uTripoRoughMax;
uniform float uTripoMetalScale;`
      ).replace(
        "#include <color_fragment>",
        `#include <color_fragment>
if ( uTripoNormEnabled > 0.5 ) {
  // Mild delighting & saturation alignment for Tripo3D baked albedo
  float tLuma = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 tDesat = mix( vec3( tLuma ), diffuseColor.rgb, uTripoAlbedoSat );
  float tTargetLuma = clamp( mix( tLuma, 0.28, 0.14 ), uTripoAlbedoMinLuma, uTripoAlbedoMaxLuma );
  float tScale = tLuma > 1e-4 ? ( tTargetLuma / tLuma ) : 1.0;
  diffuseColor.rgb = clamp( tDesat * tScale, 0.01, 0.95 );
}`
      ).replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
if ( uTripoNormEnabled > 0.5 ) {
  metalnessFactor = clamp( metalnessFactor * uTripoMetalScale, 0.0, 1.0 );
  float tMinR = metalnessFactor > 0.5 ? 0.20 : uTripoRoughMin;
  roughnessFactor = mix( tMinR, uTripoRoughMax, clamp( roughnessFactor, 0.0, 1.0 ) );
}`
      );
    };
    std.needsUpdate = true;
  }
  function syncUniforms() {
    sharedUniforms.uTripoNormEnabled.value = enabled ? 1 : 0;
    sharedUniforms.uTripoAlbedoSat.value = config.albedoSaturation;
    sharedUniforms.uTripoAlbedoMinLuma.value = config.albedoMinLuma;
    sharedUniforms.uTripoAlbedoMaxLuma.value = config.albedoMaxLuma;
    sharedUniforms.uTripoRoughMin.value = config.roughnessMin;
    sharedUniforms.uTripoRoughMax.value = config.roughnessMax;
    sharedUniforms.uTripoMetalScale.value = config.metalnessScale;
  }
  return {
    applyToObject(root, options = {}) {
      const targetHeight = options.targetHeightMeters ?? 1.75;
      const quality = options.quality ?? "HIGH";
      root.position.set(0, 0, 0);
      root.scale.set(1, 1, 1);
      root.updateMatrixWorld(true);
      const box = new THREE12.Box3().setFromObject(root);
      const size = new THREE12.Vector3();
      const center = new THREE12.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const rawHeight = size.y > 0.01 ? size.y : targetHeight;
      const scaleFactor = targetHeight / rawHeight;
      root.scale.set(scaleFactor, scaleFactor, scaleFactor);
      root.updateMatrixWorld(true);
      const scaledBox = new THREE12.Box3().setFromObject(root);
      const scaledCenter = new THREE12.Vector3();
      scaledBox.getCenter(scaledCenter);
      root.position.set(-scaledCenter.x, -scaledBox.min.y, -scaledCenter.z);
      root.updateMatrixWorld(true);
      let triangles = 0;
      let boneCount = 0;
      const materials = /* @__PURE__ */ new Set();
      let maxTextureSize = 0;
      root.traverse((obj) => {
        if (obj.isBone || obj.constructor?.name === "Bone") {
          boneCount++;
        }
        const mesh = obj;
        if (mesh.isMesh && mesh.geometry) {
          mesh.castShadow = config.castShadow;
          mesh.receiveShadow = config.receiveShadow;
          const index = mesh.geometry.getIndex();
          const pos = mesh.geometry.getAttribute("position");
          if (index) triangles += Math.floor(index.count / 3);
          else if (pos) triangles += Math.floor(pos.count / 3);
          const matList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of matList) {
            if (!m) continue;
            materials.add(m);
            patchMaterial(m);
            const std = m;
            for (const tex of [std.map, std.normalMap, std.roughnessMap, std.metalnessMap, std.aoMap]) {
              const img = tex?.image;
              if (img?.width && img?.height) {
                maxTextureSize = Math.max(maxTextureSize, img.width, img.height);
              }
            }
          }
        }
      });
      const warnings = [];
      const triLimit = quality === "LOW" ? 12e3 : 3e4;
      if (triangles > triLimit) {
        warnings.push(`Skeletal triangle count (${triangles}) exceeds ${quality} budget (${triLimit})`);
      }
      if (maxTextureSize > 1024) {
        warnings.push(`Skeletal texture size (${maxTextureSize}px) exceeds recommended 1024px cap`);
      }
      return {
        triangles,
        boneCount,
        materialCount: materials.size,
        maxTextureSize,
        warnings,
        normalizedHeightMeters: targetHeight
      };
    },
    setEnabled(val) {
      enabled = Boolean(val);
      syncUniforms();
    },
    isEnabled() {
      return enabled;
    },
    updateConfig(patch) {
      Object.assign(config, patch);
      syncUniforms();
    },
    getConfig() {
      return { ...config };
    }
  };
}

// src/modules/realistic-pcg/lookdev/lookdev-scene.ts
function mergeStaticGeometries(pieces) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const matIds = [];
  const indices = [];
  for (const piece of pieces) {
    const g = piece.geometry;
    const posAttr = g.getAttribute("position");
    const nrmAttr = g.getAttribute("normal");
    const uvAttr = g.getAttribute("uv");
    const colAttr = g.getAttribute("color");
    const matAttr = g.getAttribute("aMaterialId");
    const idxAttr = g.getIndex();
    if (!posAttr || !nrmAttr) continue;
    const [px, py, pz] = piece.pos ?? [0, 0, 0];
    const ry = piece.rotY ?? 0;
    const cos = Math.cos(ry);
    const sin = Math.sin(ry);
    const baseVert = positions.length / 3;
    for (let i = 0; i < posAttr.count; i++) {
      const lx = posAttr.getX(i);
      const ly = posAttr.getY(i);
      const lz = posAttr.getZ(i);
      const rx = lx * cos + lz * sin + px;
      const rz = -lx * sin + lz * cos + pz;
      positions.push(rx, ly + py, rz);
      const nx = nrmAttr.getX(i);
      const ny = nrmAttr.getY(i);
      const nz = nrmAttr.getZ(i);
      normals.push(nx * cos + nz * sin, ny, -nx * sin + nz * cos);
      uvs.push(uvAttr ? uvAttr.getX(i) : 0, uvAttr ? uvAttr.getY(i) : 0);
      colors.push(
        colAttr ? colAttr.getX(i) : 1,
        colAttr ? colAttr.getY(i) : 0.25,
        colAttr ? colAttr.getZ(i) : 0
      );
      matIds.push(
        piece.overrideMaterialId !== void 0 ? piece.overrideMaterialId : matAttr ? matAttr.getX(i) : 0
      );
    }
    if (idxAttr) {
      for (let i = 0; i < idxAttr.count; i++) {
        indices.push((idxAttr.array[i] ?? 0) + baseVert);
      }
    } else {
      for (let i = 0; i < posAttr.count; i++) {
        indices.push(baseVert + i);
      }
    }
    if (piece.disposeSource) {
      g.dispose();
    }
  }
  const out = new THREE13.BufferGeometry();
  out.setAttribute("position", new THREE13.Float32BufferAttribute(new Float32Array(positions), 3));
  out.setAttribute("normal", new THREE13.Float32BufferAttribute(new Float32Array(normals), 3));
  out.setAttribute("uv", new THREE13.Float32BufferAttribute(new Float32Array(uvs), 2));
  out.setAttribute("color", new THREE13.Float32BufferAttribute(new Float32Array(colors), 3));
  out.setAttribute("aMaterialId", new THREE13.Float32BufferAttribute(new Float32Array(matIds), 1));
  out.setIndex(new THREE13.Uint32BufferAttribute(new Uint32Array(indices), 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
var CAMERA_PRESETS = {
  overview: { pos: [13.5, 9.5, 15], target: [-0.8, 1.4, -2] },
  brick_closeup: { pos: [-5.8, 2, 0.1], target: [-6.1, 1.6, -3.5] },
  puddle: { pos: [-0.8, 0.85, 7.9], target: [-0.8, 0.35, 1.5] },
  character: { pos: [2.6, 1.45, 2.9], target: [0.9, 1, 0.3] },
  industrial: { pos: [-3.4, 2.9, -6], target: [-8.4, 1.35, -10.2] },
  interior: { pos: [3.2, 2, -7.6], target: [6.4, 0.9, -10.2] },
  plinths: { pos: [12.5, 4.8, 12.8], target: [6.8, 0.5, 6.2] },
  yard: { pos: [-14.8, 6, 14.6], target: [-8, 1.5, 3] }
};
async function createLookDevScene(options) {
  const { canvas: canvas2 } = options;
  const manifestUrl2 = options.manifestUrl ?? null;
  let qualityTier = options.initialQuality ?? "HIGH";
  let lightingPreset = options.initialLighting ?? "OVERCAST_WET";
  let biomeMode = options.initialBiome ?? "wet_moss";
  let wetness = 0.55;
  let disposed = false;
  let ready = false;
  let rafId = 0;
  const renderer = new THREE13.WebGLRenderer({
    canvas: canvas2,
    antialias: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true
  });
  renderer.outputColorSpace = THREE13.SRGBColorSpace;
  const applyRendererViewport = (w, h) => {
    const preset = getQualityPreset(qualityTier);
    const dpr = Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap);
    renderer.setPixelRatio(dpr);
    renderer.setSize(Math.max(1, w), Math.max(1, h), false);
    camera.aspect = Math.max(1, w) / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  const scene = new THREE13.Scene();
  const camera = new THREE13.PerspectiveCamera(48, 16 / 9, 0.1, 400);
  applyRendererViewport(canvas2.clientWidth || 1280, canvas2.clientHeight || 720);
  const camTarget = new THREE13.Vector3(...CAMERA_PRESETS.overview.target);
  const camOffset = new THREE13.Vector3(...CAMERA_PRESETS.overview.pos).sub(camTarget);
  let camRadius = camOffset.length();
  let camTheta = Math.atan2(camOffset.x, camOffset.z);
  let camPhi = Math.acos(Math.max(-0.99, Math.min(0.99, camOffset.y / camRadius)));
  const syncCamera = () => {
    const sinPhi = Math.sin(camPhi);
    camera.position.set(
      camTarget.x + camRadius * sinPhi * Math.sin(camTheta),
      camTarget.y + camRadius * Math.cos(camPhi),
      camTarget.z + camRadius * sinPhi * Math.cos(camTheta)
    );
    camera.lookAt(camTarget);
  };
  syncCamera();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onPointerDown = (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onPointerMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    camTheta -= dx * 6e-3;
    camPhi = Math.max(0.15, Math.min(Math.PI * 0.48, camPhi - dy * 6e-3));
    syncCamera();
  };
  const onPointerUp = () => {
    dragging = false;
  };
  const onWheel = (e) => {
    e.preventDefault();
    camRadius = Math.max(1.8, Math.min(36, camRadius * (1 + e.deltaY * 1e-3)));
    syncCamera();
  };
  canvas2.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  canvas2.addEventListener("wheel", onWheel, { passive: false });
  const atmosphere = createAtmospherePipeline(renderer, scene, {
    initialPreset: lightingPreset,
    quality: qualityTier,
    sceneHalfExtent: 20
  });
  const loader = new ProceduralAssetLoader({
    quality: qualityTier,
    renderer,
    bakeMode: options.initialBakeMode ?? "auto"
  });
  if (options.bundle) {
    await loader.loadFromRecipes(options.bundle.materials, options.bundle.meshes);
  } else if (manifestUrl2) {
    try {
      await loader.loadManifest(manifestUrl2);
    } catch {
      await loader.loadFromRecipes([], []);
      options.onAuditMessage?.(`External manifest unavailable (${manifestUrl2}); drop recipes to hot-reload`);
    }
  } else {
    await loader.loadFromRecipes([], []);
  }
  const texArray = loader.getTextureArray();
  const worldMat = createWorldPbrMaterial({
    textureArray: texArray,
    useTriplanar: false,
    globalWetness: wetness,
    groundHeight: 0,
    biomeMode
  });
  const rockMat = createWorldPbrMaterial({
    textureArray: texArray,
    useTriplanar: getQualityPreset(qualityTier).enableTriplanar,
    globalWetness: wetness,
    groundHeight: 0,
    biomeMode
  });
  const voxelChunks = [];
  let terrainMesh = null;
  let guardPostMesh = null;
  let showcaseMesh = null;
  let rockMesh = null;
  let hotPreviewMesh = null;
  function buildTerrain() {
    for (const c of voxelChunks) c.dispose();
    voxelChunks.length = 0;
    if (terrainMesh) {
      scene.remove(terrainMesh);
      terrainMesh.geometry.dispose();
      terrainMesh = null;
    }
    const firstMat = loader.listMaterialIds()[0];
    const grassMatId = loader.hasMaterial("grass_mud") ? loader.getMaterialId("grass_mud") : firstMat ? loader.getMaterialId(firstMat) : 0;
    const cobbleMatId = loader.hasMaterial("mossy_cobble") ? loader.getMaterialId("mossy_cobble") : grassMatId;
    const wetConcMatId = loader.hasMaterial("wet_industrial_concrete") ? loader.getMaterialId("wet_industrial_concrete") : cobbleMatId;
    const oakFloorMatId = loader.hasMaterial("oak_plank_floor") ? loader.getMaterialId("oak_plank_floor") : cobbleMatId;
    const chunkOffsets = [
      [-16, -16],
      [0, -16],
      [-16, 0],
      [0, 0]
    ];
    const chunkPieces = [];
    for (const [ox, oz] of chunkOffsets) {
      const chunk = createVoxelChunk({
        sizeX: 16,
        sizeY: 8,
        sizeZ: 16,
        voxelSize: 1,
        origin: [ox, -2, oz]
      });
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const wx = ox + x + 0.5;
          const wz = oz + z + 0.5;
          chunk.setVoxel(x, 0, z, grassMatId, 0.1);
          const dPuddle = Math.hypot(wx + 0.8, wz - 3.6);
          const inPuddle = dPuddle < 3.6;
          const inIndustrialYard = wx < -3 && wx > -13.5 && wz < -5.5 && wz > -13.5;
          const inIndoorFloor = wx > 3.2 && wx < 9.8 && wz < -6.8 && wz > -12.8;
          const onPath = Math.abs(wx) < 3.5 && wz > -2.5 && wz < 8.5 || wx > 3 && wx < 11.5 && wz > 2.5 && wz < 10.5;
          const isBorderBerm = Math.abs(wx) > 13.5 || Math.abs(wz) > 13.5;
          if (inPuddle) {
            const wetStrength = Math.max(0.45, 1 - dPuddle / 3.6 * 0.4);
            chunk.setVoxel(x, 1, z, cobbleMatId, wetStrength);
          } else if (inIndustrialYard) {
            chunk.setVoxel(x, 1, z, wetConcMatId, 0.55);
          } else if (inIndoorFloor) {
            chunk.setVoxel(x, 1, z, oakFloorMatId, 0.05);
          } else if (onPath) {
            chunk.setVoxel(x, 1, z, cobbleMatId, 0.35);
          } else {
            chunk.setVoxel(x, 1, z, grassMatId, 0.2);
          }
          if (isBorderBerm) {
            chunk.setVoxel(x, 2, z, grassMatId, 0.15);
            if (Math.abs(wx) > 14.5 && Math.abs(wz) > 14.5) {
              chunk.setVoxel(x, 3, z, cobbleMatId, 0.25);
            }
          } else if (Math.abs(wx + 3.8) < 1.2 && wz > 1.5 && wz < 5.5) {
            chunk.setVoxel(x, 2, z, cobbleMatId, 0.45);
          }
        }
      }
      extractMergedBoxes(chunk);
      const chunkGeo = chunk.buildMeshGeometry();
      chunkPieces.push({ geometry: chunkGeo, disposeSource: false });
      voxelChunks.push(chunk);
    }
    const mergedTerrain = mergeStaticGeometries(chunkPieces);
    terrainMesh = new THREE13.Mesh(mergedTerrain, worldMat.material);
    terrainMesh.name = "VoxelTerrain32m";
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = false;
    scene.add(terrainMesh);
  }
  function rebuildGuardPost() {
    if (guardPostMesh) {
      scene.remove(guardPostMesh);
      guardPostMesh = null;
    }
  }
  function rebuildShowcase() {
    if (showcaseMesh) {
      scene.remove(showcaseMesh);
      showcaseMesh.geometry.dispose();
      showcaseMesh = null;
    }
    const pieces = [];
    if (loader.hasMesh("guard_post")) {
      const gpAsset = loader.instantiateMesh("guard_post");
      pieces.push({ geometry: gpAsset.geometry, pos: [0, 0, -3.5] });
    }
    if (loader.hasMesh("beveled_wall")) {
      const pillarAsset = loader.instantiateMesh("beveled_wall", {
        params: { width: 1, height: 3, thickness: 1, hasWindow: false }
      });
      pieces.push({ geometry: pillarAsset.geometry, pos: [-4.2, 0, -3.5] });
      const wallAsset = loader.instantiateMesh("beveled_wall", {
        params: { width: 4, height: 3, thickness: 0.35, hasWindow: true }
      });
      pieces.push({ geometry: wallAsset.geometry, pos: [-7.6, 0, -3.5] });
    }
    if (loader.hasMesh("guard_post") && loader.hasMaterial("concrete_weathered") && loader.hasMaterial("rusted_iron") && loader.hasMaterial("mossy_cobble")) {
      const reskinAsset = loader.instantiateMesh("guard_post", {
        materialOverrides: {
          wallMat: "concrete_weathered",
          woodMat: "rusted_iron",
          baseMat: "mossy_cobble"
        }
      });
      pieces.push({ geometry: reskinAsset.geometry, pos: [8.5, 0, -4.5], rotY: -0.35 });
    }
    if (loader.hasMesh("shipping_container")) {
      const containerAsset = loader.instantiateMesh("shipping_container", {
        params: { doorOpen: true }
      });
      pieces.push({ geometry: containerAsset.geometry, pos: [-8.2, 0, -11], rotY: 0 });
    }
    if (loader.hasMesh("industrial_pillar")) {
      const pilA = loader.instantiateMesh("industrial_pillar", { params: { height: 3.4 } });
      pieces.push({ geometry: pilA.geometry, pos: [-4.2, 0, -8.2] });
      const pilB = loader.instantiateMesh("industrial_pillar", { params: { height: 3.4 } });
      pieces.push({ geometry: pilB.geometry, pos: [-11.8, 0, -8.2] });
    }
    if (loader.hasMesh("utility_pipe_segment")) {
      const pipeAsset = loader.instantiateMesh("utility_pipe_segment", {
        params: { length: 7.6, radius: 0.14 }
      });
      pieces.push({ geometry: pipeAsset.geometry, pos: [-8, 2.6, -8.2] });
    }
    if (loader.hasMesh("heavy_crate")) {
      const crateLarge = loader.instantiateMesh("heavy_crate", { params: { size: 1.1 } });
      pieces.push({ geometry: crateLarge.geometry, pos: [-4.8, 0, -6.2], rotY: 0.25 });
      const crateSmall = loader.instantiateMesh("heavy_crate", { params: { size: 0.72 } });
      pieces.push({ geometry: crateSmall.geometry, pos: [-3.5, 0, -6.5], rotY: -0.4 });
    }
    if (loader.hasMesh("beveled_wall") && loader.hasMaterial("matte_plaster_wall")) {
      const plasterWall = loader.instantiateMesh("beveled_wall", {
        params: { width: 5, height: 2.8, thickness: 0.28, hasWindow: true },
        materialOverrides: {
          wall: "matte_plaster_wall",
          trim: "oak_plank_floor"
        }
      });
      pieces.push({ geometry: plasterWall.geometry, pos: [6.4, 0, -11.4] });
    }
    if (loader.hasMesh("wooden_table_chair")) {
      const tableChair = loader.instantiateMesh("wooden_table_chair");
      pieces.push({ geometry: tableChair.geometry, pos: [6.2, 0, -9.5], rotY: -0.2 });
    }
    const matIds = loader.listMaterialIds();
    for (let i = 0; i < matIds.length; i++) {
      const mName = matIds[i];
      const layerId = loader.getMaterialId(mName);
      const px = 3.8 + i % 4 * 2.1;
      const pz = 3.6 + Math.floor(i / 4) * 2.2;
      const cubeRaw = buildBeveledBoxRaw(0.75, 0.75, 0.75, 0.03, layerId, 0.85, 1, 0);
      const cubeGeo = buildBufferGeometryFromRaw(cubeRaw);
      pieces.push({ geometry: cubeGeo, pos: [px - 0.42, 0.375, pz], disposeSource: true });
      const sphereGeo = new THREE13.SphereGeometry(0.38, 20, 14);
      pieces.push({
        geometry: sphereGeo,
        pos: [px + 0.45, 0.42, pz],
        overrideMaterialId: layerId,
        disposeSource: true
      });
    }
    if (pieces.length === 0) return;
    const merged = mergeStaticGeometries(pieces);
    showcaseMesh = new THREE13.Mesh(merged, worldMat.material);
    showcaseMesh.name = "StaticShowcaseBatch";
    showcaseMesh.castShadow = true;
    showcaseMesh.receiveShadow = true;
    scene.add(showcaseMesh);
  }
  function rebuildRocks() {
    if (rockMesh) {
      scene.remove(rockMesh);
      rockMesh.geometry.dispose();
      rockMesh = null;
    }
    if (!loader.hasMesh("weathered_rock")) return;
    const rockA = loader.instantiateMesh("weathered_rock", { params: { radius: 0.95, seed: 771 } });
    const rockB = loader.instantiateMesh("weathered_rock", { params: { radius: 0.65, seed: 912 } });
    const rockC = loader.instantiateMesh("weathered_rock", { params: { radius: 1.15, seed: 1031 } });
    const merged = mergeStaticGeometries([
      { geometry: rockA.geometry, pos: [-3.9, 0, 2.2], rotY: 0.4 },
      { geometry: rockB.geometry, pos: [-4.6, 0, 3.4], rotY: 1.7 },
      { geometry: rockC.geometry, pos: [4.2, 0, 1.5], rotY: -0.9 }
    ]);
    rockMesh = new THREE13.Mesh(merged, rockMat.material);
    rockMesh.name = "TriplanarRocksBatch";
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    scene.add(rockMesh);
  }
  buildTerrain();
  rebuildGuardPost();
  rebuildShowcase();
  rebuildRocks();
  const propPool = new InstancedPropPool({
    loader,
    material: worldMat.material,
    parent: scene
  });
  const yardHandles = [];
  function rebuildInstancedYard() {
    for (const h of yardHandles) propPool.remove(h);
    yardHandles.length = 0;
    if (loader.hasMesh("shipping_container")) {
      const containerSpots = [
        // West dock double-stacked shipping containers
        { pos: [-11.5, 0, 1.6], rotY: Math.PI * 0.5 },
        { pos: [-11.5, 2.59, 1.6], rotY: Math.PI * 0.5 + 0.04 },
        { pos: [-11.5, 0, 8.4], rotY: Math.PI * 0.5 - 0.03 },
        { pos: [-11.5, 2.59, 8.4], rotY: Math.PI * 0.5 + 0.02 },
        { pos: [-8.2, 0, 2], rotY: Math.PI * 0.5 + 0.05 },
        { pos: [-8.2, 2.59, 2], rotY: Math.PI * 0.5 - 0.02 },
        { pos: [-8.2, 0, 8.8], rotY: Math.PI * 0.5 },
        // South-west & North dock containers
        { pos: [-3.2, 0, 11.4], rotY: 0.03 },
        { pos: [-3.2, 2.59, 11.4], rotY: -0.04 },
        { pos: [-0.8, 0, -11.2], rotY: 0.06 },
        { pos: [-0.8, 2.59, -11.2], rotY: -0.02 },
        { pos: [2.8, 0, -11.4], rotY: Math.PI * 0.5 - 0.05 }
      ];
      for (let i = 0; i < containerSpots.length; i++) {
        const s = containerSpots[i];
        yardHandles.push(
          propPool.spawn(
            "shipping_container",
            {
              position: s.pos,
              rotation: [0, s.rotY, 0],
              tintJitter: (i % 5 - 2) * 0.06,
              wearBias: i % 4 * 0.22,
              wetnessBias: s.pos[1] < 0.1 ? 0.35 : -0.15
            },
            { params: { doorOpen: false } }
          )
        );
      }
    }
    if (loader.hasMesh("heavy_crate")) {
      for (let i = 0; i < 20; i++) {
        const row = Math.floor(i / 5);
        const col = i % 5;
        const stacked = i >= 15;
        const x = stacked ? -5.8 - (i - 15) * 1.15 : -5.6 - col * 1.15;
        const z = stacked ? 5.6 : 4.2 + row * 1.35;
        const y = stacked ? 1 : 0;
        yardHandles.push(
          propPool.spawn(
            "heavy_crate",
            {
              position: [x, y, z],
              rotation: [0, i * 37 % 10 * 0.08 - 0.35, 0],
              tintJitter: (i % 7 - 3) * 0.045,
              wearBias: i * 3 % 5 * 0.2,
              wetnessBias: stacked ? -0.1 : 0.3
            },
            { params: { size: 1 } }
          )
        );
      }
    }
    if (loader.hasMesh("industrial_pillar")) {
      const pillarCoords = [
        [-13, -11.5],
        [-13, -5],
        [-13, 2],
        [-13, 9.5],
        [-9.5, -13],
        [-3.5, -13],
        [3.5, -13],
        [9.5, -13],
        [-9.5, 12.8],
        [-3, 12.8],
        [3.5, 12.8],
        [10, 12.8],
        [12.6, -9.5],
        [12.6, -2.5],
        [12.6, 4.5],
        [12.6, 11]
      ];
      for (let i = 0; i < pillarCoords.length; i++) {
        const [px, pz] = pillarCoords[i];
        yardHandles.push(
          propPool.spawn(
            "industrial_pillar",
            {
              position: [px, 0, pz],
              rotation: [0, i % 4 * (Math.PI * 0.5), 0],
              tintJitter: (i % 3 - 1) * 0.07,
              wearBias: i % 5 * 0.18,
              wetnessBias: 0.25
            },
            { params: { height: 3 } }
          )
        );
      }
    }
    if (loader.hasMesh("weathered_rock")) {
      const rockCoords = [
        [-6.2, 0, -1.2],
        [-6.8, 0, 1.2],
        [-5.5, 0, 9.8],
        [-10.2, 0, -4.5],
        [11.8, 0, -12.2],
        [11.5, 0, 2.2],
        [11.8, 0, 11.8],
        [2.4, 0, 11.4],
        [-12.4, 0, -12.4],
        [-1.5, 0, -12.6],
        [6.5, 0, 12.2],
        [-7.2, 0, 12.6]
      ];
      for (let i = 0; i < rockCoords.length; i++) {
        const [rx, ry, rz] = rockCoords[i];
        const sc = 0.72 + i % 4 * 0.14;
        yardHandles.push(
          propPool.spawn(
            "weathered_rock",
            {
              position: [rx, ry, rz],
              rotation: [0, i * 0.65, 0],
              scale: [sc, sc, sc],
              tintJitter: (i % 5 - 2) * 0.05,
              wearBias: i % 3 * 0.3,
              wetnessBias: 0.35
            },
            { castShadow: false }
          )
        );
      }
    }
    propPool.flush();
  }
  rebuildInstancedYard();
  const normalizer = createTripoMaterialNormalizer();
  let actor = createNormalizedDummyActor(normalizer, {
    quality: qualityTier,
    targetHeightMeters: 1.75
  });
  actor.wrapper.position.set(0.9, 0, 0.3);
  scene.add(actor.wrapper);
  options.onAuditMessage?.(
    `Dummy character: ${actor.audit.triangles} tris, ${actor.audit.boneCount} bones`
  );
  let fpsSmooth = 60;
  let lastTime = performance.now();
  let startTime = lastTime;
  let lastHudTime = 0;
  function computeMetrics() {
    const tex = loader.getTextureArray();
    let staticDrawCalls = 0;
    if (terrainMesh) staticDrawCalls++;
    if (guardPostMesh) staticDrawCalls++;
    if (showcaseMesh) staticDrawCalls++;
    if (rockMesh) staticDrawCalls++;
    if (hotPreviewMesh) staticDrawCalls++;
    const poolStats = propPool.getStats();
    return {
      bakeTimeMs: Math.round((tex?.bakeTimeMs ?? 0) * 10) / 10,
      maxBakeSliceMs: Math.round((tex?.maxSliceMs ?? 0) * 10) / 10,
      bakeBackend: tex?.bakeBackend ?? "cpu",
      fps: Math.round(fpsSmooth * 10) / 10,
      drawCalls: renderer.info.render.calls,
      staticDrawCalls,
      instancedPools: poolStats.poolCount,
      instancedProps: poolStats.totalInstances,
      triangles: renderer.info.render.triangles,
      estimatedTextureMB: Math.round((tex?.estimatedMemoryMB ?? 0) * 100) / 100,
      materialCount: tex?.layers.size ?? 0,
      cachedMeshCount: loader.getCachedMeshCount(),
      qualityTier,
      lightingPreset,
      biomeMode,
      wetness,
      tripoNormalizationEnabled: normalizer.isEnabled()
    };
  }
  const renderFrame = () => {
    if (disposed) return;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(1e-3, (now - lastTime) * 1e-3));
    lastTime = now;
    fpsSmooth = fpsSmooth * 0.9 + 1 / dt * 0.1;
    const elapsed = (now - startTime) * 1e-3;
    worldMat.setTime(elapsed);
    rockMat.setTime(elapsed);
    actor.update(dt);
    atmosphere.update(elapsed, camera.position);
    renderer.render(scene, camera);
    if (now - lastHudTime > 200) {
      lastHudTime = now;
      options.onMetricsUpdate?.(computeMetrics());
    }
    rafId = requestAnimationFrame(renderFrame);
  };
  const api = {
    isReady: () => ready && !disposed,
    getMetrics: () => computeMetrics(),
    setCameraPreset(name) {
      const p = CAMERA_PRESETS[name];
      if (!p) throw new Error(`Unknown camera preset "${name}"`);
      camTarget.set(...p.target);
      const off = new THREE13.Vector3(...p.pos).sub(camTarget);
      camRadius = off.length();
      camTheta = Math.atan2(off.x, off.z);
      camPhi = Math.acos(Math.max(-0.99, Math.min(0.99, off.y / camRadius)));
      syncCamera();
      renderer.render(scene, camera);
    },
    setLightingPreset(name) {
      lightingPreset = name;
      atmosphere.setPreset(name);
      renderer.render(scene, camera);
      options.onMetricsUpdate?.(computeMetrics());
    },
    setBiomeMode(mode) {
      biomeMode = mode;
      worldMat.setBiomeMode(mode);
      rockMat.setBiomeMode(mode);
      renderer.render(scene, camera);
      options.onMetricsUpdate?.(computeMetrics());
    },
    async setBakeMode(mode) {
      const updatedTex = await loader.setBakeMode(mode);
      worldMat.syncTextureArray(updatedTex);
      rockMat.syncTextureArray(updatedTex);
      renderer.render(scene, camera);
      options.onMetricsUpdate?.(computeMetrics());
    },
    async setQuality(tier) {
      qualityTier = tier;
      applyRendererViewport(canvas2.clientWidth || 1280, canvas2.clientHeight || 720);
      atmosphere.setQuality(tier);
      const updatedTex = await loader.setQuality(tier);
      worldMat.syncTextureArray(updatedTex);
      rockMat.syncTextureArray(updatedTex);
      renderer.render(scene, camera);
      options.onMetricsUpdate?.(computeMetrics());
    },
    setWetness(value) {
      wetness = Math.max(0, Math.min(1, value));
      worldMat.setWetness(wetness);
      rockMat.setWetness(wetness);
      renderer.render(scene, camera);
      options.onMetricsUpdate?.(computeMetrics());
    },
    setTripoNormalizationEnabled(enabled) {
      normalizer.setEnabled(enabled);
      renderer.render(scene, camera);
      options.onMetricsUpdate?.(computeMetrics());
    },
    async hotReloadMaterial(recipeRaw) {
      const issues = validateMaterialRecipe(recipeRaw);
      const errors = issues.filter((i) => i.severity === "error");
      if (errors.length > 0) {
        throw new Error(`Material validation failed: ${errors.map((e) => e.message).join("; ")}`);
      }
      const recipe = recipeRaw;
      const isNew = !loader.getMaterialRecipe(recipe.id);
      await loader.registerMaterialRecipe(recipe);
      const activeTex = loader.getTextureArray();
      worldMat.syncTextureArray(activeTex);
      rockMat.syncTextureArray(activeTex);
      if (isNew) {
        buildTerrain();
        rebuildShowcase();
      }
      renderer.render(scene, camera);
      options.onMetricsUpdate?.(computeMetrics());
    },
    hotReloadMesh(recipeRaw) {
      const knownMats = new Set(loader.listMaterialIds());
      const recipe = recipeRaw;
      const knownMeshes = new Set(loader.listMeshIds());
      if (recipe?.id) knownMeshes.add(recipe.id);
      const issues = validateMeshRecipe(recipeRaw, knownMats, knownMeshes);
      const errors = issues.filter((i) => i.severity === "error");
      if (errors.length > 0) {
        throw new Error(`Mesh validation failed: ${errors.map((e) => e.message).join("; ")}`);
      }
      loader.registerMeshRecipe(recipe);
      if (recipe.id === "guard_post") {
        rebuildGuardPost();
        rebuildShowcase();
      } else if (recipe.id === "beveled_wall" || recipe.id === "shipping_container" || recipe.id === "industrial_pillar" || recipe.id === "utility_pipe_segment" || recipe.id === "heavy_crate" || recipe.id === "wooden_table_chair") {
        rebuildGuardPost();
        rebuildShowcase();
      } else if (recipe.id === "weathered_rock") {
        rebuildRocks();
      } else {
        if (hotPreviewMesh) {
          scene.remove(hotPreviewMesh);
          hotPreviewMesh = null;
        }
        const asset = loader.instantiateMesh(recipe.id);
        hotPreviewMesh = new THREE13.Mesh(asset.geometry, worldMat.material);
        hotPreviewMesh.name = `HotPreview_${recipe.id}`;
        hotPreviewMesh.position.set(-1.5, 0, 6.2);
        hotPreviewMesh.castShadow = true;
        hotPreviewMesh.receiveShadow = true;
        scene.add(hotPreviewMesh);
      }
      renderer.render(scene, camera);
      options.onMetricsUpdate?.(computeMetrics());
    },
    async loadCharacterGlb(buffer) {
      const nextActor = await loadSkeletalFromGlbBuffer(buffer, normalizer, {
        quality: qualityTier,
        targetHeightMeters: 1.75
      });
      scene.remove(actor.wrapper);
      actor.dispose();
      actor = nextActor;
      actor.wrapper.position.set(0.9, 0, 0.3);
      scene.add(actor.wrapper);
      const warnText = actor.audit.warnings.length ? ` | WARN: ${actor.audit.warnings.join(", ")}` : "";
      options.onAuditMessage?.(
        `GLB loaded: ${actor.audit.triangles} tris, ${actor.audit.boneCount} bones, maxTex ${actor.audit.maxTextureSize}px${warnText}`
      );
      renderer.render(scene, camera);
    },
    stressTestInstancedPool(iterations = 100) {
      if (!loader.hasMesh("heavy_crate")) {
        const s = propPool.getStats();
        return { iterations: 0, poolCount: s.poolCount, activeInstances: s.totalInstances };
      }
      const handles = [];
      for (let i = 0; i < iterations; i++) {
        const h = propPool.spawn(
          "heavy_crate",
          {
            position: [-6 - i % 5 * 1.1, 2 + i % 3 * 0.2, 6],
            rotation: [0, i * 0.2, 0],
            tintJitter: (i % 5 - 2) * 0.05,
            wearBias: 0.4,
            wetnessBias: 0.2
          },
          { params: { size: 1 } }
        );
        propPool.updateTransform(h, {
          position: [-6 - i % 5 * 1.1, 2.1, 6.2],
          rotation: [0, i * 0.35, 0]
        });
        handles.push(h);
        if (handles.length > 8) {
          propPool.remove(handles.shift());
        }
        propPool.flush();
      }
      while (handles.length > 0) {
        propPool.remove(handles.shift());
      }
      propPool.flush();
      renderer.render(scene, camera);
      const stats = propPool.getStats();
      options.onMetricsUpdate?.(computeMetrics());
      return {
        iterations,
        poolCount: stats.poolCount,
        activeInstances: stats.totalInstances
      };
    },
    disposeAndVerify() {
      if (!disposed) {
        disposed = true;
        ready = false;
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        canvas2.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        canvas2.removeEventListener("wheel", onWheel);
        for (const c of voxelChunks) c.dispose();
        voxelChunks.length = 0;
        if (terrainMesh) {
          scene.remove(terrainMesh);
          terrainMesh.geometry.dispose();
          terrainMesh = null;
        }
        if (guardPostMesh) {
          scene.remove(guardPostMesh);
          guardPostMesh = null;
        }
        if (showcaseMesh) {
          scene.remove(showcaseMesh);
          showcaseMesh.geometry.dispose();
          showcaseMesh = null;
        }
        if (rockMesh) {
          scene.remove(rockMesh);
          rockMesh.geometry.dispose();
          rockMesh = null;
        }
        if (hotPreviewMesh) {
          scene.remove(hotPreviewMesh);
          hotPreviewMesh = null;
        }
        scene.remove(actor.wrapper);
        actor.dispose();
        propPool.dispose();
        worldMat.dispose();
        rockMat.dispose();
        atmosphere.dispose();
        loader.dispose();
        renderer.dispose();
      }
      return {
        remainingGeometries: renderer.info.memory.geometries,
        remainingTextures: renderer.info.memory.textures
      };
    }
  };
  window.__HGAME_LOOKDEV__ = api;
  renderer.render(scene, camera);
  ready = true;
  options.onMetricsUpdate?.(computeMetrics());
  return {
    api,
    start() {
      if (!disposed && !rafId) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(renderFrame);
      }
    },
    resize(width, height) {
      if (!disposed) {
        applyRendererViewport(width, height);
        renderer.render(scene, camera);
      }
    }
  };
}

// demos/lookdev-realistic-3d/main.ts
var canvas = document.querySelector("#game");
var metricsEl = document.querySelector("#metrics");
var auditEl = document.querySelector("#audit-log");
var dropOverlay = document.querySelector("#drop-overlay");
var qualitySel = document.querySelector("#ctrl-quality");
var lightingSel = document.querySelector("#ctrl-lighting");
var biomeSel = document.querySelector("#ctrl-biome");
var bakeModeSel = document.querySelector("#ctrl-bakemode");
var wetnessSlider = document.querySelector("#ctrl-wetness");
var wetnessValEl = document.querySelector("#wetness-val");
var tripoToggle = document.querySelector("#ctrl-tripo");
var params = new URLSearchParams(location.search);
var initialQuality = params.get("quality") === "LOW" ? "LOW" : "HIGH";
var manifestParam = params.get("manifest");
var manifestUrl = manifestParam !== null ? manifestParam : "http://127.0.0.1:4174/files/procedural/manifest.json";
var initialBakeMode = params.get("bakeMode") ?? "auto";
var initialBiome = params.get("biome") ?? "wet_moss";
qualitySel.value = initialQuality;
biomeSel.value = initialBiome;
bakeModeSel.value = initialBakeMode;
function formatMetrics(m) {
  return [
    `FPS: ${m.fps} | DrawCalls: ${m.drawCalls} (Static: ${m.staticDrawCalls}, Pools: ${m.instancedPools})`,
    `Props: ${m.instancedProps} | Tris: ${m.triangles} | Tex: ${m.estimatedTextureMB} MB`,
    `Bake: ${m.bakeTimeMs} ms [${m.bakeBackend.toUpperCase()}] (maxSlice ${m.maxBakeSliceMs} ms)`,
    `Mats: ${m.materialCount} | MeshCache: ${m.cachedMeshCount}`
  ].join("\n");
}
var controller = await createLookDevScene({
  canvas,
  manifestUrl,
  initialQuality,
  initialLighting: "OVERCAST_WET",
  initialBiome,
  initialBakeMode,
  onMetricsUpdate: (m) => {
    metricsEl.textContent = formatMetrics(m);
  },
  onAuditMessage: (msg) => {
    auditEl.textContent = msg;
  }
});
canvas.dataset.engineReady = "true";
controller.start();
window.addEventListener("resize", () => {
  controller.resize(window.innerWidth, window.innerHeight);
});
qualitySel.addEventListener("change", async () => {
  await controller.api.setQuality(qualitySel.value);
});
lightingSel.addEventListener("change", () => {
  controller.api.setLightingPreset(lightingSel.value);
});
biomeSel.addEventListener("change", () => {
  controller.api.setBiomeMode(biomeSel.value);
});
bakeModeSel.addEventListener("change", async () => {
  await controller.api.setBakeMode(bakeModeSel.value);
});
wetnessSlider.addEventListener("input", () => {
  const v = Number(wetnessSlider.value);
  wetnessValEl.textContent = v.toFixed(2);
  controller.api.setWetness(v);
});
tripoToggle.addEventListener("change", () => {
  controller.api.setTripoNormalizationEnabled(tripoToggle.checked);
});
document.querySelectorAll("[data-cam]").forEach((btn) => {
  btn.addEventListener("click", () => {
    controller.api.setCameraPreset(btn.dataset.cam);
  });
});
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropOverlay.hidden = false;
});
window.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null) dropOverlay.hidden = true;
});
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropOverlay.hidden = true;
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".glb")) {
      const buf = await file.arrayBuffer();
      await controller.api.loadCharacterGlb(buf);
    } else if (name.endsWith(".hmat.json")) {
      const recipe = JSON.parse(await file.text());
      await controller.api.hotReloadMaterial(recipe);
      auditEl.textContent = `Hot-reloaded material: ${recipe.id}`;
    } else if (name.endsWith(".hmesh.json")) {
      const recipe = JSON.parse(await file.text());
      controller.api.hotReloadMesh(recipe);
      auditEl.textContent = `Hot-reloaded mesh: ${recipe.id}`;
    } else {
      auditEl.textContent = `Unsupported file: ${file.name}`;
    }
  } catch (err) {
    auditEl.textContent = `Hot-reload error: ${err instanceof Error ? err.message : String(err)}`;
  }
});
