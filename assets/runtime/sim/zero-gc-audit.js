/**
 * Hot-loop Zero-GC allocation & timing regression auditor for mobile HTML5 gameplay ticks.
 */

function readHeapUsed() {
  if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
    return process.memoryUsage().heapUsed;
  }
  if (typeof performance !== 'undefined' && performance?.memory && Number.isFinite(performance.memory.usedJSHeapSize)) {
    return performance.memory.usedJSHeapSize;
  }
  return 0;
}

/**
 * Execute `fn` over warmup + measured iterations and check heap growth per iteration.
 * @param {(iter: number) => void} fn
 * @param {object} [options]
 * @param {number} [options.warmup=20]
 * @param {number} [options.iterations=200]
 * @param {number} [options.maxHeapBytesPerIter=512]
 */
export function measureHotLoopAllocations(fn, {
  warmup = 20,
  iterations = 200,
  maxHeapBytesPerIter = 512,
} = {}) {
  if (typeof fn !== 'function') {
    throw new TypeError('measureHotLoopAllocations expects a callable fn');
  }
  const warmCount = Math.max(0, Math.floor(Number(warmup) || 20));
  const iterCount = Math.max(1, Math.floor(Number(iterations) || 200));
  const timings = new Float64Array(iterCount);

  for (let i = 0; i < warmCount; i++) {
    fn(i);
  }

  let bestDelta = Infinity;
  let totalMs = 0;
  for (let pass = 0; pass < 3; pass++) {
    const heapBefore = readHeapUsed();
    let passMs = 0;
    for (let i = 0; i < iterCount; i++) {
      const t0 = performance.now();
      fn(i);
      const dt = Math.max(0, performance.now() - t0);
      timings[i] = dt;
      passMs += dt;
    }
    const heapAfter = readHeapUsed();
    const delta = Math.max(0, heapAfter - heapBefore);
    if (delta < bestDelta) {
      bestDelta = delta;
      totalMs = passMs;
    }
  }

  const sorted = Float64Array.from(timings).sort();
  const p95Idx = Math.min(iterCount - 1, Math.floor(iterCount * 0.95));
  const totalHeapDelta = bestDelta === Infinity ? 0 : bestDelta;
  const bytesPerIter = totalHeapDelta / iterCount;

  return Object.freeze({
    passed: bytesPerIter <= maxHeapBytesPerIter,
    bytesPerIter: Number(bytesPerIter.toFixed(2)),
    totalHeapDelta,
    avgMs: Number((totalMs / iterCount).toFixed(4)),
    p95Ms: Number(sorted[p95Idx].toFixed(4)),
    iterations: iterCount,
  });
}
