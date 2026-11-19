/**
 * Zero-allocation state container for 2D ambient lighting, up to 32 point lights,
 * and 2D screen-space post-processing (bloom, vignette, hitPulse, chromatic, color grade).
 */
export function createLighting2DState(): Readonly<{
    ambientRgb: Float32Array;
    readonly ambientIntensity: number;
    readonly lightCount: number;
    lightWorld: Float32Array;
    lightUvPosRad: Float32Array;
    lightUvColorInt: Float32Array;
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
    destroy: () => void;
    readonly sceneTarget?: undefined;
    recordTargets?: undefined;
} | {
    supported: boolean;
    readonly sceneTarget: any;
    recordTargets(report: any): void;
    beginScene: (w: any, h: any) => boolean;
    endAndComposite: (w: any, h: any, state: any, cam: any, viewport: any, designW: any, designH: any, report?: null) => void;
    destroy: () => void;
};
/** Maximum simultaneous dynamic 2D point lights evaluated per pass. */
export const MAX_2D_LIGHTS: 32;
