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
export function createConfirmedFrameScheduler({
  netHz = 10,
  logicHz = 20,
  playerIds,
  simulate,
  onTick = () => {},
  isEnded = () => false,
  instantButtonMask = 0,
  startBufferFrames = 2,
  maxBufferFrames = 32,
  maxReplayBufferFrames = 4096,
  maxStepsPerUpdate = 4,
  maxExtraStepsPerUpdate = 1,
  adaptiveCatchup = false,
} = {}) {
  if (!Number.isInteger(netHz) || netHz < 1 || netHz > 240 ||
      !Number.isInteger(logicHz) || logicHz < netHz || logicHz > 240 ||
      logicHz % netHz !== 0) {
    throw new RangeError('logicHz must be an integer multiple of netHz (1..240 Hz)');
  }
  if (!Array.isArray(playerIds) || !playerIds.length ||
      playerIds.some((pid, i) => !Number.isSafeInteger(pid) || pid < 0 ||
        (i > 0 && pid <= playerIds[i - 1]))) {
    throw new RangeError('playerIds must be a non-empty sorted list of unique nonnegative integers (no duplicates)');
  }
  if (typeof simulate !== 'function' || typeof onTick !== 'function' ||
      typeof isEnded !== 'function') {
    throw new TypeError('simulate, onTick and isEnded must be functions');
  }
  if (!Number.isSafeInteger(instantButtonMask) || instantButtonMask < 0 ||
      instantButtonMask > 0x7fffffff) throw new RangeError('Invalid instantButtonMask');
  if (typeof adaptiveCatchup !== 'boolean') throw new TypeError('adaptiveCatchup must be a boolean');
  for (const [name, value, min, max] of [
    ['startBufferFrames', startBufferFrames, 1, 16],
    ['maxBufferFrames', maxBufferFrames, startBufferFrames, 512],
    ['maxReplayBufferFrames', maxReplayBufferFrames, maxBufferFrames, 65536],
    ['maxStepsPerUpdate', maxStepsPerUpdate, 1, 32],
    ['maxExtraStepsPerUpdate', maxExtraStepsPerUpdate, 0, 16],
  ]) {
    if (!Number.isInteger(value) || value < min || value > max) throw new RangeError('Invalid ' + name);
  }

  const stepsPerFrame = logicHz / netHz;
  const tickMs = 1000 / logicHz;
  /** @type {Map<number, ConfirmedInput[]>} */
  const pending = new Map();
  let logicTick = 0;
  let started = false;
  let stalled = false;
  let fatal = false;
  let accumulatorMs = 0;
  let stallEvents = 0;
  let catchupSteps = 0;
  let maxBufferedFramesSeen = 0;
  const expected = () => Math.floor(logicTick / stepsPerFrame) + 1;
  const hasStartFrames = () => {
    for (let i = 0; i < startBufferFrames; i++) {
      if (!pending.has(expected() + i)) return false;
    }
    return true;
  };
  function failClosed() { fatal = true; accumulatorMs = 0; return false; }
  /** @param {unknown} inputs @returns {boolean} */
  function validateInputs(inputs) {
    if (!Array.isArray(inputs) || inputs.length !== playerIds.length) return false;
    return inputs.every((input, i) => {
      if (!input || Object.getPrototypeOf(input) !== Object.prototype ||
          input.pid !== playerIds[i] || !Object.hasOwn(input, 'buttons') ||
          !Number.isSafeInteger(input.buttons) || input.buttons < 0 ||
          input.buttons > 0x7fffffff) return false;
      // Canonical input fields are flat integer/boolean data, not live objects.
      return Object.values(input).every(value =>
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isSafeInteger(value)));
    });
  }
  /**
   * @param {ConfirmedFrame} frame
   * @param {{ replay?: boolean }} [options]
   * @returns {boolean}
   */
  function enqueue(frame, options = {}) {
    if (fatal || isEnded()) return false;
    if (!frame || !Number.isSafeInteger(frame.netTick) || frame.netTick <= 0) {
      return failClosed();
    }
    const next = expected();
    if (frame.netTick < next || pending.has(frame.netTick)) return false;
    const cap = options?.replay ? maxReplayBufferFrames : maxBufferFrames;
    if (frame.netTick >= next + cap || pending.size >= cap) {
      return failClosed();
    }
    if (!validateInputs(frame.inputs)) return failClosed();
    pending.set(frame.netTick, structuredClone(frame.inputs));
    maxBufferedFramesSeen = Math.max(maxBufferedFramesSeen, pending.size);
    return true;
  }
  /** @param {readonly ConfirmedFrame[]} frames @returns {number} */
  function enqueueReplay(frames) {
    if (!Array.isArray(frames)) throw new TypeError('frames must be an array');
    let accepted = 0;
    for (const frame of frames) {
      if (enqueue(frame, { replay: true })) accepted++;
      if (fatal || isEnded()) break;
    }
    return accepted;
  }
  /** @param {boolean} isFastForward @returns {boolean} */
  function stepNextLogicTick(isFastForward) {
    const netTick = expected();
    const sealed = pending.get(netTick);
    if (!sealed) {
      if (!isFastForward) {
        if (!stalled) stallEvents++;
        stalled = true;
      }
      accumulatorMs = 0;
      return false;
    }
    const substep = logicTick % stepsPerFrame;
    const inputs = structuredClone(sealed);
    if (substep !== 0 && instantButtonMask) {
      for (const input of inputs) {
        input.buttons = input.buttons & ~instantButtonMask;
      }
    }
    const targetLogicTick = logicTick + 1;
    // Do not commit a tick that the game simulation rejected or threw on.
    try {
      simulate(inputs, { logicTick: targetLogicTick, netTick, substep, stepsPerFrame, isFastForward });
    } catch (error) {
      fatal = true;
      accumulatorMs = 0;
      throw error;
    }
    logicTick = targetLogicTick;
    stalled = false;
    if (logicTick % stepsPerFrame === 0) pending.delete(netTick);
    // Immediately after the real Tick: never delay hash calculation until
    // after a multi-tick catch-up and accidentally hash the wrong state.
    try {
      onTick({ logicTick, netTick, substep, isFastForward });
    } catch (error) {
      fatal = true;
      accumulatorMs = 0;
      throw error;
    }
    return true;
  }
  /** @param {number} [maxFrames=Infinity] @returns {FastForwardResult} */
  function fastForward(maxFrames = Infinity) {
    if (fatal || isEnded()) return { netFramesCompleted: 0, logicTicksCompleted: 0 };
    if (maxFrames !== Infinity && (!Number.isInteger(maxFrames) || maxFrames < 0)) {
      throw new RangeError('maxFrames must be a nonnegative integer or Infinity');
    }
    let logicTicksCompleted = 0;
    let netFramesCompleted = 0;
    while (netFramesCompleted < maxFrames && !isEnded()) {
      const beforeNetTick = expected();
      if (!pending.has(beforeNetTick)) break;
      started = true;
      if (!stepNextLogicTick(true)) break;
      logicTicksCompleted++;
      catchupSteps++;
      if (expected() > beforeNetTick) netFramesCompleted++;
    }
    accumulatorMs = 0;
    return { netFramesCompleted, logicTicksCompleted };
  }
  /** @param {{ netTick: number, logicTick?: number }} checkpoint */
  function restoreCheckpoint(checkpoint) {
    if (fatal) throw new Error('Cannot restore checkpoint on a fatal scheduler');
    if (!checkpoint || !Number.isSafeInteger(checkpoint.netTick) || checkpoint.netTick < 0) {
      throw new RangeError('checkpoint.netTick must be a nonnegative safe integer');
    }
    const expectedLogicTick = checkpoint.netTick * stepsPerFrame;
    const targetLogicTick = checkpoint.logicTick ?? expectedLogicTick;
    if (!Number.isSafeInteger(targetLogicTick) || targetLogicTick !== expectedLogicTick) {
      throw new RangeError('checkpoint.logicTick must equal checkpoint.netTick * stepsPerFrame');
    }
    logicTick = targetLogicTick;
    for (const tick of pending.keys()) {
      if (tick <= checkpoint.netTick) pending.delete(tick);
    }
    started = checkpoint.netTick > 0 || hasStartFrames();
    stalled = false;
    accumulatorMs = 0;
  }
  /** @param {number} elapsedMs @returns {number} */
  function advanceElapsedMs(elapsedMs) {
    if (fatal || isEnded()) return 0;
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new RangeError('Display elapsed time must be nonnegative and finite');
    }
    if (!started) {
      if (!hasStartFrames()) return 0;
      started = true;
      stalled = false;
      accumulatorMs = 0;
      return 0;
    }
    accumulatorMs += elapsedMs;
    let completed = 0;
    const excessFrames = pending.size - (startBufferFrames + 1);
    let recoveryBudget = 0;
    if (excessFrames > 0) {
      recoveryBudget = adaptiveCatchup
        ? Math.min(maxExtraStepsPerUpdate, excessFrames * stepsPerFrame)
        : Math.min(maxExtraStepsPerUpdate, 1);
    }
    while ((accumulatorMs + 1e-9 >= tickMs || recoveryBudget > 0) &&
      completed < maxStepsPerUpdate) {
      if (isEnded()) { accumulatorMs = 0; break; }
      const recovery = accumulatorMs + 1e-9 < tickMs;
      if (!stepNextLogicTick(false)) break;
      completed++;
      if (recovery) {
        recoveryBudget--;
        catchupSteps++;
      } else {
        accumulatorMs = Math.max(0, accumulatorMs - tickMs);
      }
      if (isEnded()) { accumulatorMs = 0; break; }
    }
    return completed;
  }
  return {
    enqueue,
    enqueueReplay,
    fastForward,
    restoreCheckpoint,
    advanceElapsedMs,
    get started() { return started; },
    get stalled() { return stalled; },
    get fatal() { return fatal; },
    get logicTick() { return logicTick; },
    get expectedNetTick() { return expected(); },
    get bufferedFrames() { return pending.size; },
    get stallEvents() { return stallEvents; },
    get catchupSteps() { return catchupSteps; },
    get maxBufferedFramesSeen() { return maxBufferedFramesSeen; },
    get renderAlpha() { return fatal || stalled || !started ? 0 : Math.min(1, accumulatorMs / tickMs); },
    dispose() { fatal = true; pending.clear(); accumulatorMs = 0; },
  };
}
