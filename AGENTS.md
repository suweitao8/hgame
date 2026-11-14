# HGame Repository Rules

HGame is a standalone, renderer-neutral HTML5 game runtime. This repository is the source of truth for the engine, starter templates, project generator, tests, and optional multiplayer foundation.

## Source of truth

- Canonical runtime: `assets/runtime/`.
- Runtime version: `assets/runtime/VERSION`; keep it consistent with `HGAME_VERSION` in `assets/runtime/index.js` and the root package version.
- New project generator: `scripts/create-game.mjs`.
- Lean release & WASM packager: `scripts/package-game.mjs` (`build/<id>_<version>/` + `.zip`).
- Offline media curation: `scripts/process-assets.mjs` and `scripts/process-audio.mjs`.
- Starter projects: `assets/template/` and `assets/profiles/`.
- Optional multiplayer workspace: `network/`; it owns its package manifest and lockfile.
- Global HGame Skill installations and game projects are downstream consumers. Do not silently edit them while changing this repository.

## Architecture boundaries

1. Keep the runtime modular. A project loads only the profile and optional features declared by `engine.config.json`.
2. `core/` owns Scene, Entity, Component, Prefab, and the single application scheduler.
3. `platform/` owns browser services and the optional WebAsset Host protocol adapter. Game rules, AI, content, and renderers remain game-owned.
4. `physics/` uses the pinned deterministic Rapier 0.21.0 packages. Offline/online mode never changes the selected physics backend.
5. `lockstep/` is an optional confirmed-frame scheduler, not a complete transport, authoritative simulation, rollback, or matchmaking implementation.
6. `network/` owns transport, room/session lifecycle, and synchronization primitives only. It must not absorb game-specific rules, AI, balance, or save data.

## Public repository safety

- Never add private material libraries, local Unreal exports, proprietary game assets, game dumps, reverse-engineering reports, secrets, or machine-specific paths.
- Keep only third-party runtime files with their corresponding license notices. HGame is licensed under `Apache-2.0` (`LICENSE`); preserve Rapier's `Apache-2.0` notice (`assets/runtime/vendor/LICENSE-rapier.txt`) and Three.js's `MIT` license (`assets/optional/three/LICENSE`) when distributing those files.
- Keep `.env.example`; never commit `.env` or credentials.

## Verification

- Runtime tests: `npm test`.
- Vendored physics parity: `npm run check:physics`.
- Network tests/check/build: run the corresponding npm command from `network/` or use the root forwarding scripts (`npm run check:all`).
- Package a game release (`build/<id>_<version>/` + `.zip`): `npm run package:game -- <game-dir> --version <ver>`.
- Full engine SDK release build (`build/hgame_1_0/` + `.zip`): `npm run release`.
- Browser profile smoke tests are optional and require `playwright-core` plus a Chromium executable.
- Run verification before committing. Do not claim browser/device coverage when only Node tests ran.

## Change discipline

- Preserve existing public APIs unless a breaking change is intentional and documented.
- Update tests and `CHANGELOG.md` for runtime behavior changes.
- Keep generated game projects self-contained; do not add CDN runtime dependencies.
- Do not automatically migrate or rewrite existing games.
- Never use destructive Git commands such as `reset --hard` or `clean -fd`.
