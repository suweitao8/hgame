/** @typedef {[number, number, number]} ShadowVec3Tuple Direction/point [x, y, z]. */
/** @typedef {ShadowVec3Tuple|{ x: number, y: number, z: number }} ShadowVec3Input */
/**
 * @typedef {object} DirectionalLightLike
 * @property {{ x: number, y: number, z: number, set?(x: number, y: number, z: number): unknown }} [position]
 * @property {{ position: { x: number, y: number, z: number, set?(x: number, y: number, z: number): unknown }, updateMatrixWorld?(force?: boolean): void }} [target]
 * @property {{ camera: { left: number, right: number, top: number, bottom: number, near: number, far: number, updateProjectionMatrix?(): void }, mapSize?: { x: number, y: number }, bias: number, normalBias?: number }} shadow
 */
/**
 * @typedef {object} ShadowFitBounds Either {min,max} or {center,radius}.
 * @property {ShadowVec3Tuple} [min]
 * @property {ShadowVec3Tuple} [max]
 * @property {ShadowVec3Tuple} [center]
 * @property {number} [radius]
 */
/**
 * @typedef {object} ShadowFitOptions
 * @property {ShadowVec3Input|null} [sunDirection=null] Defaults to the world-space direction from the target to the light.
 * @property {number} [distance=40] Light distance from bounds centre, world units.
 * @property {number} [padding=2] World units added on each side.
 * @property {boolean} [snapToTexels=true] Snap to shadow-map texels to avoid shimmer.
 * @property {number|null} [bias=-0.0003]
 * @property {number|null} [normalBias=0.02]
 */
/**
 * @typedef {object} ShadowFrustum
 * @property {number} left
 * @property {number} right
 * @property {number} bottom
 * @property {number} top
 * @property {number} near
 * @property {number} far
 */
export function normalizeShadowVec3(input: any, fallback: any): any[];
/**
 * Fits a DirectionalLight's orthographic shadow frustum tightly around scene
 * or receiver bounds and optionally snaps to shadow-map texels to avoid shimmer.
 * @param {{ Vector3: new (x?: number, y?: number, z?: number) => any }} THREE
 * @param {DirectionalLightLike} light
 * @param {ShadowFitBounds} bounds
 * @param {ShadowFitOptions} [options]
 * @returns {ShadowFrustum} The applied orthographic bounds.
 */
export function fitDirectionalShadowFrustum(THREE: {
    Vector3: new (x?: number, y?: number, z?: number) => any;
}, light: DirectionalLightLike, bounds: ShadowFitBounds, { sunDirection, distance, padding, snapToTexels, bias, normalBias, }?: ShadowFitOptions | undefined): ShadowFrustum;
/**
 * Compute camera-frustum cascade split depths using Practical Split Scheme
 * (blending logarithmic near precision and uniform far coverage).
 *
 * @param {number} near Camera near plane (> 0).
 * @param {number} far Maximum shadow range (> near).
 * @param {number} [cascades=3] Number of cascades (1..4).
 * @param {number} [lambda=0.65] Log/uniform blend factor in [0, 1].
 * @returns {number[]} Array of `cascades + 1` split distances `[near, ..., far]`.
 */
export function computeCascadeSplits(near: number, far: number, cascades?: number | undefined, lambda?: number | undefined): number[];
/**
 * Multi-cascade directional shadow manager (2–4 cascades) with practical frustum splits,
 * bounding-sphere slice fitting, and world-space texel snapping to eliminate shadow shimmer.
 *
 * @param {any} THREE Three.js namespace or compatible mock.
 * @param {object} [options]
 * @param {number} [options.cascades=3]
 * @param {number} [options.maxFar=120]
 * @param {number} [options.lambda=0.65]
 * @param {number} [options.mapSize=1024]
 * @param {number[]} [options.lightDirection]
 * @param {number} [options.color=0xfff5e4]
 * @param {number} [options.intensity=1.0]
 * @param {number} [options.shadowBias=-0.0004]
 * @param {number} [options.normalBias=0.02]
 * @param {boolean} [options.pcss=false]
 * @param {number} [options.lightSize=0.04]
 * @param {any} [options.scene=null]
 */
