const ENGLISH_LABELS = {
  游戏画面: 'Game view',
  开始: 'Start',
  暂停: 'Pause',
  继续: 'Resume',
  选项: 'Upgrade',
  再来一局: 'Play again',
  重开: 'Restart',
  静音: 'Mute',
  胜: 'Win',
  败: 'Loss',
  攻击: 'Attack',
  脉冲: 'Pulse',
  冲刺: 'Dash',
  技能一: 'Skill 1',
  技能二: 'Skill 2',
  技能三: 'Skill 3',
  技能四: 'Skill 4',
  '⚔️ 锐刃': '⚔️ Edge',
  '⚡ 迅捷': '⚡ Haste',
  '♥ 生机': '♥ Vigor',
  '+25% 伤害': '+25% DMG',
  '-5% 移速': '-5% SPD',
  '+20% 攻速': '+20% Rate',
  '-10% 护甲': '-10% DEF',
  '+30 生命': '+30 HP',
  '-5% 暴击': '-5% Crit',
};

const MENU_SELECTORS = {
  title: '#start',
  choice: '[data-upgrade]',
  paused: '#gameover button',
  result: '#gameover button',
};

export async function mountActionInterface({ base, canvas, session, input, labels = {} }) {
  const [{ createActionGameControls, mountGameShell }, { createI18n }, { createTouchControls }] = await Promise.all([
    import(base + '/kit/index.js'),
    import(base + '/ui/i18n.js'),
    import(base + '/integrations/touch-controls.js'),
  ]);
  const params = new URLSearchParams(location.search);
  const language = value => value?.toLowerCase().split('-')[0];
  const requested = language(params.get('lang'));
  const locale = ['zh', 'en'].includes(requested) ? requested : language(navigator.language) === 'en' ? 'en' : 'zh';
  const { t: translate } = createI18n({ locale, fallbackLocale: 'zh', messages: { en: ENGLISH_LABELS } });
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  canvas.setAttribute('aria-label', translate('游戏画面'));
  if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = -1;

  const controls = createActionGameControls({ input, onDisconnect: () => session.pause(), confirmWithEnter: false });
  const shell = mountGameShell({ root: document.body, session, hintKeys: 'WASD · J · K', translate, keyboardNav: false });
  const hint = shell.hud.querySelector('[data-ui-hint]');
  const touch = createTouchControls({
    controls: controls.touchPlayer, mode: 'hidden', joystick: 'fixed', joystickRadius: 44, buttonLayout: 'action',
  });
  const touchMode = params.get('touch') === '1' ? 'always' : 'touch-only';
  const bindings = controls.touchPlayer.bindings;
  for (const { name, label } of bindings) touch.setButtonLabel(name, translate(labels[name] ?? label));
  function gameHasFocus() {
    const active = document.activeElement;
    return !active || active === document.body || active === canvas ||
      shell.hud.contains(active) || touch.root.contains(active);
  }
  function syncPhase() {
    const phase = session.state.phase;
    touch.setMode(phase === 'playing' ? touchMode : 'hidden');
    if (!gameHasFocus()) return;
    if (phase === 'playing') canvas.focus({ preventScroll: true });
    else shell.uiUx.setFocus(shell.hud.querySelector(MENU_SELECTORS[phase]) ?? null);
  }
  const removePhaseListener = session.director.onPhaseChange(syncPhase);
  syncPhase();

  function updateMenu(phase) {
    if (!gameHasFocus()) return;
    if (controls.wasPressed('cancel') && (phase === 'choice' || phase === 'paused')) {
      if (phase === 'choice') session.cancelChoice();
      else session.resume();
      return;
    }
    const selector = MENU_SELECTORS[phase];
    if (!selector) return;
    const next = controls.wasPressed('next');
    const previous = controls.wasPressed('previous');
    const confirm = controls.wasPressed('confirm');
    if (!next && !previous && !confirm) return;
    const buttons = Array.from(shell.hud.querySelectorAll(selector)).filter(button => !button.disabled);
    if (!buttons.length) return;
    const selected = buttons.indexOf(document.activeElement);
    const index = next ? (selected + 1) % buttons.length
      : previous ? ((selected <= 0 ? buttons.length : selected) - 1)
      : selected;
    if (next || previous) shell.uiUx.setFocus(buttons[index]);
    if (confirm) buttons[index]?.click();
  }

  let hintDevice;
  let hintTouch;
  return {
    move: controls.move,
    wasPressed: controls.wasPressed,
    isDown: controls.isDown,
    update(dt) {
      const phase = session.state.phase;
      controls.update(dt, phase === 'playing' ? 'combat' : 'menu');
      if (phase !== session.state.phase) return false;
      if (phase !== 'playing') {
        updateMenu(phase);
        return false;
      }
      if (controls.wasPressed('pause')) {
        session.pause();
        return false;
      }
      if (hintTouch !== touch.visible) {
        hintTouch = touch.visible;
        hint.style.display = hintTouch ? 'none' : '';
      }
      if (hintDevice !== controls.device) {
        hintDevice = controls.device;
        hint.textContent = [hintDevice === 'keyboard' ? 'WASD' : '◉',
          ...bindings.map(({ name }) => controls.getGlyph(name))].filter(Boolean).join(' · ');
      }
      return true;
    },
    sync: shell.sync,
    dispose() {
      removePhaseListener();
      touch.dispose();
      controls.dispose();
      shell.dispose();
    },
  };
}
