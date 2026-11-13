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

  function keyFor(key) {
    if (typeof key !== 'string' || !key.trim() || key.includes('\0')) throw new TypeError('save key must be a non-empty string');
    return namespace + encodeURIComponent(key);
  }

  function keys() {
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
