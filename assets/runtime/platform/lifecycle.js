import { createEmitter } from './events.js';

function sizeOf(windowRef) {
  return {
    width: Math.max(0, Number(windowRef?.innerWidth) || 0),
    height: Math.max(0, Number(windowRef?.innerHeight) || 0),
    pixelRatio: Math.min(3, Math.max(1, Number(windowRef?.devicePixelRatio) || 1)),
  };
}

export function createLifecycle({ windowRef, documentRef } = {}) {
  const events = createEmitter();
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
    events.emit('dispose');
    events.clear();
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
