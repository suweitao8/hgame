/**
 * Packs `[yaw(10b), animId(4b), animSeed(10b), flags(8b)]` into a single 32-bit uint
 * matching `CrowdInstance16B` (`pos Float32x3 + packed Uint32`).
 * @param {number} yawRad Yaw in radians `[0, 2π)`.
 * @param {number} [animId=0] Animation index `0..15`.
 * @param {number} [animSeed=0] Normalized phase seed in `[0, 1)` or integer `0..1023`.
 * @param {number} [flags=0] Status/faction/tint byte `0..255`.
 * @returns {number} Unsigned 32-bit integer.
 */
export function packCrowdInstanceBitfield(yawRad: number, animId?: number | undefined, animSeed?: number | undefined, flags?: number | undefined): number;
/**
 * Decodes a 32-bit `CrowdInstance16B` packed field back into its components.
 * @param {number} packedUint32
 * @returns {{ yawRad: number, animId: number, animSeed: number, flags: number }}
 */
export function unpackCrowdInstanceBitfield(packedUint32: number): {
    yawRad: number;
    animId: number;
    animSeed: number;
    flags: number;
};
/**
 * Builds a tight 8-vertex / 6-triangle beveled octagon Impostor polygon (`LOD3`)
 * cutting 40–60% transparent overdraw compared to a 2-triangle rectangle quad.
 * @param {import('./helpers.js').Model3DThree} THREE
 * @param {{ width?: number, height?: number }} [options]
 * @returns {object}
 */
export function buildTightImpostorGeometry(THREE: import("./helpers.js").Model3DThree, { width, height }?: {
    width?: number;
    height?: number;
} | undefined): object;
/**
 * Encodes a finite JS number to IEEE-754 binary16 (uint16), clamping large finite values
 * to `+/-65504` (`0x7bff` / `0xfbff`) to avoid overflowing to Infinity in Bone-VAT texels.
 * @param {number} value
 * @returns {number} 16-bit half-float bits (`0..65535`).
 */
export function float32ToFloat16(value: number): number;
/**
 * Decodes an IEEE-754 binary16 uint16 back to a JavaScript float.
 * @param {number} bits 16-bit half-float bits (`0..65535`).
 * @returns {number}
 */
export function float16ToFloat32(bits: number): number;
/**
 * Bakes skeletal AnimationClips into a compact Half-Float Bone-VAT texture (`2 * boneCount` texels wide)
 * with hemisphere-continuous quaternions so frame lerp never flips along the long arc.
 * @param {import('./helpers.js').Model3DThree} THREE
 * @param {BakeBoneVatOptions} [options]
 * @returns {BoneVatBakedData}
 */
export function bakeBoneVatData(THREE: import("./helpers.js").Model3DThree, { asset, root, animations, sampleFps, }?: BakeBoneVatOptions | undefined): BoneVatBakedData;
/**
 * Serializes a {@link BoneVatBakedData} struct into a compact `.vat.bin` ArrayBuffer (`"HVAT"` header + JSON metadata + Uint16 half-float texels).
 * @param {BoneVatBakedData} baked
 * @returns {ArrayBuffer}
 */
export function encodeBoneVatBinary(baked: BoneVatBakedData): ArrayBuffer;
/**
 * Decodes an `"HVAT"` binary ArrayBuffer produced by {@link encodeBoneVatBinary}.
 * @param {ArrayBuffer | Uint8Array} input
 * @returns {BoneVatBakedData}
 */
export function decodeBoneVatBinary(input: ArrayBuffer | Uint8Array): BoneVatBakedData;
/**
 * Zero-dependency spatial vertex-clustering geometry simplifier for `LOD1`, preserving UVs, normals,
 * and collapsing `skinIndex`/`skinWeight` down to a single dominant bone per vertex (75% fewer VAT fetches).
 * @param {import('./helpers.js').Model3DThree} THREE
 * @param {object} geometry Source `THREE.BufferGeometry`.
 * @param {SimplifyLodOptions} [options]
 * @returns {object} Simplified geometry (or dominant-bone clone when triangle count is already tiny).
 */
