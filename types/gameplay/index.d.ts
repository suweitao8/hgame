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
export function createGameplayActor(options?: GameplayActorOptions | undefined): GameplayActor;
export { createAttributeSet } from "./attributes.js";
export { createEffectController } from "./effects.js";
export { createAbilitySystem } from "./abilities.js";
/** Attach to an entity to run an actor on the scene's existing fixed-step loop. */
export class GameplayComponent extends Component {
    /** @param {Omit<GameplayActorOptions, 'tags'>} [options] */
    constructor(options?: Omit<GameplayActorOptions, "tags"> | undefined);
    /** Access after the component has been attached to an entity. */
    get actor(): GameplayActor;
    /** @param {number} dt */
    fixedUpdate(dt: number): void;
    #private;
}
export type GameplayActorOptions = {
    attributes?: Record<string, number | import("./attributes.js").AttributeDefinition> | undefined;
    /**
     * Optional shared tag container. The actor only removes its own grants.
     */
    tags?: import("../core/tags.js").TagContainer | undefined;
    effects?: Record<string, import("./effects.js").EffectDefinition> | undefined;
    abilities?: Record<string, import("./abilities.js").AbilityDefinition> | undefined;
    maxEffects?: number | undefined;
    execute?: ((context: import("./abilities.js").AbilityExecution) => void) | undefined;
    onAttributeChange?: ((event: import("./attributes.js").AttributeChange) => void) | undefined;
    onEffect?: ((event: import("./effects.js").EffectEvent) => void) | undefined;
    onAbility?: ((event: import("./abilities.js").AbilityEvent) => void) | undefined;
    onTimeline?: ((event: import("./abilities.js").AbilityTimelineEvent) => void) | undefined;
};
export type GameplayActorSnapshot = {
    schemaVersion: 1;
    attributes: Record<string, number>;
    effects: import("./effects.js").EffectSnapshot;
    abilities: import("./abilities.js").AbilitySnapshot;
};
export type GameplayActor = {
    attributes: import("./attributes.js").AttributeSet;
    tags: import("../core/tags.js").TagContainer;
    effects: import("./effects.js").EffectController;
    abilities: import("./abilities.js").AbilitySystem;
    /**
     * Effects resolve before abilities each simulation step.
     */
    update: (dt: number) => void;
    snapshot: () => GameplayActorSnapshot;
    /**
     * Use the same versioned definitions as the saved actor.
     */
    restore: (snapshot: GameplayActorSnapshot) => void;
    dispose: () => void;
};
import { Component } from '../core/component.js';
