# Commercial Lockstep Architecture (Confirmed & Rollback)

HGame's default `Component.fixedUpdate(dt)` is a local fixed-step loop. It is not, by itself, deterministic networking. It may call floating-point math, browser APIs, random sources, or renderer objects, and therefore cannot prove that different devices will execute the same game state.

HGame provides two optional deterministic lockstep schedulers under `assets/runtime/lockstep/`, paired with the commercial relay and dual-track reconnect infrastructure in `network/`:

1. **Confirmed-Frame Lockstep (`lockstep/confirmed-frames.js`)**: `createConfirmedFrameScheduler` — deterministic confirmed-frame scheduling with `netHz`/`logicHz` substeps, `enqueueReplay` + `fastForward` silent catch-up (`isFastForward`), and `restoreCheckpoint` snapshot recovery. Ideal for RTS, MOBA, tower defense, and co-op arena games.
2. **Prediction & Rollback Lockstep (`lockstep/rollback-frames.js`)**: `createRollbackFrameScheduler` — GGPO-style input prediction, preallocated circular snapshot slot ring (`saveState` / `loadState`), misprediction rollback & silent resimulation (`isResimulating`), ordered `onConfirmedTick` hashing, bounded speculative window, and time-scale pacing (`recommendTimeScale`). Ideal for 1v1 fighting and ultra-low-latency twitch PvP.

## Authority & Dual-Track Reconnect Model

```text
Server (LockstepRoom):
  validate HGIN input (matchTag, sequence, targetNetTick)
    -> seal complete HGFR frame (immediate NO_OP|OFFLINE for disconnected slots)
    -> retain bounded frameHistory (up to 36,000 frames / 16 MiB)
    -> collect consensus hashes -> request & store trusted HGCP checkpoint

Client (HGameLockstepChannel + Scheduler):
  Warm / Cold Reconnect -> lockstep:hello / lockstep:welcome
    -> sync lastInputSequence & serverTick
    -> if missed ticks are in frameHistory:
         paged lockstep:sync -> enqueueReplay() -> fastForward() (isFastForward=true)
    -> if missed ticks were evicted (reason: 'use_checkpoint'):
         fetch binary HGCP lockstep:snapshot -> restore world state + restoreCheckpoint()
         -> paged lockstep:sync from (checkpointTick + 1) -> fastForward()
    -> live input via sendLiveInput() (AdaptiveInputLeadController via lockstep:ping/pong)
```

### Offline Slots Without Stalling Online Peers

When `reconnectSeconds > 0` and a player disconnects (`player.connected === false`):
- As long as at least one player remains connected, `LockstepRoom` **immediately** seals `{ flags: NO_OP | OFFLINE }` for disconnected slots without waiting `frameDeadlineTicks`. Online players experience zero slowdown.
- If **all** players disconnect simultaneously, frame sealing pauses safely until a peer reconnects.

### Cold & Warm Reconnect Sequence Resumption

- `LockstepRoom` emits `lockstep:welcome` on `onJoin`, `onReconnect`, and in response to `lockstep:hello` (e.g., `new HGameLockstepChannel(..., { requestWelcomeOnStart: true })`).
- `HGameLockstepChannel` automatically adopts `welcome.lastInputSequence` and `welcome.currentNetTick` so a freshly reloaded browser tab or restarted client never hits stale `sequence` or out-of-window `targetNetTick` rejections when resuming live play via `sendLiveInput()` / `recommendTargetNetTick()`.

## Minimal Usage: Confirmed Lockstep + Reconnect + Checkpoint

