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

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const STEP_COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

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
  const stateMark = new Uint8Array(total); // 0=unvisited, 1=open, 2=closed

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
    return minX + (cx + 0.5) * cellSize;
  }

  function cellCenterZ(cz) {
    return minZ + (cz + 0.5) * cellSize;
  }

  function rebuild() {
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
      if (!isCellWalkable(cx, cz)) return false;
      if (Math.abs(heights[cz * cols + cx] - heights[prevCz * cols + prevCx]) > stepHeight) {
        return false;
      }
      // Guard diagonal hops between consecutive samples.
      if (cx !== prevCx && cz !== prevCz) {
        if (!isCellWalkable(cx, prevCz) || !isCellWalkable(prevCx, cz)) return false;
      }
      prevCx = cx;
      prevCz = cz;
    }
    return true;
  }

  // Min-heap over packed node indices for A* open list.
  const heap = [];
  function heapPush(node) {
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >>> 1;
      if (fScore[heap[p]] <= fScore[heap[i]]) break;
      const tmp = heap[p];
      heap[p] = heap[i];
      heap[i] = tmp;
      i = p;
    }
  }
  function heapPop() {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      const len = heap.length;
      while (true) {
        let best = i;
        const l = i * 2 + 1;
        const r = l + 1;
        if (l < len && fScore[heap[l]] < fScore[heap[best]]) best = l;
        if (r < len && fScore[heap[r]] < fScore[heap[best]]) best = r;
        if (best === i) break;
        const tmp = heap[i];
        heap[i] = heap[best];
        heap[best] = tmp;
        i = best;
      }
    }
    return top;
  }

  /**
   * Computes a smooth 3D waypoint path `{ x, y, z }[]` between `start` and `goal`,
   * or `null` if unreachable.
   * @param {{ x: number, y?: number, z: number }} start
   * @param {{ x: number, y?: number, z: number }} goal
   * @param {{ smooth?: boolean, maxSnapCells?: number }} [pathOpts]
   * @returns {Vec3Point[] | null}
   */
  function findPath(start, goal, pathOpts = {}) {
    const smooth = pathOpts.smooth !== false;
    const maxSnap = Number.isInteger(pathOpts.maxSnapCells) ? pathOpts.maxSnapCells : 6;
    const sCell = findNearestWalkableCell(worldToCellX(start.x), worldToCellZ(start.z), maxSnap);
    const gCell = findNearestWalkableCell(worldToCellX(goal.x), worldToCellZ(goal.z), maxSnap);
    if (!sCell || !gCell) return null;

    const startIdx = sCell[1] * cols + sCell[0];
    const goalIdx = gCell[1] * cols + gCell[0];
    if (startIdx === goalIdx) {
      return [{ x: goal.x, y: heights[goalIdx], z: goal.z }];
    }

    stateMark.fill(0);
    gScore.fill(Infinity);
    cameFrom.fill(-1);
    heap.length = 0;

    gScore[startIdx] = 0;
    fScore[startIdx] = Math.hypot(gCell[0] - sCell[0], gCell[1] - sCell[1]);
    stateMark[startIdx] = 1;
    heapPush(startIdx);

    let found = false;
    while (heap.length > 0) {
      const cur = heapPop();
      if (stateMark[cur] === 2) continue;
      if (cur === goalIdx) {
        found = true;
        break;
      }
      stateMark[cur] = 2;
      const cx = cur % cols;
      const cz = (cur - cx) / cols;

      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d];
        const nz = cz + DZ[d];
        if (!canTraverse(cx, cz, nx, nz)) continue;
        const nIdx = nz * cols + nx;
        if (stateMark[nIdx] === 2) continue;
        const slopePenalty = Math.abs(heights[nIdx] - heights[cur]) * 0.5;
        const tentative = gScore[cur] + STEP_COST[d] + slopePenalty;
        if (tentative < gScore[nIdx]) {
          cameFrom[nIdx] = cur;
          gScore[nIdx] = tentative;
          fScore[nIdx] = tentative + Math.hypot(gCell[0] - nx, gCell[1] - nz);
          stateMark[nIdx] = 1;
          heapPush(nIdx);
        }
      }
    }

    if (!found) return null;

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
    sampleSurfaceHeight: (x, z) => {
      const cx = worldToCellX(x);
      const cz = worldToCellZ(z);
      return heights[cz * cols + cx];
    },
  });
}
