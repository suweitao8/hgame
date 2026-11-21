/**
 * Manages AudioContext initialization, master gain/compressor, per-bus chains,
 * snapshots, and temporary bus ducking.
 * @param {object} ctx Shared mutable audio manager state.
 */
export function createAudioBusController(ctx: object): {
    getBusNode: (busName: any) => any;
    unlock: () => Promise<any>;
    setVolume: (value: any) => any;
    setMuted: (value: any) => any;
    setBusVolume: (busName: any, value: any) => number;
    getBusVolume: (busName: any) => number;
    setBusEq: (busName: any, cfg?: {}) => {
        lowGainDb: any;
        midGainDb: any;
        highGainDb: any;
        lowFreq: any;
        midFreq: any;
        highFreq: any;
    };
    getBusEq: (busName: any) => any;
    registerSnapshot: (name: any, config?: {}) => {
        name: string;
        buses: any;
        defaultLowPassHz: any;
        transitionSeconds: number;
    };
    applySnapshot: (nameOrConfig: any, { transitionSeconds }?: {
        transitionSeconds?: null | undefined;
    }) => any;
    clearSnapshot: ({ transitionSeconds }?: {
        transitionSeconds?: number | undefined;
    }) => boolean;
    duckBus: (busName: any, factorOrOpts?: number, durationMs?: number) => boolean;
    getDuckingState: () => {};
    dispose: () => void;
};
