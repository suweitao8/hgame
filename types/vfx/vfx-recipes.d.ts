/**
 * Validates a declarative `.vfx.json` composite effect recipe (`schemaVersion === 1`).
 * @param {object} recipe
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateVfxRecipe(recipe: object): {
    ok: boolean;
    errors: string[];
};
/**
 * Creates a zero-GC composite `.vfx.json` recipe player on top of HGame VFX subsystems.
 * @param {object} [options]
 * @param {object | null} [options.shurikenKernel=null]
 * @param {object | null} [options.atlasParticles=null]
 * @param {object | null} [options.gpuParticles=null]
 * @param {object | null} [options.meshVfx=null]
 * @param {object | null} [options.trails=null]
 * @param {object | null} [options.telegraphs=null]
 * @param {object | null} [options.hitstop=null]
 * @param {object | null} [options.shake=null]
 * @param {object | null} [options.screenFeedback=null]
 * @param {object | null} [options.scene=null]
 * @param {object | null} [options.THREE=null]
 * @param {boolean} [options.is2D=false]
 * @param {ReturnType<typeof createVisualPrng>} [options.prng]
 */
export function createEffectPlayer({ shurikenKernel, atlasParticles, gpuParticles, meshVfx, trails, telegraphs, hitstop, shake, screenFeedback, scene, THREE, is2D, prng, }?: {
    shurikenKernel?: object | null;
    atlasParticles?: object | null;
    gpuParticles?: object | null;
    meshVfx?: object | null;
    trails?: object | null;
    telegraphs?: object | null;
    hitstop?: object | null;
    shake?: object | null;
    screenFeedback?: object | null;
    scene?: object | null;
    THREE?: object | null;
    is2D?: boolean | undefined;
    prng?: {
        nextFloat(): number;
        range(min: any, max: any): any;
        reset(newSeed?: number): void;
    } | undefined;
} | undefined): {
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
/**
 * Builds a normalized `uberMat` material spec from a named preset (`glow`, `smoke`,
 * `dissolve`, `ribbon`, `warp`, `pbr`) plus optional property overrides.
 * @param {'glow'|'smoke'|'dissolve'|'ribbon'|'warp'|'pbr'} [preset='glow']
 * @param {Record<string, any>} [overrides={}]
 * @returns {Record<string, any>}
 */
export function createUberMaterialSpec(preset?: "pbr" | "dissolve" | "glow" | "smoke" | "ribbon" | "warp" | undefined, overrides?: Record<string, any> | undefined): Record<string, any>;
/**
 * Normalizes defaults for hand-authored or DSL-style VFX recipes, resolves shorthand
 * `layer.uberMat` preset strings, and validates against `validateVfxRecipe`.
 * Throws a descriptive error if validation fails.
 * @param {object} spec
 * @returns {object}
 */
export function defineVfxRecipe(spec: object): object;
/**
 * Loads a built `vfx-pack.manifest.json` (atlas + regions + GLB meshes/submeshes + recipes)
 * and registers everything onto a `vfx` system in one call.
 * @param {any} vfx
 * @param {string} manifestUrl
 * @param {object} [options]
 * @param {any} [options.THREE=null]
 * @param {any} [options.gltfLoader=null]
 * @param {typeof globalThis.fetch} [options.fetchFn=globalThis.fetch]
 * @param {string | null} [options.baseUrl=null]
 * @returns {Promise<{ manifest: any, recipeIds: string[], meshCount: number, regionCount: number }>}
 */
export function loadVfxPack(vfx: any, manifestUrl: string, { THREE, gltfLoader, fetchFn, baseUrl, }?: {
    THREE?: any;
    gltfLoader?: any;
    fetchFn?: typeof fetch | undefined;
    baseUrl?: string | null | undefined;
} | undefined): Promise<{
    manifest: any;
    recipeIds: string[];
    meshCount: number;
    regionCount: number;
}>;
/**
 * Built-in ergonomic material presets for `createUberMaterialSpec`.
 */
export const VFX_MATERIAL_PRESETS: Readonly<{
    glow: Readonly<{
        shaderKind: "uber_fx";
        blend: "additive";
        keywords: readonly string[];
        mainChannelMask: readonly number[];
        mainAlphaMask: readonly number[];
        desaturate: 0;
        softFadeFactor: 0.12;
    }>;
    smoke: Readonly<{
        shaderKind: "uber_fx";
        blend: "alpha";
        keywords: readonly string[];
        mainChannelMask: readonly number[];
        mainAlphaMask: readonly number[];
        desaturate: 0.15;
        softFadeFactor: 0.25;
    }>;
    dissolve: Readonly<{
        shaderKind: "uber_fx";
        blend: "alpha";
        keywords: readonly string[];
        mainChannelMask: readonly number[];
        mainAlphaMask: readonly number[];
        detailDissolveChannel: readonly number[];
        dissolveFadeRange: readonly number[];
        softFadeFactor: 0.12;
    }>;
    ribbon: Readonly<{
        shaderKind: "uber_fx";
        blend: "premultiply";
        keywords: readonly string[];
        mainChannelMask: readonly number[];
        mainAlphaMask: readonly number[];
        doubleSided: true;
    }>;
    warp: Readonly<{
        shaderKind: "piloto_warp";
        blend: "distortion";
        keywords: readonly string[];
        distortionStrength: 0.04;
        softFadeFactor: 0.2;
    }>;
    pbr: Readonly<{
        shaderKind: "pbr_fx";
        blend: "alpha";
        opaque: false;
        keywords: readonly string[];
        smoothnessScale: 0.45;
        metallicScale: 0;
        selfIlluminationIntensity: 0.8;
    }>;
}>;
