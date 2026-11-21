/**
 * Exact 2D sweep-line union area for viewport-clamped `{ left, top, right, bottom }` rects.
 * @param {Array<{ left: number, top: number, right: number, bottom: number }>} rects
 * @returns {number}
 */
export function computeUnionArea(rects) {
  if (!Array.isArray(rects) || rects.length === 0) return 0;
  const clean = [];
  const xs = [];
  for (const r of rects) {
    if (!r) continue;
    const { left, top, right, bottom } = r;
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) continue;
    if (right <= left || bottom <= top) continue;
    clean.push({ left, top, right, bottom });
    xs.push(left, right);
  }
  if (clean.length === 0) return 0;

  xs.sort((a, b) => a - b);
  const uniqX = [xs[0]];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] > xs[i - 1]) uniqX.push(xs[i]);
  }

  let area = 0;
  for (let i = 0; i < uniqX.length - 1; i++) {
    const x0 = uniqX[i];
    const x1 = uniqX[i + 1];
    const dx = x1 - x0;
    if (dx <= 0) continue;

    const spans = [];
    for (const r of clean) {
      if (r.left <= x0 && r.right >= x1) spans.push([r.top, r.bottom]);
    }
    if (spans.length === 0) continue;

    spans.sort((a, b) => a[0] - b[0]);
    let curTop = spans[0][0];
    let curBot = spans[0][1];
    let ySpan = 0;
    for (let j = 1; j < spans.length; j++) {
      const [t, b] = spans[j];
      if (t <= curBot) {
        if (b > curBot) curBot = b;
      } else {
        ySpan += curBot - curTop;
        curTop = t;
        curBot = b;
      }
    }
    ySpan += curBot - curTop;
    area += dx * ySpan;
  }
  return area;
}

/**
 * Self-contained browser evaluation function that audits visible DOM HUD footprint,
 * button budget, hidden debug panels, and modal state.
 */
