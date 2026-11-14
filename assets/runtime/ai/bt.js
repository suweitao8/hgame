/** Execution status constants returned by behavior tree nodes. */
export const BT_STATUS = Object.freeze({
  SUCCESS: 'success',
  FAILURE: 'failure',
  RUNNING: 'running',
});

/** @typedef {'success' | 'failure' | 'running'} BTStatus */
/** @typedef {{ kind: string, [key: string]: unknown }} BTNode */

/** Runs children left-to-right until one returns FAILURE or RUNNING (resumes from running child). */
export function sequence(...children) {
  return Object.freeze({ kind: 'sequence', children });
}

/** Runs children left-to-right until one returns SUCCESS or RUNNING (resumes from running child). */
export function selector(...children) {
  return Object.freeze({ kind: 'selector', children });
}

/**
 * Runs all children concurrently.
 * @param {'all' | 'any'} [policy='all'] `'all'` succeeds when every child succeeds; `'any'` succeeds when any child succeeds.
 * @param {...BTNode} children
 */
export function parallel(policy = 'all', ...children) {
  const actualChildren = typeof policy === 'string' ? children : [policy, ...children];
  const actualPolicy = typeof policy === 'string' ? policy : 'all';
  return Object.freeze({ kind: 'parallel', policy: actualPolicy, children: actualChildren });
}

/** Inverts SUCCESS <-> FAILURE while forwarding RUNNING. */
export function inverter(child) {
  return Object.freeze({ kind: 'inverter', child });
}

/** Repeats `child` up to `count` times (`count < 0` repeats until child returns FAILURE). */
export function repeater(count, child) {
  return Object.freeze({ kind: 'repeater', count, child });
}

/** Enforces a minimum cooldown (seconds) after `child` finishes with SUCCESS or FAILURE. */
export function cooldown(seconds, child) {
  return Object.freeze({ kind: 'cooldown', seconds, child });
}

/** Evaluates a boolean predicate against `(blackboard, context)`. */
export function condition(predicate) {
  if (typeof predicate !== 'function') throw new TypeError('condition(predicate) expects a function.');
  return Object.freeze({ kind: 'condition', predicate });
}

/** Executes an action callback `(blackboard, context, dt) => BTStatus | boolean | void`. */
export function action(fn) {
  if (typeof fn !== 'function') throw new TypeError('action(fn) expects a function.');
  return Object.freeze({ kind: 'action', fn });
}

/** Waits for `seconds` while returning RUNNING, then returns SUCCESS. */
export function wait(seconds) {
  return Object.freeze({ kind: 'wait', seconds: Math.max(0, Number(seconds) || 0) });
}

/**
 * @typedef {object} BehaviorTreeOptions
 * @property {Record<string, unknown>} [blackboard={}] Per-agent mutable blackboard state.
 * @property {unknown} [context={}] Shared entity/scene context passed to leaf nodes.
 */

/**
 * Creates an isolated runtime runner over an immutable behavior tree definition.
 * Multiple AI agents can share the same tree nodes with independent running state & cooldowns.
 * @param {BTNode} root
 * @param {BehaviorTreeOptions} [options={}]
 */
