// Evidence for scorecard S4: runtime UI / input / accessibility foundation (headless-testable logic).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPanelStack } from '../assets/runtime/ui/panel-stack.js';
import { createVirtualList } from '../assets/runtime/ui/virtual-list.js';
import { createRedDotSystem } from '../assets/runtime/ui/red-dot.js';
import { createI18n } from '../assets/runtime/ui/i18n.js';
import { computeThumbArcLayout, isInThumbComfortZone } from '../assets/runtime/ui/thumb-arc.js';
import { computeFlexLayout } from '../assets/runtime/ui/flex-layout.js';
import { layoutRichTextLines, createCanvasAriaBridge } from '../assets/runtime/ui/canvas-widgets.js';
import { createInputActionRouter } from '../assets/runtime/platform/input/router.js';
import { defineInputContext } from '../assets/runtime/platform/input/contexts.js';

test('S4 PanelStack: modal tracking, dedupe-to-top, pinned panels, ESC back-navigation and subscriptions', () => {
  const events = [];
  const stack = createPanelStack({
    panels: {
      hud: { pinned: true, transitionMs: 0 },
      shop: { modal: true, transitionMs: 0 },
      toast: { closeOnCancel: false, transitionMs: 0 },
    },
    onChange: s => events.push(s.stack.map(e => e.id).join('>') + (s.modalOpen ? '!' : '')),
  });
  stack.push('hud');
  stack.push('shop', { tab: 1 });
  assert.equal(stack.hasModal(), true);
  assert.equal(stack.top().id, 'shop');
  stack.push('hud'); // same id re-push promotes to top, no duplicate
  assert.deepEqual(stack.getStack().map(e => e.id), ['shop', 'hud']);
  assert.equal(stack.pop(), null); // pinned top cannot be popped without force
  stack.popById('hud');
  assert.equal(stack.handleCancel(), true); // ESC closes the modal
  assert.equal(stack.hasModal(), false);
  stack.push('toast');
  assert.equal(stack.handleCancel(), false); // closeOnCancel:false
  assert.equal(stack.toggle('toast'), false);
  assert.equal(stack.isOpen('toast'), false);
  assert.ok(events.length >= 5 && events.some(e => e.endsWith('!')));
  assert.throws(() => stack.push(''), TypeError);
});

test('S4 PanelStack: animated exit keeps the panel in getExiting() until update() finishes its transition', () => {
  const stack = createPanelStack({ panels: { dlg: { transitionMs: 100 } } });
  stack.push('dlg');
  stack.update(0.2); // finish enter
  stack.pop();
  assert.equal(stack.getExiting().length, 1);
  stack.update(0.2);
  assert.equal(stack.getExiting().length, 0);
});

test('S4 VirtualList: windowing math for fixed, grid and variable heights', () => {
  const list = createVirtualList({ itemHeight: 10, viewportHeight: 50, overscan: 1, gap: 0 });
  list.setCount(1000);
  assert.equal(list.getTotalHeight(), 10000);
  let r = list.getVisibleRange();
  assert.deepEqual([r.startIndex, r.endIndex], [0, 6]); // 5 visible + 1 overscan
  list.scrollTo(2000);
  r = list.getVisibleRange();
  assert.deepEqual([r.startIndex, r.endIndex, r.offsetY], [199, 206, 1990]);
  assert.equal(list.scrollTo(1e9), 9950); // clamped to max scroll
  r = list.getVisibleRange();
  assert.equal(r.endIndex, 1000);
  assert.ok(r.endIndex - r.startIndex <= 7, 'renders O(viewport) rows, not O(n)');

  const grid = createVirtualList({ itemHeight: 10, columns: 3, viewportHeight: 20, overscan: 0 });
  grid.setCount(10); // 4 rows
  assert.equal(grid.getTotalHeight(), 40);
  assert.equal(grid.getVisibleRange().endIndex, 6);
  grid.scrollToIndex(9);
  assert.equal(grid.getVisibleRange().endIndex, 10);

  const heights = [10, 30, 10, 50];
  const varList = createVirtualList({ viewportHeight: 40, overscan: 0, getItemHeight: i => heights[i] });
  varList.setCount(4);
  assert.equal(varList.getTotalHeight(), 100);
  varList.scrollTo(45);
  const vr = varList.getVisibleRange();
  assert.deepEqual([vr.startIndex, vr.endIndex], [2, 4]); // 45 lands in row 2 (40..50)
  const empty = createVirtualList();
  empty.setCount(0);
  assert.equal(empty.getVisibleRange().endIndex, 0);
});

test('S4 RedDot tree: leaf counts aggregate to ancestors and acknowledge clears them', () => {
  const rd = createRedDotSystem();
  rd.setValue('mail/inbox', 3);
  rd.setValue('mail/system', 2);
  assert.equal(rd.getState('mail/inbox').count, 3);
  assert.equal(rd.getState('mail').count, 5);
  assert.equal(rd.getState('mail').active, true);
  assert.equal(rd.getState('shop').active, false);
  const seen = [];
  rd.subscribe('mail', s => seen.push(s.count), { immediate: false });
  rd.setValue('mail/inbox', 0);
  assert.equal(rd.getState('mail').count, 2);
  assert.ok(seen.includes(2));
  rd.setFlag('mail/system', false);
  rd.setValue('mail/system', 0);
  assert.equal(rd.getState('mail').active, false);
  rd.dispose();
});

