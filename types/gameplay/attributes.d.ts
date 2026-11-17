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
export function createAttributeSet(definitions?: Record<string, number | AttributeDefinition> | undefined, { onChange }?: {
    onChange?: (event: AttributeChange) => void;
} | undefined): AttributeSet;
export type AttributeDefinition = {
    base: number;
    min?: number | string;
    max?: number | string;
};
export type AttributeModifier = {
    attribute: string;
    operation?: "add" | "percent" | "multiply";
    value: number;
};
export type AttributeChange = {
    type: "base" | "modifiers" | "restore";
    attribute?: string;
    source?: string;
};
export type AttributeSet = {
    has: (name: string) => boolean;
    /**
     * Effective, bounded value.
     */
    get: (name: string) => number;
    /**
     * Unmodified base value.
     */
    getBase: (name: string) => number;
    setBase: (name: string, value: number) => number;
    addBase: (name: string, delta: number) => number;
    /**
     * Change the base to obtain an effective value; false for a zero/negative multiplier.
     */
    setValue: (name: string, value: number) => boolean;
    change: (name: string, delta: number) => boolean;
    /**
     * Replace one source's modifiers.
     */
    setModifiers: (source: string, modifiers: readonly AttributeModifier[]) => void;
    removeModifiers: (source: string) => boolean;
    canSpend: (costs: Record<string, number>) => boolean;
    /**
     * Atomically subtract non-negative effective resource costs.
     */
    spend: (costs: Record<string, number>) => boolean;
    values: () => Record<string, number>;
    /**
     * Base values only; equipment and effects own their modifiers.
     */
    snapshot: () => Record<string, number>;
    restore: (values: Record<string, number>) => void;
    subscribe: (listener: (event: AttributeChange) => void) => (() => void);
    dispose: () => void;
};
