/**
 * Create a GPU-driven culling & indirect draw helper with explicit backend capability detection
 * (`'webgpu-indirect' | 'webgl2-multidraw' | 'cpu-instanced'`) and dirty bounds range tracking.
 * @param {object} [options]
 * @param {any} [options.webgpuDevice=null] WebGPU GPUDevice supporting compute + indirect draw.
 * @param {any} [options.device=null] Alias for `webgpuDevice`.
 * @param {any} [options.gl=null] WebGL2 context checked for `WEBGL_multi_draw`.
 * @param {{ testSphere?: (x: number, y: number, z: number, radius?: number) => boolean } | null} [options.cpuCuller=null]
 * @param {number} [options.maxInstances=65536]
 */
export function createGpuIndirectCuller3D({ webgpuDevice, device, gl, cpuCuller, maxInstances, }?: {
    webgpuDevice?: any;
    device?: any;
    gl?: any;
    cpuCuller?: {
        testSphere?: (x: number, y: number, z: number, radius?: number) => boolean;
    } | null | undefined;
    maxInstances?: number | undefined;
} | undefined): {
    readonly mode: "webgpu-indirect" | "webgl2-multidraw" | "cpu-instanced";
    readonly fallbackReason: "No WebGPU device; using WebGL2 WEBGL_multi_draw batched submission" | "No WebGPU or WebGL2 context supplied; using CPU instanced culling fallback" | "WebGPU indirect & WEBGL_multi_draw unavailable; using CPU instanced culling fallback" | null;
    readonly capabilities: Readonly<{
        webgpuIndirect: boolean;
        webgl2MultiDraw: boolean;
        cpuInstancedFallback: true;
    }>;
    readonly wgslSource: string;
    readonly instanceCount: number;
    setInstanceBounds: (index: any, x: any, y: any, z: any, radius?: number) => boolean;
    setInstanceBoundsRange: (boundsArray: any, startIndex?: number, count?: number) => boolean;
    setInstanceCount: (count: any) => void;
    setFrustumPlanes: (planes: any) => boolean;
    execute: ({ commandEncoder, renderPassEncoder, indexCount, firstIndex, baseVertex, firstInstance, glMode, indicesType, counts, offsets, instanceCounts, drawCount, }?: {
        commandEncoder?: null | undefined;
        renderPassEncoder?: null | undefined;
        indexCount?: number | undefined;
        firstIndex?: number | undefined;
        baseVertex?: number | undefined;
        firstInstance?: number | undefined;
        glMode?: number | undefined;
        indicesType?: number | undefined;
        counts?: null | undefined;
        offsets?: null | undefined;
        instanceCounts?: null | undefined;
        drawCount?: number | undefined;
    }) => {
        mode: string;
        fallbackReason: string | null;
        visibleCount: number;
        indirectBuffer: any;
        visibleIndices?: undefined;
    } | {
        mode: string;
        fallbackReason: string | null;
        visibleCount: number;
        indirectBuffer?: undefined;
        visibleIndices?: undefined;
    } | {
        mode: string;
        fallbackReason: string | null;
        visibleCount: number;
        visibleIndices: Uint32Array;
        indirectBuffer?: undefined;
    };
    dispatchWebGpuCompute: ({ boundsData, instanceCount, frustumPlanes, indexCount, readback, }?: {
        boundsData?: null | undefined;
        instanceCount?: number | undefined;
        frustumPlanes?: null | undefined;
        indexCount?: number | undefined;
        readback?: boolean | undefined;
    }) => Promise<{
        mode: string;
        dispatched: number;
        visibleCount: number;
        visibleIndices: Uint32Array | null;
        workgroups: number;
    }>;
    submitComputeReadback: ({ indexCount, tag, view }?: {
        indexCount?: number;
        tag?: unknown;
        view?: object | null;
    } | undefined) => {
        submitted: boolean;
        serial: number;
    };
    getLatestResult: (tag?: unknown) => {
        serial: number;
        instanceCount: number;
        visibleCount: number;
        visibleIndices: Uint32Array;
        view: object | null;
    } | null;
    getStats(): Readonly<{
        mode: string;
        dispatchedInstances: number;
        visibleCount: number;
        indirectDraws: number;
        uploadedBytes: number;
        skippedStatic: boolean;
        readbackErrors: number;
        readbackSkipped: number;
    }>;
    dispose: () => boolean;
};
/**
 * Rotation between two camera poses, in radians. A pose is
 * `{ position: { x, y, z }, quaternion: { x, y, z, w } }` in world space.
 * @param {{ quaternion: { x: number, y: number, z: number, w: number } }} a
 * @param {{ quaternion: { x: number, y: number, z: number, w: number } }} b
 * @returns {number}
 */
