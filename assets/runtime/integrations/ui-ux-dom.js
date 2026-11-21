import { createUiSurfaceSpring, computeStaggerProgress } from '../ui/ux-motion.js';
import { UI_UX_CUES } from '../ui/ux-director.js';

const STYLE_ATTR = 'data-hgame-ui-ux-styles';

const UI_UX_STYLESHEET = `
:where([data-ui-tilt], .card, button[data-ui-interactive]) {
  position: relative;
  transform-style: preserve-3d;
  will-change: transform;
}
:where([data-ui-tilt], .card, button):not([data-ui-static]):not(:disabled) {
  transition: box-shadow 180ms ease, border-color 180ms ease, filter 180ms ease;
}
:where([data-ui-tilt], .card, button):not([data-ui-static]):not(:disabled)::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  opacity: var(--hg-glare-o, 0);
  background: radial-gradient(
    circle at var(--hg-mx, 50%) var(--hg-my, 50%),
    rgba(255, 255, 255, 0.28),
    rgba(255, 255, 255, 0.06) 36%,
    transparent 70%
  );
  transition: opacity 160ms ease;
}
:where([data-ui-tilt], .card, button)[data-ui-hovered="true"]:not(:disabled) {
  box-shadow: 0 14px 28px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(255, 255, 255, 0.18);
  filter: brightness(1.06);
}
:where([data-ui-tilt], .card, button)[data-ui-pressed="true"]:not(:disabled) {
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.32);
  filter: brightness(0.96);
}
:where([data-ui-metric]) {
  display: inline-block;
  font-variant-numeric: tabular-nums;
  transition: color 140ms ease, transform 120ms cubic-bezier(0.22, 1, 0.36, 1);
  transform: scale(calc(1 + var(--hg-pulse, 0) * 0.18));
}
:where([data-ui-metric][data-ui-pulse="up"]) {
  color: var(--hg-up-color, #6ee7b7);
}
:where([data-ui-metric][data-ui-pulse="down"]) {
  color: var(--hg-down-color, #fda4af);
}
:where([data-panel][data-panel-motion="pop"]:not([hidden])) {
  transform: scale(calc(0.94 + var(--hgame-panel-t, 1) * 0.06));
}
:where([data-panel][data-panel-motion="slide-up"]:not([hidden])) {
  transform: translate3d(0, calc((1 - var(--hgame-panel-t, 1)) * 18px), 0);
}
:where([data-panel][data-panel-motion="slide-down"]:not([hidden])) {
  transform: translate3d(0, calc((1 - var(--hgame-panel-t, 1)) * -18px), 0);
}
:where([data-ui-hint]) {
  transition: opacity 180ms ease;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  :where([data-ui-tilt], .card, button):not([data-ui-static]) {
    transform: none !important;
    transition: none !important;
  }
  :where([data-ui-tilt], .card, button):not([data-ui-static])::after {
    display: none;
  }
  :where([data-ui-metric]) {
    transform: none !important;
  }
}
`;

/**
 * Injects the shared HGame UI/UX micro-interaction stylesheet once into `document.head`.
 * @param {Document} [documentRef]
 * @returns {boolean} True when the stylesheet is present in the document.
 */
export function injectUiUxStyles(documentRef = globalThis.document) {
  const head = documentRef?.head;
  if (!head || typeof documentRef.createElement !== 'function') return false;
  if (typeof head.querySelector === 'function' && head.querySelector(`style[${STYLE_ATTR}]`)) return true;
  const children = head.children || head.childNodes || [];
  for (let i = 0; i < children.length; i++) {
    if (children[i]?.getAttribute?.(STYLE_ATTR) === '1') return true;
  }
  const styleEl = documentRef.createElement('style');
  styleEl.setAttribute(STYLE_ATTR, '1');
  styleEl.textContent = UI_UX_STYLESHEET;
  head.appendChild(styleEl);
  return true;
}

