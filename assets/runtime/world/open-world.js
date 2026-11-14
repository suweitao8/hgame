/**
 * Renderer-neutral Open-World infrastructure:
 *   - Spatial World Partition grid (2D/3D cells, hysteresis unload radii,
 *     velocity lookahead priority, and per-frame load/unload/HLOD budgets)
 *   - Hierarchical LOD (HLOD) Three.js InstancedMesh proxy builder
 *   - Large-World Floating Origin rebaser preserving Float64 global coordinates
 *
 * Never imports 'three' directly; Three.js helpers accept { THREE }.
 */

/**
 * Three-component position: [x, y, z] or { x, y, z } (missing components default to 0).
 * @typedef {readonly number[] | { x?: number, y?: number, z?: number }} Vec3Input
 */

/** @typedef {[number, number, number]} Vec3Tuple */

/**
 * @param {Vec3Input | null | undefined} p
 * @returns {Vec3Tuple}
 */
function readPos3(p) {
  if (Array.isArray(p)) return [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0];
  return [Number(p?.x) || 0, Number(p?.y) || 0, Number(p?.z) || 0];
}

/** @param {number} vx @param {number} vy @param {number} vz @param {number} maxLen @returns {Vec3Tuple} */
function clampLen3(vx, vy, vz, maxLen) {
  const len = Math.hypot(vx, vy, vz);
  if (len <= maxLen || len < 1e-8) return [vx, vy, vz];
  const s = maxLen / len;
  return [vx * s, vy * s, vz * s];
}

/**
 * Immutable description of a partition cell passed to callbacks.
 * @typedef {object} WorldCellDescriptor
 * @property {number} cx Cell column index (world X / cellSize, floored).
 * @property {number} cy Cell row index: world Y in 2d and vertical modes, world Z in horizontal 3d mode.
 * @property {number} cz Vertical cell index (only non-zero when verticalCells is enabled).
 * @property {string} key Unique key, "cx,cy" or "cx,cy,cz" (vertical mode).
 * @property {Vec3Tuple} min Minimum world corner [x, y, z] (units).
 * @property {Vec3Tuple} max Maximum world corner [x, y, z] (units).
 * @property {Vec3Tuple} center World-space centre [x, y, z] (units).
 * @property {number} cellSize Cell edge length (world units).
 */

/** Lifecycle state of a tracked cell. @typedef {'unloaded' | 'loading' | 'loaded' | 'hlod'} WorldCellState */

/**
 * @typedef {object} WorldPartitionOptions
 * @property {number} [cellSize=128] Cell edge length in world units (> 0).
 * @property {'2d' | '3d'} [dimension='3d'] '2d' partitions X/Y; '3d' partitions X/Z (or X/Y/Z with verticalCells).
 * @property {boolean} [verticalCells=false] Also partition the Y axis in 3d mode.
 * @property {number} [loadRadius=256] Distance (world units) to the cell AABB within which cells are loaded (>= 0).
 * @property {number} [unloadRadius] Hysteresis radius before loaded cells unload (>= loadRadius). Default max(loadRadius * 1.25, loadRadius + 32).
 * @property {number} [hlodRadius=640] Distance within which HLOD proxies are built (needs createHLOD).
 * @property {number} [hlodUnloadRadius] Hysteresis radius for dropping HLOD proxies. Default max(hlodRadius * 1.15, unloadRadius).
 * @property {number} [lookaheadSeconds=0.75] Seconds of viewer velocity added to the load-priority focus point.
 * @property {number} [maxLookaheadDistance] Clamp for the lookahead offset (world units). Default cellSize * 1.5.
 * @property {number} [maxLoadsPerStep=2] Maximum cell loads started per step().
 * @property {number} [maxUnloadsPerStep=4] Maximum unloads (and HLOD drops) per step().
 * @property {number} [maxHlodBuildsPerStep=4] Maximum HLOD proxy builds per step().
 * @property {((desc: WorldCellDescriptor) => boolean) | null} [cellFilter=null] Return false to ignore a cell entirely.
 * @property {((desc: WorldCellDescriptor) => unknown) | null} [loadCell=null] Load a cell; may return data or a Promise of data. Without it cells become loaded immediately.
 * @property {((desc: WorldCellDescriptor, data: unknown) => void) | null} [unloadCell=null] Release the data returned by loadCell.
 * @property {((desc: WorldCellDescriptor) => unknown) | null} [createHLOD=null] Build a distant proxy for a cell; returned value is passed to destroyHLOD.
 * @property {((desc: WorldCellDescriptor, hlodData: unknown) => void) | null} [destroyHLOD=null] Dispose a proxy built by createHLOD.
 */

