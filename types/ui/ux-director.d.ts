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
 * @typedef {object} UiDirectorOptions
 * @property {'title' | 'playing' | 'paused' | 'choice' | 'result'} [initialPhase='title']
 * @property {ReturnType<typeof createPanelStack>} [panelStack] Optional existing PanelStack to reuse.
 * @property {Record<string, import('./panel-stack.js').PanelDefinition>} [panels] Extra panel definitions.
 * @property {Record<string, UiMetricOptions | number>} [metrics] Initial HUD metrics to track.
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
