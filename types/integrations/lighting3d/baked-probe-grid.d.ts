/** Check the same visibility conditions as the scene-light draw. */
export function getVisibleBakedProbeGrid(grid: any, world: any, camera: any): any;
/** Pack a versioned SH L2 asset for the native Three.js WebGL scene-light path. */
export function createBakedProbeGrid(THREE: any, renderer: any, data: BakedIrradianceProbeData): any;
export type BakedIrradianceProbeData = {
    /**
     * Probe asset format version.
     */
    schemaVersion: 1;
    /**
     * Minimum world-space corner of the grid.
     */
    min: readonly number[];
    /**
     * Maximum world-space corner of the grid.
     */
    max: readonly number[];
    /**
     * Probe counts on X, Y and Z. Probes are at cell centers.
     */
    resolution: readonly number[];
    /**
     * Linear SH L2, 9 RGB coefficients per probe. X changes fastest, then Y, then Z.
     */
    coefficients: ArrayLike<number>;
    /**
     * Scale baked irradiance and its coverage of screen-space diffuse GI.
     */
    intensity?: number | undefined;
};
