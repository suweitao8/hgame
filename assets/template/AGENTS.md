# Generated HGame Project Rules

1. `engine.config.json` is the authoritative runtime recipe. Load only the selected profile and declared optional features.
2. The self-contained runtime copy is in `vendor/hgame/`. Do not edit that copy as a substitute for changing the HGame source repository and regenerating/updating the project deliberately.
3. Keep game rules, AI, authoritative state, content, renderer code, and save schemas inside this game project.
4. Keep Git focused on code, configs, tests, and `assets.manifest.json`. Heavy art/audio binaries under `assets/` and raw authoring files (`.psd`, `.blend`, `.fbx`, `assets/raw/`) are excluded by `.gitignore`; sync them through the unified content-addressed store via `npm run assets -- push|pull|status|verify` (configure `HGAME_ASSET_STORE` or `--store <dir>`). `npm run release` automatically resolves missing manifest assets from the unified store when present.
5. The Application owns the only RAF and fixed-step scheduler. Do not create a second RAF or step physics from a renderer callback.
5. When physics is enabled, use deterministic Rapier 0.21.0 for the selected dimension. Offline and online modes do not select different physics backends.
6. UI projects are command-driven. Do not add an idle 60 Hz loop to cards, dialogue, or turn-based interfaces.
7. Respect this project's visual and interaction requirements. Do not add unrequested buttons, menus, overlays, or permanent instructional copy.
8. Keep this game in its own Git repository. Do not initialize Git in a parent workspace or modify sibling game projects.
9. A 3D display model or material change must not silently change collision, navigation, AI, or authoritative simulation data.
10. Record the exact tests and browser/device coverage performed; do not claim unsupported platform or lockstep guarantees.
11. Reuse built-in `vendor/hgame/` helpers instead of inventing custom loops or boilerplate: use `Entity` GameplayTags (`addTag`/`matchesTags`/`scene.queryTags`), `defineInputContext`/`createInputActionRouter` for prioritized buffered controls, `scene.tweens` and `SpringDamper1D/2D/3D` (`damp`, `app.hitStop`, `app.setTimeScale`), `Sprite2D` visual transforms (`offsetX`/`offsetY`, `hitFlash`, `groundShadow`), `SpriteCrowd2D` (`renderer: 'webgl2d'` for 5,000–10,000+ sprites), `SpatialHash2D` / `ObjectPool` for 2D swarms; use `createVfxSystem` (`vendor/hgame/vfx/index.js`) for zero-GC GPU particles, slash arcs, lightning bolts, SDF telegraphs, floating damage numbers, hitstop, and camera shake instead of external VFX PNGs or DOM popups; use `camera3d` (`createSpringArm3D`, `createCameraRig3D`), `culling3d` (`createInstancedBatch3D`, frustum/occlusion culling), `sky3d`, `post3d` (`ueFilmic`, SSGI/SSR, contact shadows, `createPostProcessVolumeStack`), `lighting3d` (`createMegaLights3D`, `createIrradianceProbeVolume3D`), `world/open-world.js` (`createWorldPartition`, `createHLODProxyGroup3D`, `createFloatingOrigin`), and `model3d` (`inspect`, `loadClips`, `playOverlay`, `attachToBone`, `addNotify`, `createBudgetAllocator`, `createCrowd` VAT instancing) for 3D; call `renderer.setQuality('low' | 'medium' | 'high' | 'ultra')` (plus `renderer.setSky`/`setExposure`/`setPostVolumes`) for unified quality and post-processing presets; and use `audio.playSynth` (`hit`/`slash`/`shoot`/`explosion`/`pickup`/`powerup`/`click`/`hurt`/`laser`/`jump` with `pitchJitter`) for zero-KB procedural SFX or `audio.registerCue` / `playCue` / `updateListenerFromCamera` plus `setOcclusionProbe` and `registerSnapshot`/`applySnapshot` for spatial, occluded, and multi-variant sound effects.
12. Cross-Platform Mobile + PC & Split-Screen Input Standard: design touch-first by default (`app.input` multi-pointer `pointers`, `isPointerDown`, `wasPointerPressed`) so phones and PC work without unrequested HUD overlays. Whenever gameplay needs a virtual joystick or skill buttons, use `HGame.createArcadeControls` + `createTouchControls` (`vendor/hgame/integrations/touch-controls.js`): Player 1 maps mobile virtual joystick <-> `WASD` (`KeyW/A/S/D`) and primary skill buttons <-> `J K L U I O` (`KeyJ/K/L/U/I/O`). Keep actions within these 6 primary slots (`j/k/l/u/i/o`) whenever possible, using extra slots `Q E` (`KeyQ/E`) via `extras` or `enableExtras: true` only when 6 buttons are genuinely insufficient. For local 2-player / split-screen games, set `players: 2`: Player 2 maps automatically to `ArrowUp/Left/Down/Right` + `1 2 3 4 5 6` (`Numpad1..6` and `Digit1..6`), with reserve extras `0 .` (`Numpad0`/`Digit0` and `NumpadDecimal`/`Period`), and pair with `HGame.computeSplitScreenViews` and `renderer.setViews(...)`.
13. Hierarchical Commercial Red Dot Standard: whenever a game has multi-page/tab navigation badges, unread `NEW` items, daily resets, cooldown reminders, or claimable reward counters, use `HGame.createRedDotSystem` (`vendor/hgame/ui/red-dot.js`) plus `bindRedDotDOM` (`vendor/hgame/integrations/red-dot-dom.js`). Organize UI badges by path (`Page/SubPage/Item`) and `link(...)` cross-entry DAG nodes so parent tabs aggregate child states automatically and remain lit until every active sub-page/sub-item is handled; never track red dots with flat boolean maps or ad-hoc manual DOM `.remove()` mutations.
14. Lean Release Packaging Standard: always produce uploadable game deliverables with `npm run release` (`node scripts/package-game.mjs --version <ver>`). It reads `engine.config.json`, `game.config.json`, HTML entries, and the real ES module dependency graph to copy ONLY the active runtime modules, verified Rapier 2D/3D WASM (if enabled), and runtime assets into `build/<id>_<version>/` plus `build/<id>_<version>.zip` (for example `build/lol_1_1/` and `build/lol_1_1.zip`). Never zip the raw project root containing `.git/`, `tests/`, `scripts/`, `AGENTS.md`, unused Three/Rapier bundles, or source art files.
15. Direct `main` Milestone Commits & Snapshot Self-Check: develop directly on `main` (do not create topic branches or isolated worktrees); commit every verified milestone immediately after `npm test` / `npm run check` passes and push to the configured remote (`git push`) right away. From the HGame engine root, verify visuals and state with `npm run snapshot -- <game-dir>`.

