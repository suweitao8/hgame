import { defineInputContext } from './contexts.js';
import { createInputActionRouter } from './router.js';

/**
 * @typedef {'j' | 'k' | 'l' | 'u' | 'i' | 'o' | 'q' | 'e'} ArcadeSlot Button slots (P2 maps them to 1-6, 0 and `.`).
 */

/**
 * @typedef {object} ArcadeActionEntry
 * @property {string} name Action name.
 * @property {string} [label] Display label (default: `name`).
 * @property {ArcadeSlot} [slot] Explicit slot (auto-assigned when omitted).
 * @property {number} [bufferWindow] Input buffer, seconds (default: controls `bufferWindow`).
 */

/** @typedef {string | ArcadeActionEntry} ArcadeActionSpec */

/**
 * @typedef {object} ArcadeKeymap
 * @property {'p1' | 'p2'} id
 * @property {{ up: readonly string[], left: readonly string[], down: readonly string[], right: readonly string[] }} move `KeyboardEvent.code` lists.
 * @property {Readonly<Record<'j' | 'k' | 'l' | 'u' | 'i' | 'o', readonly string[]>>} primary
 * @property {Readonly<Record<'q' | 'e', readonly string[]>>} extra
 * @property {Readonly<Record<string, string>>} labels Human-readable key labels by direction / slot.
 */

/**
 * @typedef {object} ArcadeControlsOptions
 * @property {import('./manager.js').InputManager | null} [input]
 * @property {((code: string) => boolean) | null} [readCode] Extra key reader (e.g. touch buttons).
 * @property {1 | 2} [players=1] Local player count.
 * @property {readonly ArcadeActionSpec[]} [actions] Up to 6 primary actions (default: slots `j k l u i o`).
 * @property {readonly ArcadeActionSpec[]} [extras=[]] Up to 2 extra actions (slots `q`, `e`).
 * @property {boolean} [enableExtras=false] Allow more than 6 actions / extra slots.
 * @property {number} [bufferWindow=0.1] Default input buffer, seconds.
 * @property {'down' | 'up'} [yAxis='down'] Positive-y direction of `move` (`'down'` = screen coordinates).
 * @property {boolean} [preventBrowserScroll=true] Prevent arrow-key page scroll for 2-player mode.
 */

/**
 * @typedef {object} ArcadeBinding
 * @property {string} name
 * @property {string} label
 * @property {ArcadeSlot} slot
 * @property {readonly string[]} keys `KeyboardEvent.code` values.
 * @property {string} keyLabel
 * @property {boolean} isExtra
 * @property {number} bufferWindow Seconds.
 */

/**
 * @typedef {object} ArcadeMove
 * @property {number} x -1..1
 * @property {number} y -1..1 (sign follows `yAxis`)
 * @property {number} magnitude 0..1
 * @property {boolean} active
 */

/**
 * @typedef {object} ArcadePlayerController
 * @property {number} index 0-based player index.
 * @property {'p1' | 'p2'} id
 * @property {'down' | 'up'} yAxis
 * @property {ArcadeKeymap} keymap
 * @property {readonly ArcadeBinding[]} bindings
 * @property {import('./router.js').InputActionRouter} router
 * @property {ArcadeMove} move Snapshot copy of the movement state.
 * @property {<T extends ArcadeMove = ArcadeMove>(out?: T) => T} getMove Allocation-free read.
 * @property {(nameOrSlot: string) => boolean} isDown Action name or slot letter.
 * @property {(nameOrSlot: string) => boolean} wasPressed
 * @property {(nameOrSlot: string) => boolean} wasReleased
 * @property {(nameOrSlot: string) => number} heldSeconds
 * @property {(nameOrSlot: string, minSeconds?: number) => boolean} isHeld
 * @property {(nameOrSlot: string) => boolean} isBuffered
 * @property {(nameOrSlot: string) => boolean} consumeBuffered
 * @property {(x?: number, y?: number) => import('./router.js').Vec2Like} setVirtualStick Touch stick, -1..1.
 * @property {() => void} clearVirtualStick
 * @property {(nameOrSlot: string, down: boolean) => boolean} setVirtualButton
 * @property {(dtSeconds?: number) => void} update
 * @property {() => void} reset
 */

/**
 * @typedef {object} ArcadeControls
 * @property {readonly ArcadePlayerController[]} players
 * @property {ArcadePlayerController} p1
 * @property {ArcadePlayerController | null} p2
 * @property {(index: number) => ArcadePlayerController | null} player
 * @property {(dtSeconds?: number) => void} update Update every player (call once per tick).
 * @property {() => void} reset
 */

