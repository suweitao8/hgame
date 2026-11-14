/** @typedef {import('./color.js').RGBTuple} RGBTuple */
/** @typedef {import('../quality3d.js').Quality3DPreset} Quality3DPreset */
/** @typedef {import('./capabilities.js').WebGLCapabilities} WebGLCapabilities */
/**
 * Constructor of a THREE class (opaque, structurally matches any THREE constructor).
 * @typedef {new (...args: never[]) => object} ThreeCtor
 */
/**
 * Minimal subset of the THREE namespace used by the post pipeline. Optional
 * members are feature-detected; if required ones are missing the pipeline
 * falls back to plain forward rendering.
 * @typedef {object} PostPipelineTHREE
 * @property {ThreeCtor} WebGLRenderTarget
 * @property {ThreeCtor} DepthTexture
 * @property {ThreeCtor} ShaderMaterial
 * @property {ThreeCtor} OrthographicCamera
 * @property {ThreeCtor} Scene
 * @property {ThreeCtor} Mesh
 * @property {ThreeCtor} BufferGeometry
 * @property {ThreeCtor} BufferAttribute
 * @property {ThreeCtor} Matrix4
 * @property {ThreeCtor} Vector2
 * @property {ThreeCtor} Vector3
 * @property {ThreeCtor} [Color]
 * @property {number} GLSL3 Shader language version constant.
 * @property {number} LinearFilter
 * @property {number} NearestFilter
 * @property {number} UnsignedByteType
 * @property {number} UnsignedIntType
 * @property {number} [HalfFloatType]
 */
/**
 * Structural subset of THREE.WebGLRenderer used by the pipeline.
 * @typedef {object} PostPipelineRenderer
 * @property {boolean} [autoClear] Restored after each render.
 * @property {number} [toneMapping] Restored after each render.
 * @property {{isWebGL2?: boolean, getMaxAnisotropy?(): number}} [capabilities]
 * @property {(target: object | null) => void} setRenderTarget
 * @property {(scene: object, camera: object) => void} render
 * @property {(color?: boolean, depth?: boolean, stencil?: boolean) => void} [clear]
 * @property {() => void} [clearDepth]
 * @property {() => ({[key: string]: unknown} | null | undefined)} [getContext]
 */
/** @typedef {'aces' | 'agx' | 'none' | 'ueFilmic' | 'filmic' | 0 | 1 | 2 | 3 | string} PostToneMappingMode Unknown values resolve to ACES (index 0). */
/**
 * Post pipeline settings shared by creation options and `setState` patches.
 * @typedef {object} PostPipelineSettings
 * @property {PostToneMappingMode} [toneMapping] Default `'aces'` at creation.
 * @property {number} [exposure=1] Exposure multiplier.
 * @property {number} [bloomStrength=0.28]
 * @property {number} [bloomThreshold=0.85]
 * @property {number} [bloomSoftKnee=0.5]
 * @property {number} [ssaoRadius=0.5] World units.
 * @property {number} [ssaoBias=0.025] World units.
 * @property {number} [ssaoIntensity=0.42]
 * @property {number} [volumetricIntensity=0.18]
 * @property {number} [giIntensity=0.55]
 * @property {number} [giRadius=2.4] World units.
 * @property {number} [ssrIntensity=0.35]
 * @property {number} [ssrMaxDist=28] World units.
 * @property {number} [ssrThickness=0.35] World units.
 * @property {number} [contactShadows] 0..1; default follows the quality preset (0.65 or 0).
 * @property {number} [contactShadowLength=0.32] World units.
 * @property {number} [contactShadowThickness=0.08] World units.
 * @property {boolean} [autoExposure=false] GPU eye adaptation (rebuilds targets when toggled).
 * @property {number} [minExposure=0.35]
 * @property {number} [maxExposure=2.6]
 * @property {number} [adaptSpeedUp=3.0] Adaptation rate (1/s) when exposure decreases.
 * @property {number} [adaptSpeedDown=1.4] Adaptation rate (1/s) when exposure increases.
 * @property {number} [keyValue=0.18]
 * @property {number} [exposureCompensation=1]
 * @property {number} [whiteTemp=6500] Kelvin.
 * @property {number} [whiteTint=0] -1..1.
 * @property {number} [contrast=1]
 * @property {RGBTuple} [colorLift=[0,0,0]]
 * @property {RGBTuple} [colorGamma=[1,1,1]]
 * @property {RGBTuple} [colorGain=[1,1,1]]
 * @property {number} [chromaticAberration=0]
 * @property {number} [filmGrain=0]
 * @property {number} [filmSlope=0.88]
 * @property {number} [filmToe=0.55]
 * @property {number} [filmShoulder=0.26]
 * @property {number} [filmBlackClip=0]
 * @property {number} [filmWhiteClip=0.04]
 * @property {number} [sharpness] Unsharp strength; default follows the preset (0.14).
 * @property {number} [vignette=0.18]
 * @property {number} [saturation=1.05]
 * @property {boolean} [fxaa] Default follows the preset (true).
 * @property {number} [damage=0] Damage overlay 0..1.
 * @property {number} [lowHealth=0] Low-health overlay 0..1.
 * @property {number} [focus=0] Focus effect 0..1.
 * @property {number} [flash=0] Flash overlay 0..1.
 * @property {number} [fade=0] Fade-to-black 0..1.
 * @property {number | string | {r: number, g: number, b: number}} [sunColor] Passed to `Color.set` (setState only).
 */
