/**
 * Minimal structural Three.js Object3D (add/remove capable).
 * @typedef {{ add(object: object): unknown, remove(object: object): unknown, [key: string]: unknown }} ThreeObject3D
 */
/**
 * Injected Three.js namespace: only the constructors this module uses.
 * @typedef {{
 *   Scene: new () => ThreeObject3D,
 *   PerspectiveCamera: new (fov: number, aspect: number, near: number, far: number) => ThreeCamera,
 *   WebGLRenderer: new (options: object) => ThreeRenderer,
 *   Mesh?: new (geometry: object, material: object) => ThreeMesh,
 *   BoxGeometry?: new (...args: number[]) => ThreeDisposable,
 *   MeshStandardMaterial?: new (options: object) => ThreeDisposable,
 *   Color?: new (value: number | string) => object,
 *   Fog?: new (color: number | string, near: number, far: number) => object,
 *   HemisphereLight?: new (sky: number | string, ground: number | string, intensity: number) => object,
 *   DirectionalLight?: new (color: number | string, intensity: number) => ThreeDirectionalLight,
 *   Vector3?: new (x?: number, y?: number, z?: number) => ThreeVector3,
 *   Matrix4?: new () => ThreeMatrix4,
 *   [key: string]: unknown
 * }} ThreeNamespace
 */
/**
 * @typedef {{ dispose?(): void, [key: string]: unknown }} ThreeDisposable
 */
/**
 * @typedef {{ x: number, y: number, z: number, set(x: number, y: number, z: number): ThreeVector3,
 *   copy(v: object): ThreeVector3, sub(v: object): ThreeVector3, normalize(): ThreeVector3,
 *   applyMatrix4(m: object): ThreeVector3, setFromMatrixPosition?(m: object): ThreeVector3 }} ThreeVector3
 */
/**
 * @typedef {{ fromArray(a: ArrayLike<number>): ThreeMatrix4,
 *   decompose(position: object, quaternion: object, scale: object): ThreeMatrix4 }} ThreeMatrix4
 */
/**
 * Minimal structural Three.js camera.
 * @typedef {{ position: { x: number, y: number, z: number, set(x: number, y: number, z: number): unknown },
 *   aspect?: number, far?: number, updateProjectionMatrix?(): void, updateMatrixWorld?(force?: boolean): void,
 *   lookAt?(x: number, y: number, z: number): void,
 *   matrixWorld?: object, matrixWorldInverse?: object, projectionMatrix?: object, projectionMatrixInverse?: object,
 *   [key: string]: unknown }} ThreeCamera
 */
/**
 * Minimal structural Three.js mesh.
 * @typedef {{ geometry?: ThreeDisposable, material?: ThreeDisposable | ThreeDisposable[],
 *   castShadow: boolean, receiveShadow: boolean, visible: boolean,
 *   position: { x: number, y: number, z: number, set(x: number, y: number, z: number): unknown },
 *   rotation: { set(x: number, y: number, z: number): unknown },
 *   scale: { set(x: number, y: number, z: number): unknown },
 *   quaternion?: object, [key: string]: unknown }} ThreeMesh
 */
/**
 * Minimal structural Three.js WebGLRenderer.
 * @typedef {{ render(scene: object, camera: object): void, setSize(w: number, h: number, updateStyle?: boolean): void,
 *   setPixelRatio(ratio: number): void, getContext?(): object | null, dispose(): void,
 *   autoClear: boolean, toneMapping: number, toneMappingExposure: number,
 *   shadowMap?: { enabled: boolean, type: number },
 *   [key: string]: unknown }} ThreeRenderer
 */
