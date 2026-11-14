import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  HGame,
  Entity,
  Scene,
  ARCADE_SLOTS,
  PLAYER_KEYMAPS,
  createInputManager,
  defineInputContext,
  createInputActionRouter,
  createArcadeControls,
  computeSplitScreenViews,
} from '../assets/runtime/index.js';
import { Camera2D, Sprite2D, createCanvas2DAdapter } from '../assets/runtime/integrations/canvas2d.js';
import { createWebGL2DAdapter } from '../assets/runtime/integrations/webgl2d.js';
import { createThreeAdapter } from '../assets/runtime/integrations/three.js';
import { createTouchControls, applyRadialDeadzone } from '../assets/runtime/integrations/touch-controls.js';

function makeEventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    emit(type, event = {}) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
    },
  };
}

function makeMockDom({ maxTouchPoints = 0, coarse = false, innerWidth = 960, innerHeight = 540 } = {}) {
  const windowTarget = makeEventTarget();
  windowTarget.innerWidth = innerWidth;
  windowTarget.innerHeight = innerHeight;
  windowTarget.matchMedia = q => ({ matches: coarse && q.includes('coarse') });

  function makeElement(tagName) {
    const base = makeEventTarget();
    const attrs = new Map();
    const styleMap = new Map();
    const styleProxy = new Proxy({}, {
      set(target, prop, value) {
        target[prop] = value;
        styleMap.set(prop, value);
        return true;
      },
      get(target, prop) {
        if (prop === 'setProperty') return (k, v) => { target[k] = v; styleMap.set(k, v); };
        return target[prop];
      },
    });
    const el = {
      ...base,
      tagName: String(tagName).toUpperCase(),
      children: [],
      parentNode: null,
      textContent: '',
      className: '',
      type: '',
      style: styleProxy,
      styleMap,
      attrs,
      rect: { left: 0, top: 0, width: 300, height: 300 },
      capturedPointers: new Set(),
      appendChild(child) {
        child.parentNode = el;
        el.children.push(child);
        return child;
      },
      removeChild(child) {
        const idx = el.children.indexOf(child);
        if (idx !== -1) el.children.splice(idx, 1);
        child.parentNode = null;
        return child;
      },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) ?? null; },
      getBoundingClientRect() { return el.rect; },
      setPointerCapture(id) { el.capturedPointers.add(id); },
      releasePointerCapture(id) { el.capturedPointers.delete(id); },
      querySelectorAll(selector) {
        const out = [];
        const walk = node => {
          for (const ch of node.children) {
            if (selector.startsWith('.') && ch.className.split(/\s+/).includes(selector.slice(1))) out.push(ch);
            walk(ch);
          }
        };
        walk(el);
        return out;
      },
    };
    return el;
  }

  const head = makeElement('head');
  const body = makeElement('body');
  body.clientWidth = innerWidth;
  body.clientHeight = innerHeight;

  const docTarget = makeEventTarget();
  docTarget.hidden = false;
  docTarget.head = head;
  docTarget.body = body;
  docTarget.createElement = makeElement;

  return {
    windowRef: windowTarget,
    documentRef: docTarget,
    navigatorRef: { maxTouchPoints },
    head,
    body,
  };
}

