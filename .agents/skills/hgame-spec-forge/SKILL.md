---
name: hgame-spec-forge
description: Clean-room gameplay specification validator and HGame project scaffolder. Validates sanitized *.clean-spec.json payloads, blocks path/binary/source leaks, maps fallback systems to native HGame modules, and wires create-game.mjs --bare + sim-balance + check-level + snapshot verification.
---

# HGame Clean-Room Spec Forge (`hgame-spec-forge`)

Use this skill when building an HGame project from a sanitized clean-room gameplay specification (`*.clean-spec.json`).

> **研发铁律：先做减法再做加法（1-1-2-1 最小切片毕业制 + 双门禁）**
> 1. **第一阶段只准交付 `1-1-2-1` 最小垂直切片**：1 套角色与相机参数、1~2 把核心武器、2~3 种代表敌人、1 套 ~60 秒基础波次、最多 5 个核心升级项。
> 2. **双门禁放行前严禁扩写**：在同时跑通 **第一道门 `npm run re:eval`（评分 >= 90 且 4 项无量纲手感比值全绿）** 与 **第二道门 `npm run re:doctor`（30 秒实机四项体检全绿）** 之前，**严禁**扩充武器库、**严禁**堆砌外围系统、**严禁**盲目开启十万同屏二创。

## 1. Gate 1: Compliance Firewall, SI Unit Audit & RE Readiness Score (`npm run re:eval`)

Before generating code from any external specification JSON, run the readiness & unit sanity gate:

```bash
npm run re:eval -- <path-to-clean-spec.json>
# Or by slug / built-in demo:
npm run re:eval -- --slug <slug>
npm run re:eval -- --demo
# Direct script:
node .agents/skills/hgame-spec-forge/scripts/validate-spec.mjs <path-to-clean-spec.json> --eval
```

The Gate 1 validator refuses entry to scaffolding (`exit 1`) if any of the following fail:
- **Clean-room leaks**: local machine disk paths, proprietary binary/archive filenames (`.dll`, `.exe`, `.pak`, `.pck`, `.utoc`, `.ucas`, `.rpa`, `.asar`, etc.), or multi-line decompiled/source snippets (`> 3` lines).
- **Unit System & Normalization**: `unitSystem` must equal `"SI_METERS_SECONDS_RADIANS"` and `unitConversions` must explicitly record `distance.toMetersScale` and `time` (`toSecondsScale` / `tickHz`).
- **Zero `unknown` / `null` / `NaN`**: Core 3C and Golden Triangle fields must contain zero `"unknown"`, `null`, or `NaN`. Unextracted low-level details must be explicitly marked `status: "hgame-fallback"` with concrete HGame recommended values.
- **4 Golden Dimensionless Ratios**:
  - `playerSpeed / (playerRadius * 2)` in `[2.5, 15]` (catches unconverted `px/s` treated as `m/s`)
  - `arenaSpan / playerSpeed` in `[6, 40]` seconds
  - `gruntHp / weaponEffectiveDps` in `[0.1, 5.0]` seconds
  - `playerHp / gruntHitDamage` in `[3, 25]` hits
- **1-1-2-1 MVP Slice Scope**: 1 char + 1 camera, 1~2 weapons, 2~3 enemies, 1 × ~60s wave, `<= 5` upgrades (`RE Readiness Score >= 90`).

## 2. Clean-Room Assembly & Gate 2: Playability Doctor (`npm run re:doctor`)

1. **Validate & Scaffold (`--scaffold <out-dir>`)**:
   ```bash
   node .agents/skills/hgame-spec-forge/scripts/validate-spec.mjs <clean-spec.json> --scaffold <out-dir>
   ```
   Invokes `scripts/create-game.mjs --bare` with `engineRecipe`, writes `src/sim/spec.json`, and creates `src/sim/doctor.js` (`attachHGameDoctor`) so the project exposes `window.__HGAME_DOCTOR__`.
2. **Native Subsystem Takeover (`hgameFallbackModules`)**:
   - **Crowds & Pathing**: `createSwarmSimulation`, `createBoneVatCrowd3D`, `createNavMesh3D`, `TileMap.findGridPath`
   - **VFX & Juice**: `createVfxSystem` (`vfx/index.js`) + `CROWD_STATUS` (zero-GC)
   - **Audio**: `audio.playSynth` + `createProceduralBgm` (0-KB procedural audio)
   - **Camera & 3C**: `createCameraRig3D` / `createSpringArm3D` / `Camera2D` / `SpringDamper`
   - **UI**: `hgame-ui-ux` zero-prose minimalist HUD & whole-card buttons
3. **Gate 2 — 30s Playability Doctor (`npm run re:doctor`)**:
   Wire `attachHGameDoctor(...)` in `src/main.js` and run:
   ```bash
   npm run re:doctor -- <out-dir>
   ```
   Reuses `scripts/snapshot.mjs` (`--freeze-time --steps --keys --eval`) to assert 4 live vital signs:
   - **Test A [Move & Bounds]**: 3s continuous move input within `< 25%` error of theoretical speed, not stuck at `(0,0)`, within bounds, zero `NaN/Infinity`.
   - **Test B [Aim & Kill]**: 1 grunt spawned in range takes real damage and dies within expected TTK (`<= 5s`).
   - **Test C [Threat & Defense]**: 3 chasers damage player without `< 0.5s` instakill, and pushback/dodge opens safe distance.
   - **Test D [Visual Framing]**: non-blank/non-solid frame, legal camera distance/clearance, zero console/HTTP errors.
4. **Additional Verification Gates**:
   - Balance & drop tables: `node .agents/skills/hgame-balance-sim/scripts/sim-balance.mjs --config <balance.json>`
   - Level reachability: `node .agents/skills/hgame-level-architect/scripts/check-level.mjs --level <level.json>`
   - UI compliance & headless render: `node .agents/skills/hgame-ui-ux/scripts/check-ui.mjs --dir <game-dir>` + `npm run snapshot -- <game-dir>`
