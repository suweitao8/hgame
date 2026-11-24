// Minimalist Anti-Bloat Universal Game UI Shell (Title, Edge HUD, Whole-Card Choice, Pause, Result, Debug).
import { bindUiUxDOM } from '../integrations/ui-ux-dom.js';
import { UI_PHASES } from '../ui/ux-director.js';
import { getArtTheme } from './art-themes.js';

const SHELL_STYLE_ATTR = 'data-hgame-shell-styles';

const METRIC_ICONS = Object.freeze({
  hp: '♥',
  score: '★',
  kills: '⚔',
  wave: '❖',
  level: '⚡',
  currency: '◆',
  timer: '⏱',
});

const SHELL_CSS = `
#hud {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 20;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #f8fafc;
}
#hud .hg-edge-tl {
  position: fixed;
  top: max(14px, env(safe-area-inset-top));
  left: max(14px, env(safe-area-inset-left));
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 14px;
  border: 1px solid var(--hg-surface-border, rgba(148, 163, 184, 0.35));
  background: var(--hg-surface-bg, rgba(12, 20, 34, 0.84));
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(10px);
  pointer-events: none;
  max-width: calc(100vw - 88px);
}
#hud .hg-edge-tr {
  position: fixed;
  top: max(14px, env(safe-area-inset-top));
  right: max(14px, env(safe-area-inset-right));
  display: flex;
  align-items: center;
  gap: 10px;
  pointer-events: auto;
}
#hud .bars {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: clamp(164px, 22vw, 270px);
  max-width: 100%;
}
#hud .bar {
  height: clamp(14px, 2.2vh, 20px);
  border: 1px solid rgba(255, 255, 255, 0.28);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.45);
}
#hud .bar.xp {
  height: 6px;
  border-color: rgba(255, 255, 255, 0.18);
}
#hud #readout {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
  font-size: clamp(15px, 1.8vw, 19px);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.75);
}
#hud .hg-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
#hud .hg-pill-icon {
  color: var(--hg-accent, #38bdf8);
  font-size: 0.95em;
}
#hud #pause {
  pointer-events: auto;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  border: 1px solid var(--hg-surface-border, rgba(148, 163, 184, 0.4));
  background: var(--hg-surface-bg, rgba(12, 20, 34, 0.84));
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(10px);
  color: #f8fafc;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
#hud .hg-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  align-content: center;
  gap: clamp(16px, 2.6vh, 26px);
  padding: 20px;
  background: radial-gradient(circle at 50% 42%, rgba(8, 13, 24, 0.42), rgba(4, 7, 14, 0.82) 78%);
  pointer-events: auto;
}
#hud .hg-overlay[hidden],
#hud #debug[hidden],
#hud [data-ui-hint][hidden] {
  display: none;
}
#hud .hg-hero-frame {
  display: grid;
  justify-items: center;
  gap: 14px;
  padding: clamp(22px, 3.6vw, 36px) clamp(28px, 5vw, 52px);
  border-radius: 22px;
  border: 1px solid var(--hg-surface-border, rgba(148, 163, 184, 0.42));
  background: linear-gradient(165deg, rgba(15, 23, 42, 0.88), rgba(9, 14, 26, 0.92));
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.62), inset 0 1px 0 rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(12px);
  max-width: min(92vw, 480px);
}
#hud .hg-title-text {
  margin: 0;
  font-size: clamp(32px, 5.6vw, 56px);
  font-weight: 900;
  letter-spacing: 0.06em;
  text-align: center;
  text-shadow: 0 6px 24px rgba(0, 0, 0, 0.78);
}
#hud .hg-accent-rule {
  width: 68px;
  height: 4px;
  border-radius: 999px;
  background: var(--hg-accent, #38bdf8);
  box-shadow: 0 0 16px var(--hg-accent, #38bdf8);
}
#hud .hg-btn {
  min-width: clamp(168px, 22vw, 240px);
  min-height: 48px;
  padding: 12px 26px;
  border-radius: 14px;
  border: 1px solid var(--hg-surface-border, rgba(255, 255, 255, 0.35));
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.94), rgba(15, 23, 42, 0.96));
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.48), inset 0 1px 0 rgba(255, 255, 255, 0.22);
  color: #f8fafc;
  font-size: clamp(17px, 2.1vw, 21px);
  font-weight: 800;
  letter-spacing: 0.1em;
  cursor: pointer;
}
#hud .hg-btn-primary {
  border-color: rgba(255, 255, 255, 0.45);
  background: linear-gradient(180deg, var(--hg-accent, #38bdf8), rgba(15, 23, 42, 0.85));
  color: #ffffff;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.55);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.55), 0 0 22px rgba(56, 189, 248, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.38);
}
#hud .hg-btn-icon {
  min-width: 52px;
  width: 52px;
  padding: 12px 0;
  letter-spacing: 0;
}
#hud .hg-cards {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
  max-width: min(94vw, 760px);
}
#hud .card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  width: clamp(168px, 22vw, 224px);
  min-height: clamp(148px, 24vh, 196px);
  padding: 18px;
  border-radius: 18px;
  border: 1px solid var(--hg-surface-border, rgba(148, 163, 184, 0.4));
  border-top: 4px solid var(--hg-accent, #38bdf8);
  background: linear-gradient(165deg, rgba(22, 33, 56, 0.94), rgba(11, 17, 30, 0.96));
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.16);
  color: #f8fafc;
  font-size: 16px;
  text-align: left;
  cursor: pointer;
}
#hud .card .name {
  font-weight: 900;
  font-size: clamp(18px, 2.2vw, 22px);
  line-height: 1.2;
}
#hud .card .pos,
#hud .card .neg {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 800;
}
#hud .card .pos {
  color: var(--hg-up-color, #4ade80);
  background: rgba(74, 222, 128, 0.14);
}
#hud .card .neg {
  color: var(--hg-down-color, #fb7185);
  background: rgba(251, 113, 133, 0.14);
}
#hud .hg-heading {
  margin: 0;
  font-size: clamp(22px, 3vw, 30px);
  font-weight: 900;
  letter-spacing: 0.12em;
  text-shadow: 0 4px 14px rgba(0, 0, 0, 0.7);
}
#hud .hg-result-score {
  font-size: clamp(36px, 5.5vw, 54px);
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  color: var(--hg-accent, #facc15);
  text-shadow: 0 4px 18px rgba(0, 0, 0, 0.65);
}
#hud .hg-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
}
#hud #debug {
  position: fixed;
  left: 14px;
  bottom: 14px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(2, 6, 23, 0.88);
  font: 12px/1.4 ui-monospace, monospace;
  color: #cbd5e1;
}
#hud [data-ui-hint] {
  position: fixed;
  bottom: max(20px, env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(12, 20, 34, 0.78);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.12em;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}
#hud:has(#hg-title:not([hidden]), #levelup:not([hidden]), #gameover:not([hidden])) :is(.hg-edge-tl, .hg-edge-tr, .bars, #readout, #pause, [data-ui-hint]) {
  visibility: hidden;
}
@media (orientation: portrait), (max-width: 600px) {
  #hud[data-portrait-thumb="true"] .hg-edge-tr {
    top: auto;
    bottom: max(18px, calc(env(safe-area-inset-bottom) + 14px));
    right: max(16px, calc(env(safe-area-inset-right) + 12px));
  }
  #hud[data-portrait-thumb="true"] .hg-overlay {
    align-content: end;
    justify-items: end;
    padding: 20px max(18px, calc(env(safe-area-inset-right) + 14px)) max(28px, calc(env(safe-area-inset-bottom) + 22px)) 20px;
  }
  #hud[data-portrait-thumb="true"] .hg-hero-frame,
  #hud[data-portrait-thumb="true"] .hg-cards,
  #hud[data-portrait-thumb="true"] .hg-actions {
    max-width: min(92vw, 380px);
    justify-content: flex-end;
  }
}
`;

