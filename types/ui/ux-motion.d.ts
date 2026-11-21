/**
 * @typedef {object} UiStaggerOptions
 * @property {number} [delay=0.045] Seconds between consecutive items.
 * @property {number} [duration=0.24] Entrance duration in seconds per item.
 * @property {keyof typeof EASING | ((t: number) => number)} [ease='easeOutBack'] Easing function or name.
 */
/**
 * Computes staggered entrance progress for card/menu reveals.
 * Returns a value starting at `0` before the item's delay and reaching `1` when settled
 * (may overshoot slightly above `1` when using `'easeOutBack'`).
 *
 * @param {number} elapsed Seconds elapsed since entrance began.
 * @param {number} index Zero-based item index.
 * @param {UiStaggerOptions} [options={}]
 * @returns {number}
 */
export function computeStaggerProgress(elapsed: number, index: number, options?: UiStaggerOptions | undefined): number;
/**
 * @typedef {object} UiSurfaceSpringOptions
 * @property {number} [maxTiltDeg=11] Maximum 3D tilt angle in degrees along X/Y axes.
 * @property {number} [hoverScale=1.045] Target scale while hovered or focused.
 * @property {number} [pressScale=0.96] Target scale while pressed.
 * @property {number} [selectedScale=1.03] Target scale while selected.
 * @property {number} [hoverLift=-6] Vertical/Z lift offset while hovered (negative lifts up in CSS Y).
 * @property {number} [pressLift=1.5] Offset while pressed.
 * @property {number} [tiltHalfLife=0.08] Critically damped spring half-life (seconds) for tilt & glare.
 * @property {number} [scaleHalfLife=0.075] Spring half-life (seconds) for scale & lift.
 * @property {number} [idleFloatAmp=0] Optional sinusoidal floating amplitude (0 disables idle motion).
 * @property {number} [idleFloatSpeed=2.1] Idle floating angular frequency (rad/s).
 * @property {number} [idlePhase=0] Initial phase offset (radians) for desynchronized multi-card float.
 * @property {number} [perspective=800] Perspective distance (px) used by `toCssTransform`.
 * @property {boolean} [invertTilt=false] Invert pointer-to-tilt sign.
 */
/**
 * @typedef {object} UiSurfaceSpringState
 * @property {number} tiltX Pitch angle in degrees.
 * @property {number} tiltY Yaw angle in degrees.
 * @property {number} scale Current uniform scale.
 * @property {number} lift Current vertical/depth lift offset.
 * @property {number} floatOffset Current idle breathing offset.
 * @property {number} glareX Specular highlight X percentage (0..100).
 * @property {number} glareY Specular highlight Y percentage (0..100).
 * @property {number} glareOpacity Specular highlight opacity (0..1).
 * @property {number} glow Focus/hover glow strength (0..1).
 * @property {boolean} hovered
 * @property {boolean} pressed
 * @property {boolean} focused
 * @property {boolean} selected
 * @property {boolean} disabled
 * @property {boolean} settled
 */
/**
 * Headless spring-physics driver for interactive UI surfaces (DOM cards/buttons, Canvas, Pixi, or 3D meshes).
 * Computes zero-allocation 3D perspective tilt, hover elevation, press squash, specular glare, and idle float.
 *
 * @param {UiSurfaceSpringOptions} [options={}]
 */
export function createUiSurfaceSpring(options?: UiSurfaceSpringOptions | undefined): Readonly<{
    setPointerNorm: (nx: any, ny: any) => void;
    setHover: (active: any, nx?: number, ny?: number) => void;
    setPressed: (active: any) => void;
    setFocused: (active: any) => void;
    setSelected: (active: any) => void;
    setDisabled: (value: any) => void;
    step: (dt: any) => UiSurfaceSpringState;
    snap: () => UiSurfaceSpringState;
    isSettled: () => boolean;
    getState: () => UiSurfaceSpringState;
    toCssTransform: () => string;
}>;
/**
 * @typedef {object} UiMotionGroupOptions
 * @property {number} [count=0] Initial number of surface items.
 * @property {UiSurfaceSpringOptions} [surfaceOptions] Options forwarded to each item's surface spring.
 * @property {UiStaggerOptions} [staggerOptions] Options forwarded to `computeStaggerProgress`.
 * @property {boolean} [wrapNavigation=true] Wrap focus index on `moveFocus`.
 */
