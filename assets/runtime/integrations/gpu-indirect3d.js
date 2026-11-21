/**
 * GPU-driven frustum culling and indirect draw submission for WebGPU and WebGL2 multi-draw,
 * with explicit capability detection and CPU instanced fallback declaration.
 */

export const GPU_CULL_WGSL = /* wgsl */ `
struct FrustumUniforms {
  planes: array<vec4<f32>, 6>,
  instanceCount: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

struct DrawIndexedIndirectArgs {
  indexCount: u32,
  instanceCount: atomic<u32>,
  firstIndex: u32,
  baseVertex: i32,
  firstInstance: u32,
};

@group(0) @binding(0) var<uniform> uFrustum: FrustumUniforms;
@group(0) @binding(1) var<storage, read> bBounds: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> bVisibleIndices: array<u32>;
@group(0) @binding(3) var<storage, read_write> bDrawArgs: DrawIndexedIndirectArgs;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= uFrustum.instanceCount) {
    return;
  }
  let sphere = bBounds[idx];
  let radius = sphere.w;
  if (radius <= 0.0) {
    return;
  }
  for (var i: u32 = 0u; i < 6u; i = i + 1u) {
    let p = uFrustum.planes[i];
    if (dot(p.xyz, sphere.xyz) + p.w < -radius) {
      return;
    }
  }
  let outSlot = atomicAdd(&bDrawArgs.instanceCount, 1u);
  bVisibleIndices[outSlot] = idx;
}
`;

const WEBGPU_BUFFER_USAGE = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
};

/**
 * Create a GPU-driven culling & indirect draw helper with explicit backend capability detection
 * (`'webgpu-indirect' | 'webgl2-multidraw' | 'cpu-instanced'`) and dirty bounds range tracking.
 * @param {object} [options]
 * @param {any} [options.webgpuDevice=null] WebGPU GPUDevice supporting compute + indirect draw.
 * @param {any} [options.gl=null] WebGL2 context checked for `WEBGL_multi_draw`.
 * @param {{ testSphere?: (x: number, y: number, z: number, radius?: number) => boolean } | null} [options.cpuCuller=null]
 * @param {number} [options.maxInstances=65536]
 */
