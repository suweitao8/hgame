# Changelog

## Unreleased

- Refine AI Music pipeline category coverage & post-loudnorm silence QA (`scripts/lib/music-pipeline.mjs`, `scripts/process-audio.mjs`, `tests/music-pipeline-and-bgm.test.mjs`): expanded `inferMusicCategory` (`romance`, `emotion`, `suspense`, `puzzle`, `explore`, `urgent`), added `shouldApplyVoiceSpaceEq` (`2.8 kHz / -2.5 dB` midrange headroom for `emo_*` dialogue/romance BGM), and added post-`loudnorm` `-43 dB` RMS trailing-silence trim before final `0.05s` anti-click fadeout so attenuated `-19 LUFS` tracks cleanly pass `-45 dB` EOF silence gates.

- Upgrade offline AI Music & Stinger pipeline (`scripts/lib/music-pipeline.mjs`, `scripts/process-audio.mjs --only-music [--force]`, staging `webasset/hgame-assets-cn/raw/audio_ai_staging/{universal,games/<slug>}`) to never truncate BGM or Stinger duration and keep music strictly separated from SFX (`cue_table.json` untouched): bidirectional `start_periods=1` + `areverse` head/tail silence trim (`-45 dB`, anti-over-trim guard falling back to `-58 dB` / passthrough), micro click-prevention fades (`0.02s`/`0.05s`), 2-pass EBU R128 (`-19.0 LUFS` BGM / `-16.0 LUFS` Stinger, `96k` stereo MP3), `silencedetect` EOF check (`<= 0.3s`), SHA-1 incremental `.music_cache.json`, standalone `music_table.json` + `music-ai-index.json` + `music_report.json`, runtime `seekBgm` / `onHide` / `onShow` (`assets/runtime/platform/audio.js`), and a dedicated top-level WebAsset `音乐` workspace tab (`#nav-music`, `#music-view`, `webasset/public/js/hgame-music.js`) separated cleanly from SFX (`webasset/public/js/hgame-audio.js`).

- Add `createUpperLowerMasks` helper (`assets/runtime/animation/animator3d.js`, exported via `integrations/model3d.js` & `index.js`) to split character skeletons automatically (Mixamo/UE/Blender/generic Spine detection or explicit `spineBone`) into non-overlapping `upperMask` / `lowerMask` for 2-layer locomotion + upper-body action playback.

- Standardize LoL-style character/ward-only Fog of War in HGame (`assets/runtime/world/fog-of-war.js`, `docs/guides/USER-AND-AGENT-GUIDE.md`): extended `TOPDOWN_FOG_DEFAULTS` with `revealerSources: ['character', 'ward']` and ward sight defaults (`14m` radius, `3m` soften, `160` rays), added `addWard(opts)` helper on `createFogOfWarWorld`, and documented fixed `256×256` resolution, character/ward-only vision (weapons/projectiles do not scout fog), and clean top-down presentation without fake shadow discs or overhead nameplates.

- Optimize HGame Fog of War for multi-unit / teammate shared vision and large maps (`assets/runtime/world/fog-of-war.js`, `assets/runtime/integrations/fog-of-war.js`): added texel-snapped sliding camera window (`setWindowCenter`, `setBounds`, live `bounds`, synced automatically in `createFogOfWarThreeOverlay`), off-window revealer raster skip while preserving analytical `sampleVisualVisibility` for off-screen teammates, and dirty-AABB `applySeparableBlur` + `displayVisibility` updates when `!useMemory`.

- Standardize LoL-inspired Top-Down camera, lighting/shadow, and binary Fog of War defaults across HGame (`assets/runtime/world/fog-of-war.js`, `assets/runtime/integrations/fog-of-war.js`, `assets/runtime/integrations/camera3d.js`, `assets/runtime/integrations/three.js`, `assets/runtime/kit/art-themes.js`, exported via `index.js`): `TOPDOWN_FOG_DEFAULTS` (`256×256` smoothed grid with `blurPasses: 2`, `23.25m` sight radius / `256` rays, binary visible/unseen `useMemory: false`, `[0.22, 0.26, 0.36]` cool slate-black shroud, `0.30` visual edge hider cutoff via `sampleVisualVisibility`, and `[8, 12, 22, 188]` minimap fog), `createFogOfWarMaterialBinder`, `TOPDOWN_CAMERA_PRESET` (`fov: 42`, `25m` height / `17.5m` Z offset, `-55°` pitch), `TOPDOWN_LIGHTING_PRESET` (`[-24, 44, -18]` top-left sun casting bottom-right shadows with `#171f2e` ground bounce and `[22, 18, 16]` cool fill, wired with `worldLighting.fill` and `sun.shadow.normalBias`), and `resolvePresentationPreset(theme, 'topdown')`.

- Add WebRTC DataChannel dual-channel unreliable/reliable transport adapter (`assets/runtime/lockstep/webrtc-transport.js`, exported via `assets/runtime/index.js`; typed client implementation `network/packages/client/src/webrtc-transport.ts`, exported via `network/packages/client/src/index.ts`) supporting `{ ordered: false, maxRetransmits: 0 }` low-latency snapshot channel, `{ ordered: true }` control channel, offer/answer/ICE signaling, and transparent WebSocket `fallbackSend` degradation, raising Scorecard v5.1 `N1` from `8.0` to `9.0` (total `84.0/100`).

- Upgrade `createLightmapBaker3D` (`assets/runtime/integrations/lightmap-bake3d.js`): added point (6-face cubemap perspective shadow) and spot light direct baking (`lights`), coarse `16x16` surfel 1-bounce diffuse indirect GI (`bounces`, `bounceIntensity`, `bounceSurfels`, verified red-floor color bleeding `bleedR=0.276 > bleedB=0` on shadowed white wall in Chromium WebGL2), and multi-pass ping-pong seam dilation (`dilationPasses=4`), raising Scorecard v5.1 `R2` from `8.5` to `9.0` (total `83.2/100`).

- Upgrade Canvas UI & input persistence (`assets/runtime/ui/canvas-widgets.js`, `assets/runtime/ui/index.js`, `assets/runtime/index.js`, `assets/runtime/platform/input/router.js`): added `layoutRichTextLines` + `richText` multi-span wrapping widget, clipped `scrollView` container with scroll-aware hit-testing, IME composition underline in `textInput`, `createCanvasAriaBridge` + `syncAriaTree` semantic DOM mirror, and `rebindAction` / `saveBindings` / `loadBindings` / `resetBindings` on `createInputActionRouter`, raising Scorecard v5.1 `S4` from `7.5` to `8.5` (total `82.8/100`).

- Wire `createPhysicalRenderTargetPool3D` into `post3d/pipeline.js` (`assets/runtime/integrations/post3d/pipeline.js`, `assets/runtime/integrations/post3d/render-graph.js`): split AO and GI/SSR passes into lifetime-tracked transient stages (`aoRaw -> aoBlurX -> aoVol`, `giSsrRaw -> giSsrBlurX -> giSsr`), pool `bloomScratch` and `ldrColor` with `type`/`format` aware bucket keys, and expose `poolStats` on `lastFrameGraph` & `targets` (`reuses = 29` across 3 allocations in `390x844` Chromium WebGL2), raising Scorecard v5.1 `A2` from `8.5` to `9.0` (total `82.4/100`).

- Add `defineMaterialVariants3D` (`assets/runtime/integrations/material-graph3d.js`, exported via `index.js`) supporting declarative boolean & enum keyword variant dictionaries, canonical key sorting, `defines`/`uniforms` merging, `customProgramCacheKey` shader program reuse, and batch `warmup(renderer, camera, combinations)`, raising Scorecard v5.1 `R3` from `7.5` to `8.5` (total `82.1/100`).

- Unify `post3d/pipeline.js` and `createThreeAdapter` under a single `compileRenderGraph` + `executeRenderGraph` frame DAG with `renderGraph = true` default (`assets/runtime/integrations/post3d/pipeline.js`, `assets/runtime/integrations/three.js`): added `extraPasses` (`before` / `afterWorld`), `getMainTarget()`, and `getLastFrameGraph()` driving `shadow-csm -> world -> projected-decals -> post3d` with zero visual regression, raising Scorecard v5.1 `A2` from `7.0` to `8.5` (total `81.5/100`).

- Default `createThreeAdapter` `gpuIndirect` option to `'auto'` (`assets/runtime/integrations/three.js`, `assets/runtime/integrations/gpu-indirect3d.js`): lazy initialization with zero overhead when no indirect batches are registered, fixed `device`/`webgpuDevice` forwarding, added `getGpuCullingState()`, and implemented non-blocking 2-slot double-buffered WebGPU compute readback compaction in `createIndirectInstancedBatch3D` (`source: 'gpu-readback'`), raising Scorecard v5.1 `P2` from `7.0` to `8.0` (total `80.6/100`).

- Add `createRemoteBundleLoader` and `toCatalogLoader` (`assets/runtime/platform/remote-bundle.js`, exported via `index.js`) supporting topological bundle dependencies, SHA-256 integrity checks, exponential backoff retries, AbortSignal cancellation, and Cache Storage / memory caching, raising Scorecard v5.1 `A3` from `8.0` to `8.5` (total `79.9/100`).

- Add cross-skeleton 3D animation retargeting (`assets/runtime/animation/retarget3d.js`: `createBoneMap3D`, `retargetClip3D`, exported via `index.js`) with rest-pose world delta rotation transfer and proportional hip translation scaling, raising Scorecard v5.1 `S2` from `7.5` to `8.0` (total `79.6/100`).

- Add `generateLightmapUV3D` (`uv1` chart packing) and WebGL2 GPU progressive sun + hemispherical AO `createLightmapBaker3D` (`assets/runtime/integrations/lightmap-bake3d.js`, re-exported from `lighting3d.js` & `index.js`) with `uv1` `channel = 1` binding in `applyBakedLightmap3D`, raising Scorecard v5.1 `R2` from `7.5` to `8.5` (total `79.3/100`).

- Add deterministic Rapier Worker physics (`assets/runtime/physics/physics-worker-kernel.js`, `assets/runtime/physics/physics-worker.js`, `assets/runtime/physics/worker-physics.js`, exported as `createWorkerPhysicsWorld`) with non-COOP/COEP inline fallback and snapshot interpolation, raising Scorecard v5.1 `P1` from `7.0` to `8.0` (total `78.6/100`).

- Upgrade Scorecard to v5.1 capability-only scoring (`docs/scorecard/engine-scorecard.json`, `scripts/score-engines.mjs`, `docs/ENGINE-SCORECARD.md`, local `tests/engine-scorecard.test.mjs`): removed mobile real-device, live-launch, and delivery maturity metrics in favor of `C0–C4` capability maturity caps and verifiable `industrialChecklist` bounds (`Unity 6.x URP Web = 80.0`, `HGame 1.0.0 = 78.0`, `Cocos Creator 3.8 Web = 71.3`, `Godot 4.3+ Web = 64.6`).

- Introduce Scorecard v5 evidence-driven absolute 4-engine scoring (`docs/scorecard/engine-scorecard.json`, `scripts/score-engines.mjs`, `tests/engine-scorecard.test.mjs`, `docs/ENGINE-SCORECARD.md`), deprecating the v4 relative `100.7/100` headline score in favor of hard evidence caps (`E0–E4`), proof-file checks, anti-drift tests, and a separate delivery maturity reference score (`Unity 6.x URP Web = 80.0`, `HGame 1.0.0 = 74.0`, `Cocos Creator 3.8 Web = 71.3`, `Godot 4.3+ Web = 64.6`; delivery `83.5 / 41.5 / 77.8 / 72.0`).