export function buildSimplifiedLodGeometry(THREE: import("./helpers.js").Model3DThree, geometry: object, { gridResolution }?: SimplifyLodOptions | undefined): object;
/**
 * @typedef {object} BoneVatCrowd3DOptions
 * @property {import('./helpers.js').Model3DAsset | null} [asset=null] Loaded asset (`scene` + `animations`).
 * @property {import('./helpers.js').Model3DObject | null} [root=null] Alternative Object3D root.
 * @property {import('./helpers.js').Model3DClip[] | null} [animations=null] Clips overriding `asset.animations`.
 * @property {BoneVatBakedData | null} [vatData=null] Pre-baked Half-Float Bone-VAT (e.g. from `decodeBoneVatBinary`).
 * @property {object | null} [lod0Geometry=null] Custom LOD0 BufferGeometry override.
 * @property {object | null} [lod1Geometry=null] Custom LOD1 BufferGeometry override.
 * @property {object | null} [material=null] Base material cloned across LOD0/LOD1.
 * @property {object | null} [impostorTexture=null] Optional 8-direction billboard atlas (`impostorCols x impostorRows`).
 * @property {number} [impostorCols=8] Columns (azimuth sectors) in impostor atlas.
 * @property {number} [impostorRows=8] Rows (animation frames) in impostor atlas.
 * @property {number} [capacity=20000] Maximum instances (integer `1..262144`).
 * @property {number} [sampleFps=30] Bake sample FPS when `vatData` is not supplied.
 * @property {number} [lod1Distance=25] World distance threshold switching LOD0 -> LOD1.
 * @property {number} [lod2Distance=80] World distance threshold switching LOD1 -> LOD2 impostor.
 * @property {number} [lodHysteresis=0.1] Fractional CPU LOD margin on either side of a threshold (`0..0.5`).
 * @property {number} [maxDistance=240] Far draw cutoff (`<= 0` disables).
 * @property {number} [cullRadius=1.2] Culling radius before applying crowd scale and the group's world transform.
 * @property {number} [baseY=0] Ground Y offset in crowd-local units.
 * @property {number} [scale=1] Global uniform crowd scale.
 * @property {boolean} [castShadow=false] Whether LOD0/LOD1 meshes cast shadows.
 * @property {boolean} [receiveShadow=true] Whether LOD meshes receive shadows.
 */
/**
 * @typedef {object} BoneVatSpawnOptions
 * @property {number} [x=0] Crowd-local horizontal position.
 * @property {number} [y=0] Ignored per-instance (uses shared `baseY`); retained for API symmetry.
 * @property {number} [z=0] Crowd-local depth position.
 * @property {number} [rotationY=0]
 * @property {string | null} [clip=null]
 * @property {number} [time=0]
 * @property {number} [speed=1]
 */
/**
 * @typedef {object} BoneVatUpdateOptions
 * @property {object | null} [camera=null] Three.js camera for LOD distances + azimuth.
 * @property {{ testSphere?: (x: number, y: number, z: number, r?: number) => boolean, classifySphere?: (x: number, y: number, z: number, r?: number) => number, frustum?: { cameraPosition?: { x: number, y: number, z: number } } } | null} [culler=null] Optional SceneCuller3D.
 */
/**
 * @typedef {object} BoneVatSyncSwarmOptions
 * @property {object | null} [camera=null]
 * @property {{ testSphere?: (x: number, y: number, z: number, r?: number) => boolean, classifySphere?: (x: number, y: number, z: number, r?: number) => number, frustum?: { cameraPosition?: { x: number, y: number, z: number } } } | null} [culler=null]
 * @property {string[] | null} [clipNames=null] Optional mapping from numeric `swarm.animClip[id]` to clip names.
 */
/**
 * @typedef {object} BoneVatSyncGpuSwarmOptions
 * @property {number} [lod0Count=2000] Number of leading GPU instances rendered as full 4-bone LOD0.
 * @property {number} [lod1Count=12000] Number of subsequent GPU instances rendered as 1-bone LOD1.
 */
/**
 * @typedef {object} BoneVatCrowdStats
 * @property {number} activeCount
 * @property {number} visibleCount
 * @property {number} culledCount
 * @property {[number, number, number]} lodCounts Visible `[lod0, lod1, lod2]` counts.
 * @property {number} drawCalls Total active LOD draw calls (`0..3`).
 * @property {number} uploadedBytes Packed instance bytes scheduled by this call, excluding buffer creation.
 */
