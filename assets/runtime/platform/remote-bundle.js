/**
 * Remote asset bundle loader with topological dependency resolution, exponential-backoff
 * retries, AbortSignal cancellation, SHA-256 integrity verification, Cache Storage / memory
 * caching, and `createAssetCatalog` loader adapter.
 */

function isAbortError(err) {
  return Boolean(err && (err.name === 'AbortError' || err.code === 'ABORT_ERR'));
}

function makeAbortError(reason) {
  if (reason instanceof Error && reason.name === 'AbortError') return reason;
  const err = new Error(typeof reason === 'string' ? reason : 'The operation was aborted');
  err.name = 'AbortError';
  return err;
}

function bytesToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

async function computeSha256Hex(arrayBuffer) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.digest) {
    throw new Error('WebCrypto subtle.digest is unavailable for bundle integrity verification');
  }
  const hash = await subtle.digest('SHA-256', arrayBuffer);
  return bytesToHex(hash);
}

function resolveUrl(baseUrl, relPath) {
  if (/^[a-z]+:\/\//i.test(relPath) || relPath.startsWith('data:') || relPath.startsWith('blob:')) {
    return relPath;
  }
  if (!baseUrl) return relPath;
  try {
    return new URL(relPath, baseUrl).toString();
  } catch {
    return baseUrl.replace(/\/+$/, '') + '/' + relPath.replace(/^\/+/, '');
  }
}