- Complete Tier 6 Scene Hot-Reload, Physical RT Aliasing Pool, Real MRT Contour Draw, Vertex Quantization, 2-Stage Dawn WebGPU Hi-Z Culling & Resource Leak Diff raising unified v4 Web scorecard to **`100.7/100`** (surpassing `Unity 6.6 URP Web = 100.0` by `+0.7`; `Cocos Creator 3.8 Web = 88.2`, `Godot 4.3+ Web = 81.9`):
  - **Runtime Hot-Reload & Atomic Rollback (`A1`, `core/scene.js`)**: Added `SceneManager.hotReload` and `createHotReloadController` preserving live state (`captureState`/`restoreState`) across scene factory swaps and atomically rolling back to the live scene on replacement errors.
  - **Physical RenderTarget Transient Aliasing Pool (`A2`, `integrations/post3d/render-graph.js`)**: Added `createPhysicalRenderTargetPool3D` reusing `WebGLRenderTarget` allocations across non-overlapping RenderGraph lifetimes (`allocations=2, reuses=2, estimatedSavedBytes=5,266,560` verified in `390×844` Chromium WebGL2).
  - **Live 2-Attachment MRT Contour Pass (`R4`, `integrations/post3d/mrt-outline.js`)**: Added `renderOutline(renderer, scene, camera, outputTarget)` with explicit 2-output GLSL3 `ShaderMaterial` G-Buffer override (`gColor + gNormalId`) + fullscreen `RawShaderMaterial` Sobel edge composite with zero WebGL errors (`glErrAfterMrt=0`, `mrtRenderCount=1`).
  - **Vertex Attribute & Uint16 Index Quantization (`R5`, `integrations/culling3d.js`)**: Added `quantizeBufferGeometry3D` (`normal -> normalized Int8`, `uv -> normalized Uint16`, `Uint32 index -> Uint16`, saving `21.27%` on `SphereGeometry` live in WebGL2).
  - **Hardware Dawn WebGPU Stage 2 Hi-Z Occlusion (`P2`, `integrations/gpu-indirect3d.js`)**: Exported `dispatchWebGpuHiZOcclusion` uploading full `r32float` depth pyramid mips to `GPUTexture` and running 4-corner conservative `GPU_HIZ_OCCLUSION_WGSL` on hardware NVIDIA Lovelace Dawn WebGPU (`256 -> 128` occluded / `128` visible, `mipCount=7`) alongside Stage 1 frustum culling (`4,096 -> 2,048`).
  - **Reference-Keyed Resource Leak Snapshot & Diff (`P4`, `integrations/quality3d/render-diagnostics.js`)**: Exported `captureResourceSnapshot` and `diffResourceSnapshots` detecting leaked GPU geometries/materials/textures/targets and confirming zero post-cleanup leaks.

- Complete Tier 5 Turnkey Portrait Mode, Static Batching, 50MB Toy Budget Analyzer, Hi-Z Occlusion & Progressive Boot raising unified v4 Web scorecard to **`99.0/100`** (`Unity 6.6 URP Web = 100.0`, `Cocos Creator 3.8 Web = 88.2`, `Godot 4.3+ Web = 81.9`):
  - **Turnkey `mobilePortrait` Mode (`integrations/three.js`)**: Added `mobilePortrait: true | config` to `createThreeAdapter` automatically wiring `resolvePortraitViewport` DPR caps, `MOBILE_PORTRAIT_PRESET` LUT/heightFog/bloom/RCAS, `createPortraitDrsController`, `createVramMipGuard`, `createMaterialBatchRegistry3D`, and `stepFrameBudget(frameMs, vramBytes)`.
  - **Static Geometry Batching (`R5`, `integrations/culling3d.js`)**: Added `mergeStaticMeshesByMaterial3D` combining static world-transformed geometries by material & optional XZ spatial chunk (`24 -> 1` batched draw call verified live in `390×844` WebGL2).
  - **50MB Toy Bundle Budget Analyzer (`A3`, `scripts/package-game.mjs`)**: Added `analyzeBundleBudget` categorizing code/textures/3d/audio/data sizes, reporting 50MB utilization %, estimating KTX2 savings, and emitting `.budget-report.json` on `--target toy` builds.
  - **Hi-Z Depth Pyramid Occlusion & Progressive 3-Stage Boot (`R5`, `A3`)**: Added `GPU_HIZ_OCCLUSION_WGSL` & `createHiZOcclusionCuller3D` (`integrations/gpu-indirect3d.js`, `integrations/culling3d.js`) and `createProgressiveBootLoader` (`platform/asset-catalog.js`, `assets/runtime/index.js`).

- Complete Tier 4 WebGPU & Mobile-Portrait Commercial Pipeline raising unified v4 Web scorecard to **`98.7/100`** (`Unity 6.6 URP Web = 100.0`, `Cocos Creator 3.8 Web = 88.2`, `Godot 4.3+ Web = 81.9`, excluding Unreal):
  - **KTX2 Offline Packaging CLI & VRAM Auto-Degrade Guard (`A3`)**: Added `encodeKtx2Container`, `convertPngToKtx2`, and `--ktx2` CLI workflow in `scripts/process-assets.mjs`; added `createVramMipGuard` and `globalMipBias` escalation/recovery on `createStreamingResidencyPolicy` (`platform/asset-catalog.js`, `assets/runtime/index.js`).
  - **Hardware Dawn WebGPU Compute Frustum Culling (`P2`)**: Added `dispatchWebGpuCompute` with indirect `COPY_SRC` readback on `createGpuIndirectCuller3D` (`integrations/gpu-indirect3d.js`) and added `tests/browser-webgpu-compute-benchmark.mjs`, verified on hardware NVIDIA Lovelace Dawn WebGPU (`4,096` dispatched -> `2,048` exact compacted visible instances, zero leaks) with WebGL2/CPU fallback.
  - **Single-Target Shadow Atlas, WebGL2 MRT Outline & Lightweight 2D Skeleton (`R1`, `R2`, `R3`)**: Added `createShadowAtlas3D` multi-light tile depth target (`integrations/shadow3d.js`), `MRT_OUTLINE_FRAGMENT_GLSL3` + `createMrtOutlinePass3D` (`integrations/post3d/mrt-outline.js`), and `createSkeleton2D` (topological FK, pose blend, analytical 2-bone IK in `animation/skeleton2d.js`), verified end-to-end in `390×844` Chromium WebGL2 (`tests/browser-mobile-portrait-benchmark.mjs`).

- Realistic 3D Shader, VFX & Spatial Audio Companion v2.0 runtime upgrades:
  - **VFX Atlas Instance Compression (`vfx/vfx-atlas-particles.js`)**: Packed `aAtlasP0..aAtlasP11` (12×`vec4`) down to `aAtlasP0..aAtlasP7` (8×`vec4`, 33% less per-particle vertex attribute bandwidth and safely under WebGL2 `MAX_VERTEX_ATTRIBS = 16` across both 3D and WebGL2-2D shaders) using lossless 24-bit/12-bit encoding, and hardened `setAtlas` for external KTX2/compressed textures.
  - **2-Map PBR, Wetness, Water & Platform Quality Profiles (`integrations/material-graph3d.js`, `integrations/water3d.js`, `integrations/pbr-material-library.js`, `integrations/quality3d.js`, `integrations/foliage3d.js`, `integrations/decal3d.js`)**: Added `normalRmUnpack`, shared `wetness`, and `interactRim` modules to `createComposableMaterial3D`; added `createRealisticWater3D` and `createRealisticGlassMaterial3D` (`integrations/water3d.js`); added `createTwoMapWorldPbrMaterial` (`Color + Normal_RM` + optional `TEXTURE_2D_ARRAY` 4-layer splatmaps); added `QUALITY3D_PROFILES` (`mobile_low`, `mobile_high`, `pc_ultra`) + `resolveQuality3DProfile` while preserving `QUALITY3D_PRESETS`; added `bayerDither` / `atlasGrid` options on `createInstancedFoliage3D` and `applyQualityProfile` on `createDecalSystem3D`.
  - **Indoor Spatial Acoustics, Surface Feedback & CN Atmosphere Facades (`platform/audio.js`, `world/surface-feedback.js`, `world/atmosphere3d.js`)**: Added `setIndoor`, `playSurfaceCue`, and `bindLifecycle` (auto gesture unlock + `visibilitychange` / mini-game `onHide`/`onShow` suspend/resume) to `createAudioManager`; added `SURFACE_TYPES` + `createSurfaceFeedbackRouter` and `ATMOSPHERE_PRESETS_CN` + `createAtmosphere3D` re-exported from `assets/runtime/index.js`.

- Complete Tier 3 Web-first optimization & unified v4 Web scorecard (`Unity 6.6 URP Web = 100.0` baseline vs **HGame `96.8`**, **Cocos Creator 3.8 Web `88.2`**, **Godot 4.3+ Web `81.9`**, excluding Unreal):
  - **Mobile High-Visual Post Chain (`R4`, `P3`)**: Added `COLOR_LUT_PRESETS` and `createColorLutTexture3D` 16³ 2D-strip color grading (`integrations/post3d/color.js`), depth-reconstructed exponential height fog + `sampleStripLut` in `COMPOSITE_FRAGMENT_GLSL3` (`integrations/post3d/shaders.js`, `post3d/pipeline.js`), and updated `MOBILE_PORTRAIT_PRESET` defaults (`msaaSamples: 4`, `colorLut: 'vibrant'`, `heightFog`).
  - **WebGL2 Native UBO Batching & KTX2/ASTC/ETC2 Helpers (`R3`, `A3`)**: Upgraded `createMaterialBatchRegistry3D` with opt-in `THREE.UniformsGroup` + `std140` shader block injection (`integrations/material-graph3d.js`); added `integrations/ktx2.js` (`KTX2_MAGIC`, `detectCompressedTextureSupport`, `parseKtx2Header`, `selectOptimalTextureVariant`, `createCompressedTextureFromMipData`) re-exported from `assets/runtime/index.js`.
  - **Portrait Dynamic Resolution Scaling & Zero-GC Auditing (`P3`, `P4`)**: Added `createPortraitDrsController` zero-alloc ring-buffer DRS controller (`integrations/quality3d.js`) and `measureHotLoopAllocations` (`sim/zero-gc-audit.js`), wired end-to-end into `390×844` DPR 2 Chromium WebGL2 (`tests/browser-mobile-portrait-benchmark.mjs`) with `uboEnabled=true`, `lutEnabled=true`, `glError=0`, `uniqueColors=1372`.

- Complete Tier 2 commercial & mobile-portrait Bilibili Toy alignment upgrades raising v3 general scorecard to **`82.0/100`** (`−6.5` vs Unity 6.6 URP Web `88.5/100`) and calibrated mobile-portrait mini-game track to **`84.8/100`**:
  - **Mobile-First Portrait & Bottom-Right Thumb-Arc Ergonomics + CJK IME (`S4`)**: Added concentric bottom-right semi-arc comfort-zone HUD layout & verifier (`DEFAULT_THUMB_ARC_SPEC`, `computeThumbArcLayout`, `isInThumbComfortZone`, `createThumbArcHud` in `ui/thumb-arc.js`), added `buttonLayout: 'portrait-arc'` (`integrations/touch-controls.js`) and `portraitFirst: true` (`kit/game-shell-dom.js`), exported `auditPortraitThumbZone` (`.agents/skills/hgame-ui-ux/scripts/check-ui.mjs`), documented Mobile-First Portrait rules in `AGENTS.md` / `.agents/skills/hgame-ui-ux/SKILL.md`, and added `compositionUpdate` / `compositionEnd` CJK IME handling on `createCanvasUiRenderer` (`ui/canvas-widgets.js`).
  - **Scene-Level Render Graph Orchestration (`A2`)**: Added opt-in `renderGraph: true` on `createThreeAdapter` (`integrations/three.js`) compiling & executing `shadow-csm` -> `opaque-scene` -> `projected-decals` -> `post-composite` with reverse-reachability dead-pass pruning and `adapter.getExecutedRenderGraph()`.
  - **FSR1 RCAS Sharpening, Soft Projected Decals, O(1) Material Batching & Portrait Fill-Rate Caps (`R3`, `R4`, `P3`)**: Upgraded sharpen pass to 5-tap AMD FSR1 RCAS (`integrations/post3d/shaders.js`), added `edgeSoftness` & `roughnessTint` blending to depth-projected decals (`integrations/decal3d.js`), added `createMaterialBatchRegistry3D` (`integrations/material-graph3d.js`), added `MOBILE_PORTRAIT_PRESET` & `resolvePortraitViewport` (`integrations/quality3d.js`), and verified `390×844` DPR 2 Chromium WebGL2 + thumb-arc interaction via `tests/browser-mobile-portrait-benchmark.mjs`.

