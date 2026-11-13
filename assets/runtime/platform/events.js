export function createEmitter() {
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
