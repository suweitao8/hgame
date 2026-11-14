import { createEmitter } from './events.js';

function isEditable(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName || '');
}

function pointerButtonMask(button) {
  if (button === 0) return 1;
  if (button === 1) return 4;
  if (button === 2) return 2;
  return button >= 3 && button < 31 ? (1 << button) : 0;
}

export function createInputManager({
  target = globalThis.window,
  focused = true,
  preventDefaultKeys = [],
} = {}) {
  const events = createEmitter();
  const down = new Set();
  const pressed = new Set();
  const released = new Set();
  const prevented = new Set(preventDefaultKeys);
  const activePointers = new Map();
  const pointerPressedButtons = new Set();
  const pointerReleasedButtons = new Set();
  let active = Boolean(focused);
  let pointer = { x: 0, y: 0, buttons: 0, id: null };

  function onKeyDown(event) {
    if (!active || isEditable(event.target) || !event.code) return;
    const wasDown = down.has(event.code);
    down.add(event.code);
    if (!wasDown) pressed.add(event.code);
    if (prevented.has(event.code)) event.preventDefault?.();
    events.emit('keydown', { code: event.code, repeat: Boolean(event.repeat), originalEvent: event });
  }

  function onKeyUp(event) {
    if (!active || !event.code) return;
    if (down.delete(event.code)) released.add(event.code);
    events.emit('keyup', { code: event.code, originalEvent: event });
  }

  function onPointerMove(event) {
    if (!active) return;
    const x = Number(event.clientX) || 0;
    const y = Number(event.clientY) || 0;
    const buttons = event.buttons !== undefined ? (Number(event.buttons) || 0) : pointer.buttons;
    pointer = { ...pointer, x, y, buttons };
    const id = event.pointerId ?? 'mouse';
    const cur = activePointers.get(id);
    if (cur) {
      cur.prevX = cur.x;
      cur.prevY = cur.y;
      cur.dx += x - cur.x;
      cur.dy += y - cur.y;
      cur.x = x;
      cur.y = y;
      if (event.buttons !== undefined) cur.buttons = Number(event.buttons) || 0;
    }
    events.emit('pointermove', { ...pointer, pointerType: event.pointerType || cur?.pointerType || 'mouse', originalEvent: event });
  }

  function onPointerDown(event) {
    if (!active) return;
    const x = Number(event.clientX) || 0;
    const y = Number(event.clientY) || 0;
    const id = event.pointerId ?? 'mouse';
    const pointerType = event.pointerType || 'mouse';
    const button = Number.isInteger(event.button) ? event.button : 0;
    const rawButtons = Number(event.buttons) || 0;
    const buttons = rawButtons || pointerButtonMask(button);
    pointer = { x, y, buttons: rawButtons || buttons, id: event.pointerId ?? null };
    activePointers.set(id, {
      id,
      x,
      y,
      startX: x,
      startY: y,
      prevX: x,
      prevY: y,
      dx: 0,
      dy: 0,
      pointerType,
      button,
      buttons,
    });
    pointerPressedButtons.add(button);
    if (pointerType === 'touch' || pointerType === 'pen') pointerPressedButtons.add(0);
    events.emit('pointerdown', { ...pointer, pointerType, button, originalEvent: event });
  }

  function finishPointer(event, eventName) {
    if (!active) return;
    const x = Number(event.clientX) || 0;
    const y = Number(event.clientY) || 0;
    const id = event.pointerId ?? 'mouse';
    const cur = activePointers.get(id);
    const pointerType = event.pointerType || cur?.pointerType || 'mouse';
    const button = Number.isInteger(event.button) ? event.button : (cur?.button ?? 0);
    activePointers.delete(id);
    pointerReleasedButtons.add(button);
    if (pointerType === 'touch' || pointerType === 'pen') pointerReleasedButtons.add(0);
    const remainingButtons = activePointers.size === 0
      ? 0
      : (event.buttons !== undefined ? (Number(event.buttons) || 0) : pointer.buttons);
    pointer = {
      ...pointer,
      x,
      y,
      buttons: remainingButtons,
      id: activePointers.size === 0 ? null : pointer.id,
    };
    events.emit(eventName, { ...pointer, pointerType, button, originalEvent: event });
  }

  function onPointerUp(event) {
    finishPointer(event, 'pointerup');
  }

  function onPointerCancel(event) {
    finishPointer(event, 'pointercancel');
  }

  function reset() {
    for (const code of down) released.add(code);
    down.clear();
    activePointers.clear();
    pointerPressedButtons.clear();
    pointerReleasedButtons.clear();
    pointer = { ...pointer, buttons: 0, id: null };
  }

  function setFocused(value) {
    const next = Boolean(value);
    if (active === next) return false;
    active = next;
    if (!active) reset();
    events.emit('focus', active);
    return true;
  }

  function isPointerDown(button = 0) {
    const mask = pointerButtonMask(button);
    if (button === 0) {
      for (const p of activePointers.values()) {
        if (p.pointerType === 'touch' || p.pointerType === 'pen') return true;
        if ((p.buttons & mask) !== 0) return true;
      }
      return (pointer.buttons & mask) !== 0;
    }
    for (const p of activePointers.values()) {
      if ((p.buttons & mask) !== 0) return true;
    }
    return (pointer.buttons & mask) !== 0;
  }

  function preventKeys(codes) {
    if (typeof codes === 'string') {
      if (codes) prevented.add(codes);
      return prevented.size;
    }
    if (codes && typeof codes[Symbol.iterator] === 'function') {
      for (const code of codes) {
        if (typeof code === 'string' && code) prevented.add(code);
      }
    }
    return prevented.size;
  }

  target?.addEventListener?.('keydown', onKeyDown);
  target?.addEventListener?.('keyup', onKeyUp);
  target?.addEventListener?.('pointermove', onPointerMove);
  target?.addEventListener?.('pointerdown', onPointerDown);
  target?.addEventListener?.('pointerup', onPointerUp);
  target?.addEventListener?.('pointercancel', onPointerCancel);
  target?.addEventListener?.('blur', reset);

  function dispose() {
    target?.removeEventListener?.('keydown', onKeyDown);
    target?.removeEventListener?.('keyup', onKeyUp);
    target?.removeEventListener?.('pointermove', onPointerMove);
    target?.removeEventListener?.('pointerdown', onPointerDown);
    target?.removeEventListener?.('pointerup', onPointerUp);
    target?.removeEventListener?.('pointercancel', onPointerCancel);
    target?.removeEventListener?.('blur', reset);
    reset();
    events.clear();
  }

  return Object.freeze({
    get pointer() { return { ...pointer }; },
    get pointers() { return [...activePointers.values()].map(p => ({ ...p })); },
    get pointerCount() { return activePointers.size; },
    getPointer(id) {
      const p = activePointers.get(id);
      return p ? { ...p } : null;
    },
    get focused() { return active; },
    isDown: code => down.has(code),
    wasPressed: code => pressed.has(code),
    wasReleased: code => released.has(code),
    isPointerDown,
    wasPointerPressed: (button = 0) => pointerPressedButtons.has(button),
    wasPointerReleased: (button = 0) => pointerReleasedButtons.has(button),
    preventKeys,
    endFrame() {
      pressed.clear();
      released.clear();
      pointerPressedButtons.clear();
      pointerReleasedButtons.clear();
      for (const p of activePointers.values()) {
        p.dx = 0;
        p.dy = 0;
      }
    },
    setFocused,
    reset,
    on: events.on,
    dispose,
  });
}

