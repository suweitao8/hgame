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
    snapshot: () => import("./quality3d/render-diagnostics.js").RenderDiagnosticsSnapshot3D | null;
};
export type RenderDiagnosticsSnapshot2D = import("./quality3d/render-diagnostics.js").RenderDiagnosticsSnapshot3D;