export function createCascadedShadowMap3D(THREE: any, { cascades, maxFar, lambda, mapSize, lightDirection, color, intensity, shadowBias, normalBias, pcss, lightSize, scene, }?: {
    cascades?: number | undefined;
    maxFar?: number | undefined;
    lambda?: number | undefined;
    mapSize?: number | undefined;
    lightDirection?: number[] | undefined;
    color?: number | undefined;
    intensity?: number | undefined;
    shadowBias?: number | undefined;
    normalBias?: number | undefined;
    pcss?: boolean | undefined;
    lightSize?: number | undefined;
    scene?: any;
} | undefined): {
    readonly cascades: number;
    readonly lights: any[];
    readonly splits: number[];
    readonly direction: any[];
    update: (camera: any) => {
        splits: number[];
        frustums: any[];
    };
    applyToMaterial: (material: any) => any;
    setDirection: (nextDir: any) => void;
    setMapSize: (nextSize: any) => void;
    dispose: () => boolean;
};
/**
 * Single-RenderTarget multi-light Shadow Atlas partitioning one `atlasSize^2` DepthTexture
 * into `tileSize^2` tiles to render 2-16 local spot/point lights without FBO ping-pong stalls.
 * @param {any} [THREE=null]
 * @param {{ atlasSize?: number, tileSize?: number }} [options]
 */
export function createShadowAtlas3D(THREE?: any, { atlasSize, tileSize }?: {
    atlasSize?: number;
    tileSize?: number;
} | undefined): Readonly<{
    atlasTarget: any;
    depthTexture: any;
    allocateTile: (lightId: any) => any;
    releaseTile: (lightId: any) => boolean;
    getTileUvRect: (lightId: any) => any;
    renderTile: (renderer: any, scene: any, lightCamera: any, lightId: any) => any;
    getStats: () => Readonly<{
        atlasSize: number;
        tileSize: number;
        cols: number;
        capacity: number;
        allocated: number;
        renderedTiles: number;
        hasDepthTexture: boolean;
    }>;
    dispose: () => void;
}>;
/**
 * Direction/point [x, y, z].
 */
export type ShadowVec3Tuple = [number, number, number];
export type ShadowVec3Input = ShadowVec3Tuple | {
    x: number;
    y: number;
    z: number;
};
export type DirectionalLightLike = {
    position?: {
        x: number;
        y: number;
        z: number;
        set?(x: number, y: number, z: number): unknown;
    } | undefined;
    target?: {
        position: {
            x: number;
            y: number;
            z: number;
            set?(x: number, y: number, z: number): unknown;
        };
        updateMatrixWorld?(force?: boolean): void;
    } | undefined;
    shadow: {
        camera: {
            left: number;
            right: number;
            top: number;
            bottom: number;
            near: number;
            far: number;
            updateProjectionMatrix?(): void;
        };
        mapSize?: {
            x: number;
            y: number;
        };
        bias: number;
        normalBias?: number;
    };
};
/**
 * Either {min,max} or {center,radius}.
 */
export type ShadowFitBounds = {
    min?: ShadowVec3Tuple | undefined;
    max?: ShadowVec3Tuple | undefined;
    center?: ShadowVec3Tuple | undefined;
    radius?: number | undefined;
};
export type ShadowFitOptions = {
    /**
     * Defaults to the world-space direction from the target to the light.
     */
    sunDirection?: ShadowVec3Input | null | undefined;
    /**
     * Light distance from bounds centre, world units.
     */
    distance?: number | undefined;
    /**
     * World units added on each side.
     */
    padding?: number | undefined;
    /**
     * Snap to shadow-map texels to avoid shimmer.
     */
    snapToTexels?: boolean | undefined;
    bias?: number | null | undefined;
    normalBias?: number | null | undefined;
};
export type ShadowFrustum = {
    left: number;
    right: number;
    bottom: number;
    top: number;
    near: number;
    far: number;
};
