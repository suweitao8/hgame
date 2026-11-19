/** Internal opt-in recorder for the adapter's frame and ordered view draws. */
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
