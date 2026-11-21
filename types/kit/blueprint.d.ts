/**
 * List available genre archetype IDs.
 * @returns {string[]}
 */
export function listGenreArchetypes(): string[];
/**
 * Normalize and validate a 5-pillar Game Design Blueprint (`game.design.json`).
 * @param {object} [input]
 */
export function defineGameBlueprint(input?: object): {
    schemaVersion: number;
    meta: {
        id: string;
        title: string;
        genre: string;
        perspective: any;
        preset: any;
        renderer: string;
        tickHz: any;
        coreLoop: string;
        sessionTargetSec: any;
    };
    design: {
        feel: {
            playerSpeed: any;
            playerRadius: any;
            dashSpeed: any;
            dashCooldownSec: any;
            hitStopMs: any;
            traumaMax: any;
        };
        balance: {
            playerHp: any;
            gruntHp: any;
            gruntDamage: any;
            weaponDps: any;
            arenaSpan: any;
            waveDurationSec: any;
            maxUpgrades: any;
        };
        progression: {
            waves: any;
            upgrades: any;
            economy: any;
        };
    };
    ui: {
        theme: "cyber" | "scifi" | "arcane" | "arcade";
        hudMetrics: any[];
        hudBars: any[];
        maxTitleButtons: any;
        maxInGameButtons: any;
        maxResultButtons: any;
        cardChoices: any;
        hudMaxAreaRatio: any;
    };
    art: {
        theme: string;
        palette: any;
        vfxStyle: string;
        damagePreset: string;
    };
    audio: {
        mood: string;
        profile: string;
        overrides: any;
    };
};
/**
 * Evaluate golden dimensionless ratios, Anti-Bloat UI budgets, and optional 1-1-2-1 slice limits.
 * @param {ReturnType<typeof defineGameBlueprint>} blueprint
 * @param {{ strictSlice?: boolean }} [options]
 */
export function evaluateBlueprintBalance(blueprint: ReturnType<typeof defineGameBlueprint>, options?: {
    strictSlice?: boolean;
} | undefined): {
    ok: boolean;
    score: number;
    checks: any[];
    warnings: string[];
    errors: any[];
};
/**
 * Turn a concise game idea into a validated 5-pillar GameBlueprint ready for scaffolding.
 * @param {{ id: string, title?: string, genre?: string, theme?: string, coreLoop?: string, design?: object, ui?: object, art?: object, audio?: object }} idea
 */
