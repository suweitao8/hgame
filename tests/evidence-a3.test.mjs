// Scorecard A3 evidence: KTX2 header/variant selection, mip streaming residency, VRAM guard, progressive boot,
// remote bundle dependency/retry/refcount logic. Headless note: real GPU texture upload/VRAM is browser-only;
// all byte accounting here is the policy's own deterministic bookkeeping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { KTX2_MAGIC, parseKtx2Header, selectOptimalTextureVariant, detectCompressedTextureSupport }
  from '../assets/runtime/integrations/ktx2.js';
import { createStreamingResidencyPolicy, createVramMipGuard, createProgressiveBootLoader,
  bindTextureMipStreaming } from '../assets/runtime/platform/asset-catalog.js';
import { createRemoteBundleLoader } from '../assets/runtime/platform/remote-bundle.js';

const MB = 1024 * 1024;

test('KTX2 header parse reads fields little-endian and rejects bad/truncated input', () => {
  const buf = new ArrayBuffer(80);
  new Uint8Array(buf).set(KTX2_MAGIC, 0);
  const dv = new DataView(buf);
  dv.setUint32(12, 158, true); dv.setUint32(20, 1024, true); dv.setUint32(24, 512, true);
  dv.setUint32(40, 11, true); dv.setUint32(44, 2, true);
  const h = parseKtx2Header(buf);
  assert.equal(h.pixelWidth, 1024);
  assert.equal(h.pixelHeight, 512);
  assert.equal(h.levelCount, 11);
  assert.equal(h.supercompressionScheme, 2);
  assert.throws(() => parseKtx2Header(new ArrayBuffer(10)), RangeError);
  assert.throws(() => parseKtx2Header(new ArrayBuffer(80)), /magic/);
  assert.equal(parseKtx2Header(new Uint8Array(buf)).pixelWidth, 1024);
});

test('compressed texture variant selection honours device support priority', () => {
  const v = { astc: 'a.ktx2', etc2: 'e.ktx2', dxt: 'd.ktx2', webp: 'f.webp' };
  assert.equal(selectOptimalTextureVariant(v, { astc: true, etc2: true }).format, 'astc');
  assert.equal(selectOptimalTextureVariant(v, { etc2: true, dxt: true }).format, 'etc2');
  const fb = selectOptimalTextureVariant(v, {});
  assert.equal(fb.compressed, false);
  assert.equal(fb.url, 'f.webp');
  const exts = new Set(['WEBGL_compressed_texture_etc']);
  const s = detectCompressedTextureSupport({ getExtension: n => (exts.has(n) ? {} : null) });
  assert.equal(s.preferred, 'etc2');
  assert.equal(s.vramSavingsRatio, 4);
  assert.equal(detectCompressedTextureSupport(null).preferred, 'rgba8');
});

test('distance-driven mip streaming: near=mip0, far=mip3, bytes shrink 4x per mip, textures swap sources', () => {
  const policy = createStreamingResidencyPolicy({ maxBytes: 1024 * MB, nearDistance: 10, midDistance: 30, farDistance: 60 });
  const tex = { image: 'init', anisotropy: 1, needsUpdate: false, userData: {} };
  const bound = bindTextureMipStreaming(policy, 'rock', tex, {
    position: { x: 0, y: 0, z: 100 }, baseBytes: 16 * MB, mipSources: ['m0', 'm1', 'm2', 'm3'],
  });
  let r = policy.update({ x: 0, y: 0, z: 0 }); // dist 100 -> mip 3
  assert.equal(policy.getEntry('rock').mipBias, 3);
  assert.equal(r.residentBytes, 16 * MB / 64);
  r = policy.update({ x: 0, y: 0, z: 95 }); // dist 5 -> mip 0
  assert.equal(policy.getEntry('rock').mipBias, 0);
  assert.equal(r.residentBytes, 16 * MB);
  assert.equal(tex.image, 'm0');
  assert.equal(tex.userData.streamingMipBias, 0);
  assert.equal(tex.needsUpdate, true);
  assert.equal(tex.anisotropy, 16);
  assert.ok(bound.swaps >= 1);
  policy.update({ x: 0, y: 0, z: 60 }); // dist 40 -> mip 2
  assert.equal(tex.image, 'm2');
});

