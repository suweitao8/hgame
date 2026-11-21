/**
 * Zero-allocation state container for 2D ambient lighting, up to 32 point lights,
 * and 2D screen-space post-processing (bloom, vignette, hitPulse, chromatic, color grade).
 */
export function createLighting2DState(): Readonly<{
    ambientRgb: Float32Array;
    readonly ambientIntensity: number;
    readonly lightCount: number;
    readonly rawLightCount: number;
    readonly occluderCount: number;
    readonly rawOccluderCount: number;
    readonly qualityTier: string;
    readonly normalMap: any;
    readonly normalStrength: number;
    lightWorld: Float32Array;
    lightUvPosRad: Float32Array;
    lightUvColorInt: Float32Array;
    occluderWorld: Float32Array;
    occluderUv: Float32Array;
    post: {
        bloomIntensity: number;
        bloomThreshold: number;
        vignette: number;
        hitPulse: number;
        chromatic: number;
        saturation: number;
        contrast: number;
    };
    setAmbientLight: (color?: string, intensity?: number) => void;
    addLight: (light: any) => boolean;
    setLights: (lights: any) => number;
    clearLights: () => void;
    addOccluder: (segment: any) => boolean;
    setOccluders: (segments: any) => number;
    addPolygonOccluder: (points: any, { closed }?: {
        closed?: boolean | undefined;
    }) => number;
    setPolygonOccluders: (polygons: any, { closed }?: {
        closed?: boolean | undefined;
    }) => number;
    clearOccluders: () => void;
    setNormalLighting: ({ normalMap, strength }?: {
        normalMap?: null | undefined;
        strength?: number | undefined;
    }) => void;
    setQuality: (tier?: string) => Readonly<{
        tier: "high";
        maxLights: 32;
        ambient: true;
        pointLights: true;
        occluderShadows: true;
        softShadows: true;
        normalMaps: true;
        bloom: true;
        colorGrading: true;
        vignette: true;
        hitPulse: true;
        retainedEffects: readonly string[];
    }>;
    getQualityPolicy: () => Readonly<{
        tier: "high";
        maxLights: 32;
        ambient: true;
        pointLights: true;
        occluderShadows: true;
        softShadows: true;
        normalMaps: true;
        bloom: true;
        colorGrading: true;
        vignette: true;
        hitPulse: true;
        retainedEffects: readonly string[];
    }>;
    setPost: (cfg?: {}) => void;
    hasLighting: () => boolean;
    hasActivePass: () => boolean;
    projectLightsToUv: (cam: any, viewport: any, designW: any, designH: any) => void;
    snapshot(): {
        ambient: {
            r: number;
            g: number;
            b: number;
            intensity: number;
        };
        lightCount: number;
        occluderCount: number;
        qualityTier: string;
        qualityPolicy: Readonly<{
            tier: "high";
            maxLights: 32;
            ambient: true;
            pointLights: true;
            occluderShadows: true;
            softShadows: true;
            normalMaps: true;
            bloom: true;
            colorGrading: true;
            vignette: true;
            hitPulse: true;
            retainedEffects: readonly string[];
        }>;
        hasNormalMap: boolean;
        post: {
            bloomIntensity: number;
            bloomThreshold: number;
            vignette: number;
            hitPulse: number;
            chromatic: number;
            saturation: number;
            contrast: number;
        };
    };
}>;
export function addPolygonOccluder(state: any, points: any, options?: {}): any;
export function setPolygonOccluders(state: any, polygons: any, options?: {}): any;
/**
 * Canvas2D atmospheric lighting and screen-space fallback pass.
 */
export function renderCanvas2DPostPass(ctx: any, width: any, height: any, cam: any, state: any, subX?: number, subY?: number, subW?: any, subH?: any): void;
/**
 * WebGL2 offscreen scene capture + 2D lighting + half-res Bloom + composite pass.
 * Safely no-ops if running against a minimal mock `gl` without FBO support.
 * @param {WebGL2RenderingContext} gl
 */
export function createWebGL2DPostPass(gl: WebGL2RenderingContext): {
    supported: boolean;
    beginScene: () => boolean;
    endAndComposite: () => void;
    reclaimTargets: () => number;
    getTargetBytes: () => number;
    destroy: () => void;
    readonly sceneTarget?: undefined;
    recordTargets?: undefined;
} | {
    supported: boolean;
    readonly sceneTarget: any;
    recordTargets(report: any): void;
    beginScene: (w: any, h: any) => boolean;
    endAndComposite: (w: any, h: any, state: any, cam: any, viewport: any, designW: any, designH: any, report?: null) => void;
    reclaimTargets: () => number;
    getTargetBytes: () => number;
    destroy: () => void;
};
/** Maximum simultaneous dynamic 2D point lights evaluated per pass. */
export const MAX_2D_LIGHTS: 32;
/** Maximum simultaneous 2D shadow occluder segments evaluated per pass. */
export const MAX_2D_OCCLUDERS: 32;
/**
 * 2D lighting, shadow occlusion, sprite material/normal, and post-processing quality presets.
 * Explicitly declares which effects are retained at `'low'`, `'medium'`, and `'high'` tiers.
 */
export const QUALITY2D_LIGHTING_PRESETS: Readonly<{
    low: Readonly<{
        tier: "low";
        maxLights: 8;
        ambient: true;
        pointLights: true;
        occluderShadows: false;
        softShadows: false;
        normalMaps: false;
        bloom: false;
        colorGrading: false;
        vignette: true;
        hitPulse: true;
        retainedEffects: readonly string[];
    }>;
    medium: Readonly<{
        tier: "medium";
        maxLights: 16;
        ambient: true;
        pointLights: true;
        occluderShadows: true;
        softShadows: false;
        normalMaps: false;
        bloom: true;
        colorGrading: true;
        vignette: true;
        hitPulse: true;
        retainedEffects: readonly string[];
    }>;
    high: Readonly<{
        tier: "high";
        maxLights: 32;
        ambient: true;
        pointLights: true;
        occluderShadows: true;
        softShadows: true;
        normalMaps: true;
        bloom: true;
        colorGrading: true;
        vignette: true;
        hitPulse: true;
        retainedEffects: readonly string[];
    }>;
}>;
