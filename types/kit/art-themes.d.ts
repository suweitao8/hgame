/**
 * List available art theme IDs.
 * @returns {string[]}
 */
export function listArtThemes(): string[];
/**
 * Resolve an art theme preset by ID (falls back to `'scifi'` when omitted).
 * @param {string} [themeId='scifi']
 * @returns {ArtThemePreset}
 */
export function getArtTheme(themeId?: string | undefined): ArtThemePreset;
/**
 * Build a ready-to-use `presentation.json` object for 2D, 3D, or top-down starters from an art theme.
 * @param {string} [themeId='scifi']
 * @param {'2d' | '3d' | 'topdown' | 'ui'} [perspective='2d']
 * @param {string} [quality='auto']
 */
export function resolvePresentationPreset(themeId?: string | undefined, perspective?: "2d" | "3d" | "ui" | "topdown" | undefined, quality?: string | undefined): {
    quality: string;
    theme: string;
    sky: null;
    chunkCells: number;
    startupModelSlots: never[];
    renderer: {
        cameraFov: 42;
        cameraPosition: number[];
        cameraTarget: number[];
        limitCameraDrawDistance: boolean;
        background: "#0c111b";
        toneMapping: "ueFilmic";
        exposure: number;
        shadows: boolean;
        worldLighting: {
            fog: {
                near: number;
                far: number;
            };
            hemisphere: {
                sky: "#b6d0f2";
                ground: "#171f2e";
                intensity: 0.38;
            };
            sun: {
                color: "#fff5e6";
                intensity: 2.45;
                position: number[];
                shadow: {
                    extent: 32;
                    near: 1;
                    far: 105;
                    mapSize: 1024;
                    bias: -0.00025;
                    normalBias: 0.035;
                    adaptiveExtent: true;
                };
            };
            fill: {
                color: "#6d8ec4";
                intensity: 0.24;
                position: number[];
            };
        };
    };
    backend?: undefined;
    background?: undefined;
    lighting2d?: undefined;
    palette?: undefined;
} | {
    quality: string;
    theme: string;
    sky: {
        preset: "day" | "goldenHour" | "night" | "overcast" | "dusk";
        environment: boolean;
    };
    chunkCells: number;
    startupModelSlots: never[];
    renderer: {
        cameraPosition: number[];
        cameraTarget: number[];
        limitCameraDrawDistance: boolean;
        background: string;
        toneMapping: "ueFilmic";
        exposure: number;
        shadows: boolean;
        worldLighting: {
            fog: {
                near: number;
                far: number;
            };
            hemisphere: {
                sky: string;
                ground: string;
                intensity: number;
            };
            sun: {
                color: string;
                intensity: number;
                position: number[];
                shadow: {
                    extent: number;
                    near: number;
                    far: number;
                    mapSize: number;
                    bias: number;
                    normalBias: number;
                    adaptiveExtent: boolean;
                };
            };
            fill?: undefined;
        };
        cameraFov?: undefined;
    };
    backend?: undefined;
    background?: undefined;
    lighting2d?: undefined;
    palette?: undefined;
} | {
    quality: string;
    theme: string;
    backend: string;
    background: string;
    lighting2d: {
        ambient: string;
        ambientIntensity: number;
        bloomStrength: number;
        vignette: number;
    };
    palette: {
        bg: string;
        surface: string;
        primary: string;
        secondary: string;
        accent: string;
        player: string;
        enemy: string;
        projectile: string;
        danger: string;
        heal: string;
        gold: string;
    };
    sky?: undefined;
    chunkCells?: undefined;
    startupModelSlots?: undefined;
    renderer?: undefined;
};
/**
 * Canonical cross-discipline art rules enforced across HGame templates.
 */
export const STANDARD_ART_SPEC: Readonly<{
    unitScale: "1 unit = 1 meter (3D), 1 px = logical design unit (2D)";
    groundPivot: "bottom-center";
    actor2dBackground: "#FFFFFF";
    actor2dShadowFree: true;
    character3dMaxVertices: 3000;
    character3dHandPose: "semi-clenched-grip";
    toneMapping: "ueFilmic";
}>;
/**
 * Canonical LoL-inspired top-down lighting & shadow preset:
 * top-left overhead sun `[-24, 44, -18]` casting cool deep slate shadows bottom-right,
 * low olive-free ground bounce, and subtle opposite cool fill.
 */
export const TOPDOWN_LIGHTING_PRESET: Readonly<{
    cameraFov: 42;
    cameraPosition: readonly number[];
    cameraTarget: readonly number[];
    background: "#0c111b";
    hemisphere: Readonly<{
        sky: "#b6d0f2";
        ground: "#171f2e";
        intensity: 0.38;
    }>;
    sun: Readonly<{
        color: "#fff5e6";
        intensity: 2.45;
        position: readonly number[];
        shadow: Readonly<{
            extent: 32;
            near: 1;
            far: 105;
            mapSize: 1024;
            bias: -0.00025;
            normalBias: 0.035;
            adaptiveExtent: true;
        }>;
    }>;
    fill: Readonly<{
        color: "#6d8ec4";
        intensity: 0.24;
        position: readonly number[];
    }>;
}>;
/**
 * @typedef {object} ArtThemePreset
 * @property {string} id
 * @property {'scifi' | 'arcane' | 'arcade' | 'cyber'} uiTheme
 * @property {'cyber' | 'dungeon' | 'adventure' | 'chill'} audioMood
 * @property {{ bg: string, surface: string, primary: string, secondary: string, accent: string, player: string, enemy: string, projectile: string, danger: string, heal: string, gold: string }} palette
 * @property {{ ambient: string, ambientIntensity: number, bloomStrength: number, vignette: number }} lighting2d
 * @property {{ background: string, skyPreset: 'day' | 'goldenHour' | 'overcast' | 'dusk' | 'night', toneMapping: 'ueFilmic', exposure: number, fog: { near: number, far: number }, hemisphere: { sky: string, ground: string, intensity: number }, sun: { color: string, intensity: number } }} presentation3d
 * @property {{ hitColor: string, slashColor: string, pickupColor: string, damagePreset: string }} vfx
 * @property {{ hitStopMs: number, traumaMax: number }} camera
 */
/** @type {Record<string, ArtThemePreset>} */
export const ART_THEMES: Record<string, ArtThemePreset>;
export type ArtThemePreset = {
    id: string;
    uiTheme: "scifi" | "arcane" | "arcade" | "cyber";
    audioMood: "cyber" | "dungeon" | "adventure" | "chill";
    palette: {
        bg: string;
        surface: string;
        primary: string;
        secondary: string;
        accent: string;
        player: string;
        enemy: string;
        projectile: string;
        danger: string;
        heal: string;
        gold: string;
    };
    lighting2d: {
        ambient: string;
        ambientIntensity: number;
        bloomStrength: number;
        vignette: number;
    };
    presentation3d: {
        background: string;
        skyPreset: "day" | "goldenHour" | "overcast" | "dusk" | "night";
        toneMapping: "ueFilmic";
        exposure: number;
        fog: {
            near: number;
            far: number;
        };
        hemisphere: {
            sky: string;
            ground: string;
            intensity: number;
        };
        sun: {
            color: string;
            intensity: number;
        };
    };
    vfx: {
        hitColor: string;
        slashColor: string;
        pickupColor: string;
        damagePreset: string;
    };
    camera: {
        hitStopMs: number;
        traumaMax: number;
    };
};
