import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import {
  HGame,
  UI_PHASES,
  UI_UX_CUES,
  computeStaggerProgress,
  createUiSurfaceSpring,
  createUiMotionGroup,
  createUiDirector,
  createPanelStack,
} from '../assets/runtime/index.js';
import { bindUiUxDOM, injectUiUxStyles } from '../assets/runtime/integrations/ui-ux-dom.js';
import { createWorldHud3D, createSpatialPanel3D } from '../assets/runtime/integrations/ui-3d.js';
import { lintFiles } from '../.agents/skills/hgame-ui-ux/scripts/check-ui.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function createMockElement(tagName = 'div', ownerDocument = null) {
  const listeners = new Map();
  const attrs = new Map();
  const classes = new Set();
  const children = [];
  const styleProps = new Map();
  const style = {
    opacity: '',
    transform: '',
    zIndex: '',
    position: '',
    left: '',
    top: '',
    pointerEvents: '',
    transformOrigin: '',
    willChange: '',
    setProperty(k, v) { styleProps.set(k, v); },
    getPropertyValue(k) { return styleProps.get(k) ?? ''; },
  };
  const el = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    ownerDocument,
    hidden: false,
    disabled: false,
    textContent: '',
    isConnected: true,
    parentElement: null,
    children,
    childNodes: children,
    style,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    get className() { return [...classes].join(' '); },
    set className(v) {
      classes.clear();
      for (const c of String(v).split(/\s+/).filter(Boolean)) classes.add(c);
    },
    setAttribute(k, v) {
      attrs.set(k, String(v));
      if (k === 'id') el.id = String(v);
      if (k === 'class') el.className = String(v);
    },
    getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
    hasAttribute(k) { return attrs.has(k); },
    appendChild(child) {
      child.parentElement = el;
      children.push(child);
      return child;
    },
    remove() {
      if (!el.parentElement) return;
      const list = el.parentElement.children;
      const idx = list.indexOf(el);
      if (idx >= 0) list.splice(idx, 1);
      el.parentElement = null;
    },
    contains(node) {
      if (node === el) return true;
      for (const c of children) {
        if (c.contains(node)) return true;
      }
      return false;
    },
    matches(sel) {
      const parts = sel.split(',').map((s) => s.trim());
      for (const part of parts) {
        if (part.startsWith('button') && el.tagName === 'BUTTON') {
          if (part.includes(':not([data-ui-static])') && el.hasAttribute('data-ui-static')) continue;
          return true;
        }
        if (part === '[data-ui-tilt]' && el.hasAttribute('data-ui-tilt')) return true;
        if (part === '.card' && classes.has('card')) return true;
      }
      return false;
    },
    closest(sel) {
      let cur = el;
      while (cur) {
        if (cur.matches?.(sel)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    querySelectorAll(sel) {
      const out = [];
      const attrMatch = /^\[([^\]]+)\]$/.exec(sel.trim());
      const visit = (node) => {
        for (const c of node.children) {
          if (attrMatch) {
            if (c.hasAttribute(attrMatch[1])) out.push(c);
          } else if (c.matches(sel)) {
            out.push(c);
          }
          visit(c);
        }
      };
      visit(el);
      return out;
    },
    querySelector(sel) { return el.querySelectorAll(sel)[0] ?? null; },
    getBoundingClientRect: () => ({ left: 100, top: 100, width: 200, height: 100 }),
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatch(type, event = {}) {
      const ev = { target: el, ...event };
      for (const fn of listeners.get(type) ?? []) fn(ev);
    },
  };
  return el;
}

function createMockDocument() {
  const doc = {
    head: null,
    body: null,
    defaultView: null,
    createElement(tag) { return createMockElement(tag, doc); },
  };
  doc.head = createMockElement('head', doc);
  doc.body = createMockElement('body', doc);
  doc.defaultView = createMockElement('window', doc);
  return doc;
}