test('createInputManager tracks multi-touch pointers, pointercancel, scroll guard, and router virtual inputs', () => {
  const target = makeEventTarget();
  const input = createInputManager({ target });

  assert.equal(input.preventKeys(['ArrowUp', 'ArrowDown']), 2);
  let prevented = 0;
  target.emit('keydown', { code: 'ArrowDown', preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
  // Editable fields must never prevent default browser behavior
  target.emit('keydown', { code: 'ArrowDown', target: { tagName: 'INPUT' }, preventDefault() { prevented++; } });
  assert.equal(prevented, 1);

  target.emit('pointerdown', { pointerId: 10, pointerType: 'touch', clientX: 100, clientY: 200 });
  target.emit('pointerdown', { pointerId: 11, pointerType: 'touch', clientX: 500, clientY: 250 });
  assert.equal(input.pointerCount, 2);
  assert.equal(input.pointers.length, 2);
  assert.equal(input.isPointerDown(0), true);
  assert.equal(input.wasPointerPressed(0), true);

  target.emit('pointermove', { pointerId: 10, pointerType: 'touch', clientX: 125, clientY: 215 });
  assert.deepEqual({ dx: input.getPointer(10).dx, dy: input.getPointer(10).dy }, { dx: 25, dy: 15 });

  input.endFrame();
  assert.equal(input.wasPointerPressed(0), false);
  assert.equal(input.getPointer(10).dx, 0);

  target.emit('pointercancel', { pointerId: 10, pointerType: 'touch', clientX: 125, clientY: 215 });
  assert.equal(input.pointerCount, 1);
  assert.equal(input.wasPointerReleased(0), true);

  target.emit('blur');
  assert.equal(input.pointerCount, 0);
  assert.equal(input.isPointerDown(0), false);

  // Router virtual inputs preserve analog magnitudes and obey modal blocking
  const router = createInputActionRouter({ input });
  const gp = defineInputContext('Game', {
    priority: 0,
    actions: { Attack: 'KeyJ' },
    axes2D: { Move: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', normalize: true } },
  });
  const modal = defineInputContext('Modal', { priority: 50, blocksLowerContexts: true, actions: { Confirm: 'Space' } });
  router.pushContext(gp);

  router.setVirtualAxis2D('Move', 0.4, 0.3);
  router.setVirtualAction('Attack', true);
  router.update(0.016);
  const mv = router.getAxis2D('Move');
  assert.ok(Math.abs(mv.x - 0.4) < 1e-6 && Math.abs(mv.y - 0.3) < 1e-6);
  assert.equal(router.wasPressed('Attack'), true);

  // Pushing modal blocks lower gameplay virtual inputs
  router.pushContext(modal);
  router.update(0.016);
  assert.equal(router.isDown('Attack'), false);

  input.dispose();
});

test('createArcadeControls maps P1 (WASD+JKL UIO [+QE]) and P2 (Arrows+123456 [+0.]) without conflict', () => {
  assert.equal(HGame.createArcadeControls, createArcadeControls);
  assert.deepEqual(ARCADE_SLOTS.primary, ['j', 'k', 'l', 'u', 'i', 'o']);
  assert.deepEqual(ARCADE_SLOTS.extra, ['q', 'e']);
  assert.ok(PLAYER_KEYMAPS.p2.primary.j.includes('Numpad1') && PLAYER_KEYMAPS.p2.primary.j.includes('Digit1'));

  // Enforces 6-button primary simplicity by default
  assert.throws(
    () => createArcadeControls({ actions: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
    /at most 6 actions/,
  );

  // Supports 0-button joystick-only configuration cleanly
  const stickOnly = createArcadeControls({ actions: [] });
  assert.equal(stickOnly.p1.bindings.length, 0);

  const down = new Set();
  const controls = createArcadeControls({
    players: 2,
    actions: ['attack', 'dash', 'skill1', 'skill2', 'skill3', 'ult'],
    extras: ['dodge', 'interact'],
    readCode: code => down.has(code),
    bufferWindow: 0.12,
  });

  assert.equal(controls.players.length, 2);
  assert.deepEqual(
    controls.p1.bindings.map(b => [b.name, b.slot, b.keyLabel, b.isExtra]),
    [
      ['attack', 'j', 'J', false],
      ['dash', 'k', 'K', false],
      ['skill1', 'l', 'L', false],
      ['skill2', 'u', 'U', false],
      ['skill3', 'i', 'I', false],
      ['ult', 'o', 'O', false],
      ['dodge', 'q', 'Q', true],
      ['interact', 'e', 'E', true],
    ],
  );
  assert.deepEqual(
    controls.p2.bindings.map(b => [b.name, b.slot, b.keyLabel, b.isExtra]),
    [
      ['attack', 'j', '1', false],
      ['dash', 'k', '2', false],
      ['skill1', 'l', '3', false],
      ['skill2', 'u', '4', false],
      ['skill3', 'i', '5', false],
      ['ult', 'o', '6', false],
      ['dodge', 'q', '0', true],
      ['interact', 'e', '.', true],
    ],
  );

  // Simultaneous P1 + P2 keyboard play (plus both Numpad & Digit/Period forms for P2)
  down.add('KeyW');
  down.add('KeyD');
  down.add('KeyJ');
  down.add('KeyQ');
  down.add('ArrowDown');
  down.add('Digit2');
  down.add('NumpadDecimal');
  controls.update(0.016);

  assert.ok(Math.abs(controls.p1.move.x - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(controls.p1.move.y - (-Math.SQRT1_2)) < 1e-6);
  assert.equal(controls.p1.wasPressed('attack'), true);
  assert.equal(controls.p1.wasPressed('j'), true);
  assert.equal(controls.p1.isDown('dodge'), true);
  assert.equal(controls.p1.isDown('dash'), false);

  assert.equal(controls.p2.move.x, 0);
  assert.equal(controls.p2.move.y, 1);
  assert.equal(controls.p2.wasPressed('dash'), true);
  assert.equal(controls.p2.isDown('interact'), true);
  assert.equal(controls.p2.isDown('attack'), false);

  // Buffering check
  down.clear();
  controls.update(0.05);
  assert.equal(controls.p1.isDown('attack'), false);
  assert.equal(controls.p1.isBuffered('attack'), true);
  assert.equal(controls.p1.consumeBuffered('attack'), true);
  assert.equal(controls.p1.consumeBuffered('attack'), false);

  // Virtual analog stick preserves fractional speed and follows yAxis convention
  controls.p1.setVirtualStick(0.5, -0.25);
  controls.p1.setVirtualButton('ult', true);
  controls.update(0.016);
  assert.ok(Math.abs(controls.p1.move.x - 0.5) < 1e-6);
  assert.ok(Math.abs(controls.p1.move.y - (-0.25)) < 1e-6);
  assert.equal(controls.p1.wasPressed('o'), true);
});

test('createTouchControls handles auto touch reveal, radial deadzone, multi-touch buttons, cooldowns, 2P panes, and dispose', () => {
  // Pure radial deadzone unit verification
  assert.deepEqual(applyRadialDeadzone(3, 4, 50, 0.12), {
    x: 0,
    y: 0,
    magnitude: 0,
    knobX: 3,
    knobY: 4,
  });
  const half = applyRadialDeadzone(28, 0, 50, 0.2); // 0.56 norm -> (0.56 - 0.2) / 0.8 = 0.45
  assert.ok(Math.abs(half.x - 0.45) < 1e-6 && Math.abs(half.magnitude - 0.45) < 1e-6);

  // Desktop starts hidden in 'touch-only' mode, then reveals on touch pointerdown
  const dom = makeMockDom({ maxTouchPoints: 0, coarse: false });
  const controls = createArcadeControls({ actions: ['attack', 'dash', 'skill1'], extras: ['dodge'] });
  const ui = createTouchControls({
    controls,
    container: dom.body,
    documentRef: dom.documentRef,
    windowRef: dom.windowRef,
    navigatorRef: dom.navigatorRef,
    joystickRadius: 50,
    deadzone: 0.1,
  });

  assert.equal(ui.visible, false);
  assert.equal(ui.root.getAttribute('data-visible'), 'false');

  dom.windowRef.emit('pointerdown', { pointerType: 'touch' });
  assert.equal(ui.visible, true);
  assert.equal(ui.root.getAttribute('data-visible'), 'true');

  const joyZone = ui.root.querySelectorAll('.hgame-joy-zone')[0];
  const buttons = ui.root.querySelectorAll('.hgame-skill-btn');
  assert.equal(buttons.length, 4);

  // Multi-touch: hold joystick with pointerId=1 while pressing Attack & Dash with pointerIds 2 and 3
  let prevented = 0;
  joyZone.emit('pointerdown', { pointerId: 1, clientX: 100, clientY: 300, preventDefault() { prevented++; } });
  joyZone.emit('pointermove', { pointerId: 1, clientX: 100, clientY: 250, preventDefault() { prevented++; } });
  // Extra touch on occupied joystick zone must be ignored
  joyZone.emit('pointerdown', { pointerId: 99, clientX: 20, clientY: 20 });

  buttons[0].emit('pointerdown', { pointerId: 2, preventDefault() { prevented++; } });
  buttons[1].emit('pointerdown', { pointerId: 3, preventDefault() { prevented++; } });
  assert.ok(prevented >= 4);

  controls.update(0.016);
  assert.equal(controls.p1.move.x, 0);
  assert.ok(Math.abs(controls.p1.move.y - (-1)) < 1e-6);
  assert.equal(controls.p1.wasPressed('attack'), true);
  assert.equal(controls.p1.wasPressed('dash'), true);

  // Cooldown & grid layout switching
  assert.equal(ui.setCooldown('attack', 0.5, 2.0), true);
  assert.equal(buttons[0].getAttribute('data-cooldown'), 'true');
  assert.equal(buttons[0].children[2].textContent, '0.5');
  ui.setCooldown('attack', 0);
  assert.equal(buttons[0].getAttribute('data-cooldown'), 'false');

  ui.setButtonLayout('grid');
  assert.equal(ui.buttonLayout, 'grid');
  assert.equal(ui.root.getAttribute('data-button-layout'), 'grid');

  // Disabling button releases active virtual press cleanly
  assert.equal(ui.setButtonEnabled('attack', false), true);
  controls.update(0.016);
  assert.equal(controls.p1.isDown('attack'), false);
  assert.equal(controls.p1.isDown('dash'), true);
  ui.setButtonEnabled('attack', true);

  // pointercancel / blur safety clears held inputs
  dom.windowRef.emit('blur');
  controls.update(0.016);
  assert.equal(controls.p1.move.active, false);
  assert.equal(controls.p1.isDown('dash'), false);

  assert.equal(ui.dispose(), true);
  assert.equal(ui.dispose(), false);
  assert.equal(dom.body.children.length, 0);

  // 2P split touch regions
  const dom2p = makeMockDom({ maxTouchPoints: 5, coarse: true, innerWidth: 1000, innerHeight: 500 });
  const c2p = createArcadeControls({ players: 2, actions: ['attack', 'dash'] });
  const ui2p = createTouchControls({
    controls: c2p,
    container: dom2p.body,
    documentRef: dom2p.documentRef,
    windowRef: dom2p.windowRef,
    navigatorRef: dom2p.navigatorRef,
  });
  const panes = ui2p.root.querySelectorAll('.hgame-touch-pane');
  assert.equal(panes.length, 2);
  assert.equal(panes[0].styleMap.get('left'), '0.0000%');
  assert.equal(panes[0].styleMap.get('width'), '50.0000%');
  assert.equal(panes[1].styleMap.get('left'), '50.0000%');
  assert.equal(panes[1].styleMap.get('width'), '50.0000%');
  ui2p.dispose();
});

test('computeSplitScreenViews and setViews work across Canvas2D, WebGL2D, and Three.js adapters', () => {
  const views2 = computeSplitScreenViews(2, { width: 960, height: 540 });
  assert.equal(views2.length, 2);
  assert.deepEqual([views2[0].x, views2[0].width, views2[1].x, views2[1].width], [0, 0.5, 0.5, 0.5]);

  const views4 = computeSplitScreenViews(4);
  assert.equal(views4.length, 4);

  // 1) Canvas2D split-screen + pane-aware picking
  const ops = { fillRect: 0, strokeRect: 0, clip: 0, save: 0, restore: 0 };
  const c2dCtx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#fff',
    lineWidth: 1,
    save() { ops.save++; },
    restore() { ops.restore++; },
    setTransform() {},
    transform() {},
    translate() {},
    rotate() {},
    scale() {},
    beginPath() {},
    rect() {},
    clip() { ops.clip++; },
    fillRect() { ops.fillRect++; },
    strokeRect() { ops.strokeRect++; },
  };
  const canvas2dEl = {
    clientWidth: 960,
    clientHeight: 540,
    width: 960,
    height: 540,
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 540 }; },
    getContext: t => (t === '2d' ? c2dCtx : null),
  };
  const a2d = createCanvas2DAdapter({ canvas: canvas2dEl, width: 960, height: 540 });
  const scene2d = new Scene('split2d');
  const p1 = scene2d.add(new Entity({ x: 0, y: 0 }));
  p1.addComponent(new Sprite2D({ shape: 'rect', width: 20, height: 20, color: '#60d9b7' }));
  const p2 = scene2d.add(new Entity({ x: 1000, y: 0 }));
  p2.addComponent(new Sprite2D({ shape: 'rect', width: 20, height: 20, color: '#ff8844' }));
  scene2d._setActive(true);

  const cam1 = new Camera2D({ x: 0, y: 0 });
  const cam2 = new Camera2D({ x: 1000, y: 0 });
  a2d.setViews(computeSplitScreenViews(2, { width: 960, height: 540, cameras: [cam1, cam2] }));
  assert.equal(a2d.getViews().length, 2);

  a2d.render(scene2d);
  assert.equal(ops.clip, 2);
  assert.equal(ops.strokeRect, 2);
  assert.equal(a2d.stats.drawnSprites, 2);

  // Clicking center of left pane (x=240) hits cam1 origin (0,0); right pane center (x=720) hits cam2 origin (1000,0)
  const hitLeft = a2d.screenToWorld(240, 270);
  const hitRight = a2d.screenToWorld(720, 270);
  assert.ok(Math.abs(hitLeft.x - 0) < 1e-6 && Math.abs(hitLeft.y) < 1e-6);
  assert.ok(Math.abs(hitRight.x - 1000) < 1e-6 && Math.abs(hitRight.y) < 1e-6);

  a2d.setViews(null);
  assert.equal(a2d.getViews(), null);
  a2d.dispose();

  // 2) WebGL2D split-screen bottom-up scissor & viewport verification
  const glOps = { viewports: [], scissors: [], draws: 0 };
  const mockGl = {
    VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88e4, DYNAMIC_DRAW: 0x88e8, FLOAT: 0x1406,
    TEXTURE_2D: 0x0de1, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, CLAMP_TO_EDGE: 0x812f,
    NEAREST: 0x2600, LINEAR: 0x2601, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
    SCISSOR_TEST: 0x0c11, COLOR_BUFFER_BIT: 0x4000, BLEND: 0x0be2, SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303, TEXTURE0: 0x84c0, TRIANGLES: 0x0004,
    createShader() { return {}; }, shaderSource() {}, compileShader() {},
    getShaderParameter() { return true; }, getShaderInfoLog() { return ''; }, deleteShader() {},
    createProgram() { return {}; }, attachShader() {}, linkProgram() {},
    getProgramParameter() { return true; }, getProgramInfoLog() { return ''; }, deleteProgram() {},
    getUniformLocation(_p, name) { return { name }; },
    createVertexArray() { return {}; }, bindVertexArray() {}, deleteVertexArray() {},
    createBuffer() { return {}; }, bindBuffer() {}, bufferData() {}, bufferSubData() {}, deleteBuffer() {},
    enableVertexAttribArray() {}, vertexAttribPointer() {}, vertexAttribDivisor() {},
    createTexture() { return {}; }, bindTexture() {}, texParameteri() {}, texImage2D() {}, deleteTexture() {},
    activeTexture() {}, uniform1i() {}, uniform4f() {},
    disable() {}, enable() {}, blendFunc() {}, clearColor() {}, clear() {}, useProgram() {},
    viewport(x, y, w, h) { glOps.viewports.push([x, y, w, h]); },
    scissor(x, y, w, h) { glOps.scissors.push([x, y, w, h]); },
    drawArraysInstanced() { glOps.draws++; },
  };
  const glCanvas = {
    clientWidth: 960,
    clientHeight: 540,
    width: 960,
    height: 540,
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 540 }; },
    getContext: t => (t === 'webgl2' ? mockGl : null),
  };
  const wgl = createWebGL2DAdapter({ canvas: glCanvas, width: 960, height: 540, pixelRatio: 1 });
  wgl.setViews(computeSplitScreenViews(2, { direction: 'horizontal', width: 960, height: 540, cameras: [cam1, cam2] }));
  wgl.render(scene2d);
  // Top pane (y=0, h=0.5) must map to WebGL bottom-up vy=270; bottom pane (y=0.5) -> vy=0
  assert.deepEqual(glOps.scissors, [
    [0, 270, 960, 270],
    [0, 0, 960, 270],
  ]);
  assert.equal(glOps.draws, 2);
  wgl.dispose();

  // 3) Three.js split-screen + aspect + bottom-up scissor + screenToRay pane resolution
  const threeCalls = { viewports: [], scissors: [], renderedCams: [] };
  class MockThreeWebGL {
    constructor() {
      this.capabilities = { isWebGL2: false, getMaxAnisotropy: () => 4 };
      this.shadowMap = { enabled: false, type: 0 };
      this.autoClear = true;
      this.toneMapping = THREE.NoToneMapping;
      this.toneMappingExposure = 1;
    }
    getContext() { return null; }
    setPixelRatio() {}
    setSize() {}
    setScissorTest() {}
    setViewport(x, y, w, h) { threeCalls.viewports.push([x, y, w, h]); }
    setScissor(x, y, w, h) { threeCalls.scissors.push([x, y, w, h]); }
    clear() {}
    render(_s, cam) { threeCalls.renderedCams.push(cam); }
    dispose() {}
  }
  const mockThree = { ...THREE, WebGLRenderer: MockThreeWebGL };
  const threeCanvas = {
    clientWidth: 960,
    clientHeight: 540,
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 540 }; },
    addEventListener() {},
    removeEventListener() {},
  };
  const threeAdapter = createThreeAdapter({ THREE: mockThree, canvas: threeCanvas, width: 960, height: 540, pixelRatio: 1 });
  const scene3d = new Scene('split3d');
  const c3a = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  c3a.position.set(0, 2, 10);
  c3a.lookAt(0, 2, 0);
  const c3b = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  c3b.position.set(50, 2, 10);
  c3b.lookAt(50, 2, 0);

  threeAdapter.setViews(computeSplitScreenViews(2, { direction: 'vertical', width: 960, height: 540, cameras: [c3a, c3b] }));
  assert.ok(Math.abs(c3a.aspect - (480 / 540)) < 1e-4);
  threeAdapter.render(scene3d);

  assert.deepEqual(threeCalls.scissors, [
    [0, 0, 480, 540],
    [480, 0, 480, 540],
  ]);
  assert.deepEqual(threeCalls.renderedCams, [c3a, c3b]);

  // Ray from center of right pane (720, 270) originates from Player 2's camera at x=50
  const rayRight = threeAdapter.screenToRay(720, 270);
  assert.ok(Math.abs(rayRight.origin.x - 50) < 1e-4);
  assert.ok(Math.abs(rayRight.direction.x) < 1e-4 && rayRight.direction.z < -0.99);

  threeAdapter.dispose();
});
