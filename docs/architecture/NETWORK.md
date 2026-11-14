# HGame Network Architecture v1

The optional `network/` workspace provides shared browser/client/server multiplayer infrastructure. It is deliberately installed and built separately from the HGame runtime so single-player games do not inherit Colyseus or server dependencies.

## Workspace

| Package | Responsibility |
|---|---|
| `packages/protocol` | Versioned binary wire format (lockstep frames & quantized `encodeTransformSnapshot`/`encodeTransformDelta`), validation, deterministic integer helpers, confirmed-frame queue |
| `packages/simulation` | Shared movement step (`applyLinearMotionInput`), server-side `LagCompensationHistory` (bounded snapshot ring buffer, `sampleAt`, `verifyHit2D`), `InterestGrid2D` spatial AOI with enter/exit hysteresis, and Priority × Starvation `ReplicationPriorityScheduler` |
| `packages/client` | Colyseus client lifecycle, reconnect-token storage, `SnapshotInterpolationBuffer`, `AdaptiveInputLeadController`, and `HGameLockstepChannel` reconnect sync (`requestSync`, `onSyncStatus`, `autoSyncOnReconnect`) |
| `apps/server` | Colyseus server factory, local conformance rooms, per-session `TokenBucketRateLimiter` flood protection, and optional lockstep anti-stall/history replay |
| `apps/network-lab` | Browser harness for state sync, prediction, and confirmed frames |

## Synchronization modes

| Mode | Mechanism | Contract |
|---|---|---|
| A — State sync | Server-owned Colyseus Schema state | Clients submit commands; each game defines authoritative state and validation |
| B — Predicted sync | Colyseus input prediction | Client and server import the same game-owned step function |
| C — Confirmed lockstep | Versioned binary input frames | Server broadcasts only complete frames in stable slot order |

The lab's counter and linear-motion logic are conformance fixtures, not reusable game rules.

## Confirmed-frame protocol

An input packet contains a magic value, protocol version, flags, payload length, server-issued match tag, client sequence, target frame, and opaque game payload. The client does not choose its player slot; the server derives the slot from the authenticated room session.

The server accepts one input per active slot per target frame and seals only the next contiguous frame after every active slot has submitted. By default (`frameDeadlineTicks: 0`), a no-op must be explicit and missing input stalls the frame without silently synthesizing input or skipping gaps. Rooms can optionally enable anti-stall recovery by configuring `frameDeadlineTicks > 0`, which synthesizes explicit `NO_OP` inputs for missing active slots after waiting that many fixed ticks, and retain a bounded `frameHistory` (configurable via `maxHistoryFrames`) so reconnecting peers can request missed frames via `'lockstep:sync'` / `'lockstep:sync-status'` (reporting `'history_evicted'` if requested ticks aged out).

Client-reported hashes are diagnostic peer comparisons, not authoritative server state. Canonical world snapshots, rollback, and trusted game simulation remain the responsibility of game-specific rooms or server logic (`LagCompensationHistory` provides a bounded snapshot/ray helper only).

## Production boundaries

- The current server uses in-memory rooms; process restart ends active matches.
- No database, Redis, cross-process presence, ranked queues, bot assignment, or persistent replay store is included.
- Platform identity, authentication, team balancing, reconnect recovery, and game rules are game/server adapters.
- The SDK boundary does not assume undocumented platform globals.
- TLS termination, deployment, rate limits, monitoring, and production hardening remain deployment work.
- Rapier is not automatically loaded by the network server. Games choose and verify their own deterministic simulation build.

## Local commands

```powershell
cd network
npm ci
npm test
npm run check
npm run build
npm run dev:server
npm run dev:lab
```

The browser lab can be opened in two tabs to verify room replication and frame sealing. See `network/README.md` for the current endpoint and detailed packet layout.