/**
 * @typedef {object} WorldPartitionStepSummary
 * @property {number} loaded Cells whose load completed synchronously this step.
 * @property {number} unloaded Loaded cells unloaded this step.
 * @property {number} hlodCreated HLOD proxies built this step.
 * @property {number} hlodDestroyed HLOD proxies destroyed this step.
 * @property {number} inFlight Cells currently in the asynchronous 'loading' state.
 */

/**
 * @typedef {object} WorldPartitionStats
 * @property {number} loaded Cells in 'loaded' state.
 * @property {number} loading Cells in 'loading' state.
 * @property {number} hlod Cells showing an HLOD proxy.
 * @property {number} pinned Number of pinned cell keys.
 * @property {number} tracked Total tracked cell records.
 */

/**
 * @typedef {object} WorldCellBounds
 * @property {Vec3Tuple} min Minimum corner [x, y, z].
 * @property {Vec3Tuple} max Maximum corner [x, y, z].
 * @property {Vec3Tuple} center Centre [x, y, z].
 */

/**
 * @typedef {object} WorldPartition
 * @property {number} cellSize Cell edge length (world units, read-only).
 * @property {number} loadRadius Load radius (world units, read-only).
 * @property {number} unloadRadius Unload radius (world units, read-only).
 * @property {number} hlodRadius HLOD radius (world units, read-only).
 * @property {WorldPartitionStats} stats Snapshot of current cell counts (getter).
 * @property {(x?: number, y?: number, z?: number) => { cx: number, cy: number, cz: number, key: string }} worldToCell Cell indices containing a world position.
 * @property {(cx: number, cy: number, cz?: number) => WorldCellBounds} cellBounds World-space bounds of a cell.
 * @property {(cx: number, cy: number, cz?: number) => void} pinCell Force a cell to stay loaded.
 * @property {(cx: number, cy: number, cz?: number) => void} unpinCell Release a pin.
 * @property {(viewerPos?: Vec3Input, viewerVel?: Vec3Input) => WorldPartitionStepSummary} step Advance streaming within per-step budgets.
 * @property {(viewerPos?: Vec3Input, viewerVel?: Vec3Input) => WorldPartitionStepSummary} forceFlush Like step() but ignoring budgets.
 * @property {(cx: number, cy: number, cz?: number) => WorldCellState} getCellState Current state ('unloaded' when untracked).
 * @property {(cx: number, cy: number, cz?: number) => unknown} getCellData Data returned by loadCell, or null.
 * @property {() => WorldCellDescriptor[]} getLoadedCells Descriptors of loaded cells.
 * @property {() => WorldCellDescriptor[]} getHlodCells Descriptors of cells showing HLOD proxies.
 * @property {() => void} clear Unload everything and forget all cells.
 */

/**
 * Creates a spatial cell streaming controller with HLOD distance rings,
 * hysteresis unload thresholds (to avoid boundary thrashing), velocity lookahead
 * priority sorting, and per-step CPU/GPU instantiation budgets.
 * @param {WorldPartitionOptions} [options]
 * @returns {WorldPartition}
 */
