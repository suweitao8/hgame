/**
 * @typedef {'postTargets' | 'lightingTargets' | 'atlasCache' | 'textCache' | 'scratchBuffers'} RenderResourceType2D
 * @typedef {'memory-budget' | 'frame-time' | 'idle-ttl' | 'manual' | 'context-loss'} RenderEvictionReason2D
 */
/**
 * Manage reclaimable 2D render targets and CPU/GPU caches under memory, frame-time, and idle-TTL budgets.
 * @param {object} [options]
 * @param {number} [options.maxBytes=67108864] Soft memory ceiling in bytes.
 * @param {number} [options.idleFrames=120] Frames without `touch()` before idle eviction triggers.
 * @param {number} [options.frameBudgetMs=16.7] Target frame duration in milliseconds.
 * @param {number} [options.maxEvictionHistory=64] Bounded eviction log length.
 */
export function createRenderBudgetController({ maxBytes, idleFrames, frameBudgetMs, maxEvictionHistory, }?: {
    maxBytes?: number | undefined;
    idleFrames?: number | undefined;
    frameBudgetMs?: number | undefined;
    maxEvictionHistory?: number | undefined;
} | undefined): {
    registerResource: ({ id, type, bytes, priority, reclaim }: {
        id: any;
        type: any;
        bytes?: number | undefined;
        priority?: number | undefined;
        reclaim: any;
    }) => {
        id: string;
        type: any;
        bytes: number;
        priority: number;
        lastUsedFrame: number;
        reclaim: any;
    };
    touch: (id: any, bytes?: undefined) => boolean;
    unregister: (id: any) => boolean;
    setMaxBytes: (nextMaxBytes: any) => void;
    stepFrame: ({ frameTimeMs, activeBytes }?: {
        frameTimeMs?: null | undefined;
        activeBytes?: number | undefined;
    }) => number;
    reclaimByType: (type: any, reason?: string) => number;
    reclaimAll: (reason?: string) => number;
    getBudgetSnapshot: () => Readonly<{
        frame: number;
        maxBytes: number;
        totalBytes: number;
        resourceCount: number;
        byTypeBytes: any;
        totalReclaimedBytes: number;
        evictions: readonly any[];
    }>;
};
/**
 * Typed idle render target & cache budget controller for 2D rendering backends
 * (Canvas2D, WebGL2D, Pixi2D), recording reclamation trigger reasons.
 */
export const RENDER_RESOURCE_TYPES_2D: readonly string[];
export type RenderResourceType2D = "postTargets" | "lightingTargets" | "atlasCache" | "textCache" | "scratchBuffers";
export type RenderEvictionReason2D = "memory-budget" | "frame-time" | "idle-ttl" | "manual" | "context-loss";
