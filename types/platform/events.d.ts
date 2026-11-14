/**
 * @template {Record<string, unknown>} [E=Record<string, unknown>]
 * @typedef {object} Emitter Minimal typed event emitter.
 * @property {<K extends keyof E>(type: K, listener: (value: E[K]) => void) => () => boolean} on
 *   Subscribe; returns an unsubscribe function.
 * @property {<K extends keyof E>(type: K, listener: (value: E[K]) => void) => () => boolean} once
 *   Subscribe for a single delivery; returns an unsubscribe function.
 * @property {<K extends keyof E>(type: K, value?: E[K]) => void} emit Deliver to a snapshot of the current listeners.
 * @property {() => void} clear Remove every listener.
 */
/**
 * Create a minimal typed event emitter.
 * @template {Record<string, unknown>} [E=Record<string, unknown>]
 * @returns {Emitter<E>}
 */
export function createEmitter<E extends Record<string, unknown> = Record<string, unknown>>(): Emitter<E>;
/**
 * Minimal typed event emitter.
 */
export type Emitter<E extends Record<string, unknown> = Record<string, unknown>> = {
    /**
     *   Subscribe; returns an unsubscribe function.
     */
    on: <K extends keyof E>(type: K, listener: (value: E[K]) => void) => () => boolean;
    /**
     *   Subscribe for a single delivery; returns an unsubscribe function.
     */
    once: <K extends keyof E>(type: K, listener: (value: E[K]) => void) => () => boolean;
    /**
     * Deliver to a snapshot of the current listeners.
     */
    emit: <K extends keyof E>(type: K, value?: E[K]) => void;
    /**
     * Remove every listener.
     */
    clear: () => void;
};
