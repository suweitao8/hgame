import { EASING, SpringDamper1D } from '../time/tween.js';

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

/**
 * @typedef {object} UiStaggerOptions
 * @property {number} [delay=0.045] Seconds between consecutive items.
 * @property {number} [duration=0.24] Entrance duration in seconds per item.
 * @property {keyof typeof EASING | ((t: number) => number)} [ease='easeOutBack'] Easing function or name.
 */

/**
 * Computes staggered entrance progress for card/menu reveals.
 * Returns a value starting at `0` before the item's delay and reaching `1` when settled
 * (may overshoot slightly above `1` when using `'easeOutBack'`).
 *
 * @param {number} elapsed Seconds elapsed since entrance began.
 * @param {number} index Zero-based item index.
 * @param {UiStaggerOptions} [options={}]
 * @returns {number}
 */
export function computeStaggerProgress(elapsed, index, options = {}) {
  const delay = Number.isFinite(options.delay) && options.delay >= 0 ? options.delay : 0.045;
  const duration = Number.isFinite(options.duration) && options.duration > 0 ? options.duration : 0.24;
  const idx = Number.isFinite(index) && index > 0 ? index : 0;
  const local = (Number.isFinite(elapsed) ? elapsed : 0) - idx * delay;
  if (local <= 0) return 0;
  const t = clamp(local / duration, 0, 1);
  const easeSpec = options.ease ?? 'easeOutBack';
  const easeFn = typeof easeSpec === 'function' ? easeSpec : (EASING[easeSpec] ?? EASING.easeOutCubic);
  return easeFn(t);
}

/**
 * @typedef {object} UiSurfaceSpringOptions
 * @property {number} [maxTiltDeg=11] Maximum 3D tilt angle in degrees along X/Y axes.
 * @property {number} [hoverScale=1.045] Target scale while hovered or focused.
 * @property {number} [pressScale=0.96] Target scale while pressed.
 * @property {number} [selectedScale=1.03] Target scale while selected.
 * @property {number} [hoverLift=-6] Vertical/Z lift offset while hovered (negative lifts up in CSS Y).
 * @property {number} [pressLift=1.5] Offset while pressed.
 * @property {number} [tiltHalfLife=0.08] Critically damped spring half-life (seconds) for tilt & glare.
 * @property {number} [scaleHalfLife=0.075] Spring half-life (seconds) for scale & lift.
 * @property {number} [idleFloatAmp=0] Optional sinusoidal floating amplitude (0 disables idle motion).
 * @property {number} [idleFloatSpeed=2.1] Idle floating angular frequency (rad/s).
 * @property {number} [idlePhase=0] Initial phase offset (radians) for desynchronized multi-card float.
 * @property {number} [perspective=800] Perspective distance (px) used by `toCssTransform`.
 * @property {boolean} [invertTilt=false] Invert pointer-to-tilt sign.
 */

/**
 * @typedef {object} UiSurfaceSpringState
 * @property {number} tiltX Pitch angle in degrees.
 * @property {number} tiltY Yaw angle in degrees.
 * @property {number} scale Current uniform scale.
 * @property {number} lift Current vertical/depth lift offset.
 * @property {number} floatOffset Current idle breathing offset.
 * @property {number} glareX Specular highlight X percentage (0..100).
 * @property {number} glareY Specular highlight Y percentage (0..100).
 * @property {number} glareOpacity Specular highlight opacity (0..1).
 * @property {number} glow Focus/hover glow strength (0..1).
 * @property {boolean} hovered
 * @property {boolean} pressed
 * @property {boolean} focused
 * @property {boolean} selected
 * @property {boolean} disabled
 * @property {boolean} settled
 */

/**
 * Headless spring-physics driver for interactive UI surfaces (DOM cards/buttons, Canvas, Pixi, or 3D meshes).
 * Computes zero-allocation 3D perspective tilt, hover elevation, press squash, specular glare, and idle float.
 *
 * @param {UiSurfaceSpringOptions} [options={}]
 */
