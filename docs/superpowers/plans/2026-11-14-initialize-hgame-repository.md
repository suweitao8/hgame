# Initialize HGame Repository Implementation Plan

> **For agentic workers:** Use this plan task-by-task. Each task ends with a checkable result.

**Goal:** Turn the empty `suweitao8/hgame` repository into the canonical, standalone source repository for the HGame HTML5 runtime and its optional multiplayer foundation.

**Architecture:** Copy the canonical flat runtime and standalone project generator from the global HGame skill. Keep the multiplayer workspace independently installable under `network/`. Publish only engine-authored code, generic documentation, tests, templates, and separately licensed Three.js/Rapier runtime files; exclude private material assets and source-game research.

**Tech Stack:** JavaScript ES modules, Node.js 22.12+, npm, Three.js 0.187.0 (vendored only for generated 3D projects), deterministic Rapier 0.21.0, TypeScript 5.9, Colyseus 0.18, GitHub Actions.

## Global Constraints

- The canonical runtime is `assets/runtime/`, version `1.0.0`.
- Rapier2D and Rapier3D are pinned to deterministic `0.21.0`; no CDN runtime dependency.
- `network/` keeps its own package manifest and lockfile; root dependencies do not absorb Colyseus.
- Do not copy `assets/material-library/`, local Unreal exports, private game assets, or game-specific reverse-engineering reports.
- Do not modify the existing WebAsset checkout or global HGame skill during repository initialization.
- Do not choose an open-source license on the user's behalf.

## Review Focus

- Generator output must be self-contained and must not include unused Rapier dimensions or Three.js in 2D/UI projects.
- Physics vendor rebuilds must be byte-for-byte reproducible against pinned npm packages.
- Network package builds/tests must remain isolated from root engine dependencies.
- Public documentation must not disclose private local paths, private material-library details, or third-party source-game internals.
- No secrets, `node_modules`, build output, or private assets may enter Git.

---

### Task 1: Establish the engine source tree

**Files:**
- Create: `assets/runtime/`, `assets/template/`, `assets/profiles/`, `assets/optional/three/`
- Create: `scripts/create-game.mjs`, `scripts/preview.mjs`, `scripts/build-physics.mjs`
- Create: `tests/` with portable runtime tests

- [ ] Copy the 44-file canonical runtime and the standalone generator/template/profile/Three.js sources.
- [ ] Exclude the private curated material library and its importer/exporter tooling.
- [ ] Keep the generic PBR loader test independent of private material catalogs.
- [ ] Run `node --test tests/*.test.mjs` and require all tests to pass.

### Task 2: Add the isolated multiplayer foundation

**Files:**
- Create: `network/` from the existing `hgame-network/` workspace, excluding `node_modules/` and `dist/`
- Create: `docs/architecture/NETWORK.md`

- [ ] Preserve the network workspace manifest, lockfile, packages, apps, and conformance tests.
- [ ] Keep its npm install/build/test lifecycle independent from the root package.
- [ ] Run `npm ci` and `npm test` inside `network/`.

### Task 3: Define repository contracts and public documentation

**Files:**
- Create: `README.md`, `AGENTS.md`, `.gitignore`, `CHANGELOG.md`, root `package.json`
- Create: `docs/architecture/`, `docs/guides/`, `docs/rendering/`
- Create: `.github/workflows/ci.yml`

- [ ] Document runtime boundaries, generator usage, physics rebuild, optional network workspace, and verification commands.
- [ ] Keep the repository unlicensed until the owner chooses a license.
- [ ] Add CI for runtime tests, physics vendor parity, and network checks/tests.

### Task 4: Verify, commit, and publish

- [ ] Install root development dependencies and generate a lockfile.
- [ ] Run runtime tests, physics vendor check, network tests/check/build, and generator smoke tests.
- [ ] Audit the staged file list for private assets, secrets, generated output, and unexpected files.
- [ ] Commit the initial repository snapshot on `main`.
- [ ] Push `main` to `origin` and verify the remote commit SHA.
