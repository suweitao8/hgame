/**
 * Unity-style 3D visibility culling & GPU instancing helpers:
 *   - 6-plane Gribb-Hartmann Frustum Culler + draw distance cutoff
 *   - Analytical convex-cone AABB Software Occluder Culler (zero false positives)
 *   - Optional non-blocking WebGL2 ANY_SAMPLES_PASSED_CONSERVATIVE Hardware Occlusion Pool
 *   - Unified SceneCuller3D service
 *   - Dynamic GPU InstancedBatch3D pool with per-frame visible compaction & color buffer
 *
 * The Three.js namespace is injected into GPU helpers; non-3D games import nothing.
 */

/**
 * @typedef {object} CullCameraLike Structural subset of THREE.Camera read by the cullers.
 * @property {(force?: boolean) => void} [updateMatrixWorld]
 * @property {{elements: ArrayLike<number>, copy?: (m: object) => unknown, invert?: () => unknown}} [matrixWorldInverse]
 * @property {{elements: ArrayLike<number>}} [matrixWorld] Column-major world matrix (translation at 12..14).
 * @property {{elements: ArrayLike<number>}} [projectionMatrix] Column-major projection matrix.
 * @property {{x?: number, y?: number, z?: number}} [position] Fallback eye position.
 */

/**
 * @typedef {object} CullFrustumOptions
 * @property {number} [maxDistance=Infinity] Draw-distance cutoff in world units (non-positive/non-finite disables).
 */

/**
 * @typedef {object} FrustumCuller3D
 * @property {number} maxDistance Getter; active draw-distance cutoff (Infinity = disabled).
 * @property {boolean} hasPlanes Getter; true once planes were extracted from a camera/matrix.
 * @property {{x: number, y: number, z: number}} cameraPosition Getter; last camera world position (copy).
 * @property {(value: number) => void} setMaxDistance Sets the draw-distance cutoff in world units.
 * @property {(m: ArrayLike<number>) => boolean} setFromProjectionMatrix Extracts planes from a column-major view-projection matrix (>= 16 numbers).
 * @property {(camera: CullCameraLike | null | undefined) => boolean} updateFromCamera Updates planes and eye from a camera; false if unavailable.
 * @property {(x: number, y: number, z: number, radius?: number) => boolean} intersectsSphere True if the sphere may be visible.
 * @property {(x: number, y: number, z: number, radius?: number) => number} classifySphere 0 = outside, 1 = intersecting, 2 = strictly inside.
 * @property {(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) => boolean} intersectsAABB True if the AABB may be visible.
 */

/**
 * @typedef {object} OcclusionCullerOptions
 * @property {number} [maxOccluders=64] Maximum registered occluders.
 * @property {number} [maxTestedOccluders=24] Nearest occluders tested per frame.
 */

/**
 * @typedef {object} OccluderAABBInput
 * @property {string | number | null} [id=null] Stable id (re-adding replaces); auto-generated when null.
 * @property {[number, number, number]} min Minimum corner in world units.
 * @property {[number, number, number]} max Maximum corner in world units.
 */

/**
 * @typedef {object} OccluderCollider Collider description accepted by `setOccludersFromColliders`.
 * @property {string | number | null} [id]
 * @property {boolean} [sensor] Sensors are skipped.
 * @property {ArrayLike<number>} [size] Full box size [x, y, z] in world units.
 * @property {ArrayLike<number>} [center] Box center [x, y, z] in world units.
 */

/**
 * @typedef {object} OccluderFilterOptions
 * @property {number} [minWidth=1.5] Minimum horizontal extent in world units.
 * @property {number} [minHeight=1.5] Minimum height in world units.
 */

/**
 * @typedef {object} OcclusionCuller3D
 * @property {number} occluderCount Getter; registered occluders.
 * @property {number} activeCount Getter; occluders active this frame.
 * @property {(occluder: OccluderAABBInput) => string | number} addOccluderAABB Adds or replaces an occluder; returns its id. Throws past `maxOccluders`.
 * @property {(id: string | number) => boolean} removeOccluder True if removed.
 * @property {() => void} clearOccluders Removes all occluders.
 * @property {(colliders: OccluderCollider[], options?: OccluderFilterOptions) => number} setOccludersFromColliders Replaces occluders from large non-sensor boxes; returns the new count.
 * @property {(camera: CullCameraLike | null | undefined, frustumCuller?: Pick<FrustumCuller3D, 'intersectsAABB'> | null) => number} beginFrame Selects nearest in-frustum occluders; returns active count.
 * @property {(x: number, y: number, z: number, radius?: number) => boolean} isSphereOccluded True if the sphere is strictly hidden.
 */

/**
 * @typedef {object} HardwareOcclusionPoolOptions
 * @property {number} [maxQueries=256] Maximum simultaneous query records.
 * @property {number} [graceFrames=2] Consecutive hidden frames required before reporting occluded.
 */

/**
 * @typedef {object} HardwareOcclusionPool
 * @property {boolean} supported Getter; true when WebGL2 conservative queries exist.
 * @property {number} size Getter; query record count.
 * @property {(key: unknown) => boolean} poll Polls a finished query and returns occluded state.
 * @property {(key: unknown) => boolean} beginQuery Starts a query (false if busy/unsupported).
 * @property {(key: unknown) => boolean} endQuery Ends the active query for `key`.
 * @property {(key: unknown) => boolean} isOccluded True after more than `graceFrames` hidden frames.
 * @property {(key: unknown) => boolean} remove Deletes the record; true if existed.
 * @property {() => boolean} dispose Releases queries; false if already disposed.
 */

