/**
 * Native Canvas UI Widget & HiDPI Crisp Text Renderer powered by `computeFlexLayout`.
 * Supports panels, buttons, HiDPI outlined labels, progress bars, sliders, and clipped scroll lists
 * with pointer hit-testing, hover/pressed state, scrolling, and keyboard focus navigation.
 */
import { computeFlexLayout } from './flex-layout.js';

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

  function drawCrispText(ctx, text, x, y, {
    fontSize = 14,
    color = '#f8fafc',
    outlineColor = 'rgba(2, 6, 23, 0.85)',
    outlineWidth = 2.5,
    align = 'center',
    baseline = 'middle',
    weight = '600',
  } = {}) {
    if (!ctx || text == null) return;
    const str = String(text);
    ctx.font = `${weight} ${Math.max(8, Math.round(fontSize * deviceRatio) / deviceRatio)}px ${fontFamily}`;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    if (outlineWidth > 0 && typeof ctx.strokeText === 'function') {
      ctx.lineWidth = outlineWidth;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = outlineColor;
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText?.(str, x, y);
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
      if (node.interactive === false && node.type !== 'button' && node.type !== 'slider' && node.type !== 'scrollList') {
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

  function getState() {
    return {
      hoveredId: widgetState.hoveredId,
      pressedId: widgetState.pressedId,
      focusedId: widgetState.focusedId,
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
    scroll,
    getState,
  });
}
