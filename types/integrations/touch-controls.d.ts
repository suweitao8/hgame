/**
 * Result of applyRadialDeadzone.
 * @typedef {object} RadialDeadzoneResult
 * @property {number} x Normalized stick X in [-1, 1] after deadzone rescaling.
 * @property {number} y Normalized stick Y in [-1, 1] after deadzone rescaling.
 * @property {number} magnitude Stick magnitude in [0, 1].
 * @property {number} knobX Knob offset X in pixels, clamped to the radius.
 * @property {number} knobY Knob offset Y in pixels, clamped to the radius.
 */
/**
 * Convert a pointer offset into a normalized joystick vector with radial deadzone.
 * @param {number} dx Pointer offset from the joystick origin (pixels).
 * @param {number} dy Pointer offset from the joystick origin (pixels).
 * @param {number} radius Joystick radius in pixels (invalid or <= 0 falls back to 56).
 * @param {number} [deadzone=0.12] Fraction of the radius ignored, clamped to [0, 0.95].
 * @returns {RadialDeadzoneResult}
 */
export function applyRadialDeadzone(dx: number, dy: number, radius: number, deadzone?: number | undefined): RadialDeadzoneResult;
/** @typedef {'touch-only' | 'always' | 'hidden'} TouchControlsMode */
/** @typedef {'arc' | 'grid' | 'portrait-arc' | 'action'} TouchButtonLayout */
/**
 * One action button binding of a player controller (from createArcadeControls).
 * @typedef {object} TouchControlsBinding
 * @property {string} name Action name.
 * @property {string} label Button caption.
 * @property {string} slot Arcade slot key ('j' 'k' 'l' 'u' 'i' 'o' primary; 'q' 'e' extra).
 * @property {string} keyLabel Keyboard hint text.
 * @property {boolean} isExtra True for the smaller extra slots.
 */
/**
 * Player controller contract consumed by touch controls (a player from createArcadeControls).
 * @typedef {object} TouchControlsPlayer
 * @property {string} [id] Player id used for the data-player attribute.
 * @property {'up' | 'down'} [yAxis] Virtual stick Y convention.
 * @property {readonly TouchControlsBinding[]} bindings Action bindings rendered as buttons.
 * @property {(x?: number, y?: number) => unknown} setVirtualStick Receives the normalized stick vector.
 * @property {() => void} clearVirtualStick Reset the stick.
 * @property {(nameOrSlot: string, down: boolean) => unknown} setVirtualButton Press/release an action.
 * @property {(nameOrSlot: string) => boolean} [consumeBuffered] Discard a pending button action when focus is lost or the page becomes hidden.
 */
/**
 * @typedef {object} TouchControlsOptions
 * @property {TouchControlsPlayer | { players: readonly TouchControlsPlayer[] }} controls Arcade controls (one pane per player) or a single player (required).
 * @property {HTMLElement | null} [container=document.body] Element the overlay is appended to.
 * @property {Document | null} [documentRef=globalThis.document] Document used to create elements.
 * @property {Window | null} [windowRef=globalThis.window] Window used for events, sizing and coarse-pointer detection.
 * @property {Navigator | null} [navigatorRef=globalThis.navigator] Navigator used for maxTouchPoints detection.
 * @property {TouchControlsMode} [mode='touch-only'] Visibility: 'touch-only' shows after touch detection, 'always', or 'hidden'.
 * @property {'floating' | 'fixed' | false} [joystick='floating'] Joystick style, or false to disable it.
 * @property {number} [joystickRadius=56] Joystick radius in CSS pixels (16..240).
 * @property {number} [deadzone=0.12] Radial deadzone fraction in [0, 0.95).
 * @property {TouchButtonLayout} [buttonLayout='arc'] Button cluster layout.
 * @property {boolean | 'auto'} [showKeyHints='auto'] Show keyboard hints; 'auto' hides them on coarse-pointer devices.
 * @property {'auto' | 'horizontal' | 'vertical'} [splitDirection='auto'] Pane split direction for multiple players.
 */
/**
 * @typedef {object} TouchControls
 * @property {HTMLElement} root Overlay root element.
 * @property {boolean} visible Whether the overlay is currently visible (getter).
 * @property {TouchControlsMode} mode Current mode (getter).
 * @property {TouchButtonLayout} buttonLayout Current layout (getter).
 * @property {(mode: TouchControlsMode) => void} setMode Change the visibility mode.
 * @property {(layout: TouchButtonLayout) => void} setButtonLayout Change the button layout.
 * @property {(nameOrSlot: string, remainingSeconds: number, totalSeconds?: number, playerIndex?: number) => boolean} setCooldown Show a cooldown overlay (seconds); false if the button is unknown.
 * @property {(nameOrSlot: string, enabled: boolean, playerIndex?: number) => boolean} setButtonEnabled Enable/disable a button; false if unknown.
 * @property {(nameOrSlot: string, label: string, playerIndex?: number) => boolean} setButtonLabel Replace a button caption; false if unknown.
 * @property {() => void} refreshLayout Recompute pane rectangles from the window size.
 * @property {() => void} releaseAll Release the stick and all buttons.
 * @property {() => boolean} dispose Remove the overlay and listeners; false if already disposed.
 */
/**
 * Opt-in virtual joystick + skill button overlay synced with `createArcadeControls`.
 * Default mode `'touch-only'` stays invisible on desktop mouse/keyboard until touch is detected.
 * @param {TouchControlsOptions} options
 * @returns {Readonly<TouchControls>}
 */
