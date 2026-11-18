/**
 * High-density renderer-neutral swarm simulation, 1D linked-list spatial hash,
 * 2D Dijkstra/gradient Flow Field pathfinding, and fixed-slot SoA combat ECS
 * with 10m/12m hysteresis promotion/demotion.
 *
 * Works identically with 2D (`SpriteCrowd2D` / `webgl2d`) and 3D (`createBoneVatCrowd3D`)
 * without heap allocations or GC churn during steady-state gameplay.
 */

const SQRT2 = Math.SQRT2;
const WALL_COST = 255;
const INF_DIST = 1e9;

/** Bit flags stored in `swarm.unitFlags[id]`. */
export const SWARM_UNIT_FLAGS = Object.freeze({
  NONE: 0,
  ALIVE: 1 << 0,
  ECS_CLAIMED: 1 << 1,
  FLASHING: 1 << 2,
});

/** Bit flags stored in `ecs.flags[slot]`. */
export const ECS_SLOT_FLAGS = Object.freeze({
  NONE: 0,
  ACTIVE: 1 << 0,
  DEAD: 1 << 1,
  FROZEN: 1 << 2,
  KNOCKBACK: 1 << 3,
  DIRTY: 1 << 4,
});

/**
 * @typedef {object} FlatSpatialHashOptions
 * @property {number} [cols=256] Grid column count (integer >= 1).
 * @property {number} [rows=256] Grid row count (integer >= 1).
 * @property {number} [cellSize=2] Cell edge length in world units (> 0).
 * @property {number} [originX=-256] World X of cell (0, 0) minimum corner.
 * @property {number} [originY=-256] World Y (or Z in 3D) of cell (0, 0) minimum corner.
 * @property {number} [capacity=32768] Maximum entity ID supported (`0..capacity - 1`).
 */

/**
 * Zero-GC fixed-grid 1D atomic-style linked-list spatial hash backed purely by Int32Arrays.
 */
export class FlatSpatialHash2D {
  /** @param {FlatSpatialHashOptions} [options] */
  constructor({
    cols = 256,
    rows = 256,
    cellSize = 2,
    originX = -256,
    originY = -256,
    capacity = 32768,
  } = {}) {
    if (!Number.isInteger(cols) || cols < 1) throw new RangeError('FlatSpatialHash2D cols must be >= 1');
    if (!Number.isInteger(rows) || rows < 1) throw new RangeError('FlatSpatialHash2D rows must be >= 1');
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('FlatSpatialHash2D cellSize must be > 0');
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('FlatSpatialHash2D capacity must be >= 1');

    this.cols = cols;
    this.rows = rows;
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.originX = originX;
    this.originY = originY;
    this.capacity = capacity;
    this.head = new Int32Array(cols * rows).fill(-1);
    this.next = new Int32Array(capacity).fill(-1);
  }

  /** Reset all bucket heads to empty (`-1`). @returns {void} */
  clear() {
    this.head.fill(-1);
  }

  /**
   * Maps a world coordinate to a clamped flat cell index.
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  cellIndex(x, y) {
    let cx = Math.floor((x - this.originX) * this.invCellSize);
    let cy = Math.floor((y - this.originY) * this.invCellSize);
    if (cx < 0) cx = 0;
    else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  /**
   * Inserts `id` into the cell containing `(x, y)`.
   * @param {number} id Entity ID (`0 <= id < capacity`).
   * @param {number} x
   * @param {number} y
   * @returns {number} Cell index written, or `-1` if `id` is out of range.
   */
  insert(id, x, y) {
    if (id < 0 || id >= this.capacity) return -1;
    const cell = this.cellIndex(x, y);
    this.next[id] = this.head[cell];
    this.head[cell] = id;
    return cell;
  }

  /**
   * Rebuilds the entire spatial hash directly from SoA position arrays.
   * @param {ArrayLike<number>} unitFlags Per-unit flag array.
   * @param {ArrayLike<number>} posX Per-unit X array.
   * @param {ArrayLike<number>} posY Per-unit Y/Z array.
   * @param {number} [maxIndex] Exclusive upper bound (defaults to `Math.min(unitFlags.length, capacity)`).
   * @param {number} [activeMask=1] Bitmask required to include an entity.
   * @returns {number} Count of inserted units.
   */
  rebuildFromArrays(unitFlags, posX, posY, maxIndex = Math.min(unitFlags.length, this.capacity), activeMask = SWARM_UNIT_FLAGS.ALIVE) {
    this.head.fill(-1);
    const limit = Math.min(maxIndex | 0, this.capacity, unitFlags.length, posX.length, posY.length);
    const inv = this.invCellSize;
    const ox = this.originX;
    const oy = this.originY;
    const cols = this.cols;
    const rows = this.rows;
    const head = this.head;
    const next = this.next;
    let count = 0;
    for (let id = 0; id < limit; id++) {
      if ((unitFlags[id] & activeMask) === 0) continue;
      let cx = Math.floor((posX[id] - ox) * inv);
      let cy = Math.floor((posY[id] - oy) * inv);
      if (cx < 0) cx = 0;
      else if (cx >= cols) cx = cols - 1;
      if (cy < 0) cy = 0;
      else if (cy >= rows) cy = rows - 1;
      const cell = cy * cols + cx;
      next[id] = head[cell];
      head[cell] = id;
      count++;
    }
    return count;
  }

  /**
   * Queries IDs inside cells overlapping the circle `(x, y, radius)` into `outIds`.
   * When `posX` and `posY` are supplied, performs exact Euclidean radius filtering.
   * @param {number} x Circle center X.
   * @param {number} y Circle center Y/Z.
   * @param {number} radius Search radius in world units.
   * @param {Int32Array | number[]} outIds Output ID buffer.
   * @param {number} [maxResults=outIds.length] Maximum IDs written.
   * @param {ArrayLike<number> | null} [posX=null] Optional exact X positions.
   * @param {ArrayLike<number> | null} [posY=null] Optional exact Y/Z positions.
   * @param {number} [selfId=-1] Optional entity ID to exclude safely without breaking list traversal.
   * @returns {number} Number of matching IDs written to `outIds`.
   */
  queryRadiusIds(x, y, radius, outIds, maxResults = outIds.length, posX = null, posY = null, selfId = -1) {
    const r = Math.max(0, radius);
    const rSq = r * r;
    const inv = this.invCellSize;
    const ox = this.originX;
    const oy = this.originY;
    const maxCx = this.cols - 1;
    const maxCy = this.rows - 1;
    let minGx = Math.floor((x - r - ox) * inv);
    let maxGx = Math.floor((x + r - ox) * inv);
    let minGy = Math.floor((y - r - oy) * inv);
    let maxGy = Math.floor((y + r - oy) * inv);
    if (minGx < 0) minGx = 0;
    if (minGy < 0) minGy = 0;
    if (maxGx > maxCx) maxGx = maxCx;
    if (maxGy > maxCy) maxGy = maxCy;
    if (minGx > maxGx || minGy > maxGy) return 0;

    const head = this.head;
    const next = this.next;
    const cols = this.cols;
    const exact = Boolean(posX && posY);
    const cap = Math.min(maxResults, outIds.length);
    let count = 0;

    for (let gy = minGy; gy <= maxGy; gy++) {
      const rowBase = gy * cols;
      for (let gx = minGx; gx <= maxGx; gx++) {
        let cur = head[rowBase + gx];
        while (cur !== -1) {
          // Always advance pointer before any skip so self-entries at bucket head never stall traversal.
          const nxt = next[cur];
          if (cur !== selfId) {
            if (exact) {
              const dx = posX[cur] - x;
              const dy = posY[cur] - y;
              if (dx * dx + dy * dy <= rSq) {
                outIds[count++] = cur;
                if (count >= cap) return count;
              }
            } else {
              outIds[count++] = cur;
              if (count >= cap) return count;
            }
          }
          cur = nxt;
        }
      }
    }
    return count;
  }
}

/**
 * Convenience factory for {@link FlatSpatialHash2D}.
 * @param {FlatSpatialHashOptions} [options]
 * @returns {FlatSpatialHash2D}
 */
export function createFlatSpatialHash2D(options) {
  return new FlatSpatialHash2D(options);
}

/**
 * @typedef {object} FlowFieldOptions
 * @property {number} [cols=128] Field grid columns (integer >= 2).
 * @property {number} [rows=128] Field grid rows (integer >= 2).
 * @property {number} [cellSize=2] Cell edge length in world units (> 0).
 * @property {number} [originX=-128] World X of grid minimum corner.
 * @property {number} [originY=-128] World Y/Z of grid minimum corner.
 */

/**
 * @typedef {object} FlowFieldGoal
 * @property {number} x Goal world X.
 * @property {number} y Goal world Y/Z.
 */

/**
 * @typedef {object} FlowFieldTileMapOptions
 * @property {number} [worldOriginX=0] World X of the TileMap origin (0, 0).
 * @property {number} [worldOriginY=0] World Y/Z of the TileMap origin (0, 0).
 */

/**
 * 2D uniform-grid Flow Field pathfinder using zero-GC ring-buffer Dijkstra/SPFA propagation
 * and 8-neighbor obstacle-aware gradient extraction + RG8 direction encoding.
 */
export class FlowField2D {
  /** @param {FlowFieldOptions} [options] */
  constructor({
    cols = 128,
    rows = 128,
    cellSize = 2,
    originX = -128,
    originY = -128,
  } = {}) {
    if (!Number.isInteger(cols) || cols < 2) throw new RangeError('FlowField2D cols must be >= 2');
    if (!Number.isInteger(rows) || rows < 2) throw new RangeError('FlowField2D rows must be >= 2');
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('FlowField2D cellSize must be > 0');

    this.cols = cols;
    this.rows = rows;
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.originX = originX;
    this.originY = originY;

    const total = cols * rows;
    this.cost = new Uint8Array(total).fill(1);
    this.dist = new Float32Array(total).fill(INF_DIST);
    this.dirX = new Float32Array(total);
    this.dirY = new Float32Array(total);
    this.rg8 = new Uint8Array(total * 2).fill(128);
    this._queue = new Int32Array(total);
    this._inQueue = new Uint8Array(total);
    this._hasComputed = false;
    this._computeVersion = 0;
  }

