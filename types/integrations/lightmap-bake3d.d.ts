/**
 * Generate non-overlapping lightmap UV2 (`uv1`) coordinates for a geometry using
 * signed-dominant-axis chart flood-fill and shelf packing.
 *
 * @param {any} geometry Three.js BufferGeometry or compatible geometry object.
 * @param {{ padding?: number, resolution?: number }} [options]
 * @returns {{ charts: Array<{ id: number, axis: number, uMin: number, vMin: number, uMax: number, vMax: number, worldArea: number, triCount: number }>, utilization: number }}
 */
export function generateLightmapUV3D(geometry: any, { padding, resolution }?: {
    padding?: number;
    resolution?: number;
} | undefined): {
    charts: Array<{
        id: number;
        axis: number;
        uMin: number;
        vMin: number;
        uMax: number;
        vMax: number;
        worldArea: number;
        triCount: number;
    }>;
    utilization: number;
};
/**
 * Create a WebGL2 GPU progressive lightmap & ambient occlusion baker.
 * Generates soft directional sun shadows and cosine-weighted hemispherical AO into a `uv1`
 * lightmap texture (`channel = 1`, compatible with `applyBakedLightmap3D`).
 *
 * @param {any} THREE
 * @param {any} renderer THREE.WebGLRenderer
 * @param {{ resolution?: number, shadowResolution?: number, padding?: number }} [options]
 */
export function createLightmapBaker3D(THREE: any, renderer: any, { resolution, shadowResolution, padding, }?: {
    resolution?: number;
    shadowResolution?: number;
    padding?: number;
} | undefined): {
    bake: ({ meshes, sun, ambient, lights, samples, aoSamples, aoDistance, bounces, bounceIntensity, bounceSurfels, dilationPasses, }?: {
        meshes?: any;
        sun?: {
            direction?: any;
            color?: any;
            intensity?: number;
            softness?: number;
        };
        ambient?: {
            color?: any;
            intensity?: number;
        };
        lights?: Array<{
            type?: "point" | "spot";
            position?: any;
            color?: any;
            intensity?: number;
            distance?: number;
            decay?: number;
            direction?: any;
            angle?: number;
            penumbra?: number;
            castShadow?: boolean;
        }>;
        samples?: number;
        aoSamples?: number;
        aoDistance?: number;
        bounces?: number;
        bounceIntensity?: number;
        bounceSurfels?: number;
        dilationPasses?: number;
    } | undefined) => {
        texture: any;
        renderTarget: any;
        stats: {
            samples: number;
            lights: number;
            bounceSurfels: number;
            dilationPasses: number;
            texels: number;
            ms: number;
        };
    };
    readPixels: () => Uint8Array;
    dispose: () => boolean;
    readonly resolution: number;
};