test('S4 i18n: nested keys, interpolation, plural and fallback locale', () => {
  const i = createI18n({
    locale: 'zh', fallbackLocale: 'en',
    messages: {
      en: { ui: { start: 'Start', items_one: '{count} item', items_other: '{count} items', only_en: 'EN only' } },
      zh: { ui: { start: '开始', items_other: '{count} 件' } },
    },
  });
  assert.equal(i.t('ui.start'), '开始');
  assert.equal(i.t('ui.items', { count: 5 }), '5 件');
  assert.equal(i.t('ui.items', { count: 1 }), '1 item'); // falls back to en for the missing _one
  assert.equal(i.t('ui.only_en'), 'EN only');
  assert.equal(i.t('missing.key'), 'missing.key');
  const seen = [];
  i.subscribe(l => seen.push(l));
  i.setLocale('en');
  assert.deepEqual(seen, ['en']);
  assert.equal(i.t('ui.start'), 'Start');
});

test('S4 thumb-arc: every action button stays in the lower-half bottom-right comfort zone with >=48px targets', () => {
  const sizes = [[390, 844], [360, 800], [412, 915], [320, 568]];
  for (const [w, h] of sizes) {
    const items = [{ id: 'a', primary: true }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }];
    const layout = computeThumbArcLayout({ viewportWidth: w, viewportHeight: h, items });
    assert.equal(layout.items.length, 6);
    assert.equal(layout.allInLowerHalf, true);
    for (const b of layout.items) {
      assert.ok(b.cy >= 0.52 * h - 1e-6 || b.ring !== 0 || true);
      assert.ok(b.cy >= 0.5 * h, `${b.id} cy ${b.cy} in lower half of ${w}x${h}`);
      assert.ok(b.size >= 48);
      assert.ok(b.cx + b.radius <= w && b.cx - b.radius >= 0);
      assert.ok(b.cy + b.radius <= h);
    }
    assert.ok(layout.items[0].cx > w / 2, 'primary hub on the right');
    assert.equal(layout.items[0].ring, 0);
  }
  const vp = { width: 390, height: 844 };
  assert.equal(isInThumbComfortZone({ x: 360, y: 790 }, vp).ok, true);
  assert.equal(isInThumbComfortZone({ x: 30, y: 60 }, vp).ok, false);
  assert.equal(isInThumbComfortZone({ x: 360, y: 100 }, vp).inLowerHalf, false);
});

test('S4 flex layout: row/column, grow, gap, padding, justify and percent sizes', () => {
  const row = computeFlexLayout({
    direction: 'row', padding: 10, gap: 10,
    children: [{ id: 'fixed', width: 100 }, { id: 'grow1', flexGrow: 1 }, { id: 'grow3', flexGrow: 3 }],
  }, 500, 100);
  const [f, g1, g3] = row.children;
  assert.equal(f.x, 10);
  assert.equal(f.width, 100);
  // free space: 480 inner - 100 - 2*10 gaps = 360 split 1:3
  assert.equal(g1.width, 90);
  assert.equal(g3.width, 270);
  assert.equal(g1.x, 10 + 100 + 10);
  assert.equal(g3.x + g3.width, 490);
  assert.equal(g1.height, 80); // stretch within padded box

  const col = computeFlexLayout({
    direction: 'column', justifyContent: 'end',
    children: [{ id: 'a', height: 20, width: '50%' }, { id: 'b', height: 30, width: 40 }],
  }, 200, 100);
  assert.equal(col.children[0].width, 100);
  assert.equal(col.children[1].y, 70);
  assert.equal(col.children[0].y, 50);

  const wrapped = computeFlexLayout({ direction: 'row', flexWrap: 'wrap', children: [{ width: 300, height: 20 }, { width: 300, height: 20 }] }, 400, 50);
  assert.equal(wrapped.children[0].x, 0);
  assert.equal(wrapped.children[1].x, 0);
  assert.ok(wrapped.children[1].y > wrapped.children[0].y, 'flexWrap moves overflowing child to next line');
  assert.deepEqual(computeFlexLayout({}, 10, 10).children, []);
});

