import { finite, identifier, positiveInteger, publisher } from '../internal/gameplay.js';
import { cleanupAll } from '../internal/cleanup.js';

/** @typedef {import('./attributes.js').AttributeModifier} AttributeModifier */
/** @typedef {{id: string, amount: number}} ItemQuantity */
/** @typedef {{maxStack?: number, equipment?: {slots: readonly string[], modifiers?: readonly AttributeModifier[]}}} ItemDefinition */
/** @typedef {{remove?: readonly ItemQuantity[], add?: readonly ItemQuantity[]}} InventoryTransaction */
/** @typedef {{schemaVersion: 1, slots: (ItemQuantity | null)[], equipment: Record<string, string>}} InventorySnapshot */
/** @typedef {{type: 'transaction' | 'moved' | 'equipped' | 'unequipped' | 'restored' | 'quest-reward', revision: number, slot?: string, quest?: string}} InventoryEvent */
/** @typedef {{ok: true} | {ok: false, reason: 'full' | 'insufficient' | 'empty' | 'incompatible' | 'unavailable'}} InventoryResult */
/** @typedef {{maxStack: number, equipment: {slots: string[], modifiers: AttributeModifier[]} | null}} CompiledItem */
/** @typedef {{items: Record<string, ItemDefinition>, capacity: number, equipmentSlots?: readonly string[], attributes?: import('./attributes.js').AttributeSet, onEvent?: (event: InventoryEvent) => void}} InventoryOptions */
/** @typedef {Pick<ReturnType<typeof import('./quests.js').createQuestLog>, 'claim'>} ClaimableQuests */

let nextInventory = 1;

/**
 * Create a slotted inventory with atomic exchanges, equipment modifiers and reward admission.
 * Create one per actor or party. Item definitions, presentation and item use belong to the game.
 * @param {InventoryOptions} options
 */
