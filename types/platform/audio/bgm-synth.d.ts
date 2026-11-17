/** Converts a MIDI note number to frequency in Hz (A4 = 69 = 440 Hz). */
export function midiToHz(midi: any): number;
/**
 * Computes one 16th-note musical step deterministically from mood, step index, and combat intensity.
 * @param {string} [mood='adventure']
 * @param {number} [stepIndex=0]
 * @param {number} [intensity=0.5]
 * @param {number} [bpmOverride]
 */
export function generateBgmStep(mood?: string | undefined, stepIndex?: number | undefined, intensity?: number | undefined, bpmOverride?: number | undefined): {
    step: number;
    bar: number;
    sub: number;
    mood: string;
    intensity: any;
    bpm: any;
    stepDuration: number;
    bassHz: number;
    leadHz: number;
    drum: "kick" | "snare" | "hat" | null;
    bassWave: any;
    leadWave: any;
    leadCutoffHz: any;
};
/**
 * @typedef {object} ProceduralBgmOptions
 * @property {(new () => AudioContext) | undefined} [AudioContextClass]
 * @property {AudioContext | null} [context=null]
 * @property {AudioNode | null} [destination=null]
 * @property {(() => {context: AudioContext | null, destination: AudioNode | null} | null) | null} [resolveAudio=null] Lazily acquire a shared context and destination.
 * @property {keyof typeof BGM_MOODS | string} [mood='adventure']
 * @property {number} [intensity=0.5]
 * @property {number} [bpm]
 * @property {number} [volume=0.45]
 * @property {boolean} [autoSchedule=true]
 */
/**
 * Creates a zero-KB procedural adaptive BGM synthesizer that dynamically responds
 * to `setMood(...)` and `setIntensity(0..1)` without any external audio files.
 * Works cleanly in both browser WebAudio and headless Node tests.
 * @param {ProceduralBgmOptions} [options={}]
 */
export function createProceduralBgm(options?: ProceduralBgmOptions | undefined): Readonly<{
    start: (startOpts?: {}) => {
        mood: string | undefined;
        intensity: any;
        bpm: any;
        volume: any;
        muted: boolean;
        playing: boolean;
        paused: boolean;
        stepIndex: number;
        available: boolean;
    };
    stop: () => void;
    pause: () => void;
    resume: () => {
        mood: string | undefined;
        intensity: any;
        bpm: any;
        volume: any;
        muted: boolean;
        playing: boolean;
        paused: boolean;
        stepIndex: number;
        available: boolean;
    } | undefined;
    update: (dt: number) => any[];
    setMood: (nextMood: any) => void;
    setIntensity: (nextIntensity: any) => void;
    setVolume: (v: any) => void;
    setMuted: (nextMuted: any) => void;
    getState: () => {
        mood: string | undefined;
        intensity: any;
        bpm: any;
        volume: any;
        muted: boolean;
        playing: boolean;
        paused: boolean;
        stepIndex: number;
        available: boolean;
    };
    dispose: () => void;
}>;
/** Built-in musical mood presets for adaptive dynamic BGM. */
export const BGM_MOODS: Readonly<{
    dungeon: Readonly<{
        bpm: 108;
        rootMidi: 45;
        scale: readonly number[];
        chords: readonly number[];
        bassWave: "triangle";
        leadWave: "sine";
        leadCutoffHz: 1400;
        arpSteps: readonly number[];
    }>;
    cyber: Readonly<{
        bpm: 128;
        rootMidi: 40;
        scale: readonly number[];
        chords: readonly number[];
        bassWave: "sawtooth";
        leadWave: "square";
        leadCutoffHz: 2400;
        arpSteps: readonly number[];
    }>;
    boss: Readonly<{
        bpm: 152;
        rootMidi: 38;
        scale: readonly number[];
        chords: readonly number[];
        bassWave: "sawtooth";
        leadWave: "sawtooth";
        leadCutoffHz: 3000;
        arpSteps: readonly number[];
    }>;
    chill: Readonly<{
        bpm: 88;
        rootMidi: 48;
        scale: readonly number[];
        chords: readonly number[];
        bassWave: "sine";
        leadWave: "triangle";
        leadCutoffHz: 1100;
        arpSteps: readonly number[];
    }>;
    adventure: Readonly<{
        bpm: 120;
        rootMidi: 43;
        scale: readonly number[];
        chords: readonly number[];
        bassWave: "triangle";
        leadWave: "triangle";
        leadCutoffHz: 1900;
        arpSteps: readonly number[];
    }>;
    victory: Readonly<{
        bpm: 132;
        rootMidi: 48;
        scale: readonly number[];
        chords: readonly number[];
        bassWave: "triangle";
        leadWave: "square";
        leadCutoffHz: 2600;
        arpSteps: readonly number[];
    }>;
}>;
export type ProceduralBgmOptions = {
    AudioContextClass?: (new () => AudioContext) | undefined;
    context?: AudioContext | null | undefined;
    destination?: AudioNode | null | undefined;
    /**
     * Lazily acquire a shared context and destination.
     */
    resolveAudio?: (() => {
        context: AudioContext | null;
        destination: AudioNode | null;
    } | null) | null | undefined;
    mood?: string | undefined;
    intensity?: number | undefined;
    bpm?: number | undefined;
    volume?: number | undefined;
    autoSchedule?: boolean | undefined;
};
