import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputManager } from '../assets/runtime/platform/input/manager.js';
import { createActionGameControls } from '../assets/runtime/kit/action-game-controls.js';

test('action preset routes held controls across modes without a second press', () => {
  const target = new EventTarget();
  const input = createInputManager({ target });
  const controls = createActionGameControls({ input, getGamepads: () => [] });
  const key = (type, code) => target.dispatchEvent(Object.assign(new Event(type), { code }));
  key('keydown', 'KeyJ');
  controls.update(0.016, 'menu');
  assert.equal(controls.wasPressed('confirm'), true);
  assert.equal(controls.wasPressed('attack'), false);
  controls.update(0.016, 'combat');
  assert.equal(controls.wasPressed('attack'), false);
  assert.equal(controls.isDown('attack'), false);
  key('keyup', 'KeyJ');
  controls.update(0.016, 'combat');
  key('keydown', 'KeyJ');
  controls.update(0.016, 'combat');
  assert.equal(controls.wasPressed('attack'), true);
  controls.touchPlayer.setVirtualButton('dash', true);
  controls.touchPlayer.setVirtualButton('dash', false);
  controls.update(0.016, 'combat');
  assert.equal(controls.wasPressed('dash'), true, 'short touches survive one fixed step');
  key('keydown', 'KeyD');
  key('keydown', 'ArrowUp');
  controls.update(0.016, 'combat');
  assert.ok(controls.move.x > 0 && controls.move.y < 0, 'WASD and arrow keys share movement');
  assert.ok(Math.abs(Math.hypot(controls.move.x, controls.move.y) - 1) < 1e-8);
  controls.dispose();
  input.dispose();
});

test('action preset can leave Enter to native buttons without suppressing a fresh Xbox confirm', () => {
  const target = new EventTarget();
  const input = createInputManager({ target });
  const buttons = Array.from({ length: 16 }, () => ({ value: 0 }));
  const controls = createActionGameControls({
    input, confirmWithEnter: false,
    getGamepads: () => [{ index: 0, id: 'Xbox', mapping: 'standard', buttons, axes: [0, 0] }],
  });
  try {
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Enter' }));
    controls.update(0.016, 'menu');
    assert.equal(controls.wasPressed('confirm'), false);
    target.dispatchEvent(Object.assign(new Event('keyup'), { code: 'Enter' }));
    buttons[0].value = 1;
    controls.update(0.016, 'menu');
    assert.equal(controls.wasPressed('confirm'), true);
  } finally {
    controls.dispose();
    input.dispose();
  }
});

test('action preset uses analog movement, clears disconnect and uses approved Xbox buttons', () => {
  const input = createInputManager({ target: new EventTarget() });
  const buttons = Array.from({ length: 16 }, () => ({ value: 0 }));
  let pads = [{ index: 0, id: 'Xbox', mapping: 'standard', buttons, axes: [0.6, 0] }];
  const controls = createActionGameControls({ input, getGamepads: () => pads, actions: ['attack', 'dash', 'skill1', 'skill2', 'skill3', 'skill4'] });
  controls.update(0.016, 'combat');
  assert.ok(controls.move.x > 0 && controls.move.x < 1);
  buttons[2].value = 1;
  buttons[7].value = 1;
  controls.update(0.016, 'combat');
  assert.equal(controls.wasPressed('attack'), true);
  assert.equal(controls.wasPressed('skill4'), true);
  assert.equal(controls.getGlyph('attack'), 'X');
  pads = [];
  controls.update(0.016, 'combat');
  assert.deepEqual(controls.move, { x: 0, y: 0 });
  assert.equal(controls.isDown('attack'), false);
  controls.dispose();
  input.dispose();
});
