---
name: hgame-balance-sim
description: Monte Carlo headless combat & gacha balance simulator for HGame. Run 1,000+ deterministic runs after any stat/drop-table edit to verify win rates and TTK.
---

# HGame Balance Simulator (`hgame-balance-sim`)

Whenever editing combat stats, weapon curves, enemy HP/DPS, or gacha/drop tables, run the headless Monte Carlo simulator before shipping.

## 1. Run Verification

```bash
node .agents/skills/hgame-balance-sim/scripts/sim-balance.mjs --config path/to/balance.json --runs 1000 --seed 2026
# Quick smoke demo:
node .agents/skills/hgame-balance-sim/scripts/sim-balance.mjs --demo
```

## 2. Config Schema (`balance.json`)

```json
{
  "duel": {
    "player": { "hp": 120, "atk": 18, "atkInterval": 0.45, "critChance": 0.2, "critMult": 2.0 },
    "enemy": { "hp": 140, "atk": 14, "atkInterval": 0.65, "critChance": 0.1, "critMult": 1.6 },
    "minWinRate": 0.45,
    "maxWinRate": 0.85,
    "maxTtkSec": 12.0
  },
  "gacha": {
    "baseRate": 0.015,
    "pityThreshold": 60,
    "pullsPerRun": 100
  }
}
```

## 3. Hard Guardrails

- **Never eyeball combat math**: always validate `winRate` in `[minWinRate, maxWinRate]` and `avgTTK <= maxTtkSec`.
- **Deterministic PRNG only**: uses self-contained mulberry32; never pollutes runtime gameplay RNG.
- **Zero-dependency CLI**: runs in pure Node 22+ and exits `1` when any balance assertion fails.
