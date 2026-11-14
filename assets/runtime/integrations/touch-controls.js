import { computeSplitScreenViews } from '../platform/input.js';

const STYLE_ATTR = 'data-hgame-touch-controls';
const DEFAULT_BUTTON_DIAMETER = 52;

const ARC_COORDS = Object.freeze({
  j: Object.freeze({ right: 8, bottom: 8, size: 64, primary: true }),
  k: Object.freeze({ right: 84, bottom: 14, size: 52, primary: false }),
  l: Object.freeze({ right: 70, bottom: 82, size: 52, primary: false }),
  u: Object.freeze({ right: 10, bottom: 86, size: 52, primary: false }),
  i: Object.freeze({ right: 146, bottom: 26, size: 50, primary: false }),
  o: Object.freeze({ right: 132, bottom: 94, size: 50, primary: false }),
  q: Object.freeze({ right: 78, bottom: 150, size: 42, extra: true }),
  e: Object.freeze({ right: 16, bottom: 154, size: 42, extra: true }),
});

const GRID_COORDS = Object.freeze({
  j: Object.freeze({ right: 132, bottom: 8, size: 52, primary: true }),
  k: Object.freeze({ right: 70, bottom: 8, size: 52, primary: false }),
  l: Object.freeze({ right: 8, bottom: 8, size: 52, primary: false }),
  u: Object.freeze({ right: 132, bottom: 72, size: 52, primary: false }),
  i: Object.freeze({ right: 70, bottom: 72, size: 52, primary: false }),
  o: Object.freeze({ right: 8, bottom: 72, size: 52, primary: false }),
  q: Object.freeze({ right: 122, bottom: 136, size: 42, extra: true }),
  e: Object.freeze({ right: 66, bottom: 136, size: 42, extra: true }),
});

const TOUCH_STYLESHEET = `
.hgame-touch-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 20;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  font-family: system-ui, -apple-system, sans-serif;
}
.hgame-touch-root[data-visible="false"] {
  display: none;
}
.hgame-touch-pane {
  position: absolute;
  pointer-events: none;
  overflow: hidden;
}
.hgame-joy-zone {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 48%;
  height: 68%;
  pointer-events: auto;
  touch-action: none;
}
.hgame-joy-base {
  position: absolute;
  left: max(22px, env(safe-area-inset-left, 0px) + 18px);
  bottom: max(22px, env(safe-area-inset-bottom, 0px) + 18px);
  width: 112px;
  height: 112px;
  margin-left: 0;
  margin-bottom: 0;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.28);
  background: radial-gradient(circle, rgba(255, 255, 255, 0.1) 0%, rgba(16, 24, 32, 0.34) 100%);
  box-sizing: border-box;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.12s ease;
}
.hgame-joy-base[data-floating="true"] {
  left: 0;
  bottom: auto;
  top: 0;
  transform: translate(-50%, -50%);
  opacity: 0;
}
.hgame-joy-base[data-floating="true"][data-active="true"] {
  opacity: 0.96;
}
.hgame-joy-knob {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.42);
  border: 1.5px solid rgba(255, 255, 255, 0.72);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
  box-sizing: border-box;
  will-change: transform;
}
.hgame-btn-cluster {
  position: absolute;
  right: max(16px, env(safe-area-inset-right, 0px) + 12px);
  bottom: max(16px, env(safe-area-inset-bottom, 0px) + 12px);
  width: 210px;
  height: 210px;
  pointer-events: none;
}
.hgame-touch-pane[data-compact="true"] .hgame-btn-cluster {
  transform: scale(0.84);
  transform-origin: bottom right;
}
.hgame-skill-btn {
  position: absolute;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.38);
  background: rgba(18, 28, 40, 0.56);
  color: #f4f8fb;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  pointer-events: auto;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  overflow: hidden;
  box-sizing: border-box;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.1;
}
.hgame-skill-btn[data-extra="true"] {
  border-radius: 14px;
  background: rgba(24, 34, 48, 0.48);
  font-size: 11px;
}
.hgame-skill-btn[data-active="true"] {
  transform: scale(0.92);
  border-color: rgba(103, 217, 186, 0.95);
  background: rgba(45, 118, 102, 0.72);
}
.hgame-skill-btn[data-disabled="true"] {
  opacity: 0.4;
}
.hgame-btn-label {
  z-index: 2;
  pointer-events: none;
  padding: 0 3px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
}
.hgame-btn-key {
  z-index: 2;
  pointer-events: none;
  font-size: 9px;
  opacity: 0.72;
  margin-top: 1px;
}
.hgame-touch-root[data-show-hints="false"] .hgame-btn-key {
  display: none;
}
.hgame-btn-cd {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(8, 12, 18, 0.68);
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
  pointer-events: none;
}
.hgame-skill-btn[data-cooldown="true"] .hgame-btn-cd {
  display: flex;
}
`;

