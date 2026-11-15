/**
 * Bilibili Toy JS SDK adapter (`window.toy`) with rate-limit backoff, validation,
 * offline/local preview fallbacks, and checkpoint-batched cloud save helpers.
 *
 * Official SDK script: `//s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js`.
 */

export const BILIBILI_TOY_SDK_URL = '//s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js';
export const BILIBILI_TOY_RATE_LIMIT_CODE = 307044;

const CLOUD_KEY_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const SAFETY_SCENE_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const SCORE_MIN = -16777216;
const SCORE_MAX = 16777215;
const UTF8_ENCODER = new TextEncoder();

/** @param {string} str @returns {number} */
function utf8ByteLength(str) {
  return UTF8_ENCODER.encode(str).byteLength;
}

/** @returns {any | null} */
function getGlobalToy() {
  return globalThis.window?.toy ?? globalThis.toy ?? null;
}

/**
 * Returns `true` when the Bilibili Toy JS SDK (`window.toy`) is loaded.
 * @returns {boolean}
 */
export function isBilibiliToyEnvironment() {
  const sdk = getGlobalToy();
  return Boolean(sdk && typeof sdk.isSupport === 'function');
}

/**
 * Returns `true` if `error` is a Bilibili Toy rate-limit rejection (`307044`).
 * @param {unknown} error
 * @returns {boolean}
 */
export function isToyRateLimitError(error) {
  if (!error || typeof error !== 'object') return false;
  const err = /** @type {{ type?: unknown, code?: unknown }} */ (error);
  return err.code === BILIBILI_TOY_RATE_LIMIT_CODE &&
    (err.type === 'http_error' || err.type === undefined);
}

/**
 * Ensures the official Bilibili Toy JS SDK is loaded when running in a browser.
 * Returns `null` cleanly in headless/offline environments or when loading fails.
 * @param {{ timeoutMs?: number, forceInject?: boolean }} [options]
 * @returns {Promise<any | null>}
 */
export async function loadBilibiliToySdk({ timeoutMs = 6000, forceInject = false } = {}) {
  const existing = getGlobalToy();
  if (existing) return existing;
  const doc = globalThis.document;
  const loc = globalThis.location;
  if (!doc || !doc.head) return null;
  const onBilibiliHost = Boolean(loc?.hostname && /(?:^|\.)bilibili\.com$/i.test(loc.hostname));
  if (!forceInject && !onBilibiliHost) return null;

  return new Promise(resolve => {
    const script = doc.createElement('script');
    script.src = loc?.protocol === 'http:' ? `http:${BILIBILI_TOY_SDK_URL}` : `https:${BILIBILI_TOY_SDK_URL}`;
    script.async = true;
    let settled = false;
    const finish = val => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    };
    const timer = setTimeout(() => finish(getGlobalToy()), timeoutMs);
    script.addEventListener('load', () => finish(getGlobalToy()), { once: true });
    script.addEventListener('error', () => finish(null), { once: true });
    doc.head.appendChild(script);
  });
}

/** @param {string} key */
function assertCloudKey(key) {
  if (typeof key !== 'string' || !CLOUD_KEY_RE.test(key) || key.startsWith('__')) {
    throw new RangeError(`Invalid Toy cloud storage key: "${String(key)}"`);
  }
}

