/** Nominal geometry-buffer and texture payload estimates for a set of unique model resources. */
export function estimateModelBytes(resources) {
  const buffers = new Set();
  let bytes = 0;
  for (const resource of resources) {
    if (resource.isBufferGeometry) {
      for (const attribute of Object.values(resource.attributes ?? {})) remember(attribute);
      for (const targets of Object.values(resource.morphAttributes ?? {})) {
        for (const attribute of targets) remember(attribute);
      }
      remember(resource.index);
    } else if (resource.isTexture) {
      const levels = resource.mipmaps?.length ? resource.mipmaps : Array.isArray(resource.image) ? resource.image : [resource.image];
      let textureBytes = 0;
      for (const image of levels) {
        if (!image) continue;
        textureBytes += image.data?.byteLength ?? (image.width ?? 0) * (image.height ?? 0) * (image.depth ?? 1) * 4;
      }
      bytes += resource.generateMipmaps && !resource.mipmaps?.length ? Math.ceil(textureBytes * 4 / 3) : textureBytes;
    }
  }
  for (const buffer of buffers) bytes += buffer.array.byteLength;
  return bytes;

  function remember(attribute) {
    const buffer = attribute?.data ?? attribute;
    if (ArrayBuffer.isView(buffer?.array)) buffers.add(buffer);
  }
}

/** Wait for a parsed model without making an individual caller own the shared operation. */
export function waitForModel(promise, signals) {
  return new Promise((resolve, reject) => {
    const listeners = new Map();
    function cleanUp() {
      for (const [signal, callback] of listeners) signal.removeEventListener('abort', callback);
      listeners.clear();
    }
    for (const signal of signals) {
      if (!signal) continue;
      if (signal.aborted) {
        cleanUp();
        reject(signal.reason);
        return;
      }
      const callback = () => { cleanUp(); reject(signal.reason); };
      listeners.set(signal, callback);
      signal.addEventListener('abort', callback, { once: true });
    }
    promise.then(value => { cleanUp(); resolve(value); }, error => { cleanUp(); reject(error); });
  });
}
