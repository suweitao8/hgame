# 4.15 Commercial UI Kit (`ui/`) & Versioned Tamper-Proof Save (`storage.js`)

> Zero-framework UI stack, 10k-row virtualizer, plural/fallback i18n, and FNV-1a checksum-verified schema migrations.

- **Files**: `ui/panel-stack.js`, `ui/virtual-list.js`, `ui/i18n.js`, `platform/storage.js`
- **When**: Multi-modal menus/backpacks/localization/persistent saves.

```js
import { createPanelStack, createVirtualList, createI18n, createVersionedStore } from '../vendor/hgame/index.js';

const stack = createPanelStack();
stack.push({ id: 'shop', modal: true, exclusive: true, onCancel: () => stack.pop() });
stack.handleCancel(); // closes top modal cleanly

const list = createVirtualList({ totalCount: 10000, itemSize: 64, viewportSize: 480, columns: 4 });
const win = list.computeRange(scrollTop); // { startIndex, endIndex, offsetBefore, totalHeight }

const i18n = createI18n({ locale: 'zh', fallbackLocale: 'en', messages: { zh: { hp: '生命 {v}' }, en: { hp: 'HP {v}' } } });
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
- Save values follow JSON rules: dates become strings, undefined object fields disappear, and non-finite numbers become `null`. Checksums cover that stored representation. `save()` returns the original input. The initial migration load returns the migrator's result; subsequent loads read the persisted JSON representation. Cycles, BigInt, and top-level values omitted by JSON (such as `undefined`) throw before changing either save slot.
- Always pass positive integer `schemaVersion` and pure `migrations[v]` functions (`v -> v + 1`) so legacy saves never crash.
- UI projects (`tickHz: 0`) must subscribe/trigger render via `app.dispatch(...)` rather than polling DOM inside a RAF loop.
