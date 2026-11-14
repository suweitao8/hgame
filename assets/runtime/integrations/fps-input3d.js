/**
 * Optional first-person input bridge for desktop / touch / standard gamepad.
 *
 * A reusable, independent keyboard, pointer-lock, touch and gamepad adapter.
 * It does NOT start RAF,
 * move the camera, run physics or modify simulation state by itself.
 *
 * Call sample(dt) at the game's simulation boundary, consumeLook() once per
 * visual frame and apply deltas to your chosen camera/controller.
 */
const ACTIONS = Object.freeze([
  'fire', 'ads', 'sprint', 'crouch', 'jump', 'reload', 'melee', 'interact', 'pause',
]);
const KEYS = Object.freeze({
  fire: [], ads: [], sprint: ['ShiftLeft','ShiftRight'],
  crouch: ['KeyC','ControlLeft','ControlRight'],
  jump: ['Space'], reload: ['KeyR'], melee: ['KeyF'],
  interact: ['KeyE'], pause: ['Escape','KeyP'],
});
const magnitude = (x, y) => {
  const length = Math.hypot(x, y);
  return length > 1 ? { x: x / length, y: y / length } : { x, y };
};
const clamp = (x, low, high) => Math.min(high, Math.max(low, x));
const deadzone = (axis, threshold) => {
  if (!Number.isFinite(axis) || Math.abs(axis) <= threshold) return 0;
  return Math.sign(axis) * clamp((Math.abs(axis) - threshold) / (1 - threshold), 0, 1);
};
const editable = e => /^(INPUT|TEXTAREA|SELECT)$/i.test(e?.target?.tagName ?? '') ||
  Boolean(e?.target?.isContentEditable);

/**
 * Minimal structural event-target (window / document / canvas).
 * @typedef {object} FpsEventTargetLike
 * @property {(type: string, listener: (event: object) => void, options?: boolean | object) => void} [addEventListener]
 * @property {(type: string, listener: (event: object) => void, options?: boolean | object) => void} [removeEventListener]
 */
/**
 * Interactive canvas surface used for pointer capture, touch zones and pointer lock.
 * @typedef {object} FpsCanvasLike
 * @property {(type: string, listener: (event: object) => void, options?: boolean | object) => void} addEventListener
 * @property {(type: string, listener: (event: object) => void, options?: boolean | object) => void} [removeEventListener]
 * @property {() => {left: number, top: number, width: number, height: number}} getBoundingClientRect
 * @property {(pointerId: number) => void} [setPointerCapture]
 * @property {(pointerId: number) => void} [releasePointerCapture]
 * @property {() => (void | Promise<void>)} [requestPointerLock]
 */
/**
 * Document-like object (pointer lock + visibility).
 * @typedef {FpsEventTargetLike & {pointerLockElement?: object | null, hidden?: boolean, exitPointerLock?: () => void}} FpsDocumentLike
 */
/**
 * Navigator-like object exposing the Gamepad API.
 * @typedef {object} FpsNavigatorLike
 * @property {() => ArrayLike<object | null> | null} [getGamepads]
 */
/**
 * Optional existing keyboard input to read instead of owning key listeners.
 * @typedef {object} FpsKeyInputLike
 * @property {(code: string) => boolean} [isDown] KeyboardEvent.code lookup.
 */
/**
 * @typedef {'fire'|'ads'|'sprint'|'crouch'|'jump'|'reload'|'melee'|'interact'|'pause'} FpsAction
 */
/**
 * Options for {@link createFirstPersonInput3d}.
 * @typedef {object} FirstPersonInput3dOptions
 * @property {FpsCanvasLike} canvas Interactive canvas element (required).
 * @property {FpsEventTargetLike} [windowRef] Window for keyboard/blur events. Default `globalThis.window`.
 * @property {FpsDocumentLike} [documentRef] Document for pointer lock. Default `globalThis.document`.
 * @property {FpsNavigatorLike} [navigatorRef] Navigator for gamepads. Default `globalThis.navigator`.
 * @property {FpsKeyInputLike | null} [keyInput] Existing key input to consume. Default `null`.
 * @property {number} [sensitivity] Look sensitivity multiplier, (0, 10]. Default `1`.
 * @property {boolean} [invertY] Invert vertical look. Default `false`.
 * @property {boolean} [touchEnabled] Enable touch zones. Default `true`.
 * @property {boolean} [gamepadEnabled] Enable standard gamepad. Default `true`.
 * @property {boolean} [pointerLockEnabled] Allow pointer lock. Default `true`.
 * @property {number} [touchRadius] Virtual stick radius in CSS pixels, 16..300. Default `90`.
 * @property {number} [stickDeadzone] Gamepad stick deadzone, [0, 1). Default `0.18`.
 * @property {number} [gamepadLookRate] Gamepad look speed in radians per second at full deflection. Default `2.6`.
 */