/**
 * Quality options forwarded to `createAdaptiveQualityController` (see quality3d.js).
 * @typedef {object} ThreeQuality3DOptions
 * @property {(state: { preset: object, tier?: string, [key: string]: unknown }, reason?: string) => void} [onChange] Called after the adapter applied a quality change.
 * @property {Record<string, unknown>} [device] Device hints (e.g. `rendererName`).
 * @property {boolean} [calibrateGpu] Fill `device.rendererName` from the WebGL context.
 * @property {boolean} [gpuTiming=true] Use asynchronous GPU timings in automatic quality mode when available.
 * @property {number | null} [memoryBudgetBytes=null] Soft budget for known render attachments and resident resources.
 * @property {{readBytes: () => number, trimIdle?: (excessBytes: number) => void}} [residency] Optional project residency report and synchronous idle-cache trim.
 * @property {string} [mode] Quality mode: 'auto' | 'low' | 'medium' | 'high' | 'ultra'.
 */
/**
 * Optional sky object bound to the adapter.
 * @typedef {{ setLinearOutput?(linear: boolean): void, linearOutput?: boolean, [key: string]: unknown }} ThreeSkyLike
 */
/**
 * Optional post-process volume stack.
 * @typedef {{ applyToPipeline(pipeline: object, position: object, base?: { exposure?: number }): unknown, [key: string]: unknown }} ThreePostVolumesLike
 */
/**
 * Material palette whose anisotropy follows the quality tier.
 * @typedef {{ setAnisotropy?(value: number): void, [key: string]: unknown }} ThreeMaterialPalette
 */
/**
 * @typedef {object} ThreeDirectionalLight
 * @property {{set(x: number, y: number, z: number): unknown}} position
 * @property {boolean} castShadow
 * @property {{mapSize: {x: number, set(x: number, y: number): unknown},
 *   camera: {updateProjectionMatrix?(): void}, bias: number}} shadow
 * @property {() => void} [dispose]
 */
/**
 * Default lighting for each world created by this adapter.
 * @typedef {object} ThreeWorldLighting
 * @property {{color?: number | string, near: number, far: number}} [fog]
 * @property {{sky: number | string, ground: number | string, intensity: number}} [hemisphere]
 * @property {{color: number | string, intensity: number, position: [number, number, number],
 *   shadow?: {extent: number, near: number, far: number, mapSize?: number, bias?: number, adaptiveExtent?: boolean, autoUpdate?: boolean}}} [sun] Set shadow.autoUpdate to false to cache static shadows.
 */
/**
 * @typedef {object} ThreeAdapterOptions
 * @property {ThreeNamespace} THREE Injected Three.js namespace (required).
 * @property {HTMLCanvasElement | object} canvas Target canvas (required).
 * @property {number} [width=960] Initial width in CSS px.
 * @property {number} [height=540] Initial height in CSS px.
 * @property {number} [pixelRatio=globalThis.devicePixelRatio||1] Requested device pixel ratio.
 * @property {number} [cameraFov=60] Vertical field of view, degrees.
 * @property {[number, number, number]} [cameraPosition] Starting camera position.
 * @property {[number, number, number]} [cameraTarget] Starting camera look-at target.
 * @property {number} [near=0.1] Camera near plane, world units.
 * @property {number} [far=1000] Camera far plane / cull distance, world units.
 * @property {boolean} [limitCameraDrawDistance=false] Limit the adapter camera far plane to the active render tier's draw distance.
 * @property {number | string} [background=0x101820] Scene background colour.
 * @property {ThreeWorldLighting | null} [worldLighting=null] Default fog and lights, allocated per scene.
 * @property {ThreeQuality3DOptions | null} [quality3d=null] Adaptive quality options.
 * @property {boolean | Record<string, unknown> | null} [post3d=null] Enable post pipeline (true or its options).
 * @property {boolean} [diagnostics3d=false] Collect frame and render-stage performance diagnostics.
 * @property {boolean | null} [shadows=null] Force shadows on/off; null follows the quality preset.
 * @property {string | null} [toneMapping=null] 'aces' | 'ueFilmic' | 'filmic' | 'agx' | 'neutral' | 'none'.
 * @property {number} [exposure=1] Base tone-mapping exposure.
 * @property {{ shadow?: { mapSize?: { x: number, set?(x: number, y: number): unknown }, [key: string]: unknown }, [key: string]: unknown } | null} [sunLight=null] Shadow-casting sun light.
 * @property {ThreeCamera | null} [viewCamera=null] Camera for the view-model overlay layer.
 * @property {ThreeSkyLike | null} [sky=null] Sky controller.
 * @property {ThreePostVolumesLike | null} [postVolumes=null] Post volume stack.
 */
