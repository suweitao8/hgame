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
  /** @type {{ id: string, node: object, rect: { x: number, y: number, width: number, height: number } }[]} */
  let hitNodes = [];
  let lastLayout = null;
  const deviceRatio = Math.max(1, Number(dpr) || 1);

  function collectHitsAndNodes(layoutNode, srcNode, outList) {
    if (!layoutNode || !srcNode) return;
    outList.push({ id: srcNode.id ?? layoutNode.id ?? null, node: srcNode, rect: layoutNode });
    const srcChildren = Array.isArray(srcNode.children) ? srcNode.children : [];
    const layChildren = Array.isArray(layoutNode.children) ? layoutNode.children : [];
    for (let i = 0; i < layChildren.length && i < srcChildren.length; i++) {
      collectHitsAndNodes(layChildren[i], srcChildren[i], outList);
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
    lastLayout = computeFlexLayout(tree, width, height);
    hitNodes = [];
    collectHitsAndNodes(lastLayout, tree, hitNodes);
    return lastLayout;
  }

  function render(ctx, tree, width, height) {
    const resolved = layout(tree, width, height);
    if (ctx) renderNode(ctx, resolved, tree);
    return resolved;
  }

  function hitTest(px, py) {
    for (let i = hitNodes.length - 1; i >= 0; i--) {
      const entry = hitNodes[i];
      const { node, rect } = entry;
      if (node.interactive === false && node.type !== 'button' && node.type !== 'slider' && node.type !== 'scrollList' && node.type !== 'textInput') {
        continue;
      }
      if (px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height) {
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
    const hit = hitTest(px, py);
    if (!hit || hit.node?.type !== 'scrollList') return 0;
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
    getState,
  });
}
