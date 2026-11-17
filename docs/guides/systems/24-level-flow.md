# Level preloading and scene transitions

Use `createLevelFlow` when a game switches between levels built with `mountLevel`. The flow prepares candidate scenes on the existing `SceneManager` and keeps the current scene active during loading. Give each route a level definition or an asset-relative JSON path and optional groups from `assets/catalog.json`.

```js
import { createAssetCatalog } from '../vendor/hgame/platform/asset-catalog.js';
import { createLevelFlow } from '../vendor/hgame/world/level-flow.js';

const loader = app.platform.assets;
const catalog = createAssetCatalog(await loader.json('catalog.json'), { loader });
const levels = createLevelFlow({
  scenes: app.scenes,
  prefabs,
  assets: loader,
  catalog,
  routes: {
    town: { level: 'levels/town.json', assetGroups: ['shared', 'town'] },
    arena: { level: 'levels/arena.json', assetGroups: ['shared', 'arena'] },
  },
  async prepare({ id, scene, level, assets }, signal, deferRelease) {
    // Game-owned rendering or model preparation belongs here.
    await preparePresentation({ id, scene, level, assets }, signal, deferRelease);
  },
});

await levels.go('town');
app.start();
await levels.prefetch('arena');
const { session, cleanupErrors } = await levels.go('arena', { entrance: 'west' });
```

Use an optional `createScene(name, id)` factory to provide scene hooks. Return a fresh inactive scene using the supplied name. `prepare` runs before activation and can register cleanup callbacks with `deferRelease`. These callbacks run in reverse registration order after scene destruction. Register provider cleanup as soon as a resource has an owner. The flow acquires catalog groups before `prepare` and releases them after the game's callbacks. Catalog groups load images, data and audio bytes. Model entries provide URLs, which can be loaded by the game-owned model provider during `prepare`.

`prefetch(id)` and `go(id)` reuse the same candidate for an ID. `cancel()` cancels pending navigation and `discard(id)` drops an unused prefetch. A newer navigation supersedes an older pending one. The abort signal reaches the candidate's fetches and preparation callback. A prepare callback should settle promptly after cancellation so its resources can be safely released.

The previous scene stays current through the candidate's activation and `enter` hook. Keep those hooks scoped to the candidate. Once published, the new scene remains current if the previous scene reports a cleanup error. `go()` returns those errors in `cleanupErrors`. A loading or activation failure rejects the promise. `getCurrent()` returns the scene session currently owned by the flow. An already-registered scene that the flow did not create stays under the caller's ownership.

Use `await levels.dispose()` to release the flow and its pending scenes. Application disposal also starts this cleanup and reports any asynchronous errors through `onCleanupError` or the console. The game owns the catalog and may share it with other scenes or flows. Dispose it after the last consumer. For command-driven UI, start the application after the first navigation and let the normal UI dispatch path present subsequent scene state.

In catalog-only releases, list route JSON files in `assets/catalog.json` as data entries when their paths are used as strings in routes. Register model sidecars in the catalog so the release ships the files requested by the loader.
