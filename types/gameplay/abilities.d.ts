/** @typedef {import('../internal/ability-timeline.js').AbilityTimeline} AbilityTimeline */
/** @typedef {import('../internal/ability-timeline.js').AbilityTimelineEvent} AbilityTimelineEvent */
/** @typedef {import('../internal/ability-timeline.js').AbilityTimelineRun} AbilityTimelineRun */
/**
 * @typedef {object} AbilityDefinition
 * @property {number} [cooldown=0] Seconds to replenish one charge; sequential recharge.
 * @property {number} [charges=1] Maximum charges; available charges can be used consecutively.
 * @property {Record<string, number>} [costs] Effective attribute costs, paid on commit rather than on cast start.
 * @property {number} [castTime=0]
 * @property {number} [channelTime=0] Busy duration after commit.
 * @property {number} [channelInterval=0] Optional repeated execution during channeling.
 * @property {number} [globalCooldown=0]
 * @property {string} [group] Optional shared cooldown group.
 * @property {number} [groupCooldown] Defaults to cooldown.
 * @property {import('../core/tags.js').TagQuery} [requiredTags]
 * @property {readonly string[]} [blockedTags]
 * @property {readonly string[]} [activeTags] Granted only while casting/channeling.
 * @property {readonly string[]} [effects] Effect definitions applied to this actor on commit.
 * @property {AbilityTimeline} [timeline] Set cast and recovery timing from one clock, with animation and event cues.
 */
/** @typedef {{target?: unknown, payload?: unknown}} AbilityContext */
/** @typedef {{id: string, phase: 'activate' | 'channel', ticks: number, target?: unknown, payload?: unknown, attributes: import('./attributes.js').AttributeSet, tags: import('../core/tags.js').TagContainer, effects: import('./effects.js').EffectController}} AbilityExecution */
/** @typedef {'unknown' | 'disposed' | 'busy' | 'tags' | 'cooldown' | 'global-cooldown' | 'group-cooldown' | 'resources'} AbilityBlockReason */
/** @typedef {{ok: true} | {ok: false, reason: AbilityBlockReason}} AbilityAvailability */
/** @typedef {{ok: true, id: string, phase: 'casting' | 'committed'} | {ok: false, reason: AbilityBlockReason}} AbilityActivation */
/** @typedef {{id: string, charges: number, maxCharges: number, rechargeRemaining: number, active: 'casting' | 'channeling' | null, timeline?: {elapsed: number, duration: number, commitAt: number, clip?: string}}} AbilityState */
/** @typedef {{schemaVersion: 1, abilities: Record<string, {charges: number, rechargeRemaining: number}>, globalRemaining: number, groups: Record<string, number>}} AbilitySnapshot */
/** @typedef {{type: 'cast' | 'commit' | 'channel' | 'end' | 'cancel' | 'queued' | 'queue-expired', id: string, reason?: string, count?: number}} AbilityEvent */
/**
 * @typedef {object} AbilitySystem
 * @property {(id: string, definition: AbilityDefinition) => void} define Cannot redefine an active ability.
 * @property {(id: string) => AbilityAvailability} canActivate
 * @property {(id: string, context?: AbilityContext) => AbilityActivation} tryActivate
 * @property {(id: string, context?: AbilityContext, seconds?: number) => void} queue Buffer one command, replacing the previous one.
 * @property {() => void} clearQueue
 * @property {(reason?: string) => boolean} cancel Cancels casting or channeling; committed costs are not refunded.
 * @property {(id: string) => AbilityState} getState
 * @property {() => string | null} getActive
 * @property {(dt: number) => void} update
 * @property {() => AbilitySnapshot} snapshot Active casts/channels and target references are deliberately not serialized.
 * @property {(snapshot: AbilitySnapshot) => void} restore Cancels transient casts and buffered commands.
 * @property {(listener: (event: AbilityEvent) => void) => (() => void)} subscribe
 * @property {() => void} dispose
 */
/**
 * Data-driven skills, shared resource costs, rechargeable charges, casting and input buffering.
 * Call update from the application's existing fixedUpdate; this system creates no timers.
 * Execution is synchronous and game-owned; targets, hit detection and damage formulas remain game rules.
 * @param {{attributes: import('./attributes.js').AttributeSet, tags: import('../core/tags.js').TagContainer, effects: import('./effects.js').EffectController, definitions?: Record<string, AbilityDefinition>, execute?: (context: AbilityExecution) => void, onEvent?: (event: AbilityEvent) => void, onTimeline?: (event: AbilityTimelineEvent) => void}} options
 * @returns {AbilitySystem}
 */
