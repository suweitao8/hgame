# Inventory, equipment and quest rewards

`createInventory` manages a fixed number of bag slots and named equipment slots. The project defines item IDs, stack sizes and equipment modifiers in objects or JSON. A 2D or 3D actor can pass its existing `actor.attributes` to apply equipment effects. Card and UI projects can use the same API from explicit commands.

```js
import { createInventory } from '../vendor/hgame/gameplay/inventory.js';

const bag = createInventory({
  capacity: 16,
  equipmentSlots: ['accessory'],
  attributes: heroGameplay.actor.attributes,
  items: {
    coil: { maxStack: 20 },
    'relay-token': {
      equipment: {
        slots: ['accessory'],
        modifiers: [{ attribute: 'moveSpeed', operation: 'percent', value: 0.10 }],
      },
    },
  },
});

// Pickup and exchange code can feed the same inventory.
bag.add('coil', 2);
const reward = bag.claimQuestRewards(quests, 'delivery');
if (reward.ok) {
  const index = bag.list().findIndex(stack => stack?.id === 'relay-token');
  if (index >= 0) bag.equip(index, 'accessory');
}
```

| Use case | Method |
|---|---|
| Render bag slots and totals | `list()`, `getSlot(index)`, `count(id)` |
| Move, merge or swap bag stacks | `move(from, to)` |
| Pickup, drop or spend an item | `add(id, amount)`, `remove(id, amount)` |
| Exchange multiple inputs and outputs | `transact({ remove, add })`, `canTransact({ remove, add })` |
| Equip, swap or return an item to the bag | `equip(index, slot)`, `getEquipped(slot)`, `unequip(slot)` |
| Claim quest item rewards | `claimQuestRewards(quests, questId)` |

`count` counts items in the bag. Each equipped item occupies an equipment slot. Adding items fills matching stacks first, then empty slots. A failed exchange leaves all quantities unchanged. Removing inputs before inserting outputs lets an exchange reuse slots freed by its inputs. An unsuccessful swap or unequip preserves the loadout and its attribute modifiers.

Each command returns `{ ok: true }` or `{ ok: false, reason }` for gameplay constraints such as full capacity or missing items. Unknown item IDs and invalid configuration throw. Inventory subscribers receive the committed state and its `revision`. Subscriber errors surface after commit, so inspect state before retrying a command that threw from an observer. Dispatch new inventory commands outside the callback. Dispose the bag when its owner is destroyed to remove its modifiers.

Use `claimQuestRewards` when every reward ID is in the item catalog. The quest remains complete and claimable if the whole batch does not fit. For a custom reward store, `quests.claim(id, { accept })` optionally accepts a synchronous, read-only admission callback. A `false` return leaves the reward available. After accepting, use the returned descriptors to deliver the reward.

Save the inventory and quest snapshots together in one versioned save. Loading the inventory reconstructs equipment modifiers from the current item definitions. Save actor base attributes separately through `actor.snapshot()` so equipment bonuses are applied once. Preserve item IDs and slot names across versions or migrate the snapshot before restoring it.
