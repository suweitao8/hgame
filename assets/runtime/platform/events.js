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
export function createEmitter() {
  /** @type {Map<PropertyKey, Set<(value?: any) => void>>} */
  const listeners = new Map();
  function on(type, listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    const bucket = listeners.get(type) || new Set();
    bucket.add(listener);
    listeners.set(type, bucket);
    return () => bucket.delete(listener);
  }
  return Object.freeze({
    on,
    once(type, listener) {
      /** @type {() => boolean} */
      let off;
      off = on(type, value => {
        off();
        listener(value);
      });
      return off;
    },
    emit(type, value) {
      for (const listener of [...(listeners.get(type) || [])]) listener(value);
    },
    clear() {
      listeners.clear();
    },
  });
}
