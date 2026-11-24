/**
 * GGPO-style prediction & rollback lockstep scheduler.
 *
 * Uses a fixed `maxRollbackFrames + 1` snapshot slot ring (`saveState` / `loadState`)
 * so games can store flat TypedArray / WASM / Rapier snapshots with zero per-frame GC.
 *
 * @param {RollbackFrameSchedulerOptions} options
 * @returns {RollbackFrameScheduler}
 */
export function createRollbackFrameScheduler({ netHz, logicHz, playerIds, saveState, loadState, simulate, onConfirmedTick, predictInput, isEnded, instantButtonMask, maxRollbackFrames, maxStepsPerUpdate, }?: RollbackFrameSchedulerOptions): RollbackFrameScheduler;
/**
 * Canonical flat safe-integer/boolean input for one player on one network tick.
 */
export type RollbackInput = {
    pid: number;
    buttons: number;
} & Record<string, number | boolean>;
export type RollbackStepInfo = {
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
     * True during rollback re-simulation; skip transient SFX/VFX here.
     */
    isResimulating: boolean;
};
export type RollbackConfirmedInfo = {
    /**
     * Confirmed network tick whose inputs are now final.
     */
    netTick: number;
    /**
     * Final logic tick of `netTick`.
     */
    logicTick: number;
    /**
     * Snapshot slot index (`netTick % (maxRollbackFrames + 1)`) holding the confirmed state.
     */
    slotIndex: number;
};
export type RollbackFrameSchedulerOptions = {
    /**
     * Network ticks per second (integer 1..240).
     */
    netHz?: number | undefined;
    /**
     * Logic ticks per second; integer multiple of `netHz` (<= 240).
     */
    logicHz?: number | undefined;
    /**
     * Sorted unique nonnegative integer player ids (required).
     */
    playerIds: readonly number[];
    /**
     * Save deterministic world state into preallocated `slotIndex` (`0..maxRollbackFrames`).
     */
    saveState: (slotIndex: number, netTick: number) => void;
    /**
     * Restore deterministic world state from `slotIndex`.
     */
    loadState: (slotIndex: number, netTick: number) => void;
    /**
     * Advance one logic tick.
     */
    simulate: (inputs: RollbackInput[], info: RollbackStepInfo) => void;
    /**
     * Called in order once a `netTick` is permanently confirmed (hash/audit here).
     */
    onConfirmedTick?: ((info: RollbackConfirmedInfo) => void) | undefined;
    /**
     * Custom input predictor; defaults to repeating `lastConfirmed` with `instantButtonMask` cleared.
     */
    predictInput?: ((pid: number, lastConfirmed: RollbackInput | null, netTick: number) => RollbackInput) | undefined;
    /**
     * Return true to stop scheduling.
     */
    isEnded?: (() => boolean) | undefined;
    /**
     * Buttons cleared on substeps > 0 and default input prediction (31-bit mask).
     */
    instantButtonMask?: number | undefined;
    /**
     * Max speculative prediction window ahead of `confirmedNetTick` (1..64).
     */
    maxRollbackFrames?: number | undefined;
    /**
     * Max new logic ticks per `advanceElapsedMs` call (1..64).
     */
    maxStepsPerUpdate?: number | undefined;
};
export type RollbackFrameScheduler = {
    /**
     * Record an authoritative/real input for one player on `netTick`.
     */
    submitInput: (netTick: number, input: RollbackInput) => boolean;
    /**
     * Record a full confirmed frame for `netTick`.
     */
    enqueueConfirmedFrame: (frame: {
        netTick: number;
        inputs: readonly RollbackInput[];
    }) => boolean;
    /**
     * Roll back any dirty speculative frames, then advance due ticks.
     */
    advanceElapsedMs: (elapsedMs: number) => number;
    /**
     * Rebase scheduler after restoring an external snapshot.
     */
    restoreCheckpoint: (checkpoint: {
        netTick: number;
        logicTick?: number;
    }) => void;
    /**
     * Suggest slight pacing adjustment (`0.95..1.0`) when ahead of peers.
     */
    recommendTimeScale: (remoteAdvantageFrames: number) => number;
    /**
     * True when speculative window reached `maxRollbackFrames` waiting for remote inputs.
     */
    stalled: boolean;
    fatal: boolean;
    /**
     * Latest simulated network tick (may be speculative).
     */
    netTick: number;
    /**
     * Highest contiguous network tick with all real inputs.
     */
    confirmedNetTick: number;
    /**
     * Latest simulated logic tick.
     */
    logicTick: number;
    /**
     * Total rollback events executed.
     */
    rollbackCount: number;
    /**
     * Total network frames re-simulated due to misprediction.
     */
    resimulatedFrames: number;
    maxRollbackDepthSeen: number;
    renderAlpha: number;
    dispose: () => void;
};