/**
 * @typedef {object} ThreeSplitView
 * @property {ThreeCamera} camera View camera.
 * @property {number} x Normalised left (0..1).
 * @property {number} y Normalised top (0..1).
 * @property {number} width Normalised width (0..1).
 * @property {number} height Normalised height (0..1).
 */
/**
 * @typedef {object} ThreeRay
 * @property {{ x: number, y: number, z: number }} origin World-space ray origin.
 * @property {{ x: number, y: number, z: number }} direction Normalised world-space direction.
 */
/**
 * @typedef {object} ThreeScreenPoint
 * @property {number} x Screen x in CSS px.
 * @property {number} y Screen y in CSS px.
 * @property {number} ndcZ Normalised device depth.
 * @property {boolean} visible True when inside the view frustum.
 */
/**
 * @typedef {object} ThreeAdapter
 * @property {ThreeNamespace} THREE
 * @property {ThreeRenderer} renderer
 * @property {ThreeCamera} camera
 * @property {ReturnType<typeof createAdaptiveQualityController> | null} qualityController
 * @property {object | null} qualityPreset
 * @property {ReturnType<typeof createPostPipeline3D> | null} postPipeline
 * @property {ReturnType<typeof createSceneCuller3D>} culler3d
 * @property {boolean} contextLost
 * @property {() => import('./quality3d/render-diagnostics.js').RenderDiagnosticsSnapshot3D | null} getRenderDiagnostics Latest frame when diagnostics are enabled.
 * @property {(scene: object) => ThreeObject3D} getWorld
 * @property {(scene: object) => ThreeObject3D} getViewWorld
 * @property {(scene: object, object: object) => void} add
 * @property {(scene: object, object: object) => void} remove
 * @property {(scene: object, object: object) => void} addView
 * @property {(scene: object, object: object) => void} removeView
 * @property {(cam: ThreeCamera | null) => void} setViewCamera
 * @property {(light: object | null) => void} setSunLight
 * @property {(scene: object, data: import('./lighting3d/baked-probe-grid.js').BakedIrradianceProbeData | null) => ReturnType<typeof createBakedProbeGrid>} setIrradianceProbeGrid Install or clear the scene's baked diffuse lighting. Returns null when unsupported or cleared.
 * @property {(scene: object, options?: object) => ReturnType<typeof createDecalSystem3D>} createDecalSystem Create and attach a pooled 3D decal system owned by the scene.
 * @property {(scene: object) => ReturnType<typeof createCascadedShadowMap3D> | null} getCascadedShadowMap Return the cascaded shadow map controller for a scene if enabled.
 * @property {(id: string, batch: object) => void} registerIndirectBatch Register an indirect/instanced culling batch with the adapter.
 * @property {(id: string) => boolean} unregisterIndirectBatch Unregister an indirect culling batch.
 * @property {() => object} getGpuSubmitStats Inspect GPU indirect culling mode and submission counters.
 * @property {(scene: object, cam?: ThreeCamera | null) => Promise<object>} warmupShaders Asynchronously pre-compile all materials in a scene to avoid first-frame PSO stutter.
 * @property {(target: object, cam?: ThreeCamera | null) => number} enqueueShaderWarmup Enqueue an object/material subtree for incremental warmup.
 * @property {(budgetMs?: number) => object} stepShaderWarmup Compile queued shaders incrementally within `budgetMs`.
 * @property {() => object} getShaderWarmupStats Inspect shader warmup queue statistics.
 * @property {(scene?: object | null) => boolean} invalidateSunShadow Request a fresh sun shadow map for a scene or the active sun.
 * @property {(sun?: import('./sky3d.js').DirectionalLightLike | null, target?: import('./sky3d.js').SkyVec3Input, options?: import('./sky3d.js').ShadowFitOptions & { shadowDistance?: number, radius?: number }) => import('./sky3d.js').ShadowFrustum | null} fitShadowToPreset
 * @property {(nextSky: ThreeSkyLike | null | undefined) => void} setSky
 * @property {(nextExposure: number) => void} setExposure
 * @property {ThreePostVolumesLike | null} postVolumes
 * @property {(stack: ThreePostVolumesLike | null | undefined) => void} setPostVolumes
 * @property {(palette: ThreeMaterialPalette) => void} registerMaterialPalette
 * @property {(palette: ThreeMaterialPalette) => void} unregisterMaterialPalette
 * @property {(mode: string) => object} setQuality
 * @property {() => string | null} getQuality
 * @property {(views: object[] | null, options?: object) => ThreeSplitView[] | null} setViews
 * @property {() => ThreeSplitView[] | null} getViews
 * @property {(clientX: number, clientY: number, out?: object | null, viewIndex?: number | null) => ThreeRay} screenToRay
 * @property {(x: number, y: number, z: number, out?: object | null, viewIndex?: number) => ThreeScreenPoint} worldToScreen
 * @property {(scene: object, app?: object | null) => void} render
 * @property {() => void} resize
 * @property {(ms: number) => void} recordFrameInterval
 * @property {() => void} dispose
 */