function sleepWithAbort(ms, signal) {
  if (ms <= 0) {
    return signal?.aborted ? Promise.reject(makeAbortError(signal.reason)) : Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError(signal.reason));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(makeAbortError(signal.reason));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/**
 * Create a remote asset bundle loader.
 *
 * @param {{
 *   manifestUrl: string,
 *   manifest?: { version?: string | number, bundles: Record<string, { files: Array<{ path: string, size?: number, sha256?: string }>, deps?: string[] }> } | null,
 *   fetch?: typeof globalThis.fetch,
 *   cache?: 'auto' | 'memory' | null,
 *   cacheName?: string,
 *   caches?: CacheStorage | null,
 *   retries?: number,
 *   backoffMs?: number,
 *   timeoutMs?: number,
 *   integrity?: boolean,
 *   maxConcurrent?: number,
 *   baseUrl?: string | null,
 * }} options
 */
export function createRemoteBundleLoader({
  manifestUrl,
  manifest: inlineManifest = null,
  fetch = globalThis.fetch,
  cache = 'auto',
  cacheName = 'hgame-remote-bundles-v1',
  caches: cacheStorage = globalThis.caches,
  retries = 3,
  backoffMs = 300,
  timeoutMs = 15000,
  integrity = true,
  maxConcurrent = 4,
  baseUrl = null,
} = {}) {
  if (!manifestUrl && !inlineManifest) {
    throw new TypeError('createRemoteBundleLoader requires manifestUrl or manifest');
  }
  if (typeof fetch !== 'function') {
    throw new TypeError('createRemoteBundleLoader requires a fetch implementation');
  }

  const effectiveBaseUrl = baseUrl ?? manifestUrl ?? '';
  const maxRetries = Math.max(0, Math.floor(Number(retries) || 0));
  const baseBackoff = Math.max(0, Number(backoffMs) || 0);
  const requestTimeoutMs = Math.max(0, Number(timeoutMs) || 0);
  const concurrencyLimit = Math.max(1, Math.floor(Number(maxConcurrent) || 1));

  let manifest = inlineManifest ? normalizeManifest(inlineManifest) : null;
  let manifestPromise = null;
  let cacheBucketPromise = null;

  /** @type {Map<string, ArrayBuffer>} */
  const memoryFiles = new Map();
  /** @type {Map<string, Set<string>>} */
  const loadedBundles = new Map();
  /** @type {Map<string, number>} */
  const bundleRefCounts = new Map();
  /** @type {Map<string, number>} */
  const fileRefCounts = new Map();
  /** @type {Map<string, Promise<ArrayBuffer>>} */
  const inflightFiles = new Map();

  let activeRequests = 0;
  /** @type {Array<() => void>} */
  const waitQueue = [];

  const metrics = {
    hits: 0,
    misses: 0,
    retries: 0,
    failures: 0,
  };

  function normalizeManifest(raw) {
    if (!raw || typeof raw !== 'object' || !raw.bundles || typeof raw.bundles !== 'object') {
      throw new TypeError('Invalid bundle manifest: missing "bundles" object');
    }
    const bundles = {};
    for (const [id, spec] of Object.entries(raw.bundles)) {
      const files = Array.isArray(spec?.files)
        ? spec.files.map((f) =>
            typeof f === 'string'
              ? { path: f, size: 0, sha256: null }
              : { path: String(f.path), size: Number(f.size) || 0, sha256: f.sha256 ? String(f.sha256).toLowerCase() : null }
          )
        : [];
      const deps = Array.isArray(spec?.deps) ? spec.deps.map(String) : [];
      bundles[id] = { files, deps };
    }
    return {
      version: raw.version ?? '1',
      bundles,
    };
  }

  async function openCacheBucket() {
    if (cache !== 'auto' || !cacheStorage || typeof cacheStorage.open !== 'function') {
      return null;
    }
    if (!cacheBucketPromise) {
      cacheBucketPromise = cacheStorage.open(cacheName).catch(() => null);
    }
    return cacheBucketPromise;
  }

  async function withConcurrency(fn, signal) {
    if (signal?.aborted) throw makeAbortError(signal.reason);
    if (activeRequests >= concurrencyLimit) {
      await new Promise((resolve, reject) => {
        const entry = {
          resolve: () => {
            signal?.removeEventListener?.('abort', onAbort);
            resolve();
          },
        };
        const onAbort = () => {
          const idx = waitQueue.indexOf(entry);
          if (idx >= 0) waitQueue.splice(idx, 1);
          reject(makeAbortError(signal.reason));
        };
        waitQueue.push(entry);
        signal?.addEventListener?.('abort', onAbort, { once: true });
      });
    }
    activeRequests++;
    try {
      return await fn();
    } finally {
      activeRequests--;
      const next = waitQueue.shift();
      if (next) next.resolve();
    }
  }

  async function fetchWithRetry(url, { signal, expectedSha256 = null } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) throw makeAbortError(signal.reason);

      const attemptController = new AbortController();
      let timedOut = false;
      const onCallerAbort = () => attemptController.abort(signal.reason);
      signal?.addEventListener?.('abort', onCallerAbort, { once: true });
      const timer = requestTimeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            attemptController.abort(new Error(`Request timed out after ${requestTimeoutMs}ms: ${url}`));
          }, requestTimeoutMs)
        : null;

      try {
        const response = await fetch(url, { signal: attemptController.signal });
        if (!response || !response.ok) {
          const status = response?.status ?? 0;
          const err = new Error(`HTTP ${status} fetching ${url}`);
          err.status = status;
          throw err;
        }
        const buf = await response.arrayBuffer();
        if (integrity && expectedSha256) {
          const actual = await computeSha256Hex(buf);
          if (actual !== expectedSha256) {
            const err = new Error(`Integrity mismatch for ${url}: expected ${expectedSha256}, got ${actual}`);
            err.code = 'ERR_INTEGRITY';
            throw err;
          }
        }
        return buf;
      } catch (err) {
        if (signal?.aborted) {
          throw makeAbortError(signal.reason);
        }
        if (err?.code === 'ERR_INTEGRITY') {
          metrics.failures++;
          throw err;
        }
        lastError = timedOut ? new Error(`Request timed out after ${requestTimeoutMs}ms: ${url}`) : err;
        if (attempt < maxRetries) {
          metrics.retries++;
          const delay = baseBackoff * (1 << attempt);
          await sleepWithAbort(delay, signal);
        }
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener?.('abort', onCallerAbort);
      }
    }
    metrics.failures++;
    throw lastError || new Error(`Failed to fetch ${url}`);
  }

  /** @param {{ signal?: AbortSignal }} [options] */
  async function loadManifest({ signal } = {}) {
    if (manifest) return manifest;
    if (!manifestPromise) {
      manifestPromise = (async () => {
        const buf = await fetchWithRetry(manifestUrl, { signal });
        const json = JSON.parse(new TextDecoder().decode(buf));
        manifest = normalizeManifest(json);
        return manifest;
      })().catch((err) => {
        manifestPromise = null;
        throw err;
      });
    }
    return manifestPromise;
  }

  function resolveBundleOrder(bundleId, mf) {
    const order = [];
    const visiting = new Set();
    const visited = new Set();

    const visit = (id) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Circular bundle dependency involving "${id}"`);
      }
      const spec = mf.bundles[id];
      if (!spec) {
        throw new Error(`Unknown bundle "${id}" in manifest`);
      }
      visiting.add(id);
      for (const dep of spec.deps) {
        visit(dep);
      }
      visiting.delete(id);
      visited.add(id);
      order.push(id);
    };

    visit(bundleId);
    return order;
  }

  async function loadFile(fileSpec, mf, { signal } = {}) {
    const relPath = fileSpec.path;
    const url = resolveUrl(effectiveBaseUrl, relPath);
    const cacheKey = `${mf.version}::${relPath}`;

    if (cache !== null && memoryFiles.has(cacheKey)) {
      metrics.hits++;
      return memoryFiles.get(cacheKey);
    }

    if (inflightFiles.has(cacheKey)) {
      return inflightFiles.get(cacheKey);
    }

    const promise = (async () => {
      const bucket = await openCacheBucket();
      if (bucket && typeof bucket.match === 'function') {
        const cachedResp = await bucket.match(url).catch(() => null);
        if (cachedResp) {
          const cachedBuf = await cachedResp.arrayBuffer();
          if (!integrity || !fileSpec.sha256 || (await computeSha256Hex(cachedBuf)) === fileSpec.sha256) {
            metrics.hits++;
            if (cache !== null) memoryFiles.set(cacheKey, cachedBuf);
            return cachedBuf;
          }
        }
      }

      metrics.misses++;
      const buf = await withConcurrency(
        () => fetchWithRetry(url, { signal, expectedSha256: fileSpec.sha256 }),
        signal
      );

      if (cache !== null) {
        memoryFiles.set(cacheKey, buf);
      }
      if (bucket && typeof bucket.put === 'function' && typeof Response === 'function') {
        await bucket.put(url, new Response(buf.slice(0))).catch(() => {});
      }
      return buf;
    })().finally(() => {
      inflightFiles.delete(cacheKey);
    });

    inflightFiles.set(cacheKey, promise);
    return promise;
  }

  /** @param {string} id @param {{ signal?: AbortSignal, onProgress?: (progress: object) => void }} [options] */
  async function loadBundle(id, { signal, onProgress } = {}) {
    if (signal?.aborted) throw makeAbortError(signal.reason);
    const mf = await loadManifest({ signal });
    const order = resolveBundleOrder(id, mf);

    const orderedFiles = [];
    const seenPaths = new Set();
    let totalBytes = 0;
    for (const bId of order) {
      for (const f of mf.bundles[bId].files) {
        if (!seenPaths.has(f.path)) {
          seenPaths.add(f.path);
          orderedFiles.push({ bundleId: bId, file: f });
          totalBytes += f.size || 0;
        }
      }
    }

    let loadedFiles = 0;
    let loadedBytes = 0;
    const result = new Map();

    // Load bundles sequentially in topological dependency order, files within a bundle concurrently
    for (const bId of order) {
      const spec = mf.bundles[bId];
      const loadedKeysForBundle = new Set();
      await Promise.all(
        spec.files.map(async (fileSpec) => {
          const buf = await loadFile(fileSpec, mf, { signal });
          result.set(fileSpec.path, buf);
          loadedKeysForBundle.add(`${mf.version}::${fileSpec.path}`);
          loadedFiles++;
          loadedBytes += fileSpec.size || buf.byteLength;
          onProgress?.({
            bundleId: bId,
            file: fileSpec.path,
            loadedFiles,
            totalFiles: orderedFiles.length,
            loadedBytes,
            totalBytes: Math.max(totalBytes, loadedBytes),
            ratio: orderedFiles.length > 0 ? loadedFiles / orderedFiles.length : 1,
          });
        })
      );

      if (!loadedBundles.has(bId)) {
        loadedBundles.set(bId, loadedKeysForBundle);
        for (const k of loadedKeysForBundle) {
          fileRefCounts.set(k, (fileRefCounts.get(k) || 0) + 1);
        }
      }
      bundleRefCounts.set(bId, (bundleRefCounts.get(bId) || 0) + 1);
    }

    return result;
  }

  function unloadBundle(id) {
    if (!manifest || !bundleRefCounts.has(id)) return false;
    const order = resolveBundleOrder(id, manifest).reverse();
    let unloadedAny = false;
    for (const bId of order) {
      const count = bundleRefCounts.get(bId) || 0;
      if (count <= 0) continue;
      if (count > 1) {
        bundleRefCounts.set(bId, count - 1);
        continue;
      }
      bundleRefCounts.delete(bId);
      const keys = loadedBundles.get(bId);
      loadedBundles.delete(bId);
      unloadedAny = true;
      if (keys) {
        for (const k of keys) {
          const fc = (fileRefCounts.get(k) || 1) - 1;
          if (fc <= 0) {
            fileRefCounts.delete(k);
            memoryFiles.delete(k);
          } else {
            fileRefCounts.set(k, fc);
          }
        }
      }
    }
    return unloadedAny;
  }

  function getFile(relPath) {
    if (!manifest) return null;
    const key = `${manifest.version}::${relPath}`;
    return memoryFiles.get(key) ?? null;
  }

  /** @param {string} relPath @param {{ signal?: AbortSignal }} [options] */
  async function fetchFile(relPath, { signal } = {}) {
    const cached = getFile(relPath);
    if (cached) {
      metrics.hits++;
      return cached;
    }
    const url = resolveUrl(effectiveBaseUrl, relPath);
    const mfVersion = manifest?.version ?? '1';
    const key = `${mfVersion}::${relPath}`;
    metrics.misses++;
    const buf = await withConcurrency(() => fetchWithRetry(url, { signal }), signal);
    if (cache !== null) memoryFiles.set(key, buf);
    return buf;
  }

  function stats() {
    let residentBytes = 0;
    for (const buf of memoryFiles.values()) {
      residentBytes += buf.byteLength;
    }
    return Object.freeze({
      manifestLoaded: Boolean(manifest),
      loadedBundles: Array.from(loadedBundles.keys()),
      cachedFiles: memoryFiles.size,
      residentBytes,
      hits: metrics.hits,
      misses: metrics.misses,
      retries: metrics.retries,
      failures: metrics.failures,
      activeRequests,
    });
  }

  const instance = {
    loadManifest,
    loadBundle,
    unloadBundle,
    getFile,
    fetchFile,
    stats,
    resolve(relPath) {
      return resolveUrl(effectiveBaseUrl, relPath);
    },
    toCatalogLoader() {
      return toCatalogLoader(instance);
    },
  };

  return instance;
}

/**
 * Adapt a `createRemoteBundleLoader` instance to the `loader` interface expected by
 * `createAssetCatalog(data, { loader })`.
 *
 * @param {ReturnType<typeof createRemoteBundleLoader>} bundleLoader
 */
export function toCatalogLoader(bundleLoader) {
  if (!bundleLoader || typeof bundleLoader.fetchFile !== 'function') {
    throw new TypeError('toCatalogLoader requires a createRemoteBundleLoader instance');
  }
  return {
    resolve(relPath) {
      return bundleLoader.resolve(relPath);
    },
    async arrayBuffer(relPath, opts = {}) {
      const buf = await bundleLoader.fetchFile(relPath, opts);
      return buf.slice(0);
    },
    async text(relPath, opts = {}) {
      const buf = await bundleLoader.fetchFile(relPath, opts);
      return new TextDecoder().decode(buf);
    },
    async json(relPath, opts = {}) {
      const buf = await bundleLoader.fetchFile(relPath, opts);
      return JSON.parse(new TextDecoder().decode(buf));
    },
    async blob(relPath, opts = {}) {
      const buf = await bundleLoader.fetchFile(relPath, opts);
      return new Blob([buf]);
    },
    async image(relPath, opts = {}) {
      const buf = await bundleLoader.fetchFile(relPath, opts);
      const blob = new Blob([buf]);
      if (typeof globalThis.createImageBitmap === 'function') {
        return globalThis.createImageBitmap(blob);
      }
      return blob;
    },
  };
}
