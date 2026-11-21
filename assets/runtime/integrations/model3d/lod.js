/**
 * @typedef {object} ModelLodState3D
 * @property {number} x Actor position in the representations' common coordinate space.
 * @property {number} y Actor height. The shared Bone-VAT crowd uses its configured ground plane.
 * @property {number} z Actor position in the representations' common coordinate space.
 * @property {number} rotationY Yaw in radians.
 * @property {string} clip A looping clip shared by the skeletal model and the crowd.
 * @property {number} time Authoritative clip time in seconds.
 * @property {string | null} [secondaryClip] Optional secondary composite blend clip preserved across LOD transitions.
 * @property {number} [secondaryTime=0] Secondary clip time in seconds.
 * @property {number} [blendWeight=0] Blend weight in [0, 1] for secondary composite clip.
 */

/**
 * @typedef {object} ModelLodSlot3D
 * @property {(state: ModelLodState3D) => void} sync Apply the actual state and attach on first call. Throw if preparation cannot finish.
 * @property {() => void} dispose Detach if shown and release owned resources, including for a prepared slot that was never shown.
 */

/** @typedef {'near' | 'crowd' | 'far'} ModelLodTier3D */
/** @typedef {(options: {signal: AbortSignal}) => ModelLodSlot3D | Promise<ModelLodSlot3D>} ModelLodFactory3D */

/**
 * @typedef {object} ModelLodOptions3D
 * @property {ModelLodFactory3D} near Prepare a detached skeletal representation.
 * @property {import('./bone-vat.js').BoneVatCrowd3D} crowd Shared standalone crowd, updated once after all controllers.
 * @property {ModelLodFactory3D} far Prepare a detached proxy, such as a group from createHLODProxyGroup3D.
 * @property {number} [crowdDistance=25] Distance at which the crowd tier begins.
 * @property {number} [farDistance=80] Distance at which the proxy tier begins.
 * @property {number} [hysteresis=0.1] Fractional dead band on either side of each threshold, in [0, 1).
 * @property {AbortSignal} [signal] Scene activation or another owner lifetime.
 * @property {object | null} [budget=null] Optional unified representation budget controller (`createRepresentationBudget3D`).
 * @property {string | null} [budgetId=null] Identifier key inside the representation budget.
 * @property {Partial<Record<ModelLodTier3D, number>> | null} [tierBytes=null] Optional per-tier estimated byte footprint.
 * @property {number} [crossFadeSeconds=0] Optional smooth crossfade transition duration across LOD swaps.
 */

/**
 * @typedef {object} ModelLod3D
 * @property {ModelLodTier3D | null} tier Currently shown representation.
 * @property {ModelLodTier3D | null} pendingTier Tier preparing or awaiting the next update.
 * @property {unknown} error Latest transition failure, or null.
 * @property {() => { clip: string, time: number, secondaryClip: string | null, secondaryTime: number, blendWeight: number } | null} getAnimationState Return latest composite animation handoff state.
 * @property {() => { active: boolean, alpha: number, fromTier: ModelLodTier3D | null, toTier: ModelLodTier3D | null }} getCrossFadeState Return smooth LOD crossfade state.
 * @property {(distance: number, state: ModelLodState3D) => void} update Select a tier and apply the latest actor state.
 * @property {() => void} retry Allow another attempt on the next update after a failed transition.
 * @property {() => boolean} dispose Cancel pending work and release the shown representation. Leaves the shared crowd owned by the caller.
 */

const TIERS = /** @type {const} */ (['near', 'crowd', 'far']);

/**
 * Switches one actor between a skeletal model, a shared Bone-VAT slot and a distant proxy.
 * The current tier stays visible while a replacement prepares. The next update samples
 * the replacement at the latest transform and clip time before releasing the old tier.
 * @param {ModelLodOptions3D} options
 * @returns {ModelLod3D}
 */
