/** @typedef {import('../core/entity.js').Entity} Entity */
/** @typedef {import('../core/scene.js').Scene} Scene */
/** @typedef {import('../animation/spritesheet.js').SpriteSheet} SpriteSheet */
/** @typedef {import('./quality3d.js').QualityPresetTier} QualityPresetTier */
/** @typedef {import('./quality3d.js').Quality2DPreset} Quality2DPreset */
/** @typedef {import('./draw-order-2d.js').BlendMode2D} BlendMode2D */
/** @typedef {import('./draw-order-2d.js').ClipRect2D} ClipRect2D */
/**
 * Axis-aligned world-space rectangle.
 * @typedef {object} ViewBounds2D
 * @property {number} minX Left edge (world units).
 * @property {number} minY Top edge (world units).
 * @property {number} maxX Right edge (world units).
 * @property {number} maxY Bottom edge (world units).
 */
/**
 * Optional camera clamp. Any omitted or non-finite edge is unbounded.
 * @typedef {object} Camera2DBounds
 * @property {number} [minX] Minimum camera X (world units).
 * @property {number} [minY] Minimum camera Y (world units).
 * @property {number} [maxX] Maximum camera X (world units).
 * @property {number} [maxY] Maximum camera Y (world units).
 */
/**
 * @typedef {object} Camera2DOptions
 * @property {number} [x=0] Camera centre X in world units (finite).
 * @property {number} [y=0] Camera centre Y in world units (finite).
 * @property {number} [zoom=1] Scale factor, > 0 (2 = twice as large on screen).
 * @property {number} [rotation=0] Camera rotation in radians.
 * @property {Camera2DBounds | null} [bounds=null] Clamp region for the camera centre (world units).
 */
/**
 * Anything Camera2D#follow can track: a point, or an object exposing worldPosition() such as an Entity.
 * @typedef {{ x: number, y: number } | { worldPosition(): { x: number, y: number } }} Camera2DFollowTarget
 */
/**
 * @typedef {object} Camera2DFollowOptions
 * @property {number} [lerp=1] Follow factor per call in [0, 1] (1 = snap, smaller = smoother).
 * @property {number} [offsetX=0] Target offset X (world units).
 * @property {number} [offsetY=0] Target offset Y (world units).
 * @property {number} [deadzoneX=0] Half-width of the no-move zone around the camera (world units).
 * @property {number} [deadzoneY=0] Half-height of the no-move zone around the camera (world units).
 */
/**
 * Parses CSS hex (#rgb, #rgba, #rrggbb, #rrggbbaa) or rgb()/rgba() into 0..1 floats.
 * Unparseable input yields opaque white [1, 1, 1, 1].
 * @param {unknown} color CSS colour string.
 * @param {number[] | null} [out=null] Array to write [r, g, b, a] into; a new array when null.
 * @returns {number[]} The [r, g, b, a] array (0..1).
 */
export function parseColorRgba(color: unknown, out?: number[] | null | undefined): number[];
/** @typedef {HTMLCanvasElement | OffscreenCanvas} BufferCanvas2D */
/**
 * Split-screen view descriptor. x/y/width/height are fractions (0..1) of the logical canvas.
 * @typedef {object} Canvas2DView
 * @property {number} x Left edge fraction.
 * @property {number} y Top edge fraction.
 * @property {number} width Width fraction.
 * @property {number} height Height fraction.
 * @property {Camera2D} camera Camera rendering into this view.
 */
/**
 * @typedef {object} SplitViewOptions
 * @property {string} [dividerColor='rgba(255,255,255,0.22)'] CSS colour of the divider lines.
 * @property {number} [dividerWidth=2] Divider width in logical pixels (>= 0).
 */
/**
 * @typedef {object} Canvas2DAdapterOptions
 * @property {HTMLCanvasElement} canvas Target canvas (required).
 * @property {number} [width=960] Logical design width in world pixels.
 * @property {number} [height=540] Logical design height in world pixels.
 * @property {string} [background='#101820'] Clear colour.
 * @property {number} [pixelRatio=globalThis.devicePixelRatio || 1] Device pixel ratio, clamped by the quality preset (max 3).
 * @property {boolean} [imageSmoothing=true] Smooth scaled images (overridden by the quality preset).
 * @property {boolean} [diagnostics2d=false] Collect comparable per-frame and per-stage diagnostics.
 * @property {boolean} [interpolate=false] Always render interpolated transforms (entities with interpolate=true always do).
 * @property {boolean} [cull=true] Skip sprites outside the camera view.
 * @property {QualityPresetTier | null} [quality=null] Quality tier ('low' | 'medium' | 'high' | 'ultra'); null disables presets.
 * @property {((width: number, height: number) => BufferCanvas2D | null) | null} [createBufferCanvas=null] Factory for offscreen buffers (tint/shadow caches).
 * @property {object} [budgetOptions] Optional options passed to `createRenderBudgetController`.
 */
/**
 * @typedef {object} Renderer2DStats
 * @property {number} drawnSprites Sprites (and crowd instances) drawn last frame.
 * @property {number} drawnCrowds Crowd batches drawn last frame.
 * @property {number} culled Items skipped by culling last frame.
 * @property {boolean} sorted Whether a sort pass ran last frame.
 * @property {string} backend 'canvas2d' or 'webgl2'.
 */
/**
 * Letterboxed viewport mapping logical coordinates to the canvas.
 * @typedef {object} Viewport2D
 * @property {number} vw Canvas CSS width (px).
 * @property {number} vh Canvas CSS height (px).
 * @property {number} dpr Effective device pixel ratio.
 * @property {number} scale Uniform logical-to-CSS scale.
 * @property {number} x Letterbox X offset (CSS px).
 * @property {number} y Letterbox Y offset (CSS px).
 */
