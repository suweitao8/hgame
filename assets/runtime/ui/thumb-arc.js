/**
 * Mobile-First Portrait Bottom-Right Thumb-Arc Comfort Zone Layout & HUD Renderer.
 * Ensures clickable mobile interactions fan ergonomically around the bottom-right thumb
 * quarter-arc / semi-arc, never drifting into the hard-to-reach upper half of the screen.
 */

export const DEFAULT_THUMB_ARC_SPEC = Object.freeze({
  anchor: 'bottom-right',
  minCenterYRatio: 0.52,
  minButtonSize: 48,
  primarySize: 68,
  secondarySize: 52,
  arcRadius: 108,
  outerArcRadius: 172,
  startAngleDeg: 185,
  endAngleDeg: 265,
  cornerMarginRight: 18,
  cornerMarginBottom: 18,
});

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * Evaluate whether a screen-space coordinate lies inside the lower-half portrait thumb comfort zone.
 * @param {{ x: number, y: number }} point
 * @param {{ width: number, height: number }} viewport
 * @param {object} [options]
 * @param {number} [options.minCenterYRatio=0.5]
 * @param {number} [options.maxComfortRadiusRatio=0.88]
 */
export function isInThumbComfortZone(point, viewport, {
  minCenterYRatio = 0.5,
  maxComfortRadiusRatio = 0.88,
} = {}) {
  const vw = Math.max(1, Number(viewport?.width) || 390);
  const vh = Math.max(1, Number(viewport?.height) || 844);
  const px = Number(point?.x) || 0;
  const py = Number(point?.y) || 0;
  const inLowerHalf = py >= vh * minCenterYRatio;
  const originX = vw - DEFAULT_THUMB_ARC_SPEC.cornerMarginRight - DEFAULT_THUMB_ARC_SPEC.primarySize * 0.5;
  const originY = vh - DEFAULT_THUMB_ARC_SPEC.cornerMarginBottom - DEFAULT_THUMB_ARC_SPEC.primarySize * 0.5;
  const dist = Math.hypot(px - originX, py - originY);
  const maxComfort = Math.min(vw, vh) * maxComfortRadiusRatio;
  const inRightArc = px >= vw * 0.25 && dist <= maxComfort;
  return Object.freeze({
    inLowerHalf,
    inRightArc,
    distanceFromCorner: Number(dist.toFixed(2)),
    ok: inLowerHalf && inRightArc,
  });
}

/**
 * Compute concentric bottom-right semi-arc placements for mobile portrait action buttons.
 * Primary slot sits directly under the thumb at the bottom-right hub (`ring = 0`), while
 * secondary actions fan along inner (`ring = 1`) and outer (`ring = 2`) quarter-arcs between
 * `startAngleDeg` (upward-left from corner) and `endAngleDeg` (upward), clamped strictly
 * to the lower half (`cy >= viewportHeight * minCenterYRatio`) and safe-area margins.
 *
 * @param {object} options
 * @param {number} options.viewportWidth
 * @param {number} options.viewportHeight
 * @param {Array<{ id: string, label?: string, primary?: boolean, size?: number, icon?: string, cooldown?: number }>} options.items
 * @param {{ top?: number, right?: number, bottom?: number, left?: number }} [options.safeArea]
 * @param {number} [options.primarySize=68]
 * @param {number} [options.secondarySize=52]
 * @param {number} [options.arcRadius=108]
 * @param {number} [options.outerArcRadius=172]
 * @param {number} [options.minCenterYRatio=0.52]
 * @param {number} [options.startAngleDeg=185]
 * @param {number} [options.endAngleDeg=265]
 */
