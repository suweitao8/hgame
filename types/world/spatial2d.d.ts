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
export class ObjectPool<T, A extends unknown[] = unknown[]> {
    /** @param {ObjectPoolOptions<T, A>} [options] */
    constructor({ create, reset, initialSize, maxSize }?: ObjectPoolOptions<T, A> | undefined);
    /** @type {() => T} */
    _create: () => T;
    /** @type {((item: T, ...args: A) => void) | null} */
    _reset: ((item: T, ...args: A) => void) | null;
    /** @type {number} */
    _maxSize: number;
    /** @type {T[]} */
    _free: T[];
    /** @type {Set<T>} */
    _inPool: Set<T>;
    /** @type {number} */
    _activeCount: number;
    /** Items handed out and not yet released. @returns {number} */
    get activeCount(): number;
    /** Idle items ready for reuse. @returns {number} */
    get freeCount(): number;
    /**
     * Take an item from the pool (or create one) and run reset(item, ...args).
     * @param {...A} args Forwarded to the reset callback.
     * @returns {T}
     */
    acquire(...args: A[]): T;
    /**
     * Return an item to the pool.
     * @param {T} item
     * @returns {boolean} false for null/undefined or items already in the pool.
     */
    release(item: T): boolean;
    /** Drop all idle items and reset the active counter. @returns {void} */
    clear(): void;
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
/** @template T @typedef {{item: T | null, t: number, x: number, y: number}} SpatialSegmentHit */
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
export class SpatialHash2D<T = unknown> {
    /** @param {SpatialHash2DOptions} [options] */
    constructor({ cellSize }?: SpatialHash2DOptions | undefined);
    /** Cell edge length in world units. @type {number} */
    cellSize: number;
    /** @type {number} */
    _invCellSize: number;
    /** @type {Map<number, SpatialHash2DEntry<T>[]>} */
    _cells: Map<number, SpatialHash2DEntry<T>[]>;
    /** @type {SpatialHash2DEntry<T>[]} */
    _entries: SpatialHash2DEntry<T>[];
    /** @type {SpatialHash2DEntry<T>[]} */
    _entryPool: SpatialHash2DEntry<T>[];
    /** @type {SpatialHash2DEntry<T>[][]} */
    _cellPool: SpatialHash2DEntry<T>[][];
    /** @type {number} */
    _queryId: number;
    /** @type {number[]} */
    _sepScratch: number[];
    /** Number of inserted entries. @returns {number} */
    get count(): number;
    /** Remove all entries (buckets and entries are pooled for reuse). @returns {void} */
    clear(): void;
    /**
     * Insert an item as a circle (radius 0 = point). Rebuild each frame; there is no remove.
     * @param {T} item
     * @param {number} x Centre X (world units, finite).
     * @param {number} y Centre Y (world units, finite).
     * @param {number} [radius=0] Radius in world units (>= 0).
     * @returns {SpatialHash2DEntry<T>}
     */
    insert(item: T, x: number, y: number, radius?: number | undefined): SpatialHash2DEntry<T>;
    /**
     * Collect items whose circles overlap the query circle.
     * @param {number} x Query centre X.
     * @param {number} y Query centre Y.
     * @param {number} radius Query radius (>= 0).
     * @param {T[]} [out] Array reused for results (cleared first).
     * @returns {T[]} The out array.
     */
    queryRadius(x: number, y: number, radius: number, out?: T[] | undefined): T[];
    /**
     * Collect items whose circles overlap the axis-aligned box.
     * @param {number} minX Left bound (world units).
     * @param {number} minY Top bound (world units).
     * @param {number} maxX Right bound (world units).
     * @param {number} maxY Bottom bound (world units).
     * @param {T[]} [out] Array reused for results (cleared first).
     * @returns {T[]} The out array.
     */
    queryAABB(minX: number, minY: number, maxX: number, maxY: number, out?: T[] | undefined): T[];
    /**
     * Return the first circle touched by a segment or capsule sweep.
     * @param {number} x0 Start X.
     * @param {number} y0 Start Y.
     * @param {number} x1 End X.
     * @param {number} y1 End Y.
     * @param {number} [padding=0] Sweep radius in world units.
     * @param {SpatialSegmentHit<T>} [out] Reusable hit result.
     * @returns {SpatialSegmentHit<T> | null} Hit with `t` in [0, 1], or null. A miss leaves `out` unchanged.
     */
    castSegment(x0: number, y0: number, x1: number, y1: number, padding?: number | undefined, out?: SpatialSegmentHit<T> | undefined): SpatialSegmentHit<T> | null;
    /**
     * Push overlapping agents apart (mutates x/y). Rebuilds the hash each iteration, indexing agents by array position.
     * @param {SeparationAgent[]} agents
     * @param {SoftSeparationOptions} [options]
     * @returns {void}
     */
    resolveSoftSeparation(agents: SeparationAgent[], { defaultRadius, strength, iterations }?: SoftSeparationOptions | undefined): void;
}
export type ObjectPoolOptions<T, A extends unknown[] = unknown[]> = {
    /**
     * Factory called when the pool is empty (required).
     */
    create: () => T;
    /**
     * Re-initialises an item on acquire(...args).
     */
    reset?: ((item: T, ...args: A) => void) | null | undefined;
    /**
     * Items pre-created at construction (integer >= 0, clamped to maxSize).
     */
    initialSize?: number | undefined;
    /**
     * Maximum number of idle items retained (integer >= 1); extra released items are dropped.
     */
    maxSize?: number | undefined;
};
export type SpatialHash2DOptions = {
    /**
     * Grid cell edge length in world units (> 0).
     */
    cellSize?: number | undefined;
};
/**
 * Entry stored in a {@link SpatialHash2D}. Entries are pooled; treat as read-only.
 */
export type SpatialHash2DEntry<T> = {
    /**
     * Stored payload (null while pooled).
     */
    item: T | null;
    /**
     * Centre X in world units.
     */
    x: number;
    /**
     * Centre Y in world units.
     */
    y: number;
    /**
     * Radius in world units (>= 0).
     */
    radius: number;
    /**
     * Internal per-query de-duplication stamp.
     */
    stamp: number;
};
export type SpatialSegmentHit<T> = {
    item: T | null;
    t: number;
    x: number;
    y: number;
};
/**
 * Agent shape accepted by SpatialHash2D#resolveSoftSeparation; x/y are mutated in place.
 */
export type SeparationAgent = {
    /**
     * X position (world units, mutated).
     */
    x: number;
    /**
     * Y position (world units, mutated).
     */
    y: number;
    /**
     * Collision radius; falls back to defaultRadius.
     */
    radius?: number | undefined;
    /**
     * Skip the agent when true.
     */
    destroyed?: boolean | undefined;
};
export type SoftSeparationOptions = {
    /**
     * Radius for agents without a finite radius (>= 0, world units).
     */
    defaultRadius?: number | undefined;
    /**
     * Push factor per iteration in [0, 1].
     */
    strength?: number | undefined;
    /**
     * Relaxation passes (integer 1..8).
     */
    iterations?: number | undefined;
};
