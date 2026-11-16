/**
 * @param {PbrThree} THREE
 * @param {WorldAlignedPbrOptions} options
 * @returns {PbrMaterialLike}
 */
export function createWorldAlignedPbrMaterial(THREE: PbrThree, { color, normal, orm, ...options }?: WorldAlignedPbrOptions): PbrMaterialLike;
/**
 * Content-addressed catalogs can share a texture pool across material entries.
 * @param {PbrLibraryOptions} options
 * @returns {Promise<PbrLibrary>}
 */
export function loadCuratedPbrLibrary({ THREE, catalogUrl, fetchJson, textureLoader, }?: PbrLibraryOptions): Promise<PbrLibrary>;
export type PbrTextureLike = import("./world-aligned-material.js").WorldTextureLike;
export type PbrMaterialLike = import("./world-aligned-material.js").WorldMaterialLike;
export type PbrProjection = import("./world-aligned-material.js").WorldProjection;
/**
 * The subset of the THREE namespace used for world-aligned PBR materials.
 */
export type PbrThree = {
    MeshStandardMaterial: new (parameters?: object) => PbrMaterialLike;
    Vector3: new (x?: number, y?: number, z?: number) => {
        x: number;
        y: number;
        z: number;
    };
    FrontSide: number;
};
export type PbrProjectionOptions = {
    projection?: import("./world-aligned-material.js").WorldProjection | undefined;
    /**
     * World units per texture repeat, 0.01..1000.
     */
    tileSize?: number | undefined;
    /**
     * Triplanar blend exponent, 0.1..32.
     */
    blendSharpness?: number | undefined;
    /**
     * Ambient-occlusion strength, 0..1.
     */
    aoIntensity?: number | undefined;
    /**
     * Normal-map strength, 0..2.
     */
    normalStrength?: number | undefined;
};
/**
 * color = sRGB base colour; normal = OpenGL tangent-space map; orm = linear (R AO, G roughness, B metallic).
 */
export type WorldAlignedPbrOptions = PbrProjectionOptions & {
    color: PbrTextureLike;
    normal: PbrTextureLike;
    orm: PbrTextureLike;
};
export type PbrCatalogEntry = {
    /**
     * Matches `[a-z][a-z0-9-]{0,100}`.
     */
    id: string;
    /**
     * Relative `textures/<sha256>.png|webp` path.
     */
    color: string;
    /**
     * Relative texture path.
     */
    normal: string;
    /**
     * Relative texture path.
     */
    orm: string;
    name?: string | undefined;
    category?: string | undefined;
    /**
     * Default tile size in world units.
     */
    tileSize?: number | undefined;
    projection?: import("./world-aligned-material.js").WorldProjection | undefined;
};
export type PbrCatalog = {
    version: 1;
    /**
     * At most 2000 entries.
     */
    materials: PbrCatalogEntry[];
};
/**
 * THREE namespace for {@link loadCuratedPbrLibrary}; extends {@link PbrThree}.
 */
export type PbrLibraryThree = {
    TextureLoader: new () => {
        loadAsync(url: string): Promise<PbrTextureLike>;
    };
    MeshStandardMaterial: new (parameters?: object) => PbrMaterialLike;
    Vector3: new (x?: number, y?: number, z?: number) => {
        x: number;
        y: number;
        z: number;
    };
    FrontSide: number;
    RepeatWrapping: number;
    LinearFilter: number;
    LinearMipmapLinearFilter: number;
    SRGBColorSpace: string;
    NoColorSpace: string;
};
export type PbrLibraryOptions = {
    THREE: PbrLibraryThree;
    /**
     * HTTP(S) URL of the catalog JSON (relative allowed).
     */
    catalogUrl: string;
    /**
     * Custom catalog fetcher; defaults to fetch().
     */
    fetchJson?: ((url: string) => Promise<PbrCatalog>) | null | undefined;
    /**
     * Defaults to `new THREE.TextureLoader()`.
     */
    textureLoader?: {
        loadAsync(url: string): Promise<PbrTextureLike>;
    } | null | undefined;
};
export type PbrLibraryListItem = {
    id: string;
    name: string | undefined;
    category: string | undefined;
    tileSize: number | undefined;
};
export type PbrLibraryStats = {
    /**
     * Cached material variants.
     */
    materials: number;
    /**
     * Cached textures.
     */
    textures: number;
    /**
     * Catalog entries.
     */
    entries: number;
};
export type PbrLibrary = {
    list: () => PbrLibraryListItem[];
    /**
     * Cached per (id, options).
     */
    get: (id: string, options?: PbrProjectionOptions) => Promise<PbrMaterialLike>;
    dispose: () => Promise<void>;
    /**
     * (getter)
     */
    stats: PbrLibraryStats;
};
