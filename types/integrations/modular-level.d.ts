/**
 * Cell to world position.
 * @param {Vec3Tuple} cell Integer cell.
 * @param {ModularGridSpec} [grid] Default cellSize 1, origin 0.
 * @returns {number[]} World [x,y,z].
 */
export function gridToWorld(cell: Vec3Tuple, grid?: ModularGridSpec): number[];
/**
 * World position to nearest cell.
 * @param {Vec3Tuple} world World [x,y,z].
 * @param {ModularGridSpec} [grid] Default cellSize 1, origin 0.
 * @returns {number[]} Integer cell [x,y,z].
 */
export function worldToGrid(world: Vec3Tuple, grid?: ModularGridSpec): number[];
/**
 * Expand compact JSON into a deterministic, immutable render recipe.
 * Order is group input order, then fill: y outer, z middle, x inner.
 *
 * @param {ModularLevelData} level Version-1 level JSON.
 * @returns {CompiledModularLevel}
 */
export function compileModularLevel(level: ModularLevelData): CompiledModularLevel;
/**
 * Atomic visual-only level renderer. Asynchronously staged new levels replace
 * the old group only after all GLB requests finish. No extra RAF or physics
 * bodies are created; the caller owns render scheduling and collision state.
 *
 * @param {ModularLevelRendererOptions} options
 * @returns {ModularLevelRenderer}
 */
export function createModularLevelRenderer({ THREE, models, parent }?: ModularLevelRendererOptions): ModularLevelRenderer;
/**
 * Finite `[x, y, z]`.
 */
export type Vec3Tuple = [number, number, number];
export type ModularGridSpec = {
    /**
     * Cell edge length in world units, (0, 100]. Default `1`.
     */
    cellSize?: number;
    /**
     * World position of cell [0,0,0]. Default `[0,0,0]`.
     */
    origin?: Vec3Tuple;
};
export type ModularLevelGroup = {
    /**
     * Logical scene model slot id, e.g. `kit.wall`.
     */
    slot: string;
    /**
     * Inclusive integer cell box (xor with `cells`).
     */
    fill?: {
        from: Vec3Tuple;
        to: Vec3Tuple;
    };
    /**
     * Explicit integer cells (xor with `fill`).
     */
    cells?: Vec3Tuple[];
    /**
     * Cells to skip from the group.
     */
    exclude?: Vec3Tuple[];
    /**
     * Quarter-turns about Y. Default `0`.
     */
    turns?: 0 | 1 | 2 | 3;
    /**
     * Uniform scale multiplier, (0, 100]. Default `1`.
     */
    scale?: number;
};
/**
 * Explicit physics metadata, independent of art.
 */
export type ModularColliderSpec = {
    /**
     * Unique id, `/^[a-z][a-z0-9_-]{0,63}$/`.
     */
    id: string;
    /**
     * World-space centre.
     */
    center: Vec3Tuple;
    /**
     * Full extents in world units (> 0).
     */
    size: Vec3Tuple;
    /**
     * Trigger-only collider. Default `false`.
     */
    sensor?: boolean;
    /**
     * uint32 collision layer. Default `1`.
     */
    layer?: number;
    /**
     * uint32 collision mask. Default `0xffffffff`.
     */
    mask?: number;
};
/**
 * Version-1 level JSON.
 */
export type ModularLevelData = {
    version: 1;
    grid?: ModularGridSpec;
    /**
     * 1..2048 groups.
     */
    groups: ModularLevelGroup[];
    colliders?: ModularColliderSpec[];
    /**
     * Default `[0, 1.8, 0]`.
     */
    playerSpawn?: Vec3Tuple;
};
export type ModularPlacement = {
    x: number;
    y: number;
    z: number;
    /**
     * Radians.
     */
    rotationY: number;
    /**
     * Final uniform scale (group scale * cellSize).
     */
    scale: number;
};
export type ModularBatch = {
    slot: string;
    placements: readonly ModularPlacement[];
};
export type ModularLevelStats = {
    /**
     * Visible tile count.
     */
    tiles: number;
    /**
     * Distinct slot count.
     */
    slots: number;
    /**
     * Collider count.
     */
    colliders: number;
};
/**
 * Immutable render recipe.
 */
export type CompiledModularLevel = {
    version: 1;
    grid: Readonly<{
        cellSize: number;
        origin: readonly number[];
    }>;
    batches: readonly ModularBatch[];
    colliders: readonly Readonly<{
        id: string;
        center: readonly number[];
        size: readonly number[];
        sensor: boolean;
        layer: number;
        mask: number;
    }>[];
    playerSpawn: readonly number[];
    stats: Readonly<ModularLevelStats>;
};
/**
 * Minimal Three.js Object3D structure.
 */
export type ModularObject3DLike = {
    add: (...objects: object[]) => unknown;
    remove?: (...objects: object[]) => unknown;
};
export type ModularGroupLike = {
    name: string;
    parent?: unknown;
};
/**
 * Used Three.js constructors.
 */
export type ModularThreeLike = {
    Group: new () => ModularGroupLike & ModularObject3DLike;
};
/**
 * Scene model slot provider.
 */
export type ModularModelSlotsLike = {
    /**
     * Throws/returns for unknown slots.
     */
    get: (slot: string) => unknown;
    instantiate: (slot: string) => Promise<object> | object;
    instantiateBatch: (slot: string, placements: readonly ModularPlacement[]) => Promise<object> | object;
};
export type ModularLevelRendererOptions = {
    /**
     * Three.js namespace subset.
     */
    THREE: ModularThreeLike;
    /**
     * Slot provider.
     */
    models: ModularModelSlotsLike;
    /**
     * Object3D that receives the level group.
     */
    parent: ModularObject3DLike;
};
export type ModularLevelCommit = ModularLevelStats & {
    committed: boolean;
};
export type ModularLevelRenderer = {
    /**
     * Stage and atomically swap in a level.
     */
    setLevel: (level: ModularLevelData) => Promise<ModularLevelCommit>;
    /**
     * Re-run the last committed level.
     */
    rebuild: () => Promise<ModularLevelCommit>;
    /**
     * Remove the mounted level.
     */
    clear: () => void;
    /**
     * Clear and disable the renderer.
     */
    dispose: () => void;
    /**
     * Copy of last committed stats.
     */
    stats: ModularLevelStats;
    /**
     * Mounted Group or null.
     */
    root: object | null;
};
