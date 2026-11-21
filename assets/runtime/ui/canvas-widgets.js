/**
 * Native Canvas UI Widget, SDF/HiDPI Crisp Text & TextInput Renderer powered by `computeFlexLayout`.
 * Supports panels, buttons, SDF/outlined labels, text inputs, progress bars, sliders, and clipped
 * scroll lists with pointer hit-testing, hover/pressed state, scrolling, and keyboard typing/focus.
 */
import { computeFlexLayout } from './flex-layout.js';

/**
 * Render sharp multi-scale typography onto a Canvas2D context using an SDF glyph atlas when
 * provided (`atlas: { image, glyphSize, scale, glyphs: Record<string, { x, y, w, h, advance }> }`),
 * or supersampled HiDPI outlined vector text fallback otherwise.
 *
 * @param {any} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {object} [options]
 * @param {number} [options.fontSize=14]
 * @param {string} [options.color='#f8fafc']
 * @param {string} [options.outlineColor='rgba(2, 6, 23, 0.85)']
 * @param {number} [options.outlineWidth=2.5]
 * @param {string | null} [options.shadowColor=null]
 * @param {string} [options.fontFamily='system-ui, sans-serif']
 * @param {string} [options.weight='600']
 * @param {string} [options.align='left']
 * @param {string} [options.baseline='middle']
 * @param {number} [options.dpr=1]
 * @param {any} [options.atlas=null]
 */
