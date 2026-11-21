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
 * @property {boolean} isFastForward True during fast-forward catch-up replay.
 */
/**
 * @typedef {object} LockstepTickInfo
 * @property {number} logicTick Logic ticks completed.
 * @property {number} netTick
 * @property {number} substep
 * @property {boolean} isFastForward
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
 * @property {number} [maxBufferFrames=32] Max pending live network frames (>= startBufferFrames, <= 512).
 * @property {number} [maxReplayBufferFrames=4096] Max buffered frames allowed during replay catch-up (>= maxBufferFrames, <= 65536).
 * @property {number} [maxStepsPerUpdate=4] Logic ticks per `advanceElapsedMs` call (1..32).
 * @property {number} [maxExtraStepsPerUpdate=1] Extra catch-up ticks per call (0..16).
 * @property {boolean} [adaptiveCatchup=false] Scale catch-up with buffered excess.
 */
/**
 * @typedef {object} FastForwardResult
 * @property {number} netFramesCompleted
 * @property {number} logicTicksCompleted
 */
/**
 * @typedef {object} ConfirmedFrameScheduler
 * @property {(frame: ConfirmedFrame, options?: { replay?: boolean }) => boolean} enqueue Queue a confirmed frame; false when ignored; invalid input makes the scheduler fatal.
 * @property {(frames: readonly ConfirmedFrame[]) => number} enqueueReplay Batch-queue replay frames using `maxReplayBufferFrames` capacity.
 * @property {(maxFrames?: number) => FastForwardResult} fastForward Drain contiguous buffered frames immediately for reconnect catch-up.
 * @property {(checkpoint: { netTick: number, logicTick?: number }) => void} restoreCheckpoint Rebase scheduler cursor after restoring a world state snapshot.
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
export function createConfirmedFrameScheduler({ netHz, logicHz, playerIds, simulate, onTick, isEnded, instantButtonMask, startBufferFrames, maxBufferFrames, maxReplayBufferFrames, maxStepsPerUpdate, maxExtraStepsPerUpdate, adaptiveCatchup, }?: ConfirmedFrameSchedulerOptions): ConfirmedFrameScheduler;
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
    /**
     * True during fast-forward catch-up replay.
     */
    isFastForward: boolean;
};
export type LockstepTickInfo = {
    /**
     * Logic ticks completed.
     */
    logicTick: number;
    netTick: number;
    substep: number;
    isFastForward: boolean;
};
export type ConfirmedFrameSchedulerOptions = {
    /**
     * Network ticks per second (integer 1..240).
     */
    netHz?: number | undefined;
    /**
     * Logic ticks per second; integer multiple of `netHz` (<= 240).
     */
    logicHz?: number | undefined;
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
    onTick?: ((info: LockstepTickInfo) => void) | undefined;
    /**
     * Return true to stop scheduling.
     */
    isEnded?: (() => boolean) | undefined;
    /**
     * Buttons cleared on non-first substeps (31-bit mask).
     */
    instantButtonMask?: number | undefined;
    /**
     * Network frames buffered before starting (1..16).
     */
    startBufferFrames?: number | undefined;
    /**
     * Max pending live network frames (>= startBufferFrames, <= 512).
     */
    maxBufferFrames?: number | undefined;
    /**
     * Max buffered frames allowed during replay catch-up (>= maxBufferFrames, <= 65536).
     */
    maxReplayBufferFrames?: number | undefined;
    /**
     * Logic ticks per `advanceElapsedMs` call (1..32).
     */
    maxStepsPerUpdate?: number | undefined;
    /**
     * Extra catch-up ticks per call (0..16).
     */
    maxExtraStepsPerUpdate?: number | undefined;
    /**
     * Scale catch-up with buffered excess.
     */
    adaptiveCatchup?: boolean | undefined;
};
export type FastForwardResult = {
    netFramesCompleted: number;
    logicTicksCompleted: number;
};
export type ConfirmedFrameScheduler = {
    /**
     * Queue a confirmed frame; false when ignored; invalid input makes the scheduler fatal.
     */
    enqueue: (frame: ConfirmedFrame, options?: {
        replay?: boolean;
    }) => boolean;
    /**
     * Batch-queue replay frames using `maxReplayBufferFrames` capacity.
     */
    enqueueReplay: (frames: readonly ConfirmedFrame[]) => number;
    /**
     * Drain contiguous buffered frames immediately for reconnect catch-up.
     */
    fastForward: (maxFrames?: number) => FastForwardResult;
    /**
     * Rebase scheduler cursor after restoring a world state snapshot.
     */
    restoreCheckpoint: (checkpoint: {
        netTick: number;
        logicTick?: number;
    }) => void;
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
