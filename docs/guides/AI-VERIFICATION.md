# AI Verification Loop

How an agent develops against the user's task, runs checks, and decides whether the requested outcome is ready.

## Automated Acceptance Gate (`scripts/accept.mjs`)

Every generated game project (`npm run accept` / `npm run accept:webasset`) and HGame example (`npm run accept:examples`) includes a unified fail-closed acceptance runner synced into `scripts/accept.mjs`.

1. **Gates enforced in full mode (`node scripts/accept.mjs <dir>`):**
   - `config`: validates `engine.config.json` (`defineProject`), `game.config.json` WebAsset strict allowlist (`schemaVersion`, `id`, `name`, `version`, `entry`, `renderer`, `runtime`, `standalone`, `id === folderName`), zero CDN URLs, and valid local HTML script/CSS targets.
   - `syntax`: runs `node --check` across every `.js`/`.mjs` file under `src/`, `tests/`, and root, and verifies all static relative ESM imports in `src/` resolve on disk.
   - `uiStatic`: runs Anti-Bloat UI lint (`check-ui.mjs`).
   - `tests`: runs `node --test tests/*.test.mjs` with a zero-skip policy (`--allow-skips` to opt out).
   - `autoplay`: when `tests/autoplay.mjs` exists (or required via `--require-autoplay`), executes multi-seed `bot` vs `idle` (and optional `random`) headless runs via `check-autoplay.mjs`, verifying clear rate (`minWinRate`/`maxWinRate`), AFK/button-mashing resistance (`maxIdleWinRate`/`minSkillDelta`, `maxRandomWinRate`/`minBotOverRandomDelta`), pacing (`minAvgDurationSec`/`maxAvgDurationSec`/`maxTimeoutRate`, `p50DurationSec`), optional seed-replay determinism (`deterministic: true` / `--check-determinism`), and zero `NaN` simulation telemetry.
   - `visual`: captures `build/acceptance/desktop.png` (`960x540`) and `build/acceptance/mobile.png` (`360x800`) via `snapshot.mjs --check-ui --check-layout`, enforcing zero console/HTTP errors, non-blank/non-monochrome frames (except untouched `--bare` scaffolds), HUD area/text budgets, runtime Anti-Bloat `<p>`/`<footer>`/copy checks, zero viewport overflow, zero clipped/overlapping buttons or HUD panels, and zero clipped touch controls.
   - `playtest`: executes `tests/acceptance.mjs` (or default input probes) across both desktop (`960x540`) and mobile (`360x800`, `--skip-mobile-playtest` to opt out) via `playtest.mjs --check-ui --check-layout`, exposing `{ page, readState, checkpoint, auditUi }` for multi-phase live UI & layout audits (`playing`/`upgrade`/`gameover`/`restarted`/`reloaded`), asserting interactive responsiveness, frame telemetry, zero non-finite (`NaN`/`Infinity`) numbers in `window.__hgameState()`, and no premature `disposed`.
   - Batch downstream audit: `node scripts/accept-all.mjs [--quick|--full|--verify-fresh] [--examples] [--require-autoplay]` scans every managed project under `gamesRootDir` or `examples/`.
   - `doctor`: runs `doctor-playability.mjs` when `window.__HGAME_DOCTOR__` is wired (or required via `--doctor`).
   - `webasset`: checks `127.0.0.1:4174/api/games`, `verifyWebAssetSource`, and live isolated boot at `127.0.0.1:4175/local-games/<id>/<entry>` (mandatory when `--webasset` is passed).
   - `package` (when `--package` is passed): runs `package-game.mjs` and boots the packaged output via `snapshot.mjs`.
   - `taskManifest`: executes `task-check.mjs` if `tests/acceptance.json` or `build/task.json` exists.
2. **Freshness proof (`--verify-fresh`):** Full acceptance writes `build/acceptance-report.json` stamped with `sourceDigest` (SHA-256 over configs, HTML/CSS, `src/**/*`, and `tests/**/*`). `node scripts/accept.mjs . --verify-fresh` fails if any source/test/config file changed since the last passing full run or if screenshots are missing. `--quick` (`npm run check`) skips browser gates and always records `accepted: false`.

## Task acceptance

