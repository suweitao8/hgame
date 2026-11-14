/**
 * @typedef {import('./audio/helpers.js').AudioListenerState} AudioListenerState
 * @typedef {import('./audio/helpers.js').AudioPosition3D} AudioPosition3D
 * @typedef {import('./audio/helpers.js').AudioPosition2D} AudioPosition2D
 */
/**
 * @typedef {object} AudioManagerOptions
 * @property {(new () => AudioContext) | undefined} [AudioContextClass] Default `AudioContext` / `webkitAudioContext`.
 * @property {number} [volume=1] Master volume, 0..1.
 * @property {number} [maxPolyphony=24] Max simultaneous voices (positive integer).
 * @property {boolean} [compressor=true] Insert a master dynamics limiter.
 * @property {() => number} [now] Clock for cooldowns, milliseconds (default `performance.now`).
 */
/**
 * @typedef {object} SpatialMetrics
 * @property {'3d' | '2d' | 'pan' | 'none'} kind
 * @property {{ x: number, y: number, z: number }} [pos3] Present for `'3d'`.
 * @property {{ x: number, y: number }} [pos2] Present for `'2d'`.
 * @property {number} pan -1 (left) .. 1 (right).
 * @property {number} distanceGain 0..1 attenuation.
 */
/**
 * @typedef {number | { occlusion?: number, lowPassHz?: number, gainScale?: number }} OcclusionResult
 *   Occlusion 0 (open) .. 1 (blocked), or a detailed override (Hz / gain scale 0..1).
 */
/**
 * @callback OcclusionProbe
 * @param {{ x: number, y: number, z?: number }} sourcePosition
 * @param {AudioListenerState} listener
 * @param {{ bus: string, spatial: SpatialMetrics }} info
 * @returns {OcclusionResult | void}
 */
/**
 * @typedef {object} AudioPlayOptions
 * @property {number} [volume=1] Voice gain, 0..2.
 * @property {boolean} [loop=false]
 * @property {number} [playbackRate=1] 0.05..4.
 * @property {number} [pitchJitter=0] Random playback-rate variation (ratio, 0..1).
 * @property {number} [gainJitter=0] Random gain reduction (ratio, 0..1).
 * @property {number} [cooldownMs=0] Minimum interval between plays of the same `key` / buffer, milliseconds.
 * @property {string | null} [key=null] Cooldown key.
 * @property {string | null} [bus=null] Bus name (default `'spatial'` when positioned, else `'sfx'`).
 * @property {number | null} [pan=null] Stereo pan, -1..1 (when no position).
 * @property {AudioPosition3D | null} [position=null] 3D source position, world units (HRTF panner).
 * @property {AudioPosition2D | null} [position2D=null] 2D source position (stereo pan by `panRange`).
 * @property {boolean} [hrtf=true] Use HRTF panning for 3D sources.
 * @property {DistanceModelType} [distanceModel='inverse']
 * @property {number} [refDistance=3] World units.
 * @property {number} [maxDistance=400] World units.
 * @property {number} [rolloffFactor=0.8]
 * @property {number} [panRange=480] Horizontal distance (pixels / world units) that maps to full pan for 2D sources.
 * @property {boolean} [trimSilence=true] Skip encoder padding / trailing silence.
 * @property {number | null} [offset=null] Start offset, seconds.
 * @property {number | null} [duration=null] Play duration, seconds.
 * @property {number} [tailFadeSec=0] Fade-out length at the trimmed tail, seconds.
 * @property {number | null} [occlusion=null] Fixed occlusion 0..1 (default: evaluated via the occlusion probe).
 * @property {number} [occludedLowPassHz=550] Low-pass cutoff when fully occluded, Hz.
 * @property {number} [occludedGainScale=0.45] Gain scale when fully occluded, 0..1.
 * @property {number} [openLowPassHz=22000] Low-pass cutoff when unoccluded, Hz.
 * @property {((voice: AudioVoice) => void) | null} [onEnded=null]
 * @property {() => number} [random=Math.random] RNG returning 0..1 (for deterministic jitter).
 */