/**
 * The Three.js namespace is injected; this module never imports Three itself.
 * @param {ThreeAdapterOptions} options
 * @returns {ThreeAdapter}
 */
export function createThreeAdapter({ THREE, canvas, width, height, pixelRatio, cameraFov, cameraPosition, cameraTarget, near, far, limitCameraDrawDistance, background, worldLighting, quality3d, post3d, diagnostics3d, shadows, toneMapping, exposure, sunLight, viewCamera, sky, postVolumes, gpuIndirect, }?: ThreeAdapterOptions): ThreeAdapter;
/**
 * @typedef {object} ThreeMeshComponentOptions
 * @property {'box' | 'sphere' | 'capsule' | 'cylinder' | 'plane'} [type='box'] Primitive shape.
 * @property {number} [color=0x67d9ba] Default material colour (0xRRGGBB).
 * @property {number} [size=1] Edge length, world units.
 * @property {number} [radius=size*0.5] Radius, world units.
 * @property {number} [height=size] Height, world units.
 * @property {ThreeDisposable | null} [geometry=null] Custom shared geometry (not disposed).
 * @property {ThreeDisposable | null} [material=null] Custom shared material (not disposed).
 * @property {boolean} [castShadow=false]
 * @property {boolean} [receiveShadow=false]
 * @property {boolean} [interpolate=false] Use render-alpha interpolated transforms.
 * @property {boolean} [cull=false] Enable adapter distance and occlusion culling for meshes that do not contribute to shadow maps.
 * @property {number} [cullRadius=0] Minimum culling sphere radius in world units (0 = geometry bounds).
 */
/**
 * Minimal renderer-owned 3D mesh component (not a physics body).
 * @param {ThreeNamespace} THREE Injected Three.js namespace.
 * @param {ThreeMeshComponentOptions} [options]
 * @returns {Component & { mesh: ThreeMesh, updateTransform(): void }} Component instance owning a `mesh`.
 */
export function createThreeMeshComponent(THREE: ThreeNamespace, { type, color, size, radius, height, geometry, material, castShadow, receiveShadow, interpolate, cull, cullRadius, }?: ThreeMeshComponentOptions | undefined): Component & {
    mesh: ThreeMesh;
    updateTransform(): void;
};
/**
 * Minimal structural Three.js Object3D (add/remove capable).
 */
