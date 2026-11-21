/**
 * Create a GPU-driven culling & indirect draw helper with explicit backend capability detection
 * (`'webgpu-indirect' | 'webgl2-multidraw' | 'cpu-instanced'`) and dirty bounds range tracking.
 * @param {object} [options]
 * @param {any} [options.webgpuDevice=null] WebGPU GPUDevice supporting compute + indirect draw.
 * @param {any} [options.gl=null] WebGL2 context checked for `WEBGL_multi_draw`.
 * @param {{ testSphere?: (x: number, y: number, z: number, radius?: number) => boolean } | null} [options.cpuCuller=null]
 * @param {number} [options.maxInstances=65536]
 */
export function createGpuIndirectCuller3D({ webgpuDevice, gl, cpuCuller, maxInstances, }?: {
    webgpuDevice?: any;
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
    getStats(): Readonly<{
        mode: string;
        dispatchedInstances: number;
        visibleCount: number;
        indirectDraws: number;
        uploadedBytes: number;
        skippedStatic: boolean;
    }>;
    dispose: () => boolean;
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
    cull: (frustumPlanes: any, gpuIndirectCuller?: null) => number;
    getStats(): Readonly<{
        capacity: number;
        activeCount: number;
        visibleCount: number;
        culledOut: number;
        cullPasses: number;
        mode: string;
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
}>;
/**
 * GPU-driven frustum culling and indirect draw submission for WebGPU and WebGL2 multi-draw,
 * with explicit capability detection and CPU instanced fallback declaration.
 */
export const GPU_CULL_WGSL: "\nstruct FrustumUniforms {\n  planes: array<vec4<f32>, 6>,\n  instanceCount: u32,\n  _pad0: u32,\n  _pad1: u32,\n  _pad2: u32,\n};\n\nstruct DrawIndexedIndirectArgs {\n  indexCount: u32,\n  instanceCount: atomic<u32>,\n  firstIndex: u32,\n  baseVertex: i32,\n  firstInstance: u32,\n};\n\n@group(0) @binding(0) var<uniform> uFrustum: FrustumUniforms;\n@group(0) @binding(1) var<storage, read> bBounds: array<vec4<f32>>;\n@group(0) @binding(2) var<storage, read_write> bVisibleIndices: array<u32>;\n@group(0) @binding(3) var<storage, read_write> bDrawArgs: DrawIndexedIndirectArgs;\n\n@compute @workgroup_size(64)\nfn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n  let idx = gid.x;\n  if (idx >= uFrustum.instanceCount) {\n    return;\n  }\n  let sphere = bBounds[idx];\n  let radius = sphere.w;\n  if (radius <= 0.0) {\n    return;\n  }\n  for (var i: u32 = 0u; i < 6u; i = i + 1u) {\n    let p = uFrustum.planes[i];\n    if (dot(p.xyz, sphere.xyz) + p.w < -radius) {\n      return;\n    }\n  }\n  let outSlot = atomicAdd(&bDrawArgs.instanceCount, 1u);\n  bVisibleIndices[outSlot] = idx;\n}\n";
export const GPU_HIZ_OCCLUSION_WGSL: "\nstruct HiZParams {\n  screenSize: vec2<f32>,\n  mipCount: u32,\n  objectCount: u32,\n};\n\n@group(0) @binding(0) var<uniform> uHiZ: HiZParams;\n@group(0) @binding(1) var<storage, read> bScreenAabbs: array<vec4<f32>>;\n@group(0) @binding(2) var<storage, read> bMinDepths: array<f32>;\n@group(0) @binding(3) var tHiZ: texture_2d<f32>;\n@group(0) @binding(4) var<storage, read_write> bVisibility: array<u32>;\n\n@compute @workgroup_size(64)\nfn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n  let idx = gid.x;\n  if (idx >= uHiZ.objectCount) { return; }\n  let aabb = bScreenAabbs[idx];\n  let span = max((aabb.z - aabb.x) * uHiZ.screenSize.x, (aabb.w - aabb.y) * uHiZ.screenSize.y);\n  let mip = min(uHiZ.mipCount - 1u, u32(ceil(log2(max(1.0, span)))));\n  let dim = vec2<i32>(max(vec2<f32>(1.0), floor(uHiZ.screenSize / f32(1u << mip))));\n  let uv = clamp((aabb.xy + aabb.zw) * 0.5, vec2<f32>(0.0), vec2<f32>(0.9999));\n  let texel = clamp(vec2<i32>(uv * vec2<f32>(dim)), vec2<i32>(0), dim - vec2<i32>(1));\n  let maxOccDepth = textureLoad(tHiZ, texel, i32(mip)).r;\n  bVisibility[idx] = select(0u, 1u, bMinDepths[idx] <= maxOccDepth + 1e-4);\n}\n";
