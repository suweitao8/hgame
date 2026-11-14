/**
 * Creates a WebGL2 `RGBA32F` Ping-Pong FBO GPU Swarm simulator (up to `262,144` units).
 * @param {GpuSwarmOptions} [options]
 * @returns {GpuSwarmWebGL2}
 */
export function createGpuSwarmWebGL2({ capacity, THREE, renderer, gl, speed, curlStrength, animFps, frameCount, originX, originY, worldWidth, worldHeight, }?: GpuSwarmOptions): GpuSwarmWebGL2;
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
    autoClear?: boolean;
    capabilities?: {
        isWebGL2?: boolean;
    };
    getContext?: () => WebGL2RenderingContext;
};
export type GpuSwarmOptions = {
    /**
     * Max unit capacity (`1..262144`).
     */
    capacity?: number;
    /**
     * Optional Three.js module for Three.js WebGLRenderTarget mode.
     */
    THREE?: GpuSwarmThreeLike | null;
    /**
     * Optional Three.js WebGLRenderer.
     */
    renderer?: GpuSwarmRendererLike | null;
    /**
     * Optional raw WebGL2 context for 2D / custom pipelines.
     */
    gl?: WebGL2RenderingContext | null;
    /**
     * Default movement speed in world units/sec.
     */
    speed?: number;
    /**
     * Procedural spatial swirl separating overlapping streams.
     */
    curlStrength?: number;
    /**
     * Animation frame advance rate.
     */
    animFps?: number;
    /**
     * Cyclic VAT/sprite frame wrap count.
     */
    frameCount?: number;
    /**
     * Default FlowField origin X.
     */
    originX?: number;
    /**
     * Default FlowField origin Y/Z.
     */
    originY?: number;
    /**
     * Default FlowField span X.
     */
    worldWidth?: number;
    /**
     * Default FlowField span Y/Z.
     */
    worldHeight?: number;
};
export type GpuSwarmSpawnOptions = {
    x?: number;
    y?: number;
    rot?: number;
    frameOffset?: number;
};
export type GpuSwarmStepOptions = {
    heroX?: number;
    heroY?: number;
    speed?: number;
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
