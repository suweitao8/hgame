# @hgame/network-client

Browser-facing HGame network adapter. It wraps the Colyseus SDK but does not own game rules or render loops.

```ts
import { HGameNetworkClient } from '@hgame/network-client';

const network = new HGameNetworkClient({ endpoint: 'https://game.example.com' });
const session = await network.joinOrCreate({
  gameId: 'my-game',
  roomName: 'my-game-room',
  roomOptions: { gameId: 'my-game' },
});

session.onStateChange((state) => {
  // Read the game's server-owned Schema state.
});
session.send('game:command', { type: 'ready' });
```

## Sync modes

- A: use `session.room.state`, `session.send()` and `session.onStateChange()`.
- B: use `session.input()` and `session.prediction()`. Attach a reconciler with the exact same step function used by the server. Call `prediction.tick(now)` from the game's one render/update loop and send the returned number of input samples.
- C: create `HGameLockstepChannel(session, matchTag, firstNetTick, maxBufferedFrames, firstSequence)`. Send one input or explicit no-op per target frame. Consume only contiguous confirmed frames and pass them to HGame's confirmed-frame scheduler.

The room session stores reconnect tokens in sessionStorage under `(gameId, roomName)`. Pass a custom `StorageLike` in tests or when the host platform provides its own session storage. Call `session.leave()` for a consented leave; `leave(false)` intentionally drops the connection and permits the server's reconnection policy to apply.

For a lockstep room that retains disconnected seats, resume with the server-replicated `player.lastInputSequence + 1` and a valid target frame. Reconnection does not restore a lost game world; the game must own its snapshot/replay policy.
