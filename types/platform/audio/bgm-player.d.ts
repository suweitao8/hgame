/**
 * Streaming lazy-load BGM controller with sample-accurate MP3 loop trimming,
 * crossfade transitions, strict 1-2 AudioBuffer memory budget, and pause/resume.
 *
 * @param {object} ctx Shared mutable audio manager state.
 * @param {object} buses Bus controller (`getBusNode`, `setBusVolume`, `getBusVolume`).
 */
export function createBgmController(ctx: object, buses: object): {
    registerBgmCue: (cueId: any, cfg?: {}) => {
        cueName: string;
        url: any;
        bus: any;
        loop: boolean;
        trimStartSec: any;
        trimEndSec: any;
        durationSec: any;
        gainDb: number;
        bpm: any;
    };
    loadMusicTable: (tableOrUrl: any, { fetchImpl }?: {
        fetchImpl?: typeof fetch | undefined;
    }) => Promise<{
        bgmRegistered: number;
        stingerCount: number;
        totalTracks: any;
        table: any;
    }>;
    loadCueTable: (tableOrUrl: any, { fetchImpl }?: {
        fetchImpl?: typeof fetch | undefined;
    }) => Promise<{
        bgmRegistered: number;
        stingerCount: number;
        totalTracks: any;
        table: any;
    }>;
    hasBgmCue: (cueId: any) => boolean;
    playBgm: (cueIdOrSpec: any, { fadeMs, forceRestart, loop, volume, startAtSec, fetchImpl, }?: {
        fadeMs?: number | undefined;
        forceRestart?: boolean | undefined;
        volume?: number | undefined;
        startAtSec?: null | undefined;
        fetchImpl?: typeof fetch | undefined;
    }) => Promise<{
        cueId: any;
        ignored: boolean;
        state: string;
        loop?: undefined;
        loopStart?: undefined;
        loopEnd?: undefined;
        duration?: undefined;
    } | {
        cueId: any;
        ignored: boolean;
        state: string;
        loop: boolean;
        loopStart: number;
        loopEnd: number;
        duration: any;
    } | null>;
    stopBgm: ({ fadeMs }?: {
        fadeMs?: number | undefined;
    }) => boolean;
    pauseBgm: ({ fromLifecycle }?: {
        fromLifecycle?: boolean | undefined;
    }) => boolean;
    resumeBgm: ({ fromLifecycle }?: {
        fromLifecycle?: boolean | undefined;
    }) => Promise<boolean>;
    setBgmVolume: (value: any) => any;
    getBgmVolume: () => number;
    getBgmState: () => {
        state: any;
        cueId: any;
        loop: any;
        loopStart: any;
        loopEnd: any;
        bufferDuration: any;
        pausedPositionSec: any;
        activeBufferCount: number;
        fadingCount: number;
        registeredCueCount: number;
    };
    dispose: () => void;
};
