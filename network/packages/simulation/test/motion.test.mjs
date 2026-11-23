import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLinearMotionInput } from '../dist/index.js';

test('shared prediction step applies the same linear input to a state object', () => {
  const state = { x: 0, y: 0 };
  applyLinearMotionInput(state, { moveX: 1, moveY: -1 }, 1 / 30, 180);
  assert.equal(state.x, 6);
  assert.equal(state.y, -6);
});

test('shared prediction step rejects invalid axes and time steps', () => {
  assert.throws(() => applyLinearMotionInput({ x: 0, y: 0 }, { moveX: 2, moveY: 0 }, 1 / 30), /axes/);
  assert.throws(() => applyLinearMotionInput({ x: 0, y: 0 }, { moveX: 0, moveY: 0 }, 0), /dt/);
});