/**
 * Renderer-neutral 2D adapter shared by Canvas2D and WebGL2D backends.
 * @typedef {object} Renderer2DAdapter
 * @property {Camera2D} camera Default camera (used when no split views are set).
 * @property {(scene: Scene, app?: { renderAlpha?: number } | null) => void} render Draw the scene; app.renderAlpha drives interpolation.
 * @property {() => void} resize Re-measure the canvas and update the viewport.
 * @property {(views: Canvas2DView[] | null, options?: SplitViewOptions) => Canvas2DView[] | null} setViews Set split-screen views (null/empty restores single camera); returns copies.
 * @property {() => Canvas2DView[] | null} getViews Copies of the active views, or null.
 * @property {(clientX: number, clientY: number, viewIndex?: number | null) => { x: number, y: number }} screenToWorld Convert client coordinates to world coordinates.
 * @property {(worldX: number, worldY: number, viewIndex?: number) => { x: number, y: number }} worldToScreen Convert world coordinates to client coordinates.
 * @property {(tier: QualityPresetTier | null | undefined) => Quality2DPreset | null} setQuality Switch quality tier (null clears); returns the active preset.
 * @property {() => QualityPresetTier | null} getQuality Active quality tier.
 * @property {Quality2DPreset | null} qualityPreset Active preset (getter).
 * @property {Renderer2DStats} stats Copy of last-frame statistics (getter).
 * @property {() => import('./render-diagnostics-2d.js').RenderDiagnosticsSnapshot2D | null} getRenderDiagnostics Latest opt-in render frame.
 * @property {() => object | null} [getRenderFrameStats] Frame timing percentiles (`p50Ms`, `p95Ms`, `p99Ms`) when diagnostics are enabled.
 * @property {() => { traceEvents: object[], displayTimeUnit: string }} [exportRenderChromeTrace] Export Chrome Trace JSON events.
 * @property {() => ReturnType<import('./render-budget-2d.js').createRenderBudgetController> extends { getBudgetSnapshot: () => infer S } ? S : unknown} getRenderBudget Current 2D resource budget snapshot.
 * @property {(type?: import('./render-budget-2d.js').RenderResourceType2D | null, reason?: import('./render-budget-2d.js').RenderEvictionReason2D) => number} reclaimRenderResources Reclaim idle targets/caches by type or all.
 * @property {() => Viewport2D} getViewport Copy of the current viewport.
 * @property {(color?: string | number, intensity?: number) => void} setAmbientLight Configure global 2D ambient darkness/tint.
 * @property {(light: { x: number, y: number, radius?: number, color?: string | number, intensity?: number }) => boolean} addLight2D Append a dynamic 2D point light.
 * @property {(lights: Array<{ x: number, y: number, radius?: number, color?: string | number, intensity?: number }>) => number} setLights2D Replace active 2D point lights.
 * @property {() => void} clearLights2D Remove all 2D point lights.
 * @property {(segment: { x1: number, y1: number, x2: number, y2: number }) => boolean} addOccluder2D Append a 2D shadow occluder segment.
 * @property {(segments: Array<{ x1: number, y1: number, x2: number, y2: number }>) => number} setOccluders2D Replace active 2D shadow occluder segments.
 * @property {(points: Array<[number, number] | { x: number, y: number }>, options?: { closed?: boolean }) => number} addPolygonOccluder2D Decompose a polygon into 2D shadow occluder segments.
 * @property {(polygons: Array<Array<[number, number] | { x: number, y: number }> | { points: Array<[number, number] | { x: number, y: number }>, closed?: boolean }>, options?: { closed?: boolean }) => number} setPolygonOccluders2D Replace active polygon occluders.
 * @property {() => void} clearOccluders2D Remove all 2D shadow occluder segments.
 * @property {(opts?: { normalMap?: unknown, strength?: number }) => void} setNormalLighting2D Configure 2D normal-map lighting state.
 * @property {() => import('./post2d.js').QUALITY2D_LIGHTING_PRESETS['high']} getQualityPolicy2D Read the active 2D lighting/post quality retention policy.
 * @property {(cfg: { bloomIntensity?: number, bloomThreshold?: number, vignette?: number, hitPulse?: number, chromatic?: number, saturation?: number, contrast?: number }) => void} setPost2D Configure 2D bloom/vignette/grading effects.
 * @property {() => { ambient: { r: number, g: number, b: number, intensity: number }, lightCount: number, post: object }} getLighting2DState Inspect current 2D lighting & post state.
 * @property {() => void} dispose Release buffers and caches.
 */
/**
 * @typedef {Renderer2DAdapter & { ctx: CanvasRenderingContext2D }} Canvas2DAdapter
 */
/**
 * Optional Canvas renderer; not imported by a 3D or UI-only game.
 * @param {Canvas2DAdapterOptions} options
 * @returns {Canvas2DAdapter}
 */
export function createCanvas2DAdapter({ canvas, width, height, background, pixelRatio, imageSmoothing, interpolate, cull, quality, createBufferCanvas, diagnostics2d, budgetOptions, }?: Canvas2DAdapterOptions): Canvas2DAdapter;
/** 2D camera supporting smooth follow, deadzones, bounds clamping, zoom, rotation and shake. */
export class Camera2D {
    /** @param {Camera2DOptions} [options] */
    constructor({ x, y, zoom, rotation, bounds }?: Camera2DOptions | undefined);
    /** Centre X (world units). @type {number} */
    x: number;
    /** Centre Y (world units). @type {number} */
    y: number;
    /** @type {number} */
    _zoom: number;
    /** @param {number} value Zoom factor (> 0). */
    set zoom(value: number);
    /** Zoom factor (> 0). @returns {number} */
    get zoom(): number;
    /** Rotation in radians. @type {number} */
    rotation: number;
    /** Clamp region for the centre, or null. @type {Camera2DBounds | null} */
    bounds: Camera2DBounds | null;
    /** @type {number} */
    _shakeIntensity: number;
    _shakeDuration: number;
    _shakeTime: number;
    _shakePhase: number;
    _offsetX: number;
    _offsetY: number;
    /** Current shake offset X (world units). @returns {number} */
    get offsetX(): number;
    /** Current shake offset Y (world units). @returns {number} */
    get offsetY(): number;
    _clampToBounds(): void;
    /**
     * Move toward a target point or entity.
     * @param {Camera2DFollowTarget | null | undefined} target
     * @param {Camera2DFollowOptions} [options]
     * @returns {this}
     */
    follow(target: Camera2DFollowTarget | null | undefined, { lerp, offsetX, offsetY, deadzoneX, deadzoneY }?: Camera2DFollowOptions | undefined): this;
    /**
     * Start a decaying screen shake.
     * @param {number} intensity Peak offset in world units (>= 0).
     * @param {number} [duration=0.25] Duration in seconds (>= 0).
     * @returns {this}
     */
    shake(intensity: number, duration?: number | undefined): this;
    /**
     * Advance shake and re-clamp to bounds.
     * @param {number} dt Delta time in seconds (>= 0).
     * @returns {this}
     */
    update(dt: number): this;
    /**
     * World-space rectangle visible through a viewport (accounts for zoom, rotation and shake).
     * @param {number} viewportWidth Viewport width in logical pixels.
     * @param {number} viewportHeight Viewport height in logical pixels.
     * @returns {ViewBounds2D}
     */
    getViewBounds(viewportWidth: number, viewportHeight: number): ViewBounds2D;
}
/**
 * Ground-shadow tuning for Sprite2D / SpriteCrowd2D. Ratios are relative to the sprite size.
 * @typedef {object} GroundShadowOptions
 * @property {number} [widthRatio=0.72] Shadow width / sprite width.
 * @property {number} [heightRatio=0.18] Shadow height / sprite height.
 * @property {number} [alpha=0.45] Maximum opacity in [0, 1].
 * @property {number} [tuckRatio=0.032] Upward shift of the shadow centre / sprite height.
 * @property {boolean} [jumpScale=true] Shrink and fade the shadow while the sprite is lifted (negative offsetY).
 * @property {string} [color='#000000'] Shadow CSS colour.
 * @property {number} [offsetX=0] Extra shadow X offset (local units).
 * @property {number} [offsetY=0] Extra shadow Y offset (local units).
 */
