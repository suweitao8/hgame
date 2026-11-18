/**
 * Looks up a character's glyph index in the 64-glyph damage atlas, or -1 if absent.
 * @param {string} ch
 * @returns {number}
 */
export function lookupDamageGlyph(ch: string): number;
/**
 * Formats a numeric damage/heal/currency value according to digit display rules
 * (decimals, trailing-zero trimming, grouping separators, and suffix shortening).
 * @param {number} value
 * @param {object} [opts]
 * @returns {string}
 */
export function formatDamageValue(value: number, opts?: object): string;
/**
 * Computes an RGB24 color for a damage magnitude using either a 2-color range or multi-stop gradient.
 * @param {number} value
 * @param {object} cfg
 * @returns {number} 0xRRGGBB
 */
export function evaluateColorByNumber(value: number, cfg: object): number;
/**
 * Computes a scale multiplier for a damage magnitude across `[fromNumber, toNumber]`.
 * @param {number} value
 * @param {object} cfg
 * @returns {number}
 */
export function evaluateScaleByNumber(value: number, cfg: object): number;
/**
 * Registers or overrides a named damage number preset for reuse across `popupNumber({ preset })`.
 * @param {string} name
 * @param {object} config
 */
export function registerDamagePreset(name: string, config: object): void;
/**
 * Retrieves a registered or built-in damage number preset by name.
 * @param {string} name
 * @returns {object | null}
 */
export function getDamagePreset(name: string): object | null;
export const DAMAGE_ATLAS_CHARS: readonly string[];
/**
 * Built-in clean-room damage number presets (2D/3D normalized; distances/offsets scale cleanly per mode).
 */
