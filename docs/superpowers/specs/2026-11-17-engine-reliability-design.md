# HGame reliability and production readiness design

Status is proposed for user approval on 2026-11-17.

## Intent

Improve HGame toward the user's goal of a ten-out-of-ten self-made game engine. Its intended users are AI agents building self-contained 2D, 3D, and command-driven UI games. Judge progress through correct public contracts, repeatable browser results, representative performance measurements, and complete gameplay and lifecycle verification.

The five improvement areas from the preceding evaluation establish the initial direction. Implementation details and the order below are the agent's proposals. Further runtime fixes should follow evidence uncovered by these checks. A numerical rating alone cannot establish completion.

## Current evidence

- The current branch is `main`. Existing user changes are present in two skill files and local untracked directories.
- The preceding evaluation passed `check:all`, including 209 main tests and 32 network tests, ten CPU benchmarks, six browser configurations, and world-aligned PBR browser checks. Implementation will obtain fresh evidence after changes.
- Snapshot CI keys its baseline cache on current runtime and example contents and generates a fresh baseline on cache misses. Candidate output can consequently become its own reference.
- A read-only diagnostic using the existing snapshot CLI and a temporary copy of the reference PNG reproduced a failed `--eval` returning exit code 1 while `--update-baseline` still replaced the baseline. Baseline updates currently occur before all reported failures are checked.
- Generated declarations contain weak public signatures, including FSM methods and versioned save methods. Declaration freshness checks currently compare generated files.
- CPU benchmarks select the fastest sample. Browser stress thresholds are intentionally generous for software rendering.
- Playtest telemetry discards frame intervals of 2000 ms or more and retains only 600 recent intervals. Whole-run stalls can disappear from its report.
- Reference examples already provide deterministic simulation, restart paths, saved best scores, and page teardown. These provide existing entry points for stronger integration checks.
- API stability is assigned primarily by export module. The root facade can label an experimental implementation as stable through re-export.

## Approaches considered

### A. Add more engine subsystems

This expands the feature surface and could enable new genres. It also increases the number of combinations whose correctness and performance require evidence. The current evaluation identifies validation and contract gaps that would persist through that expansion.

### B. Strengthen the existing engine in verified stages

Retain current architecture and entry points. Improve regression detection and public contracts, measure representative workloads, and exercise complete game and resource lifecycles. Fix observed runtime failures through focused regression tests. This provides useful improvements to current and future projects with bounded compatibility risk.

### C. Replace the runtime architecture

A broad rewrite could establish a different programming model but would require revalidating generators, existing projects, render adapters, physics, packaging, and network boundaries. Current evidence supports retaining these foundations.

The agent proposes approach B. The user has delegated implementation choices through the outcome-oriented goal. Design approval covers this approach and the staged scope below.

## Constraints

- Work directly on `main` in the active workspace with native Codex tools.
- Preserve existing user changes. Stage only files produced by this work.
- Keep existing public runtime behavior unless a verified defect requires correction. Document every runtime behavior change in `CHANGELOG.md`.
- Keep Rapier at the pinned 0.21.0 deterministic backends and maintain the single application scheduler.
- Keep games self-contained and renderer-neutral at the core. Keep game-specific simulation and state in reference projects.
- Use text, JSON, and CLI workflows. Follow the repository's existing UI rules for any touched game interfaces.
- Use WebAsset for live project registration and interactive QA. Headless tools may use their existing temporary loopback fixtures.
- Changes remain in this engine repository. Downstream games and global skills require separate authorization.
- Run required verification before focused commits and push each verified commit when `origin` is configured.

## Stage 1. Trustworthy visual regression

Make a candidate compare against an explicit accepted reference that survives source changes. The reference revision or baseline update must be visible in version control. Missing or incompatible references produce actionable failures. Candidate rendering cannot automatically approve a new baseline.

An explicit baseline update commits only a successful capture. Page, HTTP, state-hook, evaluation, blank-image, and output failures preserve the previous accepted baseline byte-for-byte. Write validated replacement data atomically and report the update only after it succeeds.

Prefer rendering the accepted reference revision and candidate in the same pinned browser environment using temporary test fixtures. This avoids treating screenshots from different operating systems as interchangeable. Preserve deterministic inputs, viewport, render settings, and scene checkpoints. Keep both images and useful diff diagnostics as CI artifacts on failures.

Add a regression test proving that a deliberate visual change fails while an identical reference passes. Exercise fresh checkout behavior and intentional reference updates. Baseline fixture creation uses source files from Git without creating branches or worktrees.

