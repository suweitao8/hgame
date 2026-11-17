import { changes, finite, identifier, publisher } from '../internal/gameplay.js';

/** @typedef {{base: number, min?: number | string, max?: number | string}} AttributeDefinition */
/** @typedef {{attribute: string, operation?: 'add' | 'percent' | 'multiply', value: number}} AttributeModifier */
/** @typedef {{type: 'base' | 'modifiers' | 'restore', attribute?: string, source?: string}} AttributeChange */
/**
 * @typedef {object} AttributeSet
 * @property {(name: string) => boolean} has
 * @property {(name: string) => number} get Effective, bounded value.
 * @property {(name: string) => number} getBase Unmodified base value.
 * @property {(name: string, value: number) => number} setBase
 * @property {(name: string, delta: number) => number} addBase
 * @property {(name: string, value: number) => boolean} setValue Change the base to obtain an effective value; false for a zero/negative multiplier.
 * @property {(name: string, delta: number) => boolean} change
 * @property {(source: string, modifiers: readonly AttributeModifier[]) => void} setModifiers Replace one source's modifiers.
 * @property {(source: string) => boolean} removeModifiers
 * @property {(costs: Record<string, number>) => boolean} canSpend
 * @property {(costs: Record<string, number>) => boolean} spend Atomically subtract non-negative effective resource costs.
 * @property {() => Record<string, number>} values
 * @property {() => Record<string, number>} snapshot Base values only; equipment and effects own their modifiers.
 * @property {(values: Record<string, number>) => void} restore
 * @property {(listener: (event: AttributeChange) => void) => (() => void)} subscribe
 * @property {() => void} dispose
 */

/**
 * Create named attributes with live bounds and source-owned modifiers.
 * Effective value = (base + sum(add)) * (1 + sum(percent)) * product(multiply), then clamp.
 * A string bound references another effective attribute (for example hp.max = 'maxHp').
 * @param {Record<string, number | AttributeDefinition>} [definitions]
 * @param {{onChange?: (event: AttributeChange) => void}} [options]
 * @returns {AttributeSet}
 */
