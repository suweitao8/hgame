/**
 * Unified 2D/3D/Headless zero-GC VFX & game-feel facade.
 * @param {object} [options]
 * @param {'headless' | 'canvas2d' | 'webgl2d' | '3d' | null} [options.mode=null]
 * @param {object | null} [options.sceneOrAdapter=null] Renderer adapter, scene or 2D context.
 * @param {object | null} [options.THREE] Three.js namespace for 3D rendering.
 * @param {number} [options.maxParticles]
 * @param {number} [options.maxFloatingGlyphs]
 * @param {number} [options.seed=0x9e3779b9]
 */
export function createVfxSystem({ mode, sceneOrAdapter, THREE, maxParticles, maxFloatingGlyphs, seed, }?: {
    mode?: "3d" | "canvas2d" | "webgl2d" | "headless" | null | undefined;
    sceneOrAdapter?: object | null;
    THREE?: object | null;
    maxParticles?: number | undefined;
    maxFloatingGlyphs?: number | undefined;
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
    trails: {
        slashArc: (opts?: {}) => void;
        lightningBolt: (opts?: {}) => void;
        allocTrail: (color?: number, width?: number) => number;
        pushTrailPoint: (trackId: any, x: any, y: any, z?: number) => void;
        freeTrail: (trackId: any) => void;
        update: (visualDt: any) => void;
        renderCanvas2D: (ctx: any, camera: any, viewWidth: any, viewHeight: any) => void;
        reset: () => void;
        dispose: () => void;
        getStats(): {
            slashCap: number;
            boltCap: number;
            trailCap: number;
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
        popupNumber: (opts?: {}) => number;
        update: (visualDt: any) => void;
        renderCanvas2D: (ctx: any, camera: any, viewWidth: any, viewHeight: any) => void;
        reset: () => void;
        dispose: () => void;
        getStats(): {
            capacity: number;
            totalEmitted: number;
            cursor: number;
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
    emitHitImpact: ({ x, y, z, damage, isCrit, isHeal, isMiss, dirX, dirY, dirZ, element, hitstopSec, shakeIntensity, }?: {
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
        hitstopSec?: number | undefined;
        shakeIntensity?: number | undefined;
    } | undefined) => void;
    burstParticles: (presetOrConfig: any) => void;
    slashArc: (opts?: {}) => void;
    lightningBolt: (opts?: {}) => void;
    allocTrail: (color?: number, width?: number) => number;
    pushTrailPoint: (trackId: any, x: any, y: any, z?: number) => void;
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
    popupNumber: (opts?: {}) => number;
    screenPulse: ({ ndcX, ndcY, strength, duration, color, }?: {
        ndcX?: number | undefined;
        ndcY?: number | undefined;
        strength?: number | undefined;
        duration?: number | undefined;
        color?: number | undefined;
    }) => void;
    setLowHpIntensity: (intensity: any) => void;
    setSpeedLines: (intensity: any) => void;
    update: (rawDt?: number) => {
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
        trails: {
            slashCap: number;
            boltCap: number;
            trailCap: number;
            activeTrails: number;
        };
        telegraphs: {
            capacity: number;
            totalSpawned: number;
        };
        floatingText: {
            capacity: number;
            totalEmitted: number;
            cursor: number;
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
import { extractGlyphIndices } from './vfx-floating-text.js';
import { bakeGlyphAtlasCanvas } from './vfx-floating-text.js';
import { FLOATING_TEXT_VERTEX_GLSL } from './vfx-floating-text.js';
import { FLOATING_TEXT_FRAGMENT_GLSL } from './vfx-floating-text.js';
import { createFloatingTextPool } from './vfx-floating-text.js';
import { CROWD_STATUS } from './vfx-screen-crowd.js';
import { packCrowdAnimStatus } from './vfx-screen-crowd.js';
import { unpackCrowdAnimStatus } from './vfx-screen-crowd.js';
import { SCREEN_FEEDBACK_VERTEX_GLSL } from './vfx-screen-crowd.js';
import { SCREEN_FEEDBACK_FRAGMENT_GLSL } from './vfx-screen-crowd.js';
import { createScreenFeedbackPass } from './vfx-screen-crowd.js';
export { VFX_EASING, VFX_RENDER_ORDERS, createVisualPrng, packRgb24, unpackRgb24Into, markAttributeRangeDirty, submitRingBufferRanges, createHitstopClock, createCameraShake, VFX_SHAPE, PARTICLE_VERTEX_GLSL, PARTICLE_FRAGMENT_GLSL, PARTICLE_WEBGL2_2D_VS, PARTICLE_WEBGL2_2D_FS, createStatelessParticlePool, SLASH_VERTEX_GLSL, SLASH_FRAGMENT_GLSL, LIGHTNING_VERTEX_GLSL, LIGHTNING_FRAGMENT_GLSL, RIBBON_VERTEX_GLSL, RIBBON_FRAGMENT_GLSL, createTrailsSystem, TELEGRAPH_SHAPE, TELEGRAPH_VERTEX_GLSL, TELEGRAPH_FRAGMENT_GLSL, createTelegraphSystem, GLYPH_CHARS, extractGlyphIndices, bakeGlyphAtlasCanvas, FLOATING_TEXT_VERTEX_GLSL, FLOATING_TEXT_FRAGMENT_GLSL, createFloatingTextPool, CROWD_STATUS, packCrowdAnimStatus, unpackCrowdAnimStatus, SCREEN_FEEDBACK_VERTEX_GLSL, SCREEN_FEEDBACK_FRAGMENT_GLSL, createScreenFeedbackPass };