/**
 * @typedef {object} BoneVatCrowd3D
 * @property {object} group `THREE.Group` holding `[lod0Mesh, lod1Mesh, lod2Mesh]`.
 * @property {object} mesh Alias getter returning `group` (for drop-in compatibility with `world.add(crowd.mesh)`).
 * @property {[object, object, object]} lodMeshes Individual Three.js Meshes `[lod0, lod1, lod2]`.
 * @property {number} capacity
 * @property {object | null} vatTexture
 * @property {{ width: number, height: number, boneCount: number, sampleFps: number, totalFrames: number, byteLength: number }} vatInfo
 * @property {number} count Getter; live spawned count.
 * @property {() => string[]} getClipNames
 * @property {(options?: BoneVatSpawnOptions) => number} spawn
 * @property {(index: number) => { x: number, y: number, z: number, rotationY: number } | null} getTransform
 * @property {(index: number, x: number, y: number, z: number, rotY?: number) => boolean} setTransform
 * @property {(index: number, clipName: string, options?: { speed?: number, randomizePhase?: boolean, phase?: number }) => boolean} play
 * @property {(index: number, clipName: string, time: number, speed?: number) => boolean} setPlayback Sample a named clip at an explicit time in seconds. Speed defaults to zero for an external clock.
 * @property {(index: number, enabled: boolean) => boolean} setDistanceFallback Allow a standalone slot to draw past maxDistance while a replacement is unavailable. Frustum and occlusion culling still apply.
 * @property {(index: number, duration?: number) => boolean} hitFlash
 * @property {(index: number) => boolean} kill
 * @property {() => void} clear
 * @property {(fn: (material: object, lodIndex: number) => void) => void} applyToMaterials
 * @property {(dt?: number, options?: BoneVatUpdateOptions) => BoneVatCrowdStats} update
 * @property {(swarm: import('../../world/swarm-ecs.js').SwarmSimulation, options?: BoneVatSyncSwarmOptions) => BoneVatCrowdStats} syncFromSwarm
 * @property {(gpuSwarm: import('../../world/gpu-swarm-webgl2.js').GpuSwarmWebGL2, options?: BoneVatSyncGpuSwarmOptions) => BoneVatCrowdStats} syncFromGpuSwarm
 * @property {() => void} dispose
 */
/**
 * High-density 3D GPU Crowd powered by Half-Float Bone-VAT, 16-Byte packed instances,
 * and automatic 3-level distance LOD (`LOD0` 4-bone / `LOD1` simplified 1-bone / `LOD2` 8-direction billboard).
 * @param {import('./helpers.js').Model3DThree} THREE
 * @param {BoneVatCrowd3DOptions} [options]
 * @returns {BoneVatCrowd3D}
 */
export function createBoneVatCrowd3D(THREE: import("./helpers.js").Model3DThree, { asset, root, animations, vatData, lod0Geometry, lod1Geometry, lod2Geometry, lod3Geometry, material, impostorTexture, impostorCols, impostorRows, capacity, sampleFps, lodMode, qualityTier, bucketLimits, screenThresholds, lod1Distance, lod2Distance, lodHysteresis, maxDistance, cullRadius, baseY, scale, castShadow, receiveShadow, lod4PointFallbackBillboard, mobileMacroBatch, }?: BoneVatCrowd3DOptions | undefined): BoneVatCrowd3D;
/**
 * T5 Unified Crowd Bucket Hard Caps (per HGame 3D Model & 100k Crowd Spec).
 * Instances overflowing a full high-detail bucket cascade down into the next LOD bucket.
 */
export const T5_CROWD_BUCKET_LIMITS: Readonly<{
    pc: readonly number[];
    mobile: readonly number[];
}>;
/**
 * T5 Screen Height Ratio LOD thresholds (`projectedBoundingSphereHeightPx / viewportHeightPx`)
 * with 1.12x upward hysteresis.
 */