export function createWorldPartition(options = {}) {
  const {
    cellSize = 128,
    dimension = '3d',
    verticalCells = false,
    loadRadius = 256,
    unloadRadius = Math.max(loadRadius * 1.25, loadRadius + 32),
    hlodRadius = 640,
    hlodUnloadRadius = Math.max(hlodRadius * 1.15, unloadRadius),
    lookaheadSeconds = 0.75,
    maxLookaheadDistance = cellSize * 1.5,
    maxLoadsPerStep = 2,
    maxUnloadsPerStep = 4,
    maxHlodBuildsPerStep = 4,
    cellFilter = null,
    loadCell = null,
    unloadCell = null,
    createHLOD = null,
    destroyHLOD = null,
  } = options;

  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new RangeError('cellSize must be a positive finite number');
  }
  if (!Number.isFinite(loadRadius) || loadRadius < 0 || !Number.isFinite(unloadRadius) || unloadRadius < loadRadius) {
    throw new RangeError('unloadRadius must be >= loadRadius >= 0');
  }

  const use2D = dimension === '2d';
  const useVertical = !use2D && Boolean(verticalCells);
  const cells = new Map();
  const pinned = new Set();

  function keyFor(cx, cy, cz = 0) {
    return useVertical ? `${cx},${cy},${cz}` : `${cx},${cy}`;
  }

  function worldToCell(x = 0, y = 0, z = 0) {
    const cx = Math.floor(x / cellSize);
    const cy = Math.floor((use2D ? y : (useVertical ? y : z)) / cellSize);
    const cz = useVertical ? Math.floor(z / cellSize) : 0;
    return { cx, cy, cz, key: keyFor(cx, cy, cz) };
  }

  function cellBounds(cx, cy, cz = 0) {
    const minX = cx * cellSize;
    const maxX = minX + cellSize;
    if (use2D) {
      const minY = cy * cellSize;
      const maxY = minY + cellSize;
      return {
        min: [minX, minY, 0],
        max: [maxX, maxY, 0],
        center: [minX + cellSize * 0.5, minY + cellSize * 0.5, 0],
      };
    }
    if (useVertical) {
      const minY = cy * cellSize;
      const maxY = minY + cellSize;
      const minZ = cz * cellSize;
      const maxZ = minZ + cellSize;
      return {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
        center: [minX + cellSize * 0.5, minY + cellSize * 0.5, minZ + cellSize * 0.5],
      };
    }
    const minZ = cy * cellSize;
    const maxZ = minZ + cellSize;
    return {
      min: [minX, 0, minZ],
      max: [maxX, 0, maxZ],
      center: [minX + cellSize * 0.5, 0, minZ + cellSize * 0.5],
    };
  }

  function makeCellDescriptor(cx, cy, cz = 0) {
    const bounds = cellBounds(cx, cy, cz);
    return {
      cx,
      cy,
      cz,
      key: keyFor(cx, cy, cz),
      min: bounds.min,
      max: bounds.max,
      center: bounds.center,
      cellSize,
    };
  }

  function distanceToCellAABB(desc, vx, vy, vz) {
    const dx = vx < desc.min[0] ? desc.min[0] - vx : (vx > desc.max[0] ? vx - desc.max[0] : 0);
    if (use2D) {
      const dy = vy < desc.min[1] ? desc.min[1] - vy : (vy > desc.max[1] ? vy - desc.max[1] : 0);
      return Math.hypot(dx, dy);
    }
    if (useVertical) {
      const dy = vy < desc.min[1] ? desc.min[1] - vy : (vy > desc.max[1] ? vy - desc.max[1] : 0);
      const dz = vz < desc.min[2] ? desc.min[2] - vz : (vz > desc.max[2] ? vz - desc.max[2] : 0);
      return Math.hypot(dx, dy, dz);
    }
    const dz = vz < desc.min[2] ? desc.min[2] - vz : (vz > desc.max[2] ? vz - desc.max[2] : 0);
    return Math.hypot(dx, dz);
  }

  function distSqToFocus(desc, fx, fy, fz) {
    const dx = desc.center[0] - fx;
    if (use2D) return dx * dx + (desc.center[1] - fy) ** 2;
    if (useVertical) return dx * dx + (desc.center[1] - fy) ** 2 + (desc.center[2] - fz) ** 2;
    return dx * dx + (desc.center[2] - fz) ** 2;
  }

  function getOrCreateRecord(cx, cy, cz) {
    const key = keyFor(cx, cy, cz);
    let rec = cells.get(key);
    if (!rec) {
      rec = {
        desc: makeCellDescriptor(cx, cy, cz),
        state: 'unloaded',
        data: null,
        hlodData: null,
        epoch: 0,
      };
      cells.set(key, rec);
    }
    return rec;
  }

  function pinCell(cx, cy, cz = 0) {
    pinned.add(keyFor(cx, cy, cz));
  }

  function unpinCell(cx, cy, cz = 0) {
    pinned.delete(keyFor(cx, cy, cz));
  }

  function disposeHlod(rec, summary) {
    if (rec.hlodData == null && rec.state !== 'hlod') return;
    if (rec.hlodData != null) {
      destroyHLOD?.(rec.desc, rec.hlodData);
      rec.hlodData = null;
      summary.hlodDestroyed++;
    }
  }

  function beginLoadCell(rec, summary) {
    rec.epoch++;
    const myEpoch = rec.epoch;
    if (!loadCell) {
      disposeHlod(rec, summary);
      rec.state = 'loaded';
      summary.loaded++;
      return;
    }
    const result = loadCell(rec.desc);
    if (result && typeof result.then === 'function') {
      rec.state = 'loading';
      result.then(
        data => {
          if (rec.epoch !== myEpoch) {
            unloadCell?.(rec.desc, data);
            return;
          }
          if (rec.hlodData != null) {
            destroyHLOD?.(rec.desc, rec.hlodData);
            rec.hlodData = null;
          }
          rec.data = data;
          rec.state = 'loaded';
        },
        () => {
          if (rec.epoch === myEpoch) rec.state = 'unloaded';
        },
      );
      return;
    }
    disposeHlod(rec, summary);
    rec.data = result ?? true;
    rec.state = 'loaded';
    summary.loaded++;
  }

  function stepInternal(viewerPos = [0, 0, 0], viewerVel = [0, 0, 0], overrideBudget = null) {
    const [vx, vy, vz] = readPos3(viewerPos);
    const [rawVx, rawVy, rawVz] = readPos3(viewerVel);
    const [lx, ly, lz] = clampLen3(
      rawVx * lookaheadSeconds,
      rawVy * lookaheadSeconds,
      rawVz * lookaheadSeconds,
      maxLookaheadDistance,
    );
    const fx = vx + lx;
    const fy = vy + ly;
    const fz = vz + lz;

    const hlodCap = createHLOD ? Math.max(unloadRadius, hlodUnloadRadius) : unloadRadius;
    const cellSpan = Math.ceil(hlodCap / cellSize) + 1;
    const base = worldToCell(vx, vy, vz);

    // 1. Discover candidate cells in outer radius + handle pinned cells
    const candidates = new Set();
    for (let dx = -cellSpan; dx <= cellSpan; dx++) {
      for (let dy = -cellSpan; dy <= cellSpan; dy++) {
        if (useVertical) {
          for (let dz = -cellSpan; dz <= cellSpan; dz++) {
            candidates.add(keyFor(base.cx + dx, base.cy + dy, base.cz + dz));
          }
        } else {
          candidates.add(keyFor(base.cx + dx, base.cy + dy, 0));
        }
      }
    }
    for (const key of cells.keys()) candidates.add(key);
    for (const key of pinned) candidates.add(key);

    const toLoad = [];
    const toHlod = [];
    const toUnload = [];
    const toDropHlod = [];

    for (const key of candidates) {
      const parts = key.split(',').map(Number);
      const cx = parts[0], cy = parts[1], cz = parts[2] ?? 0;
      let rec = cells.get(key);
      const desc = rec?.desc ?? makeCellDescriptor(cx, cy, cz);
      if (cellFilter && !cellFilter(desc)) continue;

      const dist = distanceToCellAABB(desc, vx, vy, vz);
      const isPinned = pinned.has(key);

      let desired = 'unloaded';
      if (isPinned || dist <= loadRadius) {
        desired = 'loaded';
      } else if (dist <= unloadRadius) {
        if (rec && (rec.state === 'loaded' || rec.state === 'loading')) {
          desired = 'loaded';
        } else if (createHLOD && dist <= hlodRadius) {
          desired = 'hlod';
        }
      } else if (createHLOD && dist <= hlodRadius) {
        desired = 'hlod';
      } else if (createHLOD && dist <= hlodUnloadRadius) {
        desired = rec?.state === 'hlod' ? 'hlod' : 'unloaded';
      }

      if (!rec && desired === 'unloaded') continue;
      if (!rec) rec = getOrCreateRecord(cx, cy, cz);

      if (desired === 'loaded') {
        if (rec.state === 'unloaded' || rec.state === 'hlod') {
          toLoad.push({ rec, pinned: isPinned ? 1 : 0, score: distSqToFocus(rec.desc, fx, fy, fz) });
        }
      } else if (desired === 'hlod') {
        if (rec.state === 'loaded' || rec.state === 'loading') {
          toUnload.push({ rec, dist, downgradeToHlod: true });
        } else if (rec.state === 'unloaded' && createHLOD) {
          toHlod.push({ rec, score: distSqToFocus(rec.desc, fx, fy, fz) });
        }
      } else {
        if (rec.state === 'loaded' || rec.state === 'loading') {
          toUnload.push({ rec, dist, downgradeToHlod: false });
        } else if (rec.state === 'hlod') {
          toDropHlod.push({ rec, dist });
        }
      }
    }

    toLoad.sort((a, b) => (b.pinned - a.pinned) || (a.score - b.score));
    toHlod.sort((a, b) => a.score - b.score);
    toUnload.sort((a, b) => b.dist - a.dist);
    toDropHlod.sort((a, b) => b.dist - a.dist);

    const summary = { loaded: 0, unloaded: 0, hlodCreated: 0, hlodDestroyed: 0, inFlight: 0 };

    // 2. Unloads first so budgets free resources before instantiating incoming cells
    const capUnload = overrideBudget ?? maxUnloadsPerStep;
    const capLoad = overrideBudget ?? maxLoadsPerStep;
    const capHlod = overrideBudget ?? maxHlodBuildsPerStep;

    const unloadLimit = Math.min(capUnload, toUnload.length);
    for (let i = 0; i < unloadLimit; i++) {
      const { rec, downgradeToHlod } = toUnload[i];
      rec.epoch++;
      if (rec.state === 'loaded') {
        unloadCell?.(rec.desc, rec.data);
        summary.unloaded++;
      }
      rec.data = null;
      if (downgradeToHlod && createHLOD) {
        rec.hlodData = createHLOD(rec.desc) ?? true;
        rec.state = 'hlod';
        summary.hlodCreated++;
      } else {
        rec.state = 'unloaded';
        cells.delete(rec.desc.key);
      }
    }

    const dropHlodLimit = Math.min(capUnload, toDropHlod.length);
    for (let i = 0; i < dropHlodLimit; i++) {
      const { rec } = toDropHlod[i];
      disposeHlod(rec, summary);
      rec.state = 'unloaded';
      cells.delete(rec.desc.key);
    }

    // 3. Full loads sorted by velocity lookahead proximity
    const loadLimit = Math.min(capLoad, toLoad.length);
    for (let i = 0; i < loadLimit; i++) {
      beginLoadCell(toLoad[i].rec, summary);
    }

    // 4. HLOD proxy builds for mid/far ring
    const hlodBuildLimit = Math.min(capHlod, toHlod.length);
    for (let i = 0; i < hlodBuildLimit; i++) {
      const rec = toHlod[i].rec;
      if (rec.state === 'unloaded' && createHLOD) {
        rec.hlodData = createHLOD(rec.desc) ?? true;
        rec.state = 'hlod';
        summary.hlodCreated++;
      }
    }

    for (const rec of cells.values()) {
      if (rec.state === 'loading') summary.inFlight++;
    }
    return summary;
  }

  function step(viewerPos = [0, 0, 0], viewerVel = [0, 0, 0]) {
    return stepInternal(viewerPos, viewerVel, null);
  }

  function forceFlush(viewerPos = [0, 0, 0], viewerVel = [0, 0, 0]) {
    return stepInternal(viewerPos, viewerVel, Infinity);
  }

  function getStats() {
    let loaded = 0, loading = 0, hlod = 0;
    for (const rec of cells.values()) {
      if (rec.state === 'loaded') loaded++;
      else if (rec.state === 'loading') loading++;
      else if (rec.state === 'hlod') hlod++;
    }
    return { loaded, loading, hlod, pinned: pinned.size, tracked: cells.size };
  }

  function getCellState(cx, cy, cz = 0) {
    return cells.get(keyFor(cx, cy, cz))?.state ?? 'unloaded';
  }

  function getCellData(cx, cy, cz = 0) {
    return cells.get(keyFor(cx, cy, cz))?.data ?? null;
  }

  function getLoadedCells() {
    const out = [];
    for (const rec of cells.values()) {
      if (rec.state === 'loaded') out.push(rec.desc);
    }
    return out;
  }

  function getHlodCells() {
    const out = [];
    for (const rec of cells.values()) {
      if (rec.state === 'hlod') out.push(rec.desc);
    }
    return out;
  }

  function clear() {
    for (const rec of cells.values()) {
      rec.epoch++;
      if (rec.state === 'loaded') unloadCell?.(rec.desc, rec.data);
      if (rec.hlodData != null) destroyHLOD?.(rec.desc, rec.hlodData);
    }
    cells.clear();
  }

  return {
    get cellSize() { return cellSize; },
    get loadRadius() { return loadRadius; },
    get unloadRadius() { return unloadRadius; },
    get hlodRadius() { return hlodRadius; },
    get stats() { return getStats(); },
    worldToCell,
    cellBounds,
    pinCell,
    unpinCell,
    step,
    forceFlush,
    getCellState,
    getCellData,
    getLoadedCells,
    getHlodCells,
    clear,
  };
}

