import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCanvasUiRenderer,
  createCanvasAriaBridge,
  layoutRichTextLines,
  defineInputContext,
  createInputActionRouter,
} from '../assets/runtime/index.js';

function createFakeDomDocument() {
  const makeEl = (tag) => {
    const attrs = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      style: {},
      children: [],
      parentNode: null,
      tabIndex: -1,
      textContent: '',
      onclick: null,
      onfocus: null,
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) ?? null; },
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
      get firstChild() { return el.children[0] ?? null; },
    };
    return el;
  };
  const doc = { createElement: (tag) => makeEl(tag) };
  const container = makeEl('div');
  container.ownerDocument = doc;
  return { doc, container };
}

function createFakeCanvasCtx() {
  const ops = [];
  return {
    ops,
    font: '',
    textAlign: 'left',
    textBaseline: 'middle',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'round',
    save() { ops.push(['save']); },
    restore() { ops.push(['restore']); },
    beginPath() { ops.push(['beginPath']); },
    rect(x, y, w, h) { ops.push(['rect', x, y, w, h]); },
    roundRect(x, y, w, h) { ops.push(['roundRect', x, y, w, h]); },
    clip() { ops.push(['clip']); },
    translate(dx, dy) { ops.push(['translate', dx, dy]); },
    fill() { ops.push(['fill']); },
    stroke() { ops.push(['stroke']); },
    moveTo(x, y) { ops.push(['moveTo', x, y]); },
    lineTo(x, y) { ops.push(['lineTo', x, y]); },
    fillText(t, x, y) { ops.push(['fillText', t, x, y, this.fillStyle]); },
    strokeText(t, x, y) { ops.push(['strokeText', t, x, y]); },
    measureText(str) {
      let w = 0;
      for (const ch of String(str)) w += ch.charCodeAt(0) > 0x255 ? 14 : 7.5;
      return { width: w };
    },
  };
}

test('S4 layoutRichTextLines wraps CJK chars and English words across styled spans', () => {
  const ctx = createFakeCanvasCtx();
  const lines = layoutRichTextLines(ctx, [
    { text: '攻击力 ', color: '#f8fafc' },
    { text: '+120%', color: '#22c55e', weight: '700', underline: true },
    ' Critical Damage Boost',
  ], 140, { fontSize: 14 });

  assert.ok(lines.length >= 2, `Expected multi-line wrap, got ${lines.length}`);
  const joined = lines.map(l => l.segments.map(s => s.text).join('')).join('\n');
  assert.ok(joined.includes('+120%'));
  assert.ok(joined.includes('Critical'));
  assert.ok(joined.includes('Boost'));
});