export const DAMAGE_NUMBER_PRESETS: Readonly<{
    normal: Readonly<{
        color: 16777215;
        lifetime: 0.7;
        durationFadeIn: 0.14;
        durationFadeOut: 0.22;
        scaleFadeIn: readonly number[];
        offsetFadeIn: readonly number[];
        offsetFadeOut: readonly number[];
        lerp: Readonly<{
            minX: -0.45;
            maxX: 0.45;
            minY: 0.55;
            maxY: 1;
            speed: 6.5;
        }>;
        collision: Readonly<{
            radius: 0.45;
            pushFactor: 1;
        }>;
    }>;
    crit: Readonly<{
        color: 16436245;
        isCrit: true;
        scaleMultiplier: 1.38;
        lifetime: 0.92;
        durationFadeIn: 0.16;
        durationFadeOut: 0.24;
        scaleFadeIn: readonly number[];
        crossScaleFadeIn: readonly number[];
        offsetFadeIn: readonly number[];
        offsetFadeOut: readonly number[];
        lerp: Readonly<{
            minX: 0.3;
            maxX: 0.75;
            minY: 0.75;
            maxY: 1.25;
            speed: 5.5;
            randomFlip: true;
        }>;
        shake: Readonly<{
            offsetX: 0.04;
            offsetY: 0.04;
            frequency: 52;
        }>;
        startRotation: readonly number[];
        colorByNumber: Readonly<{
            fromNumber: 150;
            toNumber: 2500;
            fromColor: 16436245;
            toColor: 16726832;
        }>;
        scaleByNumber: Readonly<{
            fromNumber: 150;
            toNumber: 2500;
            fromScale: 1;
            toScale: 1.5;
        }>;
        collision: Readonly<{
            radius: 0.55;
            pushFactor: 1.15;
        }>;
    }>;
    heal: Readonly<{
        color: 4906624;
        isHeal: true;
        leftText: "+";
        lifetime: 0.85;
        durationFadeIn: 0.16;
        durationFadeOut: 0.26;
        scaleFadeIn: readonly number[];
        offsetFadeIn: readonly number[];
        lerp: Readonly<{
            minX: -0.25;
            maxX: 0.25;
            minY: 0.95;
            maxY: 1.35;
            speed: 3.8;
        }>;
    }>;
    miss: Readonly<{
        color: 9741240;
        isMiss: true;
        enableNumber: false;
        leftText: "MISS";
        lifetime: 0.65;
        durationFadeIn: 0.12;
        durationFadeOut: 0.2;
        scaleFadeIn: readonly number[];
        lerp: Readonly<{
            minX: 0.35;
            maxX: 0.65;
            minY: 0.35;
            maxY: 0.65;
            speed: 6;
            randomFlip: true;
        }>;
    }>;
    block: Readonly<{
        color: 6333946;
        enableNumber: false;
        leftText: "格挡";
        lifetime: 0.72;
        durationFadeIn: 0.12;
        durationFadeOut: 0.22;
        scaleFadeIn: readonly number[];
        shakeFadeIn: Readonly<{
            offsetX: 0.18;
            offsetY: 0;
            frequency: 28;
        }>;
        lerp: Readonly<{
            minX: -0.2;
            maxX: 0.2;
            minY: 0.55;
            maxY: 0.85;
            speed: 5;
        }>;
    }>;
    immune: Readonly<{
        color: 13358561;
        enableNumber: false;
        leftText: "免疫";
        lifetime: 0.7;
        durationFadeIn: 0.12;
        durationFadeOut: 0.22;
        scaleFadeIn: readonly number[];
        lerp: Readonly<{
            minX: -0.15;
            maxX: 0.15;
            minY: 0.6;
            maxY: 0.85;
            speed: 4.5;
        }>;
    }>;
    combo: Readonly<{
        color: 16486972;
        topText: "连击";
        topColor: 16707722;
        topScale: 0.68;
        scaleMultiplier: 1.22;
        lifetime: 1.05;
        durationFadeIn: 0.14;
        durationFadeOut: 0.25;
        scaleFadeIn: readonly number[];
        lerp: Readonly<{
            minX: -0.18;
            maxX: 0.18;
            minY: 0.75;
            maxY: 1;
            speed: 4;
        }>;
        combination: Readonly<{
            method: "absorbNew";
            maxDistance: 2.2;
            bonusLifetime: 0.45;
            spawnDelay: 0.05;
            absorbDuration: 0.22;
            moveToAbsorber: true;
            instantGain: false;
            absorberScaleFactor: 1.42;
            absorberScaleFade: 12;
        }>;
        colorByNumber: Readonly<{
            fromNumber: 100;
            toNumber: 5000;
            fromColor: 16486972;
            toColor: 15680580;
        }>;
        scaleByNumber: Readonly<{
            fromNumber: 100;
            toNumber: 5000;
            fromScale: 1;
            toScale: 1.45;
        }>;
    }>;
    fire: Readonly<{
        color: 16347926;
        lifetime: 0.75;
        durationFadeIn: 0.1;
        durationFadeOut: 0.22;
        velocity: Readonly<{
            minX: 0.45;
            maxX: 1.15;
            minY: 2.4;
            maxY: 3.4;
            randomFlip: true;
            dragX: 0.4;
            dragY: 0.8;
            gravity: 5.5;
        }>;
        shake: Readonly<{
            offsetX: 0.025;
            offsetY: 0.025;
            frequency: 44;
        }>;
    }>;
    ice: Readonly<{
        color: 3718648;
        lifetime: 0.78;
        durationFadeIn: 0.12;
        durationFadeOut: 0.22;
        scaleFadeIn: readonly number[];
        lerp: Readonly<{
            minX: 0.35;
            maxX: 0.75;
            minY: 0.5;
            maxY: 0.9;
            speed: 5.2;
            randomFlip: true;
        }>;
    }>;
    lightning: Readonly<{
        color: 10875900;
        lifetime: 0.7;
        durationFadeIn: 0.08;
        durationFadeOut: 0.18;
        scaleFadeIn: readonly number[];
        shake: Readonly<{
            offsetX: 0.055;
            offsetY: 0.035;
            frequency: 65;
        }>;
        lerp: Readonly<{
            minX: -0.5;
            maxX: 0.5;
            minY: 0.65;
            maxY: 1.15;
            speed: 7.5;
        }>;
    }>;
    poison: Readonly<{
        color: 8702998;
        scaleMultiplier: 0.88;
        lifetime: 0.88;
        durationFadeIn: 0.15;
        durationFadeOut: 0.28;
        lerp: Readonly<{
            minX: -0.25;
            maxX: 0.25;
            minY: 0.85;
            maxY: 1.25;
            speed: 2.8;
        }>;
    }>;
    gold: Readonly<{
        color: 16498468;
        leftText: "+";
        rightText: "G";
        digits: Readonly<{
            suffixShorten: true;
        }>;
        lifetime: 0.95;
        durationFadeIn: 0.14;
        durationFadeOut: 0.25;
        lerp: Readonly<{
            minX: -0.2;
            maxX: 0.2;
            minY: 0.9;
            maxY: 1.25;
            speed: 4;
        }>;
    }>;
    xp: Readonly<{
        color: 12616956;
        leftText: "+";
        rightText: "XP";
        digits: Readonly<{
            suffixShorten: true;
        }>;
        lifetime: 0.95;
        durationFadeIn: 0.14;
        durationFadeOut: 0.25;
        lerp: Readonly<{
            minX: -0.2;
            maxX: 0.2;
            minY: 0.9;
            maxY: 1.25;
            speed: 4;
        }>;
    }>;
}>;
