# HGame Trace Recorder

HGame exposes an optional renderer-neutral JSONL event recorder through:

```js
import { createTraceRecorder } from './vendor/hgame/index.js';

const lines = [];
const trace = createTraceRecorder({
  gameId: 'my-game',
  scenarioId: 'movement-basic',
  build: 'html-dev-42',
  tickHz: 60,
  emit: line => lines.push(line),
});

// Call only from existing simulation/event code. Do not create another RAF.
trace.record({
  tick: simulation.tick,
  actorId: player.id,
  type: 'move',
  position: { x: player.x, y: player.y },
  state: player.state,
});

const jsonl = lines.join('\n') + '\n';
```

The first emitted line is a trace header; subsequent lines are events with an automatically assigned sequence. The recorder has no filesystem, browser, clock, timer, RAF, network, or storage dependency. The caller owns the `emit(line)` sink and decides whether to keep data in memory, send it to a test collector, or forward it from a browser console to Playwright.

Rules:

- `gameId`, `scenarioId`, `build`, and `tickHz` describe the compared build/scenario. `tickHz: 0` is allowed for command-driven UI projects; still use a monotonically increasing logical `tick`/step for events.
- Events require a non-negative safe-integer `tick`, non-empty `actorId`, and non-empty `type`. Events must be emitted in non-decreasing tick order.
- Record committed/confirmed events only. Do not compare speculative events that may be rolled back; a rollback project must define a revision/commit key in its own adapter before comparison.
- The default event limit is 100,000 to prevent accidental unbounded logs. Configure `maxEvents` explicitly for longer test sessions.
- Recording must observe existing game state; it must never mutate state, advance simulation, or introduce a second update loop.

LeanRea's `compare-game-traces.mjs` consumes this JSONL format. Use the same game/scenario identifiers and input script for the original and HTML implementation, then define the event keys and compared fields in `trace-map.json`.
