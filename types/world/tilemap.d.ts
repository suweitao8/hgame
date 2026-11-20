/**
 * @typedef {object} FindGridPathOptions
 * @property {number} [maxNodes=20000] Maximum expanded nodes before giving up (returns []).
 * @property {boolean} [allowDiagonal=false] Allow 8-way movement (octile heuristic).
 * @property {boolean} [preventCornerCutting=true] Disallow diagonal steps past solid orthogonal neighbours.
 */
/**
 * O(N log N) A* over a TileMap, with optional diagonal movement and corner-cutting guard.
 * @template [T=number]
 * @param {TileMap<T>} map
 * @param {TileCoord} start Start cell.
 * @param {TileCoord} goal Goal cell.
 * @param {FindGridPathOptions} [options]
 * @returns {TileCoord[]} Cells from start to goal inclusive, or [] when blocked/unreachable.
 */
export function findGridPath<T = number>(map: TileMap<T>, start: TileCoord, goal: TileCoord, { maxNodes, allowDiagonal, preventCornerCutting, }?: FindGridPathOptions | undefined): TileCoord[];
/**
 * Create a budgetable A* search over the current map revision.
 * @template [T=number]
 * @param {TileMap<T>} map
 * @param {TileCoord} start
 * @param {TileCoord} goal
 * @param {FindGridPathOptions} [options]
 * @returns {Generator<undefined, TileCoord[], void>}
 */
export function createGridPathWork<T = number>(map: TileMap<T>, start: TileCoord, goal: TileCoord, { maxNodes, allowDiagonal, preventCornerCutting, }?: FindGridPathOptions | undefined): Generator<undefined, TileCoord[], void>;
/**
 * @template [T=number]
 * @typedef {object} TileMapOptions
 * @property {T[][]} tiles Rectangular row-major grid (tiles[y][x]); rows are copied.
 * @property {number} [tileWidth=32] Tile width in world units (> 0).
 * @property {number} [tileHeight=32] Tile height in world units (> 0).
 * @property {Iterable<T>} [solid=[]] Tile values that block movement.
 */
/**
 * Minimal frame-lookup contract used by TileMap#draw (e.g. a SpriteSheet).
 * @typedef {object} TileSheetLike
 * @property {CanvasImageSource | null} [image] Source image for the sheet.
 * @property {(index: number) => { x: number, y: number, width: number, height: number }} frame Returns the source rectangle (pixels) of a frame index.
 */
/**
 * World-space visible rectangle used for culling.
 * @typedef {object} TileViewBounds
 * @property {number} minX
 * @property {number} minY
 * @property {number} maxX
 * @property {number} maxY
 */
/**
 * @template [T=number]
 * @typedef {object} TileMapDrawOptions
 * @property {Record<string, string>} [palette={}] Fill style per tile value (flat-colour fallback).
 * @property {number} [originX=0] World X of the map's top-left corner.
 * @property {number} [originY=0] World Y of the map's top-left corner.
 * @property {TileSheetLike | null} [sheet=null] Sprite sheet providing tile frames.
 * @property {CanvasImageSource | null} [image=null] Override image; defaults to sheet.image.
 * @property {Record<string, number | null | undefined> | null} [tileFrames=null] Tile value to frame index; when omitted, non-negative integer tile values are used as frame indices.
 * @property {TileViewBounds | null} [viewBounds=null] Cull to this world-space rectangle.
 */
/**
 * A grid cell coordinate.
 * @typedef {object} TileCoord
 * @property {number} x Column.
 * @property {number} y Row.
 */
/**
 * Compact map grid with an explicit solid-tile palette and optional tileset/culling support.
 * @template [T=number]
 */
