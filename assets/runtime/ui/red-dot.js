export const RED_DOT_STYLES = Object.freeze({
  NONE: 'none',
  QUIET: 'quiet',
  DOT: 'dot',
  NEW: 'new',
  NUMBER: 'number',
});

const STYLE_PRIORITY = Object.freeze({
  none: 0,
  quiet: 1,
  dot: 2,
  new: 3,
  number: 4,
});

const VALID_LEAF_STYLES = new Set(['quiet', 'dot', 'new', 'number']);
const VALID_DISPLAY_MODES = new Set(['auto', 'none', 'quiet', 'dot', 'new', 'number']);
const EMPTY_SET = new Set();

function assertValidStyle(style, allowed, label = 'style') {
  if (!allowed.has(style)) {
    throw new RangeError(`Invalid RedDot ${label}: "${style}"`);
  }
  return style;
}

/**
 * Validates and normalizes a red-dot path (accepting `/` or `.` separators)
 * into a canonical `/`-delimited string (e.g. `"Main.Bag.Equip"` -> `"Main/Bag/Equip"`).
 *
 * @param {string} path
 * @returns {string}
 */
export function normalizeRedDotPath(path) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new TypeError('RedDot path must be a non-empty string');
  }
  if (/[\s\0]/.test(path)) {
    throw new RangeError(`RedDot path cannot contain whitespace or null characters: "${path}"`);
  }
  const first = path[0];
  const last = path[path.length - 1];
  if (first === '/' || first === '.' || last === '/' || last === '.') {
    throw new RangeError(`RedDot path cannot start or end with a separator: "${path}"`);
  }
  if (/[/.]{2}/.test(path)) {
    throw new RangeError(`RedDot path cannot contain consecutive separators: "${path}"`);
  }
  return path.split(/[/.]/).join('/');
}

/**
 * Expands a red-dot path into ordered root-to-leaf ancestor paths.
 *
 * @param {string} path
 * @returns {string[]}
 */
export function splitRedDotAncestors(path) {
  const normalized = normalizeRedDotPath(path);
  const parts = normalized.split('/');
  const ancestors = new Array(parts.length);
  let prefix = '';
  for (let i = 0; i < parts.length; i++) {
    prefix = i === 0 ? parts[0] : `${prefix}/${parts[i]}`;
    ancestors[i] = prefix;
  }
  return ancestors;
}

/**
 * Computes the commercial day key (`YYYY-MM-DD`) supporting daily reset hours
 * (e.g. `resetHour: 5` for 05:00 AM reset) and deterministic timezone offsets
 * (e.g. `tzOffsetMinutes: 480` for UTC+8).
 *
 * @param {number} [timestampMs]
 * @param {{ resetHour?: number, tzOffsetMinutes?: number }} [options]
 * @returns {string}
 */