/**
 * @typedef {object} AudioVoice Handle to a playing sound.
 * @property {boolean} loop
 * @property {number} playbackRate Current rate.
 * @property {string} bus Bus the voice is routed to.
 * @property {number} variant Cue variant index (-1 when not played via a cue).
 * @property {number} pan Current pan, -1..1.
 * @property {number} distanceGain 0..1.
 * @property {number} occlusion 0..1.
 * @property {number} lowPassHz Current occlusion low-pass, Hz.
 * @property {(position: AudioPosition3D | AudioPosition2D) => AudioVoice} setPosition Move the source.
 * @property {(value: number, options?: { smoothSeconds?: number, lowPassHz?: number | null, gainScale?: number | null }) => AudioVoice} setOcclusion
 *   Set fixed occlusion 0..1 (disables the probe for this voice); smoothing in seconds.
 * @property {(options?: { smoothSeconds?: number }) => number} refreshOcclusion Re-run the probe; returns occlusion 0..1.
 * @property {(volume: number) => AudioVoice} setVolume Voice gain 0..2.
 * @property {(rate: number) => AudioVoice} setPlaybackRate 0.05..4.
 * @property {(options?: { fadeOutMs?: number }) => void} stop Stop, optionally fading out (milliseconds).
 */
/**
 * @typedef {object} AudioCueConfig
 * @property {readonly AudioBuffer[]} variants 1-4 decoded buffers.
 * @property {string | null} [bus=null]
 * @property {number} [volume=1]
 * @property {number} [pitchJitter=0.02]
 * @property {number} [gainJitter=0.04]
 * @property {number} [cooldownMs=0] Milliseconds.
 * @property {number} [maxConcurrent=4] Max simultaneous voices of this cue.
 * @property {boolean} [hrtf=true]
 * @property {number} [refDistance=3]
 * @property {number} [maxDistance=400]
 * @property {number} [rolloffFactor=0.8]
 * @property {number} [panRange=480]
 * @property {boolean} [trimSilence=true]
 * @property {number} [silenceThreshold=0.0035]
 * @property {boolean} [normalizeRms=true]
 * @property {number} [maxDurationSpreadRatio=0.28]
 * @property {boolean} [alignDuration=true]
 */
/**
 * @typedef {Omit<AudioPlayOptions, 'loop' | 'offset' | 'duration' | 'tailFadeSec' | 'onEnded'> & {
 *   loop?: boolean,
 *   variant?: number,
 * }} AudioCueOverrides Per-call overrides for {@link AudioManager#playCue}; `variant` forces a variant index.
 */
/**
 * @typedef {object} AudioCueVariantInfo
 * @property {number} index
 * @property {number} duration Seconds.
 * @property {number} activeDuration Seconds.
 * @property {number} playDuration Seconds.
 * @property {number} gainScale
 * @property {number} deviationRatio
 * @property {boolean} consistent
 */
/**
 * @typedef {object} AudioCueInspection
 * @property {string} name
 * @property {string | null} bus
 * @property {number} variantCount
 * @property {number} medianDuration Seconds.
 * @property {number} medianRms
 * @property {number} durationSpreadRatio
 * @property {boolean} allConsistent
 * @property {readonly Readonly<AudioCueVariantInfo>[]} variants
 */
/**
 * @typedef {object} AudioBusMix
 * @property {number} [volume] Absolute bus gain, 0..1.5.
 * @property {number} [gainScale] Multiplier applied to the user bus volume.
 * @property {number} [lowPassHz] Low-pass cutoff, Hz (60..22000).
 * @property {number} [filterHz] Alias of `lowPassHz`.
 */
