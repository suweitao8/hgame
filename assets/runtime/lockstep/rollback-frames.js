/**
 * @typedef {{ pid: number, buttons: number } & Record<string, number | boolean>} RollbackInput
 *   Canonical flat safe-integer/boolean input for one player on one network tick.
 */

/**
 * @typedef {object} RollbackStepInfo
 * @property {number} logicTick Logic tick being simulated (1-based).
 * @property {number} netTick Network tick this logic tick belongs to.
 * @property {number} substep 0..stepsPerFrame-1 within the network tick.
 * @property {number} stepsPerFrame `logicHz / netHz`.
 * @property {boolean} isResimulating True during rollback re-simulation; skip transient SFX/VFX here.
 */

/**
 * @typedef {object} RollbackConfirmedInfo
 * @property {number} netTick Confirmed network tick whose inputs are now final.
 * @property {number} logicTick Final logic tick of `netTick`.
 * @property {number} slotIndex Snapshot slot index (`netTick % (maxRollbackFrames + 1)`) holding the confirmed state.
 */

/**
 * @typedef {object} RollbackFrameSchedulerOptions
 * @property {number} [netHz=20] Network ticks per second (integer 1..240).
 * @property {number} [logicHz=60] Logic ticks per second; integer multiple of `netHz` (<= 240).
 * @property {readonly number[]} playerIds Sorted unique nonnegative integer player ids (required).
 * @property {(slotIndex: number, netTick: number) => void} saveState Save deterministic world state into preallocated `slotIndex` (`0..maxRollbackFrames`).
 * @property {(slotIndex: number, netTick: number) => void} loadState Restore deterministic world state from `slotIndex`.
 * @property {(inputs: RollbackInput[], info: RollbackStepInfo) => void} simulate Advance one logic tick.
 * @property {(info: RollbackConfirmedInfo) => void} [onConfirmedTick] Called in order once a `netTick` is permanently confirmed (hash/audit here).
 * @property {(pid: number, lastConfirmed: RollbackInput | null, netTick: number) => RollbackInput} [predictInput] Custom input predictor; defaults to repeating `lastConfirmed` with `instantButtonMask` cleared.
 * @property {() => boolean} [isEnded] Return true to stop scheduling.
 * @property {number} [instantButtonMask=0] Buttons cleared on substeps > 0 and default input prediction (31-bit mask).
 * @property {number} [maxRollbackFrames=8] Max speculative prediction window ahead of `confirmedNetTick` (1..64).
 * @property {number} [maxStepsPerUpdate=12] Max new logic ticks per `advanceElapsedMs` call (1..64).
 */

/**
 * @typedef {object} RollbackFrameScheduler
 * @property {(netTick: number, input: RollbackInput) => boolean} submitInput Record an authoritative/real input for one player on `netTick`.
 * @property {(frame: { netTick: number, inputs: readonly RollbackInput[] }) => boolean} enqueueConfirmedFrame Record a full confirmed frame for `netTick`.
 * @property {(elapsedMs: number) => number} advanceElapsedMs Roll back any dirty speculative frames, then advance due ticks.
 * @property {(checkpoint: { netTick: number, logicTick?: number }) => void} restoreCheckpoint Rebase scheduler after restoring an external snapshot.
 * @property {(remoteAdvantageFrames: number) => number} recommendTimeScale Suggest slight pacing adjustment (`0.95..1.0`) when ahead of peers.
 * @property {boolean} stalled True when speculative window reached `maxRollbackFrames` waiting for remote inputs.
 * @property {boolean} fatal
 * @property {number} netTick Latest simulated network tick (may be speculative).
 * @property {number} confirmedNetTick Highest contiguous network tick with all real inputs.
 * @property {number} logicTick Latest simulated logic tick.
 * @property {number} rollbackCount Total rollback events executed.
 * @property {number} resimulatedFrames Total network frames re-simulated due to misprediction.
 * @property {number} maxRollbackDepthSeen
 * @property {number} renderAlpha
 * @property {() => void} dispose
 */

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** @param {unknown} value @param {WeakMap<object, unknown>} [seen] @returns {any} */
function cloneData(value, seen) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  if (value === null || typeof value !== 'object') return value;
  const memo = seen ?? new WeakMap();
  if (memo.has(value)) return memo.get(value);
  /** @type {any} */
  const out = Array.isArray(value) ? [] : {};
  memo.set(value, out);
  for (const key of Object.keys(value)) {
    out[key] = cloneData(/** @type {any} */ (value)[key], memo);
  }
  return out;
}

/**
 * GGPO-style prediction & rollback lockstep scheduler.
 *
 * Uses a fixed `maxRollbackFrames + 1` snapshot slot ring (`saveState` / `loadState`)
 * so games can store flat TypedArray / WASM / Rapier snapshots with zero per-frame GC.
 *
 * @param {RollbackFrameSchedulerOptions} options
 * @returns {RollbackFrameScheduler}
 */
