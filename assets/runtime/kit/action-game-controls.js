import { defineInputContext } from '../platform/input/contexts.js';
import { createSinglePlayerInput } from '../platform/input/single-player.js';
import { applyRadialDeadzone } from '../integrations/touch-controls.js';

const COMBAT = {
  attack: { keys: ['KeyJ', 'Pad2'], label: '攻击' },
  dash: { keys: ['KeyK', 'Pad0', 'Pad3'], label: '冲刺' },
  skill1: { keys: ['KeyL', 'Pad4'], label: '技能一' },
  skill2: { keys: ['KeyU', 'Pad5'], label: '技能二' },
  skill3: { keys: ['KeyI', 'Pad6'], label: '技能三' },
  skill4: { keys: ['KeyO', 'Pad7'], label: '技能四' },
};
const MENU = {
  confirm: ['KeyJ', 'Enter', 'Pad0'],
  cancel: ['KeyK', 'Pad1'],
  previous: ['KeyW', 'KeyA', 'ArrowUp', 'ArrowLeft', 'Pad12', 'Pad14', 'StickUp', 'StickLeft'],
  next: ['KeyS', 'KeyD', 'ArrowDown', 'ArrowRight', 'Pad13', 'Pad15', 'StickDown', 'StickRight'],
};

/**
 * Poll keyboard, standard gamepad and touch through the default single-player action bindings.
 * @param {object} options
 * @param {import('../platform/input/manager.js').InputManager} options.input
 * @param {() => ArrayLike<Gamepad | null>} [options.getGamepads]
 * @param {(index: number) => void} [options.onDisconnect]
 * @param {readonly (keyof typeof COMBAT)[]} [options.actions] Actions used by this game.
 */
export function createActionGameControls({
  input, getGamepads = () => globalThis.navigator?.getGamepads?.() ?? [],
  onDisconnect, actions = ['attack', 'dash'],
}) {
  const enabled = new Set(actions);
  const bindings = Object.entries(COMBAT).flatMap(([name, definition]) => {
    if (!enabled.has(name)) return [];
    const keyLabel = definition.keys[0].slice(3);
    return [{ name, label: definition.label, slot: keyLabel.toLowerCase(), keyLabel, isExtra: false }];
  });
  /** @type {ArrayLike<Gamepad | null>} */
  let pads = [];
  const physical = createSinglePlayerInput({ input, getGamepads: () => pads, onDisconnect });
  const router = physical.router;
  const combatActions = Object.fromEntries(bindings.map(({ name }) => [name, { keys: COMBAT[name].keys }]));
  combatActions.pause = { keys: ['Pad9', 'Pad1'] };
  router.pushContext(defineInputContext('action-combat', {
    consumesKeys: false, actions: combatActions,
    axes2D: { Move: { up: ['KeyW', 'ArrowUp'], left: ['KeyA', 'ArrowLeft'], down: ['KeyS', 'ArrowDown'], right: ['KeyD', 'ArrowRight'] } },
  }));
  router.pushContext(defineInputContext('action-menu', { consumesKeys: false, actions: MENU }));
  const combatNames = Object.keys(combatActions);
  const menuNames = Object.keys(MENU);
  const heldOnEntry = new Set();
  const heldTouch = new Set();
  const pendingTouch = new Set();
  const stick = { x: 0, y: 0 };
  const move = { x: 0, y: 0 };
  const keyboard = { x: 0, y: 0 };
  /** @type {'menu' | 'combat' | null} */
  let mode = null;
  const releaseTouch = () => {
    stick.x = 0;
    stick.y = 0;
    heldTouch.clear();
    pendingTouch.clear();
  };
  const unsubscribe = input.on('focus', focused => { if (!focused) releaseTouch(); });

  /** @param {number} dt @param {'combat' | 'menu'} nextMode */
  function update(dt, nextMode) {
    const names = nextMode === 'combat' ? combatNames : menuNames;
    if (mode !== nextMode) {
      heldOnEntry.clear();
      if (mode !== null) for (const name of names) {
        if (router.isDown(name)) heldOnEntry.add(name);
      }
      mode = nextMode;
      if (mode === 'menu') releaseTouch();
    }
    for (const { name } of bindings) {
      router.setVirtualAction(name, mode === 'combat' && (heldTouch.has(name) || pendingTouch.has(name)));
    }
    pendingTouch.clear();
    try { pads = getGamepads(); } catch { pads = []; }
    physical.update(dt);
    for (const name of heldOnEntry) if (!router.isDown(name)) heldOnEntry.delete(name);
    move.x = 0;
    move.y = 0;
    if (mode !== 'combat' || !input.focused) return;
    if (stick.x || stick.y) {
      Object.assign(move, stick);
    } else if (physical.gamepadIndex !== null) {
      const pad = Array.from(pads).find(entry => entry?.index === physical.gamepadIndex);
      const analog = applyRadialDeadzone(pad?.axes[0] || 0, pad?.axes[1] || 0, 1, 0.25);
      move.x = analog.x;
      move.y = analog.y;
    } else {
      router.getAxis2D('Move', keyboard);
      move.x = keyboard.x;
      move.y = -keyboard.y || 0;
    }
  }

  function accepts(name) {
    return !heldOnEntry.has(name) && (mode === 'combat' ? combatNames : menuNames).includes(name);
  }
  /** @type {import('../integrations/touch-controls.js').TouchControlsPlayer} */
  const touchPlayer = {
    id: 'p1', yAxis: 'down', bindings,
    setVirtualStick(x = 0, y = 0) {
      const norm = Math.max(1, Math.hypot(x, y));
      stick.x = x / norm;
      stick.y = y / norm;
    },
    clearVirtualStick() { stick.x = 0; stick.y = 0; },
    setVirtualButton(name, down) {
      if (!enabled.has(name)) return false;
      if (down) {
        if (!heldTouch.has(name)) pendingTouch.add(name);
        heldTouch.add(name);
      } else {
        heldTouch.delete(name);
      }
      return true;
    },
    consumeBuffered(name) { return pendingTouch.delete(name); },
  };
  return Object.freeze({
    move, touchPlayer, update, releaseTouch,
    get device() { return physical.device; },
    /** @param {string} name */
    getGlyph(name) { return physical.getGlyph(mode === 'menu' ? 'action-menu' : 'action-combat', name); },
    /** @param {string} name */
    wasPressed(name) { return accepts(name) && router.wasPressed(name); },
    /** @param {string} name */
    isDown(name) { return accepts(name) && router.isDown(name); },
    dispose() {
      unsubscribe();
      releaseTouch();
      physical.dispose();
    },
  });
}