export class TileMap<T = number> {
    /** @param {TileMapOptions<T>} [options] */
    constructor({ tiles, tileWidth, tileHeight, solid }?: TileMapOptions<T> | undefined);
    /** Row-major tile values (tiles[y][x]). @type {T[][]} */
    tiles: T[][];
    /** Columns. @type {number} */
    width: number;
    /** Rows. @type {number} */
    height: number;
    /** Tile width in world units. @type {number} */
    tileWidth: number;
    /** Tile height in world units. @type {number} */
    tileHeight: number;
    /** Tile values that block movement. @type {Set<T>} */
    solid: Set<T>;
    /**
     * True when (x, y) is an integer cell inside the grid.
     * @param {number} x Column.
     * @param {number} y Row.
     * @returns {boolean}
     */
    within(x: number, y: number): boolean;
    /**
     * Tile value at a cell, or undefined outside the grid.
     * @param {number} x Column.
     * @param {number} y Row.
     * @returns {T | undefined}
     */
    get(x: number, y: number): T | undefined;
    /**
     * Replace a tile; throws RangeError outside the grid.
     * @param {number} x Column.
     * @param {number} y Row.
     * @param {T} value
     * @returns {void}
     */
    set(x: number, y: number, value: T): void;
    /** Invalidate sliced searches after editing tile rows or the solid palette directly. */
    invalidateNavigation(): void;
    /**
     * Solid test; out-of-bounds cells count as solid.
     * @param {number} x Column.
     * @param {number} y Row.
     * @returns {boolean}
     */
    isSolid(x: number, y: number): boolean;
    /**
     * Convert a world position to the containing cell.
     * @param {number} x World X relative to the map origin.
     * @param {number} y World Y relative to the map origin.
     * @param {TileCoord} [out] Optional reusable result.
     * @returns {TileCoord}
     */
    worldToTile(x: number, y: number, out?: TileCoord | undefined): TileCoord;
    /**
     * World-space centre of a cell.
     * @param {number} x Column.
     * @param {number} y Row.
     * @returns {{ x: number, y: number }}
     */
    tileToWorld(x: number, y: number): {
        x: number;
        y: number;
    };
    /**
     * Draw visible tiles with a sprite sheet or flat palette colours.
     * @param {CanvasRenderingContext2D} ctx
     * @param {TileMapDrawOptions<T>} [options]
     * @returns {void}
     */
    draw(ctx: CanvasRenderingContext2D, { palette, originX, originY, sheet, image, tileFrames, viewBounds }?: TileMapDrawOptions<T> | undefined): void;
}
export type FindGridPathOptions = {
    /**
     * Maximum expanded nodes before giving up (returns []).
     */
    maxNodes?: number | undefined;
    /**
     * Allow 8-way movement (octile heuristic).
     */
    allowDiagonal?: boolean | undefined;
    /**
     * Disallow diagonal steps past solid orthogonal neighbours.
     */
    preventCornerCutting?: boolean | undefined;
};
export type HeapNode = {
    /**
     * Cell id (y * width + x).
     */
    id: number;
    x: number;
    y: number;
    /**
     * A* priority (g + heuristic).
     */
    f: number;
    /**
     * Insertion sequence for stable tie-breaking.
     */
    seq: number;
};
export type SearchNode = HeapNode & {
    g: number;
    heapIndex: number;
    parent: SearchNode | null;
};
export type TileMapOptions<T = number> = {
    /**
     * Rectangular row-major grid (tiles[y][x]); rows are copied.
     */
    tiles: T[][];
    /**
     * Tile width in world units (> 0).
     */
    tileWidth?: number | undefined;
    /**
     * Tile height in world units (> 0).
     */
    tileHeight?: number | undefined;
    /**
     * Tile values that block movement.
     */
    solid?: Iterable<T> | undefined;
};
/**
 * Minimal frame-lookup contract used by TileMap#draw (e.g. a SpriteSheet).
 */
export type TileSheetLike = {
    /**
     * Source image for the sheet.
     */
    image?: CanvasImageSource | null | undefined;
    /**
     * Returns the source rectangle (pixels) of a frame index.
     */
    frame: (index: number) => {
        x: number;
        y: number;
        width: number;
        height: number;
    };
};
/**
 * World-space visible rectangle used for culling.
 */
export type TileViewBounds = {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
};
export type TileMapDrawOptions<T = number> = {
    /**
     * Fill style per tile value (flat-colour fallback).
     */
    palette?: Record<string, string> | undefined;
    /**
     * World X of the map's top-left corner.
     */
    originX?: number | undefined;
    /**
     * World Y of the map's top-left corner.
     */
    originY?: number | undefined;
    /**
     * Sprite sheet providing tile frames.
     */
    sheet?: TileSheetLike | null | undefined;
    /**
     * Override image; defaults to sheet.image.
     */
    image?: CanvasImageSource | null | undefined;
    /**
     * Tile value to frame index; when omitted, non-negative integer tile values are used as frame indices.
     */
    tileFrames?: Record<string, number | null | undefined> | null | undefined;
    /**
     * Cull to this world-space rectangle.
     */
    viewBounds?: TileViewBounds | null | undefined;
};
/**
 * A grid cell coordinate.
 */
export type TileCoord = {
    /**
     * Column.
     */
    x: number;
    /**
     * Row.
     */
    y: number;
};
