/** @typedef {'success' | 'failure' | 'running'} BTStatus */
/** @typedef {{ kind: string, [key: string]: unknown }} BTNode */
/** Runs children left-to-right until one returns FAILURE or RUNNING (resumes from running child). */
export function sequence(...children: any[]): Readonly<{
    kind: "sequence";
    children: any[];
}>;
/** Runs children left-to-right until one returns SUCCESS or RUNNING (resumes from running child). */
export function selector(...children: any[]): Readonly<{
    kind: "selector";
    children: any[];
}>;
/**
 * Runs all children concurrently.
 * @param {'all' | 'any'} [policy='all'] `'all'` succeeds when every child succeeds; `'any'` succeeds when any child succeeds.
 * @param {...BTNode} children
 */
export function parallel(policy?: "all" | "any", ...children: BTNode[]): Readonly<{
    kind: "parallel";
    policy: "all" | "any";
    children: BTNode[];
}>;
/** Inverts SUCCESS <-> FAILURE while forwarding RUNNING. */
export function inverter(child: any): Readonly<{
    kind: "inverter";
    child: any;
}>;
/** Repeats `child` up to `count` times (`count < 0` repeats until child returns FAILURE). */
export function repeater(count: any, child: any): Readonly<{
    kind: "repeater";
    count: any;
    child: any;
}>;
/** Enforces a minimum cooldown (seconds) after `child` finishes with SUCCESS or FAILURE. */
export function cooldown(seconds: any, child: any): Readonly<{
    kind: "cooldown";
    seconds: any;
    child: any;
}>;
/** Evaluates a boolean predicate against `(blackboard, context)`. */
export function condition(predicate: any): Readonly<{
    kind: "condition";
    predicate: any;
}>;
/** Executes an action callback `(blackboard, context, dt) => BTStatus | boolean | void`. */
export function action(fn: any): Readonly<{
    kind: "action";
    fn: any;
}>;
/** Waits for `seconds` while returning RUNNING, then returns SUCCESS. */
export function wait(seconds: any): Readonly<{
    kind: "wait";
    seconds: number;
}>;
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
export function createBehaviorTree(root: BTNode, options?: BehaviorTreeOptions): Readonly<{
    tick: (dt?: number) => any;
    reset: () => void;
    blackboard: Record<string, unknown>;
    getElapsed: () => number;
}>;
/** Execution status constants returned by behavior tree nodes. */
export const BT_STATUS: Readonly<{
    SUCCESS: "success";
    FAILURE: "failure";
    RUNNING: "running";
}>;
export type BTStatus = "success" | "failure" | "running";
export type BTNode = {
    kind: string;
    [key: string]: unknown;
};
export type BehaviorTreeOptions = {
    /**
     * Per-agent mutable blackboard state.
     */
    blackboard?: Record<string, unknown>;
    /**
     * Shared entity/scene context passed to leaf nodes.
     */
    context?: unknown;
};
