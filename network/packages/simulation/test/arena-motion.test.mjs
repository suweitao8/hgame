import test from 'node:test';
import assert from 'node:assert/strict';
import { createArenaMotionState, stepArenaMotion2D } from '../dist/index.js';

test('stepArenaMotion2D normalizes diagonal input, clamps bounds, and slides along AABB obstacles', () => {
  const straight = createArenaMotionState(0, 0);
  const diag = createArenaMotionState(0, 0);
  const config = { speed: 200, radius: 10, bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 } };

  stepArenaMotion2D(straight, { moveX: 1, moveY: 0 }, 0.1, config);
  stepArenaMotion2D(diag, { moveX: 1, moveY: 1 }, 0.1, config);

  assert.ok(Math.abs(Math.hypot(diag.x, diag.y) - straight.x) < 1e-6);

  // Wall sliding against an obstacle (starting flush against left face at x = 10)
  const actor = createArenaMotionState(10, 0);
  const obstacle = { minX: 20, minY: -20, maxX: 60, maxY: 20 };
  stepArenaMotion2D(actor, { moveX: 1, moveY: 1 }, 0.05, {
    speed: 200,
    radius: 10,
    obstacles: [obstacle],
  });
  // Pushed out on X to <= 10 (minX - radius), while still sliding positively on Y
  assert.ok(actor.x <= 10 + 1e-6);
  assert.ok(actor.y > 0);
});

test('stepArenaMotion2D triggers dash impulse with cooldown', () => {
  const actor = createArenaMotionState(0, 0);
  const cfg = { speed: 100, dashSpeed: 500, dashDuration: 0.1, dashCooldown: 0.5, radius: 10 };

  stepArenaMotion2D(actor, { moveX: 1, moveY: 0, dashPressed: true }, 0.05, cfg);
  assert.ok(Math.abs(actor.x - 25) < 1e-6);
  assert.ok(actor.dashTimer > 0);
  assert.ok(actor.dashCooldown > 0);

  // Dash finishes during the next step (0.05s dash + 0.05s normal move)
  stepArenaMotion2D(actor, { moveX: 1, moveY: 0, dashPressed: true }, 0.1, cfg);
  assert.ok(Math.abs(actor.x - (25 + 25 + 5)) < 1e-6);
  assert.equal(actor.dashTimer, 0);
});
