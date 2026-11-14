# HGame Platform API

The platform layer provides browser-facing services without owning the game's loop or rules. Entry point: `assets/runtime/platform/engine.js`, re-exported from `assets/runtime/index.js`.

## Create and dispose

```js
import { createGameEngine } from './vendor/hgame/index.js';

const engine = createGameEngine({
  gameId: 'my-game',
  gameVersion: '0.1.0',
  renderer: 'threejs',
  assetBaseUrl: './assets/',
});

// After the game's own initialization is complete:
 engine.ready();

// On permanent teardown/pagehide:
 engine.dispose();
```

The engine exposes `meta`, `lifecycle`, `input`, `assets`, `save`, `audio`, `diagnostics`, and `host`. Optional `reportState(snapshot)` and `reportMetrics(extra)` send read-only diagnostics to a connected Host.

## Services

| Service | Main API | Notes |
|---|---|---|
| Lifecycle | `state`, `focused`, `visible`, `on()`, `resize()` | Does not automatically pause or resume the game loop |
| Input | `isDown()`, `wasPressed()`, `wasReleased()`, `pointer`, `pointers`, `pointerCount`, `getPointer()`, `isPointerDown()`, `wasPointerPressed()`, `wasPointerReleased()`, `preventKeys()`, `on()`, `endFrame()`, `reset()` + `createInputActionRouter` / `createArcadeControls` / `computeSplitScreenViews` | Multi-pointer touch-first primitives, virtual axis/action injection, P1/P2 arcade bindings, and opt-in `integrations/touch-controls.js` overlay |
| Assets | `resolve()`, `json()`, `text()`, `arrayBuffer()`, `blob()`, `image()` | Resolves paths relative to the configured asset base |
| Save | `get()`, `set()`, `remove()`, `keys()`, `clear()` | Namespaced by game ID and schema version |
| Audio | `unlock()`, `decode()`, `play()`, `registerCue()`, `playCue()`, `inspectCue()`, `setListener()`, `updateListenerFromCamera()`, `setOcclusionProbe()`, `updateOcclusion()`, `registerSnapshot()`, `applySnapshot()`, `clearSnapshot()`, `setBusVolume()`, `duckBus()`, `setVolume()`, `setMuted()`, `activeCount`, `dispose()` | Lazy AudioContext; master `DynamicsCompressorNode` limiter across `sfx`/`spatial`/`music`/`ambience` buses; 3D HRTF & 2D stereo panning with `handle.setPosition()` and low-pass acoustic occlusion; PCM silence trimming for gapless MP3 loops & zero-latency one-shots; 2-4 variant anti-repeat cues with loudness/duration alignment |
| Diagnostics | `recordFrame()`, `reportError()`, `snapshot()`, `dispose()` | Call `recordFrame()` from the game's existing RAF |

## Optional Host protocol

The current Host adapter implements `webasset-html-game/v1`. It validates origin, iframe source, protocol version, game ID, and session ID. Standalone mode remains disconnected and must not block gameplay.

The game-side bridge can announce `game:hello`, `game:ready`, `game:error`, `game:metrics`, and `game:state`; a compatible parent may send `host:hello`, `host:focus`, `host:resize`, and `host:visibility`.

The Host bridge is an optional integration, not a requirement for running HGame games. Never use wildcard origins. A parent must establish its session before navigating the iframe and stop that session when the game is unloaded.

## Integration rule

Integrate platform services one at a time. Do not move game state, combat, AI, physics authority, renderer objects, update loops, or game-specific save formats into the shared platform layer.
