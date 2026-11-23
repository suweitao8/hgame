import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import { Scene } from '../assets/runtime/core/scene.js';
import { createThreeAdapter } from '../assets/runtime/integrations/three.js';
import {
  createGpuIndirectCuller3D,
  createIndirectInstancedBatch3D,
} from '../assets/runtime/integrations/gpu-indirect3d.js';

function createMockWebGpuDevice({ visibleIndicesOut = [0, 2, 4] } = {}) {
  const createdBuffers = [];
  const destroyedBuffers = [];
  let latestArgsBuf = null;
  let latestIdxBuf = null;
  let submits = 0;

  const device = {
    createShaderModule: () => ({}),
    createComputePipeline: () => ({
      getBindGroupLayout: () => ({}),
    }),
    createBindGroup: () => ({}),
    createBuffer: ({ size, usage }) => {
      const data = new ArrayBuffer(size);
      const isMapRead = Boolean(usage & 0x0001);
      const buf = {
        size,
        usage,
        _data: data,
        _mapped: false,
        mapAsync: async () => {
          buf._mapped = true;
        },
        getMappedRange: () => buf._data,
        unmap: () => {
          buf._mapped = false;
        },
        destroy: () => {
          destroyedBuffers.push(buf);
        },
      };
      if (isMapRead && size === 20 && !latestArgsBuf) {
        latestArgsBuf = buf;
      } else if (isMapRead && size > 20 && !latestIdxBuf) {
        latestIdxBuf = buf;
      }
      createdBuffers.push(buf);
      return buf;
    },
    queue: {
      writeBuffer: () => {},
      submit: () => {
        submits++;
        for (const buf of createdBuffers) {
          if (!(buf.usage & 0x0001)) continue;
          if (buf.size === 20) {
            const u32 = new Uint32Array(buf._data);
            u32[0] = 36;
            u32[1] = visibleIndicesOut.length;
          } else {
            const u32 = new Uint32Array(buf._data);
            for (let i = 0; i < visibleIndicesOut.length; i++) {
              u32[i] = visibleIndicesOut[i];
            }
          }
        }
      },
    },
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline: () => {},
        setBindGroup: () => {},
        dispatchWorkgroups: () => {},
        end: () => {},
      }),
      copyBufferToBuffer: () => {},
      finish: () => ({}),
    }),
    getSubmits: () => submits,
    getDestroyedCount: () => destroyedBuffers.length,
    lost: new Promise(() => {}),
    destroy: () => {},
  };

  return device;
}

function createMockWebGL2Renderer() {
  const gl = {
    getExtension: () => null,
    getParameter: () => 0,
  };
  return {
    domElement: { width: 640, height: 360 },
    shadowMap: { enabled: false, type: null, autoUpdate: true, needsUpdate: false },
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    autoClear: true,
    getContext: () => gl,
    setPixelRatio: () => {},
    setSize: () => {},
    setClearColor: () => {},
    setViewport: () => {},
    setScissor: () => {},
    setScissorTest: () => {},
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    clear: () => {},
    clearDepth: () => {},
    render: () => {},
    compile: () => {},
    dispose: () => {},
  };
}

test('createGpuIndirectCuller3D accepts device alias and drives non-blocking 1-frame-delayed batch compaction', async () => {
  const mockDevice = createMockWebGpuDevice({ visibleIndicesOut: [1, 3, 5, 7] });

  // Verify `device` alias bug fix
  const culler = createGpuIndirectCuller3D({ device: mockDevice, maxInstances: 16 });
  assert.equal(culler.mode, 'webgpu-indirect');
  assert.equal(culler.getLatestResult(), null);

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial();
  const batch = createIndirectInstancedBatch3D(THREE, { geometry: geo, material: mat, capacity: 16 });
  const m = new THREE.Matrix4();
  for (let i = 0; i < 8; i++) {
    m.makeTranslation(i, 0, -5);
    batch.setInstanceMatrix(i, m);
    batch.setInstanceBounds(i, i, 0, -5, 0.5);
  }

  const planes = new Float32Array(24);
  // Frame 1: readback not ready yet -> cpu-fallback while async compute is submitted
  batch.cull(planes, culler);
  assert.equal(batch.getStats().source, 'cpu-fallback');
  assert.equal(mockDevice.getSubmits(), 1);
  assert.equal(culler.getLatestResult(), null);

  // Flush microtasks for mapAsync resolution
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(culler.getLatestResult());
  assert.equal(culler.getLatestResult().visibleCount, 4);

  // Frame 2: consumes real GPU readback indices
  const vis2 = batch.cull(planes, culler);
  assert.equal(vis2, 4);
  assert.equal(batch.mesh.count, 4);
  assert.equal(batch.getStats().source, 'gpu-readback');
  assert.equal(batch.getStats().gpuReadbacks, 1);

  batch.dispose();
  culler.dispose();
  geo.dispose();
  mat.dispose();
  assert.ok(mockDevice.getDestroyedCount() >= 2);
});

