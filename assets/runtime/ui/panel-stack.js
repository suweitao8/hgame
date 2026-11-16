/**
 * @typedef {object} PanelDefinition
 * @property {boolean} [modal=false] Blocks pointer/back events from reaching panels underneath.
 * @property {boolean} [closeOnCancel=true] Whether handleCancel() / Escape pops this panel.
 * @property {boolean} [closeOnBackdrop=true] Whether clicking the modal backdrop pops this panel.
 * @property {boolean} [exclusive=false] Pops all existing non-pinned panels before pushing this one.
 * @property {boolean} [pinned=false] Survives clear() unless force=true.
 * @property {number} [transitionMs=160] Enter/exit transition duration in milliseconds.
 * @property {(entry: PanelEntry) => void} [onEnter]
 * @property {(entry: PanelEntry) => void} [onExit]
 */

/**
 * @typedef {object} PanelEntry
 * @property {string} id
 * @property {unknown} payload
 * @property {boolean} modal
 * @property {boolean} closeOnCancel
 * @property {boolean} closeOnBackdrop
 * @property {boolean} exclusive
 * @property {boolean} pinned
 * @property {'entering' | 'open' | 'exiting'} phase
 * @property {number} alpha Transition progress [0..1]
 * @property {number} transitionMs
 */

/**
 * @typedef {object} PanelStackOptions
 * @property {Record<string, PanelDefinition>} [panels] Initial panel definitions keyed by id.
 * @property {(state: { stack: readonly PanelEntry[], modalOpen: boolean }) => void} [onChange]
 */

/**
 * Commercial UI stack router for modals, overlays, settings, shops, and ESC back navigation.
 * Works headlessly in Node tests and optionally binds to a DOM root container.
 * @param {PanelStackOptions} [options={}]
 */
