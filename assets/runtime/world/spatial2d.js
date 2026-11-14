/**
 * Zero-GC-friendly ObjectPool and 2D SpatialHash2D grid for horde survivor
 * proximity queries, projectile broad-phase checks, and soft enemy separation.
 */

export class ObjectPool {
  constructor({ create, reset = null, initialSize = 0, maxSize = 1024 } = {}) {
    if (typeof create !== 'function') throw new TypeError('ObjectPool requires a create function');
    if (reset !== null && typeof reset !== 'function') throw new TypeError('ObjectPool reset must be a function');
    if (!Number.isInteger(initialSize) || initialSize < 0) throw new RangeError('initialSize must be >= 0');
    if (!Number.isInteger(maxSize) || maxSize < 1) throw new RangeError('maxSize must be >= 1');

    this._create = create;
    this._reset = reset;
    this._maxSize = maxSize;
    this._free = [];
    this._inPool = new Set();
    this._activeCount = 0;

    const preload = Math.min(initialSize, maxSize);
    for (let i = 0; i < preload; i++) {
      const item = this._create();
      this._free.push(item);
      this._inPool.add(item);
    }
  }

  get activeCount() { return this._activeCount; }
  get freeCount() { return this._free.length; }

  acquire(...args) {
    const item = this._free.length > 0 ? this._free.pop() : this._create();
    this._inPool.delete(item);
    this._activeCount++;
    this._reset?.(item, ...args);
    return item;
  }

  release(item) {
    if (item === null || item === undefined || this._inPool.has(item)) return false;
    if (this._activeCount > 0) this._activeCount--;
    if (this._free.length < this._maxSize) {
      this._free.push(item);
      this._inPool.add(item);
    }
    return true;
  }

  clear() {
    this._free.length = 0;
    this._inPool.clear();
    this._activeCount = 0;
  }
}

const HASH_HALF_SPAN = 524280;
const HASH_OFFSET = 524288;
const HASH_STRIDE = 1048576;

function packCell(cx, cy) {
  const sx = Math.max(-HASH_HALF_SPAN, Math.min(HASH_HALF_SPAN, cx | 0)) + HASH_OFFSET;
  const sy = Math.max(-HASH_HALF_SPAN, Math.min(HASH_HALF_SPAN, cy | 0)) + HASH_OFFSET;
  return sx * HASH_STRIDE + sy;
}

