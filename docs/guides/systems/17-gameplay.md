# Attributes, status effects and abilities

Import `gameplay/index.js` to give a character or card-game actor reusable attributes, timed effects, resource costs and skill state. Load definitions from JSON or declare the same objects in code. The game connects abilities to its movement, targeting, damage, audio and visuals in `execute`.

```js
import { GameplayComponent } from '../vendor/hgame/gameplay/index.js';

// This object can be loaded from a game-owned gameplay.json file.
const rules = {
  attributes: {
    maxHp: 100,
    hp: { base: 100, min: 0, max: 'maxHp' },
    energy: { base: 50, min: 0, max: 50 },
    moveSpeed: 180,
  },
  effects: {
    haste: {
      duration: 3,
      stacking: 'stack',
      maxStacks: 3,
      tags: ['Buff.Haste'],
      modifiers: [{ attribute: 'moveSpeed', operation: 'percent', value: 0.2 }],
    },
    regeneration: {
      duration: 4,
      periodic: { interval: 1, changes: { hp: 5 } },
    },
    stun: { duration: 0.6, tags: ['State.Stunned'] },
  },
  abilities: {
    sprint: {
      costs: { energy: 15 },
      charges: 2,
      cooldown: 4,
      globalCooldown: 0.15,
      blockedTags: ['State.Stunned'],
      effects: ['haste'],
    },
    recover: {
      costs: { energy: 20 },
      castTime: 0.4,
      cooldown: 8,
      blockedTags: ['State.Stunned'],
      effects: ['regeneration'],
    },
  },
};

// hero is a normal HGame Entity. Attach before accessing actor.
const gameplay = hero.addComponent(new GameplayComponent(rules));
const { attributes, abilities, effects } = gameplay.actor;

// At an input edge, from a separate input component or input adapter.
abilities.queue('sprint', {}, 0.15);
// Movement code reads the effective speed when simulating a step.
const speed = attributes.get('moveSpeed');
// A game rule can interrupt a cast by applying a blocking status.
effects.apply('stun', { source: 'enemy-1' });
```

| What you need | API |
|---|---|
| Read or change an attribute | `get`, `setBase`, `setValue`, `change` |
| Grant or remove equipment modifiers | `setModifiers(source, modifiers)`, `removeModifiers(source)` |
| Apply or remove an effect | `effects.apply(id, { source })`, `effects.remove(handle)`, `effects.removeByDefinition(id)` |
| Use a skill immediately | `abilities.tryActivate(id, { target, payload })` returns the started phase or a denial reason |
| Show skill availability and charges | `abilities.canActivate(id)`, `abilities.getState(id)` |
| React to gameplay changes | `attributes.subscribe`, `effects.subscribe`, `abilities.subscribe` return unsubscribe functions |

Attribute modifiers combine as `(base + sum(add)) * (1 + sum(percent)) * product(multiply)`, then apply the bounds. A `percent` modifier with `value: 0.2` adds 20%. A bound can reference another attribute by name. Costs debit the effective values together. Use a nonnegative minimum on resource attributes and keep the effective multiplier positive when a resource must be spendable.

Effect duration uses seconds. `0` applies the `changes` immediately and `-1` remains until removed. Active status tags share the Entity tag container, so existing tag queries and AI conditions can use effects directly. `refresh` extends the same definition/source instance, `stack` increases it up to `maxStacks`, `replace` removes the old instance first, and `independent` creates separate handles. The periodic cadence survives refreshes. A large simulation step combines elapsed periodic ticks into one delta and reports their count in the event.

Costs are paid when a cast commits, after rechecking tags and resource availability. Charges refill sequentially every `cooldown` seconds. An optional `group` shares a cooldown with other abilities in that group. `channelTime` keeps the actor busy and `channelInterval` calls `execute` with `phase: 'channel'` and the number of elapsed ticks. `cancel` interrupts casting or channeling. A cast cancelled before commit has no cost. Interruption after commit keeps the paid cost and cooldown. `queue` holds one input and tries it on a subsequent step until it expires.

For turn-based or UI games, import `createGameplayActor` from the same subpath and call `actor.update(seconds)` as part of an explicit turn or command. For scene entities, the component advances the actor automatically. Keep `execute` synchronous and implement target selection and gameplay outcomes in the project.

Use `actor.snapshot()` with `createVersionedStore` if a game saves in-progress effects and cooldowns. Recreate the actor with compatible definitions before `actor.restore(saved)`. Snapshots include base attributes, active effects, and remaining cooldowns. Restore recreates effect grants without repeating their original changes. Save equipment, external tags, and other game state separately. In-progress casts, channels, and buffered inputs are transient.
