import {
  RED_DOT_STYLES,
  VALID_LEAF_STYLES,
  VALID_DISPLAY_MODES,
  assertValidStyle,
  readPersistedData,
  writePersistedData,
  parseRuleResult,
  normalizeRedDotPath,
  splitRedDotAncestors,
  computeCommercialDayKey,
  formatRedDotBadge,
} from './red-dot/helpers.js';
import { buildEmptyState, createRedDotGraph } from './red-dot/graph.js';
import {
  exportRedDotState,
  importRedDotState,
  syncRedDotTime,
  ackSingleRedDotNode,
} from './red-dot/persistence.js';

export {
  RED_DOT_STYLES,
  normalizeRedDotPath,
  splitRedDotAncestors,
  computeCommercialDayKey,
  formatRedDotBadge,
};

/** @typedef {import('./red-dot/helpers.js').RedDotStyle} RedDotStyle */
/** @typedef {import('./red-dot/helpers.js').RedDotLeafStyle} RedDotLeafStyle */
/** @typedef {import('./red-dot/helpers.js').RedDotDisplayMode} RedDotDisplayMode */
/** @typedef {import('./red-dot/helpers.js').RedDotState} RedDotState */
/** @typedef {import('./red-dot/helpers.js').RedDotStorage} RedDotStorage */
/** @typedef {import('./red-dot/helpers.js').RedDotPersistedData} RedDotPersistedData */
/** @typedef {import('./red-dot/helpers.js').RedDotRuleResult} RedDotRuleResult */
/** @typedef {import('./red-dot/helpers.js').RedDotBadgeFormatOptions} RedDotBadgeFormatOptions */
/** @typedef {import('./red-dot/helpers.js').RedDotDayKeyOptions} RedDotDayKeyOptions */

/**
 * @typedef {object} RedDotSystemOptions
 * @property {RedDotStorage | null} [storage=null] Persistence backend (HGame save store or Web Storage-like). State is loaded at creation.
 * @property {string} [storageKey='redDotState'] Key used with storage.
 * @property {() => number} [clock] Millisecond clock (default Date.now); inject for deterministic tests.
 * @property {number} [resetHour=0] Local hour (integer 0..23) at which daily nodes reset.
 * @property {number} [tzOffsetMinutes] Fixed UTC offset in minutes for the day key; omitted = host local time.
 * @property {number} [maxCount=99] Default cap for number badges (positive integer).
 * @property {string} [newLabel='NEW'] Default text for 'new' badges.
 */

/**
 * Per-node configuration for RedDotSystem#configure. Omitted fields stay unchanged.
 * @typedef {object} RedDotNodeConfig
 * @property {RedDotDisplayMode} [displayMode] Force a style or 'auto' to derive it from children.
 * @property {number | null} [maxCount] Node-specific number cap (positive integer) or null to use the system default.
 * @property {string | null} [newLabel] Node-specific 'new' text or null to use the system default.
 * @property {boolean} [unlocked] Gate the node (and its subtree) behind a feature unlock.
 * @property {boolean} [muted] Suppress the node's badge (anti-harassment).
 */

/**
 * What a rule evaluator may return: a boolean (dot), a number (count) or an object.
 * @typedef {boolean | number | { count?: number | boolean, style?: RedDotLeafStyle }} RedDotRuleReturn
 */

/**
 * Rule evaluator invoked by evaluate() with the user context.
 * @template [C=unknown]
 * @callback RedDotRuleEvaluator
 * @param {C} context Value last passed to evaluate()/refreshTime().
 * @returns {RedDotRuleReturn}
 */

/**
 * @typedef {object} RedDotDailyOptions
 * @property {RedDotLeafStyle} [style='dot'] Badge style while unacknowledged.
 * @property {boolean} [enabled=true] Disable to suspend the daily source.
 * @property {((context: unknown) => boolean) | null} [condition=null] Extra gate evaluated against the last context.
 */

/**
 * One contributing source reported by RedDotSystem#explain.
 * @typedef {object} RedDotActiveSource
 * @property {string} path Node path that owns the source.
 * @property {number} count Own contribution count.
 * @property {RedDotStyle} style Own style.
 * @property {Array<'value' | 'rule' | 'unread' | 'daily' | 'ready'>} reasons Source kinds currently active.
 */