## Quick Module Map (from `src/main.js`)

| Capability | Import path from `src/main.js` | Key entry points |
|---|---|---|
| Core, Scene, Tags, Tween, Red Dot, Arcade Input | `../vendor/hgame/index.js` | `HGame.defineProject`, `createApplication`, `Scene`, `Entity`, `HGame.createSwarmSimulation`, `HGame.createGpuSwarmWebGL2`, `HGame.createArcadeControls`, `HGame.computeSplitScreenViews`, `HGame.createRedDotSystem`, `HGame.createFloatingOrigin`, `HGame.createWorldPartition` |
| 2D Canvas & Crowd (`10,000+`) | `../vendor/hgame/integrations/canvas2d.js` | `createCanvas2DAdapter`, `Camera2D`, `Sprite2D` (`groundShadow`, `hitFlash`), `SpriteCrowd2D` (`bindSwarm`, `bindGpuSwarm`) |
| 2D WebGL2 GPU Instanced (auto Canvas2D fallback) | `../vendor/hgame/integrations/webgl2d.js` | `createWebGL2DAdapter`, `Camera2D`, `Sprite2D`, `SpriteCrowd2D` |
| 2D SpriteSheet, Animation & Pathfinding | `../vendor/hgame/animation/spritesheet.js`, `player.js`, `../vendor/hgame/world/tilemap.js`, `spatial2d.js` | `SpriteSheet.fromGrid`, `AnimationPlayer`, `TileMap`, `findGridPath`, `SpatialHash2D`, `ObjectPool` |
| 3D Adapter, Sky, Lights, Post & Culling | `../vendor/hgame/integrations/three.js`, `sky3d.js`, `lighting3d.js`, `post3d.js`, `culling3d.js`, `camera3d.js` | `createThreeAdapter`, `createProceduralSky3D`, `createMegaLights3D`, `createIrradianceProbeVolume3D`, `createPostProcessVolumeStack`, `createInstancedBatch3D`, `createCameraRig3D` |
| 3D Rigged GLB, VAT Crowd & World PBR | `../vendor/hgame/integrations/model3d.js`, `world-aligned-material.js` | `createModel3DProvider`, `createInstancedCrowd3D`, `createBoneVatCrowd3D`, `createWorldMaterialPalette`, `applyGeometricSpecularAA` |
| Zero-GC VFX & Game-Feel | `../vendor/hgame/vfx/index.js` | `createVfxSystem`, `emitHitImpact`, `burstParticles`, `slashArc`, `lightningBolt`, `spawnTelegraph`, `popupNumber`, `screenPulse`, `CROWD_STATUS` |
| Deterministic Sim Helpers | `../vendor/hgame/sim/rng.js`, `checksum.js`, `script.js` | `createSeededRng`, `createStateChecksum`, `hashState`, `runScripted` |
| Touch HUD & Red Dot DOM Binder | `../vendor/hgame/integrations/touch-controls.js`, `red-dot-dom.js` | `createTouchControls`, `bindRedDotDOM` (`[data-red-dot]`, `[data-red-dot-ack]`) |
| Quality Presets (`low`/`medium`/`high`) | `../vendor/hgame/integrations/quality3d.js` | `renderer.setQuality('low' \| 'medium' \| 'high' \| 'ultra')`, `QUALITY2D_PRESETS`, `QUALITY3D_PRESETS` |
| 0-KB Synth & Spatial Audio | `app.services.audio` (or `../vendor/hgame/platform/audio/synth.js`) | `playSynth`, `createSynthSfx`, `SYNTH_PRESETS`, `decode`, `registerCue`, `playCue`, `updateListenerFromCamera`, `setOcclusionProbe` |

## Commands Inside This Project

```powershell
# Run project tests & syntax checks
npm test
npm run check

# Query engine API or run snapshot/skill validators via the HGame engine root (<hgame-repo>):
node "<hgame-repo>/scripts/query-api.mjs" <keyword>
node "<hgame-repo>/scripts/snapshot.mjs" .
node "<hgame-repo>/.agents/skills/hgame-balance-sim/scripts/sim-balance.mjs" --config <balance.json>
node "<hgame-repo>/.agents/skills/hgame-level-architect/scripts/check-level.mjs" --level <level.json>
node "<hgame-repo>/.agents/skills/hgame-narrative-branch/scripts/check-story-graph.mjs" --story <story.json>

# Preview over loopback HTTP (never open index.html via file://)
# Using HGame's preview.mjs or any static HTTP server from project root:
node "<hgame-repo>/scripts/preview.mjs" . --port 4176

# Build lean, uploadable deliverable in build/<id>_<version>/ + .zip
npm run release -- --version 1.1
```
