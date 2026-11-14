/**
 * @typedef {object} SaveStoreOptions
 * @property {string} gameId Stable slug (`/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/`).
 * @property {number} [schemaVersion=1] Positive integer; part of the key namespace.
 * @property {Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'> | null} [storage]
 *   Backend (default: `localStorage`, falling back to in-memory when unavailable).
 * @property {string} [prefix='webasset.game'] Namespace prefix.
 */
/**
 * @typedef {object} SaveStore JSON key/value save store scoped to one game and schema version.
 * @property {string} namespace Full key prefix used in the backend.
 * @property {<T = unknown>(key: string, fallback?: T) => T} get Read a value; returns `fallback` when missing or unparsable.
 * @property {<T>(key: string, value: T) => T} set Persist a JSON-serializable value; returns it.
 * @property {(key: string) => void} remove
 * @property {() => string[]} keys Keys saved in this namespace.
 * @property {() => void} clear Remove every key in this namespace.
 */
/**
 * Create a namespaced save store.
 * @param {SaveStoreOptions} [options]
 * @returns {SaveStore}
 */
export function createSaveStore({ gameId, schemaVersion, storage, prefix, }?: SaveStoreOptions): SaveStore;
export type SaveStoreOptions = {
    /**
     * Stable slug (`/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/`).
     */
    gameId: string;
    /**
     * Positive integer; part of the key namespace.
     */
    schemaVersion?: number;
    /**
     * Backend (default: `localStorage`, falling back to in-memory when unavailable).
     */
    storage?: Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem"> | null;
    /**
     * Namespace prefix.
     */
    prefix?: string;
};
/**
 * JSON key/value save store scoped to one game and schema version.
 */
export type SaveStore = {
    /**
     * Full key prefix used in the backend.
     */
    namespace: string;
    /**
     * Read a value; returns `fallback` when missing or unparsable.
     */
    get: <T = unknown>(key: string, fallback?: T) => T;
    /**
     * Persist a JSON-serializable value; returns it.
     */
    set: <T>(key: string, value: T) => T;
    remove: (key: string) => void;
    /**
     * Keys saved in this namespace.
     */
    keys: () => string[];
    /**
     * Remove every key in this namespace.
     */
    clear: () => void;
};