export function cameraAngleBetween(a: {
    quaternion: {
        x: number;
        y: number;
        z: number;
        w: number;
    };
}, b: {
    quaternion: {
        x: number;
        y: number;
        z: number;
        w: number;
    };
}): number;
/**
 * How far a camera moved between two poses, in world units: the translation plus the arc the rotation
 * sweeps at `radius` (`2 * radius * sin(turn / 2)`).
 * @param {{ position: { x: number, y: number, z: number }, quaternion: { x: number, y: number, z: number, w: number } }} a
 * @param {{ position: { x: number, y: number, z: number }, quaternion: { x: number, y: number, z: number, w: number } }} b
 * @param {number} [radius=1]
 * @returns {number}
 */
export function cameraMotionBetween(a: {
    position: {
        x: number;
        y: number;
        z: number;
    };
    quaternion: {
        x: number;
        y: number;
        z: number;
        w: number;
    };
}, b: {
    position: {
        x: number;
        y: number;
        z: number;
    };
    quaternion: {
        x: number;
        y: number;
        z: number;
        w: number;
    };
}, radius?: number | undefined): number;
/**
 * Encloses a perspective frustum swept by a rotation and a translation of the camera at `pose`.
 * Uses normalized planes with the opposite horizontal and vertical pairs first, followed by the
 * depth planes in either order. The forward axis must be inside the view.
 * @param {ArrayLike<number>} planes 24 floats (6 vec4 planes), left unchanged.
 * @param {{ position: { x: number, y: number, z: number }, quaternion: { x: number, y: number, z: number, w: number } }} pose
 * @param {{ distance?: number, angle?: number }} [margin] `angle` in radians.
 * @param {Float64Array | Float32Array} [out]
 * @returns {{ planes: Float64Array | Float32Array, angle: number }} `angle` is the turn actually applied.
 */
export function widenFrustumPlanes(planes: ArrayLike<number>, pose: {
    position: {
        x: number;
        y: number;
        z: number;
    };
    quaternion: {
        x: number;
        y: number;
        z: number;
        w: number;
    };
}, { distance, angle }?: {
    distance?: number;
    angle?: number;
} | undefined, out?: Float64Array | Float32Array | undefined): {
    planes: Float64Array | Float32Array;
    angle: number;
};
/**
 * Real GPU-indirect & MultiDraw compacted InstancedMesh wrapper.
 * Culls per-instance bounding spheres through `gpuIndirectCuller`, compacts surviving
 * transform matrices contiguously into `InstancedMesh.instanceMatrix`, and sets `.count`.
 * @param {object} THREE
 * @param {object} options
 * @param {object} options.geometry
 * @param {object} options.material
 * @param {number} [options.capacity=1024]
 * @param {boolean} [options.castShadow=false]
 * @param {boolean} [options.receiveShadow=false]
 */
export function createIndirectInstancedBatch3D(THREE: object, { geometry, material, capacity, castShadow, receiveShadow, }?: {
    geometry: object;
    material: object;
    capacity?: number | undefined;
    castShadow?: boolean | undefined;
    receiveShadow?: boolean | undefined;
}): {
    readonly mesh: any;
    readonly capacity: number;
    readonly count: number;
    readonly visibleCount: number;
    setCount: (count: any) => number;
    setInstanceMatrix: (index: any, matrixOrElements: any) => boolean;
    setInstanceBounds: (index: any, x: any, y: any, z: any, radius?: number) => boolean;
    cull: (frustumPlanes: ArrayLike<number> | null | undefined, gpuIndirectCuller?: any, { view, predict }?: {
        predict?: boolean;
        view?: {
            id?: unknown;
            position: {
                x: number;
                y: number;
                z: number;
            };
            quaternion: {
                x: number;
                y: number;
                z: number;
                w: number;
            };
            projection?: ArrayLike<number>;
            distance?: number;
            angle?: number;
        } | null;
    } | undefined) => number;
    getStats(): Readonly<{
        capacity: number;
        activeCount: number;
        visibleCount: number;
        culledOut: number;
        cullPasses: number;
        mode: string;
        source: string;
        gpuReadbacks: number;
        readbackLag: number;
        unculledPasses: number;
    }>;
    dispose: () => void;
};
/**
 * Zero-GC CPU/WebGPU Hi-Z hierarchical depth pyramid occlusion culler (conservatively
 * downsampling max-depth mips from level 0 down to 1x1 so occluded meshes behind walls are culled).
 * @param {{ width?: number, height?: number }} [options]
 */
export function createHiZOcclusionCuller3D({ width, height }?: {
    width?: number;
    height?: number;
} | undefined): Readonly<{
    buildPyramid: (depthValues: any) => number;
    testScreenBounds: (minX: any, minY: any, maxX: any, maxY: any, minDepth: any) => boolean;
    resetStats: () => void;
    getStats: () => Readonly<{
        width: number;
        height: number;
        mipCount: number;
        tested: number;
        occluded: number;
    }>;
    getMipLevels: () => {
        width: any;
        height: any;
        data: any;
    }[];
}>;
/**
 * Hardware WebGPU Compute Stage 2 Hi-Z Occlusion Culler: uploads a full `r32float` depth pyramid
 * to `GPUTexture`, dispatches `GPU_HIZ_OCCLUSION_WGSL` across `objectCount` screen AABBs, and
 * optionally reads back per-object visibility bits (`1` = visible, `0` = occluded behind walls).
 * @param {{
 *   webgpuDevice?: any,
 *   screenAabbs: Float32Array,
 *   minDepths: Float32Array,
 *   hizDepthData: Float32Array,
 *   width?: number,
 *   height?: number,
 *   objectCount: number,
 *   readback?: boolean,
 * }} options
 */
