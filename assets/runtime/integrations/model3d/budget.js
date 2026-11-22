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
export function createAnimationBudgetAllocator({
  maxFullRateCount = 16,
  maxHalfRateCount = 32,
  maxQuarterRateCount = 48,
  offscreenTickInterval = 0.5,
  maxUpdateBudgetPerFrame = Infinity,
  maxAccumulatedDt = 2.0,
  priorityWeight = 10,
  starvationWeight = 25,
  distancePenalty = 1,
} = {}) {
  let nextSlot = 0;
  let frameCounter = 0;
  /** @type {Map<AnimationBudgetTarget, AnimationBudgetEntry>} */
  const entries = new Map();
  const visibleQueue = [];
  const offscreenQueue = [];

  function register(target, {
    priority = 0,
    getPosition = null,
    getVisible = null,
    onStep = null,
  } = {}) {
    if (!target) throw new TypeError('register requires an animation component or target object');
    const existing = entries.get(target);
    if (existing) {
      existing.priority = Number(priority) || 0;
      if (typeof getPosition === 'function') existing.getPosition = getPosition;
      if (typeof getVisible === 'function') existing.getVisible = getVisible;
      if (typeof onStep === 'function') existing.onStep = onStep;
      return existing;
    }

    target._setBudgetManaged?.(true);
    const entry = {
      target,
      slot: nextSlot++,
      priority: Number(priority) || 0,
      getPosition: typeof getPosition === 'function' ? getPosition : null,
      getVisible: typeof getVisible === 'function' ? getVisible : null,
      onStep: typeof onStep === 'function' ? onStep : null,
      accumDt: 0,
      tickCount: 0,
      score: 0,
      lastDist: 0,
      lastStride: 1,
    };
    entries.set(target, entry);
    return entry;
  }

  function unregister(target) {
    const entry = entries.get(target);
    if (!entry) return false;
    target._setBudgetManaged?.(false);
    entries.delete(target);
    return true;
  }

  function setPriority(target, priority) {
    const entry = entries.get(target);
    if (!entry) return false;
    entry.priority = Number(priority) || 0;
    return true;
  }

  function readTargetPosition(entry) {
    if (entry.getPosition) return entry.getPosition(entry.target);
    const objPos = entry.target?.object3d?.position ?? entry.target?.position;
    if (objPos) return objPos;
    const ent = entry.target?.entity;
    if (ent) return { x: ent.x ?? 0, y: ent.y ?? 0, z: ent.z ?? 0 };
    return null;
  }

  function readTargetVisible(entry) {
    if (entry.getVisible) return Boolean(entry.getVisible(entry.target));
    if (entry.target?.object3d?.visible !== undefined) return Boolean(entry.target.object3d.visible);
    if (entry.target?.visible !== undefined) return Boolean(entry.target.visible);
    return true;
  }

  function invokeEntryStep(entry, dt) {
    if (entry.onStep) {
      entry.onStep(dt, entry.target);
    } else if (typeof entry.target?._stepBudgeted === 'function') {
      entry.target._stepBudgeted(dt);
    } else if (typeof entry.target?.update === 'function') {
      entry.target.update(dt);
    } else if (typeof entry.target === 'function') {
      entry.target(dt);
    }
    entry.accumDt = 0;
    entry.tickCount++;
  }

  function update(dt = 0, cameraOrPos = null) {
    const delta = Number.isFinite(dt) && dt > 0 ? dt : 0;
    frameCounter++;

    const camPos = cameraOrPos?.position ?? cameraOrPos;
    const hasCamPos = camPos && Number.isFinite(camPos.x);
    const cx = hasCamPos ? (Number(camPos.x) || 0) : 0;
    const cy = hasCamPos ? (Number(camPos.y) || 0) : 0;
    const cz = hasCamPos ? (Number(camPos.z) || 0) : 0;

    visibleQueue.length = 0;
    offscreenQueue.length = 0;

    for (const [target, entry] of entries.entries()) {
      if (target?.entity?.destroyed || target?._destroyed) {
        entries.delete(target);
        continue;
      }
      entry.accumDt = Math.min(maxAccumulatedDt, entry.accumDt + delta);

      const pos = readTargetPosition(entry);
      const dist = (hasCamPos && pos && Number.isFinite(pos.x))
        ? Math.hypot((Number(pos.x) || 0) - cx, (Number(pos.y) || 0) - cy, (Number(pos.z) || 0) - cz)
        : 0;
      entry.lastDist = dist;

      const visible = readTargetVisible(entry);
      entry.score =
        entry.priority * priorityWeight +
        entry.accumDt * starvationWeight -
        dist * distancePenalty;

      if (visible) {
        visibleQueue.push(entry);
      } else {
        offscreenQueue.push(entry);
      }
    }

    visibleQueue.sort((a, b) => (b.score - a.score) || (a.slot - b.slot));
    offscreenQueue.sort((a, b) => (b.accumDt - a.accumDt) || (b.score - a.score));

    const budget = Number.isFinite(maxUpdateBudgetPerFrame) && maxUpdateBudgetPerFrame >= 0
      ? Math.floor(maxUpdateBudgetPerFrame)
      : Infinity;

    let updated = 0;
    let fullRate = 0;
    let throttled = 0;
    let deferred = 0;
    let offscreenSkipped = 0;

    const halfEnd = maxFullRateCount + maxHalfRateCount;
    const quarterEnd = halfEnd + maxQuarterRateCount;

    for (let i = 0; i < visibleQueue.length; i++) {
      const entry = visibleQueue[i];
      let stride = 8;
      if (i < maxFullRateCount) stride = 1;
      else if (i < halfEnd) stride = 2;
      else if (i < quarterEnd) stride = 4;
      entry.lastStride = stride;

      const wantsTick = stride === 1 || ((frameCounter + entry.slot) % stride) === 0;
      if (!wantsTick) {
        deferred++;
        continue;
      }
      if (updated >= budget) {
        deferred++;
        continue;
      }

      if (entry.accumDt > 0) {
        invokeEntryStep(entry, entry.accumDt);
        updated++;
        if (stride === 1) fullRate++;
        else throttled++;
      }
    }

    for (let i = 0; i < offscreenQueue.length; i++) {
      const entry = offscreenQueue[i];
      entry.lastStride = 0;
      if (updated < budget && entry.accumDt >= offscreenTickInterval && entry.accumDt > 0) {
        invokeEntryStep(entry, entry.accumDt);
        updated++;
        throttled++;
      } else {
        offscreenSkipped++;
      }
    }

    const total = visibleQueue.length + offscreenQueue.length;
    visibleQueue.length = 0;
    offscreenQueue.length = 0;

    return {
      total,
      updated,
      fullRate,
      throttled,
      deferred,
      offscreenSkipped,
    };
  }

  function clear() {
    for (const target of entries.keys()) {
      target._setBudgetManaged?.(false);
    }
    entries.clear();
  }

  return Object.freeze({
    get size() { return entries.size; },
    register,
    unregister,
    setPriority,
    update,
    clear,
  });
}

