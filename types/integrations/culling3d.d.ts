/**
 * 6-plane Gribb-Hartmann frustum culler with optional max draw distance cutoff.
 * @param {CullFrustumOptions} [options]
 * @returns {FrustumCuller3D}
 */
export function createFrustumCuller3D({ maxDistance }?: CullFrustumOptions | undefined): FrustumCuller3D;
/**
 * Software convex-cone AABB occlusion culler: rejects spheres strictly hidden behind
 * solid walls/buildings before rendering or stepping skeletal mixers.
 * @param {OcclusionCullerOptions} [options]
 * @returns {OcclusionCuller3D}
 */
export function createOcclusionCuller3D({ maxOccluders, maxTestedOccluders }?: OcclusionCullerOptions | undefined): OcclusionCuller3D;
/**
 * Optional non-blocking WebGL2 hardware conservative occlusion query pool
 * using ANY_SAMPLES_PASSED_CONSERVATIVE and multi-frame temporal grace.
 * @param {{[key: string]: unknown} | null | undefined} gl WebGL2 context (unsupported contexts yield `supported: false`).
 * @param {HardwareOcclusionPoolOptions} [options]
 * @returns {HardwareOcclusionPool}
 */
export function createHardwareOcclusionPool(gl: {
    [key: string]: unknown;
} | null | undefined, { maxQueries, graceFrames }?: HardwareOcclusionPoolOptions | undefined): HardwareOcclusionPool;
/**
 * Unified per-frame 3D Frustum + Occlusion culler service attached to Three adapter.
 * @param {SceneCullerOptions} [options]
 * @returns {SceneCuller3D}
 */
export function createSceneCuller3D({ maxDistance, occlusion, maxOccluders, gl, }?: SceneCullerOptions | undefined): SceneCuller3D;
/**
 * Dynamic GPU InstancedMesh pool (Unity-style Graphics.DrawMeshInstanced equivalent)
 * with O(1) slot alloc/free and per-frame frustum + occlusion compaction.
 * @param {InstancedBatchTHREE} THREE
 * @param {InstancedBatchOptions} options `geometry` and `material` are required.
 * @returns {InstancedBatch3D}
 */
export function createInstancedBatch3D(THREE: InstancedBatchTHREE, { geometry, material, capacity, castShadow, receiveShadow, perInstanceColor, cullRadius, }?: InstancedBatchOptions): InstancedBatch3D;
/**
 * Structural subset of THREE.Camera read by the cullers.
 */
export type CullCameraLike = {
    isCamera?: boolean | undefined;
    isOrthographicCamera?: boolean | undefined;
    /**
     * Three.js clip-space coordinate system.
     */
    coordinateSystem?: number | undefined;
    reversedDepth?: boolean | undefined;
    updateWorldMatrix?: ((updateParents: boolean, updateChildren: boolean) => void) | undefined;
    updateMatrixWorld?: ((force?: boolean) => void) | undefined;
    matrixWorldInverse?: {
        elements: ArrayLike<number>;
        copy?: (m: object) => unknown;
        invert?: () => unknown;
    } | undefined;
    /**
     * Column-major world matrix (translation at 12..14).
     */
    matrixWorld?: {
        elements: ArrayLike<number>;
    } | undefined;
    /**
     * Column-major projection matrix.
     */
    projectionMatrix?: {
        elements: ArrayLike<number>;
    } | undefined;
    /**
     * Fallback eye position.
     */
    position?: {
        x?: number;
        y?: number;
        z?: number;
    } | undefined;
};
export type CullFrustumOptions = {
    /**
     * Draw-distance cutoff in world units (non-positive/non-finite disables).
     */
    maxDistance?: number | undefined;
};
export type FrustumCuller3D = {
    /**
     * Getter; active draw-distance cutoff (Infinity = disabled).
     */
    maxDistance: number;
    /**
     * Getter; true once planes were extracted from a camera/matrix.
     */
    hasPlanes: boolean;
    /**
     * Getter; last camera world position (copy).
     */
    cameraPosition: {
        x: number;
        y: number;
        z: number;
    };
    /**
     * Sets the draw-distance cutoff in world units.
     */
    setMaxDistance: (value: number) => void;
    /**
     * Extracts planes from a column-major view-projection matrix (>= 16 numbers).
     */
    setFromProjectionMatrix: (m: ArrayLike<number>, zeroToOneDepth?: boolean) => boolean;
    /**
     * Updates planes and eye from a camera; false if unavailable.
     */
    updateFromCamera: (camera: CullCameraLike | null | undefined) => boolean;
    /**
     * True if the sphere may be visible.
     */
    intersectsSphere: (x: number, y: number, z: number, radius?: number) => boolean;
    /**
     * 0 = outside, 1 = intersecting, 2 = strictly inside.
     */
    classifySphere: (x: number, y: number, z: number, radius?: number) => number;
    /**
     * True if the AABB may be visible.
     */
    intersectsAABB: (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) => boolean;
};
export type OcclusionCullerOptions = {
    /**
     * Maximum registered occluders.
     */
    maxOccluders?: number | undefined;
    /**
     * Nearest occluders tested per frame.
     */
    maxTestedOccluders?: number | undefined;
};
export type OccluderAABBInput = {
    /**
     * Stable id (re-adding replaces); auto-generated when null.
     */
    id?: string | number | null | undefined;
    /**
     * Minimum corner in world units.
     */
    min: [number, number, number];
    /**
     * Maximum corner in world units.
     */
    max: [number, number, number];
};
/**
 * Collider description accepted by `setOccludersFromColliders`.
 */
