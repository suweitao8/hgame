import { SpringDamper1D, SpringDamper2D } from '../time/tween.js';
import { createUiSurfaceSpring, computeStaggerProgress } from '../ui/ux-motion.js';
import { UI_UX_CUES } from '../ui/ux-director.js';

const STYLE_ATTR = 'data-hgame-ui-ux-styles';

const UI_UX_STYLESHEET = `
:where([data-ui-theme="scifi"]) {
  --hg-accent: #38bdf8;
  --hg-up-color: #34d399;
  --hg-down-color: #fb7185;
  --hg-surface-bg: rgba(12, 24, 38, 0.82);
  --hg-surface-border: rgba(56, 189, 248, 0.42);
  --hg-bar-bg: rgba(15, 23, 42, 0.78);
  --hg-bar-fill: linear-gradient(90deg, #06b6d4, #34d399);
  --hg-bar-ghost: rgba(248, 250, 252, 0.72);
  --hg-focus-color: rgba(56, 189, 248, 0.85);
}
:where([data-ui-theme="arcane"]) {
  --hg-accent: #f59e0b;
  --hg-up-color: #86efac;
  --hg-down-color: #fda4af;
  --hg-surface-bg: rgba(28, 20, 38, 0.86);
  --hg-surface-border: rgba(245, 158, 11, 0.45);
  --hg-bar-bg: rgba(24, 16, 32, 0.82);
  --hg-bar-fill: linear-gradient(90deg, #d97706, #fbbf24);
  --hg-bar-ghost: rgba(254, 243, 199, 0.75);
  --hg-focus-color: rgba(251, 191, 36, 0.9);
}
:where([data-ui-theme="arcade"]) {
  --hg-accent: #facc15;
  --hg-up-color: #4ade80;
  --hg-down-color: #f87171;
  --hg-surface-bg: rgba(17, 24, 39, 0.9);
  --hg-surface-border: rgba(250, 204, 21, 0.55);
  --hg-bar-bg: rgba(17, 24, 39, 0.85);
  --hg-bar-fill: linear-gradient(90deg, #ef4444, #facc15);
  --hg-bar-ghost: rgba(255, 255, 255, 0.82);
  --hg-focus-color: rgba(250, 204, 21, 0.92);
}
:where([data-ui-theme="cyber"]) {
  --hg-accent: #e879f9;
  --hg-up-color: #2dd4bf;
  --hg-down-color: #fb7185;
  --hg-surface-bg: rgba(18, 12, 30, 0.85);
  --hg-surface-border: rgba(232, 121, 249, 0.48);
  --hg-bar-bg: rgba(15, 10, 28, 0.85);
  --hg-bar-fill: linear-gradient(90deg, #a855f7, #ec4899);
  --hg-bar-ghost: rgba(244, 114, 182, 0.65);
  --hg-focus-color: rgba(232, 121, 249, 0.9);
}
:where([data-ui-tilt], .card, button[data-ui-interactive]) {
  position: relative;
  transform-style: preserve-3d;
  will-change: transform;
}
:where([data-ui-theme]) :where(.card, [data-ui-surface]) {
  background: var(--hg-surface-bg);
  border-color: var(--hg-surface-border);
  backdrop-filter: blur(8px);
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
:where([data-ui-bar]) {
  position: relative;
  overflow: hidden;
  background: var(--hg-bar-bg, rgba(15, 23, 42, 0.72));
  border-radius: 999px;
}
:where([data-ui-bar])::before,
:where([data-ui-bar])::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  transform-origin: 0 50%;
  pointer-events: none;
}
:where([data-ui-bar])::before {
  background: var(--hg-bar-ghost, rgba(255, 255, 255, 0.68));
  transform: scaleX(var(--hg-bar-ghost-v, 1));
}
:where([data-ui-bar])::after {
  background: var(--hg-bar-fill, linear-gradient(90deg, #34d399, #6ee7b7));
  transform: scaleX(var(--hg-bar-value, 1));
}
:where([data-ui-bar][data-ui-bar-dir="up"])::before {
  background: var(--hg-up-color, #6ee7b7);
  opacity: 0.55;
}
:where([data-ui-cooldown]) {
  position: relative;
  overflow: hidden;
}
:where([data-ui-cooldown])::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: conic-gradient(
    rgba(8, 13, 24, 0.72) var(--hg-cd-deg, 0deg),
    transparent 0deg
  );
  opacity: var(--hg-cd-active, 0);
}
:where([data-ui-cooldown][data-ui-cd-ready="true"])::after {
  box-shadow: 0 0 calc(14px * var(--hg-cd-flash, 0)) var(--hg-accent, #38bdf8);
}
.hg-focus-ring {
  position: fixed;
  left: 0;
  top: 0;
  pointer-events: none;
  z-index: 999;
  border: 2px solid var(--hg-focus-color, rgba(110, 231, 183, 0.9));
  border-radius: 12px;
  box-shadow: 0 0 14px rgba(110, 231, 183, 0.35), inset 0 0 8px rgba(255, 255, 255, 0.12);
  will-change: transform, width, height, opacity;
}
.hg-flyer {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 1000;
  pointer-events: none;
  font-size: 18px;
  line-height: 1;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.45));
  will-change: transform, opacity;
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
  .hg-focus-ring, .hg-flyer {
    display: none !important;
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
 * @typedef {'scifi' | 'arcane' | 'arcade' | 'cyber'} UiThemeName
 */

/**
 * @typedef {object} UiFlyToOptions
 * @property {HTMLElement | { x: number, y: number }} from Origin element or viewport coordinates.
 * @property {HTMLElement | string} to Destination element or CSS selector.
 * @property {string} [glyph='✦'] Short visual icon/glyph for the flying token.
 * @property {number} [count=1] Number of staggered flyers.
 * @property {number} [duration=0.45] Flight duration in seconds.
 * @property {number} [arcHeight=48] Bezier curve peak lift in pixels.
 * @property {string | null} [metric=null] Optional `director` metric id to pulse/increment on arrival.
 * @property {number} [delta=0] Optional metric delta added per flyer arrival.
 */

/**
 * @typedef {object} UiUxDomOptions
 * @property {HTMLElement | Document} [root] Root container to enhance (defaults to `document.body`).
 * @property {ReturnType<typeof import('../ui/ux-director.js').createUiDirector> | null} [director=null] Optional UiDirector to synchronize phase, metrics, bars, cooldowns, hints, and audio cues.
 * @property {{ available?: boolean, playSynth?: (preset: unknown, opts?: object) => unknown } | null} [audio=null] Optional audio service when no director is provided.
 * @property {UiThemeName | null} [theme=null] Optional built-in theme preset applied as `data-ui-theme` on `root`.
 * @property {string} [selector='button:not([data-ui-static]), [data-ui-tilt], .card'] Interactive element selector.
 * @property {number} [maxTiltDeg=10] Maximum 3D perspective tilt angle in degrees.
 * @property {number} [hoverScale=1.045] Scale on pointer hover.
 * @property {number} [pressScale=0.96] Scale on active press.
 * @property {number} [hoverLift=-5] Vertical hover lift in pixels.
 * @property {number} [perspective=800] CSS perspective in pixels.
 * @property {Record<string, (value: number) => string>} [formatMetrics] Custom metric formatters keyed by metric id.
 * @property {boolean} [keyboardNav=true] Enable Arrow/Tab focus navigation + Enter/Space confirm across visible interactive elements.
 * @property {boolean} [gamepadNav=false] Poll connected gamepad D-pad & A button during active frames.
 * @property {boolean} [focusRing=true] Show spring-animated sliding focus ring around keyboard-focused elements.
 * @property {boolean} [touchSwipe=true] Allow touch finger dragging across sibling cards to preview & select.
 * @property {boolean} [injectStyles=true] Inject shared CSS rules automatically.
 * @property {boolean} [autoRaf=true] Run on-demand `requestAnimationFrame` only while springs or director animations are active.
 */

/**
 * Universal DOM UI/UX enhancer for HGame projects (2D, 3D, and command-driven UI).
 * Attaches spring-driven 3D tilt, floating hover, specular glare, dual-layer ghost bars,
 * radial cooldown rings, Bezier fly-to-HUD tokens, sliding keyboard/gamepad focus ring,
 * touch swipe-select, and throttled UI sound feedback. Sleeps automatically when settled.
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
  const keyboardNav = options.keyboardNav !== false;
  const gamepadNav = Boolean(options.gamepadNav);
  const focusRingEnabled = options.focusRing !== false;
  const touchSwipeEnabled = options.touchSwipe !== false;
  const autoRaf = options.autoRaf !== false;

  const reducedMotion = typeof globalThis.matchMedia === 'function'
    ? globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  if (options.injectStyles !== false && doc) {
    injectUiUxStyles(doc);
  }
  if (options.theme) {
    root.setAttribute?.('data-ui-theme', options.theme);
  }

  /** @type {Map<HTMLElement, ReturnType<typeof createUiSurfaceSpring>>} */
  const surfaces = new Map();
  /** @type {Map<HTMLElement, { elapsed: number, items: HTMLElement[] }>} */
  const staggers = new Map();
  const flyerPool = [];
  const activeFlyers = [];

  let focusRingEl = null;
  let focusedEl = null;
  const focusPosSpring = new SpringDamper2D({ halfLife: 0.055 });
  const focusSizeSpring = new SpringDamper2D({ halfLife: 0.055 });
  const focusAlphaSpring = new SpringDamper1D({ value: 0, target: 0, halfLife: 0.06 });
  let focusSnapped = false;

  let activeHovered = null;
  let activePressed = null;
  let touchStartEl = null;
  let touchSwiping = false;
  let rafId = 0;
  let lastTimeMs = 0;
  let lastGamepadMoveMs = 0;
  let prevGamepadConfirm = false;
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

  function isElementVisible(el) {
    if (!el || el.hidden) return false;
    for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
      if (cur.hidden) return false;
    }
    return true;
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

    for (const el of root.querySelectorAll('[data-ui-metric]')) {
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

    for (const el of root.querySelectorAll('[data-ui-bar]')) {
      const id = el.getAttribute('data-ui-bar');
      const bar = id ? director.getBar(id) : null;
      if (!bar || !el.style) continue;
      el.style.setProperty?.('--hg-bar-value', bar.value.toFixed(4));
      el.style.setProperty?.('--hg-bar-ghost-v', bar.ghostValue.toFixed(4));
      el.setAttribute?.('data-ui-bar-dir', bar.direction > 0 ? 'up' : bar.direction < 0 ? 'down' : 'none');
    }

    for (const el of root.querySelectorAll('[data-ui-cooldown]')) {
      const id = el.getAttribute('data-ui-cooldown');
      const cd = id ? director.getCooldown(id) : null;
      if (!cd || !el.style) continue;
      el.style.setProperty?.('--hg-cd-deg', `${(cd.ratio * 360).toFixed(1)}deg`);
      el.style.setProperty?.('--hg-cd-active', cd.ready ? '0' : '1');
      el.style.setProperty?.('--hg-cd-flash', cd.readyFlash.toFixed(3));
      el.setAttribute?.('data-ui-cd-ready', cd.ready ? 'true' : 'false');
    }

    const hintAlpha = director.getHintAlpha();
    const hintVisible = director.isHintVisible();
    for (const el of root.querySelectorAll('[data-ui-hint]')) {
      el.hidden = !hintVisible;
      if (el.style) el.style.opacity = hintAlpha.toFixed(3);
    }
  }

  function ensureFocusRing() {
    if (!focusRingEnabled || reducedMotion || !doc?.createElement) return null;
    if (focusRingEl) return focusRingEl;
    focusRingEl = doc.createElement('div');
    focusRingEl.className = 'hg-focus-ring';
    focusRingEl.hidden = true;
    root.appendChild?.(focusRingEl);
    return focusRingEl;
  }

  function setKeyboardFocus(el) {
    if (focusedEl && focusedEl !== el) {
      surfaces.get(focusedEl)?.setFocused(false);
    }
    focusedEl = el ?? null;
    if (!focusedEl) {
      focusAlphaSpring.setTarget(0);
      focusSnapped = false;
      wake();
      return;
    }
    getOrCreateSurface(focusedEl).setFocused(true);
    focusedEl.focus?.({ preventScroll: true });
    focusAlphaSpring.setTarget(1);
    if (typeof focusedEl.getBoundingClientRect === 'function') {
      const r = focusedEl.getBoundingClientRect();
      if (!focusSnapped) {
        focusPosSpring.snap(r.left - 4, r.top - 4);
        focusSizeSpring.snap(r.width + 8, r.height + 8);
        focusSnapped = true;
      } else {
        focusPosSpring.setTarget(r.left - 4, r.top - 4);
        focusSizeSpring.setTarget(r.width + 8, r.height + 8);
      }
    }
    emitCue(UI_UX_CUES.HOVER, { target: focusedEl });
    wake();
  }

  function collectNavigable() {
    if (typeof root.querySelectorAll !== 'function') return [];
    const list = [];
    for (const el of root.querySelectorAll(selector)) {
      if (!el.hasAttribute?.('data-ui-static') && isElementVisible(el) && !isElementDisabled(el)) {
        list.push(el);
      }
    }
    return list;
  }

  function moveKeyboardFocus(step) {
    const items = collectNavigable();
    if (items.length === 0) return null;
    const curIdx = focusedEl ? items.indexOf(focusedEl) : -1;
    const nextIdx = curIdx < 0
      ? (step >= 0 ? 0 : items.length - 1)
      : ((curIdx + step) % items.length + items.length) % items.length;
    setKeyboardFocus(items[nextIdx]);
    return items[nextIdx];
  }

  function acquireFlyerEl() {
    let el = flyerPool.pop();
    if (!el && doc?.createElement) {
      el = doc.createElement('span');
      el.className = 'hg-flyer';
      root.appendChild?.(el);
    }
    if (el) el.hidden = false;
    return el ?? null;
  }

  /**
   * Launches pooled Bezier-arc flying tokens from a source point/element to a HUD target.
   * @param {UiFlyToOptions} flyOpts
   */
  function flyTo(flyOpts) {
    if (!flyOpts || reducedMotion) {
      if (flyOpts?.metric && director && flyOpts.delta) {
        const cur = director.getMetric(flyOpts.metric)?.value ?? 0;
        director.setMetric(flyOpts.metric, cur + flyOpts.delta * (flyOpts.count ?? 1));
      }
      return 0;
    }
    let sx = 0;
    let sy = 0;
    if (typeof flyOpts.from?.getBoundingClientRect === 'function') {
      const r = flyOpts.from.getBoundingClientRect();
      sx = r.left + r.width * 0.5;
      sy = r.top + r.height * 0.5;
    } else if (flyOpts.from) {
      sx = Number(flyOpts.from.x) || 0;
      sy = Number(flyOpts.from.y) || 0;
    }
    const targetEl = typeof flyOpts.to === 'string'
      ? root.querySelector?.(flyOpts.to) ?? doc?.querySelector?.(flyOpts.to)
      : flyOpts.to;
    if (!targetEl || typeof targetEl.getBoundingClientRect !== 'function') return 0;
    const tr = targetEl.getBoundingClientRect();
    const ex = tr.left + tr.width * 0.5;
    const ey = tr.top + tr.height * 0.5;

    const count = Math.max(1, Math.min(12, (flyOpts.count ?? 1) | 0));
    const duration = Number.isFinite(flyOpts.duration) && flyOpts.duration > 0 ? flyOpts.duration : 0.45;
    const arcHeight = Number.isFinite(flyOpts.arcHeight) ? flyOpts.arcHeight : 48;
    const glyph = flyOpts.glyph ?? '✦';

    for (let i = 0; i < count; i++) {
      const el = acquireFlyerEl();
      if (!el) break;
      el.textContent = glyph;
      const spreadX = (i - (count - 1) * 0.5) * 18;
      const cx = (sx + ex) * 0.5 + spreadX;
      const cy = Math.min(sy, ey) - arcHeight - i * 8;
      activeFlyers.push({
        el,
        sx,
        sy,
        cx,
        cy,
        ex,
        ey,
        delay: i * 0.045,
        elapsed: 0,
        duration,
        metric: flyOpts.metric ?? null,
        delta: Number.isFinite(flyOpts.delta) ? flyOpts.delta : 0,
      });
    }
    wake();
    return count;
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

  function stepFocusRing(safeDt) {
    if (!focusRingEnabled || reducedMotion) return false;
    if (focusedEl && (!isElementVisible(focusedEl) || isElementDisabled(focusedEl) || focusedEl.isConnected === false)) {
      setKeyboardFocus(null);
    }
    if (focusedEl && typeof focusedEl.getBoundingClientRect === 'function') {
      const r = focusedEl.getBoundingClientRect();
      focusPosSpring.setTarget(r.left - 4, r.top - 4);
      focusSizeSpring.setTarget(r.width + 8, r.height + 8);
    }
    focusPosSpring.step(safeDt);
    focusSizeSpring.step(safeDt);
    const alpha = focusAlphaSpring.step(safeDt);
    const ring = focusRingEl ?? (alpha > 0.02 ? ensureFocusRing() : null);
    if (ring) {
      ring.hidden = alpha <= 0.02;
      if (!ring.hidden && ring.style) {
        ring.style.transform = `translate3d(${focusPosSpring.x.toFixed(1)}px, ${focusPosSpring.y.toFixed(1)}px, 0)`;
        ring.style.width = `${Math.max(0, focusSizeSpring.x).toFixed(1)}px`;
        ring.style.height = `${Math.max(0, focusSizeSpring.y).toFixed(1)}px`;
        ring.style.opacity = alpha.toFixed(3);
      }
    }
    return !(focusPosSpring.isSettled(0.2, 0.5) && focusSizeSpring.isSettled(0.2, 0.5) && focusAlphaSpring.isSettled(1e-2, 1e-2));
  }

  function stepFlyers(safeDt) {
    if (activeFlyers.length === 0) return false;
    for (let i = activeFlyers.length - 1; i >= 0; i--) {
      const f = activeFlyers[i];
      if (f.delay > 0) {
        f.delay = Math.max(0, f.delay - safeDt);
        if (f.el.style) f.el.style.opacity = '0';
        continue;
      }
      f.elapsed += safeDt;
      const t = Math.min(1, f.elapsed / f.duration);
      const omt = 1 - t;
      const x = omt * omt * f.sx + 2 * omt * t * f.cx + t * t * f.ex;
      const y = omt * omt * f.sy + 2 * omt * t * f.cy + t * t * f.ey;
      const scale = 0.7 + Math.sin(t * Math.PI) * 0.55;
      if (f.el.style) {
        f.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
        f.el.style.opacity = t > 0.8 ? ((1 - t) * 5).toFixed(3) : '1';
      }
      if (t >= 1) {
        f.el.hidden = true;
        flyerPool.push(f.el);
        activeFlyers.splice(i, 1);
        if (director) {
          if (f.metric && f.delta !== 0) {
            const cur = director.getMetric(f.metric)?.value ?? 0;
            director.setMetric(f.metric, cur + f.delta);
          } else if (f.metric) {
            director.pulseMetric(f.metric, 1);
          }
          director.emitCue(UI_UX_CUES.METRIC_UP, { metric: f.metric });
        }
      }
    }
    return activeFlyers.length > 0;
  }

  function pollGamepad() {
    if (!gamepadNav || typeof globalThis.navigator?.getGamepads !== 'function') return;
    const pads = globalThis.navigator.getGamepads();
    const pad = pads?.[0];
    if (!pad) return;
    const nowMs = Date.now();
    const left = pad.buttons?.[14]?.pressed || (pad.axes?.[0] ?? 0) < -0.55;
    const right = pad.buttons?.[15]?.pressed || (pad.axes?.[0] ?? 0) > 0.55;
    const up = pad.buttons?.[12]?.pressed || (pad.axes?.[1] ?? 0) < -0.55;
    const down = pad.buttons?.[13]?.pressed || (pad.axes?.[1] ?? 0) > 0.55;
    if ((left || right || up || down) && nowMs - lastGamepadMoveMs > 180) {
      lastGamepadMoveMs = nowMs;
      moveKeyboardFocus(right || down ? 1 : -1);
    }
    const confirm = Boolean(pad.buttons?.[0]?.pressed);
    if (confirm && !prevGamepadConfirm && focusedEl) {
      focusedEl.click?.();
    }
    prevGamepadConfirm = confirm;
  }

  function step(dt) {
    if (disposed) return false;
    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    let active = false;

    pollGamepad();

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

    if (stepFocusRing(safeDt)) active = true;
    if (stepFlyers(safeDt)) active = true;

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
    if (activeHovered) surfaces.get(activeHovered)?.setHover(false);
    activeHovered = el;
    const spring = getOrCreateSurface(el);
    if (!isElementDisabled(el)) {
      updatePointerCoords(el, spring, ev);
      emitCue(UI_UX_CUES.HOVER, { target: el });
    }
    wake();
  };

  const onPointerMove = (ev) => {
    if (touchSwiping && ev.pointerType === 'touch' && typeof doc?.elementFromPoint === 'function') {
      const hitNode = doc.elementFromPoint(ev.clientX, ev.clientY);
      const el = resolveInteractiveTarget(hitNode);
      if (el !== activeHovered) {
        if (activeHovered) {
          surfaces.get(activeHovered)?.setHover(false);
          surfaces.get(activeHovered)?.setPressed(false);
        }
        activeHovered = el;
        activePressed = el;
        if (el && !isElementDisabled(el)) {
          const sp = getOrCreateSurface(el);
          sp.setPressed(true);
          updatePointerCoords(el, sp, ev);
          emitCue(UI_UX_CUES.HOVER, { target: el });
        }
        wake();
      } else if (el && !isElementDisabled(el)) {
        updatePointerCoords(el, getOrCreateSurface(el), ev);
        wake();
      }
      return;
    }
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
    if (touchSwiping) return;
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
    if (focusedEl) setKeyboardFocus(null);
    const el = resolveInteractiveTarget(ev.target);
    if (!el || isElementDisabled(el)) return;
    activePressed = el;
    activeHovered = el;
    if (touchSwipeEnabled && ev.pointerType === 'touch') {
      touchSwiping = true;
      touchStartEl = el;
    }
    const spring = getOrCreateSurface(el);
    spring.setPressed(true);
    updatePointerCoords(el, spring, ev);
    emitCue(UI_UX_CUES.PRESS, { target: el });
    wake();
  };

  const releasePressed = (ev) => {
    const wasTouchSwipe = touchSwiping;
    const startEl = touchStartEl;
    touchSwiping = false;
    touchStartEl = null;
    if (wasTouchSwipe && activePressed && ev && typeof doc?.elementFromPoint === 'function') {
      const hitEl = resolveInteractiveTarget(doc.elementFromPoint(ev.clientX, ev.clientY));
      const prevEl = activePressed;
      surfaces.get(prevEl)?.setPressed(false);
      surfaces.get(prevEl)?.setHover(false);
      activePressed = null;
      activeHovered = null;
      if (hitEl && hitEl !== startEl && !isElementDisabled(hitEl)) {
        hitEl.click?.();
      }
      wake();
      return;
    }
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

  const onKeyDown = (ev) => {
    if (!keyboardNav || ev?.defaultPrevented) return;
    const modalOpen = Boolean(director?.panelStack.hasModal());
    const allowNav = modalOpen || director?.getPhase?.() !== 'playing';
    if (!allowNav && !focusedEl) return;

    const key = ev.key;
    if (key === 'ArrowRight' || key === 'ArrowDown') {
      ev.preventDefault?.();
      moveKeyboardFocus(1);
    } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
      ev.preventDefault?.();
      moveKeyboardFocus(-1);
    } else if ((key === 'Enter' || key === ' ') && focusedEl) {
      ev.preventDefault?.();
      focusedEl.click?.();
    }
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
  win?.addEventListener?.('keydown', onKeyDown);

  let unsubPhase = null;
  if (director) {
    unsubPhase = director.onPhaseChange(() => {
      setKeyboardFocus(null);
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
    flyTo,
    triggerStagger,
    syncDirectorDom,
    moveFocus: moveKeyboardFocus,
    setFocus: setKeyboardFocus,
    getFocusedElement: () => focusedEl,
    setTheme: (themeName) => root.setAttribute?.('data-ui-theme', themeName ?? ''),
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
      focusRingEl?.remove?.();
      for (const el of flyerPool) el.remove?.();
      for (const f of activeFlyers) f.el?.remove?.();
      flyerPool.length = 0;
      activeFlyers.length = 0;
      root.removeEventListener('pointerover', onPointerOver);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerout', onPointerOut);
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      root.removeEventListener('click', onClick);
      win?.removeEventListener?.('pointerup', releasePressed);
      win?.removeEventListener?.('pointercancel', releasePressed);
      win?.removeEventListener?.('keydown', onKeyDown);
      surfaces.clear();
      staggers.clear();
    },
  });
}
