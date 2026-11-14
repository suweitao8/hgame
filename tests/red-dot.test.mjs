import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HGame,
  RED_DOT_STYLES,
  normalizeRedDotPath,
  splitRedDotAncestors,
  computeCommercialDayKey,
  formatRedDotBadge,
  createRedDotSystem,
  createSaveStore,
} from '../assets/runtime/index.js';
import { bindRedDotDOM } from '../assets/runtime/integrations/red-dot-dom.js';

function createMemoryStorageMap() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
}

function createMockElement(tagName, ownerDocument) {
  const attrs = new Map();
  const classes = new Set();
  const listeners = new Map();
  const children = [];
  const el = {
    tagName: tagName.toUpperCase(),
    ownerDocument,
    parentNode: null,
    get parentElement() { return this.parentNode; },
    children,
    childNodes: children,
    textContent: '',
    get className() { return [...classes].join(' '); },
    set className(val) {
      classes.clear();
      for (const token of String(val).split(/\s+/).filter(Boolean)) classes.add(token);
    },
    classList: {
      add(...tokens) { for (const t of tokens) classes.add(t); },
      remove(...tokens) { for (const t of tokens) classes.delete(t); },
      contains(t) { return classes.has(t); },
      toggle(t, force) {
        if (force === undefined) {
          if (classes.has(t)) { classes.delete(t); return false; }
          classes.add(t);
          return true;
        }
        if (force) { classes.add(t); return true; }
        classes.delete(t);
        return false;
      },
    },
    hasAttribute(name) { return attrs.has(name); },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    removeAttribute(name) { attrs.delete(name); },
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = el;
      children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx !== -1) {
        children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    },
    remove() {
      if (el.parentNode) el.parentNode.removeChild(el);
    },
    addEventListener(type, fn) {
      let set = listeners.get(type);
      if (!set) { set = new Set(); listeners.set(type, set); }
      set.add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatchClick() {
      const event = { target: el, currentTarget: el };
      let curr = el;
      while (curr) {
        event.currentTarget = curr;
        const set = curr._listeners?.get('click');
        if (set) {
          for (const fn of [...set]) fn(event);
        }
        curr = curr.parentNode;
      }
    },
    _listeners: listeners,
  };
  return el;
}

function createMockDocument() {
  const doc = {
    head: null,
    createElement(tag) {
      return createMockElement(tag, doc);
    },
  };
  doc.head = createMockElement('head', doc);
  return doc;
}

test('RedDot Trie auto-hierarchy bubbles to parents and clears only after all sub-pages are resolved', () => {
  assert.equal(HGame.createRedDotSystem, createRedDotSystem);
  assert.equal(normalizeRedDotPath('Main.Bag.Equip/101'), 'Main/Bag/Equip/101');
  assert.deepEqual(splitRedDotAncestors('Main.Bag.Equip'), ['Main', 'Main/Bag', 'Main/Bag/Equip']);
  assert.throws(() => normalizeRedDotPath(''), TypeError);
  assert.throws(() => normalizeRedDotPath('/Main/Bag'), RangeError);
  assert.throws(() => normalizeRedDotPath('Main//Bag'), RangeError);
  assert.throws(() => normalizeRedDotPath('Main/Bag '), RangeError);

  const rd = createRedDotSystem();
  rd.markUnread('Camp/Ration/Fuel');
  rd.markUnread('Camp/Expedition/Target');
  rd.setFlag('Camp/Event/Pending', true);

  // Parent tab aggregates 3 sub-dots
  assert.equal(rd.isActive('Camp'), true);
  assert.equal(rd.getCount('Camp'), 3);
  assert.equal(rd.isActive('Camp/Ration'), true);

  // Non-recursive acknowledge on parent must NOT prematurely extinguish child dots
  assert.equal(rd.acknowledge('Camp'), 0);
  assert.equal(rd.getCount('Camp'), 3);

  // Clearing only one sub-item keeps Camp lit with 2 left
  rd.acknowledge('Camp/Ration/Fuel');
  assert.equal(rd.isActive('Camp/Ration'), false);
  assert.equal(rd.isActive('Camp'), true);
  assert.equal(rd.getCount('Camp'), 2);

  // Recursive "clear-all" acknowledges remaining unread/daily leaves, while condition flag stays lit
  const acked = rd.acknowledge('Camp', { recursive: true });
  assert.equal(acked, 1);
  assert.equal(rd.isActive('Camp/Expedition'), false);
  assert.equal(rd.isActive('Camp/Event/Pending'), true);
  assert.equal(rd.getCount('Camp'), 1);

  // Completing the underlying condition clears the remaining event dot and parent Camp
  rd.setFlag('Camp/Event/Pending', false);
  assert.equal(rd.isActive('Camp'), false);
  assert.equal(rd.getCount('Camp'), 0);
  assert.equal(rd.getState('Camp').style, RED_DOT_STYLES.NONE);
});