/**
 * @typedef {object} UiUxDomOptions
 * @property {HTMLElement | Document} [root] Root container to enhance (defaults to `document.body`).
 * @property {ReturnType<typeof import('../ui/ux-director.js').createUiDirector> | null} [director=null] Optional UiDirector to synchronize phase, metrics, hints, and audio cues.
 * @property {{ available?: boolean, playSynth?: (preset: unknown, opts?: object) => unknown } | null} [audio=null] Optional audio service when no director is provided.
 * @property {string} [selector='button:not([data-ui-static]), [data-ui-tilt], .card'] Interactive element selector.
 * @property {number} [maxTiltDeg=10] Maximum 3D perspective tilt angle in degrees.
 * @property {number} [hoverScale=1.045] Scale on pointer hover.
 * @property {number} [pressScale=0.96] Scale on active press.
 * @property {number} [hoverLift=-5] Vertical hover lift in pixels.
 * @property {number} [perspective=800] CSS perspective in pixels.
 * @property {Record<string, (value: number) => string>} [formatMetrics] Custom metric formatters keyed by metric id.
 * @property {boolean} [injectStyles=true] Inject shared CSS rules automatically.
 * @property {boolean} [autoRaf=true] Run on-demand `requestAnimationFrame` only while springs or director animations are active.
 */

/**
 * Universal DOM UI/UX enhancer for HGame projects (2D, 3D, and command-driven UI).
 * Attaches spring-driven 3D tilt, floating hover, specular glare, staggered card entrances,
 * metric punch counters, key-hint auto-fade, and throttled UI sound feedback.
 * Sleeps automatically with zero idle CPU usage when all animations settle.
 *
 * @param {UiUxDomOptions} [options={}]
 */
