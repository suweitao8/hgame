# HGame Procedural Modeling & Realistic PBR Material Standard (v1.0)

> **Authority & Repository Boundary**  
> **HGame** (`<hgame-repo>`) owns the specification, schema validators, geometry/material graph operators, shaders, and automated verification suite.  
> **WebAsset** (`<webasset-repo>/assets/procedural/`) acts purely as the centralized asset storage, catalog manifest, and live preview gallery (`http://127.0.0.1:4174/#materials` and `#models`).

---

## 1. Coordinate Systems, Units, and UV Routing Rules

- **Physical Metric Unit**: `1.0 unit = 1.0 meter` (`meta.unit: "meter"`).
- **Pivot & Grounding**: Right-handed Y-up; default architectural blocks and standalone props rest with bottom grounded at `min.y = 0` and centered horizontally (`x, z` centered).
- **UV Source Routing Contract** (never mix carelessly):

| Asset Category | Base Albedo / Normal / ORM UV Source | World Macro & Climate Overlay Source | Mandatory Rules |
| :--- | :--- | :--- | :--- |
| **Modular Architecture & Voxels** (`renderMode: "merge_chunk"`, boxes, walls, stairs, beams) | **Local Metric Box UV (`position`)** projected onto vertices along dominant face axis ([metric-uv.ts](../../src/modules/realistic-pcg/geometry/metric-uv.ts)) | `vPcgWorldPos` (`worldPosition`) | Non-uniform part/chunk transforms must recompute metric UVs (`recomputeMetricUVs` / `appendGeometry`) so 1m and 4m surfaces share exact texel density. |
| **Hard-Surface Kitbash Props** (`renderMode: "instanced_prop"`, containers, crates, pillars, furniture, railings) | **Local Metric Box UV (`position`)** baked into the prototype geometry | `vPcgWorldPos` + `aInstanceMeta.w` seed offset | Prevents texture swimming when instances rotate/stack. **Never apply non-uniform `scale` in `InstancedPropPool.spawn`**; resize dimensions via recipe `params` instead. |
| **Cylinders & Flanged Pipes** (`opCylinder`, `opPipeSegment`) | **Continuous Cylindrical Metric UV** (`u = arcLength`, `v = axisMeters`) | `vPcgWorldPos` | Do **not** overwrite with 6-axis Box UV in `mesh-recipe-eval.ts`; keep longitudinal seam on the rear side. |
| **Organic / Displaced Rocks & Terrain** (`displaced_rock`, heightfields) | **World-Space Triplanar (`vPcgWorldPos`)** on `MEDIUM`/`HIGH` tiers (`HG_USE_TRIPLANAR`) | `vPcgWorldPos` | Normal perturbation must align with world X/Y/Z Triplanar tangent axes (`vPcgWorldPos.zy / .xz / .xy`), never local `vPcgUv` `dFdx/dFdy` frames. Falls back to `vPcgUv` on `LOW`. |

---

## 2. Dual-Track Modeling Architecture

All procedural `.hmesh.json` recipes must declare `meta.renderMode`:

1. **Track A — Bare Array Construction & Chunk Merging (`merge_chunk`)**
   - Engine builders: [ProceduralMeshBuilder](../../src/modules/realistic-pcg/geometry/mesh-builder.ts), [voxel-chunk-mesher.ts](../../src/modules/realistic-pcg/geometry/voxel-chunk-mesher.ts).
   - Features: Auto CCW winding verification, hidden-face culling + 4-neighbor vertex AO, `appendGeometry` normal matrix inverse-transpose & metric UV re-projection, adaptive `Uint16Array` (`<= 65535` verts) / `Uint32Array` index selection.
   - Multi-material support: Single merged `BufferGeometry` via per-vertex `aMaterialId` attribute (`0..15` into `Texture2DArray`).
2. **Track B — Parametric Kitbashing + Pooled Instancing (`instanced_prop`)**
   - Engine pool: [InstancedPropPool](../../src/modules/realistic-pcg/geometry/instanced-prop-pool.ts).
   - Features: Buckets by `(meshId, params, materialOverrides)`, per-instance `aInstanceMeta` (`vec4(tintJitter, wearBias, wetnessBias, instSeed)`), 2x capacity growth, `O(1)` Swap-and-Pop `remove()`.
   - Shadow budget rule: Low ground-hugging scatter (e.g., `weathered_rock`) should disable `castShadow` to preserve shadow-pass DrawCall budgets.
3. **Standalone / Skeletal (`standalone`)**
   - Skinned or hero assets built with explicit armature/normalization (`TripoNormalizer` / `dummy-humanoid.ts`), strictly outside static batch pools.

