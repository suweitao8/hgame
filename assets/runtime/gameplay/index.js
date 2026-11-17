import { Component } from '../core/component.js';
import { createTagContainer } from '../core/tags.js';
import { cleanupAll } from '../internal/cleanup.js';
import { nonNegative } from '../internal/gameplay.js';
import { createAttributeSet } from './attributes.js';
import { createEffectController } from './effects.js';
import { createAbilitySystem } from './abilities.js';

export { createAttributeSet } from './attributes.js';
export { createEffectController } from './effects.js';
export { createAbilitySystem } from './abilities.js';

/**
 * @typedef {object} GameplayActorOptions
 * @property {Record<string, number | import('./attributes.js').AttributeDefinition>} [attributes]
 * @property {import('../core/tags.js').TagContainer} [tags] Optional shared tag container. The actor only removes its own grants.
 * @property {Record<string, import('./effects.js').EffectDefinition>} [effects]
 * @property {Record<string, import('./abilities.js').AbilityDefinition>} [abilities]
 * @property {number} [maxEffects]
 * @property {(context: import('./abilities.js').AbilityExecution) => void} [execute]
 * @property {(event: import('./attributes.js').AttributeChange) => void} [onAttributeChange]
 * @property {(event: import('./effects.js').EffectEvent) => void} [onEffect]
 * @property {(event: import('./abilities.js').AbilityEvent) => void} [onAbility]
 * @property {(event: import('./abilities.js').AbilityTimelineEvent) => void} [onTimeline]
 */
/** @typedef {{schemaVersion: 1, attributes: Record<string, number>, effects: import('./effects.js').EffectSnapshot, abilities: import('./abilities.js').AbilitySnapshot}} GameplayActorSnapshot */
/**
 * @typedef {object} GameplayActor
 * @property {import('./attributes.js').AttributeSet} attributes
 * @property {import('../core/tags.js').TagContainer} tags
 * @property {import('./effects.js').EffectController} effects
 * @property {import('./abilities.js').AbilitySystem} abilities
 * @property {(dt: number) => void} update Effects resolve before abilities each simulation step.
 * @property {() => GameplayActorSnapshot} snapshot
 * @property {(snapshot: GameplayActorSnapshot) => void} restore Use the same versioned definitions as the saved actor.
 * @property {() => void} dispose
 */

/**
 * Compose attributes, effects and abilities for one actor in a renderer-neutral simulation.
 * @param {GameplayActorOptions} [options]
 * @returns {GameplayActor}
 */
export function createGameplayActor(options = {}) {
  const tags = options.tags ?? createTagContainer();
  const attributes = createAttributeSet(options.attributes, { onChange: options.onAttributeChange });
  const effects = createEffectController({ attributes, tags, definitions: options.effects,
    maxEffects: options.maxEffects, onEvent: options.onEffect });
  const abilities = createAbilitySystem({ attributes, tags, effects, definitions: options.abilities,
    execute: options.execute, onEvent: options.onAbility, onTimeline: options.onTimeline });
  let disposed = false;
  let updating = false;
  function live() { if (disposed) throw new Error('GameplayActor is disposed'); }
  return {
    attributes, tags, effects, abilities,
    update(dt) {
      live(); nonNegative(dt, 'dt');
      if (updating) throw new Error('GameplayActor.update is not reentrant');
      updating = true;
      try {
        effects.update(dt);
        if (!disposed) abilities.update(dt);
      } finally { updating = false; }
    },
    snapshot() {
      live();
      return { schemaVersion: 1, attributes: attributes.snapshot(), effects: effects.snapshot(), abilities: abilities.snapshot() };
    },
    restore(snapshot) {
      live();
      if (updating || snapshot?.schemaVersion !== 1) throw new Error('Invalid gameplay snapshot or restore during update');
      abilities.restore(snapshot.abilities);
      attributes.restore(snapshot.attributes);
      effects.restore(snapshot.effects);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cleanupAll([() => abilities.dispose(), () => effects.dispose(), () => attributes.dispose()], 'Gameplay actor disposal failed');
    },
  };
}

/** Attach to an entity to run an actor on the scene's existing fixed-step loop. */
export class GameplayComponent extends Component {
  /** @param {Omit<GameplayActorOptions, 'tags'>} [options] */
  constructor(options = {}) {
    super();
    this.#options = options;
  }
  /** @type {Omit<GameplayActorOptions, 'tags'>} */
  #options;
  /** @type {GameplayActor | null} */
  #actor = null;

  /** Access after the component has been attached to an entity. */
  get actor() {
    if (!this.entity || this._destroyed) throw new Error('GameplayComponent needs a live entity');
    return (this.#actor ??= createGameplayActor({ ...this.#options, tags: this.entity.tags }));
  }
  awake() { void this.actor; }
  /** @param {number} dt */
  fixedUpdate(dt) { this.actor.update(dt); }
  onDisable() {
    this.#actor?.abilities.clearQueue();
    this.#actor?.abilities.cancel('disabled');
  }
  onDestroy() {
    const actor = this.#actor;
    this.#actor = null;
    actor?.dispose();
  }
}
