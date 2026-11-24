import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFlexLayout, createCanvasUiRenderer, layoutRichTextLines } from '../assets/runtime/index.js';

const near = (value, expected, tolerance = 1e-6) => {
  assert.ok(Math.abs(value - expected) <= tolerance, `${value} should be within ${tolerance} of ${expected}`);
};

/** Records drawn text with the font it was drawn in; ASCII measures 7px and CJK 14px at a 14px font. */
function createFakeCanvasCtx() {
  const ops = [];
  return {
    ops,
    font: '600 14px system-ui, sans-serif',
    textAlign: 'left',
    textBaseline: 'middle',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'round',
    save() { ops.push(['save']); },
    restore() { ops.push(['restore']); },
    beginPath() {},
    rect() {},
    roundRect() {},
    clip() { ops.push(['clip']); },
    translate() {},
    fill() { ops.push(['fill']); },
    stroke() {},
    moveTo() {},
    lineTo() {},
    strokeText() {},
    fillText(text, x, y) { ops.push(['fillText', text, x, y, this.font, this.fillStyle, this.textAlign]); },
    measureText(text) {
      const px = parseFloat(String(this.font).split(' ')[1]) || 14;
      let width = 0;
      for (const ch of String(text)) width += (ch.charCodeAt(0) > 0x255 ? 14 : 7) * (px / 14);
      return { width };
    },
  };
}

const fontSizeOf = (font) => Number(String(font).split(' ')[1].replace('px', ''));
const drawnText = (ctx) => ctx.ops.filter(op => op[0] === 'fillText').map(([, text, x, y, font]) => ({ text, x, y, fontSize: fontSizeOf(font) }));
const rectsOf = (rect) => rect.children.map(c => [c.id, c.x, c.y, c.width, c.height]);

function wrapTree(overrides = {}) {
  return {
    id: 'root',
    direction: 'row',
    flexWrap: 'wrap',
    gap: 10,
    width: 300,
    height: 200,
    ...overrides,
    children: overrides.children ?? [0, 1, 2, 3, 4].map(i => ({ id: `c${i}`, width: 100, height: 40 })),
  };
}

test('P0-3 flexWrap: children that do not fit move to a new line in source order', () => {
  const rect = computeFlexLayout(wrapTree({ alignContent: 'start' }), 300, 200);
  assert.deepEqual(rectsOf(rect), [
    ['c0', 0, 0, 100, 40], ['c1', 110, 0, 100, 40],
    ['c2', 0, 50, 100, 40], ['c3', 110, 50, 100, 40],
    ['c4', 0, 100, 100, 40],
  ]);

  // Without the opt-in the same children stay on one line.
  const { flexWrap, ...plain } = wrapTree({ children: [0, 1, 2, 3, 4].map(i => ({ id: `c${i}`, width: 100, height: 40, flexShrink: 0 })) });
  assert.deepEqual(rectsOf(computeFlexLayout(plain, 300, 200)).map(r => r[1]), [0, 110, 220, 330, 440]);
  assert.deepEqual(rectsOf(computeFlexLayout({ ...plain, flexWrap: 'nowrap' }, 300, 200)).map(r => r[1]), [0, 110, 220, 330, 440]);
});

test('P0-3 flexWrap: a single wrapped line matches the unwrapped layout', () => {
  const children = [
    { id: 'a', width: 80, height: 24 },
    { id: 'b', flexGrow: 1, minHeight: 30 },
    { id: 'c', width: '30%', maxHeight: 50 },
    { id: 'd', width: 60 },
  ];
  const bases = [
    { direction: 'row', padding: 8, gap: 4 },
    { direction: 'row', padding: [4, 12], alignItems: 'center', gap: 6 },
    { direction: 'row', padding: { top: 2, left: 6, right: 3, bottom: 5 }, alignItems: 'end', justifyContent: 'center' },
    { direction: 'row', alignItems: 'start', justifyContent: 'space-between' },
    { direction: 'column', alignItems: 'center', justifyContent: 'space-around', gap: 2 },
    { direction: 'column', alignItems: 'end', justifyContent: 'end', padding: 5 },
  ];
  for (const base of bases) {
    const plain = computeFlexLayout({ ...base, width: 400, height: 120, children }, 400, 120);
    for (const alignContent of [undefined, 'stretch']) {
      const wrapped = computeFlexLayout({ ...base, width: 400, height: 120, flexWrap: 'wrap', alignContent, children }, 400, 120);
      assert.deepEqual(wrapped, plain, JSON.stringify([base, alignContent]));
    }
  }
});

