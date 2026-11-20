/**
 * @typedef {object} SimulationWorkBudgetOptions
 * @property {import('../core/application.js').GameApplication} app Owns the update phase.
 * @property {number} [unitsPerTick=256] Maximum iterator advances per fixed tick.
 * @property {number} [unitsPerSlice=16] Maximum consecutive advances for one task.
 * @property {number} [maxPending=128] Maximum accepted tasks.
 */
/**
 * @template T
 * @typedef {object} SimulationWorkHandle
 * @property {'pending'|'completed'|'failed'|'cancelled'} state
 * @property {T | undefined} value Available on completion.
 * @property {unknown} error Available on failure or cancellation.
 * @property {(reason?: unknown) => boolean} cancel
 */
/** @typedef {SimulationWorkHandle<unknown>['state']} WorkState */
/** @typedef {{iterator: Generator<unknown, unknown, void> | null, state: WorkState, value: unknown, error: unknown, signal: AbortSignal | null, onAbort: (() => void) | null}} WorkEntry */
/**
 * Advance cooperative work in fixed-tick order and bound the pending queue.
 * Each generator advance is one unit and should perform bounded synchronous work.
 * @param {SimulationWorkBudgetOptions} options
 */
export function createSimulationWorkBudget({ app, unitsPerTick, unitsPerSlice, maxPending }: SimulationWorkBudgetOptions): {
    enqueue: <T>(iterator: Generator<unknown, T, void>, { signal }?: {
        signal?: AbortSignal | null;
    } | undefined) => SimulationWorkHandle<T> | null;
    snapshot: () => {
        pending: number;
        capacity: number;
        used: number;
        completed: number;
        cancelled: number;
        failed: number;
        rejected: number;
    };
    dispose: () => void;
};
export type SimulationWorkBudgetOptions = {
    /**
     * Owns the update phase.
     */
    app: import("../core/application.js").GameApplication;
    /**
     * Maximum iterator advances per fixed tick.
     */
    unitsPerTick?: number | undefined;
    /**
     * Maximum consecutive advances for one task.
     */
    unitsPerSlice?: number | undefined;
    /**
     * Maximum accepted tasks.
     */
    maxPending?: number | undefined;
};
export type SimulationWorkHandle<T> = {
    state: "pending" | "completed" | "failed" | "cancelled";
    /**
     * Available on completion.
     */
    value: T | undefined;
    /**
     * Available on failure or cancellation.
     */
    error: unknown;
    cancel: (reason?: unknown) => boolean;
};
export type WorkState = SimulationWorkHandle<unknown>["state"];
export type WorkEntry = {
    iterator: Generator<unknown, unknown, void> | null;
    state: WorkState;
    value: unknown;
    error: unknown;
    signal: AbortSignal | null;
    onAbort: (() => void) | null;
};
