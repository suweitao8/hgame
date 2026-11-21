/**
 * Create a remote asset bundle loader.
 *
 * @param {{
 *   manifestUrl: string,
 *   manifest?: { version?: string | number, bundles: Record<string, { files: Array<{ path: string, size?: number, sha256?: string }>, deps?: string[] }> } | null,
 *   fetch?: typeof globalThis.fetch,
 *   cache?: 'auto' | 'memory' | null,
 *   cacheName?: string,
 *   caches?: CacheStorage | null,
 *   retries?: number,
 *   backoffMs?: number,
 *   timeoutMs?: number,
 *   integrity?: boolean,
 *   maxConcurrent?: number,
 *   baseUrl?: string | null,
 * }} options
 */
export function createRemoteBundleLoader({ manifestUrl, manifest: inlineManifest, fetch, cache, cacheName, caches: cacheStorage, retries, backoffMs, timeoutMs, integrity, maxConcurrent, baseUrl, }?: {
    manifestUrl: string;
    manifest?: {
        version?: string | number;
        bundles: Record<string, {
            files: Array<{
                path: string;
                size?: number;
                sha256?: string;
            }>;
            deps?: string[];
        }>;
    } | null;
    fetch?: typeof globalThis.fetch;
    cache?: "auto" | "memory" | null;
    cacheName?: string;
    caches?: CacheStorage | null;
    retries?: number;
    backoffMs?: number;
    timeoutMs?: number;
    integrity?: boolean;
    maxConcurrent?: number;
    baseUrl?: string | null;
}): {
    loadManifest: ({ signal }?: {
        signal?: AbortSignal;
    } | undefined) => Promise<any>;
    loadBundle: (id: string, { signal, onProgress }?: {
        signal?: AbortSignal;
        onProgress?: (progress: object) => void;
    } | undefined) => Promise<Map<any, any>>;
    unloadBundle: (id: any) => boolean;
    getFile: (relPath: any) => ArrayBuffer | null;
    fetchFile: (relPath: string, { signal }?: {
        signal?: AbortSignal;
    } | undefined) => Promise<any>;
    stats: () => Readonly<{
        manifestLoaded: boolean;
        loadedBundles: string[];
        cachedFiles: number;
        residentBytes: number;
        hits: number;
        misses: number;
        retries: number;
        failures: number;
        activeRequests: number;
    }>;
    resolve(relPath: any): any;
    toCatalogLoader(): {
        resolve(relPath: any): any;
        arrayBuffer(relPath: any, opts?: {}): Promise<any>;
        text(relPath: any, opts?: {}): Promise<string>;
        json(relPath: any, opts?: {}): Promise<any>;
        blob(relPath: any, opts?: {}): Promise<Blob>;
        image(relPath: any, opts?: {}): Promise<Blob | ImageBitmap>;
    };
};
/**
 * Adapt a `createRemoteBundleLoader` instance to the `loader` interface expected by
 * `createAssetCatalog(data, { loader })`.
 *
 * @param {ReturnType<typeof createRemoteBundleLoader>} bundleLoader
 */
export function toCatalogLoader(bundleLoader: ReturnType<typeof createRemoteBundleLoader>): {
    resolve(relPath: any): any;
    arrayBuffer(relPath: any, opts?: {}): Promise<any>;
    text(relPath: any, opts?: {}): Promise<string>;
    json(relPath: any, opts?: {}): Promise<any>;
    blob(relPath: any, opts?: {}): Promise<Blob>;
    image(relPath: any, opts?: {}): Promise<Blob | ImageBitmap>;
};