/**
 * Creation-only options of {@link createPostPipeline3D}.
 * @typedef {object} PostPipelineCreateBase
 * @property {PostPipelineTHREE} THREE Required THREE namespace subset.
 * @property {PostPipelineRenderer} renderer Required renderer.
 * @property {number} [width=960] Buffer width in px.
 * @property {number} [height=540] Buffer height in px.
 * @property {Partial<Quality3DPreset> | null} [preset] Quality preset (default: medium preset).
 */
/** @typedef {PostPipelineSettings & PostPipelineCreateBase} PostPipeline3DOptions */
/**
 * Snapshot of the pipeline state (copy).
 * @typedef {object} PostPipelineState
 * @property {number} toneMapping Resolved tone-mapping index (0 ACES, 1 AgX, 2 none, 3 UE filmic).
 * @property {number} exposure
 * @property {number} bloomStrength
 * @property {number} bloomThreshold
 * @property {number} bloomSoftKnee
 * @property {number} ssaoRadius
 * @property {number} ssaoBias
 * @property {number} ssaoIntensity
 * @property {number} volumetricIntensity
 * @property {number} giIntensity
 * @property {number} giRadius
 * @property {number} ssrIntensity
 * @property {number} ssrMaxDist
 * @property {number} ssrThickness
 * @property {number} contactShadows
 * @property {number} contactShadowLength
 * @property {number} contactShadowThickness
 * @property {boolean} autoExposure
 * @property {number} minExposure
 * @property {number} maxExposure
 * @property {number} adaptSpeedUp
 * @property {number} adaptSpeedDown
 * @property {number} keyValue
 * @property {number} exposureCompensation
 * @property {number} whiteTemp
 * @property {number} whiteTint
 * @property {number} contrast
 * @property {RGBTuple} colorLift
 * @property {RGBTuple} colorGamma
 * @property {RGBTuple} colorGain
 * @property {number} chromaticAberration
 * @property {number} filmGrain
 * @property {number} filmSlope
 * @property {number} filmToe
 * @property {number} filmShoulder
 * @property {number} filmBlackClip
 * @property {number} filmWhiteClip
 * @property {number} sharpness
 * @property {number} vignette
 * @property {number} saturation
 * @property {boolean} fxaa
 * @property {number} damage
 * @property {number} lowHealth
 * @property {number} focus
 * @property {number} flash
 * @property {number} fade
 * @property {object | null} sunColor THREE.Color instance (null without THREE.Color).
 * @property {object | null} whiteBalanceVec THREE.Vector3 of white-balance multipliers.
 * @property {object | null} liftVec THREE.Vector3 mirror of `colorLift`.
 * @property {object | null} gammaVec THREE.Vector3 mirror of `colorGamma`.
 * @property {object | null} gainVec THREE.Vector3 mirror of `colorGain`.
 */
/**
 * Internal render-target allocation info.
 * @typedef {object} PostPipelineTargets
 * @property {number} bufferWidth Full-resolution buffer width in px.
 * @property {number} bufferHeight Full-resolution buffer height in px.
 * @property {boolean} hasSceneRT
 * @property {boolean} hasHalfRT Half-res AO/volumetric targets allocated.
 * @property {boolean} hasGiSsrRT Half-res GI/SSR targets allocated.
 * @property {boolean} hasAutoExposureRT Eye-adaptation pyramid allocated.
 * @property {number} bloomMipCount
 * @property {boolean} hasLdrRT Intermediate LDR target for FXAA/sharpen.
 */
/**
 * Camera members read by `render`.
 * @typedef {object} PostPipelineCamera
 * @property {number} [near] Default 0.1.
 * @property {number} [far] Default 1000.
 * @property {object} projectionMatrix
 * @property {object} projectionMatrixInverse
 * @property {object} matrixWorld
 * @property {object} matrixWorldInverse
 * @property {(force?: boolean) => void} [updateMatrixWorld]
 */
