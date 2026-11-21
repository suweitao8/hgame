/**
 * Creates a high-level 3D atmosphere controller wrapping sky, post3d, material
 * shared wetness block, foliage/decal quality toggles, and audio indoor state.
 * @param {Record<string, any>} [options]
 */
export function createAtmosphere3D({ sky, postPipeline, sharedBlock, directionalLight, foliage, decals, audio, rainToggle, }?: Record<string, any> | undefined): Readonly<{
    readonly preset: Readonly<{
        id: "cn_cbd_day";
        skyPreset: "day";
        sunColor: 16775406;
        sunIntensity: 1.25;
        sunDirection: readonly number[];
        exposure: 1.05;
        bloomStrength: 0.22;
        contrast: 1.06;
        saturation: 1.04;
        vignette: 0.14;
    }>;
    readonly quality: any;
    readonly wetness: number;
    readonly isIndoor: boolean;
    setPreset: (presetIdOrConfig: any, { quality, wetness, transitionSec, }?: {
        quality?: null | undefined;
        wetness?: null | undefined;
        transitionSec?: number | undefined;
    }) => {
        preset: "cn_cbd_day";
        quality: any;
        wetness: number;
    };
    setWetness: (w: any) => number;
    setPlayerIndoor: (indoor: any, { transitionSec }?: {
        transitionSec?: number | undefined;
    }) => boolean;
    update: (dt?: number) => {
        preset: "cn_cbd_day";
        quality: any;
        wetness: number;
        indoor: boolean;
    };
}>;
export const ATMOSPHERE_PRESETS_CN: Readonly<{
    cn_cbd_day: Readonly<{
        id: "cn_cbd_day";
        skyPreset: "day";
        sunColor: 16775406;
        sunIntensity: 1.25;
        sunDirection: readonly number[];
        exposure: 1.05;
        bloomStrength: 0.22;
        contrast: 1.06;
        saturation: 1.04;
        vignette: 0.14;
    }>;
    cn_old_town_dusk: Readonly<{
        id: "cn_old_town_dusk";
        skyPreset: "goldenHour";
        sunColor: 16755302;
        sunIntensity: 1.1;
        sunDirection: readonly number[];
        exposure: 1.02;
        bloomStrength: 0.34;
        contrast: 1.08;
        saturation: 1.12;
        vignette: 0.22;
        colorGain: readonly number[];
    }>;
    cn_horror_night: Readonly<{
        id: "cn_horror_night";
        skyPreset: "night";
        sunColor: 8034754;
        sunIntensity: 0.38;
        sunDirection: readonly number[];
        exposure: 0.92;
        bloomStrength: 0.52;
        contrast: 1.12;
        saturation: 0.92;
        vignette: 0.34;
        colorLift: readonly number[];
    }>;
    cn_rural_morning: Readonly<{
        id: "cn_rural_morning";
        skyPreset: "day";
        sunColor: 16772050;
        sunIntensity: 0.95;
        sunDirection: readonly number[];
        exposure: 1;
        bloomStrength: 0.28;
        contrast: 1;
        saturation: 1.05;
        vignette: 0.16;
    }>;
}>;
