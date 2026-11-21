/**
 * Injects the shared HGame UI/UX micro-interaction stylesheet once into `document.head`.
 * @param {Document} [documentRef]
 * @returns {boolean} True when the stylesheet is present in the document.
 */
export function injectUiUxStyles(documentRef?: Document | undefined): boolean;
/**
 * @typedef {'scifi' | 'arcane' | 'arcade' | 'cyber'} UiThemeName
 */
/**
 * @typedef {object} UiFlyToOptions
 * @property {HTMLElement | { x: number, y: number }} from Origin element or viewport coordinates.
 * @property {HTMLElement | string} to Destination element or CSS selector.
 * @property {string} [glyph='✦'] Short visual icon/glyph for the flying token.
 * @property {number} [count=1] Number of staggered flyers.
 * @property {number} [duration=0.45] Flight duration in seconds.
 * @property {number} [arcHeight=48] Bezier curve peak lift in pixels.
 * @property {string | null} [metric=null] Optional `director` metric id to pulse/increment on arrival.
 * @property {number} [delta=0] Optional metric delta added per flyer arrival.
 */
/**
 * @typedef {object} UiUxDomOptions
 * @property {HTMLElement | Document} [root] Root container to enhance (defaults to `document.body`).
 * @property {ReturnType<typeof import('../ui/ux-director.js').createUiDirector> | null} [director=null] Optional UiDirector to synchronize phase, metrics, bars, cooldowns, hints, and audio cues.
 * @property {{ available?: boolean, playSynth?: (preset: unknown, opts?: object) => unknown } | null} [audio=null] Optional audio service when no director is provided.
 * @property {UiThemeName | null} [theme=null] Optional built-in theme preset applied as `data-ui-theme` on `root`.
 * @property {string} [selector='button:not([data-ui-static]), [data-ui-tilt], .card'] Interactive element selector.
 * @property {number} [maxTiltDeg=10] Maximum 3D perspective tilt angle in degrees.
 * @property {number} [hoverScale=1.045] Scale on pointer hover.
 * @property {number} [pressScale=0.96] Scale on active press.
 * @property {number} [hoverLift=-5] Vertical hover lift in pixels.
 * @property {number} [perspective=800] CSS perspective in pixels.
 * @property {Record<string, (value: number) => string>} [formatMetrics] Custom metric formatters keyed by metric id.
 * @property {boolean} [keyboardNav=true] Enable Arrow/Tab focus navigation + Enter/Space confirm across visible interactive elements.
 * @property {boolean} [gamepadNav=false] Poll connected gamepad D-pad & A button during active frames.
 * @property {boolean} [focusRing=true] Show spring-animated sliding focus ring around keyboard-focused elements.
 * @property {boolean} [touchSwipe=true] Allow touch finger dragging across sibling cards to preview & select.
 * @property {boolean} [injectStyles=true] Inject shared CSS rules automatically.
 * @property {boolean} [autoRaf=true] Run on-demand `requestAnimationFrame` only while springs or director animations are active.
 */
/**
 * Universal DOM UI/UX enhancer for HGame projects (2D, 3D, and command-driven UI).
 * Attaches spring-driven 3D tilt, floating hover, specular glare, dual-layer ghost bars,
 * radial cooldown rings, Bezier fly-to-HUD tokens, sliding keyboard/gamepad focus ring,
 * touch swipe-select, and throttled UI sound feedback. Sleeps automatically when settled.
 *
 * @param {UiUxDomOptions} [options={}]
 */