const MOUSE_BUTTON_MASK = Object.freeze({
  Mouse0: 1,
  MouseLeft: 1,
  Mouse1: 4,
  MouseMiddle: 4,
  Mouse2: 2,
  MouseRight: 2,
  Mouse3: 8,
  Mouse4: 16,
});

function normalizeKeyList(keys) {
  if (!keys) return [];
  if (typeof keys === 'string') return [keys];
  return [...keys].filter(k => typeof k === 'string' && k.length > 0);
}

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
 * @param {string} name
 * @param {{
 *   priority?: number,
 *   consumesKeys?: boolean,
 *   blocksLowerContexts?: boolean,
 *   bufferWindow?: number,
 *   actions?: Record<string, any>,
 *   axes1D?: Record<string, any>,
 *   axes2D?: Record<string, any>,
 * }} [options]
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
  const normalizedActions = Object.create(null);
  for (const [actionName, spec] of Object.entries(actions)) {
    normalizedActions[actionName] = normalizeActionBinding(spec, defaults);
  }
  const normalizedAxes1D = Object.create(null);
  for (const [axisName, spec] of Object.entries(axes1D)) {
    normalizedAxes1D[axisName] = normalizeAxis1DBinding(spec, defaults);
  }
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

/**
 * Priority-ordered input action & axis router supporting key consumption across
 * layered contexts, chorded bindings, hold timers, and input buffering.
 *
 * @param {{ input?: ReturnType<createInputManager> | null, readCode?: ((code: string) => boolean) | null }} [options]
 */
