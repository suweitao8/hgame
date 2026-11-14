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
export function playAudioBuffer(ctx: object, buffer: AudioBuffer, { volume: soundVolume, loop, playbackRate, pitchJitter, gainJitter, cooldownMs, key, bus, pan, position, position2D, hrtf, distanceModel, refDistance, maxDistance, rolloffFactor, panRange, trimSilence, offset, duration, tailFadeSec, occlusion, occludedLowPassHz, occludedGainScale, openLowPassHz, onEnded, random, }?: object): Promise<{
    loop: boolean;
    playbackRate: number;
    bus: any;
    variant: number;
    readonly pan: number;
    readonly distanceGain: number;
    readonly occlusion: number;
    readonly lowPassHz: any;
    setPosition(nextPos: any): any;
    setOcclusion(nextValue: any, { smoothSeconds, lowPassHz, gainScale }?: {
        smoothSeconds?: number;
        lowPassHz?: any;
        gainScale?: any;
    }): any;
    refreshOcclusion({ smoothSeconds }?: {
        smoothSeconds?: number;
    }): number;
    setVolume(nextVol: any): any;
    setPlaybackRate(nextRate: any): any;
    stop({ fadeOutMs }?: {
        fadeOutMs?: number;
    }): void;
}>;