/**
 * @typedef {object} AudioSnapshotConfig Mix snapshot (e.g. paused / underwater).
 * @property {string} [name]
 * @property {Record<string, AudioBusMix>} [buses]
 * @property {number | null} [defaultLowPassHz] Cutoff for buses without an override, Hz.
 * @property {number} [transitionSeconds=0.2] Cross-fade time, seconds.
 */
/**
 * @typedef {object} AudioSnapshot
 * @property {string} name
 * @property {Record<string, AudioBusMix>} buses
 * @property {number | null} defaultLowPassHz
 * @property {number} transitionSeconds
 */
/**
 * @typedef {Partial<AudioListenerState>} AudioListenerUpdate
 */
/**
 * @typedef {{ matrixWorld?: { elements: ArrayLike<number> }, x?: number, y?: number, z?: number, offsetX?: number, offsetY?: number }} AudioListenerCamera
 *   A Three.js-style camera (`matrixWorld`) or a 2D camera (`x`, `y`, optional offsets in pixels).
 */
/**
 * @typedef {object} AudioManager Web Audio facade: buses, cues, spatialization, snapshots.
 * @property {number} volume Master volume 0..1.
 * @property {boolean} muted
 * @property {number} activeCount Playing voices.
 * @property {boolean} available True when an AudioContext class exists.
 * @property {AudioListenerState} listener Snapshot copy.
 * @property {string | null} activeSnapshot Name of the active mix snapshot.
 * @property {() => Promise<AudioContext>} unlock Create / resume the context (call from a user gesture).
 * @property {(data: ArrayBuffer) => Promise<AudioBuffer>} decode
 * @property {(buffer: AudioBuffer, options?: AudioPlayOptions) => Promise<AudioVoice | null>} play Resolves null when muted, throttled or no slot is free.
 * @property {(name: string, variantsOrConfig: readonly AudioBuffer[] | AudioCueConfig, extraOptions?: Omit<AudioCueConfig, 'variants'>) => AudioCueInspection} registerCue
 * @property {(name: string, overrides?: AudioCueOverrides) => Promise<AudioVoice | null>} playCue
 * @property {(name: string) => AudioCueInspection | null} inspectCue
 * @property {(name: string) => boolean} hasCue
 * @property {(value: number) => number} setVolume Returns the clamped value.
 * @property {(muted: boolean) => boolean} setMuted
 * @property {(bus: string, value: number) => number} setBusVolume Gain 0..1.5; returns the clamped value.
 * @property {(bus: string) => number} getBusVolume
 * @property {(bus: string, factor?: number, durationMs?: number) => boolean} duckBus Temporarily scale a bus (factor 0..1, default 0.55; milliseconds, default 250).
 * @property {(name: string, config?: AudioSnapshotConfig) => AudioSnapshot} registerSnapshot
 * @property {(nameOrConfig: string | AudioSnapshotConfig, options?: { transitionSeconds?: number | null }) => string} applySnapshot Returns the snapshot name.
 * @property {(options?: { transitionSeconds?: number }) => boolean} clearSnapshot
 * @property {(probe: OcclusionProbe | null | undefined) => void} setOcclusionProbe
 * @property {() => void} updateOcclusion Refresh occlusion of all active voices.
 * @property {(next?: AudioListenerUpdate) => AudioListenerState} setListener
 * @property {(camera: AudioListenerCamera | null | undefined) => AudioListenerState} updateListenerFromCamera
 * @property {() => Promise<void> | undefined} dispose Stop everything and close the context.
 */
/**
 * Web Audio manager supporting buses, master dynamics limiter, 3D HRTF / 2D left-right
 * spatialization, MP3 encoder-padding trimming, polyphony control, and multi-variant cues.
 *
 * @param {AudioManagerOptions} [options]
 * @returns {AudioManager}
 */
