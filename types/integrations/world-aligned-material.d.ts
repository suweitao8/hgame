/**
 * Adds screen-space normal-derivative roughness filtering to any PBR material
 * to suppress subpixel specular shimmering without disabling sharp highlights up close.
 */
/**
 * @template {WorldMaterialLike} M
 * @param {M} material
 * @param {SpecularAAOptions} [options]
 * @returns {M} The same material.
 */
export function applyGeometricSpecularAA<M extends WorldMaterialLike>(material: M, { strength, maxRoughnessBoost }?: SpecularAAOptions | undefined): M;
/**
 * Y-up; exact same world coordinates on adjacent meshes produce same UV.
 * @param {Vec3Tuple} position World position [x, y, z].
 * @param {'x'|'y'|'z'} axis Projection axis.
 * @param {{ tileSize?: number, offset?: Vec3Tuple }} [options] tileSize default 1; offset default [0,0,0].
 * @returns {[number, number]} UV in tile units.
 */
export function worldProjectUV(position: Vec3Tuple, axis: "x" | "y" | "z", options?: {
    tileSize?: number;
    offset?: Vec3Tuple;
} | undefined): [number, number];
/**
 * @param {Vec3Tuple} normal Non-zero surface normal.
 * @param {number} [sharpness=6] Blend exponent, 0.1..32.
 * @returns {Vec3Tuple} Weights for the x, y, z projections; sums to 1.
 */
export function triplanarWeights(normal: Vec3Tuple, sharpness?: number | undefined): Vec3Tuple;
/**
 * In-memory high-res repeatable maps; linear/mipmap filtering (not MC pixels).
 * @param {WorldAlignedThree} THREE
 * @param {WorldPattern} [pattern='stone']
 * @param {number} [resolution=256] Edge in texels, 128..1024.
 * @returns {WorldTextureLike}
 */
export function createSmoothProceduralTexture(THREE: WorldAlignedThree, pattern?: WorldPattern | undefined, resolution?: number | undefined): WorldTextureLike;
/**
 * Reuse the exact same periodic material noise used by albedo to build
 * non-color data: world-space perturbation slopes, roughness, and AO.
 * Channel packing avoids separate GPU texture requests for each PBR detail.
 * This is lightweight authored procedural relief, not copied UE textures.
 * @param {WorldAlignedThree} THREE
 * @param {WorldPattern} [pattern='stone']
 * @param {number} [resolution=256] Edge in texels, 128..1024.
 * @returns {WorldTextureLike}
 */
export function createSmoothProceduralDetailTexture(THREE: WorldAlignedThree, pattern?: WorldPattern | undefined, resolution?: number | undefined): WorldTextureLike;
/**
 * @param {WorldAlignedThree} THREE
 * @param {WorldAlignedMaterialOptions} [options]
 * @returns {WorldMaterialLike}
 */
export function createWorldAlignedMaterial(THREE: WorldAlignedThree, options?: WorldAlignedMaterialOptions | undefined): WorldMaterialLike;
/**
 * @param {WorldAlignedThree} THREE
 * @param {Record<string, WorldAlignedMaterialOptions>} definitions Keyed by material name ([a-z][a-z0-9-]{0,47}).
 * @param {WorldMaterialPaletteOptions} [paletteOptions]
 * @returns {WorldMaterialPalette}
 */
export function createWorldMaterialPalette(THREE: WorldAlignedThree, definitions: Record<string, WorldAlignedMaterialOptions>, paletteOptions?: WorldMaterialPaletteOptions | undefined): WorldMaterialPalette;
/**
 * Minimal structural Three.js texture.
 */
export type WorldTextureLike = {
    name: string;
    anisotropy: number;
    needsUpdate: boolean;
    dispose: () => void;
};
/**
 * Minimal structural Three.js shader program parameters.
 */
export type WorldShaderLike = {
    uniforms: Record<string, {
        value: unknown;
    }>;
    vertexShader: string;
    fragmentShader: string;
};
/**
 * Minimal structural Three.js material.
 */
export type WorldMaterialLike = {
    userData: Record<string, unknown>;
    needsUpdate: boolean;
    customProgramCacheKey: () => string;
    onBeforeCompile: (shader: WorldShaderLike, renderer?: object) => void;
    dispose: () => void;
};
/**
 * The subset of the THREE namespace used by this module.
 */
export type WorldAlignedThree = {
    DataTexture: new (data: Uint8Array, width: number, height: number, format: number) => WorldTextureLike;
    MeshStandardMaterial: new (parameters?: object) => WorldMaterialLike;
    Vector3: new (x?: number, y?: number, z?: number) => {
        x: number;
        y: number;
        z: number;
    };
    RGBAFormat: number;
    RepeatWrapping: number;
    LinearFilter: number;
    LinearMipmapLinearFilter: number;
    NoColorSpace: string;
};
export type WorldPattern = "stone" | "wood" | "concrete" | "soil" | "grass" | "plaster" | "metal" | "smooth";
export type WorldProjection = "planar" | "triplanar";
/**
 * World-space [x, y, z], Y-up.
 */
export type Vec3Tuple = [number, number, number];
export type SpecularAAOptions = {
    /**
     * Variance multiplier, 0..4.
     */
    strength?: number | undefined;
    /**
     * Max roughness added, 0..1.
     */
    maxRoughnessBoost?: number | undefined;
};
export type WorldAlignedMaterialOptions = {
    projection?: WorldProjection | undefined;
    pattern?: WorldPattern | undefined;
    /**
     * `#RRGGBB` tint.
     */
    color?: string | undefined;
    /**
     * World units per texture repeat, 0.01..10000.
     */
    tileSize?: number | undefined;
    /**
     * Triplanar blend exponent, 0.1..32.
     */
    blendSharpness?: number | undefined;
    /**
     * 0..1.
     */
    roughness?: number | undefined;
    /**
     * 0..1.
     */
    metalness?: number | undefined;
    /**
     * 0..1.
     */
    opacity?: number | undefined;
    transparent?: boolean | undefined;
    /**
     * World-space UV offset in world units.
     */
    offset?: Vec3Tuple | undefined;
    flatShading?: boolean | undefined;
    emissive?: string | undefined;
    /**
     * 0..6.
     */
    emissiveIntensity?: number | undefined;
    /**
     * Procedural detail normal strength, 0..1.
     */
    normalStrength?: number | undefined;
    /**
     * 0..1.
     */
    roughnessVariation?: number | undefined;
    /**
     * 0..1.
     */
    aoIntensity?: number | undefined;
    /**
     * Apply {@link applyGeometricSpecularAA}.
     */
    specularAA?: boolean | undefined;
    specularAAOptions?: SpecularAAOptions | undefined;
    /**
     * Texture anisotropy, 1..16.
     */
    anisotropy?: number | undefined;
};
export type WorldMaterialPaletteOptions = {
    /**
     * Default anisotropy, 1..16.
     */
    anisotropy?: number | undefined;
    /**
     * Default specular AA flag.
     */
    specularAA?: boolean | undefined;
};
export type WorldMaterialPaletteStats = {
    materials: number;
    uniqueTextures: number;
    uniqueDetailTextures: number;
};
export type WorldMaterialPalette = {
    /**
     * Throws on unknown name or after dispose.
     */
    get: (name: string) => WorldMaterialLike;
    /**
     * 1..16.
     */
    setAnisotropy: (value: number) => void;
    /**
     * Floating-origin shift in world units.
     */
    shiftOffset: (dx?: number, dy?: number, dz?: number) => void;
    dispose: () => void;
    /**
     * Getter.
     */
    stats: WorldMaterialPaletteStats;
};