test('S4 scrollView clips children, scrolls hit-tests, draws IME composition underline, and syncs ARIA bridge', () => {
  const ctx = createFakeCanvasCtx();
  const ui = createCanvasUiRenderer({ dpr: 1 });
  let clicked = null;
  let sliderVal = 0.5;
  const inputNode = { id: 'nameBox', type: 'textInput', height: 32, value: '英雄', placeholder: '输入名字' };
  const tree = {
    id: 'root',
    direction: 'column',
    gap: 6,
    padding: 8,
    children: [
      {
        id: 'sv',
        type: 'scrollView',
        height: 80,
        gap: 4,
        children: [
          { id: 'b1', type: 'button', height: 48, text: '按钮一', onClick: () => { clicked = 'b1'; } },
          { id: 'b2', type: 'button', height: 48, text: '按钮二', onClick: () => { clicked = 'b2'; } },
          { id: 'b3', type: 'button', height: 48, text: '按钮三', onClick: () => { clicked = 'b3'; } },
        ],
      },
      {
        id: 'rt',
        type: 'richText',
        height: 44,
        spans: [
          { text: '生命 ', color: '#fff' },
          { text: '100', color: '#ef4444', underline: true },
        ],
      },
      inputNode,
      { id: 'vol', type: 'slider', height: 24, value: sliderVal, onChange: v => { sliderVal = v; } },
    ],
  };

  ui.render(ctx, tree, 260, 260);
  assert.ok(ctx.ops.some(op => op[0] === 'clip'), 'scrollView must clip');
  assert.ok(ctx.ops.some(op => op[0] === 'fillText' && op[1] === '100'), 'richText must render styled span');

  // b3 starts below visible viewport (y >= 112), so clicking inside sv at bottom before scroll hits b2, not b3
  const scrolled = ui.scroll(80, 60, 40);
  assert.ok(scrolled > 40, `scrollView should scroll positively, got ${scrolled}`);

  // After scroll=80, b3 should now be visible around y ~ 8 + (48+4)*2 - 80 = 32 inside sv [8..88]
  ui.pointerDown(60, 50);
  ui.pointerUp(60, 50);
  assert.equal(clicked, 'b3', 'Clicking inside scrollView after scroll must hit scrolled-in button b3');

  // Outside clip rect click must NOT hit scrolled-out child
  clicked = null;
  ui.pointerDown(60, 5);
  ui.pointerUp(60, 5);
  assert.equal(clicked, null);

  // Focus textInput & test IME composition underline render
  ui.pointerDown(60, 155);
  ui.compositionUpdate('wu');
  ctx.ops.length = 0;
  ui.render(ctx, tree, 260, 260);
  assert.equal(ui.getState().composingText, 'wu');
  assert.ok(ctx.ops.some(op => op[0] === 'fillText' && String(op[1]).includes('英雄wu')));
  assert.ok(ctx.ops.some(op => op[0] === 'lineTo'), 'IME composing underline must be stroked');
  ui.compositionEnd('武');
  assert.equal(inputNode.value, '英雄武');

  // Test ARIA bridge DOM mirror
  const { container } = createFakeDomDocument();
  const count = ui.syncAriaTree(container);
  assert.ok(count >= 5, `Expected semantic ARIA nodes >= 5, got ${count}`);
  const rootBridge = container.children[0];
  assert.equal(rootBridge.getAttribute('role'), 'region');
  const buttonEl = rootBridge.children.find(el => el.getAttribute('data-node-id') === 'b1');
  assert.equal(buttonEl.getAttribute('role'), 'button');
  clicked = null;
  buttonEl.onclick();
  assert.equal(clicked, 'b1');

  const sliderEl = rootBridge.children.find(el => el.getAttribute('data-node-id') === 'vol');
  assert.equal(sliderEl.getAttribute('role'), 'slider');
  assert.equal(sliderEl.getAttribute('aria-valuenow'), '0.5');

  const standaloneBridge = createCanvasAriaBridge(container);
  assert.equal(standaloneBridge.dispose(), true);
  assert.equal(ui.dispose(), undefined);
});

test('S4 InputActionRouter rebinds actions without mutating frozen context and persists to storage', () => {
  const down = new Set();
  const input = { isDown: code => down.has(code), pointer: { buttons: 0 } };
  const gameplay = defineInputContext('gameplay', {
    priority: 10,
    actions: {
      jump: 'Space',
      dash: ['ShiftLeft', 'KeyK'],
    },
  });

  const router = createInputActionRouter({ input });
  router.pushContext(gameplay);

  // Initial binding
  down.add('Space');
  router.update(1 / 60);
  assert.equal(router.isDown('jump'), true);
  down.clear();

  // Rebind jump -> KeyJ
  const rebound = router.rebindAction('gameplay', 'jump', 'KeyJ');
  assert.deepEqual(rebound, ['KeyJ']);
  assert.deepEqual(gameplay.actions.jump.keys, ['Space'], 'Frozen InputContext definition must stay untouched');
  assert.deepEqual(router.getActionBinding('gameplay', 'jump'), {
    contextName: 'gameplay',
    actionName: 'jump',
    keys: ['KeyJ'],
    overridden: true,
  });

  down.add('Space');
  router.update(1 / 60);
  assert.equal(router.isDown('jump'), false);
  down.clear();
  down.add('KeyJ');
  router.update(1 / 60);
  assert.equal(router.isDown('jump'), true);
  down.clear();

  // Save to mock Storage & restore on fresh router
  const mem = new Map();
  const storage = {
    getItem: k => mem.get(k) ?? null,
    setItem: (k, v) => { mem.set(k, v); },
  };
  assert.equal(router.saveBindings(storage), true);

  const router2 = createInputActionRouter({ input });
  router2.pushContext(gameplay);
  const loadedCount = router2.loadBindings(storage);
  assert.equal(loadedCount, 1);
  down.add('KeyJ');
  router2.update(1 / 60);
  assert.equal(router2.isDown('jump'), true);
  down.clear();

  // Reset restores default Space
  router2.resetBindings('gameplay');
  assert.equal(router2.getActionBinding('gameplay', 'jump').overridden, false);
  down.add('Space');
  router2.update(1 / 60);
  assert.equal(router2.isDown('jump'), true);
});
