/**
 * Pooled OBB-projected 3D Decal system with surface normal alignment,
 * polygonOffset anti-Z-fighting, lifetime fade-out, and zero-allocation ring reuse.
 * Never imports 'three' directly; callers inject { THREE }.
 */
/**
 * Create a fixed-capacity pooled 3D decal manager.
 * @param {object} THREE Three.js namespace or compatible mock.
 * @param {object} [options]
 * @param {number} [options.maxDecals=128] Maximum active decals before oldest ring-buffer recycling.
 * @param {number} [options.fadeSeconds=1.5] Default fade-out duration at the end of a decal lifetime.
 * @param {number} [options.polygonOffsetFactor=-4]
 * @param {number} [options.polygonOffsetUnits=-4]
 * @param {object | null} [options.group=null] Parent Three.js Group/Scene receiving decal meshes.
 */
export function createDecalSystem3D(THREE: object, { maxDecals, fadeSeconds, polygonOffsetFactor, polygonOffsetUnits, group, }?: {
    maxDecals?: number | undefined;
    fadeSeconds?: number | undefined;
    polygonOffsetFactor?: number | undefined;
    polygonOffsetUnits?: number | undefined;
    group?: object | null;
} | undefined): {
    readonly group: any;
    readonly capacity: number;
    spawn: ({ position, normal, size, rotation, color, map, opacity, lifetime, fadeSeconds: slotFade, }?: {
        position?: number[] | undefined;
        normal?: number[] | undefined;
        size?: number[] | undefined;
        rotation?: number | undefined;
        color?: number | undefined;
        map?: null | undefined;
        opacity?: number | undefined;
        lifetime?: number | undefined;
        fadeSeconds?: number | undefined;
    }) => {
        id: any;
        mesh: any;
        dispose: () => boolean;
    } | null;
    update: (dt?: number) => number;
    clear: () => void;
    getStats: () => {
        active: number;
        capacity: number;
        recycled: number;
        totalSpawned: number;
    };
    dispose: () => boolean;
};
