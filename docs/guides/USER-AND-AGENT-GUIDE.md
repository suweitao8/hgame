# HGame 1.0.0 AI Agent Execution Manual

> Pure AI-Native Contract: **Zero manual GUI editors**. Author all scenes, levels, balance tables, dialogue graphs, UI stacks, shaders, and audio parameters in code + declarative JSON, then verify via zero-dependency validators, `snapshot`, and `playtest`.

## 1. Lookup First (Zero Blind Scan)

Always run `npm run api` from the HGame repo root instead of reading `assets/runtime/` or `assets/optional/three/`:

```powershell
npm run api -- --map             # Capability router (Need -> Module -> Key APIs)
npm run api -- --recipe 2d       # Runnable wiring for: 2d | horde | 3d | ui | network
npm run api -- <keyword>         # Exact signatures, return fields & option keys
npm run api -- --module post2d   # Every export in one module
```

---

## 2. Two Directory Contexts

| Context | Key Files | Workflow |
|---|---|---|
| **HGame Engine Repo** | `assets/runtime/`, `scripts/create-game.mjs`, `docs/api/API-INDEX.json`, `.agents/skills/` | Create projects, slice AI art/audio, build `network/`, package any external game, run `npm run check:all` & `npm run release`. Never put game-specific rules/assets here. |
| **Standalone Game** | `engine.config.json`, `game.config.json`, `src/main.js`, `vendor/hgame/` | Author all rules, AI, levels, and save schemas in `src/` & `assets/`. Treat `vendor/hgame/` as a vendored copy. Run `npm test`, `npm run check`, `npm run release -- --version <ver>`. |

---

## 3. Project Generation Matrix (`scripts/create-game.mjs`)

| Game Type | Command (from HGame root; basename must be ASCII slug `[A-Za-z0-9_-]`) |
|---|---|
| **Standard 2D Action / Platformer** | `node scripts/create-game.mjs "<dir>" --profile 2d --with audio,save --name "Title"` |
| **2D Horde / Bullet-Hell (5k–150k+)** | `node scripts/create-game.mjs "<dir>" --profile 2d --renderer webgl2d --with audio,save --name "Title"` |
| **3D Action / Open World** | `node scripts/create-game.mjs "<dir>" --profile 3d --quality auto --with physics3d,model3d,audio,save --name "Title"` |
| **Card / Narrative / Commercial UI** | `node scripts/create-game.mjs "<dir>" --profile ui --with audio,save --name "Title"` |
| **Blank Scaffold (no demo assets)** | Add `--bare` (`2d` or `3d`). Preview config without writing: `--dry-run`. |

---

## 4. Curate Art & Audio & Sync Off-Git CAS

- **2D Actor Cutout**: generate 1K pure white `#FFFFFF` `3x3` grid sheets, shadow-free:
  `npm run process:assets -- --input sheet.png --grid 3 --bg white --mode actor --out-dir "<dir>/assets/actors"`
- **Audio Normalization** (when using real `.mp3`; otherwise skip and use `playSynth` + `createBgm` 0-KB synth):
  `npm run process:audio -- --cue hit --inputs t1.mp3,t2.mp3,t3.mp3,t4.mp3 --out-dir "<dir>/assets/audio/sfx"`
- **CAS Binary Store** (binaries stay out of Git via `assets.manifest.json`):
  `npm run assets -- push|pull|status|verify "<dir>"`

---

## 5. System Cards (Load On Demand Only)