/**
 * Per-simulation-step input sample.
 * @typedef {object} FpsInputSample
 * @property {{x: number, y: number}} move Normalised move vector (x right, y back; length <= 1).
 * @property {boolean} fire
 * @property {boolean} ads
 * @property {boolean} sprint
 * @property {boolean} crouch
 * @property {boolean} jump
 * @property {boolean} reload
 * @property {boolean} melee
 * @property {boolean} interact
 * @property {boolean} pause
 * @property {boolean} locked Pointer is locked to the canvas.
 * @property {boolean} touch A touch pointer has been seen.
 * @property {boolean} gamepad A standard gamepad is connected.
 */
/**
 * Accumulated look delta in radians (since last consume).
 * @typedef {object} FpsLookDelta
 * @property {number} dx Yaw delta.
 * @property {number} dy Pitch delta.
 */
/**
 * Frozen controller returned by {@link createFirstPersonInput3d}.
 * @typedef {object} FirstPersonInput3d
 * @property {(dt?: number) => FpsInputSample} sample Sample actions; `dt` seconds, default 1/60.
 * @property {() => FpsLookDelta} consumeLook Read and zero the look delta.
 * @property {() => Promise<boolean>} requestLock Request pointer lock; resolves whether locked.
 * @property {() => void} releaseLock Exit pointer lock if held.
 * @property {() => void} reset Clear all held input state.
 * @property {(name: FpsAction, value: boolean) => void} setAction Set an on-screen overlay action.
 * @property {() => boolean} dispose Remove listeners; false when already disposed.
 * @property {boolean} locked Current pointer-lock state.
 */

/**
 * Create a first-person input adapter (keyboard, pointer lock, touch, gamepad).
 * @param {FirstPersonInput3dOptions} [options]
 * @returns {FirstPersonInput3d}
 */
