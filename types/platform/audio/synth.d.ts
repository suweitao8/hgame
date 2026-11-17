export function resolveSynthPreset(presetOrConfig: any): any;
/**
 * Pure CPU PCM synthesis for deterministic testing or offline AudioBuffer creation.
 * @param {string|object} presetOrConfig
 * @param {{ sampleRate?: number, pitchFactor?: number, volume?: number, seed?: number }} [options]
 * @returns {Float32Array}
 */
export function synthesizeSfxPcm(presetOrConfig: string | object, { sampleRate, pitchFactor, volume, seed, }?: {
    sampleRate?: number;
    pitchFactor?: number;
    volume?: number;
    seed?: number;
} | undefined): Float32Array;
/**
 * Plays a procedural SFX preset on an active WebAudio context and destination node.
 * @param {AudioContext|null} audioCtx
 * @param {AudioNode|null} destination
 * @param {string|object} presetOrConfig
 * @param {import('../audio.js').SynthPlayOptions} [options]
 */
export function playSynthPresetOnContext(audioCtx: AudioContext | null, destination: AudioNode | null, presetOrConfig: string | object, options?: import("../audio.js").SynthPlayOptions | undefined): {
    preset: any;
    pitchFactor: number;
    duration: number;
    played: boolean;
    stop(): void;
};
/**
 * Standalone zero-asset procedural WebAudio SFX synthesizer with headless fallback.
 * @param {{ AudioContextClass?: typeof AudioContext, context?: AudioContext, destination?: AudioNode, volume?: number, pitchJitter?: number, gainJitter?: number, random?: () => number }} [options]
 */
export function createSynthSfx({ AudioContextClass, context, destination, volume, pitchJitter, gainJitter, random, }?: {
    AudioContextClass?: typeof AudioContext;
    context?: AudioContext;
    destination?: AudioNode;
    volume?: number;
    pitchJitter?: number;
    gainJitter?: number;
    random?: () => number;
} | undefined): Readonly<{
    readonly available: boolean;
    readonly volume: any;
    readonly muted: boolean;
    presets: Readonly<{
        hit: Readonly<{
            wave: "triangle";
            freqStart: 190;
            freqEnd: 46;
            duration: 0.095;
            gain: 0.65;
            noiseMix: 0.45;
            filterType: "bandpass";
            filterStartHz: 1100;
            filterEndHz: 320;
            attack: 0.002;
        }>;
        slash: Readonly<{
            wave: "sine";
            freqStart: 420;
            freqEnd: 150;
            duration: 0.13;
            gain: 0.45;
            noiseMix: 0.85;
            filterType: "bandpass";
            filterStartHz: 2400;
            filterEndHz: 480;
            attack: 0.004;
        }>;
        shoot: Readonly<{
            wave: "square";
            freqStart: 560;
            freqEnd: 120;
            duration: 0.11;
            gain: 0.42;
            noiseMix: 0.35;
            filterType: "lowpass";
            filterStartHz: 3200;
            filterEndHz: 600;
            attack: 0.002;
        }>;
        explosion: Readonly<{
            wave: "sawtooth";
            freqStart: 115;
            freqEnd: 24;
            duration: 0.42;
            gain: 0.75;
            noiseMix: 0.8;
            filterType: "lowpass";
            filterStartHz: 1200;
            filterEndHz: 120;
            attack: 0.004;
        }>;
        pickup: Readonly<{
            wave: "triangle";
            freqStart: 660;
            freqEnd: 990;
            steps: number[];
            duration: 0.14;
            gain: 0.45;
            noiseMix: 0;
            filterType: "lowpass";
            filterStartHz: 6000;
            filterEndHz: 6000;
            attack: 0.003;
        }>;
        powerup: Readonly<{
            wave: "triangle";
            freqStart: 440;
            freqEnd: 880;
            steps: number[];
            duration: 0.32;
            gain: 0.5;
            noiseMix: 0.05;
            filterType: "lowpass";
            filterStartHz: 7000;
            filterEndHz: 7000;
            attack: 0.005;
        }>;
        click: Readonly<{
            wave: "sine";
            freqStart: 1150;
            freqEnd: 620;
            duration: 0.032;
            gain: 0.35;
            noiseMix: 0.15;
            filterType: "highpass";
            filterStartHz: 500;
            filterEndHz: 500;
            attack: 0.001;
        }>;
        hurt: Readonly<{
            wave: "sawtooth";
            freqStart: 250;
            freqEnd: 70;
            duration: 0.18;
            gain: 0.55;
            noiseMix: 0.4;
            filterType: "lowpass";
            filterStartHz: 1800;
            filterEndHz: 260;
            attack: 0.002;
        }>;
        laser: Readonly<{
            wave: "sawtooth";
            freqStart: 940;
            freqEnd: 170;
            duration: 0.16;
            gain: 0.4;
            noiseMix: 0.1;
            filterType: "bandpass";
            filterStartHz: 2600;
            filterEndHz: 520;
            attack: 0.002;
        }>;
        jump: Readonly<{
            wave: "sine";
            freqStart: 210;
            freqEnd: 540;
            duration: 0.14;
            gain: 0.45;
            noiseMix: 0;
            filterType: "lowpass";
            filterStartHz: 4000;
            filterEndHz: 4000;
            attack: 0.004;
        }>;
    }>;
    unlock: () => Promise<boolean>;
    play: (presetOrConfig: any, overrides?: {}) => {
        preset: any;
        pitchFactor: number;
        duration: number;
        played: boolean;
        stop(): void;
    };
    renderPcm: typeof synthesizeSfxPcm;
    setVolume: (v: any) => void;
    setMuted: (nextMuted: any) => void;
    dispose: () => void;
}>;
/**
 * Built-in procedural sound presets.
 */
