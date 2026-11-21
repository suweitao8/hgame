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

## Pitfalls
- A readable backend remains in use when full or read-only; explicit `save()`/`set()` calls throw its write error. Automatic migration/recovery writeback failures return the valid data with `writebackError` on the successful `load()` result. Check `'writebackError' in res` to distinguish failed writeback (the thrown value can be anything); the next load retries. `get()` still returns the recovered value, so use `load()` when writeback status matters. Absent/unreadable storage still uses the documented isolated memory fallback.
- Save values follow JSON rules: dates become strings, undefined object fields disappear, and non-finite numbers become `null`. Checksums cover that stored representation. `save()` returns the original input. The initial migration load returns the migrator's result; subsequent loads read the persisted JSON representation. Cycles, BigInt, and top-level values omitted by JSON (such as `undefined`) throw before changing either save slot.
- Always pass positive integer `schemaVersion` and pure `migrations[v]` functions (`v -> v + 1`) so legacy saves never crash.
- UI projects (`tickHz: 0`) must subscribe/trigger render via `app.dispatch(...)` rather than polling DOM inside a RAF loop.
- Anti-Bloat UI rules apply to all panels and localized labels: never use `PanelStack` for tutorial/rules/confirm modals, keep HUD labels to icon+number or `2–4` hanzi, and verify with `npm run check:ui -- --dir <game-dir>` + `npm run snapshot -- <game-dir> --check-ui`.
