/**
 * @typedef {object} StateTransition
 * @property {string} to Target state identifier.
 * @property {(ctx: unknown, stateTime: number) => boolean} [when] Guard evaluated during update(dt).
 * @property {string} [event] Event name handled by send(event, payload).
 * @property {(ctx: unknown, payload: unknown) => boolean} [guard] Optional guard for event transitions.
 */

/**
 * @typedef {object} StateConfig
 * @property {string | null} [parent=null] Optional parent state id for hierarchical FSM behavior.
 * @property {string | null} [initial=null] Default child state id when transitioning directly into a parent state.
 * @property {(ctx: unknown, prevState: string | null, payload: unknown) => void} [onEnter]
 * @property {(ctx: unknown, dt: number, stateTime: number) => void} [onUpdate]
 * @property {(ctx: unknown, nextState: string | null) => void} [onExit]
 * @property {StateTransition[]} [transitions]
 */

/**
 * @typedef {object} StateMachineOptions
 * @property {string} initial Initial state identifier.
 * @property {Record<string, StateConfig>} states State definitions keyed by id.
 * @property {unknown} [context={}] Context object passed to lifecycle and guard callbacks.
 * @property {(from: string | null, to: string, payload: unknown) => void} [onTransition]
 */

/**
 * Declarative Hierarchical Finite State Machine (HFSM) with LCA enter/exit semantics,
 * event-driven and condition-guarded transitions, and zero per-tick allocations.
 * @param {StateMachineOptions} options
 */
export function createStateMachine(options) {
  if (!options || typeof options !== 'object' || !options.states) {
    throw new TypeError('createStateMachine requires { initial, states }.');
  }
  const defs = options.states;
  const ctx = options.context ?? {};
  const onTransition = typeof options.onTransition === 'function' ? options.onTransition : null;

  // Precompute ancestor chains (root -> leaf) once at creation to avoid allocations in update().
  /** @type {Map<string, string[]>} */
  const chains = new Map();
  for (const id of Object.keys(defs)) {
    const chain = [];
    const seen = new Set();
    let cur = id;
    while (cur) {
      if (seen.has(cur)) throw new Error(`Cyclic parent chain detected at state "${cur}".`);
      if (!defs[cur]) throw new Error(`Unknown state "${cur}" referenced in parent chain.`);
      seen.add(cur);
      chain.unshift(cur);
      cur = defs[cur].parent ?? null;
    }
    chains.set(id, chain);
  }

  function resolveInitialLeaf(stateId) {
    let cur = stateId;
    const seen = new Set();
    while (defs[cur]?.initial) {
      if (seen.has(cur)) throw new Error(`Cyclic initial child chain detected at "${cur}".`);
      seen.add(cur);
      cur = defs[cur].initial;
    }
    if (!defs[cur]) throw new Error(`Unknown initial state "${cur}".`);
    return cur;
  }

  let current = resolveInitialLeaf(options.initial);
  let stateTime = 0;

  // Enter initial chain on startup.
  const initChain = chains.get(current);
  for (let i = 0; i < initChain.length; i++) {
    defs[initChain[i]].onEnter?.(ctx, null, null);
  }

  function transitionTo(targetId, payload = null) {
    const resolvedTarget = resolveInitialLeaf(targetId);
    const prevChain = chains.get(current);
    const nextChain = chains.get(resolvedTarget);
    if (!nextChain) throw new Error(`Unknown target state "${targetId}".`);

    // Find lowest common ancestor index.
    let lca = 0;
    const minLen = Math.min(prevChain.length, nextChain.length);
    while (lca < minLen && prevChain[lca] === nextChain[lca]) {
      lca++;
    }
    // Self-transition when transitioning explicitly to exact same leaf: re-enter leaf.
    if (lca === prevChain.length && lca === nextChain.length) {
      lca = Math.max(0, lca - 1);
    }

    const prevLeaf = current;
    for (let i = prevChain.length - 1; i >= lca; i--) {
      defs[prevChain[i]].onExit?.(ctx, resolvedTarget);
    }
    current = resolvedTarget;
    stateTime = 0;
    for (let i = lca; i < nextChain.length; i++) {
      defs[nextChain[i]].onEnter?.(ctx, prevLeaf, payload);
    }
    onTransition?.(prevLeaf, resolvedTarget, payload);
    return resolvedTarget;
  }

  function update(dt) {
    const safeDt = Number.isFinite(dt) && dt >= 0 ? dt : 0;
    stateTime += safeDt;

    // Check transitions from leaf upward so child states can override parent transitions.
    const chain = chains.get(current);
    for (let i = chain.length - 1; i >= 0; i--) {
      const transitions = defs[chain[i]].transitions;
      if (!transitions) continue;
      for (let t = 0; t < transitions.length; t++) {
        const tr = transitions[t];
        if (!tr.event && typeof tr.when === 'function' && tr.when(ctx, stateTime)) {
          transitionTo(tr.to, null);
          return current;
        }
      }
    }

    // Run active chain onUpdate from root -> leaf.
    const activeChain = chains.get(current);
    for (let i = 0; i < activeChain.length; i++) {
      defs[activeChain[i]].onUpdate?.(ctx, safeDt, stateTime);
    }
    return current;
  }

  function send(eventName, payload = null) {
    const chain = chains.get(current);
    for (let i = chain.length - 1; i >= 0; i--) {
      const transitions = defs[chain[i]].transitions;
      if (!transitions) continue;
      for (let t = 0; t < transitions.length; t++) {
        const tr = transitions[t];
        if (tr.event === eventName && (!tr.guard || tr.guard(ctx, payload))) {
          transitionTo(tr.to, payload);
          return true;
        }
      }
    }
    return false;
  }

  function isIn(stateId) {
    const chain = chains.get(current);
    return chain ? chain.includes(stateId) : false;
  }

  function reset(nextInitial = options.initial) {
    const prevChain = chains.get(current);
    const resolved = resolveInitialLeaf(nextInitial);
    for (let i = prevChain.length - 1; i >= 0; i--) {
      defs[prevChain[i]].onExit?.(ctx, resolved);
    }
    current = resolved;
    stateTime = 0;
    const initC = chains.get(current);
    for (let i = 0; i < initC.length; i++) {
      defs[initC[i]].onEnter?.(ctx, null, null);
    }
    return current;
  }

  return Object.freeze({
    update,
    send,
    transitionTo,
    reset,
    isIn,
    getState: () => current,
    getStateTime: () => stateTime,
    getContext: () => ctx,
  });
}
