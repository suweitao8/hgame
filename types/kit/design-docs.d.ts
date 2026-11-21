/**
 * Render the 4 canonical per-game design documents from a game's config, engine recipe, and optional blueprint.
 * @param {{ gameConfig?: { id?: string, name?: string, version?: string }, recipe?: { profile?: string, renderer?: string, physics?: string | null, tickHz?: number }, blueprint?: object | null }} [options]
 * @returns {{ 'GDD.md': string, 'ART-AND-AUDIO.md': string, 'UI-UX.md': string, 'LEVEL.md': string }}
 */
export function renderGameDesignDocs(options?: {
    gameConfig?: {
        id?: string;
        name?: string;
        version?: string;
    };
    recipe?: {
        profile?: string;
        renderer?: string;
        physics?: string | null;
        tickHz?: number;
    };
    blueprint?: object | null;
} | undefined): {
    "GDD.md": string;
    "ART-AND-AUDIO.md": string;
    "UI-UX.md": string;
    "LEVEL.md": string;
};
/** Canonical per-game design document filenames under `docs/design/`. */
export const REQUIRED_DESIGN_DOCS: readonly string[];
