/**
 * Creates a clean-room GLTF / skinned-model & animation provider compatible with
 * `app.installFeatures({ model3d })`.
 * @param {Model3DProviderOptions} options Provider options.
 * @returns {Model3DProvider} Provider API.
 */
export function createModel3DProvider({ THREE, GLTFLoader, loader, cloneSkeleton, projectBaseUrl, maxResidentBytes, }?: Model3DProviderOptions): Model3DProvider;
/**
 * Options for {@link createModel3DProvider}.
 */
export type Model3DProviderOptions = {
    /**
     * Three.js namespace (required).
     */
    THREE: import("./helpers.js").Model3DThree;
    /**
     * GLTFLoader constructor used when `loader` is not given.
     */
    GLTFLoader?: (new () => import("./helpers.js").Model3DLoader) | null | undefined;
    /**
     * Loader instance.
     */
    loader?: import("./helpers.js").Model3DLoader | null | undefined;
    /**
     * Custom hierarchy cloner (e.g. SkeletonUtils.clone).
     */
    cloneSkeleton?: ((source: import("./helpers.js").Model3DObject) => import("./helpers.js").Model3DObject) | null | undefined;
    /**
     * Base URL that relative asset paths resolve against.
     */
    projectBaseUrl?: string | URL | null | undefined;
    /**
     * Soft budget for resident models. Only idle scoped models can be evicted.
     */
    maxResidentBytes?: number | undefined;
};
/**
 * A loaded or registered model asset.
 */
export type Model3DAssetEntry = {
    /**
     * Normalized relative asset key.
     */
    key: string;
    /**
     * Source scene graph.
     */
    scene: import("./helpers.js").Model3DObject;
    /**
     * Animation clips.
     */
    animations: import("./helpers.js").Model3DClip[];
    /**
     * Raw loader result, or null for registered assets.
     */
    gltf: unknown;
    /**
     * True when the provider disposes the resources on `dispose()`.
     */
    owned: boolean;
};
export type Model3DLease = {
    asset: Model3DAssetEntry;
    release: () => boolean;
};
export type Model3DLoad = {
    asset: Model3DAssetEntry | null;
    roots: import("./helpers.js").Model3DObject[];
    controller: AbortController;
    request: Promise<any>;
    refs: number;
    pinned: boolean;
};
/**
 * Extra property `clipName` renames the clip when the file holds exactly one clip (default `null`).
 */
export type Model3DLoadClipsOptions = import("./helpers.js").PrepareAnimationClipsOptions & {
    clipName?: string | null;
};
/**
 * Options for {@link Model3DProvider.registerAsset}.
 */
export type Model3DRegisterAssetOptions = {
    /**
     * Cloneable scene root.
     */
    scene: import("./helpers.js").Model3DObject;
    /**
     * Animation clips.
     */
    animations?: import("./helpers.js").Model3DClip[] | undefined;
    /**
     * Dispose resources on provider `dispose()`.
     */
    owned?: boolean | undefined;
};
/**
 * A cloned model instance.
 */
export type Model3DInstance = {
    /**
     * Cloned hierarchy.
     */
    root: import("./helpers.js").Model3DObject;
    /**
     * Source clips.
     */
    animations: import("./helpers.js").Model3DClip[];
};
/**
 * Animation notify definition.
 */
export type Model3DNotifyOptions = {
    /**
     * Stable id (auto-generated when null; same id replaces).
     */
    id?: string | null | undefined;
    /**
     * Display name.
     */
    name?: string | undefined;
    /**
     * Trigger time in seconds (takes precedence over `normalizedTime`).
     */
    time?: number | undefined;
    /**
     * Trigger position 0..1 of the clip duration.
     */
    normalizedTime?: number | undefined;
    /**
     * Per-notify callback.
     */
    callback?: ((event: Model3DNotifyEvent) => void) | null | undefined;
    /**
     * User payload forwarded to the event.
     */
    data?: unknown;
    /**
     * Clip name (array form of `notifies` only).
     */
    clipName?: string | undefined;
};
/**
 * Event passed to notify callbacks.
 */
export type Model3DNotifyEvent = {
    /**
     * Notify id.
     */
    id: string;
    /**
     * Notify name.
     */
    name: string;
    /**
     * Clip that fired it.
     */
    clipName: string;
    /**
     * Trigger time in seconds.
     */
    time: number;
    /**
     * Trigger position 0..1.
     */
    normalizedTime: number;
    /**
     * Clip duration in seconds.
     */
    duration: number;
    /**
     * Loop lap index (0 for non-looping).
     */
    loopCount: number;
    /**
     * User payload.
     */
    data: unknown;
    /**
     * Owning component.
     */
    component: Model3DComponent;
};
/**
 * Options for {@link Model3DProvider.createComponent}.
 */