1. **Preserve the request.** Before editing, write the task and an observable expected result for each explicit behavior, deliverable and constraint. Note any assumptions. For a bug, reproduce the original failure. For gameplay, cover entry, the requested interaction, and the resulting state. Include restart, persistence, touch or failure paths when the request affects them.
2. **Choose evidence.** Bind deterministic rules to exact Node test names. Bind player-facing behavior to named WebAsset checkpoints that drive ordinary input and assert the game state or visible result. Use fresh screenshots or a played sequence for art direction, readability and game feel. Map each criterion to evidence that could expose a regression.
3. **Implement and exercise the real entry point.** Use the existing HGame APIs and relevant domain checks. Get the core interaction running through WebAsset early for game tasks. Reuse the task criteria when iterating. When a check fails, read the concrete assertion, state and browser errors, fix the affected path and rerun it.
4. **Audit completion.** Match each original requirement to fresh evidence from the final code. Resolve all applicable failures and missing checks. For every visual review, record what was inspected, in which state and viewport, where the evidence is, and the observed result. Run the repository or game-wide checks required by its instructions. Report completion only after this audit. If a genuine blocker remains, report the specific unset condition and the missing evidence.

Keep the task record under `build/` for a local task, or commit it with regression tests when it will be reused. For a generated game, the following example assumes `tests/save.test.mjs` contains the named test and `tests/restart.mjs` exports a playtest scenario with the named checkpoint. Use only the evidence types applicable to the task.

```json
{
  "schemaVersion": 1,
  "task": "Keep the high score when the player restarts, and keep it readable on a narrow screen.",
  "playtests": {
    "restart": {
      "scenario": "tests/restart.mjs",
      "ready": "#game[data-engine-ready=true]",
      "viewport": "360x800"
    }
  },
  "requirements": [
    {
      "id": "score",
      "expected": "Restart starts a new round and retains the high score.",
      "checks": [
        { "type": "test", "file": "tests/save.test.mjs", "name": "restart preserves the high score" },
        { "type": "playtest", "run": "restart", "checkpoint": "restart retains high score" }
      ]
    },
    {
      "id": "layout",
      "expected": "The score stays unobstructed on a 360×800 viewport.",
      "checks": [
        { "type": "review", "inspect": "Read the score in fresh 360×800 images during play and after restart." }
      ]
    }
  ]
}
```

From the target project root, run `node "<hgame-repo>/scripts/task-check.mjs" build/task.json`. For tasks in the HGame engine repository, use `npm run task:check -- build/task.json`. Paths inside the task record resolve from the target project root. Use trusted local task records and modules, which can execute code on the development machine.

- The checker runs each referenced Node test file once and each browser scenario once per run ID, then matches exact test and checkpoint names. Before opening WebAsset, it uses a temporary marker to verify that the live URL serves the project being edited. A named test that was skipped, a missing or ambiguous name, and unavailable evidence leave the criterion pending. A failed test file or unstable browser scenario fails its linked checks.
- For playtests, `scenario` and `ready` are required. Optional keys are `selector`, `viewport`, `query`, `stateHook`, `traceHook`, `maxLongFrames`, `allowStatic` and `timeoutMs` (default 120000). Write the gameplay checkpoint in the scenario and assert an outcome with `node:assert/strict`. For a PNG to review, save `page.screenshot({ path: 'build/restart.png' })` at the relevant checkpoint. The scenario can return artifact paths for the JSON report.
- Exit `0` means every declared automated check passed. Exit `1` means a check failed or still needs evidence. Exit `2` means the task record or invocation is invalid. JSON includes statuses, the record hash, and fresh test and browser evidence. `review-required` is a pending item for the agent to inspect. Record the observed evidence in the final audit. Repeat that review when the relevant code or assets change.
- Audit the correspondence between the request and the test. For example, a restart assertion should prove both a new round and retained score. A ready canvas or changing pixels is evidence for rendering activity. The full interaction needs its own assertion. For performance requirements, use the requested hardware and workload with the render benchmarks below and record the actual conditions.

## Per-frame render diagnostics

Pass `diagnostics2d: true` to `createCanvas2DAdapter` or `createWebGL2DAdapter`, or set `rendererOptions.diagnostics2d: true` in `startPixiGame`. Read `renderer.getRenderDiagnostics()` after a render. The Pixi profile also makes the enabled snapshot available through its existing `window.__hgameRenderDiagnostics()` hook. The snapshot has the same frame ID, pass timing, draw, upload and attachment fields as the Three recorder. Measurements describe renderer submissions and nominal attachment payloads.

