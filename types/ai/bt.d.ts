/** @typedef {'success' | 'failure' | 'running'} BTStatus */
/**
 * @template [TBlackboard=Record<string, unknown>]
 * @template [TContext=unknown]
 * @typedef {Readonly<
 *   { kind: 'sequence' | 'selector', children: readonly BTNode<TBlackboard, TContext>[] } |
 *   { kind: 'parallel', policy: 'all' | 'any', children: readonly BTNode<TBlackboard, TContext>[] } |
 *   { kind: 'inverter', child: BTNode<TBlackboard, TContext> } |
 *   { kind: 'repeater', count: number, child: BTNode<TBlackboard, TContext> } |
 *   { kind: 'cooldown', seconds: number, child: BTNode<TBlackboard, TContext> } |
 *   { kind: 'wait', seconds: number } |
 *   { kind: 'condition', predicate: (blackboard: TBlackboard, context: TContext) => boolean } |
 *   { kind: 'action', fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void }
 * >} BTNode
 */
/** Runs children left-to-right until one returns FAILURE or RUNNING (resumes from running child).
 * @template [TBlackboard=Record<string, unknown>]
 * @template [TContext=unknown]
 * @param {...BTNode<TBlackboard, TContext>} children
 * @returns {Readonly<{ kind: 'sequence', children: BTNode<TBlackboard, TContext>[] }>}
 */
export function sequence<TBlackboard = Record<string, unknown>, TContext = unknown>(...children: BTNode<TBlackboard, TContext>[]): Readonly<{
    kind: "sequence";
    children: BTNode<TBlackboard, TContext>[];
}>;
/** Runs children left-to-right until one returns SUCCESS or RUNNING (resumes from running child).
 * @template [TBlackboard=Record<string, unknown>]
 * @template [TContext=unknown]
 * @param {...BTNode<TBlackboard, TContext>} children
 * @returns {Readonly<{ kind: 'selector', children: BTNode<TBlackboard, TContext>[] }>}
 */
export function selector<TBlackboard = Record<string, unknown>, TContext = unknown>(...children: BTNode<TBlackboard, TContext>[]): Readonly<{
    kind: "selector";
    children: BTNode<TBlackboard, TContext>[];
}>;
/**
 * Runs all children concurrently.
 * @template [TBlackboard=Record<string, unknown>]
 * @template [TContext=unknown]
 * @param {'all' | 'any' | BTNode<TBlackboard, TContext>} [policy='all'] Omitted policy defaults to 'all'.
 * @param {...BTNode<TBlackboard, TContext>} children
 * @returns {Readonly<{ kind: 'parallel', policy: 'all' | 'any', children: BTNode<TBlackboard, TContext>[] }>}
 */