export function createModelLod3D({ near, crowd, far, crowdDistance = 25, farDistance = 80, hysteresis = 0.1, signal, budget = null, budgetId = null, tierBytes = null, crossFadeSeconds = 0 }) {
  if (typeof near !== 'function' || typeof far !== 'function' || typeof crowd?.setPlayback !== 'function') {
    throw new TypeError('Model LOD requires near and far factories and a Bone-VAT crowd');
  }
  if (!(crowdDistance > 0 && farDistance > crowdDistance && Number.isFinite(farDistance) && hysteresis >= 0 && hysteresis < 1)) {
    throw new RangeError('Model LOD requires increasing finite distances and hysteresis in [0, 1)');
  }
  const budgetKey = budgetId ?? Symbol('model-lod');
  const fadeDuration = Math.max(0, Number(crossFadeSeconds) || 0);
  let lastAnimState = null;
  let lastUpdateMs = null;
  const crossFade = { active: false, alpha: 1, elapsed: 0, fromTier: null, toTier: null };

  const thresholds = [crowdDistance, farDistance];
  const enter = thresholds.map(distance => distance * (1 + hysteresis));
  const leave = thresholds.map(distance => distance * (1 - hysteresis));
  let desired = -1;
  let current = null;
  let pending = null;
  let failure = null;
  let disposed = Boolean(signal?.aborted);
  let updating = false;

  function prepareCrowd() {
    const index = crowd.spawn({ speed: 0 });
    if (index < 0) throw new Error('Bone-VAT crowd has no available slot capacity');
    return {
      sync({ x, y, z, rotationY, clip, time }) {
        if (!crowd.setPlayback(index, clip, time) || !crowd.setTransform(index, x, y, z, rotationY)) {
          throw new Error(`Cannot sample Bone-VAT clip ${clip} in the LOD slot`);
        }
        crowd.setDistanceFallback(index, desired !== 1);
      },
      dispose() { crowd.kill(index); },
    };
  }

  const factories = [near, prepareCrowd, far];

  function cancelPending() {
    const job = pending;
    pending = null;
    if (job) {
      job.controller.abort();
      job.slot?.dispose();
    }
  }

  function prepare(target) {
    const controller = new AbortController();
    const job = { target, controller, slot: null };
    pending = job;
    function reject(error) {
      if (pending !== job) return;
      pending = null;
      failure = { error };
    }
    function ready(slot) {
      if (pending !== job) {
        slot?.dispose?.();
      } else if (typeof slot?.sync !== 'function' || typeof slot?.dispose !== 'function') {
        reject(new TypeError('Model LOD factory must return a slot with sync and dispose'));
        slot?.dispose?.();
      } else {
        job.slot = slot;
      }
    }
    try {
      const result = factories[target]({ signal: controller.signal });
      if (typeof result?.then === 'function') Promise.resolve(result).then(ready, reject);
      else ready(result);
    } catch (error) {
      reject(error);
    }
  }

  function activate(job, state) {
    const slot = job.slot;
    job.slot = null;
    try {
      slot.sync(state);
    } catch (error) {
      if (pending === job) {
        pending = null;
        failure = { error };
      }
      slot.dispose();
      return false;
    }
    if (pending !== job) {
      slot.dispose();
      return false;
    }
    pending = null;
    const previous = current;
    current = { target: job.target, slot };
    const tierName = TIERS[job.target];
    if (previous && fadeDuration > 0 && previous.target !== job.target) {
      crossFade.active = true;
      crossFade.elapsed = 0;
      crossFade.alpha = 0;
      crossFade.fromTier = TIERS[previous.target];
      crossFade.toTier = tierName;
    } else {
      crossFade.active = false;
      crossFade.alpha = 1;
      crossFade.fromTier = null;
      crossFade.toTier = tierName;
    }
    budget?.allocate?.(budgetKey, {
      tier: tierName,
      bytes: Math.max(0, Number(tierBytes?.[tierName]) || 0),
      slots: 1,
    });
    previous?.slot.dispose();
    return true;
  }

  function mergeCompositeState(state) {
    const hasCompositeInput = state.secondaryClip !== undefined || Number.isFinite(state.blendWeight);
    const hasPriorComposite = lastAnimState && (lastAnimState.secondaryClip !== null || lastAnimState.blendWeight > 0);
    if (!hasCompositeInput && !hasPriorComposite) {
      lastAnimState = {
        clip: state.clip,
        time: state.time,
        secondaryClip: null,
        secondaryTime: 0,
        blendWeight: 0,
      };
      return state;
    }
    const blendWeight = Number.isFinite(state.blendWeight)
      ? Math.max(0, Math.min(1, state.blendWeight))
      : (lastAnimState?.blendWeight ?? 0);
    const secondaryClip = state.secondaryClip !== undefined ? state.secondaryClip : (lastAnimState?.secondaryClip ?? null);
    const secondaryTime = state.secondaryTime !== undefined ? state.secondaryTime : (lastAnimState?.secondaryTime ?? 0);
    lastAnimState = {
      clip: state.clip,
      time: state.time,
      secondaryClip,
      secondaryTime,
      blendWeight,
    };
    return secondaryClip !== undefined && secondaryClip !== null
      ? { ...state, secondaryClip, secondaryTime, blendWeight }
      : { ...state, blendWeight };
  }

  function update(distance, state) {
    if (disposed || updating) return;
    if (!Number.isFinite(distance) || distance < 0) throw new RangeError('Model LOD distance must be finite and nonnegative');
    updating = true;
    try {
      const nowMs = Date.now();
      const dtSec = Number.isFinite(state?.dt) ? Math.max(0, state.dt) : (lastUpdateMs !== null ? Math.min(0.25, (nowMs - lastUpdateMs) / 1000) : 0);
      lastUpdateMs = nowMs;
      if (crossFade.active && fadeDuration > 0) {
        crossFade.elapsed += dtSec;
        crossFade.alpha = Math.min(1, crossFade.elapsed / fadeDuration);
        if (crossFade.alpha >= 1) crossFade.active = false;
      }
      const mergedState = mergeCompositeState(state);
      const forwardState = crossFade.active ? { ...mergedState, crossFadeAlpha: crossFade.alpha } : mergedState;
      let target = desired;
      if (target < 0) {
        target = distance < crowdDistance ? 0 : distance < farDistance ? 1 : 2;
      } else {
        while (target < 2 && distance >= enter[target]) target++;
        while (target > 0 && distance < leave[target - 1]) target--;
      }
      if (target !== desired) {
        desired = target;
        failure = null;
        cancelPending();
      }
      if (disposed) return;
      if (!failure && !pending && current?.target !== target) prepare(target);
      if (pending?.slot && activate(pending, forwardState)) return;
      current?.slot.sync(forwardState);
    } finally {
      updating = false;
    }
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    signal?.removeEventListener('abort', dispose);
    const previous = current;
    current = null;
    try {
      cancelPending();
    } finally {
      budget?.release?.(budgetKey);
      previous?.slot.dispose();
    }
    return true;
  }

  if (!disposed) signal?.addEventListener('abort', dispose, { once: true });
  return {
    get tier() { return current ? TIERS[current.target] : null; },
    get pendingTier() { return pending ? TIERS[pending.target] : null; },
    get error() { return failure?.error ?? null; },
    getAnimationState: () => (lastAnimState ? { ...lastAnimState } : null),
    getCrossFadeState: () => ({ active: crossFade.active, alpha: crossFade.alpha, fromTier: crossFade.fromTier, toTier: crossFade.toTier }),
    update,
    retry() { failure = null; },
    dispose,
  };
}

