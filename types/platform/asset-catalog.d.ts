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
 * @param {{loader: import('./assets.js').AssetLoader, modelProvider?: CatalogModelProvider, maxConcurrentLoads?: number, streamingPolicy?: { getStats?: () => { residentBytes?: number, withinBudget?: boolean, evictions?: number } } | null}} options Queue distinct downloads and decodes together across scopes (default 6). With a model provider, model entries acquire decoded assets.
 */
export function createAssetCatalog(data: AssetCatalogDefinition, { loader, modelProvider, maxConcurrentLoads, streamingPolicy }: {
    loader: import("./assets.js").AssetLoader;
    modelProvider?: CatalogModelProvider;
    maxConcurrentLoads?: number;
    streamingPolicy?: {
        getStats?: () => {
            residentBytes?: number;
            withinBudget?: boolean;
            evictions?: number;
        };
    } | null;
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
        streamingBytes: number;
        streamingWithinBudget: boolean;
        streamingEvictions: number;
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
/**
 * Distance- and budget-driven mip/bundle streaming residency policy.
 * Upgrades nearby assets to mip bias 0, downgrades distant assets (mip 1..3),
 * and evicts lowest-priority / farthest assets when exceeding `maxBytes`.
 */
export function createStreamingResidencyPolicy({ maxBytes, nearDistance, midDistance, farDistance, }?: {
    maxBytes?: number | undefined;
    nearDistance?: number | undefined;
    midDistance?: number | undefined;
    farDistance?: number | undefined;
}): Readonly<{
    register: (id: any, { position, baseBytes, priority, onMipChange, onEvict, }?: {
        position?: {
            x: number;
            y: number;
            z: number;
        } | undefined;
        baseBytes?: number | undefined;
        priority?: number | undefined;
        onMipChange?: null | undefined;
        onEvict?: null | undefined;
    }) => {
        id: string;
        position: {
            x: number;
            y: number;
            z: number;
        };
        baseBytes: number;
        priority: number;
        mipBias: number;
        evicted: boolean;
        distance: number;
        residentBytes: number;
        onMipChange: null;
        onEvict: null;
    };
    unregister: (id: any) => boolean;
    setPosition: (id: any, position: any) => boolean;
    setGlobalMipBias: (bias?: number) => number;
    update: (viewerPos?: {
        x: number;
        y: number;
        z: number;
    }) => {
        residentBytes: number;
        maxBytes: number;
        withinBudget: boolean;
        activeCount: number;
        evictedCount: number;
        upgrades: number;
        downgrades: number;
        evictions: number;
    };
    getEntry: (id: any) => any;
    getStats: () => Readonly<{
        maxBytes: number;
        residentBytes: number;
        withinBudget: boolean;
        totalEntries: number;
        activeCount: number;
        evictedCount: number;
        upgrades: number;
        downgrades: number;
        evictions: number;
    }>;
    dispose: () => void;
}>;
/**
 * VRAM Anti-OOM Mip Guard that dynamically shifts streaming mip bias down (lowering texture VRAM
 * by 4x-16x) when allocated device/texture bytes approach mobile WebView soft/hard thresholds.
 */
export function createVramMipGuard({ streamingPolicy, budgetBytes, softRatio, hardRatio, onMipBiasChange, }?: {
    streamingPolicy?: null | undefined;
    budgetBytes?: number | undefined;
    softRatio?: number | undefined;
    hardRatio?: number | undefined;
    onMipBiasChange?: null | undefined;
}): Readonly<{
    step: (usedBytes: any, overrideBudget?: number) => {
        mipBiasOffset: number;
        state: string;
        ratio: number;
        changed: boolean;
    };
    getState: () => Readonly<{
        mipBiasOffset: number;
        state: string;
        ratio: number;
        budgetBytes: number;
    }>;
}>;
/**
 * Bind an actual Three.js / Image texture object into `createStreamingResidencyPolicy`
 * so mip upgrades/downgrades automatically swap backing resolution/image sources and mark `needsUpdate`.
 */
export function bindTextureMipStreaming(policy: any, id: any, texture: any, { position, baseBytes, priority, mipSources, anisotropies, onSwap, }?: {
    position?: {
        x: number;
        y: number;
        z: number;
    } | undefined;
    baseBytes?: number | undefined;
    priority?: number | undefined;
    mipSources?: never[] | undefined;
    anisotropies?: number[] | undefined;
    onSwap?: null | undefined;
}): Readonly<{
    entry: any;
    readonly swaps: number;
    readonly lastAppliedMip: number;
    readonly evictedCount: number;
    unbind(): any;
}>;
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
