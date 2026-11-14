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
export function createStateMachine(options: StateMachineOptions): Readonly<{
    update: (dt: any) => any;
    send: (eventName: any, payload?: any) => boolean;
    transitionTo: (targetId: any, payload?: any) => any;
    reset: (nextInitial?: string) => any;
    isIn: (stateId: any) => boolean;
    getState: () => any;
    getStateTime: () => number;
    getContext: () => unknown;
}>;
export type StateTransition = {
    /**
     * Target state identifier.
     */
    to: string;
    /**
     * Guard evaluated during update(dt).
     */
    when?: (ctx: unknown, stateTime: number) => boolean;
    /**
     * Event name handled by send(event, payload).
     */
    event?: string;
    /**
     * Optional guard for event transitions.
     */
    guard?: (ctx: unknown, payload: unknown) => boolean;
};
export type StateConfig = {
    /**
     * Optional parent state id for hierarchical FSM behavior.
     */
    parent?: string | null;
    /**
     * Default child state id when transitioning directly into a parent state.
     */
    initial?: string | null;
    onEnter?: (ctx: unknown, prevState: string | null, payload: unknown) => void;
    onUpdate?: (ctx: unknown, dt: number, stateTime: number) => void;
    onExit?: (ctx: unknown, nextState: string | null) => void;
    transitions?: StateTransition[];
};
export type StateMachineOptions = {
    /**
     * Initial state identifier.
     */
    initial: string;
    /**
     * State definitions keyed by id.
     */
    states: Record<string, StateConfig>;
    /**
     * Context object passed to lifecycle and guard callbacks.
     */
    context?: unknown;
    onTransition?: (from: string | null, to: string, payload: unknown) => void;
};
