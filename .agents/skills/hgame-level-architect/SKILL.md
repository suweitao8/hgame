---
name: hgame-level-architect
description: Gameplay-first level, wave-pacing, and PvZ-style campaign architect for HGame. Validates multi-topology connectivity, sawtooth wave pacing, one-new-thing & hard-counter fairness, and ultra-light micro-barks.
---

# HGame Level & Stage Architect (`hgame-level-architect`)

Focus on **level design, spatial variety, sawtooth pacing, and hard-counter fairness** while keeping narrative ultra-light (PvZ Crazy Dave style micro-barks `<= 24` chars, zero dialogue walls).

## 1. Run Verification

```bash
# Single stage (grid-2d, lane-defense, arena, or modular-3d level.json)
npm run check:level -- --level path/to/level.json --strict-gameplay --min-score 80

# Multi-stage PvZ-style campaign ("起-承-转-合" unlock & counter audit)
npm run check:level -- --campaign path/to/campaign.json --strict-gameplay

# Smoke demos
npm run check:level -- --demo
npm run check:level -- --demo-pvz
```

## 2. Four Supported Topologies (`kit/stage-architect.js`)

| Topology | Trigger Fields | Key Rules |
| --- | --- | --- |
| `lane-defense` | `lanes` / `laneTypes` (`grass`/`water`/`hazard`/`blocked`) | PvZ-style rows; checks every active lane from `spawnCol` to `homeCol`, tracks `'water-lane'` counter needs |
| `grid-2d` | `grid` / `tiles` / `rows` | Tactical cells: `.` floor, `#` wall, `~` water, `^` hazard, `=` cover, `+` destructible, `P` pad, `S`/`E`/`G` |
| `arena` | `bounds: { width, height }` or `world/level.js` `schemaVersion: 1` | Checks `firstContactSec >= 2.5s` (no face-spawn), tactical cover/hazard ratio & routes |
| `modular-3d` | `groups` + `colliders` + `playerSpawn` (`modular-level.js`) | Projects solid XZ colliders onto grid and checks BFS reachability from `playerSpawn` |

## 3. Gameplay-First Design Rules

1. **Sawtooth Wave Pacing & Flag Climax**:
   - Never peak on Wave 1 (`waves.length >= 3`).
   - Escalate with breather troughs (`breatherSec >= 4` or intensity drop `>= 15%`) and at least one climax wave (`flag: true`) for `>= 4` waves.
2. **One-New-Thing & Hard-Counter Fairness**:
   - Introduce `<= 2` new mechanics per stage (`> 3` fails).
   - Every required enemy/terrain trait (`aquatic`, `water-lane`, `flying`, `shielded`, `armored`, `burrow`, `fog`) must be countered by `availableTools` via `toolCounters`.
   - Use `analyzeCampaignProgression` to prevent introducing a trait before its counter tool unlocks, and avoid 3 consecutive stagnant stages.
3. **PvZ-Style Light Micro-Barks (Zero Prose Walls)**:
   - Optional `barks`: `<= 3` per stage, single-line, `<= 24` chars (`preStage`, `firstFlag`, `finalWave`, `boss`, `victory`), non-blocking; optional post-stage `unlock` badge (`<= 8` chars).
4. **Runtime Integration**:
   - Use `createStageDirector(stage, { onSpawn, onWaveStart, onFlagWave, onBark, onUnlock, onComplete })` from `vendor/hgame/kit/index.js` for 60Hz execution, early-clear wave rush, HUD progress/flag pins (`getHudState()`), and save snapshots (`getSnapshot()` / `restoreSnapshot()`).

## 4. ASCII Minimap Legend

- `@` = Spawn / Home · `*` = Reachable goal · `!` = **Unreachable goal (FAIL)** · `E` = Enemy spawn
- `#` = Wall · `=` = Cover · `~` = Water · `^` = Hazard · `+` = Destructible · `P` = Pad · `.` = Reachable floor · `x` = Isolated island
