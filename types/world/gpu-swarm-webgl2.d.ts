/**
 * Creates a WebGL2 `RGBA32F` Ping-Pong FBO GPU Swarm simulator (up to `262,144` units).
 * @param {GpuSwarmOptions} [options]
 * @returns {GpuSwarmWebGL2}
 */
export function createGpuSwarmWebGL2({ capacity, THREE, renderer, gl, speed, curlStrength, animFps, frameCount, originX, originY, worldWidth, worldHeight, }?: GpuSwarmOptions | undefined): GpuSwarmWebGL2;
/**
 * Minimal structural Three.js interface accepted by `createGpuSwarmWebGL2`.
 */
export type GpuSwarmThreeLike = {
    FloatType: number;
    HalfFloatType: number;
    RGBAFormat: number;
    UnsignedByteType: number;
    NearestFilter: number;
    LinearFilter: number;
    ClampToEdgeWrapping: number;
    GLSL3: number;
    Scene: new () => unknown;
    OrthographicCamera: new (l: number, r: number, t: number, b: number, n: number, f: number) => unknown;
    PlaneGeometry: new (w: number, h: number) => unknown;
    Mesh: new (g: unknown, m: unknown) => {
        frustumCulled: boolean;
    };
    RawShaderMaterial: new (opts: Record<string, unknown>) => {
        uniforms: Record<string, {
            value: unknown;
        }>;
        dispose?: () => void;
    };
    WebGLRenderTarget: new (w: number, h: number, opts: Record<string, unknown>) => {
        texture: unknown;
        dispose?: () => void;
    };
    DataTexture: new (data: ArrayBufferView, w: number, h: number, fmt: number, type: number) => {
        minFilter: number;
        magFilter: number;
        wrapS: number;
        wrapT: number;
        needsUpdate: boolean;
        generateMipmaps: boolean;
        flipY: boolean;
        dispose?: () => void;
    };
};
/**
 * Minimal Three.js renderer surface accepted by `createGpuSwarmWebGL2`.
 */
export type GpuSwarmRendererLike = {
    getRenderTarget: () => unknown;
    setRenderTarget: (target: unknown) => void;
    render: (scene: unknown, camera: unknown) => void;
    autoClear?: boolean | undefined;
    capabilities?: {
        isWebGL2?: boolean;
    } | undefined;
    getContext?: (() => WebGL2RenderingContext) | undefined;
};
export type GpuSwarmOptions = {
    /**
     * Max unit capacity (`1..262144`).
     */
    capacity?: number | undefined;
    /**
     * Optional Three.js module for Three.js WebGLRenderTarget mode.
     */
    THREE?: GpuSwarmThreeLike | null | undefined;
    /**
     * Optional Three.js WebGLRenderer.
     */
    renderer?: GpuSwarmRendererLike | null | undefined;
    /**
     * Optional raw WebGL2 context for 2D / custom pipelines.
     */
    gl?: WebGL2RenderingContext | null | undefined;
    /**
     * Default movement speed in world units/sec.
     */
    speed?: number | undefined;
    /**
     * Procedural spatial swirl separating overlapping streams.
     */
    curlStrength?: number | undefined;
    /**
     * Animation frame advance rate.
     */
    animFps?: number | undefined;
    /**
     * Cyclic VAT/sprite frame wrap count.
     */
    frameCount?: number | undefined;
    /**
     * Default FlowField origin X.
     */
    originX?: number | undefined;
    /**
     * Default FlowField origin Y/Z.
     */
    originY?: number | undefined;
    /**
     * Default FlowField span X.
     */
    worldWidth?: number | undefined;
    /**
     * Default FlowField span Y/Z.
     */
    worldHeight?: number | undefined;
};
export type GpuSwarmSpawnOptions = {
    x?: number | undefined;
    y?: number | undefined;
    rot?: number | undefined;
    frameOffset?: number | undefined;
};
export type GpuSwarmStepOptions = {
    heroX?: number | undefined;
    heroY?: number | undefined;
    speed?: number | undefined;
};
export type GpuSwarmStepResult = {
    count: number;
    gpuAccelerated: boolean;
    uploadedBytes: number;
};
export type GpuSwarmWebGL2 = {
    capacity: number;
    texWidth: number;
    texHeight: number;
    count: number;
    isGpuAccelerated: boolean;
    /**
     * Active `THREE.Texture` when running with Three.js (`null` otherwise).
     */
    texture: unknown;
    /**
     * Active `WebGLTexture` when running on raw WebGL2 (`null` otherwise).
     */
    glTexture: WebGLTexture | null;
    /**
     * Underlying CPU state/staging buffer (`4` floats per texel).
     */
    data: Float32Array;
    spawn: (opts?: GpuSwarmSpawnOptions) => number;
    spawnWave: (count: number, generator?: ((index: number) => GpuSwarmSpawnOptions) | null) => number;
    clear: () => void;
    updateFlowField: (flowField: {
        cols: number;
        rows: number;
        cellSize: number;
        originX: number;
        originY: number;
        rg8: Uint8Array;
        cost: Float32Array;
    }) => void;
    step: (dt: number, opts?: GpuSwarmStepOptions) => GpuSwarmStepResult;
    dispose: () => void;
};