/**
 * @typedef {object} SceneCullerOptions
 * @property {number} [maxDistance=Infinity] Draw-distance cutoff in world units.
 * @property {boolean} [occlusion=true] Enable software occlusion.
 * @property {number} [maxOccluders=64] Maximum occluders.
 * @property {{[key: string]: unknown} | null} [gl=null] WebGL2 context enabling hardware occlusion queries.
 */

/**
 * @typedef {object} CullStats
 * @property {number} tested Spheres tested this frame.
 * @property {number} frustumCulled Rejected by frustum/distance.
 * @property {number} occluded Rejected by occlusion.
 * @property {number} visible Accepted.
 */

/**
 * @typedef {object} SceneCuller3D
 * @property {FrustumCuller3D} frustum
 * @property {OcclusionCuller3D} occluder
 * @property {HardwareOcclusionPool | null} hardwarePool
 * @property {boolean} occlusionEnabled Getter.
 * @property {(value: boolean) => void} setOcclusionEnabled
 * @property {(value: number) => void} setMaxDistance
 * @property {OcclusionCuller3D['addOccluderAABB']} addOccluderAABB
 * @property {OcclusionCuller3D['removeOccluder']} removeOccluder
 * @property {OcclusionCuller3D['clearOccluders']} clearOccluders
 * @property {OcclusionCuller3D['setOccludersFromColliders']} setOccludersFromColliders
 * @property {(camera: CullCameraLike | null | undefined) => void} beginFrame Resets stats and updates frustum/occluders.
 * @property {(x: number, y: number, z: number, radius?: number, hardwareKey?: unknown) => boolean} testSphere True if visible.
 * @property {(x: number, y: number, z: number, radius?: number) => number} classifySphere 0 = outside, 1 = intersecting, 2 = strictly inside.
 * @property {CullStats} stats Getter; copy of per-frame stats.
 * @property {() => void} dispose
 */

/**
 * Minimal structural THREE.InstancedMesh used by the batch.
 * @typedef {object} InstancedMeshLike
 * @property {boolean} frustumCulled
 * @property {boolean} castShadow
 * @property {boolean} receiveShadow
 * @property {number} count Rendered instance count.
 * @property {{array: Float32Array, needsUpdate: boolean}} instanceMatrix
 * @property {{array: Float32Array, needsUpdate: boolean} | null} [instanceColor]
 * @property {{remove?: (o: object) => unknown} | null} [parent]
 * @property {() => void} [dispose]
 */

/**
 * Minimal THREE namespace subset used by the instanced batch.
 * @typedef {object} InstancedBatchTHREE
 * @property {new (geometry: object, material: object | object[], count: number) => InstancedMeshLike} InstancedMesh
 * @property {new (array: Float32Array, itemSize: number) => {array: Float32Array, needsUpdate: boolean}} [InstancedBufferAttribute]
 */

/**
 * @typedef {object} InstancedBatchOptions
 * @property {object} geometry THREE.BufferGeometry (required).
 * @property {object | object[]} material THREE material(s) (required).
 * @property {number} [capacity=1024] Integer slot count in 1..100000.
 * @property {boolean} [castShadow=false]
 * @property {boolean} [receiveShadow=false]
 * @property {boolean} [perInstanceColor=false] Allocates an instance color buffer.
 * @property {number} [cullRadius=1] Default bounding-sphere radius in world units.
 */

/**
 * @typedef {[number, number, number] | {r: number, g: number, b: number}} InstanceColor Linear RGB 0..1.
 */

/**
 * @typedef {object} InstanceAllocOptions
 * @property {number} [x=0]
 * @property {number} [y=0]
 * @property {number} [z=0]
 * @property {number} [rotationX=0] Radians.
 * @property {number} [rotationY=0] Radians.
 * @property {number} [rotationZ=0] Radians.
 * @property {number} [scale=1] Uniform scale (default for the axes below).
 * @property {number} [scaleX]
 * @property {number} [scaleY]
 * @property {number} [scaleZ]
 * @property {number} [radius] Culling radius in world units (default batch `cullRadius`).
 * @property {InstanceColor | null} [color=null]
 * @property {boolean} [visible=true]
 */

/**
 * @typedef {object} InstancedBatchCuller
 * @property {(x: number, y: number, z: number, radius?: number) => boolean} testSphere
 */

/**
 * @typedef {object} InstancedBatchFlushOptions
 * @property {InstancedBatchCuller | null} [culler=null] E.g. a {@link SceneCuller3D}.
 * @property {((outIndex: number, slot: number) => void) | null} [onVisible=null] Called per visible instance with compacted index and slot id.
 */

/**
 * @typedef {object} InstancedBatchFlushResult
 * @property {number} totalActive Allocated instances.
 * @property {number} visible Instances written this flush.
 * @property {number} culled Instances rejected by culling.
 */

