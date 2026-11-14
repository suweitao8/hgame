import {
  VALID_LEAF_STYLES,
  normalizeRedDotPath,
  computeCommercialDayKey,
} from './helpers.js';

/**
 * Serializes unread marks, daily acknowledgements, and muted paths.
 * @param {object} ctx
 * @returns {import('./helpers.js').RedDotPersistedData}
 */
export function exportRedDotState(ctx) {
  const unread = Object.create(null);
  for (const node of ctx.unreadNodes) {
    if (node.unreadStyle) unread[node.path] = node.unreadStyle;
  }
  const dailyAck = Object.create(null);
  for (const [p, dayKey] of ctx.dailyAckMap) {
    dailyAck[p] = dayKey;
  }
  const muted = [];
  for (const node of ctx.mutedNodes) {
    if (node.muted) muted.push(node.path);
  }
  return { version: 1, unread, dailyAck, muted };
}

/**
 * Imports persisted red-dot state inside a batch.
 * @param {object} ctx
 * @param {unknown} data
 * @param {{ batch: (fn: () => void) => void, ensureNode: (path: string) => object, markDirtyUp: (node: object) => void }} ops
 */
export function importRedDotState(ctx, data, { batch, ensureNode, markDirtyUp }) {
  if (!data || typeof data !== 'object') return;
  batch(() => {
    for (const node of [...ctx.unreadNodes]) {
      node.unreadStyle = null;
      markDirtyUp(node);
    }
    ctx.unreadNodes.clear();

    for (const node of [...ctx.mutedNodes]) {
      node.muted = false;
      markDirtyUp(node);
    }
    ctx.mutedNodes.clear();

    ctx.dailyAckMap.clear();
    for (const node of ctx.dailyNodes) {
      markDirtyUp(node);
    }

    if (data.unread && typeof data.unread === 'object') {
      for (const [rawPath, style] of Object.entries(data.unread)) {
        if (typeof style !== 'string' || !VALID_LEAF_STYLES.has(style)) continue;
        const node = ensureNode(rawPath);
        node.unreadStyle = style;
        ctx.unreadNodes.add(node);
        markDirtyUp(node);
      }
    }

    if (data.dailyAck && typeof data.dailyAck === 'object') {
      for (const [rawPath, dayKey] of Object.entries(data.dailyAck)) {
        if (typeof dayKey !== 'string' || !dayKey) continue;
        const normalized = normalizeRedDotPath(rawPath);
        ctx.dailyAckMap.set(normalized, dayKey);
        const existing = ctx.nodes.get(normalized);
        if (existing) markDirtyUp(existing);
      }
    }

    if (Array.isArray(data.muted)) {
      for (const rawPath of data.muted) {
        if (typeof rawPath !== 'string') continue;
        const node = ensureNode(rawPath);
        node.muted = true;
        ctx.mutedNodes.add(node);
        markDirtyUp(node);
      }
    }

    ctx.persistDirty = false;
  });
}

/**
 * Syncs clock & commercial day key and marks time-sensitive nodes dirty.
 * @param {object} ctx
 * @param {boolean} markAffected
 * @param {(node: object) => void} markDirtyUp
 * @returns {boolean}
 */
export function syncRedDotTime(ctx, markAffected, markDirtyUp) {
  const nowMs = ctx.clock();
  const nextDayKey = computeCommercialDayKey(nowMs, {
    resetHour: ctx.resetHour,
    tzOffsetMinutes: ctx.tzOffsetMinutes,
  });
  let changed = false;

  if (nextDayKey !== ctx.cachedDayKey) {
    ctx.cachedDayKey = nextDayKey;
    if (markAffected) {
      for (const node of ctx.dailyNodes) {
        markDirtyUp(node);
      }
      changed = ctx.dailyNodes.size > 0;
    }
  }

  const prevClockMs = ctx.cachedClockMs;
  ctx.cachedClockMs = nowMs;
  if (markAffected) {
    for (const node of ctx.readyNodes) {
      if (!node.readySource || node.readySource.readyAtMs === null) continue;
      const wasReady = prevClockMs >= node.readySource.readyAtMs;
      const isReady = nowMs >= node.readySource.readyAtMs;
      if (wasReady !== isReady) {
        markDirtyUp(node);
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * Acknowledges unread & daily sources on a single node.
 * @param {object} ctx
 * @param {object} node
 * @param {(node: object) => void} markDirtyUp
 * @returns {boolean}
 */
export function ackSingleRedDotNode(ctx, node, markDirtyUp) {
  let acked = false;
  if (node.unreadStyle !== null) {
    node.unreadStyle = null;
    ctx.unreadNodes.delete(node);
    acked = true;
  }
  if (
    node.dailySource &&
    node.dailySource.enabled &&
    (!node.dailySource.condition || Boolean(node.dailySource.condition(ctx.lastContext))) &&
    ctx.dailyAckMap.get(node.path) !== ctx.cachedDayKey
  ) {
    ctx.dailyAckMap.set(node.path, ctx.cachedDayKey);
    acked = true;
  }
  if (acked) {
    ctx.persistDirty = true;
    markDirtyUp(node);
  }
  return acked;
}
