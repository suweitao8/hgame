# HGame Network Architecture v1

The optional `network/` workspace provides shared browser/client/server multiplayer infrastructure. It is deliberately installed and built separately from the HGame runtime so single-player games do not inherit Colyseus or server dependencies.

## Workspace

| Package | Responsibility |
|---|---|
| `packages/protocol` | Versioned binary wire format, validation, deterministic integer helpers, confirmed-frame queue |
| `packages/simulation` | Small shared movement step used only for prediction conformance tests |
| `packages/client` | Colyseus client lifecycle, reconnect-token storage, room listeners, lockstep channel |
| `apps/server` | Colyseus server factory and local conformance rooms |
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

The server accepts one input per active slot per target frame and seals only the next contiguous frame after every active slot has submitted. A no-op must be explicit. Missing input stalls the frame; the server does not silently synthesize no-op input or skip a gap.

Client-reported hashes are diagnostic peer comparisons, not authoritative server state. Replay history, canonical snapshots, rollback, and trusted game simulation are not implemented by this relay.

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