export const T5_LOD_SCREEN_THRESHOLDS: Readonly<{
    lod1: 0.16;
    lod2: 0.07;
    lod3: 0.025;
    lod4: 0.012;
    hysteresis: 1.12;
}>;
export type BoneVatClipMeta = {
    name: string;
    startFrame: number;
    frames: number;
    duration: number;
};
export type BoneVatBakedData = {
    /**
     * Half-float RGBA pixel array (`width * height * 4`), 2 texels per bone (`[tx,ty,tz,scale]`, `[qx,qy,qz,qw]`).
     */
    data: Uint16Array;
    /**
     * Float32 RGBA mirror (`width * height * 4`) for fallback WebGL backends without HalfFloat textures.
     */
    floatData: Float32Array;
    /**
     * Texture width in texels (`boneCount * 2`).
     */
    width: number;
    /**
     * Total baked frame rows across all clips.
     */
    height: number;
    /**
     * Number of bones encoded per frame.
     */
    boneCount: number;
    /**
     * Sampling FPS used during bake.
     */
    sampleFps: number;
    /**
     * Identical to `height`.
     */
    totalFrames: number;
    /**
     * Baked clip frame slices.
     */
    clips: BoneVatClipMeta[];
    /**
     * Base mesh world bounds.
     */
    bounds: import("./helpers.js").Model3DBounds;
};
export type BakeBoneVatOptions = {
    /**
     * Loaded GLTF asset (`scene` + `animations`).
     */
    asset?: import("./helpers.js").Model3DAsset | null | undefined;
    /**
     * Alternative root Object3D.
     */
    root?: import("./helpers.js").Model3DObject | null | undefined;
    /**
     * Clips overriding `asset.animations`.
     */
    animations?: import("./helpers.js").Model3DClip[] | null | undefined;
    /**
     * Bake sample rate in FPS (clamped `4..60`).
     */
    sampleFps?: number | undefined;
};
export type SimplifyLodOptions = {
    /**
     * Voxel clustering resolution per axis for LOD1 reduction (integer >= 2).
     */
    gridResolution?: number | undefined;
};
export type BoneVatCrowd3DOptions = {
    /**
     * Loaded asset (`scene` + `animations`).
     */
    asset?: import("./helpers.js").Model3DAsset | null | undefined;
    /**
     * Alternative Object3D root.
     */
    root?: import("./helpers.js").Model3DObject | null | undefined;
    /**
     * Clips overriding `asset.animations`.
     */
    animations?: import("./helpers.js").Model3DClip[] | null | undefined;
    /**
     * Pre-baked Half-Float Bone-VAT (e.g. from `decodeBoneVatBinary`).
     */
    vatData?: BoneVatBakedData | null | undefined;
    /**
     * Custom LOD0 BufferGeometry override.
     */
    lod0Geometry?: object | null;
    /**
     * Custom LOD1 BufferGeometry override.
     */
    lod1Geometry?: object | null;
    /**
     * Base material cloned across LOD0/LOD1.
     */
    material?: object | null;
    /**
     * Optional 8-direction billboard atlas (`impostorCols x impostorRows`).
     */
    impostorTexture?: object | null;
    /**
     * Columns (azimuth sectors) in impostor atlas.
     */
    impostorCols?: number | undefined;
    /**
     * Rows (animation frames) in impostor atlas.
     */
    impostorRows?: number | undefined;
    /**
     * Maximum instances (integer `1..262144`).
     */
    capacity?: number | undefined;
    /**
     * Bake sample FPS when `vatData` is not supplied.
     */
    sampleFps?: number | undefined;
    /**
     * World distance threshold switching LOD0 -> LOD1.
     */
    lod1Distance?: number | undefined;
    /**
     * World distance threshold switching LOD1 -> LOD2 impostor.
     */
    lod2Distance?: number | undefined;
    /**
     * Fractional CPU LOD margin on either side of a threshold (`0..0.5`).
     */
    lodHysteresis?: number | undefined;
    /**
     * Far draw cutoff (`<= 0` disables).
     */
    maxDistance?: number | undefined;
    /**
     * Culling radius before applying crowd scale and the group's world transform.
     */
    cullRadius?: number | undefined;
    /**
     * Ground Y offset in crowd-local units.
     */
    baseY?: number | undefined;
    /**
     * Global uniform crowd scale.
     */
    scale?: number | undefined;
    /**
     * Whether LOD0/LOD1 meshes cast shadows.
     */
    castShadow?: boolean | undefined;
    /**
     * Whether LOD meshes receive shadows.
     */
    receiveShadow?: boolean | undefined;
};
export type BoneVatSpawnOptions = {
    /**
     * Crowd-local horizontal position.
     */
    x?: number | undefined;
    /**
     * Ignored per-instance (uses shared `baseY`); retained for API symmetry.
     */
    y?: number | undefined;
    /**
     * Crowd-local depth position.
     */
    z?: number | undefined;
    rotationY?: number | undefined;
    clip?: string | null | undefined;
    time?: number | undefined;
    speed?: number | undefined;
};
export type BoneVatUpdateOptions = {
    /**
     * Three.js camera for LOD distances + azimuth.
     */
    camera?: object | null;
    /**
     * Optional SceneCuller3D.
     */
    culler?: {
        testSphere?: (x: number, y: number, z: number, r?: number) => boolean;
        classifySphere?: (x: number, y: number, z: number, r?: number) => number;
        frustum?: {
            cameraPosition?: {
                x: number;
                y: number;
                z: number;
            };
        };
    } | null | undefined;
};
export type BoneVatSyncSwarmOptions = {
    camera?: object | null;
    culler?: {
        testSphere?: (x: number, y: number, z: number, r?: number) => boolean;
        classifySphere?: (x: number, y: number, z: number, r?: number) => number;
        frustum?: {
            cameraPosition?: {
                x: number;
                y: number;
                z: number;
            };
        };
    } | null | undefined;
    /**
     * Optional mapping from numeric `swarm.animClip[id]` to clip names.
     */
    clipNames?: string[] | null | undefined;
};
export type BoneVatSyncGpuSwarmOptions = {
    /**
     * Number of leading GPU instances rendered as full 4-bone LOD0.
     */
    lod0Count?: number | undefined;
    /**
     * Number of subsequent GPU instances rendered as 1-bone LOD1.
     */
    lod1Count?: number | undefined;
};
export type BoneVatCrowdStats = {
    activeCount: number;
    visibleCount: number;
    culledCount: number;
    /**
     * Visible `[lod0, lod1, lod2]` counts.
     */
    lodCounts: [number, number, number];
    /**
     * Total active LOD draw calls (`0..3`).
     */
    drawCalls: number;
    /**
     * Packed instance bytes scheduled by this call, excluding buffer creation.
     */
    uploadedBytes: number;
};
export type BoneVatCrowd3D = {
    /**
     * `THREE.Group` holding `[lod0Mesh, lod1Mesh, lod2Mesh]`.
     */
    group: object;
    /**
     * Alias getter returning `group` (for drop-in compatibility with `world.add(crowd.mesh)`).
     */
    mesh: object;
    /**
     * Individual Three.js Meshes `[lod0, lod1, lod2]`.
     */
    lodMeshes: [object, object, object];
    capacity: number;
    vatTexture: object | null;
    vatInfo: {
        width: number;
        height: number;
        boneCount: number;
        sampleFps: number;
        totalFrames: number;
        byteLength: number;
    };
    /**
     * Getter; live spawned count.
     */
    count: number;
    getClipNames: () => string[];
    spawn: (options?: BoneVatSpawnOptions) => number;
    getTransform: (index: number) => {
        x: number;
        y: number;
        z: number;
        rotationY: number;
    } | null;
    setTransform: (index: number, x: number, y: number, z: number, rotY?: number) => boolean;
    play: (index: number, clipName: string, options?: {
        speed?: number;
        randomizePhase?: boolean;
        phase?: number;
    }) => boolean;
    /**
     * Sample a named clip at an explicit time in seconds. Speed defaults to zero for an external clock.
     */
    setPlayback: (index: number, clipName: string, time: number, speed?: number) => boolean;
    /**
     * Allow a standalone slot to draw past maxDistance while a replacement is unavailable. Frustum and occlusion culling still apply.
     */
    setDistanceFallback: (index: number, enabled: boolean) => boolean;
    hitFlash: (index: number, duration?: number) => boolean;
    kill: (index: number) => boolean;
    clear: () => void;
    applyToMaterials: (fn: (material: object, lodIndex: number) => void) => void;
    update: (dt?: number, options?: BoneVatUpdateOptions) => BoneVatCrowdStats;
    syncFromSwarm: (swarm: import("../../world/swarm-ecs.js").SwarmSimulation, options?: BoneVatSyncSwarmOptions) => BoneVatCrowdStats;
    syncFromGpuSwarm: (gpuSwarm: import("../../world/gpu-swarm-webgl2.js").GpuSwarmWebGL2, options?: BoneVatSyncGpuSwarmOptions) => BoneVatCrowdStats;
    dispose: () => void;
};
