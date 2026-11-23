import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssetCatalog } from '../assets/runtime/platform/asset-catalog.js';
import { createRemoteBundleLoader, toCatalogLoader } from '../assets/runtime/platform/remote-bundle.js';

async function sha256Hex(bytes) {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function textBytes(str) {
  return new TextEncoder().encode(str);
}

test('remote-bundle retries transient failures with exponential backoff and succeeds', async () => {
  const payload = textBytes('{"hp":100}');
  const sha = await sha256Hex(payload);
  const manifest = {
    version: '1.0',
    bundles: {
      core: {
        files: [{ path: 'data/stats.json', size: payload.byteLength, sha256: sha }],
        deps: [],
      },
    },
  };

  let attempts = 0;
  const mockFetch = async (url) => {
    if (url.endsWith('manifest.json')) {
      return { ok: true, status: 200, arrayBuffer: async () => textBytes(JSON.stringify(manifest)).buffer };
    }
    attempts++;
    if (attempts < 3) {
      return { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return { ok: true, status: 200, arrayBuffer: async () => payload.buffer.slice(0) };
  };

  const loader = createRemoteBundleLoader({
    manifestUrl: 'https://cdn.example.com/bundles/manifest.json',
    fetch: mockFetch,
    retries: 3,
    backoffMs: 5,
    cache: 'memory',
  });

  const progressEvents = [];
  const files = await loader.loadBundle('core', { onProgress: (p) => progressEvents.push(p) });
  assert.equal(attempts, 3);
  assert.equal(new TextDecoder().decode(files.get('data/stats.json')), '{"hp":100}');
  assert.equal(progressEvents.length, 1);
  assert.equal(progressEvents[0].ratio, 1);
  assert.equal(loader.stats().retries, 2);

  // Second load should hit memory cache with zero additional fetches
  await loader.loadBundle('core');
  assert.equal(attempts, 3);
  assert.ok(loader.stats().hits >= 1);
});

test('remote-bundle rejects when retries are exhausted or SHA-256 integrity fails', async () => {
  const goodBytes = textBytes('valid-data');
  const expectedSha = await sha256Hex(goodBytes);

  const manifest = {
    version: '1',
    bundles: {
      badHash: {
        files: [{ path: 'a.bin', size: goodBytes.byteLength, sha256: expectedSha }],
        deps: [],
      },
      alwaysFail: {
        files: [{ path: 'missing.bin', size: 10 }],
        deps: [],
      },
    },
  };

  const mockFetch = async (url) => {
    if (url.endsWith('a.bin')) {
      return { ok: true, status: 200, arrayBuffer: async () => textBytes('tampered-!').buffer };
    }
    return { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) };
  };

  const loader = createRemoteBundleLoader({
    manifestUrl: 'https://cdn.example.com/manifest.json',
    manifest,
    fetch: mockFetch,
    retries: 2,
    backoffMs: 2,
  });

  await assert.rejects(() => loader.loadBundle('badHash'), /Integrity mismatch/);
  await assert.rejects(() => loader.loadBundle('alwaysFail'), /HTTP 500/);
  assert.equal(loader.stats().cachedFiles, 0);
  assert.equal(loader.stats().failures, 2);
});

test('remote-bundle enforces topological dependency order, AbortSignal cancellation, and refcounted unload', async () => {
  const bBase = textBytes('base');
  const bUi = textBytes('ui');
  const bLevel = textBytes('level');
  const manifest = {
    version: '2',
    bundles: {
      base: { files: [{ path: 'base.bin', size: bBase.byteLength }], deps: [] },
      ui: { files: [{ path: 'ui.bin', size: bUi.byteLength }], deps: ['base'] },
      level1: { files: [{ path: 'level.bin', size: bLevel.byteLength }], deps: ['ui'] },
    },
  };

  const fetchOrder = [];
  const mockFetch = async (url, { signal } = {}) => {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
    fetchOrder.push(url.split('/').pop());
    await new Promise((r) => setTimeout(r, 15));
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
    const map = { 'base.bin': bBase, 'ui.bin': bUi, 'level.bin': bLevel };
    const name = url.split('/').pop();
    return { ok: true, status: 200, arrayBuffer: async () => map[name].buffer.slice(0) };
  };

  const loader = createRemoteBundleLoader({
    manifestUrl: 'https://cdn.example.com/manifest.json',
    manifest,
    fetch: mockFetch,
    retries: 1,
    backoffMs: 2,
    cache: 'memory',
  });

  // Cancel test
  const ac = new AbortController();
  const pCancel = loader.loadBundle('level1', { signal: ac.signal });
  setTimeout(() => ac.abort(), 5);
  await assert.rejects(() => pCancel, (err) => err.name === 'AbortError');

  // Full load test in topological order
  fetchOrder.length = 0;
  const bundleFiles = await loader.loadBundle('level1');
  assert.deepEqual(fetchOrder, ['base.bin', 'ui.bin', 'level.bin']);
  assert.equal(bundleFiles.size, 3);

  // Also load 'ui' separately so 'base' & 'ui' refcounts increase to 2
  await loader.loadBundle('ui');
  assert.equal(loader.unloadBundle('level1'), true);
  // 'base' and 'ui' remain resident because 'ui' still holds a ref
  assert.ok(loader.getFile('base.bin'));
  assert.ok(loader.getFile('ui.bin'));
  assert.equal(loader.getFile('level.bin'), null);

  assert.equal(loader.unloadBundle('ui'), true);
  assert.equal(loader.stats().cachedFiles, 0);
});

test('remote-bundle integrates with Cache Storage and createAssetCatalog via toCatalogLoader', async () => {
  const cfgBytes = textBytes(JSON.stringify({ gravity: 9.8 }));
  const manifest = {
    version: '3',
    bundles: {
      boot: { files: [{ path: 'config.json', size: cfgBytes.byteLength }], deps: [] },
    },
  };

  const cacheStore = new Map();
  const mockCaches = {
    async open() {
      return {
        async match(url) {
          return cacheStore.get(url) ?? null;
        },
        async put(url, resp) {
          const buf = await resp.arrayBuffer();
          cacheStore.set(url, { arrayBuffer: async () => buf.slice(0) });
        },
      };
    },
  };

  let fetchCount = 0;
  const loader = createRemoteBundleLoader({
    manifestUrl: 'https://cdn.example.com/assets/manifest.json',
    manifest,
    caches: mockCaches,
    cache: 'auto',
    fetch: async () => {
      fetchCount++;
      return { ok: true, status: 200, arrayBuffer: async () => cfgBytes.buffer.slice(0) };
    },
  });

  await loader.loadBundle('boot');
  assert.equal(fetchCount, 1);
  assert.equal(cacheStore.size, 1);

  const catalog = createAssetCatalog(
    { schemaVersion: 1, assets: { cfg: { kind: 'json', path: 'config.json' } } },
    { loader: toCatalogLoader(loader) }
  );
  const scope = catalog.openScope();
  const loadedCfg = await scope.load('cfg');
  assert.equal(loadedCfg.gravity, 9.8);
  assert.equal(fetchCount, 1); // Served straight from bundle loader cache
  scope.dispose();
  catalog.dispose();
});
