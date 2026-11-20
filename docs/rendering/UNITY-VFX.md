# Unity particle materials in HGame

Use Unity URP Particle System references to author HGame effects in `.vfx.json`. The converter reads serialized settings from a project supplied by the caller. HGame uses its own WebGL shaders and runtime recipe APIs.

```sh
node scripts/import-unity-vfx.mjs --unity-root <unity-assets> --prefab <effect.prefab> --out <effect.vfx.json> --manifest <effect-assets.json>
```

| Unity material setting | HGame recipe and rendering behavior |
| --- | --- |
| URP `_Surface`, legacy `_Mode` | `_Surface` determines the modern material type when present. Legacy opaque and cutout modes map to `opaque` for mesh layers. Opaque meshes write depth and output full coverage above the clip threshold. |
| `_BaseColor`, `_TintColor`, `_Color` | The importer uses the URP base color or legacy tint and combines its RGBA with the particle color curve. Material RGB above 1 is carried as an HDR multiplier. |
| `_BaseMap`, `_MainTex` | `sprite` names a region in the atlas. Register the region with `vfx.setAtlas(texture, regions)` before playing the recipe. Three mesh layers read that region as well as billboard layers. Mesh layers without a resolved region use the registered mesh's own map when available. |
| `_AlphaClip`, `_Cutoff` | `alphaCutoff` discards fragments below the threshold. Three applies the threshold before camera or soft depth fading. Transparent Three and WebGL2 2D layers retain fractional alpha above the threshold. Canvas2D uses its normal compositing path. |
| Alpha, Additive, Multiply, Premultiply | `blend` selects the corresponding channel. Premultiply consumes RGB already associated with alpha in the source, following the Unity material convention. Multiply scales destination RGB using source alpha and keeps destination alpha. |

`node tests/browser-vfx-material.mjs --chrome <chromium-path>` checks the three shader paths against fixed pixel values and exercises a transparent mesh atlas region. `vfx:score` reports feature coverage for the importer and runtime. Visual equivalence for a particular effect needs the original shader inputs and matching render conditions.

Broader Unity material alignment includes render-state handling for instanced opaque particles, depth comparisons and writes, texture slot and color-space conventions, and a documented mapping for commonly used Shader Graph inputs. These capabilities are tracked as engine work.
