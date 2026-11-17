/** Shared implementation helpers for the optional gameplay modules. */
export function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(label + ' must be finite');
  return value;
}
export function nonNegative(value, label) {
  finite(value, label);
  if (value < 0) throw new RangeError(label + ' must be >= 0');
  return value;
}
export function identifier(value, label = 'id') {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(label + ' must be a non-empty string');
  return value;
}
export function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(label + ' must be a positive integer');
  return value;
}
export function changes(input = {}) {
  const result = Object.create(null);
  for (const [key, value] of Object.entries(input)) result[identifier(key, 'attribute')] = finite(value, key);
  return Object.freeze(result);
}
export function publisher(callback) {
  const listeners = new Set();
  if (callback) listeners.add(callback);
  return {
    emit(event) { for (const fn of [...listeners]) if (listeners.has(fn)) fn(event); },
    subscribe(fn) {
      if (typeof fn !== 'function') throw new TypeError('listener must be a function');
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    clear() { listeners.clear(); },
  };
}
