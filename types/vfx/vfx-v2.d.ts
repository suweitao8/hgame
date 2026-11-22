/**
 * Zero-GC VFX v2 runtime supporting VfxPresetV2 composite effects, SoA RingBuffers,
 * 4 renderers (sprite/mesh/ribbon/event), 4 motion modules, and high/med/low quality guardrails.
 */
export function createVfxV2Runtime({ mode, THREE, scene, trails, shake, prng, maxInstances, }?: {
    mode?: string | undefined;
    THREE?: null | undefined;
    scene?: null | undefined;
    trails?: null | undefined;
    shake?: null | undefined;
    prng?: {
        nextFloat(): number;
        range(min: any, max: any): any;
        reset(newSeed?: number): void;
    } | undefined;
    maxInstances?: number | undefined;
}): {
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
export const VFX_QUALITY_TIERS: Readonly<{
    high: Readonly<{
        scale: 1;
        softParticles: true;
        allowSecondary: true;
    }>;
    med: Readonly<{
        scale: 0.75;
        softParticles: false;
        allowSecondary: true;
    }>;
    low: Readonly<{
        scale: 0.5;
        softParticles: false;
        allowSecondary: false;
    }>;
}>;
import { validateVfxPresetV2 } from './vfx-v2-presets.js';