- **WebGL2D** records each view's world draw plus the shared Bloom extract, blur and lighting composite when active. It counts observed WebGL draw calls, triangle submissions and upload bytes. When a timer query is available, GPU samples arrive asynchronously with the originating frame and pass index. Shared stages use `viewIndex: -1`.
- **Canvas2D** records CPU timing and measured Canvas2D draw counts (`draws`) for world and lighting by view, estimates image/putImageData transfer payloads (`uploadBytes`) and owned tint/shadow canvas memory (`targetBytes`), and marks GPU timing and triangles as `unavailable`.
- **Pixi** records preparation, effect preparation and scene submission. Pixi's internal filters are included in the scene submission. The recorder estimates bound offscreen attachments from their explicit base-level formats. Pixi WebGL uses the WebGL counters and timer query path. Pixi WebGPU observes direct and indirect render-pass draws, supported queue writes, and `timestamp-query` capability when enabled (`unavailable` otherwise). All major 2D and 3D backends expose `measurementSources` (`measured | estimated | unavailable`) and `estimatedFields` on both frame and pass entries.

`complete: false` identifies a frame that threw during rendering. Context changes and disposal clear the previous snapshot. Enable collection when diagnosing a workload. CPU timing includes the cost of diagnostics and attachment totals are estimates.

## Verification commands

| Need | Command | Output |
|---|---|---|
| Find an API / its option keys | `docs/api/API-INDEX.json` (grep by name; one export per line: `signature` shows option-bag keys + defaults, `returns` lists returned object keys, `members` lists class methods) | JSON |
| Logic regression | `npm test` | TAP |
| Complete reference games | `npm run test:browser:lifecycle [-- --chrome <path>]` | Keyboard movement, combat and natural death, three restart cycles, reload persistence, input/renderer/touch teardown, and zero browser errors. `--webasset` verifies the registered live examples. |
| Runnable API recipes | `npm run test:browser:recipes [-- --chrome <path>]` | Generate projects using each recipe's documented command, execute the recipe as its entry, and assert advancing 2D/3D ticks, 2D movement, swarm population, terrain and UI locale. Also verify the network recipe's imports. |
| Packaged 3D release | `npm run test:browser:packages [-- --chrome <path>]` | Extract the standard and Toy ZIPs, render each with fixed input, check the Three.js and Rapier requests, and compare with a source-byte package from the same build. |
| Types / index not stale | `npm run check` (runs `check:types` and `check:api-index`; fix with `npm run build:types` / `npm run build:api-index`) | exit code |
| **See the render** | `npm run snapshot -- <game-dir> [--keys d:300] [--wait 800] [--ready "#game[data-engine-ready=true]"] [--check-ui]` | PNG + JSON: `nonBlankRatio`, `meanLuma`, `uniqueColors`, `lumaHistogram8`, `sha256`, `diagnostics.ui`, `consoleErrors`, `httpErrors`, `problems` |
| **Anti-Bloat UI lint** | `npm run check:ui -- --dir <game-dir>` | JSON report checking Zero-Prose, button quotas (`title <=1`, `hud <=1`, `result <=2`), no blocking modals, and hidden `#debug` |
| Render regression | `npm run snapshot -- <game-dir> --baseline baseline.png` (create/refresh with `--update-baseline`) | JSON `baseline.diffRatio` + `bbox` of changed pixels; exit 1 above `--threshold` (default 0.01) |
| Accepted-reference regression | `npm run check:visual` | Renders the accepted Git revision in `tests/visual-reference.json` and the working tree in the same browser environment. PNG pairs and JSON reports remain in `build/visual-regression/`. |
| Game state / deterministic render | `npm run snapshot -- <game-dir> --freeze-time --steps 120 [--eval "<js expr>"] [--state-hook __hgameState]` | Same JSON plus `eval` (JSON-serialisable result of the expression, evaluated after ready/steps/keys), `state` (result of `window.__hgameState()` when defined) and `frozenTime: true`; see *Deterministic snapshots* below |
| CPU perf budgets | `npm run bench [-- --samples 30 --warmup 3 --json build/cpu-bench.json]` | Median budget checks, sample counts, mean/P50/P95/P99/max, and CPU/Node environment metadata. Legacy `ms` is the median. Preparation runs outside each measurement. |
| Render perf (browser) | `npm run bench:render [-- --renderer pixi --count 10000 --gpu hardware --json build/render.json]` | Frame intervals, mean/P50/P95/P99/max, long frames, observed GPU/browser/viewport, and budget kind. Covers the Pixi horde, legacy sprite crowds, and default 3D. |
| 3D stress (browser) | `npm run bench:render3d` | 2,000 `createInstancedBatch3D` instances + 64 `createMegaLights3D` lights + `post3d` + procedural sky + `createCameraRig3D`; reports mean/p50/p95/max frame ms (sync `readPixels` per frame so GPU/SwiftShader time is included), draw calls, triangles, visible instances, and a canvas non-blank check (`--instances --lights --frames --budget-p95 --no-post --png --json --chrome`). Gates only on errors, blank canvas, and a very loose p95 (4000 ms) |
| Runtime health | `createDiagnostics().snapshot()` | `fps`, `frameTimeP95Ms`, `frameTimeMaxMs`, `longFrames`, `errorCount`, `lastError` |
| Gameplay event trace | `npm run playtest -- <game-dir> --trace-hook __hgameTrace` | Retained events with simulation tick, event type, and affected object in emission order. |
| Full gameplay scenario | `npm run playtest -- <game-id> --webasset --scenario <module.mjs> --ready "#game[data-engine-ready=true]"` | Named checks, before/after state and frame hashes, timing during the run, and browser errors through post-run verification. |

