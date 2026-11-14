/**
 * @typedef {object} RedDotDOMOptions
 * @property {Pick<RedDotSystem, 'subscribe' | 'acknowledge' | 'getState'>} system Red-dot system to render (required).
 * @property {Element} root Root element scanned for bound hosts and used for click delegation (required).
 * @property {Document} [documentRef=globalThis.document] Document used to create badge elements and inject the stylesheet.
 * @property {string} [attribute='data-red-dot'] Attribute holding the node path.
 * @property {string} [modeAttribute='data-red-dot-mode'] Attribute overriding the style ('none' | 'quiet' | 'dot' | 'new' | 'number').
 * @property {string} [ackAttribute='data-red-dot-ack'] Click-to-acknowledge attribute; "false" disables, "recursive"/"tree" acknowledges the subtree.
 * @property {boolean} [observe=true] Watch the DOM with a MutationObserver and re-bind automatically.
 * @property {typeof MutationObserver} [MutationObserverClass=globalThis.MutationObserver] Injectable observer constructor.
 */
/**
 * @typedef {object} RedDotDOMBinding
 * @property {() => number} refresh Re-scan the DOM and (re)bind hosts; returns the bound host count.
 * @property {(hostEl: Element) => Element} mountBadge Create (or find) the badge element inside a host.
 * @property {() => void} dispose Unbind all hosts, remove owned badges and stop observing.
 */
/**
 * Declaratively binds `[data-red-dot="Path/To/Node"]` DOM elements to a
 * `createRedDotSystem` instance, rendering floating badges (`dot`/`number`/`new`/`quiet`),
 * applying optional `data-red-dot-mode` visual overrides, and handling click-to-acknowledge
 * via `[data-red-dot-ack]` (default self-only, or `"recursive"` for clear-all).
 * @param {RedDotDOMOptions} options
 * @returns {Readonly<RedDotDOMBinding>}
 */
export function bindRedDotDOM({ system, root, documentRef, attribute, modeAttribute, ackAttribute, observe, MutationObserverClass, }?: RedDotDOMOptions): Readonly<RedDotDOMBinding>;
export type RedDotDOMOptions = {
    /**
     * Red-dot system to render (required).
     */
    system: Pick<RedDotSystem, "subscribe" | "acknowledge" | "getState">;
    /**
     * Root element scanned for bound hosts and used for click delegation (required).
     */
    root: Element;
    /**
     * Document used to create badge elements and inject the stylesheet.
     */
    documentRef?: Document;
    /**
     * Attribute holding the node path.
     */
    attribute?: string;
    /**
     * Attribute overriding the style ('none' | 'quiet' | 'dot' | 'new' | 'number').
     */
    modeAttribute?: string;
    /**
     * Click-to-acknowledge attribute; "false" disables, "recursive"/"tree" acknowledges the subtree.
     */
    ackAttribute?: string;
    /**
     * Watch the DOM with a MutationObserver and re-bind automatically.
     */
    observe?: boolean;
    /**
     * Injectable observer constructor.
     */
    MutationObserverClass?: typeof MutationObserver;
};
export type RedDotDOMBinding = {
    /**
     * Re-scan the DOM and (re)bind hosts; returns the bound host count.
     */
    refresh: () => number;
    /**
     * Create (or find) the badge element inside a host.
     */
    mountBadge: (hostEl: Element) => Element;
    /**
     * Unbind all hosts, remove owned badges and stop observing.
     */
    dispose: () => void;
};
export type RedDotSystem = import("../ui/red-dot.js").RedDotSystem;
export type RedDotState = import("../ui/red-dot.js").RedDotState;
