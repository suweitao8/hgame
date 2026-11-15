---
name: hgame-spec-forge
description: Clean-room gameplay specification validator and HGame project scaffolder. Validates sanitized *.clean-spec.json payloads, blocks path/binary/source leaks, maps fallback systems to native HGame modules, and wires create-game.mjs --bare + sim-balance + check-level + snapshot verification.
---

# HGame Clean-Room Spec Forge (`hgame-spec-forge`)

Use this skill when building an HGame project from a sanitized clean-room gameplay specification (`*.clean-spec.json`).

## 1. Compliance Firewall & Validation

Before generating code from any external specification JSON, run the zero-dependency firewall validator:

```bash
node .agents/skills/hgame-spec-forge/scripts/validate-spec.mjs <path-to-clean-spec.json>
# Self-test demo:
node .agents/skills/hgame-spec-forge/scripts/validate-spec.mjs --demo
```

The validator fails with exit code `1` if the specification contains:
- Local machine disk paths (Windows drive paths or `/Users/` / `/home/` paths)
- Proprietary engine binary or archive filenames (`.dll`, `.exe`, `.pak`, `.pck`, `.utoc`, `.ucas`, `.rpa`, `.asar`, etc.)
- Multi-line source or decompiled code snippets (`> 3` lines)

## 2. Clean-Room Assembly Workflow

1. **Validate & Scaffold (`--scaffold <out-dir>`)**:
   ```bash
   node .agents/skills/hgame-spec-forge/scripts/validate-spec.mjs <clean-spec.json> --scaffold <out-dir>
   ```
   Invokes `scripts/create-game.mjs --bare` with the spec's `engineRecipe` (`profile`, `renderer`, `physics`, `tickHz`) and writes normalized data into `src/sim/spec.json`.
2. **Native Subsystem Takeover (`hgameFallbackModules`)**:
   - **Crowds & Pathing**: `createSwarmSimulation`, `createBoneVatCrowd3D`, `createNavMesh3D`, `TileMap.findGridPath`
   - **VFX & Juice**: `createVfxSystem` (`vfx/index.js`) + `CROWD_STATUS` (zero-GC)
   - **Audio**: `audio.playSynth` + `createProceduralBgm` (0-KB procedural audio)
   - **Camera & 3C**: `createCameraRig3D` / `createSpringArm3D` / `Camera2D` / `SpringDamper`
   - **UI**: `hgame-ui-ux` zero-prose minimalist HUD & whole-card buttons
3. **Verification Gate**:
   - Balance & drop tables: `node .agents/skills/hgame-balance-sim/scripts/sim-balance.mjs --config <balance.json>`
   - Level reachability: `node .agents/skills/hgame-level-architect/scripts/check-level.mjs --level <level.json>`
   - UI compliance & headless render: `node .agents/skills/hgame-ui-ux/scripts/check-ui.mjs --dir <game-dir>` + `npm run snapshot -- <game-dir>`