The lifecycle and recipe commands default to Chromium. Install the other Playwright browsers with `npx playwright-core install firefox webkit` and pass `--browser firefox` or `--browser webkit` to either command. CI runs both suites on all three browser engines. On Linux CI, Firefox runs with `--headed` inside Xvfb and uses Mesa software rendering to create a WebGL context. The lifecycle suite accepts `--executable <path>` to select a specific installed build. Its Chromium `--mobile` run uses an 844×390 touch viewport at DPR 2 and also verifies touch drag, cancellation, settled player motion and tap to restart. This coverage measures desktop browser engines and Chromium touch emulation.

The browser profile and lifecycle suites dispatch persisted page transition events to check that games keep running when a document enters the back/forward cache. The reference games each exercise two persisted cycles and a final non-persisted `pagehide` to verify renderer, input and touch cleanup. The generated bare starters also verify that their state hooks report the live scene and clear it on exit.

The profile and lifecycle suites observe actual startup requests. Generated starters and references load their required runtime modules directly. The 3D starters preload both vendored Three.js modules and fetch each once. The explicit 3D physics profile must request its Rapier WASM, and the other tested startup paths must issue zero Rapier requests.

For 3D release checks, render the packaged directory with `snapshot` and a fixed seed, tier and number of steps. With esbuild installed, the standard and Toy packagers minify `three.module.js` and `three.core.js` while preserving constructor names. Use `--no-minify` when verifying the original source output. Package tests compare exports, the MIT notice and source bytes.

CI starts the extracted Toy package at `/toy/release-probe/index.html`. The runner compares frozen frames from both release formats against the `--no-minify` archive using the snapshot diff threshold of zero. Screenshots and reports are recorded in `build/package-browser/` and uploaded as the `package-browser` artifact. Use `snapshot --entry <fixture-path>` for a nested entry. Snapshot reports include observed console and HTTP errors even if the page fails before capture.

Snapshots use Playwright's installed Chromium headless shell by default and fall back to a system browser when that executable is absent. Use `--chrome <path>` or `HGAME_CHROME` to select an executable. Reports include the browser version used for the capture.

The Chromium touch suite holds a drag through a simulated visibility change, checks that pointer state and the virtual stick clear, then verifies a fresh drag and cancellation after returning. Scheduler tests control the animation timestamps across a visibility transition and verify that the first visible frame uses zero elapsed time and starts a fresh diagnostic window. Hidden frames are excluded from runtime diagnostic and adaptive-quality sampling. Playtest telemetry still records stalls throughout its own measurement window.

