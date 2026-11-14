# AI Verification Loop

How an agent proves a change works without a human looking at the screen.

| Need | Command | Output |
|---|---|---|
| Find an API / its option keys | `docs/api/API-INDEX.json` (grep by name; one export per line: `signature` shows option-bag keys + defaults, `returns` lists returned object keys, `members` lists class methods) | JSON |
| Logic regression | `npm test` | TAP |
| Types / index not stale | `npm run check` (runs `check:types` and `check:api-index`; fix with `npm run build:types` / `npm run build:api-index`) | exit code |
| **See the render** | `npm run snapshot -- <game-dir> [--keys d:300] [--wait 800] [--ready "#game[data-engine-ready=true]"]` | PNG + JSON: `nonBlankRatio`, `meanLuma`, `uniqueColors`, `lumaHistogram8`, `sha256`, `consoleErrors`, `httpErrors`, `problems` |
| Render regression | `npm run snapshot -- <game-dir> --baseline baseline.png` (create/refresh with `--update-baseline`) | JSON `baseline.diffRatio` + `bbox` of changed pixels; exit 1 above `--threshold` (default 0.01) |
| Game state / deterministic render | `npm run snapshot -- <game-dir> --freeze-time --steps 120 [--eval "<js expr>"] [--state-hook __hgameState]` | Same JSON plus `eval` (JSON-serialisable result of the expression, evaluated after ready/steps/keys), `state` (result of `window.__hgameState()` when defined) and `frozenTime: true`; see *Deterministic snapshots* below |
| CPU perf budgets | `npm run bench` | PASS/FAIL per case |
| Render perf (browser) | `npm run bench:render` | mean/p95 frame ms for 10k `SpriteCrowd2D` on `webgl2d` (gated) and `canvas2d` (info only) |
| 3D stress (browser) | `npm run bench:render3d` | 2,000 `createInstancedBatch3D` instances + 64 `createMegaLights3D` lights + `post3d` + procedural sky + `createCameraRig3D`; reports mean/p50/p95/max frame ms (sync `readPixels` per frame so GPU/SwiftShader time is included), draw calls, triangles, visible instances, and a canvas non-blank check (`--instances --lights --frames --budget-p95 --no-post --png --json --chrome`). Gates only on errors, blank canvas, and a very loose p95 (4000 ms) |
| Runtime health | `createDiagnostics().snapshot()` | `fps`, `frameTimeP95Ms`, `frameTimeMaxMs`, `longFrames`, `errorCount`, `lastError` |

## Rules of thumb
- Snapshots are deterministic for identical inputs on the same machine (SwiftShader software GL); treat baselines as per-environment, not cross-OS.
- A blank canvas (`nonBlankRatio < 0.001`) or any `consoleErrors` always fails the snapshot.
- When the diff is non-zero, read `baseline.bbox` to locate what changed, then look at the PNG.
- Config and constructor errors name the valid values and suggest the closest match; fix from the message instead of searching docs.

## Deterministic snapshots (`--freeze-time`)
- `--freeze-time` (implied by `--steps`) installs, before any page script, a virtual clock: `performance.now`, `Date.now`/`new Date()` start fixed at 0 / 1700000000000, `requestAnimationFrame` callbacks only run when the tool steps them (1/60 s per frame), and `Math.random` is seeded. Wall-clock HUD text, fps read-outs and time-driven animation become reproducible.
- `--steps N` advances exactly N frames (default: `--wait` / 16.67 ms). `--keys k:ms` holds the key for `ms` of *virtual* time (rounded to frames). `setTimeout`/`setInterval` are not virtualised; games should drive logic from rAF/`performance.now`.
- Opt-in for games: read time only through `performance.now`/`Date.now`/rAF timestamps, use `Math.random` (or a seed derived from `performance.now()`) for randomness, and avoid unbounded async work after the ready marker. The ready selector is awaited without stepping, so frames before ready are not counted; if the page needs frames to become ready, the tool pumps them.
- `--eval "<expr>"` runs in the page (global scope, `await` allowed in the result) and the value is returned under `report.eval`. Example: `--eval "document.querySelector('#hud').textContent"`.
- `--state-hook <name>` (default `__hgameState`): if `window[name]` is a function, its JSON result is included as `report.state` automatically. Expose e.g. `window.__hgameState = () => ({ enemies: sim.enemies.count, tick: sim.tick })` so tests can assert game state, not just pixels.
- Example: `examples/survivor-2d/baseline.png` is produced and checked with `--ready "#game[data-engine-ready=true]" --freeze-time --steps 120 --baseline examples/survivor-2d/baseline.png --threshold 0`.