/**
 * Directional (sun) light members read by `render`.
 * @typedef {object} PostPipelineSunLight
 * @property {{x: number, y: number, z: number}} position
 * @property {{position?: {x: number, y: number, z: number}}} [target]
 * @property {object} [color] THREE.Color copied into the sun color.
 * @property {{map?: ({texture?: object} | null), matrix?: object}} [shadow]
 */
/**
 * Per-frame render options.
 * @typedef {object} PostPipelineRenderOptions
 * @property {object | null} [viewScene=null] Optional viewmodel scene drawn with compressed depth range.
 * @property {object | null} [viewCamera=null] Camera for `viewScene`.
 * @property {PostPipelineSunLight | null} [sunLight=null] Sun used for volumetrics/contact shadows.
 * @property {number} [dt=0] Frame delta in seconds.
 */
/**
 * @typedef {object} PostPipeline3D
 * @property {boolean} supported Getter; true when the HDR pipeline is active (WebGL2 + required THREE classes).
 * @property {Readonly<WebGLCapabilities>} capabilities Getter; inspected GPU capabilities.
 * @property {Quality3DPreset} preset Getter; active (merged) quality preset.
 * @property {PostPipelineState} state Getter; shallow copy of the current state.
 * @property {PostPipelineTargets} targets Getter; target allocation info.
 * @property {(width: number, height: number) => void} resize Resizes buffers (px).
 * @property {(preset: Partial<Quality3DPreset>) => void} setPreset Applies a quality preset and rebuilds targets.
 * @property {(patch?: PostPipelineSettings) => void} setState Merges finite numeric/array settings.
 * @property {(world: object, camera: PostPipelineCamera, options?: PostPipelineRenderOptions) => void} render Renders `world` through the pipeline (forward fallback when unsupported).
 * @property {() => void} handleContextLost Releases GPU targets.
 * @property {() => void} handleContextRestored Rebuilds GPU targets.
 * @property {() => boolean} dispose Releases resources; false if already disposed.
 */
/**
 * Maps a tone-mapping name/index to the shader index.
 * @param {PostToneMappingMode} mode
 * @returns {0 | 1 | 2 | 3} 0 ACES (default), 1 AgX, 2 none, 3 UE filmic.
 */
export function resolveToneMappingIndex(mode: PostToneMappingMode): 0 | 1 | 2 | 3;
/**
 * Creates a clean-room WebGL2 HDR post-processing composer with automatic
 * fallback to forward rendering on non-WebGL2 or mock renderers.
 * @param {PostPipeline3DOptions} options
 * @returns {PostPipeline3D}
 */
export function createPostPipeline3D(options?: PostPipeline3DOptions): PostPipeline3D;
export type RGBTuple = import("./color.js").RGBTuple;
export type Quality3DPreset = import("../quality3d.js").Quality3DPreset;
export type WebGLCapabilities = import("./capabilities.js").WebGLCapabilities;
/**
 * Constructor of a THREE class (opaque, structurally matches any THREE constructor).
 */
export type ThreeCtor = new (...args: never[]) => object;
/**
 * Minimal subset of the THREE namespace used by the post pipeline. Optional
 * members are feature-detected; if required ones are missing the pipeline
 * falls back to plain forward rendering.
 */
export type PostPipelineTHREE = {
    WebGLRenderTarget: ThreeCtor;
    DepthTexture: ThreeCtor;
    ShaderMaterial: ThreeCtor;
    OrthographicCamera: ThreeCtor;
    Scene: ThreeCtor;
    Mesh: ThreeCtor;
    BufferGeometry: ThreeCtor;
    BufferAttribute: ThreeCtor;
    Matrix4: ThreeCtor;
    Vector2: ThreeCtor;
    Vector3: ThreeCtor;
    Color?: ThreeCtor;
    /**
     * Shader language version constant.
     */
    GLSL3: number;
    LinearFilter: number;
    NearestFilter: number;
    UnsignedByteType: number;
    UnsignedIntType: number;
    HalfFloatType?: number;
};
/**
 * Structural subset of THREE.WebGLRenderer used by the pipeline.
 */
export type PostPipelineRenderer = {
    /**
     * Restored after each render.
     */
    autoClear?: boolean;
    /**
     * Restored after each render.
     */
    toneMapping?: number;
    capabilities?: {
        isWebGL2?: boolean;
        getMaxAnisotropy?(): number;
    };
    setRenderTarget: (target: object | null) => void;
    render: (scene: object, camera: object) => void;
    clear?: (color?: boolean, depth?: boolean, stencil?: boolean) => void;
    clearDepth?: () => void;
    getContext?: () => ({
        [key: string]: unknown;
    } | null | undefined);
};
/**
 * Unknown values resolve to ACES (index 0).
 */