export function computeThumbArcLayout({
  viewportWidth = 390,
  viewportHeight = 844,
  items = [],
  safeArea = {},
  primarySize = DEFAULT_THUMB_ARC_SPEC.primarySize,
  secondarySize = DEFAULT_THUMB_ARC_SPEC.secondarySize,
  arcRadius = DEFAULT_THUMB_ARC_SPEC.arcRadius,
  outerArcRadius = DEFAULT_THUMB_ARC_SPEC.outerArcRadius,
  minCenterYRatio = DEFAULT_THUMB_ARC_SPEC.minCenterYRatio,
  startAngleDeg = DEFAULT_THUMB_ARC_SPEC.startAngleDeg,
  endAngleDeg = DEFAULT_THUMB_ARC_SPEC.endAngleDeg,
} = {}) {
  const vw = Math.max(180, Number(viewportWidth) || 390);
  const vh = Math.max(240, Number(viewportHeight) || 844);
  const safeRight = Math.max(0, Number(safeArea.right) || 0);
  const safeBottom = Math.max(0, Number(safeArea.bottom) || 0);
  const safeLeft = Math.max(0, Number(safeArea.left) || 0);

  const pSize = Math.max(DEFAULT_THUMB_ARC_SPEC.minButtonSize, Number(primarySize) || 68);
  const sSize = Math.max(DEFAULT_THUMB_ARC_SPEC.minButtonSize, Number(secondarySize) || 52);

  const hubX = vw - safeRight - DEFAULT_THUMB_ARC_SPEC.cornerMarginRight - pSize * 0.5;
  const hubY = vh - safeBottom - DEFAULT_THUMB_ARC_SPEC.cornerMarginBottom - pSize * 0.5;
  const minCenterY = Math.max(vh * clamp(minCenterYRatio, 0.5, 0.9), vh * 0.5);

  const primaryIndex = items.findIndex(it => it?.primary);
  const primaryItem = primaryIndex >= 0 ? items[primaryIndex] : (items[0] ?? null);
  const secondaries = items.filter((_, i) => i !== (primaryIndex >= 0 ? primaryIndex : 0));

  const maxR = Math.max(pSize + 18, Math.min(vw - safeLeft - safeRight - sSize - 16, vh - minCenterY - sSize * 0.5));
  const rInner = Math.min(Number(arcRadius) || DEFAULT_THUMB_ARC_SPEC.arcRadius, maxR);
  const rOuter = Math.min(Number(outerArcRadius) || DEFAULT_THUMB_ARC_SPEC.outerArcRadius, Math.max(rInner, vh - minCenterY + sSize * 0.1));

  const placed = [];

  if (primaryItem) {
    const sz = Math.max(DEFAULT_THUMB_ARC_SPEC.minButtonSize, Number(primaryItem.size) || pSize);
    const rad = sz * 0.5;
    const cx = clamp(hubX, safeLeft + rad + 8, vw - safeRight - rad - 8);
    const cy = clamp(hubY, minCenterY + rad, vh - safeBottom - rad - 8);
    placed.push({
      ...primaryItem,
      id: primaryItem.id ?? 'primary',
      size: sz,
      radius: rad,
      cx,
      cy,
      x: cx - rad,
      y: cy - rad,
      ring: 0,
      angleDeg: 0,
      inComfortZone: true,
    });
  }

  const innerCount = Math.min(3, secondaries.length);
  const outerCount = Math.max(0, secondaries.length - innerCount);

  function placeRing(slice, ringIdx, radius) {
    const total = slice.length;
    for (let i = 0; i < total; i++) {
      const it = slice[i];
      const sz = Math.max(DEFAULT_THUMB_ARC_SPEC.minButtonSize, Number(it.size) || sSize);
      const rad = sz * 0.5;
      const t = total === 1 ? 0.5 : i / (total - 1);
      const angleDeg = startAngleDeg + (endAngleDeg - startAngleDeg) * t;
      const radAngle = (angleDeg * Math.PI) / 180;
      const rawX = hubX + Math.cos(radAngle) * radius;
      const rawY = hubY + Math.sin(radAngle) * radius;
      const cx = clamp(rawX, safeLeft + rad + 8, vw - safeRight - rad - 8);
      const cy = clamp(rawY, minCenterY + rad, vh - safeBottom - rad - 8);
      const zone = isInThumbComfortZone({ x: cx, y: cy }, { width: vw, height: vh }, { minCenterYRatio: 0.5 });
      placed.push({
        ...it,
        id: it.id ?? `arc_${ringIdx}_${i}`,
        size: sz,
        radius: rad,
        cx,
        cy,
        x: cx - rad,
        y: cy - rad,
        ring: ringIdx,
        angleDeg: Number(angleDeg.toFixed(1)),
        inComfortZone: zone.inLowerHalf,
      });
    }
  }

  if (innerCount > 0) placeRing(secondaries.slice(0, innerCount), 1, rInner);
  if (outerCount > 0) placeRing(secondaries.slice(innerCount), 2, rOuter);

  const allInLowerHalf = placed.every(b => b.cy >= vh * 0.5);

  return Object.freeze({
    origin: Object.freeze({ x: hubX, y: hubY }),
    zoneRadius: rOuter > 0 ? rOuter : rInner,
    allInLowerHalf,
    items: placed,
  });
}

