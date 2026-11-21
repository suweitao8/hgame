/**
 * Create a fixed-capacity pooled 3D decal manager.
 * @param {object} THREE Three.js namespace or compatible mock.
 * @param {object} [options]
 * @param {number} [options.maxDecals=128] Maximum active decals before oldest ring-buffer recycling.
 * @param {number} [options.fadeSeconds=1.5] Default fade-out duration at the end of a decal lifetime.
 * @param {number} [options.polygonOffsetFactor=-4]
 * @param {number} [options.polygonOffsetUnits=-4]
 * @param {'surface' | 'projected'} [options.mode='surface'] Rendering projection mode (`'projected'` reconstructs world positions from depth).
 * @param {object | null} [options.group=null] Parent Three.js Group/Scene receiving surface decal meshes.
 */
export function createDecalSystem3D(THREE: object, { maxDecals, fadeSeconds, polygonOffsetFactor, polygonOffsetUnits, mode, group, }?: {
    maxDecals?: number | undefined;
    fadeSeconds?: number | undefined;
    polygonOffsetFactor?: number | undefined;
    polygonOffsetUnits?: number | undefined;
    mode?: "surface" | "projected" | undefined;
    group?: object | null;
} | undefined): {
    readonly group: any;
    readonly projectedScene: any;
    readonly mode: string;
    readonly capacity: number;
    setMode: (nextMode: any) => string;
    spawn: ({ position, normal, size, rotation, color, map, opacity, lifetime, fadeSeconds: slotFade, edgeSoftness, roughnessTint, }?: {
        position?: number[] | undefined;
        normal?: number[] | undefined;
        size?: number[] | undefined;
        rotation?: number | undefined;
        color?: number | undefined;
        map?: null | undefined;
        opacity?: number | undefined;
        lifetime?: number | undefined;
        fadeSeconds?: number | undefined;
        edgeSoftness?: number | undefined;
        roughnessTint?: number | undefined;
    }) => {
        id: any;
        mesh: any;
        dispose: () => boolean;
    } | null;
    update: (dt?: number) => number;
    renderProjected: (renderer: any, camera: any, depthTexture: any, width: any, height: any, target?: null) => number;
    clear: () => void;
    getStats: () => {
        active: number;
        capacity: number;
        recycled: number;
        totalSpawned: number;
        mode: string;
    };
    dispose: () => boolean;
};