export function createAudioManager({ AudioContextClass, volume, maxPolyphony, compressor, now, }?: AudioManagerOptions): AudioManager;
export type AudioListenerState = import("./audio/helpers.js").AudioListenerState;
export type AudioPosition3D = import("./audio/helpers.js").AudioPosition3D;
export type AudioPosition2D = import("./audio/helpers.js").AudioPosition2D;
export type AudioManagerOptions = {
    /**
     * Default `AudioContext` / `webkitAudioContext`.
     */
    AudioContextClass?: (new () => AudioContext) | undefined;
    /**
     * Master volume, 0..1.
     */
    volume?: number;
    /**
     * Max simultaneous voices (positive integer).
     */
    maxPolyphony?: number;
    /**
     * Insert a master dynamics limiter.
     */
    compressor?: boolean;
    /**
     * Clock for cooldowns, milliseconds (default `performance.now`).
     */
    now?: () => number;
};
export type SpatialMetrics = {
    kind: "3d" | "2d" | "pan" | "none";
    /**
     * Present for `'3d'`.
     */
    pos3?: {
        x: number;
        y: number;
        z: number;
    };
    /**
     * Present for `'2d'`.
     */
    pos2?: {
        x: number;
        y: number;
    };
    /**
     * -1 (left) .. 1 (right).
     */
    pan: number;
    /**
     * 0..1 attenuation.
     */
    distanceGain: number;
};
/**
 * Occlusion 0 (open) .. 1 (blocked), or a detailed override (Hz / gain scale 0..1).
 */
export type OcclusionResult = number | {
    occlusion?: number;
    lowPassHz?: number;
    gainScale?: number;
};
export type OcclusionProbe = (sourcePosition: {
    x: number;
    y: number;
    z?: number;
}, listener: AudioListenerState, info: {
    bus: string;
    spatial: SpatialMetrics;
}) => OcclusionResult | void;
export type AudioPlayOptions = {
    /**
     * Voice gain, 0..2.
     */
    volume?: number;
    loop?: boolean;
    /**
     * 0.05..4.
     */
    playbackRate?: number;
    /**
     * Random playback-rate variation (ratio, 0..1).
     */
    pitchJitter?: number;
    /**
     * Random gain reduction (ratio, 0..1).
     */
    gainJitter?: number;
    /**
     * Minimum interval between plays of the same `key` / buffer, milliseconds.
     */
    cooldownMs?: number;
    /**
     * Cooldown key.
     */
    key?: string | null;
    /**
     * Bus name (default `'spatial'` when positioned, else `'sfx'`).
     */
    bus?: string | null;
    /**
     * Stereo pan, -1..1 (when no position).
     */
    pan?: number | null;
    /**
     * 3D source position, world units (HRTF panner).
     */
    position?: AudioPosition3D | null;
    /**
     * 2D source position (stereo pan by `panRange`).
     */
    position2D?: AudioPosition2D | null;
    /**
     * Use HRTF panning for 3D sources.
     */
    hrtf?: boolean;
    distanceModel?: DistanceModelType;
    /**
     * World units.
     */
    refDistance?: number;
    /**
     * World units.
     */
    maxDistance?: number;
    rolloffFactor?: number;
    /**
     * Horizontal distance (pixels / world units) that maps to full pan for 2D sources.
     */
    panRange?: number;
    /**
     * Skip encoder padding / trailing silence.
     */
    trimSilence?: boolean;
    /**
     * Start offset, seconds.
     */
    offset?: number | null;
    /**
     * Play duration, seconds.
     */
    duration?: number | null;
    /**
     * Fade-out length at the trimmed tail, seconds.
     */
    tailFadeSec?: number;
    /**
     * Fixed occlusion 0..1 (default: evaluated via the occlusion probe).
     */
    occlusion?: number | null;
    /**
     * Low-pass cutoff when fully occluded, Hz.
     */
    occludedLowPassHz?: number;
    /**
     * Gain scale when fully occluded, 0..1.
     */
    occludedGainScale?: number;
    /**
     * Low-pass cutoff when unoccluded, Hz.
     */
    openLowPassHz?: number;
    onEnded?: ((voice: AudioVoice) => void) | null;
    /**
     * RNG returning 0..1 (for deterministic jitter).
     */
    random?: () => number;
};
/**
 * Handle to a playing sound.
 */
