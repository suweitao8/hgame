import { identifier, positiveInteger } from '../internal/gameplay.js';
import { createTagContainer, normalizeGameplayTag } from '../core/tags.js';

/** @typedef {import('./inventory.js').ItemQuantity} ItemQuantity */
/** @typedef {{inputs?: readonly ItemQuantity[], outputs: readonly ItemQuantity[], station?: string, requires?: readonly string[]}} CraftRecipe */
/** @typedef {{quantity?: number, station?: string, tags?: import('../core/tags.js').TagContainer}} CraftOptions */
/** @typedef {{id: string, quantity: number, inputs: ItemQuantity[], outputs: ItemQuantity[]}} CraftPlan */
/** @typedef {{ok: true, plan: CraftPlan} | {ok: false, reason: 'unknown-recipe' | 'wrong-station' | 'requirements'}} CraftQuote */
/** @typedef {CraftQuote | Extract<import('./inventory.js').InventoryResult, {ok: false}>} CraftResult */
/** @typedef {Pick<ReturnType<typeof import('./inventory.js').createInventory>, 'transact'>} CraftInventory */

/** @param {readonly ItemQuantity[]} entries @returns {ItemQuantity[]} */
function quantities(entries) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const entry of entries) {
    const id = identifier(entry.id, 'item id');
    const amount = positiveInteger(entry.amount, 'item amount');
    counts.set(id, positiveInteger((counts.get(id) ?? 0) + amount, 'total item amount'));
  }
  return [...counts].map(([id, amount]) => ({ id, amount }));
}

/** @param {readonly ItemQuantity[]} entries @param {number} quantity */
function scale(entries, quantity) {
  return entries.map(({ id, amount }) => ({ id, amount: positiveInteger(amount * quantity, 'batch item amount') }));
}

/**
 * Compile item recipes with station/tag requirements and batch crafting.
 * A craft exchanges all materials and outputs in one inventory transaction.
 * @param {Record<string, CraftRecipe>} definitions
 */
export function createCraftingBook(definitions) {
  const recipes = new Map(Object.entries(definitions).map(([id, recipe]) => {
    identifier(id, 'recipe id');
    const outputs = quantities(recipe.outputs);
    if (!outputs.length) throw new Error('Recipe needs an output: ' + id);
    return [id, {
      id, inputs: quantities(recipe.inputs ?? []), outputs,
      station: recipe.station === undefined ? null : identifier(recipe.station, 'station id'),
      requires: [...new Set((recipe.requires ?? []).map(tag => normalizeGameplayTag(tag)))],
    }];
  }));
  const noTags = createTagContainer();

  /** @param {string} id @param {CraftOptions} [options] @returns {CraftQuote} */
  function quote(id, { quantity = 1, station, tags = noTags } = {}) {
    const recipe = recipes.get(id);
    if (!recipe) return { ok: false, reason: 'unknown-recipe' };
    if (recipe.station !== null && recipe.station !== station) return { ok: false, reason: 'wrong-station' };
    if (!tags.hasAll(recipe.requires)) return { ok: false, reason: 'requirements' };
    positiveInteger(quantity, 'craft quantity');
    return { ok: true, plan: { id, quantity, inputs: scale(recipe.inputs, quantity), outputs: scale(recipe.outputs, quantity) } };
  }

  return {
    /** @returns {string[]} */
    list() { return [...recipes.keys()]; },
    /** @param {string} id @returns {CraftRecipe | null} */
    get(id) {
      const recipe = recipes.get(id);
      if (!recipe) return null;
      return { inputs: scale(recipe.inputs, 1), outputs: scale(recipe.outputs, 1), station: recipe.station ?? undefined, requires: [...recipe.requires] };
    },
    quote,
    /** @param {string} id @param {CraftInventory} inventory @param {CraftOptions} [options] @returns {CraftResult} */
    craft(id, inventory, options) {
      const quoted = quote(id, options);
      if (!quoted.ok) return quoted;
      const { inputs, outputs } = quoted.plan;
      const exchanged = inventory.transact({ remove: inputs, add: outputs });
      return exchanged.ok ? quoted : exchanged;
    },
  };
}