/**
 * Diagnostic report from RedDotSystem#explain.
 * @typedef {object} RedDotExplanation
 * @property {string} path Normalized node path.
 * @property {RedDotState} state Current resolved state.
 * @property {string | null} blockedByUnlock Highest locked ancestor path (or the node itself), else null.
 * @property {boolean} muted Whether the node is muted.
 * @property {RedDotActiveSource[]} activeSources Active contributing nodes sorted by path.
 */

/**
 * @callback RedDotListener
 * @param {RedDotState} state
 * @returns {void}
 */

/**
 * Hierarchical red-dot system API. Paths accept '/' or '.' separators.
 * @typedef {object} RedDotSystem
 * @property {string} dayKey Current commercial day key YYYY-MM-DD (getter).
 * @property {(path: string, config?: RedDotNodeConfig) => string} configure Configure a node; returns its normalized path.
 * @property {(parentPath: string, childPath: string) => boolean} link Add a DAG edge (diamond-deduplicated); false if already linked, throws on cycles.
 * @property {(parentPath: string, childPath: string) => boolean} unlink Remove a DAG edge; false if absent.
 * @property {(path: string, unlocked: boolean) => boolean} setUnlocked Lock/unlock a subtree; returns the effective unlock state.
 * @property {(path: string) => boolean} isUnlocked Effective unlock state (true for unknown unlocked paths).
 * @property {(path: string, muted: boolean) => boolean} setMuted Mute/unmute a node; returns the new state.
 * @property {(path: string) => boolean} isMuted Whether the node is muted.
 * @property {(path: string, count: number, options?: { style?: RedDotLeafStyle }) => number} setValue Set a numeric leaf (default style 'number'); returns the normalized count.
 * @property {(path: string, active: boolean, options?: { style?: RedDotLeafStyle }) => boolean} setFlag Set a boolean leaf (default style 'dot').
 * @property {(path: string, evaluator: RedDotRuleEvaluator, options?: { style?: RedDotLeafStyle }) => () => void} registerRule Register a rule evaluator; returns an unregister function.
 * @property {(prefixOrPaths?: string | string[] | unknown, context?: unknown) => void} evaluate Re-run rules (optionally limited to path prefixes) with a context.
 * @property {(path: string, options?: { style?: RedDotLeafStyle }) => void} markUnread Persistently mark a node unread (default style 'new').
 * @property {(parentPath: string, itemIds: Iterable<string | number>, options?: { style?: RedDotLeafStyle }) => void} markUnreadBatch Mark many children of a parent unread in one batch.
 * @property {(path: string) => boolean} clearUnread Clear an unread mark; false if none.
 * @property {(path: string) => boolean} isUnread Whether the node has an unread mark.
 * @property {(parentPath: string, validItemIds: Iterable<string | number>) => number} syncUnreadScope Drop unread marks under a parent whose ids are not listed; returns removed count.
 * @property {(path: string, options?: RedDotDailyOptions) => () => void} registerDaily Register a once-per-day source; returns an unregister function.
 * @property {(path: string) => boolean} acknowledgeDaily Acknowledge today's daily source; false if already acknowledged.
 * @property {(path: string) => boolean} isDailyAcknowledged Whether today's daily source was acknowledged.
 * @property {(path: string, readyAtMs: number | null | undefined, options?: { style?: RedDotLeafStyle }) => boolean} setReadyAt Show a badge once the clock reaches readyAtMs (ms timestamp); null clears. Returns whether it is ready now.
 * @property {(path: string) => boolean} clearReadyAt Remove a ready timer; false if none.
 * @property {(path: string, options?: { recursive?: boolean }) => number} acknowledge Clear unread/daily sources on a node (and its subtree when recursive); returns acknowledged node count.
 * @property {(context?: unknown) => void} refreshTime Re-sync the clock/day key and optionally update the context.
 * @property {<R>(fn: (system: RedDotSystem) => R) => R | undefined} batch Run fn with listener emission deferred until it returns.
 * @property {() => boolean} flush Recompute dirty nodes and notify listeners; true if any state changed.
 * @property {(path: string) => RedDotState} getState Current state of a node (default empty state for unknown paths).
 * @property {(path: string) => boolean} isActive Whether the node currently shows a badge.
 * @property {(path: string) => number} getCount Aggregated count of the node.
 * @property {(path: string) => RedDotExplanation} explain Diagnostic breakdown of why a node is (in)active.
 * @property {(path: string, listener: RedDotListener, options?: { immediate?: boolean }) => () => void} subscribe Listen to one node (immediate defaults to true); returns an unsubscribe function.
 * @property {(listener: RedDotListener) => () => void} subscribeAny Listen to every node change; returns an unsubscribe function.
 * @property {() => RedDotPersistedData} exportState Serialize unread/daily/muted state.
 * @property {(data: RedDotPersistedData) => void} importState Replace persisted state with data.
 * @property {(options?: { clearPersistence?: boolean }) => void} reset Reset all nodes to defaults.
 * @property {() => void} dispose Flush pending persistence, drop listeners and nodes.
 */

