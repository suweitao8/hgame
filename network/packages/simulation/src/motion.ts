/**
 * Small shared simulation used only by the network conformance lab.
 * Real games provide their own shared step function and state schema.
 */
export interface LinearMotionState {
  x: number;
  y: number;
}

export interface LinearMotionInput {
  moveX: number;
  moveY: number;
}

export function applyLinearMotionInput(
  state: LinearMotionState,
  input: LinearMotionInput,
  dt: number,
  speed = 180,
): void {
  if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(speed) || speed < 0) {
    throw new RangeError('Motion step requires a positive finite dt and nonnegative finite speed');
  }
  if (!Number.isInteger(input.moveX) || input.moveX < -1 || input.moveX > 1 ||
      !Number.isInteger(input.moveY) || input.moveY < -1 || input.moveY > 1) {
    throw new RangeError('Motion input axes must be -1, 0, or 1');
  }
  state.x += input.moveX * speed * dt;
  state.y += input.moveY * speed * dt;
}