/**
 * Unified 3D representation residency budget across near/skinned actors, Bone-VAT crowds,
 * far impostors, full open-world cells, and HLOD proxies.
 *
 * @param {object} [options]
 * @param {number} [options.maxBytes=67108864] Maximum total tracked GPU/representation byte budget.
 * @param {number} [options.maxSlots=Infinity] Maximum active representation slot count.
 */
export function createRepresentationBudget3D({
  maxBytes = 64 * 1024 * 1024,
  maxSlots = Infinity,
} = {}) {
  const byteCap = Math.max(0, Number(maxBytes) || 0);
  const slotCap = maxSlots === Infinity ? Infinity : Math.max(0, Math.floor(Number(maxSlots) || 0));
  const items = new Map();
  let totalBytes = 0;
  let totalSlots = 0;
  let tick = 0;
  const evictions = [];

  function recordEviction(entry, reason) {
    evictions.push({ id: entry.id, tier: entry.tier, bytes: entry.bytes, slots: entry.slots, reason, tick });
    if (evictions.length > 64) evictions.shift();
  }

  function removeEntry(entry) {
    items.delete(entry.id);
    totalBytes = Math.max(0, totalBytes - entry.bytes);
    totalSlots = Math.max(0, totalSlots - entry.slots);
  }

  function release(id) {
    const entry = items.get(id);
    if (!entry) return false;
    removeEntry(entry);
    return true;
  }

  function touch(id) {
    const entry = items.get(id);
    if (!entry) return false;
    entry.lastUsedTick = ++tick;
    return true;
  }

  function pickEvictCandidate(excludeId = null) {
    let best = null;
    for (const candidate of items.values()) {
      if (candidate.id === excludeId) continue;
      if (!best || candidate.priority < best.priority ||
          (candidate.priority === best.priority && candidate.lastUsedTick < best.lastUsedTick)) {
        best = candidate;
      }
    }
    return best;
  }

  function enforce(excludeId = null) {
    const evicted = [];
    while ((totalBytes > byteCap || totalSlots > slotCap) && items.size > (excludeId !== null && items.has(excludeId) ? 1 : 0)) {
      const candidate = pickEvictCandidate(excludeId);
      if (!candidate) break;
      const reason = totalBytes > byteCap ? 'byte-budget' : 'slot-budget';
      removeEntry(candidate);
      recordEviction(candidate, reason);
      evicted.push({ id: candidate.id, tier: candidate.tier, reason, bytes: candidate.bytes, slots: candidate.slots });
      try {
        candidate.onEvict?.(candidate.id, candidate);
      } catch {
        // Eviction hooks must not break budget accounting.
      }
    }
    return evicted;
  }

  function allocate(id, {
    tier = 'near',
    bytes = 0,
    slots = 1,
    priority = 0,
    onEvict = null,
  } = {}) {
    if (id === undefined || id === null) throw new TypeError('allocate requires a non-null representation id');
    const normBytes = Math.max(0, Number(bytes) || 0);
    const normSlots = Math.max(0, Math.floor(Number(slots) || 0));
    const existing = items.get(id);
    if (existing) removeEntry(existing);
    const entry = {
      id,
      tier: String(tier || 'near'),
      bytes: normBytes,
      slots: normSlots,
      priority: Number(priority) || 0,
      onEvict: typeof onEvict === 'function' ? onEvict : null,
      lastUsedTick: ++tick,
    };
    items.set(id, entry);
    totalBytes += normBytes;
    totalSlots += normSlots;
    const evicted = enforce(id);
    return { id, totalBytes, totalSlots, evicted };
  }

  function getStats() {
    const byTier = Object.create(null);
    for (const entry of items.values()) {
      const bucket = byTier[entry.tier] ?? { count: 0, bytes: 0, slots: 0 };
      bucket.count++;
      bucket.bytes += entry.bytes;
      bucket.slots += entry.slots;
      byTier[entry.tier] = bucket;
    }
    return {
      count: items.size,
      totalBytes,
      totalSlots,
      maxBytes: byteCap,
      maxSlots: slotCap,
      byTier,
      evictions: evictions.slice(),
    };
  }

  function clear() {
    items.clear();
    totalBytes = 0;
    totalSlots = 0;
  }

  return Object.freeze({
    allocate,
    release,
    touch,
    enforce,
    getStats,
    clear,
  });
}

