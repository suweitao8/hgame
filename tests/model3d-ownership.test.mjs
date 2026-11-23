import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import { WorkerPool } from '../assets/optional/three/jsm/utils/WorkerPool.js';
import { createGameApplication, Entity, Scene } from '../assets/runtime/index.js';
import { createModel3DProvider, createLodAnimationScheduler, DEFAULT_LOD_ANIMATION_RATES } from '../assets/runtime/integrations/model3d.js';
import { createAssetCatalog } from '../assets/runtime/platform/asset-catalog.js';
import { createAssetLoader } from '../assets/runtime/platform/assets.js';
import { PrefabRegistry } from '../assets/runtime/core/prefab.js';
import { createLevelFlow } from '../assets/runtime/world/level-flow.js';
import { createProceduralModelSlots } from '../assets/runtime/integrations/procedural-models.js';
import { createStarterModelLoader } from '../assets/profiles/3d/model-loader.js';

function monitor(resource) {
  let calls = 0;
  resource.addEventListener('dispose', () => { calls++; });
  return () => calls;
}

test('scoped model acquisition shares a decode and aborts transport only after the last pending owner leaves', async () => {
  const jobs = [];
  const loader = { loadWithSignal(url, signal) {
    const pending = Promise.withResolvers();
    jobs.push({ url, signal, pending });
    return pending.promise;
  } };
  const provider = createModel3DProvider({ THREE, loader });
  const a = new AbortController();
  const b = new AbortController();
  const first = provider.acquire('shared.glb', { signal: a.signal });
  const second = provider.acquire('shared.glb', { signal: b.signal });
  const cancelled = [first, second].map(pending => assert.rejects(pending, { name: 'AbortError' }));
  await Promise.resolve();
  assert.equal(jobs.length, 1);
  a.abort();
  await cancelled[0];
  assert.equal(jobs[0].signal.aborted, false);
  b.abort();
  await cancelled[1];
  assert.equal(jobs[0].signal.aborted, true);
  const fresh = provider.acquire('shared.glb');
  await Promise.resolve();
  assert.equal(jobs.length, 2);
  const staleGeometry = new THREE.BoxGeometry();
  const freshGeometry = new THREE.BoxGeometry();
  const staleDisposals = monitor(staleGeometry);
  const freshDisposals = monitor(freshGeometry);
  const material = new THREE.MeshBasicMaterial();
  const materialDisposals = monitor(material);
  jobs[1].pending.resolve({ scene: new THREE.Mesh(freshGeometry, material) });
  const lease = await fresh;
  jobs[0].pending.resolve({ scene: new THREE.Mesh(staleGeometry, material) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(staleDisposals(), 1);
  assert.equal(freshDisposals(), 0);
  assert.equal(materialDisposals(), 0);
  assert.equal(lease.asset.scene.geometry, freshGeometry);
  lease.release();
  await provider.dispose();
  assert.equal(freshDisposals(), 1);
  assert.equal(materialDisposals(), 1);
});

test('catalog model scopes retain shared live GPU resources while an LRU budget reclaims idle models', async () => {
  const texture = new THREE.DataTexture(new Uint8Array(64), 4, 4, THREE.RGBAFormat);
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const textureDisposals = monitor(texture);
  const loaded = [];
  const provider = createModel3DProvider({ THREE, maxResidentBytes: 100_000, loader: { loadAsync(url) {
    const geometry = new THREE.BoxGeometry();
    loaded.push({ url, geometry, count: monitor(geometry) });
    return { scene: new THREE.Mesh(geometry, material) };
  } } });
  const catalog = createAssetCatalog({ schemaVersion: 1, assets: {
    hero: { kind: 'model', path: 'hero.glb' }, heroAlias: { kind: 'model', path: 'hero.glb' },
    robot: { kind: 'model', path: 'robot.glb' },
  } }, { loader: createAssetLoader(), modelProvider: provider });
  const first = catalog.openScope();
  const second = catalog.openScope();
  const robotScope = catalog.openScope();
  const [hero, alias, robot] = await Promise.all([first.load('hero'), second.load('heroAlias'), robotScope.load('robot')]);
  assert.equal(loaded.length, 2);
  assert.equal(hero, alias);
  assert.notEqual(hero, robot);
  const resident = provider.residency.readBytes();
  assert.ok(resident > texture.image.data.byteLength);
  first.dispose();
  provider.residency.trimIdle(resident);
  assert.deepEqual(loaded.map(model => model.count()), [0, 0]);
  second.dispose();
  assert.equal(provider.residency.readBytes(), resident, 'released models may remain as idle cache');
  provider.residency.trimIdle(1);
  assert.deepEqual(loaded.map(model => model.count()), [1, 0]);
  assert.equal(textureDisposals(), 0);
  assert.ok(provider.residency.readBytes() < resident);
  robotScope.dispose();
  provider.residency.trimIdle(resident);
  assert.deepEqual(loaded.map(model => model.count()), [1, 1]);
  assert.equal(textureDisposals(), 1);
  assert.equal(provider.residency.readBytes(), 0);
  catalog.dispose();
  await provider.dispose();
});

test('level flow transfers a shared decoded model between prepared scenes and reclaims it after the last unload', async () => {
  const app = createGameApplication({
    project: { profile: '3d', physics: 'none', features: ['scene'] },
    renderer: { render() {} },
  });
  const geometry = new THREE.BoxGeometry();
  const disposals = monitor(geometry);
  let loads = 0;
  const provider = createModel3DProvider({ THREE, maxResidentBytes: 0, loader: { loadAsync() {
    loads++;
    return { scene: new THREE.Mesh(geometry) };
  } } });
  const catalog = createAssetCatalog({
    schemaVersion: 1,
    assets: { hero: { kind: 'model', path: 'hero.glb' } },
    groups: { character: ['hero'] },
  }, { loader: app.platform.assets, modelProvider: provider });
  const withHero = id => ({ level: { schemaVersion: 1, id, dimensions: 3 }, assetGroups: ['character'] });
  const flow = createLevelFlow({ scenes: app.scenes, prefabs: new PrefabRegistry(), catalog, routes: {
    first: withHero('first'), second: withHero('second'),
    empty: { level: { schemaVersion: 1, id: 'empty', dimensions: 3 } },
  } });
  const first = (await flow.go('first')).session;
  await flow.prefetch('second');
  const second = await flow.go('second');
  assert.deepEqual(second.cleanupErrors, []);
  assert.equal(first.assets.hero, second.session.assets.hero);
  assert.equal(second.session.assets.hero.scene.geometry, geometry);
  assert.equal(loads, 1);
  assert.equal(disposals(), 0);
  await flow.go('empty');
  assert.equal(disposals(), 1);
  assert.equal(provider.residency.readBytes(), 0);
  await flow.dispose();
  catalog.dispose();
  await provider.dispose();
  app.dispose();
});

test('a reused GPU resource can be released again after a model fetch restores its residency', async () => {
  const geometry = new THREE.BoxGeometry();
  const disposals = monitor(geometry);
  const provider = createModel3DProvider({ THREE, maxResidentBytes: 0, loader: {
    loadAsync: () => ({ scene: new THREE.Mesh(geometry) }),
  } });
  const first = await provider.acquire('reused.glb');
  first.release();
  const second = await provider.acquire('reused.glb');
  second.release();
  assert.equal(disposals(), 2);
  await provider.dispose();
});

test('catalog resolution and residency cover custom asset roots and secondary glTF scenes', async () => {
  const primary = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  const data = new Float32Array(9);
  geometry.setAttribute('position', new THREE.BufferAttribute(data, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data, 3));
  const secondary = new THREE.Mesh(geometry);
  const disposals = monitor(geometry);
  const urls = [];
  const provider = createModel3DProvider({ THREE, projectBaseUrl: 'https://game.example/level/index.html',
    maxResidentBytes: 0, loader: { loadAsync(url) {
      urls.push(url);
      return { scene: primary, scenes: [primary, secondary] };
    } },
  });
  const catalog = createAssetCatalog({ schemaVersion: 1, assets: { hero: { kind: 'model', path: 'hero.gltf' } } }, {
    loader: createAssetLoader({ baseURI: 'https://game.example/level/index.html', baseUrl: './media/' }),
    modelProvider: provider,
  });
  const scope = catalog.openScope();
  await scope.load('hero');
  assert.deepEqual(urls, ['https://game.example/level/media/hero.gltf']);
  assert.equal(provider.residency.readBytes(), data.byteLength * 2);
  scope.dispose();
  assert.equal(disposals(), 1);
  await provider.dispose();
  catalog.dispose();
});

test('managed procedural model slots share their source with a scene scope and cancel replacements on disposal', async () => {
  const started = Promise.withResolvers();
  const geometry = new THREE.BoxGeometry();
  const disposals = monitor(geometry);
  const provider = createModel3DProvider({ THREE, maxResidentBytes: 0, loader: {
    loadWithSignal(url, signal) {
      if (url.endsWith('hero.glb')) return { scene: new THREE.Mesh(geometry) };
      started.resolve(signal);
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
  } });
  const otherScene = await provider.acquire('assets/hero.glb');
  const catalog = createAssetCatalog({ schemaVersion: 1, assets: {
    hero: { kind: 'model', path: 'hero.glb' },
  } }, { loader: createAssetLoader() });
  const slots = createProceduralModelSlots({
    THREE, assetCatalog: catalog, materialPalette: { get() { return new THREE.MeshBasicMaterial(); } },
    slots: {
      'model.hero': { shape: 'box', material: 'default', size: [1, 1, 1], replacementAsset: 'hero' },
      'model.pending': { shape: 'box', material: 'default', size: [1, 1, 1], replacement: 'assets/models/pending.glb' },
    },
    acquireGLTF: provider.acquire,
  });
  const hero = await slots.instantiate('model.hero');
  assert.equal(hero.geometry, otherScene.asset.scene.geometry);
  const pending = assert.rejects(slots.instantiate('model.pending'), { name: 'AbortError' });
  const signal = await started.promise;
  await slots.dispose();
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(disposals(), 0);
  otherScene.release();
  assert.equal(disposals(), 1);
  await provider.dispose();
  catalog.dispose();
});

test('Basis worker errors settle active and queued decode jobs and allow a retry', { timeout: 1500 }, async () => {
  const workers = [];
  class FakeWorker extends EventTarget {
    postMessage() {}
    terminate() { this.terminated = true; }
  }
  const pool = new WorkerPool(1);
  pool.setWorkerCreator(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  const active = pool.postMessage({ type: 'transcode' });
  const queued = pool.postMessage({ type: 'transcode' });
  const rejected = Promise.all([assert.rejects(active, /codec init failed/), assert.rejects(queued, /codec init failed/)]);
  const error = new Event('error');
  error.message = 'codec init failed';
  workers[0].dispatchEvent(error);
  await rejected;
  assert.equal(workers[0].terminated, true);
  const retry = pool.postMessage({ type: 'transcode' });
  workers[1].dispatchEvent(new MessageEvent('message', { data: 'decoded' }));
  assert.equal((await retry).data, 'decoded');
  pool.dispose();
});

test('Model3D keeps replaced assets usable and disposes shared owned resources once', async () => {
  const provider = createModel3DProvider({ THREE });
  const texture = new THREE.Texture();
  const material = new THREE.MeshBasicMaterial({ map: texture, alphaMap: texture });
  const first = new THREE.BoxGeometry();
  const second = new THREE.BoxGeometry();
  const borrowed = new THREE.BoxGeometry();
  const promoted = new THREE.BoxGeometry();
  const counts = [first, second, material, texture, borrowed, promoted].map(monitor);
  const oldModel = new THREE.Group();
  oldModel.add(new THREE.Mesh(first, material), new THREE.Mesh(first, material));
  provider.registerAsset('hero', { scene: oldModel, owned: true });
  const instance = await provider.instantiate('hero');
  provider.registerAsset('hero', { scene: new THREE.Mesh(second, material), owned: true });
  provider.registerAsset('borrowed', { scene: new THREE.Mesh(borrowed) });
  const promotedRoot = new THREE.Mesh(promoted);
  provider.registerAsset('promoted', { scene: promotedRoot });
  provider.registerAsset('promoted', { scene: promotedRoot, owned: true });
  assert.equal(instance.root.children[0].geometry, first);
  assert.equal((await provider.instantiate('hero')).root.geometry, second);
  assert.deepEqual(counts.map(count => count()), [0, 0, 0, 0, 0, 0]);
  assert.equal(await provider.dispose(), true);
  assert.deepEqual(counts.map(count => count()), [1, 1, 1, 1, 0, 1]);
  assert.equal(await provider.dispose(), false);
  borrowed.dispose();
});

test('Model3D disposal drains a superseded load and does not return a disposed asset', async () => {
  const loaderStarted = Promise.withResolvers();
  const loaded = Promise.withResolvers();
  const slowGeometry = new THREE.BoxGeometry();
  const replacementGeometry = new THREE.BoxGeometry();
  const sharedMaterial = new THREE.MeshBasicMaterial();
  const slowCount = monitor(slowGeometry);
  const replacementCount = monitor(replacementGeometry);
  const materialCount = monitor(sharedMaterial);
  const provider = createModel3DProvider({ THREE, loader: { loadAsync: () => {
    loaderStarted.resolve();
    return loaded.promise;
  } } });
  const pending = provider.load('hero.glb');
  await loaderStarted.promise;
  provider.registerAsset('hero.glb', { scene: new THREE.Mesh(replacementGeometry, sharedMaterial), owned: true });
  const rejected = assert.rejects(pending, /disposed/i);
  const teardown = provider.dispose();
  const replacementBeforeLoadFinishes = replacementCount();
  loaded.resolve({ scene: new THREE.Mesh(slowGeometry, sharedMaterial) });
  await rejected;
  assert.equal(await teardown, true);
  assert.equal(slowCount(), 1);
  assert.equal(replacementCount(), 1);
  assert.equal(replacementBeforeLoadFinishes, 1, 'ready models should release before waiting for a loader');
  assert.equal(materialCount(), 1, 'late and ready models share one material disposal');
});

test('Model3D cannot return a cached asset or produce a clone after disposal begins', async () => {
  const provider = createModel3DProvider({ THREE });
  provider.registerAsset('hero', { scene: new THREE.Group(), owned: true });
  const asset = provider.load('hero');
  const instance = provider.instantiate('hero');
  const rejected = [asset, instance].map(request => assert.rejects(request, /disposed/i));
  assert.equal(await provider.dispose(), true);
  await Promise.all(rejected);
});

test('Model3D continues releasing owned resources when one dispose listener throws', async () => {
  const provider = createModel3DProvider({ THREE });
  const failed = new THREE.BoxGeometry();
  const healthy = new THREE.BoxGeometry();
  const count = monitor(healthy);
  const error = new Error('geometry dispose listener');
  failed.addEventListener('dispose', () => { throw error; });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(failed), new THREE.Mesh(healthy));
  provider.registerAsset('owned', { scene: root, owned: true });
  await assert.rejects(provider.dispose(), failure => failure === error || failure.errors?.includes(error));
  assert.equal(count(), 1);
  assert.equal(await provider.dispose(), false);
});

test('an application reports an asynchronous Model3D disposal failure through diagnostics', async () => {
  const provider = createModel3DProvider({ THREE });
  const failed = new THREE.BoxGeometry();
  failed.addEventListener('dispose', () => { throw new Error('broken model teardown'); });
  provider.registerAsset('mesh', { scene: new THREE.Mesh(failed), owned: true });
  let releasedRenderer = false;
  const app = createGameApplication({ project: { profile: '3d', physics: 'none', features: ['scene', 'model3d'] },
    renderer: { render() {}, dispose() { releasedRenderer = true; } } });
  await app.installFeatures({ model3d: provider });
  assert.equal(app.dispose(), true);
  assert.equal(releasedRenderer, true);
  await new Promise(resolve => setImmediate(resolve));
  const diagnostics = app.platform.diagnostics.snapshot();
  assert.equal(diagnostics.errorCount, 1);
  assert.equal(diagnostics.lastError.context.service, 'model3d');
});

test('destroying an inactive Model3D component before awake is safe', async () => {
  const provider = createModel3DProvider({ THREE });
  const entity = new Entity({ active: false });
  const component = entity.addComponent(provider.createComponent({ root: new THREE.Group() }));
  assert.equal(component.modelRoot, undefined);
  assert.equal(entity.destroy(), true);
  assert.equal(await provider.dispose(), true);
});

function skinnedMesh() {
  const geometry = new THREE.BoxGeometry();
  const vertices = geometry.getAttribute('position').count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(vertices * 4), 4));
  const weights = new Float32Array(vertices * 4);
  for (let i = 0; i < vertices; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  const bone = new THREE.Bone();
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  mesh.skeleton.computeBoneTexture();
  return mesh;
}

test('destroying a cloned Model3D component releases its private bone texture only', async () => {
  const mesh = skinnedMesh();
  const sourceTexture = monitor(mesh.skeleton.boneTexture);
  const sourceGeometry = monitor(mesh.geometry);
  const provider = createModel3DProvider({ THREE });
  const asset = provider.registerAsset('rig', { scene: mesh, owned: true });
  const scene = new Scene('playing');
  const entity = scene.add(new Entity());
  const cloned = entity.addComponent(provider.createComponent({ asset }));
  const borrowed = scene.add(new Entity());
  borrowed.addComponent(provider.createComponent({ root: mesh }));
  scene._setActive(true);
  const clonedSkeleton = cloned.modelRoot.skeleton;
  assert.notEqual(clonedSkeleton, mesh.skeleton);
  clonedSkeleton.computeBoneTexture();
  const cloneTexture = monitor(clonedSkeleton.boneTexture);
  entity.destroy();
  borrowed.destroy();
  assert.deepEqual([cloneTexture(), sourceTexture(), sourceGeometry()], [1, 0, 0]);
  await provider.dispose();
  assert.deepEqual([cloneTexture(), sourceTexture(), sourceGeometry()], [1, 1, 1]);
});

test('custom model cloners retain ownership of their skeleton and borrowed bone texture', async () => {
  const mesh = skinnedMesh();
  const sourceTexture = monitor(mesh.skeleton.boneTexture);
  const provider = createModel3DProvider({ THREE, cloneSkeleton(source) {
    const clone = source.clone();
    clone.skeleton = source.skeleton.clone();
    clone.skeleton.boneTexture = source.skeleton.boneTexture;
    return clone;
  } });
  const asset = provider.registerAsset('external', { scene: mesh });
  const scene = new Scene('playing');
  const entity = scene.add(new Entity());
  const component = entity.addComponent(provider.createComponent({ asset }));
  scene._setActive(true);
  const clonedSkeleton = component.modelRoot.skeleton;
  assert.notEqual(clonedSkeleton, mesh.skeleton);
  entity.destroy();
  await provider.dispose();
  assert.equal(clonedSkeleton.boneTexture, mesh.skeleton.boneTexture);
  assert.equal(sourceTexture(), 0);
  mesh.skeleton.dispose();
});

test('a bone texture shared across owned skeletons and a material is disposed once', async () => {
  const provider = createModel3DProvider({ THREE });
  const texture = new THREE.DataTexture(new Float32Array(16), 2, 2, THREE.RGBAFormat, THREE.FloatType);
  const count = monitor(texture);
  const root = new THREE.Group();
  const skeletons = [new THREE.Skeleton(), new THREE.Skeleton()];
  for (const skeleton of skeletons) {
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map: texture }));
    skeleton.boneTexture = texture;
    mesh.skeleton = skeleton;
    root.add(mesh);
  }
  provider.registerAsset('shared', { scene: root, owned: true });
  await provider.dispose();
  assert.equal(count(), 1);
  assert.deepEqual(skeletons.map(skeleton => skeleton.boneTexture), [null, null]);
});