/** @param {Record<string, string>} items */
function normalizeCloudItems(items) {
  if (!items || Array.isArray(items) || typeof items !== 'object') {
    throw new TypeError('Cloud storage items must be a plain object');
  }
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, rawVal] of Object.entries(items)) {
    assertCloudKey(key);
    const str = typeof rawVal === 'string' ? rawVal : JSON.stringify(rawVal);
    if (str === undefined) throw new TypeError(`Cloud storage value for "${key}" is not serializable`);
    if (utf8ByteLength(str) > 1024) {
      throw new RangeError(`Toy cloud storage value for "${key}" exceeds 1024 UTF-8 bytes`);
    }
    out[key] = str;
  }
  return out;
}

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
export function createToyBridge({
  sdk,
  fallbackStorage,
  gameId = 'hgame-toy',
  autoRetryRateLimit = true,
  maxRetries = 3,
  baseDelayMs = 600,
  random = Math.random,
} = {}) {
  const localPrefix = `hgame.toy.${gameId}.`;
  let localMem = new Map();
  let localBackend = fallbackStorage;
  if (localBackend === undefined) {
    try { localBackend = globalThis.localStorage ?? null; } catch { localBackend = null; }
  }

  /** @returns {any | null} */
  function resolveSdk() {
    return sdk ?? getGlobalToy();
  }

  /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  async function withRateLimitBackoff(fn) {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (err) {
        if (!autoRetryRateLimit || !isToyRateLimitError(err) || attempt >= maxRetries) {
          throw err;
        }
        const jitter = 0.8 + random() * 0.4;
        const delayMs = Math.round(baseDelayMs * Math.pow(2, attempt) * jitter);
        attempt++;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  /** @param {string} ns @param {string[]} [keys] @returns {Record<string, string>} */
  function readLocalMap(ns, keys) {
    const pfx = localPrefix + ns + '.';
    /** @type {Record<string, string>} */
    const out = {};
    if (localBackend) {
      if (Array.isArray(keys) && keys.length > 0) {
        for (const k of keys) {
          assertCloudKey(k);
          const v = localBackend.getItem(pfx + k);
          if (v !== null) out[k] = v;
        }
      } else {
        for (let i = 0; i < localBackend.length; i++) {
          const full = localBackend.key(i);
          if (full?.startsWith(pfx)) {
            const k = full.slice(pfx.length);
            const v = localBackend.getItem(full);
            if (v !== null) out[k] = v;
          }
        }
      }
      return out;
    }
    if (Array.isArray(keys) && keys.length > 0) {
      for (const k of keys) {
        assertCloudKey(k);
        if (localMem.has(pfx + k)) out[k] = localMem.get(pfx + k);
      }
    } else {
      for (const [full, val] of localMem.entries()) {
        if (full.startsWith(pfx)) out[full.slice(pfx.length)] = val;
      }
    }
    return out;
  }

  /** @param {string} ns @param {Record<string, string>} items */
  function writeLocalMap(ns, items) {
    const pfx = localPrefix + ns + '.';
    for (const [k, v] of Object.entries(items)) {
      if (localBackend) localBackend.setItem(pfx + k, v);
      else localMem.set(pfx + k, v);
    }
  }

  /** @param {string} ns @param {string[]} keys */
  function deleteLocalKeys(ns, keys) {
    const pfx = localPrefix + ns + '.';
    for (const k of keys) {
      assertCloudKey(k);
      if (localBackend) localBackend.removeItem(pfx + k);
      else localMem.delete(pfx + k);
    }
  }

  /** @param {string} method @returns {any} */
  function requireSdkMethod(method) {
    const toy = resolveSdk();
    if (!toy || typeof toy[method] !== 'function') {
      throw new Error(`[ToySDK] ${method} unavailable outside Bilibili Toy environment`);
    }
    return toy;
  }

  return Object.freeze({
    get sdk() { return resolveSdk(); },
    get isAvailable() { return Boolean(resolveSdk()); },

    /** @param {string} ability @returns {Promise<boolean>} */
    async isSupport(ability) {
      const toy = resolveSdk();
      if (!toy || typeof toy.isSupport !== 'function') return false;
      try {
        return Boolean(await toy.isSupport(ability));
      } catch {
        return false;
      }
    },

    withRateLimitBackoff,

    /** @param {string[]} [keys] @returns {Promise<Record<string, string>>} */
    async getCloudStorage(keys) {
      if (Array.isArray(keys)) keys.forEach(assertCloudKey);
      const toy = resolveSdk();
      if (!toy?.getCloudStorage) return readLocalMap('cloud', keys);
      return withRateLimitBackoff(() => toy.getCloudStorage(keys));
    },

    /** @param {Record<string, string>} items @returns {Promise<void>} */
    async setCloudStorage(items) {
      const normalized = normalizeCloudItems(items);
      if (Object.keys(normalized).length === 0) return;
      const toy = resolveSdk();
      if (!toy?.setCloudStorage) {
        writeLocalMap('cloud', normalized);
        return;
      }
      await withRateLimitBackoff(() => toy.setCloudStorage(normalized));
    },

    /** @param {string[]} keys @returns {Promise<void>} */
    async removeCloudStorage(keys) {
      if (!Array.isArray(keys)) throw new TypeError('keys must be an array');
      keys.forEach(assertCloudKey);
      if (keys.length === 0) return;
      const toy = resolveSdk();
      if (!toy?.removeCloudStorage) {
        deleteLocalKeys('cloud', keys);
        return;
      }
      await withRateLimitBackoff(() => toy.removeCloudStorage(keys));
    },

    /** @param {string} storageId @param {string[]} [keys] @returns {Promise<Record<string, string>>} */
    async getSharedStorage(storageId, keys) {
      if (typeof storageId !== 'string' || !storageId) throw new TypeError('storageId is required');
      if (Array.isArray(keys)) keys.forEach(assertCloudKey);
      const toy = resolveSdk();
      if (!toy?.getSharedStorage) return readLocalMap(`shared.${storageId}`, keys);
      return withRateLimitBackoff(() => toy.getSharedStorage(storageId, keys));
    },

    /** @param {string} storageId @param {Record<string, string>} items @returns {Promise<void>} */
    async setSharedStorage(storageId, items) {
      if (typeof storageId !== 'string' || !storageId) throw new TypeError('storageId is required');
      const normalized = normalizeCloudItems(items);
      if (Object.keys(normalized).length === 0) return;
      const toy = resolveSdk();
      if (!toy?.setSharedStorage) {
        writeLocalMap(`shared.${storageId}`, normalized);
        return;
      }
      await withRateLimitBackoff(() => toy.setSharedStorage(storageId, normalized));
    },

    /** @param {string} storageId @param {string[]} keys @returns {Promise<void>} */
    async removeSharedStorage(storageId, keys) {
      if (typeof storageId !== 'string' || !storageId) throw new TypeError('storageId is required');
      if (!Array.isArray(keys)) throw new TypeError('keys must be an array');
      keys.forEach(assertCloudKey);
      if (keys.length === 0) return;
      const toy = resolveSdk();
      if (!toy?.removeSharedStorage) {
        deleteLocalKeys(`shared.${storageId}`, keys);
        return;
      }
      await withRateLimitBackoff(() => toy.removeSharedStorage(storageId, keys));
    },

    /**
     * Submit an absolute integer score (`-16777216..16777215`) to board `1..5` (default `1`).
     * @param {{ board?: number, score: number }} req
     * @returns {Promise<{ score: number }>}
     */
    async submitScore(req) {
      if (!req || typeof req !== 'object') throw new TypeError('submitScore requires an object');
      const board = req.board ?? 1;
      if (!Number.isInteger(board) || board < 1 || board > 5) {
        throw new RangeError('Leaderboard board must be an integer 1..5');
      }
      if (!Number.isInteger(req.score) || req.score < SCORE_MIN || req.score > SCORE_MAX) {
        throw new RangeError(`Leaderboard score must be an integer in [${SCORE_MIN}, ${SCORE_MAX}]`);
      }
      const toy = resolveSdk();
      if (!toy?.submitScore) {
        const key = `lb_b${board}`;
        const prev = Number(readLocalMap('lb', [key])[key] ?? '-Infinity');
        const best = Math.max(prev, req.score);
        writeLocalMap('lb', { [key]: String(best) });
        return { score: best };
      }
      return withRateLimitBackoff(() => toy.submitScore({ board, score: req.score }));
    },

    /**
     * @param {{ board?: number, period?: 'all' | 'month' | 'week' | 'day', limit?: number }} [req]
     * @returns {Promise<Array<{ rank: number, score: number, nickname: string, avatar: string }>>}
     */
    async getRankList(req = {}) {
      const toy = resolveSdk();
      if (!toy?.getRankList) return [];
      return withRateLimitBackoff(() => toy.getRankList(req));
    },

    /**
     * @param {{ board?: number, period?: 'all' | 'month' | 'week' | 'day' }} [req]
     * @returns {Promise<{ ranked: boolean, rank: number, score: number }>}
     */
    async getMyRank(req = {}) {
      const toy = resolveSdk();
      if (!toy?.getMyRank) {
        const board = req.board ?? 1;
        const raw = readLocalMap('lb', [`lb_b${board}`])[`lb_b${board}`];
        return raw !== undefined
          ? { ranked: true, rank: 1, score: Number(raw) }
          : { ranked: false, rank: 0, score: 0 };
      }
      return withRateLimitBackoff(() => toy.getMyRank(req));
    },

    /**
     * Check player-submitted text. Treats `'unavailable'` strictly as `passed: false`.
     * @param {{ text: string, scene?: string }} req
     * @returns {Promise<{ status: 'ok' | 'rejected' | 'unavailable', passed: boolean }>}
     */
    async checkInputSafety(req) {
      if (!req || typeof req.text !== 'string' || !req.text) {
        throw new TypeError('checkInputSafety requires non-empty text');
      }
      if (utf8ByteLength(req.text) > 16384) {
        throw new RangeError('checkInputSafety text exceeds 16384 UTF-8 bytes');
      }
      if (req.scene !== undefined && !SAFETY_SCENE_RE.test(req.scene)) {
        throw new RangeError('checkInputSafety scene must match /^[A-Za-z0-9_.:-]{1,64}$/');
      }
      const toy = resolveSdk();
      if (!toy?.checkInputSafety) return { status: 'ok', passed: true };
      const res = await withRateLimitBackoff(() => toy.checkInputSafety(req));
      return { status: res.status, passed: res.status === 'ok' && Boolean(res.passed) };
    },

    /** @returns {Promise<{ avatar: string, nickname: string, toyOpenId?: string }>} */
    async getUserProfile() {
      const toy = requireSdkMethod('getUserProfile');
      return toy.getUserProfile();
    },

    async getAuthorProfile() {
      const toy = resolveSdk();
      if (!toy?.getAuthorProfile) return { status: 'unsupported' };
      return toy.getAuthorProfile();
    },

    /** @param {{ videos: Array<{ aid: number } | { bvid: string }> }} req */
    async getAuthorVideos(req) {
      const toy = resolveSdk();
      if (!toy?.getAuthorVideos) return { status: 'unsupported', items: [] };
      return toy.getAuthorVideos(req);
    },

    async getAuthorRelation() {
      const toy = resolveSdk();
      if (!toy?.getAuthorRelation) return { status: 'unsupported' };
      return toy.getAuthorRelation();
    },

    /** @param {{ aids: number[] } | { videos: Array<{ aid: number } | { bvid: string }> }} req */
    async getVideoUserActions(req) {
      const toy = resolveSdk();
      if (!toy?.getVideoUserActions) return { status: 'unsupported', items: [] };
      return toy.getVideoUserActions(req);
    },

    /**
     * Query monthly charge tier unlock. `minPrice` is in **fen** (`1200` = 12 RMB;
     * 6 RMB / `600` does NOT unlock Toy content).
     * @param {{ minPrice?: number }} [req]
     */
    async getChargeUnlock(req = {}) {
      const minPrice = req.minPrice ?? 1200;
      if (!Number.isInteger(minPrice) || minPrice <= 0) {
        throw new RangeError('minPrice must be a positive integer in fen (e.g. 1200 = 12 RMB)');
      }
      const toy = resolveSdk();
      if (!toy?.getChargeUnlock) return { status: 'unsupported' };
      return toy.getChargeUnlock({ minPrice });
    },

    /** @param {{ minPrice?: number }} [req] */
    async openChargePanel(req = {}) {
      const minPrice = req.minPrice ?? 1200;
      if (!Number.isInteger(minPrice) || minPrice <= 0) {
        throw new RangeError('minPrice must be a positive integer in fen (e.g. 1200 = 12 RMB)');
      }
      const toy = requireSdkMethod('openChargePanel');
      return toy.openChargePanel({ minPrice });
    },

    /** @param {(result: any) => void} listener @returns {() => void} */
    onChargeUnlockChange(listener) {
      const toy = resolveSdk();
      if (!toy?.onChargeUnlockChange) return () => {};
      return toy.onChargeUnlockChange(listener);
    },

    /** @param {{ path?: string, size?: number }} [req] */
    async getQrCode(req) {
      const toy = requireSdkMethod('getQrCode');
      return toy.getQrCode(req);
    },

    /** @param {{ path: string }} req */
    async share(req) {
      const toy = requireSdkMethod('share');
      return toy.share(req);
    },

    /**
     * Save image to album inside Bilibili App, falling back to `<a download>` on Web
     * when `saveImageToAlbum` is unsupported.
     * @param {{ url?: string, base64Data?: string, hintMsg?: string, filename?: string }} req
     */
    async saveImage(req) {
      if (!req || (!req.url && !req.base64Data)) {
        throw new TypeError('saveImage requires url or base64Data');
      }
      const toy = resolveSdk();
      if (toy?.saveImageToAlbum && (await this.isSupport('saveImageToAlbum'))) {
        return toy.saveImageToAlbum({
          ...(req.url ? { url: req.url } : {}),
          ...(req.base64Data ? { base64Data: req.base64Data } : {}),
          ...(req.hintMsg ? { hintMsg: req.hintMsg } : {}),
        });
      }
      const doc = globalThis.document;
      if (!doc) return { localPath: '' };
      const href = req.base64Data
        ? (req.base64Data.startsWith('data:') ? req.base64Data : `data:image/png;base64,${req.base64Data}`)
        : req.url;
      const a = doc.createElement('a');
      a.href = href;
      a.download = req.filename || 'toy-image.png';
      a.rel = 'noopener';
      doc.body?.appendChild(a);
      a.click();
      doc.body?.removeChild(a);
      return { localPath: a.download };
    },

    /** @param {{ type: string, id: string, extra?: Record<string, string> }} req */
    async navigate(req) {
      const toy = requireSdkMethod('navigate');
      return toy.navigate(req);
    },

    async closeBrowser() {
      const toy = requireSdkMethod('closeBrowser');
      return toy.closeBrowser();
    },

    /** @param {(state: any) => void} listener @returns {() => void} */
    onContainerChange(listener) {
      const toy = resolveSdk();
      if (!toy?.onContainerChange) return () => {};
      return toy.onContainerChange(listener);
    },

    async getContainerState() {
      const toy = requireSdkMethod('getContainerState');
      return toy.getContainerState();
    },

    /** @param {{ orientation?: 'portrait' | 'landscape' | 'auto', immersive?: boolean }} req */
    async setContainerMode(req) {
      const toy = requireSdkMethod('setContainerMode');
      return toy.setContainerMode(req);
    },

    /** @param {{ facingMode?: 'user' | 'environment' }} [options] */
    async requestCamera(options) {
      const toy = requireSdkMethod('requestCamera');
      return toy.requestCamera(options);
    },

    async requestMicrophone() {
      const toy = requireSdkMethod('requestMicrophone');
      return toy.requestMicrophone();
    },

    /** @param {MediaStream} stream */
    async stopMedia(stream) {
      const toy = resolveSdk();
      if (toy?.stopMedia) return toy.stopMedia(stream);
      if (stream && typeof stream.getTracks === 'function') {
        for (const t of stream.getTracks()) t.stop();
      }
    },
  });
}

/**
 * Memory-first, checkpoint-flushed cloud save helper aligned with Bilibili Toy's
 * rate-limit best practices: reads once into memory, buffers writes, and batches dirty
 * keys into a single `setCloudStorage` / `setSharedStorage` call on `flush()` or page hide.
 * @param {{ bridge: ReturnType<typeof createToyBridge>, storageId?: string, bindPageHide?: boolean }} options
 */
export function createToyCloudSaveAdapter({ bridge, storageId, bindPageHide = true }) {
  if (!bridge) throw new TypeError('createToyCloudSaveAdapter requires bridge');
  /** @type {Map<string, string>} */
  const cache = new Map();
  /** @type {Set<string>} */
  const dirty = new Set();
  /** @type {Set<string>} */
  const removed = new Set();
  let loaded = false;

  async function load(keys) {
    const data = storageId
      ? await bridge.getSharedStorage(storageId, keys)
      : await bridge.getCloudStorage(keys);
    for (const [k, v] of Object.entries(data || {})) {
      if (!dirty.has(k) && !removed.has(k)) cache.set(k, v);
    }
    loaded = true;
    return getAll();
  }

  /** @template T @param {string} key @param {T} [fallback] @returns {T} */
  function get(key, fallback) {
    assertCloudKey(key);
    if (!cache.has(key)) return /** @type {T} */ (fallback);
    const raw = /** @type {string} */ (cache.get(key));
    try { return JSON.parse(raw); } catch { return /** @type {T} */ (raw); }
  }

  /** @param {string} key @param {unknown} value */
  function set(key, value) {
    assertCloudKey(key);
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    if (str === undefined) throw new TypeError(`Value for "${key}" is not serializable`);
    if (utf8ByteLength(str) > 1024) throw new RangeError(`Value for "${key}" exceeds 1024 UTF-8 bytes`);
    cache.set(key, str);
    removed.delete(key);
    dirty.add(key);
  }

  /** @param {string} key */
  function remove(key) {
    assertCloudKey(key);
    cache.delete(key);
    dirty.delete(key);
    removed.add(key);
  }

  /** @returns {Record<string, string>} */
  function getAll() {
    return Object.fromEntries(cache.entries());
  }

  async function flush() {
    if (dirty.size > 0) {
      /** @type {Record<string, string>} */
      const batch = {};
      for (const k of dirty) {
        if (cache.has(k)) batch[k] = /** @type {string} */ (cache.get(k));
      }
      if (Object.keys(batch).length > 0) {
        if (storageId) await bridge.setSharedStorage(storageId, batch);
        else await bridge.setCloudStorage(batch);
      }
      dirty.clear();
    }
    if (removed.size > 0) {
      const delKeys = [...removed];
      if (storageId) await bridge.removeSharedStorage(storageId, delKeys);
      else await bridge.removeCloudStorage(delKeys);
      removed.clear();
    }
  }

  let detach = () => {};
  if (bindPageHide && globalThis.document?.addEventListener) {
    const onHide = () => {
      if (globalThis.document.visibilityState === 'hidden' && (dirty.size > 0 || removed.size > 0)) {
        flush().catch(() => {});
      }
    };
    const onPageHide = () => {
      if (dirty.size > 0 || removed.size > 0) flush().catch(() => {});
    };
    globalThis.document.addEventListener('visibilitychange', onHide);
    globalThis.window?.addEventListener?.('pagehide', onPageHide);
    detach = () => {
      globalThis.document.removeEventListener('visibilitychange', onHide);
      globalThis.window?.removeEventListener?.('pagehide', onPageHide);
    };
  }

  return Object.freeze({
    get loaded() { return loaded; },
    get dirtyCount() { return dirty.size + removed.size; },
    load,
    get,
    set,
    remove,
    getAll,
    flush,
    dispose: detach,
  });
}
