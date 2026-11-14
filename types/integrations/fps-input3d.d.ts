/**
 * Minimal structural event-target (window / document / canvas).
 * @typedef {object} FpsEventTargetLike
 * @property {(type: string, listener: (event: object) => void, options?: boolean | object) => void} [addEventListener]
 * @property {(type: string, listener: (event: object) => void, options?: boolean | object) => void} [removeEventListener]
 */
/**
 * Interactive canvas surface used for pointer capture, touch zones and pointer lock.
 * @typedef {object} FpsCanvasLike
 * @property {(type: string, listener: (event: object) => void, options?: boolean | object) => void} addEventListener
 * @property {(type: string, listener: (event: object) => void, options?: boolean | object) => void} [removeEventListener]
 * @property {() => {left: number, top: number, width: number, height: number}} getBoundingClientRect
 * @property {(pointerId: number) => void} [setPointerCapture]
 * @property {(pointerId: number) => void} [releasePointerCapture]
 * @property {() => (void | Promise<void>)} [requestPointerLock]
 */
/**
 * Document-like object (pointer lock + visibility).
 * @typedef {FpsEventTargetLike & {pointerLockElement?: object | null, hidden?: boolean, exitPointerLock?: () => void}} FpsDocumentLike
 */
/**
 * Navigator-like object exposing the Gamepad API.
 * @typedef {object} FpsNavigatorLike
 * @property {() => ArrayLike<object | null> | null} [getGamepads]
 */
/**
 * Optional existing keyboard input to read instead of owning key listeners.
 * @typedef {object} FpsKeyInputLike
 * @property {(code: string) => boolean} [isDown] KeyboardEvent.code lookup.
 */
/**
 * @typedef {'fire'|'ads'|'sprint'|'crouch'|'jump'|'reload'|'melee'|'interact'|'pause'} FpsAction
 */
/**
 * Options for {@link createFirstPersonInput3d}.
 * @typedef {object} FirstPersonInput3dOptions
 * @property {FpsCanvasLike} canvas Interactive canvas element (required).
 * @property {FpsEventTargetLike} [windowRef] Window for keyboard/blur events. Default `globalThis.window`.
 * @property {FpsDocumentLike} [documentRef] Document for pointer lock. Default `globalThis.document`.
 * @property {FpsNavigatorLike} [navigatorRef] Navigator for gamepads. Default `globalThis.navigator`.
 * @property {FpsKeyInputLike | null} [keyInput] Existing key input to consume. Default `null`.
 * @property {number} [sensitivity] Look sensitivity multiplier, (0, 10]. Default `1`.
 * @property {boolean} [invertY] Invert vertical look. Default `false`.
 * @property {boolean} [touchEnabled] Enable touch zones. Default `true`.
 * @property {boolean} [gamepadEnabled] Enable standard gamepad. Default `true`.
 * @property {boolean} [pointerLockEnabled] Allow pointer lock. Default `true`.
 * @property {number} [touchRadius] Virtual stick radius in CSS pixels, 16..300. Default `90`.
 * @property {number} [stickDeadzone] Gamepad stick deadzone, [0, 1). Default `0.18`.
 * @property {number} [gamepadLookRate] Gamepad look speed in radians per second at full deflection. Default `2.6`.
 */
/**
 * Per-simulation-step input sample.
 * @typedef {object} FpsInputSample
 * @property {{x: number, y: number}} move Normalised move vector (x right, y back; length <= 1).
 * @property {boolean} fire
 * @property {boolean} ads
 * @property {boolean} sprint
 * @property {boolean} crouch
 * @property {boolean} jump
 * @property {boolean} reload
 * @property {boolean} melee
 * @property {boolean} interact
 * @property {boolean} pause
 * @property {boolean} locked Pointer is locked to the canvas.
 * @property {boolean} touch A touch pointer has been seen.
 * @property {boolean} gamepad A standard gamepad is connected.
 */
/**
 * Accumulated look delta in radians (since last consume).
 * @typedef {object} FpsLookDelta
 * @property {number} dx Yaw delta.
 * @property {number} dy Pitch delta.
 */
/**
 * Frozen controller returned by {@link createFirstPersonInput3d}.
 * @typedef {object} FirstPersonInput3d
 * @property {(dt?: number) => FpsInputSample} sample Sample actions; `dt` seconds, default 1/60.
 * @property {() => FpsLookDelta} consumeLook Read and zero the look delta.
 * @property {() => Promise<boolean>} requestLock Request pointer lock; resolves whether locked.
 * @property {() => void} releaseLock Exit pointer lock if held.
 * @property {() => void} reset Clear all held input state.
 * @property {(name: FpsAction, value: boolean) => void} setAction Set an on-screen overlay action.
 * @property {() => boolean} dispose Remove listeners; false when already disposed.
 * @property {boolean} locked Current pointer-lock state.
 */
/**
 * Create a first-person input adapter (keyboard, pointer lock, touch, gamepad).
 * @param {FirstPersonInput3dOptions} [options]
 * @returns {FirstPersonInput3d}
 */
