# Encounter waves and checkpoints

Use `EncounterComponent` to schedule an encounter on a scene's existing fixed step. An encounter is an ordered sequence of stages. Each stage can schedule several enemy batches and wait for a clear, elapsed survival time or named signals.

```js
import { EncounterComponent } from '../vendor/hgame/gameplay/encounters.js';

const encounter = directorEntity.addComponent(new EncounterComponent({
  id: 'relay-room',
  stages: [
    {
      id: 'clear-entry',
      waves: [
        { id: 'first', enemy: 'scout', point: 'north', count: 4 },
        { id: 'second', enemy: 'guard', point: 'south', count: 2, batches: 3, at: 2, interval: 2 },
      ],
      goals: { clear: true },
      completeSignal: 'relay.entry-cleared',
    },
    {
      id: 'hold-relay',
      checkpoint: true,
      waves: [{ id: 'reinforcements', enemy: 'scout', point: 'north', count: 3, batches: 5, interval: 4 }],
      goals: { clear: false, survive: 20, signals: ['relay.activated'] },
      timeout: 35,
      completeSignal: 'relay.secured',
    },
  ],
}, {
  autoStart: false,
  spawn(batch) {
    // The spawner returns true only if it created the entire batch.
    // Store batch.ticket on each accepted enemy for defeat reporting.
    return spawnEnemyBatch(batch);
  },
  onEvent(event) {
    if (event.type === 'checkpoint') saveStageEntry(event.checkpoint);
    if (event.type === 'signal') {
      quests.record(event.signal, { data: { stage: event.stageId } });
      if (event.signal === 'relay.secured') openRelayDoor();
    }
  },
}));

const director = encounter.director;
director.start();
// In the game's enemy removal and switch handlers:
// director.defeated(enemy.ticket);
// director.signal('relay.activated');
```

Schedule `at` and `interval` in seconds from stage entry. When spawn capacity is exhausted, the adapter returns `false` and the director retries the next fixed step with the same ticket. Later batches remain queued in schedule order. `maxBatchesPerStep` caps dispatch work after a long step. Report removals after the spawn callback returns, at most once per enemy. Tickets belong to their director and stage run. Tickets from a previous stage or restart are ignored.

A stage completes after all its batches are accepted and all selected goals are met. `clear` defaults to `true` and waits for zero tracked enemies. Set `clear: false` for a time or signal gate that can finish with survivors. The game decides whether to remove or keep those survivors. For a wave that starts only after the previous wave is cleared, put each wave in a separate stage. The next stage begins on completion, with its spawn schedule starting on the next update. A timeout fails the stage if its goals are still unmet. Call `fail()` from game rules for other failure conditions, such as a destroyed objective.

The first stage and any stage with `checkpoint: true` provide a stage-entry checkpoint. Save it alongside game-owned state in `createVersionedStore`. Before calling `restoreCheckpoint()`, reset the encounter's world objects and restore the related game state. Restoring opens the saved stage from time zero and re-emits its entry events. Use stable IDs or migrate older saves when renaming stages. A checkpoint records a restart point, so the game owns any additional mid-stage or entity state it needs.

Use `createEncounterDirector` directly when a simulation already has its own fixed-step owner. Call `update(dt)` from that owner and use `getState()` to display progress. Dispatch further commands to the same director after its spawn or event callbacks return. The component releases director subscriptions and tracking on destruction. The game retains ownership of spawned actors and their cleanup.
