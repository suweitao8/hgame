/**
 * Creates an atmospheric procedural sky dome + matching PMREM environment baker.
 * @param {SkyThree} THREE
 * @param {Sky3DOptions} [options]
 * @returns {Sky3D}
 */
export function createProceduralSky3D(THREE: SkyThree, options?: Sky3DOptions): Sky3D;
/**
 * Fits a DirectionalLight's orthographic shadow frustum tightly around scene
 * or receiver bounds and optionally snaps to shadow-map texels to avoid shimmer.
 * @param {Pick<SkyThree, 'Vector3'>} THREE
 * @param {DirectionalLightLike} light
 * @param {ShadowFitBounds} bounds
 * @param {ShadowFitOptions} [options]
 * @returns {ShadowFrustum} The applied orthographic bounds.
 */
export function fitDirectionalShadowFrustum(THREE: Pick<SkyThree, "Vector3">, light: DirectionalLightLike, bounds: ShadowFitBounds, { sunDirection, distance, padding, snapToTexels, bias, normalBias, }?: ShadowFitOptions): ShadowFrustum;
/**
 * Fixed pool of transient PointLights kept mounted at zero intensity to avoid
 * runtime Three.js shader recompilations when explosions or muzzle flashes fire.
 * @param {LightPoolThree} THREE
 * @param {{ add(object: object): unknown, remove?(object: object): unknown }} parent Scene or Group.
 * @param {LightPoolOptions} [options]
 * @returns {LightPool3D}
 */
export function createLightPool3D(THREE: LightPoolThree, parent: {
    add(object: object): unknown;
    remove?(object: object): unknown;
}, { size, defaultDecay }?: LightPoolOptions): LightPool3D;
/**
 * Clean-room procedural atmospheric sky dome, PMREM environment IBL baker,
 * tight directional shadow frustum fitter, and pooled transient point lights.
 *
 * The Three.js namespace is injected by callers so non-3D projects load nothing.
 */
/** @typedef {[number, number, number]} SkyVec3Tuple Direction/point [x, y, z]. */
/** @typedef {SkyVec3Tuple|{ x: number, y: number, z: number }} SkyVec3Input */
/** @typedef {string|number|{ readonly isColor: boolean }} SkyColorInput CSS color string, 0xRRGGBB number, or a THREE.Color. */
/** @typedef {'day'|'goldenHour'|'overcast'|'dusk'|'night'} Sky3DPresetName */
/**
 * @typedef {object} Sky3DPreset
 * @property {string} zenithColor
 * @property {string} horizonColor
 * @property {string} groundColor
 * @property {string} sunColor
 * @property {readonly number[]} sunDirection Normalised on use.
 * @property {number} sunIntensity
 * @property {number} cloudCoverage 0..1.
 * @property {number} cloudDensity 0..1.
 * @property {number} cloudSpeed Cloud drift in shader units per second.
 * @property {number} mieG Mie asymmetry, -1..1.
 * @property {number} mieStrength
 * @property {number} exposure
 */
/**
 * @typedef {object} Sky3DOptions
 * @property {Sky3DPresetName} [preset='day'] Base preset; explicit fields override it.
 * @property {SkyColorInput} [zenithColor]
 * @property {SkyColorInput} [horizonColor]
 * @property {SkyColorInput} [groundColor]
 * @property {SkyColorInput} [sunColor]
 * @property {SkyVec3Input} [sunDirection] Direction towards the sun; normalised.
 * @property {number} [sunIntensity=1]
 * @property {number} [cloudCoverage=0.42]
 * @property {number} [cloudDensity=0.55]
 * @property {number} [cloudSpeed=0.014]
 * @property {number} [mieG=0.78]
 * @property {number} [mieStrength=0.28]
 * @property {number} [exposure=1]
 * @property {number} [time=0] Initial shader time in seconds.
 * @property {number} [radius=450] Dome radius in world units (>10).
 * @property {boolean} [linearOutput=false] Output linear colour and disable tone mapping.
 */
/** @typedef {Partial<Sky3DPreset>&Partial<Sky3DOptions>} Sky3DPatch Runtime-updatable subset of {@link Sky3DOptions}. */
/**
 * @typedef {object} SkyMeshLike
 * @property {string} name
 * @property {boolean} frustumCulled
 * @property {number} renderOrder
 * @property {{ x: number, y: number, z: number, set(x: number, y: number, z: number): unknown }} position
 * @property {{ remove(object: object): unknown }|null} parent
 */
