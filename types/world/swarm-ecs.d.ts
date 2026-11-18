/**
 * Convenience factory for {@link FlatSpatialHash2D}.
 * @param {FlatSpatialHashOptions} [options]
 * @returns {FlatSpatialHash2D}
 */
export function createFlatSpatialHash2D(options?: FlatSpatialHashOptions | undefined): FlatSpatialHash2D;
/**
 * Convenience factory for {@link FlowField2D}.
 * @param {FlowFieldOptions} [options]
 * @returns {FlowField2D}
 */
export function createFlowField2D(options?: FlowFieldOptions | undefined): FlowField2D;
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
 * @property {Uint16Array} cellDensity Live unit count per spatial grid cell.
 * @property {Int32Array} activeIds Contiguous slice `[0 .. count - 1]` of live unit IDs.
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
export function createSwarmSimulation({ capacity, promoteRadius, demoteRadius, separationRadius, separationStrength, nearSeparationRadius, midSeparationRadius, maxNeighbors, flowInterval, ecsSlots, maxPatchesPerStep, gridCols, gridRows, cellSize, originX, originY, useFlowField, flashDuration, }?: SwarmSimulationOptions | undefined): SwarmSimulation;
/** Bit flags stored in `swarm.unitFlags[id]`. */
export const SWARM_UNIT_FLAGS: Readonly<{
    NONE: 0;
    ALIVE: number;
    ECS_CLAIMED: number;
    FLASHING: number;
}>;
/** Bit flags stored in `ecs.flags[slot]`. */
export const ECS_SLOT_FLAGS: Readonly<{
    NONE: 0;
    ACTIVE: number;
    DEAD: number;
    FROZEN: number;
    KNOCKBACK: number;
    DIRTY: number;
}>;
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
    constructor({ cols, rows, cellSize, originX, originY, capacity, }?: FlatSpatialHashOptions | undefined);
    cols: number;
    rows: number;
    cellSize: number;
    invCellSize: number;
    originX: number;
    originY: number;
    capacity: number;
    head: Int32Array;
    next: Int32Array;
    /** Reset all bucket heads to empty (`-1`). @returns {void} */
    clear(): void;
    /**
     * Maps a world coordinate to a clamped flat cell index.
     * @param {number} x
     * @param {number} y
     * @returns {number}
     */
    cellIndex(x: number, y: number): number;
    /**
     * Inserts `id` into the cell containing `(x, y)`.
     * @param {number} id Entity ID (`0 <= id < capacity`).
     * @param {number} x
     * @param {number} y
     * @returns {number} Cell index written, or `-1` if `id` is out of range.
     */
    insert(id: number, x: number, y: number): number;
    /**
     * Rebuilds the entire spatial hash directly from SoA position arrays.
     * @param {ArrayLike<number>} unitFlags Per-unit flag array.
     * @param {ArrayLike<number>} posX Per-unit X array.
     * @param {ArrayLike<number>} posY Per-unit Y/Z array.
     * @param {number} [maxIndex] Exclusive upper bound (defaults to `Math.min(unitFlags.length, capacity)`).
     * @param {number} [activeMask=1] Bitmask required to include an entity.
     * @returns {number} Count of inserted units.
     */
    rebuildFromArrays(unitFlags: ArrayLike<number>, posX: ArrayLike<number>, posY: ArrayLike<number>, maxIndex?: number | undefined, activeMask?: number | undefined): number;
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
    queryRadiusIds(x: number, y: number, radius: number, outIds: Int32Array | number[], maxResults?: number | undefined, posX?: ArrayLike<number> | null | undefined, posY?: ArrayLike<number> | null | undefined, selfId?: number | undefined): number;
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
    constructor({ cols, rows, cellSize, originX, originY, }?: FlowFieldOptions | undefined);
    cols: number;
    rows: number;
    cellSize: number;
    invCellSize: number;
    originX: number;
    originY: number;
    cost: Uint8Array;
    dist: Float32Array;
    dirX: Float32Array;
    dirY: Float32Array;
    rg8: Uint8Array;
    _queue: Int32Array;
    _inQueue: Uint8Array;
    _hasComputed: boolean;
    _computeVersion: number;
    /** Clears all terrain costs back to uniform `1`. @returns {void} */
    clearWalls(): void;
    /**
     * Sets traversal cost for cell `(cx, cy)` (`1..254` passable weight, `255` = solid wall).
     * @param {number} cx
     * @param {number} cy
     * @param {number} costValue
     * @returns {boolean}
     */
    setCost(cx: number, cy: number, costValue: number): boolean;
    /**
     * Marks an axis-aligned world-space rectangle with traversal `costValue` (`255` = wall).
     * @param {number} minX
     * @param {number} minY
     * @param {number} maxX
     * @param {number} maxY
     * @param {number} [costValue=255]
     * @returns {void}
     */
    setObstacleRect(minX: number, minY: number, maxX: number, maxY: number, costValue?: number | undefined): void;
    /**
     * Populates solid walls (`cost = 255`) from an HGame `TileMap`.
     * @param {{ width: number, height: number, tileWidth: number, tileHeight: number, worldToTile: (x: number, y: number, out?: { x: number, y: number }) => { x: number, y: number }, isSolid: (tx: number, ty: number) => boolean }} tileMap
     * @param {FlowFieldTileMapOptions} [options]
     * @returns {void}
     */
    setWallsFromTileMap(tileMap: {
        width: number;
        height: number;
        tileWidth: number;
        tileHeight: number;
        worldToTile: (x: number, y: number, out?: {
            x: number;
            y: number;
        } | undefined) => {
            x: number;
            y: number;
        };
        isSolid: (tx: number, ty: number) => boolean;
    }, { worldOriginX, worldOriginY }?: FlowFieldTileMapOptions | undefined): void;
    /**
     * Recomputes distance integration and direction vectors toward one or more goals.
     * @param {FlowFieldGoal | readonly FlowFieldGoal[]} goals
     * @returns {void}
     */
    compute(goals: FlowFieldGoal | readonly FlowFieldGoal[]): void;
    /**
     * Bilinearly samples a normalized flow direction vector at world `(x, y)`.
     * @param {number} x
     * @param {number} y
     * @param {{ x: number, y: number }} [out] Optional output object reused to avoid GC.
     * @returns {{ x: number, y: number }}
     */
    sample(x: number, y: number, out?: {
        x: number;
        y: number;
    } | undefined): {
        x: number;
        y: number;
    };
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
    constructor({ maxSlots, maxHitEvents, swarmCapacity, }?: FlatCombatECSOptions | undefined);
    maxSlots: number;
    maxHitEvents: number;
    swarmCapacity: number;
    flags: Uint32Array;
    swarmUnitId: Int32Array;
    posX: Float32Array;
    posY: Float32Array;
    velX: Float32Array;
    velY: Float32Array;
    rot: Float32Array;
    hp: Int32Array;
    maxHp: Int32Array;
    shield: Int32Array;
    freezeTimer: Float32Array;
    flashTicks: Uint8Array;
    statusCode: Uint8Array;
    clipId: Uint16Array;
    swarmToSlot: Int32Array;
    _freeStack: Int32Array;
    _freeTop: number;
    _activeCount: number;
    _scanLimit: number;
    _slotGeneration: Uint32Array;
    _hitTargetSlot: Int32Array;
    _hitGeneration: Uint32Array;
    _hitDamage: Int32Array;
    _hitPushX: Float32Array;
    _hitPushY: Float32Array;
    _hitFreeze: Float32Array;
    _hitCount: number;
    /** Optional internal callback invoked when a swarm unit is promoted. @type {((swarmId: number, slot: number) => void) | null} */
    _onPromote: ((swarmId: number, slot: number) => void) | null;
    /** Active promoted slot count. @returns {number} */
    get activeCount(): number;
    /** @returns {void} */
    _trimScanLimit(): void;
    /**
     * Looks up an active ECS slot by external swarm unit ID, or returns `-1`.
     * @param {number} swarmId
     * @returns {number}
     */
    getSlotBySwarmId(swarmId: number): number;
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
    promoteSwarmUnit(swarmId: number, x: number, y: number, rot?: number | undefined, hp?: number | undefined, clipId?: number | undefined, shield?: number | undefined): number;
    /**
     * Enqueues an isolated one-way combat hit event to be resolved cleanly in {@link FlatCombatECS#damageResolutionSystem}.
     * @param {number} slot
     * @param {number} damage
     * @param {number} [pushX=0]
     * @param {number} [pushY=0]
     * @param {number} [freezeDuration=0]
     * @returns {boolean}
     */
    enqueueHit(slot: number, damage: number, pushX?: number | undefined, pushY?: number | undefined, freezeDuration?: number | undefined): boolean;
    /** Resolves all queued hit events (shield absorption, HP, knockback, freeze, dead flag). @returns {number} */
    damageResolutionSystem(): number;
    /**
     * Integrates freeze timers and frame-rate-independent knockback damping.
     * @param {number} dt Seconds (> 0).
     * @returns {void}
     */
    kinematicsSystem(dt: number): void;
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
    flushPatchesAndCleanup(heroX: number, heroY: number, demoteRadius?: number | undefined, maxPatches?: number | undefined, onPatch?: ((patch: FlatCombatPatch) => void) | null | undefined, onUnitKilled?: ((swarmId: number, x: number, y: number) => void) | null | undefined): FlatCombatCleanupStats;
    /** Clears all ECS slots and pending hit events. @returns {void} */
    clear(): void;
}
export type SwarmSimulationOptions = {
    /**
     * Maximum swarm units (`1..262144`).
     */
    capacity?: number | undefined;
    /**
     * Radius around hero auto-claiming fine ECS slots.
     */
    promoteRadius?: number | undefined;
    /**
     * Hysteresis radius releasing idle ECS slots back to autonomous swarm.
     */
    demoteRadius?: number | undefined;
    /**
     * Neighbor soft-push separation radius.
     */
    separationRadius?: number | undefined;
    /**
     * Neighbor push strength (units/s).
     */
    separationStrength?: number | undefined;
    /**
     * Distance within focus executing full 60Hz neighbor separation.
     */
    nearSeparationRadius?: number | undefined;
    /**
     * Outer distance running 4-frame staggered separation (cached `sepX`/`sepY`); beyond uses flow + cell density damping.
     */
    midSeparationRadius?: number | undefined;
    /**
     * Hard cap on neighbor checks per unit per step.
     */
    maxNeighbors?: number | undefined;
    /**
     * Flow Field update interval in seconds; unchanged goal cell and costs reuse the previous field (`<= 0` recomputes every step).
     */
    flowInterval?: number | undefined;
    /**
     * Fixed ECS slot budget inside proximity ring.
     */
    ecsSlots?: number | undefined;
    /**
     * Max ECS patches flushed per step.
     */
    maxPatchesPerStep?: number | undefined;
    /**
     * Spatial hash & Flow Field column count.
     */
    gridCols?: number | undefined;
    /**
     * Spatial hash & Flow Field row count.
     */
    gridRows?: number | undefined;
    /**
     * Cell size in world units.
     */
    cellSize?: number | undefined;
    /**
     * World X minimum corner.
     */
    originX?: number | undefined;
    /**
     * World Y/Z minimum corner.
     */
    originY?: number | undefined;
    /**
     * When false, units steer directly toward `(heroX, heroY)`.
     */
    useFlowField?: boolean | undefined;
    /**
     * Hit-flash decay duration in seconds.
     */
    flashDuration?: number | undefined;
};
export type SwarmSpawnOptions = {
    x?: number | undefined;
    y?: number | undefined;
    rot?: number | undefined;
    speed?: number | undefined;
    scale?: number | undefined;
    hp?: number | undefined;
    clipId?: number | undefined;
    animTime?: number | undefined;
};
export type SwarmWaveSpawnOptions = {
    /**
     * Number of units to spawn.
     */
    count?: number | undefined;
    /**
     * Ring center X.
     */
    centerX?: number | undefined;
    /**
     * Ring center Y/Z.
     */
    centerY?: number | undefined;
    /**
     * Inner ring radius.
     */
    minRadius?: number | undefined;
    /**
     * Outer ring radius.
     */
    maxRadius?: number | undefined;
    /**
     * Movement speed (world units/sec).
     */
    speed?: number | undefined;
    /**
     * Initial hit points.
     */
    hp?: number | undefined;
    /**
     * Clip index.
     */
    clipId?: number | undefined;
    /**
     * Instance scale.
     */
    scale?: number | undefined;
    /**
     * Deterministic LCG seed (optional).
     */
    seed?: number | null | undefined;
};
export type SwarmCircleDamageOptions = {
    x?: number | undefined;
    y?: number | undefined;
    radius?: number | undefined;
    damage?: number | undefined;
    knockback?: number | undefined;
    freezeDuration?: number | undefined;
    flashDuration?: number | undefined;
};
export type SwarmStepOptions = {
    heroX?: number | undefined;
    heroY?: number | undefined;
    /**
     * Optional focal X for 3-tier LOD separation (defaults to `heroX`).
     */
    focusX?: number | undefined;
    /**
     * Optional focal Y/Z for 3-tier LOD separation (defaults to `heroY`).
     */
    focusY?: number | undefined;
    onUnitKilled?: ((swarmId: number, x: number, y: number) => void) | null | undefined;
};
export type SwarmStepStats = {
    /**
     * Total live swarm units.
     */
    activeCount: number;
    /**
     * Live units currently owning an ECS slot.
     */
    ecsActiveCount: number;
    /**
     * Units promoted to ECS this step.
     */
    promotedThisStep: number;
    /**
     * Units killed this step.
     */
    killedThisStep: number;
    /**
     * ECS-to-swarm patches synced this step.
     */
    patchesApplied: number;
};
export type SwarmSyncCrowd2DOptions = {
    /**
     * Write `rot` into `crowd.rotation`.
     */
    syncRotation?: boolean | undefined;
    /**
     * Flip `crowd.flipX` based on `sin(rot) < 0`.
     */
    flipByDirection?: boolean | undefined;
    /**
     * SpriteSheet frame count per clip (`> 1` animates `crowd.frame`).
     */
    frameCount?: number | undefined;
    /**
     * Sprite animation frames per second.
     */
    animFps?: number | undefined;
    /**
     * Force copying per-unit SoA arrays into `crowd2d` (by default `bindSwarm` connects zero-copy).
     */
    copyArrays?: boolean | undefined;
};
export type SwarmSimulation = {
    capacity: number;
    /**
     * Getter; live swarm count.
     */
    count: number;
    unitFlags: Uint8Array;
    posX: Float32Array;
    posY: Float32Array;
    rot: Float32Array;
    speed: Float32Array;
    scale: Float32Array;
    hp: Int32Array;
    animClip: Uint16Array;
    animTime: Float32Array;
    flash: Float32Array;
    /**
     * Cached neighbor separation X vector per unit.
     */
    sepX: Float32Array;
    /**
     * Cached neighbor separation Y/Z vector per unit.
     */
    sepY: Float32Array;
    /**
     * Live unit count per spatial grid cell.
     */
    cellDensity: Uint16Array;
    /**
     * Contiguous slice `[0 .. count - 1]` of live unit IDs.
     */
    activeIds: Int32Array;
    chunkCols: number;
    chunkRows: number;
    /**
     * Per-chunk intrusive head index (`-1` = empty).
     */
    chunkHead: Int32Array;
    /**
     * Per-unit next index inside its chunk list.
     */
    chunkNext: Int32Array;
    /**
     * Unit count per chunk.
     */
    chunkCount: Uint32Array;
    /**
     * Tight minimum X per non-empty chunk.
     */
    chunkMinX: Float32Array;
    /**
     * Tight maximum X per non-empty chunk.
     */
    chunkMaxX: Float32Array;
    /**
     * Tight minimum Y/Z per non-empty chunk.
     */
    chunkMinY: Float32Array;
    /**
     * Tight maximum Y/Z per non-empty chunk.
     */
    chunkMaxY: Float32Array;
    /**
     * Rebuilds coarse chunk lists & tight bounds when dirty.
     */
    ensureChunks: () => void;
    spatialHash: FlatSpatialHash2D;
    flowField: FlowField2D;
    ecs: FlatCombatECS;
    spawn: (options?: SwarmSpawnOptions) => number;
    spawnWave: (options?: SwarmWaveSpawnOptions) => number;
    kill: (id: number) => boolean;
    clear: () => void;
    /**
     * Number of hit events accepted into the bounded combat queue.
     */
    applyCircleDamage: (options?: SwarmCircleDamageOptions) => number;
    step: (dt: number, options?: SwarmStepOptions) => SwarmStepStats;
    syncToSpriteCrowd2D: (crowd2d: import("../integrations/canvas2d.js").SpriteCrowd2D, options?: SwarmSyncCrowd2DOptions) => number;
};
export type FlatSpatialHashOptions = {
    /**
     * Grid column count (integer >= 1).
     */
    cols?: number | undefined;
    /**
     * Grid row count (integer >= 1).
     */
    rows?: number | undefined;
    /**
     * Cell edge length in world units (> 0).
     */
    cellSize?: number | undefined;
    /**
     * World X of cell (0, 0) minimum corner.
     */
    originX?: number | undefined;
    /**
     * World Y (or Z in 3D) of cell (0, 0) minimum corner.
     */
    originY?: number | undefined;
    /**
     * Maximum entity ID supported (`0..capacity - 1`).
     */
    capacity?: number | undefined;
};
export type FlowFieldOptions = {
    /**
     * Field grid columns (integer >= 2).
     */
    cols?: number | undefined;
    /**
     * Field grid rows (integer >= 2).
     */
    rows?: number | undefined;
    /**
     * Cell edge length in world units (> 0).
     */
    cellSize?: number | undefined;
    /**
     * World X of grid minimum corner.
     */
    originX?: number | undefined;
    /**
     * World Y/Z of grid minimum corner.
     */
    originY?: number | undefined;
};
export type FlowFieldGoal = {
    /**
     * Goal world X.
     */
    x: number;
    /**
     * Goal world Y/Z.
     */
    y: number;
};
export type FlowFieldTileMapOptions = {
    /**
     * World X of the TileMap origin (0, 0).
     */
    worldOriginX?: number | undefined;
    /**
     * World Y/Z of the TileMap origin (0, 0).
     */
    worldOriginY?: number | undefined;
};
export type FlatCombatECSOptions = {
    /**
     * Preallocated ECS slots (integer >= 1).
     */
    maxSlots?: number | undefined;
    /**
     * Preallocated hit-event capacity (integer >= 1).
     */
    maxHitEvents?: number | undefined;
    /**
     * Maximum external swarm unit ID (`0..swarmCapacity - 1`).
     */
    swarmCapacity?: number | undefined;
};
export type FlatCombatPatch = {
    swarmId: number;
    slot: number;
    x: number;
    y: number;
    rot: number;
    hp: number;
    clipId: number;
    isDead: boolean;
    isDemoted: boolean;
    stillClaimed: boolean;
};
export type FlatCombatCleanupStats = {
    /**
     * Patches emitted this flush.
     */
    patchesEmitted: number;
    /**
     * Pending dead/demoted/dirty slots held for the next flush when `maxPatches` was hit.
     */
    pendingRemaining: number;
    /**
     * Remaining active ECS slots.
     */
    activeSlots: number;
};
