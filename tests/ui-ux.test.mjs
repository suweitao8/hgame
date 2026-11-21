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
import { createCanvasUiGroup } from '../assets/runtime/integrations/ui-2d.js';
import { createWorldHud3D, createSpatialPanel3D, createSpatialUiGroup3D } from '../assets/runtime/integrations/ui-3d.js';
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

test('upgraded ui, 3d, and pixi2d profile starters pass Anti-Bloat UI/UX lint checks', () => {
  for (const profile of ['ui', '3d', 'pixi2d']) {
    const dir = path.join(root, 'assets', 'profiles', profile);
    const files = [{ rel: 'index.html', content: readFileSync(path.join(dir, 'index.html'), 'utf8') }];
    if (profile === 'pixi2d') {
      files.push({ rel: 'src/main.js', content: readFileSync(path.join(dir, 'src', 'main.js'), 'utf8') });
      files.push({ rel: 'src/ui/HudController.js', content: readFileSync(path.join(dir, 'src', 'ui', 'HudController.js'), 'utf8') });
    } else {
      files.push({ rel: 'src/main.js', content: readFileSync(path.join(dir, 'main.js'), 'utf8') });
    }
    const report = lintFiles(files);
    assert.equal(report.pass, true, `${profile}: ${JSON.stringify(report.violations)}`);
  }
});

test('createUiDirector tracks ghost-trail bars and radial cooldown rings with ready cues', () => {
  const cues = [];
  const director = createUiDirector({
    initialPhase: UI_PHASES.PLAYING,
    bars: { hp: { value: 1, holdSec: 0.2, halfLife: 0.05 } },
    cooldowns: { dash: { remaining: 0.3, duration: 0.6, cueOnReady: true } },
    onCue: (c, d) => cues.push({ c, d }),
  });

  // Damage drops primary value immediately while ghost holds for 0.2s
  director.setBar('hp', 0.4);
  assert.equal(director.getBar('hp').value, 0.4);
  assert.equal(director.getBar('hp').ghostValue, 1);
  assert.equal(director.getBar('hp').direction, -1);

  for (let i = 0; i < 2; i++) director.update(0.05); // 0.1s < 0.2s hold
  assert.equal(director.getBar('hp').ghostValue, 1);

  for (let i = 0; i < 12; i++) director.update(0.05); // after hold, ghost catches down
  assert.ok(director.getBar('hp').ghostValue < 0.5);

  // Cooldown counts down to ready and triggers readyFlash + confirm cue
  director.setCooldown('dash', 0.3, 0.6);
  assert.equal(director.getCooldown('dash').ready, false);
  for (let i = 0; i < 8; i++) director.update(0.05);
  assert.equal(director.getCooldown('dash').ready, true);
  assert.ok(director.getCooldown('dash').readyFlash > 0);
  assert.ok(cues.some((e) => e.c === UI_UX_CUES.CONFIRM && e.d?.id === 'dash'));
  director.dispose();
});

test('bindUiUxDOM supports themes, bars, cooldowns, flyTo Bezier tokens, keyboard focus ring, and touch swipe', () => {
  const doc = createMockDocument();
  const cardA = doc.createElement('button');
  cardA.className = 'card';
  const cardB = doc.createElement('button');
  cardB.className = 'card';
  const barEl = doc.createElement('div');
  barEl.setAttribute('data-ui-bar', 'hp');
  const cdEl = doc.createElement('div');
  cdEl.setAttribute('data-ui-cooldown', 'dash');
  const metricEl = doc.createElement('span');
  metricEl.setAttribute('data-ui-metric', 'coins');

  let clickedB = 0;
  cardB.dispatch = (t, ev) => {
    if (t === 'click') clickedB++;
    const orig = Object.getPrototypeOf(cardB);
    void orig;
  };
  cardB.click = () => { clickedB++; };

  doc.body.appendChild(barEl);
  doc.body.appendChild(cdEl);
  doc.body.appendChild(metricEl);
  doc.body.appendChild(cardA);
  doc.body.appendChild(cardB);

  const director = createUiDirector({
    initialPhase: UI_PHASES.CHOICE,
    metrics: { coins: { value: 10, snap: true } },
    bars: { hp: { value: 1 } },
    cooldowns: { dash: { remaining: 0.5, duration: 1 } },
  });

  doc.elementFromPoint = (x) => (x > 250 ? cardB : cardA);
  const uiUx = bindUiUxDOM({ root: doc.body, director, theme: 'scifi', autoRaf: false });

  assert.equal(doc.body.getAttribute('data-ui-theme'), 'scifi');
  director.setBar('hp', 0.5);
  uiUx.step(0.05);
  assert.equal(barEl.style.getPropertyValue('--hg-bar-value'), '0.5000');
  assert.equal(cdEl.getAttribute('data-ui-cd-ready'), 'false');

  // Keyboard navigation + Enter confirm
  doc.defaultView.dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(uiUx.getFocusedElement(), cardA);
  doc.defaultView.dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(uiUx.getFocusedElement(), cardB);
  doc.defaultView.dispatch('keydown', { key: 'Enter' });
  assert.equal(clickedB, 1);

  // Touch swipe from cardA across to cardB triggers cardB click on release
  doc.body.dispatch('pointerdown', { target: cardA, pointerType: 'touch', clientX: 150, clientY: 150 });
  doc.body.dispatch('pointermove', { target: cardA, pointerType: 'touch', clientX: 280, clientY: 150 });
  doc.defaultView.dispatch('pointerup', { pointerType: 'touch', clientX: 280, clientY: 150 });
  assert.equal(clickedB, 2);

  // Fly-to-HUD token arrives and increments coins metric
  assert.equal(uiUx.flyTo({ from: cardA, to: metricEl, count: 2, duration: 0.2, metric: 'coins', delta: 5 }), 2);
  for (let i = 0; i < 10; i++) uiUx.step(0.05);
  assert.equal(metricEl.textContent, '20');

  uiUx.dispose();
  director.dispose();
});