export function applyRadialDeadzone(dx, dy, radius, deadzone = 0.12) {
  const r = Number.isFinite(radius) && radius > 0 ? radius : 56;
  const dz = Number.isFinite(deadzone) ? Math.max(0, Math.min(0.95, deadzone)) : 0;
  const dist = Math.hypot(dx, dy);
  if (dist <= 1e-8) {
    return { x: 0, y: 0, magnitude: 0, knobX: 0, knobY: 0 };
  }
  const ux = dx / dist;
  const uy = dy / dist;
  const clampedPx = Math.min(dist, r);
  const knobX = ux * clampedPx;
  const knobY = uy * clampedPx;
  const normDist = dist / r;
  if (normDist <= dz) {
    return { x: 0, y: 0, magnitude: 0, knobX, knobY };
  }
  const magnitude = Math.min(1, (normDist - dz) / (1 - dz));
  return {
    x: ux * magnitude,
    y: uy * magnitude,
    magnitude,
    knobX,
    knobY,
  };
}

function setElementStyle(el, key, value) {
  if (!el?.style) return;
  if (typeof el.style.setProperty === 'function') {
    el.style.setProperty(key, value);
  } else {
    el.style[key] = value;
  }
}

function injectStylesheet(documentRef) {
  const head = documentRef.head;
  if (!head || typeof documentRef.createElement !== 'function') return;
  if (typeof head.querySelector === 'function' && head.querySelector(`style[${STYLE_ATTR}]`)) return;
  if (Array.isArray(head.children) && head.children.some(c => c?.getAttribute?.(STYLE_ATTR))) return;
  const styleEl = documentRef.createElement('style');
  styleEl.setAttribute(STYLE_ATTR, '1');
  styleEl.textContent = TOUCH_STYLESHEET;
  head.appendChild(styleEl);
}

/**
 * Opt-in virtual joystick + skill button overlay synced with `createArcadeControls`.
 * Default mode `'touch-only'` stays invisible on desktop mouse/keyboard until touch is detected.
 */