### Topology & Collision Gates
- Every procedural geometry must pass [auditGeometry](../../src/modules/realistic-pcg/geometry/geometry-audit.ts): `0` degenerate triangles (`area >= 1e-7`), normalized vertex normals (`|n| - 1 < 0.02`), `0` inverted-winding triangles, finite UVs.
- **Canonical AI Character Pipeline (`character-pack`)**: Every AI-generated / Hunyuan / Trellis high-poly character model must go through the single locked flow:
  `npm run process:model3d -- character-pack --input <raw_high.glb> [--character-id <slug> --upload --qa-dir <qa>]` (or `--from-webasset --character-id <slug> --upload`).
  0. **Source T-Pose Turnaround Hand Rule**: Because runtime character rigs bind a single `hand_l`/`hand_r` bone without per-finger animation and characters hold attached weapons (e.g., swords), humanoid & fingered characters must use a **relaxed semi-clenched weapon-grip fist (`轻微握拳 / 虚握剑柄姿态`, fingers naturally curled leaving a subtle empty grip hollow, knuckles up, zero weapon drawn)** in 2:1 (`front + left`) T-pose turnaround sheets (with clean margin away from the center vertical seam). Rounded non-fingered animal paws (e.g. cats) keep natural paw shape without forcing fingers.
  1. `preRemesh`: Spatial vertex weld (`1e-4`), open-hole fill (`holes_fill`), loose vertex/edge cleanup, and thin-whisker/needle spike relaxation;
  2. Clean High Master (`--preset high`, `16,000` quads, `2048px` PBR) + Clean T5 Game Rig (`--preset low` NPC `<= 6,000` tris / `<= 7,500` verts, `--preset hero` Hero `<= 9,000` tris / `<= 11,000` verts, embedded `LOD1 ~2,200` tris, `1024px` PBR, auto `23(+3)` humanoid + tail/cape `Run` rig; see [ASSET-MODEL-LOD-SPEC.md](./ASSET-MODEL-LOD-SPEC.md));
  3. Post-voxel & post-remesh zero-debris gate (`assertCleanTopology`): fails closed unless **both** High & Low achieve `looseVerts === 0`, `looseEdges === 0`, `boundaryEdges === 0`, `nonManifoldEdges === 0`, `zeroAreaFaces === 0`, `spatialIslands === 1`, and `tinyIslands === 0`.
- Never feed high-detail render geometry directly to Rapier colliders; declare `meta.collider: "auto_boxes"` or use greedy voxel AABB merging (`collider-exporter.ts`).

---

## 3. Realistic PBR Material Specification (`.hmat.json`)

### `Texture2DArray` Channel Packing (Max 16 Layers)
- `uAlbedoArray`: `RGB` = Linear Albedo (baked shadows/lighting **strictly forbidden**), `A` = Height `[0..1]`
- `uNormalArray`: `RGB` = Tangent-Space Normal (derived via `height_to_normal`)
- `uOrmArray`: `R` = Texture AO, `G` = Roughness, `B` = Metalness, `A` = Porosity (`[0..1]`, controls rain darkening & roughness drop)

### Vertex Metadata (`color`) & Instance Metadata (`aInstanceMeta`)
- `vertex color.rgb`: `R` = Geometry Corner AO `[0.2..1.0]`, `G` = Edge Wear `[0..1]`, `B` = Local Wetness / Dirt Bias `[0..1]`.
- `aInstanceMeta.xyzw`: `x` = `tintJitter [-0.35..0.35]`, `y` = `wearBias`, `z` = `wetnessBias`, `w` = `instSeed` (offsets world macro noise).

### Physical Realism & Security Guardrails
1. **Zero `eval` / `new Function`**: Material expressions must evaluate strictly via the safe expression parser and deterministic DAG nodes ([schema-validator.ts](../../src/modules/realistic-pcg/recipes/schema-validator.ts), [material-graph-eval.ts](../../src/modules/realistic-pcg/recipes/material-graph-eval.ts)).
2. **Non-Metallic Linear Albedo Range**: When `metalness < 0.2`, mean linear luminance must remain within `[0.04, 0.85]`.
3. **Microsurface Roughness Contrast**: Baked material roughness range must exceed `0.05` (`[0.04, 0.98]`), avoiding flat plastic single-value surfaces.
4. **Seamless Periodic Tiling**: All noise/pattern kernels wrap cleanly at `U` and `V` tile boundaries (`tileMeters > 0`).

---

## 4. Verification & Sync Workflow (HGame -> WebAsset)

Whenever HGame updates `src/modules/realistic-pcg/`:
1. `npm run build:realistic-pcg` (strict TypeScript check + demo bundle `demos/lookdev-realistic-3d/app.js`).
2. Sync browser bundle to WebAsset when serving gallery previews: `<webasset-repo>/public/js/realistic-pcg.js`.
3. `npm run validate:procedural` (validates every `.hmat.json`, `.hmesh.json`, DAG, seamless tiling, and `auditGeometry`).
4. `node --test tests/realistic-pcg.test.mjs` and `npm test` (deterministic CPU parity, pool stress, zero dangling async handles).
5. `npm run test:browser:realistic-pcg` (WebGL2 GPU-first + CPU fallback parity, DrawCall budget, biome switching, screenshot review, zero leaked GPU buffers/textures).
