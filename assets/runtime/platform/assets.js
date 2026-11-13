function asError(error, url) {
  const result = new Error('Asset request failed: ' + url + (error?.message ? ' (' + error.message + ')' : ''));
  result.cause = error;
  return result;
}

export function createAssetLoader({
  baseUrl = './assets/',
  baseURI = globalThis.document?.baseURI || globalThis.location?.href || 'http://127.0.0.1/',
  fetchImpl = globalThis.fetch?.bind(globalThis),
  allowCrossOrigin = false,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available');
  const base = new URL(baseUrl, baseURI);
  if (!base.pathname.endsWith('/')) base.pathname += '/';

  function resolve(resource) {
    if (typeof resource !== 'string' || !resource.trim()) throw new TypeError('asset path must be a non-empty string');
    const absolute = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(resource);
    if (resource.includes('\\') || (absolute && !allowCrossOrigin)) {
      throw new TypeError('absolute asset URLs are not allowed');
    }
    const url = new URL(resource, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        (!allowCrossOrigin && url.origin !== base.origin)) {
      throw new TypeError('asset URL is outside the configured origin');
    }
    if (!allowCrossOrigin && !url.pathname.startsWith(base.pathname)) {
      throw new TypeError('asset path is outside the configured base');
    }
    return url.href;
  }

  async function request(resource, options) {
    const url = resolve(resource);
    let response;
    try {
      response = await fetchImpl(url, { credentials: 'same-origin', ...options });
    } catch (error) {
      throw asError(error, url);
    }
    if (!response.ok) throw new Error('Asset request failed: ' + url + ' (HTTP ' + response.status + ')');
    return response;
  }

  return Object.freeze({
    resolve,
    async json(resource, options) { return (await request(resource, options)).json(); },
    async text(resource, options) { return (await request(resource, options)).text(); },
    async arrayBuffer(resource, options) { return (await request(resource, options)).arrayBuffer(); },
    async blob(resource, options) { return (await request(resource, options)).blob(); },
    async image(resource, { createImageBitmapImpl = globalThis.createImageBitmap, ...options } = {}) {
      const blob = await request(resource, options).then(response => response.blob());
      if (typeof createImageBitmapImpl === 'function') return createImageBitmapImpl(blob);
      if (typeof globalThis.Image !== 'function') return blob;
      const url = URL.createObjectURL(blob);
      try {
        return await new Promise((resolveImage, reject) => {
          const image = new Image();
          image.onload = () => resolveImage(image);
          image.onerror = () => reject(new Error('Image decode failed: ' + resource));
          image.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    },
  });
}
