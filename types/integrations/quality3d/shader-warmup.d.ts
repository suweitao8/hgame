/**
 * Create an incremental shader warmup queue bounded by a per-frame millisecond budget.
 * @param {object} THREE Three.js namespace or compatible mock.
 * @param {object} renderer WebGLRenderer / WebGPURenderer compatible instance.
 * @param {object} [options]
 * @param {number} [options.budgetMsPerFrame=4] Default millisecond budget per `step()` call.
 * @param {() => number} [options.now] Clock function returning milliseconds.
 */
export function createShaderWarmupQueue3D(THREE: object, renderer: object, { budgetMsPerFrame, now, }?: {
    budgetMsPerFrame?: number | undefined;
    now?: (() => number) | undefined;
} | undefined): {
    enqueue: (target: any, camera: any) => number;
    enqueueMaterials: (materials: any, camera: any) => number;
    step: (budgetMs?: number) => {
        compiled: number;
        failed: number;
        remaining: number;
        elapsedMs: number;
        done: boolean;
    };
    warmupAll: (camera?: null) => Promise<{
        queued: number;
        compiled: number;
        failed: number;
        totalMs: number;
        done: boolean;
    }>;
    getStats: () => {
        queued: number;
        compiled: number;
        failed: number;
        totalMs: number;
        done: boolean;
    };
    clear: () => void;
    dispose: () => boolean;
};