/**
 * @typedef {object} SkyMaterialLike
 * @property {string} name
 * @property {boolean} toneMapped
 * @property {() => void} dispose
 */
/**
 * @typedef {object} SkyThree The subset of the THREE namespace used by the sky dome.
 * @property {new (radius: number, widthSegments: number, heightSegments: number) => { dispose(): void }} SphereGeometry
 * @property {new (parameters: object) => SkyMaterialLike} ShaderMaterial
 * @property {new (geometry: object, material: object) => SkyMeshLike} Mesh
 * @property {new (x?: number, y?: number, z?: number) => { x: number, y: number, z: number, set(x: number, y: number, z: number): unknown }} Vector3
 * @property {number} [BackSide]
 * @property {new (value?: unknown) => object} [Color]
 * @property {new (renderer: object) => { fromScene(scene: object, sigma: number, near: number, far: number): { texture: object, dispose(): void }, dispose(): void }} [PMREMGenerator]
 * @property {new () => { add(object: object): unknown }} [Scene]
 */
/**
 * @typedef {object} Sky3DBakeOptions
 * @property {{ environment: unknown }|null} [targetScene=null] Receives `environment` when given.
 * @property {number} [near=0.5]
 * @property {number} [far=1000]
 */
/**
 * @typedef {object} Sky3D
 * @property {SkyMeshLike} mesh Sky dome; add it to the scene.
 * @property {SkyMaterialLike} material
 * @property {Record<string, { value: unknown }>} uniforms Shader uniforms.
 * @property {SkyVec3Tuple} sunDirection Normalised sun direction (getter).
 * @property {object|null} environmentTexture Last baked PMREM texture (getter).
 * @property {boolean} linearOutput (getter).
 * @property {(patch?: Sky3DPatch) => void} setOptions
 * @property {(enabled: boolean) => void} setLinearOutput
 * @property {(name: Sky3DPresetName, overrides?: Sky3DPatch) => void} setPreset Throws on unknown preset.
 * @property {(dt?: number, cameraPosition?: { x?: number, y?: number, z?: number }|null) => void} update dt in seconds; follows the camera when given.
 * @property {(renderer: { getContext?(): object|null }, options?: Sky3DBakeOptions) => (object|null)} bakeEnvironment
 * @property {() => boolean} dispose
 */
/**
 * @typedef {object} DirectionalLightLike
 * @property {{ x: number, y: number, z: number, set?(x: number, y: number, z: number): unknown }} [position]
 * @property {{ position: { x: number, y: number, z: number, set?(x: number, y: number, z: number): unknown }, updateMatrixWorld?(force?: boolean): void }} [target]
 * @property {{ camera: { left: number, right: number, top: number, bottom: number, near: number, far: number, updateProjectionMatrix?(): void }, mapSize?: { x: number, y: number }, bias: number, normalBias?: number }} shadow
 */
/**
 * @typedef {object} ShadowFitBounds Either {min,max} or {center,radius}.
 * @property {SkyVec3Tuple} [min]
 * @property {SkyVec3Tuple} [max]
 * @property {SkyVec3Tuple} [center]
 * @property {number} [radius]
 */
/**
 * @typedef {object} ShadowFitOptions
 * @property {SkyVec3Input|null} [sunDirection=null] Defaults to light.position - light.target.position.
 * @property {number} [distance=40] Light distance from bounds centre, world units.
 * @property {number} [padding=2] World units added on each side.
 * @property {boolean} [snapToTexels=true] Snap to shadow-map texels to avoid shimmer.
 * @property {number|null} [bias=-0.0003]
 * @property {number|null} [normalBias=0.02]
 */
/**
 * @typedef {object} ShadowFrustum
 * @property {number} left
 * @property {number} right
 * @property {number} bottom
 * @property {number} top
 * @property {number} near
 * @property {number} far
 */
/**
 * @typedef {object} PooledLightLike
 * @property {{ set?(x: number, y: number, z: number): unknown }} [position]
 * @property {{ set?(color: unknown): unknown }} [color]
 * @property {number} distance
 * @property {number} intensity
 * @property {boolean} castShadow
 * @property {boolean} visible
 * @property {() => void} [dispose]
 */
/**
 * @typedef {object} LightPoolThree
 * @property {new (color: number, intensity: number, distance: number, decay: number) => PooledLightLike} PointLight
 */
