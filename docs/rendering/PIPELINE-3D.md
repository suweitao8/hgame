# HGame 3D Rendering Pipeline

HGame keeps 3D rendering modular and strictly opt-in. Core runtime modules never import `three` directly; projects receive Three.js via explicit dependency injection (`{ THREE }`), keeping 2D and UI profiles completely free of Three.js overhead.

## Module Overview

| Module | Role | Key Exports |
|---|---|---|
| `integrations/three.js` | Scene adapter, shadow/tone/quality setup, frustum/occlusion sync, secondary view pass, picking, mesh components | `createThreeAdapter`, `createThreeMeshComponent` |
| `integrations/camera3d.js` | Collision-probed 3D spring arm with asymmetric recovery, Third-Person / First-Person / Top-Down rig, quadratic trauma shake, recoil springs, priority FOV blending | `createSpringArm3D`, `createCameraRig3D` |
| `integrations/culling3d.js` | Gribb-Hartmann frustum culling, convex-cone software AABB occlusion, WebGL2 async hardware occlusion query pool, O(1) GPU instanced batch pool | `createFrustumCuller3D`, `createOcclusionCuller3D`, `createHardwareOcclusionPool`, `createSceneCuller3D`, `createInstancedBatch3D` |
| `integrations/quality3d.js` | Unified 2D/3D `low`/`medium`/`high` presets (`ultra` + `auto` for 3D), hardware heuristics, dynamic resolution scaling | `QUALITY_TIERS`, `QUALITY2D_PRESETS`, `QUALITY3D_PRESETS`, `resolveQualityPreset`, `chooseInitial3dQuality`, `createAdaptiveQualityController` |
| `integrations/sky3d.js` | Procedural atmospheric sky dome (`setLinearOutput`), PMREM environment baking, texel-snapped directional shadows, pooled dynamic flash lights | `SKY3D_PRESETS`, `createProceduralSky3D`, `bakeEnvironment`, `fitDirectionalShadowFrustum`, `createLightPool3D` |
| `integrations/post3d.js` | WebGL2 multi-pass HDR post-processing (SSAO, half-res SSGI + SSR, contact shadows, volumetric sun shafts, Karis bloom, GPU eye adaptation, `ueFilmic`/ACES/AgX tone mapping, CIE white balance, ASC-CDL grading, volumes, FXAA + sharpen) with forward fallback | `inspectWebGLCapabilities`, `refineQualityWithContext`, `computeWhiteBalanceRGB`, `evaluateFilmicCurveRGB`, `stepEyeAdaptation`, `createPostProcessVolumeStack`, `createPostPipeline3D` |
| `integrations/lighting3d.js` | Clustered many-light system (`1..1024` point/spot/transient lights via `16×8×16` frustum clusters & stochastic IGN sampling) and `SH L1` irradiance probe volume | `computeStochasticLightSample`, `createMegaLights3D`, `createIrradianceProbeVolume3D` |
| `integrations/world-aligned-material.js` | Planar/triplanar world-space PBR materials, Geometric Specular AA, anisotropy control, floating-origin UV offset shifting | `applyGeometricSpecularAA`, `createWorldAlignedMaterial`, `createWorldMaterialPalette` |
| `integrations/model3d.js` | Safe GLTF/GLB asset registry/loader, skeleton-safe cloning, `AnimationMixer` LOD, zero-miss `AnimNotify`, `createAnimationBudgetAllocator` & shadow cutoff, VAT GPU-instanced animated crowd | `cloneObject3DWithSkins`, `createModel3DProvider`, `createAnimationBudgetAllocator`, `createInstancedCrowd3D` |
| `world/open-world.js` | Distance/velocity-predictive cell streaming with hysteresis, HLOD `InstancedMesh` proxy batches, and `Float64` floating-origin rebasing | `createWorldPartition`, `createHLODProxyGroup3D`, `createFloatingOrigin` |

## Quality Calibration & Dynamic Scaling