/**
 * Source rectangle inside an image, in pixels.
 * @typedef {object} SpriteSourceRect
 * @property {number} x Left (px).
 * @property {number} y Top (px).
 * @property {number} width Width (px).
 * @property {number} height Height (px).
 */
/**
 * Animation source exposing the current sheet frame (e.g. an AnimationPlayer).
 * @typedef {object} SpriteFrameSource
 * @property {number} frame Current frame index into the sprite sheet.
 */
/**
 * Custom draw hook. The context is already transformed (entity matrix, offset, rotation, scale).
 * @callback Sprite2DCustomDraw
 * @param {CanvasRenderingContext2D} ctx
 * @param {Entity} entity Owning entity.
 * @param {Sprite2D} sprite The sprite being drawn.
 * @returns {void}
 */
/**
 * @typedef {object} Sprite2DOptions
 * @property {'rect' | 'circle' | 'text'} [shape='rect'] Procedural shape used when no image/sheet/customDraw is set (circle uses width as diameter).
 * @property {number} [width=32] Width in local units (world pixels).
 * @property {number} [height=32] Height in local units (world pixels).
 * @property {string} [color='#80e2c2'] Fill colour for procedural shapes and text.
 * @property {string} [text=''] Text for shape 'text'.
 * @property {string} [font='20px sans-serif'] CSS font for shape 'text'.
 * @property {number} [z=0] Draw order within a layer (higher draws on top).
 * @property {number} [layer=0] Draw layer (higher layers draw on top of lower ones).
 * @property {boolean} [ySort=false] Sort by world Y within a layer/z (for top-down depth).
 * @property {BlendMode2D} [blendMode='normal'] Draw compositing mode.
 * @property {ClipRect2D | null} [clipRect=null] Clip to a viewport-relative rectangle.
 * @property {boolean} [visible=true] Hide without removing the component.
 * @property {number} [opacity=1] Alpha in [0, 1].
 * @property {boolean} [flipX=false] Mirror horizontally.
 * @property {boolean} [flipY=false] Mirror vertically.
 * @property {CanvasImageSource | null} [image=null] Image to draw (takes priority over sheet.image).
 * @property {SpriteSheet | null} [sheet=null] Sprite sheet providing frame rectangles (and the image when image is null).
 * @property {number} [frame=0] Sheet frame index (ignored while an animation is set).
 * @property {SpriteSourceRect | null} [sourceRect=null] Explicit source rectangle in pixels (overrides sheet frames).
 * @property {SpriteFrameSource | null} [animation=null] Animation whose .frame selects the sheet frame.
 * @property {Sprite2DCustomDraw | null} [customDraw=null] Replaces the built-in drawing.
 * @property {number | null} [anchorX=null] Horizontal anchor 0..1; null falls back to entity.anchorX, then 0.5.
 * @property {number | null} [anchorY=null] Vertical anchor 0..1; null falls back to entity.anchorY, then 0.5.
 * @property {number} [offsetX=0] Visual X offset in local units (does not move the entity; ground shadow stays put).
 * @property {number} [offsetY=0] Visual Y offset in local units (negative = lifted, e.g. jump bounce).
 * @property {number} [scaleX=1] Visual X scale.
 * @property {number} [scaleY=1] Visual Y scale.
 * @property {number} [rotation=0] Visual rotation in radians.
 * @property {string | null} [tint=null] CSS colour overlay (images get a 55% silhouette overlay; shapes use it as fill).
 * @property {number} [flash=0] Hit-flash intensity in [0, 1]; normally driven by Sprite2D#hitFlash.
 * @property {string} [flashColor='#ffffff'] Hit-flash colour.
 * @property {boolean | GroundShadowOptions} [groundShadow=false] Draw an elliptical ground shadow (true = defaults).
 * @property {unknown | null} [normalMap=null] Optional tangent-space 2D normal texture for lit sprites.
 * @property {number} [normalStrength=1] Normal-map modulation strength in [0, 2].
 * @property {number} [roughness=0.8] Surface roughness hint in [0, 1].
 */