export function createUiSurfaceSpring(options = {}) {
  const maxTiltDeg = Number.isFinite(options.maxTiltDeg) ? Math.max(0, options.maxTiltDeg) : 11;
  const hoverScale = Number.isFinite(options.hoverScale) ? options.hoverScale : 1.045;
  const pressScale = Number.isFinite(options.pressScale) ? options.pressScale : 0.96;
  const selectedScale = Number.isFinite(options.selectedScale) ? options.selectedScale : 1.03;
  const hoverLift = Number.isFinite(options.hoverLift) ? options.hoverLift : -6;
  const pressLift = Number.isFinite(options.pressLift) ? options.pressLift : 1.5;
  const tiltHalfLife = Number.isFinite(options.tiltHalfLife) && options.tiltHalfLife > 0 ? options.tiltHalfLife : 0.08;
  const scaleHalfLife = Number.isFinite(options.scaleHalfLife) && options.scaleHalfLife > 0 ? options.scaleHalfLife : 0.075;
  const idleFloatAmp = Number.isFinite(options.idleFloatAmp) ? Math.max(0, options.idleFloatAmp) : 0;
  const idleFloatSpeed = Number.isFinite(options.idleFloatSpeed) ? options.idleFloatSpeed : 2.1;
  const perspective = Number.isFinite(options.perspective) && options.perspective > 0 ? options.perspective : 800;
  const tiltSign = options.invertTilt ? -1 : 1;

  let hovered = false;
  let pressed = false;
  let focused = false;
  let selected = false;
  let disabled = false;
  let pointerNx = 0;
  let pointerNy = 0;
  let floatTime = Number.isFinite(options.idlePhase) ? options.idlePhase : 0;

  const tiltXSpring = new SpringDamper1D({ value: 0, halfLife: tiltHalfLife });
  const tiltYSpring = new SpringDamper1D({ value: 0, halfLife: tiltHalfLife });
  const scaleSpring = new SpringDamper1D({ value: 1, halfLife: scaleHalfLife });
  const liftSpring = new SpringDamper1D({ value: 0, halfLife: scaleHalfLife });
  const glareXSpring = new SpringDamper1D({ value: 50, halfLife: tiltHalfLife });
  const glareYSpring = new SpringDamper1D({ value: 50, halfLife: tiltHalfLife });
  const glareOpacitySpring = new SpringDamper1D({ value: 0, halfLife: tiltHalfLife });
  const glowSpring = new SpringDamper1D({ value: 0, halfLife: scaleHalfLife });

  /** @type {UiSurfaceSpringState} */
  const state = {
    tiltX: 0,
    tiltY: 0,
    scale: 1,
    lift: 0,
    floatOffset: 0,
    glareX: 50,
    glareY: 50,
    glareOpacity: 0,
    glow: 0,
    hovered: false,
    pressed: false,
    focused: false,
    selected: false,
    disabled: false,
    settled: true,
  };

  function syncTargets() {
    const activeHover = !disabled && hovered;
    const activeFocus = !disabled && focused;
    const activePress = !disabled && pressed;
    const activeSelect = !disabled && selected;

    let targetScale = 1;
    let targetLift = 0;
    let targetTiltX = 0;
    let targetTiltY = 0;
    let targetGlareX = 50;
    let targetGlareY = 50;
    let targetGlareOpacity = 0;
    let targetGlow = 0;

    if (activePress) {
      targetScale = pressScale;
      targetLift = pressLift;
      targetGlow = 0.85;
    } else if (activeHover || activeFocus) {
      targetScale = hoverScale;
      targetLift = hoverLift;
      targetGlow = activeHover ? 1 : 0.7;
    } else if (activeSelect) {
      targetScale = selectedScale;
      targetLift = hoverLift * 0.5;
      targetGlow = 0.6;
    }

    if (activeHover) {
      // Top pointer tilts top edge back (+rotateX), right pointer tilts right edge forward (+rotateY).
      targetTiltX = clamp(-pointerNy, -1, 1) * maxTiltDeg * tiltSign;
      targetTiltY = clamp(pointerNx, -1, 1) * maxTiltDeg * tiltSign;
      targetGlareX = clamp((pointerNx * 0.5 + 0.5) * 100, 0, 100);
      targetGlareY = clamp((pointerNy * 0.5 + 0.5) * 100, 0, 100);
      targetGlareOpacity = activePress ? 0.35 : 0.75;
    } else if (activeFocus || activeSelect) {
      targetGlareOpacity = 0.25;
    }

    tiltXSpring.setTarget(targetTiltX);
    tiltYSpring.setTarget(targetTiltY);
    scaleSpring.setTarget(targetScale);
    liftSpring.setTarget(targetLift);
    glareXSpring.setTarget(targetGlareX);
    glareYSpring.setTarget(targetGlareY);
    glareOpacitySpring.setTarget(targetGlareOpacity);
    glowSpring.setTarget(targetGlow);
  }

  function refreshState() {
    const floatOffset = (!disabled && !pressed && idleFloatAmp > 0)
      ? Math.sin(floatTime * idleFloatSpeed) * idleFloatAmp
      : 0;
    state.tiltX = tiltXSpring.value;
    state.tiltY = tiltYSpring.value;
    state.scale = scaleSpring.value;
    state.lift = liftSpring.value + floatOffset;
    state.floatOffset = floatOffset;
    state.glareX = glareXSpring.value;
    state.glareY = glareYSpring.value;
    state.glareOpacity = glareOpacitySpring.value;
    state.glow = glowSpring.value;
    state.hovered = hovered;
    state.pressed = pressed;
    state.focused = focused;
    state.selected = selected;
    state.disabled = disabled;
    state.settled = idleFloatAmp === 0 && isSpringsSettled();
    return state;
  }

  function isSpringsSettled() {
    return (
      tiltXSpring.isSettled(1e-3, 1e-2) &&
      tiltYSpring.isSettled(1e-3, 1e-2) &&
      scaleSpring.isSettled(1e-4, 1e-3) &&
      liftSpring.isSettled(1e-2, 1e-1) &&
      glareXSpring.isSettled(1e-2, 1e-1) &&
      glareYSpring.isSettled(1e-2, 1e-1) &&
      glareOpacitySpring.isSettled(1e-3, 1e-2) &&
      glowSpring.isSettled(1e-3, 1e-2)
    );
  }

  function setPointerNorm(nx, ny) {
    pointerNx = clamp(Number.isFinite(nx) ? nx : 0, -1, 1);
    pointerNy = clamp(Number.isFinite(ny) ? ny : 0, -1, 1);
    syncTargets();
  }

  function setHover(active, nx = pointerNx, ny = pointerNy) {
    hovered = Boolean(active);
    if (hovered) {
      pointerNx = clamp(Number.isFinite(nx) ? nx : 0, -1, 1);
      pointerNy = clamp(Number.isFinite(ny) ? ny : 0, -1, 1);
    } else {
      pointerNx = 0;
      pointerNy = 0;
    }
    state.hovered = hovered;
    syncTargets();
  }

  function setPressed(active) {
    pressed = Boolean(active);
    state.pressed = pressed;
    syncTargets();
  }

  function setFocused(active) {
    focused = Boolean(active);
    state.focused = focused;
    syncTargets();
  }

  function setSelected(active) {
    selected = Boolean(active);
    state.selected = selected;
    syncTargets();
  }

  function setDisabled(value) {
    disabled = Boolean(value);
    if (disabled) {
      hovered = false;
      pressed = false;
      focused = false;
    }
    state.disabled = disabled;
    state.hovered = hovered;
    state.pressed = pressed;
    state.focused = focused;
    syncTargets();
  }

  function step(dt) {
    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    if (safeDt > 0) {
      floatTime += safeDt;
      tiltXSpring.step(safeDt);
      tiltYSpring.step(safeDt);
      scaleSpring.step(safeDt);
      liftSpring.step(safeDt);
      glareXSpring.step(safeDt);
      glareYSpring.step(safeDt);
      glareOpacitySpring.step(safeDt);
      glowSpring.step(safeDt);
    }
    return refreshState();
  }

  function snap() {
    syncTargets();
    tiltXSpring.snap();
    tiltYSpring.snap();
    scaleSpring.snap();
    liftSpring.snap();
    glareXSpring.snap();
    glareYSpring.snap();
    glareOpacitySpring.snap();
    glowSpring.snap();
    return refreshState();
  }

  function isSettled() {
    return idleFloatAmp === 0 && isSpringsSettled();
  }

  function toCssTransform() {
    const ty = state.lift.toFixed(2);
    const rx = state.tiltX.toFixed(2);
    const ry = state.tiltY.toFixed(2);
    const s = state.scale.toFixed(4);
    return `perspective(${perspective}px) translate3d(0, ${ty}px, 0) rotateX(${rx}deg) rotateY(${ry}deg) scale(${s})`;
  }

  syncTargets();
  refreshState();

  return Object.freeze({
    setPointerNorm,
    setHover,
    setPressed,
    setFocused,
    setSelected,
    setDisabled,
    step,
    snap,
    isSettled,
    getState: () => state,
    toCssTransform,
  });
}

