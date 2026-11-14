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
export const MOUSE_BUTTON_MASK = Object.freeze({
  Mouse0: 1,
  MouseLeft: 1,
  Mouse1: 4,
  MouseMiddle: 4,
  Mouse2: 2,
  MouseRight: 2,
  Mouse3: 8,
  Mouse4: 16,
});

/** @param {string | Iterable<string> | null | undefined} keys @returns {string[]} */
function normalizeKeyList(keys) {
  if (!keys) return [];
  if (typeof keys === 'string') return [keys];
  return [...keys].filter(k => typeof k === 'string' && k.length > 0);
}

/** @param {InputActionSpec} spec @param {{ consumesKeys: boolean, bufferWindow: number }} contextDefaults @returns {ResolvedActionBinding} */
function normalizeActionBinding(spec, contextDefaults) {
  if (typeof spec === 'string' || Array.isArray(spec)) {
    return {
      keys: normalizeKeyList(spec),
      chord: [],
      bufferWindow: contextDefaults.bufferWindow,
      consumeKeys: contextDefaults.consumesKeys,
      consumeAlways: false,
    };
  }
  if (!spec || typeof spec !== 'object') {
    throw new TypeError('Action binding must be a key string, key array, or config object');
  }
  const bufferWindow = spec.bufferWindow !== undefined ? Number(spec.bufferWindow) : contextDefaults.bufferWindow;
  if (!Number.isFinite(bufferWindow) || bufferWindow < 0) {
    throw new RangeError('Action binding bufferWindow must be >= 0');
  }
  return {
    keys: normalizeKeyList(spec.keys),
    chord: normalizeKeyList(spec.chord),
    bufferWindow,
    consumeKeys: spec.consumeKeys !== undefined ? Boolean(spec.consumeKeys) : contextDefaults.consumesKeys,
    consumeAlways: Boolean(spec.consumeAlways),
  };
}

/** @param {Axis1DBindingConfig} spec @param {{ consumesKeys: boolean }} contextDefaults @returns {ResolvedAxis1DBinding} */
function normalizeAxis1DBinding(spec, contextDefaults) {
  if (!spec || typeof spec !== 'object') {
    throw new TypeError('Axis1D binding must be a config object');
  }
  return {
    positive: normalizeKeyList(spec.positive),
    negative: normalizeKeyList(spec.negative),
    consumeKeys: spec.consumeKeys !== undefined ? Boolean(spec.consumeKeys) : contextDefaults.consumesKeys,
    consumeAlways: Boolean(spec.consumeAlways),
  };
}

/** @param {Axis2DBindingConfig} spec @param {{ consumesKeys: boolean }} contextDefaults @returns {ResolvedAxis2DBinding} */
function normalizeAxis2DBinding(spec, contextDefaults) {
  if (!spec || typeof spec !== 'object') {
    throw new TypeError('Axis2D binding must be a config object');
  }
  return {
    up: normalizeKeyList(spec.up),
    down: normalizeKeyList(spec.down),
    left: normalizeKeyList(spec.left),
    right: normalizeKeyList(spec.right),
    normalize: spec.normalize !== false,
    consumeKeys: spec.consumeKeys !== undefined ? Boolean(spec.consumeKeys) : contextDefaults.consumesKeys,
    consumeAlways: Boolean(spec.consumeAlways),
  };
}

/**
 * Defines a reusable priority-layered input mapping context inspired by
 * prioritized input context stacks.
 *
 * @param {string} name Unique context name.
 * @param {InputContextOptions} [options]
 * @returns {Readonly<InputContext>}
 */
export function defineInputContext(name, {
  priority = 0,
  consumesKeys = true,
  blocksLowerContexts = false,
  bufferWindow = 0,
  actions = {},
  axes1D = {},
  axes2D = {},
} = {}) {
  if (typeof name !== 'string' || !name) {
    throw new TypeError('Input context requires a non-empty string name');
  }
  if (!Number.isFinite(priority)) {
    throw new RangeError('Input context priority must be finite');
  }
  if (!Number.isFinite(bufferWindow) || bufferWindow < 0) {
    throw new RangeError('Input context bufferWindow must be >= 0');
  }
  const defaults = { consumesKeys: Boolean(consumesKeys), bufferWindow };
  /** @type {Record<string, ResolvedActionBinding>} */
  const normalizedActions = Object.create(null);
  for (const [actionName, spec] of Object.entries(actions)) {
    normalizedActions[actionName] = normalizeActionBinding(spec, defaults);
  }
  /** @type {Record<string, ResolvedAxis1DBinding>} */
  const normalizedAxes1D = Object.create(null);
  for (const [axisName, spec] of Object.entries(axes1D)) {
    normalizedAxes1D[axisName] = normalizeAxis1DBinding(spec, defaults);
  }
  /** @type {Record<string, ResolvedAxis2DBinding>} */
  const normalizedAxes2D = Object.create(null);
  for (const [axisName, spec] of Object.entries(axes2D)) {
    normalizedAxes2D[axisName] = normalizeAxis2DBinding(spec, defaults);
  }
  return Object.freeze({
    name,
    priority,
    consumesKeys: Boolean(consumesKeys),
    blocksLowerContexts: Boolean(blocksLowerContexts),
    bufferWindow,
    actions: normalizedActions,
    axes1D: normalizedAxes1D,
    axes2D: normalizedAxes2D,
  });
}