test('createUiSurfaceSpring drives 3D tilt, lift, press squash, glare, and settles cleanly', () => {
  assert.equal(typeof HGame.createUiSurfaceSpring, 'function');
  const spring = createUiSurfaceSpring({ maxTiltDeg: 12, hoverScale: 1.05, pressScale: 0.95, hoverLift: -8 });
  assert.equal(spring.isSettled(), true);

  // Hover top-right corner (nx=1, ny=-1) -> positive tiltX (top tilts back), positive tiltY
  spring.setHover(true, 1, -1);
  for (let i = 0; i < 40; i++) spring.step(1 / 60);
  const hovered = spring.getState();
  assert.equal(hovered.hovered, true);
  assert.ok(hovered.tiltX > 10 && hovered.tiltX <= 12.1);
  assert.ok(hovered.tiltY > 10 && hovered.tiltY <= 12.1);
  assert.ok(hovered.scale > 1.04);
  assert.ok(hovered.lift < -6);
  assert.ok(hovered.glareX > 90 && hovered.glareY < 10 && hovered.glareOpacity > 0.6);
  assert.ok(spring.toCssTransform().includes('perspective(800px)'));

  // Press squashes scale below 1
  spring.setPressed(true);
  for (let i = 0; i < 30; i++) spring.step(1 / 60);
  assert.ok(spring.getState().scale < 0.97);

  // Disabled resets hover/press and returns to rest
  spring.setDisabled(true);
  spring.snap();
  const rest = spring.getState();
  assert.equal(rest.hovered, false);
  assert.equal(rest.pressed, false);
  assert.equal(rest.scale, 1);
  assert.equal(rest.tiltX, 0);
  assert.equal(rest.tiltY, 0);
  assert.equal(rest.settled, true);
});

test('createUiMotionGroup coordinates focus navigation and staggered reveal', () => {
  assert.equal(typeof HGame.createUiMotionGroup, 'function');
  const group = createUiMotionGroup({ count: 3, staggerOptions: { delay: 0.05, duration: 0.2 } });
  assert.equal(group.getCount(), 3);

  assert.equal(group.moveFocus(1), 0);
  assert.equal(group.moveFocus(-1), 2); // wraps
  assert.equal(group.getItem(2).getState().focused, true);
  assert.equal(group.getItem(0).getState().focused, false);

  group.triggerEntrance();
  assert.equal(group.getEntranceProgress(0), 0);
  assert.equal(group.getEntranceProgress(2), 0);
  group.step(0.06);
  assert.ok(group.getEntranceProgress(0) > 0);
  assert.ok(group.getEntranceProgress(1) > 0);
  assert.equal(group.getEntranceProgress(2), 0);
  for (let i = 0; i < 30; i++) group.step(0.02);
  assert.equal(group.getEntranceProgress(2), 1);
  assert.ok(computeStaggerProgress(0.24, 0, { delay: 0.05, duration: 0.24 }) >= 0.99);
});

test('createUiDirector coordinates phases, smooth metrics, hint auto-fade, and throttled audio cues', () => {
  assert.equal(typeof HGame.createUiDirector, 'function');
  let clockMs = 1000;
  const synthCalls = [];
  const audio = {
    available: true,
    playSynth(preset, opts) { synthCalls.push({ preset, opts }); return { played: true }; },
  };
  const phaseEvents = [];

  const director = createUiDirector({
    initialPhase: UI_PHASES.TITLE,
    audio,
    now: () => clockMs,
    metrics: {
      score: { value: 0, halfLife: 0.06, cueOnChange: true },
      hp: { value: 100, snap: true },
    },
    onPhaseChange: (e) => phaseEvents.push(e),
  });

  assert.equal(director.getPhase(), 'title');
  assert.equal(director.panelStack.isOpen('title'), true);
  assert.equal(director.panelStack.isOpen('hud'), true);

  director.startGame();
  assert.equal(director.getPhase(), 'playing');
  assert.equal(director.isPaused(), false);
  assert.equal(director.isHintVisible(), true);
  assert.equal(director.getHintAlpha(), 1);

  // First move fades hint over 0.5s (stepped in realistic frame chunks <= 0.1s)
  director.notifyMoved();
  for (let i = 0; i < 5; i++) director.update(0.05);
  assert.ok(Math.abs(director.getHintAlpha() - 0.5) < 0.05);
  for (let i = 0; i < 6; i++) director.update(0.05);
  assert.equal(director.getHintAlpha(), 0);
  assert.equal(director.isHintVisible(), false);

  // Metric smoothing + pulse + cooldown-throttled cue
  director.setMetric('score', 100);
  assert.equal(director.getMetric('score').pulse, 1);
  assert.equal(director.getMetric('score').direction, 1);
  for (let i = 0; i < 40; i++) director.update(1 / 60);
  assert.ok(Math.abs(director.getMetric('score').displayValue - 100) < 0.5);

  // Snap metric updates display immediately
  director.setMetric('hp', 80);
  assert.equal(director.getMetric('hp').displayValue, 80);

  // Cue throttling protects against hover spam
  assert.equal(director.emitCue(UI_UX_CUES.HOVER), true);
  assert.equal(director.emitCue(UI_UX_CUES.HOVER), false);
  clockMs += 60;
  assert.equal(director.emitCue(UI_UX_CUES.HOVER), true);
  assert.ok(synthCalls.length >= 2);

  // Modal pause/choice/result coordination
  clockMs += 100;
  director.openChoice({ choices: ['a', 'b', 'c'] });
  assert.equal(director.panelStack.hasModal(), true);
  assert.equal(director.isPaused(), true);
  director.finishRun({ kills: 42 });
  assert.equal(director.getPhase(), 'result');
  assert.equal(director.panelStack.top().id, 'result');
  assert.ok(phaseEvents.length >= 3);

  director.dispose();
});

