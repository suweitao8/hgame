import { Entity } from '../core/entity.js';
import { multiplyAffineInto, writeEntityLocalMatrix } from './entity-transform.js';
import { createDrawOrder2D } from '../integrations/draw-order-2d.js';

const entityWorldCurrent = Entity.prototype.worldMatrixInto;
const entityWorldSampled = Entity.prototype.interpolatedWorldMatrixInto;

/** @typedef {import('../integrations/canvas2d.js').Sprite2D} Sprite */
/** @typedef {import('../integrations/canvas2d.js').SpriteCrowd2D} Crowd */
/** @typedef {{ minX: number, maxX: number, minY: number, maxY: number }} ViewBounds */
/** @typedef {{ culled: number, sorted: boolean }} QueueStats */
/** @typedef {{ kind: 0|1|2, entity: Entity|null, sprite: Sprite|Crowd|null, agentIndex: number,
 *   a: number, b: number, c: number, d: number, e: number, f: number,
 *   layer: number, z: number, ySort: boolean }} QueueItem */

function spriteBoundsVisible(sprite, entity, mat, viewBounds, absoluteTextSize) {
  const w = Math.abs(sprite.width);
  const h = Math.abs(sprite.height);
  if (sprite.shape === 'text' || sprite.customDraw) {
    const hasBounds = absoluteTextSize ? w > 0 && h > 0 : sprite.width > 0 && sprite.height > 0;
    if (!hasBounds) return true;
  }
  const ax = sprite.anchorX ?? entity.anchorX ?? 0.5;
  const ay = sprite.anchorY ?? entity.anchorY ?? 0.5;
  const shadowCfg = sprite.groundShadow
    ? (typeof sprite.groundShadow === 'object' ? sprite.groundShadow : {})
    : null;
  const shadowHalfW = shadowCfg ? (w * (shadowCfg.widthRatio ?? 0.72)) * 0.5 : 0;
  const lx0 = shadowCfg ? Math.min(-w * ax, -shadowHalfW + (shadowCfg.offsetX || 0)) : -w * ax;
  const lx1 = shadowCfg ? Math.max(-w * ax + w, shadowHalfW + (shadowCfg.offsetX || 0)) : (-w * ax + w);
  const ly0 = -h * ay;
  const shadowBottom = shadowCfg
    ? h * (1 - ay) - h * (shadowCfg.tuckRatio ?? 0.032) + (shadowCfg.offsetY || 0) + (h * (shadowCfg.heightRatio ?? 0.18)) * 0.5
    : ly0 + h;
  const ly1 = shadowCfg ? Math.max(ly0 + h, shadowBottom) : (ly0 + h);
  const a = mat[0], b = mat[1], c = mat[4], d = mat[5], e = mat[12], f = mat[13];
  const rot = sprite.rotation || 0;
  const cos = rot ? Math.cos(rot) : 1;
  const sin = rot ? Math.sin(rot) : 0;
  const sx = (sprite.flipX ? -1 : 1) * (sprite.scaleX ?? 1);
  const sy = (sprite.flipY ? -1 : 1) * (sprite.scaleY ?? 1);
  const ox = sprite.offsetX || 0;
  const oy = sprite.offsetY || 0;
  const m00 = a * (cos * sx) + c * (sin * sx);
  const m01 = b * (cos * sx) + d * (sin * sx);
  const m10 = a * (-sin * sy) + c * (cos * sy);
  const m11 = b * (-sin * sy) + d * (cos * sy);
  const tx = a * ox + c * oy + e;
  const ty = b * ox + d * oy + f;
  const x0 = m00 * lx0 + m10 * ly0 + tx, y0 = m01 * lx0 + m11 * ly0 + ty;
  const x1 = m00 * lx1 + m10 * ly0 + tx, y1 = m01 * lx1 + m11 * ly0 + ty;
  const x2 = m00 * lx1 + m10 * ly1 + tx, y2 = m01 * lx1 + m11 * ly1 + ty;
  const x3 = m00 * lx0 + m10 * ly1 + tx, y3 = m01 * lx0 + m11 * ly1 + ty;
  const minX = Math.min(x0, x1, x2, x3);
  const maxX = Math.max(x0, x1, x2, x3);
  const minY = Math.min(y0, y1, y2, y3);
  const maxY = Math.max(y0, y1, y2, y3);
  return !(maxX < viewBounds.minX || minX > viewBounds.maxX || maxY < viewBounds.minY || minY > viewBounds.maxY);
}

/**
 * Shared 2D draw queue. Cache world transforms for the active ancestor chain
 * during collection. A camera pass reads actual transforms again on entry.
 * @param {{ Sprite2D: typeof import('../integrations/canvas2d.js').Sprite2D,
 *   SpriteCrowd2D: typeof import('../integrations/canvas2d.js').SpriteCrowd2D,
 *   cull: boolean, interpolate: boolean, absoluteTextSize?: boolean }} options
 */