export type OccluderCollider = {
    id?: string | number | null | undefined;
    /**
     * Sensors are skipped.
     */
    sensor?: boolean | undefined;
    /**
     * Full box size [x, y, z] in world units.
     */
    size?: ArrayLike<number> | undefined;
    /**
     * Box center [x, y, z] in world units.
     */
    center?: ArrayLike<number> | undefined;
};
export type OccluderFilterOptions = {
    /**
     * Minimum horizontal extent in world units.
     */
    minWidth?: number | undefined;
    /**
     * Minimum height in world units.
     */
    minHeight?: number | undefined;
};
export type OcclusionCuller3D = {
    /**
     * Getter; registered occluders.
     */
    occluderCount: number;
    /**
     * Getter; occluders active this frame.
     */
    activeCount: number;
    /**
     * Adds or replaces an occluder; returns its id. Throws past `maxOccluders`.
     */
    addOccluderAABB: (occluder: OccluderAABBInput) => string | number;
    /**
     * True if removed.
     */
    removeOccluder: (id: string | number) => boolean;
    /**
     * Removes all occluders.
     */
    clearOccluders: () => void;
    /**
     * Replaces occluders from large non-sensor boxes; returns the new count.
     */
    setOccludersFromColliders: (colliders: OccluderCollider[], options?: OccluderFilterOptions) => number;
    /**
     * Selects nearest in-frustum occluders; returns active count.
     */
    beginFrame: (camera: CullCameraLike | null | undefined, frustumCuller?: Pick<FrustumCuller3D, "intersectsAABB"> | null) => number;
    /**
     * True if the sphere is strictly hidden.
     */
    isSphereOccluded: (x: number, y: number, z: number, radius?: number) => boolean;
};
export type HardwareOcclusionPoolOptions = {
    /**
     * Maximum simultaneous query records.
     */
    maxQueries?: number | undefined;
    /**
     * Consecutive hidden frames required before reporting occluded.
     */
    graceFrames?: number | undefined;
};
export type HardwareOcclusionPool = {
    /**
     * Getter; true when WebGL2 conservative queries exist.
     */
    supported: boolean;
    /**
     * Getter; query record count.
     */
    size: number;
    /**
     * Polls a finished query and returns occluded state.
     */
    poll: (key: unknown) => boolean;
    /**
     * Starts a query (false if busy/unsupported).
     */
    beginQuery: (key: unknown) => boolean;
    /**
     * Ends the active query for `key`.
     */
    endQuery: (key: unknown) => boolean;
    /**
     * True after more than `graceFrames` hidden frames.
     */
    isOccluded: (key: unknown) => boolean;
    /**
     * Deletes the record; true if existed.
     */
    remove: (key: unknown) => boolean;
    /**
     * Releases queries; false if already disposed.
     */
    dispose: () => boolean;
};
export type SceneCullerOptions = {
    /**
     * Draw-distance cutoff in world units.
     */
    maxDistance?: number | undefined;
    /**
     * Enable software occlusion.
     */
    occlusion?: boolean | undefined;
    /**
     * Maximum occluders.
     */
    maxOccluders?: number | undefined;
    /**
     * WebGL2 context enabling hardware occlusion queries.
     */
    gl?: {
        [key: string]: unknown;
    } | null | undefined;
};
export type CullStats = {
    /**
     * Spheres tested this frame.
     */
    tested: number;
    /**
     * Rejected by frustum/distance.
     */
    frustumCulled: number;
    /**
     * Rejected by occlusion.
     */
    occluded: number;
    /**
     * Accepted.
     */
    visible: number;
};
export type SceneCuller3D = {
    frustum: FrustumCuller3D;
    occluder: OcclusionCuller3D;
    hardwarePool: HardwareOcclusionPool | null;
    /**
     * Getter.
     */
    occlusionEnabled: boolean;
    setOcclusionEnabled: (value: boolean) => void;
    setMaxDistance: (value: number) => void;
    addOccluderAABB: OcclusionCuller3D["addOccluderAABB"];
    removeOccluder: OcclusionCuller3D["removeOccluder"];
    clearOccluders: OcclusionCuller3D["clearOccluders"];
    setOccludersFromColliders: OcclusionCuller3D["setOccludersFromColliders"];
    /**
     * Resets stats and updates frustum/occluders.
     */
    beginFrame: (camera: CullCameraLike | null | undefined) => void;
    /**
     * True if visible.
     */
    testSphere: (x: number, y: number, z: number, radius?: number, hardwareKey?: unknown) => boolean;
    /**
     * 0 = outside, 1 = intersecting, 2 = strictly inside.
     */
    classifySphere: (x: number, y: number, z: number, radius?: number) => number;
    /**
     * Getter; copy of per-frame stats.
     */
    stats: CullStats;
    dispose: () => void;
};
/**
 * Minimal structural THREE.InstancedMesh used by the batch.
 */
