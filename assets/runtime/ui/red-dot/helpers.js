/** Visual style of a badge: 'none' hides it, 'quiet' is a small amber dot, 'dot' a red dot, 'new' a label, 'number' a count. @typedef {'none' | 'quiet' | 'dot' | 'new' | 'number'} RedDotStyle */

/** Style a leaf source may produce (everything except 'none'). @typedef {Exclude<RedDotStyle, 'none'>} RedDotLeafStyle */

/** Per-node display override; 'auto' uses the highest-priority child style. @typedef {RedDotStyle | 'auto'} RedDotDisplayMode */

/**
 * Immutable snapshot of a node's resolved badge state.
 * @typedef {object} RedDotState
 * @property {string} path Normalized '/'-delimited node path.
 * @property {boolean} active True when the node shows a badge (count > 0, unlocked and not muted).
 * @property {number} count Aggregated count of active sources in the subtree (diamond-deduplicated).
 * @property {number} numberCount Portion of count produced by 'number'-style sources.
 * @property {RedDotStyle} style Resolved badge style ('none' when inactive).
 * @property {string} text Badge text: "" for dots, "NEW"-style label, or a capped count such as "99+".
 * @property {boolean} unlocked Effective unlock state (false if this node or an ancestor is locked).
 * @property {boolean} muted True when the node is muted (anti-harassment).
 */

/**
 * Persistence backend: either a HGame save store (get/set) or a Web Storage-like object (getItem/setItem).
 * @typedef {object} RedDotStorage
 * @property {(key: string, fallback: unknown) => unknown} [get] Read a JSON-compatible value.
 * @property {(key: string, value: unknown) => unknown} [set] Write a JSON-compatible value.
 * @property {(key: string) => string | null} [getItem] Read a raw JSON string.
 * @property {(key: string, value: string) => unknown} [setItem] Write a raw JSON string.
 */

/**
 * Serialized system state (version 1) produced by exportState and consumed by importState.
 * @typedef {object} RedDotPersistedData
 * @property {number} version Schema version (1).
 * @property {Record<string, RedDotLeafStyle>} unread Unread marks per node path.
 * @property {Record<string, string>} dailyAck Daily acknowledgement day keys (YYYY-MM-DD) per node path.
 * @property {string[]} muted Muted node paths.
 */

/**
 * Normalized result of a rule evaluator.
 * @typedef {object} RedDotRuleResult
 * @property {number} count Non-negative integer count.
 * @property {RedDotStyle} style Style used when count > 0.
 */

/** Styles enum (frozen). */
export const RED_DOT_STYLES = Object.freeze({
  NONE: 'none',
  QUIET: 'quiet',
  DOT: 'dot',
  NEW: 'new',
  NUMBER: 'number',
});

/** Display priority per style; higher wins when merging children. */
export const STYLE_PRIORITY = Object.freeze({
  none: 0,
  quiet: 1,
  dot: 2,
  new: 3,
  number: 4,
});

/** @type {Set<string>} */
export const VALID_LEAF_STYLES = new Set(['quiet', 'dot', 'new', 'number']);
/** @type {Set<string>} */
export const VALID_DISPLAY_MODES = new Set(['auto', 'none', 'quiet', 'dot', 'new', 'number']);
/** @type {Set<never>} */
export const EMPTY_SET = new Set();

/**
 * Throws RangeError unless style is in allowed.
 * @param {string} style
 * @param {Set<string>} allowed
 * @param {string} [label='style'] Name used in the error message.
 * @returns {string} The validated style.
 */
export function assertValidStyle(style, allowed, label = 'style') {
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
 * @typedef {object} RedDotDayKeyOptions
 * @property {number} [resetHour=0] Local hour (integer 0..23) at which the day rolls over.
 * @property {number} [tzOffsetMinutes] Fixed UTC offset in minutes (e.g. 480 for UTC+8); omitted = host local time.
 */

/**
 * Computes the commercial day key (`YYYY-MM-DD`) supporting daily reset hours
 * (e.g. `resetHour: 5` for 05:00 AM reset) and deterministic timezone offsets
 * (e.g. `tzOffsetMinutes: 480` for UTC+8).
 *
 * @param {number} [timestampMs]
 * @param {RedDotDayKeyOptions} [options]
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
 * @typedef {object} RedDotBadgeFormatOptions
 * @property {RedDotStyle} [style='number'] Badge style; 'none' and 'dot'/'quiet' yield "".
 * @property {number} [maxCount=99] Cap for number badges (positive integer); larger counts render as "<max>+".
 * @property {string} [newLabel='NEW'] Text used for 'new' badges.
 */

/**
 * Formats a red-dot count and style into a display badge string (`"99+"`, `"NEW"`, or `""`).
 *
 * @param {number} count
 * @param {RedDotBadgeFormatOptions} [options]
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

/**
 * Best-effort read of persisted data; returns null on any failure.
 * @param {RedDotStorage | null | undefined} storage
 * @param {string} storageKey
 * @returns {RedDotPersistedData | null}
 */
export function readPersistedData(storage, storageKey) {
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

/**
 * Best-effort write of persisted data; errors are swallowed.
 * @param {RedDotStorage | null | undefined} storage
 * @param {string} storageKey
 * @param {RedDotPersistedData} payload
 * @returns {void}
 */
export function writePersistedData(storage, storageKey, payload) {
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

/**
 * Normalizes a rule evaluator return value (boolean, number or { count, style }).
 * @param {unknown} raw
 * @param {RedDotLeafStyle | null | undefined} [explicitStyle] Style forced by registerRule.
 * @returns {RedDotRuleResult}
 */
export function parseRuleResult(raw, explicitStyle) {
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

/**
 * Field-wise equality of two states (ignores path).
 * @param {RedDotState | null | undefined} a
 * @param {RedDotState | null | undefined} b
 * @returns {boolean}
 */
export function statesEqual(a, b) {
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