export type Model3DComponentOptions = {
    /**
     * Loaded asset (requires `scene`).
     */
    asset?: import("./helpers.js").Model3DAsset | null | undefined;
    /**
     * Pre-built root (alternative to `asset`; not cloned).
     */
    root?: import("./helpers.js").Model3DObject | null | undefined;
    /**
     * Clips overriding `asset.animations`.
     */
    animations?: import("./helpers.js").Model3DClip[] | null | undefined;
    /**
     * Clip to play on awake.
     */
    clip?: string | null | undefined;
    /**
     * Default loop flag.
     */
    loop?: boolean | undefined;
    /**
     * Default playback speed multiplier.
     */
    timeScale?: number | undefined;
    /**
     * Default cross-fade duration in seconds.
     */
    crossFadeSeconds?: number | undefined;
    /**
     * Meshes cast shadows.
     */
    castShadow?: boolean | undefined;
    /**
     * Meshes receive shadows.
     */
    receiveShadow?: boolean | undefined;
    /**
     * Vertical offset in world units.
     */
    offsetY?: number | undefined;
    /**
     * Uniform scale.
     */
    scale?: number | undefined;
    /**
     * Auto-scale so the model is this tall (world units).
     */
    targetHeight?: number | null | undefined;
    /**
     * Shift so the bounds minimum sits at y=0.
     */
    alignGround?: boolean | undefined;
    /**
     * Model yaw in radians.
     */
    rotationY?: number | undefined;
    /**
     * Strip namespace prefixes from bone/track names.
     */
    stripNamespace?: boolean | undefined;
    /**
     * Lock root-bone position tracks.
     */
    stripRootMotion?: boolean | "xz" | "xyz" | undefined;
    /**
     * Root bone names (defaults to root, pelvis, hips, armature).
     */
    rootBoneNames?: string[] | undefined;
    /**
     * Bone/track rename map.
     */
    renameMap?: Record<string, string> | null | undefined;
    /**
     * Use render-alpha interpolated transforms.
     */
    interpolate?: boolean | undefined;
    /**
     * Distance-based animation tick throttling.
     */
    enableLod?: boolean | undefined;
    /**
     * Three world-unit distances for 1/2, 1/4, 1/8 tick rates.
     */
    lodDistances?: number[] | undefined;
    /**
     * Frustum-cull the model each update.
     */
    cull?: boolean | undefined;
    /**
     * Cull sphere radius in world units (auto when null).
     */
    cullRadius?: number | null | undefined;
    /**
     * Max world distance for casting shadows (renderer preset when null).
     */
    shadowDistance?: number | null | undefined;
    /**
     * Initial notifies (array with `clipName`, or map of clip name to list).
     */
    notifies?: Model3DNotifyOptions[] | Record<string, Model3DNotifyOptions[]> | null | undefined;
    /**
     * Fires for every notify.
     */
    onNotify?: ((event: Model3DNotifyEvent) => void) | null | undefined;
};
/**
 * Options for {@link Model3DComponent.play}.
 */
export type Model3DPlayOptions = {
    /**
     * Loop flag (defaults to the component default).
     */
    loop?: boolean | undefined;
    /**
     * Cross-fade seconds (defaults to the component default).
     */
    crossFadeSeconds?: number | undefined;
    /**
     * Speed multiplier (defaults to the component default).
     */
    timeScale?: number | undefined;
    /**
     * Called when a non-looping clip finishes.
     */
    onComplete?: ((clipName: string) => void) | null | undefined;
};
/**
 * Options for {@link Model3DComponent.playOverlay}.
 */
export type Model3DOverlayOptions = {
    /**
     * Effective blend weight 0..1.
     */
    weight?: number | undefined;
    /**
     * Loop the overlay.
     */
    loop?: boolean | undefined;
    /**
     * Fade-in seconds.
     */
    fadeIn?: number | undefined;
    /**
     * Fade-out seconds.
     */
    fadeOut?: number | undefined;
    /**
     * Speed multiplier (defaults to the component default).
     */
    timeScale?: number | undefined;
    /**
     * Called when a non-looping overlay finishes.
     */
    onComplete?: ((clipName: string) => void) | null | undefined;
};
/**
 * Options for {@link Model3DComponent.attachToBone}.
 */