export function dispatchWebGpuHiZOcclusion({ webgpuDevice, screenAabbs, minDepths, hizDepthData, width, height, objectCount, readback, }?: {
    webgpuDevice?: any;
    screenAabbs: Float32Array;
    minDepths: Float32Array;
    hizDepthData: Float32Array;
    width?: number;
    height?: number;
    objectCount: number;
    readback?: boolean;
}): Promise<{
    mode: string;
    dispatched: number;
    visibleCount: number;
    occludedCount: number;
    mipCount: number;
    visibility: Uint32Array | null;
}>;
/**
 * GPU-driven frustum culling and indirect draw submission for WebGPU and WebGL2 multi-draw,
 * with explicit capability detection and CPU instanced fallback declaration.
 */
export const GPU_CULL_WGSL: "\nstruct FrustumUniforms {\n  planes: array<vec4<f32>, 6>,\n  instanceCount: u32,\n  _pad0: u32,\n  _pad1: u32,\n  _pad2: u32,\n};\n\nstruct DrawIndexedIndirectArgs {\n  indexCount: u32,\n  instanceCount: atomic<u32>,\n  firstIndex: u32,\n  baseVertex: i32,\n  firstInstance: u32,\n};\n\n@group(0) @binding(0) var<uniform> uFrustum: FrustumUniforms;\n@group(0) @binding(1) var<storage, read> bBounds: array<vec4<f32>>;\n@group(0) @binding(2) var<storage, read_write> bVisibleIndices: array<u32>;\n@group(0) @binding(3) var<storage, read_write> bDrawArgs: DrawIndexedIndirectArgs;\n\n@compute @workgroup_size(64)\nfn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n  let idx = gid.x;\n  if (idx >= uFrustum.instanceCount) {\n    return;\n  }\n  let sphere = bBounds[idx];\n  let radius = sphere.w;\n  if (radius <= 0.0) {\n    return;\n  }\n  for (var i: u32 = 0u; i < 6u; i = i + 1u) {\n    let p = uFrustum.planes[i];\n    if (dot(p.xyz, sphere.xyz) + p.w < -radius) {\n      return;\n    }\n  }\n  let outSlot = atomicAdd(&bDrawArgs.instanceCount, 1u);\n  bVisibleIndices[outSlot] = idx;\n}\n";
export const GPU_HIZ_OCCLUSION_WGSL: "\nstruct HiZParams {\n  screenSize: vec2<f32>,\n  mipCount: u32,\n  objectCount: u32,\n};\n\n@group(0) @binding(0) var<uniform> uHiZ: HiZParams;\n@group(0) @binding(1) var<storage, read> bScreenAabbs: array<vec4<f32>>;\n@group(0) @binding(2) var<storage, read> bMinDepths: array<f32>;\n@group(0) @binding(3) var tHiZ: texture_2d<f32>;\n@group(0) @binding(4) var<storage, read_write> bVisibility: array<u32>;\n\n@compute @workgroup_size(64)\nfn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n  let idx = gid.x;\n  if (idx >= uHiZ.objectCount) { return; }\n  let aabb = bScreenAabbs[idx];\n  let span = max((aabb.z - aabb.x) * uHiZ.screenSize.x, (aabb.w - aabb.y) * uHiZ.screenSize.y);\n  let mip = min(uHiZ.mipCount - 1u, u32(ceil(log2(max(1.0, span * 0.5)))));\n  let dim = vec2<i32>(max(vec2<f32>(1.0), floor(uHiZ.screenSize / f32(1u << mip))));\n  let fdim = vec2<f32>(dim);\n  let t0 = clamp(vec2<i32>(floor(aabb.xy * fdim)), vec2<i32>(0), dim - vec2<i32>(1));\n  let t1 = clamp(vec2<i32>(floor((aabb.zw - vec2<f32>(1e-4)) * fdim)), t0, dim - vec2<i32>(1));\n  let d00 = textureLoad(tHiZ, t0, i32(mip)).r;\n  let d10 = textureLoad(tHiZ, vec2<i32>(t1.x, t0.y), i32(mip)).r;\n  let d01 = textureLoad(tHiZ, vec2<i32>(t0.x, t1.y), i32(mip)).r;\n  let d11 = textureLoad(tHiZ, t1, i32(mip)).r;\n  let maxOccDepth = max(max(d00, d10), max(d01, d11));\n  bVisibility[idx] = select(0u, 1u, bMinDepths[idx] <= maxOccDepth + 1e-4);\n}\n";
