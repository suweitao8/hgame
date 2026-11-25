# HGame (AI-Native Universal Game Development Template & Production Kit, v1.0.0)

HGame is an opinionated, **AI-Native Universal HTML5 Game Development Template Kit** (**通用游戏开发模板套件**) built on a standalone, zero-GUI-editor 2D/3D/UI runtime. Unlike bare game engines that leave every project to reinvent menus, game loops, balance checks, visual cohesion, and sound feedback, HGame pre-defines and ships ready-to-use standards across **all 5 production pillars**:

1. **UI (`kit/game-shell-dom.js`, `hgame-ui-ux`, `ui/*`)**: Anti-Bloat Zero-Prose HUD shell (title, edge HUD `<= 10%`, whole-card choices, pause/result, hidden debug) with 3D hover tilt, ghost-trail bars, and Red Dot tree.
2. **Design / 策划 (`kit/blueprint.js`, `src/game.design.json`)**: Idea-to-Blueprint contract (`createBlueprintFromIdea`) with automatic Golden Triangle balance checks (`npm run blueprint:check`) and genre defaults (`action-2d`, `horde-2d`, `arena-3d`, `card-ui`).
3. **Gameplay (`kit/game-session.js`, `assets/archetypes/`, `gameplay/*`)**: Unified run flow (`title -> playing -> choice -> paused -> result`), combat/reward/wave hooks, hitstop, versioned save persistence, and playable genre archetypes.
4. **Art (`kit/art-themes.js`, `vfx/`, `scripts/process-*`)**: 6 unified cross-2D/3D/UI themes (`scifi`, `arcane`, `arcade`, `cyber`, `cozy`, `ink`), `ueFilmic` 3D lighting/sky presets, zero-GC VFX, and strict 2D/3D asset specs.
5. **Audio (`kit/audio-director.js`, `platform/audio/*`)**: 21-event SFX matrix with 0-KB synth defaults, spam cooldowns, adaptive BGM mood/intensity transitions, and drop-in `.mp3` cue overrides.

Provide a game idea -> generate/validate `game.design.json` -> scaffold an archetype -> focus purely on unique mechanics and content.

## AI Entry Points (Start Here)

- **Universal Template Spec**: [docs/guides/UNIVERSAL-GAME-TEMPLATE.md](docs/guides/UNIVERSAL-GAME-TEMPLATE.md) | [docs/guides/systems/25-universal-game-kit.md](docs/guides/systems/25-universal-game-kit.md)
- **Zero-Blind-Scan API CLI**: `npm run api -- --map` | `npm run api -- --recipe <kit|2d|horde|3d|ui|network>` | `npm run api -- <keyword>`
- **Workspace Rules & AI Runbook**: [AGENTS.md](AGENTS.md) | [assets/template/AGENTS.md](assets/template/AGENTS.md) | [.agents/skills/hgame/SKILL.md](.agents/skills/hgame/SKILL.md)
- **System Cards Index**: [docs/guides/USER-AND-AGENT-GUIDE.md](docs/guides/USER-AND-AGENT-GUIDE.md)

## Repository Layout

```text
assets/
  runtime/          # Canonical runtime + 5-pillar template kit (`kit/`, `ui/`, `gameplay/`, `vfx/`, ...)
  archetypes/       # Playable 5-pillar genre archetypes (action-2d / horde-2d / arena-3d / card-ui)
  template/         # Standalone generated project template
  profiles/         # Low-level 2d / 2d-bare / 3d / 3d-bare / pixi2d / ui starters
  optional/three/   # Bundled Three.js + MIT license (copied for 3D only)
scripts/
  query-api.mjs     # npm run api (--map, --recipe, --module, <keyword>)
  create-game.mjs   # Generate self-contained game project
  process-assets.mjs # Grid slicer & white/green/alpha cutout (default: --bg white)
  process-audio.mjs # Multi-variant SFX normalization (optional ffmpeg)
  assets.mjs        # Off-Git SHA-256 asset CAS (push/pull/status/verify)
  snapshot.mjs      # Headless Playwright render + state hook PNG/JSON verification
  playtest.mjs      # Automated keyboard/pointer playtest + FPS + pixel-delta check
  package-game.mjs  # ESM graph-pruned release packager (build/<id>_<ver>/ + .zip)
  preview.mjs       # Ephemeral loopback harness for headless QA/CI & packaged builds (live dev preview uses WebAsset :4174/:4175)
network/            # Optional multiplayer workspace (@hgame/*)
tests/              # Node runtime, physics, types, API-index, and example checks
docs/               # Compact AI specs, architecture invariants & API-INDEX.json
```

## Core Commands (Run from Repo Root)

```powershell
npm ci
npm ci --prefix network
npm run api -- --map
npm run api -- --recipe 3d

# Create a 5-pillar archetype game from an idea & theme (ready to play out of the box)
node scripts/create-game.mjs "D:\Games\neon-rush" --archetype action-2d --theme cyber --name "霓虹突围"
node scripts/create-game.mjs "D:\Games\card-quest" --archetype card-ui --theme arcane --name "秘术牌局"
npm run blueprint:check -- "D:\Games\neon-rush\src\game.design.json"

# Or create a standalone game from the lower-level preset catalogue
node scripts/create-game.mjs "D:\Games\my-game" --preset 2d --name "Title"
node scripts/create-game.mjs "D:\Games\my-horde" --preset horde --name "Horde"

# Verify engine / examples / game
npm run check:all
npm run build:examples
npm run test:examples
npm run snapshot -- examples/survivor-2d
npm run playtest -- examples/survivor-2d

# Build lean game release or full engine SDK (build/hgame_1_0/ + .zip)
npm run package:game -- "D:\Games\my-game" --version 1.0
npm run release
```

