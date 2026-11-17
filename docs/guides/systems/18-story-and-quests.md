# Branching dialogue and quest progression

Use `createStoryRunner` when a game needs conditional dialogue, event cards or alternative endings. Use `createQuestLog` to count objectives and unlock follow-up quests. Both modules work with any renderer. The game owns presentation, rewards and the decisions that generate signals.

```js
import { createStoryRunner } from '../vendor/hgame/gameplay/story.js';
import { createQuestLog } from '../vendor/hgame/gameplay/quests.js';

const quests = createQuestLog({
  delivery: {
    title: 'Signal relay',
    stages: [
      { id: 'parts', objectives: [{ id: 'coils', signal: 'item.collected', match: { item: 'coil' }, count: 2 }] },
      { id: 'relay', objectives: [{ id: 'reported', signal: 'relay.reported' }] },
    ],
    rewards: [{ id: 'relay-token', amount: 1 }],
  },
});

const story = createStoryRunner({
  id: 'relay-conversation',
  start: 'operator',
  variables: { ready: false },
  nodes: {
    operator: {
      text: '还缺两枚线圈。',
      next: 'later',
      choices: [{ id: 'report', label: '交付', next: 'done',
        when: [{ variable: 'ready', op: 'eq', value: true }],
        actions: [{ op: 'emit', signal: 'relay.reported' }] }],
    },
    done: { text: '信号恢复了。', ending: true },
    later: { text: '我等你的消息。', ending: true },
  },
});

story.subscribe(event => {
  if (event.type === 'signal') quests.record(event.signal, { data: event.data });
});

quests.accept('delivery');
// The existing pickup handler can report individual or batched pickups.
quests.record('item.collected', { amount: 2, data: { item: 'coil' } });
story.start();
story.setVariables({ ready: quests.get('delivery')?.stageId === 'relay' });

const dialogue = story.view();
// The UI passes the choice ID and revision from the view it displayed.
if (dialogue) story.choose('report', dialogue.revision);
const rewards = quests.claim('delivery'); // [{ id: 'relay-token', amount: 1 }]
```

The story accepts the `start`, `nodes`, `next`, `choices[].next` and `ending` fields used by the existing story graph authoring tool. Nodes can be keyed by ID or provided as an array with an `id` on each node. Prefer explicit choice IDs for long-lived content. `view()` gives the currently eligible choices and indicates whether `advance()` can follow `next`. When no choice is eligible, a node can use `next` as its fallback. A view revision lets input code reject a stale click after the story or its variables changed.

Choice conditions are combined with AND. They compare variables by equality, numeric order or presence (`eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `exists`, `missing`). Variables and signal data use JSON scalars. On a transition, the runner applies the chosen actions first and the destination's entry actions second. Actions can `set`, `add`, `unset`, or `emit`. Event listeners receive committed state. A listener can route a signal to a different system. Dispatch commands to the emitting system after its current callback returns.

Quest objectives count only on the current stage of an accepted quest. An objective can filter a signal by exact payload values. One signal can advance multiple objectives in that stage. The next stage starts with fresh counters. A quest becomes available when every quest in `requires` is complete or claimed. `claim()` returns reward descriptors once and marks the quest claimed. The game can apply the returned rewards and save its inventory and quest state in one save envelope. Use the returned value to refresh the reward UI.

Save `story.snapshot()` and `quests.snapshot()` with `createVersionedStore`. Restore against compatible definitions and use stable IDs for stories, stages and objectives. Restoring state does not replay entry actions, completion events or rewards. Use the game's save migration when changing IDs or the structure of active objectives.