export function createAbilitySystem({ attributes, tags, effects, definitions, execute, onEvent, onTimeline }: {
    attributes: import("./attributes.js").AttributeSet;
    tags: import("../core/tags.js").TagContainer;
    effects: import("./effects.js").EffectController;
    definitions?: Record<string, AbilityDefinition>;
    execute?: (context: AbilityExecution) => void;
    onEvent?: (event: AbilityEvent) => void;
    onTimeline?: (event: AbilityTimelineEvent) => void;
}): AbilitySystem;
export type AbilityTimeline = import("../internal/ability-timeline.js").AbilityTimeline;
export type AbilityTimelineEvent = import("../internal/ability-timeline.js").AbilityTimelineEvent;
export type AbilityTimelineRun = import("../internal/ability-timeline.js").AbilityTimelineRun;
export type AbilityDefinition = {
    /**
     * Seconds to replenish one charge; sequential recharge.
     */
    cooldown?: number | undefined;
    /**
     * Maximum charges; available charges can be used consecutively.
     */
    charges?: number | undefined;
    /**
     * Effective attribute costs, paid on commit rather than on cast start.
     */
    costs?: Record<string, number> | undefined;
    castTime?: number | undefined;
    /**
     * Busy duration after commit.
     */
    channelTime?: number | undefined;
    /**
     * Optional repeated execution during channeling.
     */
    channelInterval?: number | undefined;
    globalCooldown?: number | undefined;
    /**
     * Optional shared cooldown group.
     */
    group?: string | undefined;
    /**
     * Defaults to cooldown.
     */
    groupCooldown?: number | undefined;
    requiredTags?: import("../core/tags.js").TagQuery;
    blockedTags?: readonly string[] | undefined;
    /**
     * Granted only while casting/channeling.
     */
    activeTags?: readonly string[] | undefined;
    /**
     * Effect definitions applied to this actor on commit.
     */
    effects?: readonly string[] | undefined;
    /**
     * Set cast and recovery timing from one clock, with animation and event cues.
     */
    timeline?: import("../internal/ability-timeline.js").AbilityTimeline | undefined;
};
export type AbilityContext = {
    target?: unknown;
    payload?: unknown;
};
export type AbilityExecution = {
    id: string;
    phase: "activate" | "channel";
    ticks: number;
    target?: unknown;
    payload?: unknown;
    attributes: import("./attributes.js").AttributeSet;
    tags: import("../core/tags.js").TagContainer;
    effects: import("./effects.js").EffectController;
};
export type AbilityBlockReason = "unknown" | "disposed" | "busy" | "tags" | "cooldown" | "global-cooldown" | "group-cooldown" | "resources";
export type AbilityAvailability = {
    ok: true;
} | {
    ok: false;
    reason: AbilityBlockReason;
};
export type AbilityActivation = {
    ok: true;
    id: string;
    phase: "casting" | "committed";
} | {
    ok: false;
    reason: AbilityBlockReason;
};
export type AbilityState = {
    id: string;
    charges: number;
    maxCharges: number;
    rechargeRemaining: number;
    active: "casting" | "channeling" | null;
    timeline?: {
        elapsed: number;
        duration: number;
        commitAt: number;
        clip?: string;
    };
};
export type AbilitySnapshot = {
    schemaVersion: 1;
    abilities: Record<string, {
        charges: number;
        rechargeRemaining: number;
    }>;
    globalRemaining: number;
    groups: Record<string, number>;
};
export type AbilityEvent = {
    type: "cast" | "commit" | "channel" | "end" | "cancel" | "queued" | "queue-expired";
    id: string;
    reason?: string;
    count?: number;
};
export type AbilitySystem = {
    /**
     * Cannot redefine an active ability.
     */
    define: (id: string, definition: AbilityDefinition) => void;
    canActivate: (id: string) => AbilityAvailability;
    tryActivate: (id: string, context?: AbilityContext) => AbilityActivation;
    /**
     * Buffer one command, replacing the previous one.
     */
    queue: (id: string, context?: AbilityContext, seconds?: number) => void;
    clearQueue: () => void;
    /**
     * Cancels casting or channeling; committed costs are not refunded.
     */
    cancel: (reason?: string) => boolean;
    getState: (id: string) => AbilityState;
    getActive: () => string | null;
    update: (dt: number) => void;
    /**
     * Active casts/channels and target references are deliberately not serialized.
     */
    snapshot: () => AbilitySnapshot;
    /**
     * Cancels transient casts and buffered commands.
     */
    restore: (snapshot: AbilitySnapshot) => void;
    subscribe: (listener: (event: AbilityEvent) => void) => (() => void);
    dispose: () => void;
};
