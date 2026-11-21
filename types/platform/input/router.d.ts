/**
 * @typedef {object} Vec2Like
 * @property {number} x
 * @property {number} y
 */
/**
 * @typedef {object} InputActionRouterOptions
 * @property {import('./manager.js').InputManager | null} [input] Source of key / pointer state.
 * @property {((code: string) => boolean) | null} [readCode] Extra key reader (e.g. virtual buttons); OR-ed with `input`.
 */
/**
 * @typedef {object} PushContextOptions
 * @property {boolean} [enabled=true]
 * @property {number} [priority] Override the context priority.
 */
/**
 * @typedef {object} InputContextEntry
 * @property {import('./contexts.js').InputContext} context
 * @property {number} priority
 * @property {boolean} enabled
 * @property {number} order Insertion order tie-breaker (later wins).
 */
/**
 * @typedef {object} InputActionRouter Priority-ordered action / axis router.
 * @property {(context: import('./contexts.js').InputContext, options?: PushContextOptions) => InputContextEntry} pushContext Add or replace a context by name.
 * @property {(nameOrContext: string | { name: string }) => boolean} removeContext
 * @property {(name: string, enabled: boolean) => boolean} setContextEnabled
 * @property {(name: string, options?: { enabledOnly?: boolean }) => boolean} hasContext
 * @property {() => { name: string, priority: number, enabled: boolean }[]} listContexts
 * @property {() => void} clearContexts
 * @property {(actionName: string, down: boolean) => boolean} setVirtualAction Drive an action from touch UI.
 * @property {(axisName: string, value: number) => number} setVirtualAxis1D Clamped to -1..1; returns the applied value.
 * @property {(axisName: string, x?: number, y?: number) => Vec2Like} setVirtualAxis2D Clamped to unit length; returns the applied vector.
 * @property {() => void} clearVirtualInputs
 * @property {(dtSeconds?: number) => void} update Evaluate bindings once per tick (seconds).
 * @property {(action: string) => boolean} isDown
 * @property {(action: string) => boolean} wasPressed
 * @property {(action: string) => boolean} wasReleased
 * @property {(action: string) => number} heldSeconds Seconds the action has been held.
 * @property {(action: string, minSeconds?: number) => boolean} isHeld
 * @property {(action: string) => boolean} isBuffered Press still inside its buffer window.
 * @property {(action: string) => boolean} consumeBuffered Consume the buffered press; true if one was pending.
 * @property {(axisName: string) => number} getAxis1D
 * @property {<T extends Vec2Like = Vec2Like>(axisName: string, out?: T) => T} getAxis2D
 * @property {(contextName: string, actionName: string, keys: string | Iterable<string> | null) => string[]} rebindAction
 * @property {(contextName: string, actionName: string) => { contextName: string, actionName: string, keys: string[], overridden: boolean } | null} getActionBinding
 * @property {(contextName?: string | null) => void} resetBindings
 * @property {() => { version: number, contexts: Record<string, Record<string, string[]>> }} exportBindings
 * @property {(data: unknown) => number} importBindings
 * @property {(storage?: { setItem(k: string, v: string): void } | null, key?: string) => boolean} saveBindings
 * @property {(storage?: { getItem(k: string): string | null } | null, key?: string) => number | false} loadBindings
 * @property {() => void} reset
 */
/**
 * Priority-ordered input action & axis router supporting key consumption across
 * layered contexts, chorded bindings, hold timers, and input buffering.
 *
 * @param {InputActionRouterOptions} [options]
 * @returns {InputActionRouter}
 */
export function createInputActionRouter({ input, readCode }?: InputActionRouterOptions | undefined): InputActionRouter;
export type Vec2Like = {
    x: number;
    y: number;
};
export type InputActionRouterOptions = {
    /**
     * Source of key / pointer state.
     */
    input?: import("./manager.js").InputManager | null | undefined;
    /**
     * Extra key reader (e.g. virtual buttons); OR-ed with `input`.
     */
    readCode?: ((code: string) => boolean) | null | undefined;
};
export type PushContextOptions = {
    enabled?: boolean | undefined;
    /**
     * Override the context priority.
     */
    priority?: number | undefined;
};
export type InputContextEntry = {
    context: import("./contexts.js").InputContext;
    priority: number;
    enabled: boolean;
    /**
     * Insertion order tie-breaker (later wins).
     */
    order: number;
};
/**
 * Priority-ordered action / axis router.
 */
export type InputActionRouter = {
    /**
     * Add or replace a context by name.
     */
    pushContext: (context: import("./contexts.js").InputContext, options?: PushContextOptions) => InputContextEntry;
    removeContext: (nameOrContext: string | {
        name: string;
    }) => boolean;
    setContextEnabled: (name: string, enabled: boolean) => boolean;
    hasContext: (name: string, options?: {
        enabledOnly?: boolean;
    }) => boolean;
    listContexts: () => {
        name: string;
        priority: number;
        enabled: boolean;
    }[];
    clearContexts: () => void;
    /**
     * Drive an action from touch UI.
     */
    setVirtualAction: (actionName: string, down: boolean) => boolean;
    /**
     * Clamped to -1..1; returns the applied value.
     */
    setVirtualAxis1D: (axisName: string, value: number) => number;
    /**
     * Clamped to unit length; returns the applied vector.
     */
    setVirtualAxis2D: (axisName: string, x?: number, y?: number) => Vec2Like;
    clearVirtualInputs: () => void;
    /**
     * Evaluate bindings once per tick (seconds).
     */
    update: (dtSeconds?: number) => void;
    isDown: (action: string) => boolean;
    wasPressed: (action: string) => boolean;
    wasReleased: (action: string) => boolean;
    /**
     * Seconds the action has been held.
     */
    heldSeconds: (action: string) => number;
    isHeld: (action: string, minSeconds?: number) => boolean;
    /**
     * Press still inside its buffer window.
     */
    isBuffered: (action: string) => boolean;
    /**
     * Consume the buffered press; true if one was pending.
     */
    consumeBuffered: (action: string) => boolean;
    getAxis1D: (axisName: string) => number;
    getAxis2D: <T extends Vec2Like = Vec2Like>(axisName: string, out?: T) => T;
    rebindAction: (contextName: string, actionName: string, keys: string | Iterable<string> | null) => string[];
    getActionBinding: (contextName: string, actionName: string) => {
        contextName: string;
        actionName: string;
        keys: string[];
        overridden: boolean;
    } | null;
    resetBindings: (contextName?: string | null) => void;
    exportBindings: () => {
        version: number;
        contexts: Record<string, Record<string, string[]>>;
    };
    importBindings: (data: unknown) => number;
    saveBindings: (storage?: {
        setItem(k: string, v: string): void;
    } | null, key?: string) => boolean;
    loadBindings: (storage?: {
        getItem(k: string): string | null;
    } | null, key?: string) => number | false;
    reset: () => void;
};