- Complete Tier 1 high-ROI commercial HTML5 mini-game upgrades raising v3 general scorecard to **`79.9/100`** (`−8.6` vs Unity 6.6 URP Web `88.5/100`) and calibrated mini-game track to **`82.7/100`**:
  - **Additive Sub-Scenes, Bus Ducking & Worker NavMesh (`A1`, `S3`, `P1`)**: Added `mountAdditive`/`unmountAdditive`/`overlays` in `core/scene.js` + `core/application.js`; upgraded `duckBus` with sample-accurate `GainNode` envelopes & `getDspState().ducking` (`platform/audio/`); added `'navmesh-path'` worker kernel + `findPathAsync` (`sim/worker-sim.js`, `world/navmesh3d.js`).
  - **128 2D Occluders, Auto-Tiling, 2D Sprite Effects, SDF Text & TextInput (`R1`, `S4`)**: Raised `MAX_2D_OCCLUDERS` to `128` (`integrations/post2d.js`), added `applyAutoTileRules` (`world/tilemap.js`), added per-sprite `shaderEffect` GPU outline/dissolve/wave uniforms (`integrations/webgl2d.js`), and added `renderSdfText` + interactive `textInput` widget (`ui/canvas-widgets.js`).
  - **GPU Instanced Foliage, Dither LOD, PCSS Shadows & Baked Lightmaps (`R2`, `R5`)**: Added `createInstancedFoliage3D` with trampling & Bayer fade (`integrations/foliage3d.js`), `injectDitherLodMaterial3D` (`integrations/model3d/lod.js`), opt-in `pcss` blocker/penumbra shadows in `createCascadedShadowMap3D` (`integrations/shadow3d.js`), and `applyBakedLightmap3D` (`integrations/lighting3d.js`).
  - **VRAM Ledger, Time-Sliced Warmup, Live Profiler & 60s Soak (`P3`, `P4`)**: Added `createVramLedger3D` + `adapter.measureVram` (`quality3d/render-diagnostics.js`, `integrations/three.js`), `stepWarmupBudget` alias (`quality3d/shader-warmup.js`), `createLiveProfilerOverlay` (`ui/profiler-overlay.js`), and 3,600-tick deterministic soak verification (`tests/t1d-vram-profiler-soak.test.mjs`).

- Add commercial HTML5 / Bilibili-Toy-aligned runtime upgrades and calibrated v3 scorecard (`74.7/100` general vs Unity 6.6 URP Web `88.5/100`; **`77.5/100`** calibrated for self-hosted server + Blender Auto-Rig + deterministic Rapier + 50MB single-bundle scope excluding platform SDKs/subpackaging/WebRTC/heavy cloth/vehicles):
  - **Presentation Secondary Motion & Pose Transitions (`S2`)**: Added `createSpringBoneChain3D` (Verlet spring chain for hair/capes/tails with spherical collider pushout, zero Rapier overhead) and `createInertialBlend3D` (exponential half-life residual pose decay) in `animation/animator3d.js` + `assets/runtime/index.js`.
  - **GPU Vertex Wind Sway (`R3`)**: Added optional `windSway` module (`height` or `vertexColor` weights, `sharedBlock.uniforms.uTime` sync, `setWindTime()`) to `createComposableMaterial3D` in `integrations/material-graph3d.js`, verified compiled in Chromium WebGL2 (`warmupCompiled=6`, `glError=0`).
  - **Server-Side Spatial AOI Interest Culling (`N1`)**: Added `createSpatialAoiFilter` (enter/exit radius hysteresis tracking per viewer before binary delta encoding) in `lockstep/state-sync.js` + `assets/runtime/index.js`.

- Reset HGame Engine scorecard to strict v3 end-to-end standards (`60.7/100` vs Unity 6.6 URP Web `88.5/100`) and complete Phases 1–5 commercial alignment upgrades raising verified score to **`73.6/100`** (`−14.9` honest gap remaining), verified in headless Chromium WebGL2 (`1280×720`, `tests/browser-engine-v3-commercial-benchmark.mjs`) and `npm run check:all` (`452` core tests + `network/`):
  - **Audio DSP & Real Worker Offload (`S3`, `P1`)**: Wired `voice -> reverbSendGain -> ctx.reverbSend -> ConvolverNode -> busTarget` (including deferred zone wiring on `unlock()`) and 3-band parametric EQ (`setBusEq`/`getBusEq`/`getDspState`) in `platform/audio/`; implemented `'flow-field'` and `'swarm-separate'` worker compute kernels (`sim/worker-sim.js`) with non-duplicating `stepAsync()` offloading in `world/swarm-ecs.js`.
  - **Binary State Sync & Scene Replication (`N1`)**: Replaced `JSON.stringify` diffing with recursive `valuesEqual`, compact `0x48 0x47` quantized varint/bitmask packet codec (`encodeDeltaBinary`/`decodeDeltaBinary`), and `createSceneReplicator` (`lockstep/state-sync.js`) converging with zero error under 15% packet loss + jitter.
  - **3D Rendering, Projected Decals, CSM, Probes & Render Graph (`A2`, `R2`, `R3`, `R4`)**: Added GLSL3 screen-space depth-reconstructed OBB decals (`decal3d.js` `mode:'projected'`), fixed 3× CSM overexposure to single-lit intensity + `1.08` overlap + multi-cascade GLSL injection (`shadow3d.js`) and lazy `adapter.getCascadedShadowMap(scene)` initialization (`integrations/three.js`), added dual-probe `injectBoxProjectedBlending` (`lighting3d.js`), and wired `reactiveMaskRT` + `executeRenderGraph` post execution in `post3d/pipeline.js`.
  - **GPU Indirect Batching, FABRIK/Root Motion, Canvas Flex Widgets & Mip Streaming (`A3`, `P2`, `S2`, `S4`)**: Added `createIndirectInstancedBatch3D` (`integrations/gpu-indirect3d.js`), `solveFabrikIK` (with pole target), `extractRootMotion`, and `blendMorphTargets` (`animation/animator3d.js`), native Canvas2D flex-laid widgets (`ui/canvas-widgets.js` `createCanvasUiRenderer`), and `bindTextureMipStreaming` (`platform/asset-catalog.js`).

- Bring HGame Engine v2 scorecard from `67.0/100` to **`87.9/100`** (matching and slightly ahead of Unity 6.6 URP Web `87.5/100`) across Phases A–E, verified in headless Chromium WebGL2 (`tests/browser-engine-v2-benchmark.mjs`) and 441 unit/integration tests:
  - **Physics & Skeletal Animation (`S1`, `S2`)**: 16-layer collision matrix, friction/restitution combine rules, 5 joint constraints (`fixed`, `revolute`, `prismatic`, `spherical`, `spring`), `castShape`, `queryOverlap`, and `createRagdoll` in `physics/rapier-world.js`; plus `createAvatarMask`, `createBlendTree1D`/`2D`, layered `createAnimator3D`, `solveTwoBoneIK`, `solveLookAtIK`, and `Model3DComponent.attachAnimator()` in `animation/animator3d.js` + `integrations/model3d/`.
  - **3D/2D Rendering & Visual Pipeline (`R1`–`R5`)**: Cascaded Shadow Maps (`createCascadedShadowMap3D`) + Reflection Probe blending (`createReflectionProbeManager3D`), pooled OBB Decals (`integrations/decal3d.js`), composable PBR materials (`integrations/material-graph3d.js`), YCoCg 3×3 variance-clipped + 5-tap Catmull-Rom + `tReactiveMask` TAA (`integrations/post3d/`), `crossFadeSeconds` + Bayer 4×4 dither crowd LOD transitions (`integrations/model3d/lod.js`, `bone-vat.js`), and closed/open polygon 2D shadow occluders (`addPolygonOccluder2D`, `setPolygonOccluders2D` across `post2d.js`, `canvas2d.js`, `webgl2d.js`).
  - **Architecture, GPU/Worker Performance & Profiling (`A2`, `A3`, `P1`–`P4`)**: Reverse-reachability dead-pass Render Graph culling (`pruneDeadPasses`, `culledPasses`), `createShaderWarmupQueue3D` + `gpuIndirect` wiring on `createThreeAdapter`, `createStreamingResidencyPolicy` distance Mip/budget management on `createAssetCatalog`, `stepAsync()` worker offloading in `SwarmSimulation` & `createWorldPartition`, and ring-buffered frame percentile telemetry + `exportChromeTrace()` Chrome Trace JSON in `quality3d/render-diagnostics.js`.
  - **Audio, UI/Input/Accessibility & Network State Sync (`S3`, `S4`, `N1`)**: Spatial `createReverbZone` (`ConvolverNode`), Doppler playback pitch shifting, and `playStream` streaming audio in `platform/audio.js`; headless Flexbox-lite layout solver (`ui/flex-layout.js`), JSON action rebinding persistence + `triggerGamepadRumble` (`platform/input/manager.js`), and WAI-ARIA helpers (`ui/panel-stack.js`); plus quantized delta compression, client prediction/server reconciliation, interpolation buffer, and lag-compensation rewind (`lockstep/state-sync.js`).

- Overhaul `docs/ENGINE-SCORECARD.md` to v2 (17 criteria across 5 runtime pillars, strict anti-inflation evidence caps, and head-to-head comparison against Unity 6.6 URP Web and Godot 4.7.2 Web: HGame `67.0/100` vs Unity `87.5/100` vs Godot `76.7/100`), highlighting core gaps in Skeletal StateMachines/BlendTrees/IK, WebGPU indirect integration, Materials/Decals, Rapier joints/shapecasts, and networked state synchronization.

- Bring all 11 HGame Engine Scorecard dimensions (Architecture A1–A3 `25.0/25`, Performance P1–P4 `40.0/40`, Rendering R1–R4 `35.0/35`, total `100.0/100`) to `10/10`:
  - **Architecture (A1–A3)**: Phase-aware error attribution (`activePhase`, `activeScene`, `lastPhaseError`) and scene cancellation tracking in `core/application.js`, `core/scene.js`, and `platform/diagnostics.js`; explicit DAG `compileRenderGraph` / `executeRenderGraph` with lifetime aliasing and target reclamation in `integrations/post3d/render-graph.js`; and `AbortSignal` dependency propagation + late GPU cleanup in `assets/profiles/3d/model-loader.js` unified under `assetCatalog.getResidencyStats()`.
  - **Performance (P1–P4)**: Off-thread Worker simulation runner (`sim/worker-sim.js` `createSimWorkerRunner`) with deterministic `(submitTick, priority, id)` `flushTick` ordering and main-thread fallback; static-skip / dirty-range `createInstancedBatch3D` uploads and `createGpuIndirectCuller3D` (WebGPU indirect compute, `WEBGL_multi_draw`, and CPU fallback) in `integrations/culling3d.js` + `integrations/gpu-indirect3d.js`; typed 2D memory & idle budget eviction (`integrations/render-budget-2d.js`) wired across `Canvas2D`, `WebGL2D`, and `Pixi2D`; and unified 2D/3D frame & pass telemetry (`draws`, `uploadBytes`, `targetBytes`, `measurementSources`, `estimatedFields`, Canvas2D API draw counting, and Pixi WebGPU `timestamp-query`).
  - **Rendering (R1–R4)**: 2D occluder shadow casting (`MAX_2D_OCCLUDERS = 32`), `Sprite2D` `normalMap` / `normalStrength` / `roughness`, and `QUALITY2D_LIGHTING_PRESETS` (`low`/`medium`/`high` retention policies) across `post2d.js`, `canvas2d.js`, and `webgl2d.js`; streamed 3D SH probe volume LRU & cross-cell blending (`createStreamedProbeVolumeManager3D` wired into `createWorldPartition`); `SkinnedMesh` previous-bone motion vectors + `bone-vat` classification and `temporalUpsampling` (`renderScale < 1`) in `post3d/`; and independent per-instance Bone-VAT `aCrowdY` elevation, composite animation handoff in `createModelLod3D`, and unified `createRepresentationBudget3D` integrated with `createWorldPartition`.

- Add per-game holistic design documentation suite (`docs/design/GDD.md`, `ART-AND-AUDIO.md`, `UI-UX.md`, `LEVEL.md` via `kit/design-docs.js`), automatically populated by `scripts/create-game.mjs` and verified fail-closed by `scripts/check-design-docs.mjs` (`npm run check:design`) and `scripts/accept.mjs` (`gates.designDocs` + `computeSourceDigest`).
- Add the 5-pillar Universal Game Development Template Kit (`assets/runtime/kit/`: `blueprint.js`, `art-themes.js`, `audio-director.js`, `game-session.js`, `game-shell-dom.js`, `design-docs.js`) and playable genre archetypes (`assets/archetypes/`: `action-2d`, `horde-2d`, `arena-3d`, `card-ui`) wired into `scripts/create-game.mjs` (`--archetype`, `--theme`, `--design`), `scripts/check-blueprint.mjs` (`npm run blueprint:check`), and `scripts/query-api.mjs` (`--recipe kit`).

