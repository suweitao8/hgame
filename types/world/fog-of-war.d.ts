/**
 * Extracts merged horizontal box obstacles from a `TileMap` (or any grid with `width/height/tileSize` and `getTile(x, y)`).
 * @param {object} tileMap
 * @param {(tile: any, gx: number, gy: number) => boolean} [isOpaque]
 * @returns {Array<{ minX: number, minY: number, maxX: number, maxY: number }>}
 */
export function extractTileMapObstacles(tileMap: object, isOpaque?: ((tile: any, gx: number, gy: number) => boolean) | undefined): Array<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}>;
/**
 * Creates a deterministic, zero-GC Fog of War world supporting analytical line-of-sight
 * polygons, vision cones, obstacle corner occlusion, persistent exploration memory/regrow,
 * hider tracking, and minimap RGBA export.
 */
export function createFogOfWarWorld({ plane, bounds, resolutionX, resolutionY, fadeType, fadePower, blendMode, useMemory, exploredAlpha, useRegrow, regrowSpeed, regrowFloor, fadeInSpeed, fadeOutSpeed, initialExploration, blurPasses, worldBoundsSoften, sightExtra, edgeSoften, hidersUseGrid, maxRaysPerRevealer, maxRevealersPerFrame, }?: {
    plane?: string | undefined;
    bounds?: {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
    } | undefined;
    resolutionX?: number | undefined;
    resolutionY?: number | undefined;
    fadeType?: "smoothstep" | undefined;
    fadePower?: number | undefined;
    blendMode?: string | undefined;
    useMemory?: boolean | undefined;
    exploredAlpha?: number | undefined;
    useRegrow?: boolean | undefined;
    regrowSpeed?: number | undefined;
    regrowFloor?: number | undefined;
    fadeInSpeed?: number | undefined;
    fadeOutSpeed?: number | undefined;
    initialExploration?: number | undefined;
    blurPasses?: number | undefined;
    worldBoundsSoften?: number | undefined;
    sightExtra?: number | undefined;
    edgeSoften?: number | undefined;
    hidersUseGrid?: boolean | undefined;
    maxRaysPerRevealer?: number | undefined;
    maxRevealersPerFrame?: number | undefined;
}): {
    plane: string;
    bounds: Readonly<{
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
        width: number;
        height: number;
    }>;
    resX: number;
    resY: number;
    liveVisibility: Float32Array;
    exploredMemory: Float32Array;
    displayVisibility: Float32Array;
    addObstacle: (raw: any) => any;
    removeObstacle: (id: any) => boolean;
    setObstacles: (list: any) => void;
    setObstaclesFromTileMap: (tileMap: any, isOpaque: any) => void;
    addRevealer: (opts?: {}) => any;
    updateRevealer: (id: any, patch?: {}) => boolean;
    removeRevealer: (id: any) => boolean;
    addHider: (opts?: {}) => any;
    updateHider: (id: any, patch?: {}) => boolean;
    removeHider: (id: any) => boolean;
    isHiderVisible: (id: any) => boolean;
    getHiderState: (id: any) => {
        id: any;
        visible: any;
        visibility: any;
        revealedOnce: any;
    } | null;
    sampleVisibility: (x: number, yOrZ: number, zOrHeight?: number | undefined) => number;
    sampleGridVisibility: (x: any, yOrZ: any) => any;
    sampleVisualVisibility: (x: any, yOrZ: any, zOrHeight?: number) => number;
    sampleExploration: (x: any, yOrZ: any) => any;
    sampleDisplay: (x: any, yOrZ: any) => any;
    update: (dt?: number) => void;
    writeMinimapRgba: (outRgba: any, { unexploredRgba, exploredRgba, visibleRgba, }?: {
        unexploredRgba?: number[] | undefined;
        exploredRgba?: number[] | undefined;
        visibleRgba?: number[] | undefined;
    }) => any;
    exportExploration: () => {
        resX: number;
        resY: number;
        data: number[];
    };
    importExploration: (snapshot: any) => boolean;
    clearExploration: (value?: number) => void;
    getRevealers(): any[];
    getObstacles(): any[];
    getHiders(): any[];
    getStats(): {
        plane: string;
        resX: number;
        resY: number;
        revealerCount: number;
        obstacleCount: number;
        hiderCount: number;
        visibleHiders: number;
    };
};
export const FOG_FADE_TYPE: Readonly<{
    LINEAR: "linear";
    SMOOTH: "smooth";
    SMOOTHER: "smoother";
    SMOOTHSTEP: "smoothstep";
    EXPONENTIAL: "exponential";
}>;
export const FOG_QUALITY: Readonly<{
    LOW: 64;
    MEDIUM: 128;
    HIGH: 256;
    ULTRA: 360;
}>;
/**
 * Canonical LoL-inspired top-down Fog of War tuning defaults:
 * binary visible/unseen fog (no explored memory), 256x256 smoothed grid,
 * 23.25m sight radius, cool slate-black shroud, and 0.30 transition edge hiding.
 */
export const TOPDOWN_FOG_DEFAULTS: Readonly<{
    plane: "xz";
    resolution: 256;
    useMemory: false;
    exploredAlpha: 0;
    fadeInSpeed: 12;
    fadeOutSpeed: 6.5;
    blurPasses: 2;
    sightExtra: 0.35;
    edgeSoften: 0.65;
    viewRadius: 23.25;
    softenDistance: 4;
    unobscuredRadius: 2.5;
    unobscuredSoften: 1;
    rayCount: 256;
    visibilityThreshold: 0.3;
    transitionRange: readonly number[];
    fogColor: readonly number[];
    minimapFogRgba: readonly number[];
}>;