  /** Clears all terrain costs back to uniform `1`. @returns {void} */
  clearWalls() {
    this.cost.fill(1);
  }

  /**
   * Sets traversal cost for cell `(cx, cy)` (`1..254` passable weight, `255` = solid wall).
   * @param {number} cx
   * @param {number} cy
   * @param {number} costValue
   * @returns {boolean}
   */
  setCost(cx, cy, costValue) {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false;
    const clamped = Math.max(1, Math.min(WALL_COST, Math.round(costValue)));
    this.cost[cy * this.cols + cx] = clamped;
    return true;
  }

  /**
   * Marks an axis-aligned world-space rectangle with traversal `costValue` (`255` = wall).
   * @param {number} minX
   * @param {number} minY
   * @param {number} maxX
   * @param {number} maxY
   * @param {number} [costValue=255]
   * @returns {void}
   */
  setObstacleRect(minX, minY, maxX, maxY, costValue = WALL_COST) {
    const loX = Math.min(minX, maxX);
    const hiX = Math.max(minX, maxX);
    const loY = Math.min(minY, maxY);
    const hiY = Math.max(minY, maxY);
    const x0 = Math.max(0, Math.floor((loX - this.originX) * this.invCellSize));
    const x1 = Math.min(this.cols - 1, Math.floor((hiX - this.originX) * this.invCellSize));
    const y0 = Math.max(0, Math.floor((loY - this.originY) * this.invCellSize));
    const y1 = Math.min(this.rows - 1, Math.floor((hiY - this.originY) * this.invCellSize));
    const v = Math.max(1, Math.min(WALL_COST, Math.round(costValue)));
    for (let cy = y0; cy <= y1; cy++) {
      const row = cy * this.cols;
      for (let cx = x0; cx <= x1; cx++) {
        this.cost[row + cx] = v;
      }
    }
  }

  /**
   * Populates solid walls (`cost = 255`) from an HGame `TileMap`.
   * @param {{ width: number, height: number, tileWidth: number, tileHeight: number, worldToTile: (x: number, y: number, out?: { x: number, y: number }) => { x: number, y: number }, isSolid: (tx: number, ty: number) => boolean }} tileMap
   * @param {FlowFieldTileMapOptions} [options]
   * @returns {void}
   */
  setWallsFromTileMap(tileMap, { worldOriginX = 0, worldOriginY = 0 } = {}) {
    if (!tileMap || typeof tileMap.worldToTile !== 'function' || typeof tileMap.isSolid !== 'function') {
      throw new TypeError('FlowField2D.setWallsFromTileMap requires a TileMap');
    }
    const cols = this.cols;
    const rows = this.rows;
    const half = this.cellSize * 0.5;
    const tileScratch = { x: 0, y: 0 };
    for (let cy = 0; cy < rows; cy++) {
      const wy = this.originY + cy * this.cellSize + half - worldOriginY;
      const row = cy * cols;
      for (let cx = 0; cx < cols; cx++) {
        const wx = this.originX + cx * this.cellSize + half - worldOriginX;
        const tile = tileMap.worldToTile(wx, wy, tileScratch);
        if (tile.x >= 0 && tile.y >= 0 && tile.x < tileMap.width && tile.y < tileMap.height) {
          this.cost[row + cx] = tileMap.isSolid(tile.x, tile.y) ? WALL_COST : 1;
        }
      }
    }
  }

  /**
   * Recomputes distance integration and direction vectors toward one or more goals.
   * @param {FlowFieldGoal | readonly FlowFieldGoal[]} goals
   * @returns {void}
   */
  compute(goals) {
    this._computeVersion++;
    const goalList = Array.isArray(goals) ? goals : (goals ? [goals] : []);
    const cols = this.cols;
    const rows = this.rows;
    const total = cols * rows;
    const cost = this.cost;
    const dist = this.dist;
    const queue = this._queue;
    const inQueue = this._inQueue;

    dist.fill(INF_DIST);
    inQueue.fill(0);

    let qHead = 0;
    let qTail = 0;
    let qCount = 0;

    for (let i = 0; i < goalList.length; i++) {
      const g = goalList[i];
      if (!g) continue;
      const cx = Math.max(0, Math.min(cols - 1, Math.floor((g.x - this.originX) * this.invCellSize)));
      const cy = Math.max(0, Math.min(rows - 1, Math.floor((g.y - this.originY) * this.invCellSize)));
      const idx = cy * cols + cx;
      // If target cell happens to sit on a wall, search immediate passable neighbor.
      let seedIdx = idx;
      if (cost[seedIdx] >= WALL_COST) {
        for (let oy = -1; oy <= 1 && cost[seedIdx] >= WALL_COST; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const nx = cx + ox;
            const ny = cy + oy;
            if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && cost[ny * cols + nx] < WALL_COST) {
              seedIdx = ny * cols + nx;
              break;
            }
          }
        }
      }
      if (cost[seedIdx] < WALL_COST && dist[seedIdx] > 0) {
        dist[seedIdx] = 0;
        if (!inQueue[seedIdx]) {
          inQueue[seedIdx] = 1;
          queue[qTail] = seedIdx;
          qTail = (qTail + 1) % total;
          qCount++;
        }
      }
    }

    // Zero-GC cyclic SPFA propagation with Small-Label-First (SLF) heuristic.
    while (qCount > 0) {
      const idx = queue[qHead];
      qHead = (qHead + 1) % total;
      qCount--;
      inQueue[idx] = 0;

      const d0 = dist[idx];
      const cx = idx % cols;
      const cy = (idx - cx) / cols;

      const hasLeft = cx > 0;
      const hasRight = cx + 1 < cols;
      const hasUp = cy > 0;
      const hasDown = cy + 1 < rows;

      const passL = hasLeft && cost[idx - 1] < WALL_COST;
      const passR = hasRight && cost[idx + 1] < WALL_COST;
      const passU = hasUp && cost[idx - cols] < WALL_COST;
      const passD = hasDown && cost[idx + cols] < WALL_COST;

      for (let dir = 0; dir < 8; dir++) {
        let nx = cx;
        let ny = cy;
        let stepMul = 1;
        if (dir === 0) { if (!passL) continue; nx--; }
        else if (dir === 1) { if (!passR) continue; nx++; }
        else if (dir === 2) { if (!passU) continue; ny--; }
        else if (dir === 3) { if (!passD) continue; ny++; }
        else if (dir === 4) { if (!(passL && passU)) continue; nx--; ny--; stepMul = SQRT2; }
        else if (dir === 5) { if (!(passR && passU)) continue; nx++; ny--; stepMul = SQRT2; }
        else if (dir === 6) { if (!(passL && passD)) continue; nx--; ny++; stepMul = SQRT2; }
        else { if (!(passR && passD)) continue; nx++; ny++; stepMul = SQRT2; }

        const nIdx = ny * cols + nx;
        const c = cost[nIdx];
        if (c >= WALL_COST) continue;
        const nd = d0 + stepMul * c;
        if (nd + 1e-5 < dist[nIdx]) {
          dist[nIdx] = nd;
          if (!inQueue[nIdx]) {
            inQueue[nIdx] = 1;
            if (qCount > 0 && nd < dist[queue[qHead]]) {
              qHead = (qHead - 1 + total) % total;
              queue[qHead] = nIdx;
            } else {
              queue[qTail] = nIdx;
              qTail = (qTail + 1) % total;
            }
            qCount++;
          }
        }
      }
    }

    // Build smooth obstacle-aware flow direction vectors + RG8 byte table.
    const dirX = this.dirX;
    const dirY = this.dirY;
    const rg8 = this.rg8;

    for (let cy = 0; cy < rows; cy++) {
      const row = cy * cols;
      for (let cx = 0; cx < cols; cx++) {
        const idx = row + cx;
        const dCenter = dist[idx];
        if (cost[idx] >= WALL_COST || dCenter >= INF_DIST * 0.5 || dCenter === 0) {
          dirX[idx] = 0;
          dirY[idx] = 0;
          rg8[idx * 2] = 128;
          rg8[idx * 2 + 1] = 128;
          continue;
        }

        const cL = cx > 0 && cost[idx - 1] < WALL_COST;
        const cR = cx + 1 < cols && cost[idx + 1] < WALL_COST;
        const cU = cy > 0 && cost[idx - cols] < WALL_COST;
        const cD = cy + 1 < rows && cost[idx + cols] < WALL_COST;

        const dL = cL && dist[idx - 1] < INF_DIST * 0.5 ? dist[idx - 1] : dCenter;
        const dR = cR && dist[idx + 1] < INF_DIST * 0.5 ? dist[idx + 1] : dCenter;
        const dU = cU && dist[idx - cols] < INF_DIST * 0.5 ? dist[idx - cols] : dCenter;
        const dD = cD && dist[idx + cols] < INF_DIST * 0.5 ? dist[idx + cols] : dCenter;

        let gx = dL - dR;
        let gy = dU - dD;

        // Fall back to steepest descent among valid 8-neighbors when symmetric walls cancel out central gradient.
        if (gx * gx + gy * gy < 1e-6) {
          let bestDist = dCenter;
          let bx = 0;
          let by = 0;
          for (let oy = -1; oy <= 1; oy++) {
            const ny = cy + oy;
            if (ny < 0 || ny >= rows) continue;
            for (let ox = -1; ox <= 1; ox++) {
              if (ox === 0 && oy === 0) continue;
              const nx = cx + ox;
              if (nx < 0 || nx >= cols) continue;
              if (ox !== 0 && oy !== 0) {
                if (cost[cy * cols + nx] >= WALL_COST || cost[ny * cols + cx] >= WALL_COST) continue;
              }
              const nIdx = ny * cols + nx;
              if (cost[nIdx] < WALL_COST && dist[nIdx] < bestDist) {
                bestDist = dist[nIdx];
                bx = ox;
                by = oy;
              }
            }
          }
          gx = bx;
          gy = by;
        }

        const len = Math.hypot(gx, gy);
        if (len > 1e-6) {
          const vx = gx / len;
          const vy = gy / len;
          dirX[idx] = vx;
          dirY[idx] = vy;
          rg8[idx * 2] = Math.max(0, Math.min(255, Math.round((vx * 0.5 + 0.5) * 255)));
          rg8[idx * 2 + 1] = Math.max(0, Math.min(255, Math.round((vy * 0.5 + 0.5) * 255)));
        } else {
          dirX[idx] = 0;
          dirY[idx] = 0;
          rg8[idx * 2] = 128;
          rg8[idx * 2 + 1] = 128;
        }
      }
    }
    this._hasComputed = true;
  }

  /**
   * Bilinearly samples a normalized flow direction vector at world `(x, y)`.
   * @param {number} x
   * @param {number} y
   * @param {{ x: number, y: number }} [out] Optional output object reused to avoid GC.
   * @returns {{ x: number, y: number }}
   */
  sample(x, y, out = { x: 0, y: 0 }) {
    if (!this._hasComputed) {
      out.x = 0;
      out.y = 0;
      return out;
    }
    const gx = (x - this.originX) * this.invCellSize - 0.5;
    const gy = (y - this.originY) * this.invCellSize - 0.5;
    const cols = this.cols;
    const rows = this.rows;
    const cx0 = Math.max(0, Math.min(cols - 1, Math.floor(gx)));
    const cy0 = Math.max(0, Math.min(rows - 1, Math.floor(gy)));
    const cx1 = Math.min(cols - 1, cx0 + 1);
    const cy1 = Math.min(rows - 1, cy0 + 1);
    const tx = Math.max(0, Math.min(1, gx - cx0));
    const ty = Math.max(0, Math.min(1, gy - cy0));

    let sx = 0;
    let sy = 0;
    let wSum = 0;

    const i00 = cy0 * cols + cx0;
    const i10 = cy0 * cols + cx1;
    const i01 = cy1 * cols + cx0;
    const i11 = cy1 * cols + cx1;

    if (this.cost[i00] < WALL_COST) { const w = (1 - tx) * (1 - ty); sx += this.dirX[i00] * w; sy += this.dirY[i00] * w; wSum += w; }
    if (this.cost[i10] < WALL_COST) { const w = tx * (1 - ty); sx += this.dirX[i10] * w; sy += this.dirY[i10] * w; wSum += w; }
    if (this.cost[i01] < WALL_COST) { const w = (1 - tx) * ty; sx += this.dirX[i01] * w; sy += this.dirY[i01] * w; wSum += w; }
    if (this.cost[i11] < WALL_COST) { const w = tx * ty; sx += this.dirX[i11] * w; sy += this.dirY[i11] * w; wSum += w; }

    if (wSum > 1e-6) {
      const len = Math.hypot(sx, sy);
      if (len > 1e-6) {
        out.x = sx / len;
        out.y = sy / len;
        return out;
      }
    }

    const nearX = Math.max(0, Math.min(cols - 1, Math.floor((x - this.originX) * this.invCellSize)));
    const nearY = Math.max(0, Math.min(rows - 1, Math.floor((y - this.originY) * this.invCellSize)));
    const idx = nearY * cols + nearX;
    out.x = this.dirX[idx];
    out.y = this.dirY[idx];
    return out;
  }
}

