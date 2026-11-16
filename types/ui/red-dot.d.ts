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
export function createRedDotSystem({ storage, storageKey, clock, resetHour, tzOffsetMinutes, maxCount, newLabel, }?: RedDotSystemOptions | undefined): RedDotSystem;
export type RedDotStyle = import("./red-dot/helpers.js").RedDotStyle;
export type RedDotLeafStyle = import("./red-dot/helpers.js").RedDotLeafStyle;
export type RedDotDisplayMode = import("./red-dot/helpers.js").RedDotDisplayMode;
export type RedDotState = import("./red-dot/helpers.js").RedDotState;
export type RedDotStorage = import("./red-dot/helpers.js").RedDotStorage;
export type RedDotPersistedData = import("./red-dot/helpers.js").RedDotPersistedData;
export type RedDotRuleResult = import("./red-dot/helpers.js").RedDotRuleResult;
export type RedDotBadgeFormatOptions = import("./red-dot/helpers.js").RedDotBadgeFormatOptions;
export type RedDotDayKeyOptions = import("./red-dot/helpers.js").RedDotDayKeyOptions;
export type RedDotSystemOptions = {
    /**
     * Persistence backend (HGame save store or Web Storage-like). State is loaded at creation.
     */
    storage?: import("./red-dot/helpers.js").RedDotStorage | null | undefined;
    /**
     * Key used with storage.
     */
    storageKey?: string | undefined;
    /**
     * Millisecond clock (default Date.now); inject for deterministic tests.
     */
    clock?: (() => number) | undefined;
    /**
     * Local hour (integer 0..23) at which daily nodes reset.
     */
    resetHour?: number | undefined;
    /**
     * Fixed UTC offset in minutes for the day key; omitted = host local time.
     */
    tzOffsetMinutes?: number | undefined;
    /**
     * Default cap for number badges (positive integer).
     */
    maxCount?: number | undefined;
    /**
     * Default text for 'new' badges.
     */
    newLabel?: string | undefined;
};
/**
 * Per-node configuration for RedDotSystem#configure. Omitted fields stay unchanged.
 */
export type RedDotNodeConfig = {
    /**
     * Force a style or 'auto' to derive it from children.
     */
    displayMode?: import("./red-dot/helpers.js").RedDotDisplayMode | undefined;
    /**
     * Node-specific number cap (positive integer) or null to use the system default.
     */
    maxCount?: number | null | undefined;
    /**
     * Node-specific 'new' text or null to use the system default.
     */
    newLabel?: string | null | undefined;
    /**
     * Gate the node (and its subtree) behind a feature unlock.
     */
    unlocked?: boolean | undefined;
    /**
     * Suppress the node's badge (anti-harassment).
     */
    muted?: boolean | undefined;
};
/**
 * What a rule evaluator may return: a boolean (dot), a number (count) or an object.
 */
export type RedDotRuleReturn = boolean | number | {
    count?: number | boolean;
    style?: RedDotLeafStyle;
};
/**
 * Rule evaluator invoked by evaluate() with the user context.
 */
export type RedDotRuleEvaluator<C = unknown> = (context: C) => RedDotRuleReturn;
export type RedDotDailyOptions = {
    /**
     * Badge style while unacknowledged.
     */
    style?: import("./red-dot/helpers.js").RedDotLeafStyle | undefined;
    /**
     * Disable to suspend the daily source.
     */
    enabled?: boolean | undefined;
    /**
     * Extra gate evaluated against the last context.
     */
    condition?: ((context: unknown) => boolean) | null | undefined;
};
/**
 * One contributing source reported by RedDotSystem#explain.
 */
export type RedDotActiveSource = {
    /**
     * Node path that owns the source.
     */
    path: string;
    /**
     * Own contribution count.
     */
    count: number;
    /**
     * Own style.
     */
    style: RedDotStyle;
    /**
     * Source kinds currently active.
     */
    reasons: Array<"value" | "rule" | "unread" | "daily" | "ready">;
};
/**
 * Diagnostic report from RedDotSystem#explain.
 */
export type RedDotExplanation = {
    /**
     * Normalized node path.
     */
    path: string;
    /**
     * Current resolved state.
     */
    state: RedDotState;
    /**
     * Highest locked ancestor path (or the node itself), else null.
     */
    blockedByUnlock: string | null;
    /**
     * Whether the node is muted.
     */
    muted: boolean;
    /**
     * Active contributing nodes sorted by path.
     */
    activeSources: RedDotActiveSource[];
};
export type RedDotListener = (state: RedDotState) => void;
/**
 * Hierarchical red-dot system API. Paths accept '/' or '.' separators.
 */