`QUALITY_TIERS` (`low`, `medium`, `high`) provides unified Low / Medium / High presets across 2D (`QUALITY2D_PRESETS`) and 3D (`QUALITY3D_PRESETS`, which also preserves `ultra` and `auto`). Calling `adapter.setQuality(mode)` dynamically updates DPR caps, directional shadow enablement & `shadowMapSize`, `drawDistance`, `post3d` (`fxaa`, `sharpen`, `ssao`), and `anisotropy` on registered `MaterialPalette` instances:
- Initial tier selection combines `chooseInitial3dQuality` with optional WebGL capability probing (`inspectWebGLCapabilities` and `refineQualityWithContext`, enabled on `createThreeAdapter` when `quality3d.calibrateGpu: true`).
- MSAA sample counts (`clampedMsaaSamples`) are clamped to `gl.MAX_SAMPLES` on WebGL2 contexts.
- `createAdaptiveQualityController` computes the tier's capped pixel ratio from the CSS viewport, device pixel ratio, and pixel budget. Auto mode multiplies that capped ratio by its current resolution scale and starts at `maxScale`. When slow frames trigger a tier downgrade, the controller keeps the reduced scale until fast frames qualify it for recovery.
- The adapter uses the resulting physical size for both the canvas and post-processing targets. When size and preset change together, it rebuilds post targets once at the final dimensions.
- On WebGL context loss the post pipeline releases its targets and retains the latest size and preset. It allocates the targets once at the restored size. During ordinary resolution or preset changes, fixed-size auto-exposure targets retain their exposure history.

### Target and residency budget

Set `quality3d.memoryBudgetBytes` on `createThreeAdapter` to enable a soft budget for estimated render memory. Projects can also report resident assets and reclaim their unused cache entries.

```js
const quality3d = {
  mode: 'auto',
  memoryBudgetBytes: 96 * 1024 * 1024,
  residency: {
    readBytes: () => cache.residentBytes,
    trimIdle: (excessBytes) => cache.trimIdle(excessBytes),
  },
};
```

The adapter counts allocated post-process attachments across active views, shadow maps, the baked probe atlas, and project-reported asset bytes. Individual attachment estimates include color, depth, stencil, and multisample storage where present. Fixed-size attachments such as shadow maps and exposure targets are tracked separately from targets that shrink with resolution. These estimates cover the named allocations. Total device memory and driver overhead are outside their scope.

Auto mode releases inactive owned shadow targets and can call `trimIdle` synchronously before applying quality changes. If the same pressure persists, it retries a cache trim after 120 frames. When a smaller viewport can help, the controller scales resolution within the current tier before reducing effects. Frame-time recovery also considers the estimated memory cost and requires it to fit within 90% of the byte budget. Fixed modes report usage without changing quality.

Read `adapter.qualityController.state.memory` for the latest completed frame's `limitBytes`, `targetBytes`, `fixedTargetBytes`, `residentBytes`, and `overBudget` flag. A resolution or tier change triggered by that frame appears in the next observation.

## Frustum, Occlusion Culling & GPU Instancing (`culling3d.js`)

- `createSceneCuller3D` integrates per-frame Gribb-Hartmann 6-plane frustum + `maxDistance` tests with a 5-ray convex-cone software AABB occluder pass (`addOccluderAABB` / `setOccludersFromColliders`) and optional WebGL2 `ANY_SAMPLES_PASSED_CONSERVATIVE` async query pool (`createHardwareOcclusionPool` with `graceFrames`).
- `createInstancedBatch3D(THREE, { geometry, material, capacity, perInstanceColor })` provides `O(1)` slot `alloc`/`free` and compacts visible instances per frame against `culler.testSphere`. The batch owns the instance matrix and color buffers. Updates to transforms, colors and the visible slot order schedule bounded upload ranges for each buffer. An unchanged batch keeps its existing GPU data and still calls `onVisible` for every visible instance.
- Instance positions are batch-local; culling transforms them through the mesh's world matrix. Supply each `radius` (or batch `cullRadius`) in world units large enough to contain the scaled instance.
- `createInstancedCrowd3D` / `provider.createCrowd` bakes `SkinnedMesh` `AnimationClip` frames into an RGBA Float Vertex Animation Texture (`DataTexture`) and drives per-instance frame interpolation and `hitFlash` via GPU instancing in a single draw call. It schedules animation buffer uploads for changes in the packed visible rows.
- `createBoneVatCrowd3D` packs CPU-driven instances into 16-byte rows per LOD and schedules updates only for changed spans. Its `uploadedBytes` reports scheduled instance data and excludes allocation. Skinned LODs and distant impostors use the same packed animation and status format.
- Bone-VAT positions and `baseY` are local to `crowd.group`. Move, rotate or scale that group or its parents. CPU-driven crowds measure LOD distances and test visibility in world space. Far impostors face the render camera around the transformed crowd up axis. Texture-driven crowds use the same transform for rendering and assign LOD counts explicitly through `syncFromGpuSwarm`.
- CPU-driven Bone-VAT crowds default to `lodHysteresis: 0.1`. At a 25-unit threshold, an instance moving away switches at 27.5 units, and an instance moving closer switches below 22.5. A new instance uses the nominal threshold. Set `lodHysteresis: 0` for a single threshold. A chunk can still select a common LOD when its entire distance range yields the same result for every previous LOD. Custom swarm sources can expose `slotGeneration` to enable history across frames.
- After `ensureChunks()`, the native swarm exposes a read-only prefix of `occupiedChunkIds` with length `occupiedChunkCount`. IDs are ascending, preserving submission order when the renderer skips empty cells. Canvas2D, WebGL2D and Bone-VAT use this prefix when available.