/**
 * Lightweight Canvas2D bottom-right semi-arc action HUD with radial cooldown fill and pointer hit-testing.
 * @param {object} [options]
 * @param {Array<{ id: string, label?: string, primary?: boolean, icon?: string, cooldownRatio?: number, onPress?: () => void }>} [options.items=[]]
 * @param {{ top?: number, right?: number, bottom?: number, left?: number }} [options.safeArea]
 * @param {((id: string, item: object) => void) | null} [options.onAction=null]
 */
export function createThumbArcHud({
  items = [],
  safeArea = {},
  onAction = null,
} = {}) {
  let currentItems = Array.isArray(items) ? items.map(it => ({ ...it })) : [];
  let lastLayout = null;
  let activeId = null;

  function setItems(nextItems) {
    currentItems = Array.isArray(nextItems) ? nextItems.map(it => ({ ...it })) : [];
  }

  function layout(viewportWidth, viewportHeight) {
    lastLayout = computeThumbArcLayout({
      viewportWidth,
      viewportHeight,
      items: currentItems,
      safeArea,
    });
    return lastLayout;
  }

  function hitTest(px, py) {
    if (!lastLayout) return null;
    for (let i = lastLayout.items.length - 1; i >= 0; i--) {
      const btn = lastLayout.items[i];
      if (Math.hypot(px - btn.cx, py - btn.cy) <= btn.radius * 1.1) {
        return btn;
      }
    }
    return null;
  }

  function pointerDown(px, py) {
    const hit = hitTest(px, py);
    activeId = hit?.id ?? null;
    return hit;
  }

  function pointerUp(px, py) {
    const prev = activeId;
    activeId = null;
    const hit = hitTest(px, py);
    if (hit && prev && hit.id === prev) {
      hit.onPress?.(hit);
      onAction?.(hit.id, hit);
      return hit.id;
    }
    return null;
  }

  function render(ctx, viewportWidth, viewportHeight, { showComfortArc = true } = {}) {
    const resolved = layout(viewportWidth, viewportHeight);
    if (!ctx) return resolved;

    ctx.save?.();
    if (showComfortArc) {
      ctx.beginPath?.();
      ctx.arc?.(resolved.origin.x, resolved.origin.y, Math.max(72, resolved.zoneRadius * 0.72), Math.PI, Math.PI * 1.52);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
      ctx.lineWidth = 2;
      ctx.stroke?.();
    }

    for (let i = 0; i < resolved.items.length; i++) {
      const btn = resolved.items[i];
      const pressed = activeId === btn.id;
      ctx.beginPath?.();
      ctx.arc?.(btn.cx, btn.cy, btn.radius, 0, Math.PI * 2);
      ctx.fillStyle = pressed
        ? 'rgba(56, 189, 248, 0.88)'
        : (btn.primary ? 'rgba(14, 165, 233, 0.82)' : 'rgba(15, 23, 42, 0.82)');
      ctx.fill?.();
      ctx.lineWidth = btn.primary ? 2.5 : 1.5;
      ctx.strokeStyle = btn.primary ? 'rgba(224, 242, 254, 0.88)' : 'rgba(148, 163, 184, 0.55)';
      ctx.stroke?.();

      const cd = clamp(Number(btn.cooldownRatio) || 0, 0, 1);
      if (cd > 0.001) {
        ctx.beginPath?.();
        ctx.moveTo?.(btn.cx, btn.cy);
        ctx.arc?.(btn.cx, btn.cy, btn.radius - 2, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * cd);
        ctx.closePath?.();
        ctx.fillStyle = 'rgba(2, 6, 23, 0.62)';
        ctx.fill?.();
      }

      const caption = btn.icon ?? btn.label ?? '';
      if (caption) {
        ctx.font = `700 ${btn.primary ? 18 : 14}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#f8fafc';
        ctx.fillText?.(String(caption), btn.cx, btn.cy);
      }
    }
    ctx.restore?.();
    return resolved;
  }

  return Object.freeze({
    setItems,
    layout,
    render,
    hitTest,
    pointerDown,
    pointerUp,
    getLastLayout: () => lastLayout,
  });
}