export function createBlueprintFromIdea(idea: {
    id: string;
    title?: string;
    genre?: string;
    theme?: string;
    coreLoop?: string;
    design?: object;
    ui?: object;
    art?: object;
    audio?: object;
}): {
    schemaVersion: number;
    meta: {
        id: string;
        title: string;
        genre: string;
        perspective: any;
        preset: any;
        renderer: string;
        tickHz: any;
        coreLoop: string;
        sessionTargetSec: any;
    };
    design: {
        feel: {
            playerSpeed: any;
            playerRadius: any;
            dashSpeed: any;
            dashCooldownSec: any;
            hitStopMs: any;
            traumaMax: any;
        };
        balance: {
            playerHp: any;
            gruntHp: any;
            gruntDamage: any;
            weaponDps: any;
            arenaSpan: any;
            waveDurationSec: any;
            maxUpgrades: any;
        };
        progression: {
            waves: any;
            upgrades: any;
            economy: any;
        };
    };
    ui: {
        theme: "cyber" | "scifi" | "arcane" | "arcade";
        hudMetrics: any[];
        hudBars: any[];
        maxTitleButtons: any;
        maxInGameButtons: any;
        maxResultButtons: any;
        cardChoices: any;
        hudMaxAreaRatio: any;
    };
    art: {
        theme: string;
        palette: any;
        vfxStyle: string;
        damagePreset: string;
    };
    audio: {
        mood: string;
        profile: string;
        overrides: any;
    };
};
/** Canonical genre archetypes supported out of the box by HGame templates. */
export const GENRE_ARCHETYPES: Readonly<{
    'action-2d': Readonly<{
        id: "action-2d";
        perspective: "2d";
        preset: "2d";
        renderer: "webgl2d";
        tickHz: 60;
        defaultTheme: "scifi";
        audioProfile: "action";
        feel: Readonly<{
            playerSpeed: 6.5;
            playerRadius: 0.45;
            dashSpeed: 16;
            dashCooldownSec: 1.4;
            hitStopMs: 36;
            traumaMax: 0.55;
        }>;
        balance: Readonly<{
            playerHp: 100;
            gruntHp: 30;
            gruntDamage: 12;
            weaponDps: 28;
            arenaSpan: 48;
            waveDurationSec: 60;
            maxUpgrades: 5;
        }>;
        ui: Readonly<{
            hudMetrics: string[];
            hudBars: string[];
            maxTitleButtons: 1;
            maxInGameButtons: 1;
            maxResultButtons: 2;
            cardChoices: 3;
            hudMaxAreaRatio: 0.1;
        }>;
    }>;
    'horde-2d': Readonly<{
        id: "horde-2d";
        perspective: "2d";
        preset: "horde";
        renderer: "webgl2d";
        tickHz: 60;
        defaultTheme: "cyber";
        audioProfile: "arcade";
        feel: Readonly<{
            playerSpeed: 7.2;
            playerRadius: 0.45;
            dashSpeed: 18;
            dashCooldownSec: 1.2;
            hitStopMs: 24;
            traumaMax: 0.5;
        }>;
        balance: Readonly<{
            playerHp: 120;
            gruntHp: 20;
            gruntDamage: 10;
            weaponDps: 36;
            arenaSpan: 64;
            waveDurationSec: 60;
            maxUpgrades: 5;
        }>;
        ui: Readonly<{
            hudMetrics: string[];
            hudBars: string[];
            maxTitleButtons: 1;
            maxInGameButtons: 1;
            maxResultButtons: 2;
            cardChoices: 3;
            hudMaxAreaRatio: 0.1;
        }>;
    }>;
    'arena-3d': Readonly<{
        id: "arena-3d";
        perspective: "3d";
        preset: "3d";
        renderer: "threejs";
        tickHz: 60;
        defaultTheme: "arcane";
        audioProfile: "action";
        feel: Readonly<{
            playerSpeed: 7;
            playerRadius: 0.5;
            dashSpeed: 16;
            dashCooldownSec: 1.5;
            hitStopMs: 42;
            traumaMax: 0.6;
        }>;
        balance: Readonly<{
            playerHp: 100;
            gruntHp: 40;
            gruntDamage: 15;
            weaponDps: 32;
            arenaSpan: 52;
            waveDurationSec: 60;
            maxUpgrades: 5;
        }>;
        ui: Readonly<{
            hudMetrics: string[];
            hudBars: string[];
            maxTitleButtons: 1;
            maxInGameButtons: 1;
            maxResultButtons: 2;
            cardChoices: 3;
            hudMaxAreaRatio: 0.1;
        }>;
    }>;
    'card-ui': Readonly<{
        id: "card-ui";
        perspective: "ui";
        preset: "ui";
        renderer: "dom";
        tickHz: 0;
        defaultTheme: "arcane";
        audioProfile: "tactical";
        feel: Readonly<{
            playerSpeed: 0;
            playerRadius: 0.5;
            dashSpeed: 0;
            dashCooldownSec: 0;
            hitStopMs: 0;
            traumaMax: 0.2;
        }>;
        balance: Readonly<{
            playerHp: 40;
            gruntHp: 18;
            gruntDamage: 5;
            weaponDps: 10;
            arenaSpan: 0;
            waveDurationSec: 120;
            maxUpgrades: 5;
        }>;
        ui: Readonly<{
            hudMetrics: string[];
            hudBars: string[];
            maxTitleButtons: 1;
            maxInGameButtons: 1;
            maxResultButtons: 2;
            cardChoices: 3;
            hudMaxAreaRatio: 0.1;
        }>;
    }>;
}>;
export { listArtThemes };
import { listArtThemes } from './art-themes.js';