## Sky, Shadows & Pooled Lighting (`sky3d.js`)

- `SKY3D_PRESETS`: `'day'`, `'goldenHour'`, `'overcast'`, `'dusk'`, and `'night'`.
- `createProceduralSky3D(THREE, { preset })` builds a background sky dome (`renderOrder = -1000`) and exposes `setPreset`, `setLinearOutput(linear)`, `linearOutput`, `update(timeSec, cameraPos)`, `sunDirection`, and `dispose()`. Enabling `setLinearOutput(true)` (automatically managed by `createThreeAdapter` via `setSky` when HDR `post3d` is active and temporarily during `bakeEnvironment`) skips duplicate sky exposure and inline tone-mapping/sRGB encoding.
- `bakeEnvironment(THREE, renderer, sky)` generates a PMREM environment map from the procedural sky.
- `fitDirectionalShadowFrustum(THREE, light, bounds, { snapToTexels, sunDirection })` fits an orthographic shadow frustum tightly around level bounds and snaps texels to suppress shadow shimmer during camera motion.
- `createLightPool3D(THREE, scene, { size })` pre-allocates a fixed pool of point lights in the scene graph and reuses them via `flash(...)` / `update(dt)` without runtime shader recompilation caused by adding/removing scene lights.

## Clustered Many-Light & Irradiance Probes (`lighting3d.js`)

- `createMegaLights3D(THREE, { maxLights, maxClusteredLights, defaultSamples, ... })`: manages `1..1024` dynamic point, spot, and transient flash lights by packing light data into a float `DataTexture` and partitioning camera view frustums into a `16×8×16` logarithmic-depth cluster texture (`128×128`), selecting lights with stratified Interleaved Gradient Noise stochastic importance sampling (`computeStochasticLightSample`) and composing directly into PBR materials via `onBeforeCompile` without adding scene lights or triggering shader recompilation.
- `createIrradianceProbeVolume3D(THREE, { bounds, resolution, ... })`: maintains an `SH L1` (4-band RGB) 3D irradiance lattice with analytic hemisphere/bounce baking, CPU trilinear sampling, and composable `onBeforeCompile` shader injection.

### Baked world irradiance

Use `adapter.setIrradianceProbeGrid(scene, data)` with a versioned JSON asset. The adapter registers one grid as a Three scene light, so standard lit materials, including glTF meshes, receive the diffuse irradiance in both forward and HDR rendering. All views of the scene share the atlas. A replacement, `setIrradianceProbeGrid(scene, null)`, scene disposal or adapter disposal frees the owned texture.

```js
const response = await fetch(new URL('./lighting/room-probes.json', import.meta.url));
if (!response.ok) throw new Error(`Probe asset returned ${response.status}`);
adapter.setIrradianceProbeGrid(scene, await response.json());
```

