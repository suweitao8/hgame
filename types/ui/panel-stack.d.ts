/**
 * @typedef {'pop' | 'fade' | 'slide-up' | 'slide-down' | 'none'} PanelMotion
 */
/**
 * @typedef {object} PanelDefinition
 * @property {boolean} [modal=false] Blocks pointer/back events from reaching panels underneath.
 * @property {boolean} [closeOnCancel=true] Whether handleCancel() / Escape pops this panel.
 * @property {boolean} [closeOnBackdrop=true] Whether clicking the modal backdrop pops this panel.
 * @property {boolean} [exclusive=false] Pops all existing non-pinned panels before pushing this one.
 * @property {boolean} [pinned=false] Survives clear() unless force=true.
 * @property {number} [transitionMs=160] Enter/exit transition duration in milliseconds.
 * @property {PanelMotion} [motion='pop'] Visual entrance motion style for DOM/3D binders.
 * @property {(entry: PanelEntry) => void} [onEnter]
 * @property {(entry: PanelEntry) => void} [onExit]
 */
/**
 * @typedef {object} PanelEntry
 * @property {string} id
 * @property {unknown} payload
 * @property {boolean} modal
 * @property {boolean} closeOnCancel
 * @property {boolean} closeOnBackdrop
 * @property {boolean} exclusive
 * @property {boolean} pinned
 * @property {'entering' | 'open' | 'exiting'} phase
 * @property {number} alpha Transition progress [0..1]
 * @property {number} easedAlpha Eased transition progress [0..1]
 * @property {number} transitionMs
 * @property {PanelMotion} motion
 */
/**
 * @typedef {object} PanelStackOptions
 * @property {Record<string, PanelDefinition>} [panels] Initial panel definitions keyed by id.
 * @property {(state: { stack: readonly PanelEntry[], modalOpen: boolean }) => void} [onChange]
 */
/**
 * Commercial UI stack router for modals, overlays, settings, shops, and ESC back navigation.
 * Works headlessly in Node tests and optionally binds to a DOM root container.
 * @param {PanelStackOptions} [options={}]
 */
export function createPanelStack(options?: PanelStackOptions | undefined): Readonly<{
    register: (id: any, def?: {}) => void;
    push: (id: string, payload?: unknown, overrideDef?: PanelDefinition | null | undefined) => PanelEntry;
    pop: (opts?: {}) => PanelEntry | null | undefined;
    popById: (id: any) => PanelEntry | null;
    replace: (id: string, payload?: unknown, overrideDef?: PanelDefinition | null | undefined) => PanelEntry;
    toggle: (id: string, payload?: unknown, overrideDef?: PanelDefinition | null | undefined) => boolean;
    clear: (force?: boolean) => boolean;
    handleCancel: () => boolean;
    update: (dt: any) => void;
    isOpen: (id: any) => boolean;
    top: () => PanelEntry | null;
    getEntry: (id: any) => PanelEntry | null;
    getStack: () => PanelEntry[];
    getExiting: () => PanelEntry[];
    hasModal: () => boolean;
    subscribe: (fn: any) => () => boolean;
    bindDom: (rootEl: HTMLElement, bindOpts?: {
        targetWindow?: Window | EventTarget;
        escapeKey?: string;
    } | undefined) => () => void;
    dispose: () => void;
}>;
export type PanelMotion = "pop" | "fade" | "slide-up" | "slide-down" | "none";
export type PanelDefinition = {
    /**
     * Blocks pointer/back events from reaching panels underneath.
     */
    modal?: boolean | undefined;
    /**
     * Whether handleCancel() / Escape pops this panel.
     */
    closeOnCancel?: boolean | undefined;
    /**
     * Whether clicking the modal backdrop pops this panel.
     */
    closeOnBackdrop?: boolean | undefined;
    /**
     * Pops all existing non-pinned panels before pushing this one.
     */
    exclusive?: boolean | undefined;
    /**
     * Survives clear() unless force=true.
     */
    pinned?: boolean | undefined;
    /**
     * Enter/exit transition duration in milliseconds.
     */
    transitionMs?: number | undefined;
    /**
     * Visual entrance motion style for DOM/3D binders.
     */
    motion?: PanelMotion | undefined;
    onEnter?: ((entry: PanelEntry) => void) | undefined;
    onExit?: ((entry: PanelEntry) => void) | undefined;
};
export type PanelEntry = {
    id: string;
    payload: unknown;
    modal: boolean;
    closeOnCancel: boolean;
    closeOnBackdrop: boolean;
    exclusive: boolean;
    pinned: boolean;
    phase: "entering" | "open" | "exiting";
    /**
     * Transition progress [0..1]
     */
    alpha: number;
    /**
     * Eased transition progress [0..1]
     */
    easedAlpha: number;
    transitionMs: number;
    motion: PanelMotion;
};
export type PanelStackOptions = {
    /**
     * Initial panel definitions keyed by id.
     */
    panels?: Record<string, PanelDefinition> | undefined;
    onChange?: ((state: {
        stack: readonly PanelEntry[];
        modalOpen: boolean;
    }) => void) | undefined;
};