## Stage 2. Public API contracts

Strengthen JSDoc at its source and regenerate declarations. Start with core lifecycle APIs, FSM and behavior-tree APIs, and save-store APIs. Represent callback context and stored data through appropriate generics and concrete result shapes.

Add strict TypeScript consumer fixtures that use normal public imports. Verify valid calls compile and invalid arguments, callback shapes, and result usage produce expected type errors. Include a check that catches accidental `any` in the contracts being hardened. Preserve existing JavaScript calling conventions and document intentional type-level corrections.

Resolve stability by the declaring implementation and explicit public overrides. Experimental exports keep their designation through the root facade and aliases. Keep API index, query output, and stability documentation consistent. Test representative stable, experimental, and internal boundaries.

## Stage 3. Representative performance and telemetry

Report sample counts, warmup policy, median, P95, P99, maximum, and environment metadata for CPU workloads. Keep existing machine-readable fields compatible where practical. Measure a repeatable workload with sufficient active objects for every sample.

Separate software-renderer health thresholds from configurable target-device frame budgets. Browser reports identify the actual renderer, viewport, quality and workload so results remain interpretable. Add real-GPU selection to benchmark tools where supported and run it on this machine when available.

Preserve all finite positive frame intervals in playtest summaries, including multi-second stalls. Track whole-run counts and extremes even when detailed telemetry storage is bounded. Align reported sampling windows and durations with what actually ran. Invalid numerical options fail clearly. Tests cover long stalls, empty samples, invalid samples, percentile boundaries, and long recordings.

Budget choices follow measured results and declared workloads. Software rendering and desktop measurements retain their environment labels.

## Stage 4. Complete game and lifecycle verification

Extend the current reference projects and browser harness with small serializable state hooks where needed. Exercise movement, combat progress, death or completion, repeated restart, and saved-progress recovery through normal entry points. Use deterministic state assertions in addition to nonblank and changed-image checks.

Exercise application start/stop/dispose, repeated creation, scene changes, input release, scheduled callbacks, and renderer/resource teardown in focused fixtures. Verify disposal is safe when repeated and that disposed applications cease work. Preserve UI profile behavior with no idle animation loop.

Fix confirmed lifecycle or integration defects with regression tests. Keep browser-only instrumentation in verification tooling or existing debug/state hooks. Avoid adding player-facing controls for tests.

Run headless browser scenarios and the reference game suites in CI. For live example delivery, verify WebAsset discovery and isolated runtime loading using the required config allowlist, and publish verified playable links in the final report.

## Stage 5. Evidence-led runtime refinement and delivery

Review failures, type-contract gaps, and measured hotspots exposed by the prior stages. Address high-impact correctness and avoidable runtime costs using existing modules. Re-run the same scenarios to establish the resulting behavior and performance.

Update the focused architecture, verification and stability guides to match delivered behavior. Keep a concise readiness record of commands, environments, outcomes, and remaining coverage limits. The record must distinguish machine measurements, browser simulations and real-device coverage.

## Acceptance

1. A deliberate candidate visual regression fails against an accepted reference in a reproducible browser test. Failed captures and failed baseline updates preserve the accepted baseline byte-for-byte.
2. Strict consumer examples verify the hardened public contracts and catch accidental loss of type safety.
3. Public API stability remains consistent through re-exports and machine-readable queries.
4. Performance reports expose sample distributions and environments. Multi-second stalls remain visible and actionable.
5. Reference game scenarios prove gameplay progress, restart, persistence and teardown, with failures returning nonzero status.
6. Confirmed runtime defects have focused regression coverage and documented fixes.
7. `npm run check` passes for each completed stage. `npm run check:all` also passes whenever network code changes and during final integration verification.
8. Relevant CPU, browser, snapshot, playtest, example and UI checks pass for the features changed. Test coverage matches each claim.
9. Each completed stage is committed and pushed on `main`, preserving unrelated user changes.
10. Final assessment states completed improvements and measured limits. Any unavailable device coverage remains explicit.

## Builder decisions

The implementer chooses small file boundaries, exact fixture formats, percentile calculation details, and backward-compatible CLI flags after reading existing callers. Use existing TypeScript, Playwright, PNG and simulation tooling. Add dependencies only when a concrete capability requires them.

Use inline implementation in the current conversation after approval. Independent design or code review may be read-only in the inherited workspace when the applicable workflow calls for it.