test('P0-3 flexWrap: alignContent places the lines inside the container', () => {
  const expected = {
    start: [0, 50, 100],
    center: [30, 80, 130],
    end: [60, 110, 160],
    'space-between': [0, 80, 160],
    'space-around': [10, 80, 150],
  };
  for (const [alignContent, tops] of Object.entries(expected)) {
    const rect = computeFlexLayout(wrapTree({ alignContent }), 300, 200);
    // Five chips make three lines, two chips each.
    assert.deepEqual([...new Set(rect.children.map(c => c.y))], tops, alignContent);
    for (const child of rect.children) assert.ok(child.y + child.height <= 200 + 1e-6, `${alignContent} keeps a line inside the box`);
  }

  // The default gives every line an equal share of the spare height.
  const stretched = computeFlexLayout(wrapTree());
  assert.deepEqual([...new Set(stretched.children.map(c => c.y))], [0, 70, 140]);
  for (const child of stretched.children) assert.ok(child.y + child.height <= 200 + 1e-6);
});

test('P0-3 flexWrap: alignItems works inside each line and justifyContent on each line', () => {
  const rect = computeFlexLayout(wrapTree({
    alignContent: 'start',
    alignItems: 'center',
    justifyContent: 'center',
    children: [
      { id: 'tall', width: 100, height: 60 },
      { id: 'short', width: 100, height: 20 },
      { id: 'last', width: 100, height: 20 },
    ],
  }), 300, 200);
  // Line 1 is 60px tall, so the 20px child sits 20px below its top; its 90px of spare width is split.
  assert.deepEqual(rectsOf(rect), [
    ['tall', 45, 0, 100, 60],
    ['short', 155, 20, 100, 20],
    ['last', 100, 70, 100, 20],
  ]);
});

test('P0-3 flexWrap: flexGrow only shares the space of its own line', () => {
  // `minWidth` acts as the base size, so a growing child reports the size it grew to.
  const grower = (id, flexGrow) => ({ id, flexGrow, minWidth: 100, height: 40 });
  const rect = computeFlexLayout(wrapTree({ alignContent: 'start', children: [grower('g1', 1), grower('g2', 3), grower('solo', 1)] }), 300, 200);
  // The first line has 90px to spare, split 1:3; the second line leaves the whole width to one child.
  assert.deepEqual(rectsOf(rect), [
    ['g1', 0, 0, 122.5, 40],
    ['g2', 132.5, 0, 167.5, 40],
    ['solo', 0, 50, 300, 40],
  ]);
});

test('P0-3 flexWrap: an item wider than a line sits alone and a column wraps into columns', () => {
  const wide = computeFlexLayout(wrapTree({
    alignContent: 'start',
    children: [{ id: 'a', width: 60, height: 40 }, { id: 'wide', width: 340, height: 40, flexShrink: 0 }, { id: 'b', width: 60, height: 40 }],
  }), 300, 200);
  assert.deepEqual(wide.children.map(c => [c.id, c.x, c.y]), [['a', 0, 0], ['wide', 0, 50], ['b', 0, 100]]);

  const column = computeFlexLayout({
    direction: 'column', flexWrap: 'wrap', gap: 8, width: 240, height: 100, alignContent: 'start',
    children: [1, 2, 3, 4, 5].map(n => ({ id: `r${n}`, width: 80, height: 44 })),
  }, 240, 100);
  assert.deepEqual(rectsOf(column), [
    ['r1', 0, 0, 80, 44], ['r2', 0, 52, 80, 44],
    ['r3', 88, 0, 80, 44], ['r4', 88, 52, 80, 44],
    ['r5', 176, 0, 80, 44],
  ]);
});

