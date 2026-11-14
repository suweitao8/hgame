import { hashState } from '../sim/checksum.js';

/** @returns {Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>} */
function createMemoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

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
export function createSaveStore({
  gameId,
  schemaVersion = 1,
  storage,
  prefix = 'webasset.game',
} = {}) {
  if (typeof gameId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(gameId)) {
    throw new TypeError('gameId must be a stable slug');
  }
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) throw new TypeError('schemaVersion must be a positive integer');
  /** @type {any} */
  let backend = storage;
  if (backend === undefined) {
    try { backend = globalThis.localStorage; } catch { backend = null; }
  }
  try {
    const probe = prefix + '.__probe__';
    backend?.setItem(probe, '1');
    backend?.removeItem(probe);
    if (!backend) backend = createMemoryStorage();
  } catch {
    backend = createMemoryStorage();
  }
  const namespace = [prefix, gameId, 'v' + schemaVersion].join('.') + '.';

  /** @param {string} key @returns {string} */
  function keyFor(key) {
    if (typeof key !== 'string' || !key.trim() || key.includes('\0')) throw new TypeError('save key must be a non-empty string');
    return namespace + encodeURIComponent(key);
  }

  /** @returns {string[]} */
  function keys() {
    /** @type {string[]} */
    const result = [];
    for (let index = 0; index < backend.length; index++) {
      const fullKey = backend.key(index);
      if (fullKey?.startsWith(namespace)) {
        try { result.push(decodeURIComponent(fullKey.slice(namespace.length))); } catch { /* Ignore malformed foreign keys. */ }
      }
    }
    return result;
  }

  return Object.freeze({
    namespace,
    get(key, fallback) {
      const raw = backend.getItem(keyFor(key));
      if (raw === null) return fallback;
      try { return JSON.parse(raw); } catch { return fallback; }
    },
    set(key, value) {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) throw new TypeError('save value must be JSON serializable');
      backend.setItem(keyFor(key), serialized);
      return value;
    },
    remove(key) { backend.removeItem(keyFor(key)); },
    keys,
    clear() {
      for (const key of keys()) backend.removeItem(keyFor(key));
    },
  });
}

function computeEnvelopeSum(version, salt, data) {
  return (hashState({ v: version, salt: String(salt ?? ''), data }) >>> 0).toString(16).padStart(8, '0');
}

function isVersionEnvelope(entry) {
  return Boolean(entry && typeof entry === 'object' && entry.__hgSave === 1 && Number.isInteger(entry.v) && entry.v >= 1);
}

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
export function createVersionedStore({
  store,
  gameId = 'default-game',
  storage,
  prefix = 'webasset.game',
  schemaVersion = 1,
  migrations = {},
  checksum = true,
  salt = '',
  backupKeySuffix = '.bak',
  autoPersistMigrated = true,
} = {}) {
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new TypeError('schemaVersion must be a positive integer');
  }
  const backing = store ?? createSaveStore({ gameId, schemaVersion: 1, storage, prefix });
  const bakSuffix = typeof backupKeySuffix === 'string' ? backupKeySuffix : '.bak';

  function parseCandidate(raw) {
    if (raw === undefined || raw === null) return { status: 'missing' };
    if (isVersionEnvelope(raw)) {
      if (checksum && raw.sum !== undefined) {
        const expected = computeEnvelopeSum(raw.v, salt, raw.data);
        if (raw.sum !== expected) return { status: 'corrupt', reason: 'checksum-mismatch' };
      }
      return { status: 'ok', version: raw.v, data: raw.data, legacy: false };
    }
    return { status: 'ok', version: 1, data: raw, legacy: true };
  }

  function makeEnvelope(value) {
    return {
      __hgSave: 1,
      v: schemaVersion,
      sum: checksum ? computeEnvelopeSum(schemaVersion, salt, value) : undefined,
      ts: Date.now(),
      data: value,
    };
  }

  function save(key, value) {
    if (bakSuffix) {
      const prev = backing.get(key, null);
      if (parseCandidate(prev).status === 'ok') {
        try { backing.set(key + bakSuffix, prev); } catch { /* Best-effort backup. */ }
      }
    }
    const env = makeEnvelope(value);
    backing.set(key, env);
    return value;
  }

  function migrateData(startVersion, initialData) {
    let data = initialData;
    let v = startVersion;
    while (v < schemaVersion) {
      const fn = migrations[v] ?? migrations[String(v)];
      if (typeof fn !== 'function') {
        return { ok: false, reason: `missing-migration-v${v}`, version: v, data };
      }
      data = fn(data);
      v += 1;
    }
    return { ok: true, version: v, data };
  }

  function load(key, fallback) {
    const primaryRaw = backing.get(key, null);
    let parsed = parseCandidate(primaryRaw);
    let recovered = false;

    if (parsed.status !== 'ok' && bakSuffix) {
      const bakRaw = backing.get(key + bakSuffix, null);
      const bakParsed = parseCandidate(bakRaw);
      if (bakParsed.status === 'ok') {
        parsed = bakParsed;
        recovered = true;
      }
    }

    if (parsed.status !== 'ok') {
      return {
        ok: false,
        reason: parsed.reason ?? 'missing',
        value: fallback,
        version: null,
        fromVersion: null,
        migrated: false,
        recovered: false,
      };
    }

    if (parsed.version > schemaVersion) {
      return {
        ok: false,
        reason: 'future-version',
        value: fallback,
        version: parsed.version,
        fromVersion: parsed.version,
        migrated: false,
        recovered,
      };
    }

    let data = parsed.data;
    const migrated = parsed.version < schemaVersion || parsed.legacy;
    if (parsed.version < schemaVersion) {
      const res = migrateData(parsed.version, data);
      if (!res.ok) {
        return {
          ok: false,
          reason: res.reason,
          value: fallback,
          version: res.version,
          fromVersion: parsed.version,
          migrated: false,
          recovered,
        };
      }
      data = res.data;
    }

    if ((migrated || recovered) && autoPersistMigrated) {
      backing.set(key, makeEnvelope(data));
    }

    return {
      ok: true,
      value: data,
      version: schemaVersion,
      fromVersion: parsed.version,
      migrated,
      recovered,
    };
  }

  return Object.freeze({
    schemaVersion,
    store: backing,
    save,
    set: save,
    load,
    get(key, fallback) {
      const res = load(key, fallback);
      return res.ok ? res.value : fallback;
    },
    verify(key) {
      const parsed = parseCandidate(backing.get(key, null));
      return parsed.status === 'ok' && parsed.version <= schemaVersion;
    },
    remove(key) {
      backing.remove(key);
      if (bakSuffix) backing.remove(key + bakSuffix);
    },
  });
}