export function createInputActionRouter({ input = null, readCode = null } = {}) {
  let orderCounter = 0;
  /** @type {Array<{ context: ReturnType<defineInputContext>, priority: number, enabled: boolean, order: number }>} */
  const stack = [];
  /** @type {Map<string, { down: boolean, pressed: boolean, released: boolean, heldSeconds: number, bufferRemaining: number }>} */
  const actionStates = new Map();
  /** @type {Map<string, number>} */
  const axis1DStates = new Map();
  /** @type {Map<string, { x: number, y: number }>} */
  const axis2DStates = new Map();
  const virtualActions = new Map();
  const virtualAxes1D = new Map();
  const virtualAxes2D = new Map();
  const consumedKeys = new Set();
  const seenActionsThisFrame = new Set();
  const seenAxes1DThisFrame = new Set();
  const seenAxes2DThisFrame = new Set();

  function sortStack() {
    stack.sort((a, b) => (b.priority - a.priority) || (b.order - a.order));
  }

  function defaultReadCode(code) {
    if (readCode && readCode(code)) return true;
    const mask = MOUSE_BUTTON_MASK[code];
    if (mask !== undefined) {
      return ((input?.pointer?.buttons ?? 0) & mask) !== 0;
    }
    return Boolean(input?.isDown?.(code));
  }

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

  function removeContext(nameOrContext) {
    const targetName = typeof nameOrContext === 'string' ? nameOrContext : nameOrContext?.name;
    const idx = stack.findIndex(item => item.context.name === targetName);
    if (idx === -1) return false;
    stack.splice(idx, 1);
    return true;
  }

  function setContextEnabled(name, enabled) {
    const entry = stack.find(item => item.context.name === name);
    if (!entry) return false;
    entry.enabled = Boolean(enabled);
    return true;
  }

  function hasContext(name, { enabledOnly = false } = {}) {
    const entry = stack.find(item => item.context.name === name);
    if (!entry) return false;
    return enabledOnly ? entry.enabled : true;
  }

  function clearContexts() {
    stack.length = 0;
  }

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

  function setVirtualAction(actionName, down) {
    if (typeof actionName !== 'string' || !actionName) return false;
    if (down) {
      virtualActions.set(actionName, true);
      return true;
    }
    virtualActions.delete(actionName);
    return false;
  }

  function setVirtualAxis1D(axisName, value) {
    if (typeof axisName !== 'string' || !axisName) return 0;
    const v = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    if (v === 0) virtualAxes1D.delete(axisName);
    else virtualAxes1D.set(axisName, v);
    return v;
  }

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

  function getAxis2D(name, out = { x: 0, y: 0 }) {
    const vec = axis2DStates.get(name);
    out.x = vec ? vec.x : 0;
    out.y = vec ? vec.y : 0;
    return out;
  }

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

export const ARCADE_SLOTS = Object.freeze({
  primary: Object.freeze(['j', 'k', 'l', 'u', 'i', 'o']),
  extra: Object.freeze(['q', 'e']),
  all: Object.freeze(['j', 'k', 'l', 'u', 'i', 'o', 'q', 'e']),
});

export const PLAYER_KEYMAPS = Object.freeze({
  p1: Object.freeze({
    id: 'p1',
    move: Object.freeze({ up: ['KeyW'], left: ['KeyA'], down: ['KeyS'], right: ['KeyD'] }),
    primary: Object.freeze({
      j: ['KeyJ'],
      k: ['KeyK'],
      l: ['KeyL'],
      u: ['KeyU'],
      i: ['KeyI'],
      o: ['KeyO'],
    }),
    extra: Object.freeze({
      q: ['KeyQ'],
      e: ['KeyE'],
    }),
    labels: Object.freeze({
      up: 'W', left: 'A', down: 'S', right: 'D',
      j: 'J', k: 'K', l: 'L', u: 'U', i: 'I', o: 'O', q: 'Q', e: 'E',
    }),
  }),
  p2: Object.freeze({
    id: 'p2',
    move: Object.freeze({ up: ['ArrowUp'], left: ['ArrowLeft'], down: ['ArrowDown'], right: ['ArrowRight'] }),
    primary: Object.freeze({
      j: ['Numpad1', 'Digit1'],
      k: ['Numpad2', 'Digit2'],
      l: ['Numpad3', 'Digit3'],
      u: ['Numpad4', 'Digit4'],
      i: ['Numpad5', 'Digit5'],
      o: ['Numpad6', 'Digit6'],
    }),
    extra: Object.freeze({
      q: ['Numpad0', 'Digit0'],
      e: ['NumpadDecimal', 'Period'],
    }),
    labels: Object.freeze({
      up: '↑', left: '←', down: '↓', right: '→',
      j: '1', k: '2', l: '3', u: '4', i: '5', o: '6', q: '0', e: '.',
    }),
  }),
});

function resolveArcadeSpecs(actions, extras, enableExtras, defaultBufferWindow) {
  if (!Array.isArray(actions)) {
    throw new TypeError('Arcade controls actions must be an array');
  }
  if (!Array.isArray(extras)) {
    throw new TypeError('Arcade controls extras must be an array');
  }
  if (actions.length > 6 && !enableExtras) {
    throw new RangeError('Primary arcade controls support at most 6 actions (j/k/l/u/i/o); pass extras or enableExtras: true to use extra slots (q/e and 0/.)');
  }
  if (extras.length > 2) {
    throw new RangeError('Arcade controls support at most 2 extra actions (q/e and 0/.)');
  }
  if (actions.length + extras.length > 8) {
    throw new RangeError('Arcade controls support at most 6 primary + 2 extra actions');
  }

  const usedSlots = new Set();
  const usedNames = new Set();
  const entries = [];

  function normalizeItem(item, forceExtra) {
    if (typeof item === 'string') {
      if (!item) throw new TypeError('Arcade action name must be non-empty');
      return { name: item, label: item, slot: null, bufferWindow: defaultBufferWindow, forceExtra };
    }
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name) {
      throw new TypeError('Arcade action entry must be a string or { name, label?, slot?, bufferWindow? }');
    }
    const slot = item.slot ?? null;
    if (slot !== null && !ARCADE_SLOTS.all.includes(slot)) {
      throw new RangeError(`Unsupported arcade button slot "${slot}"; expected one of ${ARCADE_SLOTS.all.join(', ')}`);
    }
    const isExtraSlot = slot !== null && ARCADE_SLOTS.extra.includes(slot);
    if (!forceExtra && isExtraSlot && !enableExtras) {
      throw new RangeError(`Extra slot "${slot}" requires extras or enableExtras: true`);
    }
    if (forceExtra && slot !== null && !isExtraSlot) {
      throw new RangeError(`extras entries must use extra slots (q/e), got "${slot}"`);
    }
    const buf = item.bufferWindow !== undefined ? Number(item.bufferWindow) : defaultBufferWindow;
    if (!Number.isFinite(buf) || buf < 0) {
      throw new RangeError('Arcade action bufferWindow must be >= 0');
    }
    return {
      name: item.name,
      label: typeof item.label === 'string' && item.label ? item.label : item.name,
      slot,
      bufferWindow: buf,
      forceExtra: forceExtra || isExtraSlot,
    };
  }

  const parsed = [
    ...actions.map((item, idx) => normalizeItem(item, idx >= 6)),
    ...extras.map(item => normalizeItem(item, true)),
  ];

  // Reserve explicit slots first so auto-assigned items never collide.
  for (const spec of parsed) {
    if (usedNames.has(spec.name)) {
      throw new Error(`Duplicate arcade action name "${spec.name}"`);
    }
    usedNames.add(spec.name);
    if (spec.slot) {
      if (usedSlots.has(spec.slot)) {
        throw new Error(`Duplicate arcade button slot "${spec.slot}"`);
      }
      usedSlots.add(spec.slot);
    }
  }

  for (const spec of parsed) {
    let slot = spec.slot;
    if (!slot) {
      const pool = spec.forceExtra
        ? ARCADE_SLOTS.extra
        : (enableExtras ? ARCADE_SLOTS.all : ARCADE_SLOTS.primary);
      slot = pool.find(candidate => !usedSlots.has(candidate)) ?? null;
      if (!slot) {
        throw new RangeError('No available arcade button slots remaining for action "' + spec.name + '"');
      }
      usedSlots.add(slot);
    }
    entries.push({
      name: spec.name,
      label: spec.label,
      slot,
      isExtra: ARCADE_SLOTS.extra.includes(slot),
      bufferWindow: spec.bufferWindow,
    });
  }

  return entries;
}