export function collectPageUiAudit() {
  const vw = window.innerWidth || document.documentElement.clientWidth || 1;
  const vh = window.innerHeight || document.documentElement.clientHeight || 1;
  const viewportArea = Math.max(1, vw * vh);

  const TOUCH_SELECTOR = '.hgame-touch-root, #mobile, [data-touch], .virtual-stick';
  const DEBUG_SELECTOR = '#debug, .debug-panel, .bench-panel, [data-debug]';
  const MODAL_SELECTOR = '[role="dialog"], [aria-modal="true"], dialog[open], #gameover, .gameover, #game-over, #levelup, .levelup, #result, .result, #pause-menu, .pause-overlay, [data-panel]:not([data-panel="hud"])';
  const SKIP_TAGS = new Set(['HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'NOSCRIPT', 'TEMPLATE', 'CANVAS']);
  const PAINTED_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'IMG', 'SVG']);

  const parseAlpha = (color) => {
    if (!color || color === 'transparent') return 0;
    const m = color.match(/rgba?\(([^)]+)\)/i);
    if (!m) return 1;
    const parts = m[1].split(/[,\s/]+/).filter(Boolean);
    if (parts.length < 4) return 1;
    const a = parseFloat(parts[3]);
    return Number.isFinite(a) ? a : 1;
  };

  const isVisible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const selfStyle = getComputedStyle(el);
    if (selfStyle.visibility === 'hidden') return false;
    for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
      if (cur.hidden) return false;
      const st = cur === el ? selfStyle : getComputedStyle(cur);
      if (st.display === 'none' || parseFloat(st.opacity) === 0) return false;
    }
    return true;
  };

  const hasVisiblePaint = (el, style) => {
    if (PAINTED_TAGS.has(el.tagName)) return true;
    if (parseAlpha(style.backgroundColor) > 0.01) return true;
    if (style.backgroundImage && style.backgroundImage !== 'none') return true;
    const sides = [
      [style.borderTopWidth, style.borderTopStyle, style.borderTopColor],
      [style.borderRightWidth, style.borderRightStyle, style.borderRightColor],
      [style.borderBottomWidth, style.borderBottomStyle, style.borderBottomColor],
      [style.borderLeftWidth, style.borderLeftStyle, style.borderLeftColor],
    ];
    for (const [w, s, c] of sides) {
      if (parseFloat(w) > 0 && s !== 'none' && parseAlpha(c) > 0.01) return true;
    }
    return false;
  };

  const pushClamped = (out, rect) => {
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(vw, rect.right);
    const bottom = Math.min(vh, rect.bottom);
    if (right > left && bottom > top) out.push({ left, top, right, bottom });
  };

  const unionRectsArea = (rects) => {
    if (rects.length === 0) return 0;
    const xs = [];
    for (const r of rects) xs.push(r.left, r.right);
    xs.sort((a, b) => a - b);
    const uniqX = [xs[0]];
    for (let i = 1; i < xs.length; i++) if (xs[i] > xs[i - 1]) uniqX.push(xs[i]);
    let area = 0;
    for (let i = 0; i < uniqX.length - 1; i++) {
      const x0 = uniqX[i];
      const x1 = uniqX[i + 1];
      const dx = x1 - x0;
      if (dx <= 0) continue;
      const spans = [];
      for (const r of rects) if (r.left <= x0 && r.right >= x1) spans.push([r.top, r.bottom]);
      if (spans.length === 0) continue;
      spans.sort((a, b) => a[0] - b[0]);
      let curTop = spans[0][0];
      let curBot = spans[0][1];
      let ySpan = 0;
      for (let j = 1; j < spans.length; j++) {
        const [t, b] = spans[j];
        if (t <= curBot) {
          if (b > curBot) curBot = b;
        } else {
          ySpan += curBot - curTop;
          curTop = t;
          curBot = b;
        }
      }
      ySpan += curBot - curTop;
      area += dx * ySpan;
    }
    return area;
  };

  let debugVisible = false;
  for (const el of document.querySelectorAll(DEBUG_SELECTOR)) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if ((r.width > 0 && r.height > 0) || (el.textContent && el.textContent.trim().length > 0) || el.children.length > 0) {
      debugVisible = true;
      break;
    }
  }

  let modalActive = false;
  for (const el of document.querySelectorAll(MODAL_SELECTOR)) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      modalActive = true;
      break;
    }
  }

  const uiRects = [];
  let visibleTextChars = 0;
  const allElements = document.body ? document.body.querySelectorAll('*') : [];
  for (const el of allElements) {
    if (SKIP_TAGS.has(el.tagName)) continue;
    if (el.id === 'game' || el.id === 'game-canvas') continue;
    if (el.closest(TOUCH_SELECTOR) || el.closest(DEBUG_SELECTOR)) continue;
    if (!isVisible(el)) continue;

    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const painted = hasVisiblePaint(el, style);
    if (!modalActive && painted && el.id !== 'hud' && el.id !== 'ui-layer') {
      const clampedW = Math.min(vw, rect.right) - Math.max(0, rect.left);
      const clampedH = Math.min(vh, rect.bottom) - Math.max(0, rect.top);
      if ((style.position === 'fixed' || style.position === 'absolute') &&
          parseAlpha(style.backgroundColor) > 0.01 &&
          clampedW * clampedH >= viewportArea * 0.5) {
        modalActive = true;
      }
    }

    if (painted) pushClamped(uiRects, rect);

    for (const child of el.childNodes) {
      if (child.nodeType !== 3) continue;
      const trimmed = child.nodeValue ? child.nodeValue.trim() : '';
      if (!trimmed) continue;
      visibleTextChars += trimmed.length;
      const range = document.createRange();
      range.selectNodeContents(child);
      for (const tr of range.getClientRects()) pushClamped(uiRects, tr);
    }
  }

  const visibleButtonLabels = [];
  for (const btn of document.querySelectorAll('button, [role="button"]')) {
    if (btn.closest(TOUCH_SELECTOR) || btn.closest(DEBUG_SELECTOR)) continue;
    if (!isVisible(btn)) continue;
    const rect = btn.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const label = (btn.innerText || btn.textContent || btn.getAttribute('aria-label') || '').trim().slice(0, 24);
    visibleButtonLabels.push(label);
  }

  const unionArea = unionRectsArea(uiRects);
  return {
    viewport: { width: vw, height: vh },
    hudAreaRatio: +(unionArea / viewportArea).toFixed(4),
    visibleButtons: visibleButtonLabels.length,
    visibleButtonLabels,
    visibleTextChars,
    debugVisible,
    modalActive,
  };
}

/**
 * Evaluates a collected page UI audit against Anti-Bloat budgets.
 * @param {ReturnType<typeof collectPageUiAudit> | null | undefined} audit
 * @param {{ maxHudRatio?: number, maxHudButtons?: number, allowDebug?: boolean }} [options]
 * @returns {string[]}
 */
export function evaluateUiAudit(audit, { maxHudRatio = 0.10, maxHudButtons = 1, allowDebug = false } = {}) {
  const problems = [];
  if (!audit) return problems;
  if (!allowDebug && audit.debugVisible) {
    problems.push('debug panel is visible without debug=1');
  }
  if (!audit.modalActive && audit.hudAreaRatio > maxHudRatio) {
    problems.push(`HUD area ratio ${audit.hudAreaRatio} exceeds ${maxHudRatio}`);
  }
  if (!audit.modalActive && audit.visibleButtons > maxHudButtons) {
    problems.push(`visible HUD buttons ${audit.visibleButtons} exceed ${maxHudButtons}`);
  }
  return problems;
}
