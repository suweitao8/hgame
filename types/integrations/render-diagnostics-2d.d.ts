/** @typedef {import('./quality3d/render-diagnostics.js').RenderDiagnosticsSnapshot3D} RenderDiagnosticsSnapshot2D */
/** Internal recorder shared by the native 2D adapters and the Pixi profile. */
export function createRenderDiagnostics2D({ gl, ctx, pixiRenderer }?: {
    gl?: null | undefined;
    ctx?: null | undefined;
    pixiRenderer?: null | undefined;
}): {
    beginFrame: () => boolean;
    endFrame: (complete: any) => void;
    beginView: (index: any) => void;
    beginPass: (name: any, target: any) => (() => void) | null;
    recordTarget: (target: any) => any;
    consumeGpuFrameMs: () => number | null;
    resetGpu: (forContextChange?: boolean) => void;
    getFrameStats: () => Readonly<{
        count: number;
        p50Ms: any;
        p95Ms: any;
        p99Ms: any;
        maxMs: any;
        avgMs: number;
        avgDrawCalls: number;
        avgUploadBytes: number;
    }>;
    exportChromeTrace: () => {
        traceEvents: ({
            name: string;
            cat: string;
            ph: string;
            ts: any;
            dur: any;
            pid: number;
            tid: number;
            args: {
                draws: any;
                uploadBytes: any;
                complete: any;
                targetBytes?: undefined;
            };
        } | {
            name: any;
            cat: string;
            ph: string;
            ts: any;
            dur: any;
            pid: number;
            tid: number;
            args: {
                draws: any;
                targetBytes: any;
                uploadBytes?: undefined;
                complete?: undefined;
            };
        })[];
        displayTimeUnit: string;
    };
    snapshot: () => import("./quality3d/render-diagnostics.js").RenderDiagnosticsSnapshot3D | null;
};
export type RenderDiagnosticsSnapshot2D = import("./quality3d/render-diagnostics.js").RenderDiagnosticsSnapshot3D;
