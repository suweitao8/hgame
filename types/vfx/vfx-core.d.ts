/**
 * Isolated visual PRNG (xorshift32). Never touches gameplay/lockstep RNG state.
 * @param {number} [seed=0x9e3779b9]
 */
export function createVisualPrng(seed?: number | undefined): {
    nextFloat(): number;
    range(min: any, max: any): any;
    reset(newSeed?: number): void;
};
/**
 * Packs 0xRRGGBB or (r, g, b) into an exact 24-bit IEEE-754 float32 integer [0 .. 16777215].
 * Avoids Uint32->Float32 bit-casting which can hit NaN bit patterns.
 * @param {number} hexOrR
 * @param {number} [g]
 * @param {number} [b]
 * @returns {number}
 */
export function packRgb24(hexOrR: number, g?: number | undefined, b?: number | undefined): number;
/**
 * Unpacks a 24-bit integer float into normalized [0..1] RGB components inside a pre-allocated array.
 * @param {number} packed
 * @param {Float32Array|number[]} outRgb
 */
export function unpackRgb24Into(packed: number, outRgb: Float32Array | number[]): number[] | Float32Array;
/**
 * Marks a sub-range of a Three.js BufferAttribute as dirty using r17x addUpdateRange when available.
 * @param {object} attr
 * @param {number} floatOffset
 * @param {number} floatCount
 */
export function markAttributeRangeDirty(attr: object, floatOffset: number, floatCount: number): void;
/**
 * Submits one or two contiguous dirty ranges for a circular ring buffer without full-buffer upload.
 * @param {object} attr
 * @param {number} startIndex
 * @param {number} count
 * @param {number} capacity
 * @param {number} strideFloats
 * @param {Array<{offset:number,count:number}>} [outRanges]
 * @returns {number} Number of ranges submitted (0, 1, or 2)
 */
export function submitRingBufferRanges(attr: object, startIndex: number, count: number, capacity: number, strideFloats: number, outRanges?: {
    offset: number;
    count: number;
}[] | undefined): number;
/**
 * Visual-only hitstop clock. Scales visualDt for VFX/animations without blocking fixed-step lockstep logic.
 */
export function createHitstopClock(): {
    trigger(durationSec?: number, scale?: number): void;
    step(rawDt: any): number;
    isFrozen(): boolean;
    reset(): void;
};
/**
 * Zero-allocation directional + trauma^2 camera shake controller.
 */
export function createCameraShake(): {
    impulse(intensity?: number, dirX?: number, dirY?: number, dirZ?: number): void;
    update(rawDt: any, maxAmplitude?: number, maxRollRad?: number): {
        x: number;
        y: number;
        z: number;
        roll: number;
    };
    readonly offset: {
        x: number;
        y: number;
        z: number;
        roll: number;
    };
    reset(): void;
};
export const VFX_RENDER_ORDERS: Readonly<{
    CROWD: 0;
    TELEGRAPH: 10;
    TRAILS: 20;
    PARTICLES: 20;
    FLOATING_TEXT: 30;
    SCREEN: 999;
}>;
export const VFX_EASING: Readonly<{
    easeOutBack(t: any): number;
    easeOutQuint(t: any): number;
    easeOutCubic(t: any): number;
}>;
