/** Animation CPU budget allocator. */
/**
 * Vector-like position (world units).
 * @typedef {{x: number, y: number, z: number}} AnimationBudgetPosition
 */
/**
 * Something the allocator can step: an animation component (`_stepBudgeted`/`update`), a plain object
 * with `update(dt)`, or a function `(dt) => void`. May expose `object3d`, `position`, `entity`, `visible`.
 * @typedef {object | ((dt: number) => void)} AnimationBudgetTarget
 */
/**
 * Options for {@link createAnimationBudgetAllocator}.
 * @typedef {object} AnimationBudgetAllocatorOptions
 * @property {number} [maxFullRateCount=16] Visible targets ticked every frame.
 * @property {number} [maxHalfRateCount=32] Next visible targets ticked every 2nd frame.
 * @property {number} [maxQuarterRateCount=48] Next visible targets ticked every 4th frame (the rest every 8th).
 * @property {number} [offscreenTickInterval=0.5] Seconds of accumulated time before an offscreen target ticks.
 * @property {number} [maxUpdateBudgetPerFrame=Infinity] Maximum number of target steps per `update` call.
 * @property {number} [maxAccumulatedDt=2] Cap (seconds) on per-target accumulated delta time.
 * @property {number} [priorityWeight=10] Score weight of `priority`.
 * @property {number} [starvationWeight=25] Score weight of accumulated delta time (seconds).
 * @property {number} [distancePenalty=1] Score penalty per world unit of camera distance.
 */
/**
 * Options for {@link AnimationBudgetAllocator.register}.
 * @typedef {object} AnimationBudgetRegisterOptions
 * @property {number} [priority=0] Higher priority gets more frequent ticks.
 * @property {((target: AnimationBudgetTarget) => AnimationBudgetPosition | null) | null} [getPosition=null] Custom world position reader.
 * @property {((target: AnimationBudgetTarget) => boolean) | null} [getVisible=null] Custom visibility reader.
 * @property {((dt: number, target: AnimationBudgetTarget) => void) | null} [onStep=null] Custom step callback receiving accumulated dt.
 */
/**
 * Registered allocator entry (live, mutable record).
 * @typedef {object} AnimationBudgetEntry
 * @property {AnimationBudgetTarget} target Registered target.
 * @property {number} slot Stable registration slot used to stagger strided ticks.
 * @property {number} priority Priority.
 * @property {((target: AnimationBudgetTarget) => AnimationBudgetPosition | null) | null} getPosition Position reader.
 * @property {((target: AnimationBudgetTarget) => boolean) | null} getVisible Visibility reader.
 * @property {((dt: number, target: AnimationBudgetTarget) => void) | null} onStep Step callback.
 * @property {number} accumDt Accumulated unprocessed delta time in seconds.
 * @property {number} tickCount Number of ticks performed.
 * @property {number} score Last computed score.
 * @property {number} lastDist Last camera distance in world units.
 * @property {number} lastStride Last stride (1/2/4/8, 0 when offscreen).
 */
/**
 * Per-frame allocator statistics.
 * @typedef {object} AnimationBudgetStats
 * @property {number} total Registered targets processed.
 * @property {number} updated Targets stepped this frame.
 * @property {number} fullRate Targets stepped at full rate.
 * @property {number} throttled Targets stepped at reduced rate (incl. offscreen).
 * @property {number} deferred Visible targets deferred this frame.
 * @property {number} offscreenSkipped Offscreen targets skipped.
 */
/**
 * Allocator API returned by {@link createAnimationBudgetAllocator}.
 * @typedef {object} AnimationBudgetAllocator
 * @property {number} size Number of registered targets (getter).
 * @property {(target: AnimationBudgetTarget, options?: AnimationBudgetRegisterOptions) => AnimationBudgetEntry} register Registers (or updates) a target.
 * @property {(target: AnimationBudgetTarget) => boolean} unregister Removes a target; false when unknown.
 * @property {(target: AnimationBudgetTarget, priority: number) => boolean} setPriority Changes priority; false when unknown.
 * @property {(dt?: number, cameraOrPos?: {position?: AnimationBudgetPosition} | AnimationBudgetPosition | null) => AnimationBudgetStats} update Distributes the frame budget; `dt` in seconds.
 * @property {() => void} clear Unregisters everything.
 */
/**
 * Coordinates a shared CPU budget across many animated 3D characters,
 * assigning full / half / quarter / eighth tick strides by visibility, priority,
 * camera distance, and accumulated starvation debt.
 * @param {AnimationBudgetAllocatorOptions} [options] Allocator options.
 * @returns {AnimationBudgetAllocator} Frozen allocator API.
 */
