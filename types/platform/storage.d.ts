/**
 * @typedef {object} SaveStoreOptions
 * @property {string} gameId Stable slug (`/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/`).
 * @property {number} [schemaVersion=1] Positive integer; part of the key namespace.
 * @property {Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'> | null} [storage]
 *   Backend (default: `localStorage`, falling back to in-memory when absent or unreadable).
 *   A readable backend is retained when writes fail (for example, quota exhaustion).
 * @property {string} [prefix='webasset.game'] Namespace prefix.
 */
/**
 * @typedef {object} SaveStore JSON key/value save store scoped to one game and schema version.
 * @property {string} namespace Full key prefix used in the backend.
 * @property {<T = unknown>(key: string, fallback?: T) => T} get Read a value; returns `fallback` when missing or unparsable.
 * @property {<T>(key: string, value: T) => T} set Persist a JSON-serializable value; returns it. Backend write errors propagate.
 * @property {(key: string) => void} remove
 * @property {() => string[]} keys Keys saved in this namespace.
 * @property {() => void} clear Remove every key in this namespace.
 */
/**
 * Create a namespaced save store.
 * @param {SaveStoreOptions} [options]
 * @returns {SaveStore}
 */
export function createSaveStore({ gameId, schemaVersion, storage, prefix, }?: SaveStoreOptions | undefined): SaveStore;
/**
 * Wrap a SaveStore (or `{ gameId, storage }`) with explicit schema versioning,
 * sequential forward migrations (`v -> v + 1`), FNV-1a checksum tamper detection,
 * and automatic last-known-good backup recovery.
 * Values follow JSON serialization rules; checksums cover the stored JSON data.
 * A value that cannot be serialized is rejected before either save slot changes.
 * A failed automatic writeback still returns valid migrated/recovered data with
 * `writebackError` on the successful load result. Explicit saves continue to throw.
 * @template [T=unknown]
 * @param {object} [options]
 * @param {SaveStore} [options.store] Existing SaveStore (overrides `gameId`/`storage`/`prefix`).
 * @param {string} [options.gameId='default-game'] Game slug used if `store` is omitted.
 * @param {Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'> | null} [options.storage]
 * @param {string} [options.prefix='webasset.game'] Namespace prefix when `store` is omitted.
 * @param {number} [options.schemaVersion=1] Target schema version (`>= 1`).
 * @param {Record<number | string, (data: unknown) => unknown>} [options.migrations={}] Map of `fromVersion -> migrator(oldData)`.
 * @param {boolean} [options.checksum=true] Enable FNV-1a tamper detection on envelopes.
 * @param {string} [options.salt=''] Optional application salt mixed into envelope checksums.
 * @param {string} [options.backupKeySuffix='.bak'] Backup key suffix; empty string disables backup slot.
 * @param {boolean} [options.autoPersistMigrated=true] Re-save migrated/recovered data on `load()`; report write failures in `writebackError`.
 * @returns {Readonly<VersionedStore<T>>}
 */
export function createVersionedStore<T = unknown>({ store, gameId, storage, prefix, schemaVersion, migrations, checksum, salt, backupKeySuffix, autoPersistMigrated, }?: {
    store?: SaveStore | undefined;
    gameId?: string | undefined;
    storage?: Pick<Storage, "length" | "key" | "setItem" | "getItem" | "removeItem"> | null | undefined;
    prefix?: string | undefined;
    schemaVersion?: number | undefined;
    migrations?: Record<string | number, (data: unknown) => unknown> | undefined;
    checksum?: boolean | undefined;
    salt?: string | undefined;
    backupKeySuffix?: string | undefined;
    autoPersistMigrated?: boolean | undefined;
} | undefined): Readonly<VersionedStore<T>>;
export type SaveStoreOptions = {
    /**
     * Stable slug (`/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/`).
     */
    gameId: string;
    /**
     * Positive integer; part of the key namespace.
     */
    schemaVersion?: number | undefined;
    /**
     * Backend (default: `localStorage`, falling back to in-memory when absent or unreadable).
     * A readable backend is retained when writes fail (for example, quota exhaustion).
     */
    storage?: Pick<Storage, "length" | "key" | "setItem" | "getItem" | "removeItem"> | null | undefined;
    /**
     * Namespace prefix.
     */
    prefix?: string | undefined;
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
     * Persist a JSON-serializable value; returns it. Backend write errors propagate.
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
export type VersionedLoadResult<T, TFallback = undefined> = {
    ok: true;
    value: T;
    version: number;
    fromVersion: number;
    migrated: boolean;
    recovered: boolean;
    writebackError?: unknown;
} | {
    ok: false;
    reason: string;
    value: TFallback;
    version: number | null;
    fromVersion: number | null;
    migrated: false;
    recovered: boolean;
};
export type VersionedStore<T = unknown> = {
    schemaVersion: number;
    store: SaveStore;
    save: <TValue extends T>(key: string, value: TValue) => TValue;
    set: <TValue extends T>(key: string, value: TValue) => TValue;
    load: <TFallback = undefined>(key: string, fallback?: TFallback) => VersionedLoadResult<T, TFallback>;
    get: <TFallback = undefined>(key: string, fallback?: TFallback) => T | TFallback;
    verify: (key: string) => boolean;
    remove: (key: string) => void;
};
