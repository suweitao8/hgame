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
/**
 * Evaluates instantaneous Unity VelocityModule.radial velocity toward/away from `(cx, cy, cz)`,
 * clamping inward steps over `dt` so particles settle smoothly at the radial origin without overshoot.
 * @param {number} px
 * @param {number} py
 * @param {number} pz
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {number} velRadial
 * @param {number} vScale
 * @param {number} dt
 * @param {Float32Array | number[]} out3
 */
export function computeDynamicRadialVel(px: number, py: number, pz: number, cx: number, cy: number, cz: number, velRadial: number, vScale: number, dt: number, out3: Float32Array | number[]): void;
/**
 * Builds an instanced chamfered-octagon particle geometry (8 vertices, 6 triangles)
 * bounding the unit inscribed circle (`r <= 1.0`) to cut ~17% corner pixel overdraw.
 * @param {object} THREE
 * @returns {object}
 */
export function createChamferedOctagonGeometry(THREE: object): object;
/**
 * Detects mobile devices, Bilibili Toy WebViews, and WeChat/Douyin mini-game runtimes
 * so VFX pools apply mobile-safe memory budgets and half-float GPU defaults.
 * @returns {boolean}
 */
export function isMobileOrMiniGameEnv(): boolean;
/**
 * Creates a 2D offscreen/staging canvas across Browser DOM, WeChat (`wx.createCanvas`),
 * Douyin (`tt.createCanvas`), and Worker `OffscreenCanvas` runtimes.
 * @param {number} width
 * @param {number} height
 * @returns {HTMLCanvasElement | OffscreenCanvas | null}
 */
export function createOffscreen2dCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas | null;
/**
 * Returns true if a Unity LimitVelocityModule (`clampVelocity`) config has active drag or speed limits.
 * @param {object | null | undefined} cfg
 * @returns {boolean}
 */
export function hasClampVelocity(cfg: object | null | undefined): boolean;
/**
 * Applies one Unity LimitVelocityOverLifetimeModule step (drag + scalar/separateAxis velocity clamp)
 * in-place on an object with `.vx`, `.vy`, `.vz` properties without allocations.
 * @param {{ vx: number, vy: number, vz: number }} target
 * @param {object | null | undefined} cfg
 * @param {number} dt
 * @param {number} [t=0]
 * @param {number} [seed=0.5]
 */
export function applyClampVelocityStep(target: {
    vx: number;
    vy: number;
    vz: number;
}, cfg: object | null | undefined, dt: number, t?: number | undefined, seed?: number | undefined): void;
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
/**
 * 2D triangle list (18 vertices = 6 triangles) tightly bounding the unit circle
 * (`r <= 1.0`), eliminating ~17% corner overdraw on mobile TBDR GPUs.
 */
export const CHAMFERED_OCTAGON_TRIS_2D: Float32Array;
