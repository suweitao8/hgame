import { createEmitter } from './events.js';

function isEditable(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName || '');
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
    pointer = { ...pointer, x: Number(event.clientX) || 0, y: Number(event.clientY) || 0, buttons: Number(event.buttons) || 0 };
    events.emit('pointermove', { ...pointer, originalEvent: event });
  }

  function onPointerDown(event) {
    if (!active) return;
    pointer = { x: Number(event.clientX) || 0, y: Number(event.clientY) || 0, buttons: Number(event.buttons) || 0, id: event.pointerId ?? null };
    events.emit('pointerdown', { ...pointer, button: event.button ?? 0, originalEvent: event });
  }

  function onPointerUp(event) {
    if (!active) return;
    pointer = { ...pointer, x: Number(event.clientX) || 0, y: Number(event.clientY) || 0, buttons: Number(event.buttons) || 0 };
    events.emit('pointerup', { ...pointer, button: event.button ?? 0, originalEvent: event });
  }

  function reset() {
    for (const code of down) released.add(code);
    down.clear();
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

  target?.addEventListener?.('keydown', onKeyDown);
  target?.addEventListener?.('keyup', onKeyUp);
  target?.addEventListener?.('pointermove', onPointerMove);
  target?.addEventListener?.('pointerdown', onPointerDown);
  target?.addEventListener?.('pointerup', onPointerUp);
  target?.addEventListener?.('blur', reset);

  function dispose() {
    target?.removeEventListener?.('keydown', onKeyDown);
    target?.removeEventListener?.('keyup', onKeyUp);
    target?.removeEventListener?.('pointermove', onPointerMove);
    target?.removeEventListener?.('pointerdown', onPointerDown);
    target?.removeEventListener?.('pointerup', onPointerUp);
    target?.removeEventListener?.('blur', reset);
    reset();
    events.clear();
  }

  return Object.freeze({
    get pointer() { return { ...pointer }; },
    get focused() { return active; },
    isDown: code => down.has(code),
    wasPressed: code => pressed.has(code),
    wasReleased: code => released.has(code),
    endFrame() { pressed.clear(); released.clear(); },
    setFocused,
    reset,
    on: events.on,
    dispose,
  });
}