The desktop CI lifecycle run adds `--context-recovery`. This loses and restores the actual WebGL context twice per game and requires scene pixels, advancing simulation ticks and zero GL errors after each restoration. The 2D probe checks a reused image and two same-size `customDraw` sprites with distinct pixel coverage. The 3D probe renders two versions of the same model key and checks that disposing the provider returns Three's geometry count to its prior value. It also feeds slow frame intervals to a separate 4K canvas at DPR 2 and checks that the physical WebGL buffer shrinks, post-processing uses the same dimensions, and the transition creates one set of post-processing targets. Node tests cover dynamic text textures, failed image upload retries, and ownership of shared or private 3D resources.

Run `npm run test:browser:lifecycle -- --webasset --soak-seconds 120 --executable <chromium-path>` for sustained desktop play on the registered reference games. The command emits one JSON record per game. It starts with 3000 enemies in Survivor and fixed medium quality in Arena. The script moves, attacks and chooses upgrades through normal inputs. Four timed windows verify simulation and combat progress and report frame percentiles plus post-GC JS heap checkpoints. The default `--gpu hardware` verifies the observed GPU matches the request. Use `--gpu software` to measure a separate rendering path. The duration is per game and starts after warmup. These samples measure JS heap, and GPU allocations require separate instrumentation.

`bench:render` measures animation frame intervals at the browser's normal cadence. Repeat `--renderer pixi` with `--count 1000`, `3000` or `10000` to establish a workload curve. The Pixi fixture runs the real horde simulation at medium quality on WebGL by default. Use `--backend auto` to follow the game fallback order or `--backend webgpu --gpu hardware` to require WebGPU. The report records the actual backend, available adapter information and visible population.

`--touch` emulates a mobile Chromium viewport at 844×390 CSS pixels and DPR 2. Override it with `--viewport` and `--dpr`. Use `--quality auto` to record the resulting quality tier and physical canvas dimensions before and after sampling. This captures mobile layout and rendering load on the host GPU.

Add `--soak-seconds 120` for sustained frame pacing. The report includes elapsed time, approximately five-second windows aligned to frame boundaries, and the quality tier and canvas size at each boundary. The frame budget applies to the whole-run P95. A timeout preserves the recorded windows.

Use `--measurement readback` to measure frame intervals with a synchronized pixel read. This mode includes the GPU work waiting in the queue and the CPU/GPU synchronization cost. Hardware readback is informational unless `--budget-p95 <ms>` is supplied. Hardware frame pacing defaults to a 60 Hz interval plus 1 ms of tolerance. The default software budgets are intended for CI smoke checks. The separate 3D stress fixture uses synchronized readback, fixed medium quality and `1/60` of simulation per rendered frame.

CI runs frame pacing and 3D stress in independent jobs. Each job uploads its JSON report (`render-bench` or `render-bench-3d`) when the benchmark wrote one, including when it exceeds its budget.

Playtest reports retain whole-run frame count, duration, mean, maximum and long-frame totals. A bounded uniform reservoir holds up to 600 detailed intervals. P50/P95/P99 are exact within that set and are explicitly marked `quantilesApproximate` when the run exceeds its capacity. Multi-second intervals remain included. The stop checkpoint waits for a final frame so a stall crossing the requested end time remains visible. `requestedDurationMs`, `actualDurationMs` and `frameStats.measuredMs` describe the actual measurement window after startup and initial capture.

A scenario is a trusted local Node module. Export `async function run({ page, readState, checkpoint, auditUi })` to drive ordinary Playwright inputs, call `await auditUi('playing' | 'upgrade' | 'gameover')` to enforce live Anti-Bloat UI & layout bounds at each game phase, and call `await checkpoint(name, async () => { ... })` for assertions. An assertion failure records the checkpoint and exits nonzero. Return JSON data from `run` to include it in the report. An optional `verify(context, result)` runs after the final frame and telemetry capture, so reloading the page keeps the gameplay measurements intact. The measured `run` phase should stay on the initial document. Pass a game directory for the existing local fixture, or use `--webasset` with a registered local game ID. See `examples/survivor-2d/tests/acceptance.mjs` and `examples/arena-3d/tests/acceptance.mjs` for full references.

## Rules of thumb

Use `app.platform.diagnostics.recordEvent({ tick, type, subject, details })` for meaningful state transitions. Pass JSON-safe scalar values in `details` and expose `app.platform.diagnostics.readEvents` as a browser hook in debug mode. `--trace-hook` must name an existing function and includes at most its newest 128 events. The report's `dropped` count includes earlier events lost to either limit. The arena reference records beacon interruptions and resumptions, damage and the run result with `--query debug=1 --trace-hook __hgameTrace`.