/**
 * Convenience factory for {@link FlowField2D}.
 * @param {FlowFieldOptions} [options]
 * @returns {FlowField2D}
 */
export function createFlowField2D(options) {
  return new FlowField2D(options);
}

/**
 * @typedef {object} FlatCombatECSOptions
 * @property {number} [maxSlots=5000] Preallocated ECS slots (integer >= 1).
 * @property {number} [maxHitEvents=4096] Preallocated hit-event capacity (integer >= 1).
 * @property {number} [swarmCapacity=100000] Maximum external swarm unit ID (`0..swarmCapacity - 1`).
 */

/**
 * @typedef {object} FlatCombatPatch
 * @property {number} swarmId
 * @property {number} slot
 * @property {number} x
 * @property {number} y
 * @property {number} rot
 * @property {number} hp
 * @property {number} clipId
 * @property {boolean} isDead
 * @property {boolean} isDemoted
 * @property {boolean} stillClaimed
 */

/**
 * @typedef {object} FlatCombatCleanupStats
 * @property {number} patchesEmitted Patches emitted this flush.
 * @property {number} pendingRemaining Pending dead/demoted/dirty slots held for the next flush when `maxPatches` was hit.
 * @property {number} activeSlots Remaining active ECS slots.
 */

/**
 * Zero-GC fixed-slot SoA combat ECS with unidirectional hit-event queue and safe patch back-pressure.
 */
export class FlatCombatECS {
  /** @param {FlatCombatECSOptions} [options] */
  constructor({
    maxSlots = 5000,
    maxHitEvents = 4096,
    swarmCapacity = 100000,
  } = {}) {
    if (!Number.isInteger(maxSlots) || maxSlots < 1) throw new RangeError('FlatCombatECS maxSlots must be >= 1');
    if (!Number.isInteger(maxHitEvents) || maxHitEvents < 1) throw new RangeError('FlatCombatECS maxHitEvents must be >= 1');
    if (!Number.isInteger(swarmCapacity) || swarmCapacity < 1) throw new RangeError('FlatCombatECS swarmCapacity must be >= 1');

    this.maxSlots = maxSlots;
    this.maxHitEvents = maxHitEvents;
    this.swarmCapacity = swarmCapacity;

    this.flags = new Uint32Array(maxSlots);
    this.swarmUnitId = new Int32Array(maxSlots).fill(-1);
    this.posX = new Float32Array(maxSlots);
    this.posY = new Float32Array(maxSlots);
    this.velX = new Float32Array(maxSlots);
    this.velY = new Float32Array(maxSlots);
    this.rot = new Float32Array(maxSlots);
    this.hp = new Int32Array(maxSlots);
    this.maxHp = new Int32Array(maxSlots);
    this.shield = new Int32Array(maxSlots);
    this.freezeTimer = new Float32Array(maxSlots);
    this.flashTicks = new Uint8Array(maxSlots);
    this.statusCode = new Uint8Array(maxSlots);
    this.clipId = new Uint16Array(maxSlots);

    this.swarmToSlot = new Int32Array(swarmCapacity).fill(-1);
    this._freeStack = new Int32Array(maxSlots);
    this._freeTop = maxSlots;
    for (let i = 0; i < maxSlots; i++) this._freeStack[i] = maxSlots - 1 - i;
    this._activeCount = 0;
    this._scanLimit = 0;
    this._slotGeneration = new Uint32Array(maxSlots);

    this._hitTargetSlot = new Int32Array(maxHitEvents);
    this._hitGeneration = new Uint32Array(maxHitEvents);
    this._hitDamage = new Int32Array(maxHitEvents);
    this._hitPushX = new Float32Array(maxHitEvents);
    this._hitPushY = new Float32Array(maxHitEvents);
    this._hitFreeze = new Float32Array(maxHitEvents);
    this._hitCount = 0;
    /** Optional internal callback invoked when a swarm unit is promoted. @type {((swarmId: number, slot: number) => void) | null} */
    this._onPromote = null;
  }

  /** Active promoted slot count. @returns {number} */
  get activeCount() { return this._activeCount; }

  /** @returns {void} */
  _trimScanLimit() {
    while (this._scanLimit > 0 && (this.flags[this._scanLimit - 1] & ECS_SLOT_FLAGS.ACTIVE) === 0) this._scanLimit--;
  }

  /**
   * Looks up an active ECS slot by external swarm unit ID, or returns `-1`.
   * @param {number} swarmId
   * @returns {number}
   */
  getSlotBySwarmId(swarmId) {
    if (swarmId < 0 || swarmId >= this.swarmCapacity) return -1;
    return this.swarmToSlot[swarmId];
  }

  /**
   * Promotes a swarm unit into a fine-grained ECS combat slot (idempotent).
   * @param {number} swarmId
   * @param {number} x
   * @param {number} y
   * @param {number} [rot=0]
   * @param {number} [hp=100]
   * @param {number} [clipId=0]
   * @param {number} [shield=0]
   * @returns {number} Allocated or existing slot index, or `-1` when full / out of range.
   */
  promoteSwarmUnit(swarmId, x, y, rot = 0, hp = 100, clipId = 0, shield = 0) {
    if (swarmId < 0 || swarmId >= this.swarmCapacity) return -1;
    const existing = this.swarmToSlot[swarmId];
    if (existing !== -1) return existing;
    if (this._freeTop <= 0) return -1;

    const slot = this._freeStack[--this._freeTop];
    this._slotGeneration[slot] = (this._slotGeneration[slot] + 1) >>> 0;
    if (slot >= this._scanLimit) this._scanLimit = slot + 1;
    this.flags[slot] = ECS_SLOT_FLAGS.ACTIVE | ECS_SLOT_FLAGS.DIRTY;
    this.swarmUnitId[slot] = swarmId;
    this.posX[slot] = x;
    this.posY[slot] = y;
    this.velX[slot] = 0;
    this.velY[slot] = 0;
    this.rot[slot] = rot;
    const initHp = Math.max(1, hp | 0);
    this.hp[slot] = initHp;
    this.maxHp[slot] = initHp;
    this.shield[slot] = Math.max(0, shield | 0);
    this.freezeTimer[slot] = 0;
    this.clipId[slot] = clipId & 0xffff;
    this.swarmToSlot[swarmId] = slot;
    this._activeCount++;
    this._onPromote?.(swarmId, slot);
    return slot;
  }

