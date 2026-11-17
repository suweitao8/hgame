/**
 * @typedef {object} GameRenderer Renderer adapter injected into the application.
 * @property {(scene: import('./scene.js').Scene, app: GameApplication) => void} render Draw the current scene.
 * @property {() => void} [resize] Called on window resize.
 * @property {() => void} [dispose] Called when the application is disposed.
 * @property {(frameIntervalMs: number) => void} [recordFrameInterval] Required by the `adaptiveQuality3d` feature (milliseconds).
 * @property {object} [qualityController] Required by the `adaptiveQuality3d` feature.
 */
/**
 * @typedef {object} GameApplicationOptions
 * @property {import('./config.js').ProjectOptions} [project] Project recipe (see {@link defineProject}).
 * @property {import('../platform/engine.js').GameEngine} [platform] Existing platform services; a new engine is created and owned when omitted.
 * @property {GameRenderer} renderer Explicit renderer adapter (required).
 * @property {string} [gameId='html-game'] Slug for the owned platform engine.
 * @property {string} [gameVersion='0.1.0']
 * @property {(callback: (timeMs: number) => void) => number | undefined} [requestFrame] Default `requestAnimationFrame`.
 * @property {(id: number) => void} [cancelFrame] Default `cancelAnimationFrame`.
 * @property {number} [maxSubSteps=5] Max fixed ticks per frame, integer 1..240.
 * @property {number} [maxDelta=0.25] Largest frame delta in seconds that is simulated (> 0).
 */
/**
 * @typedef {object} GameApplicationStats
 * @property {number} frames Rendered frames.
 * @property {number} ticks Fixed ticks executed.
 * @property {number} droppedTicks Ticks discarded because `maxSubSteps` was exceeded.
 */
/**
 * @typedef {object} HitStopOptions
 * @property {number} [scale=0] Time scale during the freeze (>= 0).
 * @property {'max' | 'add' | 'replace'} [stackMode='max'] How overlapping hit-stops combine.
 */
/**
 * @typedef {object} PhysicsWorldFactory
 * @property {(options?: Record<string, unknown>) => import('./scene.js').ScenePhysicsWorld} createWorld
 */
/**
 * @typedef {object} ApplicationServices Installed optional services (keys exist only for loaded features).
 * @property {import('./scene.js').SceneManager} [scene]
 * @property {import('../platform/input/manager.js').InputManager} [input]
 * @property {import('../platform/assets.js').AssetLoader} [assets]
 * @property {import('../platform/audio.js').AudioManager} [audio]
 * @property {import('../platform/storage.js').SaveStore} [save]
 * @property {import('../platform/diagnostics.js').Diagnostics} [diagnostics]
 * @property {PhysicsWorldFactory} [physics2d]
 * @property {PhysicsWorldFactory} [physics3d]
 * @property {{ AnimationPlayer: typeof import('../animation/player.js').AnimationPlayer, SpriteSheet: typeof import('../animation/spritesheet.js').SpriteSheet }} [animation2d]
 * @property {{ TileMap: typeof import('../world/tilemap.js').TileMap, findGridPath: typeof import('../world/tilemap.js').findGridPath }} [tilemap2d]
 * @property {typeof import('../world/tilemap.js').findGridPath} [pathfinding2d]
 * @property {unknown} [model3d] Provider passed to `installFeatures`.
 * @property {object} [adaptiveQuality3d] The renderer's quality controller.
 */
/**
 * @typedef {object} GameFeatureAdapters
 * @property {unknown} [model3d] Loader/provider required by the `model3d` feature.
 */
/**
 * @typedef {object} GameApplication The single scheduler, scenes and services of one game.
 * @property {Readonly<import('./config.js').ProjectConfig>} project
 * @property {import('../platform/engine.js').GameEngine} platform
 * @property {GameRenderer} renderer
 * @property {ApplicationServices} services
 * @property {boolean} running
 * @property {boolean} paused
 * @property {boolean} disposed Whether application ownership has ended.
 * @property {GameApplicationStats} stats Snapshot copy.
 * @property {number} baseTimeScale
 * @property {number} hitStopRemaining Seconds of hit-stop left.
 * @property {number} timeScale Effective scale (hit-stop scale while active).
 * @property {number} unscaledDeltaSeconds Seconds of the last step before scaling.
 * @property {number} deltaSeconds Scaled seconds of the last step.
 * @property {number} renderAlpha Fixed-step interpolation factor, 0..1.
 * @property {import('../platform/input/manager.js').InputManager | null} input
 * @property {import('./scene.js').SceneManager} scenes
 * @property {(scale: number) => GameApplication} setTimeScale Global time scale (>= 0).
 * @property {(durationSeconds: number, options?: HitStopOptions) => GameApplication} hitStop
 * @property {() => GameApplication} clearHitStop
 * @property {(adapters?: GameFeatureAdapters) => Promise<GameApplication>} installFeatures Load declared optional features.
 * @property {(deltaSeconds: number) => GameApplicationStats} step Advance by `deltaSeconds` (seconds).
 * @property {() => boolean} start
 * @property {() => boolean} stop
 * @property {() => boolean} pause
 * @property {() => boolean} resume
 * @property {(command: import('./scene.js').GameCommand) => void} dispatch Send a command to the current scene.
 * @property {() => boolean} dispose
 */
/**
 * Create the application: one scheduler, independent scene/component model and optional services.
 * Standalone projects inject a renderer without loading any other renderer.
 * @param {GameApplicationOptions} [options]
 * @returns {GameApplication}
 */
export function createGameApplication({ project: recipe, platform, renderer, gameId, gameVersion, requestFrame, cancelFrame, maxSubSteps, maxDelta, }?: GameApplicationOptions | undefined): GameApplication;
/**
 * Renderer adapter injected into the application.
 */