/**
 * @typedef {object} InstancedBatch3D
 * @property {InstancedMeshLike} mesh Underlying InstancedMesh.
 * @property {number} capacity Slot count.
 * @property {number} count Getter; allocated instances.
 * @property {(options?: InstanceAllocOptions) => number} alloc Allocates a slot; returns its index or -1 when full.
 * @property {(idx: number, x: number, y: number, z: number, rotY?: number, scale?: number) => boolean} setTransform Position, Y rotation (rad), uniform scale.
 * @property {(idx: number, rotX: number, rotY: number, rotZ: number) => boolean} setRotation Euler radians.
 * @property {(idx: number, r: number, g: number, b: number) => boolean} setColor
 * @property {(idx: number, value: boolean) => boolean} setVisible
 * @property {(idx: number) => boolean} free Releases a slot.
 * @property {() => void} clear Frees all slots.
 * @property {(options?: InstancedBatchFlushOptions) => InstancedBatchFlushResult} flush Compacts visible instances into the GPU buffers.
 * @property {() => void} dispose
 */

const SCRATCH_PROJ_VIEW = new Float64Array(16);

function multiply4x4Into(out, a, b) {
  for (let col = 0; col < 4; col++) {
    const o = col * 4;
    const b0 = b[o], b1 = b[o + 1], b2 = b[o + 2], b3 = b[o + 3];
    out[o]     = a[0] * b0 + a[4] * b1 + a[8]  * b2 + a[12] * b3;
    out[o + 1] = a[1] * b0 + a[5] * b1 + a[9]  * b2 + a[13] * b3;
    out[o + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[o + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

function setPlane(planes, idx, nx, ny, nz, d) {
  const len = Math.hypot(nx, ny, nz);
  const o = idx * 4;
  if (len > 1e-12) {
    const inv = 1 / len;
    planes[o]     = nx * inv;
    planes[o + 1] = ny * inv;
    planes[o + 2] = nz * inv;
    planes[o + 3] = d * inv;
  } else {
    planes[o] = 0; planes[o + 1] = 0; planes[o + 2] = 0; planes[o + 3] = 0;
  }
}

function writeMat4ToFloat32(out, offset, x, y, z, rx, ry, rz, sx, sy, sz) {
  if (rx === 0 && rz === 0) {
    if (ry === 0) {
      out[offset]      = sx; out[offset + 1]  = 0;  out[offset + 2]  = 0;  out[offset + 3]  = 0;
      out[offset + 4]  = 0;  out[offset + 5]  = sy; out[offset + 6]  = 0;  out[offset + 7]  = 0;
      out[offset + 8]  = 0;  out[offset + 9]  = 0;  out[offset + 10] = sz; out[offset + 11] = 0;
      out[offset + 12] = x;  out[offset + 13] = y;  out[offset + 14] = z;  out[offset + 15] = 1;
      return;
    }
    const c = Math.cos(ry), d = Math.sin(ry);
    out[offset]      = c * sx;  out[offset + 1]  = 0;  out[offset + 2]  = -d * sx; out[offset + 3]  = 0;
    out[offset + 4]  = 0;       out[offset + 5]  = sy; out[offset + 6]  = 0;       out[offset + 7]  = 0;
    out[offset + 8]  = d * sz;  out[offset + 9]  = 0;  out[offset + 10] = c * sz;  out[offset + 11] = 0;
    out[offset + 12] = x;       out[offset + 13] = y;  out[offset + 14] = z;       out[offset + 15] = 1;
    return;
  }
  const a = Math.cos(rx), b = Math.sin(rx);
  const c = Math.cos(ry), d = Math.sin(ry);
  const e = Math.cos(rz), f = Math.sin(rz);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  out[offset]      = c * e * sx;
  out[offset + 1]  = (af + be * d) * sx;
  out[offset + 2]  = (bf - ae * d) * sx;
  out[offset + 3]  = 0;
  out[offset + 4]  = -c * f * sy;
  out[offset + 5]  = (ae - bf * d) * sy;
  out[offset + 6]  = (be + af * d) * sy;
  out[offset + 7]  = 0;
  out[offset + 8]  = d * sz;
  out[offset + 9]  = -b * c * sz;
  out[offset + 10] = a * c * sz;
  out[offset + 11] = 0;
  out[offset + 12] = x;
  out[offset + 13] = y;
  out[offset + 14] = z;
  out[offset + 15] = 1;
}

/**
 * 6-plane Gribb-Hartmann frustum culler with optional max draw distance cutoff.
 * @param {CullFrustumOptions} [options]
 * @returns {FrustumCuller3D}
 */
export function createFrustumCuller3D({ maxDistance = Infinity } = {}) {
  const planes = new Float64Array(24);
  let camX = 0, camY = 0, camZ = 0;
  let hasPlanes = false;
  let distLimit = Number.isFinite(maxDistance) && maxDistance > 0 ? maxDistance : Infinity;

  function setFromProjectionMatrix(m) {
    if (!m || m.length < 16) return false;
    // Left, Right, Bottom, Top, Near, Far
    setPlane(planes, 0, m[3] + m[0], m[7] + m[4], m[11] + m[8],  m[15] + m[12]);
    setPlane(planes, 1, m[3] - m[0], m[7] - m[4], m[11] - m[8],  m[15] - m[12]);
    setPlane(planes, 2, m[3] + m[1], m[7] + m[5], m[11] + m[9],  m[15] + m[13]);
    setPlane(planes, 3, m[3] - m[1], m[7] - m[5], m[11] - m[9],  m[15] - m[13]);
    setPlane(planes, 4, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
    setPlane(planes, 5, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
    hasPlanes = true;
    return true;
  }

  function updateFromCamera(camera) {
    if (!camera) {
      hasPlanes = false;
      return false;
    }
    camera.updateMatrixWorld?.(true);
    if (camera.matrixWorldInverse && camera.matrixWorld && typeof camera.matrixWorldInverse.copy === 'function') {
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert?.();
    }
    const mw = camera.matrixWorld?.elements;
    if (mw && mw.length >= 16) {
      camX = mw[12]; camY = mw[13]; camZ = mw[14];
    } else if (camera.position) {
      camX = camera.position.x ?? 0;
      camY = camera.position.y ?? 0;
      camZ = camera.position.z ?? 0;
    }
    const proj = camera.projectionMatrix?.elements;
    const viewInv = camera.matrixWorldInverse?.elements;
    if (proj && viewInv) {
      multiply4x4Into(SCRATCH_PROJ_VIEW, proj, viewInv);
      return setFromProjectionMatrix(SCRATCH_PROJ_VIEW);
    }
    hasPlanes = false;
    return false;
  }

  function intersectsSphere(x, y, z, radius = 0) {
    const r = radius > 0 ? radius : 0;
    if (distLimit < Infinity) {
      const dx = x - camX, dy = y - camY, dz = z - camZ;
      const limit = distLimit + r;
      if (dx * dx + dy * dy + dz * dz > limit * limit) return false;
    }
    if (!hasPlanes) return true;
    for (let i = 0; i < 24; i += 4) {
      if (planes[i] * x + planes[i + 1] * y + planes[i + 2] * z + planes[i + 3] < -r) {
        return false;
      }
    }
    return true;
  }

  function intersectsAABB(minX, minY, minZ, maxX, maxY, maxZ) {
    if (distLimit < Infinity) {
      const cx = camX < minX ? minX : (camX > maxX ? maxX : camX);
      const cy = camY < minY ? minY : (camY > maxY ? maxY : camY);
      const cz = camZ < minZ ? minZ : (camZ > maxZ ? maxZ : camZ);
      const dx = cx - camX, dy = cy - camY, dz = cz - camZ;
      if (dx * dx + dy * dy + dz * dz > distLimit * distLimit) return false;
    }
    if (!hasPlanes) return true;
    for (let i = 0; i < 24; i += 4) {
      const nx = planes[i], ny = planes[i + 1], nz = planes[i + 2], d = planes[i + 3];
      const px = nx >= 0 ? maxX : minX;
      const py = ny >= 0 ? maxY : minY;
      const pz = nz >= 0 ? maxZ : minZ;
      if (nx * px + ny * py + nz * pz + d < 0) return false;
    }
    return true;
  }

  /**
   * Three-state sphere test: `0 = outside`, `1 = intersecting`, `2 = strictly inside`.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} [radius=0]
   * @returns {number}
   */
  function classifySphere(x, y, z, radius = 0) {
    const r = radius > 0 ? radius : 0;
    let strictlyInside = true;
    if (distLimit < Infinity) {
      const dx = x - camX, dy = y - camY, dz = z - camZ;
      const distSq = dx * dx + dy * dy + dz * dz;
      const outer = distLimit + r;
      if (distSq > outer * outer) return 0;
      const inner = distLimit - r;
      if (inner <= 0 || distSq > inner * inner) strictlyInside = false;
    }
    if (!hasPlanes) return strictlyInside ? 2 : 1;
    for (let i = 0; i < 24; i += 4) {
      const d = planes[i] * x + planes[i + 1] * y + planes[i + 2] * z + planes[i + 3];
      if (d < -r) return 0;
      if (d < r) strictlyInside = false;
    }
    return strictlyInside ? 2 : 1;
  }

  function setMaxDistance(value) {
    distLimit = Number.isFinite(value) && value > 0 ? value : Infinity;
  }

  return {
    get maxDistance() { return distLimit; },
    get hasPlanes() { return hasPlanes; },
    get cameraPosition() { return { x: camX, y: camY, z: camZ }; },
    setMaxDistance,
    setFromProjectionMatrix,
    updateFromCamera,
    intersectsSphere,
    classifySphere,
    intersectsAABB,
  };
}

function rayHitsAABBSegment(ox, oy, oz, dx, dy, dz, maxT, minX, minY, minZ, maxX, maxY, maxZ) {
  let tMin = 0;
  let tMax = maxT;

  if (Math.abs(dx) < 1e-9) {
    if (ox < minX || ox > maxX) return false;
  } else {
    const inv = 1 / dx;
    let t1 = (minX - ox) * inv;
    let t2 = (maxX - ox) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return false;
  }

  if (Math.abs(dy) < 1e-9) {
    if (oy < minY || oy > maxY) return false;
  } else {
    const inv = 1 / dy;
    let t1 = (minY - oy) * inv;
    let t2 = (maxY - oy) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return false;
  }

  if (Math.abs(dz) < 1e-9) {
    if (oz < minZ || oz > maxZ) return false;
  } else {
    const inv = 1 / dz;
    let t1 = (minZ - oz) * inv;
    let t2 = (maxZ - oz) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return false;
  }

  return tMax >= 0 && tMin <= maxT;
}

/**
 * Software convex-cone AABB occlusion culler: rejects spheres strictly hidden behind
 * solid walls/buildings before rendering or stepping skeletal mixers.
 * @param {OcclusionCullerOptions} [options]
 * @returns {OcclusionCuller3D}
 */
export function createOcclusionCuller3D({ maxOccluders = 64, maxTestedOccluders = 24 } = {}) {
  const occluders = [];
  const activeOccluders = [];
  let eyeX = 0, eyeY = 0, eyeZ = 0;

  function addOccluderAABB({ id = null, min, max }) {
    if (!Array.isArray(min) || !Array.isArray(max) || min.length !== 3 || max.length !== 3) {
      throw new TypeError('Occluder requires min[3] and max[3]');
    }
    const minX = Math.min(min[0], max[0]);
    const minY = Math.min(min[1], max[1]);
    const minZ = Math.min(min[2], max[2]);
    const maxX = Math.max(min[0], max[0]);
    const maxY = Math.max(min[1], max[1]);
    const maxZ = Math.max(min[2], max[2]);
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const record = {
      id: id ?? `occ-${occluders.length}`,
      minX, minY, minZ, maxX, maxY, maxZ,
      cx, cy, cz,
      halfDiag: Math.hypot(maxX - cx, maxY - cy, maxZ - cz),
      distSq: 0,
    };
    if (id !== null && id !== undefined) {
      const existingIdx = occluders.findIndex(o => o.id === id);
      if (existingIdx !== -1) {
        occluders[existingIdx] = record;
        return record.id;
      }
    }
    if (occluders.length >= maxOccluders) {
      throw new RangeError('Maximum occluder count reached: ' + maxOccluders);
    }
    occluders.push(record);
    return record.id;
  }

  function removeOccluder(id) {
    const at = occluders.findIndex(o => o.id === id);
    if (at === -1) return false;
    occluders.splice(at, 1);
    return true;
  }

  function clearOccluders() {
    occluders.length = 0;
    activeOccluders.length = 0;
  }

  function setOccludersFromColliders(colliders, { minWidth = 1.5, minHeight = 1.5 } = {}) {
    clearOccluders();
    if (!Array.isArray(colliders)) return 0;
    for (const c of colliders) {
      if (!c || c.sensor) continue;
      const [sx, sy, sz] = c.size ?? [0, 0, 0];
      if (sy < minHeight || Math.max(sx, sz) < minWidth) continue;
      if (occluders.length >= maxOccluders) break;
      const [cx, cy, cz] = c.center ?? [0, 0, 0];
      addOccluderAABB({
        id: c.id ?? null,
        min: [cx - sx * 0.5, cy - sy * 0.5, cz - sz * 0.5],
        max: [cx + sx * 0.5, cy + sy * 0.5, cz + sz * 0.5],
      });
    }
    return occluders.length;
  }

  function beginFrame(camera, frustumCuller = null) {
    activeOccluders.length = 0;
    if (!camera || occluders.length === 0) return 0;
    const mw = camera.matrixWorld?.elements;
    if (mw && mw.length >= 16) {
      eyeX = mw[12]; eyeY = mw[13]; eyeZ = mw[14];
    } else if (camera.position) {
      eyeX = camera.position.x ?? 0;
      eyeY = camera.position.y ?? 0;
      eyeZ = camera.position.z ?? 0;
    }
    for (let i = 0; i < occluders.length; i++) {
      const o = occluders[i];
      // Do not occlude with boxes containing the camera eye.
      if (eyeX >= o.minX && eyeX <= o.maxX &&
          eyeY >= o.minY && eyeY <= o.maxY &&
          eyeZ >= o.minZ && eyeZ <= o.maxZ) {
        continue;
      }
      if (frustumCuller && !frustumCuller.intersectsAABB(o.minX, o.minY, o.minZ, o.maxX, o.maxY, o.maxZ)) {
        continue;
      }
      const dx = o.cx - eyeX, dy = o.cy - eyeY, dz = o.cz - eyeZ;
      o.distSq = dx * dx + dy * dy + dz * dz;
      activeOccluders.push(o);
    }
    if (activeOccluders.length > 1) {
      activeOccluders.sort((a, b) => a.distSq - b.distSq);
    }
    if (activeOccluders.length > maxTestedOccluders) {
      activeOccluders.length = maxTestedOccluders;
    }
    return activeOccluders.length;
  }

  function isSphereOccluded(x, y, z, radius = 0) {
    if (activeOccluders.length === 0) return false;
    const dx = x - eyeX, dy = y - eyeY, dz = z - eyeZ;
    const distSq = dx * dx + dy * dy + dz * dz;
    const r = radius > 0 ? radius : 0.05;
    if (distSq <= r * r + 1e-4) return false;
    const dist = Math.sqrt(distSq);
    const invDist = 1 / dist;
    const dirX = dx * invDist, dirY = dy * invDist, dirZ = dz * invDist;
    const tFront = dist - r;

    // Front silhouette tangent plane point and orthonormal tangents (U, V)
    const fx = eyeX + dirX * tFront;
    const fy = eyeY + dirY * tFront;
    const fz = eyeZ + dirZ * tFront;
    const centerRayX = fx - eyeX;
    const centerRayY = fy - eyeY;
    const centerRayZ = fz - eyeZ;

    // Build unit vector U perpendicular to dir, then V = dir x U
    let ux, uy, uz;
    if (Math.abs(dirY) < 0.99) {
      // up(0,1,0) x dir = (dirZ, 0, -dirX)
      const len = Math.hypot(dirZ, dirX) || 1;
      ux = dirZ / len; uy = 0; uz = -dirX / len;
    } else {
      // right(1,0,0) x dir = (0, -dirZ, dirY)
      const len = Math.hypot(dirZ, dirY) || 1;
      ux = 0; uy = -dirZ / len; uz = dirY / len;
    }
    const vx = dirY * uz - dirZ * uy;
    const vy = dirZ * ux - dirX * uz;
    const vz = dirX * uy - dirY * ux;
    const h = r * dist / Math.sqrt(Math.max(1e-6, distSq - r * r));
    const hUx = h * ux, hUy = h * uy, hUz = h * uz;
    const hVx = h * vx, hVy = h * vy, hVz = h * vz;

    for (let i = 0; i < activeOccluders.length; i++) {
      const o = activeOccluders[i];
      // Closest point of occluder cannot be farther than sphere front plane
      const nearCenterDist = Math.sqrt(o.distSq) - o.halfDiag;
      if (nearCenterDist > tFront) continue;
      if (!rayHitsAABBSegment(
        eyeX, eyeY, eyeZ, centerRayX, centerRayY, centerRayZ, 1.0,
        o.minX, o.minY, o.minZ, o.maxX, o.maxY, o.maxZ,
      )) continue;
      if (
        rayHitsAABBSegment(eyeX, eyeY, eyeZ, centerRayX - hUx - hVx, centerRayY - hUy - hVy, centerRayZ - hUz - hVz, 1.0, o.minX, o.minY, o.minZ, o.maxX, o.maxY, o.maxZ) &&
        rayHitsAABBSegment(eyeX, eyeY, eyeZ, centerRayX + hUx - hVx, centerRayY + hUy - hVy, centerRayZ + hUz - hVz, 1.0, o.minX, o.minY, o.minZ, o.maxX, o.maxY, o.maxZ) &&
        rayHitsAABBSegment(eyeX, eyeY, eyeZ, centerRayX + hUx + hVx, centerRayY + hUy + hVy, centerRayZ + hUz + hVz, 1.0, o.minX, o.minY, o.minZ, o.maxX, o.maxY, o.maxZ) &&
        rayHitsAABBSegment(eyeX, eyeY, eyeZ, centerRayX - hUx + hVx, centerRayY - hUy + hVy, centerRayZ - hUz + hVz, 1.0, o.minX, o.minY, o.minZ, o.maxX, o.maxY, o.maxZ)
      ) {
        return true;
      }
    }
    return false;
  }

  return {
    get occluderCount() { return occluders.length; },
    get activeCount() { return activeOccluders.length; },
    addOccluderAABB,
    removeOccluder,
    clearOccluders,
    setOccludersFromColliders,
    beginFrame,
    isSphereOccluded,
  };
}

/**
 * Optional non-blocking WebGL2 hardware conservative occlusion query pool
 * using ANY_SAMPLES_PASSED_CONSERVATIVE and multi-frame temporal grace.
 * @param {{[key: string]: unknown} | null | undefined} gl WebGL2 context (unsupported contexts yield `supported: false`).
 * @param {HardwareOcclusionPoolOptions} [options]
 * @returns {HardwareOcclusionPool}
 */
export function createHardwareOcclusionPool(gl, { maxQueries = 256, graceFrames = 2 } = {}) {
  const supported = Boolean(
    gl &&
    'ANY_SAMPLES_PASSED_CONSERVATIVE' in gl &&
    'QUERY_RESULT_AVAILABLE' in gl &&
    'QUERY_RESULT' in gl &&
    typeof gl.createQuery === 'function' &&
    typeof gl.beginQuery === 'function' &&
    typeof gl.endQuery === 'function' &&
    typeof gl.getQueryParameter === 'function'
  );
  const records = new Map();
  let activeKey = null;
  let disposed = false;

  function ensureRecord(key) {
    let rec = records.get(key);
    if (!rec) {
      if (records.size >= maxQueries) return null;
      rec = { query: gl.createQuery(), pending: false, hiddenFrames: 0 };
      records.set(key, rec);
    }
    return rec;
  }

  function poll(key) {
    if (!supported || disposed) return false;
    const rec = records.get(key);
    if (!rec || !rec.pending) return isOccluded(key);
    if (!gl.getQueryParameter(rec.query, gl.QUERY_RESULT_AVAILABLE)) {
      return isOccluded(key);
    }
    const passed = Number(gl.getQueryParameter(rec.query, gl.QUERY_RESULT)) > 0;
    rec.pending = false;
    rec.hiddenFrames = passed ? 0 : (rec.hiddenFrames + 1);
    return isOccluded(key);
  }

  function beginQuery(key) {
    if (!supported || disposed || activeKey !== null) return false;
    const rec = ensureRecord(key);
    if (!rec || rec.pending) return false;
    activeKey = key;
    gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, rec.query);
    return true;
  }

  function endQuery(key) {
    if (!supported || disposed || activeKey !== key) return false;
    const rec = records.get(key);
    gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
    if (rec) rec.pending = true;
    activeKey = null;
    return true;
  }

  function isOccluded(key) {
    if (!supported || disposed) return false;
    const rec = records.get(key);
    return Boolean(rec && rec.hiddenFrames > graceFrames);
  }

  function remove(key) {
    const rec = records.get(key);
    if (!rec) return false;
    gl.deleteQuery?.(rec.query);
    records.delete(key);
    return true;
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    for (const rec of records.values()) gl.deleteQuery?.(rec.query);
    records.clear();
    return true;
  }

  return {
    get supported() { return supported; },
    get size() { return records.size; },
    poll,
    beginQuery,
    endQuery,
    isOccluded,
    remove,
    dispose,
  };
}

/**
 * Unified per-frame 3D Frustum + Occlusion culler service attached to Three adapter.
 * @param {SceneCullerOptions} [options]
 * @returns {SceneCuller3D}
 */
export function createSceneCuller3D({
  maxDistance = Infinity,
  occlusion = true,
  maxOccluders = 64,
  gl = null,
} = {}) {
  const frustum = createFrustumCuller3D({ maxDistance });
  const occluder = createOcclusionCuller3D({ maxOccluders });
  const hardwarePool = gl ? createHardwareOcclusionPool(gl) : null;
  let occlusionEnabled = Boolean(occlusion);
  const stats = { tested: 0, frustumCulled: 0, occluded: 0, visible: 0 };

  function beginFrame(camera) {
    stats.tested = 0;
    stats.frustumCulled = 0;
    stats.occluded = 0;
    stats.visible = 0;
    frustum.updateFromCamera(camera);
    if (occlusionEnabled) occluder.beginFrame(camera, frustum);
  }

  function testSphere(x, y, z, radius = 0, hardwareKey = null) {
    stats.tested++;
    if (!frustum.intersectsSphere(x, y, z, radius)) {
      stats.frustumCulled++;
      return false;
    }
    if (occlusionEnabled && occluder.activeCount > 0 && occluder.isSphereOccluded(x, y, z, radius)) {
      stats.occluded++;
      return false;
    }
    if (hardwareKey !== null && hardwarePool?.supported && hardwarePool.poll(hardwareKey)) {
      stats.occluded++;
      return false;
    }
    stats.visible++;
    return true;
  }

  /**
   * Three-state coarse sphere test (`0 = outside`, `1 = intersecting`, `2 = strictly inside`).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} [radius=0]
   * @returns {number}
   */
  function classifySphere(x, y, z, radius = 0) {
    stats.tested++;
    const state = frustum.classifySphere(x, y, z, radius);
    if (state === 0) {
      stats.frustumCulled++;
      return 0;
    }
    if (occlusionEnabled && occluder.activeCount > 0 && occluder.isSphereOccluded(x, y, z, radius)) {
      stats.occluded++;
      return 0;
    }
    stats.visible++;
    return (occlusionEnabled && occluder.activeCount > 0 && state === 2) ? 1 : state;
  }

  function dispose() {
    occluder.clearOccluders();
    hardwarePool?.dispose?.();
  }

  return {
    frustum,
    occluder,
    hardwarePool,
    get occlusionEnabled() { return occlusionEnabled; },
    setOcclusionEnabled(value) { occlusionEnabled = Boolean(value); },
    setMaxDistance(value) { frustum.setMaxDistance(value); },
    addOccluderAABB: occluder.addOccluderAABB,
    removeOccluder: occluder.removeOccluder,
    clearOccluders: occluder.clearOccluders,
    setOccludersFromColliders: occluder.setOccludersFromColliders,
    beginFrame,
    testSphere,
    classifySphere,
    get stats() { return { ...stats }; },
    dispose,
  };
}

/**
 * Dynamic GPU InstancedMesh pool (Unity-style Graphics.DrawMeshInstanced equivalent)
 * with O(1) slot alloc/free and per-frame frustum + occlusion compaction.
 * @param {InstancedBatchTHREE} THREE
 * @param {InstancedBatchOptions} options `geometry` and `material` are required.
 * @returns {InstancedBatch3D}
 */
export function createInstancedBatch3D(THREE, {
  geometry,
  material,
  capacity = 1024,
  castShadow = false,
  receiveShadow = false,
  perInstanceColor = false,
  cullRadius = 1.0,
} = {}) {
  if (!THREE?.InstancedMesh || !geometry || !material) {
    throw new TypeError('createInstancedBatch3D requires THREE.InstancedMesh, geometry, and material');
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000) {
    throw new RangeError('createInstancedBatch3D capacity must be an integer in 1..100000');
  }

  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.frustumCulled = false;
  mesh.castShadow = Boolean(castShadow);
  mesh.receiveShadow = Boolean(receiveShadow);
  mesh.count = 0;

  let colorAttr = null;
  if (perInstanceColor) {
    if (!mesh.instanceColor && THREE.InstancedBufferAttribute) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    }
    colorAttr = mesh.instanceColor ?? null;
  }

  const active = new Uint8Array(capacity);
  const visibleFlag = new Uint8Array(capacity);
  const px = new Float32Array(capacity);
  const py = new Float32Array(capacity);
  const pz = new Float32Array(capacity);
  const rx = new Float32Array(capacity);
  const ry = new Float32Array(capacity);
  const rz = new Float32Array(capacity);
  const sx = new Float32Array(capacity).fill(1);
  const sy = new Float32Array(capacity).fill(1);
  const sz = new Float32Array(capacity).fill(1);
  const radii = new Float32Array(capacity).fill(cullRadius);
  const cr = new Float32Array(capacity).fill(1);
  const cg = new Float32Array(capacity).fill(1);
  const cb = new Float32Array(capacity).fill(1);

  const freeStack = new Int32Array(capacity);
  let freeTop = capacity;
  for (let i = 0; i < capacity; i++) freeStack[i] = capacity - 1 - i;
  const activeIndices = new Int32Array(capacity);
  const indexInActive = new Int32Array(capacity).fill(-1);
  let activeCount = 0;

  function alloc({
    x = 0, y = 0, z = 0,
    rotationX = 0, rotationY = 0, rotationZ = 0,
    scale = 1, scaleX = scale, scaleY = scale, scaleZ = scale,
    radius = cullRadius,
    color = null, visible = true,
  } = {}) {
    if (freeTop <= 0) return -1;
    const idx = freeStack[--freeTop];
    const slot = activeCount++;
    activeIndices[slot] = idx;
    indexInActive[idx] = slot;
    active[idx] = 1;
    visibleFlag[idx] = visible ? 1 : 0;
    px[idx] = x; py[idx] = y; pz[idx] = z;
    rx[idx] = rotationX; ry[idx] = rotationY; rz[idx] = rotationZ;
    sx[idx] = scaleX; sy[idx] = scaleY; sz[idx] = scaleZ;
    radii[idx] = radius;
    if (Array.isArray(color)) {
      cr[idx] = color[0] ?? 1; cg[idx] = color[1] ?? 1; cb[idx] = color[2] ?? 1;
    } else if (color && typeof color === 'object' && 'r' in color) {
      cr[idx] = color.r; cg[idx] = color.g; cb[idx] = color.b;
    } else {
      cr[idx] = 1; cg[idx] = 1; cb[idx] = 1;
    }
    return idx;
  }

  function setTransform(idx, x, y, z, rotY = 0, scale = 1) {
    if (idx < 0 || idx >= capacity || !active[idx]) return false;
    px[idx] = x; py[idx] = y; pz[idx] = z;
    ry[idx] = rotY;
    sx[idx] = scale; sy[idx] = scale; sz[idx] = scale;
    return true;
  }

  function setRotation(idx, rotX, rotY, rotZ) {
    if (idx < 0 || idx >= capacity || !active[idx]) return false;
    rx[idx] = rotX; ry[idx] = rotY; rz[idx] = rotZ;
    return true;
  }

  function setColor(idx, r, g, b) {
    if (idx < 0 || idx >= capacity || !active[idx]) return false;
    cr[idx] = r; cg[idx] = g; cb[idx] = b;
    return true;
  }

  function setVisible(idx, value) {
    if (idx < 0 || idx >= capacity || !active[idx]) return false;
    visibleFlag[idx] = value ? 1 : 0;
    return true;
  }

  function free(idx) {
    if (idx < 0 || idx >= capacity || !active[idx]) return false;
    active[idx] = 0;
    visibleFlag[idx] = 0;
    const slot = indexInActive[idx];
    const last = --activeCount;
    if (slot !== last) {
      const moved = activeIndices[last];
      activeIndices[slot] = moved;
      indexInActive[moved] = slot;
    }
    indexInActive[idx] = -1;
    freeStack[freeTop++] = idx;
    return true;
  }

  function clear() {
    for (let i = 0; i < activeCount; i++) {
      const idx = activeIndices[i];
      active[idx] = 0;
      visibleFlag[idx] = 0;
      indexInActive[idx] = -1;
      freeStack[freeTop++] = idx;
    }
    activeCount = 0;
    mesh.count = 0;
  }

  function flush({ culler = null, onVisible = null } = {}) {
    const matArr = mesh.instanceMatrix?.array;
    const colArr = colorAttr?.array ?? null;
    let outCount = 0;

    for (let i = 0; i < activeCount; i++) {
      const idx = activeIndices[i];
      if (!visibleFlag[idx]) continue;
      const x = px[idx], y = py[idx], z = pz[idx];
      if (culler && !culler.testSphere(x, y, z, radii[idx])) continue;
      if (matArr) {
        writeMat4ToFloat32(
          matArr, outCount * 16,
          x, y, z, rx[idx], ry[idx], rz[idx], sx[idx], sy[idx], sz[idx],
        );
      }
      if (colArr) {
        const co = outCount * 3;
        colArr[co] = cr[idx]; colArr[co + 1] = cg[idx]; colArr[co + 2] = cb[idx];
      }
      onVisible?.(outCount, idx);
      outCount++;
    }

    mesh.count = outCount;
    if (mesh.instanceMatrix) mesh.instanceMatrix.needsUpdate = true;
    if (colorAttr) colorAttr.needsUpdate = true;
    return {
      totalActive: activeCount,
      visible: outCount,
      culled: activeCount - outCount,
    };
  }

  function dispose() {
    clear();
    mesh.parent?.remove?.(mesh);
    mesh.dispose?.();
  }

  return {
    mesh,
    capacity,
    get count() { return activeCount; },
    alloc,
    setTransform,
    setRotation,
    setColor,
    setVisible,
    free,
    clear,
    flush,
    dispose,
  };
}