test('RedDot supports 4 commercial leaf modes: value/rule 99+, persistent NEW unread, daily resetHour rollover, and cooldown readyAt', () => {
  const backingStorage = createMemoryStorageMap();
  const saveStore = createSaveStore({ gameId: 'reddot-test', storage: backingStorage });

  // 2026-05-10 04:59:00 UTC+8 == 2026-05-09T20:59:00Z -> commercial day with resetHour=5 is 2026-05-09
  let nowMs = Date.UTC(2026, 4, 9, 20, 59, 0);
  assert.equal(
    computeCommercialDayKey(nowMs, { resetHour: 5, tzOffsetMinutes: 480 }),
    '2026-05-09',
  );

  const rd1 = createRedDotSystem({
    storage: saveStore,
    clock: () => nowMs,
    resetHour: 5,
    tzOffsetMinutes: 480,
    maxCount: 99,
    newLabel: 'NEW',
  });

  // Mode 1: value/flag/rule + 99+ cap
  rd1.setValue('Main/Mail/System', 120);
  assert.equal(rd1.getState('Main/Mail').text, '99+');
  assert.equal(formatRedDotBadge(5, { style: 'number' }), '5');
  let playerState = { claimableQuests: 3, freeSpinAt: nowMs + 10_000 };
  const unregRule = rd1.registerRule('Main/Quest/Daily', ctx => ctx?.claimableQuests ?? 0);
  rd1.evaluate(playerState);
  assert.equal(rd1.getCount('Main/Quest'), 3);
  assert.equal(rd1.getState('Main/Quest').text, '3');

  // Mode 2: persistent unread batch + syncUnreadScope stale pruning
  rd1.markUnreadBatch('Main/Bag/Equip', ['sword_1', 'shield_2', 'helm_3']);
  assert.equal(rd1.getCount('Main/Bag'), 3);
  assert.equal(rd1.getState('Main/Bag').style, RED_DOT_STYLES.NEW);
  assert.equal(rd1.getState('Main/Bag').text, 'NEW');
  const removed = rd1.syncUnreadScope('Main/Bag/Equip', ['sword_1', 'helm_3']);
  assert.equal(removed, 1);
  assert.equal(rd1.isUnread('Main/Bag/Equip/shield_2'), false);
  assert.equal(rd1.getCount('Main/Bag'), 2);
  rd1.clearUnread('Main/Bag/Equip/helm_3');
  assert.equal(rd1.getCount('Main/Bag'), 1);

  // Mode 3: daily reminder acknowledged before 05:00 reset, then reactivated after 05:00
  rd1.registerDaily('Main/Shop/DailyGift', { style: 'dot' });
  assert.equal(rd1.isActive('Main/Shop/DailyGift'), true);
  assert.equal(rd1.acknowledge('Main/Shop/DailyGift'), 1);
  assert.equal(rd1.isActive('Main/Shop/DailyGift'), false);
  assert.equal(rd1.isDailyAcknowledged('Main/Shop/DailyGift'), true);

  // Mode 4: cooldown readyAtMs
  rd1.setReadyAt('Main/Gacha/FreePull', playerState.freeSpinAt, { style: 'dot' });
  assert.equal(rd1.isActive('Main/Gacha/FreePull'), false);
  nowMs += 15_000; // still 04:59:15 on 2026-05-10 UTC+8
  assert.equal(rd1.isActive('Main/Gacha/FreePull'), true);
  assert.equal(rd1.isActive('Main/Shop/DailyGift'), false);

  rd1.dispose();

  // Reload in a fresh system after crossing 05:00 AM UTC+8 (21:01Z)
  nowMs = Date.UTC(2026, 4, 9, 21, 1, 0);
  const rd2 = createRedDotSystem({
    storage: saveStore,
    clock: () => nowMs,
    resetHour: 5,
    tzOffsetMinutes: 480,
  });
  rd2.registerDaily('Main/Shop/DailyGift', { style: 'dot' });
  // Unread sword_1 persisted, helm_3 stayed cleared, daily reset activated again for 2026-05-10
  assert.equal(rd2.isUnread('Main/Bag/Equip/sword_1'), true);
  assert.equal(rd2.isUnread('Main/Bag/Equip/helm_3'), false);
  assert.equal(rd2.isActive('Main/Shop/DailyGift'), true);
  assert.equal(rd2.dayKey, '2026-05-10');
  unregRule();
});

