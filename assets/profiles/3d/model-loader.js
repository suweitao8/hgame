const meshopt = {
  supported: typeof WebAssembly !== 'undefined',
  async decodeGltfBufferAsync(count, stride, source, mode, filter) {
    const { MeshoptDecoder } = await import('../assets/vendor/three/jsm/libs/meshopt_decoder.module.js');
    return MeshoptDecoder.decodeGltfBufferAsync(count, stride, source, mode, filter);
  },
};

export function createStarterModelLoader() {
  let pending;
  return {
    async loadAsync(url) {
      pending ??= import('../assets/vendor/three/jsm/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
        return new GLTFLoader().setMeshoptDecoder(meshopt);
      });
      return (await pending).loadAsync(url);
    },
  };
}

export async function installStarter3DFeatures(app, THREE, base, loader) {
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
