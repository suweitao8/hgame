const meshopt = {
  supported: typeof WebAssembly !== 'undefined',
  async decodeGltfBufferAsync(count, stride, source, mode, filter) {
    const { MeshoptDecoder } = await import('../assets/vendor/three/jsm/libs/meshopt_decoder.module.js');
    return MeshoptDecoder.decodeGltfBufferAsync(count, stride, source, mode, filter);
  },
};

export function createStarterModelLoader(renderer = null) {
  const loads = new Set();
  let gltfPending;
  let ktxPending;
  let ktxLoader;
  let disposing;
  let closed = false;

  function getKtxLoader() {
    ktxPending ??= import('../assets/vendor/three/jsm/loaders/KTX2Loader.js').then(({ KTX2Loader }) => {
      ktxLoader = new KTX2Loader().setWorkerLimit(2).detectSupport(renderer);
      return ktxLoader;
    });
    return ktxPending;
  }

  const ktx = renderer && typeof Worker === 'function' && typeof WebAssembly !== 'undefined' ? {
    isKTX2Loader: true,
    load(url, onLoad, onProgress, onError) {
      void getKtxLoader().then(loader => loader.load(url, onLoad, onProgress, onError)).catch(onError);
    },
    parse(data, onLoad, onError) {
      void getKtxLoader().then(loader => loader.parse(data, onLoad, onError)).catch(onError);
    },
  } : null;

  function getGltfLoader() {
    gltfPending ??= import('../assets/vendor/three/jsm/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
      const loader = new GLTFLoader().setMeshoptDecoder(meshopt);
      if (ktx) loader.setKTX2Loader(ktx);
      return loader;
    });
    return gltfPending;
  }

  function loadAsync(url) {
    if (closed) return Promise.reject(new Error('Starter model loader is disposed'));
    const request = getGltfLoader().then(loader => {
      if (closed) throw new Error('Starter model loader is disposed');
      return loader.loadAsync(url);
    });
    loads.add(request);
    const retire = () => loads.delete(request);
    request.then(retire, retire);
    return request;
  }

  function dispose() {
    if (disposing) return disposing;
    closed = true;
    // The worker pool must remain available until providers finish their pending loads.
    disposing = Promise.allSettled(loads).then(() => {
      ktxLoader?.dispose();
      ktxLoader = null;
      ktxPending = null;
      gltfPending = null;
    });
    return disposing;
  }

  return { loadAsync, dispose };
}

export async function installStarter3DFeatures(app, THREE, base, loader) {
  app.scenes.onDispose(() => {
    void Promise.resolve(loader.dispose?.()).catch(error => console.error('3D model loader disposal failed', error));
  });
  if (!app.project.features.includes('model3d')) return app.installFeatures();
  const [{ createModel3DProvider }, { clone }] = await Promise.all([
    import(base + '/integrations/model3d.js'),
    import('../assets/vendor/three/jsm/utils/SkeletonUtils.js'),
  ]);
  if (app.disposed) return;
  const model3d = createModel3DProvider({ THREE, loader, cloneSkeleton: clone, projectBaseUrl: location.href });
  try {
    return await app.installFeatures({ model3d });
  } catch (error) {
    await model3d.dispose();
    throw error;
  }
}