test('RedDot DAG links prevent cycles, deduplicate diamonds, respect displayMode/unlock/mute transitions, and batch notifications', () => {
  const rd = createRedDotSystem();

  // Leaf placed under Activity, also linked into HUD/Promo and HUD/Banner via intermediate links
  rd.setValue('Activity/FirstCharge/Reward', 2, { style: 'number' });
  rd.link('HUD/Promo', 'Activity/FirstCharge/Reward');
  rd.link('HUD/Banner', 'Activity/FirstCharge/Reward');

  // Cycle detection: Activity/FirstCharge/Reward -> Activity (via tree) cannot be linked back to Activity
  assert.throws(() => rd.link('Activity/FirstCharge/Reward', 'Activity'), /cycle detected/i);
  assert.throws(() => rd.link('HUD/Promo', 'HUD/Promo'), /cycle detected/i);

  // Diamond deduplication: HUD sees count 2 once (NOT 4), even with two diamond paths
  assert.equal(rd.getCount('HUD'), 2);
  assert.equal(rd.getState('HUD').text, '2');

  // Parent noise reduction: displayMode: 'dot' hides numeric clutter at top HUD
  rd.configure('HUD', { displayMode: 'dot' });
  assert.equal(rd.getState('HUD').style, RED_DOT_STYLES.DOT);
  assert.equal(rd.getState('HUD').text, '');

  // Anti-harassment muting on one diamond branch keeps other branch alive, muting leaf clears HUD
  rd.setMuted('HUD/Promo', true);
  assert.equal(rd.isActive('HUD/Promo'), false);
  assert.equal(rd.isActive('HUD'), true);
  assert.equal(rd.getCount('HUD'), 2);
  rd.setMuted('HUD/Promo', false);
  assert.equal(rd.isActive('HUD/Promo'), true);

  // Unlock gate on structural parent blocks both structural subtree AND external DAG parents
  rd.setUnlocked('Activity/FirstCharge', false);
  assert.equal(rd.isActive('Activity/FirstCharge/Reward'), false);
  assert.equal(rd.isActive('HUD/Promo'), false);
  assert.equal(rd.isActive('HUD'), false);
  const lockedExplain = rd.explain('Activity/FirstCharge/Reward');
  assert.equal(lockedExplain.blockedByUnlock, 'Activity/FirstCharge');
  assert.equal(lockedExplain.activeSources.length, 0);

  // Re-unlocking restores DAG & tree propagation cleanly
  rd.setUnlocked('Activity/FirstCharge', true);
  assert.equal(rd.isActive('HUD'), true);
  assert.equal(rd.getCount('HUD'), 2);
  const unlockedExplain = rd.explain('HUD');
  assert.equal(unlockedExplain.blockedByUnlock, null);
  assert.deepEqual(
    unlockedExplain.activeSources.map(s => s.path),
    ['Activity/FirstCharge/Reward'],
  );

  // Unlink removes one DAG path cleanly while keeping the remaining DAG link
  assert.equal(rd.unlink('HUD/Banner', 'Activity/FirstCharge/Reward'), true);
  assert.equal(rd.isActive('HUD/Banner'), false);
  assert.equal(rd.getCount('HUD'), 2);

  // Batching coalesces multiple leaf changes into 1 parent notification
  let parentNotifyCount = 0;
  rd.subscribe('Main', () => { parentNotifyCount++; }, { immediate: false });
  rd.batch(() => {
    rd.setValue('Main/A', 1);
    rd.setValue('Main/B', 2);
    rd.setValue('Main/C', 3);
  });
  assert.equal(parentNotifyCount, 1);
  assert.equal(rd.getCount('Main'), 6);
});

