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
export function createAssetLoader({ baseUrl, baseURI, fetchImpl, allowCrossOrigin, }?: AssetLoaderOptions): AssetLoader;
export type AssetLoaderOptions = {
    /**
     * Asset root, resolved against `baseURI`.
     */
    baseUrl?: string;
    /**
     * Document base URL (default: `document.baseURI` / `location.href` / loopback).
     */
    baseURI?: string;
    /**
     * Fetch implementation (default: bound `globalThis.fetch`).
     */
    fetchImpl?: typeof fetch;
    /**
     * Allow absolute / cross-origin asset URLs.
     */
    allowCrossOrigin?: boolean;
};
/**
 * Extra `fetch` init forwarded to every asset request (default credentials: `'same-origin'`).
 */
export type AssetRequestOptions = Omit<RequestInit, "credentials"> & {
    credentials?: RequestCredentials;
};
/**
 * Image request options; `createImageBitmapImpl` overrides `globalThis.createImageBitmap`.
 */
export type AssetImageOptions = AssetRequestOptions & {
    createImageBitmapImpl?: ((blob: Blob) => Promise<ImageBitmap>) | undefined;
};
/**
 * Sandboxed (same-origin, base-relative) asset loader.
 */
export type AssetLoader = {
    /**
     * Resolve a relative path to an absolute href; throws when outside the base.
     */
    resolve: (resource: string) => string;
    /**
     * Fetch and parse JSON.
     */
    json: <T = unknown>(resource: string, options?: AssetRequestOptions) => Promise<T>;
    /**
     * Fetch text.
     */
    text: (resource: string, options?: AssetRequestOptions) => Promise<string>;
    /**
     * Fetch bytes.
     */
    arrayBuffer: (resource: string, options?: AssetRequestOptions) => Promise<ArrayBuffer>;
    /**
     * Fetch a Blob.
     */
    blob: (resource: string, options?: AssetRequestOptions) => Promise<Blob>;
    /**
     *   Fetch and decode an image (ImageBitmap, falling back to HTMLImageElement, then the raw Blob).
     */
    image: (resource: string, options?: AssetImageOptions) => Promise<ImageBitmap | HTMLImageElement | Blob>;
};