test('createSpatialUiGroup3D picks frontmost occluded 3D panel and spreads fan neighbors', () => {
  class MockVec3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
    applyMatrix4(m) {
      if (m && Number.isFinite(m.offsetZ)) this.z -= m.offsetZ;
      return this;
    }
  }
  class MockMat4 {
    constructor(offsetZ = 0) { this.offsetZ = offsetZ; }
    copy(m) { this.offsetZ = m?.offsetZ ?? 0; return this; }
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
      remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); }
      updateMatrixWorld() {}
    },
    PlaneGeometry: class { constructor(w, h) { this.w = w; this.h = h; } dispose() {} },
    MeshBasicMaterial: class { constructor(o) { this.o = o; } dispose() {} },
    Mesh: class {
      constructor(geometry, material) {
        Object.assign(this, makeTransform());
        this.geometry = geometry;
        this.material = material;
        this.matrixWorld = new MockMat4(0);
        this.children = [];
      }
      add(c) { this.children.push(c); }
      remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); }
    },
  };
  const mockRenderer = {
    screenToRay(cx, cy, out) {
      out.origin.x = (cx - 480) / 200;
      out.origin.y = -(cy - 270) / 200;
      out.origin.z = 5;
      out.direction.x = 0; out.direction.y = 0; out.direction.z = -1;
      return out;
    },
  };

  let backClicks = 0;
  let frontClicks = 0;
  const back = createSpatialPanel3D({ THREE: MockTHREE, renderer: mockRenderer, width: 2, height: 1.5, onClick: () => backClicks++ });
  const front = createSpatialPanel3D({ THREE: MockTHREE, renderer: mockRenderer, width: 2, height: 1.5, onClick: () => frontClicks++ });
  back.mesh.matrixWorld.offsetZ = 0;
  front.mesh.matrixWorld.offsetZ = 2; // closer to z=5 origin (distance 3 vs 5)

  const previewMesh = { ...makeTransform() };
  front.setPreviewObject(previewMesh, { spinSpeed: 2 });

  const group = createSpatialUiGroup3D({ renderer: mockRenderer, panels: [back, front], layout: 'fan', fanSpacing: 1.2 });
  group.handlePointerDown(480, 270);
  const clicked = group.handlePointerUp(480, 270);
  assert.equal(clicked, front);
  assert.equal(frontClicks, 1);
  assert.equal(backClicks, 0);
  assert.equal(group.getHoveredIndex(), 1);

  for (let i = 0; i < 15; i++) group.update(1 / 60);
  assert.ok(previewMesh.rotation.y > 0);
  // Neighbor card 0 spreads left when card 1 is hovered
  assert.ok(back.object3d.position.x < -0.7);
  group.dispose();
});

test('createCanvasUiGroup drives 2D in-canvas cards, touch swipe, Pixi sync, and Canvas2D draw', () => {
  const selected = [];
  const ui2d = createCanvasUiGroup({
    items: [
      { id: 'c1', x: 100, y: 200, width: 120, height: 160, glyph: '⚔', label: '狂暴' },
      { id: 'c2', x: 260, y: 200, width: 120, height: 160, glyph: '🛡', label: '铁壁' },
    ],
    onSelect: (item) => selected.push(item.id),
  });

  ui2d.triggerEntrance();
  for (let i = 0; i < 20; i++) ui2d.update(0.02);

  ui2d.handlePointerDown(100, 200);
  ui2d.handlePointerMove(260, 200); // touch swipe onto second card
  const chosen = ui2d.handlePointerUp(260, 200);
  assert.equal(chosen?.id, 'c2');
  assert.deepEqual(selected, ['c2']);

  // Sync Pixi containers cleanly without Pixi runtime import
  const pixiNodes = [
    { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, skew: { set(x, y) { this.x = x; this.y = y; } }, rotation: 0, alpha: 1, visible: true },
    { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, skew: { set(x, y) { this.x = x; this.y = y; } }, rotation: 0, alpha: 1, visible: true },
  ];
  ui2d.update(0.02);
  ui2d.syncPixi(pixiNodes);
  assert.equal(pixiNodes[1].position.x, 260);
  assert.ok(pixiNodes[1].scale.x >= 1);

  // Draw Canvas2D cleanly
  const ops = [];
  const mockCtx = {
    save: () => ops.push('save'),
    restore: () => ops.push('restore'),
    translate: () => {},
    transform: () => {},
    beginPath: () => {},
    roundRect: () => {},
    fill: () => {},
    stroke: () => {},
    fillText: (t) => ops.push(`text:${t}`),
  };
  ui2d.drawCanvas2D(mockCtx);
  assert.ok(ops.includes('text:狂暴') && ops.includes('text:铁壁'));
});
