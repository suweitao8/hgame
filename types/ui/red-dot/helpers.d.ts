/**
 * Throws RangeError unless style is in allowed.
 * @param {string} style
 * @param {Set<string>} allowed
 * @param {string} [label='style'] Name used in the error message.
 * @returns {string} The validated style.
 */
export function assertValidStyle(style: string, allowed: Set<string>, label?: string): string;
/**
 * Validates and normalizes a red-dot path (accepting `/` or `.` separators)
 * into a canonical `/`-delimited string (e.g. `"Main.Bag.Equip"` -> `"Main/Bag/Equip"`).
 *
 * @param {string} path
 * @returns {string}
 */
export function normalizeRedDotPath(path: string): string;
/**
 * Expands a red-dot path into ordered root-to-leaf ancestor paths.
 *
 * @param {string} path
 * @returns {string[]}
 */
export function splitRedDotAncestors(path: string): string[];
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
export function computeCommercialDayKey(timestampMs?: number, { resetHour, tzOffsetMinutes }?: RedDotDayKeyOptions): string;
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
export function formatRedDotBadge(count: number, { style, maxCount, newLabel }?: RedDotBadgeFormatOptions): string;
/**
 * Best-effort read of persisted data; returns null on any failure.
 * @param {RedDotStorage | null | undefined} storage
 * @param {string} storageKey
 * @returns {RedDotPersistedData | null}
 */
export function readPersistedData(storage: RedDotStorage | null | undefined, storageKey: string): RedDotPersistedData | null;
/**
 * Best-effort write of persisted data; errors are swallowed.
 * @param {RedDotStorage | null | undefined} storage
 * @param {string} storageKey
 * @param {RedDotPersistedData} payload
 * @returns {void}
 */
export function writePersistedData(storage: RedDotStorage | null | undefined, storageKey: string, payload: RedDotPersistedData): void;
/**
 * Normalizes a rule evaluator return value (boolean, number or { count, style }).
 * @param {unknown} raw
 * @param {RedDotLeafStyle | null | undefined} [explicitStyle] Style forced by registerRule.
 * @returns {RedDotRuleResult}
 */
export function parseRuleResult(raw: unknown, explicitStyle?: RedDotLeafStyle | null | undefined): RedDotRuleResult;
/**
 * Field-wise equality of two states (ignores path).
 * @param {RedDotState | null | undefined} a
 * @param {RedDotState | null | undefined} b
 * @returns {boolean}
 */
export function statesEqual(a: RedDotState | null | undefined, b: RedDotState | null | undefined): boolean;
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
export const RED_DOT_STYLES: Readonly<{
    NONE: "none";
    QUIET: "quiet";
    DOT: "dot";
    NEW: "new";
    NUMBER: "number";
}>;
/** Display priority per style; higher wins when merging children. */
export const STYLE_PRIORITY: Readonly<{
    none: 0;
    quiet: 1;
    dot: 2;
    new: 3;
    number: 4;
}>;
/** @type {Set<string>} */
export const VALID_LEAF_STYLES: Set<string>;
/** @type {Set<string>} */
export const VALID_DISPLAY_MODES: Set<string>;
/** @type {Set<never>} */
export const EMPTY_SET: Set<never>;
export type RedDotDayKeyOptions = {
    /**
     * Local hour (integer 0..23) at which the day rolls over.
     */
    resetHour?: number;
    /**
     * Fixed UTC offset in minutes (e.g. 480 for UTC+8); omitted = host local time.
     */
    tzOffsetMinutes?: number;
};
export type RedDotBadgeFormatOptions = {
    /**
     * Badge style; 'none' and 'dot'/'quiet' yield "".
     */
    style?: RedDotStyle;
    /**
     * Cap for number badges (positive integer); larger counts render as "<max>+".
     */
    maxCount?: number;
    /**
     * Text used for 'new' badges.
     */
    newLabel?: string;
};
/**
 * Visual style of a badge: 'none' hides it, 'quiet' is a small amber dot, 'dot' a red dot, 'new' a label, 'number' a count.
 */
export type RedDotStyle = "none" | "quiet" | "dot" | "new" | "number";
/**
 * Style a leaf source may produce (everything except 'none').
 */
export type RedDotLeafStyle = Exclude<RedDotStyle, "none">;
/**
 * Per-node display override; 'auto' uses the highest-priority child style.
 */
export type RedDotDisplayMode = RedDotStyle | "auto";
/**
 * Immutable snapshot of a node's resolved badge state.
 */
export type RedDotState = {
    /**
     * Normalized '/'-delimited node path.
     */
    path: string;
    /**
     * True when the node shows a badge (count > 0, unlocked and not muted).
     */
    active: boolean;
    /**
     * Aggregated count of active sources in the subtree (diamond-deduplicated).
     */
    count: number;
    /**
     * Portion of count produced by 'number'-style sources.
     */
    numberCount: number;
    /**
     * Resolved badge style ('none' when inactive).
     */
    style: RedDotStyle;
    /**
     * Badge text: "" for dots, "NEW"-style label, or a capped count such as "99+".
     */
    text: string;
    /**
     * Effective unlock state (false if this node or an ancestor is locked).
     */
    unlocked: boolean;
    /**
     * True when the node is muted (anti-harassment).
     */
    muted: boolean;
};
/**
 * Persistence backend: either a HGame save store (get/set) or a Web Storage-like object (getItem/setItem).
 */
export type RedDotStorage = {
    /**
     * Read a JSON-compatible value.
     */
    get?: (key: string, fallback: unknown) => unknown;
    /**
     * Write a JSON-compatible value.
     */
    set?: (key: string, value: unknown) => unknown;
    /**
     * Read a raw JSON string.
     */
    getItem?: (key: string) => string | null;
    /**
     * Write a raw JSON string.
     */
    setItem?: (key: string, value: string) => unknown;
};
/**
 * Serialized system state (version 1) produced by exportState and consumed by importState.
 */
export type RedDotPersistedData = {
    /**
     * Schema version (1).
     */
    version: number;
    /**
     * Unread marks per node path.
     */
    unread: Record<string, RedDotLeafStyle>;
    /**
     * Daily acknowledgement day keys (YYYY-MM-DD) per node path.
     */
    dailyAck: Record<string, string>;
    /**
     * Muted node paths.
     */
    muted: string[];
};
/**
 * Normalized result of a rule evaluator.
 */
export type RedDotRuleResult = {
    /**
     * Non-negative integer count.
     */
    count: number;
    /**
     * Style used when count > 0.
     */
    style: RedDotStyle;
};
