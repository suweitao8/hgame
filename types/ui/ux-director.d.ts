/**
 * @typedef {object} UiMetricOptions
 * @property {number} [value=0] Initial numeric value.
 * @property {number} [halfLife=0.09] Spring smoothing half-life (seconds); 0 snaps immediately.
 * @property {boolean} [snap=false] If true, `displayValue` tracks `value` immediately while `pulse` still animates.
 * @property {boolean} [cueOnChange=false] Emit `metricUp` / `metricDown` cues when the value changes.
 */
/**
 * @typedef {object} UiMetricState
 * @property {string} id
 * @property {number} value Target value.
 * @property {number} displayValue Smoothed display value.
 * @property {number} pulse Pop intensity [0..1] after a change.
 * @property {-1 | 0 | 1} direction Last change direction.
 * @property {number} lastDelta Last numeric delta applied.
 * @property {boolean} settled
 */
/**
 * @typedef {object} UiBarOptions
 * @property {number} [value=1] Initial normalized fill ratio [0..1].
 * @property {number} [holdSec=0.28] Delay in seconds before the ghost trail catches up after damage.
 * @property {number} [halfLife=0.09] Catch-up spring half-life in seconds.
 */
/**
 * @typedef {object} UiBarState
 * @property {string} id
 * @property {number} value Primary fill ratio [0..1].
 * @property {number} ghostValue Trailing/preview fill ratio [0..1].
 * @property {-1 | 0 | 1} direction Last change direction.
 * @property {number} holdRemaining Remaining ghost hold time in seconds.
 * @property {boolean} settled
 */
/**
 * @typedef {object} UiCooldownOptions
 * @property {number} [remaining=0] Initial remaining cooldown in seconds.
 * @property {number} [duration=1] Total cooldown duration in seconds.
 * @property {boolean} [cueOnReady=true] Emit `confirm` cue when transitioning from active cooldown to ready.
 */
/**
 * @typedef {object} UiCooldownState
 * @property {string} id
 * @property {number} remaining Remaining seconds.
 * @property {number} duration Total seconds.
 * @property {number} ratio Remaining fraction [0..1] (0 = ready, 1 = full cooldown).
 * @property {boolean} ready True when remaining <= 0.
 * @property {number} readyFlash Flash intensity [0..1] decaying after becoming ready.
 * @property {boolean} settled
 */
/**
 * @typedef {object} UiDirectorOptions
 * @property {'title' | 'playing' | 'paused' | 'choice' | 'result'} [initialPhase='title']
 * @property {ReturnType<typeof createPanelStack>} [panelStack] Optional existing PanelStack to reuse.
 * @property {Record<string, import('./panel-stack.js').PanelDefinition>} [panels] Extra panel definitions.
 * @property {Record<string, UiMetricOptions | number>} [metrics] Initial HUD metrics to track.
 * @property {Record<string, UiBarOptions | number>} [bars] Initial ghost-trail bars to track.
 * @property {Record<string, UiCooldownOptions | number>} [cooldowns] Initial radial cooldown rings to track.
 * @property {{ available?: boolean, playSynth?: (preset: unknown, opts?: object) => unknown } | null} [audio=null] Optional HGame audio service.
 * @property {boolean} [hintEnabled=true] Show initial move/action hint until `notifyMoved()`.
 * @property {number} [hintFadeSec=0.5] Seconds to fade out hint after first movement.
 * @property {() => number} [now] Clock function in milliseconds for cue throttling.
 * @property {(event: { phase: string, prevPhase: string, paused: boolean, payload: unknown }) => void} [onPhaseChange]
 * @property {(cue: string, detail: unknown) => void} [onCue]
 */
/**
 * Universal game UI/UX state & feedback coordinator for 2D, 3D, and DOM/card games.
 * Manages game phase flow, modal stack synchronization, smooth HUD metric roll-up & pulse,
 * first-move hint auto-fade, and throttled procedural UI audio cues.
 *
 * @param {UiDirectorOptions} [options={}]
 */
