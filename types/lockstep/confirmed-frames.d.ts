/**
 * @typedef {{ pid: number, buttons: number } & Record<string, number | boolean>} ConfirmedInput
 *   One player's canonical input: flat safe-integer / boolean fields, `buttons` is a 31-bit mask.
 */
/**
 * @typedef {object} ConfirmedFrame Inputs of every player for one network tick.
 * @property {number} netTick Positive integer network tick (starts at 1).
 * @property {readonly ConfirmedInput[]} inputs One entry per player, in `playerIds` order.
 */
/**
 * @typedef {object} LockstepStepInfo
 * @property {number} logicTick Logic tick being simulated (1-based).
 * @property {number} netTick Network tick this logic tick belongs to.
 * @property {number} substep 0..stepsPerFrame-1 within the network tick.
 * @property {number} stepsPerFrame `logicHz / netHz`.
 */
/**
 * @typedef {object} LockstepTickInfo
 * @property {number} logicTick Logic ticks completed.
 * @property {number} netTick
 * @property {number} substep
 */
/**
 * @typedef {object} ConfirmedFrameSchedulerOptions
 * @property {number} [netHz=10] Network ticks per second (integer 1..240).
 * @property {number} [logicHz=20] Logic ticks per second; integer multiple of `netHz` (<= 240).
 * @property {readonly number[]} playerIds Sorted unique non-negative integer player ids (required).
 * @property {(inputs: ConfirmedInput[], info: LockstepStepInfo) => void} simulate Advance the simulation one logic tick (required).
 * @property {(info: LockstepTickInfo) => void} [onTick] Called right after each committed logic tick (hash here).
 * @property {() => boolean} [isEnded] Return true to stop scheduling.
 * @property {number} [instantButtonMask=0] Buttons cleared on non-first substeps (31-bit mask).
 * @property {number} [startBufferFrames=2] Network frames buffered before starting (1..16).
 * @property {number} [maxBufferFrames=32] Max pending network frames (>= startBufferFrames, <= 512).
 * @property {number} [maxStepsPerUpdate=4] Logic ticks per `advanceElapsedMs` call (1..32).
 * @property {number} [maxExtraStepsPerUpdate=1] Extra catch-up ticks per call (0..16).
 * @property {boolean} [adaptiveCatchup=false] Scale catch-up with buffered excess.
 */
/**
 * @typedef {object} ConfirmedFrameScheduler
 * @property {(frame: ConfirmedFrame) => boolean} enqueue Queue a confirmed frame; false when ignored; invalid input makes the scheduler fatal.
 * @property {(elapsedMs: number) => number} advanceElapsedMs Advance by display time in milliseconds; returns logic ticks completed.
 * @property {boolean} started
 * @property {boolean} stalled Waiting for a network frame.
 * @property {boolean} fatal Failed closed after invalid input or a throwing callback.
 * @property {number} logicTick Logic ticks completed.
 * @property {number} expectedNetTick Next network tick awaited.
 * @property {number} bufferedFrames Pending network frames.
 * @property {number} stallEvents
 * @property {number} catchupSteps
 * @property {number} maxBufferedFramesSeen
 * @property {number} renderAlpha Interpolation factor 0..1 (0 while stalled / not started).
 * @property {() => void} dispose
 */
/**
 * Confirmed-input scheduler only. NOT a network client, deterministic physics,
 * rollback engine, anti-cheat layer or proof of cross-platform determinism.
 *
 * The caller owns protocol validation, pure integer simulation and state hash.
 *
 * @param {ConfirmedFrameSchedulerOptions} options
 * @returns {ConfirmedFrameScheduler}
 */
export function createConfirmedFrameScheduler({ netHz, logicHz, playerIds, simulate, onTick, isEnded, instantButtonMask, startBufferFrames, maxBufferFrames, maxStepsPerUpdate, maxExtraStepsPerUpdate, adaptiveCatchup, }?: ConfirmedFrameSchedulerOptions): ConfirmedFrameScheduler;
/**
 * One player's canonical input: flat safe-integer / boolean fields, `buttons` is a 31-bit mask.
 */
export type ConfirmedInput = {
    pid: number;
    buttons: number;
} & Record<string, number | boolean>;
/**
 * Inputs of every player for one network tick.
 */
export type ConfirmedFrame = {
    /**
     * Positive integer network tick (starts at 1).
     */
    netTick: number;
    /**
     * One entry per player, in `playerIds` order.
     */
    inputs: readonly ConfirmedInput[];
};
export type LockstepStepInfo = {
    /**
     * Logic tick being simulated (1-based).
     */
    logicTick: number;
    /**
     * Network tick this logic tick belongs to.
     */
    netTick: number;
    /**
     * 0..stepsPerFrame-1 within the network tick.
     */
    substep: number;
    /**
     * `logicHz / netHz`.
     */
    stepsPerFrame: number;
};
export type LockstepTickInfo = {
    /**
     * Logic ticks completed.
     */
    logicTick: number;
    netTick: number;
    substep: number;
};
export type ConfirmedFrameSchedulerOptions = {
    /**
     * Network ticks per second (integer 1..240).
     */
    netHz?: number;
    /**
     * Logic ticks per second; integer multiple of `netHz` (<= 240).
     */
    logicHz?: number;
    /**
     * Sorted unique non-negative integer player ids (required).
     */
    playerIds: readonly number[];
    /**
     * Advance the simulation one logic tick (required).
     */
    simulate: (inputs: ConfirmedInput[], info: LockstepStepInfo) => void;
    /**
     * Called right after each committed logic tick (hash here).
     */
    onTick?: (info: LockstepTickInfo) => void;
    /**
     * Return true to stop scheduling.
     */
    isEnded?: () => boolean;
    /**
     * Buttons cleared on non-first substeps (31-bit mask).
     */
    instantButtonMask?: number;
    /**
     * Network frames buffered before starting (1..16).
     */
    startBufferFrames?: number;
    /**
     * Max pending network frames (>= startBufferFrames, <= 512).
     */
    maxBufferFrames?: number;
    /**
     * Logic ticks per `advanceElapsedMs` call (1..32).
     */
    maxStepsPerUpdate?: number;
    /**
     * Extra catch-up ticks per call (0..16).
     */
    maxExtraStepsPerUpdate?: number;
    /**
     * Scale catch-up with buffered excess.
     */
    adaptiveCatchup?: boolean;
};
export type ConfirmedFrameScheduler = {
    /**
     * Queue a confirmed frame; false when ignored; invalid input makes the scheduler fatal.
     */
    enqueue: (frame: ConfirmedFrame) => boolean;
    /**
     * Advance by display time in milliseconds; returns logic ticks completed.
     */
    advanceElapsedMs: (elapsedMs: number) => number;
    started: boolean;
    /**
     * Waiting for a network frame.
     */
    stalled: boolean;
    /**
     * Failed closed after invalid input or a throwing callback.
     */
    fatal: boolean;
    /**
     * Logic ticks completed.
     */
    logicTick: number;
    /**
     * Next network tick awaited.
     */
    expectedNetTick: number;
    /**
     * Pending network frames.
     */
    bufferedFrames: number;
    stallEvents: number;
    catchupSteps: number;
    maxBufferedFramesSeen: number;
    /**
     * Interpolation factor 0..1 (0 while stalled / not started).
     */
    renderAlpha: number;
    dispose: () => void;
};