export type ThreeObject3D = {
    add(object: object): unknown;
    remove(object: object): unknown;
    [key: string]: unknown;
};
/**
 * Injected Three.js namespace: only the constructors this module uses.
 */
export type ThreeNamespace = {
    Scene: new () => ThreeObject3D;
    PerspectiveCamera: new (fov: number, aspect: number, near: number, far: number) => ThreeCamera;
    WebGLRenderer: new (options: object) => ThreeRenderer;
    Mesh?: new (geometry: object, material: object) => ThreeMesh;
    BoxGeometry?: new (...args: number[]) => ThreeDisposable;
    MeshStandardMaterial?: new (options: object) => ThreeDisposable;
    Color?: new (value: number | string) => object;
    Fog?: new (color: number | string, near: number, far: number) => object;
    HemisphereLight?: new (sky: number | string, ground: number | string, intensity: number) => object;
    DirectionalLight?: new (color: number | string, intensity: number) => ThreeDirectionalLight;
    Vector3?: new (x?: number, y?: number, z?: number) => ThreeVector3;
    Matrix4?: new () => ThreeMatrix4;
    [key: string]: unknown;
};
export type ThreeDisposable = {
    dispose?(): void;
    [key: string]: unknown;
};
export type ThreeVector3 = {
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): ThreeVector3;
    copy(v: object): ThreeVector3;
    sub(v: object): ThreeVector3;
    normalize(): ThreeVector3;
    applyMatrix4(m: object): ThreeVector3;
    setFromMatrixPosition?(m: object): ThreeVector3;
};
export type ThreeMatrix4 = {
    fromArray(a: ArrayLike<number>): ThreeMatrix4;
    decompose(position: object, quaternion: object, scale: object): ThreeMatrix4;
};
/**
 * Minimal structural Three.js camera.
 */
export type ThreeCamera = {
    position: {
        x: number;
        y: number;
        z: number;
        set(x: number, y: number, z: number): unknown;
    };
    aspect?: number;
    far?: number;
    updateProjectionMatrix?(): void;
    updateMatrixWorld?(force?: boolean): void;
    lookAt?(x: number, y: number, z: number): void;
    matrixWorld?: object;
    matrixWorldInverse?: object;
    projectionMatrix?: object;
    projectionMatrixInverse?: object;
    [key: string]: unknown;
};
/**
 * Minimal structural Three.js mesh.
 */
export type ThreeMesh = {
    geometry?: ThreeDisposable;
    material?: ThreeDisposable | ThreeDisposable[];
    castShadow: boolean;
    receiveShadow: boolean;
    visible: boolean;
    position: {
        x: number;
        y: number;
        z: number;
        set(x: number, y: number, z: number): unknown;
    };
    rotation: {
        set(x: number, y: number, z: number): unknown;
    };
    scale: {
        set(x: number, y: number, z: number): unknown;
    };
    quaternion?: object;
    [key: string]: unknown;
};
/**
 * Minimal structural Three.js WebGLRenderer.
 */
export type ThreeRenderer = {
    render(scene: object, camera: object): void;
    setSize(w: number, h: number, updateStyle?: boolean): void;
    setPixelRatio(ratio: number): void;
    getContext?(): object | null;
    dispose(): void;
    autoClear: boolean;
    toneMapping: number;
    toneMappingExposure: number;
    shadowMap?: {
        enabled: boolean;
        type: number;
    };
    [key: string]: unknown;
};
/**
 * Quality options forwarded to `createAdaptiveQualityController` (see quality3d.js).
 */
