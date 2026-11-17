# HGame reliability implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Improve the approved engine's regression detection, public contracts, performance measurement, and complete-game reliability, and fix defects exposed by that verification.

**Architecture:** Retain the existing runtime and tool entry points. Compare a fixed accepted Git revision with the working tree in a shared browser environment. Harden contracts in source JSDoc and use existing deterministic games for integration checks.

**Tech Stack:** Node 22, native ESM and Node tests, TypeScript declarations and strict consumers, Playwright Chromium, Git, existing PNG tooling.

**Spec:** `docs/superpowers/specs/2026-11-17-engine-reliability-design.md`

## Global constraints

- Work directly on `main` in the active workspace with native Codex tools.
- Preserve existing user changes. Stage only files produced by this work.
- Keep Rapier at the pinned 0.21.0 deterministic backends and maintain the single application scheduler.
- Preserve existing public APIs and self-contained projects. Document runtime fixes in `CHANGELOG.md`.
- Use WebAsset for interactive game QA. Existing headless tools may use temporary loopback fixtures.
- Run `npm run check` before each stage commit, then push immediately. Run `check:all` for network changes and final integration.
- Implement inline in this conversation. Use inherited, read-only independent review when required by the execution workflow.

## Review focus

- A failed capture or failed replacement must preserve a previously accepted PNG, including when source and destination paths coincide.
- Missing reference revisions, malicious CLI-shaped refs, and invalid numeric options must fail clearly before changing accepted artifacts.
- Root-facade re-exports, nested public entry modules, and internal implementation files need consistent export stability.
- Long stalls and long recordings must retain whole-run counts and maxima despite bounded detail storage.
- Repeated restart and disposal must release input, scheduled work and renderer resources while preserving saved progress.

## Task 1. Failure-safe snapshot updates and fixed visual reference

Files include `scripts/snapshot.mjs`, `scripts/check-visual-regression.mjs`, `tests/visual-reference.json`, `tests/snapshot-safety.test.mjs`, `tests/browser-snapshot.mjs`, `.github/workflows/ci.yml`, `package.json`, and the verification guide.

Interfaces preserve `snapshot.mjs` flags and JSON output. The new command `npm run check:visual` compares the working-tree examples with `tests/visual-reference.json`'s explicit full Git revision. Reports and PNGs go into ignored `build/visual-regression/`. `--reference <revision>` supports deliberate reference review. Failed comparison exits 1.

- [x] Add failing coverage proving failed eval, page/state errors, blank captures and destination failures leave baseline bytes intact. Cover same source/destination and explicit successful updates.
- [x] Run focused tests and reproduce failures before changing snapshot behavior.
- [x] Validate capture before baseline replacement, use same-directory temporary write plus atomic rename, preserve the old baseline on failure, and report updates only after success.
- [x] Implement fixed-reference rendering using a temporary `git archive` fixture, existing `build-examples.mjs`, and identical candidate/reference snapshot options. Resolve refs as commits and reject CLI-shaped inputs. Preserve failure artifacts and clean temporary processes/files.
- [x] Add reference manifest validation tests and a browser acceptance that unchanged output passes and deliberately different output fails. Exercise missing refs and fresh fixture setup.
- [x] Replace CI's candidate-hash baseline cache and automatic acceptance with `check:visual`, complete Git history, and uploaded comparison artifacts.
- [x] Run `npm run check`, snapshot browser safety checks, and `npm run check:visual`. Review, commit and push the focused stage.

## Task 2. Public contracts and stability

Files include `assets/runtime/ai/fsm.js`, `ai/bt.js`, `platform/storage.js`, relevant `core/` lifecycle APIs, `scripts/build-types.mjs`, `scripts/build-api-index.mjs`, `scripts/query-api.mjs`, `types/`, `docs/api/API-INDEX.json`, `tests/type-contracts/`, and API/query tests and guides.

Interfaces retain JavaScript calling conventions. State-machine and behavior-tree callbacks carry inferred context. Versioned stores expose concrete discriminated load results and typed stored values. Index export records add their declaring module and effective stability so facade aliases retain the implementation's tier.