export function createGpuIndirectCuller3D({
  webgpuDevice = null,
  gl = null,
  cpuCuller = null,
  maxInstances = 65536,
} = {}) {
  if (!Number.isSafeInteger(maxInstances) || maxInstances < 1) {
    throw new RangeError('maxInstances must be a positive integer');
  }

  const hasWebGpuCompute = Boolean(
    webgpuDevice &&
    typeof webgpuDevice.createShaderModule === 'function' &&
    typeof webgpuDevice.createComputePipeline === 'function' &&
    typeof webgpuDevice.createBuffer === 'function' &&
    typeof webgpuDevice.queue?.writeBuffer === 'function'
  );
  const multiDrawExt = !hasWebGpuCompute && gl?.getExtension?.('WEBGL_multi_draw') || null;
  const hasMultiDraw = Boolean(
    multiDrawExt &&
    (typeof multiDrawExt.multiDrawElementsInstancedWEBGL === 'function' ||
     typeof multiDrawExt.multiDrawElementsWEBGL === 'function' ||
     typeof multiDrawExt.multiDrawArraysWEBGL === 'function')
  );

  const mode = hasWebGpuCompute
    ? 'webgpu-indirect'
    : hasMultiDraw
      ? 'webgl2-multidraw'
      : 'cpu-instanced';

  const fallbackReason = mode === 'webgpu-indirect'
    ? null
    : mode === 'webgl2-multidraw'
      ? 'No WebGPU device; using WebGL2 WEBGL_multi_draw batched submission'
      : !webgpuDevice && !gl
        ? 'No WebGPU or WebGL2 context supplied; using CPU instanced culling fallback'
        : 'WebGPU indirect & WEBGL_multi_draw unavailable; using CPU instanced culling fallback';

  const capabilities = Object.freeze({
    webgpuIndirect: hasWebGpuCompute,
    webgl2MultiDraw: hasMultiDraw,
    cpuInstancedFallback: true,
  });

  const bounds = new Float32Array(maxInstances * 4);
  const frustumData = new Float32Array(28); // 6 vec4 planes + 4 uint/f32 header slots
  const frustumU32 = new Uint32Array(frustumData.buffer);
  const indirectHeader = new Uint32Array(5); // indexCount, instanceCount, firstIndex, baseVertex, firstInstance
  const indirectI32 = new Int32Array(indirectHeader.buffer);
  const visibleIndices = new Uint32Array(maxInstances);

  let activeCount = 0;
  let dirtyMin = Infinity;
  let dirtyMax = -1;
  let frustumDirty = true;
  let disposed = false;

  const stats = {
    mode,
    dispatchedInstances: 0,
    visibleCount: 0,
    indirectDraws: 0,
    uploadedBytes: 0,
    skippedStatic: false,
  };

  let gpuResources = null;
  if (mode === 'webgpu-indirect') {
    const shaderModule = webgpuDevice.createShaderModule({ code: GPU_CULL_WGSL });
    const pipeline = webgpuDevice.createComputePipeline({
      layout: 'auto',
      compute: { module: shaderModule, entryPoint: 'main' },
    });
    const uniformBuffer = webgpuDevice.createBuffer({
      size: frustumData.byteLength,
      usage: WEBGPU_BUFFER_USAGE.UNIFORM | WEBGPU_BUFFER_USAGE.COPY_DST,
    });
    const boundsBuffer = webgpuDevice.createBuffer({
      size: bounds.byteLength,
      usage: WEBGPU_BUFFER_USAGE.STORAGE | WEBGPU_BUFFER_USAGE.COPY_DST,
    });
    const visibleBuffer = webgpuDevice.createBuffer({
      size: maxInstances * 4,
      usage: WEBGPU_BUFFER_USAGE.STORAGE | WEBGPU_BUFFER_USAGE.COPY_SRC,
    });
    const indirectBuffer = webgpuDevice.createBuffer({
      size: indirectHeader.byteLength,
      usage: WEBGPU_BUFFER_USAGE.STORAGE | WEBGPU_BUFFER_USAGE.INDIRECT | WEBGPU_BUFFER_USAGE.COPY_DST,
    });
    const bindGroup = webgpuDevice.createBindGroup?.({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: boundsBuffer } },
        { binding: 2, resource: { buffer: visibleBuffer } },
        { binding: 3, resource: { buffer: indirectBuffer } },
      ],
    }) ?? null;
    gpuResources = { pipeline, uniformBuffer, boundsBuffer, visibleBuffer, indirectBuffer, bindGroup };
  }

  function markDirty(index) {
    if (index < dirtyMin) dirtyMin = index;
    if (index > dirtyMax) dirtyMax = index;
  }

  function setInstanceBounds(index, x, y, z, radius = 1) {
    if (!Number.isInteger(index) || index < 0 || index >= maxInstances) {
      throw new RangeError(`Instance index ${index} out of bounds [0, ${maxInstances})`);
    }
    const base = index * 4;
    const fx = Math.fround(x);
    const fy = Math.fround(y);
    const fz = Math.fround(z);
    const fr = Math.fround(radius);
    if (bounds[base] === fx && bounds[base + 1] === fy && bounds[base + 2] === fz && bounds[base + 3] === fr) {
      if (index + 1 > activeCount) activeCount = index + 1;
      return false;
    }
    bounds[base] = fx;
    bounds[base + 1] = fy;
    bounds[base + 2] = fz;
    bounds[base + 3] = fr;
    if (index + 1 > activeCount) activeCount = index + 1;
    markDirty(index);
    return true;
  }

  function setInstanceCount(count) {
    if (!Number.isInteger(count) || count < 0 || count > maxInstances) {
      throw new RangeError(`Instance count ${count} out of bounds [0, ${maxInstances}]`);
    }
    if (activeCount !== count) {
      activeCount = count;
      frustumDirty = true;
    }
  }

  function setFrustumPlanes(planes) {
    if (!planes || planes.length < 24) {
      throw new TypeError('setFrustumPlanes requires 24 floats (6 vec4 planes)');
    }
    let changed = false;
    for (let i = 0; i < 24; i++) {
      const v = Math.fround(planes[i]);
      if (frustumData[i] !== v) {
        frustumData[i] = v;
        changed = true;
      }
    }
    if (changed) frustumDirty = true;
    return changed;
  }

  function testBoundsCPU(base) {
    const x = bounds[base];
    const y = bounds[base + 1];
    const z = bounds[base + 2];
    const r = bounds[base + 3];
    if (!(r > 0)) return false;
    if (cpuCuller?.testSphere) return cpuCuller.testSphere(x, y, z, r);
    for (let p = 0; p < 24; p += 4) {
      if (frustumData[p] * x + frustumData[p + 1] * y + frustumData[p + 2] * z + frustumData[p + 3] < -r) {
        return false;
      }
    }
    return true;
  }

  function execute({
    commandEncoder = null,
    renderPassEncoder = null,
    indexCount = 0,
    firstIndex = 0,
    baseVertex = 0,
    firstInstance = 0,
    glMode = 4,
    indicesType = 0x1403,
    counts = null,
    offsets = null,
    instanceCounts = null,
    drawCount = 0,
  } = {}) {
    if (disposed) throw new Error('GPU indirect culler is disposed');
    stats.uploadedBytes = 0;
    stats.skippedStatic = false;
    stats.indirectDraws = 0;
    stats.dispatchedInstances = activeCount;

    if (mode === 'webgpu-indirect' && gpuResources) {
      if (dirtyMax >= dirtyMin) {
        const startByte = dirtyMin * 16;
        const elemCount = (dirtyMax - dirtyMin + 1) * 4;
        webgpuDevice.queue.writeBuffer(gpuResources.boundsBuffer, startByte, bounds, dirtyMin * 4, elemCount);
        stats.uploadedBytes += elemCount * 4;
        dirtyMin = Infinity;
        dirtyMax = -1;
      } else {
        stats.skippedStatic = true;
      }

      if (frustumDirty || frustumU32[24] !== activeCount) {
        frustumU32[24] = activeCount;
        webgpuDevice.queue.writeBuffer(gpuResources.uniformBuffer, 0, frustumData);
        stats.uploadedBytes += frustumData.byteLength;
        frustumDirty = false;
      }

      indirectHeader[0] = indexCount >>> 0;
      indirectHeader[1] = 0;
      indirectHeader[2] = firstIndex >>> 0;
      indirectI32[3] = baseVertex | 0;
      indirectHeader[4] = firstInstance >>> 0;
      webgpuDevice.queue.writeBuffer(gpuResources.indirectBuffer, 0, indirectHeader);
      stats.uploadedBytes += indirectHeader.byteLength;

      if (activeCount > 0 && commandEncoder) {
        const cpass = commandEncoder.beginComputePass();
        cpass.setPipeline(gpuResources.pipeline);
        if (gpuResources.bindGroup) cpass.setBindGroup(0, gpuResources.bindGroup);
        cpass.dispatchWorkgroups(Math.ceil(activeCount / 64));
        cpass.end();
      }
      if (renderPassEncoder && indexCount > 0) {
        if (typeof renderPassEncoder.drawIndexedIndirect === 'function') {
          renderPassEncoder.drawIndexedIndirect(gpuResources.indirectBuffer, 0);
          stats.indirectDraws = 1;
        } else if (typeof renderPassEncoder.drawIndirect === 'function') {
          renderPassEncoder.drawIndirect(gpuResources.indirectBuffer, 0);
          stats.indirectDraws = 1;
        }
      }
      stats.visibleCount = activeCount;
      return { mode, fallbackReason, visibleCount: activeCount, indirectBuffer: gpuResources.indirectBuffer };
    }

    if (mode === 'webgl2-multidraw' && multiDrawExt) {
      const n = drawCount || counts?.length || 0;
      if (n > 0 && counts) {
        if (instanceCounts && typeof multiDrawExt.multiDrawElementsInstancedWEBGL === 'function') {
          multiDrawExt.multiDrawElementsInstancedWEBGL(glMode, counts, 0, indicesType, offsets, 0, instanceCounts, 0, n);
          stats.indirectDraws = 1;
        } else if (offsets && typeof multiDrawExt.multiDrawElementsWEBGL === 'function') {
          multiDrawExt.multiDrawElementsWEBGL(glMode, counts, 0, indicesType, offsets, 0, n);
          stats.indirectDraws = 1;
        } else if (typeof multiDrawExt.multiDrawArraysWEBGL === 'function') {
          multiDrawExt.multiDrawArraysWEBGL(glMode, offsets, 0, counts, 0, n);
          stats.indirectDraws = 1;
        }
      }
      dirtyMin = Infinity;
      dirtyMax = -1;
      stats.skippedStatic = stats.uploadedBytes === 0;
      stats.visibleCount = activeCount;
      return { mode, fallbackReason, visibleCount: activeCount };
    }

    // CPU instanced fallback path
    let vis = 0;
    for (let i = 0; i < activeCount; i++) {
      if (testBoundsCPU(i * 4)) {
        visibleIndices[vis++] = i;
      }
    }
    dirtyMin = Infinity;
    dirtyMax = -1;
    stats.skippedStatic = true;
    stats.visibleCount = vis;
    return {
      mode,
      fallbackReason,
      visibleCount: vis,
      visibleIndices: visibleIndices.subarray(0, vis),
    };
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    gpuResources?.uniformBuffer?.destroy?.();
    gpuResources?.boundsBuffer?.destroy?.();
    gpuResources?.visibleBuffer?.destroy?.();
    gpuResources?.indirectBuffer?.destroy?.();
    gpuResources = null;
    return true;
  }

  return {
    get mode() { return mode; },
    get fallbackReason() { return fallbackReason; },
    get capabilities() { return capabilities; },
    get wgslSource() { return GPU_CULL_WGSL; },
    get instanceCount() { return activeCount; },
    setInstanceBounds,
    setInstanceCount,
    setFrustumPlanes,
    execute,
    getStats() { return Object.freeze({ ...stats }); },
    dispose,
  };
}
