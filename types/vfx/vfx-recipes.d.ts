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
 * @param {object | null} [options.atlasParticles=null]
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
export function createEffectPlayer({ atlasParticles, meshVfx, trails, telegraphs, hitstop, shake, screenFeedback, scene, THREE, is2D, prng, }?: {
    atlasParticles?: object | null;
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