test('P0-3 flexWrap: a child without its own height is sized by the stretched line', () => {
  const children = [1, 2, 3, 4].map(n => ({ id: `c${n}`, width: 150 }));
  assert.deepEqual(
    rectsOf(computeFlexLayout(wrapTree({ gap: 0, children }), 300, 200)).map(r => r[4]),
    [100, 100, 100, 100],
  );
  // Lines that are only packed have no height to give, unless a sibling brings one.
  assert.deepEqual(
    rectsOf(computeFlexLayout(wrapTree({ gap: 0, alignContent: 'start', children }, ), 300, 200)).map(r => r[4]),
    [0, 0, 0, 0],
  );
  assert.deepEqual(
    rectsOf(computeFlexLayout(wrapTree({ gap: 0, alignContent: 'start', children: [{ id: 'a', width: 150, height: 60 }, { id: 'b', width: 150 }] }), 300, 200)).map(r => [r[0], r[4]]),
    [['a', 60], ['b', 60]],
  );
});

test('P0-3 flexWrap: padding offsets the lines and wrapped containers nest', () => {
  const rect = computeFlexLayout(wrapTree({
    padding: [10, 20],
    width: 340,
    alignContent: 'start',
    children: [
      { id: 'outer', width: 300, height: 90, direction: 'row', flexWrap: 'wrap', gap: 5, alignContent: 'start',
        children: [{ id: 'in1', width: 160, height: 30 }, { id: 'in2', width: 160, height: 30 }] },
      { id: 'side', width: 300, height: 90 },
    ],
  }), 340, 200);
  assert.deepEqual(rectsOf(rect), [['outer', 20, 10, 300, 90], ['side', 20, 110, 300, 90]]);
  assert.deepEqual(rectsOf(rect.children[0]), [['in1', 20, 10, 160, 30], ['in2', 20, 45, 160, 30]]);
});

test('P0-3 percentage sizes resolve once against the inner size of the parent', () => {
  // The 560x60 inner box makes the half 280x30; 10% of its width caps the second child at 56.
  const rect = computeFlexLayout({
    direction: 'row', width: 600, height: 100, padding: 20,
    children: [{ id: 'half', width: '50%', height: '50%' }, { id: 'capped', width: 100, maxWidth: '10%' }],
  }, 600, 100);
  assert.deepEqual(rectsOf(rect), [['half', 20, 20, 280, 30], ['capped', 300, 20, 56, 60]]);
});

test('P0-3 grid: children fill equal cells row by row and keep their order', () => {
  const grid = (overrides = {}, count = 7) => computeFlexLayout({
    id: 'grid', display: 'grid', columns: 3, gap: 10, width: 300, height: 200,
    ...overrides,
    children: Array.from({ length: count }, (_, i) => ({ id: `g${i}` })),
  }, 300, 200);

  const cells = rectsOf(grid());
  assert.equal(cells.length, 7);
  assert.deepEqual(cells[0], ['g0', 0, 0, 280 / 3, 60]);
  assert.deepEqual(cells[4], ['g4', 280 / 3 + 10, 70, 280 / 3, 60]);
  assert.deepEqual(cells[6], ['g6', 0, 140, 280 / 3, 60]);
  for (const [, x, y, width, height] of cells) {
    assert.ok(x >= 0 && x + width <= 300 + 1e-6 && y >= 0 && y + height <= 200 + 1e-6, 'every cell stays inside the grid');
  }

  // Three children make one row that takes the whole height.
  assert.deepEqual(rectsOf(grid({}, 3)).map(r => r[4]), [200, 200, 200]);
  // Four columns of (300 - 3 gaps) / 4 is the default.
  assert.deepEqual(rectsOf(grid({ columns: undefined }, 4)).map(r => r[3]), [67.5, 67.5, 67.5, 67.5]);
});