/**
 * @typedef {object} LightPoolOptions
 * @property {number} [size=6] Pool size, integer 1..32.
 * @property {number} [defaultDecay=2] PointLight decay.
 */
/**
 * @typedef {object} LightFlashOptions
 * @property {number} [x=0] World units.
 * @property {number} [y=0]
 * @property {number} [z=0]
 * @property {SkyColorInput} [color=0xffb35c]
 * @property {number} [intensity=5] Must be > 0.
 * @property {number} [distance=8] World units.
 * @property {number} [duration=0.08] Seconds; must be > 0.
 */
/**
 * @typedef {object} LightPool3D
 * @property {number} size (getter)
 * @property {number} activeCount Lights currently flashing (getter).
 * @property {(options?: LightFlashOptions) => (PooledLightLike|null)} flash Steals the most-faded slot when full; null if disposed/invalid.
 * @property {(dt: number) => number} update dt in seconds; returns active count.
 * @property {() => void} clear
 * @property {() => boolean} dispose
 */
/** @type {Readonly<Record<Sky3DPresetName, Readonly<Sky3DPreset>>>} */
export const SKY3D_PRESETS: Readonly<Record<Sky3DPresetName, Readonly<Sky3DPreset>>>;
/**
 * Direction/point [x, y, z].
 */
export type SkyVec3Tuple = [number, number, number];
export type SkyVec3Input = SkyVec3Tuple | {
    x: number;
    y: number;
    z: number;
};
/**
 * CSS color string, 0xRRGGBB number, or a THREE.Color.
 */
export type SkyColorInput = string | number | {
    readonly isColor: boolean;
};
export type Sky3DPresetName = "day" | "goldenHour" | "overcast" | "dusk" | "night";
export type Sky3DPreset = {
    zenithColor: string;
    horizonColor: string;
    groundColor: string;
    sunColor: string;
    /**
     * Normalised on use.
     */
    sunDirection: readonly number[];
    sunIntensity: number;
    /**
     * 0..1.
     */
    cloudCoverage: number;
    /**
     * 0..1.
     */
    cloudDensity: number;
    /**
     * Cloud drift in shader units per second.
     */
    cloudSpeed: number;
    /**
     * Mie asymmetry, -1..1.
     */
    mieG: number;
    mieStrength: number;
    exposure: number;
};
export type Sky3DOptions = {
    /**
     * Base preset; explicit fields override it.
     */
    preset?: Sky3DPresetName;
    zenithColor?: SkyColorInput;
    horizonColor?: SkyColorInput;
    groundColor?: SkyColorInput;
    sunColor?: SkyColorInput;
    /**
     * Direction towards the sun; normalised.
     */
    sunDirection?: SkyVec3Input;
    sunIntensity?: number;
    cloudCoverage?: number;
    cloudDensity?: number;
    cloudSpeed?: number;
    mieG?: number;
    mieStrength?: number;
    exposure?: number;
    /**
     * Initial shader time in seconds.
     */
    time?: number;
    /**
     * Dome radius in world units (>10).
     */
    radius?: number;
    /**
     * Output linear colour and disable tone mapping.
     */
    linearOutput?: boolean;
};
/**
 * Runtime-updatable subset of {@link Sky3DOptions}.
 */
export type Sky3DPatch = Partial<Sky3DPreset> & Partial<Sky3DOptions>;
export type SkyMeshLike = {
    name: string;
    frustumCulled: boolean;
    renderOrder: number;
    position: {
        x: number;
        y: number;
        z: number;
        set(x: number, y: number, z: number): unknown;
    };
    parent: {
        remove(object: object): unknown;
    } | null;
};
export type SkyMaterialLike = {
    name: string;
    toneMapped: boolean;
    dispose: () => void;
};
/**
 * The subset of the THREE namespace used by the sky dome.
 */