/**
 * Opaque Three.js namespace (or subset) injected by the caller; this module never imports 'three'.
 * @typedef {Record<string, unknown>} ThreeNamespace
 */

/**
 * One static proxy instance. Rotation is Euler XYZ radians.
 * @typedef {object} HLODProxyDescriptor
 * @property {unknown} [geometry] THREE.BufferGeometry; defaults to a shared unit box.
 * @property {unknown} [material] THREE.Material; defaults to a shared standard material.
 * @property {number} [x=0] Position X (world units).
 * @property {number} [y=0] Position Y (world units).
 * @property {number} [z=0] Position Z (world units).
 * @property {number} [rx=0] Rotation X (radians).
 * @property {number} [ry=0] Rotation Y (radians).
 * @property {number} [rz=0] Rotation Z (radians).
 * @property {number} [sx=1] Scale X.
 * @property {number} [sy=1] Scale Y.
 * @property {number} [sz=1] Scale Z.
 * @property {number | string} [color] Per-instance colour accepted by THREE.Color#set.
 */

/**
 * Minimal Object3D-like parent (e.g. THREE.Scene or THREE.Group).
 * @typedef {object} HLODParentLike
 * @property {(child: unknown) => unknown} add
 */

/**
 * @typedef {object} HLODProxyGroupOptions
 * @property {HLODParentLike | null} [parent=null] Parent the proxy group is added to.
 * @property {HLODProxyDescriptor[]} [proxies=[]] Proxy instances to batch.
 * @property {boolean} [castShadow=false] Instanced meshes cast shadows.
 * @property {boolean} [receiveShadow=false] Instanced meshes receive shadows.
 * @property {number} [defaultColor=0x8f9aa6] Colour (0xRRGGBB) of the fallback material.
 */

