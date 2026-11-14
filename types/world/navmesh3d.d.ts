/**
 * Lightweight 3D Height-Aware NavMesh + A* + String-Pulling Corridor Smoother.
 * Supports obstacle radius inflation, multi-elevation platforms/ramps within `stepHeight`,
 * and line-of-sight string-pulling so 3D agents follow smooth paths around corners.
 * @param {NavMesh3DOptions} options
 */
export function createNavMesh3D(options: NavMesh3DOptions): Readonly<{
    cols: number;
    rows: number;
    cellSize: number;
    agentRadius: number;
    stepHeight: number;
    rebuild: () => void;
    addObstacle: (aabb: any) => void;
    clearObstacles: () => void;
    isWalkable: (x: any, z: any) => boolean;
    findPath: (start: {
        x: number;
        y?: number;
        z: number;
    }, goal: {
        x: number;
        y?: number;
        z: number;
    }, pathOpts?: {
        smooth?: boolean;
        maxSnapCells?: number;
    }) => Vec3Point[] | null;
    sampleSurfaceHeight: (x: any, z: any) => number;
}>;
export type NavObstacleAABB = {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    minY?: number;
    maxY?: number;
};
export type NavSurfaceBox = {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    /**
     * Surface top elevation.
     */
    y: number;
};
export type NavMesh3DOptions = {
    /**
     * World XZ navigation bounds.
     */
    bounds: {
        minX: number;
        maxX: number;
        minZ: number;
        maxZ: number;
    };
    /**
     * Grid quantization cell size in world units.
     */
    cellSize?: number;
    /**
     * Horizontal obstacle inflation radius.
     */
    agentRadius?: number;
    /**
     * Maximum traversable vertical elevation delta between neighboring cells.
     */
    stepHeight?: number;
    /**
     * Default floor elevation when no surface overrides a cell.
     */
    groundY?: number;
    /**
     * Optional continuous height provider (e.g. terrain).
     */
    sampleHeight?: (x: number, z: number) => number;
    /**
     * Static blocking AABB obstacles.
     */
    obstacles?: NavObstacleAABB[];
    /**
     * Elevated walkable platforms/bridges.
     */
    surfaces?: NavSurfaceBox[];
};
export type Vec3Point = {
    x: number;
    y: number;
    z: number;
};
