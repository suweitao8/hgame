/**
 * Lazy-load BGM controller with crossfade transitions and pause/resume.
 *
 * URL cues stream through an `HTMLAudioElement` routed into the engine's mix buses, so a long
 * track never sits decoded in memory. A media element loops whole files only: trim points that
 * sit at the file bounds (decoder-delay compensation) are left to its own gapless handling, while
 * a cue that selects a window inside the file keeps the sample-accurate `AudioBuffer` path, as do
 * short cues, cues that carry a `buffer`, and environments without media elements. That path
 * holds at most two decoded BGM buffers.
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
        stream: any;
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
        streaming?: undefined;
    } | {
        cueId: any;
        ignored: boolean;
        state: string;
        loop: boolean;
        loopStart: number;
        loopEnd: number;
        duration: any;
        streaming: boolean;
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
    seekBgm: (positionSec: any) => Promise<number | null>;
    setBgmVolume: (value: any) => any;
    getBgmVolume: () => number;
    getBgmState: () => {
        state: any;
        cueId: any;
        loop: any;
        loopStart: any;
        loopEnd: any;
        bufferDuration: any;
        duration: number;
        streaming: boolean;
        currentTimeSec: any;
        pausedPositionSec: any;
        activeBufferCount: number;
        fadingCount: number;
        registeredCueCount: number;
    };
    dispose: () => void;
};
