import { createTagContainer, normalizeGameplayTag } from '../core/tags.js';
import { changes, finite, identifier, nonNegative, positiveInteger, publisher } from '../internal/gameplay.js';
import { cleanupAll } from '../internal/cleanup.js';

let nextController = 1;
/**
 * @typedef {object} EffectDefinition
 * @property {number} [duration=0] Seconds; 0 is instant, -1 lasts until removed.
 * @property {'refresh' | 'stack' | 'replace' | 'independent'} [stacking='refresh']
 * @property {number} [maxStacks=1]
 * @property {readonly import('./attributes.js').AttributeModifier[]} [modifiers] Active modifiers, scaled by stacks.
 * @property {Record<string, number>} [changes] Effective-value changes applied once on application.
 * @property {readonly string[]} [tags] Reference-counted tags granted while active.
 * @property {{interval: number, changes: Record<string, number>}} [periodic] Effective-value deltas per interval, per stack.
 */
/** @typedef {{handle: string, definition: string, source: string, stacks: number, remaining: number, nextTick: number | null}} EffectState */
/** @typedef {{schemaVersion: 1, nextId: number, effects: EffectState[]}} EffectSnapshot */
/** @typedef {{type: 'applied' | 'stacked' | 'tick' | 'removed', handle: string, definition: string, stacks: number, count?: number, reason?: string}} EffectEvent */
/**
 * @typedef {object} EffectController
 * @property {import('./attributes.js').AttributeSet} attributes
 * @property {import('../core/tags.js').TagContainer} tags
 * @property {(id: string, definition: EffectDefinition) => void} define Remove active instances before redefining their effect.
 * @property {(id: string) => boolean} hasDefinition
 * @property {(id: string, options?: {source?: string, stacks?: number, duration?: number}) => string | null} apply Handle, or null for an instant effect.
 * @property {(handle: string, reason?: string) => boolean} remove
 * @property {(definition: string, source?: string) => number} removeByDefinition
 * @property {(dt: number) => void} update Advance simulation seconds; no independent scheduler.
 * @property {() => EffectState[]} list
 * @property {() => EffectSnapshot} snapshot
 * @property {(snapshot: EffectSnapshot) => void} restore Does not reapply instant changes or past periodic ticks.
 * @property {() => void} clear
 * @property {(listener: (event: EffectEvent) => void) => (() => void)} subscribe
 * @property {() => void} dispose
 */

/**
 * Create stackable status effects shared by 2D, 3D and command-driven games.
 * @param {{attributes: import('./attributes.js').AttributeSet, tags?: import('../core/tags.js').TagContainer, definitions?: Record<string, EffectDefinition>, maxEffects?: number, onEvent?: (event: EffectEvent) => void}} options
 * @returns {EffectController}
 */