test('createPanelStack exposes motion & easedAlpha while keeping exact linear alpha', () => {
  const stack = createPanelStack({
    panels: {
      shop: { modal: true, transitionMs: 200, motion: 'slide-up' },
    },
  });
  const entry = stack.push('shop');
  assert.equal(entry.motion, 'slide-up');
  assert.equal(entry.alpha, 0);
  assert.equal(entry.easedAlpha, 0);
  stack.update(0.1);
  assert.equal(entry.alpha, 0.5);
  assert.ok(entry.easedAlpha > 0.5 && entry.easedAlpha < 1);
});

test('bindUiUxDOM enhances interactive buttons/cards, metrics, and hints cleanly in DOM', () => {
  const doc = createMockDocument();
  assert.equal(injectUiUxStyles(doc), true);
  assert.equal(doc.head.children.length, 1);
  // Idempotent style injection
  injectUiUxStyles(doc);
  assert.equal(doc.head.children.length, 1);

  const card = doc.createElement('button');
  card.className = 'card';
  card.setAttribute('data-ui-tilt', '10');
  const readout = doc.createElement('span');
  readout.setAttribute('data-ui-metric', 'score');
  const hint = doc.createElement('div');
  hint.setAttribute('data-ui-hint', '');
  doc.body.appendChild(readout);
  doc.body.appendChild(card);
  doc.body.appendChild(hint);

  const director = createUiDirector({ initialPhase: UI_PHASES.PLAYING, metrics: { score: { value: 0, snap: true } } });
  const uiUx = bindUiUxDOM({ root: doc.body, director, autoRaf: false });

  assert.equal(hint.hidden, false);
  director.setMetric('score', 25);
  director.notifyMoved();
  for (let i = 0; i < 6; i++) uiUx.step(0.1);
  assert.equal(readout.textContent, '25');
  assert.equal(hint.hidden, true);

  // Pointer hover -> tilt + glare CSS variables
  doc.body.dispatch('pointerover', { target: card, clientX: 280, clientY: 110 });
  doc.body.dispatch('pointermove', { target: card, clientX: 280, clientY: 110 });
  uiUx.step(0.05);
  assert.equal(card.getAttribute('data-ui-hovered'), 'true');
  assert.ok(card.style.transform.includes('rotateX('));
  assert.ok(Number(card.style.getPropertyValue('--hg-glare-o')) > 0);

  // Pointer down & release
  doc.body.dispatch('pointerdown', { target: card, clientX: 200, clientY: 150 });
  uiUx.step(0.05);
  assert.equal(card.getAttribute('data-ui-pressed'), 'true');
  doc.defaultView.dispatch('pointerup', {});
  uiUx.step(0.05);
  assert.equal(card.getAttribute('data-ui-pressed'), 'false');

  uiUx.dispose();
  director.dispose();
});