| ID | Capability | Card |
|---|---|---|
| 01 | Core lifecycle, `renderAlpha`, `hitStop`, GameplayTags, `sim/` RNG/checksum | [systems/01-core-lifecycle-tags.md](systems/01-core-lifecycle-tags.md) |
| 02 | Tweens & `SpringDamper1D/2D/3D` | [systems/02-tween-spring.md](systems/02-tween-spring.md) |
| 03 | 2D Sprites, dynamic `groundShadow`, `SpriteSheet`, `TileMap` A* | [systems/03-sprite-2d-pathfinding.md](systems/03-sprite-2d-pathfinding.md) |
| 04 | 2D 5k–150k+ Swarms (`webgl2d`, `SpriteCrowd2D`, `swarm-ecs`, `gpu-swarm-webgl2`) | [systems/04-horde-2d.md](systems/04-horde-2d.md) |
| 05 | 3D `ueFilmic`, `sky3d`, `MegaLights3D`, `IrradianceProbeVolume3D` | [systems/05-render-3d-megalights.md](systems/05-render-3d-megalights.md) |
| 06 | 3D Post Stack, SSGI/SSR, Culling, GPU Instancing, `SpringArm3D` | [systems/06-post-culling-camera-3d.md](systems/06-post-culling-camera-3d.md) |
| 07 | 3D GLB Rigged Models, Bone-VAT Crowds, World-Aligned PBR, Open World | [systems/07-model-vat-open-world.md](systems/07-model-vat-open-world.md) |
| 08 | Unified Quality Tiers (`low` / `medium` / `high` / `ultra`) | [systems/08-quality-tiers.md](systems/08-quality-tiers.md) |
| 09 | Touch-First, Arcade P1 (`WASD+JKL UIO`) / P2 (`Arrows+123456`) & Split-Screen | [systems/09-touch-arcade-splitscreen.md](systems/09-touch-arcade-splitscreen.md) |
| 10 | Commercial Red Dot Tree (Trie + DAG + DOM Binder) | [systems/10-red-dot.md](systems/10-red-dot.md) |
| 11 | 2D Art Slicing, Spatial `HRTF` Audio & Multi-Variant Cues | [systems/11-art-audio-pipeline.md](systems/11-art-audio-pipeline.md) |
| 12 | Deterministic Rapier 2D/3D, `createTraceRecorder` & Multiplayer | [systems/12-physics-trace-network.md](systems/12-physics-trace-network.md) |
| 13 | AI Decision Kernel (`createStateMachine` HFSM, `createBehaviorTree`, `createNavMesh3D`) | [systems/13-ai-fsm-bt-navmesh.md](systems/13-ai-fsm-bt-navmesh.md) |
| 14 | 2D Atmospheric Lighting/Bloom (`post2d`), 3D Terrain (`terrain3d`) & 17 Props | [systems/14-post2d-terrain3d-props.md](systems/14-post2d-terrain3d-props.md) |
| 15 | Commercial UI Kit (`PanelStack`, `VirtualList`, `i18n`) & `createVersionedStore` | [systems/15-ui-kit-i18n-versioned-save.md](systems/15-ui-kit-i18n-versioned-save.md) |
| 16 | 0-KB Synth SFX (`playSynth`) & Adaptive BGM Sequencer (`createBgm`) | [systems/16-procedural-bgm.md](systems/16-procedural-bgm.md) |

---

## 6. Mandatory Constraints & Verification Pipeline

1. **Direct `main` Incremental Commits**: Develop directly on `main` (no topic branches/worktrees). Commit and `git push` immediately after each verified milestone.
2. **Single RAF Loop**: `app.start()` owns the only RAF + fixed step. UI profile (`tickHz: 0`) must use `app.dispatch(...)`, never a 60 Hz idle loop.
3. **3D Collision Separation**: Never derive collisions or gameplay truth from PBR visual meshes; keep explicit colliders / Rapier heightfield.
4. **Never Zip Raw Project**: Always release with `npm run release -- --version <ver>` / `npm run package:game -- <dir> --version <ver>`.
5. **Verification Commands**:
   - Logic + types + API index + physics: `npm run check` (or `npm run check:all` when touching `network/`)
   - Headless render PNG & state hook (`window.__hgameState`): `npm run snapshot -- <game-dir>`
   - Live input + FPS + pixel-change assertion: `npm run playtest -- <game-dir>`
   - Honesty: Never claim browser/device coverage unless Chromium/device checks actually executed.