export function createTouchControls({
  controls,
  container = globalThis.document?.body ?? null,
  documentRef = globalThis.document ?? null,
  windowRef = globalThis.window ?? null,
  navigatorRef = globalThis.navigator ?? null,
  mode = 'touch-only',
  joystick = 'floating',
  joystickRadius = 56,
  deadzone = 0.12,
  buttonLayout = 'arc',
  showKeyHints = 'auto',
  splitDirection = 'auto',
} = {}) {
  const playerList = Array.isArray(controls?.players)
    ? controls.players
    : (controls && typeof controls.setVirtualStick === 'function' ? [controls] : null);
  if (!playerList || playerList.length === 0) {
    throw new TypeError('createTouchControls requires controls from createArcadeControls or a player controller');
  }
  if (!container?.appendChild || typeof documentRef?.createElement !== 'function') {
    throw new TypeError('createTouchControls requires a valid DOM container and documentRef');
  }
  if (mode !== 'touch-only' && mode !== 'always' && mode !== 'hidden') {
    throw new RangeError('Touch controls mode must be "touch-only", "always", or "hidden"');
  }
  if (joystick !== 'floating' && joystick !== 'fixed' && joystick !== false) {
    throw new RangeError('Touch controls joystick must be "floating", "fixed", or false');
  }
  if (buttonLayout !== 'arc' && buttonLayout !== 'grid') {
    throw new RangeError('Touch controls buttonLayout must be "arc" or "grid"');
  }
  if (!Number.isFinite(joystickRadius) || joystickRadius < 16 || joystickRadius > 240) {
    throw new RangeError('joystickRadius must be in 16..240');
  }
  if (!Number.isFinite(deadzone) || deadzone < 0 || deadzone >= 0.95) {
    throw new RangeError('deadzone must be in [0, 0.95)');
  }

  injectStylesheet(documentRef);

  const coarseDevice = Boolean(
    (navigatorRef?.maxTouchPoints ?? 0) > 0 ||
    windowRef?.matchMedia?.('(pointer: coarse)')?.matches,
  );
  let touchDetected = false;
  let currentMode = mode;
  let currentLayout = buttonLayout;
  let disposed = false;

  const listeners = [];
  function listen(target, type, fn, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, fn, options);
    if (typeof target.removeEventListener === 'function') {
      listeners.push(() => target.removeEventListener(type, fn, options));
    }
  }

  const root = documentRef.createElement('div');
  root.className = 'hgame-touch-root';
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('data-hgame-touch-root', '1');

  function computeShowHints() {
    if (showKeyHints === true) return true;
    if (showKeyHints === false) return false;
    return !coarseDevice;
  }

  function isVisible() {
    if (currentMode === 'always') return true;
    if (currentMode === 'hidden') return false;
    return coarseDevice || touchDetected;
  }

  function syncVisibility() {
    const visible = isVisible();
    root.setAttribute('data-visible', visible ? 'true' : 'false');
    root.setAttribute('data-mode', currentMode);
    root.setAttribute('data-show-hints', computeShowHints() ? 'true' : 'false');
  }

  const panes = [];

  for (let pIndex = 0; pIndex < playerList.length; pIndex++) {
    const player = playerList[pIndex];
    const paneEl = documentRef.createElement('div');
    paneEl.className = 'hgame-touch-pane';
    paneEl.setAttribute('data-player', player.id || `p${pIndex + 1}`);

    const paneState = {
      index: pIndex,
      player,
      paneEl,
      joyZoneEl: null,
      joyBaseEl: null,
      joyKnobEl: null,
      joyPointerId: null,
      joyOriginX: 0,
      joyOriginY: 0,
      buttonsByKey: new Map(),
      buttonList: [],
    };

    if (joystick !== false) {
      const joyZoneEl = documentRef.createElement('div');
      joyZoneEl.className = 'hgame-joy-zone';
      const joyBaseEl = documentRef.createElement('div');
      joyBaseEl.className = 'hgame-joy-base';
      joyBaseEl.setAttribute('data-floating', joystick === 'floating' ? 'true' : 'false');
      joyBaseEl.setAttribute('data-active', joystick === 'fixed' ? 'true' : 'false');
      const diameter = Math.round(joystickRadius * 2);
      setElementStyle(joyBaseEl, 'width', `${diameter}px`);
      setElementStyle(joyBaseEl, 'height', `${diameter}px`);

      const joyKnobEl = documentRef.createElement('div');
      joyKnobEl.className = 'hgame-joy-knob';
      joyBaseEl.appendChild(joyKnobEl);
      joyZoneEl.appendChild(joyBaseEl);
      paneEl.appendChild(joyZoneEl);

      paneState.joyZoneEl = joyZoneEl;
      paneState.joyBaseEl = joyBaseEl;
      paneState.joyKnobEl = joyKnobEl;

      const updateStick = (clientX, clientY) => {
        const dx = clientX - paneState.joyOriginX;
        const dy = clientY - paneState.joyOriginY;
        const res = applyRadialDeadzone(dx, dy, joystickRadius, deadzone);
        setElementStyle(joyKnobEl, 'transform', `translate3d(${res.knobX.toFixed(1)}px, ${res.knobY.toFixed(1)}px, 0)`);
        const stickY = player.yAxis === 'up' ? -res.y : res.y;
        player.setVirtualStick(res.x, stickY);
      };

      const releaseStick = (pointerId = null) => {
        if (pointerId !== null && pointerId !== paneState.joyPointerId) return;
        const prevId = paneState.joyPointerId;
        paneState.joyPointerId = null;
        if (prevId !== null) joyZoneEl.releasePointerCapture?.(prevId);
        if (joystick === 'floating') {
          joyBaseEl.setAttribute('data-active', 'false');
        }
        setElementStyle(joyKnobEl, 'transform', 'translate3d(0px, 0px, 0)');
        player.clearVirtualStick();
      };
      paneState.releaseStick = releaseStick;

      listen(joyZoneEl, 'pointerdown', event => {
        if (disposed || paneState.joyPointerId !== null) return;
        const id = event.pointerId ?? 'mouse';
        paneState.joyPointerId = id;
        const clientX = Number(event.clientX) || 0;
        const clientY = Number(event.clientY) || 0;

        if (joystick === 'floating') {
          const zRect = joyZoneEl.getBoundingClientRect?.() ?? { left: 0, top: 0 };
          paneState.joyOriginX = clientX;
          paneState.joyOriginY = clientY;
          setElementStyle(joyBaseEl, 'left', `${(clientX - (zRect.left || 0)).toFixed(1)}px`);
          setElementStyle(joyBaseEl, 'top', `${(clientY - (zRect.top || 0)).toFixed(1)}px`);
          joyBaseEl.setAttribute('data-active', 'true');
        } else {
          const bRect = joyBaseEl.getBoundingClientRect?.();
          if (bRect && bRect.width > 0 && bRect.height > 0) {
            paneState.joyOriginX = bRect.left + bRect.width * 0.5;
            paneState.joyOriginY = bRect.top + bRect.height * 0.5;
          } else {
            paneState.joyOriginX = clientX;
            paneState.joyOriginY = clientY;
          }
          joyBaseEl.setAttribute('data-active', 'true');
        }
        joyZoneEl.setPointerCapture?.(id);
        event.preventDefault?.();
        updateStick(clientX, clientY);
      });

      listen(joyZoneEl, 'pointermove', event => {
        const id = event.pointerId ?? 'mouse';
        if (disposed || paneState.joyPointerId !== id) return;
        event.preventDefault?.();
        updateStick(Number(event.clientX) || 0, Number(event.clientY) || 0);
      });

      listen(joyZoneEl, 'pointerup', event => {
        releaseStick(event.pointerId ?? 'mouse');
      });
      listen(joyZoneEl, 'pointercancel', event => {
        releaseStick(event.pointerId ?? 'mouse');
      });
      listen(joyZoneEl, 'lostpointercapture', event => {
        releaseStick(event.pointerId ?? 'mouse');
      });
    }

    if (player.bindings.length > 0) {
      const clusterEl = documentRef.createElement('div');
      clusterEl.className = 'hgame-btn-cluster';
      paneEl.appendChild(clusterEl);
      paneState.clusterEl = clusterEl;

      for (const binding of player.bindings) {
        const btnEl = documentRef.createElement('button');
        btnEl.type = 'button';
        btnEl.className = 'hgame-skill-btn';
        btnEl.setAttribute('data-slot', binding.slot);
        btnEl.setAttribute('data-action', binding.name);
        btnEl.setAttribute('data-extra', binding.isExtra ? 'true' : 'false');
        btnEl.setAttribute('data-active', 'false');
        btnEl.setAttribute('data-disabled', 'false');
        btnEl.setAttribute('data-cooldown', 'false');
        btnEl.setAttribute('tabindex', '-1');

        const labelEl = documentRef.createElement('span');
        labelEl.className = 'hgame-btn-label';
        labelEl.textContent = binding.label;

        const keyEl = documentRef.createElement('span');
        keyEl.className = 'hgame-btn-key';
        keyEl.textContent = binding.keyLabel;

        const cdEl = documentRef.createElement('span');
        cdEl.className = 'hgame-btn-cd';
        cdEl.textContent = '';

        btnEl.appendChild(labelEl);
        btnEl.appendChild(keyEl);
        btnEl.appendChild(cdEl);
        clusterEl.appendChild(btnEl);

        const activeIds = new Set();
        const btnEntry = {
          binding,
          btnEl,
          labelEl,
          keyEl,
          cdEl,
          activeIds,
          enabled: true,
        };

        const syncBtnState = () => {
          const isPressed = btnEntry.enabled && activeIds.size > 0;
          btnEl.setAttribute('data-active', isPressed ? 'true' : 'false');
          player.setVirtualButton(binding.name, isPressed);
        };
        btnEntry.forceRelease = () => {
          for (const pid of activeIds) btnEl.releasePointerCapture?.(pid);
          activeIds.clear();
          syncBtnState();
        };

        listen(btnEl, 'pointerdown', event => {
          if (disposed || !btnEntry.enabled) return;
          const id = event.pointerId ?? 'mouse';
          activeIds.add(id);
          btnEl.setPointerCapture?.(id);
          event.preventDefault?.();
          syncBtnState();
        });

        const onBtnEnd = event => {
          const id = event.pointerId ?? 'mouse';
          if (activeIds.delete(id)) {
            syncBtnState();
          }
        };
        listen(btnEl, 'pointerup', onBtnEnd);
        listen(btnEl, 'pointercancel', onBtnEnd);
        listen(btnEl, 'lostpointercapture', onBtnEnd);

        paneState.buttonsByKey.set(binding.name, btnEntry);
        paneState.buttonsByKey.set(binding.slot, btnEntry);
        paneState.buttonList.push(btnEntry);
      }
    }

    root.appendChild(paneEl);
    panes.push(paneState);
  }

  function applyButtonPositions() {
    const table = currentLayout === 'grid' ? GRID_COORDS : ARC_COORDS;
    root.setAttribute('data-button-layout', currentLayout);
    for (const pane of panes) {
      for (const btn of pane.buttonList) {
        const spec = table[btn.binding.slot] ?? { right: 8, bottom: 8, size: DEFAULT_BUTTON_DIAMETER };
        const w = btn.binding.isExtra ? Math.max(spec.size, 44) : spec.size;
        const h = spec.size;
        setElementStyle(btn.btnEl, 'right', `${spec.right}px`);
        setElementStyle(btn.btnEl, 'bottom', `${spec.bottom}px`);
        setElementStyle(btn.btnEl, 'width', `${w}px`);
        setElementStyle(btn.btnEl, 'height', `${h}px`);
      }
    }
  }

  function refreshLayout() {
    const w = windowRef?.innerWidth || container.clientWidth || 960;
    const h = windowRef?.innerHeight || container.clientHeight || 540;
    const views = computeSplitScreenViews(panes.length, {
      direction: splitDirection,
      width: w,
      height: h,
    });
    for (let i = 0; i < panes.length; i++) {
      const pane = panes[i];
      const v = views[i];
      setElementStyle(pane.paneEl, 'left', `${(v.x * 100).toFixed(4)}%`);
      setElementStyle(pane.paneEl, 'top', `${(v.y * 100).toFixed(4)}%`);
      setElementStyle(pane.paneEl, 'width', `${(v.width * 100).toFixed(4)}%`);
      setElementStyle(pane.paneEl, 'height', `${(v.height * 100).toFixed(4)}%`);
      pane.paneEl.setAttribute('data-compact', panes.length > 1 ? 'true' : 'false');
    }
  }

  function releaseAll() {
    for (const pane of panes) {
      pane.releaseStick?.(null);
      for (const btn of pane.buttonList) {
        btn.forceRelease();
      }
    }
  }

  if (windowRef) {
    listen(windowRef, 'pointerdown', event => {
      if (disposed || touchDetected) return;
      if (event.pointerType === 'touch') {
        touchDetected = true;
        if (currentMode === 'touch-only') syncVisibility();
      }
    }, { passive: true, capture: true });
    listen(windowRef, 'blur', releaseAll);
    listen(windowRef, 'resize', refreshLayout);
  }
  if (documentRef) {
    listen(documentRef, 'visibilitychange', () => {
      if (documentRef.hidden) releaseAll();
    });
  }

  applyButtonPositions();
  refreshLayout();
  syncVisibility();
  container.appendChild(root);

  function findButton(nameOrSlot, playerIndex = 0) {
    const pane = panes[playerIndex];
    if (!pane) return null;
    return pane.buttonsByKey.get(nameOrSlot) ?? null;
  }

  return Object.freeze({
    root,
    get visible() { return isVisible(); },
    get mode() { return currentMode; },
    get buttonLayout() { return currentLayout; },
    setMode(nextMode) {
      if (nextMode !== 'touch-only' && nextMode !== 'always' && nextMode !== 'hidden') {
        throw new RangeError('Touch controls mode must be "touch-only", "always", or "hidden"');
      }
      currentMode = nextMode;
      if (!isVisible()) releaseAll();
      syncVisibility();
    },
    setButtonLayout(nextLayout) {
      if (nextLayout !== 'arc' && nextLayout !== 'grid') {
        throw new RangeError('Touch controls buttonLayout must be "arc" or "grid"');
      }
      currentLayout = nextLayout;
      applyButtonPositions();
    },
    setCooldown(nameOrSlot, remainingSeconds, totalSeconds = remainingSeconds, playerIndex = 0) {
      const btn = findButton(nameOrSlot, playerIndex);
      if (!btn) return false;
      const rem = Number.isFinite(remainingSeconds) && remainingSeconds > 0 ? remainingSeconds : 0;
      const tot = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : (rem || 1);
      const ratio = rem > 0 ? Math.max(0, Math.min(1, rem / tot)) : 0;
      btn.btnEl.setAttribute('data-cooldown', rem > 0 ? 'true' : 'false');
      setElementStyle(btn.btnEl, '--cd-ratio', String(ratio));
      btn.cdEl.textContent = rem > 0 ? (rem < 1 ? rem.toFixed(1) : String(Math.ceil(rem))) : '';
      return true;
    },
    setButtonEnabled(nameOrSlot, enabled, playerIndex = 0) {
      const btn = findButton(nameOrSlot, playerIndex);
      if (!btn) return false;
      btn.enabled = Boolean(enabled);
      btn.btnEl.setAttribute('data-disabled', btn.enabled ? 'false' : 'true');
      if (!btn.enabled) btn.forceRelease();
      return true;
    },
    setButtonLabel(nameOrSlot, label, playerIndex = 0) {
      const btn = findButton(nameOrSlot, playerIndex);
      if (!btn) return false;
      btn.labelEl.textContent = String(label ?? '');
      return true;
    },
    refreshLayout,
    releaseAll,
    dispose() {
      if (disposed) return false;
      releaseAll();
      disposed = true;
      for (const off of listeners.splice(0)) off();
      if (root.parentNode && typeof root.parentNode.removeChild === 'function') {
        root.parentNode.removeChild(root);
      } else {
        root.remove?.();
      }
      return true;
    },
  });
}
