/**
 * @typedef {object} GameChoiceCard
 * @property {string} id
 * @property {string} label
 * @property {string} [pos]
 * @property {string} [neg]
 * @property {string} [icon]
 * @property {Record<string, unknown>} [payload]
 */
/**
 * @typedef {object} GameSessionOptions
 * @property {ReturnType<typeof defineGameBlueprint> | object} [blueprint]
 * @property {{ hitStop?: (seconds: number) => void, platform?: { audio?: object, save?: object } } | null} [app=null]
 * @property {ReturnType<typeof createUiDirector> | null} [director=null]
 * @property {ReturnType<typeof createAudioDirector> | null} [audioDirector=null]
 * @property {ReturnType<typeof createVersionedStore> | null} [saveStore=null]
 * @property {Storage | null} [storage=null]
 * @property {number} [seed=1337]
 * @property {'title' | 'playing'} [initialPhase='title']
 * @property {(choice: GameChoiceCard, index: number, session: unknown) => void} [onChoice]
 * @property {(phase: string, prevPhase: string, payload: unknown) => void} [onPhaseChange]
 * @property {(session: unknown) => void} [onStartRun]
 * @property {(summary: object, session: unknown) => void} [onEndRun]
 */
/**
 * Create a unified Gameplay Run & Session controller across 2D, 3D, and UI games.
 * @param {GameSessionOptions} [options]
 */
