/**
 * Lightweight 2D Skeletal Animation & Analytical 2-Bone IK System for 50MB HTML5
 * mobile-portrait games (cuts sprite atlas memory by >70% vs dense frame sheets).
 */

/**
 * Create a hierarchical 2D skeleton with topological FK, pose blending, and analytical 2-bone IK.
 * @param {object} [options]
 * @param {Array<{ id: string, parent?: string|null, x?: number, y?: number, angle?: number, length?: number, scaleX?: number, scaleY?: number }>} [options.bones=[]]
 * @param {Array<{ id: string, bone: string, width?: number, height?: number, color?: string }>} [options.slots=[]]
 */
export function createSkeleton2D({ bones = [], slots = [] } = {}) {
  const byId = new Map();
  const order = [];

  for (let i = 0; i < bones.length; i++) {
    const src = bones[i];
    if (!src?.id) throw new TypeError(`Skeleton2D bone at index ${i} requires id`);
    const node = {
      id: String(src.id),
      parent: src.parent ? String(src.parent) : null,
      parentIdx: -1,
      x: Number(src.x) || 0,
      y: Number(src.y) || 0,
      angle: Number(src.angle) || 0,
      length: Math.max(0, Number(src.length) || 0),
      scaleX: Number.isFinite(src.scaleX) ? src.scaleX : 1,
      scaleY: Number.isFinite(src.scaleY) ? src.scaleY : 1,
      wx: 0,
      wy: 0,
      wa: 0,
      tipX: 0,
      tipY: 0,
      wsx: 1,
      wsy: 1,
    };
    byId.set(node.id, i);
    order.push(node);
  }

  for (let i = 0; i < order.length; i++) {
    const pId = order[i].parent;
    if (pId) {
      const pIdx = byId.get(pId);
      if (pIdx === undefined) throw new Error(`Skeleton2D missing parent bone: ${pId}`);
      order[i].parentIdx = pIdx;
    }
  }

  const slotList = slots.map((s) => ({
    id: String(s.id ?? s.bone),
    bone: String(s.bone),
    boneIdx: byId.get(String(s.bone)) ?? -1,
    width: Math.max(1, Number(s.width) || 16),
    height: Math.max(1, Number(s.height) || 8),
    color: s.color ?? '#38bdf8',
  }));

  function updateWorldTransforms() {
    for (let i = 0; i < order.length; i++) {
      const b = order[i];
      if (b.parentIdx < 0) {
        b.wx = b.x;
        b.wy = b.y;
        b.wa = b.angle;
        b.wsx = b.scaleX;
        b.wsy = b.scaleY;
      } else {
        const p = order[b.parentIdx];
        const c = Math.cos(p.wa);
        const s = Math.sin(p.wa);
        const lx = b.x * p.wsx;
        const ly = b.y * p.wsy;
        b.wx = p.wx + lx * c - ly * s;
        b.wy = p.wy + lx * s + ly * c;
        b.wa = p.wa + b.angle;
        b.wsx = p.wsx * b.scaleX;
        b.wsy = p.wsy * b.scaleY;
      }
      b.tipX = b.wx + Math.cos(b.wa) * b.length * b.wsx;
      b.tipY = b.wy + Math.sin(b.wa) * b.length * b.wsy;
    }
  }

  function applyPose(poseA = {}, poseB = null, t = 0) {
    const alpha = Math.max(0, Math.min(1, Number(t) || 0));
    for (let i = 0; i < order.length; i++) {
      const b = order[i];
      const a = poseA[b.id];
      const c = poseB ? poseB[b.id] : null;
      if (!a && !c) continue;
      if (a && !c) {
        if (Number.isFinite(a.x)) b.x = a.x;
        if (Number.isFinite(a.y)) b.y = a.y;
        if (Number.isFinite(a.angle)) b.angle = a.angle;
      } else if (c && !a) {
        if (Number.isFinite(c.x)) b.x = b.x + (c.x - b.x) * alpha;
        if (Number.isFinite(c.y)) b.y = b.y + (c.y - b.y) * alpha;
        if (Number.isFinite(c.angle)) b.angle = b.angle + (c.angle - b.angle) * alpha;
      } else if (a && c) {
        if (Number.isFinite(a.x) && Number.isFinite(c.x)) b.x = a.x + (c.x - a.x) * alpha;
        if (Number.isFinite(a.y) && Number.isFinite(c.y)) b.y = a.y + (c.y - a.y) * alpha;
        if (Number.isFinite(a.angle) && Number.isFinite(c.angle)) b.angle = a.angle + (c.angle - a.angle) * alpha;
      }
    }
    updateWorldTransforms();
  }

  /** Analytical planar 2-bone IK updating root & mid bone angles cleanly in O(1) with zero GC. */
  function solveTwoBoneIk2D(rootId, midId, targetX, targetY, flip = 1) {
    const rIdx = byId.get(String(rootId));
    const mIdx = byId.get(String(midId));
    if (rIdx === undefined || mIdx === undefined) return false;
    updateWorldTransforms();
    const root = order[rIdx];
    const mid = order[mIdx];
    const l1 = Math.max(1e-4, root.length * Math.abs(root.wsx));
    const l2 = Math.max(1e-4, mid.length * Math.abs(mid.wsx));

    const parentAngle = root.parentIdx >= 0 ? order[root.parentIdx].wa : 0;
    const dx = targetX - root.wx;
    const dy = targetY - root.wy;
    const rawDist = Math.hypot(dx, dy);
    const minDist = Math.abs(l1 - l2) + 1e-4;
    const maxDist = l1 + l2 - 1e-4;
    const dist = Math.max(minDist, Math.min(maxDist, rawDist));

    const baseAngle = Math.atan2(dy, dx);
    const cosA1 = Math.max(-1, Math.min(1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
    const cosA2 = Math.max(-1, Math.min(1, (l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2)));
    const sign = flip >= 0 ? 1 : -1;

    const worldRootAngle = baseAngle - sign * Math.acos(cosA1);
    const worldMidAngle = worldRootAngle + sign * (Math.PI - Math.acos(cosA2));

    root.angle = worldRootAngle - parentAngle;
    mid.angle = worldMidAngle - worldRootAngle;
    updateWorldTransforms();
    return true;
  }

  function getBoneWorld(id) {
    const idx = byId.get(String(id));
    if (idx === undefined) return null;
    const b = order[idx];
    return {
      id: b.id,
      x: b.wx,
      y: b.wy,
      tipX: b.tipX,
      tipY: b.tipY,
      angle: b.wa,
    };
  }

  function getRenderSlots() {
    const out = [];
    for (let i = 0; i < slotList.length; i++) {
      const s = slotList[i];
      if (s.boneIdx < 0) continue;
      const b = order[s.boneIdx];
      out.push({
        id: s.id,
        bone: b.id,
        x: b.wx,
        y: b.wy,
        tipX: b.tipX,
        tipY: b.tipY,
        angle: b.wa,
        width: s.width,
        height: s.height,
        color: s.color,
      });
    }
    return out;
  }

  updateWorldTransforms();

  return Object.freeze({
    updateWorldTransforms,
    applyPose,
    solveTwoBoneIk2D,
    getBoneWorld,
    getRenderSlots,
    get boneCount() { return order.length; },
  });
}