/**
 * @typedef {object} HLODProxyGroup3D
 * @property {unknown} group THREE.Group containing one InstancedMesh per geometry/material pair.
 * @property {number} drawCallCount Number of InstancedMesh batches (getter).
 * @property {number} instanceCount Number of proxy instances (getter).
 * @property {() => boolean} dispose Remove from parent and free resources; false if already disposed.
 */

/**
 * Groups static proxy descriptors for a distant World Partition cell into
 * minimal InstancedMesh draw calls (Hierarchical LOD proxy batch).
 * @param {ThreeNamespace} THREE Three.js namespace (Group, InstancedMesh, Matrix4, BoxGeometry, MeshStandardMaterial required).
 * @param {HLODProxyGroupOptions} [options]
 * @returns {HLODProxyGroup3D}
 */
export function createHLODProxyGroup3D(THREE, {
  parent = null,
  proxies = [],
  castShadow = false,
  receiveShadow = false,
  defaultColor = 0x8f9aa6,
} = {}) {
  if (!THREE?.Group || !THREE?.InstancedMesh || !THREE?.Matrix4 || !THREE?.BoxGeometry || !THREE?.MeshStandardMaterial) {
    throw new TypeError('createHLODProxyGroup3D requires Three.js Group, InstancedMesh, Matrix4, BoxGeometry and MeshStandardMaterial');
  }

  const group = new THREE.Group();
  group.name = 'HGameHLODProxyGroup';
  const fallbackGeo = new THREE.BoxGeometry(1, 1, 1);
  const fallbackMat = new THREE.MeshStandardMaterial({ color: defaultColor, roughness: 0.88, metalness: 0.0 });
  const keyMap = new Map();
  let nextPairId = 1;
  const pairIds = new WeakMap();
  const batches = [];

  function idFor(obj) {
    let id = pairIds.get(obj);
    if (!id) {
      id = nextPairId++;
      pairIds.set(obj, id);
    }
    return id;
  }

  for (const item of proxies) {
    const geo = item.geometry ?? fallbackGeo;
    const mat = item.material ?? fallbackMat;
    const key = `${idFor(geo)}:${idFor(mat)}`;
    let bucket = keyMap.get(key);
    if (!bucket) {
      bucket = { geo, mat, items: [] };
      keyMap.set(key, bucket);
    }
    bucket.items.push(item);
  }

  const dummyMatrix = new THREE.Matrix4();
  const dummyPos = new THREE.Vector3();
  const dummyEuler = THREE.Euler ? new THREE.Euler(0, 0, 0, 'XYZ') : null;
  const dummyQuat = new THREE.Quaternion();
  const dummyScale = new THREE.Vector3();
  const dummyColor = THREE.Color ? new THREE.Color() : null;

  for (const bucket of keyMap.values()) {
    const count = bucket.items.length;
    if (count === 0) continue;
    const mesh = new THREE.InstancedMesh(bucket.geo, bucket.mat, count);
    mesh.castShadow = Boolean(castShadow);
    mesh.receiveShadow = Boolean(receiveShadow);
    let hasColor = false;

    for (let i = 0; i < count; i++) {
      const p = bucket.items[i];
      dummyPos.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
      if (dummyEuler) {
        dummyEuler.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0);
        dummyQuat.setFromEuler(dummyEuler);
      } else {
        dummyQuat.set(0, 0, 0, 1);
      }
      dummyScale.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
      dummyMatrix.compose(dummyPos, dummyQuat, dummyScale);
      mesh.setMatrixAt(i, dummyMatrix);

      if (p.color !== undefined && dummyColor && typeof mesh.setColorAt === 'function') {
        dummyColor.set(p.color);
        mesh.setColorAt(i, dummyColor);
        hasColor = true;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (hasColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    batches.push(mesh);
  }

  if (parent && typeof parent.add === 'function') {
    parent.add(group);
  }

  let disposed = false;
  function dispose() {
    if (disposed) return false;
    disposed = true;
    group.parent?.remove?.(group);
    for (const mesh of batches) mesh.dispose?.();
    fallbackGeo.dispose?.();
    fallbackMat.dispose?.();
    return true;
  }

  return {
    group,
    get drawCallCount() { return batches.length; },
    get instanceCount() { return proxies.length; },
    dispose,
  };
}

/**
 * @typedef {object} FloatingOriginShiftPayload
 * @property {number} dx Shift applied on X (world units).
 * @property {number} dy Shift applied on Y (world units).
 * @property {number} dz Shift applied on Z (world units).
 * @property {Vec3Tuple} origin New accumulated global origin [x, y, z] (Float64 values).
 * @property {number} shiftCount Total number of shifts so far.
 */

/**
 * @typedef {object} FloatingOriginOptions
 * @property {number} [threshold=4096] Local distance (world units, > 0) from origin that triggers a rebase.
 * @property {number} [snapGrid=64] Shifts are rounded to multiples of this (>= 0; 0 disables snapping).
 * @property {boolean} [verticalShift=false] Include the Y axis in distance checks and shifts.
 * @property {boolean} [syncPhysics=true] Call scene.physics.setPosition for shifted entities.
 * @property {((payload: FloatingOriginShiftPayload) => void) | null} [onShift=null] Called after each shift.
 */

/**
 * Result of FloatingOrigin#update.
 * @typedef {object} FloatingOriginUpdateResult
 * @property {boolean} shifted True when the origin moved.
 * @property {number} dx
 * @property {number} dy
 * @property {number} dz
 * @property {Vec3Tuple} origin Global origin [x, y, z].
 * @property {number} shiftCount
 */

/**
 * Scene-like object whose root entities are shifted (core Scene).
 * @typedef {object} FloatingOriginSceneLike
 * @property {ArrayLike<{ x: number, y: number, z: number, destroyed?: boolean }>} [objects] Root entities.
 * @property {{ setPosition?: (entity: object, pos: { x: number, y: number, z: number }) => void, get?: (entity: object) => unknown }} [physics]
 */

/**
 * @typedef {object} FloatingOrigin
 * @property {Vec3Tuple} origin Copy of the accumulated global origin (getter).
 * @property {number} shiftCount Number of rebases performed (getter).
 * @property {(wx?: number, wy?: number, wz?: number, out?: number[]) => number[]} worldToLocal Global to local coordinates; writes into out.
 * @property {(lx?: number, ly?: number, lz?: number, out?: number[]) => number[]} localToWorld Local to global coordinates; writes into out.
 * @property {(scene: FloatingOriginSceneLike) => void} registerScene Shift this scene's root entities on rebase.
 * @property {(scene: FloatingOriginSceneLike) => void} unregisterScene
 * @property {(obj: { position: { x: number, y: number, z: number }, updateMatrixWorld?: (force?: boolean) => void }) => void} registerObject3D Shift a Three.js Object3D on rebase.
 * @property {(obj: unknown) => void} unregisterObject3D
 * @property {(vol: { shiftOrigin?: (dx: number, dy: number, dz: number) => void }) => void} registerProbeVolume Shift an irradiance probe volume (receives negated deltas).
 * @property {(vol: unknown) => void} unregisterProbeVolume
 * @property {(palette: { shiftOffset?: (dx: number, dy: number, dz: number) => void }) => void} registerWorldMaterialPalette Shift a world-aligned material palette.
 * @property {(palette: unknown) => void} unregisterWorldMaterialPalette
 * @property {(mat: { userData?: Record<string, unknown> }) => void} registerWorldMaterial Shift a world-aligned material offset uniform.
 * @property {(mat: unknown) => void} unregisterWorldMaterial
 * @property {(cb: (payload: FloatingOriginShiftPayload) => void) => () => boolean} onDidShift Subscribe to shifts; returns an unsubscribe function.
 * @property {(viewerLocalPos?: Vec3Input) => FloatingOriginUpdateResult} update Rebase when the viewer's local position exceeds the threshold.
 */

/**
 * Large-World Floating Origin controller ("World Origin Rebasing"):
 * keeps rendered/physics local coordinates bounded within [-threshold, +threshold]
 * to prevent float32 GPU vertex shimmer while preserving exact Float64 global coordinates.
 * @param {FloatingOriginOptions} [options]
 * @returns {FloatingOrigin}
 */
export function createFloatingOrigin({
  threshold = 4096,
  snapGrid = 64,
  verticalShift = false,
  syncPhysics = true,
  onShift = null,
} = {}) {
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new RangeError('threshold must be positive');
  }
  if (!Number.isFinite(snapGrid) || snapGrid < 0) {
    throw new RangeError('snapGrid must be non-negative');
  }

  const origin = new Float64Array(3);
  const scenes = new Set();
  const objects = new Set();
  const probeVolumes = new Set();
  const worldPalettes = new Set();
  const worldMaterials = new Set();
  const shiftCallbacks = new Set();
  let shiftCount = 0;

  function worldToLocal(wx = 0, wy = 0, wz = 0, out = [0, 0, 0]) {
    out[0] = wx - origin[0];
    out[1] = wy - origin[1];
    out[2] = wz - origin[2];
    return out;
  }

  function localToWorld(lx = 0, ly = 0, lz = 0, out = [0, 0, 0]) {
    out[0] = lx + origin[0];
    out[1] = ly + origin[1];
    out[2] = lz + origin[2];
    return out;
  }

  function applyShift(dx, dy, dz) {
    origin[0] += dx;
    origin[1] += dy;
    origin[2] += dz;
    shiftCount++;

    for (const scene of scenes) {
      const roots = scene?.objects ?? [];
      for (let i = 0; i < roots.length; i++) {
        const entity = roots[i];
        if (!entity || entity.destroyed) continue;
        entity.x -= dx;
        entity.y -= dy;
        entity.z -= dz;
        if (entity._prevX !== undefined) entity._prevX -= dx;
        if (entity._prevY !== undefined) entity._prevY -= dy;
        if (entity._prevZ !== undefined) entity._prevZ -= dz;
        if (syncPhysics && scene.physics?.setPosition && scene.physics?.get?.(entity)) {
          scene.physics.setPosition(entity, { x: entity.x, y: entity.y, z: entity.z });
        }
      }
    }

    for (const obj of objects) {
      if (obj?.position) {
        obj.position.x -= dx;
        obj.position.y -= dy;
        obj.position.z -= dz;
        obj.updateMatrixWorld?.(true);
      }
    }

    for (const vol of probeVolumes) {
      vol?.shiftOrigin?.(-dx, -dy, -dz);
    }

    for (const palette of worldPalettes) {
      palette?.shiftOffset?.(dx, dy, dz);
    }

    for (const mat of worldMaterials) {
      const u = mat?.userData?.worldAlignedOffsetUniform?.value;
      if (u) {
        u.x += dx;
        u.y += dy;
        u.z += dz;
      }
    }

    const payload = { dx, dy, dz, origin: [origin[0], origin[1], origin[2]], shiftCount };
    onShift?.(payload);
    for (const cb of shiftCallbacks) cb(payload);
    return payload;
  }

  function update(viewerLocalPos = [0, 0, 0]) {
    const [lx, ly, lz] = readPos3(viewerLocalPos);
    const dist = verticalShift ? Math.hypot(lx, ly, lz) : Math.hypot(lx, lz);
    if (dist < threshold) {
      return { shifted: false, dx: 0, dy: 0, dz: 0, origin: [origin[0], origin[1], origin[2]], shiftCount };
    }

    const snap = (v) => (snapGrid > 0 ? ((Math.round(v / snapGrid) * snapGrid) || 0) : (v || 0));
    const dx = snap(lx);
    const dy = verticalShift ? snap(ly) : 0;
    const dz = snap(lz);
    if (dx === 0 && dy === 0 && dz === 0) {
      return { shifted: false, dx: 0, dy: 0, dz: 0, origin: [origin[0], origin[1], origin[2]], shiftCount };
    }

    const payload = applyShift(dx, dy, dz);
    return { shifted: true, ...payload };
  }

  return {
    get origin() { return [origin[0], origin[1], origin[2]]; },
    get shiftCount() { return shiftCount; },
    worldToLocal,
    localToWorld,
    registerScene(scene) { if (scene) scenes.add(scene); },
    unregisterScene(scene) { scenes.delete(scene); },
    registerObject3D(obj) { if (obj) objects.add(obj); },
    unregisterObject3D(obj) { objects.delete(obj); },
    registerProbeVolume(vol) { if (vol) probeVolumes.add(vol); },
    unregisterProbeVolume(vol) { probeVolumes.delete(vol); },
    registerWorldMaterialPalette(palette) { if (palette) worldPalettes.add(palette); },
    unregisterWorldMaterialPalette(palette) { worldPalettes.delete(palette); },
    registerWorldMaterial(mat) { if (mat) worldMaterials.add(mat); },
    unregisterWorldMaterial(mat) { worldMaterials.delete(mat); },
    onDidShift(cb) {
      if (typeof cb === 'function') shiftCallbacks.add(cb);
      return () => shiftCallbacks.delete(cb);
    },
    update,
  };
}