export function bindUiUxDOM(options = {}) {
  const doc = options.root?.ownerDocument ?? globalThis.document;
  const root = options.root ?? doc?.body ?? doc?.documentElement;
  if (!root || typeof root.addEventListener !== 'function') {
    throw new TypeError('bindUiUxDOM requires a DOM root element.');
  }

  const director = options.director ?? null;
  const audio = options.audio ?? null;
  const selector = options.selector ?? 'button:not([data-ui-static]), [data-ui-tilt], .card';
  const maxTiltDeg = Number.isFinite(options.maxTiltDeg) ? options.maxTiltDeg : 10;
  const hoverScale = Number.isFinite(options.hoverScale) ? options.hoverScale : 1.045;
  const pressScale = Number.isFinite(options.pressScale) ? options.pressScale : 0.96;
  const hoverLift = Number.isFinite(options.hoverLift) ? options.hoverLift : -5;
  const perspective = Number.isFinite(options.perspective) ? options.perspective : 800;
  const formatMetrics = options.formatMetrics ?? null;
  const autoRaf = options.autoRaf !== false;

  const reducedMotion = typeof globalThis.matchMedia === 'function'
    ? globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  if (options.injectStyles !== false && doc) {
    injectUiUxStyles(doc);
  }

  /** @type {Map<HTMLElement, ReturnType<typeof createUiSurfaceSpring>>} */
  const surfaces = new Map();
  /** @type {Map<HTMLElement, { elapsed: number, items: HTMLElement[] }>} */
  const staggers = new Map();

  let activeHovered = null;
  let activePressed = null;
  let rafId = 0;
  let lastTimeMs = 0;
  let disposed = false;

  function emitCue(cue, detail) {
    if (director) {
      director.emitCue(cue, detail);
    } else if (audio && audio.available !== false && typeof audio.playSynth === 'function') {
      const preset = cue === UI_UX_CUES.CONFIRM ? 'pickup' : 'click';
      try {
        audio.playSynth(preset, { bus: 'sfx', volume: cue === UI_UX_CUES.HOVER ? 0.1 : 0.18, pitchJitter: 0.05 });
      } catch {}
    }
  }

  function isElementDisabled(el) {
    return Boolean(el.disabled || el.getAttribute?.('aria-disabled') === 'true');
  }

  function resolveInteractiveTarget(node) {
    if (!node || typeof node.closest !== 'function') return null;
    const match = node.closest(selector);
    if (!match || match.hasAttribute?.('data-ui-static')) return null;
    if (typeof root.contains === 'function' && root !== match && !root.contains(match)) return null;
    return match;
  }

  function getOrCreateSurface(el) {
    let spring = surfaces.get(el);
    if (spring) return spring;
    const floatAttr = el.getAttribute?.('data-ui-float');
    const idleFloatAmp = reducedMotion || floatAttr === null ? 0 : (Number(floatAttr) || 3.5);
    const tiltAttr = el.getAttribute?.('data-ui-tilt');
    const elemMaxTilt = tiltAttr && Number.isFinite(Number(tiltAttr)) ? Number(tiltAttr) : maxTiltDeg;
    spring = createUiSurfaceSpring({
      maxTiltDeg: reducedMotion ? 0 : elemMaxTilt,
      hoverScale: reducedMotion ? 1 : hoverScale,
      pressScale: reducedMotion ? 1 : pressScale,
      hoverLift: reducedMotion ? 0 : hoverLift,
      idleFloatAmp,
      idlePhase: surfaces.size * 0.9,
      perspective,
    });
    spring.setDisabled(isElementDisabled(el));
    surfaces.set(el, spring);
    return spring;
  }

  function applySurfaceToDom(el, spring, staggerScale = 1, staggerOpacity = 1) {
    const st = spring.getState();
    el.setAttribute?.('data-ui-hovered', st.hovered ? 'true' : 'false');
    el.setAttribute?.('data-ui-pressed', st.pressed ? 'true' : 'false');
    if (!el.style) return;
    if (!reducedMotion) {
      const ty = (st.lift + (1 - staggerScale) * 14).toFixed(2);
      const rx = st.tiltX.toFixed(2);
      const ry = st.tiltY.toFixed(2);
      const s = (st.scale * (0.9 + 0.1 * staggerScale)).toFixed(4);
      el.style.transform = `perspective(${perspective}px) translate3d(0, ${ty}px, 0) rotateX(${rx}deg) rotateY(${ry}deg) scale(${s})`;
      el.style.setProperty?.('--hg-mx', `${st.glareX.toFixed(1)}%`);
      el.style.setProperty?.('--hg-my', `${st.glareY.toFixed(1)}%`);
      el.style.setProperty?.('--hg-glare-o', st.glareOpacity.toFixed(3));
      el.style.setProperty?.('--hg-glow', st.glow.toFixed(3));
    }
    if (staggerOpacity < 1) {
      el.style.opacity = staggerOpacity.toFixed(3);
    } else if (el.style.opacity) {
      el.style.opacity = '';
    }
  }

  function updatePointerCoords(el, spring, event) {
    if (typeof el.getBoundingClientRect !== 'function') {
      spring.setHover(true, 0, 0);
      return;
    }
    const rect = el.getBoundingClientRect();
    const w = rect.width > 0 ? rect.width : 1;
    const h = rect.height > 0 ? rect.height : 1;
    const nx = ((event.clientX - rect.left) / w) * 2 - 1;
    const ny = ((event.clientY - rect.top) / h) * 2 - 1;
    spring.setHover(true, nx, ny);
  }

  function syncDirectorDom() {
    if (!director || typeof root.querySelectorAll !== 'function') return;
    root.setAttribute?.('data-ui-phase', director.getPhase());

    const metricEls = root.querySelectorAll('[data-ui-metric]');
    for (const el of metricEls) {
      const id = el.getAttribute('data-ui-metric');
      const metric = id ? director.getMetric(id) : null;
      if (!metric) continue;
      const fmt = formatMetrics?.[id];
      const text = fmt ? fmt(metric.displayValue, metric) : String(Math.round(metric.displayValue));
      if (el.textContent !== text) el.textContent = text;
      const pulseDir = metric.pulse > 0.12 ? (metric.direction >= 0 ? 'up' : 'down') : 'none';
      el.setAttribute?.('data-ui-pulse', pulseDir);
      el.style?.setProperty?.('--hg-pulse', metric.pulse.toFixed(3));
    }

    const hintEls = root.querySelectorAll('[data-ui-hint]');
    const hintAlpha = director.getHintAlpha();
    const hintVisible = director.isHintVisible();
    for (const el of hintEls) {
      el.hidden = !hintVisible;
      if (el.style) el.style.opacity = hintAlpha.toFixed(3);
    }
  }

  function triggerStagger(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return;
    const items = Array.from(container.querySelectorAll(selector));
    if (items.length === 0) return;
    for (const item of items) getOrCreateSurface(item);
    staggers.set(container, { elapsed: 0, items });
    wake();
  }

  function scanFloatingAndStagger() {
    if (typeof root.querySelectorAll !== 'function') return;
    for (const el of root.querySelectorAll('[data-ui-float]')) {
      getOrCreateSurface(el);
    }
    for (const container of root.querySelectorAll('[data-ui-stagger]')) {
      if (!container.hidden) triggerStagger(container);
    }
  }

  function step(dt) {
    if (disposed) return false;
    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    let active = false;

    if (director) {
      const status = director.update(safeDt);
      if (status.activeAnimations) active = true;
      syncDirectorDom();
    }

    for (const [container, stagger] of staggers) {
      stagger.elapsed += safeDt;
      let done = true;
      for (let i = 0; i < stagger.items.length; i++) {
        const item = stagger.items[i];
        const p = reducedMotion ? 1 : computeStaggerProgress(stagger.elapsed, i, { delay: 0.045, duration: 0.24 });
        const opacity = Math.min(1, p * 1.4);
        const spring = getOrCreateSurface(item);
        applySurfaceToDom(item, spring, p, opacity);
        if (stagger.elapsed < i * 0.045 + 0.24) done = false;
      }
      if (done) staggers.delete(container);
      else active = true;
    }

    for (const [el, spring] of surfaces) {
      if (el.isConnected === false) {
        surfaces.delete(el);
        continue;
      }
      const disabled = isElementDisabled(el);
      if (spring.getState().disabled !== disabled) spring.setDisabled(disabled);
      const st = spring.step(safeDt);
      applySurfaceToDom(el, spring);
      if (!st.settled) active = true;
    }

    return active;
  }

  function rafLoop(nowMs) {
    rafId = 0;
    if (disposed) return;
    const dt = lastTimeMs > 0 ? (nowMs - lastTimeMs) / 1000 : 1 / 60;
    lastTimeMs = nowMs;
    const keepGoing = step(dt);
    if (keepGoing && autoRaf && typeof globalThis.requestAnimationFrame === 'function') {
      rafId = globalThis.requestAnimationFrame(rafLoop);
    } else {
      lastTimeMs = 0;
    }
  }

  function wake() {
    if (disposed || !autoRaf || rafId !== 0) return;
    if (typeof globalThis.requestAnimationFrame === 'function') {
      lastTimeMs = 0;
      rafId = globalThis.requestAnimationFrame(rafLoop);
    }
  }

  const onPointerOver = (ev) => {
    const el = resolveInteractiveTarget(ev.target);
    if (!el || el === activeHovered) return;
    if (activeHovered) {
      surfaces.get(activeHovered)?.setHover(false);
    }
    activeHovered = el;
    const spring = getOrCreateSurface(el);
    if (!isElementDisabled(el)) {
      updatePointerCoords(el, spring, ev);
      emitCue(UI_UX_CUES.HOVER, { target: el });
    }
    wake();
  };

  const onPointerMove = (ev) => {
    const el = resolveInteractiveTarget(ev.target);
    if (!el) return;
    const spring = getOrCreateSurface(el);
    if (!isElementDisabled(el)) {
      if (activeHovered !== el) {
        if (activeHovered) surfaces.get(activeHovered)?.setHover(false);
        activeHovered = el;
      }
      updatePointerCoords(el, spring, ev);
      wake();
    }
  };

  const onPointerOut = (ev) => {
    const el = resolveInteractiveTarget(ev.target);
    if (!el) return;
    const related = resolveInteractiveTarget(ev.relatedTarget);
    if (related === el) return;
    const spring = surfaces.get(el);
    if (spring) {
      spring.setHover(false);
      spring.setPressed(false);
    }
    if (activeHovered === el) activeHovered = null;
    if (activePressed === el) activePressed = null;
    wake();
  };

  const onPointerDown = (ev) => {
    const el = resolveInteractiveTarget(ev.target);
    if (!el || isElementDisabled(el)) return;
    activePressed = el;
    const spring = getOrCreateSurface(el);
    spring.setPressed(true);
    updatePointerCoords(el, spring, ev);
    emitCue(UI_UX_CUES.PRESS, { target: el });
    wake();
  };

  const releasePressed = () => {
    if (!activePressed) return;
    surfaces.get(activePressed)?.setPressed(false);
    activePressed = null;
    wake();
  };

  const onFocusIn = (ev) => {
    const el = resolveInteractiveTarget(ev.target);
    if (!el || isElementDisabled(el)) return;
    getOrCreateSurface(el).setFocused(true);
    wake();
  };

  const onFocusOut = (ev) => {
    const el = resolveInteractiveTarget(ev.target);
    if (!el) return;
    surfaces.get(el)?.setFocused(false);
    wake();
  };

  const onClick = (ev) => {
    const el = resolveInteractiveTarget(ev.target);
    if (!el || isElementDisabled(el)) return;
    if (el.classList?.contains('card')) {
      emitCue(UI_UX_CUES.CONFIRM, { target: el });
    }
    wake();
  };

  let observer = null;
  if (typeof globalThis.MutationObserver === 'function') {
    observer = new globalThis.MutationObserver((mutations) => {
      let needWake = false;
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'hidden') {
          const target = m.target;
          if (!target.hidden && (target.hasAttribute?.('data-ui-stagger') || target.hasAttribute?.('data-panel'))) {
            triggerStagger(target);
            needWake = true;
          }
        } else if (m.type === 'childList') {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1 && node.hasAttribute?.('data-ui-float')) {
              getOrCreateSurface(node);
              needWake = true;
            }
          }
        }
      }
      if (needWake) wake();
    });
    observer.observe(root, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true });
  }

  root.addEventListener('pointerover', onPointerOver);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerout', onPointerOut);
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onFocusOut);
  root.addEventListener('click', onClick);
  const win = doc?.defaultView ?? globalThis;
  win?.addEventListener?.('pointerup', releasePressed);
  win?.addEventListener?.('pointercancel', releasePressed);

  let unsubPhase = null;
  if (director) {
    unsubPhase = director.onPhaseChange(() => {
      syncDirectorDom();
      wake();
    });
    syncDirectorDom();
  }

  scanFloatingAndStagger();
  if (surfaces.size > 0 || director) wake();

  return Object.freeze({
    step,
    wake,
    triggerStagger,
    syncDirectorDom,
    getSurfaceCount: () => surfaces.size,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (rafId !== 0 && typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      observer?.disconnect();
      unsubPhase?.();
      root.removeEventListener('pointerover', onPointerOver);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerout', onPointerOut);
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      root.removeEventListener('click', onClick);
      win?.removeEventListener?.('pointerup', releasePressed);
      win?.removeEventListener?.('pointercancel', releasePressed);
      surfaces.clear();
      staggers.clear();
    },
  });
}