/** Renderable 2D visual component drawn by the Canvas2D / WebGL2D adapters. */
export class Sprite2D extends Component {
    /** @param {Sprite2DOptions} [options] */
    constructor({ shape, width, height, color, text, font, z, layer, ySort, blendMode, clipRect, visible, opacity, flipX, flipY, image, sheet, frame, sourceRect, animation, customDraw, anchorX, anchorY, offsetX, offsetY, scaleX, scaleY, rotation, tint, flash, flashColor, groundShadow, normalMap, normalStrength, roughness, }?: Sprite2DOptions | undefined);
    shape: "text" | "rect" | "circle";
    width: number;
    height: number;
    color: string;
    text: string;
    font: string;
    z: number;
    layer: number;
    ySort: boolean;
    /** @param {BlendMode2D} mode */
    set blendMode(mode: import("./draw-order-2d.js").BlendMode2D);
    /** @returns {BlendMode2D} */
    get blendMode(): import("./draw-order-2d.js").BlendMode2D;
    /** @param {ClipRect2D | null} rect */
    set clipRect(rect: import("./draw-order-2d.js").ClipRect2D | null);
    /** @returns {Readonly<ClipRect2D> | null} */
    get clipRect(): Readonly<import("./draw-order-2d.js").ClipRect2D> | null;
    visible: boolean;
    opacity: number;
    flipX: boolean;
    flipY: boolean;
    image: CanvasImageSource | null;
    sheet: import("../index.js").SpriteSheet | null;
    frame: number;
    sourceRect: SpriteSourceRect | null;
    animation: SpriteFrameSource | null;
    customDraw: Sprite2DCustomDraw | null;
    anchorX: number | null;
    anchorY: number | null;
    offsetX: number;
    offsetY: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    tint: string | null;
    flash: number;
    flashColor: string;
    groundShadow: boolean | GroundShadowOptions;
    normalMap: unknown;
    normalStrength: number;
    roughness: number;
    _flashDuration: number;
    _flashRemaining: number;
    /** @param {number} value Rotation in radians. */
    set visualRotation(value: number);
    /** Alias of rotation (radians). @returns {number} */
    get visualRotation(): number;
    _blendMode: import("./draw-order-2d.js").BlendMode2D | undefined;
    _clipRect: Readonly<import("./draw-order-2d.js").ClipRect2D> | null | undefined;
    /**
     * Flash the sprite with a colour that fades out over duration.
     * @param {number} [duration=0.08] Seconds (>= 0); 0 clears the flash.
     * @param {string} [color='#ffffff'] CSS flash colour.
     * @returns {this}
     */
    hitFlash(duration?: number | undefined, color?: string | undefined): this;
    /**
     * Advance the hit-flash fade.
     * @param {number} dt Delta time in seconds.
     * @returns {void}
     */
    update(dt: number): void;
}
/**
 * @typedef {object} SpriteCrowdBindSwarmOptions
 * @property {boolean} [syncRotation=false] Rotate each instance toward its swarm heading.
 * @property {boolean} [flipByDirection=true] Flip horizontally when heading left (`sin(rot) < 0`).
 * @property {number} [frameCount=1] Cyclic animation frame count (`> 1` advances by `animTime * animFps`).
 * @property {number} [animFps=8] Animation frames per second when `frameCount > 1`.
 * @property {number} [worldScale=1] Multiplier from swarm simulation coordinates to crowd local coordinates.
 */
/**
 * @typedef {object} SpriteCrowd2DOptions
 * @property {number} [capacity=4096] Maximum simultaneous instances (integer 1..262144).
 * @property {'rect' | 'circle'} [shape='rect'] Procedural shape when no image/sheet is set.
 * @property {number} [width=32] Instance width in local units.
 * @property {number} [height=32] Instance height in local units.
 * @property {string} [color='#80e2c2'] Fill colour for procedural shapes.
 * @property {CanvasImageSource | null} [image=null] Shared image (takes priority over sheet.image).
 * @property {SpriteSheet | null} [sheet=null] Shared sprite sheet; each instance picks a frame.
 * @property {SpriteSourceRect | null} [sourceRect=null] Explicit source rectangle in pixels shared by all instances.
 * @property {number} [anchorX=0.5] Horizontal anchor 0..1.
 * @property {number} [anchorY=0.5] Vertical anchor 0..1.
 * @property {number} [layer=0] Draw layer.
 * @property {number} [z=0] Draw order within a layer.
 * @property {boolean} [ySort=false] Sort every instance individually by world Y (slower; enables per-agent depth).
 * @property {BlendMode2D} [blendMode='normal'] Draw compositing mode for the crowd.
 * @property {ClipRect2D | null} [clipRect=null] Clip to a viewport-relative rectangle.
 * @property {boolean} [visible=true] Hide the whole crowd.
 * @property {boolean | GroundShadowOptions} [groundShadow=false] Ground shadow for every instance.
 * @property {string} [flashColor='#ffffff'] Hit-flash colour.
 */
/**
 * Per-instance initial values for SpriteCrowd2D#spawn.
 * @typedef {object} SpriteCrowdSpawnOptions
 * @property {number} [x=0] Local X (relative to the owning entity, world units).
 * @property {number} [y=0] Local Y (relative to the owning entity, world units).
 * @property {number} [offsetX=0] Visual X offset.
 * @property {number} [offsetY=0] Visual Y offset (negative = lifted).
 * @property {number} [rotation=0] Rotation in radians.
 * @property {number} [scaleX=1] X scale.
 * @property {number} [scaleY=1] Y scale.
 * @property {number} [opacity=1] Alpha in [0, 1].
 * @property {number} [frame=0] Sheet frame index (0..65535).
 * @property {boolean} [flipX=false] Mirror horizontally.
 * @property {string | null} [tint=null] CSS colour tint (rgb used as fill for procedural shapes).
 */
/**
 * High-density Struct-of-Arrays (SoA) 2D sprite batch component for survivor hordes,
 * projectiles, and pickups (10,000+ instances without per-entity JS allocation overhead).
 * Instances are addressed by the integer index returned from spawn(); the per-instance
 * typed arrays (x, y, rotation, ...) may be written directly for maximum throughput.
 */
