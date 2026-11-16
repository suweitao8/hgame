/**
 * Defines a reusable priority-layered input mapping context inspired by
 * prioritized input context stacks.
 *
 * @param {string} name Unique context name.
 * @param {InputContextOptions} [options]
 * @returns {Readonly<InputContext>}
 */
export function defineInputContext(name: string, { priority, consumesKeys, blocksLowerContexts, bufferWindow, actions, axes1D, axes2D, }?: InputContextOptions | undefined): Readonly<InputContext>;
/**
 * @typedef {object} ActionBindingConfig
 * @property {string | Iterable<string>} [keys] Keys (`KeyboardEvent.code` or `Mouse*` names) that trigger the action.
 * @property {string | Iterable<string>} [chord] Keys that must all be held for the binding to apply.
 * @property {number} [bufferWindow] Input buffer duration in seconds (default: context `bufferWindow`).
 * @property {boolean} [consumeKeys] Hide triggering keys from lower-priority contexts (default: context `consumesKeys`).
 * @property {boolean} [consumeAlways=false] Consume the keys even while not triggered.
 */
/** @typedef {string | readonly string[] | ActionBindingConfig} InputActionSpec Key, key list, or full binding config. */
/**
 * @typedef {object} Axis1DBindingConfig
 * @property {string | Iterable<string>} [positive] Keys giving +1.
 * @property {string | Iterable<string>} [negative] Keys giving -1.
 * @property {boolean} [consumeKeys]
 * @property {boolean} [consumeAlways=false]
 */
/**
 * @typedef {object} Axis2DBindingConfig
 * @property {string | Iterable<string>} [up] Keys giving +y.
 * @property {string | Iterable<string>} [down] Keys giving -y.
 * @property {string | Iterable<string>} [left] Keys giving -x.
 * @property {string | Iterable<string>} [right] Keys giving +x.
 * @property {boolean} [normalize=true] Normalize diagonals to unit length.
 * @property {boolean} [consumeKeys]
 * @property {boolean} [consumeAlways=false]
 */
/**
 * @typedef {object} InputContextOptions
 * @property {number} [priority=0] Higher priority contexts are evaluated first (finite).
 * @property {boolean} [consumesKeys=true] Default key consumption for bindings.
 * @property {boolean} [blocksLowerContexts=false] Modal: stop evaluating lower-priority contexts.
 * @property {number} [bufferWindow=0] Default input-buffer duration, seconds (>= 0).
 * @property {Record<string, InputActionSpec>} [actions] Action name -> binding.
 * @property {Record<string, Axis1DBindingConfig>} [axes1D] Axis name -> binding.
 * @property {Record<string, Axis2DBindingConfig>} [axes2D] Axis name -> binding.
 */
/**
 * @typedef {object} ResolvedActionBinding
 * @property {string[]} keys
 * @property {string[]} chord
 * @property {number} bufferWindow Seconds.
 * @property {boolean} consumeKeys
 * @property {boolean} consumeAlways
 */
/**
 * @typedef {object} ResolvedAxis1DBinding
 * @property {string[]} positive
 * @property {string[]} negative
 * @property {boolean} consumeKeys
 * @property {boolean} consumeAlways
 */
/**
 * @typedef {object} ResolvedAxis2DBinding
 * @property {string[]} up
 * @property {string[]} down
 * @property {string[]} left
 * @property {string[]} right
 * @property {boolean} normalize
 * @property {boolean} consumeKeys
 * @property {boolean} consumeAlways
 */
/**
 * @typedef {object} InputContext Immutable, normalized input mapping context.
 * @property {string} name
 * @property {number} priority
 * @property {boolean} consumesKeys
 * @property {boolean} blocksLowerContexts
 * @property {number} bufferWindow Seconds.
 * @property {Record<string, ResolvedActionBinding>} actions
 * @property {Record<string, ResolvedAxis1DBinding>} axes1D
 * @property {Record<string, ResolvedAxis2DBinding>} axes2D
 */
