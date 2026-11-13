import { createLifecycle } from './lifecycle.js';
import { createInputManager } from './input.js';
import { createAssetLoader } from './assets.js';
import { createSaveStore } from './storage.js';
import { createAudioManager } from './audio.js';
import { createDiagnostics } from './diagnostics.js';
import { createGameBridge } from './game-bridge.js';
import { GAME_ENGINE_PROTOCOL, GAME_ENGINE_PROTOCOL_VERSION } from './protocol.js';

export const PLATFORM_VERSION = '1.0.0';
export { GAME_ENGINE_PROTOCOL, GAME_ENGINE_PROTOCOL_VERSION };
export { createAssetLoader } from './assets.js';
export { createSaveStore } from './storage.js';
export { createInputManager } from './input.js';
export { createAudioManager } from './audio.js';
export { createDiagnostics } from './diagnostics.js';
export { createGameBridge } from './game-bridge.js';
export { createGameHostBridge } from './host-bridge.js';

export function createGameEngine({
  gameId,
  gameVersion = '0.0.0',
  renderer = 'custom',
  assetBaseUrl = './assets/',
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  storage,
  parentOrigin,
  preventDefaultKeys = [],
  onError = () => {},
} = {}) {
  if (typeof gameId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(gameId)) {
    throw new TypeError('gameId is required and must be a stable slug');
  }

  const lifecycle = createLifecycle({ windowRef, documentRef });
  const input = createInputManager({ target: windowRef, preventDefaultKeys });
  const assets = createAssetLoader({
    baseUrl: assetBaseUrl,
    baseURI: documentRef?.baseURI || windowRef?.location?.href,
    fetchImpl: windowRef?.fetch?.bind(windowRef) || globalThis.fetch?.bind(globalThis),
  });
  const save = createSaveStore({ gameId, storage });
  const audio = createAudioManager({ AudioContextClass: windowRef?.AudioContext || windowRef?.webkitAudioContext });
  const host = createGameBridge({ gameId, windowRef, documentRef, parentOrigin });
  const diagnostics = createDiagnostics({
    gameId,
    windowRef,
    onReport: detail => {
      onError(detail);
      host.send('game:error', detail);
    },
  });

  const offFocus = lifecycle.on('focus', focused => input.setFocused(focused));
  const offHostFocus = host.on('focus', focused => {
    lifecycle.setFocused(focused);
    input.setFocused(focused);
  });
  const offHostResize = host.on('resize', size => lifecycle.resize(size));
  const offVisibility = host.on('visibility', visible => {
    lifecycle.setVisible(visible);
    if (!visible) input.reset();
  });
  const offDocumentVisibility = lifecycle.on('visibility', visible => {
    if (!visible) input.reset();
  });
  let disposed = false;

  function ready() {
    if (disposed) return false;
    lifecycle.ready();
    host.ready();
    return true;
  }

  function reportState(state) {
    if (disposed) return false;
    return host.send('game:state', state);
  }

  function reportMetrics(extra = {}) {
    if (disposed) return false;
    return host.send('game:metrics', { ...diagnostics.snapshot(), ...extra });
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    offFocus();
    offHostFocus();
    offHostResize();
    offVisibility();
    offDocumentVisibility();
    lifecycle.dispose();
    input.dispose();
    diagnostics.dispose();
    host.dispose();
    void audio.dispose()?.catch?.(() => {});
    return true;
  }

  return Object.freeze({
    meta: Object.freeze({ gameId, gameVersion, renderer, engineVersion: PLATFORM_VERSION, protocolVersion: GAME_ENGINE_PROTOCOL_VERSION }),
    lifecycle,
    input,
    assets,
    save,
    audio,
    diagnostics,
    host,
    ready,
    reportState,
    reportMetrics,
    dispose,
  });
}