export class SpriteCrowd2D extends Component {
    /** @param {SpriteCrowd2DOptions} [options] */
    constructor({ capacity, shape, width, height, color, image, sheet, sourceRect, anchorX, anchorY, layer, z, ySort, blendMode, clipRect, visible, groundShadow, flashColor, }?: SpriteCrowd2DOptions | undefined);
    capacity: number;
    shape: "rect" | "circle";
    width: number;
    height: number;
    color: string;
    image: CanvasImageSource | null;
    sheet: import("../index.js").SpriteSheet | null;
    sourceRect: SpriteSourceRect | null;
    anchorX: number;
    anchorY: number;
    layer: number;
    z: number;
    ySort: boolean;
    /** @param {BlendMode2D} mode */
    set blendMode(mode: import("./draw-order-2d.js").BlendMode2D);
    /** @returns {BlendMode2D} */
    get blendMode(): import("./draw-order-2d.js").BlendMode2D;
    /** @param {ClipRect2D | null} rect */
    set clipRect(rect: import("./draw-order-2d.js").ClipRect2D | null);
    /** @returns {Readonly<ClipRect2D> | null} */
    get clipRect(): Readonly<import("./draw-order-2d.js").ClipRect2D> | null;
    visible: boolean;
    groundShadow: boolean | GroundShadowOptions;
    flashColor: string;
    /** 1 when the slot is in use. @type {Uint8Array} */
    active: Uint8Array;
    /** Local X per instance. @type {Float32Array} */
    x: Float32Array;
    y: Float32Array;
    offsetX: Float32Array;
    offsetY: Float32Array;
    rotation: Float32Array;
    scaleX: Float32Array;
    scaleY: Float32Array;
    opacity: Float32Array;
    flash: Float32Array;
    flashRate: Float32Array;
    frame: Uint16Array;
    flipX: Uint8Array;
    tintR: Float32Array;
    tintG: Float32Array;
    tintB: Float32Array;
    hasTint: Uint8Array;
    statusCode: Uint8Array;
    _freeStack: Int32Array;
    _freeTop: number;
    _activeIndices: Int32Array;
    _indexInActive: Int32Array;
    _activeCount: number;
    _flashingCount: number;
    _boundSwarm: import("../world/swarm-ecs.js").SwarmSimulation | null;
    _boundSwarmOpts: {
        syncRotation: boolean;
        flipByDirection: boolean;
        frameCount: number;
        animFps: number;
        worldScale: number;
    } | null;
    _boundGpuSwarm: import("../world/gpu-swarm-webgl2.js").GpuSwarmWebGL2 | null;
    _boundGpuSwarmOpts: {
        syncRotation: boolean;
        flipByDirection: boolean;
        frameCount: number;
        animFps: number;
        worldScale: number;
    } | null;
    _blendMode: import("./draw-order-2d.js").BlendMode2D | undefined;
    _clipRect: Readonly<import("./draw-order-2d.js").ClipRect2D> | null | undefined;
    /** Number of live instances. @returns {number} */
    get count(): number;
    /**
     * Bind a CPU `SwarmSimulation` directly to this crowd for zero-copy chunk rendering.
     * @param {import('../world/swarm-ecs.js').SwarmSimulation} swarm
     * @param {SpriteCrowdBindSwarmOptions} [options]
     * @returns {this}
     */
    bindSwarm(swarm: import("../world/swarm-ecs.js").SwarmSimulation, { syncRotation, flipByDirection, frameCount, animFps, worldScale, }?: SpriteCrowdBindSwarmOptions | undefined): this;
    /**
     * Bind a WebGL2 `GpuSwarmWebGL2` state texture directly for zero-CPU-upload `texelFetch` rendering.
     * @param {import('../world/gpu-swarm-webgl2.js').GpuSwarmWebGL2} gpuSwarm
     * @param {SpriteCrowdBindSwarmOptions} [options]
     * @returns {this}
     */
    bindGpuSwarm(gpuSwarm: import("../world/gpu-swarm-webgl2.js").GpuSwarmWebGL2, { syncRotation, flipByDirection, frameCount, animFps, worldScale, }?: SpriteCrowdBindSwarmOptions | undefined): this;
    /** Detach any zero-copy swarm binding. @returns {void} */
    unbindSwarm(): void;
    /**
     * Allocate an instance.
     * @param {SpriteCrowdSpawnOptions} [options]
     * @returns {number} Instance index, or -1 when the crowd is full.
     */
    spawn({ x, y, offsetX, offsetY, rotation, scaleX, scaleY, opacity, frame, flipX, tint, }?: SpriteCrowdSpawnOptions | undefined): number;
    /**
     * Update an instance transform.
     * @param {number} index Instance index from spawn().
     * @param {number} x Local X.
     * @param {number} y Local Y.
     * @param {number} [rotation=0] Radians.
     * @param {number} [scaleX=1]
     * @param {number} [scaleY=1]
     * @returns {boolean} false when the index is invalid or inactive.
     */
    setTransform(index: number, x: number, y: number, rotation?: number | undefined, scaleX?: number | undefined, scaleY?: number | undefined): boolean;
    /**
     * Flash one instance with flashColor, fading over duration.
     * @param {number} index Instance index.
     * @param {number} [duration=0.08] Seconds; <= 0 clears the flash.
     * @returns {boolean} false when the index is invalid or inactive.
     */
    hitFlash(index: number, duration?: number | undefined): boolean;
    /**
     * Sets a crowd status code (0=normal, 1..4=white flash, 5=frozen, 6=poison, 7=burn).
     * @param {number} index
     * @param {number} [code=0]
     * @returns {boolean}
     */
    setStatus(index: number, code?: number | undefined): boolean;
    /**
     * Release an instance (swap-removes from the active list).
     * @param {number} index Instance index.
     * @returns {boolean} false when the index is invalid or inactive.
     */
    kill(index: number): boolean;
    /** Release every instance. @returns {void} */
    clear(): void;
    /**
     * Advance instance hit-flash fades.
     * @param {number} dt Delta time in seconds.
     * @returns {void}
     */
    update(dt: number): void;
}
export type Entity = import("../core/entity.js").Entity;
export type Scene = import("../core/scene.js").Scene;
export type SpriteSheet = import("../animation/spritesheet.js").SpriteSheet;
export type QualityPresetTier = import("./quality3d.js").QualityPresetTier;
export type Quality2DPreset = import("./quality3d.js").Quality2DPreset;
export type BlendMode2D = import("./draw-order-2d.js").BlendMode2D;
export type ClipRect2D = import("./draw-order-2d.js").ClipRect2D;
/**
 * Axis-aligned world-space rectangle.
 */
export type ViewBounds2D = {
    /**
     * Left edge (world units).
     */
    minX: number;
    /**
     * Top edge (world units).
     */
    minY: number;
    /**
     * Right edge (world units).
     */
    maxX: number;
    /**
     * Bottom edge (world units).
     */
    maxY: number;
};
/**
 * Optional camera clamp. Any omitted or non-finite edge is unbounded.
 */
export type Camera2DBounds = {
    /**
     * Minimum camera X (world units).
     */
    minX?: number | undefined;
    /**
     * Minimum camera Y (world units).
     */
    minY?: number | undefined;
    /**
     * Maximum camera X (world units).
     */
    maxX?: number | undefined;
    /**
     * Maximum camera Y (world units).
     */
    maxY?: number | undefined;
};
export type Camera2DOptions = {
    /**
     * Camera centre X in world units (finite).
     */
    x?: number | undefined;
    /**
     * Camera centre Y in world units (finite).
     */
    y?: number | undefined;
    /**
     * Scale factor, > 0 (2 = twice as large on screen).
     */
    zoom?: number | undefined;
    /**
     * Camera rotation in radians.
     */
    rotation?: number | undefined;
    /**
     * Clamp region for the camera centre (world units).
     */
    bounds?: Camera2DBounds | null | undefined;
};
/**
 * Anything Camera2D#follow can track: a point, or an object exposing worldPosition() such as an Entity.
 */
