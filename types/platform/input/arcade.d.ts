/**
 * Standardized Mobile-Touch + PC + 2P Split-Screen Arcade Controller.
 *
 * - P1: WASD + J K L U I O (optional extras Q E)
 * - P2: Arrow Keys + 1 2 3 4 5 6 (optional extras 0 .)
 *
 * @param {ArcadeControlsOptions} [options]
 * @returns {ArcadeControls}
 */
export function createArcadeControls({ input, readCode, players, actions, extras, enableExtras, bufferWindow, yAxis, preventBrowserScroll, }?: ArcadeControlsOptions): ArcadeControls;
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
export const ARCADE_SLOTS: Readonly<{
    primary: readonly ArcadeSlot[];
    extra: readonly ArcadeSlot[];
    all: readonly ArcadeSlot[];
}>;
/** Default P1 / P2 key mappings. @type {Readonly<{ p1: ArcadeKeymap, p2: ArcadeKeymap }>} */
export const PLAYER_KEYMAPS: Readonly<{
    p1: ArcadeKeymap;
    p2: ArcadeKeymap;
}>;
/**
 * Button slots (P2 maps them to 1-6, 0 and `.`).
 */
export type ArcadeSlot = "j" | "k" | "l" | "u" | "i" | "o" | "q" | "e";
export type ArcadeActionEntry = {
    /**
     * Action name.
     */
    name: string;
    /**
     * Display label (default: `name`).
     */
    label?: string;
    /**
     * Explicit slot (auto-assigned when omitted).
     */
    slot?: ArcadeSlot;
    /**
     * Input buffer, seconds (default: controls `bufferWindow`).
     */
    bufferWindow?: number;
};
export type ArcadeActionSpec = string | ArcadeActionEntry;
export type ArcadeKeymap = {
    id: "p1" | "p2";
    /**
     * `KeyboardEvent.code` lists.
     */
    move: {
        up: readonly string[];
        left: readonly string[];
        down: readonly string[];
        right: readonly string[];
    };
    primary: Readonly<Record<"j" | "k" | "l" | "u" | "i" | "o", readonly string[]>>;
    extra: Readonly<Record<"q" | "e", readonly string[]>>;
    /**
     * Human-readable key labels by direction / slot.
     */
    labels: Readonly<Record<string, string>>;
};
export type ArcadeControlsOptions = {
    input?: import("./manager.js").InputManager | null;
    /**
     * Extra key reader (e.g. touch buttons).
     */
    readCode?: ((code: string) => boolean) | null;
    /**
     * Local player count.
     */
    players?: 1 | 2;
    /**
     * Up to 6 primary actions (default: slots `j k l u i o`).
     */
    actions?: readonly ArcadeActionSpec[];
    /**
     * Up to 2 extra actions (slots `q`, `e`).
     */
    extras?: readonly ArcadeActionSpec[];
    /**
     * Allow more than 6 actions / extra slots.
     */
    enableExtras?: boolean;
    /**
     * Default input buffer, seconds.
     */
    bufferWindow?: number;
    /**
     * Positive-y direction of `move` (`'down'` = screen coordinates).
     */
    yAxis?: "down" | "up";
    /**
     * Prevent arrow-key page scroll for 2-player mode.
     */
    preventBrowserScroll?: boolean;
};
export type ArcadeBinding = {
    name: string;
    label: string;
    slot: ArcadeSlot;
    /**
     * `KeyboardEvent.code` values.
     */
    keys: readonly string[];
    keyLabel: string;
    isExtra: boolean;
    /**
     * Seconds.
     */
    bufferWindow: number;
};
export type ArcadeMove = {
    /**
     * -1..1
     */
    x: number;
    /**
     * -1..1 (sign follows `yAxis`)
     */
    y: number;
    /**
     * 0..1
     */
    magnitude: number;
    active: boolean;
};
export type ArcadePlayerController = {
    /**
     * 0-based player index.
     */
    index: number;
    id: "p1" | "p2";
    yAxis: "down" | "up";
    keymap: ArcadeKeymap;
    bindings: readonly ArcadeBinding[];
    router: import("./router.js").InputActionRouter;
    /**
     * Snapshot copy of the movement state.
     */
    move: ArcadeMove;
    /**
     * Allocation-free read.
     */
    getMove: <T extends ArcadeMove = ArcadeMove>(out?: T) => T;
    /**
     * Action name or slot letter.
     */
    isDown: (nameOrSlot: string) => boolean;
    wasPressed: (nameOrSlot: string) => boolean;
    wasReleased: (nameOrSlot: string) => boolean;
    heldSeconds: (nameOrSlot: string) => number;
    isHeld: (nameOrSlot: string, minSeconds?: number) => boolean;
    isBuffered: (nameOrSlot: string) => boolean;
    consumeBuffered: (nameOrSlot: string) => boolean;
    /**
     * Touch stick, -1..1.
     */
    setVirtualStick: (x?: number, y?: number) => import("./router.js").Vec2Like;
    clearVirtualStick: () => void;
    setVirtualButton: (nameOrSlot: string, down: boolean) => boolean;
    update: (dtSeconds?: number) => void;
    reset: () => void;
};
export type ArcadeControls = {
    players: readonly ArcadePlayerController[];
    p1: ArcadePlayerController;
    p2: ArcadePlayerController | null;
    player: (index: number) => ArcadePlayerController | null;
    /**
     * Update every player (call once per tick).
     */
    update: (dtSeconds?: number) => void;
    reset: () => void;
};
