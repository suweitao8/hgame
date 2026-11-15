/**
 * Returns `true` when the Bilibili Toy JS SDK (`window.toy`) is loaded.
 * @returns {boolean}
 */
export function isBilibiliToyEnvironment(): boolean;
/**
 * Returns `true` if `error` is a Bilibili Toy rate-limit rejection (`307044`).
 * @param {unknown} error
 * @returns {boolean}
 */
export function isToyRateLimitError(error: unknown): boolean;
/**
 * Ensures the official Bilibili Toy JS SDK is loaded when running in a browser.
 * Returns `null` cleanly in headless/offline environments or when loading fails.
 * @param {{ timeoutMs?: number, forceInject?: boolean }} [options]
 * @returns {Promise<any | null>}
 */
export function loadBilibiliToySdk({ timeoutMs, forceInject }?: {
    timeoutMs?: number;
    forceInject?: boolean;
}): Promise<any | null>;
/**
 * @typedef {object} ToyBridgeOptions
 * @property {any} [sdk] Optional explicit `window.toy` instance (for testing).
 * @property {Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> | null} [fallbackStorage]
 *   Optional fallback storage used outside Bilibili Toy (`localStorage` by default).
 * @property {string} [gameId='hgame-toy'] Namespace prefix for local fallback storage.
 * @property {boolean} [autoRetryRateLimit=true] Retry `307044` rejections with exponential backoff.
 * @property {number} [maxRetries=3]
 * @property {number} [baseDelayMs=600]
 * @property {() => number} [random]
 */
/**
 * Create a resilient, rate-limit-aware wrapper around the Bilibili Toy JS SDK (`window.toy`)
 * with local preview fallbacks so games run identically in HGame preview and on Bilibili Toy.
 * @param {ToyBridgeOptions} [options]
 */
