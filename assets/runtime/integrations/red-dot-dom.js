import { formatRedDotBadge, normalizeRedDotPath } from '../ui/red-dot.js';

/** @typedef {import('../ui/red-dot.js').RedDotSystem} RedDotSystem */
/** @typedef {import('../ui/red-dot.js').RedDotState} RedDotState */

const STYLE_ATTR = 'data-hgame-red-dot-styles';
const VALID_OVERRIDES = new Set(['none', 'quiet', 'dot', 'new', 'number']);

const RED_DOT_STYLESHEET = `
:where(.hgame-red-dot-host) {
  position: relative;
}
.hgame-red-dot {
  position: absolute;
  top: -4px;
  right: -4px;
  z-index: 5;
  pointer-events: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 999px;
  background: #ef4444;
  color: #ffffff;
  border: 1.5px solid rgba(15, 23, 42, 0.85);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  font-family: system-ui, -apple-system, sans-serif;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  user-select: none;
  -webkit-user-select: none;
}
.hgame-red-dot[data-active="false"],
.hgame-red-dot[data-style="none"] {
  display: none;
}
.hgame-red-dot[data-style="dot"] {
  width: 10px;
  height: 10px;
  min-width: 10px;
  padding: 0;
}
.hgame-red-dot[data-style="quiet"] {
  top: -2px;
  right: -2px;
  width: 7px;
  height: 7px;
  min-width: 7px;
  padding: 0;
  background: #f59e0b;
  border-width: 1px;
}
.hgame-red-dot[data-style="number"] {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-size: 11px;
}
.hgame-red-dot[data-style="new"] {
  top: -6px;
  right: -6px;
  min-width: 28px;
  height: 16px;
  padding: 0 5px;
  font-size: 9px;
  letter-spacing: 0.4px;
  background: linear-gradient(135deg, #f97316, #ef4444);
}
`;

function ensureStylesheet(documentRef) {
  const head = documentRef?.head;
  if (!head || typeof documentRef.createElement !== 'function') return;
  if (typeof head.querySelector === 'function' && head.querySelector(`style[${STYLE_ATTR}]`)) return;
  const children = head.children || head.childNodes || [];
  for (let i = 0; i < children.length; i++) {
    if (children[i]?.getAttribute?.(STYLE_ATTR) === '1') return;
  }
  const styleEl = documentRef.createElement('style');
  styleEl.setAttribute(STYLE_ATTR, '1');
  styleEl.textContent = RED_DOT_STYLESHEET;
  head.appendChild(styleEl);
}

function collectElementsWithAttribute(root, attribute) {
  const result = [];
  if (!root) return result;
  if (root.hasAttribute?.(attribute) || root.getAttribute?.(attribute)) {
    result.push(root);
  }
  if (typeof root.querySelectorAll === 'function') {
    const list = root.querySelectorAll(`[${attribute}]`);
    for (let i = 0; i < list.length; i++) {
      if (list[i] !== root) result.push(list[i]);
    }
    return result;
  }
  const stack = [...(root.children || root.childNodes || [])];
  while (stack.length > 0) {
    const el = stack.shift();
    if (!el) continue;
    if (el.hasAttribute?.(attribute) || el.getAttribute?.(attribute)) {
      result.push(el);
    }
    const children = el.children || el.childNodes;
    if (children && children.length > 0) {
      for (let i = children.length - 1; i >= 0; i--) {
        stack.unshift(children[i]);
      }
    }
  }
  return result;
}

function findDirectBadge(hostEl) {
  const children = hostEl.children || hostEl.childNodes || [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child?.getAttribute?.('data-hgame-red-dot-badge') === '1') {
      return child;
    }
  }
  return null;
}

function findAncestorWithAttr(startEl, stopEl, attrName) {
  let curr = startEl;
  while (curr) {
    const has = curr.hasAttribute ? curr.hasAttribute(attrName) : curr.getAttribute?.(attrName) !== null && curr.getAttribute?.(attrName) !== undefined;
    if (has) return curr;
    if (curr === stopEl) break;
    curr = curr.parentElement ?? curr.parentNode ?? null;
  }
  return null;
}

/**
 * @typedef {object} RedDotDOMOptions
 * @property {Pick<RedDotSystem, 'subscribe' | 'acknowledge' | 'getState'>} system Red-dot system to render (required).
 * @property {Element} root Root element scanned for bound hosts and used for click delegation (required).
 * @property {Document} [documentRef=globalThis.document] Document used to create badge elements and inject the stylesheet.
 * @property {string} [attribute='data-red-dot'] Attribute holding the node path.
 * @property {string} [modeAttribute='data-red-dot-mode'] Attribute overriding the style ('none' | 'quiet' | 'dot' | 'new' | 'number').
 * @property {string} [ackAttribute='data-red-dot-ack'] Click-to-acknowledge attribute; "false" disables, "recursive"/"tree" acknowledges the subtree.
 * @property {boolean} [observe=true] Watch the DOM with a MutationObserver and re-bind automatically.
 * @property {typeof MutationObserver} [MutationObserverClass=globalThis.MutationObserver] Injectable observer constructor.
 */

/**
 * @typedef {object} RedDotDOMBinding
 * @property {() => number} refresh Re-scan the DOM and (re)bind hosts; returns the bound host count.
 * @property {(hostEl: Element) => Element} mountBadge Create (or find) the badge element inside a host.
 * @property {() => void} dispose Unbind all hosts, remove owned badges and stop observing.
 */

/**
 * Declaratively binds `[data-red-dot="Path/To/Node"]` DOM elements to a
 * `createRedDotSystem` instance, rendering floating badges (`dot`/`number`/`new`/`quiet`),
 * applying optional `data-red-dot-mode` visual overrides, and handling click-to-acknowledge
 * via `[data-red-dot-ack]` (default self-only, or `"recursive"` for clear-all).
 * @param {RedDotDOMOptions} options
 * @returns {Readonly<RedDotDOMBinding>}
 */
