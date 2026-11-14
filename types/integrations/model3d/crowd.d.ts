/**
 * Bakes Skeletal AnimationClips into a Vertex Animation Texture (VAT) RGBA Float DataTexture
 * and wraps geometry+material into a single-draw-call GPU InstancedMesh crowd.
 * @param {import('./helpers.js').Model3DThree} THREE Three.js namespace (needs `InstancedMesh`, `BufferGeometry`; VAT baking also needs `AnimationMixer`, `DataTexture`, `InstancedBufferAttribute`).
 * @param {InstancedCrowd3DOptions} [options] Crowd options.
 * @returns {InstancedCrowd3D} Crowd API.
 */
export function createInstancedCrowd3D(THREE: import("./helpers.js").Model3DThree, { asset, root, animations, capacity, sampleFps, castShadow, receiveShadow, perInstanceColor, cullRadius, scale, }?: InstancedCrowd3DOptions): InstancedCrowd3D;
/**
 * Minimal structural view of a Three.js object/geometry/material/texture used by the crowd.
 */
export type Model3DCrowdObject = {
    [member: string]: unknown;
};
/**
 * Options for {@link createInstancedCrowd3D}.
 */
export type InstancedCrowd3DOptions = {
    /**
     * Loaded asset (`scene` + `animations`).
     */
    asset?: import("./helpers.js").Model3DAsset | null;
    /**
     * Root object (alternative to `asset`).
     */
    root?: import("./helpers.js").Model3DObject | null;
    /**
     * Clips to bake (defaults to `asset.animations`).
     */
    animations?: import("./helpers.js").Model3DClip[] | null;
    /**
     * Maximum instances (integer 1..100000).
     */
    capacity?: number;
    /**
     * VAT bake sample rate in frames per second (clamped 4..60).
     */
    sampleFps?: number;
    /**
     * Instanced mesh casts shadows.
     */
    castShadow?: boolean;
    /**
     * Instanced mesh receives shadows.
     */
    receiveShadow?: boolean;
    /**
     * Enable per-instance color.
     */
    perInstanceColor?: boolean;
    /**
     * Per-instance bounding radius in world units (before scale).
     */
    cullRadius?: number;
    /**
     * Default per-instance uniform scale.
     */
    scale?: number;
};
/**
 * Options for {@link InstancedCrowd3D.spawn}.
 */
export type CrowdSpawnOptions = {
    /**
     * World X.
     */
    x?: number;
    /**
     * World Y.
     */
    y?: number;
    /**
     * World Z.
     */
    z?: number;
    /**
     * Yaw in radians.
     */
    rotationY?: number;
    /**
     * Uniform scale (defaults to the crowd `scale`).
     */
    scale?: number;
    /**
     * Clip name (defaults to the first baked clip).
     */
    clip?: string | null;
    /**
     * Start time in seconds.
     */
    time?: number;
    /**
     * Playback speed multiplier.
     */
    speed?: number;
    /**
     * Per-instance color (when `perInstanceColor`).
     */
    color?: {
        r: number;
        g: number;
        b: number;
    } | number | string | null;
};
/**
 * Options for {@link InstancedCrowd3D.play}.
 */
export type CrowdPlayOptions = {
    /**
     * Playback speed multiplier.
     */
    speed?: number;
    /**
     * Start at `phase` of the clip instead of 0.
     */
    randomizePhase?: boolean;
    /**
     * Normalized start phase 0..1 (used with `randomizePhase`).
     */
    phase?: number;
};
/**
 * Options for {@link InstancedCrowd3D.update}.
 */
export type CrowdUpdateOptions = {
    /**
     * Scene culler (see `createSceneCuller3D`) used to cull instances.
     */
    culler?: {
        [member: string]: unknown;
    } | null;
};
/**
 * Statistics returned by {@link InstancedCrowd3D.update}.
 */
export type CrowdUpdateStats = {
    /**
     * Allocated instances.
     */
    activeCount: number;
    /**
     * Instances that passed culling.
     */
    visibleCount: number;
    /**
     * Instances culled.
     */
    culledCount: number;
    /**
     * 1 when any instance is visible, else 0.
     */
    drawCalls: number;
};
/**
 * VAT bake metadata.
 */
export type CrowdVatInfo = {
    /**
     * Texture width in texels.
     */
    width: number;
    /**
     * Texture height in texels.
     */
    height: number;
    /**
     * Vertices per texture row.
     */
    stride: number;
    /**
     * Texture rows per baked frame.
     */
    rowsPerFrame: number;
    /**
     * Total baked frame slices.
     */
    totalFrames: number;
};
/**
 * Crowd API returned by {@link createInstancedCrowd3D}.
 */
export type InstancedCrowd3D = {
    /**
     * The InstancedMesh (single draw call).
     */
    mesh: Model3DCrowdObject;
    /**
     * Maximum instances.
     */
    capacity: number;
    /**
     * Baked VAT DataTexture, or null when baking was not possible (getter).
     */
    vatTexture: Model3DCrowdObject | null;
    /**
     * Copy of the VAT metadata (getter).
     */
    vatInfo: CrowdVatInfo | null;
    /**
     * Allocated instance count (getter).
     */
    count: number;
    /**
     * Baked clip names.
     */
    getClipNames: () => string[];
    /**
     * Allocates an instance; returns its index or -1 when full.
     */
    spawn: (options?: CrowdSpawnOptions) => number;
    /**
     * Sets position (world units), yaw (radians), and scale.
     */
    setTransform: (index: number, x: number, y: number, z: number, rotY?: number, scale?: number) => boolean;
    /**
     * Sets Euler rotation in radians.
     */
    setRotation: (index: number, rotX: number, rotY: number, rotZ: number) => boolean;
    /**
     * Sets per-instance color (0..1 channels).
     */
    setColor: (index: number, r: number, g: number, b: number) => boolean;
    /**
     * Switches an instance's clip.
     */
    play: (index: number, clipName: string, options?: CrowdPlayOptions) => boolean;
    /**
     * Flashes an instance white for `duration` seconds (default 0.08).
     */
    hitFlash: (index: number, duration?: number) => boolean;
    /**
     * Frees an instance.
     */
    kill: (index: number) => boolean;
    /**
     * Frees all instances.
     */
    clear: () => void;
    /**
     * Advances animation (`dt` seconds) and flushes instance data.
     */
    update: (dt?: number, options?: CrowdUpdateOptions) => CrowdUpdateStats;
    /**
     * Releases geometry, material, and texture.
     */
    dispose: () => void;
};
