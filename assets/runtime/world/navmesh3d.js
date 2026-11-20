import { createNavPathWork } from './internal/navmesh3d-work.js';
import { guardNavigationWork } from './internal/path-work.js';

/**
 * @typedef {object} NavObstacleAABB
 * @property {number} minX
 * @property {number} maxX
 * @property {number} minZ
 * @property {number} maxZ
 * @property {number} [minY=-Infinity]
 * @property {number} [maxY=Infinity]
 */

/**
 * @typedef {object} NavSurfaceBox
 * @property {number} minX
 * @property {number} maxX
 * @property {number} minZ
 * @property {number} maxZ
 * @property {number} y Surface top elevation.
 */

/**
 * @typedef {object} NavMesh3DOptions
 * @property {{ minX: number, maxX: number, minZ: number, maxZ: number }} bounds World XZ navigation bounds.
 * @property {number} [cellSize=1] Grid quantization cell size in world units.
 * @property {number} [agentRadius=0.45] Horizontal obstacle inflation radius.
 * @property {number} [stepHeight=0.6] Maximum traversable vertical elevation delta between neighboring cells.
 * @property {number} [groundY=0] Default floor elevation when no surface overrides a cell.
 * @property {(x: number, z: number) => number} [sampleHeight] Optional continuous height provider (e.g. terrain).
 * @property {NavObstacleAABB[]} [obstacles=[]] Static blocking AABB obstacles.
 * @property {NavSurfaceBox[]} [surfaces=[]] Elevated walkable platforms/bridges.
 */

/**
 * @typedef {{ x: number, y: number, z: number }} Vec3Point
 */
/** @typedef {{ x: number, y?: number, z: number }} NavEndpoint */
/** @typedef {{ smooth?: boolean, maxSnapCells?: number, maxNodes?: number }} NavPathOptions */

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const STEP_COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

/** @param {NavPathOptions} options */
function pathNodeLimit(options) {
  const maxNodes = options.maxNodes ?? Infinity;
  if (maxNodes !== Infinity && (!Number.isSafeInteger(maxNodes) || maxNodes < 0)) {
    throw new RangeError('3D pathfinding maxNodes must be a non-negative integer or Infinity');
  }
  return maxNodes;
}

/**
 * Lightweight 3D Height-Aware NavMesh + A* + String-Pulling Corridor Smoother.
 * Supports obstacle radius inflation, multi-elevation platforms/ramps within `stepHeight`,
 * and line-of-sight string-pulling so 3D agents follow smooth paths around corners.
 * @param {NavMesh3DOptions} options
 */
