import { createUiMotionGroup } from '../ui/ux-motion.js';
import { UI_UX_CUES } from '../ui/ux-director.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * @typedef {object} CanvasUiItem
 * @property {string} id
 * @property {number} x Center X in UI coordinate space.
 * @property {number} y Center Y in UI coordinate space.
 * @property {number} width Item width.
 * @property {number} height Item height.
 * @property {string} [label] Short label (2-4 hanzi or icon+number).
 * @property {string} [glyph] Optional icon/emoji.
 * @property {string} [accent='#38bdf8'] Accent color hex.
 * @property {boolean} [disabled=false]
 * @property {unknown} [payload=null]
 */

/**
 * @typedef {object} CanvasUiGroupOptions
 * @property {CanvasUiItem[]} [items=[]] Initial interactive 2D items.
 * @property {ReturnType<typeof import('../ui/ux-director.js').createUiDirector> | null} [director=null]
 * @property {{ available?: boolean, playSynth?: (preset: unknown, opts?: object) => unknown } | null} [audio=null]
 * @property {(item: CanvasUiItem, index: number) => void} [onSelect]
 * @property {(item: CanvasUiItem | null, index: number) => void} [onHoverChange]
 * @property {import('../ui/ux-motion.js').UiSurfaceSpringOptions} [surfaceOptions]
 * @property {import('../ui/ux-motion.js').UiStaggerOptions} [staggerOptions]
 */

/**
 * Renderer-neutral 2D in-canvas UI coordinator for PixiJS, Canvas2D, and WebGL2D games
 * (including DOM-free mini-game targets like Bilibili Toy).
 * Drives spring hover tilt, lift, press squash, touch swipe-select, keyboard focus,
 * and staggered reveals; renders directly via `drawCanvas2D(ctx)` or syncs Pixi containers via `syncPixi(nodes)`.
 *
 * @param {CanvasUiGroupOptions} [options={}]
 */