export type GameRenderer = {
    /**
     * Draw the current scene.
     */
    render: (scene: import("./scene.js").Scene, app: GameApplication) => void;
    /**
     * Called on window resize.
     */
    resize?: (() => void) | undefined;
    /**
     * Called when the application is disposed.
     */
    dispose?: (() => void) | undefined;
    /**
     * Required by the `adaptiveQuality3d` feature (milliseconds).
     */
    recordFrameInterval?: ((frameIntervalMs: number) => void) | undefined;
    /**
     * Required by the `adaptiveQuality3d` feature.
     */
    qualityController?: object;
};
export type GameApplicationOptions = {
    /**
     * Project recipe (see {@link defineProject}).
     */
    project?: import("./config.js").ProjectOptions | undefined;
    /**
     * Existing platform services; a new engine is created and owned when omitted.
     */
    platform?: import("../platform/engine.js").GameEngine | undefined;
    /**
     * Explicit renderer adapter (required).
     */
    renderer: GameRenderer;
    /**
     * Slug for the owned platform engine.
     */
    gameId?: string | undefined;
    gameVersion?: string | undefined;
    /**
     * Default `requestAnimationFrame`.
     */
    requestFrame?: ((callback: (timeMs: number) => void) => number | undefined) | undefined;
    /**
     * Default `cancelAnimationFrame`.
     */
    cancelFrame?: ((id: number) => void) | undefined;
    /**
     * Max fixed ticks per frame, integer 1..240.
     */
    maxSubSteps?: number | undefined;
    /**
     * Largest frame delta in seconds that is simulated (> 0).
     */
    maxDelta?: number | undefined;
};
export type GameApplicationStats = {
    /**
     * Rendered frames.
     */
    frames: number;
    /**
     * Fixed ticks executed.
     */
    ticks: number;
    /**
     * Ticks discarded because `maxSubSteps` was exceeded.
     */
    droppedTicks: number;
};
export type HitStopOptions = {
    /**
     * Time scale during the freeze (>= 0).
     */
    scale?: number | undefined;
    /**
     * How overlapping hit-stops combine.
     */
    stackMode?: "replace" | "max" | "add" | undefined;
};
export type PhysicsWorldFactory = {
    createWorld: (options?: Record<string, unknown>) => import("./scene.js").ScenePhysicsWorld;
};
/**
 * Installed optional services (keys exist only for loaded features).
 */
export type ApplicationServices = {
    scene?: SceneManager | undefined;
    input?: import("../platform/input/manager.js").InputManager | undefined;
    assets?: import("../platform/assets.js").AssetLoader | undefined;
    audio?: import("../platform/audio.js").AudioManager | undefined;
    save?: import("../platform/storage.js").SaveStore | undefined;
    diagnostics?: import("../platform/diagnostics.js").Diagnostics | undefined;
    physics2d?: PhysicsWorldFactory | undefined;
    physics3d?: PhysicsWorldFactory | undefined;
    animation2d?: {
        AnimationPlayer: typeof import("../animation/player.js").AnimationPlayer;
        SpriteSheet: typeof import("../animation/spritesheet.js").SpriteSheet;
    } | undefined;
    tilemap2d?: {
        TileMap: typeof import("../world/tilemap.js").TileMap;
        findGridPath: typeof import("../world/tilemap.js").findGridPath;
    } | undefined;
    pathfinding2d?: typeof import("../index.js").findGridPath | undefined;
    /**
     * Provider passed to `installFeatures`.
     */
    model3d?: unknown;
    /**
     * The renderer's quality controller.
     */
    adaptiveQuality3d?: object;
};
export type GameFeatureAdapters = {
    /**
     * Loader/provider required by the `model3d` feature.
     */
    model3d?: unknown;
};
/**
 * The single scheduler, scenes and services of one game.
 */
export type GameApplication = {
    project: Readonly<import("./config.js").ProjectConfig>;
    platform: import("../platform/engine.js").GameEngine;
    renderer: GameRenderer;
    services: ApplicationServices;
    running: boolean;
    paused: boolean;
    /**
     * Whether application ownership has ended.
     */
    disposed: boolean;
    /**
     * Snapshot copy.
     */
    stats: GameApplicationStats;
    baseTimeScale: number;
    /**
     * Seconds of hit-stop left.
     */
    hitStopRemaining: number;
    /**
     * Effective scale (hit-stop scale while active).
     */
    timeScale: number;
    /**
     * Seconds of the last step before scaling.
     */
    unscaledDeltaSeconds: number;
    /**
     * Scaled seconds of the last step.
     */
    deltaSeconds: number;
    /**
     * Fixed-step interpolation factor, 0..1.
     */
    renderAlpha: number;
    input: import("../platform/input/manager.js").InputManager | null;
    scenes: import("./scene.js").SceneManager;
    /**
     * Global time scale (>= 0).
     */
    setTimeScale: (scale: number) => GameApplication;
    hitStop: (durationSeconds: number, options?: HitStopOptions) => GameApplication;
    clearHitStop: () => GameApplication;
    /**
     * Load declared optional features.
     */
    installFeatures: (adapters?: GameFeatureAdapters) => Promise<GameApplication>;
    /**
     * Advance by `deltaSeconds` (seconds).
     */
    step: (deltaSeconds: number) => GameApplicationStats;
    start: () => boolean;
    stop: () => boolean;
    pause: () => boolean;
    resume: () => boolean;
    /**
     * Send a command to the current scene.
     */
    dispatch: (command: import("./scene.js").GameCommand) => void;
    dispose: () => boolean;
};
import { SceneManager } from './scene.js';
