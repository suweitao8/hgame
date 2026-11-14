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
export function createWorldPartition(options?: WorldPartitionOptions): WorldPartition;
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
export function createHLODProxyGroup3D(THREE: ThreeNamespace, { parent, proxies, castShadow, receiveShadow, defaultColor, }?: HLODProxyGroupOptions): HLODProxyGroup3D;
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
export function createFloatingOrigin({ threshold, snapGrid, verticalShift, syncPhysics, onShift, }?: FloatingOriginOptions): FloatingOrigin;
/**
 * Three-component position: [x, y, z] or { x, y, z } (missing components default to 0).
 */
export type Vec3Input = readonly number[] | {
    x?: number;
    y?: number;
    z?: number;
};
export type Vec3Tuple = [number, number, number];
/**
 * Immutable description of a partition cell passed to callbacks.
 */
export type WorldCellDescriptor = {
    /**
     * Cell column index (world X / cellSize, floored).
     */
    cx: number;
    /**
     * Cell row index: world Y in 2d and vertical modes, world Z in horizontal 3d mode.
     */
    cy: number;
    /**
     * Vertical cell index (only non-zero when verticalCells is enabled).
     */
    cz: number;
    /**
     * Unique key, "cx,cy" or "cx,cy,cz" (vertical mode).
     */
    key: string;
    /**
     * Minimum world corner [x, y, z] (units).
     */
    min: Vec3Tuple;
    /**
     * Maximum world corner [x, y, z] (units).
     */
    max: Vec3Tuple;
    /**
     * World-space centre [x, y, z] (units).
     */
    center: Vec3Tuple;
    /**
     * Cell edge length (world units).
     */
    cellSize: number;
};
/**
 * Lifecycle state of a tracked cell.
 */