/** Primary / extra button slot letters. @type {Readonly<{ primary: readonly ArcadeSlot[], extra: readonly ArcadeSlot[], all: readonly ArcadeSlot[] }>} */
export const ARCADE_SLOTS = Object.freeze({
  primary: Object.freeze(['j', 'k', 'l', 'u', 'i', 'o']),
  extra: Object.freeze(['q', 'e']),
  all: Object.freeze(['j', 'k', 'l', 'u', 'i', 'o', 'q', 'e']),
});

/** Default P1 / P2 key mappings. @type {Readonly<{ p1: ArcadeKeymap, p2: ArcadeKeymap }>} */
export const PLAYER_KEYMAPS = Object.freeze({
  p1: Object.freeze({
    id: 'p1',
    move: Object.freeze({ up: ['KeyW'], left: ['KeyA'], down: ['KeyS'], right: ['KeyD'] }),
    primary: Object.freeze({
      j: ['KeyJ'],
      k: ['KeyK'],
      l: ['KeyL'],
      u: ['KeyU'],
      i: ['KeyI'],
      o: ['KeyO'],
    }),
    extra: Object.freeze({
      q: ['KeyQ'],
      e: ['KeyE'],
    }),
    labels: Object.freeze({
      up: 'W', left: 'A', down: 'S', right: 'D',
      j: 'J', k: 'K', l: 'L', u: 'U', i: 'I', o: 'O', q: 'Q', e: 'E',
    }),
  }),
  p2: Object.freeze({
    id: 'p2',
    move: Object.freeze({ up: ['ArrowUp'], left: ['ArrowLeft'], down: ['ArrowDown'], right: ['ArrowRight'] }),
    primary: Object.freeze({
      j: ['Numpad1', 'Digit1'],
      k: ['Numpad2', 'Digit2'],
      l: ['Numpad3', 'Digit3'],
      u: ['Numpad4', 'Digit4'],
      i: ['Numpad5', 'Digit5'],
      o: ['Numpad6', 'Digit6'],
    }),
    extra: Object.freeze({
      q: ['Numpad0', 'Digit0'],
      e: ['NumpadDecimal', 'Period'],
    }),
    labels: Object.freeze({
      up: '↑', left: '←', down: '↓', right: '→',
      j: '1', k: '2', l: '3', u: '4', i: '5', o: '6', q: '0', e: '.',
    }),
  }),
});

/**
 * @param {readonly ArcadeActionSpec[]} actions
 * @param {readonly ArcadeActionSpec[]} extras
 * @param {boolean} enableExtras
 * @param {number} defaultBufferWindow
 * @returns {{ name: string, label: string, slot: ArcadeSlot, isExtra: boolean, bufferWindow: number }[]}
 */
