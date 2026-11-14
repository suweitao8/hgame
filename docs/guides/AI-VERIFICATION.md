# AI Verification Loop

How an agent proves a change works without a human looking at the screen.

| Need | Command | Output |
|---|---|---|
| Find an API / its option keys | `docs/api/API-INDEX.json` (grep by name; one export per line: `signature` shows option-bag keys + defaults, `returns` lists returned object keys, `members` lists class methods) | JSON |
| Logic regression | `npm test` | TAP |
| Types / index not stale | `npm run check` (runs `check:types` and `check:api-index`; fix with `npm run build:types` / `npm run build:api-index`) | exit code |
| **See the render** | `npm run snapshot -- <game-dir> [--keys d:300] [--wait 800] [--ready "#game[data-engine-ready=true]"]` | PNG + JSON: `nonBlankRatio`, `meanLuma`, `uniqueColors`, `lumaHistogram8`, `sha256`, `consoleErrors`, `httpErrors`, `problems` |
| Render regression | `npm run snapshot -- <game-dir> --baseline baseline.png` (create/refresh with `--update-baseline`) | JSON `baseline.diffRatio` + `bbox` of changed pixels; exit 1 above `--threshold` (default 0.01) |
| CPU perf budgets | `npm run bench` | PASS/FAIL per case |
| Render perf (browser) | `npm run bench:render` | mean/p95 frame ms for 10k `SpriteCrowd2D` on `webgl2d` (gated) and `canvas2d` (info only) |
| 3D stress (browser) | `npm run bench:render3d` | 2,000 `createInstancedBatch3D` instances + 64 `createMegaLights3D` lights + `post3d` + procedural sky + `createCameraRig3D`; reports mean/p50/p95/max frame ms (sync `readPixels` per frame so GPU/SwiftShader time is included), draw calls, triangles, visible instances, and a canvas non-blank check (`--instances --lights --frames --budget-p95 --no-post --png --json --chrome`). Gates only on errors, blank canvas, and a very loose p95 (4000 ms) |
| Runtime health | `createDiagnostics().snapshot()` | `fps`, `frameTimeP95Ms`, `frameTimeMaxMs`, `longFrames`, `errorCount`, `lastError` |

## Rules of thumb
- Snapshots are deterministic for identical inputs on the same machine (SwiftShader software GL); treat baselines as per-environment, not cross-OS.
- A blank canvas (`nonBlankRatio < 0.001`) or any `consoleErrors` always fails the snapshot.
- When the diff is non-zero, read `baseline.bbox` to locate what changed, then look at the PNG.
- Config and constructor errors name the valid values and suggest the closest match; fix from the message instead of searching docs.