  /**
   * Enqueues an isolated one-way combat hit event to be resolved cleanly in {@link FlatCombatECS#damageResolutionSystem}.
   * @param {number} slot
   * @param {number} damage
   * @param {number} [pushX=0]
   * @param {number} [pushY=0]
   * @param {number} [freezeDuration=0]
   * @returns {boolean}
   */
  enqueueHit(slot, damage, pushX = 0, pushY = 0, freezeDuration = 0) {
    if (slot < 0 || slot >= this.maxSlots || this._hitCount >= this.maxHitEvents) return false;
    const idx = this._hitCount++;
    this._hitTargetSlot[idx] = slot;
    this._hitGeneration[idx] = this._slotGeneration[this._hitTargetSlot[idx]];
    this._hitDamage[idx] = Math.max(0, Math.round(damage));
    this._hitPushX[idx] = pushX;
    this._hitPushY[idx] = pushY;
    this._hitFreeze[idx] = Math.max(0, freezeDuration);
    return true;
  }

  /** Resolves all queued hit events (shield absorption, HP, knockback, freeze, dead flag). @returns {number} */
  damageResolutionSystem() {
    const n = this._hitCount;
    let resolved = 0;
    for (let i = 0; i < n; i++) {
      const slot = this._hitTargetSlot[i];
      if (this._hitGeneration[i] !== this._slotGeneration[slot]) continue;
      const f = this.flags[slot];
      if ((f & ECS_SLOT_FLAGS.ACTIVE) === 0 || (f & ECS_SLOT_FLAGS.DEAD) !== 0) continue;

      let remainDmg = this._hitDamage[i];
      if (this.shield[slot] > 0 && remainDmg > 0) {
        const absorbed = Math.min(this.shield[slot], remainDmg);
        this.shield[slot] -= absorbed;
        remainDmg -= absorbed;
      }
      this.hp[slot] -= remainDmg;
      this.flashTicks[slot] = 6;

      const px = this._hitPushX[i];
      const py = this._hitPushY[i];
      if (px !== 0 || py !== 0) {
        this.velX[slot] += px;
        this.velY[slot] += py;
        this.flags[slot] |= ECS_SLOT_FLAGS.KNOCKBACK;
      }

      const freeze = this._hitFreeze[i];
      if (freeze > 0) {
        this.freezeTimer[slot] = Math.max(this.freezeTimer[slot], freeze);
        this.flags[slot] |= ECS_SLOT_FLAGS.FROZEN;
      }

      this.flags[slot] |= ECS_SLOT_FLAGS.DIRTY;
      if (this.hp[slot] <= 0) {
        this.flags[slot] |= ECS_SLOT_FLAGS.DEAD;
      }
      resolved++;
    }
    this._hitCount = 0;
    return resolved;
  }

  /**
   * Integrates freeze timers and frame-rate-independent knockback damping.
   * @param {number} dt Seconds (> 0).
   * @returns {void}
   */
  kinematicsSystem(dt) {
    if (!(dt > 0) || this._activeCount === 0) return;
    // Frame-rate-independent decay equivalent to 0.85 per 60Hz frame.
    const damp = Math.pow(0.85, dt * 60);
    for (let slot = 0; slot < this._scanLimit; slot++) {
      const f = this.flags[slot];
      if ((f & ECS_SLOT_FLAGS.ACTIVE) === 0 || (f & ECS_SLOT_FLAGS.DEAD) !== 0) continue;

      if ((f & ECS_SLOT_FLAGS.FROZEN) !== 0) {
        this.freezeTimer[slot] -= dt;
        if (this.freezeTimer[slot] <= 0) {
          this.freezeTimer[slot] = 0;
          this.flags[slot] &= ~ECS_SLOT_FLAGS.FROZEN;
        }
        continue;
      }

      if ((f & ECS_SLOT_FLAGS.KNOCKBACK) !== 0) {
        const vx = this.velX[slot];
        const vy = this.velY[slot];
        this.posX[slot] += vx * dt;
        this.posY[slot] += vy * dt;
        if (vx * vx + vy * vy > 1e-4) {
          this.velX[slot] = vx * damp;
          this.velY[slot] = vy * damp;
        }
        this.flags[slot] |= ECS_SLOT_FLAGS.DIRTY;
        if (this.velX[slot] * this.velX[slot] + this.velY[slot] * this.velY[slot] < 0.05) {
          this.velX[slot] = 0;
          this.velY[slot] = 0;
          this.flags[slot] &= ~ECS_SLOT_FLAGS.KNOCKBACK;
        }
      }
    }
  }

  /**
   * Emits patches up to `maxPatches` and recycles ONLY those dead/demoted slots whose patch was emitted.
   * Preserves un-flushed dead/demoted slots for the next frame to eliminate overflow "zombie" ghosts.
   * @param {number} heroX
   * @param {number} heroY
   * @param {number} [demoteRadius=12]
   * @param {number} [maxPatches=1024]
   * @param {((patch: FlatCombatPatch) => void) | null} [onPatch=null]
   * @param {((swarmId: number, x: number, y: number) => void) | null} [onUnitKilled=null]
   * @returns {FlatCombatCleanupStats}
   */
  flushPatchesAndCleanup(
    heroX,
    heroY,
    demoteRadius = 12,
    maxPatches = 1024,
    onPatch = null,
    onUnitKilled = null,
  ) {
    if (this._activeCount === 0) return { patchesEmitted: 0, pendingRemaining: 0, activeSlots: 0 };
    const demoteSq = demoteRadius * demoteRadius;
    const cap = Math.max(0, maxPatches | 0);
    let emitted = 0;
    let pendingRemaining = 0;
    const patch = {
      swarmId: -1,
      slot: -1,
      x: 0,
      y: 0,
      rot: 0,
      hp: 0,
      clipId: 0,
      isDead: false,
      isDemoted: false,
      stillClaimed: true,
    };

    for (let slot = 0; slot < this._scanLimit; slot++) {
      const f = this.flags[slot];
      if ((f & ECS_SLOT_FLAGS.ACTIVE) === 0) continue;

      const sId = this.swarmUnitId[slot];
      const isDead = (f & ECS_SLOT_FLAGS.DEAD) !== 0;
      const dx = this.posX[slot] - heroX;
      const dy = this.posY[slot] - heroY;
      const isDemoted = !isDead && (f & (ECS_SLOT_FLAGS.KNOCKBACK | ECS_SLOT_FLAGS.FROZEN)) === 0 && (dx * dx + dy * dy > demoteSq);
      const isDirty = (f & ECS_SLOT_FLAGS.DIRTY) !== 0;

      if (!(isDead || isDemoted || isDirty)) continue;
      if (emitted >= cap) {
        pendingRemaining++;
        continue;
      }

      if (onPatch) {
        patch.swarmId = sId;
        patch.slot = slot;
        patch.x = this.posX[slot];
        patch.y = this.posY[slot];
        patch.rot = this.rot[slot];
        patch.hp = this.hp[slot];
        patch.clipId = this.clipId[slot];
        patch.isDead = isDead;
        patch.isDemoted = isDemoted;
        patch.stillClaimed = !(isDead || isDemoted);
        onPatch(patch);
      }
      emitted++;
      this.flags[slot] &= ~ECS_SLOT_FLAGS.DIRTY;

      if (isDead || isDemoted) {
        if (isDead && onUnitKilled) onUnitKilled(sId, this.posX[slot], this.posY[slot]);
        this.flags[slot] = ECS_SLOT_FLAGS.NONE;
        this.swarmUnitId[slot] = -1;
        if (sId >= 0 && sId < this.swarmCapacity) this.swarmToSlot[sId] = -1;
        this._freeStack[this._freeTop++] = slot;
        this._activeCount = Math.max(0, this._activeCount - 1);
      }
    }

    this._trimScanLimit();
    return { patchesEmitted: emitted, pendingRemaining, activeSlots: this._activeCount };
  }

  /** Clears all ECS slots and pending hit events. @returns {void} */
  clear() {
    this.flags.fill(ECS_SLOT_FLAGS.NONE);
    this.swarmUnitId.fill(-1);
    this.swarmToSlot.fill(-1);
    for (let i = 0; i < this.maxSlots; i++) this._freeStack[i] = this.maxSlots - 1 - i;
    this._freeTop = this.maxSlots;
    this._activeCount = 0;
    this._scanLimit = 0;
    this._hitCount = 0;
  }
}

/**
 * Fast polynomial `atan2(y, x)` approximation (max error < 0.004 rad) for hot swarm loops.
 * @param {number} y
 * @param {number} x
 * @returns {number}
 */
function fastAtan2(y, x) {
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  if (ax === 0 && ay === 0) return 0;
  const a = ax < ay ? ax / ay : ay / ax;
  const s = a * a;
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (ay > ax) r = 1.5707963267948966 - r;
  if (x < 0) r = 3.141592653589793 - r;
  return y < 0 ? -r : r;
}