function resolveArcadeSpecs(actions, extras, enableExtras, defaultBufferWindow) {
  if (!Array.isArray(actions)) {
    throw new TypeError('Arcade controls actions must be an array');
  }
  if (!Array.isArray(extras)) {
    throw new TypeError('Arcade controls extras must be an array');
  }
  if (actions.length > 6 && !enableExtras) {
    throw new RangeError('Primary arcade controls support at most 6 actions (j/k/l/u/i/o); pass extras or enableExtras: true to use extra slots (q/e and 0/.)');
  }
  if (extras.length > 2) {
    throw new RangeError('Arcade controls support at most 2 extra actions (q/e and 0/.)');
  }
  if (actions.length + extras.length > 8) {
    throw new RangeError('Arcade controls support at most 6 primary + 2 extra actions');
  }

  const usedSlots = new Set();
  const usedNames = new Set();
  /** @type {{ name: string, label: string, slot: ArcadeSlot, isExtra: boolean, bufferWindow: number }[]} */
  const entries = [];

  function normalizeItem(item, forceExtra) {
    if (typeof item === 'string') {
      if (!item) throw new TypeError('Arcade action name must be non-empty');
      return { name: item, label: item, slot: null, bufferWindow: defaultBufferWindow, forceExtra };
    }
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name) {
      throw new TypeError('Arcade action entry must be a string or { name, label?, slot?, bufferWindow? }');
    }
    const slot = item.slot ?? null;
    if (slot !== null && !ARCADE_SLOTS.all.includes(slot)) {
      throw new RangeError(`Unsupported arcade button slot "${slot}"; expected one of ${ARCADE_SLOTS.all.join(', ')}`);
    }
    const isExtraSlot = slot !== null && ARCADE_SLOTS.extra.includes(slot);
    if (!forceExtra && isExtraSlot && !enableExtras) {
      throw new RangeError(`Extra slot "${slot}" requires extras or enableExtras: true`);
    }
    if (forceExtra && slot !== null && !isExtraSlot) {
      throw new RangeError(`extras entries must use extra slots (q/e), got "${slot}"`);
    }
    const buf = item.bufferWindow !== undefined ? Number(item.bufferWindow) : defaultBufferWindow;
    if (!Number.isFinite(buf) || buf < 0) {
      throw new RangeError('Arcade action bufferWindow must be >= 0');
    }
    return {
      name: item.name,
      label: typeof item.label === 'string' && item.label ? item.label : item.name,
      slot,
      bufferWindow: buf,
      forceExtra: forceExtra || isExtraSlot,
    };
  }

  const parsed = [
    ...actions.map((item, idx) => normalizeItem(item, idx >= 6)),
    ...extras.map(item => normalizeItem(item, true)),
  ];

  // Reserve explicit slots first so auto-assigned items never collide.
  for (const spec of parsed) {
    if (usedNames.has(spec.name)) {
      throw new Error(`Duplicate arcade action name "${spec.name}"`);
    }
    usedNames.add(spec.name);
    if (spec.slot) {
      if (usedSlots.has(spec.slot)) {
        throw new Error(`Duplicate arcade button slot "${spec.slot}"`);
      }
      usedSlots.add(spec.slot);
    }
  }

  for (const spec of parsed) {
    let slot = spec.slot;
    if (!slot) {
      const pool = spec.forceExtra
        ? ARCADE_SLOTS.extra
        : (enableExtras ? ARCADE_SLOTS.all : ARCADE_SLOTS.primary);
      slot = pool.find(candidate => !usedSlots.has(candidate)) ?? null;
      if (!slot) {
        throw new RangeError('No available arcade button slots remaining for action "' + spec.name + '"');
      }
      usedSlots.add(slot);
    }
    entries.push({
      name: spec.name,
      label: spec.label,
      slot,
      isExtra: ARCADE_SLOTS.extra.includes(slot),
      bufferWindow: spec.bufferWindow,
    });
  }

  return entries;
}

/**
 * Standardized Mobile-Touch + PC + 2P Split-Screen Arcade Controller.
 *
 * - P1: WASD + J K L U I O (optional extras Q E)
 * - P2: Arrow Keys + 1 2 3 4 5 6 (optional extras 0 .)
 *
 * @param {ArcadeControlsOptions} [options]
 * @returns {ArcadeControls}
 */
