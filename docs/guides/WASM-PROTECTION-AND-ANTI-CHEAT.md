# WASM Core Isolation and Multiplayer Anti-Cheat Guide

This guide explains how a downstream HGame project can isolate sensitive balance configs, seeded RNG, and simulation rules inside an optional Rust WebAssembly module (`rust-core`), harden the browser distribution bundle, and reuse the exact same WASM binary on a Node.js (`>=22.12.0`) / `@hgame/network` server for anti-cheat verification.

> **Architecture boundary**: Keep `vendor/hgame/` unmodified and keep game rules out of `network/`. The HGame runtime owns `Scene`, `Entity`, `Component`, renderer adapters, and optional `lockstep/confirmed-frames.js`; `network/` owns Colyseus room lifecycle, transport, and `HGIN`/`HGFR` frame sealing; each game owns its balance schema, `rust-core`, `core-bridge`, and server-side verification rooms.

---

## Authority and Isolation Boundary

```text
Browser (90% Presentation)                  Server (Node.js / @hgame/network)
──────────────────────────────────────────  ──────────────────────────────────────────
HGame Application / Scene / Renderer        Colyseus GameRoom / Settlement Endpoint
  │  (Canvas 2D / Three.js / DOM / Audio)     │  (createHGameNetworkServer)
  ▼                                           ▼
src/core-bridge/ (esbuild + obfuscated)     server/core-verifier (unmodified Node WASM)
  │  (typed snapshots & command log)          │  (HMAC seed challenge & shadow/replay)
  ▼                                           ▼
Inlined Masked Payload ──(same binary)──▶  server/wasm/core.wasm (0 imports, 1-char ABI)
```

### Key principles

1. **Pure `wasm32-unknown-unknown` `extern "C"` ABI**: Avoid `wasm-bindgen` glue when maximal symbol minimization and dual-end portability are needed. Export only single-letter entry points (`i` init, `w` write-command ptr, `r` read-snapshot ptr, `s` step, `h` 64-bit state hash) with zero host imports (`WebAssembly.Module.imports(mod).length === 0`).
2. **Schema-driven binary config**: Generate both the masked binary payload (`cfg.bin`, protected with an FNV-1a checksum) and fixed-offset, fixed-capacity Rust reader (`cfg_gen.rs`) from a single `balance.schema.json`. Keep raw balance JSON files outside `dist/`.
3. **Zero-panic, zero-heap-allocation step**: Do not use `unwrap()`, `expect()`, `format!()`, `slice[i]`, or dynamic `Vec` allocations on the hot path. Use `.get()` / `.get_mut()`, `checked_rem()`, `wrapping_*`, and `saturating_*` with pre-allocated static I/O buffers.
4. **Two-stage `esbuild` client hardening**: Bundle and minify `src/core-bridge/` separately from `src/main.ts`, then run `javascript-obfuscator` (`target: 'browser-no-eval'`, `ignoreImports: true`) on the `core-bridge` bundle *after* `esbuild` minification so expression splitting is not folded back, while leaving the HGame rendering layer un-obfuscated at full frame rate.
5. **Cross-platform path and section stripping**: Build `rust-core` using `CARGO_ENCODED_RUSTFLAGS` (`\x1f`-delimited `--remap-path-prefix` entries) and strip all WASM Custom Sections (`section_id === 0`: `producers`, `name`, `target_features`, debug sections) before generating server and client artifacts.

---

## Multiplayer Anti-Cheat Mapping onto `@hgame/network`

Client obfuscation raises static reverse-engineering cost; multiplayer fairness requires authoritative server verification. Because `core.wasm` has zero browser dependencies, the Node.js backend instantiates the exact same module per match or replay (`new WebAssembly.Instance(CORE_MODULE, {})`).

| Game Model | `@hgame/network` / Runtime Mechanism | Server `core.wasm` Role |
|---|---|---|
| **PvE / Roguelike / Leaderboard Settlement** | Signed seed challenge (`HMAC-SHA256`) + settlement endpoint | Issue a time-limited signed `{ matchId, seed }`; upon completion, replay the client's compact `cmdLog` inside a fresh server `core.wasm` instance, check step/rate limits, verify final `h()`, and compute rewards exclusively from server output. |
| **Mode A — State Sync** | Colyseus Schema room (`lab_state_sync` pattern) | Run `core.wasm` exclusively on the server room; clients send semantic commands and never receive unrevealed deck order, loot RNG seeds, or fog-of-war enemy state. |
| **Mode B — Predicted Sync** | Colyseus `defineInput` / `setFixedTimestep` | Both client `core-bridge` and server room run `core.wasm`; server remains authoritative on conflicts, cooldowns, and hidden state. |
| **Mode C — Confirmed Lockstep** | `HGIN`/`HGFR` relay + `vendor/hgame/lockstep/confirmed-frames.js` | Server seals complete frames in stable slot order and steps a shadow `core.wasm` instance per room, comparing authoritative `h()` hashes periodically rather than trusting peer-reported hashes alone. |

---

## Determinism Rules

- **Integer and fixed-point arithmetic**: Represent coordinates, damage multipliers, timers, and probabilities in integer or fixed-point units inside `rust-core` so browser and Node.js V8/WASM execution produce bit-identical snapshots and 64-bit hashes.
- **Self-contained PRNG**: Use an explicit deterministic generator such as `SplitMix64` seeded per match; never call `Math.random()` or `Date.now()` inside authoritative simulation logic.
- **Stable iteration order**: Assign deterministic numeric entity/actor IDs and iterate in sorted ID order.
- **Physics pairing**: If physics is required, enable the matching pinned `@dimforge/rapier2d-deterministic@0.21.0` or `@dimforge/rapier3d-deterministic@0.21.0` backend (`--with physics2d` / `--with physics3d` in `scripts/create-game.mjs`) and verify the exact client/server Rapier build separately, as `core.wasm` and Rapier maintain separate linear memories.

---

## Verification Gates

Run automated checks in CI / release builds before shipping:

1. **Distribution hygiene**: Confirm `dist/` contains no `.map`, `.rs`, `cfg.bin`, raw balance `.json` files (while preserving legitimate HGame `game.config.json` and `engine.config.json`), or exposed core `.wasm` files (only `vendor/hgame/vendor/rapier2d|3d/rapier2d|3d.wasm` when physics is enabled).
2. **String and symbol audit**: Confirm `server/wasm/core.wasm` has zero Custom Sections, zero imports, only single-letter exports (`memory`, `i`, `w`, `r`, `s`, `h`), and zero panic/path strings (`panicked at`, `index out of bounds`, `capacity overflow`, `.rs`, `.cargo`, local home directory names).
3. **Dual-end deterministic parity**: Feed 1,000+ randomized commands (and 10,000+ ticks for lockstep projects; see `docs/architecture/LOCKSTEP.md`) into independent `server/wasm/core.wasm` and decoded client-payload instances and assert identical snapshots and `h()` hashes on every tick.
4. **Trace comparison**: Use `createTraceRecorder()` (`docs/guides/TRACE-RECORDER.md`) to compare committed state transitions across browser and Node.js runs under fixed seeds.
