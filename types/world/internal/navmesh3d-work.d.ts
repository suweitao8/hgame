/** @param {NavWorkGrid} grid @param {PathQuery} query @returns {Generator<undefined, import('../navmesh3d.js').Vec3Point[] | null, void>} */
export function createNavPathWork(grid: NavWorkGrid, { sx, sz, gx, gz, maxNodes, maxSnap, smooth }: PathQuery): Generator<undefined, import("../navmesh3d.js").Vec3Point[] | null, void>;
export type NavWorkGrid = {
    cols: number;
    rows: number;
    heights: Float32Array;
    canTraverse: (ax: number, az: number, bx: number, bz: number) => boolean;
    isCellWalkable: (cx: number, cz: number) => boolean;
    isWalkable: (x: number, z: number) => boolean;
    worldToCellX: (x: number) => number;
    worldToCellZ: (z: number) => number;
    cellCenterX: (x: number) => number;
    cellCenterZ: (z: number) => number;
    dx: readonly number[];
    dz: readonly number[];
    stepCost: readonly number[];
};
export type PathQuery = {
    sx: number;
    sz: number;
    gx: number;
    gz: number;
    maxNodes: number;
    maxSnap: number;
    smooth: boolean;
};
export type Cell = [x: number, z: number];
export type IndexedCell = [x: number, z: number, index: number];
