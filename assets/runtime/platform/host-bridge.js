import { createEmitter } from './events.js';
import { GAME_ENGINE_PROTOCOL, GAME_ENGINE_PROTOCOL_VERSION, GAME_MESSAGE_TYPES } from './protocol.js';

function createSessionId(windowRef) {
  if (typeof windowRef?.crypto?.randomUUID === 'function') return windowRef.crypto.randomUUID();
  return 'wge-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

export function createGameHostBridge({
  frame,
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  onMessage: onHostMessage = () => {},
} = {}) {
  if (!frame) throw new TypeError('frame is required');
  const events = createEmitter();
  let session = null;
  let disposed = false;

  function post(type, payload = {}) {
    if (!session || disposed || !frame.contentWindow) return false;
    frame.contentWindow.postMessage({
      channel: GAME_ENGINE_PROTOCOL,
      protocolVersion: GAME_ENGINE_PROTOCOL_VERSION,
      type,
      gameId: session.gameId,
      sessionId: session.sessionId,
      payload,
    }, session.targetOrigin);
    return true;
  }

  function onFrameLoad() {
    if (!session || disposed) return;
    post('host:hello', {
      capabilities: { focus: true, resize: true, diagnostics: true },
    });
    sendResize();
  }

  function sendResize() {
    if (!session) return false;
    const rect = frame.getBoundingClientRect?.() || {};
    return post('host:resize', {
      width: Math.max(0, Number(rect.width) || 0),
      height: Math.max(0, Number(rect.height) || 0),
      pixelRatio: Math.min(3, Math.max(1, Number(windowRef?.devicePixelRatio) || 1)),
    });
  }

  function onMessage(event) {
    if (disposed || !session || event.source !== frame.contentWindow || event.origin !== session.targetOrigin) return;
    const message = event.data;
    if (!message || message.channel !== GAME_ENGINE_PROTOCOL || message.protocolVersion !== GAME_ENGINE_PROTOCOL_VERSION) return;
    if (message.gameId !== session.gameId) return;
    if (message.type === 'game:hello') {
      post('host:hello', { capabilities: { focus: true, resize: true, diagnostics: true } });
      sendResize();
      return;
    }
    if (message.sessionId !== session.sessionId || !GAME_MESSAGE_TYPES.includes(message.type)) return;
    const result = Object.freeze({ type: message.type, gameId: message.gameId, payload: message.payload || {} });
    if (message.type === 'game:ready') session.ready = true;
    events.emit(message.type, result);
    onHostMessage(result);
  }

  function onFocusIn() {
    post('host:focus', { focused: documentRef?.activeElement === frame });
  }

  function onWindowBlur() {
    if (documentRef?.activeElement !== frame) post('host:focus', { focused: false });
  }

  function onWindowFocus() {
    post('host:focus', { focused: documentRef?.activeElement === frame });
  }

  function onVisibilityChange() {
    post('host:visibility', { visible: documentRef?.visibilityState !== 'hidden' });
  }

  function onFrameFocus() {
    post('host:focus', { focused: true });
  }

  frame.addEventListener?.('load', onFrameLoad);
  frame.addEventListener?.('focus', onFrameFocus);
  windowRef?.addEventListener?.('message', onMessage);
  windowRef?.addEventListener?.('resize', sendResize);
  windowRef?.addEventListener?.('focusin', onFocusIn);
  windowRef?.addEventListener?.('blur', onWindowBlur);
  windowRef?.addEventListener?.('focus', onWindowFocus);
  documentRef?.addEventListener?.('visibilitychange', onVisibilityChange);

  function startSession({ gameId, targetOrigin }) {
    if (disposed) throw new Error('game host bridge is disposed');
    if (typeof gameId !== 'string' || !gameId) throw new TypeError('gameId is required');
    const origin = new URL(targetOrigin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) {
      throw new TypeError('game target origin must use HTTP or HTTPS without credentials');
    }
    session = { gameId, targetOrigin: origin.origin, sessionId: createSessionId(windowRef), ready: false };
    return session.sessionId;
  }

  function stopSession() {
    session = null;
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    session = null;
    frame.removeEventListener?.('load', onFrameLoad);
    frame.removeEventListener?.('focus', onFrameFocus);
    windowRef?.removeEventListener?.('message', onMessage);
    windowRef?.removeEventListener?.('resize', sendResize);
    windowRef?.removeEventListener?.('focusin', onFocusIn);
    windowRef?.removeEventListener?.('blur', onWindowBlur);
    windowRef?.removeEventListener?.('focus', onWindowFocus);
    documentRef?.removeEventListener?.('visibilitychange', onVisibilityChange);
    events.clear();
    return true;
  }

  return Object.freeze({
    get session() { return session ? { ...session } : null; },
    on: events.on,
    startSession,
    stopSession,
    sendResize,
    sendFocus: focused => post('host:focus', { focused: Boolean(focused) }),
    dispose,
  });
}