/** Pointer button name -> `PointerEvent.buttons` bit. @type {Readonly<Record<string, number>>} */
export const MOUSE_BUTTON_MASK: Readonly<Record<string, number>>;
export type ActionBindingConfig = {
    /**
     * Keys (`KeyboardEvent.code` or `Mouse*` names) that trigger the action.
     */
    keys?: string | Iterable<string> | undefined;
    /**
     * Keys that must all be held for the binding to apply.
     */
    chord?: string | Iterable<string> | undefined;
    /**
     * Input buffer duration in seconds (default: context `bufferWindow`).
     */
    bufferWindow?: number | undefined;
    /**
     * Hide triggering keys from lower-priority contexts (default: context `consumesKeys`).
     */
    consumeKeys?: boolean | undefined;
    /**
     * Consume the keys even while not triggered.
     */
    consumeAlways?: boolean | undefined;
};
/**
 * Key, key list, or full binding config.
 */
export type InputActionSpec = string | readonly string[] | ActionBindingConfig;
export type Axis1DBindingConfig = {
    /**
     * Keys giving +1.
     */
    positive?: string | Iterable<string> | undefined;
    /**
     * Keys giving -1.
     */
    negative?: string | Iterable<string> | undefined;
    consumeKeys?: boolean | undefined;
    consumeAlways?: boolean | undefined;
};
export type Axis2DBindingConfig = {
    /**
     * Keys giving +y.
     */
    up?: string | Iterable<string> | undefined;
    /**
     * Keys giving -y.
     */
    down?: string | Iterable<string> | undefined;
    /**
     * Keys giving -x.
     */
    left?: string | Iterable<string> | undefined;
    /**
     * Keys giving +x.
     */
    right?: string | Iterable<string> | undefined;
    /**
     * Normalize diagonals to unit length.
     */
    normalize?: boolean | undefined;
    consumeKeys?: boolean | undefined;
    consumeAlways?: boolean | undefined;
};
export type InputContextOptions = {
    /**
     * Higher priority contexts are evaluated first (finite).
     */
    priority?: number | undefined;
    /**
     * Default key consumption for bindings.
     */
    consumesKeys?: boolean | undefined;
    /**
     * Modal: stop evaluating lower-priority contexts.
     */
    blocksLowerContexts?: boolean | undefined;
    /**
     * Default input-buffer duration, seconds (>= 0).
     */
    bufferWindow?: number | undefined;
    /**
     * Action name -> binding.
     */
    actions?: Record<string, InputActionSpec> | undefined;
    /**
     * Axis name -> binding.
     */
    axes1D?: Record<string, Axis1DBindingConfig> | undefined;
    /**
     * Axis name -> binding.
     */
    axes2D?: Record<string, Axis2DBindingConfig> | undefined;
};
export type ResolvedActionBinding = {
    keys: string[];
    chord: string[];
    /**
     * Seconds.
     */
    bufferWindow: number;
    consumeKeys: boolean;
    consumeAlways: boolean;
};
export type ResolvedAxis1DBinding = {
    positive: string[];
    negative: string[];
    consumeKeys: boolean;
    consumeAlways: boolean;
};
export type ResolvedAxis2DBinding = {
    up: string[];
    down: string[];
    left: string[];
    right: string[];
    normalize: boolean;
    consumeKeys: boolean;
    consumeAlways: boolean;
};
/**
 * Immutable, normalized input mapping context.
 */
export type InputContext = {
    name: string;
    priority: number;
    consumesKeys: boolean;
    blocksLowerContexts: boolean;
    /**
     * Seconds.
     */
    bufferWindow: number;
    actions: Record<string, ResolvedActionBinding>;
    axes1D: Record<string, ResolvedAxis1DBinding>;
    axes2D: Record<string, ResolvedAxis2DBinding>;
};