export type WorldCellState = "unloaded" | "loading" | "loaded" | "hlod";
export type WorldPartitionOptions = {
    /**
     * Cell edge length in world units (> 0).
     */
    cellSize?: number;
    /**
     * '2d' partitions X/Y; '3d' partitions X/Z (or X/Y/Z with verticalCells).
     */
    dimension?: "2d" | "3d";
    /**
     * Also partition the Y axis in 3d mode.
     */
    verticalCells?: boolean;
    /**
     * Distance (world units) to the cell AABB within which cells are loaded (>= 0).
     */
    loadRadius?: number;
    /**
     * Hysteresis radius before loaded cells unload (>= loadRadius). Default max(loadRadius * 1.25, loadRadius + 32).
     */
    unloadRadius?: number;
    /**
     * Distance within which HLOD proxies are built (needs createHLOD).
     */
    hlodRadius?: number;
    /**
     * Hysteresis radius for dropping HLOD proxies. Default max(hlodRadius * 1.15, unloadRadius).
     */
    hlodUnloadRadius?: number;
    /**
     * Seconds of viewer velocity added to the load-priority focus point.
     */
    lookaheadSeconds?: number;
    /**
     * Clamp for the lookahead offset (world units). Default cellSize * 1.5.
     */
    maxLookaheadDistance?: number;
    /**
     * Maximum cell loads started per step().
     */
    maxLoadsPerStep?: number;
    /**
     * Maximum unloads (and HLOD drops) per step().
     */
    maxUnloadsPerStep?: number;
    /**
     * Maximum HLOD proxy builds per step().
     */
    maxHlodBuildsPerStep?: number;
    /**
     * Return false to ignore a cell entirely.
     */
    cellFilter?: ((desc: WorldCellDescriptor) => boolean) | null;
    /**
     * Load a cell; may return data or a Promise of data. Without it cells become loaded immediately.
     */
    loadCell?: ((desc: WorldCellDescriptor) => unknown) | null;
    /**
     * Release the data returned by loadCell.
     */
    unloadCell?: ((desc: WorldCellDescriptor, data: unknown) => void) | null;
    /**
     * Build a distant proxy for a cell; returned value is passed to destroyHLOD.
     */
    createHLOD?: ((desc: WorldCellDescriptor) => unknown) | null;
    /**
     * Dispose a proxy built by createHLOD.
     */
    destroyHLOD?: ((desc: WorldCellDescriptor, hlodData: unknown) => void) | null;
};
export type WorldPartitionStepSummary = {
    /**
     * Cells whose load completed synchronously this step.
     */
    loaded: number;
    /**
     * Loaded cells unloaded this step.
     */
    unloaded: number;
    /**
     * HLOD proxies built this step.
     */
    hlodCreated: number;
    /**
     * HLOD proxies destroyed this step.
     */
    hlodDestroyed: number;
    /**
     * Cells currently in the asynchronous 'loading' state.
     */
    inFlight: number;
};
export type WorldPartitionStats = {
    /**
     * Cells in 'loaded' state.
     */
    loaded: number;
    /**
     * Cells in 'loading' state.
     */
    loading: number;
    /**
     * Cells showing an HLOD proxy.
     */
    hlod: number;
    /**
     * Number of pinned cell keys.
     */
    pinned: number;
    /**
     * Total tracked cell records.
     */
    tracked: number;
};
export type WorldCellBounds = {
    /**
     * Minimum corner [x, y, z].
     */
    min: Vec3Tuple;
    /**
     * Maximum corner [x, y, z].
     */
    max: Vec3Tuple;
    /**
     * Centre [x, y, z].
     */
    center: Vec3Tuple;
};
export type WorldPartition = {
    /**
     * Cell edge length (world units, read-only).
     */
    cellSize: number;
    /**
     * Load radius (world units, read-only).
     */
    loadRadius: number;
    /**
     * Unload radius (world units, read-only).
     */
    unloadRadius: number;
    /**
     * HLOD radius (world units, read-only).
     */
    hlodRadius: number;
    /**
     * Snapshot of current cell counts (getter).
     */
    stats: WorldPartitionStats;
    /**
     * Cell indices containing a world position.
     */
    worldToCell: (x?: number, y?: number, z?: number) => {
        cx: number;
        cy: number;
        cz: number;
        key: string;
    };
    /**
     * World-space bounds of a cell.
     */
    cellBounds: (cx: number, cy: number, cz?: number) => WorldCellBounds;
    /**
     * Force a cell to stay loaded.
     */
    pinCell: (cx: number, cy: number, cz?: number) => void;
    /**
     * Release a pin.
     */
    unpinCell: (cx: number, cy: number, cz?: number) => void;
    /**
     * Advance streaming within per-step budgets.
     */
    step: (viewerPos?: Vec3Input, viewerVel?: Vec3Input) => WorldPartitionStepSummary;
    /**
     * Like step() but ignoring budgets.
     */
    forceFlush: (viewerPos?: Vec3Input, viewerVel?: Vec3Input) => WorldPartitionStepSummary;
    /**
     * Current state ('unloaded' when untracked).
     */
    getCellState: (cx: number, cy: number, cz?: number) => WorldCellState;
    /**
     * Data returned by loadCell, or null.
     */
    getCellData: (cx: number, cy: number, cz?: number) => unknown;
    /**
     * Descriptors of loaded cells.
     */
    getLoadedCells: () => WorldCellDescriptor[];
    /**
     * Descriptors of cells showing HLOD proxies.
     */
    getHlodCells: () => WorldCellDescriptor[];
    /**
     * Unload everything and forget all cells.
     */
    clear: () => void;
};
/**
 * Opaque Three.js namespace (or subset) injected by the caller; this module never imports 'three'.
 */
export type ThreeNamespace = Record<string, unknown>;
/**
 * One static proxy instance. Rotation is Euler XYZ radians.
 */
export type HLODProxyDescriptor = {
    /**
     * THREE.BufferGeometry; defaults to a shared unit box.
     */
    geometry?: unknown;
    /**
     * THREE.Material; defaults to a shared standard material.
     */
    material?: unknown;
    /**
     * Position X (world units).
     */
    x?: number;
    /**
     * Position Y (world units).
     */
    y?: number;
    /**
     * Position Z (world units).
     */
    z?: number;
    /**
     * Rotation X (radians).
     */
    rx?: number;
    /**
     * Rotation Y (radians).
     */
    ry?: number;
    /**
     * Rotation Z (radians).
     */
    rz?: number;
    /**
     * Scale X.
     */
    sx?: number;
    /**
     * Scale Y.
     */
    sy?: number;
    /**
     * Scale Z.
     */
    sz?: number;
    /**
     * Per-instance colour accepted by THREE.Color#set.
     */
    color?: number | string;
};
/**
 * Minimal Object3D-like parent (e.g. THREE.Scene or THREE.Group).
 */
