import { createGpuFrameTimer } from './gpu-timer.js';
import { beginWebGlUploadProbe } from './upload-probe.js';

const MAX_GPU_SAMPLES = 32;
const MAX_FRAME_HISTORY = 256;

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

function textureBytesPerPixel(THREE, texture = {}) {
  if (texture.type === THREE.UnsignedInt101111Type) return 4;
  if (texture.internalFormat === 'RGBA8') return 4;
  const channels = texture.format === THREE.RedFormat ? 1 : texture.format === THREE.RGFormat ? 2 :
    texture.format === THREE.RGBFormat ? 3 : 4;
  const bytes = texture.type === THREE.FloatType ? 4 : texture.type === THREE.HalfFloatType ? 2 : 1;
  return channels * bytes;
}

/** Nominal bytes of known Three render attachments, shared by budgets and diagnostics. */
export function estimateRenderTargetBytes(THREE, target) {
  const { width, height, samples = 0, texture, depthBuffer, depthTexture, stencilBuffer } = target ?? {};
  if (!(width > 0 && height > 0)) return 0;
  return width * height * ((texture ? textureBytesPerPixel(THREE, texture) : 0) * (1 + samples) +
    (depthBuffer || stencilBuffer || depthTexture ? 4 * Math.max(1, samples) : 0) + (samples && depthTexture ? 4 : 0));
}