/**
 * Standardized Mobile-Touch + PC + 2P Split-Screen Arcade Controller.
 *
 * - P1: WASD + J K L U I O (optional extras Q E)
 * - P2: Arrow Keys + 1 2 3 4 5 6 (optional extras 0 .)
 */
export function createArcadeControls({
  input = null,
  readCode = null,
  players = 1,
  actions = ARCADE_SLOTS.primary,
  extras = [],
  enableExtras = false,
  bufferWindow = 0.1,
  yAxis = 'down',
  preventBrowserScroll = true,
} = {}) {
  if (players !== 1 && players !== 2) {
    throw new RangeError('Arcade controls support 1 or 2 local players');
  }
  if (yAxis !== 'down' && yAxis !== 'up') {
    throw new RangeError('Arcade controls yAxis must be "down" or "up"');
  }

  const specs = resolveArcadeSpecs(actions, extras, enableExtras, bufferWindow);

  if (preventBrowserScroll && input?.preventKeys && players === 2) {
    input.preventKeys(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  }

  function createPlayerController(index, keymap) {
    const router = createInputActionRouter({ input, readCode });
    const ctxActions = {};
    const nameLookup = new Map();
    const bindings = [];

    for (const spec of specs) {
      const keys = spec.isExtra ? keymap.extra[spec.slot] : keymap.primary[spec.slot];
      ctxActions[spec.name] = { keys, bufferWindow: spec.bufferWindow };
      nameLookup.set(spec.name, spec.name);
      nameLookup.set(spec.slot, spec.name);
      bindings.push(Object.freeze({
        name: spec.name,
        label: spec.label,
        slot: spec.slot,
        keys: Object.freeze([...keys]),
        keyLabel: keymap.labels[spec.slot],
        isExtra: spec.isExtra,
        bufferWindow: spec.bufferWindow,
      }));
    }

    const context = defineInputContext(`Arcade_${keymap.id}`, {
      priority: 0,
      consumesKeys: true,
      bufferWindow,
      actions: ctxActions,
      axes2D: {
        Move: {
          up: keymap.move.up,
          down: keymap.move.down,
          left: keymap.move.left,
          right: keymap.move.right,
          normalize: true,
        },
      },
    });
    router.pushContext(context);

    const scratchMove = { x: 0, y: 0 };
    const moveState = { x: 0, y: 0, magnitude: 0, active: false };
    const frozenBindings = Object.freeze(bindings);

    function resolveActionName(nameOrSlot) {
      return nameLookup.get(nameOrSlot) ?? null;
    }

    function setVirtualStick(x = 0, y = 0) {
      const vx = Number.isFinite(x) ? x : 0;
      const vy = Number.isFinite(y) ? y : 0;
      const mapped = router.setVirtualAxis2D('Move', vx, yAxis === 'down' ? -vy : vy);
      return { x: mapped.x, y: yAxis === 'down' ? -mapped.y : mapped.y };
    }

    function clearVirtualStick() {
      router.setVirtualAxis2D('Move', 0, 0);
    }

    function setVirtualButton(nameOrSlot, down) {
      const actionName = resolveActionName(nameOrSlot);
      if (!actionName) return false;
      return router.setVirtualAction(actionName, Boolean(down));
    }

    function update(dt = 0) {
      router.update(dt);
      router.getAxis2D('Move', scratchMove);
      const mx = scratchMove.x || 0;
      const my = (yAxis === 'down' ? -scratchMove.y : scratchMove.y) || 0;
      moveState.x = mx;
      moveState.y = my;
      moveState.magnitude = Math.min(1, Math.hypot(mx, my));
      moveState.active = moveState.magnitude > 1e-5;
    }

    function getMove(out = { x: 0, y: 0, magnitude: 0, active: false }) {
      out.x = moveState.x;
      out.y = moveState.y;
      out.magnitude = moveState.magnitude;
      out.active = moveState.active;
      return out;
    }

    function reset() {
      router.reset();
      moveState.x = 0;
      moveState.y = 0;
      moveState.magnitude = 0;
      moveState.active = false;
    }

    return Object.freeze({
      index,
      id: keymap.id,
      yAxis,
      keymap,
      bindings: frozenBindings,
      router,
      get move() { return { ...moveState }; },
      getMove,
      isDown(nameOrSlot) {
        const name = resolveActionName(nameOrSlot);
        return name ? router.isDown(name) : false;
      },
      wasPressed(nameOrSlot) {
        const name = resolveActionName(nameOrSlot);
        return name ? router.wasPressed(name) : false;
      },
      wasReleased(nameOrSlot) {
        const name = resolveActionName(nameOrSlot);
        return name ? router.wasReleased(name) : false;
      },
      heldSeconds(nameOrSlot) {
        const name = resolveActionName(nameOrSlot);
        return name ? router.heldSeconds(name) : 0;
      },
      isHeld(nameOrSlot, minSeconds = 0) {
        const name = resolveActionName(nameOrSlot);
        return name ? router.isHeld(name, minSeconds) : false;
      },
      isBuffered(nameOrSlot) {
        const name = resolveActionName(nameOrSlot);
        return name ? router.isBuffered(name) : false;
      },
      consumeBuffered(nameOrSlot) {
        const name = resolveActionName(nameOrSlot);
        return name ? router.consumeBuffered(name) : false;
      },
      setVirtualStick,
      clearVirtualStick,
      setVirtualButton,
      update,
      reset,
    });
  }

  const playerControllers = Object.freeze(
    players === 2
      ? [createPlayerController(0, PLAYER_KEYMAPS.p1), createPlayerController(1, PLAYER_KEYMAPS.p2)]
      : [createPlayerController(0, PLAYER_KEYMAPS.p1)]
  );

  return Object.freeze({
    players: playerControllers,
    p1: playerControllers[0],
    p2: playerControllers[1] ?? null,
    player(index) {
      return playerControllers[index] ?? null;
    },
    update(dt = 0) {
      for (let i = 0; i < playerControllers.length; i++) {
        playerControllers[i].update(dt);
      }
    },
    reset() {
      for (let i = 0; i < playerControllers.length; i++) {
        playerControllers[i].reset();
      }
    },
  });
}

/**
 * Computes normalized `[0..1]` top-left split-screen viewport descriptors
 * compatible with `canvas2d.setViews`, `webgl2d.setViews`, and `three.setViews`.
 */
export function computeSplitScreenViews(playerCount = 2, {
  direction = 'auto',
  width = 960,
  height = 540,
  cameras = [],
} = {}) {
  if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > 4) {
    throw new RangeError('computeSplitScreenViews supports playerCount in 1..4');
  }
  const safeW = Number.isFinite(width) && width > 0 ? width : 960;
  const safeH = Number.isFinite(height) && height > 0 ? height : 540;

  let rects;
  if (playerCount === 1) {
    rects = [{ x: 0, y: 0, width: 1, height: 1 }];
  } else if (playerCount === 2) {
    const split = direction === 'auto' ? (safeW >= safeH ? 'vertical' : 'horizontal') : direction;
    if (split !== 'vertical' && split !== 'horizontal') {
      throw new RangeError('Split-screen direction must be "auto", "vertical", or "horizontal"');
    }
    rects = split === 'vertical'
      ? [{ x: 0, y: 0, width: 0.5, height: 1 }, { x: 0.5, y: 0, width: 0.5, height: 1 }]
      : [{ x: 0, y: 0, width: 1, height: 0.5 }, { x: 0, y: 0.5, width: 1, height: 0.5 }];
  } else if (playerCount === 3) {
    rects = [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 1, height: 0.5 },
    ];
  } else {
    rects = [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ];
  }

  return rects.map((r, index) => ({
    index,
    playerId: `p${index + 1}`,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    aspect: (safeW * r.width) / Math.max(1, safeH * r.height),
    camera: Array.isArray(cameras) ? (cameras[index] ?? null) : null,
  }));
}