/**
 * @typedef {object} UiMotionGroupOptions
 * @property {number} [count=0] Initial number of surface items.
 * @property {UiSurfaceSpringOptions} [surfaceOptions] Options forwarded to each item's surface spring.
 * @property {UiStaggerOptions} [staggerOptions] Options forwarded to `computeStaggerProgress`.
 * @property {boolean} [wrapNavigation=true] Wrap focus index on `moveFocus`.
 */

/**
 * Coordinates a group of interactive UI surfaces (e.g., 3-choice upgrade cards, menu buttons, shop items)
 * with keyboard/gamepad focus navigation, mutual selection, and staggered entrance progress.
 *
 * @param {UiMotionGroupOptions} [options={}]
 */
export function createUiMotionGroup(options = {}) {
  const surfaceOptions = options.surfaceOptions ?? {};
  const staggerOptions = options.staggerOptions ?? {};
  const wrapNavigation = options.wrapNavigation !== false;

  /** @type {ReturnType<typeof createUiSurfaceSpring>[]} */
  const items = [];
  let focusIndex = -1;
  let entranceElapsed = 0;
  let entranceActive = false;

  function setCount(nextCount) {
    const count = Math.max(0, nextCount | 0);
    while (items.length < count) {
      const idx = items.length;
      items.push(createUiSurfaceSpring({
        ...surfaceOptions,
        idlePhase: (surfaceOptions.idlePhase ?? 0) + idx * 0.85,
      }));
    }
    if (items.length > count) items.length = count;
    if (focusIndex >= count) focusIndex = count - 1;
    return items.length;
  }

  function getItem(index) {
    return items[index] ?? null;
  }

  function setFocus(index) {
    if (index < 0 || index >= items.length) {
      if (focusIndex >= 0 && items[focusIndex]) items[focusIndex].setFocused(false);
      focusIndex = -1;
      return -1;
    }
    if (focusIndex >= 0 && items[focusIndex] && focusIndex !== index) {
      items[focusIndex].setFocused(false);
    }
    focusIndex = index;
    items[focusIndex].setFocused(true);
    return focusIndex;
  }

  function moveFocus(delta) {
    if (items.length === 0) return -1;
    const stepDir = delta >= 0 ? 1 : -1;
    if (focusIndex < 0) {
      return setFocus(stepDir > 0 ? 0 : items.length - 1);
    }
    let next = focusIndex + stepDir;
    if (wrapNavigation) {
      next = (next % items.length + items.length) % items.length;
    } else {
      next = clamp(next, 0, items.length - 1);
    }
    return setFocus(next);
  }

  function triggerEntrance() {
    entranceElapsed = 0;
    entranceActive = true;
  }

  function getEntranceProgress(index) {
    if (!entranceActive) return 1;
    return computeStaggerProgress(entranceElapsed, index, staggerOptions);
  }

  function step(dt) {
    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    let active = false;
    if (entranceActive) {
      entranceElapsed += safeDt;
      const delay = Number.isFinite(staggerOptions.delay) ? staggerOptions.delay : 0.045;
      const duration = Number.isFinite(staggerOptions.duration) ? staggerOptions.duration : 0.24;
      const total = Math.max(0, items.length - 1) * delay + duration;
      if (entranceElapsed >= total) entranceActive = false;
      else active = true;
    }
    for (let i = 0; i < items.length; i++) {
      const st = items[i].step(safeDt);
      if (!st.settled) active = true;
    }
    return active;
  }

  setCount(options.count ?? 0);

  return Object.freeze({
    setCount,
    getCount: () => items.length,
    getItem,
    setFocus,
    getFocusIndex: () => focusIndex,
    moveFocus,
    triggerEntrance,
    getEntranceProgress,
    step,
  });
}
