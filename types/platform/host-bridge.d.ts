/**
 * @typedef {object} GameHostMessage Validated message from the embedded game.
 * @property {import('./game-bridge.js').GameMessageType} type
 * @property {string} gameId
 * @property {Record<string, unknown>} payload
 */
/**
 * @typedef {object} GameHostBridgeOptions
 * @property {HTMLIFrameElement} frame The iframe that hosts the game (required).
 * @property {Window} [windowRef] Host window (default `globalThis.window`).
 * @property {Document} [documentRef] Host document (default `globalThis.document`).
 * @property {(message: Readonly<GameHostMessage>) => void} [onMessage] Called for every accepted game message.
 */
/**
 * @typedef {object} GameHostSession
 * @property {string} gameId
 * @property {string} targetOrigin Normalized origin messages are posted to.
 * @property {string} sessionId
 * @property {boolean} ready True once `game:ready` was received.
 */
/**
 * @typedef {Record<import('./game-bridge.js').GameMessageType, Readonly<GameHostMessage>>} GameHostEvents
 */
/**
 * @typedef {object} GameHostBridge Host-side bridge for embedding a game iframe.
 * @property {GameHostSession | null} session Copy of the active session.
 * @property {import('./events.js').Emitter<GameHostEvents>['on']} on Subscribe to a `game:*` message type.
 * @property {(options: { gameId: string, targetOrigin: string }) => string} startSession Returns the new session id.
 * @property {() => void} stopSession
 * @property {() => boolean} sendResize Post `host:resize` using the frame's current size (pixels).
 * @property {(focused: boolean) => boolean} sendFocus
 * @property {() => boolean} dispose
 */
/**
 * Create the host-side bridge for an iframe-embedded game.
 * @param {GameHostBridgeOptions} options
 * @returns {GameHostBridge}
 */
export function createGameHostBridge({ frame, windowRef, documentRef, onMessage: onHostMessage, }?: GameHostBridgeOptions): GameHostBridge;
/**
 * Validated message from the embedded game.
 */
export type GameHostMessage = {
    type: import("./game-bridge.js").GameMessageType;
    gameId: string;
    payload: Record<string, unknown>;
};
export type GameHostBridgeOptions = {
    /**
     * The iframe that hosts the game (required).
     */
    frame: HTMLIFrameElement;
    /**
     * Host window (default `globalThis.window`).
     */
    windowRef?: Window;
    /**
     * Host document (default `globalThis.document`).
     */
    documentRef?: Document;
    /**
     * Called for every accepted game message.
     */
    onMessage?: (message: Readonly<GameHostMessage>) => void;
};
export type GameHostSession = {
    gameId: string;
    /**
     * Normalized origin messages are posted to.
     */
    targetOrigin: string;
    sessionId: string;
    /**
     * True once `game:ready` was received.
     */
    ready: boolean;
};
export type GameHostEvents = Record<import("./game-bridge.js").GameMessageType, Readonly<GameHostMessage>>;
/**
 * Host-side bridge for embedding a game iframe.
 */
export type GameHostBridge = {
    /**
     * Copy of the active session.
     */
    session: GameHostSession | null;
    /**
     * Subscribe to a `game:*` message type.
     */
    on: import("./events.js").Emitter<GameHostEvents>["on"];
    /**
     * Returns the new session id.
     */
    startSession: (options: {
        gameId: string;
        targetOrigin: string;
    }) => string;
    stopSession: () => void;
    /**
     * Post `host:resize` using the frame's current size (pixels).
     */
    sendResize: () => boolean;
    sendFocus: (focused: boolean) => boolean;
    dispose: () => boolean;
};
