# Loot tables and crafting recipes

Use `createLootSystem` for chests, enemy drops and other rewards tied to a stable source. Use `createCraftingBook` to turn inventory items into other items. Both accept plain configuration objects or JSON and use the inventory transaction API.

```js
import { createLootSystem } from '../vendor/hgame/gameplay/loot.js';
import { createCraftingBook } from '../vendor/hgame/gameplay/crafting.js';

const loot = createLootSystem({
  relayCrate: {
    guaranteed: [{ kind: 'item', id: 'coil', amount: 2 }],
    rolls: 1,
    entries: [
      { kind: 'item', id: 'scrap', amount: [1, 3], weight: 3 },
      { kind: 'empty', weight: 1 },
    ],
  },
}, { seed: runSeed });

const crafting = createCraftingBook({
  relay: {
    station: 'workbench',
    requires: ['Recipe.Relay'],
    inputs: [{ id: 'coil', amount: 2 }],
    outputs: [{ id: 'relay-token', amount: 1 }],
  },
});

// All item IDs must exist in the target inventory's catalog.
const receipt = loot.roll('relayCrate', 'room-3/crate-1');
const pickup = loot.claim(receipt.source, bag);
const result = crafting.craft('relay', bag, {
  station: 'workbench', tags: heroGameplay.actor.tags, quantity: 1,
});
```

Guaranteed entries run first. Each weighted draw selects one entry independently. An entry can grant an item, draw from a nested table using `kind: 'table'`, or produce nothing. Quantity ranges include both endpoints. The engine combines duplicate item IDs in each receipt. Positive integer weights represent relative frequency.

Use a source ID that remains stable for the life of the reward. Give newly spawned chests their own IDs. Recurring calls with the same source return its existing receipt. Save `loot.snapshot()` and the bag snapshot in the same versioned save envelope. Restore using the same run seed and compatible table IDs. A failed claim leaves the receipt pending, and a claimed receipt prevents the same items from being granted twice. Keep one loot system per region or run and keep source IDs unique within that scope.

Use `crafting.quote()` to get the scaled amounts for a crafting UI after checking station and tag requirements. At execution, `craft()` returns the plan on success or a reason such as `wrong-station`, `requirements`, `insufficient` or `full`. A batch uses one transaction, so material slots freed by the craft can hold the outputs. Failed crafts leave the inventory unchanged. Pass actual station and actor state from game rules when invoking the recipe.

An inventory transaction supports an optional synchronous `onCommit` callback for composing state changes with item transfers. It runs after the item state is committed and before inventory subscribers run. A thrown observer error leaves the transaction committed. Keep commit callbacks small and free of additional inventory commands.