export type ThreeQuality3DOptions = {
    /**
     * Called after the adapter applied a quality change.
     */
    onChange?: ((state: {
        preset: object;
        tier?: string;
        [key: string]: unknown;
    }, reason?: string) => void) | undefined;
    /**
     * Device hints (e.g. `rendererName`).
     */
    device?: Record<string, unknown> | undefined;
    /**
     * Fill `device.rendererName` from the WebGL context.
     */
    calibrateGpu?: boolean | undefined;
    /**
     * Use asynchronous GPU timings in automatic quality mode when available.
     */
    gpuTiming?: boolean | undefined;
    /**
     * Soft budget for known render attachments and resident resources.
     */
    memoryBudgetBytes?: number | null | undefined;
    /**
     * Optional project residency report and synchronous idle-cache trim.
     */
    residency?: {
        readBytes: () => number;
        trimIdle?: (excessBytes: number) => void;
    } | undefined;
    /**
     * Quality mode: 'auto' | 'low' | 'medium' | 'high' | 'ultra'.
     */
    mode?: string | undefined;
};
/**
 * Optional sky object bound to the adapter.
 */
export type ThreeSkyLike = {
    setLinearOutput?(linear: boolean): void;
    linearOutput?: boolean;
    [key: string]: unknown;
};
/**
 * Optional post-process volume stack.
 */
export type ThreePostVolumesLike = {
    applyToPipeline(pipeline: object, position: object, base?: {
        exposure?: number;
    }): unknown;
    [key: string]: unknown;
};
/**
 * Material palette whose anisotropy follows the quality tier.
 */
export type ThreeMaterialPalette = {
    setAnisotropy?(value: number): void;
    [key: string]: unknown;
};
export type ThreeDirectionalLight = {
    position: {
        set(x: number, y: number, z: number): unknown;
    };
    castShadow: boolean;
    shadow: {
        mapSize: {
            x: number;
            set(x: number, y: number): unknown;
        };
        camera: {
            updateProjectionMatrix?(): void;
        };
        bias: number;
    };
    dispose?: (() => void) | undefined;
};
/**
 * Default lighting for each world created by this adapter.
 */