export type HLODParentLike = {
    add: (child: unknown) => unknown;
};
export type HLODProxyGroupOptions = {
    /**
     * Parent the proxy group is added to.
     */
    parent?: HLODParentLike | null;
    /**
     * Proxy instances to batch.
     */
    proxies?: HLODProxyDescriptor[];
    /**
     * Instanced meshes cast shadows.
     */
    castShadow?: boolean;
    /**
     * Instanced meshes receive shadows.
     */
    receiveShadow?: boolean;
    /**
     * Colour (0xRRGGBB) of the fallback material.
     */
    defaultColor?: number;
};
export type HLODProxyGroup3D = {
    /**
     * THREE.Group containing one InstancedMesh per geometry/material pair.
     */
    group: unknown;
    /**
     * Number of InstancedMesh batches (getter).
     */
    drawCallCount: number;
    /**
     * Number of proxy instances (getter).
     */
    instanceCount: number;
    /**
     * Remove from parent and free resources; false if already disposed.
     */
    dispose: () => boolean;
};
export type FloatingOriginShiftPayload = {
    /**
     * Shift applied on X (world units).
     */
    dx: number;
    /**
     * Shift applied on Y (world units).
     */
    dy: number;
    /**
     * Shift applied on Z (world units).
     */
    dz: number;
    /**
     * New accumulated global origin [x, y, z] (Float64 values).
     */
    origin: Vec3Tuple;
    /**
     * Total number of shifts so far.
     */
    shiftCount: number;
};
export type FloatingOriginOptions = {
    /**
     * Local distance (world units, > 0) from origin that triggers a rebase.
     */
    threshold?: number;
    /**
     * Shifts are rounded to multiples of this (>= 0; 0 disables snapping).
     */
    snapGrid?: number;
    /**
     * Include the Y axis in distance checks and shifts.
     */
    verticalShift?: boolean;
    /**
     * Call scene.physics.setPosition for shifted entities.
     */
    syncPhysics?: boolean;
    /**
     * Called after each shift.
     */
    onShift?: ((payload: FloatingOriginShiftPayload) => void) | null;
};
/**
 * Result of FloatingOrigin#update.
 */
export type FloatingOriginUpdateResult = {
    /**
     * True when the origin moved.
     */
    shifted: boolean;
    dx: number;
    dy: number;
    dz: number;
    /**
     * Global origin [x, y, z].
     */
    origin: Vec3Tuple;
    shiftCount: number;
};
/**
 * Scene-like object whose root entities are shifted (core Scene).
 */
export type FloatingOriginSceneLike = {
    /**
     * Root entities.
     */
    objects?: ArrayLike<{
        x: number;
        y: number;
        z: number;
        destroyed?: boolean;
    }>;
    physics?: {
        setPosition?: (entity: object, pos: {
            x: number;
            y: number;
            z: number;
        }) => void;
        get?: (entity: object) => unknown;
    };
};
export type FloatingOrigin = {
    /**
     * Copy of the accumulated global origin (getter).
     */
    origin: Vec3Tuple;
    /**
     * Number of rebases performed (getter).
     */
    shiftCount: number;
    /**
     * Global to local coordinates; writes into out.
     */
    worldToLocal: (wx?: number, wy?: number, wz?: number, out?: number[]) => number[];
    /**
     * Local to global coordinates; writes into out.
     */
    localToWorld: (lx?: number, ly?: number, lz?: number, out?: number[]) => number[];
    /**
     * Shift this scene's root entities on rebase.
     */
    registerScene: (scene: FloatingOriginSceneLike) => void;
    unregisterScene: (scene: FloatingOriginSceneLike) => void;
    /**
     * Shift a Three.js Object3D on rebase.
     */
    registerObject3D: (obj: {
        position: {
            x: number;
            y: number;
            z: number;
        };
        updateMatrixWorld?: (force?: boolean) => void;
    }) => void;
    unregisterObject3D: (obj: unknown) => void;
    /**
     * Shift an irradiance probe volume (receives negated deltas).
     */
    registerProbeVolume: (vol: {
        shiftOrigin?: (dx: number, dy: number, dz: number) => void;
    }) => void;
    unregisterProbeVolume: (vol: unknown) => void;
    /**
     * Shift a world-aligned material palette.
     */
    registerWorldMaterialPalette: (palette: {
        shiftOffset?: (dx: number, dy: number, dz: number) => void;
    }) => void;
    unregisterWorldMaterialPalette: (palette: unknown) => void;
    /**
     * Shift a world-aligned material offset uniform.
     */
    registerWorldMaterial: (mat: {
        userData?: Record<string, unknown>;
    }) => void;
    unregisterWorldMaterial: (mat: unknown) => void;
    /**
     * Subscribe to shifts; returns an unsubscribe function.
     */
    onDidShift: (cb: (payload: FloatingOriginShiftPayload) => void) => () => boolean;
    /**
     * Rebase when the viewer's local position exceeds the threshold.
     */
    update: (viewerLocalPos?: Vec3Input) => FloatingOriginUpdateResult;
};