export function computeCommercialDayKey(
  timestampMs = Date.now(),
  { resetHour = 0, tzOffsetMinutes } = {},
) {
  if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs)) {
    throw new RangeError('timestampMs must be a finite number');
  }
  if (!Number.isInteger(resetHour) || resetHour < 0 || resetHour > 23) {
    throw new RangeError('resetHour must be an integer between 0 and 23');
  }
  const shifted = timestampMs - resetHour * 3_600_000;
  if (tzOffsetMinutes !== undefined) {
    if (typeof tzOffsetMinutes !== 'number' || !Number.isFinite(tzOffsetMinutes)) {
      throw new RangeError('tzOffsetMinutes must be a finite number');
    }
    const d = new Date(shifted + tzOffsetMinutes * 60_000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const d = new Date(shifted);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Formats a red-dot count and style into a display badge string (`"99+"`, `"NEW"`, or `""`).
 *
 * @param {number} count
 * @param {{ style?: string, maxCount?: number, newLabel?: string }} [options]
 * @returns {string}
 */
export function formatRedDotBadge(count, { style = 'number', maxCount = 99, newLabel = 'NEW' } = {}) {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0 || style === 'none') {
    return '';
  }
  if (style === 'number') {
    const cappedMax = Number.isInteger(maxCount) && maxCount > 0 ? maxCount : 99;
    const n = Math.floor(count);
    if (n <= 0) return '';
    return n > cappedMax ? `${cappedMax}+` : String(n);
  }
  if (style === 'new') {
    return String(newLabel);
  }
  return '';
}

function readPersistedData(storage, storageKey) {
  if (!storage) return null;
  try {
    if (typeof storage.get === 'function') {
      return storage.get(storageKey, null);
    }
    if (typeof storage.getItem === 'function') {
      const raw = storage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    }
  } catch {
    return null;
  }
  return null;
}

function writePersistedData(storage, storageKey, payload) {
  if (!storage) return;
  try {
    if (typeof storage.set === 'function') {
      storage.set(storageKey, payload);
      return;
    }
    if (typeof storage.setItem === 'function') {
      storage.setItem(storageKey, JSON.stringify(payload));
    }
  } catch {
    // Storage quota or private-mode failures should not crash gameplay.
  }
}

function parseRuleResult(raw, explicitStyle) {
  if (typeof raw === 'boolean') {
    return {
      count: raw ? 1 : 0,
      style: explicitStyle ?? 'dot',
    };
  }
  if (typeof raw === 'number') {
    const count = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
    return {
      count,
      style: explicitStyle ?? 'number',
    };
  }
  if (raw && typeof raw === 'object') {
    const count = typeof raw.count === 'boolean'
      ? (raw.count ? 1 : 0)
      : (typeof raw.count === 'number' && Number.isFinite(raw.count)
          ? Math.max(0, Math.floor(raw.count))
          : 0);
    const candidateStyle = raw.style ?? explicitStyle ?? (typeof raw.count === 'boolean' ? 'dot' : 'number');
    const style = VALID_LEAF_STYLES.has(candidateStyle) ? candidateStyle : 'dot';
    return { count, style };
  }
  return { count: 0, style: 'none' };
}

function statesEqual(a, b) {
  if (!a || !b) return false;
  return (
    a.active === b.active &&
    a.count === b.count &&
    a.numberCount === b.numberCount &&
    a.style === b.style &&
    a.text === b.text &&
    a.unlocked === b.unlocked &&
    a.muted === b.muted
  );
}

/**
 * Creates a hierarchical Trie + DAG Red Dot System with dirty batching,
 * 4 commercial leaf trigger modes, diamond deduplication, unlock gating,
 * anti-harassment muting, and optional persistence.
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

  const nodes = new Map();
  const dirtySet = new Set();
  const ruleNodes = new Set();
  const unreadNodes = new Set();
  const dailyNodes = new Set();
  const readyNodes = new Set();
  const mutedNodes = new Set();
  const dailyAckMap = new Map();

  const pathListeners = new Map();
  const anyListeners = new Set();

  let dagLinkCount = 0;
  let batchDepth = 0;
  let flushing = false;
  let disposed = false;
  let persistDirty = false;
  let lastContext = undefined;
  let cachedClockMs = clock();
  let cachedDayKey = computeCommercialDayKey(cachedClockMs, { resetHour, tzOffsetMinutes });

  function buildEmptyState(path, unlocked = true, muted = false) {
    return Object.freeze({
      path,
      active: false,
      count: 0,
      numberCount: 0,
      style: 'none',
      text: '',
      unlocked,
      muted,
    });
  }

  function createNode(path, segment, depth, treeParent) {
    const effectiveUnlocked = treeParent ? treeParent.effectiveUnlocked : true;
    const initialState = buildEmptyState(path, effectiveUnlocked, false);
    const node = {
      path,
      segment,
      depth,
      treeParent,
      treeChildren: new Map(),
      dagParents: new Set(),
      dagChildren: new Set(),
      unlocked: true,
      effectiveUnlocked,
      muted: false,
      displayMode: 'auto',
      maxCount: null,
      newLabel: null,
      valueSource: null,
      ruleSource: null,
      unreadStyle: null,
      dailySource: null,
      readySource: null,
      ownCount: 0,
      ownNumberCount: 0,
      ownStyle: 'none',
      contributors: null,
      state: initialState,
      lastEmittedState: initialState,
      dirty: false,
    };
    nodes.set(path, node);
    return node;
  }

  function ensureNode(rawPath) {
    const normalized = normalizeRedDotPath(rawPath);
    const existing = nodes.get(normalized);
    if (existing) return existing;

    const segments = normalized.split('/');
    let parent = null;
    let prefix = '';
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      prefix = i === 0 ? seg : `${prefix}/${seg}`;
      let node = nodes.get(prefix);
      if (!node) {
        node = createNode(prefix, seg, i, parent);
        if (parent) {
          parent.treeChildren.set(seg, node);
        }
      }
      parent = node;
    }
    return parent;
  }

  function markDirtyUp(startNode) {
    if (!startNode || startNode.dirty) return;
    const stack = [startNode];
    while (stack.length > 0) {
      const curr = stack.pop();
      if (!curr || curr.dirty) continue;
      curr.dirty = true;
      dirtySet.add(curr);
      if (curr.treeParent && !curr.treeParent.dirty) {
        stack.push(curr.treeParent);
      }
      for (const dp of curr.dagParents) {
        if (!dp.dirty) stack.push(dp);
      }
    }
  }

  function markAllDirty() {
    for (const node of nodes.values()) {
      node.dirty = true;
      dirtySet.add(node);
    }
  }

  function isReachable(fromNode, targetNode) {
    if (fromNode === targetNode) return true;
    const visited = new Set([fromNode]);
    const stack = [fromNode];
    while (stack.length > 0) {
      const curr = stack.pop();
      for (const child of curr.treeChildren.values()) {
        if (child === targetNode) return true;
        if (!visited.has(child)) {
          visited.add(child);
          stack.push(child);
        }
      }
      for (const child of curr.dagChildren) {
        if (child === targetNode) return true;
        if (!visited.has(child)) {
          visited.add(child);
          stack.push(child);
        }
      }
    }
    return false;
  }

  function computeOwnContribution(node) {
    let count = 0;
    let numberCount = 0;
    let bestStyle = 'none';
    let bestPriority = 0;

    const addSource = (srcCount, srcStyle) => {
      if (srcCount <= 0) return;
      count += srcCount;
      if (srcStyle === 'number') numberCount += srcCount;
      const p = STYLE_PRIORITY[srcStyle] ?? 0;
      if (p > bestPriority) {
        bestPriority = p;
        bestStyle = srcStyle;
      }
    };

    if (node.valueSource && node.valueSource.count > 0) {
      addSource(node.valueSource.count, node.valueSource.style);
    }
    if (node.ruleSource && node.ruleSource.count > 0) {
      addSource(node.ruleSource.count, node.ruleSource.activeStyle);
    }
    if (node.unreadStyle) {
      addSource(1, node.unreadStyle);
    }
    if (
      node.dailySource &&
      node.dailySource.enabled &&
      (!node.dailySource.condition || Boolean(node.dailySource.condition(lastContext))) &&
      dailyAckMap.get(node.path) !== cachedDayKey
    ) {
      addSource(1, node.dailySource.style);
    }
    if (
      node.readySource &&
      node.readySource.readyAtMs !== null &&
      cachedClockMs >= node.readySource.readyAtMs
    ) {
      addSource(1, node.readySource.style);
    }

    node.ownCount = count;
    node.ownNumberCount = numberCount;
    node.ownStyle = bestStyle;
  }

  function recomputeNode(node, changedNodes) {
    computeOwnContribution(node);

    if (!node.effectiveUnlocked || node.muted) {
      node.contributors = null;
      const next = buildEmptyState(node.path, node.effectiveUnlocked, node.muted);
      node.state = next;
      if (!statesEqual(next, node.lastEmittedState)) {
        node.lastEmittedState = next;
        changedNodes.push(node);
      }
      return;
    }

    let count = 0;
    let numberCount = 0;
    let resolvedBestStyle = node.ownStyle;
    let resolvedBestPriority = STYLE_PRIORITY[resolvedBestStyle] ?? 0;

    const considerChildStyle = (childStyle) => {
      const p = STYLE_PRIORITY[childStyle] ?? 0;
      if (p > resolvedBestPriority) {
        resolvedBestPriority = p;
        resolvedBestStyle = childStyle;
      }
    };

    if (dagLinkCount === 0) {
      node.contributors = null;
      count = node.ownCount;
      numberCount = node.ownNumberCount;
      for (const child of node.treeChildren.values()) {
        if (!child.state.active) continue;
        count += child.state.count;
        numberCount += child.state.numberCount;
        considerChildStyle(child.state.style);
      }
    } else {
      const contrib = new Set();
      if (node.ownCount > 0) {
        contrib.add(node);
      }
      for (const child of node.treeChildren.values()) {
        if (!child.effectiveUnlocked || child.muted) continue;
        if (child.contributors) {
          for (const leaf of child.contributors) contrib.add(leaf);
        }
        if (child.state.active) {
          considerChildStyle(child.state.style);
        }
      }
      for (const child of node.dagChildren) {
        if (!child.effectiveUnlocked || child.muted) continue;
        if (child.contributors) {
          for (const leaf of child.contributors) contrib.add(leaf);
        }
        if (child.state.active) {
          considerChildStyle(child.state.style);
        }
      }
      node.contributors = contrib.size > 0 ? contrib : null;
      for (const leaf of contrib) {
        count += leaf.ownCount;
        numberCount += leaf.ownNumberCount;
      }
    }

    const active = count > 0;
    let finalStyle = 'none';
    if (active) {
      finalStyle = node.displayMode === 'auto' ? resolvedBestStyle : node.displayMode;
    }

    let text = '';
    if (active && finalStyle !== 'none') {
      let badgeValue = count;
      if (node.displayMode === 'auto' && finalStyle === 'number') {
        badgeValue = numberCount > 0 ? numberCount : count;
      }
      text = formatRedDotBadge(badgeValue, {
        style: finalStyle,
        maxCount: node.maxCount ?? maxCount,
        newLabel: node.newLabel ?? newLabel,
      });
    }

    const next = Object.freeze({
      path: node.path,
      active,
      count,
      numberCount,
      style: finalStyle,
      text,
      unlocked: node.effectiveUnlocked,
      muted: node.muted,
    });
    node.state = next;
    if (!statesEqual(next, node.lastEmittedState)) {
      node.lastEmittedState = next;
      changedNodes.push(node);
    }
  }

  function ensureClean(node, changedNodes, visiting = new Set()) {
    if (!node.dirty) return;
    if (visiting.has(node)) return;
    visiting.add(node);
    for (const child of node.treeChildren.values()) {
      if (child.dirty) ensureClean(child, changedNodes, visiting);
    }
    for (const child of node.dagChildren) {
      if (child.dirty) ensureClean(child, changedNodes, visiting);
    }
    visiting.delete(node);
    recomputeNode(node, changedNodes);
    node.dirty = false;
    dirtySet.delete(node);
  }

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

  function exportState() {
    const unread = Object.create(null);
    for (const node of unreadNodes) {
      if (node.unreadStyle) unread[node.path] = node.unreadStyle;
    }
    const dailyAck = Object.create(null);
    for (const [p, dayKey] of dailyAckMap) {
      dailyAck[p] = dayKey;
    }
    const muted = [];
    for (const node of mutedNodes) {
      if (node.muted) muted.push(node.path);
    }
    return { version: 1, unread, dailyAck, muted };
  }

  function syncTimeInternal(markAffected = true) {
    const nowMs = clock();
    const nextDayKey = computeCommercialDayKey(nowMs, { resetHour, tzOffsetMinutes });
    let changed = false;

    if (nextDayKey !== cachedDayKey) {
      cachedDayKey = nextDayKey;
      if (markAffected) {
        for (const node of dailyNodes) {
          markDirtyUp(node);
        }
        changed = dailyNodes.size > 0;
      }
    }

    const prevClockMs = cachedClockMs;
    cachedClockMs = nowMs;
    if (markAffected) {
      for (const node of readyNodes) {
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

  function flush() {
    if (disposed || batchDepth > 0 || flushing) return false;
    flushing = true;
    try {
      let emittedAny = false;
      let passes = 0;
      while (dirtySet.size > 0 && passes < 16) {
        passes++;
        const changedNodes = [];
        for (const node of [...dirtySet]) {
          ensureClean(node, changedNodes);
        }
        if (persistDirty) {
          writePersistedData(storage, storageKey, exportState());
          persistDirty = false;
        }
        for (const node of changedNodes) {
          emittedAny = true;
          emitNodeChange(node);
        }
      }
      if (persistDirty) {
        writePersistedData(storage, storageKey, exportState());
        persistDirty = false;
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
      if (batchDepth === 0) {
        flush();
      }
    }
  }

  function importState(data) {
    if (!data || typeof data !== 'object') return;
    batch(() => {
      for (const node of [...unreadNodes]) {
        node.unreadStyle = null;
        markDirtyUp(node);
      }
      unreadNodes.clear();

      for (const node of [...mutedNodes]) {
        node.muted = false;
        markDirtyUp(node);
      }
      mutedNodes.clear();

      dailyAckMap.clear();
      for (const node of dailyNodes) {
        markDirtyUp(node);
      }

      if (data.unread && typeof data.unread === 'object') {
        for (const [rawPath, style] of Object.entries(data.unread)) {
          if (typeof style !== 'string' || !VALID_LEAF_STYLES.has(style)) continue;
          const node = ensureNode(rawPath);
          node.unreadStyle = style;
          unreadNodes.add(node);
          markDirtyUp(node);
        }
      }

      if (data.dailyAck && typeof data.dailyAck === 'object') {
        for (const [rawPath, dayKey] of Object.entries(data.dailyAck)) {
          if (typeof dayKey !== 'string' || !dayKey) continue;
          const normalized = normalizeRedDotPath(rawPath);
          dailyAckMap.set(normalized, dayKey);
          const existing = nodes.get(normalized);
          if (existing) markDirtyUp(existing);
        }
      }

      if (Array.isArray(data.muted)) {
        for (const rawPath of data.muted) {
          if (typeof rawPath !== 'string') continue;
          const node = ensureNode(rawPath);
          node.muted = true;
          mutedNodes.add(node);
          markDirtyUp(node);
        }
      }

      persistDirty = false;
    });
  }

  function link(parentPath, childPath) {
    const parent = ensureNode(parentPath);
    const child = ensureNode(childPath);
    if (parent === child) {
      throw new Error(`RedDot cycle detected: cannot link "${parent.path}" to itself`);
    }
    if (child.treeParent === parent || parent.dagChildren.has(child)) {
      return false;
    }
    if (isReachable(child, parent)) {
      throw new Error(`RedDot cycle detected: "${child.path}" already reaches "${parent.path}"`);
    }
    const wasTreeOnly = dagLinkCount === 0;
    parent.dagChildren.add(child);
    child.dagParents.add(parent);
    dagLinkCount++;
    if (wasTreeOnly) {
      markAllDirty();
    } else {
      markDirtyUp(parent);
    }
    flush();
    return true;
  }

  function unlink(parentPath, childPath) {
    const parent = nodes.get(normalizeRedDotPath(parentPath));
    const child = nodes.get(normalizeRedDotPath(childPath));
    if (!parent || !child || !parent.dagChildren.has(child)) {
      return false;
    }
    parent.dagChildren.delete(child);
    child.dagParents.delete(parent);
    dagLinkCount = Math.max(0, dagLinkCount - 1);
    if (dagLinkCount === 0) {
      for (const n of nodes.values()) n.contributors = null;
    }
    markDirtyUp(parent);
    flush();
    return true;
  }

  function updateSubtreeUnlock(rootNode) {
    const stack = [rootNode];
    while (stack.length > 0) {
      const curr = stack.pop();
      curr.effectiveUnlocked = curr.unlocked && (curr.treeParent ? curr.treeParent.effectiveUnlocked : true);
      markDirtyUp(curr);
      for (const child of curr.treeChildren.values()) {
        stack.push(child);
      }
    }
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
    const existing = nodes.get(normalized);
    if (existing) return existing.effectiveUnlocked;
    const ancestors = splitRedDotAncestors(normalized);
    for (let i = 0; i < ancestors.length - 1; i++) {
      const n = nodes.get(ancestors[i]);
      if (n && !n.effectiveUnlocked) return false;
    }
    return true;
  }

  function setMuted(path, muted) {
    const node = ensureNode(path);
    const next = Boolean(muted);
    if (node.muted === next) return next;
    node.muted = next;
    if (next) mutedNodes.add(node);
    else mutedNodes.delete(node);
    persistDirty = true;
    markDirtyUp(node);
    flush();
    return next;
  }

  function isMuted(path) {
    const existing = nodes.get(normalizeRedDotPath(path));
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
      if (config.unlocked !== undefined) {
        setUnlocked(node.path, config.unlocked);
      }
      if (config.muted !== undefined) {
        setMuted(node.path, config.muted);
      }
    });
    return node.path;
  }

  function setValue(path, count, { style = 'number' } = {}) {
    assertValidStyle(style, VALID_LEAF_STYLES);
    const node = ensureNode(path);
    const normalizedCount = Number.isFinite(Number(count))
      ? Math.max(0, Math.floor(Number(count)))
      : 0;
    const prev = node.valueSource;
    if (normalizedCount <= 0) {
      if (!prev) return 0;
      node.valueSource = null;
    } else {
      if (prev && prev.count === normalizedCount && prev.style === style) {
        return normalizedCount;
      }
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
    const { evaluator, style } = node.ruleSource;
    const parsed = parseRuleResult(evaluator(context), style);
    if (node.ruleSource.count === parsed.count && node.ruleSource.activeStyle === parsed.style) {
      return false;
    }
    node.ruleSource.count = parsed.count;
    node.ruleSource.activeStyle = parsed.style;
    markDirtyUp(node);
    return true;
  }

  function registerRule(path, evaluator, { style } = {}) {
    if (typeof evaluator !== 'function') {
      throw new TypeError('registerRule requires an evaluator function');
    }
    if (style !== undefined) {
      assertValidStyle(style, VALID_LEAF_STYLES);
    }
    const node = ensureNode(path);
    const entry = {
      evaluator,
      style: style ?? null,
      count: 0,
      activeStyle: 'none',
    };
    node.ruleSource = entry;
    ruleNodes.add(node);
    applyRuleNode(node, lastContext);
    flush();

    return () => {
      if (disposed || node.ruleSource !== entry) return;
      node.ruleSource = null;
      ruleNodes.delete(node);
      markDirtyUp(node);
      flush();
    };
  }

  function evaluate(prefixOrPaths, context) {
    let prefixes = null;
    let ctx = context;
    if (typeof prefixOrPaths === 'string') {
      prefixes = [normalizeRedDotPath(prefixOrPaths)];
    } else if (Array.isArray(prefixOrPaths)) {
      prefixes = prefixOrPaths.map(normalizeRedDotPath);
    } else if (prefixOrPaths !== undefined) {
      ctx = prefixOrPaths;
    }
    if (ctx !== undefined) {
      lastContext = ctx;
    }

    batch(() => {
      syncTimeInternal(true);
      const matchesPrefix = (nodePath) => {
        if (!prefixes) return true;
        for (let i = 0; i < prefixes.length; i++) {
          const p = prefixes[i];
          if (nodePath === p || nodePath.startsWith(`${p}/`)) return true;
        }
        return false;
      };

      for (const node of ruleNodes) {
        if (matchesPrefix(node.path)) {
          applyRuleNode(node, lastContext);
        }
      }
      for (const node of dailyNodes) {
        if (node.dailySource?.condition && matchesPrefix(node.path)) {
          markDirtyUp(node);
        }
      }
    });
  }

  function markUnread(path, { style = 'new' } = {}) {
    assertValidStyle(style, VALID_LEAF_STYLES);
    const node = ensureNode(path);
    if (node.unreadStyle === style) return;
    node.unreadStyle = style;
    unreadNodes.add(node);
    persistDirty = true;
    markDirtyUp(node);
    flush();
  }

  function markUnreadBatch(parentPath, itemIds, { style = 'new' } = {}) {
    assertValidStyle(style, VALID_LEAF_STYLES);
    const base = normalizeRedDotPath(parentPath);
    ensureNode(base);
    if (!itemIds || typeof itemIds[Symbol.iterator] !== 'function') {
      throw new TypeError('itemIds must be iterable');
    }
    batch(() => {
      for (const id of itemIds) {
        const rel = normalizeRedDotPath(String(id));
        const node = ensureNode(`${base}/${rel}`);
        if (node.unreadStyle !== style) {
          node.unreadStyle = style;
          unreadNodes.add(node);
          persistDirty = true;
          markDirtyUp(node);
        }
      }
    });
  }

  function clearUnread(path) {
    const node = nodes.get(normalizeRedDotPath(path));
    if (!node || node.unreadStyle === null) return false;
    node.unreadStyle = null;
    unreadNodes.delete(node);
    persistDirty = true;
    markDirtyUp(node);
    flush();
    return true;
  }

  function isUnread(path) {
    const node = nodes.get(normalizeRedDotPath(path));
    return Boolean(node && node.unreadStyle !== null);
  }

  function syncUnreadScope(parentPath, validItemIds) {
    const prefix = normalizeRedDotPath(parentPath);
    if (!validItemIds || typeof validItemIds[Symbol.iterator] !== 'function') {
      throw new TypeError('validItemIds must be iterable');
    }
    const validSet = new Set();
    for (const id of validItemIds) {
      validSet.add(normalizeRedDotPath(String(id)));
    }
    let removed = 0;
    const scopePrefix = `${prefix}/`;
    batch(() => {
      for (const node of [...unreadNodes]) {
        if (!node.path.startsWith(scopePrefix)) continue;
        const rel = node.path.slice(scopePrefix.length);
        if (!validSet.has(rel) && !validSet.has(node.path)) {
          node.unreadStyle = null;
          unreadNodes.delete(node);
          persistDirty = true;
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
    syncTimeInternal(false);
    const node = ensureNode(path);
    const entry = {
      style,
      enabled: Boolean(enabled),
      condition,
    };
    node.dailySource = entry;
    dailyNodes.add(node);
    markDirtyUp(node);
    flush();

    return () => {
      if (disposed || node.dailySource !== entry) return;
      node.dailySource = null;
      dailyNodes.delete(node);
      markDirtyUp(node);
      flush();
    };
  }

  function acknowledgeDaily(path) {
    syncTimeInternal(false);
    const normalized = normalizeRedDotPath(path);
    if (dailyAckMap.get(normalized) === cachedDayKey) {
      return false;
    }
    dailyAckMap.set(normalized, cachedDayKey);
    persistDirty = true;
    const node = nodes.get(normalized);
    if (node) markDirtyUp(node);
    flush();
    return true;
  }

  function isDailyAcknowledged(path) {
    syncTimeInternal(false);
    return dailyAckMap.get(normalizeRedDotPath(path)) === cachedDayKey;
  }

  function setReadyAt(path, readyAtMs, { style = 'dot' } = {}) {
    assertValidStyle(style, VALID_LEAF_STYLES);
    syncTimeInternal(false);
    const node = ensureNode(path);
    if (readyAtMs === null || readyAtMs === undefined) {
      return clearReadyAt(node.path);
    }
    if (typeof readyAtMs !== 'number' || !Number.isFinite(readyAtMs)) {
      throw new RangeError('readyAtMs must be a finite timestamp or null');
    }
    node.readySource = { readyAtMs, style };
    readyNodes.add(node);
    markDirtyUp(node);
    flush();
    return cachedClockMs >= readyAtMs;
  }

  function clearReadyAt(path) {
    const node = nodes.get(normalizeRedDotPath(path));
    if (!node || !node.readySource) return false;
    node.readySource = null;
    readyNodes.delete(node);
    markDirtyUp(node);
    flush();
    return true;
  }

  function ackSingleNode(node) {
    let acked = false;
    if (node.unreadStyle !== null) {
      node.unreadStyle = null;
      unreadNodes.delete(node);
      acked = true;
    }
    if (
      node.dailySource &&
      node.dailySource.enabled &&
      (!node.dailySource.condition || Boolean(node.dailySource.condition(lastContext))) &&
      dailyAckMap.get(node.path) !== cachedDayKey
    ) {
      dailyAckMap.set(node.path, cachedDayKey);
      acked = true;
    }
    if (acked) {
      persistDirty = true;
      markDirtyUp(node);
    }
    return acked;
  }

  function acknowledge(path, { recursive = false } = {}) {
    syncTimeInternal(true);
    const node = nodes.get(normalizeRedDotPath(path));
    if (!node) return 0;

    let count = 0;
    batch(() => {
      if (!recursive) {
        if (ackSingleNode(node)) count = 1;
        return;
      }
      const visited = new Set([node]);
      const stack = [node];
      while (stack.length > 0) {
        const curr = stack.pop();
        if (ackSingleNode(curr)) count++;
        for (const child of curr.treeChildren.values()) {
          if (!visited.has(child)) {
            visited.add(child);
            stack.push(child);
          }
        }
        for (const child of curr.dagChildren) {
          if (!visited.has(child)) {
            visited.add(child);
            stack.push(child);
          }
        }
      }
    });
    return count;
  }

  function refreshTime(context) {
    if (context !== undefined) {
      lastContext = context;
    }
    batch(() => {
      syncTimeInternal(true);
      if (context !== undefined) {
        for (const node of dailyNodes) {
          if (node.dailySource?.condition) markDirtyUp(node);
        }
      }
    });
  }

  function ensureFreshRead() {
    if (batchDepth === 0 && !flushing) {
      if (syncTimeInternal(true) || dirtySet.size > 0) {
        flush();
      }
    }
  }

  function getState(path) {
    const normalized = normalizeRedDotPath(path);
    ensureFreshRead();
    const node = nodes.get(normalized);
    if (node) return node.state;
    const unlocked = isUnlocked(normalized);
    return buildEmptyState(normalized, unlocked, false);
  }

  function isActive(path) {
    return getState(path).active;
  }

  function getCount(path) {
    return getState(path).count;
  }

  function explain(path) {
    const normalized = normalizeRedDotPath(path);
    ensureFreshRead();
    const ancestors = splitRedDotAncestors(normalized);
    let blockedByUnlock = null;
    for (const anc of ancestors) {
      const ancNode = nodes.get(anc);
      if (ancNode && !ancNode.unlocked) {
        blockedByUnlock = anc;
        break;
      }
    }

    const node = nodes.get(normalized);
    const state = node ? node.state : buildEmptyState(normalized, blockedByUnlock === null, false);
    const activeSources = [];

    if (node && node.effectiveUnlocked && !node.muted) {
      const visited = new Set([node]);
      const stack = [node];
      while (stack.length > 0) {
        const curr = stack.pop();
        if (!curr.effectiveUnlocked || curr.muted) continue;
        if (curr.ownCount > 0) {
          const reasons = [];
          if (curr.valueSource && curr.valueSource.count > 0) reasons.push('value');
          if (curr.ruleSource && curr.ruleSource.count > 0) reasons.push('rule');
          if (curr.unreadStyle) reasons.push('unread');
          if (
            curr.dailySource &&
            curr.dailySource.enabled &&
            (!curr.dailySource.condition || Boolean(curr.dailySource.condition(lastContext))) &&
            dailyAckMap.get(curr.path) !== cachedDayKey
          ) {
            reasons.push('daily');
          }
          if (
            curr.readySource &&
            curr.readySource.readyAtMs !== null &&
            cachedClockMs >= curr.readySource.readyAtMs
          ) {
            reasons.push('ready');
          }
          activeSources.push({
            path: curr.path,
            count: curr.ownCount,
            style: curr.ownStyle,
            reasons,
          });
        }
        for (const child of curr.treeChildren.values()) {
          if (!visited.has(child)) {
            visited.add(child);
            stack.push(child);
          }
        }
        for (const child of curr.dagChildren) {
          if (!visited.has(child)) {
            visited.add(child);
            stack.push(child);
          }
        }
      }
      activeSources.sort((a, b) => a.path.localeCompare(b.path));
    }

    return {
      path: normalized,
      state,
      blockedByUnlock,
      muted: Boolean(node?.muted),
      activeSources,
    };
  }

  function subscribe(path, listener, { immediate = true } = {}) {
    if (typeof listener !== 'function') {
      throw new TypeError('subscribe listener must be a function');
    }
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
      if (currentSet.size === 0) {
        pathListeners.delete(node.path);
      }
    };
  }

  function subscribeAny(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('subscribeAny listener must be a function');
    }
    anyListeners.add(listener);
    return () => {
      anyListeners.delete(listener);
    };
  }

  function reset({ clearPersistence = false } = {}) {
    batch(() => {
      for (const node of nodes.values()) {
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
      ruleNodes.clear();
      unreadNodes.clear();
      dailyNodes.clear();
      readyNodes.clear();
      mutedNodes.clear();
      dailyAckMap.clear();
      persistDirty = clearPersistence;
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (persistDirty) {
      writePersistedData(storage, storageKey, exportState());
      persistDirty = false;
    }
    pathListeners.clear();
    anyListeners.clear();
    dirtySet.clear();
    ruleNodes.clear();
    unreadNodes.clear();
    dailyNodes.clear();
    readyNodes.clear();
    mutedNodes.clear();
    dailyAckMap.clear();
    nodes.clear();
  }

  const api = Object.freeze({
    get dayKey() {
      syncTimeInternal(false);
      return cachedDayKey;
    },
    configure,
    link,
    unlink,
    setUnlocked,
    isUnlocked,
    setMuted,
    isMuted,
    setValue,
    setFlag,
    registerRule,
    evaluate,
    markUnread,
    markUnreadBatch,
    clearUnread,
    isUnread,
    syncUnreadScope,
    registerDaily,
    acknowledgeDaily,
    isDailyAcknowledged,
    setReadyAt,
    clearReadyAt,
    acknowledge,
    refreshTime,
    batch,
    flush,
    getState,
    isActive,
    getCount,
    explain,
    subscribe,
    subscribeAny,
    exportState,
    importState,
    reset,
    dispose,
  });

  const saved = readPersistedData(storage, storageKey);
  if (saved) {
    importState(saved);
  }

  return api;
}