function injectShellStyles(doc) {
  const head = doc?.head;
  if (!head || typeof doc.createElement !== 'function') return;
  if (head.querySelector?.(`style[${SHELL_STYLE_ATTR}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(SHELL_STYLE_ATTR, '1');
  style.textContent = SHELL_CSS;
  head.appendChild(style);
}

function el(doc, tag, attrs = {}, text = null) {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === 'hidden') node.hidden = Boolean(v);
    else if (k === 'className') node.className = v;
    else node.setAttribute(k, String(v));
  }
  if (text !== null) node.textContent = text;
  return node;
}

/**
 * @typedef {object} GameShellOptions
 * @property {HTMLElement | null} [root] Host container (defaults to `document.body`).
 * @property {import('./game-session.js').createGameSession extends (...args: any[]) => infer R ? R : object} session
 * @property {string} [title]
 * @property {string} [theme]
 * @property {string[]} [metrics]
 * @property {string[]} [bars]
 * @property {string} [hintKeys='WASD · J']
 * @property {(label: string) => string} [translate] Translates shell labels and choice text. Return the supplied label for untranslated text.
 * @property {boolean} [keyboardNav=true] Handle directional and confirmation keys when the caller does not own menu input.
 * @property {boolean} [portraitFirst=true] Anchor clickable shell controls into the bottom-right thumb arc on portrait screens.
 */

/**
 * @typedef {object} GameShellHandle
 * @property {HTMLElement} hud
 * @property {{ step: (dt?: number) => boolean, wake: () => void, syncDirectorDom: () => void, setFocus: (element: HTMLElement | null) => void, setTheme: (themeName: string) => void, dispose: () => void }} uiUx
 * @property {() => void} sync
 * @property {(text: string) => void} setDebugText
 * @property {(themeId: string) => void} setTheme
 * @property {() => void} dispose
 */

/**
 * Mount a Zero-Prose, Hard-Button-Budget, Anti-Bloat DOM Game UI Shell wired to a `GameSession`.
 * @param {GameShellOptions} options
 * @returns {Readonly<GameShellHandle>}
 */
export function mountGameShell(options) {
  if (!options?.session) throw new TypeError('mountGameShell requires a session');
  const session = options.session;
  const bp = session.blueprint;
  const doc = options.root?.ownerDocument ?? globalThis.document;
  const root = options.root ?? doc?.body;
  if (!doc || !root) throw new Error('mountGameShell requires a DOM document/root');

  const theme = getArtTheme(options.theme ?? bp.art.theme);
  const metricIds = options.metrics ?? bp.ui.hudMetrics ?? ['hp', 'score', 'wave'];
  const barIds = options.bars ?? bp.ui.hudBars ?? ['hp'];
  const translate = options.translate ?? (label => label);

  injectShellStyles(doc);

  const portraitFirst = options.portraitFirst !== false;
  const hud = el(doc, 'div', {
    id: 'hud',
    'aria-live': 'polite',
    'data-ui-theme': theme.uiTheme,
    ...(portraitFirst ? { 'data-portrait-thumb': 'true' } : {}),
  });

  // Edge HUD (Top-Left glass frame + bars + metrics, Top-Right <= 1 pause button)
  const edgeTl = el(doc, 'div', { className: 'hg-edge-tl' });
  const barsWrap = el(doc, 'div', { className: 'bars' });
  for (const barId of barIds) {
    barsWrap.appendChild(el(doc, 'div', { className: `bar ${barId}`, 'data-ui-bar': barId }));
  }
  const readout = el(doc, 'div', { id: 'readout' });
  for (const metricId of metricIds) {
    const pill = el(doc, 'span', { className: 'hg-pill' });
    pill.appendChild(el(doc, 'span', { className: 'hg-pill-icon' }, METRIC_ICONS[metricId] ?? '•'));
    pill.appendChild(el(doc, 'span', { 'data-ui-metric': metricId }, '0'));
    readout.appendChild(pill);
  }
  edgeTl.appendChild(barsWrap);
  edgeTl.appendChild(readout);

  const edgeTr = el(doc, 'div', { className: 'hg-edge-tr' });
  const pauseBtn = el(doc, 'button', { id: 'pause', type: 'button', 'aria-label': translate('暂停') }, '⏸');
  edgeTr.appendChild(pauseBtn);

  // Title Overlay (live canvas visible, <= 1 button)
  const titleOverlay = el(doc, 'div', { id: 'hg-title', className: 'hg-overlay', 'data-panel': 'title' });
  const titleFrame = el(doc, 'div', { className: 'hg-hero-frame' });
  titleFrame.appendChild(el(doc, 'h1', { className: 'hg-title-text' }, String(options.title ?? bp.meta.title).slice(0, 18)));
  titleFrame.appendChild(el(doc, 'div', { className: 'hg-accent-rule' }));
  const startBtn = el(doc, 'button', { id: 'start', type: 'button', className: 'hg-btn hg-btn-primary', 'data-ui-tilt': '' }, translate('开始'));
  titleFrame.appendChild(startBtn);
  titleOverlay.appendChild(titleFrame);

  // Choice Overlay (<= 4 whole clickable cards, <= 18 chars each)
  const choiceOverlay = el(doc, 'div', { id: 'levelup', className: 'hg-overlay', 'data-panel': 'choice', 'data-ui-stagger': '', hidden: true });
  choiceOverlay.appendChild(el(doc, 'h2', { className: 'hg-heading' }, translate('选项')));
  const cardsBox = el(doc, 'div', { className: 'hg-cards' });
  choiceOverlay.appendChild(cardsBox);

  // Pause / Result Overlay (<= 2 buttons)
  const endOverlay = el(doc, 'div', { id: 'gameover', className: 'hg-overlay', 'data-panel': 'result', hidden: true });
  const endFrame = el(doc, 'div', { className: 'hg-hero-frame' });
  const resultHeading = el(doc, 'div', { className: 'hg-heading' }, '');
  const resultScore = el(doc, 'div', { id: 'result', className: 'hg-result-score' }, '★ 0');
  const actionsRow = el(doc, 'div', { className: 'hg-actions' });
  const restartBtn = el(doc, 'button', { id: 'restart', type: 'button', className: 'hg-btn hg-btn-primary', 'data-ui-tilt': '' }, translate('再来一局'));
  const secondaryBtn = el(doc, 'button', { id: 'mute', type: 'button', className: 'hg-btn hg-btn-icon', 'aria-label': translate('静音') }, '🔊');
  actionsRow.appendChild(restartBtn);
  actionsRow.appendChild(secondaryBtn);
  endFrame.appendChild(resultHeading);
  endFrame.appendChild(resultScore);
  endFrame.appendChild(actionsRow);
  endOverlay.appendChild(endFrame);

  // Optional transient key hint & hidden debug readout
  const hintBadge = el(doc, 'div', { 'data-ui-hint': '', hidden: true }, options.hintKeys ?? 'WASD · J');
  const debugBox = el(doc, 'div', { id: 'debug', hidden: true }, '');
  if (typeof globalThis.location?.search === 'string' && new URLSearchParams(globalThis.location.search).get('debug') === '1') {
    debugBox.hidden = false;
  }

  hud.appendChild(edgeTl);
  hud.appendChild(edgeTr);
  hud.appendChild(titleOverlay);
  hud.appendChild(choiceOverlay);
  hud.appendChild(endOverlay);
  hud.appendChild(hintBadge);
  hud.appendChild(debugBox);
  root.appendChild(hud);

  const uiUx = bindUiUxDOM({
    root: hud,
    director: session.director,
    audio: null,
    theme: theme.uiTheme,
    keyboardNav: options.keyboardNav,
  });

  function renderChoices(choices) {
    cardsBox.innerHTML = '';
    const list = Array.isArray(choices) ? choices.slice(0, 4) : [];
    list.forEach((c, idx) => {
      const card = el(doc, 'button', { type: 'button', className: 'card', 'data-upgrade': c.id, 'data-ui-tilt': '' });
      card.appendChild(el(doc, 'span', { className: 'name' }, translate(String(c.label ?? c.id)).slice(0, 12)));
      if (c.pos) card.appendChild(el(doc, 'span', { className: 'pos' }, translate(String(c.pos)).slice(0, 10)));
      if (c.neg) card.appendChild(el(doc, 'span', { className: 'neg' }, translate(String(c.neg)).slice(0, 10)));
      card.addEventListener('click', () => session.selectChoice(idx));
      cardsBox.appendChild(card);
    });
  }

  function syncPhaseView() {
    const phase = session.state.phase;
    titleOverlay.hidden = phase !== UI_PHASES.TITLE;
    choiceOverlay.hidden = phase !== UI_PHASES.CHOICE;
    endOverlay.hidden = phase !== UI_PHASES.PAUSED && phase !== UI_PHASES.RESULT;

    if (phase === UI_PHASES.CHOICE) {
      renderChoices(session.state.choices);
    } else if (phase === UI_PHASES.PAUSED) {
      resultHeading.textContent = translate('暂停');
      resultScore.textContent = `★ ${Math.floor(session.state.score)}`;
      restartBtn.textContent = translate('继续');
      secondaryBtn.textContent = '↻';
      secondaryBtn.setAttribute('aria-label', translate('重开'));
    } else if (phase === UI_PHASES.RESULT) {
      resultHeading.textContent = translate(session.state.victory ? '胜' : '败');
      resultScore.textContent = `★ ${Math.floor(session.state.score)}`;
      restartBtn.textContent = translate('再来一局');
      secondaryBtn.textContent = session.audio.isMuted() ? '🔇' : '🔊';
      secondaryBtn.setAttribute('aria-label', translate('静音'));
    }
    uiUx.syncDirectorDom();
  }

  const onStartClick = () => session.startRun();
  const onPauseClick = () => session.togglePause();
  const onRestartClick = () => {
    if (session.state.phase === UI_PHASES.PAUSED) session.resume();
    else session.restart();
  };
  const onSecondaryClick = () => {
    if (session.state.phase === UI_PHASES.PAUSED) {
      session.restart();
    } else {
      const muted = session.audio.setMuted(!session.audio.isMuted());
      secondaryBtn.textContent = muted ? '🔇' : '🔊';
    }
  };
  const onKeyDown = (ev) => {
    if (ev.repeat) return;
    if (ev.code === 'Backquote') {
      debugBox.hidden = !debugBox.hidden;
    } else if (ev.code === 'Escape' && (session.state.phase === UI_PHASES.PLAYING || session.state.phase === UI_PHASES.PAUSED)) {
      session.togglePause();
    }
  };

  startBtn.addEventListener('click', onStartClick);
  pauseBtn.addEventListener('click', onPauseClick);
  restartBtn.addEventListener('click', onRestartClick);
  secondaryBtn.addEventListener('click', onSecondaryClick);
  const win = doc.defaultView ?? globalThis;
  win?.addEventListener?.('keydown', onKeyDown);

  const unsubPhase = session.director.onPhaseChange(() => syncPhaseView());
  syncPhaseView();

  let disposed = false;
  return Object.freeze({
    hud,
    uiUx,
    sync: () => {
      uiUx.syncDirectorDom();
      if (!debugBox.hidden) {
        const s = session.state;
        debugBox.textContent = `${s.phase} · HP ${Math.ceil(s.hp)}/${s.maxHp} · W${s.wave} · K${s.kills}`;
      }
    },
    setDebugText(text) {
      if (!debugBox.hidden) debugBox.textContent = String(text ?? '');
    },
    setTheme(themeId) {
      const next = getArtTheme(themeId);
      hud.setAttribute('data-ui-theme', next.uiTheme);
      uiUx.setTheme(next.uiTheme);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubPhase();
      startBtn.removeEventListener('click', onStartClick);
      pauseBtn.removeEventListener('click', onPauseClick);
      restartBtn.removeEventListener('click', onRestartClick);
      secondaryBtn.removeEventListener('click', onSecondaryClick);
      win?.removeEventListener?.('keydown', onKeyDown);
      uiUx.dispose();
      hud.remove?.();
    },
  });
}
