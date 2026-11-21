const meshopt = {
  supported: typeof WebAssembly !== 'undefined',
  async decodeGltfBufferAsync(count, stride, source, mode, filter) {
    const { MeshoptDecoder } = await import('../assets/vendor/three/jsm/libs/meshopt_decoder.module.js');
    return MeshoptDecoder.decodeGltfBufferAsync(count, stride, source, mode, filter);
  },
};

export function createStarterModelLoader(renderer = null, {
  fetchImpl = (...args) => globalThis.fetch(...args),
  GLTFLoaderCtor = null,
  KTX2LoaderCtor = null,
} = {}) {
  const loads = new Set();
  let gltfPending;
  let ktxPending;
  let ktxLoader;
  let disposing;
  let closed = false;
  const stats = { abortedRequests: 0, abortedDependencies: 0, disposedLateResources: 0 };

  function disposeLateGltf(gltf) {
    if (!gltf || typeof gltf !== 'object') return 0;
    const roots = Array.isArray(gltf.scenes) ? gltf.scenes.filter(Boolean) : [];
    if (gltf.scene && !roots.includes(gltf.scene)) roots.push(gltf.scene);
    const seen = new Set();
    let count = 0;
    for (const root of roots) {
      root?.traverse?.(obj => {
        if (obj.geometry && !seen.has(obj.geometry)) {
          seen.add(obj.geometry);
          obj.geometry.dispose?.();
          count++;
        }
        const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
        for (const mat of mats) {
          if (!mat || seen.has(mat)) continue;
          seen.add(mat);
          for (const val of Object.values(mat)) {
            if (val?.isTexture && !seen.has(val)) {
              seen.add(val);
              val.dispose?.();
              count++;
            }
          }
          mat.dispose?.();
          count++;
        }
      });
    }
    stats.disposedLateResources += count;
    return count;
  }

  function getKtxLoader() {
    ktxPending ??= (KTX2LoaderCtor
      ? Promise.resolve(new KTX2LoaderCtor().setWorkerLimit(2).detectSupport(renderer))
      : import('../assets/vendor/three/jsm/loaders/KTX2Loader.js').then(({ KTX2Loader }) => {
        ktxLoader = new KTX2Loader().setWorkerLimit(2).detectSupport(renderer);
        return ktxLoader;
      })
    ).then(loader => {
      ktxLoader = loader;
      return loader;
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

  function createLoaderInstance(depSignal = null, onDependencyAbort = null) {
    const create = GLTFLoaderCtor
      ? Promise.resolve(new GLTFLoaderCtor())
      : import('../assets/vendor/three/jsm/loaders/GLTFLoader.js').then(({ GLTFLoader }) => new GLTFLoader());
    return create.then(loader => {
      loader.setMeshoptDecoder(meshopt);
      if (ktx) {
        if (!depSignal) {
          loader.setKTX2Loader(ktx);
        } else {
          loader.setKTX2Loader({
            isKTX2Loader: true,
            load(depUrl, onLoad, _onProgress, onError) {
              if (depSignal.aborted) {
                stats.abortedDependencies++;
                onDependencyAbort?.();
                onError?.(depSignal.reason ?? new DOMException('Aborted', 'AbortError'));
                return;
              }
              const depController = new AbortController();
              const onAbort = () => {
                stats.abortedDependencies++;
                onDependencyAbort?.();
                depController.abort(depSignal.reason);
              };
              depSignal.addEventListener('abort', onAbort, { once: true });
              Promise.resolve(fetchImpl(depUrl, { signal: depController.signal }))
                .then(res => {
                  if (!res.ok) throw new Error('KTX2 dependency failed: ' + depUrl + ' (' + res.status + ')');
                  return res.arrayBuffer();
                })
                .then(buf => {
                  depSignal.throwIfAborted();
                  return getKtxLoader().then(realKtx => new Promise((resolve, reject) => realKtx.parse(buf, resolve, reject)));
                })
                .then(tex => {
                  if (depSignal.aborted) {
                    tex?.dispose?.();
                    stats.disposedLateResources++;
                    throw depSignal.reason ?? new DOMException('Aborted', 'AbortError');
                  }
                  onLoad?.(tex);
                })
                .catch(err => onError?.(err))
                .finally(() => depSignal.removeEventListener('abort', onAbort));
            },
            parse(data, onLoad, onError) {
              if (depSignal.aborted) {
                stats.abortedDependencies++;
                onDependencyAbort?.();
                onError?.(depSignal.reason ?? new DOMException('Aborted', 'AbortError'));
                return;
              }
              ktx.parse(data, tex => {
                if (depSignal.aborted) {
                  tex?.dispose?.();
                  stats.disposedLateResources++;
                  onError?.(depSignal.reason ?? new DOMException('Aborted', 'AbortError'));
                  return;
                }
                onLoad?.(tex);
              }, onError);
            },
          });
        }
      }
      return loader;
    });
  }

  function getGltfLoader() {
    gltfPending ??= createLoaderInstance(null, null);
    return gltfPending;
  }

  function runLoad(load, useFreshLoader = false, signal = null, onDependencyAbort = null) {
    if (closed) return Promise.reject(new Error('Starter model loader is disposed'));
    const loaderPromise = useFreshLoader ? createLoaderInstance(signal, onDependencyAbort) : getGltfLoader();
    const request = loaderPromise.then(loader => {
      if (closed) throw new Error('Starter model loader is disposed');
      return load(loader);
    });
    loads.add(request);
    const retire = () => loads.delete(request);
    request.then(retire, retire);
    return request;
  }

  function loadAsync(url) {
    return runLoad(loader => loader.loadAsync(url));
  }

  function loadWithSignal(url, signal, { onDependencyAbort = null } = {}) {
    const controller = new AbortController();
    const forwardAbort = () => {
      stats.abortedRequests++;
      controller.abort(signal.reason);
    };
    if (signal?.aborted) {
      stats.abortedRequests++;
      return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', forwardAbort, { once: true });

    return runLoad(async loader => {
      try {
        controller.signal.throwIfAborted();
        const response = await fetchImpl(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Model request failed: ' + url + ' (' + response.status + ')');
        const data = await response.arrayBuffer();
        controller.signal.throwIfAborted();
        const base = new URL(url, globalThis.document?.baseURI ?? globalThis.location?.href ?? 'http://127.0.0.1/');
        const resourceBase = new URL('.', base).href;
        // Propagate AbortSignal to synchronous/async glTF dependency fetches while active.
        const origFetch = globalThis.fetch;
        const depControllers = new Set();
        const onDepAbort = () => {
          for (const depCtrl of depControllers) {
            stats.abortedDependencies++;
            onDependencyAbort?.();
            depCtrl.abort(controller.signal.reason);
          }
        };
        controller.signal.addEventListener('abort', onDepAbort, { once: true });
        const scopedFetch = typeof origFetch === 'function' ? (input, init = {}) => {
          if (controller.signal.aborted) {
            stats.abortedDependencies++;
            onDependencyAbort?.();
            return Promise.reject(controller.signal.reason ?? new DOMException('Aborted', 'AbortError'));
          }
          const depCtrl = new AbortController();
          depControllers.add(depCtrl);
          if (init?.signal) {
            if (init.signal.aborted) depCtrl.abort(init.signal.reason);
            else init.signal.addEventListener('abort', () => depCtrl.abort(init.signal.reason), { once: true });
          }
          return Promise.resolve(fetchImpl(input, { ...init, signal: depCtrl.signal })).finally(() => {
            depControllers.delete(depCtrl);
          });
        } : null;

        let gltf;
        if (scopedFetch && globalThis.fetch === origFetch) {
          globalThis.fetch = scopedFetch;
          try {
            gltf = await loader.parseAsync(data, resourceBase);
          } finally {
            if (globalThis.fetch === scopedFetch) globalThis.fetch = origFetch;
            controller.signal.removeEventListener('abort', onDepAbort);
          }
        } else {
          try {
            gltf = await loader.parseAsync(data, resourceBase);
          } finally {
            controller.signal.removeEventListener('abort', onDepAbort);
          }
        }
        if (controller.signal.aborted) {
          disposeLateGltf(gltf);
          controller.signal.throwIfAborted();
        }
        return gltf;
      } finally {
        signal?.removeEventListener('abort', forwardAbort);
      }
    }, true, controller.signal, onDependencyAbort);
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

  return {
    loadAsync,
    loadWithSignal,
    getStats() { return { ...stats }; },
    dispose,
  };
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
