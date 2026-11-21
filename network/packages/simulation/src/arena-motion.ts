/**
 * Shared deterministic 2D arena motion step (normalized movement, dash impulse,
 * circle-vs-AABB obstacle sliding, and arena boundary clamping) for client-side
 * prediction and server-side authority.
 */

export interface Aabb2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ArenaMotionState {
  x: number;
  y: number;
  yaw: number;
  dashTimer: number;
  dashCooldown: number;
  dashDirX: number;
  dashDirY: number;
}

export interface ArenaMotionInput {
  moveX: number;
  moveY: number;
  aimX?: number;
  aimY?: number;
  dashPressed?: boolean;
}

export interface ArenaMotionConfig {
  speed?: number;
  dashSpeed?: number;
  dashDuration?: number;
  dashCooldown?: number;
  radius?: number;
  bounds?: Aabb2D;
  obstacles?: readonly Aabb2D[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveCircleAabb(
  x: number,
  y: number,
  radius: number,
  box: Aabb2D,
): { x: number; y: number } {
  const closestX = clamp(x, box.minX, box.maxX);
  const closestY = clamp(y, box.minY, box.maxY);
  const dx = x - closestX;
  const dy = y - closestY;
  const distSq = dx * dx + dy * dy;

  if (distSq >= radius * radius) {
    return { x, y };
  }
  if (distSq > 1e-12) {
    const dist = Math.sqrt(distSq);
    const push = radius - dist;
    return {
      x: x + (dx / dist) * push,
      y: y + (dy / dist) * push,
    };
  }

  // Circle center lies inside the box: push out along the shallowest axis.
  const leftPen = x - box.minX;
  const rightPen = box.maxX - x;
  const topPen = y - box.minY;
  const bottomPen = box.maxY - y;
  const minPen = Math.min(leftPen, rightPen, topPen, bottomPen);
  if (minPen === leftPen) return { x: box.minX - radius, y };
  if (minPen === rightPen) return { x: box.maxX + radius, y };
  if (minPen === topPen) return { x, y: box.minY - radius };
  return { x, y: box.maxY + radius };
}

export function createArenaMotionState(x = 0, y = 0, yaw = 0): ArenaMotionState {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(yaw)) {
    throw new RangeError('Initial arena motion coordinates must be finite');
  }
  return {
    x,
    y,
    yaw,
    dashTimer: 0,
    dashCooldown: 0,
    dashDirX: Math.cos(yaw),
    dashDirY: Math.sin(yaw),
  };
}

export function stepArenaMotion2D(
  state: ArenaMotionState,
  input: ArenaMotionInput,
  dt: number,
  config: ArenaMotionConfig = {},
): void {
  if (!Number.isFinite(dt) || dt <= 0) {
    throw new RangeError('Arena motion step requires a positive finite dt');
  }
  if (!Number.isFinite(input.moveX) || !Number.isFinite(input.moveY)) {
    throw new RangeError('Arena motion input axes must be finite');
  }

  const speed = config.speed ?? 220;
  const dashSpeed = config.dashSpeed ?? 620;
  const dashDuration = config.dashDuration ?? 0.14;
  const dashCooldown = config.dashCooldown ?? 0.7;
  const radius = config.radius ?? 14;
  if (!Number.isFinite(speed) || speed < 0 || !Number.isFinite(dashSpeed) || dashSpeed < 0) {
    throw new RangeError('Arena motion speeds must be nonnegative finite numbers');
  }
  if (!Number.isFinite(radius) || radius < 0) {
    throw new RangeError('Arena motion radius must be nonnegative');
  }

  let mx = clamp(input.moveX, -1, 1);
  let my = clamp(input.moveY, -1, 1);
  const moveLen = Math.hypot(mx, my);
  if (moveLen > 1) {
    mx /= moveLen;
    my /= moveLen;
  }

  const hasAim = typeof input.aimX === 'number' && typeof input.aimY === 'number'
    && Number.isFinite(input.aimX) && Number.isFinite(input.aimY)
    && (input.aimX !== 0 || input.aimY !== 0);
  if (hasAim) {
    state.yaw = Math.atan2(input.aimY!, input.aimX!);
  } else if (moveLen > 1e-4) {
    state.yaw = Math.atan2(my, mx);
  }

  if (state.dashCooldown > 0) {
    state.dashCooldown = Math.max(0, state.dashCooldown - dt);
  }

  if (input.dashPressed && state.dashTimer <= 0 && state.dashCooldown <= 0 && dashDuration > 0) {
    if (moveLen > 1e-4) {
      state.dashDirX = mx / moveLen;
      state.dashDirY = my / moveLen;
    } else if (hasAim) {
      const aimLen = Math.hypot(input.aimX!, input.aimY!);
      state.dashDirX = input.aimX! / aimLen;
      state.dashDirY = input.aimY! / aimLen;
    } else {
      state.dashDirX = Math.cos(state.yaw);
      state.dashDirY = Math.sin(state.yaw);
    }
    state.dashTimer = dashDuration;
    state.dashCooldown = dashCooldown;
  }

  if (state.dashTimer > 0) {
    const activeDt = Math.min(dt, state.dashTimer);
    const remDt = dt - activeDt;
    state.x += state.dashDirX * dashSpeed * activeDt + mx * speed * remDt;
    state.y += state.dashDirY * dashSpeed * activeDt + my * speed * remDt;
    state.dashTimer = Math.max(0, state.dashTimer - dt);
  } else {
    state.x += mx * speed * dt;
    state.y += my * speed * dt;
  }

  const obstacles = config.obstacles;
  if (obstacles && obstacles.length > 0) {
    for (let pass = 0; pass < 2; pass++) {
      for (const box of obstacles) {
        const resolved = resolveCircleAabb(state.x, state.y, radius, box);
        state.x = resolved.x;
        state.y = resolved.y;
      }
    }
  }

  const bounds = config.bounds;
  if (bounds) {
    const minX = bounds.minX + radius;
    const maxX = bounds.maxX - radius;
    const minY = bounds.minY + radius;
    const maxY = bounds.maxY - radius;
    state.x = minX <= maxX ? clamp(state.x, minX, maxX) : (bounds.minX + bounds.maxX) * 0.5;
    state.y = minY <= maxY ? clamp(state.y, minY, maxY) : (bounds.minY + bounds.maxY) * 0.5;
  }
}