export function createPanelStack(options = {}) {
  /** @type {Map<string, Required<Omit<PanelDefinition, 'onEnter' | 'onExit'>> & Pick<PanelDefinition, 'onEnter' | 'onExit'>>} */
  const defs = new Map();
  /** @type {PanelEntry[]} */
  const stack = [];
  /** @type {PanelEntry[]} */
  const exiting = [];
  const listeners = new Set();
  if (typeof options.onChange === 'function') listeners.add(options.onChange);

  let domCleanup = null;

  function normalizeDef(def = {}) {
    const transitionMs = Number.isFinite(def.transitionMs) && def.transitionMs >= 0 ? def.transitionMs : 160;
    return {
      modal: Boolean(def.modal),
      closeOnCancel: def.closeOnCancel !== false,
      closeOnBackdrop: def.closeOnBackdrop !== false,
      exclusive: Boolean(def.exclusive),
      pinned: Boolean(def.pinned),
      transitionMs,
      onEnter: typeof def.onEnter === 'function' ? def.onEnter : undefined,
      onExit: typeof def.onExit === 'function' ? def.onExit : undefined,
    };
  }

  if (options.panels && typeof options.panels === 'object') {
    for (const [id, def] of Object.entries(options.panels)) {
      defs.set(id, normalizeDef(def));
    }
  }

  function hasModal() {
    for (let i = 0; i < stack.length; i++) {
      if (stack[i].modal) return true;
    }
    return false;
  }

  function notify() {
    const snap = { stack: stack.slice(), modalOpen: hasModal() };
    for (const fn of listeners) fn(snap);
  }

  function register(id, def = {}) {
    if (!id || typeof id !== 'string') throw new TypeError('Panel id must be a non-empty string.');
    defs.set(id, normalizeDef(def));
  }

  function beginExit(entry) {
    entry.phase = 'exiting';
    const def = defs.get(entry.id);
    if (entry.transitionMs > 0 && entry.alpha > 0) {
      exiting.push(entry);
    } else {
      entry.alpha = 0;
    }
    def?.onExit?.(entry);
  }

  /** @param {string} id @param {unknown} [payload=null] @param {PanelDefinition | null} [overrideDef=null] */
  function push(id, payload = null, overrideDef = null) {
    if (!id || typeof id !== 'string') throw new TypeError('Panel id must be a non-empty string.');
    const base = defs.get(id) ?? normalizeDef();
    const def = overrideDef ? normalizeDef({ ...base, ...overrideDef }) : base;

    if (def.exclusive) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (!stack[i].pinned) {
          const [removed] = stack.splice(i, 1);
          beginExit(removed);
        }
      }
    } else {
      // Deduplicate same-id push by promoting to top with refreshed payload.
      const existingIdx = stack.findIndex((item) => item.id === id);
      if (existingIdx >= 0) {
        const [existing] = stack.splice(existingIdx, 1);
        existing.payload = payload;
        existing.phase = existing.transitionMs === 0 ? 'open' : 'entering';
        if (existing.transitionMs === 0) existing.alpha = 1;
        stack.push(existing);
        def.onEnter?.(existing);
        notify();
        return existing;
      }
    }

    /** @type {PanelEntry} */
    const entry = {
      id,
      payload,
      modal: def.modal,
      closeOnCancel: def.closeOnCancel,
      closeOnBackdrop: def.closeOnBackdrop,
      exclusive: def.exclusive,
      pinned: def.pinned,
      phase: def.transitionMs === 0 ? 'open' : 'entering',
      alpha: def.transitionMs === 0 ? 1 : 0,
      transitionMs: def.transitionMs,
    };
    stack.push(entry);
    def.onEnter?.(entry);
    notify();
    return entry;
  }

  function pop(opts = {}) {
    if (stack.length === 0) return null;
    if (!opts.force && stack[stack.length - 1].pinned) return null;
    const popped = stack.pop();
    beginExit(popped);
    notify();
    return popped;
  }

  function popById(id) {
    const idx = stack.findIndex((entry) => entry.id === id);
    if (idx < 0) return null;
    const [removed] = stack.splice(idx, 1);
    beginExit(removed);
    notify();
    return removed;
  }

  /** @param {string} id @param {unknown} [payload=null] @param {PanelDefinition | null} [overrideDef=null] */
  function replace(id, payload = null, overrideDef = null) {
    if (stack.length > 0 && !stack[stack.length - 1].pinned) {
      const removed = stack.pop();
      beginExit(removed);
    }
    return push(id, payload, overrideDef);
  }

  /** @param {string} id @param {unknown} [payload=null] @param {PanelDefinition | null} [overrideDef=null] */
  function toggle(id, payload = null, overrideDef = null) {
    const topEntry = stack[stack.length - 1];
    if (topEntry && topEntry.id === id) {
      pop();
      return false;
    }
    if (stack.some((entry) => entry.id === id)) {
      popById(id);
      return false;
    }
    push(id, payload, overrideDef);
    return true;
  }

  function clear(force = false) {
    let changed = false;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (force || !stack[i].pinned) {
        const [removed] = stack.splice(i, 1);
        beginExit(removed);
        changed = true;
      }
    }
    if (changed) notify();
    return changed;
  }

  function handleCancel() {
    if (stack.length === 0) return false;
    const topEntry = stack[stack.length - 1];
    if (!topEntry.closeOnCancel) return false;
    return pop({ force: true }) !== null;
  }

  function update(dt) {
    const ms = Number.isFinite(dt) && dt > 0 ? dt * 1000 : 0;
    if (ms <= 0) return;
    for (let i = 0; i < stack.length; i++) {
      const e = stack[i];
      if (e.phase === 'entering') {
        e.alpha = e.transitionMs > 0 ? Math.min(1, e.alpha + ms / e.transitionMs) : 1;
        if (e.alpha >= 1) e.phase = 'open';
      }
    }
    for (let i = exiting.length - 1; i >= 0; i--) {
      const e = exiting[i];
      e.alpha = e.transitionMs > 0 ? Math.max(0, e.alpha - ms / e.transitionMs) : 0;
      if (e.alpha <= 0) exiting.splice(i, 1);
    }
  }

  function isOpen(id) {
    return stack.some((e) => e.id === id);
  }

  function top() {
    return stack.length > 0 ? stack[stack.length - 1] : null;
  }

  function getEntry(id) {
    return stack.find((e) => e.id === id) ?? null;
  }

  function getStack() {
    return stack.slice();
  }

  function getExiting() {
    return exiting.slice();
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError('Listener must be a function.');
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /**
   * Optional declarative DOM binder: manages `[data-panel="<id>"]` visibility/aria-hidden,
   * `[data-panel-close]` click triggers, `[data-panel-backdrop]` dismissal, and Escape key.
   * @param {HTMLElement} rootEl
   * @param {{ targetWindow?: Window | EventTarget, escapeKey?: string }} [bindOpts]
   */
  function bindDom(rootEl, bindOpts = {}) {
    if (domCleanup) domCleanup();
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') {
      throw new TypeError('bindDom requires a DOM element container.');
    }
    const win = bindOpts.targetWindow ?? (typeof window !== 'undefined' ? window : null);
    const escKey = bindOpts.escapeKey ?? 'Escape';

    const syncDom = () => {
      const topEntry = top();
      const panels = rootEl.querySelectorAll('[data-panel]');
      for (const el of panels) {
        const pid = el.getAttribute('data-panel');
        const idx = stack.findIndex((e) => e.id === pid);
        const active = idx >= 0;
        const entry = active ? stack[idx] : null;
        if (active) {
          el.hidden = false;
          el.setAttribute('aria-hidden', 'false');
          el.setAttribute('data-panel-top', topEntry?.id === pid ? 'true' : 'false');
          if (el.style) el.style.zIndex = String(100 + idx * 10);
          if (entry && el.style && entry.transitionMs > 0) {
            el.style.opacity = String(entry.phase === 'entering' ? Math.max(0.01, entry.alpha) : 1);
          }
        } else {
          el.hidden = true;
          el.setAttribute('aria-hidden', 'true');
          el.setAttribute('data-panel-top', 'false');
        }
      }
      const backdrop = rootEl.querySelector('[data-panel-backdrop]');
      if (backdrop) {
        const showModal = hasModal();
        backdrop.hidden = !showModal;
        backdrop.setAttribute('aria-hidden', showModal ? 'false' : 'true');
      }
    };

    const onClick = (ev) => {
      const target = ev?.target;
      if (!target || typeof target.closest !== 'function') return;
      const closeBtn = target.closest('[data-panel-close]');
      if (closeBtn) {
        const targetId = closeBtn.getAttribute('data-panel-close');
        if (targetId) popById(targetId);
        else pop();
        return;
      }
      if (target.hasAttribute?.('data-panel-backdrop')) {
        const topEntry = top();
        if (topEntry?.modal && topEntry.closeOnBackdrop) pop();
      }
    };

    const onKeyDown = (ev) => {
      if (ev?.key === escKey) {
        if (handleCancel() && typeof ev.preventDefault === 'function') {
          ev.preventDefault();
        }
      }
    };

    const unsub = subscribe(syncDom);
    rootEl.addEventListener?.('click', onClick);
    win?.addEventListener?.('keydown', onKeyDown);
    syncDom();

    domCleanup = () => {
      unsub();
      rootEl.removeEventListener?.('click', onClick);
      win?.removeEventListener?.('keydown', onKeyDown);
      domCleanup = null;
    };
    return domCleanup;
  }

  function dispose() {
    domCleanup?.();
    listeners.clear();
    stack.length = 0;
    exiting.length = 0;
  }

  return Object.freeze({
    register,
    push,
    pop,
    popById,
    replace,
    toggle,
    clear,
    handleCancel,
    update,
    isOpen,
    top,
    getEntry,
    getStack,
    getExiting,
    hasModal,
    subscribe,
    bindDom,
    dispose,
  });
}
