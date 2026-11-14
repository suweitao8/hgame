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
/**
 * Wrap a SaveStore (or `{ gameId, storage }`) with explicit schema versioning,
 * sequential forward migrations (`v -> v + 1`), FNV-1a checksum tamper detection,
 * and automatic last-known-good backup recovery.
 * @param {object} [options]
 * @param {SaveStore} [options.store] Existing SaveStore (overrides `gameId`/`storage`/`prefix`).
 * @param {string} [options.gameId='default-game'] Game slug used if `store` is omitted.
 * @param {Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'> | null} [options.storage]
 * @param {string} [options.prefix='webasset.game'] Namespace prefix when `store` is omitted.
 * @param {number} [options.schemaVersion=1] Target schema version (`>= 1`).
 * @param {Record<number | string, (data: any) => any>} [options.migrations={}] Map of `fromVersion -> migrator(oldData)`.
 * @param {boolean} [options.checksum=true] Enable FNV-1a tamper detection on envelopes.
 * @param {string} [options.salt=''] Optional application salt mixed into envelope checksums.
 * @param {string} [options.backupKeySuffix='.bak'] Backup key suffix; empty string disables backup slot.
 * @param {boolean} [options.autoPersistMigrated=true] Re-save migrated data immediately on `load()`.
 */
export function createVersionedStore({ store, gameId, storage, prefix, schemaVersion, migrations, checksum, salt, backupKeySuffix, autoPersistMigrated, }?: {
    store?: SaveStore;
    gameId?: string;
    storage?: Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem"> | null;
    prefix?: string;
    schemaVersion?: number;
    migrations?: Record<number | string, (data: any) => any>;
    checksum?: boolean;
    salt?: string;
    backupKeySuffix?: string;
    autoPersistMigrated?: boolean;
}): Readonly<{
    schemaVersion: number;
    store: SaveStore;
    save: (key: any, value: any) => any;
    set: (key: any, value: any) => any;
    load: (key: any, fallback: any) => {
        ok: boolean;
        reason: string;
        value: any;
        version: any;
        fromVersion: any;
        migrated: boolean;
        recovered: boolean;
    } | {
        ok: boolean;
        value: any;
        version: number;
        fromVersion: any;
        migrated: boolean;
        recovered: boolean;
        reason?: undefined;
    };
    get(key: any, fallback: any): any;
    verify(key: any): boolean;
    remove(key: any): void;
}>;
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
