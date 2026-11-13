# Optional Confirmed-Frame Scheduling

HGame's default `Component.fixedUpdate(dt)` is a local fixed-step loop. It is not, by itself, deterministic networking. It may call floating-point math, browser APIs, random sources, or renderer objects, and therefore cannot prove that different devices will execute the same game state.

The optional `assets/runtime/lockstep/confirmed-frames.js` module schedules already-confirmed input frames. It does not provide WebSocket transport, packet authentication, room management, deterministic game rules, rollback, snapshots, or matchmaking.

## Authority model

```text
Server: validate input -> seal complete ordered network frames
                                  |
                                  v
Client: buffer contiguous confirmed frames
                                  |
                                  v
                 one authoritative game World
                                  |
                     read-only state snapshot
                                  |
                       Canvas / Three.js view
```

Only the confirmed-frame scheduler may advance the authoritative World in a lockstep project. Do not let the ordinary `fixedUpdate` path mutate the same authoritative state. Rendering and interpolation are read-only.

## Minimal usage

```js
import { createConfirmedFrameScheduler }
  from './vendor/hgame/lockstep/confirmed-frames.js';

const scheduler = createConfirmedFrameScheduler({
  netHz: 10,
  logicHz: 20,
  playerIds: [0, 1],
  instantButtonMask: 1,
  simulate(inputs, { logicTick }) {
    world.tick(inputs); // game-owned deterministic simulation
    if (world.logicTick !== logicTick) throw new Error('Tick mismatch');
  },
  onTick({ logicTick }) {
    if (logicTick % 20 === 0) recordHash(logicTick, world.computeHash());
    updateReadOnlySnapshot(world.getSnapshot());
  },
  isEnded: () => world.ended,
});

// Enqueue only after the game-specific network decoder has validated the frame.
scheduler.enqueue({
  netTick: 1,
  inputs: [
    { pid: 0, buttons: 1, moveByte: 4 },
    { pid: 1, buttons: 0, moveByte: 0 },
  ],
});

// Call from an existing display update; this only schedules confirmed frames.
scheduler.advanceElapsedMs(displayDeltaMs);
```

## Scheduler guarantees

- Network and logic rates must have an integer ratio within the supported range.
- Player IDs must be unique and ordered; accepted inputs are copied before buffering.
- Startup waits for a contiguous confirmation buffer.
- Missing frames stall authority; the scheduler does not invent no-op input or skip gaps.
- Catch-up and buffer sizes are bounded. Invalid future frames fail closed.
- Instant button bits can be consumed on the first logic substep only.
- Each completed logic tick invokes `onTick`; a terminal World stops further catch-up.

These are scheduler guarantees, not end-to-end multiplayer guarantees. Games still own packet validation, room identity, match tags, sequences, binary schema, seeded RNG, stable entity ordering, canonical state/hash, replay integrity, disconnect policy, and server trust.

## Required verification for a real lockstep game

1. Repeat a seeded input trace for at least 10,000 ticks and compare every authoritative state hash.
2. Compare 30/60/144 Hz display cadences while consuming identical confirmed frames.
3. Test missing, duplicate, late, reordered, malformed, and out-of-range frames.
4. Verify identical replay across separate processes and target browsers.
5. Compare Windows and real browser/WebAssembly execution; do not infer ARM parity from desktop emulation.
6. Store the original sealed input bytes and verify replay integrity independently of client-reported hashes.

For ordinary single-player games, keep the normal Application fixed tick and do not import the lockstep module.