Include `schemaVersion: 1`, world-space `min` and `max` corners, `resolution: [nx, ny, nz]`, and `coefficients`. Probes sit at the center of their cells. Flatten the grid in X, Y, Z order with X changing fastest. Each probe stores nine linear RGB SH radiance coefficients in Three's L2 order, for 27 values per probe. Keep globally applied sky and environment illumination separate when authoring local bounce data. Optional `intensity` scales the baked term. The adapter packs the coefficients into a padded, linearly filtered RGBA16F 3D texture. Unsupported WebGL backends or a grid exceeding texture dimensions return `null` and keep existing lighting and screen-space effects. [Three WebGL probe format](https://threejs.org/docs/pages/LightProbeGridWebGL.html)

In the HDR path, SSGI diffuse strength falls toward the interior of the active grid by up to `min(intensity, 1)`. The outer half-cell keeps the full screen-space term, and the next half-cell fades it down. This overlap preserves a screen-space contribution where a normal map can push the native probe sample beyond the grid edge. The native baked term retains its own bounds. SSR remains independent, and lower presets keep the baked term with SSGI disabled. Grid changes reset the affected view's GI and temporal history.

## WebGL2 Post-Processing & Viewmodel Pass (`post3d.js`)

When running on a WebGL2 context supporting floating-point color buffers, `createPostPipeline3D` orchestrates:
1. **Main HDR + Depth pass**: renders the main scene to a HalfFloat HDR target (with MSAA resolved on WebGL2) plus attached `DepthTexture`.
2. **Half-resolution GI, SSR & lighting effects**: on presets enabling half-res targets, executes half-res SSAO, half-res HDR SSGI + binary-refined SSR with edge-aware normal reconstruction and separable RGBA bilateral blur, plus directional shadow-map volumetric shafts.
   Setting SSAO, volumetric lighting, or bloom intensity to zero skips its GPU passes. Changing GI, SSR, FXAA, or sharpening with `setState` updates only the required targets, so an active eye-adaptation pass keeps its exposure history.
   Volumetric sun shafts use the directional light's shadow matrix and depth texture, including comparison sampling for Three.js PCF shadows. The pass requires an enabled shadow map and a light that casts shadows.
3. **4-mip Bloom & GPU Eye Adaptation pyramids**: progressive downsampling (with Karis firefly suppression) and upsampling across 4 bloom mip levels, plus a GPU luminance downsample pyramid driving automatic exposure (`stepEyeAdaptation`).
4. **Contact Shadows, Composite & Filmic Color Pipeline**: full-res 8-step screen-space contact shadows, chromatic aberration, CIE Planckian white balance (`computeWhiteBalanceRGB`), ASC-CDL lift/gamma/gain color grading, parametric S-curve `ueFilmic` / `aces` / `agx` / `none` tone mapping (`evaluateFilmicCurveChannel`, `evaluateFilmicCurveRGB`), film grain, and localized/priority-blended `createPostProcessVolumeStack` overrides alongside gameplay state uniforms (`post.setState(...)`).
5. **LDR FXAA, edge sharpen & IGN dither**: final screen-space anti-aliasing and banding mitigation into the default framebuffer.
6. **Secondary View Pass (`viewCamera` / `viewScene`)**: optional overlay/viewmodel pass rendered after clearing depth inside `depthRange(0, 0.05)` and restoring `depthRange(0, 1)`.

Non-WebGL2 or constrained contexts automatically degrade cleanly to a standard forward render pass while preserving single exposure ownership and the secondary `depthRange` overlay pass.

When the Three adapter has HDR post-processing enabled, `setViews()` sends every pane through the same world and post-processing stages as the primary camera. Targets are sized to each physical pane. Each pane keeps its own eye adaptation and GI/reflection history while its camera and slot identity match. Pane output is clipped to its own rectangle and post volumes are evaluated at its camera position. Changes made through the adapter's public `postPipeline` supply shared settings. Its idle primary targets shrink to 1×1 during split view, and its full-size targets return when split view ends. Forward-only rendering remains available when HDR is disabled or unsupported.

### Pass inputs, outputs and target lifetime