export type PostToneMappingMode = "aces" | "agx" | "none" | "ueFilmic" | "filmic" | 0 | 1 | 2 | 3 | string;
/**
 * Post pipeline settings shared by creation options and `setState` patches.
 */
export type PostPipelineSettings = {
    /**
     * Default `'aces'` at creation.
     */
    toneMapping?: PostToneMappingMode;
    /**
     * Exposure multiplier.
     */
    exposure?: number;
    bloomStrength?: number;
    bloomThreshold?: number;
    bloomSoftKnee?: number;
    /**
     * World units.
     */
    ssaoRadius?: number;
    /**
     * World units.
     */
    ssaoBias?: number;
    ssaoIntensity?: number;
    volumetricIntensity?: number;
    giIntensity?: number;
    /**
     * World units.
     */
    giRadius?: number;
    ssrIntensity?: number;
    /**
     * World units.
     */
    ssrMaxDist?: number;
    /**
     * World units.
     */
    ssrThickness?: number;
    /**
     * 0..1; default follows the quality preset (0.65 or 0).
     */
    contactShadows?: number;
    /**
     * World units.
     */
    contactShadowLength?: number;
    /**
     * World units.
     */
    contactShadowThickness?: number;
    /**
     * GPU eye adaptation (rebuilds targets when toggled).
     */
    autoExposure?: boolean;
    minExposure?: number;
    maxExposure?: number;
    /**
     * Adaptation rate (1/s) when exposure decreases.
     */
    adaptSpeedUp?: number;
    /**
     * Adaptation rate (1/s) when exposure increases.
     */
    adaptSpeedDown?: number;
    keyValue?: number;
    exposureCompensation?: number;
    /**
     * Kelvin.
     */
    whiteTemp?: number;
    /**
     * -1..1.
     */
    whiteTint?: number;
    contrast?: number;
    colorLift?: RGBTuple;
    colorGamma?: RGBTuple;
    colorGain?: RGBTuple;
    chromaticAberration?: number;
    filmGrain?: number;
    filmSlope?: number;
    filmToe?: number;
    filmShoulder?: number;
    filmBlackClip?: number;
    filmWhiteClip?: number;
    /**
     * Unsharp strength; default follows the preset (0.14).
     */
    sharpness?: number;
    vignette?: number;
    saturation?: number;
    /**
     * Default follows the preset (true).
     */
    fxaa?: boolean;
    /**
     * Damage overlay 0..1.
     */
    damage?: number;
    /**
     * Low-health overlay 0..1.
     */
    lowHealth?: number;
    /**
     * Focus effect 0..1.
     */
    focus?: number;
    /**
     * Flash overlay 0..1.
     */
    flash?: number;
    /**
     * Fade-to-black 0..1.
     */
    fade?: number;
    /**
     * Passed to `Color.set` (setState only).
     */
    sunColor?: number | string | {
        r: number;
        g: number;
        b: number;
    };
};
/**
 * Creation-only options of {@link createPostPipeline3D}.
 */
export type PostPipelineCreateBase = {
    /**
     * Required THREE namespace subset.
     */
    THREE: PostPipelineTHREE;
    /**
     * Required renderer.
     */
    renderer: PostPipelineRenderer;
    /**
     * Buffer width in px.
     */
    width?: number;
    /**
     * Buffer height in px.
     */
    height?: number;
    /**
     * Quality preset (default: medium preset).
     */
    preset?: Partial<Quality3DPreset> | null;
};
export type PostPipeline3DOptions = PostPipelineSettings & PostPipelineCreateBase;
/**
 * Snapshot of the pipeline state (copy).
 */