function buildSwarmStepGrid(
  activeCount, activeIds, posX, posY,
  ox, oy, invCell, cols, rows,
  hashHead, hashNext, cellDensity, unitCell,
  fx, fy, fineLimitSq,
) {
  hashHead.fill(-1);
  cellDensity.fill(0);

  for (let a = 0; a < activeCount; a++) {
    const id = activeIds[a];
    const px = posX[id];
    const py = posY[id];

    let cx = ((px - ox) * invCell) | 0;
    let cy = ((py - oy) * invCell) | 0;
    if (px < ox) cx = 0;
    else if (cx >= cols) cx = cols - 1;
    if (py < oy) cy = 0;
    else if (cy >= rows) cy = rows - 1;

    const cell = cy * cols + cx;
    unitCell[id] = cell;
    cellDensity[cell]++;

    const dxF = px - fx;
    const dyF = py - fy;
    if (dxF * dxF + dyF * dyF <= fineLimitSq) {
      hashNext[id] = hashHead[cell];
      hashHead[cell] = id;
    }

  }
}

function stepSwarmSequential(
  activeCount, activeIds, unitFlags, posX, posY, rot, speed, animTime, animClip, hp, flash, sepX, sepY, unitCell, cellDensity,
  dtSec, flashDecay, heroX, heroY, fx, fy, nearSepSq, midSepSq, promoteSq,
  needSep, separationRadius, separationStrength, sepSq, invSepRadius, maxNeighbors, maxProbes, tickCount,
  ox, oy, invCell, cols, rows, hashHead, hashNext,
  ffHas, ffCost, ffDirX, ffDirY,
  ecs,
) {
  let promotedThisStep = 0;
  const tickPhase = tickCount & 3;
  const tickParity = tickCount & 1;
  const ecsFlagsArr = ecs.flags;
  const ecsToSlot = ecs.swarmToSlot;
  const ecsPosX = ecs.posX;
  const ecsPosY = ecs.posY;
  const ecsRot = ecs.rot;
  const ecsLockMask = ECS_SLOT_FLAGS.DEAD | ECS_SLOT_FLAGS.FROZEN | ECS_SLOT_FLAGS.KNOCKBACK;

  for (let a = 0; a < activeCount; a++) {
    const id = activeIds[a];
    animTime[id] += dtSec;

    const uFlags = unitFlags[id];
    if ((uFlags & SWARM_UNIT_FLAGS.FLASHING) !== 0 && dtSec > 0) {
      const nextF = flash[id] - flashDecay * dtSec;
      if (nextF <= 0) {
        flash[id] = 0;
        unitFlags[id] = uFlags & ~SWARM_UNIT_FLAGS.FLASHING;
      } else {
        flash[id] = nextF;
      }
    }

    let ecsSlot = -1;
    let lockedByEcs = false;
    if ((uFlags & SWARM_UNIT_FLAGS.ECS_CLAIMED) !== 0) {
      ecsSlot = ecsToSlot[id];
      if (ecsSlot !== -1 && (ecsFlagsArr[ecsSlot] & ecsLockMask) !== 0) {
        lockedByEcs = true;
      }
    }

    let px = posX[id];
    let py = posY[id];

    if (!lockedByEcs && dtSec > 0) {
      const dxF = px - fx;
      const dyF = py - fy;
      const distFocusSq = dxF * dxF + dyF * dyF;
      const cell = unitCell[id];

      let dirX = 0;
      let dirY = 0;
      if (ffHas) {
        if (distFocusSq < nearSepSq) {
          const gx = (px - ox) * invCell - 0.5;
          const gy = (py - oy) * invCell - 0.5;
          const cx0 = Math.max(0, Math.min(cols - 1, Math.floor(gx)));
          const cy0 = Math.max(0, Math.min(rows - 1, Math.floor(gy)));
          const cx1 = cx0 + 1 < cols ? cx0 + 1 : cx0;
          const cy1 = cy0 + 1 < rows ? cy0 + 1 : cy0;
          const tx = gx <= cx0 ? 0 : (gx >= cx0 + 1 ? 1 : gx - cx0);
          const ty = gy <= cy0 ? 0 : (gy >= cy0 + 1 ? 1 : gy - cy0);
          const i00 = cy0 * cols + cx0;
          const i10 = cy0 * cols + cx1;
          const i01 = cy1 * cols + cx0;
          const i11 = cy1 * cols + cx1;
          let sx = 0, sy = 0, wSum = 0;
          if (ffCost[i00] < WALL_COST) { const w = (1 - tx) * (1 - ty); sx += ffDirX[i00] * w; sy += ffDirY[i00] * w; wSum += w; }
          if (ffCost[i10] < WALL_COST) { const w = tx * (1 - ty); sx += ffDirX[i10] * w; sy += ffDirY[i10] * w; wSum += w; }
          if (ffCost[i01] < WALL_COST) { const w = (1 - tx) * ty; sx += ffDirX[i01] * w; sy += ffDirY[i01] * w; wSum += w; }
          if (ffCost[i11] < WALL_COST) { const w = tx * ty; sx += ffDirX[i11] * w; sy += ffDirY[i11] * w; wSum += w; }
          if (wSum > 1e-6) {
            const lenSq = sx * sx + sy * sy;
            if (lenSq > 1e-12) {
              const invL = 1 / Math.sqrt(lenSq);
              dirX = sx * invL;
              dirY = sy * invL;
            } else {
              dirX = ffDirX[cell];
              dirY = ffDirY[cell];
            }
          } else {
            dirX = ffDirX[cell];
            dirY = ffDirY[cell];
          }
        } else {
          dirX = ffDirX[cell];
          dirY = ffDirY[cell];
        }
      }

      if (dirX === 0 && dirY === 0) {
        const hx = heroX - px;
        const hy = heroY - py;
        const hLenSq = hx * hx + hy * hy;
        if (hLenSq > 1e-8) {
          const invH = 1 / Math.sqrt(hLenSq);
          dirX = hx * invH;
          dirY = hy * invH;
        }
      }

      let pushX = 0;
      let pushY = 0;
      let spd = speed[id];

      if (distFocusSq < midSepSq) {
        if (needSep) {
          if (distFocusSq < nearSepSq || (id & 3) === tickPhase) {
            let checked = 0;
            let probes = 0;
            let minGx = Math.floor((px - separationRadius - ox) * invCell);
            let maxGx = Math.floor((px + separationRadius - ox) * invCell);
            let minGy = Math.floor((py - separationRadius - oy) * invCell);
            let maxGy = Math.floor((py + separationRadius - oy) * invCell);
            if (minGx < 0) minGx = 0;
            if (minGy < 0) minGy = 0;
            if (maxGx >= cols) maxGx = cols - 1;
            if (maxGy >= rows) maxGy = rows - 1;
            for (let cy = minGy; cy <= maxGy && checked < maxNeighbors && probes < maxProbes; cy++) {
              const rowBase = cy * cols;
              for (let cx = minGx; cx <= maxGx && checked < maxNeighbors && probes < maxProbes; cx++) {
                let cur = hashHead[rowBase + cx];
                while (cur !== -1 && checked < maxNeighbors && probes < maxProbes) {
                  const nxt = hashNext[cur];
                  if (cur !== id) {
                    probes++;
                    const dx = px - posX[cur];
                    const dy = py - posY[cur];
                    const dSq = dx * dx + dy * dy;
                    if (dSq > 1e-6 && dSq < sepSq) {
                      const weight = 1 / Math.sqrt(dSq) - invSepRadius;
                      pushX += dx * weight;
                      pushY += dy * weight;
                      checked++;
                    }
                  }
                  cur = nxt;
                }
              }
            }
            sepX[id] = pushX;
            sepY[id] = pushY;
          } else {
            pushX = sepX[id] * 0.9;
            pushY = sepY[id] * 0.9;
            sepX[id] = pushX;
            sepY[id] = pushY;
          }
        }
      } else {
        const excess = cellDensity[cell] - 4;
        if (excess > 0) spd *= Math.max(0.35, 1 - excess * 0.04);
        pushX = sepX[id] * 0.8;
        pushY = sepY[id] * 0.8;
        sepX[id] = pushX;
        sepY[id] = pushY;
      }

      const moveX = dirX * spd + pushX * separationStrength;
      const moveY = dirY * spd + pushY * separationStrength;
      px += moveX * dtSec;
      py += moveY * dtSec;
      posX[id] = px;
      posY[id] = py;

      if (distFocusSq < midSepSq || (id & 1) === tickParity) {
        if (moveX * moveX + moveY * moveY > 1e-5) {
          rot[id] = fastAtan2(dirX !== 0 || dirY !== 0 ? dirX : moveX, dirX !== 0 || dirY !== 0 ? dirY : moveY);
        }
      }

      if (ecsSlot !== -1) {
        ecsPosX[ecsSlot] = px;
        ecsPosY[ecsSlot] = py;
        ecsRot[ecsSlot] = rot[id];
      }
    }

    if (ecsSlot === -1) {
      const dxHero = px - heroX;
      const dyHero = py - heroY;
      if (dxHero * dxHero + dyHero * dyHero <= promoteSq) {
        const promoted = ecs.promoteSwarmUnit(id, px, py, rot[id], hp[id], animClip[id], 0);
        if (promoted !== -1) {
          unitFlags[id] |= SWARM_UNIT_FLAGS.ECS_CLAIMED;
          promotedThisStep++;
        }
      }
    }
  }
  return promotedThisStep;
}