export function createFirstPersonInput3d({ canvas, windowRef, documentRef, navigatorRef, keyInput, sensitivity, invertY, touchEnabled, gamepadEnabled, pointerLockEnabled, touchRadius, stickDeadzone, gamepadLookRate, }?: FirstPersonInput3dOptions): FirstPersonInput3d;
/**
 * Minimal structural event-target (window / document / canvas).
 */
export type FpsEventTargetLike = {
    addEventListener?: (type: string, listener: (event: object) => void, options?: boolean | object) => void;
    removeEventListener?: (type: string, listener: (event: object) => void, options?: boolean | object) => void;
};
/**
 * Interactive canvas surface used for pointer capture, touch zones and pointer lock.
 */
export type FpsCanvasLike = {
    addEventListener: (type: string, listener: (event: object) => void, options?: boolean | object) => void;
    removeEventListener?: (type: string, listener: (event: object) => void, options?: boolean | object) => void;
    getBoundingClientRect: () => {
        left: number;
        top: number;
        width: number;
        height: number;
    };
    setPointerCapture?: (pointerId: number) => void;
    releasePointerCapture?: (pointerId: number) => void;
    requestPointerLock?: () => (void | Promise<void>);
};
/**
 * Document-like object (pointer lock + visibility).
 */
export type FpsDocumentLike = FpsEventTargetLike & {
    pointerLockElement?: object | null;
    hidden?: boolean;
    exitPointerLock?: () => void;
};
/**
 * Navigator-like object exposing the Gamepad API.
 */
export type FpsNavigatorLike = {
    getGamepads?: () => ArrayLike<object | null> | null;
};
/**
 * Optional existing keyboard input to read instead of owning key listeners.
 */
export type FpsKeyInputLike = {
    /**
     * KeyboardEvent.code lookup.
     */
    isDown?: (code: string) => boolean;
};
export type FpsAction = "fire" | "ads" | "sprint" | "crouch" | "jump" | "reload" | "melee" | "interact" | "pause";
/**
 * Options for {@link createFirstPersonInput3d}.
 */
export type FirstPersonInput3dOptions = {
    /**
     * Interactive canvas element (required).
     */
    canvas: FpsCanvasLike;
    /**
     * Window for keyboard/blur events. Default `globalThis.window`.
     */
    windowRef?: FpsEventTargetLike;
    /**
     * Document for pointer lock. Default `globalThis.document`.
     */
    documentRef?: FpsDocumentLike;
    /**
     * Navigator for gamepads. Default `globalThis.navigator`.
     */
    navigatorRef?: FpsNavigatorLike;
    /**
     * Existing key input to consume. Default `null`.
     */
    keyInput?: FpsKeyInputLike | null;
    /**
     * Look sensitivity multiplier, (0, 10]. Default `1`.
     */
    sensitivity?: number;
    /**
     * Invert vertical look. Default `false`.
     */
    invertY?: boolean;
    /**
     * Enable touch zones. Default `true`.
     */
    touchEnabled?: boolean;
    /**
     * Enable standard gamepad. Default `true`.
     */
    gamepadEnabled?: boolean;
    /**
     * Allow pointer lock. Default `true`.
     */
    pointerLockEnabled?: boolean;
    /**
     * Virtual stick radius in CSS pixels, 16..300. Default `90`.
     */
    touchRadius?: number;
    /**
     * Gamepad stick deadzone, [0, 1). Default `0.18`.
     */
    stickDeadzone?: number;
    /**
     * Gamepad look speed in radians per second at full deflection. Default `2.6`.
     */
    gamepadLookRate?: number;
};
/**
 * Per-simulation-step input sample.
 */
export type FpsInputSample = {
    /**
     * Normalised move vector (x right, y back; length <= 1).
     */
    move: {
        x: number;
        y: number;
    };
    fire: boolean;
    ads: boolean;
    sprint: boolean;
    crouch: boolean;
    jump: boolean;
    reload: boolean;
    melee: boolean;
    interact: boolean;
    pause: boolean;
    /**
     * Pointer is locked to the canvas.
     */
    locked: boolean;
    /**
     * A touch pointer has been seen.
     */
    touch: boolean;
    /**
     * A standard gamepad is connected.
     */
    gamepad: boolean;
};
/**
 * Accumulated look delta in radians (since last consume).
 */
export type FpsLookDelta = {
    /**
     * Yaw delta.
     */
    dx: number;
    /**
     * Pitch delta.
     */
    dy: number;
};
/**
 * Frozen controller returned by {@link createFirstPersonInput3d}.
 */
export type FirstPersonInput3d = {
    /**
     * Sample actions; `dt` seconds, default 1/60.
     */
    sample: (dt?: number) => FpsInputSample;
    /**
     * Read and zero the look delta.
     */
    consumeLook: () => FpsLookDelta;
    /**
     * Request pointer lock; resolves whether locked.
     */
    requestLock: () => Promise<boolean>;
    /**
     * Exit pointer lock if held.
     */
    releaseLock: () => void;
    /**
     * Clear all held input state.
     */
    reset: () => void;
    /**
     * Set an on-screen overlay action.
     */
    setAction: (name: FpsAction, value: boolean) => void;
    /**
     * Remove listeners; false when already disposed.
     */
    dispose: () => boolean;
    /**
     * Current pointer-lock state.
     */
    locked: boolean;
};
