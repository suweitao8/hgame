/**
 * Unified 2D/3D/Headless zero-GC VFX & game-feel facade.
 * @param {object} [options]
 * @param {'headless' | 'canvas2d' | 'webgl2d' | '3d' | null} [options.mode=null]
 * @param {object | null} [options.sceneOrAdapter=null] Renderer adapter, scene or 2D context.
 * @param {object | null} [options.THREE] Three.js namespace for 3D rendering.
 * @param {number} [options.maxParticles]
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
export function createVfxSystem({ mode, sceneOrAdapter, THREE, maxParticles, maxAtlasParticles, maxMeshVfx, trailNodes, maxFloatingGlyphs, maxPopups, atlasTexture, atlasRegions, renderThroughWalls, seed, }?: {
    mode?: "3d" | "canvas2d" | "webgl2d" | "headless" | null | undefined;
    sceneOrAdapter?: object | null;
    THREE?: object | null;
    maxParticles?: number | undefined;
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
    atlasParticles: {
        readonly texture: any;
        capacity: number;
        lut: {
            bytes: Uint8Array;
            width: number;
            height: number;
            texture: any;
            readonly rowCount: number;
            compile: (colorCurveRaw: any, sizeCurveRaw: any, sizeYCurveRaw?: null, velocityCurveRaw?: null) => any;
            flush: () => void;
            sampleColor: (row: any, t: any, out?: Float32Array) => Float32Array;
            sampleSize: (row: any, t: any) => number;
            sampleSizeY: (row: any, t: any) => number;
            sampleVelDisp: (row: any, t: any) => number;
            dispose: () => void;
        };
        readonly regions: Record<string, readonly number[]>;
        compileCurves: (colorCurveRaw: any, sizeCurveRaw: any, sizeYCurveRaw?: null, velocityCurveRaw?: null) => any;
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
        setWind: (wx?: number, wy?: number, wz?: number) => void;
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
        registerMesh: (id: string, geometryOrObject3D: object) => boolean;
        getSurfaceSamples: (name: any) => any;
        spawn: (opts?: object) => number;
        readSlotMotion: (slotIdx: any, position: any, velocity: any) => void;
        updateSlot: (slotIdx: any, x: any, y: any, z: any, vx: any, vy: any, vz: any) => void;
        setWind: (wx?: number, wy?: number, wz?: number) => void;
        setEffectOffset: (slotIdx: any, x?: number, y?: number, z?: number) => void;
        setSceneTexture: (sceneTexture: any, { width, height }?: {
            width?: number | undefined;
            height?: number | undefined;
        }) => void;
        update: (visualDt: any) => void;
        reset: () => void;
        dispose: () => void;
        getStats(): {
            capacity: number;
            activeCount: number;
            totalSpawned: number;
            registeredMeshes: number;
        };
    };
    effects: {
        registerEffect: (recipe: object) => object;
        getEffect: (id: any) => any;
        playEffect: (recipeOrId: string | object, options?: object) => object | null;
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
    v2: {
        registerPresetV2: (preset: any) => Readonly<{
            schemaVersion: 2;
            id: any;
            name: any;
            category: any;
            duration: number;
            loop: boolean;
            boundsRadius: number;
            emitters: any;
        }>;
        getPresetV2: (id: any) => any;
        listPresetsV2: () => any[];
        validatePresetV2: typeof validateVfxPresetV2;
        playV2: (presetOrId: any, { x, y, z, lutOverride }?: {
            x?: number | undefined;
            y?: number | undefined;
            z?: number | undefined;
            lutOverride?: null | undefined;
        }) => number;
        stopV2: (uid: any) => boolean;
        setQualityTier: (nextTier: any) => void;
        getQualityTier: () => string;
        setDepthTexture: (tex: any, opts?: {}) => void;
        setGroundConfig: ({ enabled, groundY }?: {
            enabled?: boolean | undefined;
            groundY?: null | undefined;
        }) => void;
        setLutRowOverride: (rowOrNull: any) => void;
        setEventHandler: (fn: any) => void;
        registerTexture: (key: any, texture: any) => void;
        registerMesh: (kind: any, geometry: any) => void;
        getVfxMasterDefines: (matCfg: any) => Record<string, number>;
        update: (dt?: number, cameraPos?: null) => void;
        reset: () => void;
        dispose: () => void;
        getStats: () => {
            qualityTier: string;
            registeredPresets: number;
            activeInstances: number;
            activeEmitters: number;
            activeParticles: number;
            activeDrawCalls: number;
            shaderVariants: any[];
            totalSpawned: number;
            totalRecycled: number;
            nanCount: number;
        };
    };
    trails: {
        slashArc: (opts?: {}) => void;
        lightningBolt: (opts?: {}) => void;
        setTrailTexture: (texture: object | null, uvRect?: readonly number[] | undefined) => void;
        setAtlasRegions: (regions: Record<string, readonly number[]> | null) => void;
        setTrailWidthScale: (trackId: any, scale?: number) => void;
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
    setAtlas: (textureOrCanvas: object | null, newRegions?: Record<string, readonly number[]> | undefined, options?: {
        flipV?: boolean | null;
    } | undefined) => void;
    setDepthTexture(tex: any, opts: any): void;
    setSceneTexture(tex: any, opts: any): void;
    setWind(wx?: number, wy?: number, wz?: number): void;
    setCollisionResolver: (fn: any) => void;
    setTrailTexture: (texture: object | null, uvRect?: readonly number[] | undefined) => void;
    registerTexture: (key: any, texture: any) => void;
    registerMesh(kind: any, geometry: any): void;
    registerEffect: (recipe: object) => object;
    playEffect: (recipeOrId: string | object, options?: object) => object | null;
    stopAllEffects: () => void;
    registerPresetV2: (preset: any) => Readonly<{
        schemaVersion: 2;
        id: any;
        name: any;
        category: any;
        duration: number;
        loop: boolean;
        boundsRadius: number;
        emitters: any;
    }>;
    validatePresetV2: typeof validateVfxPresetV2;
    listPresetsV2: () => any[];
    playV2: (presetOrId: any, { x, y, z, lutOverride }?: {
        x?: number | undefined;
        y?: number | undefined;
        z?: number | undefined;
        lutOverride?: null | undefined;
    }) => number;
    stopV2: (uid: any) => boolean;
    setQualityTier: (nextTier: any) => void;
    getQualityTier: () => string;
    setV2GroundConfig: ({ enabled, groundY }?: {
        enabled?: boolean | undefined;
        groundY?: null | undefined;
    }) => void;
    setV2LutRowOverride: (rowOrNull: any) => void;
    setV2EventHandler: (fn: any) => void;
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
            totalSpawned: number;
            registeredMeshes: number;
        };
        effects: {
            registeredCount: number;
            activeEffects: number;
            totalPlayed: number;
        };
        v2: {
            qualityTier: string;
            registeredPresets: number;
            activeInstances: number;
            activeEmitters: number;
            activeParticles: number;
            activeDrawCalls: number;
            shaderVariants: any[];
            totalSpawned: number;
            totalRecycled: number;
            nanCount: number;
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
import { validateVfxPresetV2 } from './vfx-v2-presets.js';
import { VFX_EASING } from './vfx-core.js';
import { VFX_RENDER_ORDERS } from './vfx-core.js';
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
import { createMeshVfxPool } from './vfx-mesh.js';
import { validateVfxRecipe } from './vfx-recipes.js';
import { createEffectPlayer } from './vfx-recipes.js';
import { VFX_V2_SCHEMA_VERSION } from './vfx-v2-presets.js';
import { VFX_CURVE_LUT_SAMPLES } from './vfx-v2-presets.js';
import { VFX_V2_LUT_WIDTH } from './vfx-v2-shader.js';
import { VFX_V2_LUT_ROWS } from './vfx-v2-shader.js';
import { VFX_GRADIENT_LUT_NAMES } from './vfx-v2-shader.js';
import { VFX_COLOR_MODES } from './vfx-v2-shader.js';
import { VFX_QUALITY_TIERS } from './vfx-v2.js';
import { VFX_V2_BENCHMARK_PRESETS } from './vfx-v2-presets.js';
import { VFX_MASTER_VERTEX_GLSL } from './vfx-v2-shader.js';
import { VFX_MASTER_FRAGMENT_GLSL } from './vfx-v2-shader.js';
import { buildVfxGradientLutBytes } from './vfx-v2-shader.js';
import { createVfxGradientLutTexture } from './vfx-v2-shader.js';
import { createVfxV2DefaultTextures } from './vfx-v2-shader.js';
import { createVfxV2MeshGeometries } from './vfx-v2-shader.js';
import { getVfxMasterDefines } from './vfx-v2-shader.js';
import { createVfxMasterMaterial } from './vfx-v2-shader.js';
import { compileCurveLut16 } from './vfx-v2-presets.js';
import { sampleCurveLut16 } from './vfx-v2-presets.js';
import { compileVfxPresetV2 } from './vfx-v2-presets.js';
import { createVfxV2Runtime } from './vfx-v2.js';
export { VFX_EASING, VFX_RENDER_ORDERS, createVisualPrng, packRgb24, unpackRgb24Into, markAttributeRangeDirty, submitRingBufferRanges, createHitstopClock, createCameraShake, VFX_SHAPE, PARTICLE_VERTEX_GLSL, PARTICLE_FRAGMENT_GLSL, PARTICLE_WEBGL2_2D_VS, PARTICLE_WEBGL2_2D_FS, createStatelessParticlePool, SLASH_VERTEX_GLSL, SLASH_FRAGMENT_GLSL, LIGHTNING_VERTEX_GLSL, LIGHTNING_FRAGMENT_GLSL, RIBBON_VERTEX_GLSL, RIBBON_FRAGMENT_GLSL, createTrailsSystem, TELEGRAPH_SHAPE, TELEGRAPH_VERTEX_GLSL, TELEGRAPH_FRAGMENT_GLSL, createTelegraphSystem, GLYPH_CHARS, DAMAGE_ATLAS_CHARS, DAMAGE_NUMBER_PRESETS, registerDamagePreset, getDamagePreset, formatDamageValue, evaluateColorByNumber, evaluateScaleByNumber, extractGlyphIndices, bakeGlyphAtlasCanvas, FLOATING_TEXT_VERTEX_GLSL, FLOATING_TEXT_FRAGMENT_GLSL, FLOATING_TEXT_WEBGL2_2D_VS, FLOATING_TEXT_WEBGL2_2D_FS, createFloatingTextPool, CROWD_STATUS, packCrowdAnimStatus, unpackCrowdAnimStatus, SCREEN_FEEDBACK_VERTEX_GLSL, SCREEN_FEEDBACK_FRAGMENT_GLSL, createScreenFeedbackPass, VFX_RENDER_MODE, PROCEDURAL_VFX_ATLAS_REGIONS, ATLAS_PARTICLE_VERTEX_GLSL, ATLAS_PARTICLE_FRAGMENT_GLSL, ATLAS_PARTICLE_DISTORTION_FS, ATLAS_PARTICLE_WEBGL2_2D_VS, ATLAS_PARTICLE_WEBGL2_2D_FS, evaluateColorCurve, evaluateSizeCurve, createCurveLutTable, createProceduralVfxAtlas, evaluateAtlasParticlePosition, createAtlasParticlePool, VFX_MESH_VERTEX_GLSL, VFX_MESH_FRAGMENT_GLSL, createMeshVfxPool, validateVfxRecipe, createEffectPlayer, VFX_V2_SCHEMA_VERSION, VFX_CURVE_LUT_SAMPLES, VFX_V2_LUT_WIDTH, VFX_V2_LUT_ROWS, VFX_GRADIENT_LUT_NAMES, VFX_COLOR_MODES, VFX_QUALITY_TIERS, VFX_V2_BENCHMARK_PRESETS, VFX_MASTER_VERTEX_GLSL, VFX_MASTER_FRAGMENT_GLSL, buildVfxGradientLutBytes, createVfxGradientLutTexture, createVfxV2DefaultTextures, createVfxV2MeshGeometries, getVfxMasterDefines, createVfxMasterMaterial, compileCurveLut16, sampleCurveLut16, validateVfxPresetV2, compileVfxPresetV2, createVfxV2Runtime };
