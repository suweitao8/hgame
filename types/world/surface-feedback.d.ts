/**
 * Routes collision/raycast `surfaceType` hits to matching VFX recipes/particles,
 * decals, and 3D spatial audio cues.
 * @param {Record<string, any>} [options]
 */
export function createSurfaceFeedbackRouter({ vfx, decals, audio, table, }?: Record<string, any> | undefined): Readonly<{
    surfaceTypes: readonly string[];
    triggerImpact: ({ pos, normal, surfaceType, intensity, decal, decalMap, hitstopSec, shakeIntensity, playSound, }?: {
        pos?: number[] | undefined;
        normal?: number[] | undefined;
        surfaceType?: string | undefined;
        intensity?: number | undefined;
        decal?: null | undefined;
        decalMap?: null | undefined;
        hitstopSec?: number | undefined;
        shakeIntensity?: number | undefined;
        playSound?: boolean | undefined;
    }) => {
        surfaceType: string;
        vfxMode: string;
        decalHandle: any;
        audioPromise: any;
    };
    playFootstep: (surfaceType?: string, { pos, intensity, isRunning, }?: {
        pos?: null | undefined;
        intensity?: number | undefined;
        isRunning?: boolean | undefined;
    }) => any;
    resolveEntry: (surfaceType: any) => any;
}>;
export const SURFACE_TYPES: readonly string[];
export const DEFAULT_SURFACE_FEEDBACK_TABLE: Readonly<{
    asphalt: Readonly<{
        recipe: "impact_concrete";
        particle: Readonly<{
            shape: 2;
            color: 4937059;
            count: 8;
            speedMin: 1.8;
            speedMax: 5.2;
            sizeStart: 0.28;
            sizeEnd: 0.55;
            durationMin: 0.22;
            durationMax: 0.4;
            gravity: 6;
            drag: 3.5;
            additive: false;
        }>;
        decalColor: 2042167;
        decalSize: number[];
        decalOpacity: 0.82;
    }>;
    concrete: Readonly<{
        recipe: "impact_concrete";
        particle: Readonly<{
            shape: 2;
            color: 10265519;
            count: 10;
            speedMin: 2;
            speedMax: 5.8;
            sizeStart: 0.3;
            sizeEnd: 0.6;
            durationMin: 0.25;
            durationMax: 0.45;
            gravity: 7.5;
            drag: 3.5;
            additive: false;
        }>;
        decalColor: 3621201;
        decalSize: number[];
        decalOpacity: 0.85;
    }>;
    tile: Readonly<{
        recipe: "impact_concrete";
        particle: Readonly<{
            shape: 4;
            color: 15067115;
            count: 9;
            speedMin: 2.5;
            speedMax: 6.5;
            sizeStart: 0.22;
            sizeEnd: 0.04;
            durationMin: 0.2;
            durationMax: 0.36;
            gravity: 11;
            drag: 2.8;
            additive: false;
        }>;
        decalColor: 4937059;
        decalSize: number[];
        decalOpacity: 0.8;
    }>;
    wood: Readonly<{
        recipe: "impact_wood";
        particle: Readonly<{
            shape: 4;
            color: 11817737;
            count: 9;
            speedMin: 2.2;
            speedMax: 6;
            sizeStart: 0.24;
            sizeEnd: 0.05;
            durationMin: 0.22;
            durationMax: 0.38;
            gravity: 10;
            drag: 3;
            additive: false;
        }>;
        decalColor: 4528643;
        decalSize: number[];
        decalOpacity: 0.82;
    }>;
    metal: Readonly<{
        recipe: "impact_metal";
        particle: Readonly<{
            shape: 1;
            color: 16765286;
            count: 14;
            speedMin: 4.5;
            speedMax: 11.5;
            sizeStart: 0.26;
            sizeEnd: 0.03;
            durationMin: 0.14;
            durationMax: 0.28;
            gravity: 12;
            drag: 3.2;
            stretch: 1.35;
            additive: true;
        }>;
        decalColor: 1120295;
        decalSize: number[];
        decalOpacity: 0.85;
    }>;
    glass: Readonly<{
        recipe: "impact_glass";
        particle: Readonly<{
            shape: 4;
            color: 14742270;
            count: 12;
            speedMin: 3;
            speedMax: 8.5;
            sizeStart: 0.24;
            sizeEnd: 0.04;
            durationMin: 0.22;
            durationMax: 0.4;
            gravity: 12;
            drag: 2.4;
            additive: true;
        }>;
        decalColor: 13358561;
        decalSize: number[];
        decalOpacity: 0.72;
    }>;
    dirt: Readonly<{
        recipe: "impact_dirt";
        particle: Readonly<{
            shape: 2;
            color: 7877903;
            count: 10;
            speedMin: 1.8;
            speedMax: 5;
            sizeStart: 0.32;
            sizeEnd: 0.65;
            durationMin: 0.28;
            durationMax: 0.5;
            gravity: 8.5;
            drag: 3.6;
            additive: false;
        }>;
        decalColor: 3875604;
        decalSize: number[];
        decalOpacity: 0.78;
    }>;
    grass: Readonly<{
        recipe: "impact_grass";
        particle: Readonly<{
            shape: 4;
            color: 5078031;
            count: 9;
            speedMin: 2;
            speedMax: 5.2;
            sizeStart: 0.24;
            sizeEnd: 0.06;
            durationMin: 0.25;
            durationMax: 0.45;
            gravity: 9;
            drag: 3.4;
            additive: false;
        }>;
        decalColor: 3560212;
        decalSize: number[];
        decalOpacity: 0.65;
    }>;
    water: Readonly<{
        recipe: "impact_water";
        particle: Readonly<{
            shape: 3;
            color: 12248829;
            count: 8;
            speedMin: 1.5;
            speedMax: 4.5;
            sizeStart: 0.35;
            sizeEnd: 0.85;
            durationMin: 0.24;
            durationMax: 0.42;
            gravity: 8;
            drag: 3.2;
            additive: true;
        }>;
        decalColor: null;
        decalSize: null;
        decalOpacity: 0;
    }>;
    fabric: Readonly<{
        recipe: "impact_fabric";
        particle: Readonly<{
            shape: 2;
            color: 13751771;
            count: 6;
            speedMin: 1;
            speedMax: 3;
            sizeStart: 0.22;
            sizeEnd: 0.42;
            durationMin: 0.2;
            durationMax: 0.36;
            gravity: 2.5;
            drag: 4.2;
            additive: false;
        }>;
        decalColor: 2042167;
        decalSize: number[];
        decalOpacity: 0.55;
    }>;
}>;