/**
 * @typedef {object} SwarmSimulationOptions
 * @property {number} [capacity=32768] Maximum swarm units (`1..262144`).
 * @property {number} [promoteRadius=10] Radius around hero auto-claiming fine ECS slots.
 * @property {number} [demoteRadius=12] Hysteresis radius releasing idle ECS slots back to autonomous swarm.
 * @property {number} [separationRadius=0.9] Neighbor soft-push separation radius.
 * @property {number} [separationStrength=2.5] Neighbor push strength (units/s).
 * @property {number} [nearSeparationRadius=25] Distance within focus executing full 60Hz neighbor separation.
 * @property {number} [midSeparationRadius=65] Outer distance running 4-frame staggered separation (cached `sepX`/`sepY`); beyond uses flow + cell density damping.
 * @property {number} [maxNeighbors=8] Hard cap on neighbor checks per unit per step.
 * @property {number} [flowInterval=0.1] Flow Field update interval in seconds; unchanged goal cell and costs reuse the previous field (`<= 0` recomputes every step).
 * @property {number} [ecsSlots=5000] Fixed ECS slot budget inside proximity ring.
 * @property {number} [maxHitEvents] Queued hits per simulation step; defaults to `Math.max(4096, ecsSlots)`.
 * @property {number} [maxPatchesPerStep=1024] Max ECS patches flushed per step.
 * @property {number} [gridCols=128] Spatial hash & Flow Field column count.
 * @property {number} [gridRows=128] Spatial hash & Flow Field row count.
 * @property {number} [cellSize=2] Cell size in world units.
 * @property {number} [originX=-128] World X minimum corner.
 * @property {number} [originY=-128] World Y/Z minimum corner.
 * @property {boolean} [useFlowField=true] When false, units steer directly toward `(heroX, heroY)`.
 * @property {number} [flashDuration=0.08] Hit-flash decay duration in seconds.
 */

/**
 * @typedef {object} SwarmSpawnOptions
 * @property {number} [x=0]
 * @property {number} [y=0]
 * @property {number} [rot=0]
 * @property {number} [speed=3.5]
 * @property {number} [scale=1]
 * @property {number} [hp=100]
 * @property {number} [clipId=0]
 * @property {number} [animTime=0]
 */

/**
 * @typedef {object} SwarmWaveSpawnOptions
 * @property {number} [count=1000] Number of units to spawn.
 * @property {number} [centerX=0] Ring center X.
 * @property {number} [centerY=0] Ring center Y/Z.
 * @property {number} [minRadius=20] Inner ring radius.
 * @property {number} [maxRadius=60] Outer ring radius.
 * @property {number} [speed=3.5] Movement speed (world units/sec).
 * @property {number} [hp=100] Initial hit points.
 * @property {number} [clipId=0] Clip index.
 * @property {number} [scale=1] Instance scale.
 * @property {number | null} [seed=null] Deterministic LCG seed (optional).
 */

/**
 * @typedef {object} SwarmCircleDamageOptions
 * @property {number} [x=0]
 * @property {number} [y=0]
 * @property {number} [radius=5]
 * @property {number} [damage=25]
 * @property {number} [knockback=0]
 * @property {number} [freezeDuration=0]
 * @property {number} [flashDuration]
 */

/**
 * @typedef {object} SwarmStepOptions
 * @property {number} [heroX=0]
 * @property {number} [heroY=0]
 * @property {number} [focusX] Optional focal X for 3-tier LOD separation (defaults to `heroX`).
 * @property {number} [focusY] Optional focal Y/Z for 3-tier LOD separation (defaults to `heroY`).
 * @property {((swarmId: number, x: number, y: number) => void) | null} [onUnitKilled=null]
 */

/**
 * @typedef {object} SwarmStepStats
 * @property {number} activeCount Total live swarm units.
 * @property {number} ecsActiveCount Live units currently owning an ECS slot.
 * @property {number} promotedThisStep Units promoted to ECS this step.
 * @property {number} killedThisStep Units killed this step.
 * @property {number} patchesApplied ECS-to-swarm patches synced this step.
 */

/**
 * @typedef {object} SwarmSyncCrowd2DOptions
 * @property {boolean} [syncRotation=false] Write `rot` into `crowd.rotation`.
 * @property {boolean} [flipByDirection=true] Flip `crowd.flipX` based on `sin(rot) < 0`.
 * @property {number} [frameCount=1] SpriteSheet frame count per clip (`> 1` animates `crowd.frame`).
 * @property {number} [animFps=8] Sprite animation frames per second.
 * @property {boolean} [copyArrays=false] Force copying per-unit SoA arrays into `crowd2d` (by default `bindSwarm` connects zero-copy).
 */

/**
 * @typedef {object} SwarmSimulation
 * @property {number} capacity
 * @property {number} count Getter; live swarm count.
 * @property {Uint8Array} unitFlags
 * @property {Float32Array} posX
 * @property {Float32Array} posY
 * @property {Float32Array} rot
 * @property {Float32Array} speed
 * @property {Float32Array} scale
 * @property {Int32Array} hp
 * @property {Uint16Array} animClip
 * @property {Float32Array} animTime
 * @property {Float32Array} flash
 * @property {Float32Array} sepX Cached neighbor separation X vector per unit.
 * @property {Float32Array} sepY Cached neighbor separation Y/Z vector per unit.
 * @property {Uint16Array|Uint32Array} cellDensity Unit count per cell at the start of the latest step; 32-bit when capacity exceeds 65535.
 * @property {Int32Array} activeIds Contiguous slice `[0 .. count - 1]` of live unit IDs.
 * @property {Uint32Array} [slotGeneration] Native simulation's read-only per-slot spawn generation.
 * @property {number} chunkCols
 * @property {number} chunkRows
 * @property {Int32Array} chunkHead Per-chunk intrusive head index (`-1` = empty).
 * @property {Int32Array} chunkNext Per-unit next index inside its chunk list.
 * @property {Uint32Array} chunkCount Unit count per chunk.
 * @property {Float32Array} chunkMinX Tight minimum X per non-empty chunk.
 * @property {Float32Array} chunkMaxX Tight maximum X per non-empty chunk.
 * @property {Float32Array} chunkMinY Tight minimum Y/Z per non-empty chunk.
 * @property {Float32Array} chunkMaxY Tight maximum Y/Z per non-empty chunk.
 * @property {() => void} ensureChunks Rebuilds coarse chunk lists & tight bounds when dirty.
 * @property {FlatSpatialHash2D} spatialHash
 * @property {FlowField2D} flowField
 * @property {FlatCombatECS} ecs
 * @property {(options?: SwarmSpawnOptions) => number} spawn
 * @property {(options?: SwarmWaveSpawnOptions) => number} spawnWave
 * @property {(id: number) => boolean} kill
 * @property {() => void} clear
 * @property {(options?: SwarmCircleDamageOptions) => number} applyCircleDamage Number of hit events accepted into the bounded combat queue.
 * @property {(dt: number, options?: SwarmStepOptions) => SwarmStepStats} step
 * @property {(crowd2d: import('../integrations/canvas2d.js').SpriteCrowd2D, options?: SwarmSyncCrowd2DOptions) => number} syncToSpriteCrowd2D
 */

/**
 * Creates an integrated 2D/3D zero-GC swarm simulation combining a Flow Field,
 * 3-tier distance-decimated 1D spatial hash neighbor separation, coarse chunk indexing,
 * and a 10m/12m FlatCombatECS bridge.
 * @param {SwarmSimulationOptions} [options]
 * @returns {SwarmSimulation}
 */
