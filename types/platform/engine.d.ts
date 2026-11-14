/**
 * @typedef {object} GameEngineOptions
 * @property {string} gameId Stable slug (`/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/`); required.
 * @property {string} [gameVersion='0.0.0']
 * @property {string} [renderer='custom'] Renderer label reported in `meta`.
 * @property {string} [assetBaseUrl='./assets/'] Asset root for the AssetLoader.
 * @property {Window} [windowRef] Default `globalThis.window`.
 * @property {Document} [documentRef] Default `globalThis.document`.
 * @property {import('./storage.js').SaveStoreOptions['storage']} [storage] Save backend (default `localStorage`).
 * @property {string} [parentOrigin] Trusted embedding origin for the host bridge.
 * @property {string[]} [preventDefaultKeys=[]] `KeyboardEvent.code` values whose default action is prevented.
 * @property {(report: import('./diagnostics.js').ErrorReport) => void} [onError] Called for every error report.
 */
/**
 * @typedef {object} GameEngineMeta
 * @property {string} gameId
 * @property {string} gameVersion
 * @property {string} renderer
 * @property {string} engineVersion
 * @property {number} protocolVersion
 */
/**
 * @typedef {object} GameEngine Frozen bundle of the platform services.
 * @property {Readonly<GameEngineMeta>} meta
 * @property {import('./lifecycle.js').Lifecycle} lifecycle
 * @property {import('./input/manager.js').InputManager} input
 * @property {import('./assets.js').AssetLoader} assets
 * @property {import('./storage.js').SaveStore} save
 * @property {import('./audio.js').AudioManager} audio
 * @property {import('./diagnostics.js').Diagnostics} diagnostics
 * @property {import('./game-bridge.js').GameBridge} host
 * @property {() => boolean} ready Signal readiness to lifecycle and host; false if disposed.
 * @property {(state: unknown) => boolean} reportState Send `game:state` to the host.
 * @property {(extra?: Record<string, unknown>) => boolean} reportMetrics Send diagnostics (+ `extra`) as `game:metrics`.
 * @property {() => boolean} dispose
 */
/**
 * Create the platform service bundle (lifecycle, input, assets, save, audio, diagnostics, host bridge).
 * @param {GameEngineOptions} options
 * @returns {Readonly<GameEngine>}
 */
export function createGameEngine({ gameId, gameVersion, renderer, assetBaseUrl, windowRef, documentRef, storage, parentOrigin, preventDefaultKeys, onError, }?: GameEngineOptions): Readonly<GameEngine>;
/** Platform service version string. */
export const PLATFORM_VERSION: "1.0.0";
export { createAssetLoader } from "./assets.js";
export { createDiagnostics } from "./diagnostics.js";
export { createGameBridge } from "./game-bridge.js";
export { createGameHostBridge } from "./host-bridge.js";
export type GameEngineOptions = {
    /**
     * Stable slug (`/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/`); required.
     */
    gameId: string;
    gameVersion?: string;
    /**
     * Renderer label reported in `meta`.
     */
    renderer?: string;
    /**
     * Asset root for the AssetLoader.
     */
    assetBaseUrl?: string;
    /**
     * Default `globalThis.window`.
     */
    windowRef?: Window;
    /**
     * Default `globalThis.document`.
     */
    documentRef?: Document;
    /**
     * Save backend (default `localStorage`).
     */
    storage?: import("./storage.js").SaveStoreOptions["storage"];
    /**
     * Trusted embedding origin for the host bridge.
     */
    parentOrigin?: string;
    /**
     * `KeyboardEvent.code` values whose default action is prevented.
     */
    preventDefaultKeys?: string[];
    /**
     * Called for every error report.
     */
    onError?: (report: import("./diagnostics.js").ErrorReport) => void;
};
export type GameEngineMeta = {
    gameId: string;
    gameVersion: string;
    renderer: string;
    engineVersion: string;
    protocolVersion: number;
};
/**
 * Frozen bundle of the platform services.
 */
export type GameEngine = {
    meta: Readonly<GameEngineMeta>;
    lifecycle: import("./lifecycle.js").Lifecycle;
    input: import("./input/manager.js").InputManager;
    assets: import("./assets.js").AssetLoader;
    save: import("./storage.js").SaveStore;
    audio: import("./audio.js").AudioManager;
    diagnostics: import("./diagnostics.js").Diagnostics;
    host: import("./game-bridge.js").GameBridge;
    /**
     * Signal readiness to lifecycle and host; false if disposed.
     */
    ready: () => boolean;
    /**
     * Send `game:state` to the host.
     */
    reportState: (state: unknown) => boolean;
    /**
     * Send diagnostics (+ `extra`) as `game:metrics`.
     */
    reportMetrics: (extra?: Record<string, unknown>) => boolean;
    dispose: () => boolean;
};
import { GAME_ENGINE_PROTOCOL } from './protocol.js';
import { GAME_ENGINE_PROTOCOL_VERSION } from './protocol.js';
export { GAME_ENGINE_PROTOCOL, GAME_ENGINE_PROTOCOL_VERSION };
export { createSaveStore, createVersionedStore } from "./storage.js";
export { createInputManager, defineInputContext, createInputActionRouter, ARCADE_SLOTS, PLAYER_KEYMAPS, createArcadeControls, computeSplitScreenViews } from "./input.js";
export { createAudioManager, analyzeAudioBuffer, normalizeVariantSet, SYNTH_PRESETS, synthesizeSfxPcm, createSynthSfx, BGM_MOODS, midiToHz, generateBgmStep, createProceduralBgm } from "./audio.js";