/** Validates normalized `[0..1]` multi-viewport descriptors for `setViews(...)`. */
export function normalizeSplitViews(views, {
  dividerColor = 'rgba(255,255,255,0.22)',
  dividerWidth = 2,
} = {}) {
  const safeDividerWidth = Number.isFinite(dividerWidth) && dividerWidth >= 0 ? dividerWidth : 0;
  if (views === null || views === undefined) {
    return { views: null, dividerColor, dividerWidth: safeDividerWidth };
  }
  if (!Array.isArray(views)) {
    throw new TypeError('setViews requires an array of view descriptors or null');
  }
  if (views.length === 0) {
    return { views: null, dividerColor, dividerWidth: safeDividerWidth };
  }
  const normalized = views.map((v, i) => {
    if (!v || !v.camera || typeof v.camera !== 'object') {
      throw new TypeError(`View at index ${i} requires a camera object`);
    }
    const x = Number(v.x ?? 0);
    const y = Number(v.y ?? 0);
    const width = Number(v.width ?? 1);
    const height = Number(v.height ?? 1);
    if (
      !Number.isFinite(x) || !Number.isFinite(y) ||
      !Number.isFinite(width) || !Number.isFinite(height) ||
      x < -1e-6 || y < -1e-6 || width <= 0 || height <= 0 ||
      x + width > 1 + 1e-6 || y + height > 1 + 1e-6
    ) {
      throw new RangeError(`View rect at index ${i} must have finite positive dimensions within [0..1]`);
    }
    return Object.freeze({
      index: i,
      playerId: v.playerId ?? null,
      camera: v.camera,
      x: Math.max(0, x),
      y: Math.max(0, y),
      width: Math.min(1, width),
      height: Math.min(1, height),
    });
  });
  return { views: Object.freeze(normalized), dividerColor, dividerWidth: safeDividerWidth };
}

export function pickSplitView(views, nx, ny, viewIndex = null) {
  if (!views || views.length === 0) return null;
  if (Number.isInteger(viewIndex)) {
    return views[viewIndex] ?? views[0];
  }
  for (let i = 0; i < views.length; i++) {
    const v = views[i];
    if (nx >= v.x - 1e-6 && nx <= v.x + v.width + 1e-6 &&
        ny >= v.y - 1e-6 && ny <= v.y + v.height + 1e-6) {
      return v;
    }
  }
  return views[0];
}
