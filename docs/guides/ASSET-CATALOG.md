# Asset IDs, scene scopes and release files

Use `assets/catalog.json` as the mapping from game-facing IDs to shipped files. Keep `assets.manifest.json` for hashes and CAS synchronization. Preset projects include an empty catalog and initially include all runtime assets.

```json
{
  "schemaVersion": 1,
  "assets": {
    "hero.sprite": { "kind": "image", "path": "sprites/hero.webp" },
    "hero.model": { "kind": "model", "path": "models/hero.gltf", "files": ["models/hero.bin", "models/hero.png"] },
    "arena.rules": { "kind": "json", "path": "data/arena.json" },
    "arena.hit": { "kind": "audio", "path": "sfx/hit.ogg" }
  },
  "groups": { "arena": ["hero.sprite", "arena.rules", "arena.hit"] }
}
```

```js
import { createAssetCatalog } from '../vendor/hgame/platform/asset-catalog.js';

// The existing loader uses the project assets/ directory as its base.
const catalog = createAssetCatalog(await app.platform.assets.json('catalog.json'), {
  loader: app.platform.assets,
});
const arenaAssets = catalog.openScope();
const assets = await arenaAssets.loadGroup('arena');
const heroImage = assets['hero.sprite'];
// Pass the project-relative path to the existing GLTF provider.
const heroModelPath = catalog.projectPath('hero.model');
```

Call `scope.dispose()` after removing the scene's consumers. The catalog shares active acquisitions by file and load kind. An image acquired by two scenes stays available until both release it. The final release drops WebGL2 textures and Canvas2D tint buffers for that image, then closes the decoded bitmap. When nothing holds a pending request, the catalog signals its cancellation and closes any bitmap that arrives afterward. On a failed group load, dispose the abandoned scope. `catalog.dispose()` releases all its scopes.

By default the catalog runs at most six distinct downloads and decodes at once across all its scopes. Supply `maxConcurrentLoads` when creating a catalog to tune that limit. Shared requests use one slot. Entries that only resolve a URL skip the queue. Disposing a scope immediately rejects its pending waits. Other scopes keep their shared requests, and queued assets with no remaining owners never start.

Pass asset groups to a level route so the level flow opens and releases each scene's scope. [Level flow guide](systems/24-level-flow.md)

`image` returns the loader's decoded image. `audio` and `bytes` return `ArrayBuffer`. `url` returns a resolved URL, as does `model` when no model provider is configured. Treat values shared between scopes as read-only. If an audio decoder transfers its input, pass a copy of the bytes. `files` includes sidecars the consuming loader requests itself.

### Scene-owned decoded models

Pass the installed `app.services.model3d` as `modelProvider` when creating the catalog. A scope's `load('hero.model')` then returns the decoded asset, including its source scene and animation clips. The scope holds the model and its shared textures until disposal. Route `assetGroups` use the same mechanism during prefetch and release it after the scene is removed. Keep the scope open while components or clones use its source.

```js
const catalog = createAssetCatalog(await app.platform.assets.json('catalog.json'), {
  loader: app.platform.assets,
  modelProvider: app.services.model3d,
});
const scope = catalog.openScope();
scene.onDispose(() => scope.dispose());
const asset = await scope.load('hero.model');
entity.addComponent(app.services.model3d.createComponent({ asset }));
```

For direct control, `model3d.acquire(catalog.projectPath('hero.model'), { signal })` resolves to an asset and a release function. Use this path form with the default `assets/` root. Configured catalogs resolve model URLs through their asset loader. The signal cancels the pending acquisition. The final pending owner signals the underlying loader to stop. The generated loader can abort the primary GLB or glTF request. Parsing or sidecar downloads already under way can settle afterward, and the provider discards unused results.

The provider bounds its cache with `maxResidentBytes`, default 64 MiB. It evicts idle scoped models in release order and retains geometry or textures shared with a live model. A zero budget releases idle scoped models immediately. Direct `load`, `instantiate`, and registered assets keep their provider lifetime. `model3d.residency` exposes geometry and texture byte estimates and an idle eviction hook. In generated 3D projects, set `renderMemoryBudgetBytes` in `src/presentation.json` with the adaptive quality feature enabled to include that estimate in the renderer budget.

The 3D starter accepts `"replacementAsset": "hero.model"` in a slot in `src/model-slots.json`. Use an unanimated GLB or glTF with catalog kind `model`. Declare any external buffers and textures in the entry's `files` array. When the `model3d` feature is enabled, replacement models share the same cache as scene scopes. The starter loads the catalog on demand and keeps existing slot IDs and collision data.

### Shipping catalog files

Run `npm run assets -- push "<game-dir>" --catalog` from the engine root, or `npm run assets -- push --catalog` from a generated game. This stores the catalog's primary and sidecar files in CAS and fills in their manifest entries. Existing manifest entries are retained by default. With `--exact`, the manifest is limited to catalog files.

Set `assetMode` to `catalog` in `hgame.project.json` to package the catalog's primary and sidecar files and retain files found by the existing entry tracer. Add URLs constructed at runtime to the catalog. This mode includes every declared catalog item, including items outside groups. Render providers and game code can continue using paths for assets found by the entry tracer. Missing catalog files are resolved from the existing CAS by their manifest hashes or reported with their exact asset-relative paths. An `all` release keeps the normal asset directory sweep.