export function createTouchControls({ controls, container, documentRef, windowRef, navigatorRef, mode, joystick, joystickRadius, deadzone, buttonLayout, showKeyHints, splitDirection, }?: TouchControlsOptions): Readonly<TouchControls>;
/**
 * Result of applyRadialDeadzone.
 */
export type RadialDeadzoneResult = {
    /**
     * Normalized stick X in [-1, 1] after deadzone rescaling.
     */
    x: number;
    /**
     * Normalized stick Y in [-1, 1] after deadzone rescaling.
     */
    y: number;
    /**
     * Stick magnitude in [0, 1].
     */
    magnitude: number;
    /**
     * Knob offset X in pixels, clamped to the radius.
     */
    knobX: number;
    /**
     * Knob offset Y in pixels, clamped to the radius.
     */
    knobY: number;
};
export type TouchControlsMode = "touch-only" | "always" | "hidden";
export type TouchButtonLayout = "arc" | "grid" | "portrait-arc" | "action";
/**
 * One action button binding of a player controller (from createArcadeControls).
 */
export type TouchControlsBinding = {
    /**
     * Action name.
     */
    name: string;
    /**
     * Button caption.
     */
    label: string;
    /**
     * Arcade slot key ('j' 'k' 'l' 'u' 'i' 'o' primary; 'q' 'e' extra).
     */
    slot: string;
    /**
     * Keyboard hint text.
     */
    keyLabel: string;
    /**
     * True for the smaller extra slots.
     */
    isExtra: boolean;
};
/**
 * Player controller contract consumed by touch controls (a player from createArcadeControls).
 */
export type TouchControlsPlayer = {
    /**
     * Player id used for the data-player attribute.
     */
    id?: string | undefined;
    /**
     * Virtual stick Y convention.
     */
    yAxis?: "down" | "up" | undefined;
    /**
     * Action bindings rendered as buttons.
     */
    bindings: readonly TouchControlsBinding[];
    /**
     * Receives the normalized stick vector.
     */
    setVirtualStick: (x?: number, y?: number) => unknown;
    /**
     * Reset the stick.
     */
    clearVirtualStick: () => void;
    /**
     * Press/release an action.
     */
    setVirtualButton: (nameOrSlot: string, down: boolean) => unknown;
    /**
     * Discard a pending button action when focus is lost or the page becomes hidden.
     */
    consumeBuffered?: ((nameOrSlot: string) => boolean) | undefined;
};
export type TouchControlsOptions = {
    /**
     * Arcade controls (one pane per player) or a single player (required).
     */
    controls: TouchControlsPlayer | {
        players: readonly TouchControlsPlayer[];
    };
    /**
     * Element the overlay is appended to.
     */
    container?: HTMLElement | null | undefined;
    /**
     * Document used to create elements.
     */
    documentRef?: Document | null | undefined;
    /**
     * Window used for events, sizing and coarse-pointer detection.
     */
    windowRef?: Window | null | undefined;
    /**
     * Navigator used for maxTouchPoints detection.
     */
    navigatorRef?: Navigator | null | undefined;
    /**
     * Visibility: 'touch-only' shows after touch detection, 'always', or 'hidden'.
     */
    mode?: TouchControlsMode | undefined;
    /**
     * Joystick style, or false to disable it.
     */
    joystick?: false | "fixed" | "floating" | undefined;
    /**
     * Joystick radius in CSS pixels (16..240).
     */
    joystickRadius?: number | undefined;
    /**
     * Radial deadzone fraction in [0, 0.95).
     */
    deadzone?: number | undefined;
    /**
     * Button cluster layout.
     */
    buttonLayout?: TouchButtonLayout | undefined;
    /**
     * Show keyboard hints; 'auto' hides them on coarse-pointer devices.
     */
    showKeyHints?: boolean | "auto" | undefined;
    /**
     * Pane split direction for multiple players.
     */
    splitDirection?: "auto" | "vertical" | "horizontal" | undefined;
};
export type TouchControls = {
    /**
     * Overlay root element.
     */
    root: HTMLElement;
    /**
     * Whether the overlay is currently visible (getter).
     */
    visible: boolean;
    /**
     * Current mode (getter).
     */
    mode: TouchControlsMode;
    /**
     * Current layout (getter).
     */
    buttonLayout: TouchButtonLayout;
    /**
     * Change the visibility mode.
     */
    setMode: (mode: TouchControlsMode) => void;
    /**
     * Change the button layout.
     */
    setButtonLayout: (layout: TouchButtonLayout) => void;
    /**
     * Show a cooldown overlay (seconds); false if the button is unknown.
     */
    setCooldown: (nameOrSlot: string, remainingSeconds: number, totalSeconds?: number, playerIndex?: number) => boolean;
    /**
     * Enable/disable a button; false if unknown.
     */
    setButtonEnabled: (nameOrSlot: string, enabled: boolean, playerIndex?: number) => boolean;
    /**
     * Replace a button caption; false if unknown.
     */
    setButtonLabel: (nameOrSlot: string, label: string, playerIndex?: number) => boolean;
    /**
     * Recompute pane rectangles from the window size.
     */
    refreshLayout: () => void;
    /**
     * Release the stick and all buttons.
     */
    releaseAll: () => void;
    /**
     * Remove the overlay and listeners; false if already disposed.
     */
    dispose: () => boolean;
};
