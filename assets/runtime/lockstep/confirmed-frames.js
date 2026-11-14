/**
 * Confirmed-input scheduler only. NOT a network client, deterministic physics,
 * rollback engine, anti-cheat layer or proof of cross-platform determinism.
 *
 * The caller owns protocol validation, pure integer simulation and state hash.
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
    ['maxStepsPerUpdate', maxStepsPerUpdate, 1, 32],
    ['maxExtraStepsPerUpdate', maxExtraStepsPerUpdate, 0, 16],
  ]) {
    if (!Number.isInteger(value) || value < min || value > max) throw new RangeError('Invalid ' + name);
  }

  const stepsPerFrame = logicHz / netHz;
  const tickMs = 1000 / logicHz;
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
  function enqueue(frame) {
    if (fatal || isEnded()) return false;
    if (!frame || !Number.isSafeInteger(frame.netTick) || frame.netTick <= 0) {
      return failClosed();
    }
    const next = expected();
    if (frame.netTick < next || pending.has(frame.netTick)) return false;
    if (frame.netTick >= next + maxBufferFrames || pending.size >= maxBufferFrames) {
      return failClosed();
    }
    if (!validateInputs(frame.inputs)) return failClosed();
    pending.set(frame.netTick, structuredClone(frame.inputs));
    maxBufferedFramesSeen = Math.max(maxBufferedFramesSeen, pending.size);
    return true;
  }
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
      const netTick = expected();
      const sealed = pending.get(netTick);
      if (!sealed) {
        if (!stalled) stallEvents++;
        stalled = true;
        accumulatorMs = 0;
        break;
      }
      const recovery = accumulatorMs + 1e-9 < tickMs;
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
        simulate(inputs, { logicTick: targetLogicTick, netTick, substep, stepsPerFrame });
      } catch (error) {
        fatal = true;
        accumulatorMs = 0;
        throw error;
      }
      logicTick = targetLogicTick;
      completed++;
      if (recovery) {
        recoveryBudget--;
        catchupSteps++;
      } else {
        accumulatorMs = Math.max(0, accumulatorMs - tickMs);
      }
      stalled = false;
      if (logicTick % stepsPerFrame === 0) pending.delete(netTick);
      // Immediately after the real Tick: never delay hash calculation until
      // after a multi-tick catch-up and accidentally hash the wrong state.
      try {
        onTick({ logicTick, netTick, substep });
      } catch (error) {
        fatal = true;
        accumulatorMs = 0;
        throw error;
      }
      if (isEnded()) { accumulatorMs = 0; break; }
    }
    return completed;
  }
  return {
    enqueue,
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