export type Model3DAttachOptions = {
    /**
     * Local position (world units).
     */
    position?: {
        x?: number;
        y?: number;
        z?: number;
    } | null | undefined;
    /**
     * Local Euler rotation in radians.
     */
    rotation?: {
        x?: number;
        y?: number;
        z?: number;
    } | null | undefined;
    /**
     * Uniform or per-axis scale.
     */
    scale?: number | {
        x?: number;
        y?: number;
        z?: number;
    } | null | undefined;
};
/**
 * Handle returned by {@link Model3DComponent.attachToBone}.
 */
export type Model3DAttachment = {
    /**
     * Bone the child is attached to.
     */
    bone: import("./helpers.js").Model3DObject;
    /**
     * Attached child.
     */
    object: import("./helpers.js").Model3DObject;
    /**
     * Removes the child from the bone.
     */
    detach: () => void;
};
/**
 * Component created by {@link Model3DProvider.createComponent} (extends the core `Component`).
 */
export type Model3DComponent = import("../../core/component.js").Component & {
    object3d: import("./helpers.js").Model3DObject;
    modelRoot: import("./helpers.js").Model3DObject;
    mixer: {
        [member: string]: unknown;
    } | null;
    getClipNames(): string[];
    addNotify(clipName: string, options?: Model3DNotifyOptions): string;
    removeNotify(clipName: string, idOrName: string): boolean;
    clearNotifies(clipName?: string | null): boolean;
    findBone(boneName: string): import("./helpers.js").Model3DObject | null;
    attachToBone(boneName: string, child: import("./helpers.js").Model3DObject, options?: Model3DAttachOptions): Model3DAttachment;
    attachAnimator(config?: object): ReturnType<typeof import("../../animation/animator3d.js").createAnimator3D>;
    readonly animator: ReturnType<typeof import("../../animation/animator3d.js").createAnimator3D> | null;
    play(name: string, options?: Model3DPlayOptions): boolean;
    playOverlay(name: string, options?: Model3DOverlayOptions): boolean;
    stopOverlay(fadeOut?: number): boolean;
    stop(): void;
    updateTransform(): void;
};
/**
 * Provider API returned by {@link createModel3DProvider}.
 */
export type Model3DProvider = {
    /**
     * The Three.js namespace passed in.
     */
    THREE: import("./helpers.js").Model3DThree;
    /**
     * Loads (and caches) a GLTF by relative path.
     */
    load: (url: string) => Promise<Model3DAssetEntry>;
    /**
     * Hold a model until the lease is released. A signal cancels the pending acquisition. A catalog may supply its resolved asset URL.
     */
    acquire: (url: string, options?: {
        signal?: AbortSignal;
        resolvedUrl?: string;
    }) => Promise<Model3DLease>;
    /**
     * Estimated owned geometry and texture bytes, idle eviction hook, and cancellation/residency stats.
     */
    residency: {
        readBytes: () => number;
        trimIdle: (excessBytes: number) => void;
        getStats: () => {
            residentBytes: number;
            idleModels: number;
            activeLoads: number;
            abortedRequests: number;
            abortedDependencies: number;
            disposedLateResources: number;
        };
    };
    /**
     * Loads and prepares animation clips from a file.
     */
    loadClips: (url: string, options?: Model3DLoadClipsOptions) => Promise<import("./helpers.js").Model3DClip[]>;
    /**
     * Registers an in-memory asset.
     */
    registerAsset: (urlOrKey: string, options: Model3DRegisterAssetOptions) => Model3DAssetEntry;
    /**
     * Loads and clones an asset.
     */
    instantiate: (urlOrKey: string) => Promise<Model3DInstance>;
    /**
     * Inspects bounds, bones, and clips.
     */
    inspect: (assetOrRoot: import("./helpers.js").Model3DAsset | import("./helpers.js").Model3DObject, explicitAnimations?: import("./helpers.js").Model3DClip[] | null) => import("./helpers.js").Model3DInspection;
    /**
     * Creates an animated model component.
     */
    createComponent: (options?: Model3DComponentOptions) => Model3DComponent;
    /**
     * Creates a VAT instanced crowd.
     */
    createCrowd: (options?: import("./crowd.js").InstancedCrowd3DOptions) => import("./crowd.js").InstancedCrowd3D;
    /**
     * Creates an animation budget allocator.
     */
    createBudgetAllocator: (options?: import("./budget.js").AnimationBudgetAllocatorOptions) => import("./budget.js").AnimationBudgetAllocator;
    /**
     * Disposes owned resources; false when already disposed.
     */
    dispose: () => Promise<boolean>;
};