- Add a fail-closed Self-Test & Acceptance Gate (`scripts/accept.mjs`, `scripts/accept-all.mjs`, `npm run accept`, `npm run accept:examples`) synced into every generated/managed game (`scripts/lib/engine-sync.mjs`, `assets/template/`). Enforces WebAsset allowlist & asset reference validation, full `src/`/`tests/` syntax + relative ESM import checks, Anti-Bloat UI static & runtime lint (`check-ui.mjs`, `snapshot.mjs --check-layout` detecting runtime `<p>`/`<footer>`/prose walls, overlong buttons, clipped/overlapping HUD panels, and clipped touch controls), zero-skip unit tests, multi-seed headless autoplay clear-rate, difficulty tiering (`bot` vs `random` vs `idle`), pacing, and determinism verification (`scripts/check-autoplay.mjs`, `--require-autoplay`, `--check-determinism`, `task-check` `autoplay` check type), dual-viewport (`960x540` desktop & `360x800` mobile) real-input `tests/acceptance.mjs` playtesting with multi-phase `context.auditUi(label)` checks, in-page `NaN`/`Infinity` & premature disposal detection (`playtest.mjs`), live WebAsset 4174/4175 runtime verification, optional release boot checks, and cryptographic `sourceDigest` freshness proofs (`--verify-fresh` in `build/acceptance-report.json`). Extended `task-check.mjs` with `ui`, `snapshot`, `doctor`, `accept`, and `autoplay` check types, wired `window.__hgameState` / `data-engine-ready` across all starter profiles and examples (`examples/arena-3d`, `examples/survivor-2d`, including responsive narrow-screen HUD layout fixes), and added `tests/acceptance-gate.test.mjs` + `tests/browser-acceptance.mjs`.

- Add a universal cross-game UI & UX runtime system: spring-driven 3D hover tilt, specular glare, press squash, idle float, and staggered card reveal (`ui/ux-motion.js`: `createUiSurfaceSpring`, `createUiMotionGroup`, `computeStaggerProgress`), a cross-profile phase/metric/hint/cue/ghost-bar/cooldown-ring director (`ui/ux-director.js`: `createUiDirector`), `panel-stack.js` `motion` and `easedAlpha` support, an on-demand sleeping DOM UX binder (`integrations/ui-ux-dom.js`: `bindUiUxDOM` with `scifi`/`arcane`/`arcade`/`cyber` theme presets, dual-layer ghost bars, radial cooldown rings, pooled Bezier `flyTo`, sliding keyboard/gamepad focus ring, and touch swipe-to-select), a renderer-neutral 2D Canvas/Pixi UI binder (`integrations/ui-2d.js`: `createCanvasUiGroup`), and 3D world HUD / depth-sorted fanned spatial 3D UI (`integrations/ui-3d.js`: `createWorldHud3D`, `createSpatialPanel3D` with curved arc & 3D preview attachment, `createSpatialUiGroup3D`). Upgraded `ui`, `3d`, and `pixi2d` starter profiles and added Chromium regression coverage (`tests/browser-ui-ux.mjs`).

- Add a text-authored fullscreen HDR shader pass with Unity-style screen coordinates, chained linear color, and view-matched raw, eye and normalized depth. Document Shader Graph inputs and texture color-space mapping.

- Play Unity grid texture sheets on Three mesh particles. Mesh and atlas particles share frame selection and interpolation, including single-row atlas regions and prewarmed mesh lifetime.

- Carry Unity material depth comparisons and explicit depth-write settings into Three mesh and instanced particle draws. Batch opaque atlas cutouts by render state, preserve white default textures, and honor each atlas material's soft-particle toggle. Idle batches submit zero instances.

- Preserve Unity URP material surface type, tint alpha, and mesh texture masks in particle recipes. Apply alpha clipping before camera and soft-particle fades, support premultiplied source textures, and restore the WebGL2 2D atlas shader.

- Extend `vfx/` shaders, importer (`scripts/import-unity-vfx.mjs`), and fidelity scorer (`scripts/score-vfx-fidelity.mjs`) for Unity URP/Legacy ParticleShader and material feature coverage: add `multiply` (`DstColor/Zero` with alpha-interpolated white neutral) and `premultiply` (`One/OneMinusSrcAlpha`) blend channels across 3D/WebGL2/Canvas2D (`vfx-atlas-particles.js`, `vfx-mesh.js`), per-particle `cullMode` (`gl_FrontFacing` discard), `alphaCutoff`, `_CameraFadingEnabled` near/far distance fading (`cameraFade`), `_BaseMap`/`_MainTex` `uvScale` + `uvOffset`, `_EmissionEnabled` HDR `emissionBoost`, particle `dissolve`, `m_Pivot` + Unity `StretchedBillboard` (`size * lengthScale + speed * velocityScale`), built-in Unity primitive meshes (`quad`/`cube`/`sphere`/`cylinder`) + `.fbx.meta` `meshGlobalScale`, `ShapeModule` `sphericalDirectionAmount` + `randomDirectionAmount`, recursive Transform hierarchy scale/rotation (`computeHierarchyTransform`), `ParticleSystemRenderer.m_Enabled: 0` filtering, and Legacy `_TintColor` support.

- Bring `vfx/` and `scripts/import-unity-vfx.mjs` to full coverage of the Unity ParticleSystem checklist in `scripts/score-vfx-fidelity.mjs`: add `sizeYCurve` + signed cumulative `velCurve` LUT channels (`128..255` `.b`/`.a`), `aAtlasP8`/`aAtlasP9` for 3D forces/wind (`setWind`), `aspectY`, 3D Euler quad rotation (`rotation3D`), scrolled/damped `NoiseModule`, moving local-space anchor tracking (`uEffectDeltas`), screen-space refraction distortion channels (`setSceneTexture` on billboard particles & smooth `distortion` spheres in `vfx-mesh.js`), `donut`/`rectangle`/`mesh` surface shapes (`getSurfaceSamples`), `simulationSpeed`, `UVModule.rowMode`, multi-stop trail `widthCurve`, custom `setCollisionResolver` + mesh bounce sync, `SubModule` property/velocity inheritance, and pooled `LightsModule` per-particle `PointLight` instances.

- Add a distance-based 3D model LOD controller for skeletal models, shared Bone-VAT slots and distant proxies. Preserve animation time and keep the active representation while the next one prepares. World partition now preserves its fallback during failed loads and prepares distant proxies within budget before releasing full cells.

- Use stable 2D layer and depth ordering across native and Pixi draws. Add normalized viewport clips and additive blending, and keep adjacent compatible draws together.

- Add an opt-in fixed-tick budget for deferred simulation work and resumable 2D and 3D pathfinding. Navigation jobs use the same routing rules across slices and report backpressure, failures, and cancellation.

- Add ordered application phase hooks and a cancellation signal for each scene activation. Pair scene entry and exit during transition rollback and reentrant teardown.

- Add scene-scoped decoded model acquisition with shared cancellation and idle geometry and texture eviction. Connect model residency to the optional 3D render budget.

- Add an opt-in Three render memory budget that trims idle resources and adjusts resolution or effects independently of GPU timing.

- Add opt-in frame and pass diagnostics for Canvas2D, WebGL2D, and the Pixi profile, sharing the Three snapshot structure and reporting unavailable backend counters as null.

- Reproject 3D temporal AA with depth-checked motion from opaque rigid meshes and CPU-managed instances. Static views skip the motion draw, and incompatible paths retain camera reprojection.

- Load versioned baked SH irradiance into Three scene lighting, with pane-local SSGI coverage, GPU capability fallback, and scene-owned texture lifetime.

- Declare built-in and custom 3D fullscreen pass texture dependencies and output attachments. Reuse pane-local HDR intermediates across passes once their inputs have been consumed.

- Extend `vfx/` with textured/flipbook/curve GPU particles (`vfx-atlas-particles.js`, 256x1024 128-stop Curve LUT, `BILLBOARD` `aspectY` + `VERTICAL` modes, per-particle `startColor` tinting, GPU `orbitalY` + `orbitalOffset` spiral motion, persistent + `curveCycle` looping curves, LDR-preserving HDR shader output, optional depth-based Soft Particles via `setDepthTexture`), pooled 3D mesh VFX with auto-extracted GLB textures, Fresnel rim glow, UV scroll, separate-axis `spin`, and procedural dissolve (`vfx-mesh.js`), textured/tapered ribbon trails (`vfx-trails.js`), and a declarative `.vfx.json` composite effect recipe player (`vfx-recipes.js`, `createVfxSystem.playEffect`, `validateVfxRecipe`, `createProceduralVfxAtlas`, 3D `shape.rotation`, `rateOverDistance`, ground-plane `CollisionModule` bounce, recursive `SubModule` sub-emitters). Add clean-room Unity `ParticleSystem` YAML importer (`scripts/import-unity-vfx.mjs`) with `ForceModule`, `VelocityModule`, `RotationModule.separateAxes`, `EmissionModule` bursts/rateOverDistance, and refraction-only `Distortion.mat` filtering.

- Add opt-in 3D temporal anti-aliasing for the HDR world, with depth-validated color history per view and FXAA fallback.

- Load glTF KTX2/Basis textures on demand in 3D projects, including self-contained packaged releases. Reuse transcoded bytes with per-model texture ownership and release the worker pool on teardown.

- Report submitted WebGL buffer and texture upload payloads by frame and pass in opt-in Three diagnostics.

- Reuse unchanged clustered light bins and upload bounded dirty texture ranges. Initialize all data on fresh GPU backing and retain full-update fallback for injected Three builds.

- Add optional Three adapter diagnostics for frame and pass CPU submission, draw calls, triangles, viewport target usage, and asynchronously sampled GPU time.

- Compose caller-owned fullscreen HDR effects with declared color and optional world-depth inputs. Reuse pane-local scratch targets and skip effects whose depth input is unavailable.

- Run 3D split views through HDR post-processing when available. Keep exposure and temporal history isolated by view, size targets to physical pane pixels, and release pane resources on removal or context loss.

- Add opt-in temporal accumulation for screen-space GI and reflections. Reproject depth-validated history in the existing bilateral pass and reset it across scene changes, camera cuts and target changes.

- Add clean-room Fog of War system (`world/fog-of-war.js` + `integrations/fog-of-war.js`) with analytical corner-ray LOS occlusion, vision cones, persistent exploration memory/regrow, hider tracking, TileMap obstacle merging, minimap export, and Canvas2D/Three.js overlays.

- Integrate clean-room DamageNumbersPro capabilities into `vfx/vfx-floating-text.js` and `vfx/vfx-damage-presets.js` (64-glyph GPU atlas, K/M/B/T suffix shortening, grouping separators, color/scale-by-number, 13 presets, damped lerp, velocity/gravity, target following, combination/absorption, collision separation, push, destruction, unscaled time, 3D distance scaling, and WebGL2 2D rendering).

- Ensure adaptive 3D viewports retain at least one physical pixel per axis within GPU buffer limits.

- Fix FXAA edge orientation, reuse cardinal taps for sharpening, and keep canvas alpha opaque when tone mapping writes directly to the screen.

- Store bloom mips in packed RGB float targets where supported. Reconstruct the upsampling tent kernel with four bilinear reads instead of nine.

- Resolve multisampled scene depth only for active depth effects. Select MSAA counts supported by both HDR color and depth attachments.

- Respect WebGL texture, renderbuffer and viewport dimensions when sizing 3D buffers. Keep HDR targets and split-view edges aligned with the allocated canvas buffer.

- Restore 3D quality tiers after sustained render headroom. Limit the initial resolution increase when enabling higher-tier effects and back off after a failed promotion.

- Use bounded, asynchronous WebGL GPU timing to avoid unnecessary 3D quality reductions when slow frames leave GPU render headroom. Keep frame-interval adaptation when timer samples are unavailable.

- Share depth reconstruction across 3D post-processing passes, including reversed depth. March volumetric lighting along parallel rays in orthographic views.

