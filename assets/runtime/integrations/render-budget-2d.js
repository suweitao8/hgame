/**
 * Typed idle render target & cache budget controller for 2D rendering backends
 * (Canvas2D, WebGL2D, Pixi2D), recording reclamation trigger reasons.
 */

export const RENDER_RESOURCE_TYPES_2D = Object.freeze([
  'postTargets',
  'lightingTargets',
  'atlasCache',
  'textCache',
  'scratchBuffers',
]);

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
export function createRenderBudgetController({
  maxBytes = 64 * 1024 * 1024,
  idleFrames = 600,
  frameBudgetMs = 16.7,
  maxEvictionHistory = 64,
} = {}) {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) throw new RangeError('maxBytes must be >= 0');
  if (!Number.isSafeInteger(idleFrames) || idleFrames < 1) throw new RangeError('idleFrames must be >= 1');
  if (!Number.isFinite(frameBudgetMs) || frameBudgetMs <= 0) throw new RangeError('frameBudgetMs must be > 0');

  /** @type {Map<string, { id: string, type: RenderResourceType2D, bytes: number, priority: number, lastUsedFrame: number, reclaim: (reason: RenderEvictionReason2D) => number | void }>} */
  const entries = new Map();
  const evictions = [];
  let frame = 0;
  let totalReclaimedBytes = 0;
  let currentMaxBytes = maxBytes;

  function totalBytes() {
    let sum = 0;
    for (const entry of entries.values()) sum += entry.bytes;
    return sum;
  }

  function recordEviction(entry, reclaimedBytes, reason) {
    totalReclaimedBytes += reclaimedBytes;
    evictions.push(Object.freeze({
      frame,
      id: entry.id,
      resourceType: entry.type,
      reclaimedBytes,
      reason,
    }));
    if (evictions.length > maxEvictionHistory) evictions.shift();
  }

  function evictEntry(entry, reason) {
    entries.delete(entry.id);
    let freed = entry.bytes;
    try {
      const result = entry.reclaim(reason);
      if (typeof result === 'number' && Number.isFinite(result) && result >= 0) {
        freed = result;
      }
    } finally {
      recordEviction(entry, freed, reason);
    }
    return freed;
  }

  function registerResource({ id, type, bytes = 0, priority = 0, reclaim }) {
    if (typeof id !== 'string' || !id) throw new TypeError('Resource id must be a non-empty string');
    if (!RENDER_RESOURCE_TYPES_2D.includes(type)) throw new RangeError('Unknown 2D resource type: ' + type);
    if (typeof reclaim !== 'function') throw new TypeError('Resource requires a reclaim callback');
    const safeBytes = Math.max(0, Number(bytes) || 0);
    const entry = {
      id,
      type,
      bytes: safeBytes,
      priority: Number(priority) || 0,
      lastUsedFrame: frame,
      reclaim,
    };
    entries.set(id, entry);
    return entry;
  }

  function touch(id, bytes = undefined) {
    const entry = entries.get(id);
    if (!entry) return false;
    entry.lastUsedFrame = frame;
    if (bytes !== undefined && Number.isFinite(bytes) && bytes >= 0) {
      entry.bytes = bytes;
    }
    return true;
  }

  function unregister(id) {
    return entries.delete(id);
  }

  function setMaxBytes(nextMaxBytes) {
    if (!Number.isFinite(nextMaxBytes) || nextMaxBytes < 0) throw new RangeError('maxBytes must be >= 0');
    currentMaxBytes = nextMaxBytes;
  }

  function stepFrame({ frameTimeMs = null, activeBytes = 0 } = {}) {
    let reclaimedThisStep = 0;

    // 1. Idle TTL pass
    for (const entry of [...entries.values()]) {
      if (frame - entry.lastUsedFrame >= idleFrames) {
        reclaimedThisStep += evictEntry(entry, 'idle-ttl');
      }
    }

    // 2. Memory budget pass (reclaim oldest/lowest-priority idle entries first)
    let overBudget = totalBytes() + Math.max(0, Number(activeBytes) || 0) - currentMaxBytes;
    if (overBudget > 0 && entries.size > 0) {
      const candidates = [...entries.values()]
        .filter(e => e.lastUsedFrame < frame)
        .sort((a, b) => (a.priority - b.priority) || (a.lastUsedFrame - b.lastUsedFrame) || (b.bytes - a.bytes));
      for (const entry of candidates) {
        if (overBudget <= 0) break;
        const freed = evictEntry(entry, 'memory-budget');
        reclaimedThisStep += freed;
        overBudget -= freed;
      }
    }

    // 3. Frame-time pressure pass (shed non-essential idle post/cache targets)
    if (frameTimeMs !== null && Number.isFinite(frameTimeMs) && frameTimeMs > frameBudgetMs * 1.25 && entries.size > 0) {
      const candidates = [...entries.values()]
        .filter(e => e.lastUsedFrame < frame)
        .sort((a, b) => (a.priority - b.priority) || (a.lastUsedFrame - b.lastUsedFrame));
      if (candidates.length > 0) {
        reclaimedThisStep += evictEntry(candidates[0], 'frame-time');
      }
    }

    frame++;
    return reclaimedThisStep;
  }

  function reclaimByType(type, reason = 'manual') {
    if (!RENDER_RESOURCE_TYPES_2D.includes(type)) throw new RangeError('Unknown 2D resource type: ' + type);
    let freed = 0;
    for (const entry of [...entries.values()]) {
      if (entry.type === type) freed += evictEntry(entry, reason);
    }
    return freed;
  }

  function reclaimAll(reason = 'context-loss') {
    let freed = 0;
    for (const entry of [...entries.values()]) {
      freed += evictEntry(entry, reason);
    }
    return freed;
  }

  function getBudgetSnapshot() {
    const byTypeBytes = Object.create(null);
    for (const t of RENDER_RESOURCE_TYPES_2D) byTypeBytes[t] = 0;
    let sum = 0;
    for (const entry of entries.values()) {
      sum += entry.bytes;
      byTypeBytes[entry.type] += entry.bytes;
    }
    return Object.freeze({
      frame,
      maxBytes: currentMaxBytes,
      totalBytes: sum,
      resourceCount: entries.size,
      byTypeBytes: Object.freeze(byTypeBytes),
      totalReclaimedBytes,
      evictions: Object.freeze(evictions.slice()),
    });
  }

  return {
    registerResource,
    touch,
    unregister,
    setMaxBytes,
    stepFrame,
    reclaimByType,
    reclaimAll,
    getBudgetSnapshot,
  };
}
