/**
 * @param {unknown} error
 * @param {string} url
 * @returns {Error}
 */
function asError(error, url) {
  const result = new Error('Asset request failed: ' + url + (error?.message ? ' (' + error.message + ')' : ''));
  result.cause = error;
  return result;
}

/**
 * @typedef {object} AssetLoaderOptions
 * @property {string} [baseUrl='./assets/'] Asset root, resolved against `baseURI`.
 * @property {string} [baseURI] Document base URL (default: `document.baseURI` / `location.href` / loopback).
 * @property {typeof fetch} [fetchImpl] Fetch implementation (default: bound `globalThis.fetch`).
 * @property {boolean} [allowCrossOrigin=false] Allow absolute / cross-origin asset URLs.
 */

/**
 * @typedef {Omit<RequestInit, 'credentials'> & { credentials?: RequestCredentials }} AssetRequestOptions
 *   Extra `fetch` init forwarded to every asset request (default credentials: `'same-origin'`).
 */

/**
 * @typedef {AssetRequestOptions & { createImageBitmapImpl?: ((blob: Blob) => Promise<ImageBitmap>) | undefined }} AssetImageOptions
 *   Image request options; `createImageBitmapImpl` overrides `globalThis.createImageBitmap`.
 */

/**
 * @typedef {object} AssetLoader Sandboxed (same-origin, base-relative) asset loader.
 * @property {(resource: string) => string} resolve Resolve a relative path to an absolute href; throws when outside the base.
 * @property {<T = unknown>(resource: string, options?: AssetRequestOptions) => Promise<T>} json Fetch and parse JSON.
 * @property {(resource: string, options?: AssetRequestOptions) => Promise<string>} text Fetch text.
 * @property {(resource: string, options?: AssetRequestOptions) => Promise<ArrayBuffer>} arrayBuffer Fetch bytes.
 * @property {(resource: string, options?: AssetRequestOptions) => Promise<Blob>} blob Fetch a Blob.
 * @property {(resource: string, options?: AssetImageOptions) => Promise<ImageBitmap | HTMLImageElement | Blob>} image
 *   Fetch and decode an image (ImageBitmap, falling back to HTMLImageElement, then the raw Blob).
 */

/**
 * Create a sandboxed asset loader.
 * @param {AssetLoaderOptions} [options]
 * @returns {AssetLoader}
 */
export function createAssetLoader({
  baseUrl = './assets/',
  baseURI = globalThis.document?.baseURI || globalThis.location?.href || 'http://127.0.0.1/',
  fetchImpl = globalThis.fetch?.bind(globalThis),
  allowCrossOrigin = false,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available');
  const base = new URL(baseUrl, baseURI);
  if (!base.pathname.endsWith('/')) base.pathname += '/';

  /** @param {string} resource @returns {string} */
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

  /** @param {string} resource @param {AssetRequestOptions} [options] @returns {Promise<Response>} */
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
    /** @type {AssetLoader['json']} */
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