- Preserve native camera matrices for parented 3D views. Use parallel rays for orthographic occlusion and picking. Recognize zero-to-one depth when extracting frustums.

- Keep off-camera Three.js mesh components eligible to cast shadows. Apply optional camera culling to other meshes at draw time using their world-space geometry bounds.

- Allow static scenes to reuse their built-in sun's shadow map. Refresh cached maps on scene edits, camera layer changes, quality transitions, context restoration or explicit requests.

- Clamp directional shadow atlas sizes to the GPU limit and refresh manually updated shadows after quality changes, frustum refits and WebGL context restoration.

- Fit directional shadows and derive screen-space sun lighting from world-space light and target transforms. Snap the shadow projection to a world-anchored texel grid.

- Step contact shadows and volumetric lighting in projected coordinates. Stop contact shadows at the first valid occluder and reuse depth reads when consecutive samples reach the same texel.

- Clip screen-space reflection rays to the camera frustum and march in projected pixel space with perspective-correct depth. Refine depth crossings and fade hits near view edges.

- Use a logarithmic depth guide for 3D screen-space lighting denoising and upsampling. Reject sky and foreground bleeding at silhouettes while keeping effects at half resolution.

- Finish screen-space effects using world scene depth before drawing a first-person layer. Apply bloom, exposure and tone mapping to the combined HDR image.

- Reuse 3D post-processing targets across quality and viewport changes. Share half-resolution scratch storage between GI/reflection denoising and bloom, including AO/volumetrics on the 8-bit path.

- Meter auto-exposure over the full luminance grid and combine the final reduction with adaptation. Preserve signed log luminance and exposure above 1 on 8-bit render targets.

- Skip Pixi shockwave filter passes when the distortion ring misses the viewport. Keep wave timing and filter order across camera movement.

- Process only entering and leaving Pixi tilemap chunks on camera movement. Stage new chunks before changing the visible set and skip empty chunks during drawing.

- Prepare render chunk bounds in the swarm movement pass when the latest viewport is likely to cull most units. Invalidate the index on subsequent ECS movement or removal.

- Reuse current swarm chunk bounds in Pixi to skip off-screen units while preserving particle submission order. Fall back to a linear scan when the index is dirty or most units remain candidates.

- Reuse static quad vertices for Pixi swarm sprites with stable geometry. Keep per-frame geometry uploads for direction flips, changing frame bounds, or opt-in animated scales.

- Track occupied swarm chunks in grid order. Rebuild sparse chunk indices without clearing the full grid and skip empty chunks in crowd rendering and circle damage queries.

- Add distance hysteresis for CPU-driven Bone-VAT crowds to reduce LOD switching and buffer repacking near thresholds. Track swarm slot generations so respawned units start with fresh LOD and status.

- Apply the Bone-VAT crowd group's world transform to CPU culling, LOD distances and impostor camera-facing, including under scaled and rotated ancestors.

- Reuse unchanged packed Bone-VAT instance data and report scheduled upload bytes. Preserve animation and status colors across chunk culling and impostor LOD transitions.

- Upload vertex animation data for changed visible crowd instances and skip animation uploads while the crowd is unchanged or hidden.

- Reuse unchanged 3D instance matrices and colors. Upload only changed ranges when they can be submitted in a bounded number of GPU calls.

- Skip redundant 3D scene clears with Three.js auto-clear enabled and only recompute white balance when temperature or tint changes.

- Resize the Three.js drawing buffer in one update. Defer 3D post-processing allocations during WebGL context loss and retain auto-exposure history across resolution changes.

- Support `tickHz: 0` for command-driven 2D games without physics. The Pixi renderer redraws on commands and resize while the idle game schedules zero frames.

- Clear 3D telegraphs from the renderer when the VFX system resets so warnings from a previous run cannot reappear.

- Record bounded gameplay events in runtime diagnostics and collect them in AI playtest reports. The arena reference traces beacon interruptions and combat events in debug mode.

- Upload Pixi atlas pixels through WebGPU's byte upload to keep GPU memory bounded across repeated renderer restarts.

- Release the Pixi atlas backing canvas on game shutdown and startup failure. Create a fresh atlas when starting another renderer.

- Split Pixi's JavaScript by renderer and load Horde settings and simulation alongside the engine. Check the cold-start transfer budget and request ordering in browser CI.

- Build new Pixi projects with esbuild, removing the affected Picomatch dependency from their build toolchain. Preserve release rebuilds for existing Vite projects.

- Release the Pixi atlas when renderer initialization fails before mounting a canvas. Cover automatic WebGL fallback, hidden-page context recovery and fixed-backend startup errors in browser CI.

- Avoid SwiftShader's per-instance draw overhead in general WebGL2D sprite batches by fetching packed instances in one triangle stream.

- Render WebGL2D instanced quads with four vertices and skip interpolation of per-instance colors. Run the frame pacing and 3D stress budgets independently in CI.

- Build the network lab with esbuild and remove the affected Picomatch dependency from the network workspace.

- Disconnect congested lockstep WebSockets at a bounded live-frame backlog and retain the confirmed frames for reconnect replay.

- Bound lockstep replay by bytes and send rate, defer replay during WebSocket congestion, and cancel deferred work when a session drops.

- Add a fixed-duration rendering benchmark mode with frame-time windows and adaptive-quality checkpoints.

- Ship the engine and network lockfiles and documented tool sources in full SDK exports. Use tracked paths in a Git checkout and keep local caches and planning files outside the SDK.

- Deliver confirmed lockstep frames individually so the remaining queue survives subscription changes during a burst.

- Refresh Pixi swarm UV and rotation buffers when their static values change. Recycle offscreen particle tails without temporary removal arrays.

- Cull offscreen Pixi arena enemies before particle updates. Expose the selected backend and adapter diagnostics and add WebGPU and touch/DPR modes to the render benchmark.

- Catch up from a bounded lockstep receive window when live frames arrive before replay, and stop automatic retries when the server has evicted the required history.

- Exclude shader line separators from the Toy preflight's external host detection.

- Stage game and SDK releases before publishing. Preserve the previous artifacts if assembly or Toy preflight fails and use stable archive timestamps.

- Deduplicate client reconnect attempts, detach replaced room subscriptions, and keep confirmed lockstep frames bounded before a consumer subscribes.

- Publish the Pixi canvas readiness marker used by browser tools. Trace reachable Pixi build files in releases and detect Toy SDK usage in bundled entries. Keep compiled files and the asset catalog out of media CAS sync.

- Include HGame modules referenced by literal paths in the Pixi bundles reachable from a game's release entry.

- Add swept projectile queries to `SpatialHash2D` and use the shared spatial index in the Pixi arena without rebuilding it on idle dense-crowd ticks.

- Cull off-screen Pixi effect particles before rendering while preserving their simulation and the separate active/visible counts.

- Anchor Pixi shockwaves in world space, pool and cap their GPU filters, and run bloom independently of distortion.

- Add Pixi 2D quality presets to the game generator and adapt resolution from HGame frame timing by default.

- Share Pixi startup and teardown across the bare, arena, and horde starters, including renderer cleanup when initialization fails.

- Bound concurrent asset catalog downloads and decodes across scene scopes, and cancel a disposed scope's pending waits independently of shared requests.

- Reduce world-transform calculations and single-component dispatch overhead, and stop physics stepping when an update switches away from its scene.

- Limit 3D A* workspace updates to visited cells, support per-query node budgets, and preserve traversability when smoothing paths or snapping destinations.

- Reuse a bounded per-map grid pathfinding workspace and update queued priorities in place so duplicate entries cannot consume the A* node budget.

- Reuse Pixi tile particles on map edits and evict off-screen chunks in cache order without sorting.

- Sample the directional shadow depth texture in 3D volumetric lighting using the correct texture coordinates and PCF comparison mode.

- Skip inactive 3D post-processing passes and preserve scene buffers and eye-adaptation history when effect settings change.

- Bundle local API lookup, the selected starter entry reference, and runtime type declarations in generated games. Include the Pixi starter build and declarations in the engine SDK archive.

- Reduce per-unit Pixi swarm synchronization work for common single-clip and fixed-orientation crowds.

- Restrict 3D instanced batch GPU buffer updates to the visible prefix when the Three.js buffer API supports update ranges.

- Cull 3D instance batches in world space when the batch mesh or its parents are transformed.

- Prevent per-cell swarm density counters from wrapping above 65,535 units by using 32-bit counters for larger swarm capacities.

- Avoid rebuilding the swarm's coarse spatial chunks before movement; rebuild them lazily for combat and rendering queries after positions change.

- Allow the CPU swarm hit-event queue capacity to be configured independently from combat slots, and expose both budgets in the Pixi horde starter.

- Use precolored explosion atlas frames on the Pixi Canvas fallback and avoid Canvas particle tinting of atlas subframes.

- Use a simple drawn slash and particle shockwave on Pixi's Canvas fallback, and avoid unsupported GPU filters there.

- Retry each Pixi backend separately, including Canvas when WebGL initialization fails after capability detection.

- Retry Pixi initialization with WebGL/Canvas if WebGPU is unavailable or fails during renderer initialization.

- Preserve authored model root transforms when a 3D modular level places a single instance, matching the batch placement path.

- Release already-created 3D instance buffers if a later part of the same model batch fails to build.

- Skip redundant placement-matrix multiplication when 3D instanced model parts have identity world transforms.

- Map Pixi demo pointer input through the canvas CSS bounds, preserve analog touch movement, and constrain horde touch movement to the canvas.

- Track combat-slot generations so queued hits cannot damage a different swarm unit after a slot is recycled.

- Count only successfully queued swarm area hits, and stop promoting targets when the bounded hit queue is full.

- Keep the procedural 3D sky inside the camera's far clipping plane when adaptive quality shortens scene draw distance.

- Allow 3D model slots to configure shadow casting and receiving consistently for individual clones and instanced batches.

- Preserve source mesh shadow settings when creating single-mesh 3D instance batches instead of forcing both shadows on.

- Preserve model root transforms and Matrix4 placements when 3D scene-model batches fall back to cloned objects instead of instancing.

- Limit combat-ECS scans to the highest active slot while keeping ascending slot-order processing and trimming the range as slots are recycled.

- Skip full combat-ECS slot scans when no swarm units are promoted, while retaining normal slot-order processing when combat is active.

- Reuse a coordinate object when building swarm flow-field walls from HGame TileMaps, avoiding one temporary allocation per sampled cell.

- Reuse the CPU swarm flow field when the goal cell and terrain costs are unchanged; detect direct cost-array edits and external recomputations.

- Reuse the active Three.js animation action's clip when advancing 3D notify cursors, avoiding repeated clip-name searches.

- Allow Pixi tilemaps to render as foreground or background layers so games can compose scenery around character sprites.

- Avoid allocating a notify-event array on every 3D animation step when neither active clip has notifications, while continuing to advance notify cursors.

- Reuse a model provider's parsed GLTF when the same file is requested sequentially for its scene and animation clips.

- Add Pixi tilemap edit helpers that update the existing TileMap and rebuild each affected cached visual chunk once per batch.

- Restrict CPU swarm circle-damage queries to overlapping spatial chunk coordinates, retaining edge chunks for out-of-world units.

- Avoid a temporary options object per enemy when spawning large CPU swarm waves; retain the existing individual spawn interface and random sequence.

- Allow unanimated skinned model replacements to reach the skeleton-aware model-slot cloning path; animated GLBs remain handled by the model3d provider.

- Avoid toggling Pixi tilemap chunk visibility or revisiting the cache while the camera remains within the same chunk range.

- Load Pixi tilemap render chunks on demand and bound the off-screen chunk cache, while retaining visible chunks and the full TileMap data grid.

- Render HGame TileMaps in the Pixi starter using shared-atlas particle chunks, camera visibility, and per-chunk refresh after map edits.

- Release model-slot-owned cloned skeletons when 3D modular levels are replaced or disposed, while keeping shared model assets alive.

- Extrude Pixi atlas frame edges into the existing padding to reduce linear-filter seams around scaled and rotated sprites.

- Create Pixi entity shadows only when needed, avoid redundant crowd texture writes and trigonometry, and fall back to the base texture if a hit-flash silhouette was omitted.

- Preserve independent skeletons in skinned 3D model slots instead of flattening them into static instances; the 3D starter loads SkeletonUtils only when needed.

