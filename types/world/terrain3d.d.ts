/**
 * Compute deterministic 2D fractal Brownian motion (plus optional ridged noise) in [-1, 1].
 * @param {number} x World X coordinate.
 * @param {number} z World Z coordinate.
 * @param {object} [options]
 * @param {number} [options.seed=1337]
 * @param {number} [options.octaves=4]
 * @param {number} [options.frequency=0.025]
 * @param {number} [options.lacunarity=2.05]
 * @param {number} [options.gain=0.5]
 * @param {number} [options.ridgeWeight=0.22]
 * @returns {number}
 */
export function fbmNoise2D(x: number, z: number, options?: {
    seed?: number | undefined;
    octaves?: number | undefined;
    frequency?: number | undefined;
    lacunarity?: number | undefined;
    gain?: number | undefined;
    ridgeWeight?: number | undefined;
} | undefined): number;
/**
 * @typedef {object} Terrain3DOptions
 * @property {number} [width=120] Terrain extent along X in world units.
 * @property {number} [depth=120] Terrain extent along Z in world units.
 * @property {number} [segmentsX=64] Grid columns along X.
 * @property {number} [segmentsZ=64] Grid rows along Z.
 * @property {number} [minHeight=-2] Lower height bound.
 * @property {number} [maxHeight=18] Upper height bound.
 * @property {number} [seaLevel=0] Sea/sand transition height.
 * @property {number} [centerX=0] World X center.
 * @property {number} [centerZ=0] World Z center.
 * @property {number} [seed=1337] Deterministic noise seed.
 * @property {number} [octaves=4] FBM octaves.
 * @property {number} [frequency=0.024] Base noise frequency.
 * @property {number} [lacunarity=2.05] FBM frequency multiplier.
 * @property {number} [gain=0.5] FBM amplitude multiplier.
 * @property {number} [ridgeWeight=0.22] Ridged blend weight (0..1).
 * @property {'none'|'island'|'bowl'} [edgeFalloff='none'] Optional radial edge shaping.
 * @property {number} [edgeStrength=0.85] Radial shaping intensity when edgeFalloff != 'none'.
 * @property {(x: number, z: number, baseHeight: number) => number} [heightFn] Optional custom height modifier.
 * @property {object} [palette] Biome hex/RGB colors (`sand`, `grass`, `rock`, `peak`).
 */
/**
 * Create a deterministic 3D heightfield terrain with exact mesh/physics height parity.
 * @param {Terrain3DOptions} [options]
 */
export function createHeightfieldTerrain3D(options?: Terrain3DOptions | undefined): Readonly<{
    width: number;
    depth: number;
    segmentsX: number;
    segmentsZ: number;
    centerX: number | undefined;
    centerZ: number | undefined;
    seaLevel: number | undefined;
    seed: number;
    minHeight: number;
    maxHeight: number;
    bounds: Readonly<{
        minX: number;
        maxX: number;
        minZ: number;
        maxZ: number;
        minY: number;
        maxY: number;
    }>;
    heights: Float32Array;
    sampleHeight: (x: any, z: any) => any;
    sampleNormal: (x: any, z: any, out?: {
        x: number;
        y: number;
        z: number;
    }) => {
        x: number;
        y: number;
        z: number;
    };
    sampleSlope: (x: any, z: any) => any;
    sampleBiome: (x: any, z: any) => "rock" | "sand" | "peak" | "grass";
    toRapierHeightfieldArray: () => Float32Array;
    buildGeometry: (THREE: any) => any;
    createMesh: (THREE: any, meshOptions?: {}) => {
        mesh: any;
        geometry: any;
        material: any;
        dispose(): void;
    };
    attachPhysics: (physicsWorld: any, physicsOptions?: {}) => {
        rigidBody: any;
        collider: any;
        bodyHandle: any;
        colliderHandle: any;
        dispose(): void;
    };
    scatterPositions: (scatterOptions?: {}) => {
        x: any;
        y: any;
        z: any;
        normal: {
            x: number;
            y: number;
            z: number;
        };
        slope: any;
        biome: string;
        yaw: number;
        scale: any;
    }[];
}>;
export type Terrain3DOptions = {
    /**
     * Terrain extent along X in world units.
     */
    width?: number | undefined;
    /**
     * Terrain extent along Z in world units.
     */
    depth?: number | undefined;
    /**
     * Grid columns along X.
     */
    segmentsX?: number | undefined;
    /**
     * Grid rows along Z.
     */
    segmentsZ?: number | undefined;
    /**
     * Lower height bound.
     */
    minHeight?: number | undefined;
    /**
     * Upper height bound.
     */
    maxHeight?: number | undefined;
    /**
     * Sea/sand transition height.
     */
    seaLevel?: number | undefined;
    /**
     * World X center.
     */
    centerX?: number | undefined;
    /**
     * World Z center.
     */
    centerZ?: number | undefined;
    /**
     * Deterministic noise seed.
     */
    seed?: number | undefined;
    /**
     * FBM octaves.
     */
    octaves?: number | undefined;
    /**
     * Base noise frequency.
     */
    frequency?: number | undefined;
    /**
     * FBM frequency multiplier.
     */
    lacunarity?: number | undefined;
    /**
     * FBM amplitude multiplier.
     */
    gain?: number | undefined;
    /**
     * Ridged blend weight (0..1).
     */
    ridgeWeight?: number | undefined;
    /**
     * Optional radial edge shaping.
     */
    edgeFalloff?: "none" | "island" | "bowl" | undefined;
    /**
     * Radial shaping intensity when edgeFalloff != 'none'.
     */
    edgeStrength?: number | undefined;
    /**
     * Optional custom height modifier.
     */
    heightFn?: ((x: number, z: number, baseHeight: number) => number) | undefined;
    /**
     * Biome hex/RGB colors (`sand`, `grass`, `rock`, `peak`).
     */
    palette?: object;
};