/**
 * Creates a hierarchical Trie + DAG Red Dot System with dirty batching,
 * 4 commercial leaf trigger modes, diamond deduplication, unlock gating,
 * anti-harassment muting, and optional persistence.
 * @param {RedDotSystemOptions} [options]
 * @returns {RedDotSystem}
 */
export function createRedDotSystem({
  storage = null,
  storageKey = 'redDotState',
  clock = () => Date.now(),
  resetHour = 0,
  tzOffsetMinutes,
  maxCount = 99,
  newLabel = 'NEW',
} = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (!Number.isInteger(resetHour) || resetHour < 0 || resetHour > 23) {
    throw new RangeError('resetHour must be an integer between 0 and 23');
  }
  if (!Number.isInteger(maxCount) || maxCount < 1) {
    throw new RangeError('maxCount must be a positive integer');
  }

  const initialClock = clock();
  const ctx = {
    nodes: new Map(),
    dirtySet: new Set(),
    ruleNodes: new Set(),
    unreadNodes: new Set(),
    dailyNodes: new Set(),
    readyNodes: new Set(),
    mutedNodes: new Set(),
    dailyAckMap: new Map(),
    clock,
    resetHour,
    tzOffsetMinutes,
    maxCount,
    newLabel,
    dagLinkCount: 0,
    persistDirty: false,
    lastContext: undefined,
    cachedClockMs: initialClock,
    cachedDayKey: computeCommercialDayKey(initialClock, { resetHour, tzOffsetMinutes }),
  };

  const pathListeners = new Map();
  const anyListeners = new Set();
  let batchDepth = 0;
  let flushing = false;
  let disposed = false;

  const {
    ensureNode,
    markDirtyUp,
    markAllDirty,
    isReachable,
    ensureClean,
    updateSubtreeUnlock,
    explainPath,
  } = createRedDotGraph(ctx);

  function emitNodeChange(node) {
    const state = node.state;
    const subs = pathListeners.get(node.path);
    if (subs && subs.size > 0) {
      for (const fn of [...subs]) {
        try { fn(state); } catch { /* Listener errors must not break red-dot updates. */ }
      }
    }
    if (anyListeners.size > 0) {
      for (const fn of [...anyListeners]) {
        try { fn(state); } catch { /* Listener errors must not break red-dot updates. */ }
      }
    }
  }

  function flush() {
    if (disposed || batchDepth > 0 || flushing) return false;
    flushing = true;
    try {
      let emittedAny = false;
      let passes = 0;
      while (ctx.dirtySet.size > 0 && passes < 16) {
        passes++;
        const changedNodes = [];
        for (const node of [...ctx.dirtySet]) ensureClean(node, changedNodes);
        if (ctx.persistDirty) {
          writePersistedData(storage, storageKey, exportRedDotState(ctx));
          ctx.persistDirty = false;
        }
        for (const node of changedNodes) {
          emittedAny = true;
          emitNodeChange(node);
        }
      }
      if (ctx.persistDirty) {
        writePersistedData(storage, storageKey, exportRedDotState(ctx));
        ctx.persistDirty = false;
      }
      return emittedAny;
    } finally {
      flushing = false;
    }
  }

  function batch(fn) {
    if (typeof fn !== 'function') throw new TypeError('batch requires a function');
    if (disposed) return undefined;
    batchDepth++;
    try {
      return fn(api);
    } finally {
      batchDepth--;
      if (batchDepth === 0) flush();
    }
  }

  const exportState = () => exportRedDotState(ctx);
  const importState = (data) => importRedDotState(ctx, data, { batch, ensureNode, markDirtyUp });
  const syncTime = (markAffected = true) => syncRedDotTime(ctx, markAffected, markDirtyUp);

  function ensureFreshRead() {
    if (batchDepth === 0 && !flushing && (syncTime(true) || ctx.dirtySet.size > 0)) {
      flush();
    }
  }

  function link(parentPath, childPath) {
    const parent = ensureNode(parentPath);
    const child = ensureNode(childPath);
    if (parent === child) throw new Error(`RedDot cycle detected: cannot link "${parent.path}" to itself`);
    if (child.treeParent === parent || parent.dagChildren.has(child)) return false;
    if (isReachable(child, parent)) {
      throw new Error(`RedDot cycle detected: "${child.path}" already reaches "${parent.path}"`);
    }
    const wasTreeOnly = ctx.dagLinkCount === 0;
    parent.dagChildren.add(child);
    child.dagParents.add(parent);
    ctx.dagLinkCount++;
    if (wasTreeOnly) markAllDirty();
    else markDirtyUp(parent);
    flush();
    return true;
  }

  function unlink(parentPath, childPath) {
    const parent = ctx.nodes.get(normalizeRedDotPath(parentPath));
    const child = ctx.nodes.get(normalizeRedDotPath(childPath));
    if (!parent || !child || !parent.dagChildren.has(child)) return false;
    parent.dagChildren.delete(child);
    child.dagParents.delete(parent);
    ctx.dagLinkCount = Math.max(0, ctx.dagLinkCount - 1);
    if (ctx.dagLinkCount === 0) {
      for (const n of ctx.nodes.values()) n.contributors = null;
    }
    markDirtyUp(parent);
    flush();
    return true;
  }

  function setUnlocked(path, unlocked) {
    const node = ensureNode(path);
    const next = Boolean(unlocked);
    if (node.unlocked === next) return node.effectiveUnlocked;
    batch(() => {
      node.unlocked = next;
      updateSubtreeUnlock(node);
    });
    return node.effectiveUnlocked;
  }

  function isUnlocked(path) {
    const normalized = normalizeRedDotPath(path);
    const existing = ctx.nodes.get(normalized);
    if (existing) return existing.effectiveUnlocked;
    const ancestors = splitRedDotAncestors(normalized);
    for (let i = 0; i < ancestors.length - 1; i++) {
      const n = ctx.nodes.get(ancestors[i]);
      if (n && !n.effectiveUnlocked) return false;
    }
    return true;
  }

  function setMuted(path, muted) {
    const node = ensureNode(path);
    const next = Boolean(muted);
    if (node.muted === next) return next;
    node.muted = next;
    if (next) ctx.mutedNodes.add(node);
    else ctx.mutedNodes.delete(node);
    ctx.persistDirty = true;
    markDirtyUp(node);
    flush();
    return next;
  }

  function isMuted(path) {
    const existing = ctx.nodes.get(normalizeRedDotPath(path));
    return existing ? existing.muted : false;
  }

  function configure(path, config = {}) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new TypeError('configure options must be an object');
    }
    const node = ensureNode(path);
    batch(() => {
      if (config.displayMode !== undefined) {
        assertValidStyle(config.displayMode, VALID_DISPLAY_MODES, 'displayMode');
        if (node.displayMode !== config.displayMode) {
          node.displayMode = config.displayMode;
          markDirtyUp(node);
        }
      }
      if (config.maxCount !== undefined) {
        if (config.maxCount !== null && (!Number.isInteger(config.maxCount) || config.maxCount < 1)) {
          throw new RangeError('maxCount must be a positive integer or null');
        }
        node.maxCount = config.maxCount;
        markDirtyUp(node);
      }
      if (config.newLabel !== undefined) {
        node.newLabel = config.newLabel === null ? null : String(config.newLabel);
        markDirtyUp(node);
      }
      if (config.unlocked !== undefined) setUnlocked(node.path, config.unlocked);
      if (config.muted !== undefined) setMuted(node.path, config.muted);
    });
    return node.path;
  }

  function setValue(path, count, { style = 'number' } = {}) {
    assertValidStyle(style, VALID_LEAF_STYLES);
    const node = ensureNode(path);
    const normalizedCount = Number.isFinite(Number(count)) ? Math.max(0, Math.floor(Number(count))) : 0;
    const prev = node.valueSource;
    if (normalizedCount <= 0) {
      if (!prev) return 0;
      node.valueSource = null;
    } else {
      if (prev && prev.count === normalizedCount && prev.style === style) return normalizedCount;
      node.valueSource = { count: normalizedCount, style };
    }
    markDirtyUp(node);
    flush();
    return normalizedCount;
  }

  function setFlag(path, active, { style = 'dot' } = {}) {
    assertValidStyle(style, VALID_LEAF_STYLES);
    setValue(path, active ? 1 : 0, { style });
    return Boolean(active);
  }

  function applyRuleNode(node, context) {
    if (!node.ruleSource) return false;
    const parsed = parseRuleResult(node.ruleSource.evaluator(context), node.ruleSource.style);
    if (node.ruleSource.count === parsed.count && node.ruleSource.activeStyle === parsed.style) return false;
    node.ruleSource.count = parsed.count;
    node.ruleSource.activeStyle = parsed.style;
    markDirtyUp(node);
    return true;
  }

  function registerRule(path, evaluator, { style } = {}) {
    if (typeof evaluator !== 'function') throw new TypeError('registerRule requires an evaluator function');
    if (style !== undefined) assertValidStyle(style, VALID_LEAF_STYLES);
    const node = ensureNode(path);
    const entry = { evaluator, style: style ?? null, count: 0, activeStyle: 'none' };
    node.ruleSource = entry;
    ctx.ruleNodes.add(node);
    applyRuleNode(node, ctx.lastContext);
    flush();
    return () => {
      if (disposed || node.ruleSource !== entry) return;
      node.ruleSource = null;
      ctx.ruleNodes.delete(node);
      markDirtyUp(node);
      flush();
    };
  }

  function evaluate(prefixOrPaths, context) {
    let prefixes = null;
    let evalCtx = context;
    if (typeof prefixOrPaths === 'string') prefixes = [normalizeRedDotPath(prefixOrPaths)];
    else if (Array.isArray(prefixOrPaths)) prefixes = prefixOrPaths.map(normalizeRedDotPath);
    else if (prefixOrPaths !== undefined) evalCtx = prefixOrPaths;
    if (evalCtx !== undefined) ctx.lastContext = evalCtx;

    batch(() => {
      syncTime(true);
      const matchesPrefix = (nodePath) => !prefixes || prefixes.some(p => nodePath === p || nodePath.startsWith(`${p}/`));
      for (const node of ctx.ruleNodes) if (matchesPrefix(node.path)) applyRuleNode(node, ctx.lastContext);
      for (const node of ctx.dailyNodes) if (node.dailySource?.condition && matchesPrefix(node.path)) markDirtyUp(node);
    });
  }

  function markUnread(path, { style = 'new' } = {}) {
    assertValidStyle(style, VALID_LEAF_STYLES);
    const node = ensureNode(path);
    if (node.unreadStyle === style) return;
    node.unreadStyle = style;
    ctx.unreadNodes.add(node);
    ctx.persistDirty = true;
    markDirtyUp(node);
    flush();
  }

  function markUnreadBatch(parentPath, itemIds, { style = 'new' } = {}) {
    assertValidStyle(style, VALID_LEAF_STYLES);
    const base = normalizeRedDotPath(parentPath);
    ensureNode(base);
    if (!itemIds || typeof itemIds[Symbol.iterator] !== 'function') throw new TypeError('itemIds must be iterable');
    batch(() => {
      for (const id of itemIds) {
        const node = ensureNode(`${base}/${normalizeRedDotPath(String(id))}`);
        if (node.unreadStyle !== style) {
          node.unreadStyle = style;
          ctx.unreadNodes.add(node);
          ctx.persistDirty = true;
          markDirtyUp(node);
        }
      }
    });
  }

  function clearUnread(path) {
    const node = ctx.nodes.get(normalizeRedDotPath(path));
    if (!node || node.unreadStyle === null) return false;
    node.unreadStyle = null;
    ctx.unreadNodes.delete(node);
    ctx.persistDirty = true;
    markDirtyUp(node);
    flush();
    return true;
  }

  function isUnread(path) {
    const node = ctx.nodes.get(normalizeRedDotPath(path));
    return Boolean(node && node.unreadStyle !== null);
  }

  function syncUnreadScope(parentPath, validItemIds) {
    const prefix = normalizeRedDotPath(parentPath);
    if (!validItemIds || typeof validItemIds[Symbol.iterator] !== 'function') {
      throw new TypeError('validItemIds must be iterable');
    }
    const validSet = new Set();
    for (const id of validItemIds) validSet.add(normalizeRedDotPath(String(id)));
    let removed = 0;
    const scopePrefix = `${prefix}/`;
    batch(() => {
      for (const node of [...ctx.unreadNodes]) {
        if (!node.path.startsWith(scopePrefix)) continue;
        const rel = node.path.slice(scopePrefix.length);
        if (!validSet.has(rel) && !validSet.has(node.path)) {
          node.unreadStyle = null;
          ctx.unreadNodes.delete(node);
          ctx.persistDirty = true;
          markDirtyUp(node);
          removed++;
        }
      }
    });
    return removed;
  }

  function registerDaily(path, { style = 'dot', enabled = true, condition = null } = {}) {
    assertValidStyle(style, VALID_LEAF_STYLES);
    if (condition !== null && typeof condition !== 'function') {
      throw new TypeError('daily condition must be a function or null');
    }
    syncTime(false);
    const node = ensureNode(path);
    const entry = { style, enabled: Boolean(enabled), condition };
    node.dailySource = entry;
    ctx.dailyNodes.add(node);
    markDirtyUp(node);
    flush();
    return () => {
      if (disposed || node.dailySource !== entry) return;
      node.dailySource = null;
      ctx.dailyNodes.delete(node);
      markDirtyUp(node);
      flush();
    };
  }

  function acknowledgeDaily(path) {
    syncTime(false);
    const normalized = normalizeRedDotPath(path);
    if (ctx.dailyAckMap.get(normalized) === ctx.cachedDayKey) return false;
    ctx.dailyAckMap.set(normalized, ctx.cachedDayKey);
    ctx.persistDirty = true;
    const node = ctx.nodes.get(normalized);
    if (node) markDirtyUp(node);
    flush();
    return true;
  }

  function isDailyAcknowledged(path) {
    syncTime(false);
    return ctx.dailyAckMap.get(normalizeRedDotPath(path)) === ctx.cachedDayKey;
  }

  function setReadyAt(path, readyAtMs, { style = 'dot' } = {}) {
    assertValidStyle(style, VALID_LEAF_STYLES);
    syncTime(false);
    const node = ensureNode(path);
    if (readyAtMs === null || readyAtMs === undefined) return clearReadyAt(node.path);
    if (typeof readyAtMs !== 'number' || !Number.isFinite(readyAtMs)) {
      throw new RangeError('readyAtMs must be a finite timestamp or null');
    }
    node.readySource = { readyAtMs, style };
    ctx.readyNodes.add(node);
    markDirtyUp(node);
    flush();
    return ctx.cachedClockMs >= readyAtMs;
  }

  function clearReadyAt(path) {
    const node = ctx.nodes.get(normalizeRedDotPath(path));
    if (!node || !node.readySource) return false;
    node.readySource = null;
    ctx.readyNodes.delete(node);
    markDirtyUp(node);
    flush();
    return true;
  }

  function acknowledge(path, { recursive = false } = {}) {
    syncTime(true);
    const node = ctx.nodes.get(normalizeRedDotPath(path));
    if (!node) return 0;
    let count = 0;
    batch(() => {
      if (!recursive) {
        if (ackSingleRedDotNode(ctx, node, markDirtyUp)) count = 1;
        return;
      }
      const visited = new Set([node]);
      const stack = [node];
      while (stack.length > 0) {
        const curr = stack.pop();
        if (ackSingleRedDotNode(ctx, curr, markDirtyUp)) count++;
        for (const child of curr.treeChildren.values()) {
          if (!visited.has(child)) { visited.add(child); stack.push(child); }
        }
        for (const child of curr.dagChildren) {
          if (!visited.has(child)) { visited.add(child); stack.push(child); }
        }
      }
    });
    return count;
  }

  function refreshTime(context) {
    if (context !== undefined) ctx.lastContext = context;
    batch(() => {
      syncTime(true);
      if (context !== undefined) {
        for (const node of ctx.dailyNodes) if (node.dailySource?.condition) markDirtyUp(node);
      }
    });
  }

  function getState(path) {
    const normalized = normalizeRedDotPath(path);
    ensureFreshRead();
    const node = ctx.nodes.get(normalized);
    return node ? node.state : buildEmptyState(normalized, isUnlocked(normalized), false);
  }

  function explain(path) {
    const normalized = normalizeRedDotPath(path);
    ensureFreshRead();
    return explainPath(normalized);
  }

  function subscribe(path, listener, { immediate = true } = {}) {
    if (typeof listener !== 'function') throw new TypeError('subscribe listener must be a function');
    const node = ensureNode(path);
    ensureFreshRead();
    let listeners = pathListeners.get(node.path);
    if (!listeners) {
      listeners = new Set();
      pathListeners.set(node.path, listeners);
    }
    listeners.add(listener);
    if (immediate && !disposed) {
      node.lastEmittedState = node.state;
      listener(node.state);
    }
    return () => {
      const currentSet = pathListeners.get(node.path);
      if (!currentSet) return;
      currentSet.delete(listener);
      if (currentSet.size === 0) pathListeners.delete(node.path);
    };
  }

  function subscribeAny(listener) {
    if (typeof listener !== 'function') throw new TypeError('subscribeAny listener must be a function');
    anyListeners.add(listener);
    return () => { anyListeners.delete(listener); };
  }

  function reset({ clearPersistence = false } = {}) {
    batch(() => {
      for (const node of ctx.nodes.values()) {
        node.unlocked = true;
        node.effectiveUnlocked = true;
        node.muted = false;
        node.displayMode = 'auto';
        node.maxCount = null;
        node.newLabel = null;
        node.valueSource = null;
        node.ruleSource = null;
        node.unreadStyle = null;
        node.dailySource = null;
        node.readySource = null;
        node.ownCount = 0;
        node.ownNumberCount = 0;
        node.ownStyle = 'none';
        node.contributors = null;
        markDirtyUp(node);
      }
      ctx.ruleNodes.clear();
      ctx.unreadNodes.clear();
      ctx.dailyNodes.clear();
      ctx.readyNodes.clear();
      ctx.mutedNodes.clear();
      ctx.dailyAckMap.clear();
      ctx.persistDirty = clearPersistence;
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (ctx.persistDirty) {
      writePersistedData(storage, storageKey, exportState());
      ctx.persistDirty = false;
    }
    pathListeners.clear();
    anyListeners.clear();
    ctx.dirtySet.clear();
    ctx.ruleNodes.clear();
    ctx.unreadNodes.clear();
    ctx.dailyNodes.clear();
    ctx.readyNodes.clear();
    ctx.mutedNodes.clear();
    ctx.dailyAckMap.clear();
    ctx.nodes.clear();
  }

  /** @type {RedDotSystem} */
  const api = Object.freeze({
    get dayKey() {
      syncTime(false);
      return ctx.cachedDayKey;
    },
    configure, link, unlink, setUnlocked, isUnlocked, setMuted, isMuted,
    setValue, setFlag, registerRule, evaluate,
    markUnread, markUnreadBatch, clearUnread, isUnread, syncUnreadScope,
    registerDaily, acknowledgeDaily, isDailyAcknowledged,
    setReadyAt, clearReadyAt, acknowledge, refreshTime,
    batch, flush, getState,
    isActive: (path) => getState(path).active,
    getCount: (path) => getState(path).count,
    explain, subscribe, subscribeAny, exportState, importState, reset, dispose,
  });

  const saved = readPersistedData(storage, storageKey);
  if (saved) importState(saved);
  return api;
}