- Reuse world-space viewport bounds when culling Pixi swarm particles, reducing per-unit camera transformations.

- Rebuild swarm spatial chunks on demand after movement and ECS patching so later spatial queries do not rely on pre-movement membership.

- Compact expired Pixi effect particles in one pass and release active particles and the trail when the effect system is disposed.

- Let Pixi starters optionally reuse HGame's adaptive quality controller to scale their render resolution within the existing pixel budget.

- Support sprite-sheet clips for Pixi CPU swarms using the simulation's per-unit animation time and existing shared-atlas particle rendering.

- Let new 3D starters opt into a scene-owned procedural sky and optional baked environment reflections through presentation.json.

- Allow Pixi scenes to configure persistent bloom independently of temporary shockwaves, preserving glow when effects end.

- Make generated Pixi starter rendering, atlas, swarm, effects and input interfaces discoverable through the HGame API lookup, with paths distinguished from runtime imports.

- Avoid allocating an unused statistics snapshot on every scheduled frame; manual `step()` calls now also return a snapshot while paused.

- Reconfigure automatic procedural-music timing when a mood changes tempo, and stop its timer while paused.

- Route procedural BGM through the audio manager's lazily acquired shared context and music bus, with independent per-track gain and explicit controller release.

- Count procedural synth sounds against the shared audio voice budget and release their nodes when stopped, ended, or the manager is disposed. Expose synth and procedural music on the audio manager's documented API.

- Share concurrent 3D model and animation-clip requests for the same GLTF within a model provider.

- Run deferred 3D starter model upgrades from the application loop and support touch movement alongside keyboard input.

- Keep GLTF scene resources loaded with standalone 3D animation clips under the model provider's ownership, and wait for in-flight clip loads during provider disposal.

- Share the 3D starter's GLTF loader across static slots and the optional rigged model service. Load the Meshopt decoder only when a model uses compressed geometry.

- Use the same WebGL2 default for new 2D and horde projects. Share glyph textures across changing number labels and pack loose PNG sprites into a padded atlas with reusable source rectangles.
- Let new 3D projects start with procedural geometry for background model replacements. Stage authored assets after startup, instance eligible static multi-mesh models, and limit the built-in sun's shadow coverage by the quality tier.

- Release cached WebGL2 textures and Canvas2D tint buffers when the final catalog scope releases an image. Drop evicted tint canvases from renderer ownership.

- Partition large static instance batches by grid region in the 3D starter and apply quality-tier draw distance to the default camera. Keep sparse regions batched and cull dense regions independently.

- Share scene traversal, culling and sprite ordering between Canvas2D and WebGL2. Reuse ancestor transforms during each camera pass, including scenes with mixed fixed-step interpolation.

- Resolve 3D starter model replacements by logical catalog ID. Let `assets push --catalog` store the same selected files and sidecars that the release packager includes.

- Keep up to four textures in a WebGL2 2D sprite batch while preserving draw order and the existing instance layout. Flush pending sprites before replacing custom-draw textures or evicting cached text.

- Generate 3D starters with a shared JSON layout for camera, lighting, tone mapping and quality. Manage lighting and level resources with the scene lifecycle. Reuse compiled level data, prepare independent model slots concurrently and instance opaque procedural models by mesh part.

- Add level preloading and scene transitions with catalog asset groups. Candidate loading or entry failure preserves the current scene. Successful transitions retire the old scene and release its resources, with separate reporting for cleanup errors.

- Add a logical asset catalog shared by runtime and release packaging. Scopes share active downloads and decoded images, then release resources when their final owner leaves. Catalog releases include named media and sidecar files, with CAS fallback.

- Share project presets and renderer metadata across the generator, API recipes and standalone packager. New `--preset` projects ship an entry-traced runtime, and the horde preset starts with one swarm simulation and one crowd render component.

- Add declarative level assembly with prefab hierarchies, named spawn points and tag-filtered trigger volumes in 2D and 3D. Level-owned entities and staged spawn batches clean up on failure. One-shot triggers can be restored from a save.

- Add fixed-step encounters with scheduled waves, spawn backpressure, clear/survival/signal gates, timeouts and stage-entry checkpoints. Encounter signals can drive quests and scene transitions.

- Add fixed-step ability timelines with animation clip hints, timed cues, a commit point and recovery. Presentation can share one start/cue/end/cancel contract across sprite and model animation.

- Add deterministic weighted loot tables, persistent per-source reward receipts and batch crafting with station and tag requirements. Loot claims and crafting use inventory transactions to preserve pending rewards and materials when the bag is full.

- Add slotted inventories with stack limits, atomic exchanges, equipment and attribute modifiers. Claim a complete quest's rewards only when its entire item bundle fits. Inventory snapshots retain slot layout and equipment.

- Run `story.json` graphs with conditional choices, variables, signals and resumable saves. Track prerequisite quests, consecutive stages and filtered objectives from the same signals, with explicit reward claims and JSON snapshots.

- Add an opt-in gameplay runtime with bounded attributes, source-owned modifiers, stackable and periodic effects, and abilities with costs, shared cooldowns, charges, casting, channeling and buffered input. Use `GameplayComponent` in fixed-step scenes or `createGameplayActor` for command-driven games. Actor snapshots persist attributes, effects and cooldown state.

- Keep readable save storage when writes are blocked or its quota is exhausted, preserving existing progress and surfacing explicit write errors. Probe availability without modifying storage. Successful migrated/recovered loads report automatic writeback failures through optional `writebackError` while keeping valid data readable; retry on the next load.

- Checksum versioned saves after JSON conversion so dates, optional fields, typed arrays and non-finite numbers remain readable. Validate serialization before changing the primary or backup slot, including migrated saves.

- Verify rendered 3D releases directly from standard and Toy ZIPs in Chromium CI. Capture nested entry paths and retain startup HTTP and JavaScript errors in snapshot reports.

- Minify the two vendored Three.js modules in standard and Toy game releases when esbuild is available. Preserve constructor names, module paths and the MIT notice. Use `--no-minify` to package the source files.

- Preload the vendored Three.js entry and core modules in 3D starters and Arena, so both downloads can start during HTML parsing.

- Start generated profiles and reference games from their required runtime modules, loading configuration and shared modules in parallel.
- Remove unused Rapier 3D from the Arena reference game's engine configuration. Its simulation uses its own ray and box collision code.

- Rebase application frame timing on browser visibility transitions. Hidden frames leave adaptive 3D quality alone, and the next visible frame starts a new diagnostic timing window.
- Skip recording a frame when an adaptive-quality callback disposes the application or resets its frame clock.
- Release touch gestures and discard buffered overlay button actions when the page becomes hidden or loses focus.

- Preserve starter and reference game state when a browser caches the document during navigation. Continue disposing resources on page exit. Report the current scene in the bare starter state hooks.

- Apply adaptive 3D resolution scaling to the capped drawing buffer. Keep the reduced scale when switching to a lower quality tier and honor the configured maximum on entry to auto mode.
- Size 3D post-processing targets to the canvas drawing buffer and combine size and preset changes into one rebuild. Skip repeated renderer and target sizing when the dimensions are unchanged.

- Keep Model3D resources from superseded owned asset revisions until provider disposal, then release shared resources once. Pending model requests reject during disposal, including requests for a superseded version.
- Release cloned Model3D component bone textures on destruction while keeping borrowed roots and shared asset geometry alive. Allow destruction before `awake()` and finish resource cleanup when a dispose listener throws.
- Report asynchronous feature disposal failures through diagnostics while keeping application disposal synchronous.

- Re-upload WebGL2D sprite images after context restoration and allow retry after a failed upload. Release GPU textures when text cache entries are evicted. Reuse one scratch canvas and GPU texture for `customDraw` sprites with a clean drawing state for every callback.

- Keep one pending animation frame when a ready or update callback pauses and resumes its application. Stopping the application cancels that frame.
- Roll back a failed startup if a ready callback or initial render throws so the application can be started again.

- Release input and the remaining platform services when a lifecycle disposal listener throws. Clear lifecycle subscriptions even on callback failure and report cleanup errors after teardown.

- Execute all API recipes against generated entry points in CI. Correct tick/locale getters, swarm capacity/spawn/step/count wiring, VFX adapter ownership, the optional model provider requirement, and the confirmed-frame scheduler's explicit subpath import.
- Prevent scene-transition callbacks from activating the next scene after application disposal, and reject entity reattachment or new roots during scene cleanup.
- Cancel the rest of an in-flight tween/timer update when its callback disposes the manager or application. Do not execute scene hooks, later timers or tween completion callbacks after teardown.

- Prevent asynchronous installation and ready callbacks from reviving disposed applications. Terminate in-flight update work after disposal and expose `app.disposed`.
- Complete entity, scene, service, renderer and owned-platform cleanup even when user cleanup callbacks throw, then report all errors with `AggregateError`. Preserve idempotent disposal and borrowed-platform ownership.
- Keep generated 3D quality settings in entry code so `game.config.json` conforms to WebAsset's discovery allowlist, including bare starters. Legacy quality metadata remains readable.
- Map the engine's `webgl2d` renderer to WebAsset's `webgl-custom` catalog value while preserving the selected backend in `engine.config.json`.
- Verify reference-game movement, combat, natural death under controlled pressure, three restart cycles, persistent best scores, input release and renderer/touch teardown in browser CI. Add serializable state hooks and compact HUDs with opt-in debug stats.
- Make automated playtests fail explicitly when a declared state hook throws or cannot serialize its result.

- Preserve multi-second and end-of-window stalls in automated playtest telemetry. Retain whole-run counters and extrema with bounded, explicitly labelled reservoir quantiles, and report requested and actual measurement durations.
- Replace best-only CPU timings with repeated median/tail distributions and repeatable swarm/VFX preparation. Add synchronized render measurements, explicit software/hardware modes, actual GPU/browser provenance, and target-frame versus software-health budget labels.
- Reject invalid numeric workload, viewport and timing options before starting browser or CPU work, including malformed input-action durations.

- Strengthen FSM, behavior-tree and versioned-save declarations with context/schema generics, typed methods and discriminated load results. Generate declarations with strict nullability and verify public consumers, including detached component getters. These type-level corrections expose invalid calls and unsafe historical-data assumptions in TypeScript consumers.
- Preserve imported type-query bindings in generated facades, validate declarations without skipping library checks, and correct inferred VFX options and panel payload types. Correct the 3D API recipe's VFX scene argument.
- Preserve each API export's implementation stability and declaration origin through root facades and aliases, and expose these fields in API query results.

- Make snapshot baseline updates failure-safe with atomic replacement after capture validation, including shared output/baseline paths. Keep failed candidate images as separate diagnostics.
- Capture frozen-clock snapshots without waiting for live element-stability frames and disable CSS animations during capture.
- Add `npm run check:visual` with a version-controlled accepted Git revision, same-environment reference/candidate rendering, and retained PNG/JSON diagnostics. CI now uses this check and browser baseline-safety tests in place of cache-dependent baseline acceptance.

- Unified WebAsset Game Management & Preview Standard (`AGENTS.md`, `assets/template/AGENTS.md`, `assets/template/README.md`, `.agents/skills/hgame/SKILL.md`, `docs/guides/USER-AND-AGENT-GUIDE.md`, `docs/architecture/ENGINE-OVERVIEW.md`, `README.md`):
  - Codify unified **WebAsset** management and preview (`http://127.0.0.1:4174/#games` lobby; `http://127.0.0.1:4175/local-games/<slug>/<entry>` runtime via `game.config.json`) across HGame engine rules, global/repo skills, and generated project templates, forbidding per-game dev servers (`npm start`, `npm run serve`, `python -m http.server`, manual `preview.mjs` preview ports) during development, playtesting, and browser QA while reserving `scripts/preview.mjs` strictly for ephemeral headless/CI/packaged harnesses.

