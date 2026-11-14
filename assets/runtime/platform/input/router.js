import { MOUSE_BUTTON_MASK } from './contexts.js';

/**
 * @typedef {object} Vec2Like
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {object} InputActionRouterOptions
 * @property {import('./manager.js').InputManager | null} [input] Source of key / pointer state.
 * @property {((code: string) => boolean) | null} [readCode] Extra key reader (e.g. virtual buttons); OR-ed with `input`.
 */

/**
 * @typedef {object} PushContextOptions
 * @property {boolean} [enabled=true]
 * @property {number} [priority] Override the context priority.
 */

/**
 * @typedef {object} InputContextEntry
 * @property {import('./contexts.js').InputContext} context
 * @property {number} priority
 * @property {boolean} enabled
 * @property {number} order Insertion order tie-breaker (later wins).
 */

/**
 * @typedef {object} InputActionRouter Priority-ordered action / axis router.
 * @property {(context: import('./contexts.js').InputContext, options?: PushContextOptions) => InputContextEntry} pushContext Add or replace a context by name.
 * @property {(nameOrContext: string | { name: string }) => boolean} removeContext
 * @property {(name: string, enabled: boolean) => boolean} setContextEnabled
 * @property {(name: string, options?: { enabledOnly?: boolean }) => boolean} hasContext
 * @property {() => { name: string, priority: number, enabled: boolean }[]} listContexts
 * @property {() => void} clearContexts
 * @property {(actionName: string, down: boolean) => boolean} setVirtualAction Drive an action from touch UI.
 * @property {(axisName: string, value: number) => number} setVirtualAxis1D Clamped to -1..1; returns the applied value.
 * @property {(axisName: string, x?: number, y?: number) => Vec2Like} setVirtualAxis2D Clamped to unit length; returns the applied vector.
 * @property {() => void} clearVirtualInputs
 * @property {(dtSeconds?: number) => void} update Evaluate bindings once per tick (seconds).
 * @property {(action: string) => boolean} isDown
 * @property {(action: string) => boolean} wasPressed
 * @property {(action: string) => boolean} wasReleased
 * @property {(action: string) => number} heldSeconds Seconds the action has been held.
 * @property {(action: string, minSeconds?: number) => boolean} isHeld
 * @property {(action: string) => boolean} isBuffered Press still inside its buffer window.
 * @property {(action: string) => boolean} consumeBuffered Consume the buffered press; true if one was pending.
 * @property {(axisName: string) => number} getAxis1D
 * @property {<T extends Vec2Like = Vec2Like>(axisName: string, out?: T) => T} getAxis2D
 * @property {() => void} reset
 */

/**
 * Priority-ordered input action & axis router supporting key consumption across
 * layered contexts, chorded bindings, hold timers, and input buffering.
 *
 * @param {InputActionRouterOptions} [options]
 * @returns {InputActionRouter}
 */