export function createSpriteQueue({ Sprite2D, SpriteCrowd2D, cull, interpolate, absoluteTextSize = false }) {
  /** @type {QueueItem[]} */
  const drawPool = [];
  const order = createDrawOrder2D((/** @type {QueueItem} */ item) => item.f);
  const frames = [];
  const localMatrix = new Float64Array(16);
  const customMatrix = new Float64Array(16);
  let drawCount = 0;
  let needsLayerSort = false;
  let usesDepthSort = false;
  let prevLayer = -Infinity;
  let prevZ = -Infinity;

  function worldAt(depth, alpha, sampled) {
    const frame = frames[depth];
    const entity = frame.entity;
    const world = sampled ? (frame.sampled ??= new Float64Array(16))
      : (frame.current ??= new Float64Array(16));
    if (sampled ? frame.sampledValid : frame.currentValid) return world;

    const blend = sampled ? alpha : 1;
    if (!entity.parent) {
      writeEntityLocalMatrix(entity, world, blend);
    } else if (depth > 0 && frames[depth - 1].entity === entity.parent) {
      const parent = worldAt(depth - 1, alpha, sampled);
      writeEntityLocalMatrix(entity, localMatrix, blend);
      multiplyAffineInto(world, parent, localMatrix);
    } else if (sampled) {
      entityWorldSampled.call(entity, alpha, world);
    } else {
      entityWorldCurrent.call(entity, world);
    }
    if (sampled) frame.sampledValid = true;
    else frame.currentValid = true;
    return world;
  }

  function push(kind, entity, comp, agentIndex, world, x = world[12], y = world[13]) {
    const slot = drawPool[drawCount] ?? (drawPool[drawCount] = {
      kind: 0, entity: null, sprite: null, agentIndex: -1,
      a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
      layer: 0, z: 0, ySort: false,
    });
    slot.kind = kind;
    slot.entity = entity;
    slot.sprite = comp;
    slot.agentIndex = agentIndex;
    slot.a = world[0]; slot.b = world[1]; slot.c = world[4]; slot.d = world[5];
    slot.e = x; slot.f = y;
    const layer = slot.layer = comp.layer;
    const z = slot.z = comp.z;
    slot.ySort = Boolean(comp.ySort);
    usesDepthSort ||= slot.ySort;
    if (drawCount++ > 0 && (layer < prevLayer || (layer === prevLayer && z < prevZ))) {
      needsLayerSort = true;
    }
    prevLayer = layer;
    prevZ = z;
  }

  function collect(entity, alpha, viewBounds, stats, depth) {
    if (!entity.active || entity.destroyed) return;
    const frame = frames[depth] ?? (frames[depth] = {
      entity: null, current: null, sampled: null, currentValid: false, sampledValid: false,
    });
    frame.entity = entity;
    frame.currentValid = frame.sampledValid = false;
    let world = null;
    const comps = entity.components;
    for (let ci = 0, n = comps.length; ci < n; ci++) {
      const comp = comps[ci];
      if (!comp._running || !comp.visible) continue;
      const single = comp instanceof Sprite2D;
      if (single ? !(comp.opacity > 0) : !(comp instanceof SpriteCrowd2D && comp.count > 0)) continue;
      if (!world) {
        const blended = interpolate || entity.interpolate;
        if (blended && entity.interpolatedWorldMatrixInto !== entityWorldSampled) {
          entity.interpolatedWorldMatrixInto(alpha, customMatrix);
          world = customMatrix;
        } else if (!blended && entity.worldMatrixInto !== entityWorldCurrent) {
          entity.worldMatrixInto(customMatrix);
          world = customMatrix;
        } else {
          world = worldAt(depth, alpha, blended && alpha < 1);
        }
        if (world === customMatrix) {
          // Overrides can change transforms before the traversal reaches a sibling.
          for (let i = 0; i <= depth; i++) frames[i].currentValid = frames[i].sampledValid = false;
        }
      }

      if (single) {
        if (cull && !spriteBoundsVisible(comp, entity, world, viewBounds, absoluteTextSize)) {
          stats.culled++;
          continue;
        }
        push(0, entity, comp, -1, world);
      } else if (!comp.ySort || comp._boundSwarm || comp._boundGpuSwarm) {
        push(1, entity, comp, -1, world);
      } else {
        const halfPad = Math.max(Math.abs(comp.width), Math.abs(comp.height)) * 2;
        const tx = world[12], ty = world[13];
        for (let i = 0; i < comp._activeCount; i++) {
          const idx = comp._activeIndices[i];
          if (!(comp.opacity[idx] > 0)) continue;
          const lx = comp.x[idx], ly = comp.y[idx];
          const x = tx + world[0] * lx + world[4] * ly;
          const y = ty + world[1] * lx + world[5] * ly;
          if (cull && (
            x + halfPad < viewBounds.minX || x - halfPad > viewBounds.maxX ||
            y + halfPad < viewBounds.minY || y - halfPad > viewBounds.maxY
          )) {
            stats.culled++;
            continue;
          }
          push(2, entity, comp, idx, world, x, y);
        }
      }
    }
    const children = entity.children;
    for (let i = 0, n = children.length; i < n; i++) collect(children[i], alpha, viewBounds, stats, depth + 1);
    frame.entity = null;
  }

  function clear() {
    for (let i = 0; i < drawCount; i++) {
      drawPool[i].entity = null;
      drawPool[i].sprite = null;
    }
    order.clear();
    drawCount = 0;
    needsLayerSort = usesDepthSort = false;
  }

  /** @param {readonly Entity[]} roots @param {number} alpha @param {ViewBounds} viewBounds @param {QueueStats} stats */
  function gather(roots, alpha, viewBounds, stats) {
    clear();
    try {
      for (let i = 0, n = roots.length; i < n; i++) collect(roots[i], alpha, viewBounds, stats, 0);
    } catch (error) {
      for (const frame of frames) frame.entity = null;
      clear();
      throw error;
    }
    const ordered = order.apply(drawPool, drawCount, needsLayerSort, usesDepthSort);
    if (ordered !== drawPool) stats.sorted = true;
    return ordered;
  }

  return {
    get count() { return drawCount; },
    gather,
    clear,
    dispose() {
      clear();
      drawPool.length = 0;
      frames.length = 0;
    },
  };
}
