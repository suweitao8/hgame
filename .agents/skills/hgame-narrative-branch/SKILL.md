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

## 3. Dialogue Style & Event Card Rules

- **Short & direct**: keep each event/node description `<= 60` characters (configurable with `--max-chars`); state only the concrete event fact—forbid filler scene-setting ("大家围坐清点……") or melodramatic lyricism.
- **No unrequested banter, role pills, or meta eyebrows**: forbid inventing decorative role nickname pills (`老实一家之主`), character monologue quote blocks, or redundant modal eyebrow tags (`第 N 天 · 突发事件`). Only display factual name + mechanic/skill when a card lists members.
- **Explicit `选项` block (`<= 4` choices, single-content buttons)**: present choices under a clear `选项` section heading, capped at `<= 4` options per event; every choice button MUST show direct single-content option copy (and concise inline cost/probability if mechanical)—forbid splitting a button into a decorative `title + sub-description` two-row stack or inventing fake flavor subtitles.
- **2–4 meaningful choices (no fake branches)**: decision nodes should offer distinct consequences or risk-reward tradeoffs—forbid cosmetic duplicates leading to identical outcomes.
- **Zero dead-ends & 100% reachable endings**: non-ending nodes must declare at least one `choices` edge or `next` target, and every node marked `"ending": true` must be reachable from `start`.