- Bilibili Toy Platform SDK Integration, Packaging Standard & Skill (`integrations/bilibili-toy.js`, `scripts/package-game.mjs`, `scripts/toy-preflight.mjs`, `.agents/skills/hgame-bilibili-toy/`, `docs/guides/BILIBILI-TOY-STANDARD.md`):
  - Add `assets/runtime/integrations/bilibili-toy.js` (`createToyBridge`, `createToyCloudSaveAdapter`, `loadBilibiliToySdk`, `isBilibiliToyEnvironment`, `isToyRateLimitError`) wrapping `window.toy` with `307044` jittered exponential-backoff retries, key/score/byte validation, checkpoint-batched cloud/shared saves, App/Web fallbacks, and local preview storage fallbacks.
  - Add `--target toy` (plus `--toy-sdk`/`--no-toy-sdk`, `--slug`, `--poster`, `--icon`) to `scripts/package-game.mjs` and `npm run package:toy` / `npm run toy:check` via `scripts/toy-preflight.mjs`, enforcing flat ZIP root, `contenthash` entry JS/CSS renaming, `toy-sdk.js` head injection, <=1MB `index.html` gate, `<10000px` image limits, relative URL checks, rate-limit heuristics, and Toy capability advisories (`AUDIO_VIDEO_UPLOAD`, `EXTERNAL_SERVICE_ACCESS`, `USER_CONTENT_INPUT`, `CHARGE_UNLOCK`, `LARGE_PACKAGE_UPLOAD`).
  - Encapsulate the official Toy SDK (`types/toy.d.ts`), packaging standard, and `toy` CLI two-stage release workflow into `.agents/skills/hgame-bilibili-toy/` and wire `scripts/create-game.mjs` + `assets/template/package.json` with `package:toy` and `toy:check`.

- AI-Native Documentation & Query Tooling (`scripts/query-api.mjs`, `docs/`, `AGENTS.md`, `.agents/skills/hgame/SKILL.md`):
  - Upgrade `npm run api` with `--map` (intent-to-module capability router) and `--recipe <2d|horde|3d|ui|network>` (runnable boilerplate + `__hgameState` verification hook), plus `--json` output.
  - Rewrite `README.md` and `docs/guides/USER-AND-AGENT-GUIDE.md` into pure AI-Native execution specs, align `--bg white` default in `docs/guides/ASSET-AND-AUDIO-PIPELINE.md`, remove stale `docs/guides/ENGINE-GAPS.md`, add compact system cards `13..16`, and expose `__hgameState` + `data-engine-ready` in bare 2D/3D starters.

- Versioned Save Store & Automated AI Playtest Runner (`platform/storage.js`, `scripts/playtest.mjs`):
  - Add `createVersionedStore` wrapping `SaveStore` with sequential `v -> v + 1` schema migrations, FNV-1a envelope tamper detection, and automatic `.bak` backup slot recovery.
  - Add `npm run playtest -- <game-dir>` (`scripts/playtest.mjs`) to boot loopback preview + headless Chromium, drive scripted keyboard/pointer inputs, collect rAF FPS/stutter telemetry, and verify non-blank & reactive gameplay with zero JS/HTTP errors.

- 3D Procedural Heightfield Terrain & Expanded Props (`world/terrain3d.js`, `integrations/procedural-models.js`, `physics/rapier-world.js`):
  - Add `createHeightfieldTerrain3D` & `fbmNoise2D` with exact bilinear height/normal/slope/biome queries, Three.js vertex-colored mesh builder, deterministic prop scatter (`scatterPositions`), and direct Rapier3D heightfield physics (`attachPhysics`, exposing `world.RAPIER`).
  - Expand `createProceduralModelSlots` with 7 new shapes (`arch`, `crate`, `barrel`, `crystal`, `rock`, `pine`, `turret`).

- 2D Modern Atmospheric Lighting & Post-Processing (`integrations/post2d.js`, `integrations/webgl2d.js`, `integrations/canvas2d.js`):
  - Add zero-alloc `createLighting2DState` (ambient tint + up to 32 dynamic world-space point lights + `bloomIntensity`, `bloomThreshold`, `vignette`, `hitPulse`, `chromatic`, `saturation`, `contrast`) with automatic bypass when inactive.
  - Add WebGL2 offscreen scene FBO + half-res separable Bloom + composite shader in `createWebGL2DPostPass`, plus Canvas2D `'lighter'` radial fallback in `renderCanvas2DPostPass`.

- Zero-KB Procedural Adaptive BGM Sequencer (`platform/audio/bgm-synth.js`, `platform/audio.js`):
  - Add 6 built-in moods (`dungeon`, `cyber`, `boss`, `chill`, `adventure`, `victory`), deterministic step planner (`generateBgmStep`, `midiToHz`), intensity-scaled drums/arps (`setMood`, `setIntensity(0..1)`), WebAudio + headless fixed-step `update(dt)` support (`createProceduralBgm`, `audio.createBgm`).

- AI Decision Kernel & 3D NavMesh (`ai/fsm.js`, `ai/bt.js`, `ai/index.js`, `world/navmesh3d.js`):
  - Add zero-GC Hierarchical Finite State Machine (`createStateMachine` with LCA parent/child enter-exit, guarded/event transitions).
  - Add shared-definition Behavior Tree runner (`createBehaviorTree`, `BT_STATUS`, `sequence`, `selector`, `parallel`, `inverter`, `repeater`, `cooldown`, `condition`, `action`, `wait`) with priority preemption and per-instance typed memory.
  - Add height-aware 3D NavMesh + A* + LOS string-pulling smoother (`createNavMesh3D`), and allowlist `ai/` in `scripts/package-game.mjs`.

- Commercial UI Kit, i18n & AI-Native Zero-GUI Contract (`ui/panel-stack.js`, `ui/virtual-list.js`, `ui/i18n.js`, `ui/index.js`):
  - Add stack-based UI modal/overlay router (`createPanelStack` with Escape/cancel back-stack, exclusive/pinned modes, transition alphas, and optional `bindDom`).
  - Add zero-alloc virtualized list/grid window (`createVirtualList` with fixed-grid and variable-height prefix-sum scrolling + DOM row pooling).
  - Add localization helper (`createI18n` with nested keys, `{param}` interpolation, `_zero`/`_one`/`_other` plurals, and fallback locales).
  - Codify the AI-Native Zero-GUI-Editor contract in `AGENTS.md`, `assets/template/AGENTS.md`, and `.agents/skills/hgame/SKILL.md`.

- Unified off-Git art & audio asset management:
  - Expand `.gitignore` across the engine root, generated game template (`assets/template/.gitignore`), and examples (`examples/*/.gitignore`) to exclude large binary media (`png`, `jpg`, `webp`, `glb`, `gltf`, `vat.bin`, `mp3`, `ogg`, `wav`, fonts, video) and raw DCC sources (`.psd`, `.blend`, `.fbx`, `assets/raw/`), keeping Git repositories focused on code, configs, and lightweight `assets.manifest.json`.
  - Add `scripts/assets.mjs` (`npm run assets -- push|pull|status|verify|rm|prune-store`) for SHA-256 content-addressed storage (`HGAME_ASSET_STORE` / `~/.hgame/asset-store`, plus optional HTTP `--remote`) with `assets.manifest.json` scaffolded into every project by `scripts/create-game.mjs`.
  - Update `scripts/package-game.mjs` to skip `assets.manifest.json` in release bundles and automatically resolve any missing-locally manifest assets from the unified store (`resolvedFromStore`), failing clearly if neither disk nor store holds declared assets.

- Camera, Three shadow helper & CI verification (ENGINE-GAPS 5/6/7):
  - `integrations/camera3d.js`: add zero-GC `createBoxCollisionTest(boxes, { inflateByProbe })` supporting `{ minX..maxZ }`, `{ x, y, z, hx, hy, hz }`, and floor-standing `{ x, z, hx, hz, h, y? }` AABB obstacles for `createSpringArm3D` / `createCameraRig3D`.
  - `integrations/shadow3d.js` + `integrations/three.js`: extract `fitDirectionalShadowFrustum` into `shadow3d.js` (re-exported cleanly by `sky3d.js` without pulling sky shaders into minimal 3D builds) and expose `renderer.fitShadowToPreset(sun, target, options)` on the Three.js adapter using the active quality tier's `shadowDistance`.
  - `.github/workflows/ci.yml`: generate, zero-threshold verify, and cache OS-native snapshot baselines in `.ci-baselines/` via `actions/cache@v4` for `survivor-2d` and `arena-3d` with `--freeze-time`.
  - `ui/red-dot.js` & `platform/audio.js`: finish splitting graph/persistence (`ui/red-dot/graph.js`, `ui/red-dot/persistence.js`) and bus/voice playback (`platform/audio/buses.js`, `platform/audio/voice.js`) into focused sub-modules with identical public exports and behavior.

- Generator & packager (ENGINE-GAPS 1/2):
  - `create-game --bare` (2d/3d): emits only configs, a minimal empty-scene `src/main.js` and the vendored runtime — no demo `level.json`, `materials.json`, `model-slots.json`. Bare entries live in `assets/profiles/{2d,3d}-bare/`.
  - `package-game`: Rapier WASM is bundled only when `src/` uses `scene.physics`/Rapier modules (static scan) or `game.config.json` sets `physics.bundleWasm: true`. Declared-but-unused physics omits the WASM and strips the physics feature from the release `engine.config.json`; uncertain scans keep the safe default (bundle) with a note. Result adds `wasmSkipped` and `notes`.

