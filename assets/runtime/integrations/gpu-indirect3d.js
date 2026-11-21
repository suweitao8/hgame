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
 * @param {any} [options.device=null] Alias for `webgpuDevice`.
 * @param {any} [options.gl=null] WebGL2 context checked for `WEBGL_multi_draw`.
 * @param {{ testSphere?: (x: number, y: number, z: number, radius?: number) => boolean } | null} [options.cpuCuller=null]
 * @param {number} [options.maxInstances=65536]
 */
export function createGpuIndirectCuller3D({
  webgpuDevice = null,
  device = null,
  gl = null,
  cpuCuller = null,
  maxInstances = 65536,
} = {}) {
  const gpuDevice = webgpuDevice ?? device ?? null;
  if (!Number.isSafeInteger(maxInstances) || maxInstances < 1) {
    throw new RangeError('maxInstances must be a positive integer');
  }

  const hasWebGpuCompute = Boolean(
    gpuDevice &&
    typeof gpuDevice.createShaderModule === 'function' &&
    typeof gpuDevice.createComputePipeline === 'function' &&
    typeof gpuDevice.createBuffer === 'function' &&
    typeof gpuDevice.queue?.writeBuffer === 'function'
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
      : !gpuDevice && !gl
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
    readbackErrors: 0,
    readbackSkipped: 0,
  };

  let gpuResources = null;
  const stagingPool = [null, null];
  let readbackSerial = 0;
  let latestResult = null;
  if (mode === 'webgpu-indirect') {
    const shaderModule = gpuDevice.createShaderModule({ code: GPU_CULL_WGSL });
    const pipeline = gpuDevice.createComputePipeline({
      layout: 'auto',
      compute: { module: shaderModule, entryPoint: 'main' },
    });
    const uniformBuffer = gpuDevice.createBuffer({
      size: frustumData.byteLength,
      usage: WEBGPU_BUFFER_USAGE.UNIFORM | WEBGPU_BUFFER_USAGE.COPY_DST,
    });
    const boundsBuffer = gpuDevice.createBuffer({
      size: bounds.byteLength,
      usage: WEBGPU_BUFFER_USAGE.STORAGE | WEBGPU_BUFFER_USAGE.COPY_DST,
    });
    const visibleBuffer = gpuDevice.createBuffer({
      size: maxInstances * 4,
      usage: WEBGPU_BUFFER_USAGE.STORAGE | WEBGPU_BUFFER_USAGE.COPY_SRC,
    });
    const indirectBuffer = gpuDevice.createBuffer({
      size: indirectHeader.byteLength,
      usage: WEBGPU_BUFFER_USAGE.STORAGE | WEBGPU_BUFFER_USAGE.INDIRECT | WEBGPU_BUFFER_USAGE.COPY_DST | WEBGPU_BUFFER_USAGE.COPY_SRC,
    });
    const bindGroup = gpuDevice.createBindGroup?.({
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

  function setInstanceBoundsRange(boundsArray, startIndex = 0, count = Math.floor((boundsArray?.length ?? 0) / 4)) {
    const start = Math.max(0, startIndex | 0);
    const n = Math.max(0, Math.min(maxInstances - start, count | 0));
    if (n === 0 || !boundsArray) return false;
    bounds.set(boundsArray.subarray(0, n * 4), start * 4);
    if (start + n > activeCount) activeCount = start + n;
    markDirty(start);
    markDirty(start + n - 1);
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
        gpuDevice.queue.writeBuffer(gpuResources.boundsBuffer, startByte, bounds, dirtyMin * 4, elemCount);
        stats.uploadedBytes += elemCount * 4;
        dirtyMin = Infinity;
        dirtyMax = -1;
      } else {
        stats.skippedStatic = true;
      }

      if (frustumDirty || frustumU32[24] !== activeCount) {
        frustumU32[24] = activeCount;
        gpuDevice.queue.writeBuffer(gpuResources.uniformBuffer, 0, frustumData);
        stats.uploadedBytes += frustumData.byteLength;
        frustumDirty = false;
      }

      indirectHeader[0] = indexCount >>> 0;
      indirectHeader[1] = 0;
      indirectHeader[2] = firstIndex >>> 0;
      indirectI32[3] = baseVertex | 0;
      indirectHeader[4] = firstInstance >>> 0;
      gpuDevice.queue.writeBuffer(gpuResources.indirectBuffer, 0, indirectHeader);
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

  async function dispatchWebGpuCompute({
    boundsData = null,
    instanceCount = activeCount,
    frustumPlanes = null,
    indexCount = 36,
    readback = false,
  } = {}) {
    if (disposed) throw new Error('GPU indirect culler is disposed');
    if (frustumPlanes) setFrustumPlanes(frustumPlanes);
    if (boundsData) setInstanceBoundsRange(boundsData, 0, instanceCount);
    else if (instanceCount !== activeCount) setInstanceCount(instanceCount);

    const workgroups = activeCount > 0 ? Math.ceil(activeCount / 64) : 0;
    if (mode === 'webgpu-indirect' && gpuResources && typeof gpuDevice.createCommandEncoder === 'function') {
      const commandEncoder = gpuDevice.createCommandEncoder();
      execute({ commandEncoder, indexCount });

      let readArgsBuf = null;
      let readIdxBuf = null;
      if (readback) {
        readArgsBuf = gpuDevice.createBuffer({
          size: indirectHeader.byteLength,
          usage: WEBGPU_BUFFER_USAGE.MAP_READ | WEBGPU_BUFFER_USAGE.COPY_DST,
        });
        commandEncoder.copyBufferToBuffer(gpuResources.indirectBuffer, 0, readArgsBuf, 0, indirectHeader.byteLength);
        if (activeCount > 0) {
          readIdxBuf = gpuDevice.createBuffer({
            size: activeCount * 4,
            usage: WEBGPU_BUFFER_USAGE.MAP_READ | WEBGPU_BUFFER_USAGE.COPY_DST,
          });
          commandEncoder.copyBufferToBuffer(gpuResources.visibleBuffer, 0, readIdxBuf, 0, activeCount * 4);
        }
      }

      gpuDevice.queue.submit([commandEncoder.finish()]);

      if (readback && readArgsBuf) {
        await readArgsBuf.mapAsync(0x0001);
        const argsView = new Uint32Array(readArgsBuf.getMappedRange());
        const visibleCount = Math.min(activeCount, argsView[1] >>> 0);
        readArgsBuf.unmap();
        readArgsBuf.destroy();

        let visibleOut = new Uint32Array(0);
        if (readIdxBuf) {
          await readIdxBuf.mapAsync(0x0001);
          const idxView = new Uint32Array(readIdxBuf.getMappedRange());
          visibleOut = new Uint32Array(idxView.subarray(0, visibleCount));
          readIdxBuf.unmap();
          readIdxBuf.destroy();
        }
        stats.visibleCount = visibleCount;
        return {
          mode,
          dispatched: activeCount,
          visibleCount,
          visibleIndices: visibleOut,
          workgroups,
        };
      }

      return {
        mode,
        dispatched: activeCount,
        visibleCount: stats.visibleCount,
        visibleIndices: null,
        workgroups,
      };
    }

    const res = execute({ indexCount });
    return {
      mode,
      dispatched: activeCount,
      visibleCount: res.visibleCount,
      visibleIndices: res.visibleIndices ?? null,
      workgroups: 0,
    };
  }

  /**
   * Non-blocking 2-slot double-buffered WebGPU compute dispatch + async `mapAsync` readback.
   * Never blocks the main thread; latest completed result is exposed via `getLatestResult()`.
   * @param {{ indexCount?: number }} [options]
   * @returns {{ submitted: boolean, serial: number }}
   */
  function submitComputeReadback({ indexCount = 0 } = {}) {
    if (disposed) throw new Error('GPU indirect culler is disposed');
    if (mode !== 'webgpu-indirect' || !gpuResources || typeof gpuDevice.createCommandEncoder !== 'function') {
      return { submitted: false, serial: readbackSerial };
    }

    let slotIdx = -1;
    for (let i = 0; i < stagingPool.length; i++) {
      if (!stagingPool[i] || !stagingPool[i].inFlight) {
        slotIdx = i;
        break;
      }
    }
    if (slotIdx === -1) {
      stats.readbackSkipped++;
      return { submitted: false, serial: readbackSerial };
    }

    let slot = stagingPool[slotIdx];
    if (!slot) {
      slot = {
        inFlight: false,
        argsBuf: gpuDevice.createBuffer({
          size: indirectHeader.byteLength,
          usage: WEBGPU_BUFFER_USAGE.MAP_READ | WEBGPU_BUFFER_USAGE.COPY_DST,
        }),
        idxBuf: gpuDevice.createBuffer({
          size: maxInstances * 4,
          usage: WEBGPU_BUFFER_USAGE.MAP_READ | WEBGPU_BUFFER_USAGE.COPY_DST,
        }),
        outIndices: new Uint32Array(maxInstances),
      };
      stagingPool[slotIdx] = slot;
    }

    slot.inFlight = true;
    const serial = ++readbackSerial;
    const submittedCount = activeCount;
    const commandEncoder = gpuDevice.createCommandEncoder();
    execute({ commandEncoder, indexCount });
    commandEncoder.copyBufferToBuffer(gpuResources.indirectBuffer, 0, slot.argsBuf, 0, indirectHeader.byteLength);
    if (submittedCount > 0) {
      commandEncoder.copyBufferToBuffer(gpuResources.visibleBuffer, 0, slot.idxBuf, 0, submittedCount * 4);
    }
    gpuDevice.queue.submit([commandEncoder.finish()]);

    const mapJobs = [slot.argsBuf.mapAsync(0x0001)];
    if (submittedCount > 0) mapJobs.push(slot.idxBuf.mapAsync(0x0001));

    Promise.all(mapJobs).then(
      () => {
        try {
          if (disposed) {
            try { slot.argsBuf.unmap(); } catch {}
            if (submittedCount > 0) try { slot.idxBuf.unmap(); } catch {}
            return;
          }
          const argsView = new Uint32Array(slot.argsBuf.getMappedRange());
          const visCount = Math.min(submittedCount, argsView[1] >>> 0);
          slot.argsBuf.unmap();

          if (submittedCount > 0) {
            const idxView = new Uint32Array(slot.idxBuf.getMappedRange());
            if (visCount > 0) {
              slot.outIndices.set(idxView.subarray(0, visCount), 0);
            }
            slot.idxBuf.unmap();
          }
          const copied = new Uint32Array(slot.outIndices.subarray(0, visCount));
          latestResult = {
            serial,
            instanceCount: submittedCount,
            visibleCount: visCount,
            visibleIndices: copied,
          };
          stats.visibleCount = visCount;
        } finally {
          slot.inFlight = false;
        }
      },
      () => {
        try { slot.argsBuf.unmap(); } catch {}
        if (submittedCount > 0) try { slot.idxBuf.unmap(); } catch {}
        slot.inFlight = false;
        stats.readbackErrors++;
      }
    );

    return { submitted: true, serial };
  }

  function getLatestResult() {
    return latestResult;
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    latestResult = null;
    for (let i = 0; i < stagingPool.length; i++) {
      const slot = stagingPool[i];
      if (!slot) continue;
      try { slot.argsBuf?.destroy?.(); } catch {}
      try { slot.idxBuf?.destroy?.(); } catch {}
      stagingPool[i] = null;
    }
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
    setInstanceBoundsRange,
    setInstanceCount,
    setFrustumPlanes,
    execute,
    dispatchWebGpuCompute,
    submitComputeReadback,
    getLatestResult,
    getStats() { return Object.freeze({ ...stats }); },
    dispose,
  };
}

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
export function createIndirectInstancedBatch3D(THREE, {
  geometry,
  material,
  capacity = 1024,
  castShadow = false,
  receiveShadow = false,
} = {}) {
  if (!THREE?.InstancedMesh || !geometry || !material) {
    throw new TypeError('createIndirectInstancedBatch3D requires THREE.InstancedMesh, geometry, and material');
  }
  const cap = Math.max(1, Math.floor(Number(capacity) || 1024));
  const instancedMesh = new THREE.InstancedMesh(geometry, material, cap);
  instancedMesh.frustumCulled = false; // We perform per-instance frustum compaction directly
  instancedMesh.castShadow = Boolean(castShadow);
  instancedMesh.receiveShadow = Boolean(receiveShadow);
  instancedMesh.count = 0;

  const sourceMatrices = new Float32Array(cap * 16);
  const bounds = new Float32Array(cap * 4);
  let activeCount = 0;
  let visibleCount = 0;
  let cullCount = 0;
  let gpuReadbacks = 0;
  let lastMode = 'cpu-instanced';
  let lastSource = 'cpu-instanced';

  function setCount(count) {
    activeCount = Math.max(0, Math.min(cap, Math.floor(Number(count) || 0)));
    return activeCount;
  }

  function setInstanceMatrix(index, matrixOrElements) {
    if (index < 0 || index >= cap) return false;
    const elems = matrixOrElements?.elements ?? matrixOrElements;
    if (!elems || elems.length < 16) return false;
    const base = index * 16;
    for (let i = 0; i < 16; i++) sourceMatrices[base + i] = elems[i];
    if (index >= activeCount) activeCount = index + 1;
    return true;
  }

  function setInstanceBounds(index, x, y, z, radius = 1) {
    if (index < 0 || index >= cap) return false;
    const base = index * 4;
    bounds[base] = Number(x) || 0;
    bounds[base + 1] = Number(y) || 0;
    bounds[base + 2] = Number(z) || 0;
    bounds[base + 3] = Math.max(0.001, Number(radius) || 1);
    if (index >= activeCount) activeCount = index + 1;
    return true;
  }

  function compactFromIndices(dst, idxArr, count) {
    for (let i = 0; i < count; i++) {
      const srcOffset = idxArr[i] * 16;
      const dstOffset = i * 16;
      for (let k = 0; k < 16; k++) dst[dstOffset + k] = sourceMatrices[srcOffset + k];
    }
    return count;
  }

  function cull(frustumPlanes, gpuIndirectCuller = null) {
    if (activeCount === 0) {
      visibleCount = 0;
      instancedMesh.count = 0;
      return 0;
    }
    cullCount++;
    let vis = 0;
    let compacted = false;
    const dst = instancedMesh.instanceMatrix?.array;

    if (gpuIndirectCuller) {
      if (frustumPlanes) gpuIndirectCuller.setFrustumPlanes(frustumPlanes);
      if (typeof gpuIndirectCuller.setInstanceBoundsRange === 'function') {
        gpuIndirectCuller.setInstanceBoundsRange(bounds, 0, activeCount);
      } else {
        for (let i = 0; i < activeCount; i++) {
          const b = i * 4;
          gpuIndirectCuller.setInstanceBounds(i, bounds[b], bounds[b + 1], bounds[b + 2], bounds[b + 3]);
        }
      }
      gpuIndirectCuller.setInstanceCount(activeCount);

      if (
        gpuIndirectCuller.mode === 'webgpu-indirect' &&
        typeof gpuIndirectCuller.submitComputeReadback === 'function'
      ) {
        lastMode = 'webgpu-indirect';
        gpuIndirectCuller.submitComputeReadback();
        const latest = gpuIndirectCuller.getLatestResult?.();
        if (latest && latest.instanceCount === activeCount && dst) {
          vis = compactFromIndices(dst, latest.visibleIndices, latest.visibleCount);
          lastSource = 'gpu-readback';
          gpuReadbacks++;
          compacted = true;
        } else {
          lastSource = 'cpu-fallback';
        }
      } else {
        const res = gpuIndirectCuller.execute();
        lastMode = res.mode ?? gpuIndirectCuller.mode;
        if (res.visibleIndices && dst) {
          vis = compactFromIndices(dst, res.visibleIndices, res.visibleCount);
          lastSource = 'cpu-instanced';
          compacted = true;
        } else {
          lastSource = 'host-planes';
        }
      }
    }

    if (!compacted && dst && frustumPlanes && frustumPlanes.length >= 24) {
      // Compact instance matrices on host side matching GPU frustum planes for WebGL2 InstancedMesh
      for (let i = 0; i < activeCount; i++) {
        const b = i * 4;
        const x = bounds[b];
        const y = bounds[b + 1];
        const z = bounds[b + 2];
        const r = bounds[b + 3];
        let inside = true;
        for (let p = 0; p < 24; p += 4) {
          if (frustumPlanes[p] * x + frustumPlanes[p + 1] * y + frustumPlanes[p + 2] * z + frustumPlanes[p + 3] < -r) {
            inside = false;
            break;
          }
        }
        if (inside) {
          const srcOffset = i * 16;
          const dstOffset = vis * 16;
          for (let k = 0; k < 16; k++) dst[dstOffset + k] = sourceMatrices[srcOffset + k];
          vis++;
        }
      }
    }

    visibleCount = vis;
    instancedMesh.count = vis;
    if (instancedMesh.instanceMatrix) {
      if (typeof instancedMesh.instanceMatrix.clearUpdateRanges === 'function') {
        instancedMesh.instanceMatrix.clearUpdateRanges();
      }
      if (vis > 0 && typeof instancedMesh.instanceMatrix.addUpdateRange === 'function') {
        instancedMesh.instanceMatrix.addUpdateRange(0, vis * 16);
      }
      instancedMesh.instanceMatrix.needsUpdate = true;
    }
    return vis;
  }

  function dispose() {
    instancedMesh.removeFromParent?.();
    instancedMesh.dispose?.();
  }

  return {
    get mesh() { return instancedMesh; },
    get capacity() { return cap; },
    get count() { return activeCount; },
    get visibleCount() { return visibleCount; },
    setCount,
    setInstanceMatrix,
    setInstanceBounds,
    cull,
    getStats() {
      return Object.freeze({
        capacity: cap,
        activeCount,
        visibleCount,
        culledOut: Math.max(0, activeCount - visibleCount),
        cullPasses: cullCount,
        mode: lastMode,
        source: lastSource,
        gpuReadbacks,
      });
    },
    dispose,
  };
}

export const GPU_HIZ_OCCLUSION_WGSL = /* wgsl */ `
struct HiZParams {
  screenSize: vec2<f32>,
  mipCount: u32,
  objectCount: u32,
};

@group(0) @binding(0) var<uniform> uHiZ: HiZParams;
@group(0) @binding(1) var<storage, read> bScreenAabbs: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> bMinDepths: array<f32>;
@group(0) @binding(3) var tHiZ: texture_2d<f32>;
@group(0) @binding(4) var<storage, read_write> bVisibility: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= uHiZ.objectCount) { return; }
  let aabb = bScreenAabbs[idx];
  let span = max((aabb.z - aabb.x) * uHiZ.screenSize.x, (aabb.w - aabb.y) * uHiZ.screenSize.y);
  let mip = min(uHiZ.mipCount - 1u, u32(ceil(log2(max(1.0, span * 0.5)))));
  let dim = vec2<i32>(max(vec2<f32>(1.0), floor(uHiZ.screenSize / f32(1u << mip))));
  let fdim = vec2<f32>(dim);
  let t0 = clamp(vec2<i32>(floor(aabb.xy * fdim)), vec2<i32>(0), dim - vec2<i32>(1));
  let t1 = clamp(vec2<i32>(floor((aabb.zw - vec2<f32>(1e-4)) * fdim)), t0, dim - vec2<i32>(1));
  let d00 = textureLoad(tHiZ, t0, i32(mip)).r;
  let d10 = textureLoad(tHiZ, vec2<i32>(t1.x, t0.y), i32(mip)).r;
  let d01 = textureLoad(tHiZ, vec2<i32>(t0.x, t1.y), i32(mip)).r;
  let d11 = textureLoad(tHiZ, t1, i32(mip)).r;
  let maxOccDepth = max(max(d00, d10), max(d01, d11));
  bVisibility[idx] = select(0u, 1u, bMinDepths[idx] <= maxOccDepth + 1e-4);
}
`;

/**
 * Zero-GC CPU/WebGPU Hi-Z hierarchical depth pyramid occlusion culler (conservatively
 * downsampling max-depth mips from level 0 down to 1x1 so occluded meshes behind walls are culled).
 * @param {{ width?: number, height?: number }} [options]
 */
export function createHiZOcclusionCuller3D({ width = 128, height = 128 } = {}) {
  const baseW = Math.max(4, 1 << Math.floor(Math.log2(Math.max(4, Number(width) || 128))));
  const baseH = Math.max(4, 1 << Math.floor(Math.log2(Math.max(4, Number(height) || 128))));

  const mips = [];
  let cw = baseW;
  let ch = baseH;
  while (true) {
    mips.push({ width: cw, height: ch, data: new Float32Array(cw * ch).fill(1.0) });
    if (cw === 1 && ch === 1) break;
    cw = Math.max(1, cw >> 1);
    ch = Math.max(1, ch >> 1);
  }

  let tested = 0;
  let occluded = 0;

  function buildPyramid(depthValues) {
    const level0 = mips[0].data;
    if (depthValues && depthValues.length >= level0.length) {
      level0.set(depthValues.subarray(0, level0.length));
    } else if (depthValues) {
      level0.fill(1.0);
      level0.set(depthValues);
    }
    for (let m = 1; m < mips.length; m++) {
      const prev = mips[m - 1];
      const curr = mips[m];
      const pw = prev.width;
      const ph = prev.height;
      const pd = prev.data;
      const cd = curr.data;
      for (let y = 0; y < curr.height; y++) {
        const sy0 = Math.min(ph - 1, y * 2);
        const sy1 = Math.min(ph - 1, sy0 + 1);
        for (let x = 0; x < curr.width; x++) {
          const sx0 = Math.min(pw - 1, x * 2);
          const sx1 = Math.min(pw - 1, sx0 + 1);
          const d00 = pd[sy0 * pw + sx0];
          const d10 = pd[sy0 * pw + sx1];
          const d01 = pd[sy1 * pw + sx0];
          const d11 = pd[sy1 * pw + sx1];
          cd[y * curr.width + x] = Math.max(d00, d10, d01, d11);
        }
      }
    }
    return mips.length;
  }

  function testScreenBounds(minX, minY, maxX, maxY, minDepth) {
    tested++;
    if (maxX <= 0 || maxY <= 0 || minX >= 1 || minY >= 1) {
      occluded++;
      return false;
    }
    const cMinX = Math.max(0, Math.min(1, minX));
    const cMinY = Math.max(0, Math.min(1, minY));
    const cMaxX = Math.max(0, Math.min(1, maxX));
    const cMaxY = Math.max(0, Math.min(1, maxY));
    const spanPx = Math.max((cMaxX - cMinX) * baseW, (cMaxY - cMinY) * baseH, 1);
    const mipIdx = Math.max(0, Math.min(mips.length - 1, Math.floor(Math.log2(Math.max(1, spanPx * 0.5)))));
    const mip = mips[mipIdx];

    const x0 = Math.max(0, Math.min(mip.width - 1, Math.floor(cMinX * mip.width)));
    const x1 = Math.max(x0, Math.min(mip.width - 1, Math.floor(cMaxX * (mip.width - 1e-4))));
    const y0 = Math.max(0, Math.min(mip.height - 1, Math.floor(cMinY * mip.height)));
    const y1 = Math.max(y0, Math.min(mip.height - 1, Math.floor(cMaxY * (mip.height - 1e-4))));

    let maxOccludingDepth = 0;
    for (let y = y0; y <= y1; y++) {
      const row = y * mip.width;
      for (let x = x0; x <= x1; x++) {
        const d = mip.data[row + x];
        if (d > maxOccludingDepth) maxOccludingDepth = d;
      }
    }

    const visible = minDepth <= maxOccludingDepth + 1e-4;
    if (!visible) occluded++;
    return visible;
  }

  function resetStats() {
    tested = 0;
    occluded = 0;
  }

  function getStats() {
    return Object.freeze({
      width: baseW,
      height: baseH,
      mipCount: mips.length,
      tested,
      occluded,
    });
  }

  return Object.freeze({
    buildPyramid,
    testScreenBounds,
    resetStats,
    getStats,
    getMipLevels: () => mips.map(m => ({ width: m.width, height: m.height, data: m.data })),
  });
}

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
export async function dispatchWebGpuHiZOcclusion({
  webgpuDevice = null,
  screenAabbs,
  minDepths,
  hizDepthData,
  width = 64,
  height = 64,
  objectCount = 0,
  readback = false,
} = {}) {
  const count = Math.max(0, Math.floor(Number(objectCount) || 0));
  const culler = createHiZOcclusionCuller3D({ width, height });
  culler.buildPyramid(hizDepthData);
  const mipLevels = culler.getMipLevels();

  if (!webgpuDevice || typeof webgpuDevice.createComputePipeline !== 'function' || count === 0) {
    const visibility = new Uint32Array(count);
    let visibleCount = 0;
    for (let i = 0; i < count; i++) {
      const b = i * 4;
      const vis = culler.testScreenBounds(screenAabbs[b], screenAabbs[b + 1], screenAabbs[b + 2], screenAabbs[b + 3], minDepths[i]);
      visibility[i] = vis ? 1 : 0;
      if (vis) visibleCount++;
    }
    return {
      mode: 'cpu-hiz',
      dispatched: count,
      visibleCount,
      occludedCount: count - visibleCount,
      mipCount: mipLevels.length,
      visibility,
    };
  }

  const baseW = mipLevels[0].width;
  const baseH = mipLevels[0].height;
  // GPUTextureUsage: TEXTURE_BINDING (0x04) | COPY_DST (0x02) = 0x06
  const hizTexture = webgpuDevice.createTexture({
    size: [baseW, baseH, 1],
    mipLevelCount: mipLevels.length,
    format: 'r32float',
    usage: 0x06,
  });

  for (let m = 0; m < mipLevels.length; m++) {
    const mip = mipLevels[m];
    const rowBytes = mip.width * 4;
    const paddedRowBytes = Math.ceil(rowBytes / 256) * 256;
    let uploadBuf = mip.data;
    if (paddedRowBytes !== rowBytes) {
      const padded = new Uint8Array(paddedRowBytes * mip.height);
      const srcBytes = new Uint8Array(mip.data.buffer, mip.data.byteOffset, mip.data.byteLength);
      for (let y = 0; y < mip.height; y++) {
        padded.set(srcBytes.subarray(y * rowBytes, (y + 1) * rowBytes), y * paddedRowBytes);
      }
      uploadBuf = padded;
    }
    webgpuDevice.queue.writeTexture(
      { texture: hizTexture, mipLevel: m },
      uploadBuf,
      { bytesPerRow: paddedRowBytes, rowsPerImage: mip.height },
      [mip.width, mip.height, 1],
    );
  }

  const uniformData = new ArrayBuffer(16);
  const uniformF32 = new Float32Array(uniformData);
  const uniformU32 = new Uint32Array(uniformData);
  uniformF32[0] = baseW;
  uniformF32[1] = baseH;
  uniformU32[2] = mipLevels.length;
  uniformU32[3] = count;

  const uniformBuf = webgpuDevice.createBuffer({
    size: 16,
    usage: WEBGPU_BUFFER_USAGE.UNIFORM | WEBGPU_BUFFER_USAGE.COPY_DST,
  });
  webgpuDevice.queue.writeBuffer(uniformBuf, 0, uniformData);

  const aabbByteLen = Math.max(16, count * 16);
  const aabbBuf = webgpuDevice.createBuffer({
    size: aabbByteLen,
    usage: WEBGPU_BUFFER_USAGE.STORAGE | WEBGPU_BUFFER_USAGE.COPY_DST,
  });
  webgpuDevice.queue.writeBuffer(aabbBuf, 0, screenAabbs, 0, count * 4);

  const depthByteLen = Math.max(16, count * 4);
  const depthBuf = webgpuDevice.createBuffer({
    size: depthByteLen,
    usage: WEBGPU_BUFFER_USAGE.STORAGE | WEBGPU_BUFFER_USAGE.COPY_DST,
  });
  webgpuDevice.queue.writeBuffer(depthBuf, 0, minDepths, 0, count);

  const visBuf = webgpuDevice.createBuffer({
    size: depthByteLen,
    usage: WEBGPU_BUFFER_USAGE.STORAGE | WEBGPU_BUFFER_USAGE.COPY_SRC,
  });

  const shaderModule = webgpuDevice.createShaderModule({ code: GPU_HIZ_OCCLUSION_WGSL });
  const pipeline = webgpuDevice.createComputePipeline({
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'main' },
  });
  const bindGroup = webgpuDevice.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: aabbBuf } },
      { binding: 2, resource: { buffer: depthBuf } },
      { binding: 3, resource: hizTexture.createView() },
      { binding: 4, resource: { buffer: visBuf } },
    ],
  });

  const encoder = webgpuDevice.createCommandEncoder();
  const cpass = encoder.beginComputePass();
  cpass.setPipeline(pipeline);
  cpass.setBindGroup(0, bindGroup);
  cpass.dispatchWorkgroups(Math.ceil(count / 64));
  cpass.end();

  let readBuf = null;
  if (readback) {
    readBuf = webgpuDevice.createBuffer({
      size: depthByteLen,
      usage: WEBGPU_BUFFER_USAGE.MAP_READ | WEBGPU_BUFFER_USAGE.COPY_DST,
    });
    encoder.copyBufferToBuffer(visBuf, 0, readBuf, 0, count * 4);
  }
  webgpuDevice.queue.submit([encoder.finish()]);

  let visibility = null;
  let visibleCount = 0;
  if (readback && readBuf) {
    await readBuf.mapAsync(0x0001);
    visibility = new Uint32Array(new Uint32Array(readBuf.getMappedRange()).subarray(0, count));
    for (let i = 0; i < count; i++) if (visibility[i] > 0) visibleCount++;
    readBuf.unmap();
    readBuf.destroy();
  }

  uniformBuf.destroy();
  aabbBuf.destroy();
  depthBuf.destroy();
  visBuf.destroy();
  hizTexture.destroy();

  return {
    mode: 'webgpu-hiz',
    dispatched: count,
    visibleCount,
    occludedCount: readback ? count - visibleCount : 0,
    mipCount: mipLevels.length,
    visibility,
  };
}
