/**
 * @typedef {object} AudioDirectorOptions
 * @property {import('../platform/audio.js').AudioManager | null} [audio=null]
 * @property {string} [theme='scifi']
 * @property {string} [mood]
 * @property {'action' | 'arcade' | 'tactical' | 'cozy'} [profile='action']
 * @property {boolean} [bgmEnabled=true]
 * @property {Record<string, { cue?: string, preset?: string | object, volume?: number, pitchJitter?: number, cooldownMs?: number }>} [overrides]
 * @property {() => number} [now]
 */
/**
 * Create a unified AudioDirector that maps game/UI events to custom cues or 0-KB synth defaults
 * and coordinates adaptive BGM mood/intensity transitions across game phases.
 * @param {AudioDirectorOptions} [options]
 */
export function createAudioDirector(options?: AudioDirectorOptions | undefined): Readonly<{
    play: (event: string, playOpts?: object) => boolean;
    setPhase: (nextPhase: "title" | "playing" | "paused" | "choice" | "result", meta?: {
        bossActive?: boolean;
        victory?: boolean;
        intensity?: number;
    } | undefined) => void;
    setIntensity: (value: number) => void;
    setMuted: (nextMuted: boolean) => boolean;
    isMuted: () => boolean;
    unlock: () => void;
    registerCueOverrides: (map: Record<string, {
        cue?: string;
        preset?: string | object;
        volume?: number;
        pitchJitter?: number;
        cooldownMs?: number;
    }>) => void;
    update: (dt: number) => void;
    snapshot: () => {
        phase: string;
        mood: string;
        intensity: 0.28 | 0.55 | 0.38 | 0.62;
        muted: boolean;
        playedCount: number;
        throttledCount: number;
        bgm: {
            mood: string | undefined;
            intensity: any;
            bpm: any;
            volume: any;
            muted: boolean;
            playing: boolean;
            paused: boolean;
            stepIndex: number;
            available: boolean;
        } | null;
    };
    dispose(): void;
}>;
/** Canonical gameplay and UI audio event identifiers. */
export const GAME_AUDIO_EVENTS: Readonly<{
    ATTACK: "attack";
    HIT: "hit";
    CRIT: "crit";
    KILL: "kill";
    DASH: "dash";
    HURT: "hurt";
    PICKUP: "pickup";
    LEVEL_UP: "levelup";
    WAVE_START: "waveStart";
    BOSS_SPAWN: "bossSpawn";
    VICTORY: "victory";
    DEFEAT: "defeat";
    INTERACT: "interact";
    UI_HOVER: "uiHover";
    UI_PRESS: "uiPress";
    UI_CONFIRM: "uiConfirm";
    UI_CANCEL: "uiCancel";
    UI_OPEN: "uiOpen";
    UI_CLOSE: "uiClose";
    UI_REWARD: "uiReward";
    UI_ERROR: "uiError";
}>;
/** Default 0-KB synth preset + anti-spam cooldown matrix for every canonical audio event. */
export const DEFAULT_AUDIO_MATRIX: Readonly<{
    attack: Readonly<{
        preset: "slash";
        volume: 0.42;
        pitchJitter: 0.08;
        cooldownMs: 55;
    }>;
    hit: Readonly<{
        preset: "hit";
        volume: 0.38;
        pitchJitter: 0.12;
        cooldownMs: 45;
    }>;
    crit: Readonly<{
        preset: "explosion";
        volume: 0.48;
        pitchJitter: 0.08;
        cooldownMs: 90;
    }>;
    kill: Readonly<{
        preset: "pickup";
        volume: 0.36;
        pitchJitter: 0.14;
        cooldownMs: 55;
    }>;
    dash: Readonly<{
        preset: "laser";
        volume: 0.38;
        pitchJitter: 0.06;
        cooldownMs: 120;
    }>;
    hurt: Readonly<{
        preset: "hurt";
        volume: 0.56;
        pitchJitter: 0.04;
        cooldownMs: 140;
    }>;
    pickup: Readonly<{
        preset: "pickup";
        volume: 0.32;
        pitchJitter: 0.15;
        cooldownMs: 40;
    }>;
    levelup: Readonly<{
        preset: "powerup";
        volume: 0.58;
        pitchJitter: 0.02;
        cooldownMs: 250;
    }>;
    waveStart: Readonly<{
        preset: "powerup";
        volume: 0.45;
        pitchJitter: 0.02;
        cooldownMs: 300;
    }>;
    bossSpawn: Readonly<{
        preset: "explosion";
        volume: 0.65;
        pitchJitter: 0.02;
        cooldownMs: 500;
    }>;
    victory: Readonly<{
        preset: "powerup";
        volume: 0.64;
        pitchJitter: 0;
        cooldownMs: 300;
    }>;
    defeat: Readonly<{
        preset: "hurt";
        volume: 0.62;
        pitchJitter: 0;
        cooldownMs: 300;
    }>;
    interact: Readonly<{
        preset: "click";
        volume: 0.36;
        pitchJitter: 0.04;
        cooldownMs: 60;
    }>;
    uiHover: Readonly<{
        preset: "click";
        volume: 0.12;
        pitchJitter: 0.05;
        cooldownMs: 45;
    }>;
    uiPress: Readonly<{
        preset: "click";
        volume: 0.22;
        pitchJitter: 0.04;
        cooldownMs: 30;
    }>;
    uiConfirm: Readonly<{
        preset: "pickup";
        volume: 0.28;
        pitchJitter: 0.03;
        cooldownMs: 60;
    }>;
    uiCancel: Readonly<{
        preset: "hit";
        volume: 0.22;
        pitchJitter: 0.03;
        cooldownMs: 60;
    }>;
    uiOpen: Readonly<{
        preset: "pickup";
        volume: 0.24;
        pitchJitter: 0.03;
        cooldownMs: 80;
    }>;
    uiClose: Readonly<{
        preset: "click";
        volume: 0.2;
        pitchJitter: 0.03;
        cooldownMs: 80;
    }>;
    uiReward: Readonly<{
        preset: "powerup";
        volume: 0.34;
        pitchJitter: 0.02;
        cooldownMs: 120;
    }>;
    uiError: Readonly<{
        preset: "hurt";
        volume: 0.25;
        pitchJitter: 0.02;
        cooldownMs: 120;
    }>;
}>;
/** Genre audio mixing profiles. */
export const AUDIO_PROFILES: Readonly<{
    action: Readonly<{
        bgmVolume: 0.36;
        baseIntensity: 0.55;
        combatIntensity: 0.78;
    }>;
    arcade: Readonly<{
        bgmVolume: 0.38;
        baseIntensity: 0.62;
        combatIntensity: 0.85;
    }>;
    tactical: Readonly<{
        bgmVolume: 0.3;
        baseIntensity: 0.38;
        combatIntensity: 0.65;
    }>;
    cozy: Readonly<{
        bgmVolume: 0.32;
        baseIntensity: 0.28;
        combatIntensity: 0.48;
    }>;
}>;
export type AudioDirectorOptions = {
    audio?: import("../platform/audio.js").AudioManager | null | undefined;
    theme?: string | undefined;
    mood?: string | undefined;
    profile?: "action" | "arcade" | "cozy" | "tactical" | undefined;
    bgmEnabled?: boolean | undefined;
    overrides?: Record<string, {
        cue?: string;
        preset?: string | object;
        volume?: number;
        pitchJitter?: number;
        cooldownMs?: number;
    }> | undefined;
    now?: (() => number) | undefined;
};