/**
 * Coordinates a group of interactive UI surfaces (e.g., 3-choice upgrade cards, menu buttons, shop items)
 * with keyboard/gamepad focus navigation, mutual selection, and staggered entrance progress.
 *
 * @param {UiMotionGroupOptions} [options={}]
 */
export function createUiMotionGroup(options?: UiMotionGroupOptions | undefined): Readonly<{
    setCount: (nextCount: any) => number;
    getCount: () => number;
    getItem: (index: any) => Readonly<{
        setPointerNorm: (nx: any, ny: any) => void;
        setHover: (active: any, nx?: number, ny?: number) => void;
        setPressed: (active: any) => void;
        setFocused: (active: any) => void;
        setSelected: (active: any) => void;
        setDisabled: (value: any) => void;
        step: (dt: any) => UiSurfaceSpringState;
        snap: () => UiSurfaceSpringState;
        isSettled: () => boolean;
        getState: () => UiSurfaceSpringState;
        toCssTransform: () => string;
    }>;
    setFocus: (index: any) => number;
    getFocusIndex: () => number;
    moveFocus: (delta: any) => number;
    triggerEntrance: () => void;
    getEntranceProgress: (index: any) => number;
    step: (dt: any) => boolean;
}>;
export type UiStaggerOptions = {
    /**
     * Seconds between consecutive items.
     */
    delay?: number | undefined;
    /**
     * Entrance duration in seconds per item.
     */
    duration?: number | undefined;
    /**
     * Easing function or name.
     */
    ease?: import("../time/tween.js").EaseName | ((t: number) => number) | undefined;
};
export type UiSurfaceSpringOptions = {
    /**
     * Maximum 3D tilt angle in degrees along X/Y axes.
     */
    maxTiltDeg?: number | undefined;
    /**
     * Target scale while hovered or focused.
     */
    hoverScale?: number | undefined;
    /**
     * Target scale while pressed.
     */
    pressScale?: number | undefined;
    /**
     * Target scale while selected.
     */
    selectedScale?: number | undefined;
    /**
     * Vertical/Z lift offset while hovered (negative lifts up in CSS Y).
     */
    hoverLift?: number | undefined;
    /**
     * Offset while pressed.
     */
    pressLift?: number | undefined;
    /**
     * Critically damped spring half-life (seconds) for tilt & glare.
     */
    tiltHalfLife?: number | undefined;
    /**
     * Spring half-life (seconds) for scale & lift.
     */
    scaleHalfLife?: number | undefined;
    /**
     * Optional sinusoidal floating amplitude (0 disables idle motion).
     */
    idleFloatAmp?: number | undefined;
    /**
     * Idle floating angular frequency (rad/s).
     */
    idleFloatSpeed?: number | undefined;
    /**
     * Initial phase offset (radians) for desynchronized multi-card float.
     */
    idlePhase?: number | undefined;
    /**
     * Perspective distance (px) used by `toCssTransform`.
     */
    perspective?: number | undefined;
    /**
     * Invert pointer-to-tilt sign.
     */
    invertTilt?: boolean | undefined;
};
export type UiSurfaceSpringState = {
    /**
     * Pitch angle in degrees.
     */
    tiltX: number;
    /**
     * Yaw angle in degrees.
     */
    tiltY: number;
    /**
     * Current uniform scale.
     */
    scale: number;
    /**
     * Current vertical/depth lift offset.
     */
    lift: number;
    /**
     * Current idle breathing offset.
     */
    floatOffset: number;
    /**
     * Specular highlight X percentage (0..100).
     */
    glareX: number;
    /**
     * Specular highlight Y percentage (0..100).
     */
    glareY: number;
    /**
     * Specular highlight opacity (0..1).
     */
    glareOpacity: number;
    /**
     * Focus/hover glow strength (0..1).
     */
    glow: number;
    hovered: boolean;
    pressed: boolean;
    focused: boolean;
    selected: boolean;
    disabled: boolean;
    settled: boolean;
};
export type UiMotionGroupOptions = {
    /**
     * Initial number of surface items.
     */
    count?: number | undefined;
    /**
     * Options forwarded to each item's surface spring.
     */
    surfaceOptions?: UiSurfaceSpringOptions | undefined;
    /**
     * Options forwarded to `computeStaggerProgress`.
     */
    staggerOptions?: UiStaggerOptions | undefined;
    /**
     * Wrap focus index on `moveFocus`.
     */
    wrapNavigation?: boolean | undefined;
};