export function createAttributeSet(definitions = {}, { onChange } = {}) {
  const records = new Map();
  const sources = new Map();
  const events = publisher(onChange);
  let revision = 0;
  let disposed = false;
  for (const [name, value] of Object.entries(definitions)) {
    identifier(name, 'attribute');
    const def = typeof value === 'number' ? { base: value } : value;
    if (!def || typeof def !== 'object') throw new TypeError('Invalid attribute: ' + name);
    for (const bound of [def.min, def.max]) {
      if (bound !== undefined && typeof bound !== 'string') finite(bound, name + ' bound');
    }
    records.set(name, { base: finite(def.base, name), min: def.min, max: def.max, cached: 0, revision: -1, visiting: false });
  }
  function record(name) {
    if (disposed) throw new Error('AttributeSet is disposed');
    const entry = records.get(name);
    if (!entry) throw new Error('Unknown attribute: ' + name);
    return entry;
  }
  function factors(name) {
    let add = 0, percent = 0, multiply = 1;
    for (const list of sources.values()) for (const mod of list) {
      if (mod.attribute !== name) continue;
      if (mod.operation === 'percent') percent += mod.value;
      else if (mod.operation === 'multiply') multiply *= mod.value;
      else add += mod.value;
    }
    return { add, scale: (1 + percent) * multiply };
  }
  function bounds(entry) {
    const min = typeof entry.min === 'string' ? get(entry.min) : (entry.min ?? -Infinity);
    const max = typeof entry.max === 'string' ? get(entry.max) : (entry.max ?? Infinity);
    if (min > max) throw new RangeError('Attribute minimum exceeds maximum');
    return { min, max };
  }
  function get(name) {
    const entry = record(name);
    if (entry.revision === revision) return entry.cached;
    if (entry.visiting) throw new Error('Cyclic attribute bounds at ' + name);
    entry.visiting = true;
    try {
      const { add, scale } = factors(name);
      const { min, max } = bounds(entry);
      entry.cached = Math.max(min, Math.min(max, finite((entry.base + add) * scale, name)));
      entry.revision = revision;
      return entry.cached;
    } finally { entry.visiting = false; }
  }
  function changed(event) { revision++; events.emit(event); }
  function baseForValue(name, value) {
    const entry = record(name);
    const { add, scale } = factors(name);
    if (!(scale > 0) || !Number.isFinite(scale)) return null;
    const { min, max } = bounds(entry);
    return finite(Math.max(min, Math.min(max, value)) / scale - add, name);
  }
  function prepareSpend(input) {
    const costs = changes(input);
    const pending = new Map();
    for (const [name, amount] of Object.entries(costs)) {
      if (amount < 0) throw new RangeError('Resource costs must be non-negative');
      if (amount === 0) { record(name); continue; }
      const current = get(name);
      const entry = record(name);
      const { min } = bounds(entry);
      if (current - amount < Math.max(0, min)) return null;
      const next = baseForValue(name, current - amount);
      if (next === null) return null;
      pending.set(name, { entry, base: entry.base, next, target: current - amount });
    }
    if (pending.size > 1) {
      // A simultaneously spent attribute may also bound another. Evaluate the whole debit
      // before notifying observers so a moving bound cannot change the promised cost.
      for (const item of pending.values()) item.entry.base = item.next;
      revision++;
      try {
        for (const [name, item] of pending) {
          if (Math.abs(get(name) - item.target) > Number.EPSILON * Math.max(1, Math.abs(item.target)) * 8) return null;
        }
      } finally {
        for (const item of pending.values()) item.entry.base = item.base;
        revision++;
      }
    }
    return pending;
  }
  /** @type {AttributeSet} */
  const api = {
    has(name) { return !disposed && records.has(name); },
    get,
    getBase(name) { return record(name).base; },
    setBase(name, value) {
      const entry = record(name);
      value = finite(value, name);
      if (entry.base !== value) { entry.base = value; changed({ type: 'base', attribute: name }); }
      return value;
    },
    addBase(name, delta) { return api.setBase(name, record(name).base + finite(delta, name)); },
    setValue(name, value) {
      const next = baseForValue(name, finite(value, name));
      if (next === null) return false;
      api.setBase(name, next);
      return true;
    },
    change(name, delta) { return api.setValue(name, get(name) + finite(delta, name)); },
    setModifiers(source, modifiers) {
      identifier(source, 'modifier source');
      const list = modifiers.map(mod => {
        record(mod.attribute);
        const operation = mod.operation ?? 'add';
        if (!['add', 'percent', 'multiply'].includes(operation)) throw new Error('Unknown modifier operation: ' + operation);
        const value = finite(mod.value, mod.attribute);
        if (operation === 'multiply' && value < 0) throw new RangeError('Multipliers must be non-negative');
        return { attribute: mod.attribute, operation, value };
      });
      sources.set(source, list);
      changed({ type: 'modifiers', source });
    },
    removeModifiers(source) {
      if (!sources.delete(source)) return false;
      changed({ type: 'modifiers', source });
      return true;
    },
    canSpend(costs) { return prepareSpend(costs) !== null; },
    spend(costs) {
      const pending = prepareSpend(costs);
      if (!pending) return false;
      for (const item of pending.values()) item.entry.base = item.next;
      if (pending.size) changed({ type: 'base' });
      return true;
    },
    values() { return Object.fromEntries([...records.keys()].map(name => [name, get(name)])); },
    snapshot() { return Object.fromEntries([...records].map(([name, entry]) => [name, entry.base])); },
    restore(values) {
      const pending = Object.entries(values).map(([name, value]) => ({ entry: record(name), value: finite(value, name) }));
      for (const { entry, value } of pending) entry.base = value;
      changed({ type: 'restore' });
    },
    subscribe: events.subscribe,
    dispose() { if (!disposed) { disposed = true; sources.clear(); events.clear(); } },
  };
  // Resolve references once without changing caller definitions or creating timers.
  for (const name of records.keys()) get(name);
  return api;
}
