/**
 * @template [I=unknown]
 * @typedef {object} RunScriptedOptions
 * @property {(tick: number, input: I | null) => void} step Advance the simulation one fixed tick.
 * @property {ArrayLike<I> | ((tick: number) => I | null | undefined)} [script] Per-tick input: array indexed by tick or a function. Missing entries yield `null`.
 * @property {number} [ticks] Tick count; defaults to `script.length` for arrays.
 * @property {(tick: number) => unknown} [checksum] Returns the state to fold into the checksum after each tick (default: no hashing).
 * @property {number} [every] Fold the state every N ticks (default 1; the final tick is always folded).
 * @property {number} [recordEvery] When > 0, record the running digest every N ticks in `samples`.
 */
/**
 * @typedef {object} RunScriptedResult
 * @property {number} ticks Ticks executed.
 * @property {number} checksum Final uint32 digest (`0` hashed state when `checksum` omitted).
 * @property {string} hex Final digest as hex.
 * @property {number[]} samples Running digests per `recordEvery` (empty by default).
 */
/**
 * Run a fixed-step simulation from a scripted input stream and return a checksum.
 * @template [I=unknown]
 * @param {RunScriptedOptions<I>} options
 * @returns {RunScriptedResult}
 */
export function runScripted<I = unknown>({ step, script, ticks, checksum, every, recordEvery }: RunScriptedOptions<I>): RunScriptedResult;
export type RunScriptedOptions<I = unknown> = {
    /**
     * Advance the simulation one fixed tick.
     */
    step: (tick: number, input: I | null) => void;
    /**
     * Per-tick input: array indexed by tick or a function. Missing entries yield `null`.
     */
    script?: ArrayLike<I> | ((tick: number) => I | null | undefined);
    /**
     * Tick count; defaults to `script.length` for arrays.
     */
    ticks?: number;
    /**
     * Returns the state to fold into the checksum after each tick (default: no hashing).
     */
    checksum?: (tick: number) => unknown;
    /**
     * Fold the state every N ticks (default 1; the final tick is always folded).
     */
    every?: number;
    /**
     * When > 0, record the running digest every N ticks in `samples`.
     */
    recordEvery?: number;
};
export type RunScriptedResult = {
    /**
     * Ticks executed.
     */
    ticks: number;
    /**
     * Final uint32 digest (`0` hashed state when `checksum` omitted).
     */
    checksum: number;
    /**
     * Final digest as hex.
     */
    hex: string;
    /**
     * Running digests per `recordEvery` (empty by default).
     */
    samples: number[];
};
