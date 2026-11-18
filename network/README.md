# HGame Network

HGame Network is the shared HTML5 multiplayer client/server foundation. It is intentionally separate from the HGame browser runtime and from individual games.

## Workspace

```text
network/
├── packages/
│   ├── protocol/       # versioned binary protocol + deterministic integer helpers
│   ├── simulation/     # shared motion step fixture & server LagCompensationHistory
│   └── client/         # Colyseus client, reconnect, SnapshotInterpolationBuffer, AdaptiveInputLeadController & HGameLockstepChannel
└── apps/
    ├── server/         # Colyseus 0.18 server, TokenBucketRateLimiter & conformance rooms
    └── network-lab/    # browser test page; not a shipped game
```

The workspace has its own `package.json` and lockfile. It does not change the HGame runtime's root dependencies or start a second game preview server.

## Requirements and commands

- Node.js `>=22.12.0`
- npm workspaces, TypeScript `5.9.x`, Vite `6.4.6`
- Colyseus Core `0.18.28`, WebSocket transport `0.18.5`, Schema `5.0.48`, browser SDK `0.18.10`

```powershell
cd network
npm ci
npm test
npm run check
npm run build
```

Start the backend and browser lab in two terminals:

```powershell
npm run dev:server
npm run dev:lab
```

Open `http://127.0.0.1:5173/` in two browser tabs. Both tabs can join the same room to verify state replication, prediction and confirmed frames. The default server endpoint is `http://127.0.0.1:2567`.

The end-to-end client test expects a running development server. Start it in one terminal, then run the test in another:

```powershell
# Terminal 1
$env:PORT = '2568'
npm run dev:server

# Terminal 2
$env:HGAME_NETWORK_URL = 'http://127.0.0.1:2568'
npm run test:e2e
```

## Three sync modes

| Mode | Mechanism | Room in the local lab |
|---|---|---|
| A — State Sync | Colyseus server-owned Schema state; clients submit commands | `lab_state_sync` |
| B — Predicted Sync | Colyseus 0.18 `defineInput` / `setFixedTimestep`; client `room.input()` / `Predict` | `lab_predicted` |
| C — Confirmed Lockstep | Versioned binary input packets; server seals only complete frames | `lab_lockstep` |

The lab's counter and linear-motion rules are test fixtures, not reusable game rules. Real games own their state schemas, validation, simulation, AI, win conditions and persistence.

## Lockstep protocol v1

Client input packet (`HGIN`, little-endian):

| Offset | Field | Type |
|---:|---|---|
| 0 | Magic | 4 bytes |
| 4 | Protocol version | UInt8 |
| 5 | Flags (`NO_OP=1`) | UInt8 |
| 6 | Payload length | UInt16 |
| 8 | Server-issued match tag | UInt32 |
| 12 | Client input sequence | UInt32 |
| 16 | Target network frame | UInt32 |
| 20 | Game-defined input payload | bytes |

The client does not send its player slot. The server derives slot identity from the authenticated room session. It rejects stale/duplicate sequences, wrong match tags, duplicate slot submissions and target frames outside the configured future window.

Confirmed frame (`HGFR`) has a 16-byte header followed by sorted per-slot entries. Each entry contains slot, flags, payload length, accepted input sequence and payload. By default (`frameDeadlineTicks: 0`), a frame is sealed strictly once every active slot has submitted that tick; rooms can opt into `frameDeadlineTicks > 0` to emit bounded `NO_OP` entries when a deadline expires. Both `StateSyncRoom` and `LockstepRoom` enforce per-session `TokenBucketRateLimiter` input flood protection.

`LockstepRoom` buffers bounded confirmed-frame history (`maxHistoryFrames`) so `HGameLockstepChannel` can request catch-up replay via `'lockstep:sync'` on reconnect (configurable `reconnectionSeconds`), while state recovery for full mid-match drop-in still relies on a game-defined canonical snapshot contract. Client-reported hashes are compared peer-to-peer and remain non-authoritative.

Each history reply sends up to 240 frames or 128 KiB of frame payload, whichever limit it reaches first. The room scales its replay quota to its configured live frame rate and defers one pending request per session during congestion. A competing cursor receives a correlated `retry_later` status with `retryAfterMs`. `HGameLockstepChannel` honors that delay. Successful responses report `sentBytes` and the last frame sent.

Before sending a live frame, the room terminates a WebSocket if its queued bytes plus the frame payload would exceed 1 MiB. Other peers still receive the confirmed frame, and a peer with reconnection enabled can replay it while it remains in history. The configured frame deadline and reconnection window still determine how the room handles missing inputs.

## Production boundaries

- Colyseus rooms are in-memory and stateful while running. A process restart ends active matches; there is no database, Redis, persistence or multi-process adapter in this first foundation.
- Lab rooms are registered only when `NODE_ENV !== production`. Production startup does not expose the lab endpoints; a game server registers its own rooms through `createHGameNetworkServer({ enableLabRooms: false })` and `server.define(...)`.
- One server process can register rooms for multiple game IDs. Room type names are unique; each room's `onCreate` options carry the game ID and game-specific configuration. Use `createHGameNetworkServer({ enableLabRooms: false, gameRooms: { game_alpha: AlphaRoom, game_beta: BetaRoom } })` in a production entrypoint.
- Colyseus built-in matchmaking (`joinOrCreate`, `create`, `joinById`) is the current room allocation layer. Ranked queues, team balancing, bot assignment and platform identity are future adapters.
- Bilibili Toy SDK integration is deliberately an interface boundary only. No placeholder global such as `window.biliToy` is treated as a real SDK implementation.
- TLS termination, Nginx, process supervision, domain allowlists and Toy platform permission approval are deployment tasks, not claimed as complete here.
- Rapier is not loaded by the network server automatically. Games choose the HGame deterministic Rapier build for their selected simulation profile and verify the exact client/server build before using prediction or lockstep.

## Current scope

This is the first runnable foundation: shared protocol, client lifecycle, reconnect-token storage, state sync lab, native prediction lab, strict confirmed-frame relay, browser lab, and automated unit tests. It is not yet a production matchmaking service or a complete deterministic game simulation.
