import { createTagContainer, normalizeGameplayTag } from '../core/tags.js';
import { finite, identifier, publisher } from '../internal/gameplay.js';

/** @typedef {readonly [number, number] | readonly [number, number, number]} LevelPoint */
/** @typedef {{all?: readonly string[], any?: readonly string[], none?: readonly string[], exact?: boolean}} VolumeTagQuery */
/** @typedef {{min: LevelPoint, max: LevelPoint, tags?: VolumeTagQuery, once?: boolean, enterSignal?: string, exitSignal?: string}} TriggerVolume */
/** @typedef {{id: string, position: ArrayLike<number>, tags?: import('../core/tags.js').TagContainer}} TriggerSample */
/** @typedef {{type: 'enter' | 'exit', trigger: string, actor: string, signal?: string}} TriggerEvent */
/** @typedef {{id: string, min: number[], max: number[], tags: VolumeTagQuery, once: boolean, enterSignal?: string, exitSignal?: string}} CompiledVolume */

/** @param {ArrayLike<number>} value @param {number} dimensions @param {string} name */
function coordinates(value, dimensions, name) {
  if (!value || value.length !== dimensions) throw new TypeError(name + ' needs ' + dimensions + ' coordinates');
  return Array.from(value, coordinate => finite(coordinate, name));
}

/** @param {string} id @param {TriggerVolume} volume @param {2 | 3} dimensions @returns {CompiledVolume} */
function compileVolume(id, volume, dimensions) {
  const min = coordinates(volume.min, dimensions, 'volume minimum');
  const max = coordinates(volume.max, dimensions, 'volume maximum');
  if (min.some((value, axis) => value >= max[axis])) throw new RangeError('Trigger volume needs positive size: ' + id);
  return { id: identifier(id, 'trigger id'), min, max, once: volume.once === true,
    tags: { all: (volume.tags?.all ?? []).map(normalizeGameplayTag), any: (volume.tags?.any ?? []).map(normalizeGameplayTag),
      none: (volume.tags?.none ?? []).map(normalizeGameplayTag), exact: volume.tags?.exact === true },
    enterSignal: volume.enterSignal === undefined ? undefined : identifier(volume.enterSignal, 'enter signal'),
    exitSignal: volume.exitSignal === undefined ? undefined : identifier(volume.exitSignal, 'exit signal') };
}

/**
 * Track named actor points entering/exiting 2D or 3D AABBs using sampled world coordinates.
 * The logic uses the caller's fixed step and shares existing hierarchical entity tags.
 * @param {Record<string, TriggerVolume>} definitions
 * @param {{dimensions: 2 | 3, onEvent?: (event: TriggerEvent) => void}} options
 */
export function createTriggerVolumes(definitions, { dimensions, onEvent }) {
  if (dimensions !== 2 && dimensions !== 3) throw new RangeError('Trigger dimensions must be 2 or 3');
  const volumes = Object.entries(definitions).map(([id, volume]) => compileVolume(id, volume, dimensions));
  const oneShot = new Set(volumes.filter(volume => volume.once).map(volume => volume.id));
  const events = publisher(onEvent);
  const noTags = createTagContainer();
  /** @type {Map<string, Set<string>>} */
  let occupied = new Map();
  /** @type {Set<string>} */
  let consumed = new Set();
  let dispatching = false;
  let disposed = false;
  function writable() {
    if (disposed) throw new Error('Trigger volumes are disposed');
    if (dispatching) throw new Error('Trigger commands cannot run during trigger callbacks');
  }

  return {
    /** @param {Iterable<TriggerSample>} samples @returns {TriggerEvent[]} */
    update(samples) {
      writable();
      if (!volumes.length) return [];
      const actors = new Map();
      for (const sample of samples) {
        const id = identifier(sample.id, 'trigger actor id');
        if (actors.has(id)) throw new Error('Duplicate trigger actor: ' + id);
        actors.set(id, { position: coordinates(sample.position, dimensions, 'actor position'), tags: sample.tags ?? noTags });
      }
      const next = new Map();
      const fired = new Set(consumed);
      /** @type {TriggerEvent[]} */
      const pending = [];
      for (const volume of volumes) {
        const previous = occupied.get(volume.id);
        /** @type {Set<string>} */
        const inside = new Set();
        if (!fired.has(volume.id) || previous?.size) {
          for (const [id, actor] of actors) {
            const alreadyInside = previous?.has(id) ?? false;
            if (!alreadyInside && fired.has(volume.id)) continue;
            if (!actor.position.every((value, axis) => value >= volume.min[axis] && value <= volume.max[axis]) || !actor.tags.matches(volume.tags)) continue;
            inside.add(id);
            if (alreadyInside) continue;
            pending.push({ type: 'enter', trigger: volume.id, actor: id, signal: volume.enterSignal });
            if (volume.once) fired.add(volume.id);
          }
        }
        for (const id of previous ?? []) {
          if (!inside.has(id)) pending.push({ type: 'exit', trigger: volume.id, actor: id, signal: volume.exitSignal });
        }
        if (inside.size) next.set(volume.id, inside);
      }
      occupied = next;
      consumed = fired;
      dispatching = true;
      try { for (const event of pending) events.emit(Object.freeze(event)); }
      finally { dispatching = false; }
      return pending;
    },
    /** @param {string} volume @param {string} actor */
    contains(volume, actor) { return occupied.get(volume)?.has(actor) ?? false; },
    /** @returns {string[]} */
    snapshot() { return [...consumed]; },
    /** Restore consumed one-shot zones and rebuild occupancy on the next sample. @param {readonly string[]} spent */
    restore(spent) {
      writable();
      if (!Array.isArray(spent) || spent.some(id => !oneShot.has(id))) throw new Error('Invalid one-shot trigger snapshot');
      consumed = new Set(spent);
      occupied.clear();
    },
    /** @type {(listener: (event: TriggerEvent) => void) => (() => void)} */
    subscribe(listener) { return disposed ? () => {} : events.subscribe(listener); },
    dispose() {
      disposed = true;
      events.clear();
      occupied.clear();
      consumed.clear();
    },
  };
}