- [x] Add strict TypeScript consumer fixtures using root and public subpath imports. Assert valid inference and expected compile errors for incorrect arguments, callbacks and result usage. Add explicit accidental-`any` assertions for the hardened methods.
- [x] Run consumers to establish the failures. Add source JSDoc signatures and generics, then regenerate declarations.
- [x] Cover ordinary lifecycle calls and invalid argument types in consumer fixtures, preserving existing runtime tests.
- [x] Add failing API index tests for stable core APIs, experimental world/lighting exports through the facade, and internal module exclusion.
- [x] Resolve each export's declaration origin and explicit tier, update query display and documentation, and regenerate the index.
- [x] Run `npm run check`, strict consumer checks and query tests. Review, commit and push.

## Task 3. Whole-run telemetry and representative performance

Files include `scripts/playtest.mjs`, `benchmarks/run.mjs`, both render benchmark scripts, a focused shared statistics module if needed, and relevant Node tests and verification documentation.

Interfaces retain existing report fields and add sample/warmup counts, P50/P99, measured duration and environment metadata. Software-renderer health budgets remain distinguishable from explicit target-device budgets. `--gpu software|hardware` selects browser rendering mode without silently relabeling fallback rendering.

- [x] Add failing tests for multi-second stalls, invalid/empty samples, percentile boundaries, long recordings, and invalid numeric CLI options.
- [x] Preserve positive finite intervals and whole-run count/sum/max/long-frame totals. Keep bounded detail with explicit sampling metadata for long reports.
- [x] Replace best-only CPU measurements with warmup plus repeated distribution sampling. Reset or replenish workloads so measured objects remain active. Preserve legacy `ms` as the documented median.
- [x] Add frame distributions, actual WebGL renderer/browser metadata, workload/viewport information and explicit GPU selection to browser benchmarks.
- [x] Run Node tests, CPU budgets, software render benchmarks and available hardware rendering. Record measured limits without inferring mobile performance.
- [x] Run `npm run check`, review, commit and push.

## Task 4. Complete game and lifecycle checks

Files include both reference games' `src/main.js`, their existing simulation/meta tests, `tests/browser-game-lifecycle.mjs`, focused runtime lifecycle tests, and CI scripts.

Interfaces add serializable `window.__hgameState()` hooks to the existing reference projects and reuse current controls and debug simulation hooks. The browser command returns nonzero for stalled gameplay, restart/persistence failures, errors or active work after disposal.

- [x] Add tests covering repeated create/start/stop/dispose, scene changes, callback cancellation and input release. Verify UI mode remains command-driven.
- [x] Run failing tests before fixing confirmed runtime defects, then document the behavior changes.
- [x] Add browser scenarios for movement, combat progress, death/completion, repeated restart, saved-progress reload and teardown, using actual existing entry points.
- [x] Add deterministic state assertions and browser error capture. Keep verification controls hidden from normal gameplay and follow the existing UI rules.
- [x] Run reference simulation, UI lint, browser lifecycle, snapshot and playtest checks. Add the complete browser scenarios to CI.
- [x] Verify live WebAsset discovery/loading for any delivered playable examples using the approved managed root and strict config schema.
- [x] Run `npm run check`, review, commit and push.

## Task 5. Runtime refinement and completion audit

Files are limited to verified hotspots/defects from Tasks 1–4, their regression tests, `CHANGELOG.md`, and a concise readiness report under `docs/guides/`.

- [x] Inspect new failures and measurements, prioritize high-impact correctness and runtime cost, and add regression coverage before each correction.
- [x] Re-run identical before/after scenarios and preserve their actual measurements.
- [x] Run `npm run check:all`, CPU budgets, relevant browser/profile/PBR/snapshot/visual/lifecycle checks and strict consumers.
- [x] Independently review the complete diff against the approved spec and fix actionable findings.
- [x] Audit each numbered acceptance condition in the design against current source and fresh verification outputs. Record actual environments, delivered changes and remaining device coverage limits.
- [x] Commit and push the verified final stage. Claim completion only when the approved acceptance conditions are evidenced.

## Plan self-review

Tasks 1–4 cover each concrete gap in the design. Task 5 preserves the evidence-led runtime improvement and final audit scope. Each review-focus condition is covered by its owning task. File decomposition and exact helper signatures remain implementation choices where existing caller inspection is required.
