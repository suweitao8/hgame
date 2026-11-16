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
    duckBus: (busName: any, factor?: number, durationMs?: number) => boolean;
    dispose: () => void;
};
