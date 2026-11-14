---
name: hgame-narrative-branch
description: Narrative branch & event-card graph validator for HGame. Blocks dangling dead-ends, broken links, unreachable endings, and verbose dialogue walls.
---

# HGame Narrative Branch Validator (`hgame-narrative-branch`)

Before shipping branching dialogue or roguelike event cards (`story.json`), run the graph checker to ensure every choice connects cleanly and every ending is reachable.

## 1. Run Verification

```bash
node .agents/skills/hgame-narrative-branch/scripts/check-story-graph.mjs --story path/to/story.json --max-chars 60
# Quick smoke demo:
node .agents/skills/hgame-narrative-branch/scripts/check-story-graph.mjs --demo
```

## 2. Story JSON Schema

```json
{
  "start": "intro",
  "nodes": {
    "intro": {
      "text": "雨夜街头，刀锋未冷。",
      "choices": [
        { "label": "拔刀迎战", "next": "win_end" },
        { "label": "转身撤离", "next": "retreat_end" }
      ]
    },
    "win_end": { "text": "一击制胜！", "ending": true },
    "retreat_end": { "text": "留得青山在。", "ending": true }
  }
}
```

## 3. Dialogue Style Rules

- **Short & punchy**: keep each node line `<= 60` characters (configurable with `--max-chars`).
- **2–3 meaningful choices (no fake branches)**: every branching decision node must offer **2–3 choices with distinct consequences or risk-reward tradeoffs**—forbid fake single-choice illusions or cosmetic duplicates leading to identical outcomes.
- **Sharp, witty & high-contrast**: write brisk, memorable lines with character contrast or dry humor (`简练有梗、带反差感`); reject preachy exposition, filler lectures, or melodramatic lyricism (`拒绝冗长说教与矫情抒情`).
- **Zero dead-ends**: non-ending nodes must declare at least one `choices` edge or `next` target.
- **100% reachable endings**: every node marked `"ending": true` must be reachable from `start`.