export function renderSdfText(ctx, text, x, y, {
  fontSize = 14,
  color = '#f8fafc',
  outlineColor = 'rgba(2, 6, 23, 0.85)',
  outlineWidth = 2.5,
  shadowColor = null,
  fontFamily = 'system-ui, sans-serif',
  weight = '600',
  align = 'left',
  baseline = 'middle',
  dpr = 1,
  atlas = null,
} = {}) {
  if (!ctx || text == null) return false;
  const str = String(text);

  if (atlas && atlas.image && atlas.glyphs && typeof ctx.drawImage === 'function') {
    const baseSize = Math.max(8, Number(atlas.glyphSize) || 32);
    const scale = Math.max(0.1, (Number(fontSize) || 14) / baseSize);
    let totalAdv = 0;
    for (let i = 0; i < str.length; i++) {
      const g = atlas.glyphs[str[i]];
      totalAdv += g ? (g.advance ?? g.w) * scale : (Number(fontSize) || 14) * 0.5;
    }
    let penX = align === 'center' ? x - totalAdv * 0.5 : (align === 'right' ? x - totalAdv : x);
    const topY = baseline === 'top' ? y : (baseline === 'bottom' ? y - fontSize : y - fontSize * 0.5);
    ctx.save?.();
    if (shadowColor && 'shadowColor' in ctx) {
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = Math.max(1, outlineWidth);
    }
    for (let i = 0; i < str.length; i++) {
      const g = atlas.glyphs[str[i]];
      if (!g) {
        penX += (Number(fontSize) || 14) * 0.5;
        continue;
      }
      ctx.drawImage(atlas.image, g.x, g.y, g.w, g.h, penX, topY, g.w * scale, g.h * scale);
      penX += (g.advance ?? g.w) * scale;
    }
    ctx.restore?.();
    return true;
  }

  const ratio = Math.max(1, Number(dpr) || 1);
  ctx.save?.();
  ctx.font = `${weight} ${Math.max(8, Math.round(fontSize * ratio) / ratio)}px ${fontFamily}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (shadowColor && 'shadowColor' in ctx) {
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = 3;
  }
  if (outlineWidth > 0 && typeof ctx.strokeText === 'function') {
    ctx.lineWidth = outlineWidth;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = outlineColor;
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText?.(str, x, y);
  ctx.restore?.();
  return true;
}

function isWideOrCjkChar(ch) {
  const code = ch.charCodeAt(0);
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0x3000 && code <= 0x303f)
  );
}

function measureStyledText(ctx, text, style) {
  if (!text) return 0;
  const fs = Math.max(8, Number(style.fontSize) || 14);
  if (ctx && typeof ctx.measureText === 'function') {
    ctx.font = `${style.italic ? 'italic ' : ''}${style.weight ?? '600'} ${fs}px ${style.fontFamily ?? 'system-ui, sans-serif'}`;
    const m = ctx.measureText(text);
    if (m && Number.isFinite(m.width)) return m.width;
  }
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    width += isWideOrCjkChar(text[i]) ? fs : fs * 0.56;
  }
  return width;
}

function tokenizeRichSegment(str) {
  const tokens = [];
  let buf = '';
  let inSpace = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\n') {
      if (buf) { tokens.push(buf); buf = ''; }
      tokens.push('\n');
      inSpace = false;
      continue;
    }
    if (isWideOrCjkChar(ch)) {
      if (buf) { tokens.push(buf); buf = ''; }
      tokens.push(ch);
      inSpace = false;
      continue;
    }
    const isWs = ch === ' ' || ch === '\t';
    if (isWs !== inSpace) {
      if (buf) { tokens.push(buf); buf = ''; }
      inSpace = isWs;
    }
    buf += ch;
  }
  if (buf) tokens.push(buf);
  return tokens;
}

/**
 * Lay out styled rich-text spans (`string | { text, color?, fontSize?, weight?, italic?, outlineColor?, outlineWidth?, underline? }`)
 * into wrapped visual lines constrained by `maxWidth`, breaking on CJK character boundaries and ASCII word boundaries.
 *
 * @param {any} ctx
 * @param {string | Array<string | { text?: string, color?: string, fontSize?: number, weight?: string | number, italic?: boolean, outlineColor?: string, outlineWidth?: number, underline?: boolean }>} spans
 * @param {number} maxWidth
 * @param {object} [defaultOpts]
 * @returns {{ segments: { text: string, style: Record<string, any>, width: number, fontSize: number }[], width: number, height: number }[]}
 */
export function layoutRichTextLines(ctx, spans, maxWidth, defaultOpts = {}) {
  const limitW = Math.max(8, Number(maxWidth) || 200);
  const rawList = Array.isArray(spans) ? spans : [spans ?? ''];
  const baseStyle = {
    color: defaultOpts.color ?? '#f1f5f9',
    fontSize: Math.max(8, Number(defaultOpts.fontSize) || 14),
    weight: String(defaultOpts.weight ?? '600'),
    italic: Boolean(defaultOpts.italic),
    fontFamily: defaultOpts.fontFamily ?? 'system-ui, sans-serif',
    outlineColor: defaultOpts.outlineColor ?? 'rgba(2, 6, 23, 0.85)',
    outlineWidth: defaultOpts.outlineWidth ?? 1.5,
    underline: Boolean(defaultOpts.underline),
  };

  /** @type {{ segments: { text: string, style: Record<string, any>, width: number, fontSize: number }[], width: number, height: number }[]} */
  const lines = [];
  let curSegs = [];
  let curW = 0;
  let curH = baseStyle.fontSize;

  const flushLine = () => {
    lines.push({ segments: curSegs, width: curW, height: curH });
    curSegs = [];
    curW = 0;
    curH = baseStyle.fontSize;
  };

  const pushSegment = (text, style, segW) => {
    const fs = style.fontSize;
    curH = Math.max(curH, fs);
    const prev = curSegs[curSegs.length - 1];
    if (prev && prev.style === style) {
      prev.text += text;
      prev.width += segW;
    } else {
      curSegs.push({ text, style, width: segW, fontSize: fs });
    }
    curW += segW;
  };

  ctx?.save?.();
  try {
    for (const item of rawList) {
      const span = typeof item === 'string' ? { text: item } : (item && typeof item === 'object' ? item : { text: '' });
      const text = String(span.text ?? '');
      if (!text) continue;
      const style = {
        ...baseStyle,
        ...span,
        fontSize: Math.max(8, Number(span.fontSize ?? baseStyle.fontSize) || baseStyle.fontSize),
        weight: String(span.weight ?? baseStyle.weight),
      };
      const tokens = tokenizeRichSegment(text);
      for (const tok of tokens) {
        if (tok === '\n') {
          flushLine();
          continue;
        }
        const tokW = measureStyledText(ctx, tok, style);
        const isWhitespace = /^\s+$/.test(tok);
        if (curW > 0 && curW + tokW > limitW) {
          flushLine();
          if (isWhitespace) continue;
        }
        if (tokW > limitW && curW === 0 && tok.length > 1) {
          let chunk = '';
          let chunkW = 0;
          for (let i = 0; i < tok.length; i++) {
            const ch = tok[i];
            const chW = measureStyledText(ctx, ch, style);
            if (chunk && chunkW + chW > limitW) {
              pushSegment(chunk, style, chunkW);
              flushLine();
              chunk = ch;
              chunkW = chW;
            } else {
              chunk += ch;
              chunkW += chW;
            }
          }
          if (chunk) pushSegment(chunk, style, chunkW);
        } else {
          pushSegment(tok, style, tokW);
        }
      }
    }
    if (curSegs.length > 0 || lines.length === 0) {
      flushLine();
    }
  } finally {
    ctx?.restore?.();
  }
  return lines;
}

/**
 * Create a visually-hidden semantic DOM ARIA mirror for a Canvas UI tree so screen
 * readers and keyboard navigation can inspect and activate buttons, inputs, sliders,
 * scroll regions, and rich-text/label nodes without shifting canvas layout.
 *
 * @param {any} container Host DOM element receiving the visually-hidden ARIA container.
 * @returns {{ sync: (hitNodes: readonly any[], widgetState?: any) => number, getElementCount: () => number, getRoot: () => any, dispose: () => boolean }}
 */
export function createCanvasAriaBridge(container) {
  const doc = container?.ownerDocument ?? (typeof globalThis.document !== 'undefined' ? globalThis.document : null);
  let root = null;
  let disposed = false;

  if (doc && typeof doc.createElement === 'function') {
    root = doc.createElement('div');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Canvas UI');
    root.setAttribute('data-hgame-aria-bridge', 'true');
    if (root.style) {
      root.style.position = 'absolute';
      root.style.width = '1px';
      root.style.height = '1px';
      root.style.overflow = 'hidden';
      root.style.clip = 'rect(0, 0, 0, 0)';
      root.style.clipPath = 'inset(50%)';
      root.style.whiteSpace = 'nowrap';
      root.style.border = '0';
      root.style.margin = '0';
      root.style.padding = '0';
    }
    container?.appendChild?.(root);
  }

  function clearChildren() {
    if (!root) return;
    if (Array.isArray(root.children) && typeof root.removeChild === 'function') {
      while (root.firstChild) root.removeChild(root.firstChild);
    } else if ('innerHTML' in root) {
      root.innerHTML = '';
    }
  }

  function sync(hitNodes = [], widgetState = null) {
    if (disposed || !root || !doc) return 0;
    clearChildren();
    let count = 0;
    for (let i = 0; i < hitNodes.length; i++) {
      const entry = hitNodes[i];
      const node = entry?.node;
      if (!node || node.visible === false || node.ariaHidden === true) continue;
      const kind = node.type ?? 'box';
      if (kind !== 'button' && kind !== 'textInput' && kind !== 'slider' &&
          kind !== 'scrollList' && kind !== 'scrollView' && kind !== 'richText' && kind !== 'label') {
        continue;
      }

      const tag = kind === 'button' ? 'button' : 'div';
      const el = doc.createElement(tag);
      const id = entry.id ?? node.id ?? `node-${i}`;
      el.setAttribute('data-node-id', String(id));

      if (kind === 'button') {
        if (tag === 'button') el.type = 'button';
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', String(node.ariaLabel ?? node.text ?? node.label ?? id));
        el.tabIndex = 0;
        el.textContent = String(node.text ?? node.label ?? id);
        el.onclick = () => node.onClick?.(node);
        el.onfocus = () => { if (widgetState) widgetState.focusedId = id; };
      } else if (kind === 'textInput') {
        el.setAttribute('role', 'textbox');
        el.setAttribute('aria-label', String(node.ariaLabel ?? node.placeholder ?? id));
        el.setAttribute('aria-valuetext', String(node.value ?? ''));
        el.tabIndex = 0;
        el.onfocus = () => { if (widgetState) widgetState.focusedId = id; };
      } else if (kind === 'slider') {
        el.setAttribute('role', 'slider');
        el.setAttribute('aria-label', String(node.ariaLabel ?? node.label ?? id));
        el.setAttribute('aria-valuemin', '0');
        el.setAttribute('aria-valuemax', '1');
        el.setAttribute('aria-valuenow', String(Math.max(0, Math.min(1, Number(node.value) || 0))));
        el.tabIndex = 0;
        el.onfocus = () => { if (widgetState) widgetState.focusedId = id; };
      } else if (kind === 'scrollList' || kind === 'scrollView') {
        el.setAttribute('role', 'region');
        el.setAttribute('aria-label', String(node.ariaLabel ?? node.label ?? id));
      } else if (kind === 'richText' || kind === 'label') {
        el.setAttribute('role', 'text');
        const textVal = Array.isArray(node.spans)
          ? node.spans.map(s => (typeof s === 'string' ? s : (s?.text ?? ''))).join('')
          : String(node.ariaLabel ?? node.text ?? node.label ?? '');
        el.setAttribute('aria-label', textVal);
        el.textContent = textVal;
      }

      root.appendChild(el);
      count++;
    }
    return count;
  }

  function getElementCount() {
    return root?.children?.length ?? root?.childNodes?.length ?? 0;
  }

  function getRoot() {
    return root;
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    clearChildren();
    root?.parentNode?.removeChild?.(root);
    root = null;
    return true;
  }

  return Object.freeze({
    sync,
    getElementCount,
    getRoot,
    dispose,
  });
}

/**
 * @param {object} [options]
 * @param {string} [options.fontFamily='system-ui, sans-serif']
 * @param {number} [options.dpr=1]
 */
export function createCanvasUiRenderer({
  fontFamily = 'system-ui, sans-serif',
  dpr = 1,
} = {}) {
  const widgetState = {
    hoveredId: null,
    pressedId: null,
    focusedId: null,
    composingText: '',
    scrollOffsets: new Map(),
  };
  /** @type {{ id: string, node: object, rect: { x: number, y: number, width: number, height: number }, scrollParentId?: string | null, clipRect?: { x: number, y: number, width: number, height: number } | null }[]} */
  let hitNodes = [];
  let lastLayout = null;
  let lastLayoutRenderCtx = null;
  const scrollMeta = new Map();
  let ownedAriaBridge = null;
  let ownedAriaContainer = null;
  const deviceRatio = Math.max(1, Number(dpr) || 1);

  function resolveScrollViews(layoutNode, srcNode) {
    if (!layoutNode || !srcNode) return;
    const srcChildren = Array.isArray(srcNode.children) ? srcNode.children : [];
    if (srcNode.type === 'scrollView' && srcChildren.length > 0) {
      const svId = srcNode.id ?? layoutNode.id ?? null;
      const expanded = computeFlexLayout(
        { ...srcNode, width: layoutNode.width, height: 1e6 },
        layoutNode.width,
        1e6,
        layoutNode.x,
        layoutNode.y,
      );
      layoutNode.children = expanded.children;
      let maxBottom = layoutNode.y;
      for (const ch of layoutNode.children) {
        maxBottom = Math.max(maxBottom, ch.y + ch.height);
      }
      const padBottom = typeof srcNode.padding === 'number'
        ? Math.max(0, srcNode.padding)
        : Math.max(0, Number(srcNode.padding?.bottom) || 0);
      const contentHeight = Math.max(0, maxBottom - layoutNode.y + padBottom);
      if (svId != null) {
        scrollMeta.set(svId, { contentHeight, viewHeight: layoutNode.height });
        const prev = widgetState.scrollOffsets.get(svId) ?? 0;
        const maxScroll = Math.max(0, contentHeight - layoutNode.height);
        if (prev > maxScroll) widgetState.scrollOffsets.set(svId, maxScroll);
      }
    }
    const layChildren = Array.isArray(layoutNode.children) ? layoutNode.children : [];
    for (let i = 0; i < layChildren.length && i < srcChildren.length; i++) {
      resolveScrollViews(layChildren[i], srcChildren[i]);
    }
  }

  function collectHitsAndNodes(layoutNode, srcNode, outList, activeScroll = null) {
    if (!layoutNode || !srcNode) return;
    const id = srcNode.id ?? layoutNode.id ?? null;
    outList.push({
      id,
      node: srcNode,
      rect: layoutNode,
      scrollParentId: activeScroll?.id ?? null,
      clipRect: activeScroll?.clipRect ?? null,
    });
    const nextScroll = srcNode.type === 'scrollView' && id != null
      ? { id, clipRect: { x: layoutNode.x, y: layoutNode.y, width: layoutNode.width, height: layoutNode.height } }
      : activeScroll;
    const srcChildren = Array.isArray(srcNode.children) ? srcNode.children : [];
    const layChildren = Array.isArray(layoutNode.children) ? layoutNode.children : [];
    for (let i = 0; i < layChildren.length && i < srcChildren.length; i++) {
      collectHitsAndNodes(layChildren[i], srcChildren[i], outList, nextScroll);
    }
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    const rad = Math.min(Math.max(0, r || 0), w * 0.5, h * 0.5);
    ctx.beginPath?.();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, rad);
    } else if (typeof ctx.rect === 'function') {
      ctx.rect(x, y, w, h);
    }
  }

  function drawCrispText(ctx, text, x, y, opts = {}) {
    return renderSdfText(ctx, text, x, y, {
      fontFamily,
      dpr: deviceRatio,
      align: 'center',
      ...opts,
    });
  }

  function renderNode(ctx, layoutNode, srcNode) {
    if (!srcNode || srcNode.visible === false) return;
    const { x, y, width, height } = layoutNode;
    const kind = srcNode.type ?? 'box';
    const isHovered = srcNode.id != null && widgetState.hoveredId === srcNode.id;
    const isPressed = srcNode.id != null && widgetState.pressedId === srcNode.id;
    const isFocused = srcNode.id != null && widgetState.focusedId === srcNode.id;

    if (kind === 'panel' || srcNode.bg) {
      drawRoundedRect(ctx, x, y, width, height, srcNode.radius ?? 8);
      ctx.fillStyle = srcNode.bg ?? 'rgba(15, 23, 42, 0.88)';
      ctx.fill?.();
      if (srcNode.borderColor || isFocused) {
        ctx.lineWidth = isFocused ? 2 : (srcNode.borderWidth ?? 1);
        ctx.strokeStyle = isFocused ? '#38bdf8' : srcNode.borderColor;
        ctx.stroke?.();
      }
    }

    if (kind === 'button') {
      drawRoundedRect(ctx, x, y, width, height, srcNode.radius ?? 6);
      ctx.fillStyle = isPressed
        ? (srcNode.pressedBg ?? '#0284c7')
        : isHovered
          ? (srcNode.hoverBg ?? '#38bdf8')
          : (srcNode.bg ?? '#0ea5e9');
      ctx.fill?.();
      if (isFocused) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fef08a';
        ctx.stroke?.();
      }
      drawCrispText(ctx, srcNode.text ?? srcNode.label ?? '', x + width * 0.5, y + height * 0.5, {
        fontSize: srcNode.fontSize ?? 14,
        color: srcNode.color ?? '#ffffff',
      });
    } else if (kind === 'label' && (srcNode.text !== undefined || srcNode.label !== undefined)) {
      const align = srcNode.textAlign ?? 'left';
      const tx = align === 'center' ? x + width * 0.5 : (align === 'right' ? x + width : x);
      drawCrispText(ctx, srcNode.text ?? srcNode.label ?? '', tx, y + height * 0.5, {
        fontSize: srcNode.fontSize ?? 14,
        color: srcNode.color ?? '#f1f5f9',
        align,
      });
    } else if (kind === 'progress' || kind === 'slider') {
      const val = Math.max(0, Math.min(1, Number(srcNode.value) || 0));
      drawRoundedRect(ctx, x, y, width, height, height * 0.5);
      ctx.fillStyle = srcNode.trackBg ?? 'rgba(30, 41, 59, 0.9)';
      ctx.fill?.();
      const fillW = Math.max(0, width * val);
      if (fillW > 0) {
        drawRoundedRect(ctx, x, y, fillW, height, height * 0.5);
        ctx.fillStyle = srcNode.fillBg ?? '#22c55e';
        ctx.fill?.();
      }
      if (kind === 'slider') {
        const kx = x + fillW;
        const ky = y + height * 0.5;
        ctx.beginPath?.();
        ctx.arc?.(kx, ky, Math.max(6, height * 0.65), 0, Math.PI * 2);
        ctx.fillStyle = isHovered || isPressed ? '#ffffff' : '#e2e8f0';
        ctx.fill?.();
      }
    } else if (kind === 'textInput') {
      drawRoundedRect(ctx, x, y, width, height, srcNode.radius ?? 6);
      ctx.fillStyle = srcNode.bg ?? 'rgba(15, 23, 42, 0.94)';
      ctx.fill?.();
      ctx.lineWidth = isFocused ? 2 : 1;
      ctx.strokeStyle = isFocused ? '#38bdf8' : (isHovered ? '#94a3b8' : (srcNode.borderColor ?? '#475569'));
      ctx.stroke?.();
      const rawVal = typeof srcNode.value === 'string' ? srcNode.value : '';
      const composing = isFocused && widgetState.composingText ? widgetState.composingText : '';
      const combined = rawVal + composing;
      const hasVal = combined.length > 0;
      const display = hasVal ? combined : (srcNode.placeholder ?? '');
      drawCrispText(ctx, display + (isFocused ? '|' : ''), x + 10, y + height * 0.5, {
        fontSize: srcNode.fontSize ?? 14,
        color: hasVal ? (srcNode.color ?? '#f8fafc') : (srcNode.placeholderColor ?? '#64748b'),
        align: 'left',
        outlineWidth: 1.5,
        atlas: srcNode.atlas ?? null,
      });
      if (composing.length > 0 && ctx) {
        const fs = srcNode.fontSize ?? 14;
        const style = { fontSize: fs, weight: '600', fontFamily };
        const prefixW = measureStyledText(ctx, rawVal, style);
        const compW = measureStyledText(ctx, composing, style);
        const uy = y + height * 0.5 + fs * 0.55;
        ctx.save?.();
        ctx.strokeStyle = srcNode.composingUnderlineColor ?? '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.beginPath?.();
        ctx.moveTo?.(x + 10 + prefixW, uy);
        ctx.lineTo?.(x + 10 + prefixW + compW, uy);
        ctx.stroke?.();
        ctx.restore?.();
      }
    } else if (kind === 'richText') {
      const padX = Number(srcNode.paddingX) || 2;
      const fs = srcNode.fontSize ?? 14;
      const lines = layoutRichTextLines(ctx, srcNode.spans ?? srcNode.text ?? srcNode.label ?? '', Math.max(8, width - padX * 2), {
        fontSize: fs,
        color: srcNode.color ?? '#f1f5f9',
        weight: srcNode.weight ?? '600',
        fontFamily: srcNode.fontFamily ?? fontFamily,
        outlineColor: srcNode.outlineColor ?? 'rgba(2, 6, 23, 0.85)',
        outlineWidth: srcNode.outlineWidth ?? 1.5,
      });
      const lineMult = Math.max(1.0, Number(srcNode.lineHeight) || 1.35);
      const align = srcNode.textAlign ?? 'left';
      let cursorY = y + 2;
      for (const line of lines) {
        const lh = line.height * lineMult;
        if (cursorY > y + height) break;
        let penX = align === 'center'
          ? x + (width - line.width) * 0.5
          : align === 'right'
            ? x + width - padX - line.width
            : x + padX;
        const baselineY = cursorY + line.height * 0.5;
        for (const seg of line.segments) {
          renderSdfText(ctx, seg.text, penX, baselineY, {
            fontSize: seg.style.fontSize,
            color: seg.style.color,
            outlineColor: seg.style.outlineColor,
            outlineWidth: seg.style.outlineWidth,
            fontFamily: seg.style.fontFamily,
            weight: `${seg.style.italic ? 'italic ' : ''}${seg.style.weight}`,
            align: 'left',
            baseline: 'middle',
            dpr: deviceRatio,
          });
          if (seg.style.underline && ctx) {
            ctx.save?.();
            ctx.strokeStyle = seg.style.color;
            ctx.lineWidth = Math.max(1, seg.style.fontSize * 0.08);
            ctx.beginPath?.();
            ctx.moveTo?.(penX, baselineY + seg.style.fontSize * 0.48);
            ctx.lineTo?.(penX + seg.width, baselineY + seg.style.fontSize * 0.48);
            ctx.stroke?.();
            ctx.restore?.();
          }
          penX += seg.width;
        }
        cursorY += lh;
      }
    } else if (kind === 'scrollView') {
      const scrollY = widgetState.scrollOffsets.get(srcNode.id) ?? 0;
      const srcChildren = Array.isArray(srcNode.children) ? srcNode.children : [];
      const layChildren = Array.isArray(layoutNode.children) ? layoutNode.children : [];
      ctx?.save?.();
      ctx?.beginPath?.();
      ctx?.rect?.(x, y, width, height);
      ctx?.clip?.();
      if (scrollY !== 0) ctx?.translate?.(0, -scrollY);
      try {
        for (let i = 0; i < layChildren.length && i < srcChildren.length; i++) {
          const chRect = layChildren[i];
          if (chRect.y + chRect.height - scrollY < y || chRect.y - scrollY > y + height) continue;
          renderNode(ctx, chRect, srcChildren[i]);
        }
      } finally {
        ctx?.restore?.();
      }
      const meta = scrollMeta.get(srcNode.id);
      if (meta && meta.contentHeight > height + 1 && width > 8) {
        const trackH = Math.max(12, height - 4);
        const thumbH = Math.max(16, (height / meta.contentHeight) * trackH);
        const maxScroll = Math.max(1, meta.contentHeight - height);
        const thumbY = y + 2 + (scrollY / maxScroll) * (trackH - thumbH);
        drawRoundedRect(ctx, x + width - 5, thumbY, 3, thumbH, 1.5);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
        ctx.fill?.();
      }
      return;
    } else if (kind === 'scrollList') {
      const items = Array.isArray(srcNode.items) ? srcNode.items : [];
      const rowHeight = Math.max(18, Number(srcNode.rowHeight) || 28);
      const scrollY = widgetState.scrollOffsets.get(srcNode.id) ?? 0;
      ctx.save?.();
      ctx.beginPath?.();
      ctx.rect?.(x, y, width, height);
      ctx.clip?.();
      for (let i = 0; i < items.length; i++) {
        const ry = y + i * rowHeight - scrollY;
        if (ry + rowHeight < y || ry > y + height) continue;
        drawRoundedRect(ctx, x + 2, ry + 1, Math.max(1, width - 4), rowHeight - 2, 4);
        ctx.fillStyle = i % 2 === 0 ? 'rgba(30, 41, 59, 0.72)' : 'rgba(51, 65, 85, 0.52)';
        ctx.fill?.();
        const label = typeof items[i] === 'string' ? items[i] : (items[i]?.label ?? String(i));
        drawCrispText(ctx, label, x + 10, ry + rowHeight * 0.5, {
          fontSize: srcNode.fontSize ?? 13,
          align: 'left',
          outlineWidth: 1.5,
        });
      }
      ctx.restore?.();
    }

    const srcChildren = Array.isArray(srcNode.children) ? srcNode.children : [];
    const layChildren = Array.isArray(layoutNode.children) ? layoutNode.children : [];
    for (let i = 0; i < layChildren.length && i < srcChildren.length; i++) {
      renderNode(ctx, layChildren[i], srcChildren[i]);
    }
  }

  function layout(tree, width, height) {
    scrollMeta.clear();
    lastLayout = computeFlexLayout(tree, width, height);
    resolveScrollViews(lastLayout, tree);
    hitNodes = [];
    collectHitsAndNodes(lastLayout, tree, hitNodes);
    return lastLayout;
  }

  function render(ctx, tree, width, height) {
    lastLayoutRenderCtx = ctx ?? lastLayoutRenderCtx;
    const resolved = layout(tree, width, height);
    if (ctx) renderNode(ctx, resolved, tree);
    return resolved;
  }

  function hitTest(px, py) {
    for (let i = hitNodes.length - 1; i >= 0; i--) {
      const entry = hitNodes[i];
      const { node, rect, scrollParentId, clipRect } = entry;
      if (node.interactive === false && node.type !== 'button' && node.type !== 'slider' && node.type !== 'scrollList' && node.type !== 'scrollView' && node.type !== 'textInput') {
        continue;
      }
      if (clipRect && (px < clipRect.x || px > clipRect.x + clipRect.width || py < clipRect.y || py > clipRect.y + clipRect.height)) {
        continue;
      }
      const dy = scrollParentId ? (widgetState.scrollOffsets.get(scrollParentId) ?? 0) : 0;
      const ry = rect.y - dy;
      if (px >= rect.x && px <= rect.x + rect.width && py >= ry && py <= ry + rect.height) {
        return entry;
      }
    }
    return null;
  }

  function pointerMove(px, py) {
    const hit = hitTest(px, py);
    widgetState.hoveredId = hit?.id ?? null;
    if (widgetState.pressedId) {
      const pressedEntry = hitNodes.find(h => h.id === widgetState.pressedId);
      if (pressedEntry?.node?.type === 'slider') {
        const t = Math.max(0, Math.min(1, (px - pressedEntry.rect.x) / Math.max(1, pressedEntry.rect.width)));
        pressedEntry.node.value = t;
        pressedEntry.node.onChange?.(t, pressedEntry.node);
      }
    }
    return widgetState.hoveredId;
  }

  function pointerDown(px, py) {
    const hit = hitTest(px, py);
    widgetState.pressedId = hit?.id ?? null;
    if (hit?.id) widgetState.focusedId = hit.id;
    if (hit?.node?.type === 'slider') {
      const t = Math.max(0, Math.min(1, (px - hit.rect.x) / Math.max(1, hit.rect.width)));
      hit.node.value = t;
      hit.node.onChange?.(t, hit.node);
    }
    return hit;
  }

  function pointerUp(px, py) {
    const prevPressed = widgetState.pressedId;
    widgetState.pressedId = null;
    const hit = hitTest(px, py);
    if (hit && prevPressed && hit.id === prevPressed && hit.node?.type === 'button') {
      hit.node.onClick?.(hit.node);
      return hit.id;
    }
    return null;
  }

  function scroll(deltaY, px, py) {
    let hit = null;
    for (let i = hitNodes.length - 1; i >= 0; i--) {
      const entry = hitNodes[i];
      if (entry.node?.type !== 'scrollList' && entry.node?.type !== 'scrollView') continue;
      const { rect } = entry;
      if (px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height) {
        hit = entry;
        break;
      }
    }
    if (!hit) return 0;
    if (hit.node.type === 'scrollView') {
      const meta = scrollMeta.get(hit.id);
      const maxScroll = Math.max(0, (meta?.contentHeight ?? 0) - hit.rect.height);
      const prev = widgetState.scrollOffsets.get(hit.id) ?? 0;
      const next = Math.max(0, Math.min(maxScroll, prev + (Number(deltaY) || 0)));
      widgetState.scrollOffsets.set(hit.id, next);
      return next;
    }
    const items = Array.isArray(hit.node.items) ? hit.node.items : [];
    const rowH = Math.max(18, Number(hit.node.rowHeight) || 28);
    const maxScroll = Math.max(0, items.length * rowH - hit.rect.height);
    const prev = widgetState.scrollOffsets.get(hit.id) ?? 0;
    const next = Math.max(0, Math.min(maxScroll, prev + (Number(deltaY) || 0)));
    widgetState.scrollOffsets.set(hit.id, next);
    return next;
  }

  function keyDown(key) {
    if (!widgetState.focusedId || typeof key !== 'string') return false;
    const entry = hitNodes.find(h => h.id === widgetState.focusedId);
    const node = entry?.node;
    if (!node || node.type !== 'textInput') return false;
    const cur = typeof node.value === 'string' ? node.value : '';
    const maxLen = Number.isInteger(node.maxLength) && node.maxLength > 0 ? node.maxLength : 64;
    if (key === 'Backspace') {
      node.value = cur.slice(0, -1);
      node.onChange?.(node.value, node);
      return true;
    }
    if (key === 'Enter') {
      node.onSubmit?.(cur, node);
      return true;
    }
    if (key === 'Escape') {
      widgetState.focusedId = null;
      return true;
    }
    if (key.length === 1 && cur.length < maxLen) {
      node.value = cur + key;
      node.onChange?.(node.value, node);
      return true;
    }
    return false;
  }

  function compositionUpdate(text) {
    if (!widgetState.focusedId) return false;
    widgetState.composingText = typeof text === 'string' ? text : '';
    return true;
  }

  function compositionEnd(text) {
    widgetState.composingText = '';
    if (!widgetState.focusedId || typeof text !== 'string' || !text) return false;
    const entry = hitNodes.find(h => h.id === widgetState.focusedId);
    const node = entry?.node;
    if (!node || node.type !== 'textInput') return false;
    const cur = typeof node.value === 'string' ? node.value : '';
    const maxLen = Number.isInteger(node.maxLength) && node.maxLength > 0 ? node.maxLength : 64;
    node.value = (cur + text).slice(0, maxLen);
    node.onChange?.(node.value, node);
    return true;
  }

  function getState() {
    return {
      hoveredId: widgetState.hoveredId,
      pressedId: widgetState.pressedId,
      focusedId: widgetState.focusedId,
      composingText: widgetState.composingText,
      hitCount: hitNodes.length,
    };
  }

  function syncAriaTree(container = ownedAriaContainer) {
    if (!ownedAriaBridge || (container && container !== ownedAriaContainer)) {
      ownedAriaBridge?.dispose?.();
      ownedAriaContainer = container ?? null;
      ownedAriaBridge = container ? createCanvasAriaBridge(container) : null;
    }
    return ownedAriaBridge ? ownedAriaBridge.sync(hitNodes, widgetState) : 0;
  }

  function dispose() {
    ownedAriaBridge?.dispose?.();
    ownedAriaBridge = null;
    ownedAriaContainer = null;
    scrollMeta.clear();
  }

  return Object.freeze({
    layout,
    render,
    hitTest,
    pointerMove,
    pointerDown,
    pointerUp,
    keyDown,
    compositionUpdate,
    compositionEnd,
    scroll,
    syncAriaTree,
    dispose,
    getState,
  });
}