test('residency budget is a hard cap: far/low-priority assets are downgraded/evicted before near hero assets', () => {
  const policy = createStreamingResidencyPolicy({ maxBytes: 20 * MB, nearDistance: 10, midDistance: 30, farDistance: 60 });
  const evicted = [];
  policy.register('hero', { position: { x: 1, y: 0, z: 0 }, baseBytes: 16 * MB, priority: 5 });
  for (let i = 0; i < 6; i++) {
    policy.register('bg' + i, { position: { x: 5, y: 0, z: 0 }, baseBytes: 16 * MB, priority: 0,
      onEvict: e => evicted.push(e.id) });
  }
  const r = policy.update({ x: 0, y: 0, z: 0 });
  assert.equal(r.withinBudget, true);
  assert.ok(r.residentBytes <= 20 * MB, `resident ${r.residentBytes}`);
  assert.equal(policy.getEntry('hero').mipBias, 0, 'hero kept at full res');
  assert.equal(policy.getEntry('hero').evicted, false);
  assert.ok(['bg0','bg1','bg2','bg3','bg4','bg5'].every(id => policy.getEntry(id).mipBias === 3 || policy.getEntry(id).evicted), 'background assets squeezed');
  assert.equal(policy.getStats().evictedCount, evicted.length);
  // conservation: stats equal sum of per-entry bytes
  let sum = 0;
  for (const id of ['hero', 'bg0', 'bg1', 'bg2', 'bg3', 'bg4', 'bg5']) sum += policy.getEntry(id).residentBytes;
  assert.equal(sum, r.residentBytes);
});

test('VRAM mip guard escalates with pressure, applies global bias to policy, and recovers with hysteresis', () => {
  const policy = createStreamingResidencyPolicy({ maxBytes: 1024 * MB, nearDistance: 10 });
  policy.register('t', { position: { x: 0, y: 0, z: 0 }, baseBytes: 64 * MB });
  const guard = createVramMipGuard({ streamingPolicy: policy, budgetBytes: 100 * MB });
  policy.update({ x: 0, y: 0, z: 0 });
  assert.equal(policy.getEntry('t').mipBias, 0);
  assert.equal(guard.step(50 * MB).state, 'healthy');
  assert.equal(guard.step(85 * MB).state, 'soft-degrade');
  policy.update({ x: 0, y: 0, z: 0 });
  assert.equal(policy.getEntry('t').mipBias, 1);
  const hard = guard.step(95 * MB);
  assert.equal(hard.state, 'hard-degrade');
  assert.equal(hard.mipBiasOffset, 2);
  assert.equal(policy.update({ x: 0, y: 0, z: 0 }).residentBytes, 64 * MB / 16);
  const mid = guard.step(90 * MB); // hysteresis: stays at offset 2 while still near the soft threshold
  assert.equal(mid.state, 'soft-degrade'); assert.equal(mid.mipBiasOffset, 2);
  const rec = guard.step(40 * MB);
  assert.equal(rec.state, 'healthy');
  assert.equal(rec.mipBiasOffset, 0);
  assert.equal(policy.update({ x: 0, y: 0, z: 0 }).residentBytes, 64 * MB);
});

test('progressive boot loads P0 first (interactive-ready), then P1, P2 in order; abort stops further stages', async () => {
  const log = [];
  const stages = [];
  const loader = createProgressiveBootLoader({
    p0: ['a', 'b'], p1: ['c'], p2: ['d'],
    loadAsset: async id => { log.push(id); await new Promise(r => setImmediate(r)); },
    onStageComplete: s => stages.push(s),
  });
  const ready = await loader.start();
  assert.equal(ready.interactiveReady, true);
  assert.equal(ready.p0Count, 2);
  assert.ok(log.includes('a') && log.includes('b'));
  assert.ok(!log.includes('d'), 'P2 not loaded at interactive time');
  const done = await loader.whenAllReady();
  assert.deepEqual(log, ['a', 'b', 'c', 'd']);
  assert.deepEqual(stages, ['p0', 'p1', 'p2']);
  assert.deepEqual(done.completedStages, ['p0', 'p1', 'p2']);

  const log2 = [];
  const l2 = createProgressiveBootLoader({ p0: ['x'], p1: ['y'], p2: ['z'],
    loadAsset: async id => { log2.push(id); await new Promise(r => setImmediate(r)); } });
  await l2.start(); l2.abort();
  const d2 = await l2.whenAllReady();
  assert.equal(d2.aborted, true);
  assert.ok(!log2.includes('z'));
});

