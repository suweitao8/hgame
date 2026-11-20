export function createFramePhases(): {
    on: (phase: FramePhase, callback: FramePhaseCallback, { order, signal }?: FramePhaseOptions | undefined) => () => boolean;
    run: (phase: FramePhase, app: import("../application.js").GameApplication, scene: import("../scene.js").Scene, signal: AbortSignal, deltaSeconds: number) => boolean;
    dispose: () => void;
};
export type FramePhase = "beforeFixedUpdate" | "afterPhysics" | "beforeUpdate" | "beforeLateUpdate" | "beforeRender" | "afterRender";
export type FramePhaseContext = {
    phase: FramePhase;
    app: import("../application.js").GameApplication;
    scene: import("../scene.js").Scene;
    /**
     * The current scene activation.
     */
    signal: AbortSignal;
    /**
     * Fixed or scaled frame seconds. Render-only calls use zero.
     */
    deltaSeconds: number;
};
export type FramePhaseCallback = (context: FramePhaseContext) => void;
export type FramePhaseOptions = {
    order?: number;
    signal?: AbortSignal;
};
export type PhaseListener = {
    order: number;
    callback: FramePhaseCallback;
    active: boolean;
    signal?: AbortSignal;
    remove: () => boolean;
};