export function createAnimationBudgetAllocator({ maxFullRateCount, maxHalfRateCount, maxQuarterRateCount, offscreenTickInterval, maxUpdateBudgetPerFrame, maxAccumulatedDt, priorityWeight, starvationWeight, distancePenalty, }?: AnimationBudgetAllocatorOptions | undefined): AnimationBudgetAllocator;
/**
 * Unified 3D representation residency budget across near/skinned actors, Bone-VAT crowds,
 * far impostors, full open-world cells, and HLOD proxies.
 *
 * @param {object} [options]
 * @param {number} [options.maxBytes=67108864] Maximum total tracked GPU/representation byte budget.
 * @param {number} [options.maxSlots=Infinity] Maximum active representation slot count.
 */
export function createRepresentationBudget3D({ maxBytes, maxSlots, }?: {
    maxBytes?: number | undefined;
    maxSlots?: number | undefined;
} | undefined): Readonly<{
    allocate: (id: any, { tier, bytes, slots, priority, onEvict, }?: {
        tier?: string | undefined;
        bytes?: number | undefined;
        slots?: number | undefined;
        priority?: number | undefined;
        onEvict?: null | undefined;
    }) => {
        id: any;
        totalBytes: number;
        totalSlots: number;
        evicted: {
            id: any;
            tier: any;
            reason: string;
            bytes: any;
            slots: any;
        }[];
    };
    release: (id: any) => boolean;
    touch: (id: any) => boolean;
    enforce: (excludeId?: null) => {
        id: any;
        tier: any;
        reason: string;
        bytes: any;
        slots: any;
    }[];
    getStats: () => {
        count: number;
        totalBytes: number;
        totalSlots: number;
        maxBytes: number;
        maxSlots: number;
        byTier: any;
        evictions: any[];
    };
    clear: () => void;
}>;
/**
 * @typedef {object} LodAnimationSchedulerOptions
 * @property {Record<number, number>} [rates] Per-LOD update rates in Hz (defaults to 24 / 12 / 6 / 6 Hz).
 * @property {number} [maxAccumulatedDt=2.0] Cap (seconds) on accumulated per-target delta time.
 */
/**
 * @typedef {object} LodAnimationStats
 * @property {number} total Registered targets evaluated.
 * @property {number} updated Targets stepped this frame.
 * @property {number} skipped Targets skipped this frame (accumulating dt).
 * @property {[number, number, number, number]} byLod Count of targets per LOD tier `[L0, L1, L2, L3]`.
 */
/**
 * Schedules staggered LOD-tiered animation updates (`24 / 12 / 6 / 6 Hz` by default)
 * so mid/far skeletal characters cut CPU animation cost without simultaneous frame spikes.
 * @param {LodAnimationSchedulerOptions} [options] Scheduler options.
 */
export function createLodAnimationScheduler({ rates, maxAccumulatedDt, }?: LodAnimationSchedulerOptions | undefined): Readonly<{
    readonly size: number;
    register: (target: any, { lod, getLod, onStep }?: {
        lod?: number | undefined;
        getLod?: null | undefined;
        onStep?: null | undefined;
    }) => any;
    unregister: (target: any) => boolean;
    setLod: (target: any, lod: any) => boolean;
    update: (dt?: number) => {
        total: number;
        updated: number;
        skipped: number;
        byLod: [number, number, number, number];
    };
    flush: () => void;
    clear: () => void;
    getRates: () => Readonly<{
        0: number;
        1: number;
        2: number;
        3: number;
    }>;
}>;
/**
 * Default per-LOD animation update rates (Hz) for staggered skeletal updates (URO).
 * @type {Readonly<{ 0: number, 1: number, 2: number, 3: number }>}
 */
export const DEFAULT_LOD_ANIMATION_RATES: Readonly<{
    0: number;
    1: number;
    2: number;
    3: number;
}>;
/**
 * Vector-like position (world units).
 */
export type AnimationBudgetPosition = {
    x: number;
    y: number;
    z: number;
};
/**
 * Something the allocator can step: an animation component (`_stepBudgeted`/`update`), a plain object
 * with `update(dt)`, or a function `(dt) => void`. May expose `object3d`, `position`, `entity`, `visible`.
 */
export type AnimationBudgetTarget = object | ((dt: number) => void);
/**
 * Options for {@link createAnimationBudgetAllocator}.
 */
