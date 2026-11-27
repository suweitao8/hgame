/**
 * Unified 2D/3D/Headless zero-GC VFX & game-feel facade.
 * @param {object} [options]
 * @param {'headless' | 'canvas2d' | 'webgl2d' | '3d' | null} [options.mode=null]
 * @param {object | null} [options.sceneOrAdapter=null] Renderer adapter, scene or 2D context.
 * @param {object | null} [options.THREE] Three.js namespace for 3D rendering.
 * @param {object | null} [options.renderer=null] Optional Three.js WebGLRenderer for 3D GPU particle MRT stepping.
 * @param {number} [options.maxParticles]
 * @param {number} [options.maxGpuParticles]
 * @param {number} [options.maxAtlasParticles]
 * @param {number} [options.maxMeshVfx]
 * @param {number} [options.trailNodes]
 * @param {number} [options.maxFloatingGlyphs]
 * @param {number} [options.maxPopups]
 * @param {object | null} [options.atlasTexture=null]
 * @param {Record<string, readonly number[]> | null} [options.atlasRegions=null]
 * @param {boolean} [options.renderThroughWalls=true]
 * @param {number} [options.seed=0x9e3779b9]
 */
export function createVfxSystem({ mode, sceneOrAdapter, THREE, renderer, maxParticles, maxGpuParticles, maxAtlasParticles, maxMeshVfx, trailNodes, maxFloatingGlyphs, maxPopups, atlasTexture, atlasRegions, renderThroughWalls, seed, }?: {
    mode?: "3d" | "canvas2d" | "webgl2d" | "headless" | null | undefined;
    sceneOrAdapter?: object | null;
    THREE?: object | null;
    renderer?: object | null;
    maxParticles?: number | undefined;
    maxGpuParticles?: number | undefined;
    maxAtlasParticles?: number | undefined;
    maxMeshVfx?: number | undefined;
    trailNodes?: number | undefined;
    maxFloatingGlyphs?: number | undefined;
    maxPopups?: number | undefined;
    atlasTexture?: object | null;
    atlasRegions?: Record<string, readonly number[]> | null | undefined;
    renderThroughWalls?: boolean | undefined;
    seed?: number | undefined;
} | undefined): {
    mode: any;
    prng: {
        nextFloat(): number;
        range(min: any, max: any): any;
        reset(newSeed?: number): void;
    };
    hitstop: {
        trigger(durationSec?: number, scale?: number): void;
        step(rawDt: any): number;
        isFrozen(): boolean;
        reset(): void;
    };
    shake: {
        impulse(intensity?: number, dirX?: number, dirY?: number, dirZ?: number): void;
        update(rawDt: any, maxAmplitude?: number, maxRollRad?: number): {
            x: number;
            y: number;
            z: number;
            roll: number;
        };
        readonly offset: {
            x: number;
            y: number;
            z: number;
            roll: number;
        };
        reset(): void;
    };
    particles: {
        capacity: number;
        emit: (opts: any) => void;
        burst: (opts?: {}) => void;
        flushDirty: () => void;
        update: (visualDt: any) => void;
        renderWebGL2: (camera: any, viewWidth: any, viewHeight: any) => void;
        renderCanvas2D: (ctx: any, camera: any, viewWidth: any, viewHeight: any) => void;
        reset: () => void;
        dispose: () => void;
        readonly time: number;
        getStats(): {
            capacity: number;
            normalCursor: number;
            additiveCursor: number;
            normalTotal: number;
            additiveTotal: number;
            normalWrapCount: number;
            additiveWrapCount: number;
            normalLastRanges: never[];
            additiveLastRanges: never[];
        };
    };
    gpuParticles: {
        capacity: number;
        texWidth: number;
        texHeight: number;
        emit: (opts?: {}) => number;
        burst: (opts?: {}) => void;
        setField: (opts?: {}) => void;
        setQualityTier: (tier?: string) => void;
        setDepthTexture: (depthTex: any, { near, far, collision }?: {
            near?: number | undefined;
            far?: number | undefined;
            collision?: boolean | undefined;
        }) => void;
        setCameraMatrices: (viewProj: any, near?: number, far?: number) => void;
        setRenderer: (r: any) => void;
        readParticleSample: (slotIdx: any, out?: {}) => {};
        update: (visualDt?: number) => void;
        renderWebGL2: (camera: any, viewWidth: any, viewHeight: any) => void;
        renderCanvas2D: (ctx: any, camera: any, viewWidth: any, viewHeight: any) => void;
        reset: () => void;
        dispose: () => void;
        readonly time: number;
        getStats(): {
            capacity: number;
            mobile: any;
            precision: string;
            qualityTier: string;
            initialized: boolean;
            activeEstimate: number;
            activeBaseSlot: number;
            activeSpanCount: number;
            totalEmitted: number;
            gpuAccelerated: boolean;
            simPasses: number;
            uploadedBytes: number;
        };
    };
    atlasParticles: {
        readonly texture: any;
        capacity: number;
        lut: {
            bytes: Uint8Array;
            width: number;
            height: number;
            texture: any;
            readonly rowCount: number;
            readonly version: number;
            compile: (colorCurveRaw: any, sizeCurveRaw: any, sizeYCurveRaw?: null, velocityCurveRaw?: null) => any;
            flush: () => void;
            sampleColor: (row: any, t: any, out?: Float32Array) => Float32Array;
            sampleSize: (row: any, t: any) => number;
            sampleSizeY: (row: any, t: any) => number;
            sampleVelDisp: (row: any, t: any) => number;
            dispose: () => void;
        };
        uberLut: {
            texture: any;
            data: Float32Array;
            width: number;
            height: number;
            allocateRow: (cacheKey: any, matSpec: any, texRects: any) => any;
            packRow: (rowIdx: any, matSpec: any, texRects: any) => void;
            clear: () => void;
            dispose: () => void;
        } | null;
        readonly regions: Record<string, readonly number[]>;
        compileCurves: (colorCurveRaw: any, sizeCurveRaw: any, sizeYCurveRaw?: null, velocityCurveRaw?: null) => any;
        registerUberMaterial: (matSpec: any) => any;
        setAtlas: (textureOrCanvas: object | null, newRegions?: Record<string, readonly number[]> | undefined, options?: {
            flipV?: boolean | null;
        } | undefined) => void;
        setDepthTexture: (depthTexture: any, { near, far, width, height, softFade }?: {
            near?: number | undefined;
            far?: number | undefined;
            width?: number | undefined;
            height?: number | undefined;
            softFade?: number | undefined;
        }) => void;
        setSceneTexture: (sceneTexture: object | null, { width, height, strength }?: {
            width?: number;
            height?: number;
            strength?: number;
        } | undefined) => void;
        setQualityTier: (tier?: string) => void;
        hasActiveDistortion: () => boolean;
        setWind: (wx?: number, wy?: number, wz?: number) => void;
        setEffectTransform: (slotIdx: number, x?: number | undefined, y?: number | undefined, z?: number | undefined, qx?: number | undefined, qy?: number | undefined, qz?: number | undefined, qw?: number | undefined) => void;
        setEffectOffset: (slotIdx: number, x?: number, y?: number, z?: number) => void;
        emit: (opts?: object) => number;
        updateSlot: (blendOrState: any, idx: any, x: any, y: any, z: any, vx: any, vy: any, vz: any) => void;
        killSlot: (blendOrState: any, idx: any) => void;
        flushDirty: () => void;
        update: (visualDt: any) => void;
        renderWebGL2: (camera: any, viewWidth: any, viewHeight: any) => void;
        renderCanvas2D: (ctx: any, camera: any, viewWidth: any, viewHeight: any) => void;
        reset: () => void;
        dispose: () => void;
        readonly time: number;
        getStats(): {
            capacity: number;
            curveRows: number;
            normalCursor: number;
            additiveCursor: number;
            multiplyCursor: number;
            premultiplyCursor: number;
            distortionCursor: number;
            normalTotal: number;
            additiveTotal: number;
            multiplyTotal: number;
            premultiplyTotal: number;
            distortionTotal: number;
            renderStateChannels: number;
            renderStateTotal: number;
        };
    };
    meshVfx: {
        capacity: number;
        registerMesh: (id: string, geometryOrObject3D: object, options?: {}) => boolean;
        registerUberMaterial: (matSpec: any) => any;
        getSurfaceSamples: (name: any) => any;
        spawn: (opts?: object) => number;
        killSlot: (slotIdx: any) => void;
        readSlotMotion: (slotIdx: any, position: any, velocity: any) => void;
        readSlotTransform: (slotIdx: any, position: any, quatOut: any, scaleOut: any, t?: number) => boolean;
        updateSlot: (slotIdx: any, x: any, y: any, z: any, vx: any, vy: any, vz: any) => void;
        setWind: (wx?: number, wy?: number, wz?: number) => void;
        setCamera: (camera: any) => void;
        setEffectTransform: (slotIdx: any, x?: number, y?: number, z?: number, qx?: number, qy?: number, qz?: number, qw?: number) => void;
        setEffectOffset: (slotIdx: any, x?: number, y?: number, z?: number) => void;
        setAtlas: (textureOrCanvas: any, newRegions: any, options?: {}) => void;
        setDepthTexture: (depthTexture: any, { near, far, width, height, softFade }?: {
            near?: number | undefined;
            far?: number | undefined;
            width?: number | undefined;
            height?: number | undefined;
            softFade?: number | undefined;
        }) => void;
        setSceneTexture: (sceneTexture: object | null, { width, height }?: {
            width?: number;
            height?: number;
        } | undefined) => void;
        setQualityTier: (tier?: string) => void;
        hasActiveDistortion: () => boolean;
        update: (visualDt: any) => void;
        reset: () => void;
        dispose: () => void;
        getStats(): {
            capacity: number;
            activeCount: number;
            instancedBatches: number;
            totalSpawned: number;
            registeredMeshes: number;
        };
    };
    shurikenKernel: {
        registerTexture: (key: any, tex: any) => void;
        setAtlas: (tex: any, regions?: null, opts?: {}) => void;
        registerMeshGeometry: (key: any, geoOrObj: any) => void;
        registerLayer: (layer: any, customTextures?: null) => {
            layer: any;
            renderMode: any;
            renderModeId: any;
            isNone: boolean;
            isWarp: boolean;
            space: string;
            simSpeed: number;
            meshGlobalScale: number;
            velocityScale: number;
            lengthScale: number;
            alignToVelocity: boolean;
            aspectY: number;
            capacity: number;
            life: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            speed: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            sizeX: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            sizeY: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            sizeZ: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            sizeCurveX: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            } | null;
            sizeCurveY: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            } | null;
            sizeCurveZ: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            } | null;
            rot0X: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            rot0Y: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            rot0Z: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            spinX: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            spinY: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            spinZ: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            rotCurveX: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            } | null;
            rotCurveY: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            } | null;
            rotCurveZ: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            } | null;
            velX: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            } | null;
            velY: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            } | null;
            velZ: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            } | null;
            velCurve: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            } | null;
            orbitalX: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            orbitalY: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            orbitalZ: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            radialVel: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            };
            forceX: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            } | null;
            forceY: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            } | null;
            forceZ: {
                kind: string;
                lut: Float32Array;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                v?: undefined;
            } | {
                kind: string;
                min: any;
                max: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                v?: undefined;
            } | {
                kind: string;
                v: any;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
                min?: undefined;
                max?: undefined;
            } | null;
            clampVel: {
                separateAxis: boolean;
                dampen: number;
                limitMag: {
                    kind: string;
                    lut: Float32Array;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    lutMin: Float32Array;
                    lutMax: Float32Array;
                    lut?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    min: any;
                    max: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    v: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                };
                limitX: {
                    kind: string;
                    lut: Float32Array;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    lutMin: Float32Array;
                    lutMax: Float32Array;
                    lut?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    min: any;
                    max: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    v: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                };
                limitY: {
                    kind: string;
                    lut: Float32Array;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    lutMin: Float32Array;
                    lutMax: Float32Array;
                    lut?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    min: any;
                    max: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    v: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                };
                limitZ: {
                    kind: string;
                    lut: Float32Array;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    lutMin: Float32Array;
                    lutMax: Float32Array;
                    lut?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    min: any;
                    max: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    v: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                };
                drag: {
                    kind: string;
                    lut: Float32Array;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    lutMin: Float32Array;
                    lutMax: Float32Array;
                    lut?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    min: any;
                    max: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    v: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                } | null;
            } | null;
            rotBySpeed: {
                separateAxes: boolean;
                rangeMin: number;
                rangeMax: number;
                curveX: {
                    kind: string;
                    lut: Float32Array;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    lutMin: Float32Array;
                    lutMax: Float32Array;
                    lut?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    min: any;
                    max: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    v: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                } | null;
                curveY: {
                    kind: string;
                    lut: Float32Array;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    lutMin: Float32Array;
                    lutMax: Float32Array;
                    lut?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    min: any;
                    max: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    v: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                } | null;
                curveZ: {
                    kind: string;
                    lut: Float32Array;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    lutMin: Float32Array;
                    lutMax: Float32Array;
                    lut?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    min: any;
                    max: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    v: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                };
            } | null;
            inheritVelocity: {
                mode: any;
                multiplier: {
                    kind: string;
                    lut: Float32Array;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    lutMin: Float32Array;
                    lutMax: Float32Array;
                    lut?: undefined;
                    min?: undefined;
                    max?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    min: any;
                    max: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    v?: undefined;
                } | {
                    kind: string;
                    v: any;
                    lut?: undefined;
                    lutMin?: undefined;
                    lutMax?: undefined;
                    min?: undefined;
                    max?: undefined;
                };
            } | null;
            startColor: {
                kind: string;
                rgba: number[];
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
            } | {
                kind: string;
                lut: Float32Array;
                rgba?: undefined;
                min?: undefined;
                max?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
            } | {
                kind: string;
                min: number[];
                max: number[];
                rgba?: undefined;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                rgba?: undefined;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
            };
            colorOverLifetime: {
                kind: string;
                rgba: number[];
                lut?: undefined;
                min?: undefined;
                max?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
            } | {
                kind: string;
                lut: Float32Array;
                rgba?: undefined;
                min?: undefined;
                max?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
            } | {
                kind: string;
                min: number[];
                max: number[];
                rgba?: undefined;
                lut?: undefined;
                lutMin?: undefined;
                lutMax?: undefined;
            } | {
                kind: string;
                lutMin: Float32Array;
                lutMax: Float32Array;
                rgba?: undefined;
                lut?: undefined;
                min?: undefined;
                max?: undefined;
            };
            customData: {
                custom1: {
                    kind: string;
                    grad: {
                        kind: string;
                        rgba: number[];
                        lut?: undefined;
                        min?: undefined;
                        max?: undefined;
                        lutMin?: undefined;
                        lutMax?: undefined;
                    } | {
                        kind: string;
                        lut: Float32Array;
                        rgba?: undefined;
                        min?: undefined;
                        max?: undefined;
                        lutMin?: undefined;
                        lutMax?: undefined;
                    } | {
                        kind: string;
                        min: number[];
                        max: number[];
                        rgba?: undefined;
                        lut?: undefined;
                        lutMin?: undefined;
                        lutMax?: undefined;
                    } | {
                        kind: string;
                        lutMin: Float32Array;
                        lutMax: Float32Array;
                        rgba?: undefined;
                        lut?: undefined;
                        min?: undefined;
                        max?: undefined;
                    };
                    comps?: undefined;
                } | {
                    kind: string;
                    comps: ({
                        kind: string;
                        lut: Float32Array;
                        lutMin?: undefined;
                        lutMax?: undefined;
                        min?: undefined;
                        max?: undefined;
                        v?: undefined;
                    } | {
                        kind: string;
                        lutMin: Float32Array;
                        lutMax: Float32Array;
                        lut?: undefined;
                        min?: undefined;
                        max?: undefined;
                        v?: undefined;
                    } | {
                        kind: string;
                        min: any;
                        max: any;
                        lut?: undefined;
                        lutMin?: undefined;
                        lutMax?: undefined;
                        v?: undefined;
                    } | {
                        kind: string;
                        v: any;
                        lut?: undefined;
                        lutMin?: undefined;
                        lutMax?: undefined;
                        min?: undefined;
                        max?: undefined;
                    })[];
                    grad?: undefined;
                } | null;
                custom2: {
                    kind: string;
                    grad: {
                        kind: string;
                        rgba: number[];
                        lut?: undefined;
                        min?: undefined;
                        max?: undefined;
                        lutMin?: undefined;
                        lutMax?: undefined;
                    } | {
                        kind: string;
                        lut: Float32Array;
                        rgba?: undefined;
                        min?: undefined;
                        max?: undefined;
                        lutMin?: undefined;
                        lutMax?: undefined;
                    } | {
                        kind: string;
                        min: number[];
                        max: number[];
                        rgba?: undefined;
                        lut?: undefined;
                        lutMin?: undefined;
                        lutMax?: undefined;
                    } | {
                        kind: string;
                        lutMin: Float32Array;
                        lutMax: Float32Array;
                        rgba?: undefined;
                        lut?: undefined;
                        min?: undefined;
                        max?: undefined;
                    };
                    comps?: undefined;
                } | {
                    kind: string;
                    comps: ({
                        kind: string;
                        lut: Float32Array;
                        lutMin?: undefined;
                        lutMax?: undefined;
                        min?: undefined;
                        max?: undefined;
                        v?: undefined;
                    } | {
                        kind: string;
                        lutMin: Float32Array;
                        lutMax: Float32Array;
                        lut?: undefined;
                        min?: undefined;
                        max?: undefined;
                        v?: undefined;
                    } | {
                        kind: string;
                        min: any;
                        max: any;
                        lut?: undefined;
                        lutMin?: undefined;
                        lutMax?: undefined;
                        v?: undefined;
                    } | {
                        kind: string;
                        v: any;
                        lut?: undefined;
                        lutMin?: undefined;
                        lutMax?: undefined;
                        min?: undefined;
                        max?: undefined;
                    })[];
                    grad?: undefined;
                } | null;
            } | null;
            streams: {
                custom1: boolean;
                custom2: boolean;
                agePercent: boolean;
                stableRandom: boolean;
                uv2: boolean;
            };
            needsCustom1: boolean;
            needsCustom2: boolean;
            flipbook: any;
            trail: any;
            subEmitters: any;
            mesh: any;
            material: any;
            renderState: {
                transparent: boolean;
                opaque: boolean;
                isWarp: boolean;
                premulAlpha: boolean;
                blending: any;
                blendEquation: any;
                blendSrc: any;
                blendDst: any;
                blendSrcAlpha: any;
                blendDstAlpha: any;
                side: any;
                depthTestIdx: number;
                depthWrite: boolean;
                renderOrder: number;
            } | null;
            gpuBuffers: {
                geo: any;
                arrays: {
                    instPos: Float32Array;
                    instRot: Float32Array;
                    instScale: Float32Array;
                    instVel: Float32Array;
                    color: Float32Array;
                    custom1: Float32Array;
                    custom2: Float32Array;
                    meta: Float32Array;
                };
                attrs: {
                    aInstPos: any;
                    aInstRot: any;
                    aInstScale: any;
                    aInstVel: any;
                    aColor: any;
                    aCustom1: any;
                    aCustom2: any;
                    aMeta: any;
                };
            } | null;
            soa: {
                cursor: number;
                activeCount: number;
                active: Uint8Array;
                activeIndices: Int32Array;
                slotToActivePos: Int32Array;
                effectSlotId: Int32Array;
                px: Float32Array;
                py: Float32Array;
                pz: Float32Array;
                vx: Float32Array;
                vy: Float32Array;
                vz: Float32Array;
                age: Float32Array;
                life: Float32Array;
                baseSx: Float32Array;
                baseSy: Float32Array;
                baseSz: Float32Array;
                rotX: Float32Array;
                rotY: Float32Array;
                rotZ: Float32Array;
                spinX: Float32Array;
                spinY: Float32Array;
                spinZ: Float32Array;
                gravity: Float32Array;
                drag: Float32Array;
                fx: Float32Array;
                fy: Float32Array;
                fz: Float32Array;
                orbitalX: Float32Array;
                orbitalY: Float32Array;
                orbitalZ: Float32Array;
                centerX: Float32Array;
                centerY: Float32Array;
                centerZ: Float32Array;
                noiseStr: Float32Array;
                noiseFreq: Float32Array;
                noisePhase: Float32Array;
                randSize: Float32Array;
                randColor: Float32Array;
                randRot: Float32Array;
                randCustom: Float32Array;
                stableRand: Float32Array;
                startR: Float32Array;
                startG: Float32Array;
                startB: Float32Array;
                startA: Float32Array;
                fbRow: Uint16Array;
                trailId: Int32Array;
                birthSeq: Float64Array;
                ribbonTrailId: number;
                ribbonOrder: Int32Array;
            };
        };
        emitParticle: (cl: any, opts?: {}) => any;
        setEffectTransform: (effectId: any, x: any, y: any, z: any, yaw?: number, vx?: number, vy?: number, vz?: number, qx?: number, qy?: number, qz?: number, qw?: number) => void;
        setQualityTier: (tier?: string) => void;
        getQualityTier: () => string;
        setDepthTexture: (depthTex: any, { near, far, width, height }?: {
            near?: number | undefined;
            far?: number | undefined;
            width?: number | undefined;
            height?: number | undefined;
        }) => void;
        setSceneTexture: (sceneTex: object | null, { width, height }?: {
            width?: number;
            height?: number;
        } | undefined) => void;
        hasActiveWarp: () => boolean;
        setWarpMeshesVisible: (visible: any) => void;
        update: (dt?: number) => void;
        reset: () => void;
        dispose: () => void;
        getStats: () => {
            qualityTier: string;
            compiledLayers: number;
            activeParticles: number;
            activeDrawCalls: number;
            warpActive: number;
        };
    };
    effects: {
        registerEffect: (recipe: object) => object;
        getEffect: (id: any) => any;
        playEffect: (recipeOrId: string | object, options?: {
            x?: number | undefined;
            y?: number | undefined;
            z?: number | undefined;
            yaw?: number | undefined;
            rotation?: number[] | undefined;
            scale?: number | undefined;
            follow?: {
                x?: number;
                y?: number;
                z?: number;
                yaw?: number;
                rotation?: number[];
            } | undefined;
        } | undefined) => object | null;
        setCollisionResolver: (fn: any) => void;
        stopAll: () => void;
        update: (visualDt: any) => void;
        reset: () => void;
        dispose: () => void;
        getStats(): {
            registeredCount: number;
            activeEffects: number;
            totalPlayed: number;
        };
    };
    trails: {
        slashArc: (opts?: {}) => void;
        lightningBolt: (opts?: {}) => void;
        setAtlas: (texture: any, regions?: null, opts?: {}) => void;
        registerUberMaterial: (matSpec: any) => any;
        setTrailTexture: (texture: object | null, uvRect?: readonly number[] | undefined) => void;
        setDepthTexture: (depthTexture: any, { near, far, width, height, softFade }?: {
            near?: number | undefined;
            far?: number | undefined;
            width?: number | undefined;
            height?: number | undefined;
            softFade?: number | undefined;
        }) => void;
        setTrailPoints: (trackId: any, px: any, py: any, pz: any, indices: any, startIdx: any, endIdx: any) => void;
        setAtlasRegions: (regions: Record<string, readonly number[]> | null) => void;
        setTrailWidthScale: (trackId: any, scale?: number) => void;
        setTrailLifeMod: (trackId: any, r?: number, g?: number, b?: number, a?: number) => void;
        allocTrail: (colorOrOpts?: number | object, width?: number | undefined) => number;
        pushTrailPoint: (trackId: any, x: any, y: any, z?: number, timeOverride?: undefined) => void;
        updateTrailHead: (trackId: any, x: any, y: any, z?: number, timeOverride?: undefined) => void;
        freeTrail: (trackId: any) => void;
        update: (visualDt: any) => void;
        renderCanvas2D: (ctx: any, camera: any, viewWidth: any, viewHeight: any) => void;
        reset: () => void;
        dispose: () => void;
        getTime: () => number;
        getStats(): {
            slashCap: number;
            boltCap: number;
            trailCap: number;
            trailNodes: number;
            activeTrails: number;
        };
    };
    telegraphs: {
        spawnTelegraph: (opts?: {}) => number;
        updateTelegraph: (slot: any, opts?: {}) => void;
        setShrinkZone: ({ centerX, centerY, centerZ, safeRadius, mapRadius, active, }?: {
            centerX?: number | undefined;
            centerY?: number | undefined;
            centerZ?: number | undefined;
            safeRadius?: number | undefined;
            mapRadius?: number | undefined;
            active?: boolean | undefined;
        }) => void;
        update: (visualDt: any) => void;
        renderCanvas2D: (ctx: any, camera: any, viewWidth: any, viewHeight: any) => void;
        reset: () => void;
        dispose: () => void;
        getStats(): {
            capacity: number;
            totalSpawned: number;
        };
    };
    floatingText: {
        popupNumber: (opts?: object) => number;
        update: (visualDt: number, rawDtOrCameraPos?: number | object | null, maybeCameraPos?: object | null) => void;
        renderWebGL2: (camera: any, viewWidth: any, viewHeight: any) => void;
        renderCanvas2D: (ctx: any, camera: any, viewWidth: any, viewHeight: any) => void;
        getActivePopups: () => {
            id: number;
            x: number;
            y: number;
            z: number;
            renderX: number;
            renderY: number;
            renderZ: number;
            value: number;
            text: string;
            topText: string;
            bottomText: string;
            alpha: number;
            scaleX: number;
            scaleY: number;
            rotRad: number;
            color: number;
            spamGroup: string;
            destroying: boolean;
            absorbing: boolean;
        }[];
        reset: () => void;
        dispose: () => void;
        getStats(): {
            capacity: number;
            popupCapacity: number;
            activePopups: number;
            activeGlyphs: number;
            totalEmitted: number;
            totalPopupsSpawned: number;
            totalCombined: number;
        };
    };
    screenFeedback: {
        screenPulse: ({ ndcX, ndcY, strength, duration, color, }?: {
            ndcX?: number | undefined;
            ndcY?: number | undefined;
            strength?: number | undefined;
            duration?: number | undefined;
            color?: number | undefined;
        }) => void;
        setLowHpIntensity: (intensity: any) => void;
        setSpeedLines: (intensity: any) => void;
        update: (visualDt: any) => void;
        renderCanvas2D: (ctx: any, viewWidth: any, viewHeight: any) => void;
        reset: () => void;
        dispose: () => void;
    };
    setAtlas(tex: any, regions: any, opts: any): void;
    setDepthTexture(tex: any, opts: any): void;
    setSceneTexture(tex: any, opts: any): void;
    setQualityTier(tier: any): void;
    getQualityTier: () => string;
    registerTexture: (key: any, tex: any) => void;
    hasActiveWarp: () => boolean;
    setWarpMeshesVisible: (visible: any) => void;
    hasActiveDistortion: () => boolean;
    prepareDistortionBeforeWorld: () => void;
    renderDistortionPass: (renderer: any, targetScene: any, camera: any) => void;
    renderWithDistortion: (renderer: any, targetScene: any, camera: any) => void;
    setWind(wx?: number, wy?: number, wz?: number): void;
    setCamera(camera: any): void;
    setCollisionResolver: (fn: any) => void;
    setTrailTexture: (texture: object | null, uvRect?: readonly number[] | undefined) => void;
    registerMesh(name: any, geometry: any, options: any): boolean;
    registerEffect: (recipe: object) => object;
    playEffect: (recipeOrId: string | object, options?: {
        x?: number | undefined;
        y?: number | undefined;
        z?: number | undefined;
        yaw?: number | undefined;
        rotation?: number[] | undefined;
        scale?: number | undefined;
        follow?: {
            x?: number;
            y?: number;
            z?: number;
            yaw?: number;
            rotation?: number[];
        } | undefined;
    } | undefined) => object | null;
    stopAllEffects: () => void;
    emitHitImpact: ({ x, y, z, damage, isCrit, isHeal, isMiss, dirX, dirY, dirZ, element, numberPreset, spamGroup, follow, combination, hitstopSec, shakeIntensity, }?: {
        x?: number | undefined;
        y?: number | undefined;
        z?: number | undefined;
        damage?: number | undefined;
        isCrit?: boolean | undefined;
        isHeal?: boolean | undefined;
        isMiss?: boolean | undefined;
        dirX?: number | undefined;
        dirY?: number | undefined;
        dirZ?: number | undefined;
        element?: string | undefined;
        numberPreset?: string | undefined;
        spamGroup?: string | undefined;
        follow?: object;
        combination?: object;
        hitstopSec?: number | undefined;
        shakeIntensity?: number | undefined;
    } | undefined) => void;
    burstParticles: (presetOrConfig: any) => void;
    emitGpuParticles: (opts?: {}) => void;
    setGpuField: (opts?: {}) => void;
    slashArc: (opts?: {}) => void;
    lightningBolt: (opts?: {}) => void;
    allocTrail: (colorOrOpts?: number | object, width?: number | undefined) => number;
    pushTrailPoint: (trackId: any, x: any, y: any, z?: number, timeOverride?: undefined) => void;
    freeTrail: (trackId: any) => void;
    spawnTelegraph: (opts?: {}) => number;
    updateTelegraph: (slot: any, opts?: {}) => void;
    setShrinkZone: ({ centerX, centerY, centerZ, safeRadius, mapRadius, active, }?: {
        centerX?: number | undefined;
        centerY?: number | undefined;
        centerZ?: number | undefined;
        safeRadius?: number | undefined;
        mapRadius?: number | undefined;
        active?: boolean | undefined;
    }) => void;
    popupNumber: (opts?: object) => number;
    screenPulse: ({ ndcX, ndcY, strength, duration, color, }?: {
        ndcX?: number | undefined;
        ndcY?: number | undefined;
        strength?: number | undefined;
        duration?: number | undefined;
        color?: number | undefined;
    }) => void;
    setLowHpIntensity: (intensity: any) => void;
    setSpeedLines: (intensity: any) => void;
    update: (rawDt?: number, cameraPos?: null) => {
        visualDt: number;
        cameraOffset: {
            x: number;
            y: number;
            z: number;
            roll: number;
        };
    };
    render: (ctxOrCamera: any, cameraOrWidth: any, widthOrHeight: any, maybeHeight: any) => void;
    reset: () => void;
    dispose: () => void;
    getStats(): {
        mode: any;
        particles: {
            capacity: number;
            normalCursor: number;
            additiveCursor: number;
            normalTotal: number;
            additiveTotal: number;
            normalWrapCount: number;
            additiveWrapCount: number;
            normalLastRanges: never[];
            additiveLastRanges: never[];
        };
        gpuParticles: {
            capacity: number;
            mobile: any;
            precision: string;
            qualityTier: string;
            initialized: boolean;
            activeEstimate: number;
            activeBaseSlot: number;
            activeSpanCount: number;
            totalEmitted: number;
            gpuAccelerated: boolean;
            simPasses: number;
            uploadedBytes: number;
        };
        atlasParticles: {
            capacity: number;
            curveRows: number;
            normalCursor: number;
            additiveCursor: number;
            multiplyCursor: number;
            premultiplyCursor: number;
            distortionCursor: number;
            normalTotal: number;
            additiveTotal: number;
            multiplyTotal: number;
            premultiplyTotal: number;
            distortionTotal: number;
            renderStateChannels: number;
            renderStateTotal: number;
        };
        meshVfx: {
            capacity: number;
            activeCount: number;
            instancedBatches: number;
            totalSpawned: number;
            registeredMeshes: number;
        };
        shuriken: {
            qualityTier: string;
            compiledLayers: number;
            activeParticles: number;
            activeDrawCalls: number;
            warpActive: number;
        };
        shaderVariants: number;
        effects: {
            registeredCount: number;
            activeEffects: number;
            totalPlayed: number;
        };
        trails: {
            slashCap: number;
            boltCap: number;
            trailCap: number;
            trailNodes: number;
            activeTrails: number;
        };
        telegraphs: {
            capacity: number;
            totalSpawned: number;
        };
        floatingText: {
            capacity: number;
            popupCapacity: number;
            activePopups: number;
            activeGlyphs: number;
            totalEmitted: number;
            totalPopupsSpawned: number;
            totalCombined: number;
        };
    };
};
export const VFX_PRESETS: Readonly<{
    physical: Readonly<{
        color: 16765286;
        shape: 1;
        count: 10;
        speedMin: 3.5;
        speedMax: 9;
        sizeStart: 0.35;
        sizeEnd: 0.04;
        durationMin: 0.18;
        durationMax: 0.32;
        gravity: 12;
        drag: 4;
        stretch: 1;
        additive: true;
    }>;
    fire: Readonly<{
        color: 16347926;
        shape: 0;
        count: 14;
        speedMin: 2.5;
        speedMax: 7.5;
        sizeStart: 0.45;
        sizeEnd: 0.06;
        durationMin: 0.25;
        durationMax: 0.48;
        gravity: -4;
        drag: 2.8;
        stretch: 0.4;
        additive: true;
    }>;
    ice: Readonly<{
        color: 3718648;
        shape: 4;
        count: 12;
        speedMin: 3;
        speedMax: 8.5;
        sizeStart: 0.38;
        sizeEnd: 0.05;
        durationMin: 0.24;
        durationMax: 0.42;
        gravity: 10;
        drag: 3.2;
        stretch: 0.9;
        additive: true;
    }>;
    poison: Readonly<{
        color: 4906624;
        shape: 2;
        count: 10;
        speedMin: 1.5;
        speedMax: 4.5;
        sizeStart: 0.5;
        sizeEnd: 0.9;
        durationMin: 0.35;
        durationMax: 0.6;
        gravity: -2.5;
        drag: 3;
        stretch: 0;
        additive: false;
    }>;
    lightning: Readonly<{
        color: 6333946;
        shape: 1;
        count: 14;
        speedMin: 5;
        speedMax: 12;
        sizeStart: 0.34;
        sizeEnd: 0.03;
        durationMin: 0.14;
        durationMax: 0.26;
        gravity: 4;
        drag: 5;
        stretch: 1.4;
        additive: true;
    }>;
}>;
import { VFX_EASING } from './vfx-core.js';
import { VFX_RENDER_ORDERS } from './vfx-core.js';
import { CHAMFERED_OCTAGON_TRIS_2D } from './vfx-core.js';
import { createChamferedOctagonGeometry } from './vfx-core.js';
import { isMobileOrMiniGameEnv } from './vfx-core.js';
import { createOffscreen2dCanvas } from './vfx-core.js';
import { createVisualPrng } from './vfx-core.js';
import { packRgb24 } from './vfx-core.js';
import { unpackRgb24Into } from './vfx-core.js';
import { markAttributeRangeDirty } from './vfx-core.js';
import { submitRingBufferRanges } from './vfx-core.js';
import { createHitstopClock } from './vfx-core.js';
import { createCameraShake } from './vfx-core.js';
import { VFX_SHAPE } from './vfx-particles.js';
import { PARTICLE_VERTEX_GLSL } from './vfx-particles.js';
import { PARTICLE_FRAGMENT_GLSL } from './vfx-particles.js';
import { PARTICLE_WEBGL2_2D_VS } from './vfx-particles.js';
import { PARTICLE_WEBGL2_2D_FS } from './vfx-particles.js';
import { createStatelessParticlePool } from './vfx-particles.js';
import { GPU_PARTICLE_SIM_VS } from './vfx-gpu-particles.js';
import { GPU_PARTICLE_SIM_FS } from './vfx-gpu-particles.js';
import { GPU_PARTICLE_RENDER_VS } from './vfx-gpu-particles.js';
import { GPU_PARTICLE_RENDER_FS } from './vfx-gpu-particles.js';
import { GPU_PARTICLE_RENDER_2D_VS } from './vfx-gpu-particles.js';
import { GPU_PARTICLE_RENDER_2D_FS } from './vfx-gpu-particles.js';
import { createGpuParticleSystem } from './vfx-gpu-particles.js';
import { SLASH_VERTEX_GLSL } from './vfx-trails.js';
import { SLASH_FRAGMENT_GLSL } from './vfx-trails.js';
import { LIGHTNING_VERTEX_GLSL } from './vfx-trails.js';
import { LIGHTNING_FRAGMENT_GLSL } from './vfx-trails.js';
import { RIBBON_VERTEX_GLSL } from './vfx-trails.js';
import { RIBBON_FRAGMENT_GLSL } from './vfx-trails.js';
import { createTrailsSystem } from './vfx-trails.js';
import { TELEGRAPH_SHAPE } from './vfx-telegraph.js';
import { TELEGRAPH_VERTEX_GLSL } from './vfx-telegraph.js';
import { TELEGRAPH_FRAGMENT_GLSL } from './vfx-telegraph.js';
import { createTelegraphSystem } from './vfx-telegraph.js';
import { GLYPH_CHARS } from './vfx-floating-text.js';
import { DAMAGE_ATLAS_CHARS } from './vfx-damage-presets.js';
import { DAMAGE_NUMBER_PRESETS } from './vfx-damage-presets.js';
import { registerDamagePreset } from './vfx-damage-presets.js';
import { getDamagePreset } from './vfx-damage-presets.js';
import { formatDamageValue } from './vfx-damage-presets.js';
import { evaluateColorByNumber } from './vfx-damage-presets.js';
import { evaluateScaleByNumber } from './vfx-damage-presets.js';
import { extractGlyphIndices } from './vfx-floating-text.js';
import { bakeGlyphAtlasCanvas } from './vfx-floating-text.js';
import { FLOATING_TEXT_VERTEX_GLSL } from './vfx-floating-text.js';
import { FLOATING_TEXT_FRAGMENT_GLSL } from './vfx-floating-text.js';
import { FLOATING_TEXT_WEBGL2_2D_VS } from './vfx-floating-text.js';
import { FLOATING_TEXT_WEBGL2_2D_FS } from './vfx-floating-text.js';
import { createFloatingTextPool } from './vfx-floating-text.js';
import { CROWD_STATUS } from './vfx-screen-crowd.js';
import { packCrowdAnimStatus } from './vfx-screen-crowd.js';
import { unpackCrowdAnimStatus } from './vfx-screen-crowd.js';
import { SCREEN_FEEDBACK_VERTEX_GLSL } from './vfx-screen-crowd.js';
import { SCREEN_FEEDBACK_FRAGMENT_GLSL } from './vfx-screen-crowd.js';
import { createScreenFeedbackPass } from './vfx-screen-crowd.js';
import { VFX_RENDER_MODE } from './vfx-atlas-particles.js';
import { PROCEDURAL_VFX_ATLAS_REGIONS } from './vfx-atlas-particles.js';
import { ATLAS_PARTICLE_VERTEX_GLSL } from './vfx-atlas-particles.js';
import { ATLAS_PARTICLE_FRAGMENT_GLSL } from './vfx-atlas-particles.js';
import { ATLAS_PARTICLE_DISTORTION_FS } from './vfx-atlas-particles.js';
import { ATLAS_PARTICLE_WEBGL2_2D_VS } from './vfx-atlas-particles.js';
import { ATLAS_PARTICLE_WEBGL2_2D_FS } from './vfx-atlas-particles.js';
import { evaluateColorCurve } from './vfx-atlas-particles.js';
import { evaluateSizeCurve } from './vfx-atlas-particles.js';
import { createCurveLutTable } from './vfx-atlas-particles.js';
import { createProceduralVfxAtlas } from './vfx-atlas-particles.js';
import { evaluateAtlasParticlePosition } from './vfx-atlas-particles.js';
import { createAtlasParticlePool } from './vfx-atlas-particles.js';
import { VFX_MESH_VERTEX_GLSL } from './vfx-mesh.js';
import { VFX_MESH_FRAGMENT_GLSL } from './vfx-mesh.js';
import { VFX_MESH_INSTANCED_VS } from './vfx-mesh.js';
import { VFX_MESH_INSTANCED_FS } from './vfx-mesh.js';
import { createMeshVfxPool } from './vfx-mesh.js';
import { UBER_MAT_LUT_WIDTH } from './vfx-shader-chunks.js';
import { UBER_MAT_LUT_ROWS } from './vfx-shader-chunks.js';
import { UBER_SHADER_KIND } from './vfx-shader-chunks.js';
import { VFX_CURVE_LUT_SAMPLES } from './vfx-shader-chunks.js';
import { VFX_COMMON_GLSL } from './vfx-shader-chunks.js';
import { VFX_VERTEX_BUS_ATTRS_GLSL } from './vfx-shader-chunks.js';
import { VFX_VERTEX_SHELL_GLSL } from './vfx-shader-chunks.js';
import { createUberMaterialLut } from './vfx-shader-chunks.js';
import { compileCustomDataCurves } from './vfx-shader-chunks.js';
import { compileCurveLut16 } from './vfx-shader-chunks.js';
import { sampleCurveLut16 } from './vfx-shader-chunks.js';
import { compileMinMaxCurve } from './vfx-shader-chunks.js';
import { evaluateMinMaxCurve } from './vfx-shader-chunks.js';
import { srgbToLinear } from './vfx-shader-chunks.js';
import { compileMinMaxGradient } from './vfx-shader-chunks.js';
import { evaluateMinMaxGradient } from './vfx-shader-chunks.js';
import { registerShaderProfile } from './vfx-shader-profiles.js';
import { getShaderProfile } from './vfx-shader-profiles.js';
import { listShaderProfiles } from './vfx-shader-profiles.js';
import { resolveThreeRenderState } from './vfx-shader-profiles.js';
import { createProfileMaterial } from './vfx-shader-profiles.js';
import { getCompiledShaderVariantCount } from './vfx-shader-profiles.js';
import { resetCompiledShaderVariantTracker } from './vfx-shader-profiles.js';
import { SHURIKEN_QUALITY_TIERS } from './vfx-shuriken-kernel.js';
import { compileShurikenLayer } from './vfx-shuriken-kernel.js';
import { createShurikenKernel } from './vfx-shuriken-kernel.js';
import { VFX_MATERIAL_PRESETS } from './vfx-recipes.js';
import { createUberMaterialSpec } from './vfx-recipes.js';
import { defineVfxRecipe } from './vfx-recipes.js';
import { loadVfxPack } from './vfx-recipes.js';
import { validateVfxRecipe } from './vfx-recipes.js';
import { createEffectPlayer } from './vfx-recipes.js';
export { VFX_EASING, VFX_RENDER_ORDERS, CHAMFERED_OCTAGON_TRIS_2D, createChamferedOctagonGeometry, isMobileOrMiniGameEnv, createOffscreen2dCanvas, createVisualPrng, packRgb24, unpackRgb24Into, markAttributeRangeDirty, submitRingBufferRanges, createHitstopClock, createCameraShake, VFX_SHAPE, PARTICLE_VERTEX_GLSL, PARTICLE_FRAGMENT_GLSL, PARTICLE_WEBGL2_2D_VS, PARTICLE_WEBGL2_2D_FS, createStatelessParticlePool, GPU_PARTICLE_SIM_VS, GPU_PARTICLE_SIM_FS, GPU_PARTICLE_RENDER_VS, GPU_PARTICLE_RENDER_FS, GPU_PARTICLE_RENDER_2D_VS, GPU_PARTICLE_RENDER_2D_FS, createGpuParticleSystem, SLASH_VERTEX_GLSL, SLASH_FRAGMENT_GLSL, LIGHTNING_VERTEX_GLSL, LIGHTNING_FRAGMENT_GLSL, RIBBON_VERTEX_GLSL, RIBBON_FRAGMENT_GLSL, createTrailsSystem, TELEGRAPH_SHAPE, TELEGRAPH_VERTEX_GLSL, TELEGRAPH_FRAGMENT_GLSL, createTelegraphSystem, GLYPH_CHARS, DAMAGE_ATLAS_CHARS, DAMAGE_NUMBER_PRESETS, registerDamagePreset, getDamagePreset, formatDamageValue, evaluateColorByNumber, evaluateScaleByNumber, extractGlyphIndices, bakeGlyphAtlasCanvas, FLOATING_TEXT_VERTEX_GLSL, FLOATING_TEXT_FRAGMENT_GLSL, FLOATING_TEXT_WEBGL2_2D_VS, FLOATING_TEXT_WEBGL2_2D_FS, createFloatingTextPool, CROWD_STATUS, packCrowdAnimStatus, unpackCrowdAnimStatus, SCREEN_FEEDBACK_VERTEX_GLSL, SCREEN_FEEDBACK_FRAGMENT_GLSL, createScreenFeedbackPass, VFX_RENDER_MODE, PROCEDURAL_VFX_ATLAS_REGIONS, ATLAS_PARTICLE_VERTEX_GLSL, ATLAS_PARTICLE_FRAGMENT_GLSL, ATLAS_PARTICLE_DISTORTION_FS, ATLAS_PARTICLE_WEBGL2_2D_VS, ATLAS_PARTICLE_WEBGL2_2D_FS, evaluateColorCurve, evaluateSizeCurve, createCurveLutTable, createProceduralVfxAtlas, evaluateAtlasParticlePosition, createAtlasParticlePool, VFX_MESH_VERTEX_GLSL, VFX_MESH_FRAGMENT_GLSL, VFX_MESH_INSTANCED_VS, VFX_MESH_INSTANCED_FS, createMeshVfxPool, UBER_MAT_LUT_WIDTH, UBER_MAT_LUT_ROWS, UBER_SHADER_KIND, VFX_CURVE_LUT_SAMPLES, VFX_COMMON_GLSL, VFX_VERTEX_BUS_ATTRS_GLSL, VFX_VERTEX_SHELL_GLSL, createUberMaterialLut, compileCustomDataCurves, compileCurveLut16, sampleCurveLut16, compileMinMaxCurve, evaluateMinMaxCurve, srgbToLinear, compileMinMaxGradient, evaluateMinMaxGradient, registerShaderProfile, getShaderProfile, listShaderProfiles, resolveThreeRenderState, createProfileMaterial, getCompiledShaderVariantCount, resetCompiledShaderVariantTracker, SHURIKEN_QUALITY_TIERS, compileShurikenLayer, createShurikenKernel, VFX_MATERIAL_PRESETS, createUberMaterialSpec, defineVfxRecipe, loadVfxPack, validateVfxRecipe, createEffectPlayer };