function describeTarget(THREE, target, viewIndex) {
  const { width, height, samples = 0 } = target;
  return Object.freeze({ viewIndex, width, height, samples, bytes: estimateRenderTargetBytes(THREE, target) });
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
 * @property {(info: {drawCalls: number | null, draws: number | null, triangles: number | null, uploads: WebGlUploadTotals | null, uploadBytes: number | null, hasTargetBytes: boolean, gpuSupported: boolean}) => Record<string, 'measured' | 'estimated' | 'unavailable'> | null} [describeMeasurementSources]
 * @property {() => {read: () => {calls: number | null, triangles: number | null}, stop: () => void} | null} [beginCanvasDraws]
 * @property {() => {methods: string[], read: () => WebGlUploadTotals, stop: () => void} | null} [beginCanvasUploads]
 */

/**
 * Shared opt-in recorder for frame and ordered view submissions.
 * @param {RenderDiagnosticsOptions} [options]
 */
export function createRenderDiagnostics({ getContext, getIdentity, isUnavailable, beginCounters, describeTarget,
  beginUploads = beginWebGlUploadProbe, observeTargets, describeMeasurementSources,
  beginCanvasDraws = null, beginCanvasUploads = null } = {}) {
  const gpuSamples = [];
  const frameHistory = [];
  let timer;
  let sourceIdentity;
  let frame = null;
  /** @type {RenderDiagnosticsSnapshot3D | null} */
  let snapshot = null;
  let frameId = 0;
  let nextGpuPass = 0;
  let gpuFrameSum = 0;
  let gpuFrameCount = 0;

  function buildMeasurementMeta({ drawCalls, draws, triangles, uploads, uploadBytes, hasTargetBytes, gpuSupported }) {
    const base = {
      cpuMs: 'measured',
      gpuMs: gpuSupported ? 'measured' : 'unavailable',
      draws: (draws ?? drawCalls) !== null ? 'measured' : 'unavailable',
      triangles: triangles !== null ? 'measured' : 'unavailable',
      uploadBytes: uploads ? (uploads.unmeasuredCalls > 0 ? 'estimated' : 'measured') : (uploadBytes !== null ? 'estimated' : 'unavailable'),
      targetBytes: hasTargetBytes ? 'estimated' : 'unavailable',
    };
    const overrides = describeMeasurementSources?.({ drawCalls, draws, triangles, uploads, uploadBytes, hasTargetBytes, gpuSupported });
    const sources = Object.freeze(overrides ? { ...base, ...overrides } : base);
    const estimatedFields = Object.freeze(Object.keys(sources).filter(key => sources[key] === 'estimated'));
    return { sources, estimatedFields };
  }

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
    const canvasCounters = !counters ? beginCanvasDraws?.() : null;
    const id = ++frameId;
    const wholeFrame = id % 2 === 1;
    frame = {
      id, counters, canvasCounters, viewIndex: 0, passes: [], targets: new Map(),
      started: performance.now(),
      startCounts: counters?.read(),
      startCanvasCounts: canvasCounters?.read(),
      gpuPass: timer && !wholeFrame ? nextGpuPass++ % Math.max(1, snapshot?.passes.length ?? 0) : -1,
      frameTimer: wholeFrame && timer?.begin({ frame: id, name: 'frame', viewIndex: null, passIndex: null }) ? timer : null,
      upload: beginUploads(gl),
      canvasUpload: !gl ? beginCanvasUploads?.() : null,
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
    const { counters, canvasCounters, viewIndex } = current;
    const index = current.passes.length;
    const description = recordTarget(target);
    const gpu = index === current.gpuPass && timer?.begin({ frame: current.id, name, viewIndex, passIndex: index }) ? timer : null;
    const start = performance.now();
    const before = counters?.read();
    const beforeCanvas = canvasCounters?.read();
    const uploads = current.upload?.read();
    const canvasUploads = current.canvasUpload?.read();
    return () => {
      if (frame !== current) return;
      gpu?.end();
      const after = counters?.read();
      const afterCanvas = canvasCounters?.read();
      const passDrawCalls = drawDelta(after, before);
      const passCanvasDraws = drawDelta(afterCanvas, beforeCanvas);
      const passDraws = passDrawCalls ?? passCanvasDraws;
      const passTris = delta(after?.triangles ?? null, before?.triangles ?? null);
      const passUploads = uploadDelta(current.upload?.read(), uploads);
      const passCanvasUploads = uploadDelta(current.canvasUpload?.read(), canvasUploads);
      const passUploadBytes = passUploads
        ? passUploads.bufferBytes + passUploads.textureBytes
        : passCanvasUploads
          ? passCanvasUploads.bufferBytes + passCanvasUploads.textureBytes
          : null;
      const passTargetBytes = description?.bytes ?? 0;
      const meta = buildMeasurementMeta({
        drawCalls: passDrawCalls,
        draws: passDraws,
        triangles: passTris,
        uploads: passUploads,
        uploadBytes: passUploadBytes,
        hasTargetBytes: true,
        gpuSupported: Boolean(gpu),
      });
      current.passes.push(Object.freeze({
        name,
        viewIndex,
        target: description,
        cpuMs: performance.now() - start,
        startedAtMs: start,
        gpuMs: null,
        drawCalls: passDrawCalls,
        draws: passDraws,
        triangles: passTris,
        uploads: passUploads,
        uploadBytes: passUploadBytes,
        targetBytes: passTargetBytes,
        measurementSources: meta.sources,
        estimatedFields: meta.estimatedFields,
      }));
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
      const canvasCounts = current.canvasCounters?.read();
      const frameDrawCalls = drawDelta(counts, current.startCounts);
      const frameCanvasDraws = drawDelta(canvasCounts, current.startCanvasCounts);
      const frameDraws = frameDrawCalls ?? frameCanvasDraws;
      const frameTris = delta(counts?.triangles ?? null, current.startCounts?.triangles ?? null);
      const frameUploads = current.upload ? Object.freeze(current.upload.read()) : null;
      const frameCanvasUploads = current.canvasUpload ? current.canvasUpload.read() : null;
      const frameUploadBytes = frameUploads
        ? frameUploads.bufferBytes + frameUploads.textureBytes
        : frameCanvasUploads
          ? frameCanvasUploads.bufferBytes + frameCanvasUploads.textureBytes
          : null;
      const frameTargetBytes = targets.reduce((total, target) => total + target.bytes, 0);
      const meta = buildMeasurementMeta({
        drawCalls: frameDrawCalls,
        draws: frameDraws,
        triangles: frameTris,
        uploads: frameUploads,
        uploadBytes: frameUploadBytes,
        hasTargetBytes: true,
        gpuSupported: Boolean(timer),
      });
      const frameCpuMs = performance.now() - current.started;
      snapshot = Object.freeze({
        frame: current.id, complete, cpuMs: frameCpuMs,
        drawCalls: frameDrawCalls,
        draws: frameDraws,
        triangles: frameTris,
        estimatedTargetBytes: frameTargetBytes,
        targetBytes: frameTargetBytes,
        targets: Object.freeze(targets), passes: Object.freeze(current.passes),
        uploads: frameUploads,
        uploadBytes: frameUploadBytes,
        uploadMethods: Object.freeze(current.upload?.methods ?? current.canvasUpload?.methods ?? []),
        gpu: Object.freeze({ supported: Boolean(timer), samples: Object.freeze(gpuSamples.slice()) }),
        measurementSources: meta.sources,
        estimatedFields: meta.estimatedFields,
      });
      frameHistory.push({
        frame: current.id,
        complete,
        startUs: Math.round(current.started * 1000),
        durUs: Math.max(1, Math.round(frameCpuMs * 1000)),
        cpuMs: frameCpuMs,
        draws: frameDraws ?? 0,
        drawCalls: frameDrawCalls ?? 0,
        uploadBytes: frameUploadBytes ?? 0,
        passes: current.passes.map(p => ({
          name: p.name,
          viewIndex: p.viewIndex,
          startUs: Math.round((p.startedAtMs ?? current.started) * 1000),
          durUs: Math.max(1, Math.round((p.cpuMs || 0) * 1000)),
          draws: p.draws ?? p.drawCalls ?? 0,
          targetBytes: p.targetBytes ?? 0,
        })),
      });
      if (frameHistory.length > MAX_FRAME_HISTORY) frameHistory.shift();
    } finally {
      stopFrameObservations(current);
    }
  }

  function stopFrameObservations(current) {
    current.upload?.stop();
    current.canvasUpload?.stop();
    current.counters?.stop();
    current.canvasCounters?.stop();
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

  function getFrameStats() {
    const count = frameHistory.length;
    if (count === 0) {
      return Object.freeze({
        count: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        maxMs: 0,
        avgMs: 0,
        avgDrawCalls: 0,
        avgUploadBytes: 0,
      });
    }
    const sorted = frameHistory.map(f => f.cpuMs).sort((a, b) => a - b);
    const pct = p => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
    let sumMs = 0, sumDraws = 0, sumBytes = 0;
    for (const f of frameHistory) {
      sumMs += f.cpuMs;
      sumDraws += f.draws;
      sumBytes += f.uploadBytes;
    }
    return Object.freeze({
      count,
      p50Ms: pct(0.5),
      p95Ms: pct(0.95),
      p99Ms: pct(0.99),
      maxMs: sorted[sorted.length - 1],
      avgMs: sumMs / count,
      avgDrawCalls: sumDraws / count,
      avgUploadBytes: sumBytes / count,
    });
  }

  function exportChromeTrace() {
    const traceEvents = [];
    for (const f of frameHistory) {
      traceEvents.push({
        name: `frame#${f.frame}`,
        cat: 'render',
        ph: 'X',
        ts: f.startUs,
        dur: f.durUs,
        pid: 1,
        tid: 0,
        args: { draws: f.draws, uploadBytes: f.uploadBytes, complete: f.complete },
      });
      for (const p of f.passes) {
        traceEvents.push({
          name: p.name,
          cat: 'render.pass',
          ph: 'X',
          ts: p.startUs,
          dur: p.durUs,
          pid: 1,
          tid: 1 + (Number(p.viewIndex) || 0),
          args: { draws: p.draws, targetBytes: p.targetBytes },
        });
      }
    }
    return { traceEvents, displayTimeUnit: 'ms' };
  }

  return { beginFrame, endFrame, beginView, beginPass, recordTarget, consumeGpuFrameMs, resetGpu,
    getFrameStats, exportChromeTrace, snapshot: readSnapshot };
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
