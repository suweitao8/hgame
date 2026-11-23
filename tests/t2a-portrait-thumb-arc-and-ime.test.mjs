import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_THUMB_ARC_SPEC,
  computeThumbArcLayout,
  isInThumbComfortZone,
  createThumbArcHud,
  createCanvasUiRenderer,
} from '../assets/runtime/index.js';
import { createArcadeControls } from '../assets/runtime/platform/input.js';
import { createTouchControls } from '../assets/runtime/integrations/touch-controls.js';
import { auditPortraitThumbZone } from '../.agents/skills/hgame-ui-ux/scripts/check-ui.mjs';

test('S4 computeThumbArcLayout keeps all portrait actions inside bottom-right lower-half comfort arc without overlaps', () => {
  const viewports = [
    [360, 640],
    [390, 844],
    [430, 932],
  ];
  const items = [
    { id: 'atk', label: 'A', primary: true },
    { id: 'dash', label: 'D' },
    { id: 'skill1', label: 'S1' },
    { id: 'skill2', label: 'S2' },
    { id: 'ult', label: 'U' },
    { id: 'item', label: 'I' },
  ];

  for (const [w, h] of viewports) {
    const res = computeThumbArcLayout({
      viewportWidth: w,
      viewportHeight: h,
      items,
      safeArea: { bottom: 20, right: 8, left: 8 },
    });
    assert.equal(res.items.length, items.length);
    assert.equal(res.allInLowerHalf, true);
    for (const btn of res.items) {
      assert.ok(btn.cy >= h * DEFAULT_THUMB_ARC_SPEC.minCenterYRatio, `Button ${btn.id} y=${btn.cy} must stay in lower half on ${w}x${h}`);
      assert.ok(btn.cx - btn.radius >= 8 && btn.cx + btn.radius <= w - 8);
      assert.ok(btn.cy + btn.radius <= h - 20);
      assert.equal(isInThumbComfortZone({ x: btn.cx, y: btn.cy }, { width: w, height: h }).inLowerHalf, true);
    }
    const audit = auditPortraitThumbZone(res.items.map(b => ({ id: b.id, y: b.y, height: b.size })), h);
    assert.equal(audit.pass, true);
  }
});

test('S4 createThumbArcHud renders semi-arc guide, triggers bottom-right actions, and auditPortraitThumbZone flags upper buttons', () => {
  const pressed = [];
  const hud = createThumbArcHud({
    items: [
      { id: 'fire', label: 'ATK', primary: true, cooldownRatio: 0.25 },
      { id: 'dodge', label: 'DODGE' },
      { id: 'burst', label: 'ULT' },
    ],
    onAction: id => pressed.push(id),
  });

  const strokes = [];
  const ctx = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
    save() {},
    restore() {},
    beginPath() {},
    arc(...args) { strokes.push(args); },
    moveTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    fillText() {},
  };

  const layout = hud.render(ctx, 390, 844);
  assert.ok(strokes.length >= 4);
  const fire = layout.items[0];
  const dodge = layout.items[1];
  hud.pointerDown(fire.cx, fire.cy);
  hud.pointerUp(fire.cx, fire.cy);
  hud.pointerDown(dodge.cx, dodge.cy);
  hud.pointerUp(dodge.cx, dodge.cy);
  assert.deepEqual(pressed, ['fire', 'dodge']);

  const badAudit = auditPortraitThumbZone([
    { id: 'topBtn', y: 20, height: 40 },
    { id: 'bottomBtn', y: 740, height: 60 },
  ], 844);
  assert.equal(badAudit.pass, false);
  assert.equal(badAudit.violations.length, 1);
  assert.equal(badAudit.violations[0].id, 'topBtn');
});

test('S4 createCanvasUiRenderer supports mobile CJK IME compositionUpdate & compositionEnd on textInput', () => {
  const inputNode = { id: 'nick', type: 'textInput', height: 40, value: 'Hi ' };
  const ui = createCanvasUiRenderer({ dpr: 2 });
  ui.layout({ id: 'panel', type: 'panel', children: [inputNode] }, 300, 120);
  ui.pointerDown(50, 20);
  assert.equal(ui.compositionUpdate('nihao'), true);
  assert.equal(ui.getState().composingText, 'nihao');
  assert.equal(ui.compositionEnd('你好'), true);
  assert.equal(ui.getState().composingText, '');
  assert.equal(inputNode.value, 'Hi 你好');
});

test('S4 createTouchControls supports portrait-arc buttonLayout inside bottom-right lower half', () => {
  const created = [];
  const makeEl = tag => {
    const attrs = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      children: [],
      style: {
        _props: new Map(),
        setProperty(k, v) { this._props.set(k, v); this[k] = v; },
      },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) ?? null; },
      appendChild(child) { this.children.push(child); return child; },
      addEventListener() {},
      removeEventListener() {},
      remove() {},
    };
    created.push(el);
    return el;
  };
  const doc = {
    head: { children: [], appendChild(c) { this.children.push(c); } },
    createElement: makeEl,
    addEventListener() {},
    removeEventListener() {},
  };
  const container = { clientWidth: 390, clientHeight: 844, appendChild() {} };
  const win = { innerWidth: 390, innerHeight: 844, addEventListener() {}, removeEventListener() {} };
  const ctrl = createArcadeControls({ actions: ['attack', 'dash', 'skill1'], extras: ['dodge'] });
  const tc = createTouchControls({
    controls: ctrl,
    container,
    documentRef: doc,
    windowRef: win,
    mode: 'always',
    buttonLayout: 'portrait-arc',
  });

  assert.equal(tc.buttonLayout, 'portrait-arc');
  assert.equal(tc.root.getAttribute('data-button-layout'), 'portrait-arc');
  const btns = created.filter(e => e.className === 'hgame-skill-btn');
  assert.ok(btns.length >= 2);
  for (const b of btns) {
    const bottom = parseFloat(b.style.bottom);
    const height = parseFloat(b.style.height);
    assert.ok(844 - (bottom + height * 0.5) >= 844 * 0.5, 'Every portrait-arc touch button center must sit in lower half');
  }
  tc.dispose();
});
