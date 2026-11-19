import { createGpuFrameTimer } from './gpu-timer.js';
import { beginWebGlUploadProbe } from './upload-probe.js';

const MAX_GPU_SAMPLES = 32;

/** @typedef {{viewIndex: number, width: number, height: number, samples: number, bytes: number}} RenderTargetUsage3D */
/** @typedef {import('./upload-probe.js').WebGlUploadTotals} WebGlUploadTotals */
/** @typedef {{name: string, viewIndex: number, target: RenderTargetUsage3D | null, cpuMs: number, drawCalls: number | null, triangles: number | null, uploads: WebGlUploadTotals | null}} RenderStageSample3D */
/** @typedef {{frame: number, name: string, viewIndex: number | null, passIndex: number | null, status: 'ready' | 'disjoint' | 'expired' | 'invalid', ms: number | null}} RenderGpuSample3D */
/**
 * @typedef {object} RenderDiagnosticsSnapshot3D
 * @property {number} frame Adapter frame serial.
 * @property {boolean} complete True if the frame finished rendering.
 * @property {number} cpuMs Whole frame CPU time including view setup.
 * @property {number | null} drawCalls WebGL draw calls, if reported by the renderer.
 * @property {number | null} triangles Triangles submitted, if reported by the renderer.
 * @property {number} estimatedTargetBytes Nominal payload of the counted offscreen attachments.
 * @property {readonly RenderTargetUsage3D[]} targets Unique targets in the rendered views.
 * @property {readonly RenderStageSample3D[]} passes CPU submission samples in execution order.
 * @property {WebGlUploadTotals | null} uploads Client transfer payloads submitted while this adapter rendered the frame.
 * @property {readonly string[]} uploadMethods WebGL calls covered by the frame's upload probe.
 * @property {{supported: boolean, samples: readonly RenderGpuSample3D[]}} gpu Recent asynchronously resolved GPU samples, keyed by frame and view.
 */

function textureBytesPerPixel(THREE, texture) {
  if (texture.type === THREE.UnsignedInt101111Type) return 4;
  if (texture.internalFormat === 'RGBA8') return 4;
  const channels = texture.format === THREE.RedFormat ? 1 : texture.format === THREE.RGFormat ? 2 :
    texture.format === THREE.RGBFormat ? 3 : 4;
  const bytes = texture.type === THREE.FloatType ? 4 : texture.type === THREE.HalfFloatType ? 2 : 1;
  return channels * bytes;
}

function describeTarget(THREE, target, viewIndex) {
  const { width, height, samples = 0, texture, depthBuffer, depthTexture, stencilBuffer } = target;
  const bytes = width * height * (textureBytesPerPixel(THREE, texture) * (1 + samples) +
    (depthBuffer || stencilBuffer ? 4 * Math.max(1, samples) : 0) + (samples && depthTexture ? 4 : 0));
  return Object.freeze({ viewIndex, width, height, samples, bytes });
}

function counter(info, key) {
  const value = info?.render?.[key];
  return Number.isFinite(value) ? value : null;
}

function delta(value, previous) {
  return value === null || previous === null ? null : Math.max(0, value - previous);
}

function drawDelta(after, before) {
  return after?.opaqueDraws === before?.opaqueDraws ? delta(after?.calls ?? null, before?.calls ?? null) : null;
}

function uploadDelta(after, before) {
  if (!after || !before) return null;
  return Object.freeze({ bufferBytes: after.bufferBytes - before.bufferBytes, textureBytes: after.textureBytes - before.textureBytes,
    calls: after.calls - before.calls, unmeasuredCalls: after.unmeasuredCalls - before.unmeasuredCalls });
}

function beginThreeCounters(renderer) {
  const info = renderer.info;
  const autoReset = info?.autoReset;
  if (typeof autoReset === 'boolean') {
    if (autoReset) info.reset?.();
    info.autoReset = false;
  }
  return {
    read: () => ({ calls: counter(info, 'calls'), triangles: counter(info, 'triangles') }),
    stop() { if (typeof autoReset === 'boolean') info.autoReset = autoReset; },
  };
}

export function createRenderDiagnostics3D(THREE, renderer) {
  return createRenderDiagnostics({ getContext: () => renderer.getContext?.(),
    beginCounters: () => beginThreeCounters(renderer), describeTarget: (target, view) => describeTarget(THREE, target, view) });
}

/**
 * @typedef {object} RenderDiagnosticsOptions
 * @property {() => any} [getContext] WebGL context for GPU samples.
 * @property {() => unknown} [getIdentity] Context or device identity.
 * @property {() => boolean} [isUnavailable] Whether the backend is unavailable.
 * @property {(context: any) => {read: () => {calls: number | null, triangles: number | null, opaqueDraws?: number}, stop: () => void} | null} [beginCounters]
 * @property {(target: any, viewIndex: number) => RenderTargetUsage3D | null} [describeTarget]
 * @property {typeof beginWebGlUploadProbe} [beginUploads]
 * @property {(record: (target: any) => RenderTargetUsage3D | null) => (() => void) | null} [observeTargets]
 */

/**
 * Shared opt-in recorder for frame and ordered view submissions.
 * @param {RenderDiagnosticsOptions} [options]
 */