export function createNavMesh3D(options) {
  if (!options || !options.bounds) throw new TypeError('createNavMesh3D requires { bounds }.');
  const { minX, maxX, minZ, maxZ } = options.bounds;
  const cellSize = Number.isFinite(options.cellSize) && options.cellSize > 0 ? options.cellSize : 1;
  const agentRadius = Number.isFinite(options.agentRadius) && options.agentRadius >= 0 ? options.agentRadius : 0.45;
  const stepHeight = Number.isFinite(options.stepHeight) && options.stepHeight >= 0 ? options.stepHeight : 0.6;
  const groundY = Number.isFinite(options.groundY) ? options.groundY : 0;
  const heightFn = typeof options.sampleHeight === 'function' ? options.sampleHeight : null;

  const cols = Math.max(1, Math.ceil((maxX - minX) / cellSize));
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / cellSize));
  const total = cols * rows;

  const walkable = new Uint8Array(total);
  const heights = new Float32Array(total);
  const gScore = new Float32Array(total);
  const fScore = new Float32Array(total);
  const cameFrom = new Int32Array(total);
  // Zero is untouched, one is closed, and an open cell stores its heap index + 2.
  const heapState = new Uint32Array(total);
  let revision = 0;

  /** @type {NavObstacleAABB[]} */
  const obstacles = Array.isArray(options.obstacles) ? options.obstacles.map((o) => ({ ...o })) : [];
  /** @type {NavSurfaceBox[]} */
  const surfaces = Array.isArray(options.surfaces) ? options.surfaces.map((s) => ({ ...s })) : [];

  function worldToCellX(x) {
    return Math.max(0, Math.min(cols - 1, Math.floor((x - minX) / cellSize)));
  }

  function worldToCellZ(z) {
    return Math.max(0, Math.min(rows - 1, Math.floor((z - minZ) / cellSize)));
  }

  function cellCenterX(cx) {
    const left = minX + cx * cellSize;
    return left + Math.min(cellSize, Math.max(0, maxX - left)) * 0.5;
  }

  function cellCenterZ(cz) {
    const top = minZ + cz * cellSize;
    return top + Math.min(cellSize, Math.max(0, maxZ - top)) * 0.5;
  }

  function rebuild() {
    revision++;
    for (let cz = 0; cz < rows; cz++) {
      const wz = cellCenterZ(cz);
      for (let cx = 0; cx < cols; cx++) {
        const wx = cellCenterX(cx);
        const idx = cz * cols + cx;

        let y = heightFn ? heightFn(wx, wz) : groundY;
        for (let s = 0; s < surfaces.length; s++) {
          const surf = surfaces[s];
          if (wx >= surf.minX && wx <= surf.maxX && wz >= surf.minZ && wz <= surf.maxZ && surf.y > y) {
            y = surf.y;
          }
        }
        heights[idx] = y;

        let blocked = false;
        for (let o = 0; o < obstacles.length; o++) {
          const ob = obstacles[o];
          const minOy = ob.minY ?? -Infinity;
          const maxOy = ob.maxY ?? Infinity;
          if (
            wx >= ob.minX - agentRadius &&
            wx <= ob.maxX + agentRadius &&
            wz >= ob.minZ - agentRadius &&
            wz <= ob.maxZ + agentRadius &&
            y >= minOy - 0.1 &&
            y <= maxOy
          ) {
            blocked = true;
            break;
          }
        }
        walkable[idx] = blocked ? 0 : 1;
      }
    }
  }

  rebuild();

  function addObstacle(aabb) {
    obstacles.push({ ...aabb });
    rebuild();
  }

  function clearObstacles() {
    obstacles.length = 0;
    rebuild();
  }

  function isCellWalkable(cx, cz) {
    if (cx < 0 || cx >= cols || cz < 0 || cz >= rows) return false;
    return walkable[cz * cols + cx] === 1;
  }

  function canTraverse(ax, az, bx, bz) {
    if (!isCellWalkable(ax, az) || !isCellWalkable(bx, bz)) return false;
    const aIdx = az * cols + ax;
    const bIdx = bz * cols + bx;
    if (Math.abs(heights[bIdx] - heights[aIdx]) > stepHeight) return false;
    // Prevent diagonal corner cutting through blocked cardinal neighbors.
    if (ax !== bx && az !== bz) {
      if (!isCellWalkable(bx, az) || !isCellWalkable(ax, bz)) return false;
      if (Math.abs(heights[az * cols + bx] - heights[aIdx]) > stepHeight) return false;
      if (Math.abs(heights[bz * cols + ax] - heights[aIdx]) > stepHeight) return false;
    }
    return true;
  }

  function isWalkable(x, z) {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return false;
    return isCellWalkable(worldToCellX(x), worldToCellZ(z));
  }

  function findNearestWalkableCell(cx, cz, maxCellRadius = 8) {
    if (isCellWalkable(cx, cz)) return [cx, cz];
    let best = null;
    let bestD2 = Infinity;
    for (let r = 1; r <= maxCellRadius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (!isCellWalkable(nx, nz)) continue;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = [nx, nz];
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /**
   * Bresenham-style supercover grid LOS check with height delta guard.
   */
  function hasLineOfSight(ax, az, bx, bz) {
    const steps = Math.max(Math.abs(bx - ax), Math.abs(bz - az)) * 2;
    if (steps === 0) return true;
    let prevCx = ax;
    let prevCz = az;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const cx = Math.round(ax + (bx - ax) * t);
      const cz = Math.round(az + (bz - az) * t);
      if (cx === prevCx && cz === prevCz) continue;
      if (!canTraverse(prevCx, prevCz, cx, cz)) return false;
      prevCx = cx;
      prevCz = cz;
    }
    return true;
  }

  // Indexed min-heap over packed cell IDs. Priority changes move the existing
  // entry up instead of leaving copies with inconsistent priorities.
  const heap = [];
  const touched = [];
  function queueNode(node) {
    let i = heapState[node] - 2;
    if (i < 0) {
      touched.push(node);
      i = heap.length;
      heap.push(node);
    }
    while (i > 0) {
      const p = (i - 1) >>> 1;
      const parent = heap[p];
      if (fScore[parent] <= fScore[node]) break;
      heap[i] = parent;
      heapState[parent] = i + 2;
      i = p;
    }
    heap[i] = node;
    heapState[node] = i + 2;
  }
  function heapPop() {
    const top = heap[0];
    const last = heap.pop();
    heapState[top] = 1;
    if (heap.length > 0) {
      let i = 0;
      const len = heap.length;
      while (i * 2 + 1 < len) {
        let child = i * 2 + 1;
        const right = child + 1;
        if (right < len && fScore[heap[right]] < fScore[heap[child]]) child = right;
        const childNode = heap[child];
        if (fScore[last] <= fScore[childNode]) break;
        heap[i] = childNode;
        heapState[childNode] = i + 2;
        i = child;
      }
      heap[i] = last;
      heapState[last] = i + 2;
    }
    return top;
  }

  function searchCells(startIdx, goalIdx, goalX, goalZ, maxNodes) {
    const startX = startIdx % cols;
    const startZ = (startIdx - startX) / cols;
    gScore[startIdx] = 0;
    fScore[startIdx] = Math.hypot(goalX - startX, goalZ - startZ);
    cameFrom[startIdx] = -1;
    queueNode(startIdx);

    let visited = 0;
    try {
      while (heap.length > 0 && visited++ < maxNodes) {
        const cur = heapPop();
        if (cur === goalIdx) return true;
        const cx = cur % cols;
        const cz = (cur - cx) / cols;
        for (let d = 0; d < 8; d++) {
          const nx = cx + DX[d];
          const nz = cz + DZ[d];
          if (!canTraverse(cx, cz, nx, nz)) continue;
          const nIdx = nz * cols + nx;
          const state = heapState[nIdx];
          if (state === 1) continue;
          const slopePenalty = Math.abs(heights[nIdx] - heights[cur]) * 0.5;
          const tentative = gScore[cur] + STEP_COST[d] + slopePenalty;
          if (!(tentative < (state === 0 ? Infinity : gScore[nIdx]))) continue;
          cameFrom[nIdx] = cur;
          gScore[nIdx] = tentative;
          fScore[nIdx] = tentative + Math.hypot(goalX - nx, goalZ - nz);
          queueNode(nIdx);
        }
      }
      return false;
    } finally {
      for (let i = 0; i < touched.length; i++) heapState[touched[i]] = 0;
      touched.length = 0;
      heap.length = 0;
    }
  }

  /**
   * Computes a smooth 3D waypoint path `{ x, y, z }[]` between `start` and `goal`,
   * or `null` if unreachable.
   * @param {NavEndpoint} start
   * @param {NavEndpoint} goal
   * @param {NavPathOptions} [pathOpts] `maxNodes` caps visited cells and defaults to unlimited.
   * @returns {Vec3Point[] | null}
   */
  function findPath(start, goal, pathOpts = {}) {
    const smooth = pathOpts.smooth !== false;
    const maxSnap = Number.isInteger(pathOpts.maxSnapCells) ? pathOpts.maxSnapCells : 6;
    const maxNodes = pathNodeLimit(pathOpts);
    if (maxNodes === 0) return null;
    const sCell = findNearestWalkableCell(worldToCellX(start.x), worldToCellZ(start.z), maxSnap);
    const gCell = findNearestWalkableCell(worldToCellX(goal.x), worldToCellZ(goal.z), maxSnap);
    if (!sCell || !gCell) return null;

    const startIdx = sCell[1] * cols + sCell[0];
    const goalIdx = gCell[1] * cols + gCell[0];
    if (startIdx === goalIdx) {
      return isWalkable(goal.x, goal.z)
        ? [{ x: goal.x, y: heights[goalIdx], z: goal.z }]
        : [{ x: cellCenterX(gCell[0]), y: heights[goalIdx], z: cellCenterZ(gCell[1]) }];
    }

    if (!searchCells(startIdx, goalIdx, gCell[0], gCell[1], maxNodes)) return null;

    // Reconstruct raw cell sequence start -> goal.
    const rawCells = [];
    let cur = goalIdx;
    while (cur !== -1) {
      const cx = cur % cols;
      const cz = (cur - cx) / cols;
      rawCells.push([cx, cz, cur]);
      if (cur === startIdx) break;
      cur = cameFrom[cur];
    }
    rawCells.reverse();

    // String-pulling LOS smoothing.
    let kept = rawCells;
    if (smooth && rawCells.length > 2) {
      kept = [rawCells[0]];
      let anchorIdx = 0;
      while (anchorIdx < rawCells.length - 1) {
        let farthest = anchorIdx + 1;
        for (let probe = rawCells.length - 1; probe > anchorIdx + 1; probe--) {
          if (hasLineOfSight(rawCells[anchorIdx][0], rawCells[anchorIdx][1], rawCells[probe][0], rawCells[probe][1])) {
            farthest = probe;
            break;
          }
        }
        kept.push(rawCells[farthest]);
        anchorIdx = farthest;
      }
    }

    const waypoints = kept.map(([cx, cz, idx], i) => {
      if (i === 0 && isWalkable(start.x, start.z)) return { x: start.x, y: heights[idx], z: start.z };
      if (i === kept.length - 1 && isWalkable(goal.x, goal.z)) return { x: goal.x, y: heights[idx], z: goal.z };
      return { x: cellCenterX(cx), y: heights[idx], z: cellCenterZ(cz) };
    });
    return waypoints;
  }

  const pathGrid = {
    cols, rows, heights, canTraverse, isCellWalkable, isWalkable,
    worldToCellX, worldToCellZ, cellCenterX, cellCenterZ,
    dx: DX, dz: DZ, stepCost: STEP_COST,
  };
  /**
   * Create an interruptible search, including snapping and waypoint smoothing.
   * @param {NavEndpoint} start
   * @param {NavEndpoint} goal
   * @param {NavPathOptions} [pathOpts]
   * @returns {Generator<undefined, Vec3Point[] | null, void>}
   */
  function createPathWork(start, goal, pathOpts = {}) {
    const current = revision;
    const work = createNavPathWork(pathGrid, {
      sx: start.x, sz: start.z, gx: goal.x, gz: goal.z,
      maxNodes: pathNodeLimit(pathOpts),
      maxSnap: Number.isInteger(pathOpts.maxSnapCells) ? pathOpts.maxSnapCells : 6,
      smooth: pathOpts.smooth !== false,
    });
    return guardNavigationWork(work, () => revision === current);
  }

  return Object.freeze({
    cols,
    rows,
    cellSize,
    agentRadius,
    stepHeight,
    rebuild,
    addObstacle,
    clearObstacles,
    isWalkable,
    findPath,
    createPathWork,
    sampleSurfaceHeight: (x, z) => {
      const cx = worldToCellX(x);
      const cz = worldToCellZ(z);
      return heights[cz * cols + cx];
    },
  });
}
