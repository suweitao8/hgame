/**
 * @typedef {object} PanelDefinition
 * @property {boolean} [modal=false] Blocks pointer/back events from reaching panels underneath.
 * @property {boolean} [closeOnCancel=true] Whether handleCancel() / Escape pops this panel.
 * @property {boolean} [closeOnBackdrop=true] Whether clicking the modal backdrop pops this panel.
 * @property {boolean} [exclusive=false] Pops all existing non-pinned panels before pushing this one.
 * @property {boolean} [pinned=false] Survives clear() unless force=true.
 * @property {number} [transitionMs=160] Enter/exit transition duration in milliseconds.
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
 * @property {number} transitionMs
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
export function createPanelStack(options?: PanelStackOptions): Readonly<{
    register: (id: any, def?: {}) => void;
    push: (id: any, payload?: any, overrideDef?: any) => PanelEntry;
    pop: (opts?: {}) => PanelEntry;
    popById: (id: any) => PanelEntry;
    replace: (id: any, payload?: any, overrideDef?: any) => PanelEntry;
    toggle: (id: any, payload?: any, overrideDef?: any) => boolean;
    clear: (force?: boolean) => boolean;
    handleCancel: () => boolean;
    update: (dt: any) => void;
    isOpen: (id: any) => boolean;
    top: () => PanelEntry;
    getEntry: (id: any) => PanelEntry;
    getStack: () => PanelEntry[];
    getExiting: () => PanelEntry[];
    hasModal: () => boolean;
    subscribe: (fn: any) => () => boolean;
    bindDom: (rootEl: HTMLElement, bindOpts?: {
        targetWindow?: Window | EventTarget;
        escapeKey?: string;
    }) => () => void;
    dispose: () => void;
}>;
export type PanelDefinition = {
    /**
     * Blocks pointer/back events from reaching panels underneath.
     */
    modal?: boolean;
    /**
     * Whether handleCancel() / Escape pops this panel.
     */
    closeOnCancel?: boolean;
    /**
     * Whether clicking the modal backdrop pops this panel.
     */
    closeOnBackdrop?: boolean;
    /**
     * Pops all existing non-pinned panels before pushing this one.
     */
    exclusive?: boolean;
    /**
     * Survives clear() unless force=true.
     */
    pinned?: boolean;
    /**
     * Enter/exit transition duration in milliseconds.
     */
    transitionMs?: number;
    onEnter?: (entry: PanelEntry) => void;
    onExit?: (entry: PanelEntry) => void;
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
    transitionMs: number;
};
export type PanelStackOptions = {
    /**
     * Initial panel definitions keyed by id.
     */
    panels?: Record<string, PanelDefinition>;
    onChange?: (state: {
        stack: readonly PanelEntry[];
        modalOpen: boolean;
    }) => void;
};
