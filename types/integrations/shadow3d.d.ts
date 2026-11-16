/**
 * Directional shadow frustum fitter shared between the Three.js adapter
 * and procedural sky helpers without pulling sky shaders into minimal 3D builds.
 */
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
 * @property {ShadowVec3Input|null} [sunDirection=null] Defaults to light.position - light.target.position.
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
     * Defaults to light.position - light.target.position.
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
