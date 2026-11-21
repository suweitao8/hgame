/**
 * Normalize a logical asset catalog. The release packager uses the same rules as the browser.
 * @param {AssetCatalogDefinition} data
 */
export function normalizeAssetCatalog(data: AssetCatalogDefinition): Readonly<{
    schemaVersion: 1;
    assets: Readonly<Record<string, AssetDescriptor>>;
    groups: Readonly<Record<string, readonly string[]>>;
}>;
/** @param {AssetCatalogDefinition} data @returns {string[]} */
export function listCatalogFiles(data: AssetCatalogDefinition): string[];
/**
 * Load assets by logical ID and deduplicate downloads/decodes across active scopes.
 * @param {AssetCatalogDefinition} data
 * @param {{loader: import('./assets.js').AssetLoader, modelProvider?: CatalogModelProvider, maxConcurrentLoads?: number}} options Queue distinct downloads and decodes together across scopes (default 6). With a model provider, model entries acquire decoded assets.
 */
export function createAssetCatalog(data: AssetCatalogDefinition, { loader, modelProvider, maxConcurrentLoads }: {
    loader: import("./assets.js").AssetLoader;
    modelProvider?: CatalogModelProvider;
    maxConcurrentLoads?: number;
}): {
    definition: Readonly<{
        schemaVersion: 1;
        assets: Readonly<Record<string, AssetDescriptor>>;
        groups: Readonly<Record<string, readonly string[]>>;
    }>;
    get: (id: string) => AssetDescriptor;
    getResidencyStats: () => Readonly<{
        modelBytes: any;
        imageBytes: number;
        audioBytes: number;
        bytesBytes: number;
        otherBytes: number;
        totalBytes: any;
        activeAcquisitions: number;
        queuedLoads: number;
        runningLoads: number;
        abortedRequests: any;
        abortedDependencies: any;
        disposedLateResources: any;
    }>;
    /** @param {string} id @returns {string} */
    url(id: string): string;
    /** @param {string} id @returns {string} */
    projectPath(id: string): string;
    /** @returns {AssetScope} */
    openScope(): AssetScope;
    dispose(): void;
};
export type AssetKind = "image" | "json" | "text" | "bytes" | "blob" | "audio" | "model" | "url";
export type AssetCatalogEntry = {
    kind: AssetKind;
    path: string;
    files?: readonly string[];
};
export type AssetCatalogDefinition = {
    schemaVersion: 1;
    assets: Record<string, AssetCatalogEntry>;
    groups?: Record<string, readonly string[]>;
};
export type AssetDescriptor = {
    kind: AssetKind;
    path: string;
    files: readonly string[];
};
export type Acquisition = {
    key: string;
    entryKind?: AssetKind;
    refs: number;
    controller: AbortController;
    promise: Promise<unknown>;
    ready: boolean;
    value: unknown;
    image: boolean;
    releaseValue: (() => void) | null;
};
export type CatalogModelProvider = {
    acquire: (path: string, options: {
        signal: AbortSignal;
        resolvedUrl: string;
    }) => Promise<{
        asset: unknown;
        release: () => void;
    }>;
};
export type AssetScope = {
    /**
     * Abort the caller's wait without invalidating shared acquisitions.
     */
    load: (id: string, options?: {
        signal?: AbortSignal;
    }) => Promise<unknown>;
    loadGroup: (group: string) => Promise<Record<string, unknown>>;
    dispose: () => void;
};
