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
export function createLiveProfilerOverlay({
  width = 220,
  height = 96,
  maxSamples = 60,
  budgetMs = 16.67,
} = {}) {
  const cap = Math.max(10, Math.floor(maxSamples) || 60);
  const w = Math.max(120, Number(width) || 220);
  const h = Math.max(64, Number(height) || 96);
  const targetMs = Math.max(1, Number(budgetMs) || 16.67);
  const frameSamples = new Float32Array(cap);
  let cursor = 0;
  let sampleCount = 0;
  let lastDrawCalls = 0;
  let lastVramMB = 0;
  let gcSpikeCount = 0;

  function recordSample({ frameMs = 0, drawCalls = 0, vramMB = 0, gcSpikeMs = 33.4 } = {}) {
    const ms = Math.max(0, Number(frameMs) || 0);
    frameSamples[cursor] = ms;
    cursor = (cursor + 1) % cap;
    if (sampleCount < cap) sampleCount++;
    lastDrawCalls = Math.max(0, Number(drawCalls) || 0);
    lastVramMB = Math.max(0, Number(vramMB) || 0);
    if (ms >= gcSpikeMs) gcSpikeCount++;
  }

  function getStats() {
    if (sampleCount === 0) {
      return { samples: 0, avgMs: 0, p95Ms: 0, maxMs: 0, drawCalls: 0, vramMB: 0, gcSpikes: 0 };
    }
    const vals = [];
    for (let i = 0; i < sampleCount; i++) vals.push(frameSamples[i]);
    vals.sort((a, b) => a - b);
    let sum = 0;
    for (let i = 0; i < sampleCount; i++) sum += vals[i];
    return {
      samples: sampleCount,
      avgMs: Number((sum / sampleCount).toFixed(2)),
      p95Ms: Number(vals[Math.min(sampleCount - 1, Math.floor((sampleCount - 1) * 0.95))].toFixed(2)),
      maxMs: Number(vals[sampleCount - 1].toFixed(2)),
      drawCalls: lastDrawCalls,
      vramMB: Number(lastVramMB.toFixed(1)),
      gcSpikes: gcSpikeCount,
    };
  }

  function render(ctx, x = 8, y = 8) {
    if (!ctx) return null;
    const stats = getStats();
    ctx.save?.();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.84)';
    ctx.fillRect?.(x, y, w, h);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect?.(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.font = '600 11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText?.(`FPS ${stats.avgMs > 0 ? Math.round(1000 / stats.avgMs) : 0} | P95 ${stats.p95Ms}ms`, x + 8, y + 6);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText?.(`DC ${stats.drawCalls} | VRAM ${stats.vramMB}MB | GC ${stats.gcSpikes}`, x + 8, y + 22);

    const chartX = x + 8;
    const chartY = y + 40;
    const chartW = w - 16;
    const chartH = Math.max(16, h - 48);
    const barW = Math.max(1, chartW / cap);
    const maxScale = Math.max(targetMs * 2, stats.maxMs || targetMs * 2);

    for (let i = 0; i < sampleCount; i++) {
      const idx = (cursor - sampleCount + i + cap) % cap;
      const ms = frameSamples[idx];
      const barH = Math.max(2, Math.min(chartH, (ms / maxScale) * chartH));
      ctx.fillStyle = ms > targetMs * 1.5 ? '#ef4444' : (ms > targetMs ? '#f59e0b' : '#22c55e');
      ctx.fillRect?.(chartX + i * barW, chartY + chartH - barH, Math.max(1, barW - 1), barH);
    }
    ctx.restore?.();
    return stats;
  }

  function reset() {
    frameSamples.fill(0);
    cursor = 0;
    sampleCount = 0;
    lastDrawCalls = 0;
    lastVramMB = 0;
    gcSpikeCount = 0;
  }

  return Object.freeze({
    width: w,
    height: h,
    recordSample,
    getStats,
    render,
    reset,
  });
}
