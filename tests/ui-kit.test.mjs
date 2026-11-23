import test from 'node:test';
import assert from 'node:assert/strict';
import { HGame, createPanelStack, createVirtualList, createI18n } from '../assets/runtime/index.js';

test('createPanelStack manages modal hierarchy, exclusive replacement, cancel blocking, and transitions', () => {
  const events = [];
  const ui = createPanelStack({
    panels: {
      hud: { pinned: true, closeOnCancel: false, transitionMs: 0 },
      shop: { modal: true, transitionMs: 200, onEnter: (e) => events.push(`enter:${e.id}`), onExit: (e) => events.push(`exit:${e.id}`) },
      confirm: { modal: true, closeOnCancel: true, transitionMs: 100 },
      loading: { exclusive: true, closeOnCancel: false, transitionMs: 0 },
    },
  });

  assert.equal(typeof HGame.createPanelStack, 'function');
  ui.push('hud');
  assert.equal(ui.isOpen('hud'), true);
  assert.equal(ui.hasModal(), false);

  ui.push('shop', { tab: 'weapons' });
  assert.equal(ui.hasModal(), true);
  assert.equal(ui.top().id, 'shop');
  assert.equal(ui.top().phase, 'entering');

  ui.update(0.1);
  assert.equal(ui.getEntry('shop').alpha, 0.5);
  ui.update(0.15);
  assert.equal(ui.getEntry('shop').phase, 'open');

  ui.push('confirm', { cost: 500 });
  assert.equal(ui.top().id, 'confirm');
  assert.equal(ui.handleCancel(), true);
  assert.equal(ui.top().id, 'shop');

  // Pinned hud survives exclusive loading panel while shop exits smoothly.
  ui.push('loading');
  assert.equal(ui.isOpen('hud'), true);
  assert.equal(ui.isOpen('shop'), false);
  assert.equal(ui.top().id, 'loading');
  assert.equal(ui.handleCancel(), false); // loading has closeOnCancel: false

  ui.pop();
  assert.equal(ui.top().id, 'hud');
  assert.equal(ui.pop(), null); // pinned hud refuses non-forced pop
  assert.deepEqual(events, ['enter:shop', 'exit:shop']);
});

test('createVirtualList computes fixed-grid and variable-height visible windows without heap churn', () => {
  assert.equal(typeof HGame.createVirtualList, 'function');

  // Fixed-height 4-column inventory grid of 10,000 items
  const grid = createVirtualList({ itemHeight: 64, gap: 8, columns: 4, viewportHeight: 220, overscan: 1 });
  grid.setCount(10000);
  // 2500 rows * 64 + 2499 * 8 = 160000 + 19992 = 179992
  assert.equal(grid.getTotalHeight(), 179992);

  const out = { startIndex: -1, endIndex: -1, startRow: -1, endRow: -1, offsetY: -1, totalHeight: -1, scrollTop: -1 };
  const r0 = grid.getVisibleRange(out);
  assert.equal(r0, out);
  assert.equal(r0.startIndex, 0);
  // Visible rows at scroll=0..220 with stride 72 are rows 0..3; +1 overscan -> rows 0..5 -> endIndex = 20
  assert.equal(r0.endRow, 5);
  assert.equal(r0.endIndex, 20);

  grid.scrollToIndex(500, 'start'); // row 125 -> 125 * 72 = 9000
  const rMid = grid.getVisibleRange(out);
  assert.equal(rMid.scrollTop, 9000);
  assert.equal(rMid.startRow, 124); // overscan 1

  // Variable-height single-column quest/combat log
  const varList = createVirtualList({
    viewportHeight: 100,
    overscan: 0,
    getItemHeight: (i) => (i % 2 === 0 ? 30 : 60),
  });
  varList.setItems(['a', 'b', 'c', 'd', 'e']); // 30+60+30+60+30 = 210
  assert.equal(varList.getTotalHeight(), 210);
  varList.scrollTo(95);
  const vr = varList.getVisibleRange();
  assert.equal(vr.startIndex, 2);
  assert.equal(vr.endIndex, 5);
});

test('createI18n resolves nested keys, interpolation, plural rules, fallback locale, and notifications', () => {
  assert.equal(typeof HGame.createI18n, 'function');
  const i18n = createI18n({
    locale: 'zh-CN',
    fallbackLocale: 'en',
    messages: {
      en: {
        ui: { play: 'Play', score: 'Score: {value}' },
        loot: {
          gems_zero: 'No gems',
          gems_one: '1 gem',
          gems_other: '{count} gems',
        },
        onlyEn: 'English Fallback',
      },
      'zh-CN': {
        ui: { play: '开始游戏', score: '得分：{value}' },
        loot: {
          gems_zero: '没有宝石',
          gems_one: '1 颗宝石',
          gems_other: '{count} 颗宝石',
        },
      },
    },
  });

  const changes = [];
  const unsub = i18n.subscribe((loc) => changes.push(loc));
  assert.equal(i18n.t('ui.play'), '开始游戏');
  assert.equal(i18n.t('ui.score', { value: 999 }), '得分：999');
  assert.equal(i18n.t('loot.gems', { count: 0 }), '没有宝石');
  assert.equal(i18n.t('loot.gems', { count: 1 }), '1 颗宝石');
  assert.equal(i18n.t('loot.gems', { count: 12 }), '12 颗宝石');
  assert.equal(i18n.t('onlyEn'), 'English Fallback');
  assert.equal(i18n.t('missing.key'), 'missing.key');

  i18n.setLocale('en');
  assert.equal(i18n.t('ui.play'), 'Play');
  assert.deepEqual(changes, ['en']);
  unsub();
});