test('P0-3 grid: padding, justifyItems and alignItems place children that have their own size', () => {
  const sized = Array.from({ length: 2 }, (_, i) => ({ id: `s${i}`, width: 40, height: 20 }));
  const cell = (overrides) => rectsOf(computeFlexLayout({
    display: 'grid', columns: 2, gap: 20, width: 300, height: 100, padding: [10, 20], ...overrides, children: sized,
  }, 300, 100));

  // The padding leaves 260x80, so each of the two cells is 120x80.
  assert.deepEqual(cell({ justifyItems: 'center', alignItems: 'center' }), [['s0', 60, 40, 40, 20], ['s1', 200, 40, 40, 20]]);
  assert.deepEqual(cell({ justifyItems: 'end', alignItems: 'end' }), [['s0', 100, 70, 40, 20], ['s1', 240, 70, 40, 20]]);
  // Min and max limits apply to a child that fills its cell as well.
  assert.deepEqual(
    rectsOf(computeFlexLayout({ display: 'grid', columns: 2, width: 300, height: 100,
      children: [{ id: 'min', minWidth: 200 }, { id: 'max', maxWidth: 50, maxHeight: 30 }] }, 300, 100)),
    [['min', 0, 0, 200, 100], ['max', 150, 0, 50, 30]],
  );
});

test('P0-3 grid: rowHeight keeps rows fixed so a grid can scroll inside a short container', () => {
  const rect = computeFlexLayout({
    direction: 'column', width: 200, height: 80,
    children: [{
      id: 'bag', display: 'grid', columns: 3, rowHeight: 60, gap: 10,
      children: Array.from({ length: 7 }, (_, i) => ({ id: `b${i}` })),
    }],
  }, 200, 80);
  assert.deepEqual(rectsOf(rect.children[0]).map(r => [r[0], r[2]]), [['b0', 0], ['b1', 0], ['b2', 0], ['b3', 70], ['b4', 70], ['b5', 70], ['b6', 140]]);
  assert.equal(rect.children[0].children[0].width, 60);
});

test('P0-3 renderer: hit-testing and ARIA follow wrapped and grid children by index', () => {
  const ui = createCanvasUiRenderer({ dpr: 1 });
  const ctx = createFakeCanvasCtx();
  const clicks = [];
  const chip = (id) => ({ id, type: 'button', width: 120, height: 40, text: id, onClick: () => clicks.push(id) });
  const tree = {
    id: 'root', direction: 'column', gap: 12, padding: 16,
    children: [
      { id: 'chips', direction: 'row', flexWrap: 'wrap', gap: 10, alignContent: 'start', height: 90, children: ['x', 'y', 'z'].map(n => chip(n)) },
      { id: 'pad', display: 'grid', columns: 2, gap: 10, height: 110, children: ['a', 'b', 'c', 'd'].map(n => chip(n)) },
    ],
  };
  const layout = ui.render(ctx, tree, 360, 640);
  // The 328px row holds two 120px chips; the third one drops to the next line.
  assert.deepEqual([layout.children[0].children[2].x, layout.children[0].children[2].y], [16, 66]);
  // The grid cells are 159x50 and each chip keeps its own size at the cell's top-left corner.
  assert.deepEqual([layout.children[1].children[3].x, layout.children[1].children[3].y], [185, 178]);

  ui.pointerDown(50, 80);
  ui.pointerUp(50, 80);
  ui.pointerDown(300, 200);
  ui.pointerUp(300, 200);
  assert.deepEqual(clicks, ['z', 'd']);
  assert.equal(ui.hitTest(200, 30)?.id, 'y');
  // Between two chips the row container itself is hit.
  assert.equal(ui.hitTest(140, 30)?.id, 'chips');

  const { container } = createFakeDom();
  assert.equal(ui.syncAriaTree(container), 7);
  assert.deepEqual(Array.from(container.children[0].children).map(el => el.getAttribute('data-node-id')), ['x', 'y', 'z', 'a', 'b', 'c', 'd']);
  ui.dispose();
});

