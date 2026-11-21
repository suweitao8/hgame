/**
 * Composable declarative 3D PBR material system with shared constant uniform blocks,
 * deterministic shader program cache keys (avoiding ad-hoc onBeforeCompile collisions),
 * and modular surface features (Fresnel rim glow, procedural Dissolve, Triplanar UV scale,
 * and Geometric Specular AA). Zero direct 'three' imports.
 */
/**
 * Shared shader uniform block reused across multiple materials so time, wind, or
 * global atmospheric uniforms update once without per-material traversal.
 */
export function createSharedMaterialBlock3D(initialUniforms?: {}): {
    readonly version: number;
    readonly uniforms: any;
    set: (name: any, value: any) => void;
    get: (name: any) => any;
};
/**
 * Build a declarative PBR material combining standard/physical base properties
 * with deterministic shader modules (`fresnel`, `dissolve`, `triplanar`, `specularAA`, `windSway`)
 * and optional `sharedBlock` uniforms.
 *
 * @param {any} THREE Three.js namespace or compatible mock.
 * @param {Record<string, any>} [options]
 */
export function createComposableMaterial3D(THREE: any, { color, roughness, metalness, clearcoat, clearcoatRoughness, emissive, emissiveIntensity, transparent, opacity, side, fresnel, dissolve, triplanar, specularAA, windSway, normalRmUnpack, wetness, interactRim, sharedBlock, vertexChunks, fragmentChunks, }?: Record<string, any> | undefined): any;
/**
 * Shared O(1) Material Batch Registry synchronizing global uniforms (`uTime`, `uWindDir`,
 * `uFogDensity`) via WebGL2 UniformsGroup UBOs when `options.THREE` is provided, without
 * per-material scene traversal.
 * @param {Record<string, any>} [initialSharedUniforms]
 * @param {object} [options]
 * @param {object|null} [options.THREE]
 * @param {string} [options.groupName='HGamePerFrameUBO']
 */
export function createMaterialBatchRegistry3D(initialSharedUniforms?: Record<string, any> | undefined, options?: {
    THREE?: object | null;
    groupName?: string | undefined;
} | undefined): Readonly<{
    sharedBlock: {
        readonly version: number;
        readonly uniforms: any;
        set: (name: any, value: any) => void;
        get: (name: any) => any;
    };
    uboGroup: any;
    register: (material: any) => boolean;
    unregister: (material: any) => boolean;
    setGlobal: (name: any, value: any) => any;
    updateFrame: (dt?: number, overrides?: null) => number;
    getStats: () => Readonly<{
        registeredCount: number;
        version: number;
        uniformKeys: string[];
        uboEnabled: boolean;
        uboGroupName: string | null;
    }>;
}>;
/**
 * Define a declarative keyword-driven 3D material variant pipeline with canonical cache keys,
 * `defines`/`uniforms` merging, `customProgramCacheKey` reuse, and batch shader warmup.
 *
 * @param {any} THREE Three.js namespace or compatible mock.
 * @param {object} [options]
 * @param {Record<string, any>} [options.base={}] Base options passed to {@link createComposableMaterial3D}.
 * @param {Record<string, Record<string, any>>} [options.keywords={}] Boolean or enum keyword definitions.
 * @param {Record<string, any> | null} [options.uniforms=null] Shared variant uniforms merged onto created materials.
 * @param {ReturnType<typeof createSharedMaterialBlock3D> | null} [options.sharedBlock=null] Optional shared uniform block.
 * @returns {{ getKey: (activeKeywords?: Record<string, boolean | string | number | null | undefined>) => string, get: (activeKeywords?: Record<string, boolean | string | number | null | undefined>) => any, warmup: (renderer: any, camera: any, combinations?: Array<Record<string, boolean | string | number | null | undefined>> | null) => { compiled: number, keys: string[] }, list: () => string[], dispose: () => void, readonly size: number }}
 */
export function defineMaterialVariants3D(THREE: any, { base, keywords, uniforms, sharedBlock, }?: {
    base?: Record<string, any> | undefined;
    keywords?: Record<string, Record<string, any>> | undefined;
    uniforms?: Record<string, any> | null | undefined;
    sharedBlock?: {
        readonly version: number;
        readonly uniforms: any;
        set: (name: any, value: any) => void;
        get: (name: any) => any;
    } | null | undefined;
} | undefined): {
    getKey: (activeKeywords?: Record<string, boolean | string | number | null | undefined>) => string;
    get: (activeKeywords?: Record<string, boolean | string | number | null | undefined>) => any;
    warmup: (renderer: any, camera: any, combinations?: Array<Record<string, boolean | string | number | null | undefined>> | null) => {
        compiled: number;
        keys: string[];
    };
    list: () => string[];
    dispose: () => void;
    readonly size: number;
};
