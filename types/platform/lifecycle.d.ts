/**
 * @typedef {'created' | 'ready' | 'disposed'} LifecycleState
 */
/**
 * @typedef {object} ViewportSize
 * @property {number} width Pixels (CSS), >= 0.
 * @property {number} height Pixels (CSS), >= 0.
 * @property {number} pixelRatio Device pixel ratio, clamped to 1..3.
 */
/**
 * @typedef {object} LifecycleEvents
 * @property {boolean} focus
 * @property {{ state: LifecycleState }} ready
 * @property {ViewportSize} resize
 * @property {boolean} visibility
 * @property {undefined} dispose
 */
/**
 * @typedef {object} LifecycleOptions
 * @property {Window} [windowRef]
 * @property {Document} [documentRef]
 */
/**
 * @typedef {object} Lifecycle
 * @property {LifecycleState} state
 * @property {boolean} focused
 * @property {boolean} visible
 * @property {import('./events.js').Emitter<LifecycleEvents>['on']} on Subscribe to `focus`, `ready`, `resize`, `visibility`, `dispose`.
 * @property {() => boolean} ready Mark ready; false if not in `created` state.
 * @property {(focused: boolean) => boolean} setFocused
 * @property {(visible: boolean) => boolean} setVisible
 * @property {(size?: Partial<ViewportSize>) => boolean} resize Emit `resize` (default: current window size).
 * @property {() => boolean} dispose
 */
/**
 * Create the lifecycle service (focus / visibility / resize / ready).
 * @param {LifecycleOptions} [options]
 * @returns {Lifecycle}
 */
export function createLifecycle({ windowRef, documentRef }?: LifecycleOptions | undefined): Lifecycle;
export type LifecycleState = "created" | "ready" | "disposed";
export type ViewportSize = {
    /**
     * Pixels (CSS), >= 0.
     */
    width: number;
    /**
     * Pixels (CSS), >= 0.
     */
    height: number;
    /**
     * Device pixel ratio, clamped to 1..3.
     */
    pixelRatio: number;
};
export type LifecycleEvents = {
    focus: boolean;
    ready: {
        state: LifecycleState;
    };
    resize: ViewportSize;
    visibility: boolean;
    dispose: undefined;
};
export type LifecycleOptions = {
    windowRef?: Window | undefined;
    documentRef?: Document | undefined;
};
export type Lifecycle = {
    state: LifecycleState;
    focused: boolean;
    visible: boolean;
    /**
     * Subscribe to `focus`, `ready`, `resize`, `visibility`, `dispose`.
     */
    on: import("./events.js").Emitter<LifecycleEvents>["on"];
    /**
     * Mark ready; false if not in `created` state.
     */
    ready: () => boolean;
    setFocused: (focused: boolean) => boolean;
    setVisible: (visible: boolean) => boolean;
    /**
     * Emit `resize` (default: current window size).
     */
    resize: (size?: Partial<ViewportSize>) => boolean;
    dispose: () => boolean;
};
