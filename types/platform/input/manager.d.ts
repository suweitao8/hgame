/**
 * @typedef {object} InputManagerOptions
 * @property {EventTarget | null} [target] Event source (default `globalThis.window`).
 * @property {boolean} [focused=true] Initial focus state; unfocused managers ignore input.
 * @property {Iterable<string>} [preventDefaultKeys=[]] `KeyboardEvent.code` values whose default action is prevented.
 */
/**
 * @typedef {object} PointerState Primary pointer snapshot (client coordinates in pixels).
 * @property {number} x
 * @property {number} y
 * @property {number} buttons `PointerEvent.buttons` bit mask (1 = left, 2 = right, 4 = middle).
 * @property {number | null} id Pointer id of the primary pointer, or null when none is down.
 */
/**
 * @typedef {object} TrackedPointer Active pointer (mouse, touch or pen).
 * @property {number | 'mouse'} id
 * @property {number} x Client x in pixels.
 * @property {number} y Client y in pixels.
 * @property {number} startX Client x at press, pixels.
 * @property {number} startY Client y at press, pixels.
 * @property {number} prevX Previous x, pixels.
 * @property {number} prevY Previous y, pixels.
 * @property {number} dx Movement accumulated this frame, pixels (reset by `endFrame`).
 * @property {number} dy Movement accumulated this frame, pixels.
 * @property {string} pointerType `'mouse'`, `'touch'` or `'pen'`.
 * @property {number} button Button that started the press (0 = primary).
 * @property {number} buttons Current button mask.
 */
/**
 * @typedef {object} InputEvents
 * @property {{ code: string, repeat: boolean, originalEvent: KeyboardEvent }} keydown
 * @property {{ code: string, originalEvent: KeyboardEvent }} keyup
 * @property {PointerState & { pointerType: string, originalEvent: PointerEvent }} pointermove
 * @property {PointerState & { pointerType: string, button: number, originalEvent: PointerEvent }} pointerdown
 * @property {PointerState & { pointerType: string, button: number, originalEvent: PointerEvent }} pointerup
 * @property {PointerState & { pointerType: string, button: number, originalEvent: PointerEvent }} pointercancel
 * @property {boolean} focus
 */
/**
 * @typedef {object} InputManager Keyboard and pointer state with per-frame edge detection.
 * @property {Readonly<PointerState>} pointer Copy of the primary pointer state.
 * @property {TrackedPointer[]} pointers Copies of all active pointers.
 * @property {number} pointerCount
 * @property {(id: number | 'mouse') => TrackedPointer | null} getPointer
 * @property {boolean} focused
 * @property {(code: string) => boolean} isDown Key currently held (`KeyboardEvent.code`).
 * @property {(code: string) => boolean} wasPressed Key went down since the last `endFrame`.
 * @property {(code: string) => boolean} wasReleased Key went up since the last `endFrame`.
 * @property {(button?: number) => boolean} isPointerDown Default button 0 (any touch/pen counts as 0).
 * @property {(button?: number) => boolean} wasPointerPressed
 * @property {(button?: number) => boolean} wasPointerReleased
 * @property {(codes: string | Iterable<string>) => number} preventKeys Add default-prevented keys; returns the set size.
 * @property {() => void} endFrame Clear edge flags and per-frame pointer deltas (call once per tick).
 * @property {(focused: boolean) => boolean} setFocused
 * @property {() => void} reset Release all keys/pointers.
 * @property {import('../events.js').Emitter<InputEvents>['on']} on
 * @property {() => void} dispose
 */
/**
 * Create the keyboard / pointer input manager.
 * @param {InputManagerOptions} [options]
 * @returns {InputManager}
 */
export function createInputManager({ target, focused, preventDefaultKeys, }?: InputManagerOptions | undefined): InputManager;
export type InputManagerOptions = {
    /**
     * Event source (default `globalThis.window`).
     */
    target?: EventTarget | null | undefined;
    /**
     * Initial focus state; unfocused managers ignore input.
     */
    focused?: boolean | undefined;
    /**
     * `KeyboardEvent.code` values whose default action is prevented.
     */
    preventDefaultKeys?: Iterable<string> | undefined;
};
/**
 * Primary pointer snapshot (client coordinates in pixels).
 */
export type PointerState = {
    x: number;
    y: number;
    /**
     * `PointerEvent.buttons` bit mask (1 = left, 2 = right, 4 = middle).
     */
    buttons: number;
    /**
     * Pointer id of the primary pointer, or null when none is down.
     */
    id: number | null;
};
/**
 * Active pointer (mouse, touch or pen).
 */
export type TrackedPointer = {
    id: number | "mouse";
    /**
     * Client x in pixels.
     */
    x: number;
    /**
     * Client y in pixels.
     */
    y: number;
    /**
     * Client x at press, pixels.
     */
    startX: number;
    /**
     * Client y at press, pixels.
     */
    startY: number;
    /**
     * Previous x, pixels.
     */
    prevX: number;
    /**
     * Previous y, pixels.
     */
    prevY: number;
    /**
     * Movement accumulated this frame, pixels (reset by `endFrame`).
     */
    dx: number;
    /**
     * Movement accumulated this frame, pixels.
     */
    dy: number;
    /**
     * `'mouse'`, `'touch'` or `'pen'`.
     */
    pointerType: string;
    /**
     * Button that started the press (0 = primary).
     */
    button: number;
    /**
     * Current button mask.
     */
    buttons: number;
};
export type InputEvents = {
    keydown: {
        code: string;
        repeat: boolean;
        originalEvent: KeyboardEvent;
    };
    keyup: {
        code: string;
        originalEvent: KeyboardEvent;
    };
    pointermove: PointerState & {
        pointerType: string;
        originalEvent: PointerEvent;
    };
    pointerdown: PointerState & {
        pointerType: string;
        button: number;
        originalEvent: PointerEvent;
    };
    pointerup: PointerState & {
        pointerType: string;
        button: number;
        originalEvent: PointerEvent;
    };
    pointercancel: PointerState & {
        pointerType: string;
        button: number;
        originalEvent: PointerEvent;
    };
    focus: boolean;
};
/**
 * Keyboard and pointer state with per-frame edge detection.
 */
export type InputManager = {
    /**
     * Copy of the primary pointer state.
     */
    pointer: Readonly<PointerState>;
    /**
     * Copies of all active pointers.
     */
    pointers: TrackedPointer[];
    pointerCount: number;
    getPointer: (id: number | "mouse") => TrackedPointer | null;
    focused: boolean;
    /**
     * Key currently held (`KeyboardEvent.code`).
     */
    isDown: (code: string) => boolean;
    /**
     * Key went down since the last `endFrame`.
     */
    wasPressed: (code: string) => boolean;
    /**
     * Key went up since the last `endFrame`.
     */
    wasReleased: (code: string) => boolean;
    /**
     * Default button 0 (any touch/pen counts as 0).
     */
    isPointerDown: (button?: number) => boolean;
    wasPointerPressed: (button?: number) => boolean;
    wasPointerReleased: (button?: number) => boolean;
    /**
     * Add default-prevented keys; returns the set size.
     */
    preventKeys: (codes: string | Iterable<string>) => number;
    /**
     * Clear edge flags and per-frame pointer deltas (call once per tick).
     */
    endFrame: () => void;
    setFocused: (focused: boolean) => boolean;
    /**
     * Release all keys/pointers.
     */
    reset: () => void;
    on: import("../events.js").Emitter<InputEvents>["on"];
    dispose: () => void;
};