export type Camera2DFollowTarget = {
    x: number;
    y: number;
} | {
    worldPosition(): {
        x: number;
        y: number;
    };
};
export type Camera2DFollowOptions = {
    /**
     * Follow factor per call in [0, 1] (1 = snap, smaller = smoother).
     */
    lerp?: number | undefined;
    /**
     * Target offset X (world units).
     */
    offsetX?: number | undefined;
    /**
     * Target offset Y (world units).
     */
    offsetY?: number | undefined;
    /**
     * Half-width of the no-move zone around the camera (world units).
     */
    deadzoneX?: number | undefined;
    /**
     * Half-height of the no-move zone around the camera (world units).
     */
    deadzoneY?: number | undefined;
};
export type BufferCanvas2D = HTMLCanvasElement | OffscreenCanvas;
/**
 * Split-screen view descriptor. x/y/width/height are fractions (0..1) of the logical canvas.
 */
export type Canvas2DView = {
    /**
     * Left edge fraction.
     */
    x: number;
    /**
     * Top edge fraction.
     */
    y: number;
    /**
     * Width fraction.
     */
    width: number;
    /**
     * Height fraction.
     */
    height: number;
    /**
     * Camera rendering into this view.
     */
    camera: Camera2D;
};
export type SplitViewOptions = {
    /**
     * CSS colour of the divider lines.
     */
    dividerColor?: string | undefined;
    /**
     * Divider width in logical pixels (>= 0).
     */
    dividerWidth?: number | undefined;
};
export type Canvas2DAdapterOptions = {
    /**
     * Target canvas (required).
     */
    canvas: HTMLCanvasElement;
    /**
     * Logical design width in world pixels.
     */
    width?: number | undefined;
    /**
     * Logical design height in world pixels.
     */
    height?: number | undefined;
    /**
     * Clear colour.
     */
    background?: string | undefined;
    /**
     * Device pixel ratio, clamped by the quality preset (max 3).
     */
    pixelRatio?: number | undefined;
    /**
     * Smooth scaled images (overridden by the quality preset).
     */
    imageSmoothing?: boolean | undefined;
    /**
     * Collect comparable per-frame and per-stage diagnostics.
     */
    diagnostics2d?: boolean | undefined;
    /**
     * Always render interpolated transforms (entities with interpolate=true always do).
     */
    interpolate?: boolean | undefined;
    /**
     * Skip sprites outside the camera view.
     */
    cull?: boolean | undefined;
    /**
     * Quality tier ('low' | 'medium' | 'high' | 'ultra'); null disables presets.
     */
    quality?: import("./quality3d.js").QualityPresetTier | null | undefined;
    /**
     * Factory for offscreen buffers (tint/shadow caches).
     */
    createBufferCanvas?: ((width: number, height: number) => BufferCanvas2D | null) | null | undefined;
    /**
     * Optional options passed to `createRenderBudgetController`.
     */
    budgetOptions?: object;
};
export type Renderer2DStats = {
    /**
     * Sprites (and crowd instances) drawn last frame.
     */
    drawnSprites: number;
    /**
     * Crowd batches drawn last frame.
     */
    drawnCrowds: number;
    /**
     * Items skipped by culling last frame.
     */
    culled: number;
    /**
     * Whether a sort pass ran last frame.
     */
    sorted: boolean;
    /**
     * 'canvas2d' or 'webgl2'.
     */
    backend: string;
};
/**
 * Letterboxed viewport mapping logical coordinates to the canvas.
 */
export type Viewport2D = {
    /**
     * Canvas CSS width (px).
     */
    vw: number;
    /**
     * Canvas CSS height (px).
     */
    vh: number;
    /**
     * Effective device pixel ratio.
     */
    dpr: number;
    /**
     * Uniform logical-to-CSS scale.
     */
    scale: number;
    /**
     * Letterbox X offset (CSS px).
     */
    x: number;
    /**
     * Letterbox Y offset (CSS px).
     */
    y: number;
};
/**
 * Renderer-neutral 2D adapter shared by Canvas2D and WebGL2D backends.
 */