export const SYNTH_PRESETS: Readonly<{
    hit: Readonly<{
        wave: "triangle";
        freqStart: 190;
        freqEnd: 46;
        duration: 0.095;
        gain: 0.65;
        noiseMix: 0.45;
        filterType: "bandpass";
        filterStartHz: 1100;
        filterEndHz: 320;
        attack: 0.002;
    }>;
    slash: Readonly<{
        wave: "sine";
        freqStart: 420;
        freqEnd: 150;
        duration: 0.13;
        gain: 0.45;
        noiseMix: 0.85;
        filterType: "bandpass";
        filterStartHz: 2400;
        filterEndHz: 480;
        attack: 0.004;
    }>;
    shoot: Readonly<{
        wave: "square";
        freqStart: 560;
        freqEnd: 120;
        duration: 0.11;
        gain: 0.42;
        noiseMix: 0.35;
        filterType: "lowpass";
        filterStartHz: 3200;
        filterEndHz: 600;
        attack: 0.002;
    }>;
    explosion: Readonly<{
        wave: "sawtooth";
        freqStart: 115;
        freqEnd: 24;
        duration: 0.42;
        gain: 0.75;
        noiseMix: 0.8;
        filterType: "lowpass";
        filterStartHz: 1200;
        filterEndHz: 120;
        attack: 0.004;
    }>;
    pickup: Readonly<{
        wave: "triangle";
        freqStart: 660;
        freqEnd: 990;
        steps: number[];
        duration: 0.14;
        gain: 0.45;
        noiseMix: 0;
        filterType: "lowpass";
        filterStartHz: 6000;
        filterEndHz: 6000;
        attack: 0.003;
    }>;
    powerup: Readonly<{
        wave: "triangle";
        freqStart: 440;
        freqEnd: 880;
        steps: number[];
        duration: 0.32;
        gain: 0.5;
        noiseMix: 0.05;
        filterType: "lowpass";
        filterStartHz: 7000;
        filterEndHz: 7000;
        attack: 0.005;
    }>;
    click: Readonly<{
        wave: "sine";
        freqStart: 1150;
        freqEnd: 620;
        duration: 0.032;
        gain: 0.35;
        noiseMix: 0.15;
        filterType: "highpass";
        filterStartHz: 500;
        filterEndHz: 500;
        attack: 0.001;
    }>;
    hurt: Readonly<{
        wave: "sawtooth";
        freqStart: 250;
        freqEnd: 70;
        duration: 0.18;
        gain: 0.55;
        noiseMix: 0.4;
        filterType: "lowpass";
        filterStartHz: 1800;
        filterEndHz: 260;
        attack: 0.002;
    }>;
    laser: Readonly<{
        wave: "sawtooth";
        freqStart: 940;
        freqEnd: 170;
        duration: 0.16;
        gain: 0.4;
        noiseMix: 0.1;
        filterType: "bandpass";
        filterStartHz: 2600;
        filterEndHz: 520;
        attack: 0.002;
    }>;
    jump: Readonly<{
        wave: "sine";
        freqStart: 210;
        freqEnd: 540;
        duration: 0.14;
        gain: 0.45;
        noiseMix: 0;
        filterType: "lowpass";
        filterStartHz: 4000;
        filterEndHz: 4000;
        attack: 0.004;
    }>;
}>;