export class SpatialHash2D {
  constructor({ cellSize = 64 } = {}) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError('SpatialHash2D cellSize must be > 0');
    }
    this.cellSize = cellSize;
    this._invCellSize = 1 / cellSize;
    this._cells = new Map();
    this._entries = [];
    this._entryPool = [];
    this._cellPool = [];
    this._queryId = 0;
    this._sepScratch = [];
  }

  get count() { return this._entries.length; }

  clear() {
    for (const bucket of this._cells.values()) {
      bucket.length = 0;
      this._cellPool.push(bucket);
    }
    this._cells.clear();
    for (let i = 0; i < this._entries.length; i++) {
      const entry = this._entries[i];
      entry.item = null;
      this._entryPool.push(entry);
    }
    this._entries.length = 0;
  }

  insert(item, x, y, radius = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('SpatialHash2D coordinates must be finite');
    if (!Number.isFinite(radius) || radius < 0) throw new RangeError('SpatialHash2D radius must be >= 0');

    const entry = this._entryPool.length > 0 ? this._entryPool.pop() : { item: null, x: 0, y: 0, radius: 0, stamp: 0 };
    entry.item = item;
    entry.x = x;
    entry.y = y;
    entry.radius = radius;
    entry.stamp = 0;
    this._entries.push(entry);

    const inv = this._invCellSize;
    const minCx = Math.floor((x - radius) * inv);
    const maxCx = Math.floor((x + radius) * inv);
    const minCy = Math.floor((y - radius) * inv);
    const maxCy = Math.floor((y + radius) * inv);

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const key = packCell(cx, cy);
        let bucket = this._cells.get(key);
        if (!bucket) {
          bucket = this._cellPool.length > 0 ? this._cellPool.pop() : [];
          this._cells.set(key, bucket);
        }
        bucket.push(entry);
      }
    }
    return entry;
  }

  queryRadius(x, y, radius, out = []) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('SpatialHash2D query coordinates must be finite');
    if (!Number.isFinite(radius) || radius < 0) throw new RangeError('SpatialHash2D query radius must be >= 0');

    out.length = 0;
    const stamp = ++this._queryId;
    const inv = this._invCellSize;
    const minCx = Math.floor((x - radius) * inv);
    const maxCx = Math.floor((x + radius) * inv);
    const minCy = Math.floor((y - radius) * inv);
    const maxCy = Math.floor((y + radius) * inv);

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this._cells.get(packCell(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const entry = bucket[i];
          if (entry.stamp === stamp) continue;
          entry.stamp = stamp;
          const dx = entry.x - x;
          const dy = entry.y - y;
          const limit = radius + entry.radius;
          if (dx * dx + dy * dy <= limit * limit) {
            out.push(entry.item);
          }
        }
      }
    }
    return out;
  }

  queryAABB(minX, minY, maxX, maxY, out = []) {
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
      throw new TypeError('SpatialHash2D AABB bounds must be finite');
    }
    out.length = 0;
    const stamp = ++this._queryId;
    const inv = this._invCellSize;
    const minCx = Math.floor(minX * inv);
    const maxCx = Math.floor(maxX * inv);
    const minCy = Math.floor(minY * inv);
    const maxCy = Math.floor(maxY * inv);

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this._cells.get(packCell(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const entry = bucket[i];
          if (entry.stamp === stamp) continue;
          entry.stamp = stamp;
          const r = entry.radius;
          if (entry.x + r >= minX && entry.x - r <= maxX && entry.y + r >= minY && entry.y - r <= maxY) {
            out.push(entry.item);
          }
        }
      }
    }
    return out;
  }

  resolveSoftSeparation(agents, { defaultRadius = 16, strength = 0.5, iterations = 1 } = {}) {
    if (!Array.isArray(agents)) throw new TypeError('resolveSoftSeparation expects an array');
    if (!Number.isFinite(defaultRadius) || defaultRadius < 0) throw new RangeError('defaultRadius must be >= 0');
    if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new RangeError('strength must be in [0, 1]');
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > 8) throw new RangeError('iterations must be 1..8');

    const len = agents.length;
    if (len < 2 || strength === 0) return;
    const neighbors = this._sepScratch;

    for (let iter = 0; iter < iterations; iter++) {
      this.clear();
      let maxRadius = defaultRadius;
      for (let i = 0; i < len; i++) {
        const a = agents[i];
        if (!a || a.destroyed) continue;
        const r = Number.isFinite(a.radius) ? a.radius : defaultRadius;
        if (r > maxRadius) maxRadius = r;
        this.insert(i, a.x, a.y, r);
      }

      for (let i = 0; i < len; i++) {
        const a = agents[i];
        if (!a || a.destroyed) continue;
        const ra = Number.isFinite(a.radius) ? a.radius : defaultRadius;
        this.queryRadius(a.x, a.y, ra + maxRadius, neighbors);
        for (let k = 0; k < neighbors.length; k++) {
          const j = neighbors[k];
          if (j <= i) continue;
          const b = agents[j];
          if (!b || b.destroyed) continue;
          const rb = Number.isFinite(b.radius) ? b.radius : defaultRadius;
          const minDist = ra + rb;
          if (!(minDist > 0)) continue;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const distSq = dx * dx + dy * dy;
          if (distSq >= minDist * minDist) continue;
          let dist = Math.sqrt(distSq);
          if (dist <= 1e-6) {
            dx = (i % 2 === 0) ? 1 : -1;
            dy = 0;
            dist = 1;
          }
          const push = ((minDist - dist) * 0.5 * strength) / dist;
          const px = dx * push;
          const py = dy * push;
          a.x -= px;
          a.y -= py;
          b.x += px;
          b.y += py;
        }
      }
      neighbors.length = 0;
    }
  }
}
