/**
 * @typedef {object} CanvasUiItem
 * @property {string} id
 * @property {number} x Center X in UI coordinate space.
 * @property {number} y Center Y in UI coordinate space.
 * @property {number} width Item width.
 * @property {number} height Item height.
 * @property {string} [label] Short label (2-4 hanzi or icon+number).
 * @property {string} [glyph] Optional icon/emoji.
 * @property {string} [accent='#38bdf8'] Accent color hex.
 * @property {boolean} [disabled=false]
 * @property {unknown} [payload=null]
 */
/**
 * @typedef {object} CanvasUiGroupOptions
 * @property {CanvasUiItem[]} [items=[]] Initial interactive 2D items.
 * @property {ReturnType<typeof import('../ui/ux-director.js').createUiDirector> | null} [director=null]
 * @property {{ available?: boolean, playSynth?: (preset: unknown, opts?: object) => unknown } | null} [audio=null]
 * @property {(item: CanvasUiItem, index: number) => void} [onSelect]
 * @property {(item: CanvasUiItem | null, index: number) => void} [onHoverChange]
 * @property {import('../ui/ux-motion.js').UiSurfaceSpringOptions} [surfaceOptions]
 * @property {import('../ui/ux-motion.js').UiStaggerOptions} [staggerOptions]
 */
/**
 * Renderer-neutral 2D in-canvas UI coordinator for PixiJS, Canvas2D, and WebGL2D games
 * (including DOM-free mini-game targets like Bilibili Toy).
 * Drives spring hover tilt, lift, press squash, touch swipe-select, keyboard focus,
 * and staggered reveals; renders directly via `drawCanvas2D(ctx)` or syncs Pixi containers via `syncPixi(nodes)`.
 *
 * @param {CanvasUiGroupOptions} [options={}]
 */
export function createCanvasUiGroup(options?: CanvasUiGroupOptions | undefined): Readonly<{
    motion: Readonly<{
        setCount: (nextCount: any) => number;
        getCount: () => number;
        getItem: (index: any) => Readonly<{
            setPointerNorm: (nx: any, ny: any) => void;
            setHover: (active: any, nx?: number, ny?: number) => void;
            setPressed: (active: any) => void;
            setFocused: (active: any) => void;
            setSelected: (active: any) => void;
            setDisabled: (value: any) => void;
            step: (dt: any) => import("../ui/ux-motion.js").UiSurfaceSpringState;
            snap: () => import("../ui/ux-motion.js").UiSurfaceSpringState;
            isSettled: () => boolean;
            getState: () => import("../ui/ux-motion.js").UiSurfaceSpringState;
            toCssTransform: () => string;
        }>;
        setFocus: (index: any) => number;
        getFocusIndex: () => number;
        moveFocus: (delta: any) => number;
        triggerEntrance: () => void;
        getEntranceProgress: (index: any) => number;
        step: (dt: any) => boolean;
    }>;
    setItems: (nextItems: any) => void;
    getItems: () => CanvasUiItem[];
    setVisible(nextVisible: any): void;
    isVisible: () => boolean;
    triggerEntrance: () => void;
    moveFocus: (delta: any) => number;
    confirmFocused: () => CanvasUiItem | null;
    hitTest: (px: any, py: any) => {
        index: number;
        nx: any;
        ny: any;
    } | null;
    handlePointerMove: (px: any, py: any) => {
        index: number;
        nx: any;
        ny: any;
    } | null;
    handlePointerDown: (px: any, py: any) => {
        index: number;
        nx: any;
        ny: any;
    } | null;
    handlePointerUp: (px: any, py: any) => CanvasUiItem | null;
    update: (dt: any) => boolean;
    syncPixi: (nodes: Array<{
        position?: {
            x: number;
            y: number;
            set?(x: number, y: number): void;
        };
        scale?: {
            x: number;
            y: number;
            set?(x: number, y?: number): void;
        };
        skew?: {
            x: number;
            y: number;
            set?(x: number, y: number): void;
        };
        rotation?: number;
        alpha?: number;
        visible?: boolean;
    }>) => void;
    drawCanvas2D: (ctx: CanvasRenderingContext2D) => void;
}>;
export type CanvasUiItem = {
    id: string;
    /**
     * Center X in UI coordinate space.
     */
    x: number;
    /**
     * Center Y in UI coordinate space.
     */
    y: number;
    /**
     * Item width.
     */
    width: number;
    /**
     * Item height.
     */
    height: number;
    /**
     * Short label (2-4 hanzi or icon+number).
     */
    label?: string | undefined;
    /**
     * Optional icon/emoji.
     */
    glyph?: string | undefined;
    /**
     * Accent color hex.
     */
    accent?: string | undefined;
    disabled?: boolean | undefined;
    payload?: unknown;
};
export type CanvasUiGroupOptions = {
    /**
     * Initial interactive 2D items.
     */
    items?: CanvasUiItem[] | undefined;
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
    audio?: {
        available?: boolean;
        playSynth?: (preset: unknown, opts?: object) => unknown;
    } | null | undefined;
    onSelect?: ((item: CanvasUiItem, index: number) => void) | undefined;
    onHoverChange?: ((item: CanvasUiItem | null, index: number) => void) | undefined;
    surfaceOptions?: import("../ui/ux-motion.js").UiSurfaceSpringOptions | undefined;
    staggerOptions?: import("../ui/ux-motion.js").UiStaggerOptions | undefined;
};