The world draw supplies HDR color and optional sampleable depth. The pipeline resolves depth only when an active stage reads it. Each built-in and custom fullscreen pass declares the required and optional texture uniforms it samples and whether it writes color, color and depth, or the framebuffer. The draw path checks those bindings before issuing the pass and rejects sampling an output attachment. MSAA resolve, shadow-map availability, quality tiers and missing sampleable depth determine which stages feed those bindings.

Each view owns its HDR intermediates. A stage releases a scratch target after its last reader, allowing another stage with matching dimensions and attachment requirements to reuse it. For example, TAA consumes the world-lighting intermediate before the custom HDR chain can write over it. Consecutive custom stages retain the preceding color until the next draw completes. The pool also checks auxiliary shader uniforms before reusing a target in a custom pass. The first-person layer keeps a separate depth attachment when required. Unused intermediates are disposed after the frame. Resize, context loss and view removal release the affected targets. Exposure, GI and TAA history are owned by their stages and retain their explicit reset rules.

Dependency-ordered scheduling is exposed via `compileRenderGraph` / `executeRenderGraph` in `integrations/post3d.js` and `pipeline.getRenderGraphPlan()`. Passes declare `reads`, `optionalReads`, `writes`, and `transientSpecs`; the compiler derives topological execution order, `[firstWrite, lastRead]` transient lifetimes, slot aliasing, and automatic last-use target reclamation.

### Custom HDR effects

Configure `post3d.passes` or replace the chain through `adapter.postPipeline.setPasses(passes)`. Effects run in array order. Each descriptor names its previous-color texture uniform and, optionally, its original world-depth texture uniform. The chain runs after the first-person layer and before exposure metering, bloom and tone mapping. Built-in lighting that has yet to be composited remains in the subsequent HDR composite.

```js
adapter.postPipeline.setPasses([
  { id: 'heat-haze', material: heatHazeShader, inputs: { color: 'tColor', depth: 'tWorldDepth' } },
  { id: 'tint', material: tintShader, inputs: { color: 'tColor' } },
]);
```

Use an opaque fullscreen shader material that writes linear color across the output. The pipeline supplies `position` and `uv` attributes and restores the input uniforms after each draw. The standard chain alternates between two reusable pane-sized scratch targets. The game owns its materials. `enabled: false` skips an effect, as does a missing depth attachment when the effect requires depth. In forward fallback the engine skips the HDR chain.

Use [`createFullscreenShaderPass`](UNITY-SHADER-GRAPH.md) for a GLSL3 authoring entry point with screen coordinates, chained HDR color, and world-depth helpers. Custom descriptors can also bind `inputs.depthView` with `inverseProjection`, `clipDepthMode`, and `far` uniform names alongside `inputs.depth`. The clip depth modes are `0` for `[-1, 1]`, `1` for `[0, 1]`, and `2` for reversed `[0, 1]`.

### Temporal antialiasing

Set `post3d: { temporalAA: true }` on the Three adapter or call `adapter.postPipeline.setState({ temporalAA: true })`. Each view jitters the world camera and accumulates HDR color from depth-validated history. The resolve runs before the first-person layer, custom HDR effects, exposure, bloom and tone mapping.

On half-float HDR targets, the `temporal-motion` draw records screen displacement and preceding view depth for moved or newly visible opaque rigid meshes and CPU `InstancedMesh` instances. The draw uses the same jitter as the world and writes only where it matches the visible world depth. The resolve checks the previous depth at the displaced pixel and excludes new geometry without valid history. Static views skip the motion draw. Mark CPU instance matrices with `instanceMatrix.needsUpdate` when editing them, as in normal Three rendering. Camera reprojection covers shader-driven deformation, skinning, morph targets, alpha-masked or blended materials and unavailable motion buffers. Set `temporalMotion: false` to select camera-only reprojection. Temporal upscaling remains future work.

Each enabled view owns two color and depth targets sized to its render buffer. Camera or world switches, projection changes, large camera movement, pauses and target resizes invalidate accumulation. Call `adapter.postPipeline.resetTemporalHistory()` for an explicit cut across the primary camera and split views. When the world resolves with TAA, the final pass retains FXAA for first-person content if configured. XR, array cameras and unavailable scene depth take the configured FXAA path.

### Frame and pass diagnostics