/**
 * Inject screen-space 4x4 Bayer Dither LOD crossfade onto any static or skeletal Three.js PBR
 * material so LOD switches dissolve smoothly instead of popping.
 *
 * @param {any} THREE Three.js namespace or compatible mock.
 * @param {any} material Target Three.js Material.
 * @param {object} [options]
 * @param {number} [options.fade=1] Opacity threshold in [0, 1].
 * @param {boolean} [options.invert=false] Invert Bayer pattern order for outgoing vs incoming LOD mesh.
 */
export function injectDitherLodMaterial3D(THREE, material, {
  fade = 1,
  invert = false,
} = {}) {
  if (!material || typeof material !== 'object') return false;
  if (material.userData?.hgameLodDither) {
    material.userData.hgameLodDither.setLodDitherFade(fade, invert);
    return true;
  }

  const uniforms = {
    uLodDitherFade: { value: Math.max(0, Math.min(1, Number(fade) ?? 1)) },
    uLodDitherInvert: { value: invert ? 1 : 0 },
  };
  const prevCompile = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => {
    const base = typeof prevKey === 'function' ? prevKey.call(material) : '';
    return `${base}:hgame-dither-lod`;
  };
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof prevCompile === 'function') prevCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    if (shader.fragmentShader.includes('#include <alphatest_fragment>')) {
      shader.fragmentShader = [
        'uniform float uLodDitherFade;',
        'uniform float uLodDitherInvert;',
      ].join('\n') + '\n' + shader.fragmentShader.replace(
        '#include <alphatest_fragment>',
        [
          '#include <alphatest_fragment>',
          'if (uLodDitherFade < 0.999) {',
          '  int _lx = int(mod(gl_FragCoord.x, 4.0));',
          '  int _ly = int(mod(gl_FragCoord.y, 4.0));',
          '  float _lb = (float((_lx * 5 + _ly * 3) % 16) + 0.5) / 16.0;',
          '  float _lVal = uLodDitherInvert > 0.5 ? (1.0 - _lb) : _lb;',
          '  if (uLodDitherFade <= _lVal) discard;',
          '}',
        ].join('\n'),
      );
    }
  };
  material.userData = {
    ...(material.userData || {}),
    hgameLodDither: {
      uniforms,
      setLodDitherFade(nextFade, nextInvert = false) {
        uniforms.uLodDitherFade.value = Math.max(0, Math.min(1, Number(nextFade) ?? 1));
        uniforms.uLodDitherInvert.value = nextInvert ? 1 : 0;
      },
    },
  };
  material.needsUpdate = true;
  return true;
}
