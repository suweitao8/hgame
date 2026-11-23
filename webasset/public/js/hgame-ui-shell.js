function parseDebugFlag() {
  try {
    const urlParams = new URLSearchParams(location.search);
    if (urlParams.get('debug') === '1') return true;
    const hash = String(location.hash || '');
    const qIdx = hash.indexOf('?');
    if (qIdx >= 0) {
      return new URLSearchParams(hash.slice(qIdx + 1)).get('debug') === '1';
    }
  } catch { /* ignore */ }
  return false;
}

export function syncDebugMode() {
  const on = parseDebugFlag();
  document.documentElement.dataset.debugMode = on ? '1' : '0';
  return on;
}

function closeAllPopovers(except = null) {
  for (const pop of document.querySelectorAll('.stage-params-popover')) {
    if (pop === except) continue;
    pop.hidden = true;
    const wrap = pop.closest('.stage-popover-wrap');
    const btn = wrap?.querySelector('.stage-params-toggle, .volume-popover-toggle');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
}

export function syncSingleOptionSelects(root = document) {
  const selects = root.querySelectorAll('.hgame-sidebar select, .hgame-controls select, .stage-params-popover select');
  for (const sel of selects) {
    if (sel.dataset.keepSingle === 'true') continue;
    const count = [...sel.options].filter((o) => !o.hidden).length;
    const hideSelf = count <= 1;
    const field = sel.closest('.hgame-field');
    if (field) {
      field.dataset.singleHidden = hideSelf ? 'true' : 'false';
    } else {
      sel.dataset.singleHidden = hideSelf ? 'true' : 'false';
    }
  }
  for (const row of root.querySelectorAll('.hgame-filter-row')) {
    const visibleChildren = [...row.children].filter((child) => (
      !child.hidden && child.dataset.singleHidden !== 'true'
    ));
    row.dataset.singleHidden = visibleChildren.length === 0 ? 'true' : 'false';
  }
}

function activeWorkspaceEl() {
  return document.querySelector('.workspace-layout:not([hidden])');
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(target.isContentEditable);
}

function stepSidebarSelection(view, delta) {
  const items = [...view.querySelectorAll('.hgame-asset-list .hgame-list-item, #character-list button, #game-list button')]
    .filter((el) => !el.hidden && el.offsetParent !== null);
  if (items.length === 0) return false;
  let idx = items.findIndex((el) => el.getAttribute('aria-current') === 'true' || el.classList.contains('is-active'));
  if (idx < 0) idx = 0;
  else idx = Math.max(0, Math.min(items.length - 1, idx + delta));
  const next = items[idx];
  next.scrollIntoView({ block: 'nearest' });
  next.click();
  return true;
}

function stepCharacterSelect(delta) {
  const sel = document.querySelector('#hgame-anim-character-select');
  if (!sel || sel.options.length <= 1) return false;
  const nextIdx = (sel.selectedIndex + delta + sel.options.length) % sel.options.length;
  sel.selectedIndex = nextIdx;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function initPopovers() {
  document.addEventListener('click', (event) => {
    const toggle = event.target.closest?.('.stage-params-toggle, .volume-popover-toggle');
    if (toggle) {
      const wrap = toggle.closest('.stage-popover-wrap');
      const pop = wrap?.querySelector('.stage-params-popover');
      if (!pop) return;
      const willOpen = pop.hidden;
      closeAllPopovers(willOpen ? pop : null);
      pop.hidden = !willOpen;
      toggle.setAttribute('aria-expanded', String(willOpen));
      return;
    }
    if (!event.target.closest?.('.stage-params-popover')) {
      closeAllPopovers();
    }
  });
}

function initGlobalShortcuts() {
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === 'Escape') {
      closeAllPopovers();
      for (const dlg of document.querySelectorAll('dialog[open]')) {
        dlg.close?.();
      }
      return;
    }

    if (isTypingTarget(event.target)) return;

    const view = activeWorkspaceEl();
    if (!view) return;
    const id = view.id;

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (stepSidebarSelection(view, event.key === 'ArrowUp' ? -1 : 1)) {
        event.preventDefault();
      }
      return;
    }

    if (event.code === 'Space') {
      const playMap = {
        'music-view': '#hgame-music-play-button',
        'audio-view': '#hgame-audio-play-button',
        'animations-view': '#hgame-anim-play-button',
        'vfx-view': '#hgame-vfx-play-button',
      };
      const btn = playMap[id] ? view.querySelector(playMap[id]) : null;
      if (btn && !btn.disabled) {
        event.preventDefault();
        btn.click();
      }
      return;
    }

    const key = event.key.toLowerCase();
    if (key === 'r') {
      const replayMap = {
        'animations-view': '#hgame-anim-restart-button',
        'vfx-view': '#hgame-vfx-replay-button',
        'tests-view': '#hgame-test-reset-cam',
      };
      const btn = replayMap[id] ? view.querySelector(replayMap[id]) : null;
      if (btn && !btn.disabled) {
        event.preventDefault();
        btn.click();
      }
      return;
    }

    if (key === 'l') {
      if (id === 'tests-view') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('webasset:toggle-pointer-lock'));
        return;
      }
      const loopMap = {
        'music-view': '#hgame-music-loop',
        'audio-view': '#hgame-audio-loop',
        'animations-view': '#hgame-anim-loop',
      };
      const chk = loopMap[id] ? view.querySelector(loopMap[id]) : null;
      if (chk) {
        event.preventDefault();
        chk.checked = !chk.checked;
        chk.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }

    if (id === 'animations-view' && (event.key === '[' || event.key === ']')) {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('webasset:step-anim-character', { detail: { delta: event.key === '[' ? -1 : 1 } }));
      return;
    }

    if (id === 'tests-view' && (key === 'h' || event.key === '?')) {
      const helpBtn = view.querySelector('#hgame-test-help-button');
      if (helpBtn) {
        event.preventDefault();
        helpBtn.click();
      }
    }
  });
}

function initAutoHideObserver() {
  syncSingleOptionSelects();
  let scheduled = false;
  const scheduleSync = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      syncSingleOptionSelects();
    });
  };
  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
}

syncDebugMode();
window.addEventListener('hashchange', syncDebugMode);
window.addEventListener('popstate', syncDebugMode);
window.addEventListener('webasset:workspace-change', () => {
  closeAllPopovers();
  syncSingleOptionSelects();
});
initPopovers();
initGlobalShortcuts();
initAutoHideObserver();
