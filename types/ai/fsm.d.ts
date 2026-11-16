/**
 * @template [TContext=unknown]
 * @typedef {object} StateTransition
 * @property {string} to Target state identifier.
 * @property {(ctx: TContext, stateTime: number) => boolean} [when] Guard evaluated during update(dt).
 * @property {string} [event] Event name handled by send(event, payload).
 * @property {(ctx: TContext, payload: unknown) => boolean} [guard] Optional guard for event transitions.
 */
/**
 * @template [TContext=unknown]
 * @typedef {object} StateConfig
 * @property {string | null} [parent=null] Optional parent state id for hierarchical FSM behavior.
 * @property {string | null} [initial=null] Default child state id when transitioning directly into a parent state.
 * @property {(ctx: TContext, prevState: string | null, payload: unknown) => void} [onEnter]
 * @property {(ctx: TContext, dt: number, stateTime: number) => void} [onUpdate]
 * @property {(ctx: TContext, nextState: string | null) => void} [onExit]
 * @property {StateTransition<TContext>[]} [transitions]
 */
/**
 * @template [TContext=unknown]
 * @typedef {object} StateMachineOptions
 * @property {string} initial Initial state identifier.
 * @property {Record<string, StateConfig<TContext>>} states State definitions keyed by id.
 * @property {TContext} [context] Context object passed to lifecycle and guard callbacks.
 * @property {(from: string | null, to: string, payload: unknown) => void} [onTransition]
 */
/**
 * @template [TContext=unknown]
 * @typedef {object} StateMachine
 * @property {(dt: number) => string} update
 * @property {(eventName: string, payload?: unknown) => boolean} send
 * @property {(targetId: string, payload?: unknown) => string} transitionTo
 * @property {(nextInitial?: string) => string} reset
 * @property {(stateId: string) => boolean} isIn
 * @property {() => string} getState
 * @property {() => number} getStateTime
 * @property {() => TContext} getContext
 */
/**
 * Declarative Hierarchical Finite State Machine (HFSM) with LCA enter/exit semantics,
 * event-driven and condition-guarded transitions, and zero per-tick allocations.
 * @template [TContext=unknown]
 * @param {StateMachineOptions<TContext>} options
 * @returns {Readonly<StateMachine<TContext>>}
 */
export function createStateMachine<TContext = unknown>(options: StateMachineOptions<TContext>): Readonly<StateMachine<TContext>>;
export type StateTransition<TContext = unknown> = {
    /**
     * Target state identifier.
     */
    to: string;
    /**
     * Guard evaluated during update(dt).
     */
    when?: ((ctx: TContext, stateTime: number) => boolean) | undefined;
    /**
     * Event name handled by send(event, payload).
     */
    event?: string | undefined;
    /**
     * Optional guard for event transitions.
     */
    guard?: ((ctx: TContext, payload: unknown) => boolean) | undefined;
};
export type StateConfig<TContext = unknown> = {
    /**
     * Optional parent state id for hierarchical FSM behavior.
     */
    parent?: string | null | undefined;
    /**
     * Default child state id when transitioning directly into a parent state.
     */
    initial?: string | null | undefined;
    onEnter?: ((ctx: TContext, prevState: string | null, payload: unknown) => void) | undefined;
    onUpdate?: ((ctx: TContext, dt: number, stateTime: number) => void) | undefined;
    onExit?: ((ctx: TContext, nextState: string | null) => void) | undefined;
    transitions?: StateTransition<TContext>[] | undefined;
};
export type StateMachineOptions<TContext = unknown> = {
    /**
     * Initial state identifier.
     */
    initial: string;
    /**
     * State definitions keyed by id.
     */
    states: Record<string, StateConfig<TContext>>;
    /**
     * Context object passed to lifecycle and guard callbacks.
     */
    context?: TContext | undefined;
    onTransition?: ((from: string | null, to: string, payload: unknown) => void) | undefined;
};
export type StateMachine<TContext = unknown> = {
    update: (dt: number) => string;
    send: (eventName: string, payload?: unknown) => boolean;
    transitionTo: (targetId: string, payload?: unknown) => string;
    reset: (nextInitial?: string) => string;
    isIn: (stateId: string) => boolean;
    getState: () => string;
    getStateTime: () => number;
    getContext: () => TContext;
};
