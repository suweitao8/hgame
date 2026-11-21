/**
 * Build a GPU-instanced foliage / grass field with deterministic seeded placement,
 * real-time GPU vertex wind sway, character trampling bend (`setTrampler`), and smooth
 * screen-space 4x4 Bayer distance dither fade in a single `THREE.InstancedMesh` draw call.
 *
 * @param {any} THREE Three.js namespace or compatible mock.
 * @param {object} [options]
 * @param {any} [options.geometry] Custom blade geometry; defaults to an upright tapered quad.
 * @param {number} [options.count=400] Instance count.
 * @param {number} [options.areaSize=24] Square placement extent centered at origin.
 * @param {number} [options.minScale=0.7]
 * @param {number} [options.maxScale=1.35]
 * @param {number} [options.windAmp=0.16]
 * @param {number} [options.windFreq=2.4]
 * @param {number} [options.fadeNear=18] Distance where Bayer fade begins.
 * @param {number} [options.fadeFar=36] Distance where blades completely fade out.
 * @param {number} [options.trampleRadius=1.4] Radius around trampler bending blades away.
 * @param {number} [options.colorBase=0x166534]
 * @param {number} [options.colorTip=0x4ade80]
 * @param {number} [options.seed=1337]
 */
export function createInstancedFoliage3D(THREE: any, { geometry, count, areaSize, minScale, maxScale, windAmp, windFreq, fadeNear, fadeFar, trampleRadius, colorBase, colorTip, seed, }?: {
    geometry?: any;
    count?: number | undefined;
    areaSize?: number | undefined;
    minScale?: number | undefined;
    maxScale?: number | undefined;
    windAmp?: number | undefined;
    windFreq?: number | undefined;
    fadeNear?: number | undefined;
    fadeFar?: number | undefined;
    trampleRadius?: number | undefined;
    colorBase?: number | undefined;
    colorTip?: number | undefined;
    seed?: number | undefined;
} | undefined): Readonly<{
    mesh: any;
    material: any;
    uniforms: {
        uFoliageTime: {
            value: number;
        };
        uWindAmp: {
            value: number;
        };
        uWindFreq: {
            value: number;
        };
        uTramplePos: {
            value: any;
        };
        uTrampleRadius: {
            value: number;
        };
        uFadeNear: {
            value: number;
        };
        uFadeFar: {
            value: number;
        };
    };
    count: number;
    update: (dt?: number, tramplerPos?: null) => void;
    setTrampler: (x: any, y?: number, z?: number) => void;
    setWind: (amp: any, freq: any) => void;
    dispose: () => void;
}>;