export type AudioVoice = {
    loop: boolean;
    /**
     * Current rate.
     */
    playbackRate: number;
    /**
     * Bus the voice is routed to.
     */
    bus: string;
    /**
     * Cue variant index (-1 when not played via a cue).
     */
    variant: number;
    /**
     * Current pan, -1..1.
     */
    pan: number;
    /**
     * 0..1.
     */
    distanceGain: number;
    /**
     * 0..1.
     */
    occlusion: number;
    /**
     * Current occlusion low-pass, Hz.
     */
    lowPassHz: number;
    /**
     * Move the source.
     */
    setPosition: (position: AudioPosition3D | AudioPosition2D) => AudioVoice;
    /**
     *   Set fixed occlusion 0..1 (disables the probe for this voice); smoothing in seconds.
     */
    setOcclusion: (value: number, options?: {
        smoothSeconds?: number;
        lowPassHz?: number | null;
        gainScale?: number | null;
    }) => AudioVoice;
    /**
     * Re-run the probe; returns occlusion 0..1.
     */
    refreshOcclusion: (options?: {
        smoothSeconds?: number;
    }) => number;
    /**
     * Voice gain 0..2.
     */
    setVolume: (volume: number) => AudioVoice;
    /**
     * 0.05..4.
     */
    setPlaybackRate: (rate: number) => AudioVoice;
    /**
     * Stop, optionally fading out (milliseconds).
     */
    stop: (options?: {
        fadeOutMs?: number;
    }) => void;
};
export type AudioCueConfig = {
    /**
     * 1-4 decoded buffers.
     */
    variants: readonly AudioBuffer[];
    bus?: string | null;
    volume?: number;
    pitchJitter?: number;
    gainJitter?: number;
    /**
     * Milliseconds.
     */
    cooldownMs?: number;
    /**
     * Max simultaneous voices of this cue.
     */
    maxConcurrent?: number;
    hrtf?: boolean;
    refDistance?: number;
    maxDistance?: number;
    rolloffFactor?: number;
    panRange?: number;
    trimSilence?: boolean;
    silenceThreshold?: number;
    normalizeRms?: boolean;
    maxDurationSpreadRatio?: number;
    alignDuration?: boolean;
};
/**
 * Per-call overrides for {@link AudioManager#playCue}; `variant` forces a variant index.
 */
export type AudioCueOverrides = Omit<AudioPlayOptions, "loop" | "offset" | "duration" | "tailFadeSec" | "onEnded"> & {
    loop?: boolean;
    variant?: number;
};
export type AudioCueVariantInfo = {
    index: number;
    /**
     * Seconds.
     */
    duration: number;
    /**
     * Seconds.
     */
    activeDuration: number;
    /**
     * Seconds.
     */
    playDuration: number;
    gainScale: number;
    deviationRatio: number;
    consistent: boolean;
};
export type AudioCueInspection = {
    name: string;
    bus: string | null;
    variantCount: number;
    /**
     * Seconds.
     */
    medianDuration: number;
    medianRms: number;
    durationSpreadRatio: number;
    allConsistent: boolean;
    variants: readonly Readonly<AudioCueVariantInfo>[];
};
export type AudioBusMix = {
    /**
     * Absolute bus gain, 0..1.5.
     */
    volume?: number;
    /**
     * Multiplier applied to the user bus volume.
     */
    gainScale?: number;
    /**
     * Low-pass cutoff, Hz (60..22000).
     */
    lowPassHz?: number;
    /**
     * Alias of `lowPassHz`.
     */
    filterHz?: number;
};
/**
 * Mix snapshot (e.g. paused / underwater).
 */
