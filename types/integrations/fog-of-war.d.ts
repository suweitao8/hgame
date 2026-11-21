/**
 * Creates a Canvas2D Fog of War overlay supporting `'hybrid'` (persistent explored memory +
 * razor-sharp analytical obstacle shadow polygons), `'analytical'`, and `'grid'` modes,
 * plus an integrated minimap renderer.
 * @param {ReturnType<import('../world/fog-of-war.js').createFogOfWarWorld>} fowWorld
 */
export function createFogOfWarCanvas2DOverlay(fowWorld: ReturnType<typeof import("../index.js").createFogOfWarWorld>, { mode, fogColor, exploredOpacity, pixelate, createBufferCanvas, }?: {
    mode?: string | undefined;
    fogColor?: number[] | undefined;
    exploredOpacity?: number | undefined;
    pixelate?: boolean | undefined;
    createBufferCanvas?: null | undefined;
}): {
    render: (ctx: any, camera: any, viewWidth?: number, viewHeight?: number) => void;
    renderMinimap: (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, markers?: {
        x: number;
        y: number;
        color?: string;
        radius?: number;
    }[] | undefined) => void;
    dispose: () => void;
};
/**
 * Creates a Three.js world-aligned Fog of War plane & `DataTexture` synced zero-GC from `fowWorld`.
 * Works seamlessly for 3D top-down / isometric / RTS scenes (`plane: 'xz'`).
 */
export function createFogOfWarThreeOverlay(fowWorld: any, { THREE, scene, heightY, unexploredColor, exploredColor, fogScroll, noiseAmount, ditherSize, renderOrder, }?: {
    heightY?: number | undefined;
    unexploredColor?: number[] | undefined;
    exploredColor?: number[] | undefined;
    fogScroll?: number[] | undefined;
    noiseAmount?: number | undefined;
    ditherSize?: number | undefined;
    renderOrder?: number | undefined;
}): {
    mesh: any;
    texture: any;
    material: any;
    sync: (dt?: number) => void;
    dispose: () => void;
};
/**
 * Binds Three.js world/PBR materials directly to the LoL-style cool slate-black
 * Fog of War shader (`smoothstep(0.30, 0.95, live * borderMask)` + unified out-of-bounds darkness)
 * so terrain, walls, and props receive crisp GPU fog shading without an alpha plane.
 */
export function createFogOfWarMaterialBinder(THREE: any, { fogColor, transitionMin, transitionMax, borderFadeStart, borderFadeEnd, worldPosVar, }?: {
    fogColor?: number[] | undefined;
    transitionMin?: number | undefined;
    transitionMax?: number | undefined;
    borderFadeStart?: number | undefined;
    borderFadeEnd?: number | undefined;
    worldPosVar?: string | undefined;
}): {
    uniforms: {
        uFogEnabled: {
            value: number;
        };
        uFogTex: {
            value: any;
        };
        uFogBounds: {
            value: any;
        };
        uFogColor: {
            value: any;
        };
    };
    applyToMaterial: (mat: any, { worldPosVar: posVar }?: {
        worldPosVar?: string | undefined;
    }) => any;
    bind: (fogTexture: any, bounds: any) => boolean;
    clear: () => void;
    dispose: () => void;
};
