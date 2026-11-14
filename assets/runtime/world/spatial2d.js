/**
 * Zero-GC-friendly ObjectPool and 2D SpatialHash2D grid for horde survivor
 * proximity queries, projectile broad-phase checks, and soft enemy separation.
 */

/**
 * @template T
 * @template {unknown[]} [A=unknown[]]
 * @typedef {object} ObjectPoolOptions
 * @property {() => T} create Factory called when the pool is empty (required).
 * @property {((item: T, ...args: A) => void) | null} [reset=null] Re-initialises an item on acquire(...args).
 * @property {number} [initialSize=0] Items pre-created at construction (integer >= 0, clamped to maxSize).
 * @property {number} [maxSize=1024] Maximum number of idle items retained (integer >= 1); extra released items are dropped.
 */

/**
 * Reusable object pool that avoids per-frame allocations.
 * @template T
 * @template {unknown[]} [A=unknown[]]
 */
export class ObjectPool {
  /** @param {ObjectPoolOptions<T, A>} [options] */
  constructor({ create, reset = null, initialSize = 0, maxSize = 1024 } = {}) {
    if (typeof create !== 'function') throw new TypeError('ObjectPool requires a create function');
    if (reset !== null && typeof reset !== 'function') throw new TypeError('ObjectPool reset must be a function');
    if (!Number.isInteger(initialSize) || initialSize < 0) throw new RangeError('initialSize must be >= 0');
    if (!Number.isInteger(maxSize) || maxSize < 1) throw new RangeError('maxSize must be >= 1');

    /** @type {() => T} */
    this._create = create;
    /** @type {((item: T, ...args: A) => void) | null} */
    this._reset = reset;
    /** @type {number} */
    this._maxSize = maxSize;
    /** @type {T[]} */
    this._free = [];
    /** @type {Set<T>} */
    this._inPool = new Set();
    /** @type {number} */
    this._activeCount = 0;

    const preload = Math.min(initialSize, maxSize);
    for (let i = 0; i < preload; i++) {
      const item = this._create();
      this._free.push(item);
      this._inPool.add(item);
    }
  }

  /** Items handed out and not yet released. @returns {number} */
  get activeCount() { return this._activeCount; }
  /** Idle items ready for reuse. @returns {number} */
  get freeCount() { return this._free.length; }

  /**
   * Take an item from the pool (or create one) and run reset(item, ...args).
   * @param {...A} args Forwarded to the reset callback.
   * @returns {T}
   */
  acquire(...args) {
    const item = /** @type {T} */ (this._free.length > 0 ? this._free.pop() : this._create());
    this._inPool.delete(item);
    this._activeCount++;
    this._reset?.(item, ...args);
    return item;
  }

  /**
   * Return an item to the pool.
   * @param {T} item
   * @returns {boolean} false for null/undefined or items already in the pool.
   */
  release(item) {
    if (item === null || item === undefined || this._inPool.has(item)) return false;
    if (this._activeCount > 0) this._activeCount--;
    if (this._free.length < this._maxSize) {
      this._free.push(item);
      this._inPool.add(item);
    }
    return true;
  }

  /** Drop all idle items and reset the active counter. @returns {void} */
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

/**
 * @typedef {object} SpatialHash2DOptions
 * @property {number} [cellSize=64] Grid cell edge length in world units (> 0).
 */

/**
 * Entry stored in a {@link SpatialHash2D}. Entries are pooled; treat as read-only.
 * @template T
 * @typedef {object} SpatialHash2DEntry
 * @property {T | null} item Stored payload (null while pooled).
 * @property {number} x Centre X in world units.
 * @property {number} y Centre Y in world units.
 * @property {number} radius Radius in world units (>= 0).
 * @property {number} stamp Internal per-query de-duplication stamp.
 */

/**
 * Agent shape accepted by SpatialHash2D#resolveSoftSeparation; x/y are mutated in place.
 * @typedef {object} SeparationAgent
 * @property {number} x X position (world units, mutated).
 * @property {number} y Y position (world units, mutated).
 * @property {number} [radius] Collision radius; falls back to defaultRadius.
 * @property {boolean} [destroyed] Skip the agent when true.
 */

/**
 * @typedef {object} SoftSeparationOptions
 * @property {number} [defaultRadius=16] Radius for agents without a finite radius (>= 0, world units).
 * @property {number} [strength=0.5] Push factor per iteration in [0, 1].
 * @property {number} [iterations=1] Relaxation passes (integer 1..8).
 */

/**
 * Uniform-grid spatial hash for circle/AABB broad-phase queries.
 * @template [T=unknown]
 */
export class SpatialHash2D {
  /** @param {SpatialHash2DOptions} [options] */
  constructor({ cellSize = 64 } = {}) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError('SpatialHash2D cellSize must be > 0');
    }
    /** Cell edge length in world units. @type {number} */
    this.cellSize = cellSize;
    /** @type {number} */
    this._invCellSize = 1 / cellSize;
    /** @type {Map<number, SpatialHash2DEntry<T>[]>} */
    this._cells = new Map();
    /** @type {SpatialHash2DEntry<T>[]} */
    this._entries = [];
    /** @type {SpatialHash2DEntry<T>[]} */
    this._entryPool = [];
    /** @type {SpatialHash2DEntry<T>[][]} */
    this._cellPool = [];
    /** @type {number} */
    this._queryId = 0;
    /** @type {number[]} */
    this._sepScratch = [];
  }

  /** Number of inserted entries. @returns {number} */
  get count() { return this._entries.length; }

  /** Remove all entries (buckets and entries are pooled for reuse). @returns {void} */
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

  /**
   * Insert an item as a circle (radius 0 = point). Rebuild each frame; there is no remove.
   * @param {T} item
   * @param {number} x Centre X (world units, finite).
   * @param {number} y Centre Y (world units, finite).
   * @param {number} [radius=0] Radius in world units (>= 0).
   * @returns {SpatialHash2DEntry<T>}
   */
  insert(item, x, y, radius = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('SpatialHash2D coordinates must be finite');
    if (!Number.isFinite(radius) || radius < 0) throw new RangeError('SpatialHash2D radius must be >= 0');

    /** @type {SpatialHash2DEntry<T>} */
    const entry = this._entryPool.length > 0 ? /** @type {SpatialHash2DEntry<T>} */ (this._entryPool.pop()) : { item: null, x: 0, y: 0, radius: 0, stamp: 0 };
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

  /**
   * Collect items whose circles overlap the query circle.
   * @param {number} x Query centre X.
   * @param {number} y Query centre Y.
   * @param {number} radius Query radius (>= 0).
   * @param {T[]} [out] Array reused for results (cleared first).
   * @returns {T[]} The out array.
   */
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
            out.push(/** @type {T} */ (entry.item));
          }
        }
      }
    }
    return out;
  }

  /**
   * Collect items whose circles overlap the axis-aligned box.
   * @param {number} minX Left bound (world units).
   * @param {number} minY Top bound (world units).
   * @param {number} maxX Right bound (world units).
   * @param {number} maxY Bottom bound (world units).
   * @param {T[]} [out] Array reused for results (cleared first).
   * @returns {T[]} The out array.
   */
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

  /**
   * Push overlapping agents apart (mutates x/y). Rebuilds the hash each iteration, indexing agents by array position.
   * @param {SeparationAgent[]} agents
   * @param {SoftSeparationOptions} [options]
   * @returns {void}
   */
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
