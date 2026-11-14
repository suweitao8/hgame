import { createEmitter } from './events.js';
import { GAME_ENGINE_PROTOCOL, GAME_ENGINE_PROTOCOL_VERSION, GAME_MESSAGE_TYPES } from './protocol.js';

/** @param {string | undefined} hostname @returns {boolean} */
function loopbackHost(hostname) {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
}

/** @param {Document | undefined} documentRef @param {Window | undefined} windowRef @param {string | undefined} explicitOrigin @returns {Set<string>} */
function allowedParentOrigins(documentRef, windowRef, explicitOrigin) {
  if (explicitOrigin) return new Set([new URL(explicitOrigin).origin]);
  try {
    if (documentRef?.referrer) {
      const referrer = new URL(documentRef.referrer);
      if (loopbackHost(referrer.hostname) && referrer.port === '4174') return new Set([referrer.origin]);
    }
  } catch {
    // Fall through to the fixed local WebAsset origin allowlist.
  }
  const current = windowRef?.location;
  if (loopbackHost(current?.hostname) && current?.port === '4175') {
    return new Set([
      current.protocol + '//127.0.0.1:4174',
      current.protocol + '//localhost:4174',
      current.protocol + '//[::1]:4174',
    ]);
  }
  return new Set();
}

/**
 * @typedef {object} GameBridgeOptions
 * @property {string} gameId Stable game slug echoed in every message.
 * @property {Window} [windowRef] Game window (default `globalThis.window`).
 * @property {Document} [documentRef] Used to infer the embedding origin from `referrer`.
 * @property {string} [parentOrigin] Explicit trusted parent origin (otherwise a loopback allowlist is used).
 */

/**
 * @typedef {object} GameBridgeEvents
 * @property {{ sessionId: string, capabilities: Record<string, unknown> }} connect Host handshake accepted.
 * @property {unknown} incompatible Rejected `host:hello` message.
 * @property {boolean} focus
 * @property {Partial<import('./lifecycle.js').ViewportSize>} resize
 * @property {boolean} visibility
 */

/** @typedef {'game:hello' | 'game:ready' | 'game:error' | 'game:metrics' | 'game:state'} GameMessageType */

/**
 * @typedef {object} GameBridge Game-side postMessage bridge to the embedding WebAsset host.
 * @property {boolean} connected True after an accepted `host:hello`.
 * @property {string | null} sessionId
 * @property {string | null} parentOrigin Trusted parent origin once established.
 * @property {string[]} allowedParentOrigins
 * @property {string} lastMessageStatus Debug status of the last inbound message (e.g. `'accepted:host:focus'`).
 * @property {import('./events.js').Emitter<GameBridgeEvents>['on']} on
 * @property {() => boolean} ready Request `game:ready`; true if it was sent now.
 * @property {(type: GameMessageType, payload?: unknown) => boolean} send Post to the parent; false when not connected.
 * @property {() => boolean} dispose
 */

/**
 * Create the game-side host bridge.
 * @param {GameBridgeOptions} [options]
 * @returns {GameBridge}
 */
export function createGameBridge({
  gameId,
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  parentOrigin,
} = {}) {
  /** @type {import('./events.js').Emitter<GameBridgeEvents>} */
  const events = createEmitter();
  const allowedOrigins = allowedParentOrigins(documentRef, windowRef, parentOrigin);
  /** @type {string | null} */
  let trustedParentOrigin = null;
  /** @type {string | null} */
  let sessionId = null;
  let connected = false;
  let readyRequested = false;
  let disposed = false;
  let lastMessageStatus = 'waiting';

  /** @param {GameMessageType} type @param {unknown} [payload] @returns {boolean} */
  function send(type, payload = {}) {
    if (!connected || disposed || !trustedParentOrigin || !windowRef?.parent?.postMessage || !GAME_MESSAGE_TYPES.includes(type)) return false;
    windowRef.parent.postMessage({
      channel: GAME_ENGINE_PROTOCOL,
      protocolVersion: GAME_ENGINE_PROTOCOL_VERSION,
      type,
      gameId,
      sessionId,
      payload,
    }, trustedParentOrigin);
    return true;
  }

  function sendReady() {
    if (!connected || !readyRequested) return false;
    return send('game:ready', { engineVersion: '1.0.0' });
  }

  function announce() {
    if (disposed || !windowRef?.parent?.postMessage || windowRef.parent === windowRef) return;
    for (const origin of allowedOrigins) {
      windowRef.parent.postMessage({
        channel: GAME_ENGINE_PROTOCOL,
        protocolVersion: GAME_ENGINE_PROTOCOL_VERSION,
        type: 'game:hello',
        gameId,
      }, origin);
    }
  }

  /** @param {MessageEvent} event @returns {void} */
  function onMessage(event) {
    if (disposed) return;
    if (event.source !== windowRef?.parent) {
      lastMessageStatus = 'rejected:source';
      return;
    }
    if (!trustedParentOrigin) {
      if (!allowedOrigins.has(event.origin)) {
        lastMessageStatus = 'rejected:origin';
        return;
      }
      trustedParentOrigin = event.origin;
    }
    if (event.origin !== trustedParentOrigin) {
      lastMessageStatus = 'rejected:origin';
      return;
    }
    const message = event.data;
    if (!message || message.channel !== GAME_ENGINE_PROTOCOL || !message.type) {
      lastMessageStatus = 'rejected:protocol';
      return;
    }
    if (message.type === 'host:hello') {
      if (message.protocolVersion !== GAME_ENGINE_PROTOCOL_VERSION || message.gameId !== gameId || typeof message.sessionId !== 'string') {
        lastMessageStatus = 'rejected:session';
        events.emit('incompatible', message);
        return;
      }
      if (connected && sessionId === message.sessionId) {
        sendReady();
        return;
      }
      sessionId = message.sessionId;
      connected = true;
      lastMessageStatus = 'accepted:host:hello';
      events.emit('connect', { sessionId, capabilities: message.payload?.capabilities || {} });
      sendReady();
      return;
    }
    if (!connected || message.gameId !== gameId || message.sessionId !== sessionId) {
      lastMessageStatus = 'rejected:session';
      return;
    }
    lastMessageStatus = 'accepted:' + message.type;
    if (message.type === 'host:focus') events.emit('focus', Boolean(message.payload?.focused));
    else if (message.type === 'host:resize') events.emit('resize', message.payload || {});
    else if (message.type === 'host:visibility') events.emit('visibility', Boolean(message.payload?.visible));
  }

  windowRef?.addEventListener?.('message', onMessage);
  announce();

  function ready() {
    readyRequested = true;
    return sendReady();
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    connected = false;
    sessionId = null;
    windowRef?.removeEventListener?.('message', onMessage);
    events.clear();
    return true;
  }

  return Object.freeze({
    get connected() { return connected; },
    get sessionId() { return sessionId; },
    get parentOrigin() { return trustedParentOrigin; },
    get allowedParentOrigins() { return [...allowedOrigins]; },
    get lastMessageStatus() { return lastMessageStatus; },
    on: events.on,
    ready,
    send,
    dispose,
  });
}
