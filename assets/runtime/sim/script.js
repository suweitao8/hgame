/**
 * Deterministic scripted replay driver (also usable for lockstep desync tests).
 * @module sim/script
 */
import { createStateChecksum } from './checksum.js';

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
export function runScripted({ step, script, ticks, checksum, every = 1, recordEvery = 0 }) {
  if (typeof step !== 'function') throw new TypeError('runScripted: step must be a function');
  const isFn = typeof script === 'function';
  const total = ticks ?? (script && !isFn ? script.length : 0);
  const sum = createStateChecksum();
  const samples = [];
  const stride = every > 0 ? every : 1;
  for (let tick = 0; tick < total; tick++) {
    const input = isFn ? script(tick) : script ? script[tick] : null;
    step(tick, input ?? null);
    if (checksum && ((tick + 1) % stride === 0 || tick === total - 1)) sum.update(checksum(tick));
    if (recordEvery > 0 && (tick + 1) % recordEvery === 0) samples.push(sum.digest());
  }
  return { ticks: total, checksum: sum.digest(), hex: sum.hex(), samples };
}
