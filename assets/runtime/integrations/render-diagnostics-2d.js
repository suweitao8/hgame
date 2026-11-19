import { createRenderDiagnostics } from './quality3d/render-diagnostics.js';
import { beginWebGlUploadProbe } from './quality3d/upload-probe.js';

function observeMethod(receiver, name, measure) {
  try {
    const original = receiver?.[name];
    if (typeof original !== 'function') return null;
    const descriptor = Object.getOwnPropertyDescriptor(receiver, name);
    let active = true;
    const wrapper = function (...args) {
      const result = Reflect.apply(original, this, args);
      if (active) {
        try { measure(args, result); } catch { /* A collector must not interrupt rendering. */ }
      }
      return result;
    };
    Object.defineProperty(receiver, name, descriptor && 'value' in descriptor ? { ...descriptor, value: wrapper } :
      { configurable: true, writable: true, enumerable: descriptor?.enumerable ?? false, value: wrapper });
    return () => {
      active = false;
      try {
        if (Object.getOwnPropertyDescriptor(receiver, name)?.value !== wrapper) return;
        if (descriptor) Object.defineProperty(receiver, name, descriptor);
        else delete receiver[name];
      } catch { /* A newly sealed receiver keeps an inert forwarder. */ }
    };
  } catch { return null; }
}

function beginGlDrawCounters(gl) {
  let calls = 0;
  let triangles = 0;
  function count(mode, vertices, instances) {
    calls++;
    const faces = mode === 4 ? Math.floor(vertices / 3) : mode === 5 || mode === 6 ? Math.max(0, vertices - 2) : 0;
    triangles += faces * instances;
  }
  const stops = [
    observeMethod(gl, 'drawArrays', args => count(args[0], args[2], 1)),
    observeMethod(gl, 'drawElements', args => count(args[0], args[1], 1)),
    observeMethod(gl, 'drawArraysInstanced', args => count(args[0], args[2], args[3])),
    observeMethod(gl, 'drawElementsInstanced', args => count(args[0], args[1], args[4])),
    observeMethod(gl, 'drawRangeElements', args => count(args[0], args[3], 1)),
  ];
  if (!stops.some(Boolean)) return null;
  return { read: () => ({ calls, triangles }), stop() { for (const stop of stops) stop?.(); } };
}

function beginWebGpuDrawCounters(device) {
  let calls = 0;
  let opaqueDraws = 0;
  const stops = [];
  function measure(receiver, name, callback) {
    const stop = observeMethod(receiver, name, callback);
    if (stop) stops.push(stop);
    else opaqueDraws++;
  }
  const deviceHook = observeMethod(device, 'createCommandEncoder', (_args, encoder) => {
    measure(encoder, 'beginRenderPass', (_args, pass) => {
      for (const name of ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect']) measure(pass, name, () => calls++);
      measure(pass, 'executeBundles', args => { if (args[0]?.length !== 0) opaqueDraws++; });
    });
  });
  if (!deviceHook) return null;
  return {
    read: () => ({ calls, triangles: null, opaqueDraws }),
    stop() {
      for (let i = stops.length - 1; i >= 0; i--) stops[i]();
      deviceHook();
    },
  };
}

function formatBytes(format) {
  if (typeof format !== 'string') return null;
  if (/^(rgba|bgra)8|^rgb10a2|^rg11b10|^depth24plus|^depth32float$/.test(format)) return 4;
  if (/^rgba16|^rg32|^depth32float-stencil8$/.test(format)) return 8;
  if (/^rgba32/.test(format)) return 16;
  if (/^rg16|^r32/.test(format)) return 4;
  if (/^rg8|^r16|^depth16/.test(format)) return 2;
  if (/^r8|^stencil8/.test(format)) return 1;
  return null;
}

function bufferWriteBytes(source, offset = 0, size) {
  const elementBytes = source?.BYTES_PER_ELEMENT ?? 1;
  const bytes = size === undefined ? source?.byteLength - offset * elementBytes : size * elementBytes;
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

function textureWriteBytes(destination, size) {
  const width = size?.width ?? size?.[0];
  const height = size?.height ?? size?.[1] ?? 1;
  const layers = size?.depthOrArrayLayers ?? size?.[2] ?? 1;
  const bytes = formatBytes(destination?.texture?.format);
  return bytes && [width, height, layers].every(value => Number.isSafeInteger(value) && value >= 0)
    ? width * height * layers * bytes : null;
}

function beginWebGpuUploads(queue) {
  const totals = { bufferBytes: 0, textureBytes: 0, calls: 0, unmeasuredCalls: 0 };
  const methods = [];
  const stops = [];
  function observe(name, field, bytes) {
    const stop = observeMethod(queue, name, args => {
      const count = bytes(args);
      if (count === 0) return;
      totals.calls++;
      if (count === null) totals.unmeasuredCalls++;
      else totals[field] += count;
    });
    if (stop) { methods.push(name); stops.push(stop); }
  }
  observe('writeBuffer', 'bufferBytes', args => bufferWriteBytes(args[2], args[3], args[4]));
  observe('writeTexture', 'textureBytes', args => textureWriteBytes(args[0], args[3]));
  observe('copyExternalImageToTexture', 'textureBytes', args => textureWriteBytes(args[1], args[2]));
  return stops.length ? { methods, read: () => ({ ...totals }), stop() { for (const stop of stops) stop(); } } : null;
}

function describeTarget(target, viewIndex, screenTarget) {
  // Pixi WebGPU also marks offscreen targets as root for its coordinate convention.
  if (screenTarget ? target === screenTarget : target.isRoot) return null;
  const width = target.pixelWidth ?? target.w ?? target.width;
  const height = target.pixelHeight ?? target.h ?? target.height;
  if (!(width > 0 && height > 0)) return null;
  let bytesPerPixel = 4;
  if (target.colorAttachments) {
    // Pixi owns attachment formats and GPU/MSAA resources. Count explicit base-level attachments.
    bytesPerPixel = target.colorAttachments.reduce((sum, attachment) => sum + (formatBytes(attachment.texture?.format) ?? 0), 0);
    bytesPerPixel += formatBytes(target.depthStencilAttachment?.texture?.format) ?? 0;
  }
  return Object.freeze({ viewIndex, width, height, samples: 0, bytes: width * height * bytesPerPixel });
}

/** @typedef {import('./quality3d/render-diagnostics.js').RenderDiagnosticsSnapshot3D} RenderDiagnosticsSnapshot2D */

/** Internal recorder shared by the native 2D adapters and the Pixi profile. */
export function createRenderDiagnostics2D({ gl = null, pixiRenderer = null } = {}) {
  const getContext = () => pixiRenderer?.gl ?? gl;
  let device;
  let deviceState;
  function getIdentity() {
    const current = pixiRenderer?.gpu?.device;
    if (device !== current) {
      device = current;
      const state = { lost: false };
      deviceState = state;
      current?.lost?.then(() => { state.lost = true; });
    }
    return current ?? getContext();
  }
  return createRenderDiagnostics({
    getContext, getIdentity,
    isUnavailable: () => deviceState?.lost === true,
    beginCounters: context => context ? beginGlDrawCounters(context) : beginWebGpuDrawCounters(device),
    beginUploads: context => context ? beginWebGlUploadProbe(context) : beginWebGpuUploads(pixiRenderer?.gpu?.device?.queue),
    describeTarget: (target, viewIndex) => describeTarget(target, viewIndex, pixiRenderer?.view?.renderTarget),
    observeTargets: record => observeMethod(pixiRenderer?.renderTarget, 'bind', (_args, target) => record(target)),
  });
}
