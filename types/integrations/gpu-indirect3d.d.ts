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
 * GPU-driven frustum culling and indirect draw submission for WebGPU and WebGL2 multi-draw,
 * with explicit capability detection and CPU instanced fallback declaration.
 */
export const GPU_CULL_WGSL: "\nstruct FrustumUniforms {\n  planes: array<vec4<f32>, 6>,\n  instanceCount: u32,\n  _pad0: u32,\n  _pad1: u32,\n  _pad2: u32,\n};\n\nstruct DrawIndexedIndirectArgs {\n  indexCount: u32,\n  instanceCount: atomic<u32>,\n  firstIndex: u32,\n  baseVertex: i32,\n  firstInstance: u32,\n};\n\n@group(0) @binding(0) var<uniform> uFrustum: FrustumUniforms;\n@group(0) @binding(1) var<storage, read> bBounds: array<vec4<f32>>;\n@group(0) @binding(2) var<storage, read_write> bVisibleIndices: array<u32>;\n@group(0) @binding(3) var<storage, read_write> bDrawArgs: DrawIndexedIndirectArgs;\n\n@compute @workgroup_size(64)\nfn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n  let idx = gid.x;\n  if (idx >= uFrustum.instanceCount) {\n    return;\n  }\n  let sphere = bBounds[idx];\n  let radius = sphere.w;\n  if (radius <= 0.0) {\n    return;\n  }\n  for (var i: u32 = 0u; i < 6u; i = i + 1u) {\n    let p = uFrustum.planes[i];\n    if (dot(p.xyz, sphere.xyz) + p.w < -radius) {\n      return;\n    }\n  }\n  let outSlot = atomicAdd(&bDrawArgs.instanceCount, 1u);\n  bVisibleIndices[outSlot] = idx;\n}\n";