export type PostPipelineState = {
    /**
     * Resolved tone-mapping index (0 ACES, 1 AgX, 2 none, 3 UE filmic).
     */
    toneMapping: number;
    exposure: number;
    bloomStrength: number;
    bloomThreshold: number;
    bloomSoftKnee: number;
    ssaoRadius: number;
    ssaoBias: number;
    ssaoIntensity: number;
    volumetricIntensity: number;
    giIntensity: number;
    giRadius: number;
    ssrIntensity: number;
    ssrMaxDist: number;
    ssrThickness: number;
    contactShadows: number;
    contactShadowLength: number;
    contactShadowThickness: number;
    autoExposure: boolean;
    minExposure: number;
    maxExposure: number;
    adaptSpeedUp: number;
    adaptSpeedDown: number;
    keyValue: number;
    exposureCompensation: number;
    whiteTemp: number;
    whiteTint: number;
    contrast: number;
    colorLift: RGBTuple;
    colorGamma: RGBTuple;
    colorGain: RGBTuple;
    chromaticAberration: number;
    filmGrain: number;
    filmSlope: number;
    filmToe: number;
    filmShoulder: number;
    filmBlackClip: number;
    filmWhiteClip: number;
    sharpness: number;
    vignette: number;
    saturation: number;
    fxaa: boolean;
    damage: number;
    lowHealth: number;
    focus: number;
    flash: number;
    fade: number;
    /**
     * THREE.Color instance (null without THREE.Color).
     */
    sunColor: object | null;
    /**
     * THREE.Vector3 of white-balance multipliers.
     */
    whiteBalanceVec: object | null;
    /**
     * THREE.Vector3 mirror of `colorLift`.
     */
    liftVec: object | null;
    /**
     * THREE.Vector3 mirror of `colorGamma`.
     */
    gammaVec: object | null;
    /**
     * THREE.Vector3 mirror of `colorGain`.
     */
    gainVec: object | null;
};
/**
 * Internal render-target allocation info.
 */
export type PostPipelineTargets = {
    /**
     * Full-resolution buffer width in px.
     */
    bufferWidth: number;
    /**
     * Full-resolution buffer height in px.
     */
    bufferHeight: number;
    hasSceneRT: boolean;
    /**
     * Half-res AO/volumetric targets allocated.
     */
    hasHalfRT: boolean;
    /**
     * Half-res GI/SSR targets allocated.
     */
    hasGiSsrRT: boolean;
    /**
     * Eye-adaptation pyramid allocated.
     */
    hasAutoExposureRT: boolean;
    bloomMipCount: number;
    /**
     * Intermediate LDR target for FXAA/sharpen.
     */
    hasLdrRT: boolean;
};
/**
 * Camera members read by `render`.
 */
export type PostPipelineCamera = {
    /**
     * Default 0.1.
     */
    near?: number;
    /**
     * Default 1000.
     */
    far?: number;
    projectionMatrix: object;
    projectionMatrixInverse: object;
    matrixWorld: object;
    matrixWorldInverse: object;
    updateMatrixWorld?: (force?: boolean) => void;
};
/**
 * Directional (sun) light members read by `render`.
 */
export type PostPipelineSunLight = {
    position: {
        x: number;
        y: number;
        z: number;
    };
    target?: {
        position?: {
            x: number;
            y: number;
            z: number;
        };
    };
    /**
     * THREE.Color copied into the sun color.
     */
    color?: object;
    shadow?: {
        map?: ({
            texture?: object;
        } | null);
        matrix?: object;
    };
};
/**
 * Per-frame render options.
 */
export type PostPipelineRenderOptions = {
    /**
     * Optional viewmodel scene drawn with compressed depth range.
     */
    viewScene?: object | null;
    /**
     * Camera for `viewScene`.
     */
    viewCamera?: object | null;
    /**
     * Sun used for volumetrics/contact shadows.
     */
    sunLight?: PostPipelineSunLight | null;
    /**
     * Frame delta in seconds.
     */
    dt?: number;
};
export type PostPipeline3D = {
    /**
     * Getter; true when the HDR pipeline is active (WebGL2 + required THREE classes).
     */
    supported: boolean;
    /**
     * Getter; inspected GPU capabilities.
     */
    capabilities: Readonly<WebGLCapabilities>;
    /**
     * Getter; active (merged) quality preset.
     */
    preset: Quality3DPreset;
    /**
     * Getter; shallow copy of the current state.
     */
    state: PostPipelineState;
    /**
     * Getter; target allocation info.
     */
    targets: PostPipelineTargets;
    /**
     * Resizes buffers (px).
     */
    resize: (width: number, height: number) => void;
    /**
     * Applies a quality preset and rebuilds targets.
     */
    setPreset: (preset: Partial<Quality3DPreset>) => void;
    /**
     * Merges finite numeric/array settings.
     */
    setState: (patch?: PostPipelineSettings) => void;
    /**
     * Renders `world` through the pipeline (forward fallback when unsupported).
     */
    render: (world: object, camera: PostPipelineCamera, options?: PostPipelineRenderOptions) => void;
    /**
     * Releases GPU targets.
     */
    handleContextLost: () => void;
    /**
     * Rebuilds GPU targets.
     */
    handleContextRestored: () => void;
    /**
     * Releases resources; false if already disposed.
     */
    dispose: () => boolean;
};
