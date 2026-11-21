import { createEmitter } from '../events.js';

/** @param {EventTarget | null | undefined} target @returns {boolean} */
function isEditable(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName || '');
}

/** @param {number} button @returns {number} */
function pointerButtonMask(button) {
  if (button === 0) return 1;
  if (button === 1) return 4;
  if (button === 2) return 2;
  return button >= 3 && button < 31 ? (1 << button) : 0;
}

/**
 * @typedef {object} InputManagerOptions
 * @property {EventTarget | null} [target] Event source (default `globalThis.window`).
 * @property {boolean} [focused=true] Initial focus state; unfocused managers ignore input.
 * @property {Iterable<string>} [preventDefaultKeys=[]] `KeyboardEvent.code` values whose default action is prevented.
 * @property {Record<string, string | string[]>} [defaultBindings] Default action -> key codes map for rebinding & persistence.
 */

/**
 * @typedef {object} PointerState Primary pointer snapshot (client coordinates in pixels).
 * @property {number} x
 * @property {number} y
 * @property {number} buttons `PointerEvent.buttons` bit mask (1 = left, 2 = right, 4 = middle).
 * @property {number | null} id Pointer id of the primary pointer, or null when none is down.
 */

/**
 * @typedef {object} TrackedPointer Active pointer (mouse, touch or pen).
 * @property {number | 'mouse'} id
 * @property {number} x Client x in pixels.
 * @property {number} y Client y in pixels.
 * @property {number} startX Client x at press, pixels.
 * @property {number} startY Client y at press, pixels.
 * @property {number} prevX Previous x, pixels.
 * @property {number} prevY Previous y, pixels.
 * @property {number} dx Movement accumulated this frame, pixels (reset by `endFrame`).
 * @property {number} dy Movement accumulated this frame, pixels.
 * @property {string} pointerType `'mouse'`, `'touch'` or `'pen'`.
 * @property {number} button Button that started the press (0 = primary).
 * @property {number} buttons Current button mask.
 */

/**
 * @typedef {object} InputEvents
 * @property {{ code: string, repeat: boolean, originalEvent: KeyboardEvent }} keydown
 * @property {{ code: string, originalEvent: KeyboardEvent }} keyup
 * @property {PointerState & { pointerType: string, originalEvent: PointerEvent }} pointermove
 * @property {PointerState & { pointerType: string, button: number, originalEvent: PointerEvent }} pointerdown
 * @property {PointerState & { pointerType: string, button: number, originalEvent: PointerEvent }} pointerup
 * @property {PointerState & { pointerType: string, button: number, originalEvent: PointerEvent }} pointercancel
 * @property {boolean} focus
 */

/**
 * @typedef {object} InputManager Keyboard and pointer state with per-frame edge detection.
 * @property {Readonly<PointerState>} pointer Copy of the primary pointer state.
 * @property {TrackedPointer[]} pointers Copies of all active pointers.
 * @property {number} pointerCount
 * @property {(id: number | 'mouse') => TrackedPointer | null} getPointer
 * @property {boolean} focused
 * @property {(code: string) => boolean} isDown Key currently held (`KeyboardEvent.code`).
 * @property {(code: string) => boolean} wasPressed Key went down since the last `endFrame`.
 * @property {(code: string) => boolean} wasReleased Key went up since the last `endFrame`.
 * @property {(action: string, codes: string | Iterable<string>) => string[]} setBinding Bind an action name to one or more key codes.
 * @property {(action: string) => string[]} getBinding
 * @property {() => void} resetBindings Restore initial default bindings.
 * @property {() => Record<string, string[]>} exportBindings Serialize current bindings for storage.
 * @property {(data: string | Record<string, string | string[]>) => Record<string, string[]>} importBindings
 * @property {(action: string) => boolean} isActionDown
 * @property {(action: string) => boolean} wasActionPressed
 * @property {(action: string) => boolean} wasActionReleased
 * @property {(gamepadIndex?: number, options?: { durationMs?: number, weakMagnitude?: number, strongMagnitude?: number, navigatorObj?: object }) => Promise<boolean>} triggerGamepadRumble
 * @property {(button?: number) => boolean} isPointerDown Default button 0 (any touch/pen counts as 0).
 * @property {(button?: number) => boolean} wasPointerPressed
 * @property {(button?: number) => boolean} wasPointerReleased
 * @property {(codes: string | Iterable<string>) => number} preventKeys Add default-prevented keys; returns the set size.
 * @property {() => void} endFrame Clear edge flags and per-frame pointer deltas (call once per tick).
 * @property {(focused: boolean) => boolean} setFocused
 * @property {() => void} reset Release all keys/pointers.
 * @property {import('../events.js').Emitter<InputEvents>['on']} on
 * @property {() => void} dispose
 */