export type RedDotSystem = {
    /**
     * Current commercial day key YYYY-MM-DD (getter).
     */
    dayKey: string;
    /**
     * Configure a node; returns its normalized path.
     */
    configure: (path: string, config?: RedDotNodeConfig) => string;
    /**
     * Add a DAG edge (diamond-deduplicated); false if already linked, throws on cycles.
     */
    link: (parentPath: string, childPath: string) => boolean;
    /**
     * Remove a DAG edge; false if absent.
     */
    unlink: (parentPath: string, childPath: string) => boolean;
    /**
     * Lock/unlock a subtree; returns the effective unlock state.
     */
    setUnlocked: (path: string, unlocked: boolean) => boolean;
    /**
     * Effective unlock state (true for unknown unlocked paths).
     */
    isUnlocked: (path: string) => boolean;
    /**
     * Mute/unmute a node; returns the new state.
     */
    setMuted: (path: string, muted: boolean) => boolean;
    /**
     * Whether the node is muted.
     */
    isMuted: (path: string) => boolean;
    /**
     * Set a numeric leaf (default style 'number'); returns the normalized count.
     */
    setValue: (path: string, count: number, options?: {
        style?: RedDotLeafStyle;
    }) => number;
    /**
     * Set a boolean leaf (default style 'dot').
     */
    setFlag: (path: string, active: boolean, options?: {
        style?: RedDotLeafStyle;
    }) => boolean;
    /**
     * Register a rule evaluator; returns an unregister function.
     */
    registerRule: (path: string, evaluator: RedDotRuleEvaluator, options?: {
        style?: RedDotLeafStyle;
    }) => () => void;
    /**
     * Re-run rules (optionally limited to path prefixes) with a context.
     */
    evaluate: (prefixOrPaths?: string | string[] | unknown, context?: unknown) => void;
    /**
     * Persistently mark a node unread (default style 'new').
     */
    markUnread: (path: string, options?: {
        style?: RedDotLeafStyle;
    }) => void;
    /**
     * Mark many children of a parent unread in one batch.
     */
    markUnreadBatch: (parentPath: string, itemIds: Iterable<string | number>, options?: {
        style?: RedDotLeafStyle;
    }) => void;
    /**
     * Clear an unread mark; false if none.
     */
    clearUnread: (path: string) => boolean;
    /**
     * Whether the node has an unread mark.
     */
    isUnread: (path: string) => boolean;
    /**
     * Drop unread marks under a parent whose ids are not listed; returns removed count.
     */
    syncUnreadScope: (parentPath: string, validItemIds: Iterable<string | number>) => number;
    /**
     * Register a once-per-day source; returns an unregister function.
     */
    registerDaily: (path: string, options?: RedDotDailyOptions) => () => void;
    /**
     * Acknowledge today's daily source; false if already acknowledged.
     */
    acknowledgeDaily: (path: string) => boolean;
    /**
     * Whether today's daily source was acknowledged.
     */
    isDailyAcknowledged: (path: string) => boolean;
    /**
     * Show a badge once the clock reaches readyAtMs (ms timestamp); null clears. Returns whether it is ready now.
     */
    setReadyAt: (path: string, readyAtMs: number | null | undefined, options?: {
        style?: RedDotLeafStyle;
    }) => boolean;
    /**
     * Remove a ready timer; false if none.
     */
    clearReadyAt: (path: string) => boolean;
    /**
     * Clear unread/daily sources on a node (and its subtree when recursive); returns acknowledged node count.
     */
    acknowledge: (path: string, options?: {
        recursive?: boolean;
    }) => number;
    /**
     * Re-sync the clock/day key and optionally update the context.
     */
    refreshTime: (context?: unknown) => void;
    /**
     * Run fn with listener emission deferred until it returns.
     */
    batch: <R>(fn: (system: RedDotSystem) => R) => R | undefined;
    /**
     * Recompute dirty nodes and notify listeners; true if any state changed.
     */
    flush: () => boolean;
    /**
     * Current state of a node (default empty state for unknown paths).
     */
    getState: (path: string) => RedDotState;
    /**
     * Whether the node currently shows a badge.
     */
    isActive: (path: string) => boolean;
    /**
     * Aggregated count of the node.
     */
    getCount: (path: string) => number;
    /**
     * Diagnostic breakdown of why a node is (in)active.
     */
    explain: (path: string) => RedDotExplanation;
    /**
     * Listen to one node (immediate defaults to true); returns an unsubscribe function.
     */
    subscribe: (path: string, listener: RedDotListener, options?: {
        immediate?: boolean;
    }) => () => void;
    /**
     * Listen to every node change; returns an unsubscribe function.
     */
    subscribeAny: (listener: RedDotListener) => () => void;
    /**
     * Serialize unread/daily/muted state.
     */
    exportState: () => RedDotPersistedData;
    /**
     * Replace persisted state with data.
     */
    importState: (data: RedDotPersistedData) => void;
    /**
     * Reset all nodes to defaults.
     */
    reset: (options?: {
        clearPersistence?: boolean;
    }) => void;
    /**
     * Flush pending persistence, drop listeners and nodes.
     */
    dispose: () => void;
};
import { RED_DOT_STYLES } from './red-dot/helpers.js';
import { normalizeRedDotPath } from './red-dot/helpers.js';
import { splitRedDotAncestors } from './red-dot/helpers.js';
import { computeCommercialDayKey } from './red-dot/helpers.js';
import { formatRedDotBadge } from './red-dot/helpers.js';
export { RED_DOT_STYLES, normalizeRedDotPath, splitRedDotAncestors, computeCommercialDayKey, formatRedDotBadge };