export function createRenderDiagnostics({ getContext, getIdentity, isUnavailable, beginCounters, describeTarget,
  beginUploads = beginWebGlUploadProbe, observeTargets } = {}) {
  const gpuSamples = [];
  let timer;
  let sourceIdentity;
  let frame = null;
  /** @type {RenderDiagnosticsSnapshot3D | null} */
  let snapshot = null;
  let frameId = 0;
  let nextGpuPass = 0;
  let gpuFrameSum = 0;
  let gpuFrameCount = 0;

  function pollGpu() {
    timer?.poll((identity, ms, status) => {
      gpuSamples.push(Object.freeze({ ...identity, status, ms }));
      if (gpuSamples.length > MAX_GPU_SAMPLES) gpuSamples.shift();
      if (identity.passIndex === null && ms !== null) {
        gpuFrameSum += ms;
        gpuFrameCount++;
      }
    });
  }

  function consumeGpuFrameMs() {
    pollGpu();
    const result = gpuFrameCount > 0 ? gpuFrameSum / gpuFrameCount : null;
    gpuFrameSum = gpuFrameCount = 0;
    return result;
  }

  function beginFrame() {
    if (frame) return false;
    const gl = getContext?.();
    const identity = getIdentity ? getIdentity() : gl;
    if (gl?.isContextLost?.() || isUnavailable?.()) {
      resetGpu(true);
      return false;
    }
    if (identity !== sourceIdentity) {
      resetGpu(true);
      sourceIdentity = identity;
    }
    if (timer === undefined) timer = createGpuFrameTimer(gl, { alternate: false });
    pollGpu();
    const counters = beginCounters?.(gl);
    const id = ++frameId;
    const wholeFrame = id % 2 === 1;
    frame = {
      id, counters, viewIndex: 0, passes: [], targets: new Map(),
      started: performance.now(), startCounts: counters?.read(),
      gpuPass: timer && !wholeFrame ? nextGpuPass++ % Math.max(1, snapshot?.passes.length ?? 0) : -1,
      frameTimer: wholeFrame && timer?.begin({ frame: id, name: 'frame', viewIndex: null, passIndex: null }) ? timer : null,
      upload: beginUploads(gl),
      stopObservingTargets: observeTargets?.(recordTarget),
    };
    return true;
  }

  function beginView(index) {
    if (frame) frame.viewIndex = index;
  }

  function recordTarget(target) {
    if (!frame || !target) return null;
    let description = frame.targets.get(target);
    if (!description) {
      description = describeTarget?.(target, frame.viewIndex);
      if (!description) return null;
      frame.targets.set(target, description);
    }
    return description;
  }

  function beginPass(name, target) {
    const current = frame;
    if (!current) return null;
    const { counters, viewIndex } = current;
    const index = current.passes.length;
    const description = recordTarget(target);
    const gpu = index === current.gpuPass && timer?.begin({ frame: current.id, name, viewIndex, passIndex: index }) ? timer : null;
    const start = performance.now();
    const before = counters?.read();
    const uploads = current.upload?.read();
    return () => {
      if (frame !== current) return;
      gpu?.end();
      const after = counters?.read();
      current.passes.push(Object.freeze({ name, viewIndex, target: description, cpuMs: performance.now() - start,
        drawCalls: drawDelta(after, before), triangles: delta(after?.triangles ?? null, before?.triangles ?? null),
        uploads: uploadDelta(current.upload?.read(), uploads) }));
    };
  }

  function endFrame(complete) {
    const current = frame;
    if (!current) return;
    frame = null;
    try {
      current.frameTimer?.end();
      const targets = [...current.targets.values()];
      const counts = current.counters?.read();
      snapshot = Object.freeze({
        frame: current.id, complete, cpuMs: performance.now() - current.started,
        drawCalls: drawDelta(counts, current.startCounts),
        triangles: delta(counts?.triangles ?? null, current.startCounts?.triangles ?? null),
        estimatedTargetBytes: targets.reduce((total, target) => total + target.bytes, 0),
        targets: Object.freeze(targets), passes: Object.freeze(current.passes),
        uploads: current.upload ? Object.freeze(current.upload.read()) : null,
        uploadMethods: Object.freeze(current.upload?.methods ?? []),
        gpu: Object.freeze({ supported: Boolean(timer), samples: Object.freeze(gpuSamples.slice()) }),
      });
    } finally {
      stopFrameObservations(current);
    }
  }

  function stopFrameObservations(current) {
    current.upload?.stop();
    current.counters?.stop();
    current.stopObservingTargets?.();
  }

  function resetGpu(forContextChange = false) {
    timer?.reset();
    if (forContextChange) {
      if (frame) {
        const current = frame;
        frame = null;
        try { timer?.end(); } finally { stopFrameObservations(current); }
      }
      timer = undefined;
      snapshot = null;
    }
    gpuSamples.length = 0;
    gpuFrameSum = gpuFrameCount = 0;
  }

  function readSnapshot() {
    const gl = getContext?.();
    const identity = getIdentity ? getIdentity() : gl;
    if (gl?.isContextLost?.() || isUnavailable?.() || identity !== sourceIdentity) {
      resetGpu(true);
      return null;
    }
    return snapshot;
  }

  return { beginFrame, endFrame, beginView, beginPass, recordTarget, consumeGpuFrameMs, resetGpu,
    snapshot: readSnapshot };
}

export function drawWithDiagnostics(renderer, onPass, name, target, scene, camera) {
  if (!onPass) {
    renderer.render(scene, camera);
    return;
  }
  const stop = onPass(name, target);
  try {
    renderer.render(scene, camera);
  } finally {
    stop?.();
  }
}
