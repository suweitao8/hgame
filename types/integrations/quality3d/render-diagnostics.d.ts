export function createRenderDiagnostics3D(THREE: any, renderer: any): {
    beginFrame: () => boolean;
    endFrame: (complete: any) => void;
    beginView: (index: any) => void;
    beginPass: (name: any, target: any) => (() => void) | null;
    recordTarget: (target: any) => any;
    consumeGpuFrameMs: () => number | null;
    resetGpu: (forContextChange?: boolean) => void;
    snapshot: () => RenderDiagnosticsSnapshot3D | null;
};
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
export function createRenderDiagnostics({ getContext, getIdentity, isUnavailable, beginCounters, describeTarget, beginUploads, observeTargets }?: RenderDiagnosticsOptions | undefined): {
    beginFrame: () => boolean;
    endFrame: (complete: any) => void;
    beginView: (index: any) => void;
    beginPass: (name: any, target: any) => (() => void) | null;
    recordTarget: (target: any) => any;
    consumeGpuFrameMs: () => number | null;
    resetGpu: (forContextChange?: boolean) => void;
    snapshot: () => RenderDiagnosticsSnapshot3D | null;
};
export function drawWithDiagnostics(renderer: any, onPass: any, name: any, target: any, scene: any, camera: any): void;
export type RenderTargetUsage3D = {
    viewIndex: number;
    width: number;
    height: number;
    samples: number;
    bytes: number;
};
export type WebGlUploadTotals = import("./upload-probe.js").WebGlUploadTotals;
export type RenderStageSample3D = {
    name: string;
    viewIndex: number;
    target: RenderTargetUsage3D | null;
    cpuMs: number;
    drawCalls: number | null;
    triangles: number | null;
    uploads: WebGlUploadTotals | null;
};
export type RenderGpuSample3D = {
    frame: number;
    name: string;
    viewIndex: number | null;
    passIndex: number | null;
    status: "ready" | "disjoint" | "expired" | "invalid";
    ms: number | null;
};
export type RenderDiagnosticsSnapshot3D = {
    /**
     * Adapter frame serial.
     */
    frame: number;
    /**
     * True if the frame finished rendering.
     */
    complete: boolean;
    /**
     * Whole frame CPU time including view setup.
     */
    cpuMs: number;
    /**
     * WebGL draw calls, if reported by the renderer.
     */
    drawCalls: number | null;
    /**
     * Triangles submitted, if reported by the renderer.
     */
    triangles: number | null;
    /**
     * Nominal payload of the counted offscreen attachments.
     */
    estimatedTargetBytes: number;
    /**
     * Unique targets in the rendered views.
     */
    targets: readonly RenderTargetUsage3D[];
    /**
     * CPU submission samples in execution order.
     */
    passes: readonly RenderStageSample3D[];
    /**
     * Client transfer payloads submitted while this adapter rendered the frame.
     */
    uploads: WebGlUploadTotals | null;
    /**
     * WebGL calls covered by the frame's upload probe.
     */
    uploadMethods: readonly string[];
    /**
     * Recent asynchronously resolved GPU samples, keyed by frame and view.
     */
    gpu: {
        supported: boolean;
        samples: readonly RenderGpuSample3D[];
    };
};
export type RenderDiagnosticsOptions = {
    /**
     * WebGL context for GPU samples.
     */
    getContext?: (() => any) | undefined;
    /**
     * Context or device identity.
     */
    getIdentity?: (() => unknown) | undefined;
    /**
     * Whether the backend is unavailable.
     */
    isUnavailable?: (() => boolean) | undefined;
    beginCounters?: ((context: any) => {
        read: () => {
            calls: number | null;
            triangles: number | null;
            opaqueDraws?: number;
        };
        stop: () => void;
    } | null) | undefined;
    describeTarget?: ((target: any, viewIndex: number) => RenderTargetUsage3D | null) | undefined;
    beginUploads?: typeof beginWebGlUploadProbe | undefined;
    observeTargets?: ((record: (target: any) => RenderTargetUsage3D | null) => (() => void) | null) | undefined;
};
import { beginWebGlUploadProbe } from './upload-probe.js';