/**
 * Default per-LOD animation update rates (Hz) for staggered skeletal updates (URO).
 * @type {Readonly<{ 0: number, 1: number, 2: number, 3: number }>}
 */
export const DEFAULT_LOD_ANIMATION_RATES = Object.freeze({
  0: 24,
  1: 12,
  2: 6,
  3: 6,
});

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
export function createLodAnimationScheduler({
  rates = DEFAULT_LOD_ANIMATION_RATES,
  maxAccumulatedDt = 2.0,
} = {}) {
  const normRates = {
    0: Math.max(1, Number(rates?.[0]) || DEFAULT_LOD_ANIMATION_RATES[0]),
    1: Math.max(1, Number(rates?.[1]) || DEFAULT_LOD_ANIMATION_RATES[1]),
    2: Math.max(1, Number(rates?.[2]) || DEFAULT_LOD_ANIMATION_RATES[2]),
    3: Math.max(1, Number(rates?.[3]) || DEFAULT_LOD_ANIMATION_RATES[3]),
  };
  const maxAccum = Math.max(0.05, Number(maxAccumulatedDt) || 2.0);
  const GOLDEN_CONJ = 0.61803398875;
  let nextSlot = 0;
  /** @type {Map<unknown, any>} */
  const entries = new Map();

  function normalizeLod(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(3, Math.floor(n)));
  }

  function stepEntry(entry, dt) {
    if (entry.onStep) {
      entry.onStep(dt, entry.target);
    } else if (typeof entry.target?.update === 'function') {
      entry.target.update(dt);
    } else if (typeof entry.target === 'function') {
      entry.target(dt);
    }
    entry.accumDt = 0;
  }

  function register(target, { lod = 0, getLod = null, onStep = null } = {}) {
    if (!target) throw new TypeError('register requires a mixer or animation target');
    const existing = entries.get(target);
    if (existing) {
      existing.lod = normalizeLod(lod);
      if (typeof getLod === 'function') existing.getLod = getLod;
      if (typeof onStep === 'function') existing.onStep = onStep;
      return existing;
    }
    const slot = nextSlot++;
    const initLod = normalizeLod(lod);
    const interval = 1 / normRates[initLod];
    const phaseFrac = (slot * GOLDEN_CONJ) % 1;
    const entry = {
      target,
      slot,
      lod: initLod,
      phaseFrac,
      getLod: typeof getLod === 'function' ? getLod : null,
      onStep: typeof onStep === 'function' ? onStep : null,
      accumDt: 0,
      phaseAccum: phaseFrac * interval,
    };
    entries.set(target, entry);
    return entry;
  }

  function unregister(target) {
    return entries.delete(target);
  }

  function setLod(target, lod) {
    const entry = entries.get(target);
    if (!entry) return false;
    entry.lod = normalizeLod(lod);
    return true;
  }

  function clear() {
    entries.clear();
  }

  function flush() {
    for (const entry of entries.values()) {
      stepEntry(entry, entry.accumDt);
    }
  }

  function update(dt = 0) {
    const delta = Number.isFinite(dt) && dt > 0 ? dt : 0;
    let total = 0;
    let updated = 0;
    let skipped = 0;
    /** @type {[number, number, number, number]} */
    const byLod = [0, 0, 0, 0];

    for (const [target, entry] of entries.entries()) {
      if (target?._destroyed || target?.entity?.destroyed) {
        entries.delete(target);
        continue;
      }
      total++;
      const lod = entry.getLod ? normalizeLod(entry.getLod(target)) : entry.lod;
      entry.lod = lod;
      byLod[lod]++;

      const interval = 1 / normRates[lod];
      entry.accumDt = Math.min(maxAccum, entry.accumDt + delta);
      entry.phaseAccum += delta;

      if (entry.phaseAccum + 1e-9 >= interval) {
        stepEntry(entry, entry.accumDt);
        entry.phaseAccum = entry.phaseAccum - Math.floor(entry.phaseAccum / interval) * interval;
        updated++;
      } else {
        skipped++;
      }
    }

    return { total, updated, skipped, byLod };
  }

  function getRates() {
    return Object.freeze({ ...normRates });
  }

  return Object.freeze({
    get size() { return entries.size; },
    register,
    unregister,
    setLod,
    update,
    flush,
    clear,
    getRates,
  });
}