export function createRollbackFrameScheduler({
  netHz = 20,
  logicHz = 60,
  playerIds,
  saveState,
  loadState,
  simulate,
  onConfirmedTick = () => {},
  predictInput,
  isEnded = () => false,
  instantButtonMask = 0,
  maxRollbackFrames = 8,
  maxStepsPerUpdate = 12,
} = {}) {
  if (!Number.isInteger(netHz) || netHz < 1 || netHz > 240 ||
      !Number.isInteger(logicHz) || logicHz < netHz || logicHz > 240 ||
      logicHz % netHz !== 0) {
    throw new RangeError('logicHz must be an integer multiple of netHz (1..240 Hz)');
  }
  if (!Array.isArray(playerIds) || !playerIds.length ||
      playerIds.some((pid, i) => !Number.isSafeInteger(pid) || pid < 0 ||
        (i > 0 && pid <= playerIds[i - 1]))) {
    throw new RangeError('playerIds must be a non-empty sorted list of unique nonnegative integers');
  }
  if (typeof saveState !== 'function' || typeof loadState !== 'function' ||
      typeof simulate !== 'function' || typeof onConfirmedTick !== 'function' ||
      typeof isEnded !== 'function') {
    throw new TypeError('saveState, loadState, simulate, onConfirmedTick and isEnded must be functions');
  }
  if (predictInput !== undefined && typeof predictInput !== 'function') {
    throw new TypeError('predictInput must be a function');
  }
  if (!Number.isSafeInteger(instantButtonMask) || instantButtonMask < 0 ||
      instantButtonMask > 0x7fffffff) throw new RangeError('Invalid instantButtonMask');
  if (!Number.isInteger(maxRollbackFrames) || maxRollbackFrames < 1 || maxRollbackFrames > 64) {
    throw new RangeError('maxRollbackFrames must be an integer from 1 to 64');
  }
  if (!Number.isInteger(maxStepsPerUpdate) || maxStepsPerUpdate < 1 || maxStepsPerUpdate > 64) {
    throw new RangeError('maxStepsPerUpdate must be an integer from 1 to 64');
  }

  const stepsPerFrame = logicHz / netHz;
  const tickMs = 1000 / logicHz;
  const ringSize = maxRollbackFrames + 1;
  const pidIndex = new Map(playerIds.map((pid, idx) => [pid, idx]));

  /** @type {Map<number, Map<number, RollbackInput>>} */
  const realInputsByTick = new Map();
  /** @type {Map<number, RollbackInput[]>} */
  const appliedInputsByTick = new Map();
  /** @type {Map<number, RollbackInput>} */
  const lastRealInputByPid = new Map();

  let confirmedNetTick = 0;
  let lastConfirmedReported = 0;
  let currentNetTick = 0;
  let logicTick = 0;
  let earliestDirtyNetTick = Infinity;
  let initialSnapshotSaved = false;
  let stalled = false;
  let fatal = false;
  let accumulatorMs = 0;
  let rollbackCount = 0;
  let resimulatedFrames = 0;
  let maxRollbackDepthSeen = 0;

  /** @param {unknown} input @returns {boolean} */
  function isValidInput(input) {
    if (!input || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) return false;
    const candidate = /** @type {Record<string, unknown>} */ (input);
    if (!pidIndex.has(/** @type {number} */ (candidate.pid))) return false;
    if (!hasOwn(candidate, 'buttons') || !Number.isSafeInteger(candidate.buttons) ||
        /** @type {number} */ (candidate.buttons) < 0 || /** @type {number} */ (candidate.buttons) > 0x7fffffff) {
      return false;
    }
    return Object.values(candidate).every(value =>
      typeof value === 'boolean' || (typeof value === 'number' && Number.isSafeInteger(value)));
  }

  /** @param {RollbackInput} a @param {RollbackInput} b @returns {boolean} */
  function inputsEqual(a, b) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!hasOwn(b, key) || a[key] !== b[key]) return false;
    }
    return true;
  }

  /** @param {number} pid @param {number} netTick @returns {RollbackInput} */
  function defaultPredict(pid, netTick) {
    const last = lastRealInputByPid.get(pid) ?? null;
    if (predictInput) {
      const custom = predictInput(pid, last ? cloneData(last) : null, netTick);
      if (!isValidInput(custom) || custom.pid !== pid) {
        fatal = true;
        throw new Error('Custom predictInput returned an invalid input object');
      }
      return cloneData(custom);
    }
    if (!last) return { pid, buttons: 0 };
    const copy = cloneData(last);
    if (instantButtonMask) copy.buttons = copy.buttons & ~instantButtonMask;
    return copy;
  }

  /** @param {number} netTick @returns {RollbackInput[]} */
  function resolveFrameInputs(netTick) {
    const realMap = realInputsByTick.get(netTick);
    return playerIds.map((pid) => {
      const real = realMap?.get(pid);
      if (real) return cloneData(real);
      return defaultPredict(pid, netTick);
    });
  }

  function advanceConfirmedCursor() {
    while (true) {
      const next = confirmedNetTick + 1;
      const realMap = realInputsByTick.get(next);
      if (!realMap || realMap.size < playerIds.length) break;
      confirmedNetTick = next;
    }
  }

  function flushConfirmedNotifications() {
    while (lastConfirmedReported < confirmedNetTick) {
      const next = lastConfirmedReported + 1;
      if (next * stepsPerFrame > logicTick || next >= earliestDirtyNetTick) break;
      lastConfirmedReported = next;
      onConfirmedTick({ netTick: next, logicTick: next * stepsPerFrame, slotIndex: next % ringSize });
      realInputsByTick.delete(next);
      appliedInputsByTick.delete(next);
    }
  }

  /** @param {number} netTick @param {RollbackInput} input @returns {boolean} */
  function submitInput(netTick, input) {
    if (fatal || isEnded()) return false;
    if (!Number.isSafeInteger(netTick) || netTick <= 0) {
      fatal = true;
      return false;
    }
    if (!isValidInput(input)) {
      fatal = true;
      return false;
    }
    if (netTick <= confirmedNetTick) return false;

    const clone = cloneData(input);
    let realMap = realInputsByTick.get(netTick);
    if (!realMap) {
      realMap = new Map();
      realInputsByTick.set(netTick, realMap);
    }
    const existing = realMap.get(clone.pid);
    if (existing && inputsEqual(existing, clone)) return false;

    realMap.set(clone.pid, clone);
    lastRealInputByPid.set(clone.pid, clone);
    advanceConfirmedCursor();

    if (netTick <= currentNetTick) {
      const applied = appliedInputsByTick.get(netTick);
      const idx = pidIndex.get(clone.pid);
      if (applied && idx !== undefined && !inputsEqual(applied[idx], clone)) {
        if (netTick < earliestDirtyNetTick) earliestDirtyNetTick = netTick;
      }
    }
    flushConfirmedNotifications();
    return true;
  }

  /** @param {{ netTick: number, inputs: readonly RollbackInput[] }} frame @returns {boolean} */
  function enqueueConfirmedFrame(frame) {
    if (fatal || isEnded()) return false;
    if (!frame || !Array.isArray(frame.inputs) || frame.inputs.length !== playerIds.length) {
      fatal = true;
      return false;
    }
    let changed = false;
    for (let i = 0; i < frame.inputs.length; i++) {
      const entry = frame.inputs[i];
      if (!entry || entry.pid !== playerIds[i]) {
        fatal = true;
        return false;
      }
      if (submitInput(frame.netTick, entry)) changed = true;
    }
    return changed;
  }

  /** @param {number} targetNetTick @param {number} substep @param {RollbackInput[]} frameInputs @param {boolean} isResimulating */
  function runSubstep(targetNetTick, substep, frameInputs, isResimulating) {
    const stepInputs = cloneData(frameInputs);
    if (substep !== 0 && instantButtonMask) {
      for (const inp of stepInputs) {
        inp.buttons = inp.buttons & ~instantButtonMask;
      }
    }
    const nextLogicTick = (targetNetTick - 1) * stepsPerFrame + substep + 1;
    try {
      simulate(stepInputs, {
        logicTick: nextLogicTick,
        netTick: targetNetTick,
        substep,
        stepsPerFrame,
        isResimulating,
      });
    } catch (error) {
      fatal = true;
      accumulatorMs = 0;
      throw error;
    }
    logicTick = nextLogicTick;
    if (substep === stepsPerFrame - 1) {
      saveState(targetNetTick % ringSize, targetNetTick);
    }
  }

  function performRollbackIfNeeded() {
    if (earliestDirtyNetTick > currentNetTick) {
      earliestDirtyNetTick = Infinity;
      return;
    }
    const restoreTick = earliestDirtyNetTick - 1;
    if (restoreTick < confirmedNetTick - maxRollbackFrames && restoreTick < 0) {
      fatal = true;
      throw new Error('Rollback exceeded snapshot ring capacity');
    }
    const depth = currentNetTick - restoreTick;
    rollbackCount++;
    if (depth > maxRollbackDepthSeen) maxRollbackDepthSeen = depth;

    loadState(restoreTick % ringSize, restoreTick);

    const startTick = earliestDirtyNetTick;
    const savedCurrentNetTick = currentNetTick;
    const savedLogicTick = logicTick;
    for (let tick = startTick; tick <= savedCurrentNetTick; tick++) {
      const resolved = resolveFrameInputs(tick);
      appliedInputsByTick.set(tick, cloneData(resolved));
      const maxSubstep = tick < savedCurrentNetTick
        ? stepsPerFrame - 1
        : (savedLogicTick - 1) % stepsPerFrame;
      for (let sub = 0; sub <= maxSubstep; sub++) {
        runSubstep(tick, sub, resolved, true);
      }
      resimulatedFrames++;
      earliestDirtyNetTick = tick + 1;
      if (maxSubstep === stepsPerFrame - 1) {
        flushConfirmedNotifications();
      }
    }
    earliestDirtyNetTick = Infinity;
    flushConfirmedNotifications();
  }

  /** @param {number} elapsedMs @returns {number} */
  function advanceElapsedMs(elapsedMs) {
    if (fatal || isEnded()) return 0;
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new RangeError('Display elapsed time must be nonnegative and finite');
    }
    if (!initialSnapshotSaved) {
      saveState(0, 0);
      initialSnapshotSaved = true;
    }

    performRollbackIfNeeded();
    accumulatorMs += elapsedMs;

    let completed = 0;
    while (accumulatorMs + 1e-9 >= tickMs && completed < maxStepsPerUpdate) {
      if (isEnded()) { accumulatorMs = 0; break; }
      const substep = logicTick % stepsPerFrame;
      const targetNetTick = Math.floor(logicTick / stepsPerFrame) + 1;

      if (substep === 0 && targetNetTick > confirmedNetTick + maxRollbackFrames) {
        stalled = true;
        accumulatorMs = 0;
        break;
      }

      stalled = false;
      let frameInputs = appliedInputsByTick.get(targetNetTick);
      if (!frameInputs || substep === 0) {
        frameInputs = resolveFrameInputs(targetNetTick);
        appliedInputsByTick.set(targetNetTick, cloneData(frameInputs));
      }

      if (targetNetTick > currentNetTick) currentNetTick = targetNetTick;
      runSubstep(targetNetTick, substep, frameInputs, false);
      completed++;
      accumulatorMs = Math.max(0, accumulatorMs - tickMs);
      if (substep === stepsPerFrame - 1) {
        flushConfirmedNotifications();
      }
      if (isEnded()) { accumulatorMs = 0; break; }
    }
    return completed;
  }

  /** @param {{ netTick: number, logicTick?: number }} checkpoint */
  function restoreCheckpoint(checkpoint) {
    if (fatal) throw new Error('Cannot restore checkpoint on a fatal scheduler');
    if (!checkpoint || !Number.isSafeInteger(checkpoint.netTick) || checkpoint.netTick < 0) {
      throw new RangeError('checkpoint.netTick must be a nonnegative safe integer');
    }
    const targetLogicTick = checkpoint.logicTick ?? checkpoint.netTick * stepsPerFrame;
    if (targetLogicTick !== checkpoint.netTick * stepsPerFrame) {
      throw new RangeError('checkpoint.logicTick must equal checkpoint.netTick * stepsPerFrame');
    }
    confirmedNetTick = checkpoint.netTick;
    lastConfirmedReported = checkpoint.netTick;
    currentNetTick = checkpoint.netTick;
    logicTick = targetLogicTick;
    earliestDirtyNetTick = Infinity;
    realInputsByTick.clear();
    appliedInputsByTick.clear();
    saveState(checkpoint.netTick % ringSize, checkpoint.netTick);
    initialSnapshotSaved = true;
    stalled = false;
    accumulatorMs = 0;
  }

  /** @param {number} remoteAdvantageFrames @returns {number} */
  function recommendTimeScale(remoteAdvantageFrames) {
    if (!Number.isFinite(remoteAdvantageFrames)) return 1;
    const localAhead = currentNetTick - confirmedNetTick;
    const diff = localAhead - remoteAdvantageFrames;
    if (diff <= 1) return 1;
    if (diff >= 4) return 0.94;
    return 0.97;
  }

  return {
    submitInput,
    enqueueConfirmedFrame,
    advanceElapsedMs,
    restoreCheckpoint,
    recommendTimeScale,
    get stalled() { return stalled; },
    get fatal() { return fatal; },
    get netTick() { return currentNetTick; },
    get confirmedNetTick() { return confirmedNetTick; },
    get logicTick() { return logicTick; },
    get rollbackCount() { return rollbackCount; },
    get resimulatedFrames() { return resimulatedFrames; },
    get maxRollbackDepthSeen() { return maxRollbackDepthSeen; },
    get renderAlpha() { return fatal || stalled ? 0 : Math.min(1, accumulatorMs / tickMs); },
    dispose() {
      fatal = true;
      realInputsByTick.clear();
      appliedInputsByTick.clear();
      lastRealInputByPid.clear();
      accumulatorMs = 0;
    },
  };
}
