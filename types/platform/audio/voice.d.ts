/**
 * Computes 3D / 2D / explicit stereo spatial pan and distance gain against listenerState.
 * @param {unknown} posArg
 * @param {object} opts
 * @param {import('./helpers.js').AudioListenerState} listenerState
 */
export function computeSpatialMetrics(posArg: unknown, opts: object, listenerState: import("./helpers.js").AudioListenerState): {
    kind: string;
    pos3: {
        x: number;
        y: number;
        z: number;
    };
    pan: number;
    distanceGain: number;
    pos2?: undefined;
} | {
    kind: string;
    pos2: {
        x: number;
        y: number;
    };
    pan: number;
    distanceGain: number;
    pos3?: undefined;
} | {
    kind: string;
    pan: number;
    distanceGain: number;
    pos3?: undefined;
    pos2?: undefined;
};
/**
 * Instantiates and starts a single Web Audio voice with spatialization, occlusion filter,
 * encoder-padding trimming, and polyphony eviction.
 * @param {object} ctx Shared mutable audio manager state.
 * @param {AudioBuffer} buffer
 * @param {object} [options]
 */
export function playAudioBuffer(ctx: object, buffer: AudioBuffer, options?: object): Promise<{
    loop: boolean;
    playbackRate: any;
    bus: string;
    variant: number;
    readonly pan: number;
    readonly distanceGain: number;
    readonly occlusion: number;
    readonly lowPassHz: any;
    readonly reverbSendGain: any;
    setReverbSend(amount: any): any;
    setPosition(nextPos: any): any;
    setOcclusion(nextValue: any, { smoothSeconds, lowPassHz, gainScale }?: {
        smoothSeconds?: number | undefined;
        lowPassHz?: null | undefined;
        gainScale?: null | undefined;
    }): any;
    refreshOcclusion({ smoothSeconds }?: {
        smoothSeconds?: number | undefined;
    }): number;
    setVolume(nextVol: any): any;
    setPlaybackRate(nextRate: any): any;
    stop({ fadeOutMs }?: {
        fadeOutMs?: number | undefined;
    }): void;
} | null>;
export function playAudioMedia(ctx: any, url: any, options: any, reservation: any): Promise<{
    loop: boolean;
    playbackRate: any;
    bus: string;
    variant: number;
    readonly pan: number;
    readonly distanceGain: number;
    readonly occlusion: number;
    readonly lowPassHz: any;
    readonly reverbSendGain: any;
    setReverbSend(amount: any): any;
    setPosition(nextPos: any): any;
    setOcclusion(nextValue: any, { smoothSeconds, lowPassHz, gainScale }?: {
        smoothSeconds?: number | undefined;
        lowPassHz?: null | undefined;
        gainScale?: null | undefined;
    }): any;
    refreshOcclusion({ smoothSeconds }?: {
        smoothSeconds?: number | undefined;
    }): number;
    setVolume(nextVol: any): any;
    setPlaybackRate(nextRate: any): any;
    stop({ fadeOutMs }?: {
        fadeOutMs?: number | undefined;
    }): void;
} | null>;
