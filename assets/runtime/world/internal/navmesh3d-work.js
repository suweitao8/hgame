import { reversePath } from './path-work.js';

const LOS_SAMPLES_PER_UNIT = 16;

/**
 * @typedef {object} NavWorkGrid
 * @property {number} cols
 * @property {number} rows
 * @property {Float32Array} heights
 * @property {(ax: number, az: number, bx: number, bz: number) => boolean} canTraverse
 * @property {(cx: number, cz: number) => boolean} isCellWalkable
 * @property {(x: number, z: number) => boolean} isWalkable
 * @property {(x: number) => number} worldToCellX
 * @property {(z: number) => number} worldToCellZ
 * @property {(x: number) => number} cellCenterX
 * @property {(z: number) => number} cellCenterZ
 * @property {readonly number[]} dx
 * @property {readonly number[]} dz
 * @property {readonly number[]} stepCost
 */
/** @typedef {{ sx: number, sz: number, gx: number, gz: number, maxNodes: number, maxSnap: number, smooth: boolean }} PathQuery */
/** @typedef {[x: number, z: number]} Cell */
/** @typedef {[x: number, z: number, index: number]} IndexedCell */

/** @param {NavWorkGrid} grid @param {number} cx @param {number} cz @param {number} maxSnap @returns {Generator<undefined, Cell | null, void>} */
function* snapCell(grid, cx, cz, maxSnap) {
  if (grid.isCellWalkable(cx, cz)) return [cx, cz];
  const radius = Math.min(maxSnap, Math.max(cx, grid.cols - 1 - cx, cz, grid.rows - 1 - cz));
  for (let r = 1; r <= radius; r++) {
    let distance = Infinity;
    let best = null;
    for (let dz = -r; dz <= r; dz++) {
      const stride = Math.abs(dz) === r ? 1 : 2 * r;
      for (let dx = -r; dx <= r; dx += stride) {
        yield;
        const x = cx + dx, z = cz + dz;
        const score = dx * dx + dz * dz;
        if (score < distance && grid.isCellWalkable(x, z)) {
          distance = score;
          best = [x, z];
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** @param {NavWorkGrid} grid @param {Cell} start @param {Cell} goal @param {number} maxNodes @returns {Generator<undefined, IndexedCell[] | null, void>} */
function* searchCells(grid, start, goal, maxNodes) {
  const { cols, heights, canTraverse, dx, dz, stepCost } = grid;
  const [sx, sz] = start, [gx, gz] = goal;
  const startIdx = sz * cols + sx, goalIdx = gz * cols + gx;
  // Map global cells to compact slots as the search discovers them. Keep the
  // synchronous packed workspace separate so mixed workloads retain its fast path.
  const slotByCell = new Map([[startIdx, 0]]);
  const cellBySlot = [startIdx];
  const cost = [0], priority = [Math.fround(Math.hypot(gx - sx, gz - sz))], parent = [-1];
  const heap = [0], state = [2]; // 1 is closed, open slots store heap index + 2.

  for (let visited = 0; heap.length && visited < maxNodes; visited++) {
    yield;
    const slot = pop();
    const index = cellBySlot[slot];
    if (index === goalIdx) {
      const route = [];
      for (let cursor = slot; cursor !== -1; cursor = parent[cursor]) {
        yield;
        const cell = cellBySlot[cursor], x = cell % cols;
        route.push([x, (cell - x) / cols, cell]);
      }
      yield* reversePath(route);
      return route;
    }
    const x = index % cols, z = (index - x) / cols;
    for (let direction = 0; direction < dx.length; direction++) {
      const nx = x + dx[direction], nz = z + dz[direction];
      if (!canTraverse(x, z, nx, nz)) continue;
      const nextIndex = nz * cols + nx;
      let next = slotByCell.get(nextIndex);
      if (next !== undefined && state[next] === 1) continue;
      const g = cost[slot] + stepCost[direction] + Math.abs(heights[nextIndex] - heights[index]) * 0.5;
      if (next !== undefined && !(g < cost[next])) continue;
      if (next === undefined) {
        next = cellBySlot.length;
        slotByCell.set(nextIndex, next);
        cellBySlot.push(nextIndex);
        state[next] = 0;
      }
      // Match Float32 comparisons and rounding in the synchronous search.
      cost[next] = Math.fround(g);
      priority[next] = Math.fround(g + Math.hypot(gx - nx, gz - nz));
      parent[next] = slot;
      push(next);
    }
  }
  return null;

  function push(slot) {
    let index = state[slot] - 2;
    if (index < 0) {
      index = heap.length;
      heap.push(slot);
    }
    while (index > 0) {
      const previous = (index - 1) >>> 1;
      const other = heap[previous];
      if (priority[other] <= priority[slot]) break;
      heap[index] = other;
      state[other] = index + 2;
      index = previous;
    }
    heap[index] = slot;
    state[slot] = index + 2;
  }

  function pop() {
    const top = heap[0], last = heap.pop();
    state[top] = 1;
    if (heap.length) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        const right = child + 1;
        if (right < heap.length && priority[heap[right]] < priority[heap[child]]) child = right;
        const next = heap[child];
        if (priority[last] <= priority[next]) break;
        heap[index] = next;
        state[next] = index + 2;
        index = child;
      }
      heap[index] = last;
      state[last] = index + 2;
    }
    return top;
  }
}

/** @param {NavWorkGrid} grid @param {IndexedCell[]} route */
function* smoothRoute(grid, route) {
  const kept = [route[0]];
  for (let anchor = 0; anchor < route.length - 1;) {
    let farthest = anchor + 1;
    const [ax, az] = route[anchor];
    for (let probe = route.length - 1; probe > farthest; probe--) {
      const [bx, bz] = route[probe];
      if (yield* traceLine(grid.canTraverse, ax, az, bx, bz)) {
        farthest = probe;
        break;
      }
    }
    kept.push(route[farthest]);
    anchor = farthest;
  }
  return kept;
}

function* traceLine(canTraverse, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const steps = Math.max(Math.abs(dx), Math.abs(dz)) * 2;
  let prevX = ax, prevZ = az;
  for (let i = 1; i <= steps; i++) {
    if ((i - 1) % LOS_SAMPLES_PER_UNIT === 0) yield;
    const t = i / steps;
    const x = Math.round(ax + dx * t), z = Math.round(az + dz * t);
    if (x === prevX && z === prevZ) continue;
    if (!canTraverse(prevX, prevZ, x, z)) return false;
    prevX = x;
    prevZ = z;
  }
  return true;
}

/** @param {NavWorkGrid} grid @param {PathQuery} query @returns {Generator<undefined, import('../navmesh3d.js').Vec3Point[] | null, void>} */
export function* createNavPathWork(grid, { sx, sz, gx, gz, maxNodes, maxSnap, smooth }) {
  if (maxNodes === 0) return null;
  const start = yield* snapCell(grid, grid.worldToCellX(sx), grid.worldToCellZ(sz), maxSnap);
  const goal = yield* snapCell(grid, grid.worldToCellX(gx), grid.worldToCellZ(gz), maxSnap);
  if (!start || !goal) return null;
  if (start[0] === goal[0] && start[1] === goal[1]) {
    const y = grid.heights[goal[1] * grid.cols + goal[0]];
    return grid.isWalkable(gx, gz)
      ? [{ x: gx, y, z: gz }]
      : [{ x: grid.cellCenterX(goal[0]), y, z: grid.cellCenterZ(goal[1]) }];
  }
  const route = yield* searchCells(grid, start, goal, maxNodes);
  if (!route) return null;
  const kept = smooth && route.length > 2 ? yield* smoothRoute(grid, route) : route;
  const waypoints = [];
  for (let i = 0; i < kept.length; i++) {
    yield;
    const [x, z, index] = kept[i], y = grid.heights[index];
    if (i === 0 && grid.isWalkable(sx, sz)) waypoints.push({ x: sx, y, z: sz });
    else if (i === kept.length - 1 && grid.isWalkable(gx, gz)) waypoints.push({ x: gx, y, z: gz });
    else waypoints.push({ x: grid.cellCenterX(x), y, z: grid.cellCenterZ(z) });
  }
  return waypoints;
}