test('createThreeAdapter defaults gpuIndirect to auto with zero overhead until batch registration and upgrades via navigator.gpu', async () => {
  const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const mockDevice = createMockWebGpuDevice({ visibleIndicesOut: [0, 1] });
  let adapterRequests = 0;

  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        gpu: {
          requestAdapter: async () => {
            adapterRequests++;
            return {
              requestDevice: async () => mockDevice,
            };
          },
        },
      },
    });

    const renderer = createMockWebGL2Renderer();
    const ns = { ...THREE, WebGLRenderer: class { constructor() { return renderer; } } };
    const adapter = createThreeAdapter({
      THREE: ns,
      canvas: { clientWidth: 640, clientHeight: 360 },
      pixelRatio: 1,
    });

    // Zero overhead before any indirect batch is registered
    const state0 = adapter.getGpuCullingState();
    assert.equal(state0.enabled, false);
    assert.equal(state0.requested, 'auto');
    assert.equal(adapterRequests, 0);

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial();
    const batch = createIndirectInstancedBatch3D(THREE, { geometry: geo, material: mat, capacity: 8 });
    const m = new THREE.Matrix4().makeTranslation(0, 0, -5);
    batch.setInstanceMatrix(0, m);
    batch.setInstanceBounds(0, 0, 0, -5, 0.5);
    batch.setInstanceMatrix(1, m);
    batch.setInstanceBounds(1, 1, 0, -5, 0.5);

    const scene = new Scene('auto-gpu-test');
    adapter.add(scene, batch.mesh);
    adapter.registerIndirectBatch('b0', batch);

    assert.equal(adapter.getGpuCullingState().enabled, true);
    assert.equal(adapterRequests, 0); // Promise.resolve().then runs in microtask
    await new Promise((r) => setTimeout(r, 15));

    assert.equal(adapterRequests, 1);
    assert.equal(adapter.getGpuCullingState().mode, 'webgpu-indirect');
    assert.equal(adapter.getGpuCullingState().pending, false);

    // Fallback test when requestAdapter returns null
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { gpu: { requestAdapter: async () => null } },
    });
    const adapterNull = createThreeAdapter({
      THREE: ns,
      canvas: { clientWidth: 640, clientHeight: 360 },
      pixelRatio: 1,
    });
    adapterNull.registerIndirectBatch('b1', batch);
    await new Promise((r) => setTimeout(r, 15));
    const nullState = adapterNull.getGpuCullingState();
    assert.notEqual(nullState.mode, 'webgpu-indirect');
    assert.ok(nullState.fallbackReason && nullState.fallbackReason.length > 0);

    // Explicit opt-out remains disabled
    const adapterOff = createThreeAdapter({
      THREE: ns,
      canvas: { clientWidth: 640, clientHeight: 360 },
      pixelRatio: 1,
      gpuIndirect: false,
    });
    adapterOff.registerIndirectBatch('b2', batch);
    assert.equal(adapterOff.getGpuCullingState().enabled, false);
    assert.equal(adapterOff.getGpuCullingState().mode, 'disabled');

    batch.dispose();
    adapter.dispose();
    adapterNull.dispose();
    adapterOff.dispose();
    geo.dispose();
    mat.dispose();
  } finally {
    if (origNavDesc) Object.defineProperty(globalThis, 'navigator', origNavDesc);
    else delete globalThis.navigator;
  }
});
