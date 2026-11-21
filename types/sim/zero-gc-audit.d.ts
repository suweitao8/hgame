/**
 * Execute `fn` over warmup + measured iterations and check heap growth per iteration.
 * @param {(iter: number) => void} fn
 * @param {object} [options]
 * @param {number} [options.warmup=20]
 * @param {number} [options.iterations=200]
 * @param {number} [options.maxHeapBytesPerIter=512]
 */
export function measureHotLoopAllocations(fn: (iter: number) => void, { warmup, iterations, maxHeapBytesPerIter, }?: {
    warmup?: number | undefined;
    iterations?: number | undefined;
    maxHeapBytesPerIter?: number | undefined;
} | undefined): Readonly<{
    passed: boolean;
    bytesPerIter: number;
    totalHeapDelta: number;
    avgMs: number;
    p95Ms: number;
    iterations: number;
}>;