export function createEffectController({ attributes, tags = createTagContainer(), definitions = {}, maxEffects = 256, onEvent }) {
  positiveInteger(maxEffects, 'maxEffects');
  const catalog = new Map();
  const active = new Map();
  const events = publisher(onEvent);
  const scratch = [];
  const owner = 'hgame.effects.' + nextController++ + '.';
  let clock = 0, nextId = 1, disposed = false, updating = false;
  function live() { if (disposed) throw new Error('EffectController is disposed'); }
  function duration(value) {
    finite(value, 'duration');
    if (value < 0 && value !== -1) throw new RangeError('duration must be >= 0 or -1');
    return value;
  }
  function validateChanges(input) {
    const output = changes(input);
    for (const name of Object.keys(output)) if (!attributes.has(name)) throw new Error('Unknown effect attribute: ' + name);
    return output;
  }
  function define(id, input) {
    live(); identifier(id);
    for (const entry of active.values()) {
      if (entry.definition === id) throw new Error('Cannot redefine an active effect: ' + id);
    }
    const modifiers = (input.modifiers ?? []).map(mod => {
      if (!attributes.has(mod.attribute)) throw new Error('Unknown effect attribute: ' + mod.attribute);
      const operation = mod.operation ?? 'add';
      if (!['add', 'percent', 'multiply'].includes(operation)) throw new Error('Unknown modifier operation: ' + operation);
      const value = finite(mod.value, 'modifier value');
      if (operation === 'multiply' && value < 0) throw new RangeError('Multipliers must be non-negative');
      return Object.freeze({ attribute: mod.attribute, operation, value });
    });
    const stacking = input.stacking ?? 'refresh';
    if (!['refresh', 'stack', 'replace', 'independent'].includes(stacking)) throw new Error('Unknown effect stacking: ' + stacking);
    let periodic = null;
    if (input.periodic) {
      const interval = nonNegative(input.periodic.interval, 'periodic interval');
      if (interval === 0) throw new RangeError('periodic interval must be > 0');
      periodic = Object.freeze({ interval, changes: validateChanges(input.periodic.changes) });
    }
    const def = Object.freeze({ duration: duration(input.duration ?? 0), stacking,
      maxStacks: positiveInteger(input.maxStacks ?? 1, 'maxStacks'),
      modifiers: Object.freeze(modifiers), changes: validateChanges(input.changes),
      tags: Object.freeze([...new Set((input.tags ?? []).map(tag => normalizeGameplayTag(tag)))]), periodic });
    if (def.duration === 0 && (modifiers.length || def.tags.length || periodic)) {
      throw new Error('Instant effects use changes; persistent modifiers, tags and periodic ticks need a duration');
    }
    catalog.set(id, def);
  }
  function changeValues(values, multiplier = 1) {
    for (const [name, delta] of Object.entries(values)) {
      if (disposed) break;
      attributes.change(name, finite(delta * multiplier, name + ' effect delta'));
    }
  }
  function syncModifiers(entry) {
    if (!entry.def.modifiers.length) return;
    attributes.setModifiers(owner + entry.handle, entry.def.modifiers.map(mod => ({
      ...mod, value: mod.operation === 'multiply' ? mod.value ** entry.stacks : mod.value * entry.stacks,
    })));
  }
  function state(entry) {
    return { handle: entry.handle, definition: entry.definition, source: entry.source, stacks: entry.stacks,
      remaining: entry.expiresAt === Infinity ? -1 : Math.max(0, entry.expiresAt - clock),
      nextTick: entry.nextTick === Infinity ? null : Math.max(0, entry.nextTick - clock) };
  }
  function notify(type, entry, extra = {}) {
    events.emit({ type, handle: entry.handle, definition: entry.definition, stacks: entry.stacks, ...extra });
  }
  function remove(handle, reason = 'removed') {
    const entry = active.get(handle);
    if (!entry) return false;
    active.delete(handle);
    // Revoke tags before notifications can trigger another ability.
    cleanupAll([
      () => { if (entry.def.tags.length) tags.remove(entry.def.tags); },
      () => attributes.removeModifiers(owner + handle),
      () => notify('removed', entry, { reason }),
    ], 'Effect removal failed');
    return true;
  }
  function install(entry) {
    active.set(entry.handle, entry);
    if (entry.def.tags.length) tags.add(entry.def.tags);
    if (!disposed && active.get(entry.handle) === entry) syncModifiers(entry);
  }
  /** @type {EffectController} */
  const api = {
    attributes, tags, define,
    hasDefinition(id) { return catalog.has(id); },
    apply(id, options = {}) {
      live();
      const def = catalog.get(id);
      if (!def) throw new Error('Unknown effect: ' + id);
      const source = options.source ?? '';
      if (typeof source !== 'string') throw new TypeError('effect source must be a string');
      const stacks = Math.min(def.maxStacks, positiveInteger(options.stacks ?? 1, 'stacks'));
      const seconds = duration(options.duration ?? def.duration);
      if (seconds === 0) {
        if (def.modifiers.length || def.tags.length || def.periodic) throw new Error('Cannot apply a persistent effect with duration 0');
        changeValues(def.changes, stacks);
        notify('applied', { handle: '', definition: id, stacks });
        return null;
      }
      let previous = null;
      if (def.stacking !== 'independent') {
        for (const entry of active.values()) if (entry.definition === id && entry.source === source) { previous = entry; break; }
      }
      if (previous && def.stacking !== 'replace') {
        const added = def.stacking === 'stack' ? Math.min(previous.def.maxStacks - previous.stacks, stacks) : 0;
        previous.stacks += added;
        previous.expiresAt = seconds === -1 ? Infinity : clock + seconds;
        syncModifiers(previous);
        if (!disposed && active.get(previous.handle) === previous) changeValues(previous.def.changes, def.stacking === 'stack' ? added : stacks);
        if (!disposed && active.get(previous.handle) === previous) notify('stacked', previous);
        return previous.handle;
      }
      if (previous) remove(previous.handle, 'replaced');
      live();
      if (active.size >= maxEffects) throw new RangeError('Maximum active effects reached');
      const handle = 'effect:' + nextId++;
      const entry = { handle, definition: id, source, stacks, def,
        expiresAt: seconds === -1 ? Infinity : clock + seconds,
        nextTick: def.periodic ? clock + def.periodic.interval : Infinity };
      install(entry);
      if (!disposed && active.get(handle) === entry) changeValues(def.changes, stacks);
      if (!disposed && active.get(handle) === entry) notify('applied', entry);
      return handle;
    },
    remove,
    removeByDefinition(id, source) {
      const handles = [...active.values()].filter(entry => entry.definition === id && (source === undefined || entry.source === source)).map(entry => entry.handle);
      let removed = 0;
      cleanupAll(handles.map(handle => () => { if (remove(handle)) removed++; }), 'Effect removal failed');
      return removed;
    },
    update(dt) {
      live(); nonNegative(dt, 'dt');
      if (updating) throw new Error('EffectController.update is not reentrant');
      clock = finite(clock + dt, 'effect clock');
      updating = true;
      try {
        for (const entry of active.values()) scratch.push(entry);
        for (const entry of scratch) {
          if (disposed) break;
          if (active.get(entry.handle) !== entry) continue;
          const until = Math.min(clock, entry.expiresAt);
          if (entry.def.periodic && entry.nextTick <= until) {
            const count = Math.min(Number.MAX_SAFE_INTEGER, Math.floor((until - entry.nextTick) / entry.def.periodic.interval + 1e-9) + 1);
            entry.nextTick += count * entry.def.periodic.interval;
            changeValues(entry.def.periodic.changes, entry.stacks * count);
            if (!disposed && active.get(entry.handle) === entry) notify('tick', entry, { count });
          }
          if (!disposed && active.get(entry.handle) === entry && clock >= entry.expiresAt) remove(entry.handle, 'expired');
        }
      } finally { scratch.length = 0; updating = false; }
    },
    list() { return [...active.values()].map(state); },
    snapshot() { return { schemaVersion: 1, nextId, effects: api.list() }; },
    restore(snapshot) {
      live();
      if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.effects) || snapshot.effects.length > maxEffects) throw new Error('Invalid effect snapshot');
      const pending = [], handles = new Set();
      let sequence = positiveInteger(snapshot.nextId, 'nextId');
      for (const saved of snapshot.effects) {
        const def = catalog.get(saved.definition);
        if (!def) throw new Error('Unknown snapshot effect: ' + saved.definition);
        const match = /^effect:([1-9][0-9]*)$/.exec(saved.handle);
        if (!match || handles.has(saved.handle) || typeof saved.source !== 'string') throw new Error('Invalid effect handle/source');
        handles.add(saved.handle);
        sequence = Math.max(sequence, positiveInteger(Number(match[1]), 'handle') + 1);
        const remaining = duration(saved.remaining);
        const stacks = positiveInteger(saved.stacks, 'stacks');
        if (stacks > def.maxStacks) throw new Error('Snapshot exceeds maxStacks');
        if (remaining === 0) continue;
        let nextTick = Infinity;
        if (def.periodic) nextTick = clock + nonNegative(saved.nextTick, 'nextTick');
        pending.push({ handle: saved.handle, definition: saved.definition, source: saved.source, stacks, def,
          expiresAt: remaining === -1 ? Infinity : clock + remaining, nextTick });
      }
      api.clear(); live(); nextId = sequence;
      for (const entry of pending) { live(); install(entry); }
    },
    clear() { cleanupAll([...active.keys()].map(handle => () => remove(handle, 'cleared')), 'Effect cleanup failed'); },
    subscribe: events.subscribe,
    dispose() {
      if (disposed) return;
      disposed = true;
      events.clear();
      try { api.clear(); } finally { catalog.clear(); }
    },
  };
  for (const [id, def] of Object.entries(definitions)) define(id, def);
  return api;
}
