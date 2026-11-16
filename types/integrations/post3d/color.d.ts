/** Color / tone-curve / eye-adaptation math helpers. */
/**
 * @typedef {[number, number, number]} RGBTuple Linear RGB triple.
 */
/**
 * Clamps a value into [lo, hi].
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
export function clampRange(v: number, lo: number, hi: number): number;
/**
 * Approximate linear sRGB of a Planckian radiator (Y = 1).
 * @param {number} tempK Color temperature in Kelvin (clamped to 1667..25000, default 6500 if non-finite).
 * @returns {RGBTuple}
 */
export function ciePlanckianLinearRgb(tempK: number): RGBTuple;
/**
 * Computes luminance-preserving camera white-balance RGB multipliers relative
 * to 6500K neutral daylight (`whiteTemp > 6500` warms, `< 6500` cools).
 * @param {number} [whiteTemp=6500] Kelvin, clamped 1667..25000.
 * @param {number} [whiteTint=0] Green/magenta tint, clamped -1..1.
 * @param {RGBTuple} [out=[1,1,1]] Receives the multipliers (mutated and returned).
 * @returns {RGBTuple} `out`.
 */
export function computeWhiteBalanceRGB(whiteTemp?: number | undefined, whiteTint?: number | undefined, out?: RGBTuple | undefined): RGBTuple;
/**
 * Clean-room monotonic parametric filmic tone curve for a single linear HDR channel.
 * @typedef {object} FilmicCurveParams
 * @property {number} [slope=0.88] Mid-tone contrast slope.
 * @property {number} [toe=0.55] Toe strength 0..1.
 * @property {number} [shoulder=0.26] Shoulder strength 0..1.
 * @property {number} [blackClip=0] Black clip 0..0.5.
 * @property {number} [whiteClip=0.04] White clip 0..0.5.
 */
/**
 * Evaluates the filmic curve for one channel.
 * @param {number} x Linear HDR value (>= 0).
 * @param {FilmicCurveParams} [params]
 * @returns {number} Mapped value in 0..1.
 */
export function evaluateFilmicCurveChannel(x: number, { slope, toe, shoulder, blackClip, whiteClip, }?: FilmicCurveParams | undefined): number;
/**
 * Evaluates the parametric filmic curve with subtle highlight crosstalk desaturation.
 * @param {ArrayLike<number>} rgb Linear HDR RGB input.
 * @param {FilmicCurveParams} [params={}]
 * @param {RGBTuple} [out=[0,0,0]] Receives the result (mutated and returned).
 * @returns {RGBTuple} `out`.
 */
export function evaluateFilmicCurveRGB(rgb: ArrayLike<number>, params?: FilmicCurveParams | undefined, out?: RGBTuple | undefined): RGBTuple;
/**
 * Eye-adaptation tuning.
 * @typedef {object} EyeAdaptationParams
 * @property {number} [keyValue=0.18] Target middle-grey key.
 * @property {number} [minExposure=0.35] Minimum exposure multiplier.
 * @property {number} [maxExposure=2.6] Maximum exposure multiplier.
 * @property {number} [adaptSpeedUp=3.0] Adaptation rate (1/s) when target exposure decreases (scene brightens).
 * @property {number} [adaptSpeedDown=1.4] Adaptation rate (1/s) when target exposure increases (scene darkens).
 * @property {number} [exposureCompensation=1.0] Exposure compensation multiplier.
 */
/**
 * Computes one asymmetric temporal eye-adaptation step from scene average luminance.
 * @param {number} currentExposure Current exposure multiplier.
 * @param {number} avgLuminance Scene average luminance (clamped 1e-4..1e4).
 * @param {EyeAdaptationParams} [params]
 * @param {number} [dt=1/60] Time step in seconds.
 * @returns {number} New exposure multiplier.
 */
export function stepEyeAdaptation(currentExposure: number, avgLuminance: number, { keyValue, minExposure, maxExposure, adaptSpeedUp, adaptSpeedDown, exposureCompensation, }?: EyeAdaptationParams | undefined, dt?: number | undefined): number;
export const D65_PLANCKIAN_REF: RGBTuple;
/**
 * Linear RGB triple.
 */
export type RGBTuple = [number, number, number];
/**
 * Clean-room monotonic parametric filmic tone curve for a single linear HDR channel.
 */
export type FilmicCurveParams = {
    /**
     * Mid-tone contrast slope.
     */
    slope?: number | undefined;
    /**
     * Toe strength 0..1.
     */
    toe?: number | undefined;
    /**
     * Shoulder strength 0..1.
     */
    shoulder?: number | undefined;
    /**
     * Black clip 0..0.5.
     */
    blackClip?: number | undefined;
    /**
     * White clip 0..0.5.
     */
    whiteClip?: number | undefined;
};
/**
 * Eye-adaptation tuning.
 */
export type EyeAdaptationParams = {
    /**
     * Target middle-grey key.
     */
    keyValue?: number | undefined;
    /**
     * Minimum exposure multiplier.
     */
    minExposure?: number | undefined;
    /**
     * Maximum exposure multiplier.
     */
    maxExposure?: number | undefined;
    /**
     * Adaptation rate (1/s) when target exposure decreases (scene brightens).
     */
    adaptSpeedUp?: number | undefined;
    /**
     * Adaptation rate (1/s) when target exposure increases (scene darkens).
     */
    adaptSpeedDown?: number | undefined;
    /**
     * Exposure compensation multiplier.
     */
    exposureCompensation?: number | undefined;
};