export type AudioSnapshotConfig = {
    name?: string;
    buses?: Record<string, AudioBusMix>;
    /**
     * Cutoff for buses without an override, Hz.
     */
    defaultLowPassHz?: number | null;
    /**
     * Cross-fade time, seconds.
     */
    transitionSeconds?: number;
};
export type AudioSnapshot = {
    name: string;
    buses: Record<string, AudioBusMix>;
    defaultLowPassHz: number | null;
    transitionSeconds: number;
};
export type AudioListenerUpdate = Partial<AudioListenerState>;
/**
 * A Three.js-style camera (`matrixWorld`) or a 2D camera (`x`, `y`, optional offsets in pixels).
 */
export type AudioListenerCamera = {
    matrixWorld?: {
        elements: ArrayLike<number>;
    };
    x?: number;
    y?: number;
    z?: number;
    offsetX?: number;
    offsetY?: number;
};
/**
 * Web Audio facade: buses, cues, spatialization, snapshots.
 */
export type AudioManager = {
    /**
     * Master volume 0..1.
     */
    volume: number;
    muted: boolean;
    /**
     * Playing voices.
     */
    activeCount: number;
    /**
     * True when an AudioContext class exists.
     */
    available: boolean;
    /**
     * Snapshot copy.
     */
    listener: AudioListenerState;
    /**
     * Name of the active mix snapshot.
     */
    activeSnapshot: string | null;
    /**
     * Create / resume the context (call from a user gesture).
     */
    unlock: () => Promise<AudioContext>;
    decode: (data: ArrayBuffer) => Promise<AudioBuffer>;
    /**
     * Resolves null when muted, throttled or no slot is free.
     */
    play: (buffer: AudioBuffer, options?: AudioPlayOptions) => Promise<AudioVoice | null>;
    registerCue: (name: string, variantsOrConfig: readonly AudioBuffer[] | AudioCueConfig, extraOptions?: Omit<AudioCueConfig, "variants">) => AudioCueInspection;
    playCue: (name: string, overrides?: AudioCueOverrides) => Promise<AudioVoice | null>;
    inspectCue: (name: string) => AudioCueInspection | null;
    hasCue: (name: string) => boolean;
    /**
     * Returns the clamped value.
     */
    setVolume: (value: number) => number;
    setMuted: (muted: boolean) => boolean;
    /**
     * Gain 0..1.5; returns the clamped value.
     */
    setBusVolume: (bus: string, value: number) => number;
    getBusVolume: (bus: string) => number;
    /**
     * Temporarily scale a bus (factor 0..1, default 0.55; milliseconds, default 250).
     */
    duckBus: (bus: string, factor?: number, durationMs?: number) => boolean;
    registerSnapshot: (name: string, config?: AudioSnapshotConfig) => AudioSnapshot;
    /**
     * Returns the snapshot name.
     */
    applySnapshot: (nameOrConfig: string | AudioSnapshotConfig, options?: {
        transitionSeconds?: number | null;
    }) => string;
    clearSnapshot: (options?: {
        transitionSeconds?: number;
    }) => boolean;
    setOcclusionProbe: (probe: OcclusionProbe | null | undefined) => void;
    /**
     * Refresh occlusion of all active voices.
     */
    updateOcclusion: () => void;
    setListener: (next?: AudioListenerUpdate) => AudioListenerState;
    updateListenerFromCamera: (camera: AudioListenerCamera | null | undefined) => AudioListenerState;
    /**
     * Stop everything and close the context.
     */
    dispose: () => Promise<void> | undefined;
};
import { analyzeAudioBuffer } from './audio/analysis.js';
import { normalizeVariantSet } from './audio/variants.js';
import { SYNTH_PRESETS } from './audio/synth.js';
import { synthesizeSfxPcm } from './audio/synth.js';
import { createSynthSfx } from './audio/synth.js';
export { analyzeAudioBuffer, normalizeVariantSet, SYNTH_PRESETS, synthesizeSfxPcm, createSynthSfx };
