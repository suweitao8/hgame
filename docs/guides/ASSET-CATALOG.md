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

Call `scope.dispose()` after removing the scene's consumers. The catalog shares active acquisitions by file and load kind. An image acquired by two scenes stays available until both release it. When nothing holds a pending request, the catalog signals its cancellation and closes any bitmap that arrives afterward. On a failed group load, dispose the abandoned scope. `catalog.dispose()` releases all its scopes.

`image` returns the loader's decoded image. `audio` and `bytes` return `ArrayBuffer`. `model` and `url` return a resolved URL. The existing audio and model providers still own decoding and GPU resources. Treat values shared between scopes as read-only. If an audio decoder transfers its input, pass a copy of the bytes. `files` includes sidecars the consuming loader requests itself.

Set `assetMode` to `catalog` in `hgame.project.json` to package the catalog's primary and sidecar files and retain files found by the existing entry tracer. Add URLs constructed at runtime to the catalog. This mode includes every declared catalog item, including items outside groups. Render providers and game code can continue using paths for assets found by the entry tracer. Missing catalog files are resolved from the existing CAS by their manifest hashes or reported with their exact asset-relative paths. An `all` release keeps the normal asset directory sweep.
