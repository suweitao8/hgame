/**
 * Lightweight zero-dependency live performance profiler HUD overlay rendered directly to Canvas2D.
 * Tracks bounded ring-buffer frame times, draw calls, VRAM MB, and GC spike events.
 * Intended strictly behind debug flags (`?debug=1` / backtick), never shipping in player HUDs.
 */
/**
 * @param {object} [options]
 * @param {number} [options.width=220]
 * @param {number} [options.height=96]
 * @param {number} [options.maxSamples=60]
 * @param {number} [options.budgetMs=16.67]
 */
export function createLiveProfilerOverlay({ width, height, maxSamples, budgetMs, }?: {
    width?: number | undefined;
    height?: number | undefined;
    maxSamples?: number | undefined;
    budgetMs?: number | undefined;
} | undefined): Readonly<{
    width: number;
    height: number;
    recordSample: ({ frameMs, drawCalls, vramMB, gcSpikeMs }?: {
        frameMs?: number | undefined;
        drawCalls?: number | undefined;
        vramMB?: number | undefined;
        gcSpikeMs?: number | undefined;
    }) => void;
    getStats: () => {
        samples: number;
        avgMs: number;
        p95Ms: number;
        maxMs: number;
        drawCalls: number;
        vramMB: number;
        gcSpikes: number;
    };
    render: (ctx: any, x?: number, y?: number) => {
        samples: number;
        avgMs: number;
        p95Ms: number;
        maxMs: number;
        drawCalls: number;
        vramMB: number;
        gcSpikes: number;
    } | null;
    reset: () => void;
}>;
