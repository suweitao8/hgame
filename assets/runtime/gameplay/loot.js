import { createSeededRng } from '../sim/rng.js';
import { identifier, positiveInteger } from '../internal/gameplay.js';

/** @typedef {import('./inventory.js').ItemQuantity} ItemQuantity */
/** @typedef {{kind: 'item', id: string, amount?: number | readonly [number, number]} | {kind: 'table', id: string} | {kind: 'empty'}} LootOutcome */
/** @typedef {{guaranteed?: readonly LootOutcome[], entries?: readonly (LootOutcome & {weight: number})[], rolls?: number}} LootTable */
/** @typedef {{kind: 'item', id: string, min: number, max: number} | {kind: 'table', id: string} | {kind: 'empty'}} CompiledOutcome */
/** @typedef {{guaranteed: CompiledOutcome[], entries: {weight: number, outcome: CompiledOutcome}[], rolls: number, total: number}} CompiledTable */
/** @typedef {{source: string, table: string, status: 'pending' | 'claimed', items: ItemQuantity[]}} LootReceipt */
/** @typedef {{schemaVersion: 1, seed: string | number, receipts: LootReceipt[]}} LootSnapshot */
/** @typedef {{ok: true, items: ItemQuantity[]} | {ok: false, reason: 'unavailable' | 'full'}} LootClaim */
/** @typedef {Pick<ReturnType<typeof import('./inventory.js').createInventory>, 'transact'>} LootInventory */

const MAX_WEIGHT_TOTAL = 0x100000000;
// Bound expanded work even when a small graph repeats several nested tables.
const MAX_TABLE_WORK = 4096;

/** @param {LootOutcome} input @returns {CompiledOutcome} */
function outcome(input) {
  if (input.kind === 'empty') return { kind: 'empty' };
  if (input.kind === 'table') return { kind: 'table', id: identifier(input.id, 'loot table') };
  if (input.kind !== 'item') throw new Error('Unknown loot outcome kind');
  const amount = input.amount ?? 1;
  const min = positiveInteger(typeof amount === 'number' ? amount : amount[0], 'minimum quantity');
  const max = positiveInteger(typeof amount === 'number' ? amount : amount[1], 'maximum quantity');
  if (max < min || max - min + 1 > MAX_WEIGHT_TOTAL) throw new RangeError('Invalid loot quantity range');
  return { kind: 'item', id: identifier(input.id, 'item id'), min, max };
}

/** @param {LootReceipt} receipt @returns {LootReceipt} */
function copyReceipt(receipt) { return { ...receipt, items: receipt.items.map(stack => ({ ...stack })) }; }

/**
 * Compile weighted loot tables and keep one durable roll and claim per game-owned source ID.
 * Identical run seed, table and source ID produce the same result regardless of other drops.
 * @param {Record<string, LootTable>} definitions
 * @param {{seed?: string | number}} [options]
 */