export function bindRedDotDOM({
  system,
  root,
  documentRef = globalThis.document,
  attribute = 'data-red-dot',
  modeAttribute = 'data-red-dot-mode',
  ackAttribute = 'data-red-dot-ack',
  observe = true,
  MutationObserverClass = globalThis.MutationObserver,
} = {}) {
  if (!system || typeof system.subscribe !== 'function' || typeof system.acknowledge !== 'function') {
    throw new TypeError('bindRedDotDOM requires a valid RedDotSystem instance');
  }
  if (!root) {
    throw new TypeError('bindRedDotDOM requires a root DOM element');
  }
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('bindRedDotDOM requires a valid document reference');
  }

  ensureStylesheet(documentRef);

  const bindings = new Map();
  let disposed = false;
  let observer = null;

  function mountBadge(hostEl) {
    hostEl.classList?.add?.('hgame-red-dot-host');
    let badge = findDirectBadge(hostEl);
    let owned = false;
    if (!badge) {
      owned = true;
      badge = documentRef.createElement('span');
      badge.className = 'hgame-red-dot';
      badge.setAttribute('data-hgame-red-dot-badge', '1');
      badge.setAttribute('data-active', 'false');
      badge.setAttribute('data-style', 'none');
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = '';
      hostEl.appendChild(badge);
    }
    return { badge, owned };
  }

  function applyBadgeState(hostEl, badgeEl, state) {
    if (!state || !state.active) {
      badgeEl.setAttribute('data-active', 'false');
      badgeEl.setAttribute('data-style', 'none');
      badgeEl.textContent = '';
      hostEl.classList?.toggle?.('has-red-dot', false);
      return;
    }

    const modeOverride = hostEl.getAttribute?.(modeAttribute);
    const hasOverride = typeof modeOverride === 'string' && VALID_OVERRIDES.has(modeOverride);
    const style = hasOverride ? modeOverride : state.style;

    if (style === 'none') {
      badgeEl.setAttribute('data-active', 'false');
      badgeEl.setAttribute('data-style', 'none');
      badgeEl.textContent = '';
      hostEl.classList?.toggle?.('has-red-dot', false);
      return;
    }

    const text = hasOverride
      ? formatRedDotBadge(state.count, { style })
      : state.text;

    badgeEl.setAttribute('data-active', 'true');
    badgeEl.setAttribute('data-style', style);
    badgeEl.textContent = text;
    hostEl.classList?.toggle?.('has-red-dot', true);
  }

  function unbindElement(el) {
    const entry = bindings.get(el);
    if (!entry) return;
    entry.unsubscribe();
    bindings.delete(el);
    entry.badge.setAttribute('data-active', 'false');
    entry.badge.setAttribute('data-style', 'none');
    entry.badge.textContent = '';
    el.classList?.toggle?.('has-red-dot', false);
    if (entry.owned) {
      if (typeof entry.badge.remove === 'function') entry.badge.remove();
      else entry.badge.parentNode?.removeChild?.(entry.badge);
    }
  }

  function refresh() {
    if (disposed) return 0;
    const found = collectElementsWithAttribute(root, attribute);
    const foundSet = new Set(found);

    for (const el of [...bindings.keys()]) {
      if (!foundSet.has(el)) {
        unbindElement(el);
      }
    }

    for (const el of found) {
      const rawPath = el.getAttribute?.(attribute);
      if (typeof rawPath !== 'string' || !rawPath.trim()) {
        unbindElement(el);
        continue;
      }
      let normalizedPath;
      try {
        normalizedPath = normalizeRedDotPath(rawPath.trim());
      } catch {
        unbindElement(el);
        continue;
      }

      const existing = bindings.get(el);
      if (existing) {
        if (existing.path === normalizedPath) {
          applyBadgeState(el, existing.badge, system.getState(normalizedPath));
          continue;
        }
        existing.unsubscribe();
        bindings.delete(el);
      }

      const { badge, owned } = mountBadge(el);
      const unsubscribe = system.subscribe(
        normalizedPath,
        state => applyBadgeState(el, badge, state),
        { immediate: true },
      );
      bindings.set(el, { path: normalizedPath, badge, owned, unsubscribe });
    }

    return bindings.size;
  }

  function handleClick(event) {
    if (disposed || !event?.target) return;
    const ackEl = findAncestorWithAttr(event.target, root, ackAttribute);
    if (!ackEl) return;
    const rawAck = ackEl.getAttribute?.(ackAttribute);
    if (rawAck === 'false') return;
    const pathHost = findAncestorWithAttr(ackEl, root, attribute);
    const rawPath = pathHost?.getAttribute?.(attribute);
    if (typeof rawPath !== 'string' || !rawPath.trim()) return;

    let normalizedPath;
    try {
      normalizedPath = normalizeRedDotPath(rawPath.trim());
    } catch {
      return;
    }
    const recursive = rawAck === 'recursive' || rawAck === 'tree';
    system.acknowledge(normalizedPath, { recursive });
  }

  root.addEventListener?.('click', handleClick);

  if (observe && typeof MutationObserverClass === 'function') {
    observer = new MutationObserverClass(() => {
      refresh();
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [attribute, modeAttribute],
    });
  }

  refresh();

  return Object.freeze({
    refresh,
    mountBadge(hostEl) {
      return mountBadge(hostEl).badge;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer?.disconnect?.();
      observer = null;
      root.removeEventListener?.('click', handleClick);
      for (const el of [...bindings.keys()]) {
        unbindElement(el);
      }
    },
  });
}
