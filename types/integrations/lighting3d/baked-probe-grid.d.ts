/** Check the same visibility conditions as the scene-light draw. */
export function getVisibleBakedProbeGrid(grid: any, world: any, camera: any): any;
/** Pack a versioned SH L2 asset for the native Three.js WebGL scene-light path. */
export function createBakedProbeGrid(THREE: any, renderer: any, data: BakedIrradianceProbeData): any;
/**
 * Multi-cell streamed 3D baked irradiance probe volume manager with LRU residency eviction,
 * GPU texture cleanup, and smooth spatial + temporal cross-cell transition blending.
 *
 * @param {object} THREE Three.js namespace or compatible mock.
 * @param {object | null} [renderer=null] WebGLRenderer-compatible object for capability validation.
 * @param {StreamedProbeManagerOptions} [options]
 */
export function createStreamedProbeVolumeManager3D(THREE: object, renderer?: object | null, options?: StreamedProbeManagerOptions | undefined): {
    attachCell: (cellKey: any, data: any) => {
        key: string;
        active: boolean;
        evicted: never[];
        bytes?: undefined;
    } | {
        key: string;
        active: boolean;
        bytes: any;
        evicted: {
            key: any;
            bytes: any;
            reason: any;
            tick: number;
        }[];
    };
    detachCell: (cellKey: any) => boolean;
    touchCell: (cellKey: any) => boolean;
    evaluateAt: (position?: number[], dt?: number) => {
        position: number[];
        active: {
            key: any;
            weight: number;
            spatialWeight: any;
            fade: any;
            light: any;
        }[];
        totalWeight: number;
    };
    getCell: (cellKey: any) => {
        key: any;
        bytes: any;
        weight: any;
        spatialWeight: any;
        fade: any;
        lastUsedTick: any;
        light: any;
    } | null;
    getStats: () => {
        cellCount: number;
        totalBytes: number;
        maxCells: number;
        maxBytes: number;
        evictedCount: number;
        lastEvictionReason: any;
        evictions: any[];
    };
    dispose: () => boolean;
};
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
export type StreamedProbeManagerOptions = {
    /**
     * Maximum simultaneously resident probe cells.
     */
    maxCells?: number | undefined;
    /**
     * Maximum SH 3D texture byte budget across resident cells.
     */
    maxBytes?: number | undefined;
    /**
     * Smooth spatial blend margin outside cell bounds (world units).
     */
    blendMargin?: number | undefined;
    /**
     * Temporal fade-in duration when a probe cell attaches.
     */
    transitionSeconds?: number | undefined;
    /**
     * Optional Three.js scene/world that hosts attached probe lights.
     */
    scene?: object | null;
};
