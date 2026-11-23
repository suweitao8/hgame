/**
 * Single-player standard gamepad and keyboard/pointer action routing.
 * @param {object} options
 * @param {import('./manager.js').InputManager} options.input
 * @param {() => ArrayLike<Gamepad | null>} [options.getGamepads]
 * @param {(index: number) => void} [options.onDisconnect]
 * @param {keyof typeof BUTTON_GLYPHS} [options.gamepadFamily] Override browser identification.
 */
export function createSinglePlayerInput({ input, getGamepads, onDisconnect, gamepadFamily, }: {
    input: import("./manager.js").InputManager;
    getGamepads?: (() => ArrayLike<Gamepad | null>) | undefined;
    onDisconnect?: ((index: number) => void) | undefined;
    gamepadFamily?: "playstation" | "switch" | "xbox" | "generic" | undefined;
}): Readonly<{
    router: import("./router.js").InputActionRouter;
    update: (dtSeconds?: number | undefined) => void;
    readonly device: string;
    readonly gamepadIndex: number | null;
    /** @param {boolean} value */
    setSwapConfirmCancel(value: boolean): void;
    getGlyph: (context: string, action: string) => string | null;
    promptParts: (i18n: {
        t: (key: string, params?: Record<string, unknown>) => string;
    }, key: string, context: string, params?: Record<string, unknown> | undefined) => (string | {
        action: string;
        glyph: string | null;
    })[];
    dispose(): void;
}>;