```js
import { createConfirmedFrameScheduler }
  from './vendor/hgame/lockstep/confirmed-frames.js';

const scheduler = createConfirmedFrameScheduler({
  netHz: 20,
  logicHz: 40,
  playerIds: [0, 1],
  instantButtonMask: 1,
  maxReplayBufferFrames: 4096,
  simulate(inputs, { logicTick, isFastForward }) {
    world.tick(inputs);
    if (!isFastForward) playVisualAndAudioEvents(world);
    if (world.logicTick !== logicTick) throw new Error('Tick mismatch');
  },
  onTick({ logicTick, netTick, substep, isFastForward }) {
    if (substep === 1 && netTick % 20 === 0) {
      const hash = world.computeHash();
      checkpoints.set(netTick, world.serialize());
      if (!isFastForward) channel.reportHash(netTick, hash);
    }
    if (!isFastForward) updateReadOnlySnapshot(world.getSnapshot());
  },
  isEnded: () => world.ended,
});

// Wire HGameLockstepChannel for cold/warm reconnect & HGCP checkpoint recovery
channel.setCheckpointProvider(({ netTick }) => checkpoints.get(netTick) ?? null);
channel.onCheckpoint((cp) => {
  world.deserialize(cp.payload);
  scheduler.restoreCheckpoint({ netTick: cp.netTick });
});
channel.onFrame((frame) => {
  scheduler.enqueue(decodeFrame(frame), { replay: true });
  if (channel.isCatchingUp) scheduler.fastForward();
});
```

## Minimal Usage: Prediction & Rollback Lockstep

```js
import { createRollbackFrameScheduler }
  from './vendor/hgame/lockstep/rollback-frames.js';

const maxRollbackFrames = 8;
const ring = Array.from({ length: maxRollbackFrames + 1 }, () => new Uint8Array(STATE_BYTES));

const rollback = createRollbackFrameScheduler({
  netHz: 20,
  logicHz: 60,
  playerIds: [0, 1],
  instantButtonMask: 1,
  maxRollbackFrames,
  saveState(slotIndex) { world.writeSnapshot(ring[slotIndex]); },
  loadState(slotIndex) { world.readSnapshot(ring[slotIndex]); },
  simulate(inputs, { isResimulating }) {
    world.step(inputs);
    if (!isResimulating) emitTransientSfxAndVfx(world);
  },
  onConfirmedTick({ netTick, slotIndex }) {
    channel.reportHash(netTick, hashSnapshotBytes(ring[slotIndex]));
  },
});
```

## Scheduler Guarantees

- Network and logic rates must have an integer ratio within `1..240 Hz`.
- Player IDs must be unique and ordered; accepted inputs are cloned before buffering.
- Startup waits for a contiguous confirmation buffer in confirmed mode.
- Missing live frames stall confirmed authority; `fastForward()` drains contiguous buffered replay frames silently (`isFastForward: true`) without tripping live `maxBufferFrames` limits.
- Rollback mode bounds speculation strictly to `confirmedNetTick + maxRollbackFrames` and clears `instantButtonMask` on default input prediction and non-first substeps.
- A terminal World (`isEnded() === true`) stops further stepping cleanly.

These are scheduler and transport guarantees, not complete game guarantees. Games still own binary input encoding, fixed-point / integer math, seeded RNG (`DeterministicRng` / `createSeededRng`), stable entity iteration order, canonical state serialization & hashing (`hashInt32State`), disconnect AI policy, and server-side anti-cheat validation (such as shadow simulation).

## Required Verification for a Real Lockstep Game

1. Repeat a seeded input trace for at least 10,000 ticks and compare every authoritative state hash.
2. Compare 30/60/144 Hz display cadences while consuming identical confirmed frames.
3. Test missing, duplicate, late, reordered, malformed, and out-of-range frames.
4. Test both short outages (history replay + immediate `NO_OP | OFFLINE` slot synthesis) and long evicted outages (`HGCP` consensus checkpoint + tail frame catch-up) with cold reconnects.
5. Verify identical replay across separate processes and target browsers (and compare Windows vs real browser/WASM execution).
6. Store the original sealed `HGFR` input bytes (`LockstepRoom.exportFrameHistory()`) and verify replay integrity independently of client-reported hashes.

For ordinary single-player games, keep the normal Application fixed tick and do not import the lockstep modules.