export function createInputActionRouter({ input = null, readCode = null } = {}) {
  let orderCounter = 0;
  /** @type {InputContextEntry[]} */
  const stack = [];
  /** @type {Map<string, { down: boolean, pressed: boolean, released: boolean, heldSeconds: number, bufferRemaining: number }>} */
  const actionStates = new Map();
  /** @type {Map<string, number>} */
  const axis1DStates = new Map();
  /** @type {Map<string, { x: number, y: number }>} */
  const axis2DStates = new Map();
  /** @type {Map<string, boolean>} */
  const virtualActions = new Map();
  /** @type {Map<string, number>} */
  const virtualAxes1D = new Map();
  /** @type {Map<string, Vec2Like>} */
  const virtualAxes2D = new Map();
  /** @type {Set<string>} */
  const consumedKeys = new Set();
  /** @type {Set<string>} */
  const seenActionsThisFrame = new Set();
  /** @type {Set<string>} */
  const seenAxes1DThisFrame = new Set();
  /** @type {Set<string>} */
  const seenAxes2DThisFrame = new Set();

  function sortStack() {
    stack.sort((a, b) => (b.priority - a.priority) || (b.order - a.order));
  }

  /** @param {string} code @returns {boolean} */
  function defaultReadCode(code) {
    if (readCode && readCode(code)) return true;
    const mask = MOUSE_BUTTON_MASK[code];
    if (mask !== undefined) {
      return ((input?.pointer?.buttons ?? 0) & mask) !== 0;
    }
    return Boolean(input?.isDown?.(code));
  }

  /** @param {string} code @returns {boolean} */
  function isKeyActive(code) {
    if (consumedKeys.has(code)) return false;
    return defaultReadCode(code);
  }

  function getOrCreateActionState(name) {
    let state = actionStates.get(name);
    if (!state) {
      state = { down: false, pressed: false, released: false, heldSeconds: 0, bufferRemaining: 0 };
      actionStates.set(name, state);
    }
    return state;
  }

  /** @param {import('./contexts.js').InputContext} context @param {PushContextOptions} [options] @returns {InputContextEntry} */
  function pushContext(context, { enabled = true, priority = undefined } = {}) {
    const resolved = context;
    if (!resolved || typeof resolved.name !== 'string') {
      throw new TypeError('pushContext requires a context created by defineInputContext');
    }
    const existingIdx = stack.findIndex(item => item.context.name === resolved.name);
    const resolvedPriority = priority !== undefined ? priority : resolved.priority;
    if (!Number.isFinite(resolvedPriority)) {
      throw new RangeError('Context priority must be finite');
    }
    const entry = {
      context: resolved,
      priority: resolvedPriority,
      enabled: Boolean(enabled),
      order: ++orderCounter,
    };
    if (existingIdx !== -1) {
      stack[existingIdx] = entry;
    } else {
      stack.push(entry);
    }
    sortStack();
    return entry;
  }

  /** @param {string | { name: string }} nameOrContext @returns {boolean} */
  function removeContext(nameOrContext) {
    const targetName = typeof nameOrContext === 'string' ? nameOrContext : nameOrContext?.name;
    const idx = stack.findIndex(item => item.context.name === targetName);
    if (idx === -1) return false;
    stack.splice(idx, 1);
    return true;
  }

  /** @param {string} name @param {boolean} enabled @returns {boolean} */
  function setContextEnabled(name, enabled) {
    const entry = stack.find(item => item.context.name === name);
    if (!entry) return false;
    entry.enabled = Boolean(enabled);
    return true;
  }

  /** @param {string} name @param {{ enabledOnly?: boolean }} [options] @returns {boolean} */
  function hasContext(name, { enabledOnly = false } = {}) {
    const entry = stack.find(item => item.context.name === name);
    if (!entry) return false;
    return enabledOnly ? entry.enabled : true;
  }

  function clearContexts() {
    stack.length = 0;
  }

  /** @param {number} [dt] Seconds. @returns {void} */
  function update(dt = 0) {
    const delta = Number.isFinite(dt) && dt > 0 ? dt : 0;
    consumedKeys.clear();
    seenActionsThisFrame.clear();
    seenAxes1DThisFrame.clear();
    seenAxes2DThisFrame.clear();

    // Advance buffer timers first so fresh presses receive full buffer duration this frame.
    for (const state of actionStates.values()) {
      if (state.bufferRemaining > 0) {
        state.bufferRemaining = Math.max(0, state.bufferRemaining - delta);
      }
      state.pressed = false;
      state.released = false;
    }

    const activeActionDown = new Map();
    const activeActionBuffers = new Map();
    const activeAxes1D = new Map();
    const activeAxes2D = new Map();
    let blockedByModal = false;

    for (let i = 0; i < stack.length; i++) {
      const entry = stack[i];
      if (!entry.enabled) continue;
      const ctx = entry.context;

      // Actions
      for (const [actionName, binding] of Object.entries(ctx.actions)) {
        let chordSatisfied = true;
        for (let c = 0; c < binding.chord.length; c++) {
          if (!isKeyActive(binding.chord[c])) {
            chordSatisfied = false;
            break;
          }
        }

        let triggered = false;
        if (chordSatisfied) {
          for (let k = 0; k < binding.keys.length; k++) {
            const key = binding.keys[k];
            if (isKeyActive(key)) {
              triggered = true;
              if (binding.consumeKeys) consumedKeys.add(key);
            }
          }
        }
        if (!triggered && virtualActions.get(actionName) === true) {
          triggered = true;
        }
        if (binding.consumeAlways) {
          for (let k = 0; k < binding.keys.length; k++) {
            consumedKeys.add(binding.keys[k]);
          }
        }

        if (!seenActionsThisFrame.has(actionName)) {
          seenActionsThisFrame.add(actionName);
          activeActionDown.set(actionName, triggered);
          activeActionBuffers.set(actionName, binding.bufferWindow);
        } else if (triggered) {
          activeActionDown.set(actionName, true);
          if (binding.bufferWindow > (activeActionBuffers.get(actionName) ?? 0)) {
            activeActionBuffers.set(actionName, binding.bufferWindow);
          }
        }
      }

      // 1D Axes
      for (const [axisName, binding] of Object.entries(ctx.axes1D)) {
        if (!seenAxes1DThisFrame.has(axisName)) {
          seenAxes1DThisFrame.add(axisName);
          let pos = false;
          let neg = false;
          for (let k = 0; k < binding.positive.length; k++) {
            const key = binding.positive[k];
            if (isKeyActive(key)) {
              pos = true;
              if (binding.consumeKeys) consumedKeys.add(key);
            } else if (binding.consumeAlways) {
              consumedKeys.add(key);
            }
          }
          for (let k = 0; k < binding.negative.length; k++) {
            const key = binding.negative[k];
            if (isKeyActive(key)) {
              neg = true;
              if (binding.consumeKeys) consumedKeys.add(key);
            } else if (binding.consumeAlways) {
              consumedKeys.add(key);
            }
          }
          const kbVal = (pos ? 1 : 0) - (neg ? 1 : 0);
          const vVal = virtualAxes1D.get(axisName);
          const val = (vVal !== undefined && Math.abs(vVal) > Math.abs(kbVal)) ? vVal : kbVal;
          activeAxes1D.set(axisName, val);
        } else if (binding.consumeAlways) {
          for (const key of binding.positive) consumedKeys.add(key);
          for (const key of binding.negative) consumedKeys.add(key);
        }
      }

      // 2D Axes
      for (const [axisName, binding] of Object.entries(ctx.axes2D)) {
        if (!seenAxes2DThisFrame.has(axisName)) {
          seenAxes2DThisFrame.add(axisName);
          let up = false, downKey = false, left = false, right = false;
          for (const key of binding.up) {
            if (isKeyActive(key)) { up = true; if (binding.consumeKeys) consumedKeys.add(key); }
            else if (binding.consumeAlways) consumedKeys.add(key);
          }
          for (const key of binding.down) {
            if (isKeyActive(key)) { downKey = true; if (binding.consumeKeys) consumedKeys.add(key); }
            else if (binding.consumeAlways) consumedKeys.add(key);
          }
          for (const key of binding.left) {
            if (isKeyActive(key)) { left = true; if (binding.consumeKeys) consumedKeys.add(key); }
            else if (binding.consumeAlways) consumedKeys.add(key);
          }
          for (const key of binding.right) {
            if (isKeyActive(key)) { right = true; if (binding.consumeKeys) consumedKeys.add(key); }
            else if (binding.consumeAlways) consumedKeys.add(key);
          }
          let x = (right ? 1 : 0) - (left ? 1 : 0);
          let y = (up ? 1 : 0) - (downKey ? 1 : 0);
          if (binding.normalize && x !== 0 && y !== 0) {
            const inv = 1 / Math.hypot(x, y);
            x *= inv;
            y *= inv;
          }
          const vVec = virtualAxes2D.get(axisName);
          if (vVec) {
            const kbMag = Math.hypot(x, y);
            const vMag = Math.hypot(vVec.x, vVec.y);
            if (kbMag === 0 || vMag > kbMag) {
              x = vVec.x;
              y = vVec.y;
            }
          }
          activeAxes2D.set(axisName, { x, y });
        } else if (binding.consumeAlways) {
          for (const key of binding.up) consumedKeys.add(key);
          for (const key of binding.down) consumedKeys.add(key);
          for (const key of binding.left) consumedKeys.add(key);
          for (const key of binding.right) consumedKeys.add(key);
        }
      }

      if (ctx.blocksLowerContexts) {
        blockedByModal = true;
        break;
      }
    }

    if (!blockedByModal) {
      for (const [actionName, vDown] of virtualActions.entries()) {
        if (vDown && !seenActionsThisFrame.has(actionName)) {
          activeActionDown.set(actionName, true);
        }
      }
      for (const [axisName, vVal] of virtualAxes1D.entries()) {
        if (!seenAxes1DThisFrame.has(axisName)) {
          activeAxes1D.set(axisName, vVal);
        }
      }
      for (const [axisName, vVec] of virtualAxes2D.entries()) {
        if (!seenAxes2DThisFrame.has(axisName)) {
          activeAxes2D.set(axisName, { x: vVec.x, y: vVec.y });
        }
      }
    }

    // Reconcile action state transitions cleanly (including actions whose contexts were disabled/removed).
    for (const [name, state] of actionStates.entries()) {
      const nextDown = activeActionDown.get(name) ?? false;
      const wasDown = state.down;
      state.pressed = nextDown && !wasDown;
      state.released = !nextDown && wasDown;
      state.down = nextDown;
      if (nextDown) {
        state.heldSeconds = state.pressed ? 0 : state.heldSeconds + delta;
        if (state.pressed) {
          const win = activeActionBuffers.get(name) ?? 0;
          if (win > state.bufferRemaining) state.bufferRemaining = win;
        }
      } else {
        state.heldSeconds = 0;
      }
      activeActionDown.delete(name);
    }

    for (const [name, nextDown] of activeActionDown.entries()) {
      const state = getOrCreateActionState(name);
      state.down = nextDown;
      state.pressed = nextDown;
      state.released = false;
      state.heldSeconds = 0;
      if (nextDown) {
        const win = activeActionBuffers.get(name) ?? 0;
        if (win > state.bufferRemaining) state.bufferRemaining = win;
      }
    }

    axis1DStates.clear();
    for (const [name, val] of activeAxes1D.entries()) axis1DStates.set(name, val);

    for (const [name, vec] of axis2DStates.entries()) {
      if (!activeAxes2D.has(name)) {
        vec.x = 0;
        vec.y = 0;
      }
    }
    for (const [name, next] of activeAxes2D.entries()) {
      const existing = axis2DStates.get(name);
      if (existing) {
        existing.x = next.x;
        existing.y = next.y;
      } else {
        axis2DStates.set(name, { x: next.x, y: next.y });
      }
    }
  }

  /** @param {string} actionName @param {boolean} down @returns {boolean} */
  function setVirtualAction(actionName, down) {
    if (typeof actionName !== 'string' || !actionName) return false;
    if (down) {
      virtualActions.set(actionName, true);
      return true;
    }
    virtualActions.delete(actionName);
    return false;
  }

  /** @param {string} axisName @param {number} value @returns {number} */
  function setVirtualAxis1D(axisName, value) {
    if (typeof axisName !== 'string' || !axisName) return 0;
    const v = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    if (v === 0) virtualAxes1D.delete(axisName);
    else virtualAxes1D.set(axisName, v);
    return v;
  }

  /** @param {string} axisName @param {number} [x] @param {number} [y] @returns {Vec2Like} */
  function setVirtualAxis2D(axisName, x = 0, y = 0) {
    if (typeof axisName !== 'string' || !axisName) return { x: 0, y: 0 };
    let vx = Number.isFinite(x) ? x : 0;
    let vy = Number.isFinite(y) ? y : 0;
    const mag = Math.hypot(vx, vy);
    if (mag > 1) {
      vx /= mag;
      vy /= mag;
    }
    if (vx === 0 && vy === 0) virtualAxes2D.delete(axisName);
    else virtualAxes2D.set(axisName, { x: vx, y: vy });
    return { x: vx, y: vy };
  }

  function clearVirtualInputs() {
    virtualActions.clear();
    virtualAxes1D.clear();
    virtualAxes2D.clear();
  }

  function isDown(action) {
    return actionStates.get(action)?.down ?? false;
  }

  function wasPressed(action) {
    return actionStates.get(action)?.pressed ?? false;
  }

  function wasReleased(action) {
    return actionStates.get(action)?.released ?? false;
  }

  function heldSeconds(action) {
    return actionStates.get(action)?.heldSeconds ?? 0;
  }

  function isHeld(action, minSeconds = 0) {
    const state = actionStates.get(action);
    return Boolean(state && state.down && state.heldSeconds >= minSeconds);
  }

  function isBuffered(action) {
    return (actionStates.get(action)?.bufferRemaining ?? 0) > 0;
  }

  function consumeBuffered(action) {
    const state = actionStates.get(action);
    if (!state || state.bufferRemaining <= 0) return false;
    state.bufferRemaining = 0;
    return true;
  }

  function getAxis1D(name) {
    return axis1DStates.get(name) ?? 0;
  }

  /** @template {Vec2Like} [T=Vec2Like] @param {string} name @param {T} [out] @returns {T} */
  function getAxis2D(name, out = { x: 0, y: 0 }) {
    const vec = axis2DStates.get(name);
    out.x = vec ? vec.x : 0;
    out.y = vec ? vec.y : 0;
    return out;
  }

  /** @returns {{ name: string, priority: number, enabled: boolean }[]} */
  function listContexts() {
    return stack.map(entry => ({
      name: entry.context.name,
      priority: entry.priority,
      enabled: entry.enabled,
    }));
  }

  function reset() {
    consumedKeys.clear();
    clearVirtualInputs();
    for (const state of actionStates.values()) {
      state.down = false;
      state.pressed = false;
      state.released = false;
      state.heldSeconds = 0;
      state.bufferRemaining = 0;
    }
    axis1DStates.clear();
    for (const vec of axis2DStates.values()) {
      vec.x = 0;
      vec.y = 0;
    }
  }

  return Object.freeze({
    pushContext,
    removeContext,
    setContextEnabled,
    hasContext,
    listContexts,
    clearContexts,
    setVirtualAction,
    setVirtualAxis1D,
    setVirtualAxis2D,
    clearVirtualInputs,
    update,
    isDown,
    wasPressed,
    wasReleased,
    heldSeconds,
    isHeld,
    isBuffered,
    consumeBuffered,
    getAxis1D,
    getAxis2D,
    reset,
  });
}