export type Renderer2DAdapter = {
    /**
     * Default camera (used when no split views are set).
     */
    camera: Camera2D;
    /**
     * Draw the scene; app.renderAlpha drives interpolation.
     */
    render: (scene: Scene, app?: {
        renderAlpha?: number;
    } | null) => void;
    /**
     * Re-measure the canvas and update the viewport.
     */
    resize: () => void;
    /**
     * Set split-screen views (null/empty restores single camera); returns copies.
     */
    setViews: (views: Canvas2DView[] | null, options?: SplitViewOptions) => Canvas2DView[] | null;
    /**
     * Copies of the active views, or null.
     */
    getViews: () => Canvas2DView[] | null;
    /**
     * Convert client coordinates to world coordinates.
     */
    screenToWorld: (clientX: number, clientY: number, viewIndex?: number | null) => {
        x: number;
        y: number;
    };
    /**
     * Convert world coordinates to client coordinates.
     */
    worldToScreen: (worldX: number, worldY: number, viewIndex?: number) => {
        x: number;
        y: number;
    };
    /**
     * Switch quality tier (null clears); returns the active preset.
     */
    setQuality: (tier: QualityPresetTier | null | undefined) => Quality2DPreset | null;
    /**
     * Active quality tier.
     */
    getQuality: () => QualityPresetTier | null;
    /**
     * Active preset (getter).
     */
    qualityPreset: Quality2DPreset | null;
    /**
     * Copy of last-frame statistics (getter).
     */
    stats: Renderer2DStats;
    /**
     * Latest opt-in render frame.
     */
    getRenderDiagnostics: () => import("./render-diagnostics-2d.js").RenderDiagnosticsSnapshot2D | null;
    /**
     * Frame timing percentiles (`p50Ms`, `p95Ms`, `p99Ms`) when diagnostics are enabled.
     */
    getRenderFrameStats?: (() => object | null) | undefined;
    /**
     * Export Chrome Trace JSON events.
     */
    exportRenderChromeTrace?: (() => {
        traceEvents: object[];
        displayTimeUnit: string;
    }) | undefined;
    /**
     * Current 2D resource budget snapshot.
     */
    getRenderBudget: () => ReturnType<typeof createRenderBudgetController> extends {
        getBudgetSnapshot: () => infer S;
    } ? S : unknown;
    /**
     * Reclaim idle targets/caches by type or all.
     */
    reclaimRenderResources: (type?: import("./render-budget-2d.js").RenderResourceType2D | null, reason?: import("./render-budget-2d.js").RenderEvictionReason2D) => number;
    /**
     * Copy of the current viewport.
     */
    getViewport: () => Viewport2D;
    /**
     * Configure global 2D ambient darkness/tint.
     */
    setAmbientLight: (color?: string | number, intensity?: number) => void;
    /**
     * Append a dynamic 2D point light.
     */
    addLight2D: (light: {
        x: number;
        y: number;
        radius?: number;
        color?: string | number;
        intensity?: number;
    }) => boolean;
    /**
     * Replace active 2D point lights.
     */
    setLights2D: (lights: Array<{
        x: number;
        y: number;
        radius?: number;
        color?: string | number;
        intensity?: number;
    }>) => number;
    /**
     * Remove all 2D point lights.
     */
    clearLights2D: () => void;
    /**
     * Append a 2D shadow occluder segment.
     */
    addOccluder2D: (segment: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
    }) => boolean;
    /**
     * Replace active 2D shadow occluder segments.
     */
    setOccluders2D: (segments: Array<{
        x1: number;
        y1: number;
        x2: number;
        y2: number;
    }>) => number;
    /**
     * Decompose a polygon into 2D shadow occluder segments.
     */
    addPolygonOccluder2D: (points: Array<[number, number] | {
        x: number;
        y: number;
    }>, options?: {
        closed?: boolean;
    }) => number;
    /**
     * Replace active polygon occluders.
     */
    setPolygonOccluders2D: (polygons: Array<Array<[number, number] | {
        x: number;
        y: number;
    }> | {
        points: Array<[number, number] | {
            x: number;
            y: number;
        }>;
        closed?: boolean;
    }>, options?: {
        closed?: boolean;
    }) => number;
    /**
     * Remove all 2D shadow occluder segments.
     */
    clearOccluders2D: () => void;
    /**
     * Configure 2D normal-map lighting state.
     */
    setNormalLighting2D: (opts?: {
        normalMap?: unknown;
        strength?: number;
    }) => void;
    /**
     * Read the active 2D lighting/post quality retention policy.
     */
    getQualityPolicy2D: () => any["high"];
    /**
     * Configure 2D bloom/vignette/grading effects.
     */
    setPost2D: (cfg: {
        bloomIntensity?: number;
        bloomThreshold?: number;
        vignette?: number;
        hitPulse?: number;
        chromatic?: number;
        saturation?: number;
        contrast?: number;
    }) => void;
    /**
     * Inspect current 2D lighting & post state.
     */
    getLighting2DState: () => {
        ambient: {
            r: number;
            g: number;
            b: number;
            intensity: number;
        };
        lightCount: number;
        post: object;
    };
    /**
     * Release buffers and caches.
     */
    dispose: () => void;
};
export type Canvas2DAdapter = Renderer2DAdapter & {
    ctx: CanvasRenderingContext2D;
};
/**
 * Ground-shadow tuning for Sprite2D / SpriteCrowd2D. Ratios are relative to the sprite size.
 */
export type GroundShadowOptions = {
    /**
     * Shadow width / sprite width.
     */
    widthRatio?: number | undefined;
    /**
     * Shadow height / sprite height.
     */
    heightRatio?: number | undefined;
    /**
     * Maximum opacity in [0, 1].
     */
    alpha?: number | undefined;
    /**
     * Upward shift of the shadow centre / sprite height.
     */
    tuckRatio?: number | undefined;
    /**
     * Shrink and fade the shadow while the sprite is lifted (negative offsetY).
     */
    jumpScale?: boolean | undefined;
    /**
     * Shadow CSS colour.
     */
    color?: string | undefined;
    /**
     * Extra shadow X offset (local units).
     */
    offsetX?: number | undefined;
    /**
     * Extra shadow Y offset (local units).
     */
    offsetY?: number | undefined;
};
/**
 * Source rectangle inside an image, in pixels.
 */
export type SpriteSourceRect = {
    /**
     * Left (px).
     */
    x: number;
    /**
     * Top (px).
     */
    y: number;
    /**
     * Width (px).
     */
    width: number;
    /**
     * Height (px).
     */
    height: number;
};
/**
 * Animation source exposing the current sheet frame (e.g. an AnimationPlayer).
 */
export type SpriteFrameSource = {
    /**
     * Current frame index into the sprite sheet.
     */
    frame: number;
};
/**
 * Custom draw hook. The context is already transformed (entity matrix, offset, rotation, scale).
 */