export type InstancedMeshLike = {
    frustumCulled: boolean;
    castShadow: boolean;
    receiveShadow: boolean;
    /**
     * Rendered instance count.
     */
    count: number;
    instanceMatrix: InstanceBufferLike;
    instanceColor?: InstanceBufferLike | null | undefined;
    matrixWorld?: {
        elements: ArrayLike<number>;
    } | undefined;
    updateWorldMatrix?: ((updateParents: boolean, updateChildren: boolean) => void) | undefined;
    parent?: {
        remove?: (o: object) => unknown;
    } | null | undefined;
    dispose?: (() => void) | undefined;
};
export type InstanceBufferLike = {
    array: Float32Array;
    needsUpdate: boolean;
    clearUpdateRanges?: (() => void) | undefined;
    addUpdateRange?: ((start: number, count: number) => void) | undefined;
};
/**
 * Minimal THREE namespace subset used by the instanced batch.
 */
export type InstancedBatchTHREE = {
    InstancedMesh: new (geometry: object, material: object | object[], count: number) => InstancedMeshLike;
    InstancedBufferAttribute?: (new (array: Float32Array, itemSize: number) => {
        array: Float32Array;
        needsUpdate: boolean;
    }) | undefined;
};
export type InstancedBatchOptions = {
    /**
     * THREE.BufferGeometry (required).
     */
    geometry: object;
    /**
     * THREE material(s) (required).
     */
    material: object | object[];
    /**
     * Integer slot count in 1..100000.
     */
    capacity?: number | undefined;
    castShadow?: boolean | undefined;
    receiveShadow?: boolean | undefined;
    /**
     * Allocates an instance color buffer.
     */
    perInstanceColor?: boolean | undefined;
    /**
     * Default bounding-sphere radius in world units.
     */
    cullRadius?: number | undefined;
};
/**
 * Linear RGB 0..1.
 */
export type InstanceColor = [number, number, number] | {
    r: number;
    g: number;
    b: number;
};
export type InstanceAllocOptions = {
    /**
     * Position in batch-local coordinates.
     */
    x?: number | undefined;
    /**
     * Position in batch-local coordinates.
     */
    y?: number | undefined;
    /**
     * Position in batch-local coordinates.
     */
    z?: number | undefined;
    /**
     * Radians.
     */
    rotationX?: number | undefined;
    /**
     * Radians.
     */
    rotationY?: number | undefined;
    /**
     * Radians.
     */
    rotationZ?: number | undefined;
    /**
     * Uniform scale (default for the axes below).
     */
    scale?: number | undefined;
    scaleX?: number | undefined;
    scaleY?: number | undefined;
    scaleZ?: number | undefined;
    /**
     * Culling radius in world units (default batch `cullRadius`).
     */
    radius?: number | undefined;
    color?: InstanceColor | null | undefined;
    visible?: boolean | undefined;
};
export type InstancedBatchCuller = {
    testSphere: (x: number, y: number, z: number, radius?: number) => boolean;
};
export type InstancedBatchFlushOptions = {
    /**
     * E.g. a {@link SceneCuller3D}.
     */
    culler?: InstancedBatchCuller | null | undefined;
    /**
     * Called per visible instance with compacted index and slot id.
     */
    onVisible?: ((outIndex: number, slot: number) => void) | null | undefined;
};
export type InstancedBatchFlushResult = {
    /**
     * Allocated instances.
     */
    totalActive: number;
    /**
     * Instances written this flush.
     */
    visible: number;
    /**
     * Instances rejected by culling.
     */
    culled: number;
};
export type InstancedBatch3D = {
    /**
     * Underlying InstancedMesh.
     */
    mesh: InstancedMeshLike;
    /**
     * Slot count.
     */
    capacity: number;
    /**
     * Getter; allocated instances.
     */
    count: number;
    /**
     * Allocates a slot; returns its index or -1 when full.
     */
    alloc: (options?: InstanceAllocOptions) => number;
    /**
     * Position, Y rotation (rad), uniform scale.
     */
    setTransform: (idx: number, x: number, y: number, z: number, rotY?: number, scale?: number) => boolean;
    /**
     * Euler radians.
     */
    setRotation: (idx: number, rotX: number, rotY: number, rotZ: number) => boolean;
    setColor: (idx: number, r: number, g: number, b: number) => boolean;
    setVisible: (idx: number, value: boolean) => boolean;
    /**
     * Releases a slot.
     */
    free: (idx: number) => boolean;
    /**
     * Frees all slots.
     */
    clear: () => void;
    /**
     * Compacts visible instances into the GPU buffers.
     */
    flush: (options?: InstancedBatchFlushOptions) => InstancedBatchFlushResult;
    dispose: () => void;
};
export { GPU_CULL_WGSL, createGpuIndirectCuller3D } from "./gpu-indirect3d.js";