test('createWorldHud3D and createSpatialPanel3D support 3D world HUD projection and raycasted 3D UI cards', () => {
  const doc = createMockDocument();
  const container = doc.createElement('div');
  const mockRenderer = {
    camera: { position: { x: 0, y: 2, z: 10 } },
    worldToScreen(x, y, z, out) {
      out.x = 480 + x * 40;
      out.y = 270 - y * 40;
      out.ndcZ = 0.2;
      out.visible = z < 9;
      return out;
    },
    screenToRay(clientX, clientY, out) {
      out.origin.x = (clientX - 480) / 200;
      out.origin.y = -(clientY - 270) / 200;
      out.origin.z = 5;
      out.direction.x = 0;
      out.direction.y = 0;
      out.direction.z = -1;
      return out;
    },
  };

  const worldHud = createWorldHud3D({ renderer: mockRenderer, container, maxItems: 4 });
  const visibleCount = worldHud.update([
    { id: 'npc', x: 1, y: 2, z: 0, text: '♥ 3' },
    { id: 'behind', x: 0, y: 0, z: 20, text: '隐藏' },
  ], 1 / 60);
  assert.equal(visibleCount, 1);
  assert.equal(container.children[0].hidden, false);
  assert.equal(container.children[0].textContent, '♥ 3');
  assert.equal(container.children[1].hidden, true);
  worldHud.dispose();
  assert.equal(container.children.length, 0);

  // Minimal Three.js math mock for createSpatialPanel3D
  class MockVec3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
    applyMatrix4() { return this; }
  }
  class MockMat4 {
    copy() { return this; }
    invert() { return this; }
  }
  const makeTransform = () => ({
    position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    rotation: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
  });
  const MockTHREE = {
    Vector3: MockVec3,
    Matrix4: MockMat4,
    DoubleSide: 2,
    Group: class {
      constructor() { Object.assign(this, makeTransform()); this.children = []; }
      add(c) { this.children.push(c); }
      updateMatrixWorld() {}
    },
    PlaneGeometry: class { constructor(w, h) { this.w = w; this.h = h; } dispose() {} },
    MeshBasicMaterial: class { constructor(o) { this.o = o; } dispose() {} },
    Mesh: class {
      constructor(geometry, material) {
        Object.assign(this, makeTransform());
        this.geometry = geometry;
        this.material = material;
        this.matrixWorld = new MockMat4();
      }
    },
  };

  let clicked = 0;
  let hoveredStates = [];
  const panel = createSpatialPanel3D({
    THREE: MockTHREE,
    renderer: mockRenderer,
    width: 2,
    height: 1.2,
    maxTiltDeg: 10,
    hoverLift: 0.2,
    idleFloatAmp: 0,
    onClick: () => { clicked++; },
    onHoverChange: (h) => hoveredStates.push(h),
  });

  // Pointer hits right-top area of panel
  const hit = panel.handlePointerDown(580, 220);
  assert.ok(hit && hit.nx > 0 && hit.ny < 0);
  assert.equal(panel.handlePointerUp(580, 220), true);
  assert.equal(clicked, 1);
  assert.deepEqual(hoveredStates, [true]);

  for (let i = 0; i < 20; i++) panel.update(1 / 60);
  assert.ok(panel.mesh.rotation.y > 0);
  assert.ok(panel.mesh.position.z > 0.05);
  assert.ok(panel.mesh.scale.x > 1.01);

  panel.handlePointerMove(10, 10); // outside panel
  assert.deepEqual(hoveredStates, [true, false]);
  panel.dispose();
});

test('upgraded ui profile starter passes Anti-Bloat UI/UX lint checks', () => {
  const uiDir = path.join(root, 'assets', 'profiles', 'ui');
  const report = lintFiles([
    { rel: 'index.html', content: readFileSync(path.join(uiDir, 'index.html'), 'utf8') },
    { rel: 'src/main.js', content: readFileSync(path.join(uiDir, 'main.js'), 'utf8') },
  ]);
  assert.equal(report.pass, true, JSON.stringify(report.violations));
});