/**
 * Create the keyboard / pointer input manager.
 * @param {InputManagerOptions} [options]
 * @returns {InputManager}
 */
export function createInputManager({
  target = globalThis.window,
  focused = true,
  preventDefaultKeys = [],
  defaultBindings = {},
} = {}) {
  /** @type {import('../events.js').Emitter<InputEvents>} */
  const events = createEmitter();
  const down = new Set();
  const pressed = new Set();
  const released = new Set();
  const prevented = new Set(preventDefaultKeys);
  const initialBindings = new Map();
  const bindings = new Map();
  function normalizeCodes(codes) {
    if (typeof codes === 'string') return codes ? [codes] : [];
    if (!codes || typeof codes[Symbol.iterator] !== 'function') return [];
    const seen = new Set();
    for (const c of codes) {
      if (typeof c === 'string' && c) seen.add(c);
    }
    return [...seen];
  }
  if (defaultBindings && typeof defaultBindings === 'object') {
    for (const [action, codes] of Object.entries(defaultBindings)) {
      const list = normalizeCodes(codes);
      initialBindings.set(action, list);
      bindings.set(action, list.slice());
    }
  }
  /** @type {Map<number | 'mouse', TrackedPointer>} */
  const activePointers = new Map();
  /** @type {Set<number>} */
  const pointerPressedButtons = new Set();
  /** @type {Set<number>} */
  const pointerReleasedButtons = new Set();
  let active = Boolean(focused);
  /** @type {PointerState} */
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

  /** @param {boolean} value @returns {boolean} */
  function setFocused(value) {
    const next = Boolean(value);
    if (active === next) return false;
    active = next;
    if (!active) reset();
    events.emit('focus', active);
    return true;
  }

  /** @param {number} [button] @returns {boolean} */
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

  /** @param {string | Iterable<string>} codes @returns {number} */
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
    setBinding(action, codes) {
      if (typeof action !== 'string' || !action) throw new TypeError('Action name must be a non-empty string');
      const list = normalizeCodes(codes);
      bindings.set(action, list);
      return list.slice();
    },
    getBinding(action) {
      return (bindings.get(action) ?? []).slice();
    },
    resetBindings() {
      bindings.clear();
      for (const [action, list] of initialBindings) {
        bindings.set(action, list.slice());
      }
    },
    exportBindings() {
      /** @type {Record<string, string[]>} */
      const out = {};
      for (const [action, list] of bindings) out[action] = list.slice();
      return out;
    },
    importBindings(data) {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      if (!parsed || typeof parsed !== 'object') throw new TypeError('importBindings requires an object or JSON string');
      for (const [action, codes] of Object.entries(parsed)) {
        if (typeof action === 'string' && action) bindings.set(action, normalizeCodes(codes));
      }
      const out = {};
      for (const [action, list] of bindings) out[action] = list.slice();
      return out;
    },
    isActionDown: action => (bindings.get(action) ?? []).some(code => down.has(code)),
    wasActionPressed: action => (bindings.get(action) ?? []).some(code => pressed.has(code)),
    wasActionReleased: action => (bindings.get(action) ?? []).some(code => released.has(code)),
    async triggerGamepadRumble(gamepadIndex = 0, {
      durationMs = 150,
      weakMagnitude = 0.5,
      strongMagnitude = 0.5,
      navigatorObj = globalThis.navigator,
    } = {}) {
      const pads = typeof navigatorObj?.getGamepads === 'function' ? navigatorObj.getGamepads() : null;
      const gp = pads ? pads[gamepadIndex] : null;
      const duration = Math.max(0, Math.min(5000, Number(durationMs) || 0));
      const weak = Math.max(0, Math.min(1, Number(weakMagnitude) || 0));
      const strong = Math.max(0, Math.min(1, Number(strongMagnitude) || 0));
      if (gp?.vibrationActuator && typeof gp.vibrationActuator.playEffect === 'function') {
        await gp.vibrationActuator.playEffect('dual-rumble', {
          startDelay: 0,
          duration,
          weakMagnitude: weak,
          strongMagnitude: strong,
        });
        return true;
      }
      const pulse = gp?.hapticActuators?.[0]?.pulse;
      if (typeof pulse === 'function') {
        await pulse.call(gp.hapticActuators[0], Math.max(weak, strong), duration);
        return true;
      }
      return false;
    },
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
