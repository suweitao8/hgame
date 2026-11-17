/**
 * @typedef {object} EffectDefinition
 * @property {number} [duration=0] Seconds; 0 is instant, -1 lasts until removed.
 * @property {'refresh' | 'stack' | 'replace' | 'independent'} [stacking='refresh']
 * @property {number} [maxStacks=1]
 * @property {readonly import('./attributes.js').AttributeModifier[]} [modifiers] Active modifiers, scaled by stacks.
 * @property {Record<string, number>} [changes] Effective-value changes applied once on application.
 * @property {readonly string[]} [tags] Reference-counted tags granted while active.
 * @property {{interval: number, changes: Record<string, number>}} [periodic] Effective-value deltas per interval, per stack.
 */
/** @typedef {{handle: string, definition: string, source: string, stacks: number, remaining: number, nextTick: number | null}} EffectState */
/** @typedef {{schemaVersion: 1, nextId: number, effects: EffectState[]}} EffectSnapshot */
/** @typedef {{type: 'applied' | 'stacked' | 'tick' | 'removed', handle: string, definition: string, stacks: number, count?: number, reason?: string}} EffectEvent */
/**
 * @typedef {object} EffectController
 * @property {import('./attributes.js').AttributeSet} attributes
 * @property {import('../core/tags.js').TagContainer} tags
 * @property {(id: string, definition: EffectDefinition) => void} define Remove active instances before redefining their effect.
 * @property {(id: string) => boolean} hasDefinition
 * @property {(id: string, options?: {source?: string, stacks?: number, duration?: number}) => string | null} apply Handle, or null for an instant effect.
 * @property {(handle: string, reason?: string) => boolean} remove
 * @property {(definition: string, source?: string) => number} removeByDefinition
 * @property {(dt: number) => void} update Advance simulation seconds; no independent scheduler.
 * @property {() => EffectState[]} list
 * @property {() => EffectSnapshot} snapshot
 * @property {(snapshot: EffectSnapshot) => void} restore Does not reapply instant changes or past periodic ticks.
 * @property {() => void} clear
 * @property {(listener: (event: EffectEvent) => void) => (() => void)} subscribe
 * @property {() => void} dispose
 */
/**
 * Create stackable status effects shared by 2D, 3D and command-driven games.
 * @param {{attributes: import('./attributes.js').AttributeSet, tags?: import('../core/tags.js').TagContainer, definitions?: Record<string, EffectDefinition>, maxEffects?: number, onEvent?: (event: EffectEvent) => void}} options
 * @returns {EffectController}
 */
export function createEffectController({ attributes, tags, definitions, maxEffects, onEvent }: {
    attributes: import("./attributes.js").AttributeSet;
    tags?: import("../core/tags.js").TagContainer;
    definitions?: Record<string, EffectDefinition>;
    maxEffects?: number;
    onEvent?: (event: EffectEvent) => void;
}): EffectController;
export type EffectDefinition = {
    /**
     * Seconds; 0 is instant, -1 lasts until removed.
     */
    duration?: number | undefined;
    stacking?: "replace" | "refresh" | "stack" | "independent" | undefined;
    maxStacks?: number | undefined;
    /**
     * Active modifiers, scaled by stacks.
     */
    modifiers?: readonly import("./attributes.js").AttributeModifier[] | undefined;
    /**
     * Effective-value changes applied once on application.
     */
    changes?: Record<string, number> | undefined;
    /**
     * Reference-counted tags granted while active.
     */
    tags?: readonly string[] | undefined;
    /**
     * Effective-value deltas per interval, per stack.
     */
    periodic?: {
        interval: number;
        changes: Record<string, number>;
    } | undefined;
};
export type EffectState = {
    handle: string;
    definition: string;
    source: string;
    stacks: number;
    remaining: number;
    nextTick: number | null;
};
export type EffectSnapshot = {
    schemaVersion: 1;
    nextId: number;
    effects: EffectState[];
};
export type EffectEvent = {
    type: "applied" | "stacked" | "tick" | "removed";
    handle: string;
    definition: string;
    stacks: number;
    count?: number;
    reason?: string;
};
export type EffectController = {
    attributes: import("./attributes.js").AttributeSet;
    tags: import("../core/tags.js").TagContainer;
    /**
     * Remove active instances before redefining their effect.
     */
    define: (id: string, definition: EffectDefinition) => void;
    hasDefinition: (id: string) => boolean;
    /**
     * Handle, or null for an instant effect.
     */
    apply: (id: string, options?: {
        source?: string;
        stacks?: number;
        duration?: number;
    }) => string | null;
    remove: (handle: string, reason?: string) => boolean;
    removeByDefinition: (definition: string, source?: string) => number;
    /**
     * Advance simulation seconds; no independent scheduler.
     */
    update: (dt: number) => void;
    list: () => EffectState[];
    snapshot: () => EffectSnapshot;
    /**
     * Does not reapply instant changes or past periodic ticks.
     */
    restore: (snapshot: EffectSnapshot) => void;
    clear: () => void;
    subscribe: (listener: (event: EffectEvent) => void) => (() => void);
    dispose: () => void;
};