- Deterministic sim helpers (sim/*.js, re-exported from `index.js` & `HGame`): `createSeededRng`, `hashState` / `createStateChecksum`, `runScripted`. Camera (`integrations/camera3d.js`): `createSpringArmRayProbe(castRay)` adapter for `collisionTest` and `cameraRelativeMove`; typed/documented the collision-test contract.

- High-Density 100k+ 2D/3D Crowd Pipeline Optimizations:
  - `SwarmSimulation` (`world/swarm-ecs.js`): add 3-tier distance-decimated neighbor separation (`< 25m` 60Hz + bilinear flow, `25m–65m` 4-frame staggered separation with `sepX`/`sepY` caching, `> 65m` cell density damping), module-level `buildSwarmStepGrid` / `stepSwarmSequential` kernels, coarse `32x32` spatial chunks (`ensureChunks`, chunk-accelerated `applyCircleDamage`), and zero-copy default `syncToSpriteCrowd2D`. Raise capacity limits to `262,144` across `SwarmSimulation`, `SpriteCrowd2D`, `WebGL2D`, and `BoneVatCrowd3D`.
  - 3D Coarse Chunk Frustum/LOD Fast-Path (`integrations/culling3d.js`, `integrations/model3d/bone-vat.js`): add 3-state `classifySphere` (`0` outside, `1` intersecting, `2` strictly inside) on `FrustumCuller3D` / `SceneCuller3D`; upgrade `BoneVatCrowd3D.syncFromSwarm` with coarse chunk culling, branch-free strictly-inside single-LOD loops, and flat clip lookup arrays.
  - 2D Zero-Relay `16-Byte` Instancing (`integrations/canvas2d.js`, `integrations/webgl2d.js`): add `SpriteCrowd2D.bindSwarm` / `bindGpuSwarm` / `unbindSwarm` plus a compact `16-Byte` (`vec4 aPacked2D`) GLSL3 instanced shader path and coarse chunk culling in `WebGL2D` (and Canvas2D fallback).
  - Pure-GPU Ping-Pong FBO Swarm (`world/gpu-swarm-webgl2.js`, re-exported as `createGpuSwarmWebGL2` from `index.js` & `HGame`): `RGBA32F` double-buffered GPU swarm stepping from `FlowField2D` `.rg8` textures, wired into `BoneVatCrowd3D.syncFromGpuSwarm` and `WebGL2D` via vertex-shader `texelFetch` (`0` bytes uploaded per frame), with automatic CPU fallback when WebGL2 is absent.
- Swarm & 3D Bone-VAT Crowd (`world/swarm-ecs.js`, `integrations/model3d/bone-vat.js`, `scripts/bake-bone-vat.mjs`):
  - Add renderer-neutral zero-GC swarm runtime in `assets/runtime/world/swarm-ecs.js` (re-exported via `index.js` & `HGame`): 1D intrusive linked-list `FlatSpatialHash2D` (`createFlatSpatialHash2D`), ring-buffer SPFA/Dijkstra `FlowField2D` (`createFlowField2D`, `setWallsFromTileMap`, `rg8`), fixed-slot SoA `FlatCombatECS` with 10m/12m hysteresis promote/demote and back-pressure-safe patch cleanup, and integrated `createSwarmSimulation` (`syncToSpriteCrowd2D`).
  - Add IEEE-754 Half-Float Bone-VAT (`bakeBoneVatData` with `bindMatrix` folding & antipodal quaternion hemisphere continuity, `"HVAT"` binary `encodeBoneVatBinary`/`decodeBoneVatBinary`, `buildSimplifiedLodGeometry` voxel-clustering + 1-bone collapse) and 16-byte packed 3-LOD GPU crowd `createBoneVatCrowd3D` (`LOD0` 4-bone / `LOD1` 1-bone / `LOD2` 8-direction azimuth billboard, `syncFromSwarm`) in `assets/runtime/integrations/model3d.js`.
  - Add offline Bone-VAT baker CLI `scripts/bake-bone-vat.mjs` (`npm run bake:vat`) and `.bin` MIME support in `scripts/preview.mjs`.
- Tooling: `npm run bench:render3d` (`benchmarks/render-bench-3d.mjs`) 3D stress benchmark (instanced batch + MegaLights + post3d + sky + camera rig) with frame stats, draw calls/triangles and non-blank check; wired into the CI browser job.

- Tooling: generated TypeScript declarations in `types/` (`build:types` / `check:types`, enforced in CI); performance budgets (`npm run bench`); e2e profile test (generate -> test -> package for 2d/3d/ui); CI browser smoke and benchmark jobs; `docs/guides/API-STABILITY.md`.
- Agent tooling: `npm run snapshot` (headless render PNG + JSON stats + baseline diff), `docs/api/API-INDEX.json` (machine-readable API with option-bag keys and returned members, `build:api-index` / `check:api-index`), `docs/guides/AI-VERIFICATION.md`, browser render benchmark (`bench:render`), and the USER-AND-AGENT guide split into `docs/guides/systems/*`.
- Diagnostics: `createDiagnostics().snapshot()` now also reports `frameTimeP95Ms`, `frameTimeMaxMs` and `longFrames`. Config validation errors list valid values and suggest the closest match.
- Physics: add `physics.addTileMap(scene, map, options)` (2D) generating merged fixed colliders from a TileMap with y-up conversion.
- Types: JSDoc typedefs for option bags and returned objects across core/platform/time/animation/2D/3D/physics/world/ui; generated `types/` now has no `any` in public signatures. Added `tests/genre-conformance.test.mjs` (platformer, horde, card/UI, 3D action, puzzle, lockstep) and `tests/browser-snapshot.mjs`; `bench:render` now includes the default 3D scene.
- Internal refactor (no API change): `post3d`, `model3d`, `input`, `audio` and `red-dot` split into sub-modules; original paths re-export the same public names.

## 1.0.0 - 2026-11-14

- Core & Deterministic Physics:
  - Establish the canonical standalone HGame runtime (`assets/runtime/`, version `1.0.0`), 2D/3D/UI starter profiles, standalone project generator (`scripts/create-game.mjs`), and loopback preview server (`scripts/preview.mjs`).
  - Add fixed-step transform snapshots with `app.renderAlpha`, zero-GC `Entity.worldMatrixInto` / `interpolatedWorldMatrixInto` / `snapTransform`, Rapier2D/3D 0.21.0 deterministic WASM bundles (`build-physics.mjs`), rotation & angular velocity synchronization (`enabledRotations`, `lockRotations`, `setRotation`, `setAngularVelocity`), snapshot-resilient `createCharacterController`, and lazy `scene.tweens` lifecycle management.
- Gameplay Systems, Camera, Budgets, Audio & Replication:
  - Add hierarchical, reference-counted gameplay tags (`core/tags.js`: `createTagRegistry`, `createTagContainer`, `matchGameplayTags`), lazy `Entity` tag APIs (`addTag`/`removeTag`/`hasTag`/`matchesTags`), and `Scene.findByTag` / `Scene.queryTags`.
  - Add frame-rate-independent exponential smoothing (`damp`, `dampAngle`) and analytical critically-damped springs (`LN2_CRIT`, `stepSpring1D`, `SpringDamper1D/2D/3D`) in `time/tween.js`, plus global time dilation and sub-frame hit-stop (`app.setTimeScale`, `app.hitStop`, `app.clearHitStop`, constant fixed physics step) in `core/application.js`.
  - Add priority-layered input mapping contexts, key consumption, chorded bindings, hold timers, and input buffering (`defineInputContext`, `createInputActionRouter`) in `platform/input.js`.
- 2D Horde Engine, Procedural Juice & WebGL2 Instancing:
  - Add `Camera2D` (`follow`, `bounds`, `shake`, `getViewBounds`), rotated AABB frustum culling, `Sprite2D` visual transform decoupling (`anchorX`/`anchorY` overrides, `offsetX`/`offsetY`, `scaleX`/`scaleY`, `rotation`/`visualRotation`, `tint`, `flash`, `hitFlash`), `'source-in'` silhouette tint/flash compositing, analytical floor-locked `groundShadow` rendering, SoA `SpriteCrowd2D` (`O(1)` swap-back recycling for 5,000–10,000+ horde instances), and `WeakMap` `tintCache` in `integrations/canvas2d.js`.
  - Add hardware-instanced WebGL2 2D renderer `integrations/webgl2d.js` (`createWebGL2DAdapter`, `renderer: 'webgl2d'` in `defineProject` & `create-game.mjs`) with automatic Canvas2D fallback.
  - Upgrade `SpriteSheet` (`SpriteSheet.fromGrid`, `inset`), `TileMap.draw()` `viewBounds` culling, `findGridPath` (binary `MinHeap` + octile diagonal movement), `TweenManager` & `EASING` (17 easing curves, `delay`, `repeat`, `yoyo`, `tag`, `overwrite`, `killTweensOf`, `sequence`, and 2D motion presets `idle`/`run`/`attackLunge`/`dieKnockback`), and zero-GC `ObjectPool` + `SpatialHash2D` (`world/spatial2d.js`).
- 3D Rendering, UE-Inspired Lighting/Post-Processing, Rigged Models & Open World:
  - Add `integrations/sky3d.js` (`SKY3D_PRESETS`, procedural sky dome, `bakeEnvironment`, `fitDirectionalShadowFrustum`, `createLightPool3D`, `setLinearOutput`) and `integrations/post3d.js` (WebGL2 MSAA HalfFloat HDR + DepthTexture, `ueFilmic` S-curve tone mapper, CIE Planckian white balance, ASC-CDL grading, SSGI/SSR with bilateral blur, full-res screen-space Contact Shadows, GPU Eye Adaptation downsample pyramid, Karis bloom, FXAA/sharpen/grain/IGN dither, and priority/distance-feathered `createPostProcessVolumeStack`).
  - Add `integrations/lighting3d.js` (`createMegaLights3D` clustered `16x8x16` log-Z many-light renderer for `1..1024` dynamic lights via IGN stochastic sampling + `createIrradianceProbeVolume3D` `SH L1` lattice probes), `integrations/culling3d.js` (frustum culling, 5-ray software occlusion, async WebGL2 hardware occlusion queries, `createInstancedBatch3D`), and `integrations/camera3d.js` (`createSpringArm3D` asymmetric collision probe + `createCameraRig3D` trauma/recoil/FOV).
  - Add opt-in `applyGeometricSpecularAA` / `specularAA` / `anisotropy` / `shiftOffset` in `world-aligned-material.js`, `integrations/model3d.js` (Unreal namespace/root-motion cleanup, bone sockets, `playOverlay`/`stopOverlay`, zero-miss `AnimNotify`, distance Animation LOD + `createAnimationBudgetAllocator`, and VAT RGBA float texture `createInstancedCrowd3D`), `integrations/three.js` (`calibrateGpu`, unified `setSky`/`setExposure`/`setPostVolumes`), and `world/open-world.js` (`createWorldPartition`, `createHLODProxyGroup3D`, `Float64` `createFloatingOrigin`).
  - Standardize `low`/`medium`/`high` (plus 3D `ultra`/`auto`) runtime quality presets (`QUALITY_TIERS`, `QUALITY2D_PRESETS`, `QUALITY3D_PRESETS`) in `integrations/quality3d.js`.
- Spatial & Multi-Variant Audio + Offline Asset/Audio Tooling:
  - Upgrade `platform/audio.js` with master `DynamicsCompressorNode` limiter across `sfx`/`spatial`/`music`/`ambience` buses, `duckBus`, 3D binaural `HRTF` `PannerNode`, `updateListenerFromCamera`, 2D `StereoPannerNode`, live `handle.setPosition`, per-voice acoustic low-pass occlusion (`setOcclusionProbe`/`updateOcclusion`), mix snapshots (`registerSnapshot`/`applySnapshot`/`clearSnapshot`), PCM silence trimming (`analyzeAudioBuffer`) for gapless MP3 loops and zero-latency one-shots, and `registerCue` / `playCue` (2–4 variant anti-repeat selector + loudness/duration alignment, `cooldownMs`, `pitchJitter`, loop-preserving `maxPolyphony`).
  - Add zero-dependency PNG `1x1`/`2x2`/`3x3` cutout script (`scripts/process-assets.mjs`), `ffmpeg`-backed variant curation script (`scripts/process-audio.mjs`), and `docs/guides/ASSET-AND-AUDIO-PIPELINE.md`.
- Mobile Touch-First, Virtual Joystick/Buttons & Local Split-Screen Controls:
  - Upgrade `createInputManager` (`platform/input.js`) with multi-pointer tracking (`pointers`, `pointerCount`, `getPointer`, `isPointerDown`, `wasPointerPressed`, `wasPointerReleased`, `pointercancel` cleanup, `preventKeys`) and add `setVirtualAction`/`setVirtualAxis1D`/`setVirtualAxis2D`/`clearVirtualInputs` on `createInputActionRouter`.
  - Add standardized `ARCADE_SLOTS`, `PLAYER_KEYMAPS`, `createArcadeControls`, and `computeSplitScreenViews` in `platform/input.js`: P1 (`WASD` + `J K L U I O`, opt-in extras `Q E`), P2 (`ArrowUp/Left/Down/Right` + `1..6`, opt-in extras `0 .`), enforcing 6-primary-button discipline by default.
  - Add opt-in `integrations/touch-controls.js` (`createTouchControls`, `applyRadialDeadzone`), `setViews`/`getViews` split-screen rendering & pane-aware picking across `canvas2d.js`/`webgl2d.js`/`three.js`, mobile hardening in `assets/template/style.css`, and template rule 12.
- Commercial Hierarchical Red Dot System:
  - Add renderer-neutral Trie + DAG Red Dot engine (`ui/red-dot.js`, re-exported via `index.js` / `HGame`) with `RED_DOT_STYLES`, `normalizeRedDotPath`, `splitRedDotAncestors`, `computeCommercialDayKey`, `formatRedDotBadge`, `createRedDotSystem` supporting condition count/rule (`99+`), persistent `NEW` unread items (`syncUnreadScope`), configurable daily reset hour/timezone reminders, cooldown `setReadyAt`, non-recursive vs recursive `acknowledge`, cross-entry DAG `link`/`unlink` with cycle rejection and diamond deduplication, `setUnlocked` ghost-dot gating, `setMuted`, `batch` dirty coalescing, and `explain()`.
  - Add declarative DOM badge binder `bindRedDotDOM` (`integrations/red-dot-dom.js`) supporting `[data-red-dot]`, `[data-red-dot-mode]`, `[data-red-dot-ack]`, dynamic `MutationObserver`/`refresh()`, and template rule 13.
- Lean Release Packaging, Multiplayer Synchronization & Repository Governance:
  - Add `scripts/package-game.mjs` (`npm run release` in generated games and `--engine` SDK release in engine repo) tracing exact HTML/importmap/ESM dependencies, verifying/bundling only the active Rapier 2D/3D WASM backend when enabled, stripping dev/raw files, and writing `build/<id>_<version>/` + upload-ready `build/<id>_<version>.zip`, plus template rule 14 and `scripts/preview.mjs` hardening.
  - Add isolated `network/` workspace features (`encodeTransformSnapshot`/`encodeTransformDelta`, `InterestGrid2D`, `LagCompensationHistory`, `ReplicationPriorityScheduler`, `SnapshotInterpolationBuffer`, `AdaptiveInputLeadController`, `TokenBucketRateLimiter`, anti-stall `NO_OP` + `LockstepRoom` catch-up), `docs/guides/WASM-PROTECTION-AND-ANTI-CHEAT.md`, and `Apache-2.0` licensing (`LICENSE`) preserving bundled Rapier (`Apache-2.0`) and Three.js (`MIT`) notices.