export function createUiDirector(options?: UiDirectorOptions | undefined): Readonly<{
    panelStack: Readonly<{
        register: (id: any, def?: {}) => void;
        push: (id: string, payload?: unknown, overrideDef?: import("./panel-stack.js").PanelDefinition | null | undefined) => import("./panel-stack.js").PanelEntry;
        pop: (opts?: {}) => import("./panel-stack.js").PanelEntry | null | undefined;
        popById: (id: any) => import("./panel-stack.js").PanelEntry | null;
        replace: (id: string, payload?: unknown, overrideDef?: import("./panel-stack.js").PanelDefinition | null | undefined) => import("./panel-stack.js").PanelEntry;
        toggle: (id: string, payload?: unknown, overrideDef?: import("./panel-stack.js").PanelDefinition | null | undefined) => boolean;
        clear: (force?: boolean) => boolean;
        handleCancel: () => boolean;
        update: (dt: any) => void;
        isOpen: (id: any) => boolean;
        top: () => import("./panel-stack.js").PanelEntry | null;
        getEntry: (id: any) => import("./panel-stack.js").PanelEntry | null;
        getStack: () => import("./panel-stack.js").PanelEntry[];
        getExiting: () => import("./panel-stack.js").PanelEntry[];
        hasModal: () => boolean;
        subscribe: (fn: any) => () => boolean;
        bindDom: (rootEl: HTMLElement, bindOpts?: {
            targetWindow?: Window | EventTarget;
            escapeKey?: string;
        } | undefined) => () => void;
        dispose: () => void;
    }>;
    getPhase: () => "playing" | "paused" | "title" | "choice" | "result" | undefined;
    getPhasePayload: () => any;
    isPaused: () => boolean;
    setPhase: (nextPhase: any, payload?: null, { silent }?: {
        silent?: boolean | undefined;
    }) => "playing" | "paused" | "title" | "choice" | "result" | undefined;
    startGame: (payload?: null) => "playing" | "paused" | "title" | "choice" | "result" | undefined;
    pause: (payload?: null) => "playing" | "paused" | "title" | "choice" | "result" | undefined;
    resume: () => "playing" | "paused" | "title" | "choice" | "result" | undefined;
    togglePause: () => "playing" | "paused" | "title" | "choice" | "result" | undefined;
    openChoice: (payload?: null) => "playing" | "paused" | "title" | "choice" | "result" | undefined;
    closeChoice: () => "playing" | "paused" | "title" | "choice" | "result" | undefined;
    finishRun: (summary?: null) => "playing" | "paused" | "title" | "choice" | "result" | undefined;
    restart: (payload?: null) => "playing" | "paused" | "title" | "choice" | "result" | undefined;
    registerMetric: (id: any, metricOptions?: {}) => UiMetricState;
    setMetric: (id: any, nextValue: any, opts?: {}) => UiMetricState | null;
    pulseMetric: (id: any, direction?: number) => UiMetricState | null;
    getMetric: (id: any) => UiMetricState | null;
    getMetrics: () => {
        [k: string]: UiMetricState;
    };
    registerBar: (id: any, barOptions?: {}) => UiBarState;
    setBar: (id: any, ratio: any) => UiBarState | null;
    getBar: (id: any) => UiBarState | null;
    getBars: () => {
        [k: string]: UiBarState;
    };
    registerCooldown: (id: any, cdOptions?: {}) => UiCooldownState;
    setCooldown: (id: any, remaining: any, duration?: null) => UiCooldownState;
    getCooldown: (id: any) => UiCooldownState | null;
    getCooldowns: () => {
        [k: string]: UiCooldownState;
    };
    notifyMoved: () => void;
    isHintVisible: () => boolean;
    getHintAlpha: () => number;
    emitCue: (cue: any, detail?: null) => boolean;
    onPhaseChange(fn: any): () => boolean;
    onCue(fn: any): () => boolean;
    update: (dt: any) => {
        phase: "playing" | "paused" | "title" | "choice" | "result" | undefined;
        paused: boolean;
        modalOpen: boolean;
        hintAlpha: number;
        hintVisible: boolean;
        activeAnimations: boolean;
    };
    snapshot: () => {
        phase: "playing" | "paused" | "title" | "choice" | "result" | undefined;
        paused: boolean;
        modalOpen: boolean;
        topPanel: string | null;
        hintAlpha: number;
        metrics: {
            [k: string]: {
                value: number;
                displayValue: number;
                pulse: number;
            };
        };
        bars: {
            [k: string]: {
                value: number;
                ghostValue: number;
            };
        };
        cooldowns: {
            [k: string]: {
                remaining: number;
                ratio: number;
                ready: boolean;
            };
        };
    };
    dispose(): void;
}>;
/** Standard cross-game UI flow phases. */
export const UI_PHASES: Readonly<{
    TITLE: "title";
    PLAYING: "playing";
    PAUSED: "paused";
    CHOICE: "choice";
    RESULT: "result";
}>;
/** Semantic UI/UX interaction cues routed to audio/haptics. */
export const UI_UX_CUES: Readonly<{
    HOVER: "hover";
    PRESS: "press";
    CONFIRM: "confirm";
    CANCEL: "cancel";
    OPEN: "open";
    CLOSE: "close";
    REWARD: "reward";
    ERROR: "error";
    METRIC_UP: "metricUp";
    METRIC_DOWN: "metricDown";
}>;
export type UiMetricOptions = {
    /**
     * Initial numeric value.
     */
    value?: number | undefined;
    /**
     * Spring smoothing half-life (seconds); 0 snaps immediately.
     */
    halfLife?: number | undefined;
    /**
     * If true, `displayValue` tracks `value` immediately while `pulse` still animates.
     */
    snap?: boolean | undefined;
    /**
     * Emit `metricUp` / `metricDown` cues when the value changes.
     */
    cueOnChange?: boolean | undefined;
};
export type UiMetricState = {
    id: string;
    /**
     * Target value.
     */
    value: number;
    /**
     * Smoothed display value.
     */
    displayValue: number;
    /**
     * Pop intensity [0..1] after a change.
     */
    pulse: number;
    /**
     * Last change direction.
     */
    direction: -1 | 0 | 1;
    /**
     * Last numeric delta applied.
     */
    lastDelta: number;
    settled: boolean;
};
export type UiBarOptions = {
    /**
     * Initial normalized fill ratio [0..1].
     */
    value?: number | undefined;
    /**
     * Delay in seconds before the ghost trail catches up after damage.
     */
    holdSec?: number | undefined;
    /**
     * Catch-up spring half-life in seconds.
     */
    halfLife?: number | undefined;
};
export type UiBarState = {
    id: string;
    /**
     * Primary fill ratio [0..1].
     */
    value: number;
    /**
     * Trailing/preview fill ratio [0..1].
     */
    ghostValue: number;
    /**
     * Last change direction.
     */
    direction: -1 | 0 | 1;
    /**
     * Remaining ghost hold time in seconds.
     */
    holdRemaining: number;
    settled: boolean;
};
export type UiCooldownOptions = {
    /**
     * Initial remaining cooldown in seconds.
     */
    remaining?: number | undefined;
    /**
     * Total cooldown duration in seconds.
     */
    duration?: number | undefined;
    /**
     * Emit `confirm` cue when transitioning from active cooldown to ready.
     */
    cueOnReady?: boolean | undefined;
};
export type UiCooldownState = {
    id: string;
    /**
     * Remaining seconds.
     */
    remaining: number;
    /**
     * Total seconds.
     */
    duration: number;
    /**
     * Remaining fraction [0..1] (0 = ready, 1 = full cooldown).
     */
    ratio: number;
    /**
     * True when remaining <= 0.
     */
    ready: boolean;
    /**
     * Flash intensity [0..1] decaying after becoming ready.
     */
    readyFlash: number;
    settled: boolean;
};
export type UiDirectorOptions = {
    initialPhase?: "playing" | "paused" | "title" | "choice" | "result" | undefined;
    /**
     * Optional existing PanelStack to reuse.
     */
    panelStack?: Readonly<{
        register: (id: any, def?: {}) => void;
        push: (id: string, payload?: unknown, overrideDef?: import("./panel-stack.js").PanelDefinition | null | undefined) => import("./panel-stack.js").PanelEntry;
        pop: (opts?: {}) => import("./panel-stack.js").PanelEntry | null | undefined;
        popById: (id: any) => import("./panel-stack.js").PanelEntry | null;
        replace: (id: string, payload?: unknown, overrideDef?: import("./panel-stack.js").PanelDefinition | null | undefined) => import("./panel-stack.js").PanelEntry;
        toggle: (id: string, payload?: unknown, overrideDef?: import("./panel-stack.js").PanelDefinition | null | undefined) => boolean;
        clear: (force?: boolean) => boolean;
        handleCancel: () => boolean;
        update: (dt: any) => void;
        isOpen: (id: any) => boolean;
        top: () => import("./panel-stack.js").PanelEntry | null;
        getEntry: (id: any) => import("./panel-stack.js").PanelEntry | null;
        getStack: () => import("./panel-stack.js").PanelEntry[];
        getExiting: () => import("./panel-stack.js").PanelEntry[];
        hasModal: () => boolean;
        subscribe: (fn: any) => () => boolean;
        bindDom: (rootEl: HTMLElement, bindOpts?: {
            targetWindow?: Window | EventTarget;
            escapeKey?: string;
        } | undefined) => () => void;
        dispose: () => void;
    }> | undefined;
    /**
     * Extra panel definitions.
     */
    panels?: Record<string, import("./panel-stack.js").PanelDefinition> | undefined;
    /**
     * Initial HUD metrics to track.
     */
    metrics?: Record<string, number | UiMetricOptions> | undefined;
    /**
     * Initial ghost-trail bars to track.
     */
    bars?: Record<string, number | UiBarOptions> | undefined;
    /**
     * Initial radial cooldown rings to track.
     */
    cooldowns?: Record<string, number | UiCooldownOptions> | undefined;
    /**
     * Optional HGame audio service.
     */
    audio?: {
        available?: boolean;
        playSynth?: (preset: unknown, opts?: object) => unknown;
    } | null | undefined;
    /**
     * Show initial move/action hint until `notifyMoved()`.
     */
    hintEnabled?: boolean | undefined;
    /**
     * Seconds to fade out hint after first movement.
     */
    hintFadeSec?: number | undefined;
    /**
     * Clock function in milliseconds for cue throttling.
     */
    now?: (() => number) | undefined;
    onPhaseChange?: ((event: {
        phase: string;
        prevPhase: string;
        paused: boolean;
        payload: unknown;
    }) => void) | undefined;
    onCue?: ((cue: string, detail: unknown) => void) | undefined;
};
