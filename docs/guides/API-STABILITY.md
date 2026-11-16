# API Stability & Versioning

HGame follows [Semantic Versioning](https://semver.org/) from 1.0.0. The version lives in `assets/runtime/VERSION`, `HGAME_VERSION` (`assets/runtime/index.js`) and the root `package.json`; they must match.

## Tiers

| Tier | What | Guarantee |
|---|---|---|
| **Stable** | Core, platform, animation, time, UI and stable world helpers, the `engine.config.json` schema, `create-game` / `package-game` CLI flags, and the WebAsset Host protocol (`platform/protocol.js`). | No breaking change inside a major version. Deprecations ship at least one minor release before removal and are listed in `CHANGELOG.md`. |
| **Stable subpath** | Documented factories imported by subpath: `integrations/canvas2d.js`, `webgl2d.js`, `three.js`, `camera3d.js`, `quality3d.js`, `touch-controls.js`, `physics/*`. | Same as Stable. Imports of the original file path keep working even when internals are split into sub-folders. |
| **Experimental** | `lockstep/`, `integrations/post3d.js` (SSGI/SSR), `lighting3d.js` (MegaLights, probe volumes), `culling3d.js`, `world/open-world.js`, `model3d.js` VAT crowds, `network/`. | May change in a minor release; changes are called out under "Experimental" in the changelog. |
| **Internal** | Anything inside sub-folders such as `post3d/`, `model3d/`, `input/`, `audio/`, `red-dot/`. | No guarantee. Import the parent file instead. |

Each export record in `docs/api/API-INDEX.json` carries its effective `tier` and its implementation's `declaredIn` module. Re-exports and aliases retain this tier through `index.js` and other facades. A module's top-level tier describes its default contract. The per-export tier governs individual exports. Public factories implemented in nested internal files inherit the contract of their public parent integration.

## Type declarations

`types/` holds generated `.d.ts` files (`npm run build:types`). Generation preserves strict nullability. `npm run check` verifies freshness and runs strict consumer fixtures covering core lifecycle, FSM/behavior-tree context inference, typed saves, error-result narrowing and accidental `any` regressions.

FSM and behavior-tree contexts infer from supplied context objects and typed leaf callbacks. `createVersionedStore<State>()` constrains saved values and returns a discriminated `load()` result. Successful results carry `State`, while failed results carry the supplied fallback. Unspecified stored data and migration inputs use `unknown`. Code consuming historical data should validate or narrow its shape before migration. Detached component owner/scene getters remain nullable.

## Verifying a change

1. `npm run check` (tests, physics parity, types) and `npm run bench` (performance budgets).
2. Browser coverage runs in CI (`npm run test:browser`, `npm run test:browser:pbr`); run it locally with `playwright-core` + Chromium for rendering changes.

## Migration

Breaking changes (major versions only) get a section here: what changed, why, and a before/after snippet. None so far.