test('bindRedDotDOM renders badges declaratively, handles mode overrides, click acknowledgment, refresh, and dispose', () => {
  const doc = createMockDocument();
  const root = doc.createElement('div');

  const navBag = doc.createElement('button');
  navBag.setAttribute('data-red-dot', 'Main/Bag');
  navBag.setAttribute('data-red-dot-mode', 'dot'); // visual noise reduction override on nav tab

  const itemBtn = doc.createElement('button');
  itemBtn.setAttribute('data-red-dot', 'Main/Bag/Sword');
  itemBtn.setAttribute('data-red-dot-ack', '');
  const itemLabel = doc.createElement('span');
  itemBtn.appendChild(itemLabel);

  const mailPanel = doc.createElement('div');
  mailPanel.setAttribute('data-red-dot', 'Main/Mail');
  const mailClearAllBtn = doc.createElement('button');
  mailClearAllBtn.setAttribute('data-red-dot-ack', 'recursive');
  mailPanel.appendChild(mailClearAllBtn);

  root.appendChild(navBag);
  root.appendChild(itemBtn);
  root.appendChild(mailPanel);

  const rd = createRedDotSystem();
  rd.markUnread('Main/Bag/Sword');
  rd.markUnreadBatch('Main/Mail', ['m1', 'm2']);

  const binder = bindRedDotDOM({ system: rd, root, documentRef: doc, observe: false });

  // Head stylesheet injected once
  assert.equal(doc.head.children.length, 1);

  // navBag shows dot override despite child Sword being NEW
  const navBadge = navBag.children[0];
  assert.equal(navBadge.getAttribute('data-active'), 'true');
  assert.equal(navBadge.getAttribute('data-style'), 'dot');
  assert.equal(navBadge.textContent, '');
  assert.equal(navBag.classList.contains('has-red-dot'), true);

  // itemBtn shows NEW
  const itemBadge = itemBtn.children[1];
  assert.equal(itemBadge.getAttribute('data-active'), 'true');
  assert.equal(itemBadge.getAttribute('data-style'), 'new');
  assert.equal(itemBadge.textContent, 'NEW');

  // Clicking inner span bubbles to itemBtn and acknowledges Main/Bag/Sword -> clears both itemBtn & navBag!
  itemLabel.dispatchClick();
  assert.equal(itemBadge.getAttribute('data-active'), 'false');
  assert.equal(navBadge.getAttribute('data-active'), 'false');
  assert.equal(navBag.classList.contains('has-red-dot'), false);

  // Clicking mailClearAllBtn propagates to ancestor [data-red-dot="Main/Mail"] recursively
  const mailBadge = mailPanel.children[1];
  assert.equal(mailBadge.getAttribute('data-style'), 'new');
  mailClearAllBtn.dispatchClick();
  assert.equal(mailBadge.getAttribute('data-active'), 'false');
  assert.equal(rd.isActive('Main/Mail'), false);

  // Dynamic element mounted later picked up via refresh()
  const lateBtn = doc.createElement('button');
  lateBtn.setAttribute('data-red-dot', 'Main/Shop/Daily');
  root.appendChild(lateBtn);
  rd.markUnread('Main/Shop/Daily', { style: 'dot' });
  binder.refresh();
  assert.equal(lateBtn.children[0].getAttribute('data-active'), 'true');

  // Clean dispose removes listeners and injected badges
  binder.dispose();
  assert.equal(navBag.children.length, 0);
  assert.equal(navBag.classList.contains('has-red-dot'), false);
  rd.markUnread('Main/Mail/m3');
  // Disconnected clicks do not acknowledge after dispose
  const before = rd.isActive('Main/Mail');
  mailClearAllBtn.dispatchClick();
  assert.equal(rd.isActive('Main/Mail'), before);
});
