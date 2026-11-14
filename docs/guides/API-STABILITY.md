# API Stability & Versioning

HGame follows [Semantic Versioning](https://semver.org/) from 1.0.0. The version lives in `assets/runtime/VERSION`, `HGAME_VERSION` (`assets/runtime/index.js`) and the root `package.json`; they must match.

## Tiers

| Tier | What | Guarantee |
|---|---|---|
| **Stable** | Everything re-exported from `assets/runtime/index.js`; the `engine.config.json` schema; `create-game` / `package-game` CLI flags; the WebAsset Host protocol (`platform/protocol.js`). | No breaking change inside a major version. Deprecations ship at least one minor release before removal and are listed in `CHANGELOG.md`. |
| **Stable subpath** | Documented factories imported by subpath: `integrations/canvas2d.js`, `webgl2d.js`, `three.js`, `camera3d.js`, `quality3d.js`, `touch-controls.js`, `physics/*`. | Same as Stable. Imports of the original file path keep working even when internals are split into sub-folders. |
| **Experimental** | `lockstep/`, `integrations/post3d.js` (SSGI/SSR), `lighting3d.js` (MegaLights, probe volumes), `culling3d.js`, `world/open-world.js`, `model3d.js` VAT crowds, `network/`. | May change in a minor release; changes are called out under "Experimental" in the changelog. |
| **Internal** | Anything inside sub-folders such as `post3d/`, `model3d/`, `input/`, `audio/`, `red-dot/`. | No guarantee. Import the parent file instead. |

## Type declarations

`types/` holds generated `.d.ts` files (`npm run build:types`; CI runs `npm run check:types` and fails when stale). Declarations are inferred from the JSDoc and code, so treat them as a navigation aid that gets more precise as JSDoc improves.

## Verifying a change

1. `npm run check` (tests, physics parity, types) and `npm run bench` (performance budgets).
2. Browser coverage runs in CI (`npm run test:browser`, `npm run test:browser:pbr`); run it locally with `playwright-core` + Chromium for rendering changes.

## Migration

Breaking changes (major versions only) get a section here: what changed, why, and a before/after snippet. None so far.