export type ThreeWorldLighting = {
    fog?: {
        color?: number | string;
        near: number;
        far: number;
    } | undefined;
    hemisphere?: {
        sky: number | string;
        ground: number | string;
        intensity: number;
    } | undefined;
    /**
     * Set shadow.autoUpdate to false to cache static shadows.
     */
    sun?: {
        color: number | string;
        intensity: number;
        position: [number, number, number];
        shadow?: {
            extent: number;
            near: number;
            far: number;
            mapSize?: number;
            bias?: number;
            adaptiveExtent?: boolean;
            autoUpdate?: boolean;
        };
    } | undefined;
};
export type ThreeAdapterOptions = {
    /**
     * Injected Three.js namespace (required).
     */
    THREE: ThreeNamespace;
    /**
     * Target canvas (required).
     */
    canvas: HTMLCanvasElement | object;
    /**
     * Initial width in CSS px.
     */
    width?: number | undefined;
    /**
     * Initial height in CSS px.
     */
    height?: number | undefined;
    /**
     * Requested device pixel ratio.
     */
    pixelRatio?: number | undefined;
    /**
     * Vertical field of view, degrees.
     */
    cameraFov?: number | undefined;
    /**
     * Starting camera position.
     */
    cameraPosition?: [number, number, number] | undefined;
    /**
     * Starting camera look-at target.
     */
    cameraTarget?: [number, number, number] | undefined;
    /**
     * Camera near plane, world units.
     */
    near?: number | undefined;
    /**
     * Camera far plane / cull distance, world units.
     */
    far?: number | undefined;
    /**
     * Limit the adapter camera far plane to the active render tier's draw distance.
     */
    limitCameraDrawDistance?: boolean | undefined;
    /**
     * Scene background colour.
     */
    background?: string | number | undefined;
    /**
     * Default fog and lights, allocated per scene.
     */
    worldLighting?: ThreeWorldLighting | null | undefined;
    /**
     * Adaptive quality options.
     */
    quality3d?: ThreeQuality3DOptions | null | undefined;
    /**
     * Enable post pipeline (true or its options).
     */
    post3d?: boolean | Record<string, unknown> | null | undefined;
    /**
     * Collect frame and render-stage performance diagnostics.
     */
    diagnostics3d?: boolean | undefined;
    /**
     * Force shadows on/off; null follows the quality preset.
     */
    shadows?: boolean | null | undefined;
    /**
     * 'aces' | 'ueFilmic' | 'filmic' | 'agx' | 'neutral' | 'none'.
     */
    toneMapping?: string | null | undefined;
    /**
     * Base tone-mapping exposure.
     */
    exposure?: number | undefined;
    /**
     * Shadow-casting sun light.
     */
    sunLight?: {
        [key: string]: unknown;
        shadow?: {
            mapSize?: {
                x: number;
                set?(x: number, y: number): unknown;
            };
            [key: string]: unknown;
        };
    } | null | undefined;
    /**
     * Camera for the view-model overlay layer.
     */
    viewCamera?: ThreeCamera | null | undefined;
    /**
     * Sky controller.
     */
    sky?: ThreeSkyLike | null | undefined;
    /**
     * Post volume stack.
     */
    postVolumes?: ThreePostVolumesLike | null | undefined;
};
export type ThreeSplitView = {
    /**
     * View camera.
     */
    camera: ThreeCamera;
    /**
     * Normalised left (0..1).
     */
    x: number;
    /**
     * Normalised top (0..1).
     */
    y: number;
    /**
     * Normalised width (0..1).
     */
    width: number;
    /**
     * Normalised height (0..1).
     */
    height: number;
};
export type ThreeRay = {
    /**
     * World-space ray origin.
     */
    origin: {
        x: number;
        y: number;
        z: number;
    };
    /**
     * Normalised world-space direction.
     */
    direction: {
        x: number;
        y: number;
        z: number;
    };
};
export type ThreeScreenPoint = {
    /**
     * Screen x in CSS px.
     */
    x: number;
    /**
     * Screen y in CSS px.
     */
    y: number;
    /**
     * Normalised device depth.
     */
    ndcZ: number;
    /**
     * True when inside the view frustum.
     */
    visible: boolean;
};
export type ThreeAdapter = {
    THREE: ThreeNamespace;
    renderer: ThreeRenderer;
    camera: ThreeCamera;
    qualityController: ReturnType<typeof createAdaptiveQualityController> | null;
    qualityPreset: object | null;
    postPipeline: ReturnType<typeof createPostPipeline3D> | null;
    culler3d: ReturnType<typeof createSceneCuller3D>;
    contextLost: boolean;
    /**
     * Latest frame when diagnostics are enabled.
     */
    getRenderDiagnostics: () => import("./quality3d/render-diagnostics.js").RenderDiagnosticsSnapshot3D | null;
    getWorld: (scene: object) => ThreeObject3D;
    getViewWorld: (scene: object) => ThreeObject3D;
    add: (scene: object, object: object) => void;
    remove: (scene: object, object: object) => void;
    addView: (scene: object, object: object) => void;
    removeView: (scene: object, object: object) => void;
    setViewCamera: (cam: ThreeCamera | null) => void;
    setSunLight: (light: object | null) => void;
    /**
     * Install or clear the scene's baked diffuse lighting. Returns null when unsupported or cleared.
     */
    setIrradianceProbeGrid: (scene: object, data: import("./lighting3d/baked-probe-grid.js").BakedIrradianceProbeData | null) => ReturnType<typeof createBakedProbeGrid>;
    /**
     * Create and attach a pooled 3D decal system owned by the scene.
     */
    createDecalSystem: (scene: object, options?: object) => ReturnType<typeof createDecalSystem3D>;
    /**
     * Return the cascaded shadow map controller for a scene if enabled.
     */
    getCascadedShadowMap: (scene: object) => ReturnType<typeof createCascadedShadowMap3D> | null;
    /**
     * Register an indirect/instanced culling batch with the adapter.
     */
    registerIndirectBatch: (id: string, batch: object) => void;
    /**
     * Unregister an indirect culling batch.
     */
    unregisterIndirectBatch: (id: string) => boolean;
    /**
     * Inspect GPU indirect culling mode and submission counters.
     */
    getGpuSubmitStats: () => object;
    /**
     * Asynchronously pre-compile all materials in a scene to avoid first-frame PSO stutter.
     */
    warmupShaders: (scene: object, cam?: ThreeCamera | null) => Promise<object>;
    /**
     * Enqueue an object/material subtree for incremental warmup.
     */
    enqueueShaderWarmup: (target: object, cam?: ThreeCamera | null) => number;
    /**
     * Compile queued shaders incrementally within `budgetMs`.
     */
    stepShaderWarmup: (budgetMs?: number) => object;
    /**
     * Inspect shader warmup queue statistics.
     */
    getShaderWarmupStats: () => object;
    /**
     * Request a fresh sun shadow map for a scene or the active sun.
     */
    invalidateSunShadow: (scene?: object | null) => boolean;
    fitShadowToPreset: (sun?: import("./sky3d.js").DirectionalLightLike | null, target?: import("./sky3d.js").SkyVec3Input, options?: import("./sky3d.js").ShadowFitOptions & {
        shadowDistance?: number;
        radius?: number;
    }) => import("./sky3d.js").ShadowFrustum | null;
    setSky: (nextSky: ThreeSkyLike | null | undefined) => void;
    setExposure: (nextExposure: number) => void;
    postVolumes: ThreePostVolumesLike | null;
    setPostVolumes: (stack: ThreePostVolumesLike | null | undefined) => void;
    registerMaterialPalette: (palette: ThreeMaterialPalette) => void;
    unregisterMaterialPalette: (palette: ThreeMaterialPalette) => void;
    setQuality: (mode: string) => object;
    getQuality: () => string | null;
    setViews: (views: object[] | null, options?: object) => ThreeSplitView[] | null;
    getViews: () => ThreeSplitView[] | null;
    screenToRay: (clientX: number, clientY: number, out?: object | null, viewIndex?: number | null) => ThreeRay;
    worldToScreen: (x: number, y: number, z: number, out?: object | null, viewIndex?: number) => ThreeScreenPoint;
    render: (scene: object, app?: object | null) => void;
    resize: () => void;
    recordFrameInterval: (ms: number) => void;
    dispose: () => void;
};
export type ThreeMeshComponentOptions = {
    /**
     * Primitive shape.
     */
    type?: "capsule" | "plane" | "box" | "sphere" | "cylinder" | undefined;
    /**
     * Default material colour (0xRRGGBB).
     */
    color?: number | undefined;
    /**
     * Edge length, world units.
     */
    size?: number | undefined;
    /**
     * Radius, world units.
     */
    radius?: number | undefined;
    /**
     * Height, world units.
     */
    height?: number | undefined;
    /**
     * Custom shared geometry (not disposed).
     */
    geometry?: ThreeDisposable | null | undefined;
    /**
     * Custom shared material (not disposed).
     */
    material?: ThreeDisposable | null | undefined;
    castShadow?: boolean | undefined;
    receiveShadow?: boolean | undefined;
    /**
     * Use render-alpha interpolated transforms.
     */
    interpolate?: boolean | undefined;
    /**
     * Enable adapter distance and occlusion culling for meshes that do not contribute to shadow maps.
     */
    cull?: boolean | undefined;
    /**
     * Minimum culling sphere radius in world units (0 = geometry bounds).
     */
    cullRadius?: number | undefined;
};
import { Component } from '../core/component.js';
import { createAdaptiveQualityController } from './quality3d.js';
import { createPostPipeline3D } from './post3d.js';
import { createSceneCuller3D } from './culling3d.js';
import { createBakedProbeGrid } from './lighting3d/baked-probe-grid.js';
import { createDecalSystem3D } from './decal3d.js';
import { createCascadedShadowMap3D } from './shadow3d.js';