export type AnimationBudgetAllocatorOptions = {
    /**
     * Visible targets ticked every frame.
     */
    maxFullRateCount?: number | undefined;
    /**
     * Next visible targets ticked every 2nd frame.
     */
    maxHalfRateCount?: number | undefined;
    /**
     * Next visible targets ticked every 4th frame (the rest every 8th).
     */
    maxQuarterRateCount?: number | undefined;
    /**
     * Seconds of accumulated time before an offscreen target ticks.
     */
    offscreenTickInterval?: number | undefined;
    /**
     * Maximum number of target steps per `update` call.
     */
    maxUpdateBudgetPerFrame?: number | undefined;
    /**
     * Cap (seconds) on per-target accumulated delta time.
     */
    maxAccumulatedDt?: number | undefined;
    /**
     * Score weight of `priority`.
     */
    priorityWeight?: number | undefined;
    /**
     * Score weight of accumulated delta time (seconds).
     */
    starvationWeight?: number | undefined;
    /**
     * Score penalty per world unit of camera distance.
     */
    distancePenalty?: number | undefined;
};
/**
 * Options for {@link AnimationBudgetAllocator.register}.
 */
export type AnimationBudgetRegisterOptions = {
    /**
     * Higher priority gets more frequent ticks.
     */
    priority?: number | undefined;
    /**
     * Custom world position reader.
     */
    getPosition?: ((target: AnimationBudgetTarget) => AnimationBudgetPosition | null) | null | undefined;
    /**
     * Custom visibility reader.
     */
    getVisible?: ((target: AnimationBudgetTarget) => boolean) | null | undefined;
    /**
     * Custom step callback receiving accumulated dt.
     */
    onStep?: ((dt: number, target: AnimationBudgetTarget) => void) | null | undefined;
};
/**
 * Registered allocator entry (live, mutable record).
 */
export type AnimationBudgetEntry = {
    /**
     * Registered target.
     */
    target: AnimationBudgetTarget;
    /**
     * Stable registration slot used to stagger strided ticks.
     */
    slot: number;
    /**
     * Priority.
     */
    priority: number;
    /**
     * Position reader.
     */
    getPosition: ((target: AnimationBudgetTarget) => AnimationBudgetPosition | null) | null;
    /**
     * Visibility reader.
     */
    getVisible: ((target: AnimationBudgetTarget) => boolean) | null;
    /**
     * Step callback.
     */
    onStep: ((dt: number, target: AnimationBudgetTarget) => void) | null;
    /**
     * Accumulated unprocessed delta time in seconds.
     */
    accumDt: number;
    /**
     * Number of ticks performed.
     */
    tickCount: number;
    /**
     * Last computed score.
     */
    score: number;
    /**
     * Last camera distance in world units.
     */
    lastDist: number;
    /**
     * Last stride (1/2/4/8, 0 when offscreen).
     */
    lastStride: number;
};
/**
 * Per-frame allocator statistics.
 */
export type AnimationBudgetStats = {
    /**
     * Registered targets processed.
     */
    total: number;
    /**
     * Targets stepped this frame.
     */
    updated: number;
    /**
     * Targets stepped at full rate.
     */
    fullRate: number;
    /**
     * Targets stepped at reduced rate (incl. offscreen).
     */
    throttled: number;
    /**
     * Visible targets deferred this frame.
     */
    deferred: number;
    /**
     * Offscreen targets skipped.
     */
    offscreenSkipped: number;
};
/**
 * Allocator API returned by {@link createAnimationBudgetAllocator}.
 */
export type AnimationBudgetAllocator = {
    /**
     * Number of registered targets (getter).
     */
    size: number;
    /**
     * Registers (or updates) a target.
     */
    register: (target: AnimationBudgetTarget, options?: AnimationBudgetRegisterOptions) => AnimationBudgetEntry;
    /**
     * Removes a target; false when unknown.
     */
    unregister: (target: AnimationBudgetTarget) => boolean;
    /**
     * Changes priority; false when unknown.
     */
    setPriority: (target: AnimationBudgetTarget, priority: number) => boolean;
    /**
     * Distributes the frame budget; `dt` in seconds.
     */
    update: (dt?: number, cameraOrPos?: {
        position?: AnimationBudgetPosition;
    } | AnimationBudgetPosition | null) => AnimationBudgetStats;
    /**
     * Unregisters everything.
     */
    clear: () => void;
};
export type LodAnimationSchedulerOptions = {
    /**
     * Per-LOD update rates in Hz (defaults to 24 / 12 / 6 / 6 Hz).
     */
    rates?: Record<number, number> | undefined;
    /**
     * Cap (seconds) on accumulated per-target delta time.
     */
    maxAccumulatedDt?: number | undefined;
};
export type LodAnimationStats = {
    /**
     * Registered targets evaluated.
     */
    total: number;
    /**
     * Targets stepped this frame.
     */
    updated: number;
    /**
     * Targets skipped this frame (accumulating dt).
     */
    skipped: number;
    /**
     * Count of targets per LOD tier `[L0, L1, L2, L3]`.
     */
    byLod: [number, number, number, number];
};