export function createBehaviorTree(root, options = {}) {
  if (!root || typeof root !== 'object') throw new TypeError('createBehaviorTree requires a root node.');
  const blackboard = options.blackboard ?? {};
  const context = options.context ?? {};

  // Assign dense integer indices to nodes so runtime memory stays typed & GC-free.
  let nextId = 0;
  /** @type {WeakMap<object, number>} */
  const nodeIds = new WeakMap();
  function indexTree(node) {
    if (!node || typeof node !== 'object') return;
    if (!nodeIds.has(node)) nodeIds.set(node, nextId++);
    if (Array.isArray(node.children)) {
      for (let i = 0; i < node.children.length; i++) indexTree(node.children[i]);
    }
    if (node.child) indexTree(node.child);
  }
  indexTree(root);

  const runningIndex = new Int32Array(nextId);
  const timers = new Float64Array(nextId);
  const repeatCounts = new Int32Array(nextId);
  let elapsed = 0;
  timers.fill(-1e9);

  function resetSubtree(node) {
    const id = nodeIds.get(node);
    if (id !== undefined) {
      runningIndex[id] = 0;
      repeatCounts[id] = 0;
      if (node.kind === 'wait') timers[id] = -1e9;
    }
    if (Array.isArray(node.children)) {
      for (let i = 0; i < node.children.length; i++) resetSubtree(node.children[i]);
    }
    if (node.child) resetSubtree(node.child);
  }

  function evalNode(node, dt) {
    const id = nodeIds.get(node);
    switch (node.kind) {
      case 'condition':
        return node.predicate(blackboard, context) ? BT_STATUS.SUCCESS : BT_STATUS.FAILURE;

      case 'action': {
        const res = node.fn(blackboard, context, dt);
        if (res === BT_STATUS.SUCCESS || res === BT_STATUS.FAILURE || res === BT_STATUS.RUNNING) return res;
        return res === false ? BT_STATUS.FAILURE : BT_STATUS.SUCCESS;
      }

      case 'wait': {
        if (timers[id] < 0) timers[id] = 0;
        timers[id] += dt;
        if (timers[id] >= node.seconds) {
          timers[id] = -1e9;
          return BT_STATUS.SUCCESS;
        }
        return BT_STATUS.RUNNING;
      }

      case 'sequence': {
        let i = runningIndex[id];
        for (; i < node.children.length; i++) {
          const status = evalNode(node.children[i], dt);
          if (status === BT_STATUS.RUNNING) {
            runningIndex[id] = i;
            return BT_STATUS.RUNNING;
          }
          if (status === BT_STATUS.FAILURE) {
            runningIndex[id] = 0;
            return BT_STATUS.FAILURE;
          }
        }
        runningIndex[id] = 0;
        return BT_STATUS.SUCCESS;
      }

      case 'selector': {
        const prev = runningIndex[id] - 1;
        for (let i = 0; i < node.children.length; i++) {
          const status = evalNode(node.children[i], dt);
          if (status === BT_STATUS.RUNNING) {
            if (prev >= 0 && prev !== i) resetSubtree(node.children[prev]);
            runningIndex[id] = i + 1;
            return BT_STATUS.RUNNING;
          }
          if (status === BT_STATUS.SUCCESS) {
            if (prev >= 0 && prev !== i) resetSubtree(node.children[prev]);
            runningIndex[id] = 0;
            return BT_STATUS.SUCCESS;
          }
        }
        if (prev >= 0 && prev < node.children.length) resetSubtree(node.children[prev]);
        runningIndex[id] = 0;
        return BT_STATUS.FAILURE;
      }

      case 'parallel': {
        let succ = 0;
        let fail = 0;
        const n = node.children.length;
        for (let i = 0; i < n; i++) {
          const st = evalNode(node.children[i], dt);
          if (st === BT_STATUS.SUCCESS) succ++;
          else if (st === BT_STATUS.FAILURE) fail++;
        }
        if (node.policy === 'any') {
          if (succ > 0) return BT_STATUS.SUCCESS;
          if (fail === n) return BT_STATUS.FAILURE;
          return BT_STATUS.RUNNING;
        }
        if (fail > 0) return BT_STATUS.FAILURE;
        if (succ === n) return BT_STATUS.SUCCESS;
        return BT_STATUS.RUNNING;
      }

      case 'inverter': {
        const st = evalNode(node.child, dt);
        if (st === BT_STATUS.SUCCESS) return BT_STATUS.FAILURE;
        if (st === BT_STATUS.FAILURE) return BT_STATUS.SUCCESS;
        return BT_STATUS.RUNNING;
      }

      case 'repeater': {
        const st = evalNode(node.child, dt);
        if (st === BT_STATUS.RUNNING) return BT_STATUS.RUNNING;
        if (node.count < 0) {
          return st === BT_STATUS.FAILURE ? BT_STATUS.SUCCESS : BT_STATUS.RUNNING;
        }
        repeatCounts[id]++;
        if (repeatCounts[id] >= node.count) {
          repeatCounts[id] = 0;
          return st;
        }
        return BT_STATUS.RUNNING;
      }

      case 'cooldown': {
        if (elapsed - timers[id] < node.seconds) return BT_STATUS.FAILURE;
        const st = evalNode(node.child, dt);
        if (st !== BT_STATUS.RUNNING) timers[id] = elapsed;
        return st;
      }

      default:
        throw new Error(`Unknown BT node kind: ${String(node.kind)}`);
    }
  }

  function tick(dt = 0) {
    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    elapsed += safeDt;
    return evalNode(root, safeDt);
  }

  function reset() {
    elapsed = 0;
    timers.fill(-1e9);
    resetSubtree(root);
  }

  return Object.freeze({
    tick,
    reset,
    blackboard,
    getElapsed: () => elapsed,
  });
}