function createFakeDom() {
  const doc = {};
  const makeEl = (tag) => {
    const attrs = new Map();
    const el = {
      tagName: tag.toUpperCase(), style: {}, children: [], parentNode: null, tabIndex: -1, textContent: '',
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) ?? null; },
      appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
      removeChild(child) { el.children.splice(el.children.indexOf(child), 1); child.parentNode = null; return child; },
      get firstChild() { return el.children[0] ?? null; },
    };
    return el;
  };
  doc.createElement = (tag) => makeEl(tag);
  const container = makeEl('div');
  container.ownerDocument = doc;
  return { doc, container };
}

test('P0-3 button: the label shrinks to fit, then shortens with an ellipsis', () => {
  const ui = createCanvasUiRenderer({ dpr: 1 });
  const render = (src) => {
    const ctx = createFakeCanvasCtx();
    ui.render(ctx, { width: 400, height: 400, children: [{ type: 'button', y: 0, ...src }] }, 400, 400);
    return drawnText(ctx)[0];
  };

  // Fits: nothing changes.
  assert.deepEqual(render({ width: 120, height: 40, text: '开始' }), { text: '开始', x: 60, y: 20, fontSize: 14 });
  // 44px of room for 56px of text: the font scales down but stays above the floor.
  const scaled = render({ width: 60, height: 40, text: '开始游戏' });
  assert.deepEqual([scaled.text, scaled.fontSize], ['开始游戏', 11]);
  // 28px of room: the floor is reached, so the text gives way.
  assert.deepEqual([render({ width: 44, height: 40, text: '开始游戏' })].map(r => [r.text, r.fontSize]), [['开…', 10]]);
  assert.deepEqual([render({ width: 60, height: 40, text: '开始游戏', minFontSize: 12 })].map(r => [r.text, r.fontSize]), [['开始…', 12]]);
  assert.deepEqual([render({ width: 44, height: 40, text: '开始游戏', paddingX: 2 })].map(r => [r.text, r.fontSize]), [['开始游戏', 10]]);

  assert.deepEqual(render({ width: 44, height: 40, text: '开始游戏', autoFit: false }), { text: '开始游戏', x: 22, y: 20, fontSize: 14 });
  // An empty label is drawn as before.
  assert.deepEqual(render({ width: 44, height: 40, text: '' }), { text: '', x: 22, y: 20, fontSize: 14 });
  // A box barely taller than its text gives up the vertical inset.
  assert.deepEqual([render({ width: 120, height: 14, text: '开始' })].map(r => r.fontSize), [10]);
});

test('P0-3 label: wrap breaks on CJK characters and English words', () => {
  const ui = createCanvasUiRenderer({ dpr: 1 });
  const render = (src) => {
    const ctx = createFakeCanvasCtx();
    ui.render(ctx, { width: 400, height: 400, children: [{ type: 'label', x: 0, y: 0, width: 120, height: 60, fontSize: 14, wrap: true, ...src }] }, 400, 400);
    return drawnText(ctx);
  };

  // 116px holds eight 14px characters.
  const lines = render({ text: '攻击力提升百分之二十' });
  assert.deepEqual(lines.map(l => [l.text, l.x]), [['攻击力提升百分之', 2], ['二十', 2]]);
  near(lines[0].y, 20.55);
  near(lines[1].y, 39.45);

  assert.deepEqual(render({ text: 'Upgrade your sword now please' }).map(l => l.text), ['Upgrade your', 'sword now please']);
  const centered = render({ text: '攻击力提升百分之二十', textAlign: 'center' });
  assert.deepEqual(centered.map(l => l.x), [60, 60]);
  // Without `wrap` the label stays on one line, however long.
  assert.deepEqual(render({ text: '攻击力提升百分之二十', wrap: false }).map(l => l.text), ['攻击力提升百分之二十']);
});