export function createGameSession(options?: GameSessionOptions | undefined): Readonly<{
    blueprint: any;
    director: Readonly<{
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
    }>;
    audio: Readonly<{
        play: (event: string, playOpts?: object) => boolean;
        setPhase: (nextPhase: "title" | "playing" | "paused" | "choice" | "result", meta?: {
            bossActive?: boolean;
            victory?: boolean;
            intensity?: number;
        } | undefined) => void;
        setIntensity: (value: number) => void;
        setMuted: (nextMuted: boolean) => boolean;
        isMuted: () => boolean;
        unlock: () => void;
        registerCueOverrides: (map: Record<string, {
            cue?: string;
            preset?: string | object;
            volume?: number;
            pitchJitter?: number;
            cooldownMs?: number;
        }>) => void;
        update: (dt: number) => void;
        snapshot: () => {
            phase: string;
            mood: string;
            intensity: 0.28 | 0.55 | 0.38 | 0.62;
            muted: boolean;
            playedCount: number;
            throttledCount: number;
            bgm: {
                mood: string | undefined;
                intensity: any;
                bpm: any;
                volume: any;
                muted: boolean;
                playing: boolean;
                paused: boolean;
                stepIndex: number;
                available: boolean;
            } | null;
        };
        dispose(): void;
    }>;
    saveStore: Readonly<import("../platform/storage.js").VersionedStore<unknown>>;
    readonly rng: import("../sim/rng.js").SeededRng;
    readonly state: {
        phase: "playing" | "paused" | "title" | "choice" | "result" | undefined;
        hp: number;
        maxHp: number;
        xp: number;
        nextXp: number;
        level: number;
        score: number;
        bestScore: number;
        kills: number;
        wave: number;
        bossActive: boolean;
        elapsed: number;
        currency: any;
        combo: number;
        comboTimer: number;
        victory: boolean;
        /** @type {GameChoiceCard[]} */
        choices: GameChoiceCard[];
    };
    startRun: () => {
        phase: "playing" | "paused" | "title" | "choice" | "result" | undefined;
        hp: number;
        maxHp: number;
        xp: number;
        nextXp: number;
        level: number;
        score: number;
        bestScore: number;
        kills: number;
        wave: number;
        bossActive: boolean;
        elapsed: number;
        currency: any;
        combo: number;
        comboTimer: number;
        victory: boolean;
        /** @type {GameChoiceCard[]} */
        choices: GameChoiceCard[];
    };
    pause: () => "playing" | "paused" | "title" | "choice" | "result" | undefined;
    resume: () => "playing" | "paused" | "title" | "choice" | "result" | undefined;
    togglePause: () => "playing" | "paused" | "title" | "choice" | "result" | undefined;
    presentChoices: (choices?: GameChoiceCard[] | undefined) => GameChoiceCard[];
    selectChoice: (index: number) => GameChoiceCard | null;
    cancelChoice: () => boolean;
    endRun: (summary?: {
        victory?: boolean;
        bonusScore?: number;
    } | undefined) => {
        victory: boolean;
        score: number;
        bestScore: number;
        kills: number;
        wave: number;
        elapsed: number;
    } | null;
    restart: () => {
        phase: "playing" | "paused" | "title" | "choice" | "result" | undefined;
        hp: number;
        maxHp: number;
        xp: number;
        nextXp: number;
        level: number;
        score: number;
        bestScore: number;
        kills: number;
        wave: number;
        bossActive: boolean;
        elapsed: number;
        currency: any;
        combo: number;
        comboTimer: number;
        victory: boolean;
        /** @type {GameChoiceCard[]} */
        choices: GameChoiceCard[];
    };
    recordHit: (info?: {
        damage?: number;
        crit?: boolean;
        score?: number;
        hitStopSec?: number;
    } | undefined) => void;
    recordKill: (info?: {
        score?: number;
        xp?: number;
        currency?: number;
    } | undefined) => {
        leveledUp: boolean;
        level?: undefined;
    } | {
        leveledUp: boolean;
        level: number;
    };
    damagePlayer: (amount: number) => number;
    healPlayer: (amount: number) => number;
    addCurrency: (amount: number) => any;
    setWave: (wave: number, meta?: {
        bossActive?: boolean;
    } | undefined) => number;
    notifyMoved: () => void;
    update: (dt: number) => void;
    snapshot: () => {
        phase: "playing" | "paused" | "title" | "choice" | "result" | undefined;
        hp: number;
        maxHp: number;
        xp: number;
        nextXp: number;
        level: number;
        score: number;
        bestScore: number;
        kills: number;
        wave: number;
        bossActive: boolean;
        elapsed: number;
        currency: number;
        combo: number;
        victory: boolean;
        choices: string[];
        meta: {
            bestScore: number;
            runs: number;
            totalKills: number;
        };
        ui: {
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
        audio: {
            phase: string;
            mood: string;
            intensity: 0.28 | 0.55 | 0.38 | 0.62;
            muted: boolean;
            playedCount: number;
            throttledCount: number;
            bgm: {
                mood: string | undefined;
                intensity: any;
                bpm: any;
                volume: any;
                muted: boolean;
                playing: boolean;
                paused: boolean;
                stepIndex: number;
                available: boolean;
            } | null;
        };
    };
    dispose(): void;
}>;
export type GameChoiceCard = {
    id: string;
    label: string;
    pos?: string | undefined;
    neg?: string | undefined;
    icon?: string | undefined;
    payload?: Record<string, unknown> | undefined;
};
export type GameSessionOptions = {
    blueprint?: ReturnType<typeof defineGameBlueprint> | object;
    app?: {
        hitStop?: (seconds: number) => void;
        platform?: {
            audio?: object;
            save?: object;
        };
    } | null | undefined;
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
    audioDirector?: Readonly<{
        play: (event: string, playOpts?: object) => boolean;
        setPhase: (nextPhase: "title" | "playing" | "paused" | "choice" | "result", meta?: {
            bossActive?: boolean;
            victory?: boolean;
            intensity?: number;
        } | undefined) => void;
        setIntensity: (value: number) => void;
        setMuted: (nextMuted: boolean) => boolean;
        isMuted: () => boolean;
        unlock: () => void;
        registerCueOverrides: (map: Record<string, {
            cue?: string;
            preset?: string | object;
            volume?: number;
            pitchJitter?: number;
            cooldownMs?: number;
        }>) => void;
        update: (dt: number) => void;
        snapshot: () => {
            phase: string;
            mood: string;
            intensity: 0.28 | 0.55 | 0.38 | 0.62;
            muted: boolean;
            playedCount: number;
            throttledCount: number;
            bgm: {
                mood: string | undefined;
                intensity: any;
                bpm: any;
                volume: any;
                muted: boolean;
                playing: boolean;
                paused: boolean;
                stepIndex: number;
                available: boolean;
            } | null;
        };
        dispose(): void;
    }> | null | undefined;
    saveStore?: Readonly<import("../platform/storage.js").VersionedStore<unknown>> | null | undefined;
    storage?: Storage | null | undefined;
    seed?: number | undefined;
    initialPhase?: "playing" | "title" | undefined;
    onChoice?: ((choice: GameChoiceCard, index: number, session: unknown) => void) | undefined;
    onPhaseChange?: ((phase: string, prevPhase: string, payload: unknown) => void) | undefined;
    onStartRun?: ((session: unknown) => void) | undefined;
    onEndRun?: ((summary: object, session: unknown) => void) | undefined;
};
import { defineGameBlueprint } from './blueprint.js';