test('glTF dependency cancellation aborts external fetches, disposes late resources, and unifies catalog residency stats', async () => {
  const fetchCalls = [];
  let depDeferred;
  const lateGeometry = new THREE.BoxGeometry();
  const lateTexture = new THREE.DataTexture(new Uint8Array(64), 4, 4, THREE.RGBAFormat);
  const lateMaterial = new THREE.MeshBasicMaterial({ map: lateTexture });
  const lateGeoDisposals = monitor(lateGeometry);
  const lateTexDisposals = monitor(lateTexture);
  const lateMatDisposals = monitor(lateMaterial);

  class FakeGLTFLoader {
    setMeshoptDecoder() { return this; }
    setKTX2Loader() { return this; }
    async parseAsync(_data, baseUrl) {
      // Simulate glTF fetching an external .bin dependency via globalThis.fetch
      await globalThis.fetch(baseUrl + 'scene.bin');
      return { scene: new THREE.Mesh(lateGeometry, lateMaterial) };
    }
  }

  const starterLoader = createStarterModelLoader(null, {
    GLTFLoaderCtor: FakeGLTFLoader,
    fetchImpl(url, init) {
      fetchCalls.push({ url, signal: init?.signal });
      if (String(url).endsWith('hero.gltf')) {
        return Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) });
      }
      depDeferred = Promise.withResolvers();
      return depDeferred.promise;
    },
  });

  const provider = createModel3DProvider({ THREE, loader: starterLoader });
  const abortController = new AbortController();
  const pending = provider.acquire('hero.gltf', { signal: abortController.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });

  // Wait until external dependency fetch starts
  for (let i = 0; i < 20 && fetchCalls.length < 2; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[1].signal.aborted, false);

  abortController.abort(new DOMException('Scene left', 'AbortError'));
  await rejected;
  assert.equal(fetchCalls[1].signal.aborted, true, 'external dependency fetch receives abort signal');

  // Even if the dependency promise resolves late instead of rejecting, late GPU resources are disposed
  depDeferred.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lateGeoDisposals(), 1);
  assert.equal(lateTexDisposals(), 1);
  assert.equal(lateMatDisposals(), 1);

  const modelStats = provider.residency.getStats();
  assert.ok(modelStats.abortedRequests >= 1);
  assert.ok(modelStats.abortedDependencies >= 1);
  assert.ok(modelStats.disposedLateResources >= 3);

  // Unified catalog residency stats across models, images, and audio
  const loader = {
    resolve: p => 'http://127.0.0.1/assets/' + p,
    image: async () => ({ width: 8, height: 8, close() {} }),
    arrayBuffer: async () => new ArrayBuffer(128),
  };
  const catalog = createAssetCatalog({
    schemaVersion: 1,
    assets: {
      sprite: { kind: 'image', path: 'hero.png' },
      sfx: { kind: 'audio', path: 'hit.ogg' },
    },
  }, { loader, modelProvider: provider });
  const scope = catalog.openScope();
  await Promise.all([scope.load('sprite'), scope.load('sfx')]);
  const unified = catalog.getResidencyStats();
  assert.equal(unified.imageBytes, 8 * 8 * 4);
  assert.equal(unified.audioBytes, 128);
  assert.equal(unified.totalBytes, unified.modelBytes + 256 + 128);
  assert.ok(unified.abortedDependencies >= 1);
  assert.ok(unified.disposedLateResources >= 3);
  scope.dispose();
  catalog.dispose();
  await starterLoader.dispose();
  await provider.dispose();
});