test('P0-3 label: maxLines, lineHeight and verticalAlign control the text block', () => {
  const ui = createCanvasUiRenderer({ dpr: 1 });
  const render = (src) => {
    const ctx = createFakeCanvasCtx();
    ui.render(ctx, { width: 400, height: 400, children: [{ type: 'label', x: 0, y: 0, width: 120, height: 60, fontSize: 14, wrap: true, ...src }] }, 400, 400);
    return drawnText(ctx).map(l => ({ text: l.text, y: Math.round(l.y * 1e6) / 1e6 }));
  };
  const text = '攻击力提升百分之二十';

  // Seven characters and "…" fill the 116px line; eight alone would not leave room for it.
  assert.deepEqual(render({ text, maxLines: 1 }), [{ text: '攻击力提升百分…', y: 30 }]);
  // A 20px box holds one line only.
  assert.deepEqual(render({ text, height: 20 }).map(l => l.text), ['攻击力提升百分…']);
  assert.deepEqual(render({ text, maxLines: 1, height: 40, verticalAlign: 'top' }).map(l => l.y), [9.45]);
  assert.deepEqual(render({ text, maxLines: 1, height: 40, verticalAlign: 'bottom' }).map(l => l.y), [30.55]);
  assert.deepEqual(render({ text, lineHeight: 2 }).map(l => l.y), [16, 44]);
  assert.deepEqual(render({ text, verticalAlign: 'top' }).map(l => l.y), [9.45, 28.35]);
  assert.deepEqual(render({ text, verticalAlign: 'bottom' }).map(l => l.y), [31.65, 50.55]);
});

test('P0-3 rich text: maxLines ends the last line with an ellipsis and leaves unlimited layout unchanged', () => {
  const ctx = createFakeCanvasCtx();
  const text = '第一行内容\n第二行内容\n第三行内容\n';
  const full = layoutRichTextLines(ctx, text, 200, { fontSize: 14 });
  assert.deepEqual(full.map(l => l.segments.map(s => s.text).join('')), ['第一行内容', '第二行内容', '第三行内容']);
  assert.equal(full.some(l => l.clipped), false);

  const two = layoutRichTextLines(ctx, text, 200, { fontSize: 14, maxLines: 2 });
  assert.deepEqual(two.map(l => l.segments.map(s => s.text).join('')), ['第一行内容', '第二行内容…']);
  assert.deepEqual(two.map(l => l.clipped), [undefined, true]);
  // Trailing blanks after the last kept line are not content.
  assert.deepEqual(layoutRichTextLines(ctx, '第一行\n第二行\n\n', 200, { fontSize: 14, maxLines: 2 }).map(l => l.segments.map(s => s.text).join('')), ['第一行', '第二行']);

  // Every way a line can overflow respects the limit.
  const one = (value, width = 30) => layoutRichTextLines(ctx, value, width, { fontSize: 14, maxLines: 1 }).map(l => l.segments.map(s => s.text).join(''));
  assert.deepEqual(one('abcdefgh'), ['ab…']);
  // The ellipsis takes the place of the last word: 21px of text and 14px of "…" do not fit in 30px.
  assert.deepEqual(one('aaa bbbbbbbb'), ['aa…']);
  assert.deepEqual(one('aaa bb'), ['aa…']);
  assert.deepEqual(one('aaa bb', 200), ['aaa bb']);
  assert.deepEqual(
    layoutRichTextLines(ctx, 'abcdefghijkl', 30, { fontSize: 14, maxLines: 2 }).map(l => l.segments.map(s => s.text).join('')),
    ['abcd', 'ef…'],
  );
});
