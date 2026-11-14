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
- **Zero dead-ends**: non-ending nodes must declare at least one `choices` edge or `next` target.
- **100% reachable endings**: every node marked `"ending": true` must be reachable from `start`.