export function createArcadeControls({
  input = null,
  readCode = null,
  players = 1,
  actions = ARCADE_SLOTS.primary,
  extras = [],
  enableExtras = false,
  bufferWindow = 0.1,
  yAxis = 'down',
  preventBrowserScroll = true,
} = {}) {
  if (players !== 1 && players !== 2) {
    throw new RangeError('Arcade controls support 1 or 2 local players');
  }
  if (yAxis !== 'down' && yAxis !== 'up') {
    throw new RangeError('Arcade controls yAxis must be "down" or "up"');
  }

  const specs = resolveArcadeSpecs(actions, extras, enableExtras, bufferWindow);

  if (preventBrowserScroll && input?.preventKeys && players === 2) {
    input.preventKeys(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  }

  /** @param {number} index @param {ArcadeKeymap} keymap @returns {ArcadePlayerController} */
  function createPlayerController(index, keymap) {
    const router = createInputActionRouter({ input, readCode });
    const ctxActions = {};
    const nameLookup = new Map();
    /** @type {ArcadeBinding[]} */
    const bindings = [];

    for (const spec of specs) {
      const keys = spec.isExtra ? keymap.extra[spec.slot] : keymap.primary[spec.slot];
      ctxActions[spec.name] = { keys, bufferWindow: spec.bufferWindow };
      nameLookup.set(spec.name, spec.name);
      nameLookup.set(spec.slot, spec.name);
      bindings.push(Object.freeze({
        name: spec.name,
        label: spec.label,
        slot: spec.slot,
        keys: Object.freeze([...keys]),
        keyLabel: keymap.labels[spec.slot],
        isExtra: spec.isExtra,
        bufferWindow: spec.bufferWindow,
      }));
    }

    const context = defineInputContext(`Arcade_${keymap.id}`, {
      priority: 0,
      consumesKeys: true,
      bufferWindow,
      actions: ctxActions,
      axes2D: {
        Move: {
          up: keymap.move.up,
          down: keymap.move.down,
          left: keymap.move.left,
          right: keymap.move.right,
          normalize: true,
        },
      },
    });
    router.pushContext(context);

    const scratchMove = { x: 0, y: 0 };
    const moveState = { x: 0, y: 0, magnitude: 0, active: false };
    const frozenBindings = Object.freeze(bindings);

    function resolveActionName(nameOrSlot) {
      return nameLookup.get(nameOrSlot) ?? null;
    }

    function setVirtualStick(x = 0, y = 0) {
      const vx = Number.isFinite(x) ? x : 0;
      const vy = Number.isFinite(y) ? y : 0;
      const mapped = router.setVirtualAxis2D('Move', vx, yAxis === 'down' ? -vy : vy);
      return { x: mapped.x, y: yAxis === 'down' ? -mapped.y : mapped.y };
    }

    function clearVirtualStick() {
      router.setVirtualAxis2D('Move', 0, 0);
    }

    function setVirtualButton(nameOrSlot, down) {
      const actionName = resolveActionName(nameOrSlot);
      if (!actionName) return false;
      return router.setVirtualAction(actionName, Boolean(down));
    }

    function update(dt = 0) {
      router.update(dt);
      router.getAxis2D('Move', scratchMove);
      const mx = scratchMove.x || 0;
      const my = (yAxis === 'down' ? -scratchMove.y : scratchMove.y) || 0;
      moveState.x = mx;
      moveState.y = my;
      moveState.magnitude = Math.min(1, Math.hypot(mx, my));
      moveState.active = moveState.magnitude > 1e-5;
    }

    function getMove(out = { x: 0, y: 0, magnitude: 0, active: false }) {
      out.x = moveState.x;
      out.y = moveState.y;
      out.magnitude = moveState.magnitude;
      out.active = moveState.active;
      return out;
    }

    function reset() {
      router.reset();
      moveState.x = 0;
      moveState.y = 0;
      moveState.magnitude = 0;
      moveState.active = false;
    }

    return Object.freeze({
      index,
      id: keymap.id,
      yAxis,
      keymap,
      bindings: frozenBindings,
      router,
      get move() { return { ...moveState }; },
      getMove,
      isDown(nameOrSlot) {
        const name = resolveActionName(nameOrSlot);
        return name ? router.isDown(name) : false;
      },
      wasPressed(nameOrSlot) {
        const name = resolveActionName(nameOrSlot);
        return name ? router.wasPressed(name) : false;
      },
      wasReleased(nameOrSlot) {
        const name = resolveActionName(nameOrSlot);
        return name ? router.wasReleased(name) : false;
      },
      heldSeconds(nameOrSlot) {
        const name = resolveActionName(nameOrSlot);
        return name ? router.heldSeconds(name) : 0;
      },
      isHeld(nameOrSlot, minSeconds = 0) {
        const name = resolveActionName(nameOrSlot);
        return name ? router.isHeld(name, minSeconds) : false;
      },
      isBuffered(nameOrSlot) {
        const name = resolveActionName(nameOrSlot);
        return name ? router.isBuffered(name) : false;
      },
      consumeBuffered(nameOrSlot) {
        const name = resolveActionName(nameOrSlot);
        return name ? router.consumeBuffered(name) : false;
      },
      setVirtualStick,
      clearVirtualStick,
      setVirtualButton,
      update,
      reset,
    });
  }

  const playerControllers = Object.freeze(
    players === 2
      ? [createPlayerController(0, PLAYER_KEYMAPS.p1), createPlayerController(1, PLAYER_KEYMAPS.p2)]
      : [createPlayerController(0, PLAYER_KEYMAPS.p1)]
  );

  return Object.freeze({
    players: playerControllers,
    p1: playerControllers[0],
    p2: playerControllers[1] ?? null,
    player(index) {
      return playerControllers[index] ?? null;
    },
    update(dt = 0) {
      for (let i = 0; i < playerControllers.length; i++) {
        playerControllers[i].update(dt);
      }
    },
    reset() {
      for (let i = 0; i < playerControllers.length; i++) {
        playerControllers[i].reset();
      }
    },
  });
}
