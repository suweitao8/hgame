import { createEmitter } from './events.js';

/** @param {Window | undefined} windowRef @returns {ViewportSize} */
function sizeOf(windowRef) {
  return {
    width: Math.max(0, Number(windowRef?.innerWidth) || 0),
    height: Math.max(0, Number(windowRef?.innerHeight) || 0),
    pixelRatio: Math.min(3, Math.max(1, Number(windowRef?.devicePixelRatio) || 1)),
  };
}

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
export function createLifecycle({ windowRef, documentRef } = {}) {
  /** @type {import('./events.js').Emitter<LifecycleEvents>} */
  const events = createEmitter();
  /** @type {LifecycleState} */
  let state = 'created';
  let focused = true;
  let visible = documentRef?.visibilityState !== 'hidden';
  let disposed = false;

  const onFocus = () => setFocused(true);
  const onBlur = () => setFocused(false);
  const onResize = () => events.emit('resize', sizeOf(windowRef));
  const onVisibility = () => {
    visible = documentRef?.visibilityState !== 'hidden';
    events.emit('visibility', visible);
  };

  windowRef?.addEventListener?.('focus', onFocus);
  windowRef?.addEventListener?.('blur', onBlur);
  windowRef?.addEventListener?.('resize', onResize);
  documentRef?.addEventListener?.('visibilitychange', onVisibility);

  /** @param {boolean} value @returns {boolean} */
  function setFocused(value) {
    if (disposed || focused === Boolean(value)) return false;
    focused = Boolean(value);
    events.emit('focus', focused);
    return true;
  }

  function ready() {
    if (disposed || state !== 'created') return false;
    state = 'ready';
    events.emit('ready', { state });
    return true;
  }

  /** @param {Partial<ViewportSize>} [value] @returns {boolean} */
  function resize(value = sizeOf(windowRef)) {
    if (disposed) return false;
    const next = {
      width: Math.max(0, Number(value.width) || 0),
      height: Math.max(0, Number(value.height) || 0),
      pixelRatio: Math.min(3, Math.max(1, Number(value.pixelRatio) || 1)),
    };
    events.emit('resize', next);
    return true;
  }

  /** @param {boolean} value @returns {boolean} */
  function setVisible(value) {
    if (disposed || visible === Boolean(value)) return false;
    visible = Boolean(value);
    events.emit('visibility', visible);
    return true;
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    state = 'disposed';
    windowRef?.removeEventListener?.('focus', onFocus);
    windowRef?.removeEventListener?.('blur', onBlur);
    windowRef?.removeEventListener?.('resize', onResize);
    documentRef?.removeEventListener?.('visibilitychange', onVisibility);
    try { events.emit('dispose'); }
    finally { events.clear(); }
    return true;
  }

  return Object.freeze({
    get state() { return state; },
    get focused() { return focused; },
    get visible() { return visible; },
    on: events.on,
    ready,
    setFocused,
    setVisible,
    resize,
    dispose,
  });
}