export function createToyBridge({ sdk, fallbackStorage, gameId, autoRetryRateLimit, maxRetries, baseDelayMs, random, }?: ToyBridgeOptions): Readonly<{
    readonly sdk: any;
    readonly isAvailable: boolean;
    /** @param {string} ability @returns {Promise<boolean>} */
    isSupport(ability: string): Promise<boolean>;
    withRateLimitBackoff: <T>(fn: () => Promise<T>) => Promise<T>;
    /** @param {string[]} [keys] @returns {Promise<Record<string, string>>} */
    getCloudStorage(keys?: string[]): Promise<Record<string, string>>;
    /** @param {Record<string, string>} items @returns {Promise<void>} */
    setCloudStorage(items: Record<string, string>): Promise<void>;
    /** @param {string[]} keys @returns {Promise<void>} */
    removeCloudStorage(keys: string[]): Promise<void>;
    /** @param {string} storageId @param {string[]} [keys] @returns {Promise<Record<string, string>>} */
    getSharedStorage(storageId: string, keys?: string[]): Promise<Record<string, string>>;
    /** @param {string} storageId @param {Record<string, string>} items @returns {Promise<void>} */
    setSharedStorage(storageId: string, items: Record<string, string>): Promise<void>;
    /** @param {string} storageId @param {string[]} keys @returns {Promise<void>} */
    removeSharedStorage(storageId: string, keys: string[]): Promise<void>;
    /**
     * Submit an absolute integer score (`-16777216..16777215`) to board `1..5` (default `1`).
     * @param {{ board?: number, score: number }} req
     * @returns {Promise<{ score: number }>}
     */
    submitScore(req: {
        board?: number;
        score: number;
    }): Promise<{
        score: number;
    }>;
    /**
     * @param {{ board?: number, period?: 'all' | 'month' | 'week' | 'day', limit?: number }} [req]
     * @returns {Promise<Array<{ rank: number, score: number, nickname: string, avatar: string }>>}
     */
    getRankList(req?: {
        board?: number;
        period?: "all" | "month" | "week" | "day";
        limit?: number;
    }): Promise<Array<{
        rank: number;
        score: number;
        nickname: string;
        avatar: string;
    }>>;
    /**
     * @param {{ board?: number, period?: 'all' | 'month' | 'week' | 'day' }} [req]
     * @returns {Promise<{ ranked: boolean, rank: number, score: number }>}
     */
    getMyRank(req?: {
        board?: number;
        period?: "all" | "month" | "week" | "day";
    }): Promise<{
        ranked: boolean;
        rank: number;
        score: number;
    }>;
    /**
     * Check player-submitted text. Treats `'unavailable'` strictly as `passed: false`.
     * @param {{ text: string, scene?: string }} req
     * @returns {Promise<{ status: 'ok' | 'rejected' | 'unavailable', passed: boolean }>}
     */
    checkInputSafety(req: {
        text: string;
        scene?: string;
    }): Promise<{
        status: "ok" | "rejected" | "unavailable";
        passed: boolean;
    }>;
    /** @returns {Promise<{ avatar: string, nickname: string, toyOpenId?: string }>} */
    getUserProfile(): Promise<{
        avatar: string;
        nickname: string;
        toyOpenId?: string;
    }>;
    getAuthorProfile(): Promise<any>;
    /** @param {{ videos: Array<{ aid: number } | { bvid: string }> }} req */
    getAuthorVideos(req: {
        videos: Array<{
            aid: number;
        } | {
            bvid: string;
        }>;
    }): Promise<any>;
    getAuthorRelation(): Promise<any>;
    /** @param {{ aids: number[] } | { videos: Array<{ aid: number } | { bvid: string }> }} req */
    getVideoUserActions(req: {
        aids: number[];
    } | {
        videos: Array<{
            aid: number;
        } | {
            bvid: string;
        }>;
    }): Promise<any>;
    /**
     * Query monthly charge tier unlock. `minPrice` is in **fen** (`1200` = 12 RMB;
     * 6 RMB / `600` does NOT unlock Toy content).
     * @param {{ minPrice?: number }} [req]
     */
    getChargeUnlock(req?: {
        minPrice?: number;
    }): Promise<any>;
    /** @param {{ minPrice?: number }} [req] */
    openChargePanel(req?: {
        minPrice?: number;
    }): Promise<any>;
    /** @param {(result: any) => void} listener @returns {() => void} */
    onChargeUnlockChange(listener: (result: any) => void): () => void;
    /** @param {{ path?: string, size?: number }} [req] */
    getQrCode(req?: {
        path?: string;
        size?: number;
    }): Promise<any>;
    /** @param {{ path: string }} req */
    share(req: {
        path: string;
    }): Promise<any>;
    /**
     * Save image to album inside Bilibili App, falling back to `<a download>` on Web
     * when `saveImageToAlbum` is unsupported.
     * @param {{ url?: string, base64Data?: string, hintMsg?: string, filename?: string }} req
     */
    saveImage(req: {
        url?: string;
        base64Data?: string;
        hintMsg?: string;
        filename?: string;
    }): Promise<any>;
    /** @param {{ type: string, id: string, extra?: Record<string, string> }} req */
    navigate(req: {
        type: string;
        id: string;
        extra?: Record<string, string>;
    }): Promise<any>;
    closeBrowser(): Promise<any>;
    /** @param {(state: any) => void} listener @returns {() => void} */
    onContainerChange(listener: (state: any) => void): () => void;
    getContainerState(): Promise<any>;
    /** @param {{ orientation?: 'portrait' | 'landscape' | 'auto', immersive?: boolean }} req */
    setContainerMode(req: {
        orientation?: "portrait" | "landscape" | "auto";
        immersive?: boolean;
    }): Promise<any>;
    /** @param {{ facingMode?: 'user' | 'environment' }} [options] */
    requestCamera(options?: {
        facingMode?: "user" | "environment";
    }): Promise<any>;
    requestMicrophone(): Promise<any>;
    /** @param {MediaStream} stream */
    stopMedia(stream: MediaStream): Promise<any>;
}>;
/**
 * Memory-first, checkpoint-flushed cloud save helper aligned with Bilibili Toy's
 * rate-limit best practices: reads once into memory, buffers writes, and batches dirty
 * keys into a single `setCloudStorage` / `setSharedStorage` call on `flush()` or page hide.
 * @param {{ bridge: ReturnType<typeof createToyBridge>, storageId?: string, bindPageHide?: boolean }} options
 */
export function createToyCloudSaveAdapter({ bridge, storageId, bindPageHide }: {
    bridge: ReturnType<typeof createToyBridge>;
    storageId?: string;
    bindPageHide?: boolean;
}): Readonly<{
    readonly loaded: boolean;
    readonly dirtyCount: number;
    load: (keys: any) => Promise<Record<string, string>>;
    get: <T>(key: string, fallback?: T) => T;
    set: (key: string, value: unknown) => void;
    remove: (key: string) => void;
    getAll: () => Record<string, string>;
    flush: () => Promise<void>;
    dispose: () => void;
}>;
/**
 * Bilibili Toy JS SDK adapter (`window.toy`) with rate-limit backoff, validation,
 * offline/local preview fallbacks, and checkpoint-batched cloud save helpers.
 *
 * Official SDK script: `//s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js`.
 */
export const BILIBILI_TOY_SDK_URL: "//s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js";
export const BILIBILI_TOY_RATE_LIMIT_CODE: 307044;
export type ToyBridgeOptions = {
    /**
     * Optional explicit `window.toy` instance (for testing).
     */
    sdk?: any;
    /**
     * Optional fallback storage used outside Bilibili Toy (`localStorage` by default).
     */
    fallbackStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length"> | null;
    /**
     * Namespace prefix for local fallback storage.
     */
    gameId?: string;
    /**
     * Retry `307044` rejections with exponential backoff.
     */
    autoRetryRateLimit?: boolean;
    maxRetries?: number;
    baseDelayMs?: number;
    random?: () => number;
};