Enable `diagnostics3d: true` on `createThreeAdapter` and read `adapter.getRenderDiagnostics()` after rendering. The snapshot reports full-frame CPU submission, draw calls, triangles, the ordered draws with their view indices, and the estimated payload of the offscreen targets in rendered views. The `world` draw includes Three.js shadow work. Target bytes estimate color, depth and MSAA attachments. The canvas, driver overhead, and textures and buffers owned by the game are outside that estimate.

GPU diagnostics use a bounded WebGL timer query pool. Sampling alternates between a full frame and one rotating pass. A resolved sample includes its original frame and pass index, so results that arrive later can be matched to their draw. `disjoint`, `expired`, and `invalid` samples have a null time. Forward rendering and devices without timer queries still report CPU and draw counters.

The opt-in `uploads` counters cover CPU buffer and texture payloads submitted by the frame and each draw. `uploadMethods` lists the WebGL methods observed on that context, and `unmeasuredCalls` indicates when a payload size was unavailable. Buffer subranges use element offsets and lengths. Uncompressed texture bytes use the requested pixel rectangle and format, with row padding and driver storage outside the count. Compressed uploads use the submitted source range. Commands with no client payload, such as empty allocation and GPU buffer offsets, contribute zero bytes. Uploads issued outside the adapter frame are outside the capture. See the [WebGL 2 transfer signatures](https://registry.khronos.org/webgl/specs/latest/2.0/).

### Compressed model textures

The generated 3D loader handles `KHR_texture_basisu` for external KTX2 files and KTX2 images embedded in GLB buffer views. Plain models do not fetch the KTX2 loader or its WASM. The first KTX2 request uses the current renderer's format support and starts at most two Basis workers when transcoding is required. Concurrent loads may share decoded bytes, with each model owning its texture descriptor and sampler settings.

Provide a standard glTF image when Basis is optional. That image can load when Worker or WebAssembly support is absent or when the compressed image cannot be decoded. A failed required Basis texture rejects the model load. Transient transcoder initialization failures can be retried. On application disposal, the starter rejects new model loads, drains started work and releases the workers and their URL. Started network requests can finish during the drain.

Standalone releases include the pinned Three r187 KTX2 loader, Basis JS and WASM, helper modules and their license notices. [Three KTX2 loader](https://raw.githubusercontent.com/mrdoob/three.js/r187/examples/jsm/loaders/KTX2Loader.js) · [glTF Basis extension](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_texture_basisu)

### Clustered-light texture updates

`createMegaLights3D` reuses the last light bins when the view transform, projection, light budget and light values stay unchanged. The viewport and stochastic sampling clock still advance. Rebuilding compares active light rows and the cluster windows occupied in either build. The bundled Three.js build uploads row-bounded ranges for sparse edits and falls back to a full upload for dense changes. Newly allocated GPU textures and renderers that missed a previous version receive the full data. Other injected Three builds use full uploads for changed textures. `mega.uploadStats` reports the current queued bytes, range count and mode for each texture. A renderer that needs a full refresh can submit more than the pending range estimate.

## World Materials, Models & Adapter Lifecycle

For imported or hand-authored particle effects, see the [Unity particle material reference](UNITY-VFX.md).

### Model LOD and cell handoff

`createModelLod3D` in `integrations/model3d.js` switches an actor between skeletal animation, a slot in a shared Bone-VAT crowd, and a distant proxy. The two distances have hysteresis. The game owns the actor position, yaw, clip and clip time. Pass those values to `update(distance, state)` before packing the shared crowd with `crowd.update`. The controller uses the same looping clip time to sample every animated tier. `near` and `far` factories may prepare asynchronously and return detached slots. A slot joins the scene when its `sync(state)` first applies the latest state. The previous slot is released after that call succeeds.

Use one standalone Bone-VAT crowd for actors sharing an asset and ground plane. The crowd uses its configured `baseY` and group transform for height. Choose a render range that covers the normal crowd tier. A retained crowd slot can exceed that range during a transition or failure, with frustum and occlusion culling still enabled. Call `crowd.update` once after the controllers on each render update. A full crowd or failed factory leaves the current slot active. Inspect `error` and call `retry()` when the underlying condition changes, or cross into a different tier. A scene activation signal cancels pending factories and releases the active slot. The caller disposes the shared crowd after its controllers.

`createWorldPartition` keeps the current cell or HLOD proxy during replacement. `loadCell(cell, { signal })` can be asynchronous. A failed promotion returns to the existing HLOD state, and a late completion from a cancelled load goes to `unloadCell`. The `loading` state can coexist with a displayed proxy, so `getHlodCells()` and `stats.hlod` include that proxy. Build `createHLOD(cell)` synchronously. Downgrades and new proxies share `maxHlodBuildsPerStep`. If a build fails, the full cell remains active. Retry candidates wait behind cells that have yet to attempt a build. Use `onCellError(cell, error, stage)` to record load and proxy preparation failures.

See the [model and world system guide](../guides/systems/07-model-vat-open-world.md#角色距离切换) for the slot integration.

### Other model and world APIs

- **Specular Anti-Aliasing, Anisotropy & Floating Origin**: `applyGeometricSpecularAA(material, { strength, maxRoughnessBoost })` injects screen-space normal derivative (`dFdx`/`dFdy`) roughness widening via `onBeforeCompile`. `createWorldAlignedMaterial` and `createWorldMaterialPalette` expose opt-in `specularAA`, `anisotropy`, `palette.setAnisotropy(value)`, and `palette.shiftOffset(dx, dy, dz)` for floating-origin texture continuity.
- **Open-World Infrastructure (`world/open-world.js`)**: `createWorldPartition` provides distance/velocity-predictive 2D/3D cell streaming with hysteresis (`unloadRadius >= loadRadius`), HLOD rings, per-step budgets, `pinCell`, and `forceFlush`; `createHLODProxyGroup3D` batches distant proxies into `InstancedMesh` draws; and `createFloatingOrigin` preserves `Float64` global coordinates while shifting interpolation-safe root entities, `Object3D` transforms, probe volumes, and material world-aligned offsets.
- **Rigged 3D Models**: `cloneObject3DWithSkins(THREE, source)` rebinds cloned `SkinnedMesh` bones to their cloned skeleton hierarchy so prototype rigs are never mutated by per-instance animations. `inspectModel3D(THREE, assetOrRoot)` reports structured bounds, bone names, mesh counts, and clip root-motion diagnostics. `prepareAnimationClips(THREE, clips, { stripNamespace, stripRootMotion, renameMap })` cleans exported rig namespaces and optionally locks root translation (`true` / `'xz'` / `'xyz'`). `createModel3DProvider({ THREE, GLTFLoader, loader, cloneSkeleton, projectBaseUrl })` enforces safe relative project URLs, adds `loadClips` and `inspect`, supports `targetHeight`, `alignGround`, `rotationY`, `attachToBone`, `play(..., { onComplete })`, and concurrent `playOverlay` / `stopOverlay` animation layers.
- **Model ownership**: Loaded assets and roots registered with `owned: true` belong to the provider. Re-registering a key selects the latest root for new instances. Older instances can still use their original resources until the provider is disposed. Detach instances before calling `await provider.dispose()`. Ready resources are released immediately, and the promise waits for outstanding model loads and releases their resources once per object. The caller owns registered roots with the default `owned: false`. A component releases private skeletons created by HGame's built-in clone. A custom `cloneSkeleton` callback manages its own resources. Passing `root` to `createComponent()` borrows that root from its owner. Providers passed to `app.installFeatures()` are disposed by the application. Application disposal is synchronous and reports asynchronous service failures through diagnostics.
- **Three Adapter & Entities**: `createThreeAdapter` maintains single exposure, tone-mapping (`ueFilmic` mapped forward cleanly as well), and linear-HDR sky ownership (`setSky`, `setExposure`, `setPostVolumes`), uses pre-allocated scratch matrices (`Entity.interpolatedWorldMatrixInto(app.renderAlpha, scratch)` / `worldMatrixInto(scratch)`), handles `webglcontextlost` / `webglcontextrestored` events cleanly (halting draws while lost and rebuilding `postPipeline` targets on restore), provides `screenToRay` / `worldToScreen` helpers, and guards against disposing shared caller-owned geometries or materials in `createThreeMeshComponent`.