test('createLodAnimationScheduler steps LOD 0/1/2 at 24/12/6 Hz, staggers across frames, and preserves total dt', () => {
  assert.deepEqual(DEFAULT_LOD_ANIMATION_RATES, { 0: 24, 1: 12, 2: 6, 3: 6 });

  const scheduler = createLodAnimationScheduler();
  const makeTarget = () => {
    let calls = 0;
    let sumDt = 0;
    return {
      update(dt) { calls++; sumDt += dt; },
      stats: () => ({ calls, sumDt }),
    };
  };

  const t0 = makeTarget();
  const t1 = makeTarget();
  const t2 = makeTarget();
  scheduler.register(t0, { lod: 0 });
  scheduler.register(t1, { lod: 1 });
  scheduler.register(t2, { lod: 2 });

  for (let i = 0; i < 60; i++) {
    scheduler.update(1 / 60);
  }
  scheduler.flush();

  assert.ok(t0.stats().calls >= 23 && t0.stats().calls <= 26, `LOD0 calls=${t0.stats().calls}`);
  assert.ok(t1.stats().calls >= 11 && t1.stats().calls <= 14, `LOD1 calls=${t1.stats().calls}`);
  assert.ok(t2.stats().calls >= 5 && t2.stats().calls <= 8, `LOD2 calls=${t2.stats().calls}`);
  assert.ok(Math.abs(t0.stats().sumDt - 1.0) < 1e-6);
  assert.ok(Math.abs(t1.stats().sumDt - 1.0) < 1e-6);
  assert.ok(Math.abs(t2.stats().sumDt - 1.0) < 1e-6);

  // Stagger check: 20 characters at LOD2 (6Hz) should average ~2 updates/frame, never 20 all at once
  scheduler.clear();
  const crowd = Array.from({ length: 20 }, () => makeTarget());
  for (const m of crowd) scheduler.register(m, { lod: 2 });
  let maxPerFrame = 0;
  for (let i = 0; i < 60; i++) {
    const res = scheduler.update(1 / 60);
    if (res.updated > maxPerFrame) maxPerFrame = res.updated;
  }
  assert.ok(maxPerFrame <= 5, `Expected staggered updates <= 5/frame, got ${maxPerFrame}`);

  // Dynamic getLod / setLod transition check
  scheduler.clear();
  let curLod = 2;
  const dyn = makeTarget();
  scheduler.register(dyn, { getLod: () => curLod });
  for (let i = 0; i < 60; i++) scheduler.update(1 / 60);
  const callsAtLod2 = dyn.stats().calls;
  curLod = 0;
  for (let i = 0; i < 60; i++) scheduler.update(1 / 60);
  const callsAtLod0 = dyn.stats().calls - callsAtLod2;
  assert.ok(callsAtLod0 >= 22 && callsAtLod2 <= 7, `Dynamic LOD rate switch: L2=${callsAtLod2}, L0=${callsAtLod0}`);
});