export function parallel<TBlackboard = Record<string, unknown>, TContext = unknown>(policy?: "all" | "any" | Readonly<{
    kind: "sequence" | "selector";
    children: readonly Readonly<any | {
        kind: "parallel";
        policy: "all" | "any";
        children: readonly Readonly<any | any | {
            kind: "inverter";
            child: Readonly<any | any | any | {
                kind: "repeater";
                count: number;
                child: Readonly<any | any | any | any | {
                    kind: "cooldown";
                    seconds: number;
                    child: Readonly<any | any | any | any | any | {
                        kind: "wait";
                        seconds: number;
                    } | {
                        kind: "condition";
                        predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                    } | {
                        kind: "action";
                        fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                    }>;
                } | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "repeater";
            count: number;
            child: Readonly<any | any | any | any | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "cooldown";
            seconds: number;
            child: Readonly<any | any | any | any | any | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>[];
    } | {
        kind: "inverter";
        child: Readonly<any | any | any | {
            kind: "repeater";
            count: number;
            child: Readonly<any | any | any | any | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "cooldown";
            seconds: number;
            child: Readonly<any | any | any | any | any | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>;
    } | {
        kind: "repeater";
        count: number;
        child: Readonly<any | any | any | any | {
            kind: "cooldown";
            seconds: number;
            child: Readonly<any | any | any | any | any | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>;
    } | {
        kind: "cooldown";
        seconds: number;
        child: Readonly<any | any | any | any | any | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>;
    } | {
        kind: "wait";
        seconds: number;
    } | {
        kind: "condition";
        predicate: (blackboard: TBlackboard, context: TContext) => boolean;
    } | {
        kind: "action";
        fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
    }>[];
} | {
    kind: "parallel";
    policy: "all" | "any";
    children: readonly Readonly<{
        kind: "sequence" | "selector";
        children: readonly Readonly<any | any | {
            kind: "inverter";
            child: Readonly<any | any | any | {
                kind: "repeater";
                count: number;
                child: Readonly<any | any | any | any | {
                    kind: "cooldown";
                    seconds: number;
                    child: Readonly<any | any | any | any | any | {
                        kind: "wait";
                        seconds: number;
                    } | {
                        kind: "condition";
                        predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                    } | {
                        kind: "action";
                        fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                    }>;
                } | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "repeater";
            count: number;
            child: Readonly<any | any | any | any | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "cooldown";
            seconds: number;
            child: Readonly<any | any | any | any | any | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>[];
    } | any | {
        kind: "inverter";
        child: Readonly<any | any | any | {
            kind: "repeater";
            count: number;
            child: Readonly<any | any | any | any | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "cooldown";
            seconds: number;
            child: Readonly<any | any | any | any | any | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>;
    } | {
        kind: "repeater";
        count: number;
        child: Readonly<any | any | any | any | {
            kind: "cooldown";
            seconds: number;
            child: Readonly<any | any | any | any | any | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>;
    } | {
        kind: "cooldown";
        seconds: number;
        child: Readonly<any | any | any | any | any | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>;
    } | {
        kind: "wait";
        seconds: number;
    } | {
        kind: "condition";
        predicate: (blackboard: TBlackboard, context: TContext) => boolean;
    } | {
        kind: "action";
        fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
    }>[];
} | {
    kind: "inverter";
    child: Readonly<{
        kind: "sequence" | "selector";
        children: readonly Readonly<any | any | {
            kind: "inverter";
            child: Readonly<any | any | any | {
                kind: "repeater";
                count: number;
                child: Readonly<any | any | any | any | {
                    kind: "cooldown";
                    seconds: number;
                    child: Readonly<any | any | any | any | any | {
                        kind: "wait";
                        seconds: number;
                    } | {
                        kind: "condition";
                        predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                    } | {
                        kind: "action";
                        fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                    }>;
                } | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "repeater";
            count: number;
            child: Readonly<any | any | any | any | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "cooldown";
            seconds: number;
            child: Readonly<any | any | any | any | any | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>[];
    } | {
        kind: "parallel";
        policy: "all" | "any";
        children: readonly Readonly<any | any | {
            kind: "inverter";
            child: Readonly<any | any | any | {
                kind: "repeater";
                count: number;
                child: Readonly<any | any | any | any | {
                    kind: "cooldown";
                    seconds: number;
                    child: Readonly<any | any | any | any | any | {
                        kind: "wait";
                        seconds: number;
                    } | {
                        kind: "condition";
                        predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                    } | {
                        kind: "action";
                        fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                    }>;
                } | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "repeater";
            count: number;
            child: Readonly<any | any | any | any | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "cooldown";
            seconds: number;
            child: Readonly<any | any | any | any | any | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>[];
    } | any | {
        kind: "repeater";
        count: number;
        child: Readonly<any | any | any | any | {
            kind: "cooldown";
            seconds: number;
            child: Readonly<any | any | any | any | any | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>;
    } | {
        kind: "cooldown";
        seconds: number;
        child: Readonly<any | any | any | any | any | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>;
    } | {
        kind: "wait";
        seconds: number;
    } | {
        kind: "condition";
        predicate: (blackboard: TBlackboard, context: TContext) => boolean;
    } | {
        kind: "action";
        fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
    }>;
} | {
    kind: "repeater";
    count: number;
    child: Readonly<{
        kind: "sequence" | "selector";
        children: readonly Readonly<any | any | {
            kind: "inverter";
            child: Readonly<any | any | any | {
                kind: "repeater";
                count: number;
                child: Readonly<any | any | any | any | {
                    kind: "cooldown";
                    seconds: number;
                    child: Readonly<any | any | any | any | any | {
                        kind: "wait";
                        seconds: number;
                    } | {
                        kind: "condition";
                        predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                    } | {
                        kind: "action";
                        fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                    }>;
                } | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "repeater";
            count: number;
            child: Readonly<any | any | any | any | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "cooldown";
            seconds: number;
            child: Readonly<any | any | any | any | any | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>[];
    } | {
        kind: "parallel";
        policy: "all" | "any";
        children: readonly Readonly<any | any | {
            kind: "inverter";
            child: Readonly<any | any | any | {
                kind: "repeater";
                count: number;
                child: Readonly<any | any | any | any | {
                    kind: "cooldown";
                    seconds: number;
                    child: Readonly<any | any | any | any | any | {
                        kind: "wait";
                        seconds: number;
                    } | {
                        kind: "condition";
                        predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                    } | {
                        kind: "action";
                        fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                    }>;
                } | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "repeater";
            count: number;
            child: Readonly<any | any | any | any | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "cooldown";
            seconds: number;
            child: Readonly<any | any | any | any | any | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>[];
    } | {
        kind: "inverter";
        child: Readonly<any | any | any | {
            kind: "repeater";
            count: number;
            child: Readonly<any | any | any | any | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "cooldown";
            seconds: number;
            child: Readonly<any | any | any | any | any | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>;
    } | any | {
        kind: "cooldown";
        seconds: number;
        child: Readonly<any | any | any | any | any | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>;
    } | {
        kind: "wait";
        seconds: number;
    } | {
        kind: "condition";
        predicate: (blackboard: TBlackboard, context: TContext) => boolean;
    } | {
        kind: "action";
        fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
    }>;
} | {
    kind: "cooldown";
    seconds: number;
    child: Readonly<{
        kind: "sequence" | "selector";
        children: readonly Readonly<any | any | {
            kind: "inverter";
            child: Readonly<any | any | any | {
                kind: "repeater";
                count: number;
                child: Readonly<any | any | any | any | {
                    kind: "cooldown";
                    seconds: number;
                    child: Readonly<any | any | any | any | any | {
                        kind: "wait";
                        seconds: number;
                    } | {
                        kind: "condition";
                        predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                    } | {
                        kind: "action";
                        fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                    }>;
                } | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "repeater";
            count: number;
            child: Readonly<any | any | any | any | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "cooldown";
            seconds: number;
            child: Readonly<any | any | any | any | any | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>[];
    } | {
        kind: "parallel";
        policy: "all" | "any";
        children: readonly Readonly<any | any | {
            kind: "inverter";
            child: Readonly<any | any | any | {
                kind: "repeater";
                count: number;
                child: Readonly<any | any | any | any | {
                    kind: "cooldown";
                    seconds: number;
                    child: Readonly<any | any | any | any | any | {
                        kind: "wait";
                        seconds: number;
                    } | {
                        kind: "condition";
                        predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                    } | {
                        kind: "action";
                        fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                    }>;
                } | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "repeater";
            count: number;
            child: Readonly<any | any | any | any | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "cooldown";
            seconds: number;
            child: Readonly<any | any | any | any | any | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>[];
    } | {
        kind: "inverter";
        child: Readonly<any | any | any | {
            kind: "repeater";
            count: number;
            child: Readonly<any | any | any | any | {
                kind: "cooldown";
                seconds: number;
                child: Readonly<any | any | any | any | any | {
                    kind: "wait";
                    seconds: number;
                } | {
                    kind: "condition";
                    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
                } | {
                    kind: "action";
                    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
                }>;
            } | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "cooldown";
            seconds: number;
            child: Readonly<any | any | any | any | any | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>;
    } | {
        kind: "repeater";
        count: number;
        child: Readonly<any | any | any | any | {
            kind: "cooldown";
            seconds: number;
            child: Readonly<any | any | any | any | any | {
                kind: "wait";
                seconds: number;
            } | {
                kind: "condition";
                predicate: (blackboard: TBlackboard, context: TContext) => boolean;
            } | {
                kind: "action";
                fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
            }>;
        } | {
            kind: "wait";
            seconds: number;
        } | {
            kind: "condition";
            predicate: (blackboard: TBlackboard, context: TContext) => boolean;
        } | {
            kind: "action";
            fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
        }>;
    } | any | {
        kind: "wait";
        seconds: number;
    } | {
        kind: "condition";
        predicate: (blackboard: TBlackboard, context: TContext) => boolean;
    } | {
        kind: "action";
        fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
    }>;
} | {
    kind: "wait";
    seconds: number;
} | {
    kind: "condition";
    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
} | {
    kind: "action";
    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
}> | undefined, ...children: BTNode<TBlackboard, TContext>[]): Readonly<{
    kind: "parallel";
    policy: "all" | "any";
    children: BTNode<TBlackboard, TContext>[];
}>;
/** Inverts SUCCESS <-> FAILURE while forwarding RUNNING.
 * @template [TBlackboard=Record<string, unknown>]
 * @template [TContext=unknown]
 * @param {BTNode<TBlackboard, TContext>} child
 * @returns {Readonly<{ kind: 'inverter', child: BTNode<TBlackboard, TContext> }>}
 */
export function inverter<TBlackboard = Record<string, unknown>, TContext = unknown>(child: BTNode<TBlackboard, TContext>): Readonly<{
    kind: "inverter";
    child: BTNode<TBlackboard, TContext>;
}>;
/** Repeats `child` up to `count` times (`count < 0` repeats until child returns FAILURE).
 * @template [TBlackboard=Record<string, unknown>]
 * @template [TContext=unknown]
 * @param {number} count
 * @param {BTNode<TBlackboard, TContext>} child
 * @returns {Readonly<{ kind: 'repeater', count: number, child: BTNode<TBlackboard, TContext> }>}
 */
export function repeater<TBlackboard = Record<string, unknown>, TContext = unknown>(count: number, child: BTNode<TBlackboard, TContext>): Readonly<{
    kind: "repeater";
    count: number;
    child: BTNode<TBlackboard, TContext>;
}>;
/** Enforces a minimum cooldown (seconds) after `child` finishes with SUCCESS or FAILURE.
 * @template [TBlackboard=Record<string, unknown>]
 * @template [TContext=unknown]
 * @param {number} seconds
 * @param {BTNode<TBlackboard, TContext>} child
 * @returns {Readonly<{ kind: 'cooldown', seconds: number, child: BTNode<TBlackboard, TContext> }>}
 */
export function cooldown<TBlackboard = Record<string, unknown>, TContext = unknown>(seconds: number, child: BTNode<TBlackboard, TContext>): Readonly<{
    kind: "cooldown";
    seconds: number;
    child: BTNode<TBlackboard, TContext>;
}>;
/** Evaluates a boolean predicate against `(blackboard, context)`.
 * @template [TBlackboard=Record<string, unknown>]
 * @template [TContext=unknown]
 * @param {(blackboard: TBlackboard, context: TContext) => boolean} predicate
 * @returns {Readonly<{ kind: 'condition', predicate: (blackboard: TBlackboard, context: TContext) => boolean }>}
 */
export function condition<TBlackboard = Record<string, unknown>, TContext = unknown>(predicate: (blackboard: TBlackboard, context: TContext) => boolean): Readonly<{
    kind: "condition";
    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
}>;
/** Executes an action callback `(blackboard, context, dt) => BTStatus | boolean | void`.
 * @template [TBlackboard=Record<string, unknown>]
 * @template [TContext=unknown]
 * @param {(blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void} fn
 * @returns {Readonly<{ kind: 'action', fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void }>}
 */
export function action<TBlackboard = Record<string, unknown>, TContext = unknown>(fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void): Readonly<{
    kind: "action";
    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
}>;
/** Waits for `seconds` while returning RUNNING, then returns SUCCESS.
 * @param {number} seconds
 * @returns {Readonly<{ kind: 'wait', seconds: number }>}
 */
export function wait(seconds: number): Readonly<{
    kind: "wait";
    seconds: number;
}>;
/**
 * @template [TBlackboard=Record<string, unknown>]
 * @template [TContext=unknown]
 * @typedef {object} BehaviorTreeOptions
 * @property {TBlackboard} [blackboard] Per-agent mutable blackboard state.
 * @property {TContext} [context] Shared entity/scene context passed to leaf nodes.
 */
/**
 * Creates an isolated runtime runner over an immutable behavior tree definition.
 * Multiple AI agents can share the same tree nodes with independent running state & cooldowns.
 * @template [TBlackboard=Record<string, unknown>]
 * @template [TContext=unknown]
 * @param {BTNode<TBlackboard, TContext>} root
 * @param {BehaviorTreeOptions<TBlackboard, TContext>} [options={}]
 * @returns {Readonly<{ tick: (dt?: number) => BTStatus, reset: () => void, blackboard: TBlackboard, getElapsed: () => number }>}
 */
export function createBehaviorTree<TBlackboard = Record<string, unknown>, TContext = unknown>(root: BTNode<TBlackboard, TContext>, options?: BehaviorTreeOptions<TBlackboard, TContext> | undefined): Readonly<{
    tick: (dt?: number) => BTStatus;
    reset: () => void;
    blackboard: TBlackboard;
    getElapsed: () => number;
}>;
/** Execution status constants returned by behavior tree nodes. */
export const BT_STATUS: Readonly<{
    SUCCESS: "success";
    FAILURE: "failure";
    RUNNING: "running";
}>;
export type BTStatus = "success" | "failure" | "running";
export type BTNode<TBlackboard = Record<string, unknown>, TContext = unknown> = Readonly<{
    kind: "sequence" | "selector";
    children: readonly BTNode<TBlackboard, TContext>[];
} | {
    kind: "parallel";
    policy: "all" | "any";
    children: readonly BTNode<TBlackboard, TContext>[];
} | {
    kind: "inverter";
    child: BTNode<TBlackboard, TContext>;
} | {
    kind: "repeater";
    count: number;
    child: BTNode<TBlackboard, TContext>;
} | {
    kind: "cooldown";
    seconds: number;
    child: BTNode<TBlackboard, TContext>;
} | {
    kind: "wait";
    seconds: number;
} | {
    kind: "condition";
    predicate: (blackboard: TBlackboard, context: TContext) => boolean;
} | {
    kind: "action";
    fn: (blackboard: TBlackboard, context: TContext, dt: number) => BTStatus | boolean | void;
}>;
export type BehaviorTreeOptions<TBlackboard = Record<string, unknown>, TContext = unknown> = {
    /**
     * Per-agent mutable blackboard state.
     */
    blackboard?: TBlackboard | undefined;
    /**
     * Shared entity/scene context passed to leaf nodes.
     */
    context?: TContext | undefined;
};
