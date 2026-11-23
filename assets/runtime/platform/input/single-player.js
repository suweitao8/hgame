import { createInputActionRouter } from './router.js';

const BUTTON_GLYPHS = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS'],
  playstation: ['×', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3'],
  switch: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'L Stick', 'R Stick'],
  generic: ['↓', '→', '←', '↑', 'L', 'R', 'LT', 'RT', '−', '+', 'L Stick', 'R Stick'],
};
const STICK_CODES = ['StickUp', 'StickDown', 'StickLeft', 'StickRight'];
const MOUSE_CODES = ['MouseLeft', 'MouseMiddle', 'MouseRight'];
const DIRECTIONS = ['↑', '↓', '←', '→'];
const KEY_GLYPHS = {
  Enter: '↵', Escape: '⎋', Space: '␣', Tab: '⇥',
  ShiftLeft: '⇧', ShiftRight: '⇧', ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  MouseLeft: 'LMB', MouseMiddle: 'MMB', MouseRight: 'RMB',
};

function identifyFamily(id) {
  if (/dualshock|dualsense|playstation|054c/i.test(id)) return 'playstation';
  if (/nintendo|switch|057e/i.test(id)) return 'switch';
  if (/xbox|xinput|045e/i.test(id)) return 'xbox';
  return 'generic';
}

/**
 * Single-player standard gamepad and keyboard/pointer action routing.
 * @param {object} options
 * @param {import('./manager.js').InputManager} options.input
 * @param {() => ArrayLike<Gamepad | null>} [options.getGamepads]
 * @param {(index: number) => void} [options.onDisconnect]
 * @param {keyof typeof BUTTON_GLYPHS} [options.gamepadFamily] Override browser identification.
 */
export function createSinglePlayerInput({
  input, getGamepads = () => globalThis.navigator?.getGamepads?.() ?? [],
  onDisconnect, gamepadFamily,
}) {
  /** @type {Map<number, {index: number, id: string, codes: Set<string>}>} */
  const history = new Map();
  /** @type {{index: number, id: string, codes: Set<string>} | null} */
  let activePad = null;
  let device = 'keyboard';
  let keyboardReady = true;
  let swapped = false;
  let disposed = false;
  const activateKeyboard = () => {
    activePad = null;
    device = 'keyboard';
    keyboardReady = true;
  };
  const unsubscribe = [
    input.on('keydown', ({ repeat }) => { if (!repeat) activateKeyboard(); }),
    input.on('pointerdown', activateKeyboard),
  ];

  function physicalCode(code) {
    if (swapped && code === 'Pad0') return 'Pad1';
    if (swapped && code === 'Pad1') return 'Pad0';
    return code;
  }

  const router = createInputActionRouter({
    readCode(code) {
      if (!input.focused) return false;
      if (activePad) return activePad.codes.has(physicalCode(code));
      if (!keyboardReady) return false;
      const button = MOUSE_CODES.indexOf(code);
      return button >= 0 ? input.isPointerDown(button) : input.isDown(code);
    },
  });

  /** @param {number} [dtSeconds] */
  function update(dtSeconds) {
    if (disposed) return;
    const pads = Array.from(getGamepads()).filter(pad => pad?.mapping === 'standard' && pad.connected !== false);
    pads.sort((a, b) => a.index - b.index);
    const next = new Map();
    let candidate = null;
    for (const pad of pads) {
      const previous = history.get(pad.index);
      const oldCodes = previous?.id === pad.id ? previous.codes : new Set();
      const codes = new Set();
      pad.buttons.forEach((button, index) => {
        const code = 'Pad' + index;
        if (button.value >= (oldCodes.has(code) ? 0.20 : 0.25)) codes.add(code);
      });
      const axes = [-pad.axes[1], pad.axes[1], -pad.axes[0], pad.axes[0]];
      axes.forEach((value, index) => {
        const code = STICK_CODES[index];
        if (value >= (oldCodes.has(code) ? 0.20 : 0.25)) codes.add(code);
      });
      const state = { index: pad.index, id: pad.id, codes };
      next.set(pad.index, state);
      if (input.focused && [...codes].some(code => !oldCodes.has(code))) {
        if (!candidate || activePad?.index === pad.index) candidate = state;
      }
    }
    const previousPad = activePad;
    const current = previousPad && next.get(previousPad.index);
    const lost = previousPad && current?.id !== previousPad.id;
    activePad = candidate ?? (lost ? null : current);
    device = activePad ? gamepadFamily ?? identifyFamily(activePad.id) : 'keyboard';
    if (lost) keyboardReady = false;
    history.clear();
    for (const [index, state] of next) history.set(index, state);
    router.update(dtSeconds);
    if (lost) onDisconnect?.(previousPad.index);
  }

  /** @param {string} context @param {string} action @returns {string | null} */
  function getGlyph(context, action) {
    const keys = router.getActionBinding(context, action)?.keys ?? [];
    const code = keys.find(key => /^(Pad\d+|Stick(?:Up|Down|Left|Right))$/.test(key) === Boolean(activePad));
    if (!code) return null;
    if (!activePad) return KEY_GLYPHS[code] ?? code.replace(/^(Key|Digit)/, '');
    if (code.startsWith('Stick')) return DIRECTIONS[STICK_CODES.indexOf(code)];
    const index = Number(physicalCode(code).slice(3));
    return BUTTON_GLYPHS[device]?.[index] ?? DIRECTIONS[index - 12] ?? '•';
  }

  /**
   * Return plain text and action glyph descriptors in translated order.
   * @param {{t: (key: string, params?: Record<string, unknown>) => string}} i18n
   * @param {string} key
   * @param {string} context
   * @param {Record<string, unknown>} [params]
   * @returns {(string | {action: string, glyph: string | null})[]}
   */
  function promptParts(i18n, key, context, params) {
    return i18n.t(key, params).split(/\{Action:([\w.-]+)\}/g).flatMap((part, index) =>
      index % 2 ? [{ action: part, glyph: getGlyph(context, part) }] : part ? [part] : []);
  }

  return Object.freeze({
    router,
    update,
    get device() { return device; },
    get gamepadIndex() { return activePad?.index ?? null; },
    /** @param {boolean} value */
    setSwapConfirmCancel(value) { swapped = Boolean(value); },
    getGlyph,
    promptParts,
    dispose() {
      disposed = true;
      for (const off of unsubscribe) off();
      history.clear();
      activateKeyboard();
      router.reset();
    },
  });
}
