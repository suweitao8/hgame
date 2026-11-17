/**
 * Track named actor points entering/exiting 2D or 3D AABBs using sampled world coordinates.
 * The logic uses the caller's fixed step and shares existing hierarchical entity tags.
 * @param {Record<string, TriggerVolume>} definitions
 * @param {{dimensions: 2 | 3, onEvent?: (event: TriggerEvent) => void}} options
 */
export function createTriggerVolumes(definitions: Record<string, TriggerVolume>, { dimensions, onEvent }: {
    dimensions: 2 | 3;
    onEvent?: (event: TriggerEvent) => void;
}): {
    /** @param {Iterable<TriggerSample>} samples @returns {TriggerEvent[]} */
    update(samples: Iterable<TriggerSample>): TriggerEvent[];
    /** @param {string} volume @param {string} actor */
    contains(volume: string, actor: string): boolean;
    /** @returns {string[]} */
    snapshot(): string[];
    /** Restore consumed one-shot zones and rebuild occupancy on the next sample. @param {readonly string[]} spent */
    restore(spent: readonly string[]): void;
    /** @type {(listener: (event: TriggerEvent) => void) => (() => void)} */
    subscribe(listener: (event: TriggerEvent) => void): (() => void);
    dispose(): void;
};
export type LevelPoint = readonly [number, number] | readonly [number, number, number];
export type VolumeTagQuery = {
    all?: readonly string[];
    any?: readonly string[];
    none?: readonly string[];
    exact?: boolean;
};
export type TriggerVolume = {
    min: LevelPoint;
    max: LevelPoint;
    tags?: VolumeTagQuery;
    once?: boolean;
    enterSignal?: string;
    exitSignal?: string;
};
export type TriggerSample = {
    id: string;
    position: ArrayLike<number>;
    tags?: import("../core/tags.js").TagContainer;
};
export type TriggerEvent = {
    type: "enter" | "exit";
    trigger: string;
    actor: string;
    signal?: string;
};
export type CompiledVolume = {
    id: string;
    min: number[];
    max: number[];
    tags: VolumeTagQuery;
    once: boolean;
    enterSignal?: string;
    exitSignal?: string;
};