For native WeChat, Douyin, TapTap, and Bilibili exports and their shared SDK interface, see [Mini-game packaging](docs/guides/MINIGAME-PACKAGING.md).

The full SDK ZIP includes both npm lockfiles, the optional network workspace, and the source for the bundled examples, benchmarks, and verification commands. SDK exports from a Git checkout use tracked or staged paths and the current local contents of those files. Repacking an extracted SDK uses its included file manifest.

## Runtime Subsystems

- **Asset catalog**: logical media IDs, scoped loading and catalog-based release selection. [Asset catalog workflow](docs/guides/ASSET-CATALOG.md)
- **Core & Sim**: `Scene/Entity/Component`, `GameplayTags`, `app.renderAlpha`, `app.hitStop`, `TweenManager`, `SpringDamper1D/2D/3D`, `sim/` (`createSeededRng`, `hashState`, `runScripted`).
- **Gameplay**: attributes, resource costs, Buff/Debuff stacking, periodic effects, cooldowns, charges, casting, channeling and buffered input. Import `GameplayComponent` or `createGameplayActor` from `gameplay/index.js`. [Gameplay guide](docs/guides/systems/17-gameplay.md)
- **Skill timing**: drive animation, sound and visual cues from the same fixed-step timeline as skill commitment and recovery. [Ability timeline guide](docs/guides/systems/21-ability-timelines.md)
- **Progression**: branching dialogue, conditional choices, event-driven quests, reward claims and resumable state in `gameplay/story.js` and `gameplay/quests.js`. [Story and quest guide](docs/guides/systems/18-story-and-quests.md)
- **Inventory**: item stacks, equipment modifiers, resource exchanges and quest reward admission through `createInventory`. [Inventory guide](docs/guides/systems/19-inventory-and-equipment.md)
- **Loot and crafting**: seeded drop tables, pending reward claims and atomic crafting recipes. [Loot and crafting guide](docs/guides/systems/20-loot-and-crafting.md)
- **Encounters**: timed waves, stage goals, transitions and checkpoint restarts. [Encounter guide](docs/guides/systems/22-encounters.md)
- **Level assembly**: prefab hierarchies, named spawn points and tag-filtered trigger volumes. [Level guide](docs/guides/systems/23-level-assembly.md)
- **Level flow**: prepare a new scene with shared catalog resources, then switch and unload the old level. [Level flow guide](docs/guides/systems/24-level-flow.md)
- **2D & 150k+ Crowds**: `Canvas2D`, `WebGL2D`, `post2d` (ambient + 32 point lights + Bloom/vignette/hitPulse), `SpriteSheet`, `TileMap` A*, `SpriteCrowd2D`, `createSwarmSimulation`, `createGpuSwarmWebGL2`.
- **3D & Open World**: `ThreeAdapter` (`ueFilmic`), `sky3d`, `MegaLights3D`, `IrradianceProbeVolume3D`, `post3d`, `culling3d`, `camera3d`, `terrain3d` (FBM + Rapier heightfield + scatter), `navmesh3d`, `procedural-models` (17 PBR shapes), `model3d` (`BoneVatCrowd3D`), `open-world` (`WorldPartition`, `HLOD`, `FloatingOrigin`).
- **AI, UI, Audio & Storage**: `ai/fsm.js` (HFSM), `ai/bt.js` (Behavior Tree), `ui/` (`PanelStack`, `VirtualList`, `i18n`, `RedDotSystem`), `audio.playSynth` (10 SFX presets), `audio.createBgm` (6 adaptive moods), `HRTF` 3D cues, `createVersionedStore` (migrations + FNV-1a + `.bak`).

## Reference Specs

- Engine scorecard: [ENGINE-SCORECARD.md](docs/ENGINE-SCORECARD.md)
- Architecture & Physics: [ENGINE-OVERVIEW.md](docs/architecture/ENGINE-OVERVIEW.md), [PLATFORM-API.md](docs/architecture/PLATFORM-API.md), [DETERMINISTIC-PHYSICS.md](docs/architecture/DETERMINISTIC-PHYSICS.md)
- Rendering & PBR: [PIPELINE-3D.md](docs/rendering/PIPELINE-3D.md), [WORLD-ALIGNED-PBR.md](docs/rendering/WORLD-ALIGNED-PBR.md)
- Art/Audio/Verification: [ASSET-AND-AUDIO-PIPELINE.md](docs/guides/ASSET-AND-AUDIO-PIPELINE.md), [AI-VERIFICATION.md](docs/guides/AI-VERIFICATION.md), [GAME-ARCHITECTURE-AND-QA.md](docs/guides/GAME-ARCHITECTURE-AND-QA.md)
- Multiplayer & Lockstep: [NETWORK.md](docs/architecture/NETWORK.md), [LOCKSTEP.md](docs/architecture/LOCKSTEP.md), [WASM-PROTECTION-AND-ANTI-CHEAT.md](docs/guides/WASM-PROTECTION-AND-ANTI-CHEAT.md)
