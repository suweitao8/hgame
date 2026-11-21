/**
 * Preload, prepare and switch between game-owned levels on the existing SceneManager.
 * The current scene remains live through loading and candidate activation.
 * @param {LevelFlowOptions} options
 */
export function createLevelFlow({ scenes, prefabs, assets, catalog, routes, createScene, prepare, onTrigger, onCleanupError }: LevelFlowOptions): {
    /** Prepare the route without activating it. @param {string} id @returns {Promise<void>} */
    prefetch(id: string): Promise<void>;
    /** @param {string} id @param {unknown} [data] @returns {Promise<LevelTransition>} */
    go(id: string, data?: unknown): Promise<LevelTransition>;
    /** Cancel the pending activation. The current scene stays available. */
    cancel(): boolean;
    /** Drop an unused prefetch and release what it owns. @param {string} id */
    discard(id: string): Promise<boolean>;
    /** @returns {LevelSession | null} */
    getCurrent(): LevelSession | null;
    dispose: () => Promise<void>;
};
export type LevelDefinition = import("./level.js").LevelDefinition;
export type LevelAssetKind = "json" | "text" | "arrayBuffer" | "blob" | "image";
export type AssetCatalog = ReturnType<typeof import("../platform/asset-catalog.js").createAssetCatalog>;
export type LevelRoute = {
    level: LevelDefinition | string;
    assets?: Record<string, {
        kind: LevelAssetKind;
        path: string;
    }>;
    assetGroups?: readonly string[];
};
export type LevelSession = {
    id: string;
    scene: Scene;
    level: ReturnType<typeof mountLevel>;
    assets: Readonly<Record<string, unknown>>;
};
export type DeferRelease = (release: () => unknown) => void;
export type LevelTransition = {
    session: LevelSession;
    cleanupErrors: unknown[];
};
export type PreparedLevel = {
    id: string;
    controller: AbortController;
    scene: Scene | null;
    session: LevelSession | null;
    promise: Promise<LevelSession> | null;
    releases: (() => unknown)[];
    releasing: Promise<unknown[]> | null;
};
export type LevelFlowOptions = {
    scenes: import("../core/scene.js").SceneManager;
    prefabs: import("../core/prefab.js").PrefabRegistry;
    assets?: import("../platform/assets.js").AssetLoader | undefined;
    /**
     * Shared media catalog. The caller owns it.
     */
    catalog?: {
        definition: Readonly<{
            schemaVersion: 1;
            assets: Readonly<Record<string, import("../platform/asset-catalog.js").AssetDescriptor>>;
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
        url(id: string): string;
        projectPath(id: string): string;
        openScope(): AssetScope;
        dispose(): void;
    } | undefined;
    routes: Record<string, LevelRoute>;
    /**
     * Return a new, inactive and unregistered scene.
     */
    createScene?: ((name: string, id: string) => Scene) | undefined;
    prepare?: ((session: LevelSession, signal: AbortSignal, deferRelease: DeferRelease) => void | Promise<void>) | undefined;
    onTrigger?: ((id: string, event: import("./trigger-volumes.js").TriggerEvent) => void) | undefined;
    /**
     * For cancellation and application teardown.
     */
    onCleanupError?: ((error: unknown) => void) | undefined;
};
import { Scene } from '../core/scene.js';
import { mountLevel } from './level.js';
