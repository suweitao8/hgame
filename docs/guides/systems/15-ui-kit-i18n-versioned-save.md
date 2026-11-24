# 4.15 Commercial UI Kit (`ui/`) & Versioned Tamper-Proof Save (`storage.js`)

> Zero-framework UI stack, 10k-row virtualizer, plural/fallback i18n, and FNV-1a checksum-verified schema migrations.

- **Files**: `ui/panel-stack.js`, `ui/virtual-list.js`, `ui/i18n.js`, `platform/storage.js`
- **When**: Multi-modal menus/backpacks/localization/persistent saves.

```js
import { createPanelStack, createVirtualList, createI18n, createVersionedStore } from '../vendor/hgame/index.js';

const stack = createPanelStack({
  panels: {
    shop: { modal: true, exclusive: true, closeOnCancel: true, closeOnBackdrop: true },
  },
});
stack.push('shop');
stack.handleCancel(); // closes top panel cleanly

const list = createVirtualList({ itemHeight: 64, viewportHeight: 480, columns: 4 });
list.setCount(10000);
list.scrollTo(scrollTop);
const win = list.getVisibleRange(); // { startIndex, endIndex, offsetY, totalHeight, scrollTop }

const i18n = createI18n({ locale: 'zh', fallbackLocale: 'en', messages: { zh: { hp: '♥ {v}' }, en: { hp: 'HP {v}' } } });
const label = i18n.t('hp', { v: 120 });

const saves = createVersionedStore({
  gameId: 'my-rpg',
  schemaVersion: 2,
  salt: 'build-v1',
  migrations: { 1: old => ({ ...old, gold: (old.coins ?? 0) * 10 }) },
});
const res = saves.load('slot1', { hp: 100, gold: 0 }); // auto-migrates + recovers .bak on tamper
```

## Canvas layout and widgets (`ui/flex-layout.js`, `ui/canvas-widgets.js`)

`computeFlexLayout` turns a declarative tree into pixel rectangles. `createCanvasUiRenderer` draws the same tree (panels, buttons, labels, text inputs, sliders, scroll views) and hit-tests it by child index. Verified in a real browser at 960x540 and 360x800 by `node tests/browser-ui-layout.mjs`.

```js
import { createCanvasUiRenderer } from '../vendor/hgame/index.js';

const ui = createCanvasUiRenderer({ dpr: window.devicePixelRatio });
ui.render(ctx, {
  id: 'root', direction: 'column', gap: 10, padding: 16,
  children: [
    // `flexWrap` moves children that do not fit onto a new line; `alignContent` places the lines.
    { id: 'chips', direction: 'row', flexWrap: 'wrap', gap: 8, alignContent: 'start', height: 88,
      children: chips.map(chip => ({ id: chip.id, type: 'button', width: 120, height: 40, text: chip.name, onClick: chip.use })) },
    // `display: 'grid'` shares the box between equal cells across `columns` columns.
    { id: 'bag', display: 'grid', columns: 4, gap: 8, height: 360, children: slots },
    // A wrapped label keeps as many lines as its box holds, or `maxLines`; the last one ends with "…".
    { id: 'lore', type: 'label', wrap: true, maxLines: 3, height: 60, fontSize: 13, lineHeight: 1.4, text: lore },
  ],
}, 360, 800);
```

- Button text shrinks down to `minFontSize` (default `10`) and is then shortened with `…`. Pass `autoFit: false` to keep the font size.
- A wrapped label takes `textAlign`, `lineHeight` (a multiple of the font size) and `verticalAlign` (`top`, `middle`, `bottom`).
- A grid child fills its cell unless it has its own `width` / `height`; `justifyItems` / `alignItems` then place it in the cell. `rowHeight` fixes the row size instead of sharing the box.

## Pitfalls
- A readable backend remains in use when full or read-only; explicit `save()`/`set()` calls throw its write error. Automatic migration/recovery writeback failures return the valid data with `writebackError` on the successful `load()` result. Check `'writebackError' in res` to distinguish failed writeback (the thrown value can be anything); the next load retries. `get()` still returns the recovered value, so use `load()` when writeback status matters. Absent/unreadable storage still uses the documented isolated memory fallback.
- Save values follow JSON rules: dates become strings, undefined object fields disappear, and non-finite numbers become `null`. Checksums cover that stored representation. `save()` returns the original input. The initial migration load returns the migrator's result; subsequent loads read the persisted JSON representation. Cycles, BigInt, and top-level values omitted by JSON (such as `undefined`) throw before changing either save slot.
- Always pass positive integer `schemaVersion` and pure `migrations[v]` functions (`v -> v + 1`) so legacy saves never crash.
- UI projects (`tickHz: 0`) must subscribe/trigger render via `app.dispatch(...)` rather than polling DOM inside a RAF loop.
- Canvas layout has no content sizing. A child without a main-axis size is `0` until it grows, and a container never grows to fit its children: give a wrapped row the height its lines need (lay it out once in a tall box to measure it) and set `rowHeight` on a grid that sits in a scroll view. Do not give children of a scroll view `flexGrow`.
- A wrapped child without its own cross size is only sized when its line stretches (the default `alignContent: 'stretch'`). With `start`, `center` or `end` it takes the largest explicit size of its line.
- A child that names its own `width` / `height` always reports that size: `flexGrow`, `flexShrink` and `min` / `max` move where the siblings go but do not resize such a child. Use `minWidth` / `minHeight` as the base size of a child that should grow into its space.
- Anti-Bloat UI rules apply to all panels and localized labels: never use `PanelStack` for tutorial/rules/confirm modals, keep HUD labels to icon+number or `2–4` hanzi, and verify with `npm run check:ui -- --dir <game-dir>` + `npm run snapshot -- <game-dir> --check-ui`.