export function createFirstPersonInput3d({
  canvas,
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  navigatorRef = globalThis.navigator,
  keyInput = null,
  sensitivity = 1,
  invertY = false,
  touchEnabled = true,
  gamepadEnabled = true,
  pointerLockEnabled = true,
  touchRadius = 90,
  stickDeadzone = 0.18,
  gamepadLookRate = 2.6,
} = /** @type {FirstPersonInput3dOptions} */ ({})) {
  if (!canvas?.addEventListener || !canvas?.getBoundingClientRect) {
    throw new TypeError('FPS input needs an interactive canvas element');
  }
  if (!(Number.isFinite(sensitivity) && sensitivity > 0 && sensitivity <= 10)) {
    throw new RangeError('Invalid look sensitivity');
  }
  if (!(stickDeadzone >= 0 && stickDeadzone < 1) || !Number.isFinite(stickDeadzone)) {
    throw new RangeError('Invalid gamepad deadzone');
  }
  if (!(touchRadius >= 16 && touchRadius <= 300)) {
    throw new RangeError('Invalid touch radius');
  }
  const keys = new Set();
  const buttons = new Set();
  const overlays = new Map();
  const touches = new Map();
  const listeners = [];
  let lookX = 0, lookY = 0;
  let locked = false, touchSeen = false, disposed = false;

  function listen(target, type, fn, options) {
    target?.addEventListener?.(type, fn, options);
    if (target?.removeEventListener) listeners.push(() => target.removeEventListener(type, fn, options));
  }
  function reset() {
    keys.clear();
    buttons.clear();
    touches.clear();
    overlays.clear();
    lookX = lookY = 0;
  }
  function keyDown(event) {
    if (editable(event) || !event.code) return;
    keys.add(event.code);
  }
  function keyUp(event) {
    if (event.code) keys.delete(event.code);
  }
  function hasKey(code) {
    return keyInput?.isDown?.(code) ?? keys.has(code);
  }
  function action(name) {
    if (overlays.get(name)) return true;
    if (name === 'fire' && buttons.has(0)) return true;
    if (name === 'ads' && buttons.has(2)) return true;
    return KEYS[name]?.some(hasKey) || false;
  }
  function onLockChange() {
    locked = documentRef?.pointerLockElement === canvas;
    if (!locked) buttons.clear();
  }
  function onMouseMove(event) {
    if (!locked || event.pointerType === 'touch') return;
    const factor = 0.0025 * sensitivity;
    lookX += (Number(event.movementX) || 0) * factor;
    lookY += (Number(event.movementY) || 0) * factor * (invertY ? -1 : 1);
  }
  function onPointerDown(event) {
    if (event.pointerType === 'touch') {
      if (!touchEnabled) return;
      touchSeen = true;
      const rect = canvas.getBoundingClientRect();
      const px = (Number(event.clientX) || 0) - rect.left;
      const py = (Number(event.clientY) || 0) - rect.top;
      const zone = px < rect.width / 2 ? 'move' : 'look';
      // Exactly one active thumb per zone.
      if ([...touches.values()].some(touch => touch.zone === zone)) return;
      touches.set(event.pointerId, { zone, startX:px, startY:py, x:px, y:py });
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault?.();
      return;
    }
    buttons.add(event.button ?? 0);
  }
  function onPointerMove(event) {
    if (event.pointerType !== 'touch') return;
    const touch = touches.get(event.pointerId);
    if (!touch) return;
    const rect = canvas.getBoundingClientRect();
    const x = (Number(event.clientX) || 0) - rect.left;
    const y = (Number(event.clientY) || 0) - rect.top;
    if (touch.zone === 'look') {
      lookX += (x - touch.x) * 0.0025 * sensitivity;
      lookY += (y - touch.y) * 0.0025 * sensitivity * (invertY ? -1 : 1);
    }
    touch.x = x;
    touch.y = y;
    event.preventDefault?.();
  }
  function onPointerUp(event) {
    if (event.pointerType === 'touch') {
      touches.delete(event.pointerId);
      canvas.releasePointerCapture?.(event.pointerId);
      return;
    }
    buttons.delete(event.button ?? 0);
  }
  function firstGamepad() {
    if (!gamepadEnabled || typeof navigatorRef?.getGamepads !== 'function') return null;
    try {
      return Array.from(navigatorRef.getGamepads() || []).find(p =>
        p?.connected && (!p.mapping || p.mapping === 'standard')) ?? null;
    } catch {
      return null;
    }
  }
  function pressed(pad, index) {
    const button = pad?.buttons?.[index];
    return Boolean(button?.pressed || (button?.value ?? 0) > 0.5);
  }
  function sample(dt = 1/60) {
    if (disposed) throw new Error('FPS input disposed');
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid FPS input delta');
    let x = Number(hasKey('KeyD') || hasKey('ArrowRight')) -
      Number(hasKey('KeyA') || hasKey('ArrowLeft'));
    let y = Number(hasKey('KeyS') || hasKey('ArrowDown')) -
      Number(hasKey('KeyW') || hasKey('ArrowUp'));
    for (const touch of touches.values()) if (touch.zone === 'move') {
      x += clamp((touch.x - touch.startX) / touchRadius, -1, 1);
      y += clamp((touch.y - touch.startY) / touchRadius, -1, 1);
    }
    const pad = firstGamepad();
    if (pad) {
      x += deadzone(pad.axes?.[0], stickDeadzone);
      y += deadzone(pad.axes?.[1], stickDeadzone);
      const lookDt = Math.min(dt, 0.05);
      lookX += deadzone(pad.axes?.[2], stickDeadzone) * gamepadLookRate * lookDt;
      lookY += deadzone(pad.axes?.[3], stickDeadzone) * gamepadLookRate * lookDt *
        (invertY ? -1 : 1);
    }
    const move = magnitude(clamp(x, -1, 1), clamp(y, -1, 1));
    return {
      move,
      fire: action('fire') || pressed(pad, 7),
      ads: action('ads') || pressed(pad, 6),
      sprint: action('sprint') || pressed(pad, 10),
      crouch: action('crouch') || pressed(pad, 1),
      jump: action('jump') || pressed(pad, 0),
      reload: action('reload') || pressed(pad, 2),
      melee: action('melee') || pressed(pad, 3),
      interact: action('interact') || pressed(pad, 4),
      pause: action('pause') || pressed(pad, 9),
      locked,
      touch: touchSeen,
      gamepad: Boolean(pad),
    };
  }
  function consumeLook() {
    const result = { dx: lookX, dy: lookY };
    lookX = 0;
    lookY = 0;
    return result;
  }
  async function requestLock() {
    if (disposed || !pointerLockEnabled || !canvas.requestPointerLock) return false;
    try {
      await canvas.requestPointerLock();
      return documentRef?.pointerLockElement === canvas;
    } catch {
      return false;
    }
  }
  function releaseLock() {
    if (documentRef?.pointerLockElement === canvas) documentRef.exitPointerLock?.();
  }
  function setAction(name, value) {
    if (!ACTIONS.includes(name)) throw new Error('Unknown FPS action: ' + name);
    if (disposed) throw new Error('FPS input disposed');
    overlays.set(name, Boolean(value));
  }
  function dispose() {
    if (disposed) return false;
    releaseLock();
    disposed = true;
    for (const off of listeners.splice(0)) off();
    reset();
    return true;
  }

  // Own keyboard listeners only when not already consuming V1 input.
  if (!keyInput) {
    listen(windowRef, 'keydown', keyDown);
    listen(windowRef, 'keyup', keyUp);
  }
  listen(windowRef, 'blur', reset);
  listen(documentRef, 'visibilitychange', () => { if (documentRef.hidden) reset(); });
  listen(documentRef, 'pointerlockchange', onLockChange);
  listen(documentRef, 'pointermove', onMouseMove);
  listen(canvas, 'pointerdown', onPointerDown);
  listen(canvas, 'pointermove', onPointerMove);
  listen(canvas, 'pointerup', onPointerUp);
  listen(canvas, 'pointercancel', onPointerUp);
  listen(canvas, 'contextmenu', event => { if (locked) event.preventDefault?.(); });
  return Object.freeze({
    sample, consumeLook, requestLock, releaseLock, reset, setAction, dispose,
    get locked() { return locked; },
  });
}