export function createCanvasUiGroup(options = {}) {
  const director = options.director ?? null;
  const audio = options.audio ?? null;
  const motion = createUiMotionGroup({
    count: options.items?.length ?? 0,
    surfaceOptions: {
      maxTiltDeg: 10,
      hoverScale: 1.06,
      pressScale: 0.95,
      hoverLift: -8,
      ...(options.surfaceOptions ?? {}),
    },
    staggerOptions: options.staggerOptions,
  });

  /** @type {CanvasUiItem[]} */
  let items = (options.items ?? []).map((item) => ({ ...item }));
  let hoveredIdx = -1;
  let pressedIdx = -1;
  let visible = true;

  function emitCue(cue, detail) {
    if (director) {
      director.emitCue(cue, detail);
    } else if (audio && audio.available !== false && typeof audio.playSynth === 'function') {
      try {
        audio.playSynth(cue === UI_UX_CUES.CONFIRM ? 'pickup' : 'click', {
          bus: 'sfx',
          volume: cue === UI_UX_CUES.HOVER ? 0.1 : 0.18,
          pitchJitter: 0.04,
        });
      } catch {}
    }
  }

  function setItems(nextItems) {
    items = (nextItems ?? []).map((item) => ({ ...item }));
    motion.setCount(items.length);
    for (let i = 0; i < items.length; i++) {
      motion.getItem(i)?.setDisabled(Boolean(items[i].disabled));
    }
    hoveredIdx = -1;
    pressedIdx = -1;
  }

  function hitTest(px, py) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.disabled) continue;
      const hw = it.width * 0.5;
      const hh = it.height * 0.5;
      if (px >= it.x - hw && px <= it.x + hw && py >= it.y - hh && py <= it.y + hh) {
        return {
          index: i,
          nx: hw > 0 ? clamp((px - it.x) / hw, -1, 1) : 0,
          ny: hh > 0 ? clamp((py - it.y) / hh, -1, 1) : 0,
        };
      }
    }
    return null;
  }

  function handlePointerMove(px, py) {
    if (!visible) return null;
    const hit = hitTest(px, py);
    const nextIdx = hit ? hit.index : -1;
    if (nextIdx !== hoveredIdx) {
      if (hoveredIdx >= 0) motion.getItem(hoveredIdx)?.setHover(false);
      hoveredIdx = nextIdx;
      if (hoveredIdx >= 0) {
        motion.getItem(hoveredIdx)?.setHover(true, hit.nx, hit.ny);
        emitCue(UI_UX_CUES.HOVER, { item: items[hoveredIdx], index: hoveredIdx });
      }
      options.onHoverChange?.(hoveredIdx >= 0 ? items[hoveredIdx] : null, hoveredIdx);
    } else if (hoveredIdx >= 0 && hit) {
      motion.getItem(hoveredIdx)?.setPointerNorm(hit.nx, hit.ny);
    }
    return hit;
  }

  function handlePointerDown(px, py) {
    if (!visible) return null;
    const hit = handlePointerMove(px, py);
    if (hit) {
      pressedIdx = hit.index;
      motion.getItem(pressedIdx)?.setPressed(true);
      emitCue(UI_UX_CUES.PRESS, { item: items[pressedIdx], index: pressedIdx });
    }
    return hit;
  }

  function handlePointerUp(px, py) {
    if (!visible) return null;
    const prevPressed = pressedIdx;
    if (prevPressed >= 0) {
      motion.getItem(prevPressed)?.setPressed(false);
    }
    pressedIdx = -1;
    const hit = handlePointerMove(px, py);
    // Support touch swipe-release on any valid card, or click on pressed card.
    if (hit && prevPressed >= 0) {
      emitCue(UI_UX_CUES.CONFIRM, { item: items[hit.index], index: hit.index });
      options.onSelect?.(items[hit.index], hit.index);
      return items[hit.index];
    }
    return null;
  }

  function confirmFocused() {
    const idx = motion.getFocusIndex();
    if (idx < 0 || !items[idx] || items[idx].disabled) return null;
    emitCue(UI_UX_CUES.CONFIRM, { item: items[idx], index: idx });
    options.onSelect?.(items[idx], idx);
    return items[idx];
  }

  function update(dt) {
    return motion.step(dt);
  }

  /**
   * Synchronizes PixiJS `Container` / `Sprite` transforms with each item's spring state.
   * @param {Array<{ position?: { x: number, y: number, set?(x: number, y: number): void }, scale?: { x: number, y: number, set?(x: number, y?: number): void }, skew?: { x: number, y: number, set?(x: number, y: number): void }, rotation?: number, alpha?: number, visible?: boolean }>} nodes
   */
  function syncPixi(nodes) {
    if (!Array.isArray(nodes)) return;
    for (let i = 0; i < items.length && i < nodes.length; i++) {
      const node = nodes[i];
      const it = items[i];
      const spring = motion.getItem(i);
      if (!node || !spring) continue;
      const st = spring.getState();
      const enter = motion.getEntranceProgress(i);
      node.visible = visible;
      node.alpha = visible ? clamp(enter * 1.4, 0, 1) * (it.disabled ? 0.5 : 1) : 0;
      const py = it.y + st.lift + (1 - enter) * 18;
      if (node.position?.set) node.position.set(it.x, py);
      else if (node.position) { node.position.x = it.x; node.position.y = py; }

      const s = st.scale * (0.9 + 0.1 * enter);
      // Perspective foreshortening approximation in 2D Pixi/Canvas
      const sx = s * (1 - Math.abs(st.tiltY) * 0.008);
      const sy = s * (1 - Math.abs(st.tiltX) * 0.008);
      if (node.scale?.set) node.scale.set(sx, sy);
      else if (node.scale) { node.scale.x = sx; node.scale.y = sy; }

      if (node.skew?.set) {
        node.skew.set(st.tiltY * 0.006, st.tiltX * 0.006);
      }
      node.rotation = st.tiltY * 0.004;
    }
  }

  /**
   * Renders all items onto a 2D Canvas context with pseudo-3D tilt, shadow, and specular glare.
   * @param {CanvasRenderingContext2D} ctx
   */
  function drawCanvas2D(ctx) {
    if (!ctx || !visible) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const spring = motion.getItem(i);
      if (!spring) continue;
      const st = spring.getState();
      const enter = motion.getEntranceProgress(i);
      const alpha = clamp(enter * 1.4, 0, 1) * (it.disabled ? 0.5 : 1);
      if (alpha <= 0.01) continue;

      const s = st.scale * (0.9 + 0.1 * enter);
      const sx = s * (1 - Math.abs(st.tiltY) * 0.008);
      const sy = s * (1 - Math.abs(st.tiltX) * 0.008);
      const w = it.width;
      const h = it.height;
      const r = Math.min(14, w * 0.12, h * 0.12);
      const accent = it.accent ?? '#38bdf8';

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(it.x, it.y + st.lift + (1 - enter) * 18);
      ctx.transform(sx, st.tiltX * 0.004, st.tiltY * 0.004, sy, 0, 0);

      // Shadow
      ctx.fillStyle = st.hovered ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.roundRect?.(-w * 0.5, -h * 0.5 + (st.hovered ? 10 : 5), w, h, r);
      if (!ctx.roundRect) ctx.rect(-w * 0.5, -h * 0.5 + 6, w, h);
      ctx.fill();

      // Surface card
      ctx.fillStyle = st.hovered || st.focused ? '#1d3242' : '#13222e';
      ctx.strokeStyle = st.hovered || st.focused ? accent : 'rgba(255,255,255,0.2)';
      ctx.lineWidth = st.hovered || st.focused ? 2 : 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-w * 0.5, -h * 0.5, w, h, r);
      else ctx.rect(-w * 0.5, -h * 0.5, w, h);
      ctx.fill();
      ctx.stroke();

      // Specular glare
      if (st.glareOpacity > 0.02 && typeof ctx.createRadialGradient === 'function') {
        const gx = ((st.glareX / 100) - 0.5) * w;
        const gy = ((st.glareY / 100) - 0.5) * h;
        const grad = ctx.createRadialGradient(gx, gy, 4, gx, gy, Math.max(w, h) * 0.75);
        grad.addColorStop(0, `rgba(255,255,255,${(st.glareOpacity * 0.25).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Glyph + label
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (it.glyph) {
        ctx.font = `600 ${Math.round(Math.min(w, h) * 0.26)}px system-ui`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(it.glyph, 0, it.label ? -h * 0.12 : 0);
      }
      if (it.label) {
        ctx.font = `700 ${Math.round(Math.min(w, h) * 0.14)}px system-ui`;
        ctx.fillStyle = '#e2f1f8';
        ctx.fillText(it.label, 0, it.glyph ? h * 0.18 : 0);
      }

      ctx.restore();
    }
  }

  return Object.freeze({
    motion,
    setItems,
    getItems: () => items,
    setVisible(nextVisible) {
      visible = Boolean(nextVisible);
      if (visible) motion.triggerEntrance();
    },
    isVisible: () => visible,
    triggerEntrance: () => motion.triggerEntrance(),
    moveFocus: (delta) => motion.moveFocus(delta),
    confirmFocused,
    hitTest,
    handlePointerMove,
    handlePointerDown,
    handlePointerUp,
    update,
    syncPixi,
    drawCanvas2D,
  });
}
