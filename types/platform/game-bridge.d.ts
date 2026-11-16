/**
 * @typedef {object} GameBridgeOptions
 * @property {string} gameId Stable game slug echoed in every message.
 * @property {Window} [windowRef] Game window (default `globalThis.window`).
 * @property {Document} [documentRef] Used to infer the embedding origin from `referrer`.
 * @property {string} [parentOrigin] Explicit trusted parent origin (otherwise a loopback allowlist is used).
 */
/**
 * @typedef {object} GameBridgeEvents
 * @property {{ sessionId: string, capabilities: Record<string, unknown> }} connect Host handshake accepted.
 * @property {unknown} incompatible Rejected `host:hello` message.
 * @property {boolean} focus
 * @property {Partial<import('./lifecycle.js').ViewportSize>} resize
 * @property {boolean} visibility
 */
/** @typedef {'game:hello' | 'game:ready' | 'game:error' | 'game:metrics' | 'game:state'} GameMessageType */
/**
 * @typedef {object} GameBridge Game-side postMessage bridge to the embedding WebAsset host.
 * @property {boolean} connected True after an accepted `host:hello`.
 * @property {string | null} sessionId
 * @property {string | null} parentOrigin Trusted parent origin once established.
 * @property {string[]} allowedParentOrigins
 * @property {string} lastMessageStatus Debug status of the last inbound message (e.g. `'accepted:host:focus'`).
 * @property {import('./events.js').Emitter<GameBridgeEvents>['on']} on
 * @property {() => boolean} ready Request `game:ready`; true if it was sent now.
 * @property {(type: GameMessageType, payload?: unknown) => boolean} send Post to the parent; false when not connected.
 * @property {() => boolean} dispose
 */
/**
 * Create the game-side host bridge.
 * @param {GameBridgeOptions} [options]
 * @returns {GameBridge}
 */
export function createGameBridge({ gameId, windowRef, documentRef, parentOrigin, }?: GameBridgeOptions | undefined): GameBridge;
export type GameBridgeOptions = {
    /**
     * Stable game slug echoed in every message.
     */
    gameId: string;
    /**
     * Game window (default `globalThis.window`).
     */
    windowRef?: Window | undefined;
    /**
     * Used to infer the embedding origin from `referrer`.
     */
    documentRef?: Document | undefined;
    /**
     * Explicit trusted parent origin (otherwise a loopback allowlist is used).
     */
    parentOrigin?: string | undefined;
};
export type GameBridgeEvents = {
    /**
     * Host handshake accepted.
     */
    connect: {
        sessionId: string;
        capabilities: Record<string, unknown>;
    };
    /**
     * Rejected `host:hello` message.
     */
    incompatible: unknown;
    focus: boolean;
    resize: Partial<import("./lifecycle.js").ViewportSize>;
    visibility: boolean;
};
export type GameMessageType = "game:hello" | "game:ready" | "game:error" | "game:metrics" | "game:state";
/**
 * Game-side postMessage bridge to the embedding WebAsset host.
 */
export type GameBridge = {
    /**
     * True after an accepted `host:hello`.
     */
    connected: boolean;
    sessionId: string | null;
    /**
     * Trusted parent origin once established.
     */
    parentOrigin: string | null;
    allowedParentOrigins: string[];
    /**
     * Debug status of the last inbound message (e.g. `'accepted:host:focus'`).
     */
    lastMessageStatus: string;
    on: import("./events.js").Emitter<GameBridgeEvents>["on"];
    /**
     * Request `game:ready`; true if it was sent now.
     */
    ready: () => boolean;
    /**
     * Post to the parent; false when not connected.
     */
    send: (type: GameMessageType, payload?: unknown) => boolean;
    dispose: () => boolean;
};