export function createLootSystem(definitions, { seed = 1 } = {}) {
  if (typeof seed !== 'string' && !Number.isFinite(seed)) throw new TypeError('Loot seed must be a finite number or string');
  /** @type {Map<string, CompiledTable>} */
  const tables = new Map();
  for (const [id, input] of Object.entries(definitions)) {
    const guaranteed = (input.guaranteed ?? []).map(outcome);
    const entries = (input.entries ?? []).map(entry => ({ weight: positiveInteger(entry.weight, 'loot weight'), outcome: outcome(entry) }));
    const rolls = input.rolls ?? (entries.length ? 1 : 0);
    if (!Number.isSafeInteger(rolls) || rolls < 0 || rolls > MAX_TABLE_WORK || (rolls > 0 && !entries.length)) {
      throw new RangeError('Invalid roll count in loot table: ' + id);
    }
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    if (total > MAX_WEIGHT_TOTAL) throw new RangeError('Loot weight total is too large: ' + id);
    tables.set(identifier(id, 'loot table id'), { guaranteed, entries, rolls, total });
  }

  /** @type {Map<string, {work: number, depth: number}>} */
  const costs = new Map();
  const visiting = new Set();
  /** @param {string} id @returns {{work: number, depth: number}} */
  function resolve(id) {
    const known = costs.get(id);
    if (known !== undefined) return known;
    const table = tables.get(id);
    if (!table) throw new Error('Unknown loot table: ' + id);
    if (visiting.has(id)) throw new Error('Cyclic loot table: ' + id);
    if (visiting.size >= 64) throw new RangeError('Loot table nesting exceeds 64');
    visiting.add(id);
    let depth = 1;
    /** @param {CompiledOutcome} entry */
    function work(entry) {
      if (entry.kind !== 'table') return 1;
      const child = resolve(entry.id);
      depth = Math.max(depth, child.depth + 1);
      return child.work;
    }
    const fixed = table.guaranteed.reduce((sum, entry) => sum + work(entry), 0);
    let worst = 0;
    for (const entry of table.entries) worst = Math.max(worst, work(entry.outcome));
    const total = 1 + fixed + table.rolls * (table.entries.length + worst);
    if (total > MAX_TABLE_WORK) throw new RangeError('Expanded loot table is too large: ' + id);
    if (depth > 64) throw new RangeError('Loot table nesting exceeds 64: ' + id);
    visiting.delete(id);
    const result = { work: total, depth };
    costs.set(id, result);
    return result;
  }
  for (const id of tables.keys()) resolve(id);

  /** @type {Map<string, LootReceipt>} */
  let receipts = new Map();
  let claiming = false;

  /** @param {string} id @param {string} source @returns {ItemQuantity[]} */
  function draw(id, source) {
    const rng = createSeededRng(JSON.stringify([seed, id, source]));
    /** @type {Map<string, number>} */
    const totals = new Map();
    /** @param {CompiledOutcome} entry */
    function emit(entry) {
      if (entry.kind === 'table') visit(entry.id);
      if (entry.kind === 'item') {
        const count = entry.min === entry.max ? entry.min : entry.min + rng.int(entry.max - entry.min + 1);
        const amount = (totals.get(entry.id) ?? 0) + count;
        if (!Number.isSafeInteger(amount)) throw new RangeError('Loot item total is too large: ' + entry.id);
        totals.set(entry.id, amount);
      }
    }
    /** @param {string} tableId */
    function visit(tableId) {
      const table = tables.get(tableId);
      for (const entry of table.guaranteed) emit(entry);
      for (let roll = 0; roll < table.rolls; roll++) {
        let pick = rng.int(table.total);
        for (const entry of table.entries) {
          pick -= entry.weight;
          if (pick < 0) { emit(entry.outcome); break; }
        }
      }
    }
    visit(id);
    return [...totals].map(([id, amount]) => ({ id, amount }));
  }

  return {
    /** Keep the first result for a source ID. @param {string} table @param {string} source @returns {LootReceipt} */
    roll(table, source) {
      if (claiming) throw new Error('Cannot roll loot during a claim');
      identifier(source, 'loot source');
      if (!tables.has(table)) throw new Error('Unknown loot table: ' + table);
      const previous = receipts.get(source);
      if (previous) {
        if (previous.table !== table) throw new Error('Loot source is assigned to another table: ' + source);
        return copyReceipt(previous);
      }
      /** @type {LootReceipt} */
      const receipt = { source, table, status: 'pending', items: draw(table, source) };
      receipts.set(source, receipt);
      return copyReceipt(receipt);
    },
    /** @param {string} source @returns {LootReceipt | null} */
    get(source) { const receipt = receipts.get(source); return receipt ? copyReceipt(receipt) : null; },
    /** @param {string} source @param {LootInventory} inventory @returns {LootClaim} */
    claim(source, inventory) {
      if (claiming) throw new Error('Loot claims cannot be nested');
      const receipt = receipts.get(source);
      if (!receipt || receipt.status !== 'pending') return { ok: false, reason: 'unavailable' };
      claiming = true;
      try {
        const items = copyReceipt(receipt).items;
        const result = inventory.transact({ add: items }, { onCommit() { receipt.status = 'claimed'; } });
        if (result.ok && receipt.status !== 'claimed') throw new Error('Loot inventory must honor the transaction commit callback');
        return result.ok ? { ok: true, items } : { ok: false, reason: 'full' };
      } finally { claiming = false; }
    },
    /** @returns {LootSnapshot} */
    snapshot() { return { schemaVersion: 1, seed, receipts: [...receipts.values()].map(copyReceipt) }; },
    /** Restore the recorded outcomes without rolling or granting items. @param {LootSnapshot} snapshot */
    restore(snapshot) {
      if (claiming) throw new Error('Cannot restore loot during a claim');
      if (snapshot?.schemaVersion !== 1 || snapshot.seed !== seed || !Array.isArray(snapshot.receipts)) throw new Error('Incompatible loot snapshot');
      /** @type {Map<string, LootReceipt>} */
      const loaded = new Map();
      for (const entry of snapshot.receipts) {
        const source = identifier(entry.source, 'loot source');
        if (loaded.has(source) || !tables.has(entry.table) || (entry.status !== 'pending' && entry.status !== 'claimed') ||
          !Array.isArray(entry.items) || entry.items.length > MAX_TABLE_WORK) throw new Error('Invalid loot receipt: ' + source);
        const ids = new Set();
        const items = entry.items.map(stack => {
          const id = identifier(stack.id, 'item id');
          if (ids.has(id)) throw new Error('Duplicate loot item: ' + id);
          ids.add(id);
          return { id, amount: positiveInteger(stack.amount, 'loot item amount') };
        });
        loaded.set(source, { source, table: entry.table, status: entry.status, items });
      }
      receipts = loaded;
    },
  };
}