- A declared state hook must return JSON-serializable state. Exceptions and serialization errors fail the playtest explicitly. Reference lifecycle scenarios use the existing game-owned simulation API to accelerate combat and apply controlled enemy pressure. They never overwrite health, death flags or scores.
- `app.dispose()` is idempotent and marks `app.disposed` before cleanup. Pending installation rejects and scheduled work stops. Cleanup continues after callback failures, then reports an `AggregateError`. Injected platforms remain caller-owned. UI projects retain command-driven rendering with no idle RAF.
- Snapshots use the same inputs and SwiftShader environment for each reference/candidate pair. `check:visual` renders its fixed accepted commit from a temporary Git archive and requires that commit to be available locally. CI fetches full history. Source changes and cache misses preserve the accepted reference.
- Review intentional visual changes with `npm run check:visual -- --reference <commit>` and inspect the PNG pairs. Accept a new reference by changing the full commit hash in `tests/visual-reference.json` in a reviewed commit.
- `--update-baseline` replaces a baseline atomically only after capture checks succeed. Failed page, HTTP, state, eval, blank-image or output checks preserve the previous baseline. An output path equal to the baseline requires an explicit update.
- A blank canvas (`nonBlankRatio < 0.001`) or any `consoleErrors` always fails the snapshot.
- When the diff is non-zero, read `baseline.bbox` to locate what changed, then look at the PNG.
- Config and constructor errors name the valid values and suggest the closest match; fix from the message instead of searching docs.

## Deterministic snapshots (`--freeze-time`)
- `--freeze-time` (implied by `--steps`) installs, before any page script, a virtual clock: `performance.now`, `Date.now`/`new Date()` start fixed at 0 / 1700000000000, `requestAnimationFrame` callbacks only run when the tool steps them (1/60 s per frame), and `Math.random` is seeded. Wall-clock HUD text, fps read-outs and time-driven animation become reproducible.
- `--steps N` advances exactly N frames (default: `--wait` / 16.67 ms). `--keys k:ms` holds the key for `ms` of *virtual* time (rounded to frames). `setTimeout`/`setInterval` are not virtualised; games should drive logic from rAF/`performance.now`.
- Opt-in for games: read time only through `performance.now`/`Date.now`/rAF timestamps, use `Math.random` (or a seed derived from `performance.now()`) for randomness, and avoid unbounded async work after the ready marker. The ready selector is awaited without stepping, so frames before ready are not counted; if the page needs frames to become ready, the tool pumps them.
- Games that start with a fallback can set `data-visual-loading` on the canvas and clear it when visual assets settle. Pass `--visual-ready '#game:not([data-visual-loading])'` after the usual `--ready` selector. This second wait never steps a frozen clock. The reference-image comparisons use both selectors.
- `--eval "<expr>"` runs in the page (global scope, `await` allowed in the result) and the value is returned under `report.eval`. Example: `--eval "document.querySelector('#hud').textContent"`.
- `--state-hook <name>` (default `__hgameState`): if `window[name]` is a function, its JSON result is included as `report.state` automatically. Expose e.g. `window.__hgameState = () => ({ enemies: sim.enemies.count, tick: sim.tick })` so tests can assert game state, not just pixels.
- Example: `examples/survivor-2d/baseline.png` is produced and checked with `--ready "#game[data-engine-ready=true]" --freeze-time --steps 120 --baseline examples/survivor-2d/baseline.png --threshold 0`.

### 单游戏局域网试玩

`npm run webasset -- --lan-game <slug> --lan-host <局域网 IPv4>` 单独启动 WebAsset 的局域网试玩监听。使用本机已配置的非回环私有 IPv4 地址。打开命令输出的链接，手机应与电脑位于同一子网。

该监听只提供选中的游戏和公用 HGame 运行时，WebAsset 管理 API 继续使用默认的本机入口。普通 `npm run webasset` 仍只监听回环地址。若同子网设备连不上，检查系统是否允许当前 Node 程序接收试玩端口的入站连接。局域网 HTTP 适合验证触控，浏览器可能限制 HTTP 下的硬件手柄等安全上下文功能。
