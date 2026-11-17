# HGame (AI-Native HTML5 Game Engine, v1.0.0)

HGame is a standalone, renderer-neutral, **zero-GUI-editor** HTML5 game runtime built for autonomous AI development (`Scene / Entity / Component / Prefab`, 2D Canvas/WebGL2, 3D Three.js, Command-Driven UI, Deterministic Rapier `0.21.0`, and optional Colyseus multiplayer).

## AI Entry Points (Start Here)

- **Zero-Blind-Scan API CLI**: `npm run api -- --map` | `npm run api -- --recipe <2d|horde|3d|ui|network>` | `npm run api -- <keyword>`
- **Workspace Rules & AI Runbook**: [AGENTS.md](AGENTS.md) | [assets/template/AGENTS.md](assets/template/AGENTS.md) | [.agents/skills/hgame/SKILL.md](.agents/skills/hgame/SKILL.md)
- **System Cards Index**: [docs/guides/USER-AND-AGENT-GUIDE.md](docs/guides/USER-AND-AGENT-GUIDE.md)

## Repository Layout

```text
assets/
  runtime/          # Canonical engine runtime (1.0.0)
  template/         # Standalone generated project template
  profiles/         # 2d / 2d-bare / 3d / 3d-bare / ui starters
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
npm run api -- --map
npm run api -- --recipe 3d

# Create a standalone game from the shared preset catalogue
node scripts/create-game.mjs "D:\Games\my-game" --preset 2d --name "Title"
node scripts/create-game.mjs "D:\Games\my-horde" --preset horde --name "Horde"

# Verify engine / examples / game
npm run check:all
npm run test:examples
npm run snapshot -- examples/survivor-2d
npm run playtest -- examples/survivor-2d

# Build lean game release or full engine SDK (build/hgame_1_0/ + .zip)
npm run package:game -- "D:\Games\my-game" --version 1.0
npm run release
```

## Runtime Subsystems

- **Core & Sim**: `Scene/Entity/Component`, `GameplayTags`, `app.renderAlpha`, `app.hitStop`, `TweenManager`, `SpringDamper1D/2D/3D`, `sim/` (`createSeededRng`, `hashState`, `runScripted`).
- **Gameplay**: attributes, resource costs, Buff/Debuff stacking, periodic effects, cooldowns, charges, casting, channeling and buffered input. Import `GameplayComponent` or `createGameplayActor` from `gameplay/index.js`. [Gameplay guide](docs/guides/systems/17-gameplay.md)
- **Skill timing**: drive animation, sound and visual cues from the same fixed-step timeline as skill commitment and recovery. [Ability timeline guide](docs/guides/systems/21-ability-timelines.md)
- **Progression**: branching dialogue, conditional choices, event-driven quests, reward claims and resumable state in `gameplay/story.js` and `gameplay/quests.js`. [Story and quest guide](docs/guides/systems/18-story-and-quests.md)
- **Inventory**: item stacks, equipment modifiers, resource exchanges and quest reward admission through `createInventory`. [Inventory guide](docs/guides/systems/19-inventory-and-equipment.md)
- **Loot and crafting**: seeded drop tables, pending reward claims and atomic crafting recipes. [Loot and crafting guide](docs/guides/systems/20-loot-and-crafting.md)
- **Encounters**: timed waves, stage goals, transitions and checkpoint restarts. [Encounter guide](docs/guides/systems/22-encounters.md)
- **Level assembly**: prefab hierarchies, named spawn points and tag-filtered trigger volumes. [Level guide](docs/guides/systems/23-level-assembly.md)
- **2D & 150k+ Crowds**: `Canvas2D`, `WebGL2D`, `post2d` (ambient + 32 point lights + Bloom/vignette/hitPulse), `SpriteSheet`, `TileMap` A*, `SpriteCrowd2D`, `createSwarmSimulation`, `createGpuSwarmWebGL2`.
- **3D & Open World**: `ThreeAdapter` (`ueFilmic`), `sky3d`, `MegaLights3D`, `IrradianceProbeVolume3D`, `post3d`, `culling3d`, `camera3d`, `terrain3d` (FBM + Rapier heightfield + scatter), `navmesh3d`, `procedural-models` (17 PBR shapes), `model3d` (`BoneVatCrowd3D`), `open-world` (`WorldPartition`, `HLOD`, `FloatingOrigin`).
- **AI, UI, Audio & Storage**: `ai/fsm.js` (HFSM), `ai/bt.js` (Behavior Tree), `ui/` (`PanelStack`, `VirtualList`, `i18n`, `RedDotSystem`), `audio.playSynth` (10 SFX presets), `audio.createBgm` (6 adaptive moods), `HRTF` 3D cues, `createVersionedStore` (migrations + FNV-1a + `.bak`).

## Reference Specs

- Architecture & Physics: [ENGINE-OVERVIEW.md](docs/architecture/ENGINE-OVERVIEW.md), [PLATFORM-API.md](docs/architecture/PLATFORM-API.md), [DETERMINISTIC-PHYSICS.md](docs/architecture/DETERMINISTIC-PHYSICS.md)
- Rendering & PBR: [PIPELINE-3D.md](docs/rendering/PIPELINE-3D.md), [WORLD-ALIGNED-PBR.md](docs/rendering/WORLD-ALIGNED-PBR.md)
- Art/Audio/Verification: [ASSET-AND-AUDIO-PIPELINE.md](docs/guides/ASSET-AND-AUDIO-PIPELINE.md), [AI-VERIFICATION.md](docs/guides/AI-VERIFICATION.md), [GAME-ARCHITECTURE-AND-QA.md](docs/guides/GAME-ARCHITECTURE-AND-QA.md)
- Multiplayer & Lockstep: [NETWORK.md](docs/architecture/NETWORK.md), [LOCKSTEP.md](docs/architecture/LOCKSTEP.md), [WASM-PROTECTION-AND-ANTI-CHEAT.md](docs/guides/WASM-PROTECTION-AND-ANTI-CHEAT.md)