export function bindUiUxDOM(options?: UiUxDomOptions | undefined): Readonly<{
    step: (dt: any) => boolean;
    wake: () => void;
    flyTo: (flyOpts: UiFlyToOptions) => number;
    triggerStagger: (container: any) => void;
    syncDirectorDom: () => void;
    moveFocus: (step: any) => Element | null;
    setFocus: (el: any) => void;
    getFocusedElement: () => any;
    setTheme: (themeName: any) => any;
    getSurfaceCount: () => number;
    dispose(): void;
}>;
export type UiThemeName = "scifi" | "arcane" | "arcade" | "cyber";
export type UiFlyToOptions = {
    /**
     * Origin element or viewport coordinates.
     */
    from: HTMLElement | {
        x: number;
        y: number;
    };
    /**
     * Destination element or CSS selector.
     */
    to: HTMLElement | string;
    /**
     * Short visual icon/glyph for the flying token.
     */
    glyph?: string | undefined;
    /**
     * Number of staggered flyers.
     */
    count?: number | undefined;
    /**
     * Flight duration in seconds.
     */
    duration?: number | undefined;
    /**
     * Bezier curve peak lift in pixels.
     */
    arcHeight?: number | undefined;
    /**
     * Optional `director` metric id to pulse/increment on arrival.
     */
    metric?: string | null | undefined;
    /**
     * Optional metric delta added per flyer arrival.
     */
    delta?: number | undefined;
};
export type UiUxDomOptions = {
    /**
     * Root container to enhance (defaults to `document.body`).
     */
    root?: Document | HTMLElement | undefined;
    /**
     * Optional UiDirector to synchronize phase, metrics, bars, cooldowns, hints, and audio cues.
     */
    director?: Readonly<{
        panelStack: Readonly<{
            register: (id: any, def?: {}) => void;
            push: (id: string, payload?: unknown, overrideDef?: import("../ui/panel-stack.js").PanelDefinition | null | undefined) => import("../ui/panel-stack.js").PanelEntry;
            pop: (opts?: {}) => import("../ui/panel-stack.js").PanelEntry | null | undefined;
            popById: (id: any) => import("../ui/panel-stack.js").PanelEntry | null;
            replace: (id: string, payload?: unknown, overrideDef?: import("../ui/panel-stack.js").PanelDefinition | null | undefined) => import("../ui/panel-stack.js").PanelEntry;
            toggle: (id: string, payload?: unknown, overrideDef?: import("../ui/panel-stack.js").PanelDefinition | null | undefined) => boolean;
            clear: (force?: boolean) => boolean;
            handleCancel: () => boolean;
            update: (dt: any) => void;
            isOpen: (id: any) => boolean;
            top: () => import("../ui/panel-stack.js").PanelEntry | null;
            getEntry: (id: any) => import("../ui/panel-stack.js").PanelEntry | null;
            getStack: () => import("../ui/panel-stack.js").PanelEntry[];
            getExiting: () => import("../ui/panel-stack.js").PanelEntry[];
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
        registerMetric: (id: any, metricOptions?: {}) => import("../ui/ux-director.js").UiMetricState;
        setMetric: (id: any, nextValue: any, opts?: {}) => import("../ui/ux-director.js").UiMetricState | null;
        pulseMetric: (id: any, direction?: number) => import("../ui/ux-director.js").UiMetricState | null;
        getMetric: (id: any) => import("../ui/ux-director.js").UiMetricState | null;
        getMetrics: () => {
            [k: string]: import("../ui/ux-director.js").UiMetricState;
        };
        registerBar: (id: any, barOptions?: {}) => import("../ui/ux-director.js").UiBarState;
        setBar: (id: any, ratio: any) => import("../ui/ux-director.js").UiBarState | null;
        getBar: (id: any) => import("../ui/ux-director.js").UiBarState | null;
        getBars: () => {
            [k: string]: import("../ui/ux-director.js").UiBarState;
        };
        registerCooldown: (id: any, cdOptions?: {}) => import("../ui/ux-director.js").UiCooldownState;
        setCooldown: (id: any, remaining: any, duration?: null) => import("../ui/ux-director.js").UiCooldownState;
        getCooldown: (id: any) => import("../ui/ux-director.js").UiCooldownState | null;
        getCooldowns: () => {
            [k: string]: import("../ui/ux-director.js").UiCooldownState;
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
    }> | null | undefined;
    /**
     * Optional audio service when no director is provided.
     */
    audio?: {
        available?: boolean;
        playSynth?: (preset: unknown, opts?: object) => unknown;
    } | null | undefined;
    /**
     * Optional built-in theme preset applied as `data-ui-theme` on `root`.
     */
    theme?: UiThemeName | null | undefined;
    /**
     * Interactive element selector.
     */
    selector?: string | undefined;
    /**
     * Maximum 3D perspective tilt angle in degrees.
     */
    maxTiltDeg?: number | undefined;
    /**
     * Scale on pointer hover.
     */
    hoverScale?: number | undefined;
    /**
     * Scale on active press.
     */
    pressScale?: number | undefined;
    /**
     * Vertical hover lift in pixels.
     */
    hoverLift?: number | undefined;
    /**
     * CSS perspective in pixels.
     */
    perspective?: number | undefined;
    /**
     * Custom metric formatters keyed by metric id.
     */
    formatMetrics?: Record<string, (value: number) => string> | undefined;
    /**
     * Enable Arrow/Tab focus navigation + Enter/Space confirm across visible interactive elements.
     */
    keyboardNav?: boolean | undefined;
    /**
     * Poll connected gamepad D-pad & A button during active frames.
     */
    gamepadNav?: boolean | undefined;
    /**
     * Show spring-animated sliding focus ring around keyboard-focused elements.
     */
    focusRing?: boolean | undefined;
    /**
     * Allow touch finger dragging across sibling cards to preview & select.
     */
    touchSwipe?: boolean | undefined;
    /**
     * Inject shared CSS rules automatically.
     */
    injectStyles?: boolean | undefined;
    /**
     * Run on-demand `requestAnimationFrame` only while springs or director animations are active.
     */
    autoRaf?: boolean | undefined;
};