export function createInventory({ items, capacity, equipmentSlots = [], attributes, onEvent }) {
  if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > 4096) throw new RangeError('Inventory capacity must be 0..4096');
  const equipmentOrder = new Set();
  for (const slot of equipmentSlots) {
    if (equipmentOrder.has(slot)) throw new Error('Duplicate equipment slot: ' + slot);
    equipmentOrder.add(identifier(slot, 'equipment slot'));
  }
  /** @type {Map<string, CompiledItem>} */
  const catalog = new Map();
  for (const [id, def] of Object.entries(items)) {
    identifier(id, 'item id');
    let equipment = null;
    if (def.equipment) {
      const slots = [...new Set(def.equipment.slots)];
      if (!slots.length) throw new Error('Equippable item needs an equipment slot: ' + id);
      for (const slot of slots) if (!equipmentOrder.has(slot)) throw new Error('Unknown equipment slot: ' + slot);
      const modifiers = (def.equipment.modifiers ?? []).map(modifier => {
        const attribute = identifier(modifier.attribute, 'modifier attribute');
        if (attributes && !attributes.has(attribute)) throw new Error('Unknown equipment attribute: ' + attribute);
        const operation = modifier.operation ?? 'add';
        if (operation !== 'add' && operation !== 'percent' && operation !== 'multiply') throw new Error('Unknown modifier operation: ' + operation);
        const value = finite(modifier.value, 'modifier value');
        if (operation === 'multiply' && value < 0) throw new RangeError('Equipment multipliers must be non-negative');
        return { attribute, operation, value };
      });
      equipment = { slots, modifiers };
    }
    const maxStack = positiveInteger(def.maxStack ?? 1, 'maxStack');
    if (!Number.isSafeInteger(maxStack * capacity)) throw new RangeError('Inventory item totals must fit a safe integer: ' + id);
    catalog.set(id, { maxStack, equipment });
  }

  /** @type {(ItemQuantity | null)[]} */
  let bag = Array.from({ length: capacity }, () => null);
  /** @type {Map<string, string>} */
  let equipped = new Map();
  const modifierSource = 'hgame.inventory.' + nextInventory++;
  const events = publisher(onEvent);
  let revision = 0;
  let busy = false;
  let disposed = false;

  function writable() {
    if (disposed) throw new Error('Inventory is disposed');
    if (busy) throw new Error('Inventory commands cannot run during inventory events');
  }

  /** @param {string} id */
  function item(id) {
    const def = catalog.get(id);
    if (!def) throw new Error('Unknown inventory item: ' + id);
    return def;
  }

  /** @param {ItemQuantity} entry */
  function quantity(entry) {
    item(entry.id);
    return { id: entry.id, amount: positiveInteger(entry.amount, 'item amount') };
  }

  /** @param {(ItemQuantity | null)[]} target @param {ItemQuantity} stack */
  function insert(target, { id, amount }) {
    const limit = item(id).maxStack;
    for (let i = 0; i < target.length && amount > 0; i++) {
      const previous = target[i];
      if (previous?.id !== id || previous.amount === limit) continue;
      const fill = Math.min(amount, limit - previous.amount);
      target[i] = { id, amount: previous.amount + fill };
      amount -= fill;
    }
    for (let i = 0; i < target.length && amount > 0; i++) {
      if (target[i] !== null) continue;
      const fill = Math.min(amount, limit);
      target[i] = { id, amount: fill };
      amount -= fill;
    }
    return amount === 0;
  }

  /** @param {(ItemQuantity | null)[]} target @param {ItemQuantity} stack */
  function extract(target, { id, amount }) {
    for (let i = target.length - 1; i >= 0 && amount > 0; i--) {
      const previous = target[i];
      if (previous?.id !== id) continue;
      const take = Math.min(amount, previous.amount);
      target[i] = take === previous.amount ? null : { id, amount: previous.amount - take };
      amount -= take;
    }
    return amount === 0;
  }

  /** @param {InventoryTransaction} transaction @returns {{ok: true, slots: (ItemQuantity | null)[]} | {ok: false, reason: 'full' | 'insufficient'}} */
  function plan({ remove = [], add = [] }) {
    const withdrawals = remove.map(quantity);
    const deposits = add.map(quantity);
    const slots = bag.slice();
    for (const entry of withdrawals) if (!extract(slots, entry)) return { ok: false, reason: 'insufficient' };
    for (const entry of deposits) if (!insert(slots, entry)) return { ok: false, reason: 'full' };
    return { ok: true, slots };
  }

  /** @param {Map<string, string>} loadout */
  function loadoutModifiers(loadout) {
    if (!attributes) return [];
    const modifiers = [];
    for (const slot of equipmentOrder) {
      const id = loadout.get(slot);
      if (id === undefined) continue;
      for (const modifier of item(id).equipment?.modifiers ?? []) {
        if (!attributes.has(modifier.attribute)) throw new Error('Equipment attribute unavailable: ' + modifier.attribute);
        modifiers.push(modifier);
      }
    }
    return modifiers;
  }

  /** @param {(ItemQuantity | null)[]} slots @param {Omit<InventoryEvent, 'revision'>} event @param {Map<string, string>} [loadout] @param {() => void} [onCommit] */
  function commit(slots, event, loadout, onCommit) {
    const modifiers = loadout === undefined ? [] : loadoutModifiers(loadout);
    bag = slots;
    if (loadout !== undefined) equipped = loadout;
    revision++;
    busy = true;
    try {
      cleanupAll([
        () => onCommit?.(),
        () => {
          if (!attributes || loadout === undefined) return;
          if (modifiers.length) attributes.setModifiers(modifierSource, modifiers);
          else attributes.removeModifiers(modifierSource);
        },
        () => events.emit({ ...event, revision }),
      ], 'Inventory observers failed after commit');
    } finally { busy = false; }
  }

  /** @param {number} index */
  function slotAt(index) {
    if (!Number.isInteger(index) || index < 0 || index >= capacity) throw new RangeError('Invalid inventory slot: ' + index);
    return bag[index];
  }

  const api = {
    get capacity() { return capacity; },
    get revision() { return revision; },
    /** @param {number} index @returns {ItemQuantity | null} */
    getSlot(index) { const stack = slotAt(index); return stack ? { ...stack } : null; },
    /** @returns {(ItemQuantity | null)[]} */
    list() { return bag.map(stack => stack ? { ...stack } : null); },
    /** @param {string} id */
    count(id) {
      let total = 0;
      for (const stack of bag) if (stack?.id === id) total += stack.amount;
      return total;
    },
    /** @param {string} slot @returns {string | null} */
    getEquipped(slot) { return equipped.get(slot) ?? null; },
    /** @param {InventoryTransaction} transaction */
    canTransact(transaction) { return !disposed && plan(transaction).ok; },
    /**
     * Apply the exchange. The optional synchronous onCommit runs once after success,
     * before inventory observers, and also runs for an empty successful exchange.
     * @param {InventoryTransaction} transaction
     * @param {{onCommit?: () => void}} [options]
     * @returns {InventoryResult}
     */
    transact(transaction, { onCommit } = {}) {
      writable();
      if (onCommit !== undefined && typeof onCommit !== 'function') throw new TypeError('onCommit must be a function');
      const pending = plan(transaction);
      if (!pending.ok) return pending;
      if (transaction.remove?.length || transaction.add?.length) {
        commit(pending.slots, { type: 'transaction' }, undefined, onCommit);
      } else if (onCommit) {
        busy = true;
        try { onCommit(); }
        finally { busy = false; }
      }
      return { ok: true };
    },
    /** @param {string} id @param {number} [amount] @returns {InventoryResult} */
    add(id, amount = 1) { return api.transact({ add: [{ id, amount }] }); },
    /** @param {string} id @param {number} [amount] @returns {InventoryResult} */
    remove(id, amount = 1) { return api.transact({ remove: [{ id, amount }] }); },
    /** Move/swap stacks, or merge matching stacks up to their size limit. @param {number} from @param {number} to @returns {InventoryResult} */
    move(from, to) {
      writable();
      const source = slotAt(from);
      const target = slotAt(to);
      if (!source) return { ok: false, reason: 'empty' };
      if (from === to) return { ok: true };
      const slots = bag.slice();
      if (target?.id === source.id) {
        const moved = Math.min(source.amount, item(source.id).maxStack - target.amount);
        if (moved === 0) return { ok: false, reason: 'full' };
        slots[to] = { id: target.id, amount: target.amount + moved };
        slots[from] = moved === source.amount ? null : { id: source.id, amount: source.amount - moved };
      } else {
        slots[to] = source;
        slots[from] = target;
      }
      commit(slots, { type: 'moved' });
      return { ok: true };
    },
    /** @param {number} index Bag slot containing the item. @param {string} [slot] @returns {InventoryResult} */
    equip(index, slot) {
      writable();
      const stack = slotAt(index);
      if (!stack) return { ok: false, reason: 'empty' };
      const definition = item(stack.id).equipment;
      if (!definition) return { ok: false, reason: 'incompatible' };
      const target = slot ?? definition.slots.find(candidate => !equipped.has(candidate)) ?? definition.slots[0];
      if (!definition.slots.includes(target)) return { ok: false, reason: 'incompatible' };
      const previous = equipped.get(target);
      if (previous === stack.id) return { ok: true };
      const slots = bag.slice();
      slots[index] = stack.amount === 1 ? null : { id: stack.id, amount: stack.amount - 1 };
      if (previous !== undefined && !insert(slots, { id: previous, amount: 1 })) return { ok: false, reason: 'full' };
      const loadout = new Map(equipped);
      loadout.set(target, stack.id);
      commit(slots, { type: 'equipped', slot: target }, loadout);
      return { ok: true };
    },
    /** @param {string} slot @returns {InventoryResult} */
    unequip(slot) {
      writable();
      const id = equipped.get(slot);
      if (id === undefined) return { ok: false, reason: 'empty' };
      const slots = bag.slice();
      if (!insert(slots, { id, amount: 1 })) return { ok: false, reason: 'full' };
      const loadout = new Map(equipped);
      loadout.delete(slot);
      commit(slots, { type: 'unequipped', slot }, loadout);
      return { ok: true };
    },
    /** Admit every reward before claiming. @param {ClaimableQuests} quests @param {string} id @returns {InventoryResult} */
    claimQuestRewards(quests, id) {
      writable();
      /** @type {(ItemQuantity | null)[] | null} */
      let slots = null;
      let full = false;
      busy = true;
      let rewards;
      try {
        rewards = quests.claim(id, { accept(items) {
          const pending = plan({ add: items });
          full = !pending.ok;
          if (pending.ok) slots = pending.slots;
          return pending.ok;
        } });
      } finally { busy = false; }
      if (rewards === null) return { ok: false, reason: full ? 'full' : 'unavailable' };
      if (slots === null) throw new Error('Quest log must honor reward admission');
      commit(slots, { type: 'quest-reward', quest: id });
      return { ok: true };
    },
    /** @returns {InventorySnapshot} */
    snapshot() { return { schemaVersion: 1, slots: api.list(), equipment: Object.fromEntries(equipped) }; },
    /** @param {InventorySnapshot} snapshot */
    restore(snapshot) {
      writable();
      if (snapshot?.schemaVersion !== 1 || !Array.isArray(snapshot.slots) || snapshot.slots.length !== capacity ||
        !snapshot.equipment || typeof snapshot.equipment !== 'object' || Array.isArray(snapshot.equipment)) throw new Error('Incompatible inventory snapshot');
      const slots = Array.from(snapshot.slots, stack => {
        if (stack === null) return null;
        const entry = quantity(stack);
        if (entry.amount > item(entry.id).maxStack) throw new Error('Saved stack exceeds maxStack: ' + entry.id);
        return entry;
      });
      const loadout = new Map();
      for (const [slot, id] of Object.entries(snapshot.equipment)) {
        if (!item(id).equipment?.slots.includes(slot)) throw new Error('Incompatible saved equipment: ' + slot);
        loadout.set(slot, id);
      }
      commit(slots, { type: 'restored' }, loadout);
    },
    /** @type {(listener: (event: InventoryEvent) => void) => (() => void)} */
    subscribe: events.subscribe,
    dispose() {
      if (disposed) return;
      writable();
      disposed = true;
      events.clear();
      attributes?.removeModifiers(modifierSource);
    },
  };
  return api;
}
