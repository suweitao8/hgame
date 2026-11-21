# Unity particle materials in HGame

Use Unity URP Particle System references to author HGame effects in `.vfx.json`. The converter reads serialized settings from a project supplied by the caller. HGame uses its own WebGL shaders and runtime recipe APIs.

```sh
node scripts/import-unity-vfx.mjs --unity-root <unity-assets> --prefab <effect.prefab> --out <effect.vfx.json> --manifest <effect-assets.json>
```

| Unity material setting | HGame recipe and rendering behavior |
| --- | --- |
| URP `_Surface`, legacy `_Mode` | `_Surface` determines the modern material type when present. Legacy opaque and cutout modes map to `opaque`. In Three, mesh and atlas particles use the opaque queue, disable blending, and write depth by default. |
| `_ZTest` | `depthTest` accepts `disabled`, `never`, `less`, `equal`, `less-equal` (default), `greater`, `not-equal`, `greater-equal`, and `always`. These map to the corresponding Three depth states. |
| `_ZWrite` | `depthWrite` accepts `true` or `false` and overrides the surface default. With `depthTest: "disabled"`, WebGL skips both comparison and depth writes. Use `"always"` and `depthWrite: true` to write depth unconditionally. |
| `_BaseColor`, `_TintColor`, `_Color` | The importer uses the URP base color or legacy tint and combines its RGBA with the particle color curve. Material RGB above 1 is carried as an HDR multiplier. |
| `_BaseMap`, `_MainTex` | `sprite` names a region in the atlas. Register the region with `vfx.setAtlas(texture, regions)` before playing the recipe. Three mesh layers read that region as well as billboard layers. Mesh layers without a resolved region use the registered mesh's own map when available. |
| Unassigned opaque base map | The importer sets `useTexture: false`. Three mesh and atlas particles use a white sample, so an unassigned material cannot pick up unrelated atlas regions. |
| `_AlphaClip`, `_Cutoff` | `alphaCutoff` discards fragments below the threshold. Three applies the threshold before camera or soft depth fading. Transparent Three and WebGL2 2D layers retain fractional alpha above the threshold. Canvas2D uses its normal compositing path. |
| `_SoftParticlesEnabled` | `softParticles: false` opts a Three atlas layer out of the shared scene-depth fade. `true` uses the bound depth texture and global `softFade` distance when available. |
| Alpha, Additive, Multiply, Premultiply | `blend` selects the corresponding channel. Premultiply consumes RGB already associated with alpha in the source, following the Unity material convention. Multiply scales destination RGB using source alpha and keeps destination alpha. |

The Three atlas pool creates one instanced batch per blend, surface and depth state on first use. Each batch inherits the corresponding blend pool's ring capacity, and equal states share it. Idle batches keep their allocations for reuse and submit zero instances. `renderStateTotal` reports emissions into those batches. To move or kill a returned slot directly, pass the same render-state options to `updateSlot` or `killSlot`. Canvas2D and native WebGL2 2D continue to composite in their flat draw order.

`node tests/browser-vfx-material.mjs --chrome <chromium-path>` checks pixel values for blending, cutout, depth, and texture-sheet frames. `vfx:score` reports feature coverage for the importer and runtime. Visual equivalence for a particular effect needs the original shader inputs and matching render conditions.

## Texture Sheet Animation

Unity Grid mode maps to `flipbook` on mesh and billboard layers. Frames run left to right, then top to bottom. `cols` and `rows` set the grid size, and `cycles` controls the number of repetitions over the particle lifetime. In a single row, the importer emits a fixed `rowIndex` or `rowMode: "random"`. Mesh Index imports use row zero for the converted renderer's single mesh. Modern URP `_FlipbookBlending` takes priority over legacy `_FlipbookMode`.

```json
{
  "schemaVersion": 1,
  "id": "mesh_blast",
  "duration": 0.6,
  "layers": [{
    "kind": "mesh",
    "mesh": "quad",
    "size": 1.2,
    "life": 0.6,
    "flipbook": { "region": "blast", "cols": 4, "rows": 2, "rowIndex": 1, "blend": true },
    "bursts": [{ "time": 0, "count": 1 }]
  }]
}
```

Register `blast` with `vfx.setAtlas(texture, regions)`. A mesh with an unresolved atlas region can use its own registered texture with the mesh's UV orientation. The GPU paths blend adjacent frames when `blend` is enabled. Prewarmed mesh particles advance motion and frame age together, using up to 32 motion steps per particle at spawn. The importer currently maps linear lifetime playback. Unity's Speed and FPS modes, start-frame offsets, custom timing curves, sprite lists, and additional UV channels need further mapping. [Unity Texture Sheet Animation](https://docs.unity.com/en-us/engine/6000.6/manual/visual-effects/particle-systems/particle-system-modules/part-sys-tex-sheet-anim-module)

For fullscreen Shader Graph references, use the [GLSL3 authoring entry point](UNITY-SHADER-GRAPH.md). Unity material alignment also includes further texture slot and scene inputs for mesh and particle shaders.
