---
name: hgame-level-architect
description: BFS/flow-field level connectivity validator for HGame. Asserts 100% reachability from spawn to all objectives with zero isolated islands and prints an ASCII minimap.
---

# HGame Level Connectivity Architect (`hgame-level-architect`)

Before committing any tilemap, dungeon, or arena `level.json`, run the BFS reachability checker to guarantee zero soft-locks or disconnected objective islands.

## 1. Run Verification

```bash
node .agents/skills/hgame-level-architect/scripts/check-level.mjs --level path/to/level.json
# Quick smoke demo:
node .agents/skills/hgame-level-architect/scripts/check-level.mjs --demo
```

## 2. Level JSON Formats Supported

- Numeric 2D grid (`tiles` / `grid`, where `0` = walkable, `> 0` = solid wall) or ASCII rows (`["######", "#S..G#", "######"]`).
- `spawn`: `{ "x": 1, "y": 1 }` (or `'S'` in ASCII grid).
- `objectives` / `waypoints` / `goals`: `[{ "id": "boss", "x": 8, "y": 5 }]` (or `'G'` in ASCII grid).

## 3. ASCII Minimap Legend

- `@` = Spawn
- `*` = Reachable objective
- `!` = **Unreachable objective (FAIL)**
- `#` = Wall
- `.` = Reachable floor
- `x` = Disconnected floor island