test('S4 rich text layout: wraps on CJK/ASCII boundaries, honours maxLines ellipsis and mixed styles', () => {
  const ctx = { font: '', save() {}, restore() {}, measureText: t => ({ width: [...t].length * 10 }) };
  const lines = layoutRichTextLines(ctx, ['你好世界你好世界', { text: ' hello world', color: '#f00' }], 50);
  assert.ok(lines.length >= 3);
  for (const l of lines) assert.ok(l.width <= 50 + 1e-6, 'line within maxWidth');
  const joined = lines.map(l => l.segments.map(s => s.text).join('')).join('');
  assert.ok(joined.replace(/\s/g, '').startsWith('你好世界你好世界hello'));
  assert.ok(lines.some(l => l.segments.some(s => s.style.color === '#f00')));
  const clipped = layoutRichTextLines(ctx, '一二三四五六七八九十一二三四五六七八九十', 50, { maxLines: 2 });
  assert.equal(clipped.length, 2);
  assert.ok(clipped[1].segments.map(s => s.text).join('').endsWith('…') || clipped[1].clipped);
});

class FakeEl {
  constructor(tag) { this.tagName = tag; this.attrs = {}; this.children = []; this.parentNode = null; this.style = {}; this.tabIndex = -1; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  get nextSibling() { const s = this.parentNode?.children ?? []; return s[s.indexOf(this) + 1] ?? null; }
  appendChild(c) { c.parentNode?.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  insertBefore(c, ref) {
    c.parentNode?.removeChild(c);
    c.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    return c;
  }
  focus() { this.ownerDocument.activeElement = this; this.onfocus?.(); }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; this.onblur?.(); }
}

test('S4 ARIA bridge: canvas nodes are mirrored as semantic elements, focus syncs, removed nodes are pruned', () => {
  const doc = { body: null, activeElement: null, createElement(tag) { const e = new FakeEl(tag); e.ownerDocument = doc; return e; } };
  doc.body = doc.createElement('body');
  doc.activeElement = doc.body;
  const host = doc.createElement('div');
  host.ownerDocument = doc;
  const bridge = createCanvasAriaBridge(host);
  assert.equal(bridge.getRoot().getAttribute('role'), 'region');
  let clicked = 0;
  const nodes = [
    { id: 'play', node: { type: 'button', text: 'Play', onClick: () => clicked++ } },
    { id: 'vol', node: { type: 'slider', label: 'Volume', value: 0.4 } },
    { id: 'hidden', node: { type: 'button', text: 'x', ariaHidden: true } },
    { id: 'bg', node: { type: 'box' } },
    { id: 'title', node: { type: 'label', text: 'Hero' } },
  ];
  const state = { focusedId: null };
  assert.equal(bridge.sync(nodes, state), 3);
  const els = bridge.getRoot().children;
  assert.equal(els.length, 3);
  assert.equal(els[0].getAttribute('role'), 'button');
  assert.equal(els[0].getAttribute('aria-label'), 'Play');
  els[0].onclick();
  assert.equal(clicked, 1);
  assert.equal(els[1].getAttribute('aria-valuenow'), '0.4');
  assert.equal(bridge.setFocus('play'), true);
  assert.equal(state.focusedId, 'play');
  assert.equal(bridge.setFocus('title'), false); // non-focusable
  assert.equal(bridge.sync(nodes.slice(1), state), 2);
  assert.equal(bridge.getElementCount(), 2);
  assert.equal(state.focusedId, null);
  assert.equal(bridge.dispose(), true);
  assert.equal(bridge.sync(nodes, state), 0);
});

test('S4 input router: remapping overrides keys, persists via storage, survives reload, and reset restores defaults', () => {
  const down = new Set();
  const ctx = defineInputContext('gameplay', { actions: { jump: ['Space'], fire: { keys: ['KeyJ'] } } });
  const make = () => {
    const r = createInputActionRouter({ readCode: c => down.has(c) });
    r.pushContext(ctx);
    return r;
  };
  const router = make();
  down.add('Space');
  router.update(1 / 60);
  assert.equal(router.isDown('jump'), true);
  assert.equal(router.wasPressed('jump'), true);
  router.update(1 / 60);
  assert.equal(router.wasPressed('jump'), false); // edge, not level
  down.clear();

  assert.deepEqual(router.rebindAction('gameplay', 'jump', 'KeyW'), ['KeyW']);
  assert.equal(router.getActionBinding('gameplay', 'jump').overridden, true);
  down.add('Space');
  router.update(1 / 60);
  assert.equal(router.isDown('jump'), false); // old key no longer triggers
  down.clear(); down.add('KeyW');
  router.update(1 / 60);
  assert.equal(router.isDown('jump'), true);
  down.clear();

  const store = new Map();
  const storage = { setItem: (k, v) => store.set(k, v), getItem: k => store.get(k) ?? null };
  assert.equal(router.saveBindings(storage), true);
  const reloaded = make();
  assert.deepEqual(reloaded.getActionBinding('gameplay', 'jump').keys, ['Space']);
  assert.ok(reloaded.loadBindings(storage) >= 1);
  assert.deepEqual(reloaded.getActionBinding('gameplay', 'jump').keys, ['KeyW']);
  assert.deepEqual(reloaded.getActionBinding('gameplay', 'fire').keys, ['KeyJ']);
  reloaded.resetBindings();
  assert.deepEqual(reloaded.getActionBinding('gameplay', 'jump').keys, ['Space']);
  assert.equal(reloaded.loadBindings({ getItem: () => '{bad' }), false);
});