export function createSwarmSimulation({
  capacity = 32768,
  promoteRadius = 10,
  demoteRadius = 12,
  separationRadius = 0.9,
  separationStrength = 2.5,
  nearSeparationRadius = 25,
  midSeparationRadius = 65,
  maxNeighbors = 8,
  flowInterval = 0.1,
  ecsSlots = 5000,
  maxHitEvents = Math.max(4096, ecsSlots),
  maxPatchesPerStep = 1024,
  gridCols = 128,
  gridRows = 128,
  cellSize = 2,
  originX = -128,
  originY = -128,
  useFlowField = true,
  flashDuration = 0.08,
} = {}) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 262144) {
    throw new RangeError('createSwarmSimulation capacity must be an integer in 1..262144');
  }
  if (!Number.isFinite(promoteRadius) || promoteRadius < 0) throw new RangeError('promoteRadius must be >= 0');
  if (!Number.isFinite(demoteRadius) || demoteRadius < promoteRadius) throw new RangeError('demoteRadius must be >= promoteRadius');
  const nearSepR = Number.isFinite(nearSeparationRadius) && nearSeparationRadius >= 0 ? nearSeparationRadius : 25;
  const midSepR = Number.isFinite(midSeparationRadius) && midSeparationRadius >= nearSepR ? midSeparationRadius : Math.max(nearSepR, 65);

  const unitFlags = new Uint8Array(capacity);
  const posX = new Float32Array(capacity);
  const posY = new Float32Array(capacity);
  const rot = new Float32Array(capacity);
  const speed = new Float32Array(capacity).fill(3.5);
  const scale = new Float32Array(capacity).fill(1);
  const hp = new Int32Array(capacity).fill(100);
  const animClip = new Uint16Array(capacity);
  const animTime = new Float32Array(capacity);
  const flash = new Float32Array(capacity);
  const statusCode = new Uint8Array(capacity);
  const sepX = new Float32Array(capacity);
  const sepY = new Float32Array(capacity);
  const slotGeneration = new Uint32Array(capacity);

  const freeStack = new Int32Array(capacity);
  let freeTop = capacity;
  for (let i = 0; i < capacity; i++) freeStack[i] = capacity - 1 - i;

  const activeIds = new Int32Array(capacity);
  const indexInActive = new Int32Array(capacity).fill(-1);
  let activeCount = 0;

  const spatialHash = new FlatSpatialHash2D({
    cols: gridCols,
    rows: gridRows,
    cellSize,
    originX,
    originY,
    capacity,
  });
  const flowField = new FlowField2D({
    cols: gridCols,
    rows: gridRows,
    cellSize,
    originX,
    originY,
  });
  const ecs = new FlatCombatECS({
    maxSlots: Math.min(ecsSlots, capacity),
    maxHitEvents,
    swarmCapacity: capacity,
  });
  ecs._onPromote = (sId) => {
    if (sId >= 0 && sId < capacity) unitFlags[sId] |= SWARM_UNIT_FLAGS.ECS_CLAIMED;
  };

  // Coarse 32x32 spatial chunks with tight bounds for O(chunks) frustum & AOE culling.
  const chunkCols = Math.min(gridCols, 32);
  const chunkRows = Math.min(gridRows, 32);
  const totalChunks = chunkCols * chunkRows;
  const chunkW = (gridCols * cellSize) / chunkCols;
  const chunkH = (gridRows * cellSize) / chunkRows;
  const invChunkW = 1 / chunkW;
  const invChunkH = 1 / chunkH;
  const chunkHead = new Int32Array(totalChunks).fill(-1);
  const chunkNext = new Int32Array(capacity).fill(-1);
  const chunkCount = new Uint32Array(totalChunks);
  const baseChunkMinX = new Float32Array(totalChunks);
  const baseChunkMaxX = new Float32Array(totalChunks);
  const baseChunkMinY = new Float32Array(totalChunks);
  const baseChunkMaxY = new Float32Array(totalChunks);
  for (let ky = 0; ky < chunkRows; ky++) {
    for (let kx = 0; kx < chunkCols; kx++) {
      const ck = ky * chunkCols + kx;
      baseChunkMinX[ck] = originX + kx * chunkW - 0.5;
      baseChunkMaxX[ck] = originX + (kx + 1) * chunkW + 0.5;
      baseChunkMinY[ck] = originY + ky * chunkH - 0.5;
      baseChunkMaxY[ck] = originY + (ky + 1) * chunkH + 0.5;
    }
  }
  const chunkMinX = new Float32Array(baseChunkMinX);
  const chunkMaxX = new Float32Array(baseChunkMaxX);
  const chunkMinY = new Float32Array(baseChunkMinY);
  const chunkMaxY = new Float32Array(baseChunkMaxY);
  const unitCell = new Int32Array(capacity);
  // Every live unit can occupy the same cell, including out-of-world units
  // clamped to an edge cell. Select the counter width from total capacity.
  const cellDensity = capacity <= 0xffff
    ? new Uint16Array(gridCols * gridRows)
    : new Uint32Array(gridCols * gridRows);

  const swarmToCrowd2D = new Int32Array(capacity).fill(-1);
  let boundCrowd2D = null;
  let flowAccum = 0;
  let hasFlow = false;
  let flowGoalX = -1, flowGoalY = -1, flowVersion = -1;
  const flowCostSnapshot = useFlowField ? new Uint8Array(flowField.cost.length) : null;
  let tickCount = 0;
  let chunksDirty = true;

  const flashDecay = flashDuration > 0 ? (1 / flashDuration) : 12.5;
  const promoteSq = promoteRadius * promoteRadius;
  const nearSepSq = nearSepR * nearSepR;
  const midSepSq = midSepR * midSepR;
  const fineLimitDist = midSepR + Math.max(0, separationRadius) + cellSize;
  const fineLimitSq = fineLimitDist * fineLimitDist;
  const sepSq = separationRadius * separationRadius;
  const invSepRadius = separationRadius > 0 ? 1 / separationRadius : 0;

  function ensureChunks() {
    if (!chunksDirty) return;
    chunkHead.fill(-1);
    chunkCount.fill(0);
    chunkMinX.fill(Infinity);
    chunkMaxX.fill(-Infinity);
    chunkMinY.fill(Infinity);
    chunkMaxY.fill(-Infinity);

    for (let a = 0; a < activeCount; a++) {
      const id = activeIds[a];
      const px = posX[id];
      const py = posY[id];
      let kx = Math.floor((px - originX) * invChunkW);
      let ky = Math.floor((py - originY) * invChunkH);
      if (kx < 0) kx = 0;
      else if (kx >= chunkCols) kx = chunkCols - 1;
      if (ky < 0) ky = 0;
      else if (ky >= chunkRows) ky = chunkRows - 1;
      const ck = ky * chunkCols + kx;
      chunkNext[id] = chunkHead[ck];
      chunkHead[ck] = id;
      chunkCount[ck]++;
      if (px < chunkMinX[ck]) chunkMinX[ck] = px;
      if (px > chunkMaxX[ck]) chunkMaxX[ck] = px;
      if (py < chunkMinY[ck]) chunkMinY[ck] = py;
      if (py > chunkMaxY[ck]) chunkMaxY[ck] = py;
    }
    chunksDirty = false;
  }

  function spawn({
    x = 0,
    y = 0,
    rot: r = 0,
    speed: spd = 3.5,
    scale: sc = 1,
    hp: initHp = 100,
    clipId = 0,
    animTime: t0 = 0,
  } = {}) {
    return spawnUnit(x, y, r, spd, sc, initHp, clipId, t0);
  }

  function spawnUnit(x, y, r, spd, sc, initHp, clipId, t0) {
    if (freeTop <= 0) return -1;
    const id = freeStack[--freeTop];
    const slot = activeCount++;
    activeIds[slot] = id;
    indexInActive[id] = slot;
    slotGeneration[id]++;

    unitFlags[id] = SWARM_UNIT_FLAGS.ALIVE;
    posX[id] = x;
    posY[id] = y;
    rot[id] = r;
    speed[id] = spd;
    scale[id] = sc;
    hp[id] = Math.max(1, initHp | 0);
    animClip[id] = clipId & 0xffff;
    animTime[id] = t0;
    flash[id] = 0;
    statusCode[id] = 0;
    sepX[id] = 0;
    sepY[id] = 0;
    chunksDirty = true;
    return id;
  }

  function spawnWave({
    count = 1000,
    centerX = 0,
    centerY = 0,
    minRadius = 20,
    maxRadius = 60,
    speed: spd = 3.5,
    hp: initHp = 100,
    clipId = 0,
    scale: sc = 1,
    seed = null,
  } = {}) {
    let s = (seed ?? ((Date.now() ^ 0x5f3759df) >>> 0)) >>> 0;
    const nextRand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const r0 = Math.max(0, minRadius);
    const r1 = Math.max(r0, maxRadius);
    const r0Sq = r0 * r0;
    const rDiffSq = r1 * r1 - r0Sq;

    let spawned = 0;
    const target = Math.max(0, count | 0);
    for (let i = 0; i < target; i++) {
      const ang = nextRand() * Math.PI * 2;
      const dist = Math.sqrt(r0Sq + nextRand() * rDiffSq);
      const px = centerX + Math.cos(ang) * dist;
      const py = centerY + Math.sin(ang) * dist;
      const yaw = Math.atan2(centerX - px, centerY - py);
      const id = spawnUnit(px, py, yaw, spd, sc, initHp, clipId, nextRand() * 2.0);
      if (id < 0) break;
      spawned++;
    }
    return spawned;
  }

  function _releaseSwarmUnit(id) {
    unitFlags[id] = SWARM_UNIT_FLAGS.NONE;
    flash[id] = 0;
    sepX[id] = 0;
    sepY[id] = 0;
    chunksDirty = true;

    if (boundCrowd2D && swarmToCrowd2D[id] !== -1) {
      boundCrowd2D.kill(swarmToCrowd2D[id]);
      swarmToCrowd2D[id] = -1;
    }

    const activeSlot = indexInActive[id];
    if (activeSlot !== -1) {
      const lastSlot = --activeCount;
      if (activeSlot !== lastSlot) {
        const movedId = activeIds[lastSlot];
        activeIds[activeSlot] = movedId;
        indexInActive[movedId] = activeSlot;
      }
      indexInActive[id] = -1;
      freeStack[freeTop++] = id;
    }
  }

  function kill(id) {
    if (id < 0 || id >= capacity || (unitFlags[id] & SWARM_UNIT_FLAGS.ALIVE) === 0) return false;
    const ecsSlot = ecs.getSlotBySwarmId(id);
    if (ecsSlot !== -1) {
      ecs.flags[ecsSlot] = ECS_SLOT_FLAGS.NONE;
      ecs.swarmUnitId[ecsSlot] = -1;
      ecs.swarmToSlot[id] = -1;
      ecs._freeStack[ecs._freeTop++] = ecsSlot;
      ecs._activeCount = Math.max(0, ecs._activeCount - 1);
      ecs._trimScanLimit();
    }
    _releaseSwarmUnit(id);
    return true;
  }

  function clear() {
    for (let i = 0; i < activeCount; i++) {
      const id = activeIds[i];
      unitFlags[id] = SWARM_UNIT_FLAGS.NONE;
      flash[id] = 0;
      sepX[id] = 0;
      sepY[id] = 0;
      indexInActive[id] = -1;
      freeStack[freeTop++] = id;
    }
    activeCount = 0;
    ecs.clear();
    spatialHash.clear();
    chunkHead.fill(-1);
    chunkCount.fill(0);
    cellDensity.fill(0);
    chunksDirty = false;
    if (boundCrowd2D) {
      boundCrowd2D.clear();
      swarmToCrowd2D.fill(-1);
    }
  }

  function applyCircleDamage({
    x = 0,
    y = 0,
    radius = 5,
    damage = 25,
    knockback = 0,
    freezeDuration = 0,
  } = {}) {
    if (ecs._hitCount >= ecs.maxHitEvents) return 0;
    ensureChunks();
    const r = Math.max(0, radius);
    const rSq = r * r;
    let applied = 0;
    // Out-of-world units are stored in edge chunks, so clamp rather than
    // rejecting a query whose circle lies outside the configured grid.
    let minChunkX = 0, maxChunkX = chunkCols - 1, minChunkY = 0, maxChunkY = chunkRows - 1;
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(r)) {
      minChunkX = Math.max(0, Math.min(chunkCols - 1, Math.floor((x - r - originX) * invChunkW)));
      maxChunkX = Math.max(0, Math.min(chunkCols - 1, Math.floor((x + r - originX) * invChunkW)));
      minChunkY = Math.max(0, Math.min(chunkRows - 1, Math.floor((y - r - originY) * invChunkH)));
      maxChunkY = Math.max(0, Math.min(chunkRows - 1, Math.floor((y + r - originY) * invChunkH)));
    }
    for (let cy = minChunkY; cy <= maxChunkY; cy++) for (let cx = minChunkX; cx <= maxChunkX; cx++) {
      const ck = cy * chunkCols + cx;
      let id = chunkHead[ck];
      if (id === -1) continue;
      if (x + r < chunkMinX[ck] || x - r > chunkMaxX[ck] || y + r < chunkMinY[ck] || y - r > chunkMaxY[ck]) {
        continue;
      }
      while (id !== -1) {
        if ((unitFlags[id] & SWARM_UNIT_FLAGS.ALIVE) !== 0) {
          const dx = posX[id] - x;
          const dy = posY[id] - y;
          if (dx * dx + dy * dy <= rSq) {
            if (ecs._hitCount >= ecs.maxHitEvents) return applied;
            const slot = ecs.promoteSwarmUnit(id, posX[id], posY[id], rot[id], hp[id], animClip[id], 0);
            if (slot >= 0) {
              let pushX = 0;
              let pushY = 0;
              if (knockback !== 0) {
                const distSq = dx * dx + dy * dy;
                if (distSq > 1e-10) {
                  const invD = 1 / Math.sqrt(distSq);
                  pushX = dx * invD * knockback;
                  pushY = dy * invD * knockback;
                } else {
                  pushX = knockback;
                }
              }
              if (ecs.enqueueHit(slot, damage, pushX, pushY, freezeDuration)) {
                unitFlags[id] |= SWARM_UNIT_FLAGS.ECS_CLAIMED | SWARM_UNIT_FLAGS.FLASHING;
                flash[id] = 1;
                applied++;
              }
            }
          }
        }
        id = chunkNext[id];
      }
    }
    return applied;
  }

  function step(dt = 0, { heroX = 0, heroY = 0, focusX = heroX, focusY = heroY, onUnitKilled = null } = {}) {
    const dtSec = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const fx = Number.isFinite(focusX) ? focusX : heroX;
    const fy = Number.isFinite(focusY) ? focusY : heroY;

    if (useFlowField) {
      flowAccum += dtSec;
      if (!hasFlow || flowInterval <= 0 || flowAccum >= flowInterval) {
        flowAccum = 0;
        const goalX = Math.max(0, Math.min(flowField.cols - 1, Math.floor((heroX - flowField.originX) * flowField.invCellSize)));
        const goalY = Math.max(0, Math.min(flowField.rows - 1, Math.floor((heroY - flowField.originY) * flowField.invCellSize)));
        let changed = !hasFlow || flowInterval <= 0 || !flowField._hasComputed ||
          flowField._computeVersion !== flowVersion || goalX !== flowGoalX || goalY !== flowGoalY;
        if (!changed) {
          for (let i = 0; i < flowField.cost.length; i++) {
            if (flowField.cost[i] !== flowCostSnapshot[i]) { changed = true; break; }
          }
        }
        if (changed) {
          flowField.compute({ x: heroX, y: heroY });
          flowCostSnapshot.set(flowField.cost);
          flowGoalX = goalX; flowGoalY = goalY; flowVersion = flowField._computeVersion;
          hasFlow = true;
        }
      }
    }

    const invCell = spatialHash.invCellSize;
    const ox = spatialHash.originX;
    const oy = spatialHash.originY;
    const cols = spatialHash.cols;
    const rows = spatialHash.rows;
    const hashHead = spatialHash.head;
    const hashNext = spatialHash.next;

    // 1. Build the fine hash and density grid. Coarse chunks are rebuilt lazily
    // after movement only when rendering or combat queries need them.
    chunksDirty = true;
    buildSwarmStepGrid(
      activeCount, activeIds, posX, posY,
      ox, oy, invCell, cols, rows,
      hashHead, hashNext, cellDensity, unitCell,
      fx, fy, fineLimitSq,
    );

    // 2. Sequential autonomous simulation (3-tier distance separation + FlowField + density damping + 10m ECS promotion).
    const needSep = separationRadius > 0 && maxNeighbors > 0 && separationStrength > 0;
    const promotedThisStep = stepSwarmSequential(
      activeCount, activeIds, unitFlags, posX, posY, rot, speed, animTime, animClip, hp, flash, sepX, sepY, unitCell, cellDensity,
      dtSec, flashDecay, heroX, heroY, fx, fy, nearSepSq, midSepSq, promoteSq,
      needSep, separationRadius, separationStrength, sepSq, invSepRadius, maxNeighbors, maxNeighbors * 2, tickCount,
      ox, oy, invCell, cols, rows, hashHead, hashNext,
      useFlowField && flowField._hasComputed, flowField.cost, flowField.dirX, flowField.dirY,
      ecs,
    );

    // Step-grid membership describes pre-movement positions. Subsequent spatial
    // queries must rebuild before relying on the lists or their bounds.
    chunksDirty = true;

    // 3. Resolve ECS combat queue, frozen/knockback kinematics, and patch flush back to swarm.
    ecs.damageResolutionSystem();
    ecs.kinematicsSystem(dtSec);

    let killedThisStep = 0;
    const flushStats = ecs.flushPatchesAndCleanup(
      heroX,
      heroY,
      demoteRadius,
      maxPatchesPerStep,
      (patch) => {
        const sId = patch.swarmId;
        if (sId < 0 || sId >= capacity) return;
        if ((unitFlags[sId] & SWARM_UNIT_FLAGS.ALIVE) === 0) return;

        if (patch.isDead) {
          killedThisStep++;
          _releaseSwarmUnit(sId);
          return;
        }
        // A previous kill callback may have rebuilt the index during this flush.
        chunksDirty = true;
        posX[sId] = patch.x;
        posY[sId] = patch.y;
        rot[sId] = patch.rot;
        hp[sId] = patch.hp;
        animClip[sId] = patch.clipId;
        if (patch.isDemoted) {
          unitFlags[sId] &= ~SWARM_UNIT_FLAGS.ECS_CLAIMED;
        }
      },
      onUnitKilled,
    );

    tickCount = (tickCount + 1) | 0;
    // ECS callbacks may have queried and rebuilt chunks while patches were
    // still being applied; the final positions need a fresh index as well.
    chunksDirty = true;

    return {
      activeCount,
      ecsActiveCount: flushStats.activeSlots,
      promotedThisStep,
      killedThisStep,
      patchesApplied: flushStats.patchesEmitted,
    };
  }

  /**
   * Connects or synchronizes live swarm instances into an HGame 2D `SpriteCrowd2D` component.
   * By default (`copyArrays: false`) uses zero-copy chunk binding when `crowd2d.bindSwarm` is available.
   * @param {import('../integrations/canvas2d.js').SpriteCrowd2D} crowd2d
   * @param {SwarmSyncCrowd2DOptions} [options]
   * @returns {number} Number of crowd instances connected or synced.
   */
  function syncToSpriteCrowd2D(crowd2d, {
    syncRotation = false,
    flipByDirection = true,
    frameCount = 1,
    animFps = 8,
    copyArrays = false,
  } = {}) {
    if (!crowd2d || !crowd2d.x || typeof crowd2d.spawn !== 'function') {
      throw new TypeError('syncToSpriteCrowd2D requires a SpriteCrowd2D instance');
    }
    if (!copyArrays && typeof crowd2d.bindSwarm === 'function') {
      ensureChunks();
      crowd2d.bindSwarm(api, { syncRotation, flipByDirection, frameCount, animFps });
      return Math.min(crowd2d.capacity, activeCount);
    }

    if (boundCrowd2D !== crowd2d) {
      if (boundCrowd2D) boundCrowd2D.clear();
      boundCrowd2D = crowd2d;
      swarmToCrowd2D.fill(-1);
    }

    const fCount = Math.max(1, frameCount | 0);
    let synced = 0;
    for (let a = 0; a < activeCount; a++) {
      const id = activeIds[a];
      let cid = swarmToCrowd2D[id];
      if (cid === -1 || !crowd2d.active[cid]) {
        cid = crowd2d.spawn({ x: posX[id], y: posY[id] });
        if (cid === -1) break;
        swarmToCrowd2D[id] = cid;
      }
      crowd2d.x[cid] = posX[id];
      crowd2d.y[cid] = posY[id];
      const sc = scale[id];
      crowd2d.scaleX[cid] = sc;
      crowd2d.scaleY[cid] = sc;
      crowd2d.flash[cid] = flash[id];
      if (crowd2d.statusCode) crowd2d.statusCode[cid] = statusCode[id];
      if (syncRotation) crowd2d.rotation[cid] = rot[id];
      if (flipByDirection) crowd2d.flipX[cid] = Math.sin(rot[id]) < 0 ? 1 : 0;
      if (fCount > 1) {
        crowd2d.frame[cid] = Math.floor(animTime[id] * animFps) % fCount;
      } else {
        crowd2d.frame[cid] = animClip[id];
      }
      synced++;
    }
    return synced;
  }

  const api = {
    capacity,
    get count() { return activeCount; },
    unitFlags,
    posX,
    posY,
    rot,
    speed,
    scale,
    hp,
    animClip,
    animTime,
    flash,
    statusCode,
    sepX,
    sepY,
    cellDensity,
    activeIds,
    slotGeneration,
    chunkCols,
    chunkRows,
    chunkHead,
    chunkNext,
    chunkCount,
    chunkMinX,
    chunkMaxX,
    chunkMinY,
    chunkMaxY,
    ensureChunks,
    spatialHash,
    flowField,
    ecs,
    spawn,
    spawnWave,
    kill,
    clear,
    applyCircleDamage,
    step,
    syncToSpriteCrowd2D,
  };
  return api;
}
