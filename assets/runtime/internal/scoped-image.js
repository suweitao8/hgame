import { cleanupAll } from './cleanup.js';

/** @type {WeakMap<object, { refs: number, listeners: Set<(image: object) => void> }>} */
const ownership = new WeakMap();

/** @param {unknown} image */
export function retainScopedImage(image) {
  if (!image || typeof image !== 'object') return;
  const record = ownership.get(image);
  if (record) record.refs++;
  else ownership.set(image, { refs: 1, listeners: new Set() });
}

/**
 * Drop renderer copies immediately before the final scope closes the image.
 * The returned unsubscribe holds no reference to the image itself.
 * @param {object} image
 * @param {(image: object) => void} listener
 */
export function onScopedImageRelease(image, listener) {
  const listeners = ownership.get(image)?.listeners;
  if (!listeners) return null;
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** @param {unknown} image */
export function releaseScopedImage(image) {
  if (!image || typeof image !== 'object') return;
  const record = ownership.get(image);
  if (!record || --record.refs > 0) return;
  ownership.delete(image);
  const listeners = [...record.listeners];
  record.listeners.clear();
  const closable = /** @type {{ close?(): void }} */ (image);
  cleanupAll([
    ...listeners.map(listener => () => listener(image)),
    () => closable.close?.(),
  ], 'Scoped image disposal failed');
}