export type SkyThree = {
    SphereGeometry: new (radius: number, widthSegments: number, heightSegments: number) => {
        dispose(): void;
    };
    ShaderMaterial: new (parameters: object) => SkyMaterialLike;
    Mesh: new (geometry: object, material: object) => SkyMeshLike;
    Vector3: new (x?: number, y?: number, z?: number) => {
        x: number;
        y: number;
        z: number;
        set(x: number, y: number, z: number): unknown;
    };
    BackSide?: number;
    Color?: new (value?: unknown) => object;
    PMREMGenerator?: new (renderer: object) => {
        fromScene(scene: object, sigma: number, near: number, far: number): {
            texture: object;
            dispose(): void;
        };
        dispose(): void;
    };
    Scene?: new () => {
        add(object: object): unknown;
    };
};
export type Sky3DBakeOptions = {
    /**
     * Receives `environment` when given.
     */
    targetScene?: {
        environment: unknown;
    } | null;
    near?: number;
    far?: number;
};
export type Sky3D = {
    /**
     * Sky dome; add it to the scene.
     */
    mesh: SkyMeshLike;
    material: SkyMaterialLike;
    /**
     * Shader uniforms.
     */
    uniforms: Record<string, {
        value: unknown;
    }>;
    /**
     * Normalised sun direction (getter).
     */
    sunDirection: SkyVec3Tuple;
    /**
     * Last baked PMREM texture (getter).
     */
    environmentTexture: object | null;
    /**
     * (getter).
     */
    linearOutput: boolean;
    setOptions: (patch?: Sky3DPatch) => void;
    setLinearOutput: (enabled: boolean) => void;
    /**
     * Throws on unknown preset.
     */
    setPreset: (name: Sky3DPresetName, overrides?: Sky3DPatch) => void;
    /**
     * dt in seconds; follows the camera when given.
     */
    update: (dt?: number, cameraPosition?: {
        x?: number;
        y?: number;
        z?: number;
    } | null) => void;
    bakeEnvironment: (renderer: {
        getContext?(): object | null;
    }, options?: Sky3DBakeOptions) => (object | null);
    dispose: () => boolean;
};
export type DirectionalLightLike = {
    position?: {
        x: number;
        y: number;
        z: number;
        set?(x: number, y: number, z: number): unknown;
    };
    target?: {
        position: {
            x: number;
            y: number;
            z: number;
            set?(x: number, y: number, z: number): unknown;
        };
        updateMatrixWorld?(force?: boolean): void;
    };
    shadow: {
        camera: {
            left: number;
            right: number;
            top: number;
            bottom: number;
            near: number;
            far: number;
            updateProjectionMatrix?(): void;
        };
        mapSize?: {
            x: number;
            y: number;
        };
        bias: number;
        normalBias?: number;
    };
};
/**
 * Either {min,max} or {center,radius}.
 */
export type ShadowFitBounds = {
    min?: SkyVec3Tuple;
    max?: SkyVec3Tuple;
    center?: SkyVec3Tuple;
    radius?: number;
};
export type ShadowFitOptions = {
    /**
     * Defaults to light.position - light.target.position.
     */
    sunDirection?: SkyVec3Input | null;
    /**
     * Light distance from bounds centre, world units.
     */
    distance?: number;
    /**
     * World units added on each side.
     */
    padding?: number;
    /**
     * Snap to shadow-map texels to avoid shimmer.
     */
    snapToTexels?: boolean;
    bias?: number | null;
    normalBias?: number | null;
};
export type ShadowFrustum = {
    left: number;
    right: number;
    bottom: number;
    top: number;
    near: number;
    far: number;
};
export type PooledLightLike = {
    position?: {
        set?(x: number, y: number, z: number): unknown;
    };
    color?: {
        set?(color: unknown): unknown;
    };
    distance: number;
    intensity: number;
    castShadow: boolean;
    visible: boolean;
    dispose?: () => void;
};
export type LightPoolThree = {
    PointLight: new (color: number, intensity: number, distance: number, decay: number) => PooledLightLike;
};
export type LightPoolOptions = {
    /**
     * Pool size, integer 1..32.
     */
    size?: number;
    /**
     * PointLight decay.
     */
    defaultDecay?: number;
};
export type LightFlashOptions = {
    /**
     * World units.
     */
    x?: number;
    y?: number;
    z?: number;
    color?: SkyColorInput;
    /**
     * Must be > 0.
     */
    intensity?: number;
    /**
     * World units.
     */
    distance?: number;
    /**
     * Seconds; must be > 0.
     */
    duration?: number;
};
export type LightPool3D = {
    /**
     * (getter)
     */
    size: number;
    /**
     * Lights currently flashing (getter).
     */
    activeCount: number;
    /**
     * Steals the most-faded slot when full; null if disposed/invalid.
     */
    flash: (options?: LightFlashOptions) => (PooledLightLike | null);
    /**
     * dt in seconds; returns active count.
     */
    update: (dt: number) => number;
    clear: () => void;
    dispose: () => boolean;
};