export type Sprite2DCustomDraw = (ctx: CanvasRenderingContext2D, entity: Entity, sprite: Sprite2D) => void;
export type Sprite2DOptions = {
    /**
     * Procedural shape used when no image/sheet/customDraw is set (circle uses width as diameter).
     */
    shape?: "text" | "rect" | "circle" | undefined;
    /**
     * Width in local units (world pixels).
     */
    width?: number | undefined;
    /**
     * Height in local units (world pixels).
     */
    height?: number | undefined;
    /**
     * Fill colour for procedural shapes and text.
     */
    color?: string | undefined;
    /**
     * Text for shape 'text'.
     */
    text?: string | undefined;
    /**
     * CSS font for shape 'text'.
     */
    font?: string | undefined;
    /**
     * Draw order within a layer (higher draws on top).
     */
    z?: number | undefined;
    /**
     * Draw layer (higher layers draw on top of lower ones).
     */
    layer?: number | undefined;
    /**
     * Sort by world Y within a layer/z (for top-down depth).
     */
    ySort?: boolean | undefined;
    /**
     * Draw compositing mode.
     */
    blendMode?: import("./draw-order-2d.js").BlendMode2D | undefined;
    /**
     * Clip to a viewport-relative rectangle.
     */
    clipRect?: import("./draw-order-2d.js").ClipRect2D | null | undefined;
    /**
     * Hide without removing the component.
     */
    visible?: boolean | undefined;
    /**
     * Alpha in [0, 1].
     */
    opacity?: number | undefined;
    /**
     * Mirror horizontally.
     */
    flipX?: boolean | undefined;
    /**
     * Mirror vertically.
     */
    flipY?: boolean | undefined;
    /**
     * Image to draw (takes priority over sheet.image).
     */
    image?: CanvasImageSource | null | undefined;
    /**
     * Sprite sheet providing frame rectangles (and the image when image is null).
     */
    sheet?: import("../index.js").SpriteSheet | null | undefined;
    /**
     * Sheet frame index (ignored while an animation is set).
     */
    frame?: number | undefined;
    /**
     * Explicit source rectangle in pixels (overrides sheet frames).
     */
    sourceRect?: SpriteSourceRect | null | undefined;
    /**
     * Animation whose .frame selects the sheet frame.
     */
    animation?: SpriteFrameSource | null | undefined;
    /**
     * Replaces the built-in drawing.
     */
    customDraw?: Sprite2DCustomDraw | null | undefined;
    /**
     * Horizontal anchor 0..1; null falls back to entity.anchorX, then 0.5.
     */
    anchorX?: number | null | undefined;
    /**
     * Vertical anchor 0..1; null falls back to entity.anchorY, then 0.5.
     */
    anchorY?: number | null | undefined;
    /**
     * Visual X offset in local units (does not move the entity; ground shadow stays put).
     */
    offsetX?: number | undefined;
    /**
     * Visual Y offset in local units (negative = lifted, e.g. jump bounce).
     */
    offsetY?: number | undefined;
    /**
     * Visual X scale.
     */
    scaleX?: number | undefined;
    /**
     * Visual Y scale.
     */
    scaleY?: number | undefined;
    /**
     * Visual rotation in radians.
     */
    rotation?: number | undefined;
    /**
     * CSS colour overlay (images get a 55% silhouette overlay; shapes use it as fill).
     */
    tint?: string | null | undefined;
    /**
     * Hit-flash intensity in [0, 1]; normally driven by Sprite2D#hitFlash.
     */
    flash?: number | undefined;
    /**
     * Hit-flash colour.
     */
    flashColor?: string | undefined;
    /**
     * Draw an elliptical ground shadow (true = defaults).
     */
    groundShadow?: boolean | GroundShadowOptions | undefined;
    /**
     * Optional tangent-space 2D normal texture for lit sprites.
     */
    normalMap?: unknown | null;
    /**
     * Normal-map modulation strength in [0, 2].
     */
    normalStrength?: number | undefined;
    /**
     * Surface roughness hint in [0, 1].
     */
    roughness?: number | undefined;
};
export type SpriteCrowdBindSwarmOptions = {
    /**
     * Rotate each instance toward its swarm heading.
     */
    syncRotation?: boolean | undefined;
    /**
     * Flip horizontally when heading left (`sin(rot) < 0`).
     */
    flipByDirection?: boolean | undefined;
    /**
     * Cyclic animation frame count (`> 1` advances by `animTime * animFps`).
     */
    frameCount?: number | undefined;
    /**
     * Animation frames per second when `frameCount > 1`.
     */
    animFps?: number | undefined;
    /**
     * Multiplier from swarm simulation coordinates to crowd local coordinates.
     */
    worldScale?: number | undefined;
};
export type SpriteCrowd2DOptions = {
    /**
     * Maximum simultaneous instances (integer 1..262144).
     */
    capacity?: number | undefined;
    /**
     * Procedural shape when no image/sheet is set.
     */
    shape?: "rect" | "circle" | undefined;
    /**
     * Instance width in local units.
     */
    width?: number | undefined;
    /**
     * Instance height in local units.
     */
    height?: number | undefined;
    /**
     * Fill colour for procedural shapes.
     */
    color?: string | undefined;
    /**
     * Shared image (takes priority over sheet.image).
     */
    image?: CanvasImageSource | null | undefined;
    /**
     * Shared sprite sheet; each instance picks a frame.
     */
    sheet?: import("../index.js").SpriteSheet | null | undefined;
    /**
     * Explicit source rectangle in pixels shared by all instances.
     */
    sourceRect?: SpriteSourceRect | null | undefined;
    /**
     * Horizontal anchor 0..1.
     */
    anchorX?: number | undefined;
    /**
     * Vertical anchor 0..1.
     */
    anchorY?: number | undefined;
    /**
     * Draw layer.
     */
    layer?: number | undefined;
    /**
     * Draw order within a layer.
     */
    z?: number | undefined;
    /**
     * Sort every instance individually by world Y (slower; enables per-agent depth).
     */
    ySort?: boolean | undefined;
    /**
     * Draw compositing mode for the crowd.
     */
    blendMode?: import("./draw-order-2d.js").BlendMode2D | undefined;
    /**
     * Clip to a viewport-relative rectangle.
     */
    clipRect?: import("./draw-order-2d.js").ClipRect2D | null | undefined;
    /**
     * Hide the whole crowd.
     */
    visible?: boolean | undefined;
    /**
     * Ground shadow for every instance.
     */
    groundShadow?: boolean | GroundShadowOptions | undefined;
    /**
     * Hit-flash colour.
     */
    flashColor?: string | undefined;
};
/**
 * Per-instance initial values for SpriteCrowd2D#spawn.
 */
export type SpriteCrowdSpawnOptions = {
    /**
     * Local X (relative to the owning entity, world units).
     */
    x?: number | undefined;
    /**
     * Local Y (relative to the owning entity, world units).
     */
    y?: number | undefined;
    /**
     * Visual X offset.
     */
    offsetX?: number | undefined;
    /**
     * Visual Y offset (negative = lifted).
     */
    offsetY?: number | undefined;
    /**
     * Rotation in radians.
     */
    rotation?: number | undefined;
    /**
     * X scale.
     */
    scaleX?: number | undefined;
    /**
     * Y scale.
     */
    scaleY?: number | undefined;
    /**
     * Alpha in [0, 1].
     */
    opacity?: number | undefined;
    /**
     * Sheet frame index (0..65535).
     */
    frame?: number | undefined;
    /**
     * Mirror horizontally.
     */
    flipX?: boolean | undefined;
    /**
     * CSS colour tint (rgb used as fill for procedural shapes).
     */
    tint?: string | null | undefined;
};
import { Component } from '../core/component.js';
import { createRenderBudgetController } from './render-budget-2d.js';
