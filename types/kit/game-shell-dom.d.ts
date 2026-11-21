/**
 * @typedef {object} GameShellOptions
 * @property {HTMLElement | null} [root] Host container (defaults to `document.body`).
 * @property {import('./game-session.js').createGameSession extends (...args: any[]) => infer R ? R : object} session
 * @property {string} [title]
 * @property {string} [theme]
 * @property {string[]} [metrics]
 * @property {string[]} [bars]
 * @property {string} [hintKeys='WASD · J']
 * @property {boolean} [portraitFirst=true] Anchor clickable shell controls into the bottom-right thumb arc on portrait screens.
 */
/**
 * @typedef {object} GameShellHandle
 * @property {HTMLElement} hud
 * @property {{ step: (dt?: number) => boolean, wake: () => void, syncDirectorDom: () => void, setTheme: (themeName: string) => void, dispose: () => void }} uiUx
 * @property {() => void} sync
 * @property {(text: string) => void} setDebugText
 * @property {(themeId: string) => void} setTheme
 * @property {() => void} dispose
 */
/**
 * Mount a Zero-Prose, Hard-Button-Budget, Anti-Bloat DOM Game UI Shell wired to a `GameSession`.
 * @param {GameShellOptions} options
 * @returns {Readonly<GameShellHandle>}
 */
export function mountGameShell(options: GameShellOptions): Readonly<GameShellHandle>;
export type GameShellOptions = {
    /**
     * Host container (defaults to `document.body`).
     */
    root?: HTMLElement | null | undefined;
    session: typeof import("./game-session.js").createGameSession extends (...args: any[]) => infer R ? R : object;
    title?: string | undefined;
    theme?: string | undefined;
    metrics?: string[] | undefined;
    bars?: string[] | undefined;
    hintKeys?: string | undefined;
    /**
     * Anchor clickable shell controls into the bottom-right thumb arc on portrait screens.
     */
    portraitFirst?: boolean | undefined;
};
export type GameShellHandle = {
    hud: HTMLElement;
    uiUx: {
        step: (dt?: number) => boolean;
        wake: () => void;
        syncDirectorDom: () => void;
        setTheme: (themeName: string) => void;
        dispose: () => void;
    };
    sync: () => void;
    setDebugText: (text: string) => void;
    setTheme: (themeId: string) => void;
    dispose: () => void;
};