// ---- remote bundles ----
const sha = b => createHash('sha256').update(Buffer.from(b)).digest('hex');
function fakeFetch(files, { failFirst = {} } = {}) {
  const calls = {};
  const f = async (url) => {
    calls[url] = (calls[url] || 0) + 1;
    if ((failFirst[url] || 0) >= calls[url]) throw new TypeError('network offline');
    if (!(url in files)) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    const u8 = Buffer.from(files[url]);
    return { ok: true, status: 200, arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) };
  };
  f.calls = calls;
  return f;
}
const manifest = {
  version: 'v1',
  bundles: {
    core: { files: [{ path: 'core.bin', sha256: sha('CORE') }] },
    level1: { deps: ['core'], files: [{ path: 'l1.bin', sha256: sha('L1') }] },
    level2: { deps: ['core'], files: [{ path: 'l2.bin' }] },
    loopA: { deps: ['loopB'], files: [] }, loopB: { deps: ['loopA'], files: [] },
  },
};
const files = { 'https://cdn/core.bin': 'CORE', 'https://cdn/l1.bin': 'L1', 'https://cdn/l2.bin': 'L2' };
const mk = (fetch, extra = {}) => createRemoteBundleLoader({ manifestUrl: 'https://cdn/manifest.json', manifest,
  fetch, cache: 'memory', caches: null, backoffMs: 1, ...extra });

test('remote bundle: dependency-ordered load, shared dep fetched once, refcounted unload', async () => {
  const fetch = fakeFetch(files);
  const loader = mk(fetch);
  const progress = [];
  const out = await loader.loadBundle('level1', { onProgress: p => progress.push(p.bundleId) });
  assert.deepEqual([...out.keys()], ['core.bin', 'l1.bin']);
  assert.deepEqual(progress, ['core', 'level1']);
  await loader.loadBundle('level2');
  assert.equal(fetch.calls['https://cdn/core.bin'], 1, 'shared dependency cached');
  assert.deepEqual(new Set(loader.stats().loadedBundles), new Set(['core', 'level1', 'level2']));

  loader.unloadBundle('level1');
  assert.equal(loader.getFile('l1.bin'), null, 'level1 payload evicted');
  assert.ok(loader.getFile('core.bin'), 'core still held by level2');
  loader.unloadBundle('level2');
  assert.equal(loader.getFile('core.bin'), null);
  assert.equal(loader.stats().residentBytes, 0);
  await assert.rejects(loader.loadBundle('loopA'), /Circular/);
  await assert.rejects(loader.loadBundle('nope'), /Unknown bundle/);
});

test('remote bundle: offline failures are retried with backoff then succeed; exhausted retries reject', async () => {
  const fetch = fakeFetch(files, { failFirst: { 'https://cdn/core.bin': 2 } });
  const loader = mk(fetch, { retries: 3 });
  await loader.loadBundle('core');
  assert.equal(fetch.calls['https://cdn/core.bin'], 3);
  assert.equal(loader.stats().retries, 2);

  const dead = fakeFetch(files, { failFirst: { 'https://cdn/core.bin': 99 } });
  const l2 = mk(dead, { retries: 1 });
  await assert.rejects(l2.loadBundle('core'), /offline/);
  assert.equal(dead.calls['https://cdn/core.bin'], 2);
  assert.equal(l2.stats().failures, 1);
});

test('remote bundle: SHA-256 integrity mismatch is rejected without retry, abort signal cancels', async () => {
  const bad = fakeFetch({ ...files, 'https://cdn/core.bin': 'TAMPERED' });
  const loader = mk(bad, { retries: 3 });
  await assert.rejects(loader.loadBundle('core'), /Integrity mismatch/);
  assert.equal(bad.calls['https://cdn/core.bin'], 1);
  assert.equal(loader.getFile('core.bin'), null);

  const ac = new AbortController(); ac.abort();
  await assert.rejects(mk(fakeFetch(files)).loadBundle('core', { signal: ac.signal }), { name: 'AbortError' });
});
