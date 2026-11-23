/**
 * Poll keyboard, standard gamepad and touch through the default single-player action bindings.
 * @param {object} options
 * @param {import('../platform/input/manager.js').InputManager} options.input
 * @param {() => ArrayLike<Gamepad | null>} [options.getGamepads]
 * @param {(index: number) => void} [options.onDisconnect]
 * @param {boolean} [options.confirmWithEnter=true] Include Enter as a menu confirmation shortcut.
 * @param {readonly (keyof typeof COMBAT)[]} [options.actions] Actions used by this game.
 */
export function createActionGameControls({ input, getGamepads, onDisconnect, actions, confirmWithEnter, }: {
    input: import("../platform/input/manager.js").InputManager;
    getGamepads?: (() => ArrayLike<Gamepad | null>) | undefined;
    onDisconnect?: ((index: number) => void) | undefined;
    confirmWithEnter?: boolean | undefined;
    actions?: readonly ("attack" | "dash" | "skill1" | "skill2" | "skill3" | "skill4")[] | undefined;
}): Readonly<{
    move: {
        x: number;
        y: number;
    };
    touchPlayer: import("../integrations/touch-controls.js").TouchControlsPlayer;
    update: (dt: number, nextMode: "combat" | "menu") => void;
    releaseTouch: () => void;
    readonly device: string;
    /** @param {string} name */
    getGlyph(name: string): string | null;
    /** @param {string} name */
    wasPressed(name: string): boolean;
    /** @param {string} name */
    isDown(name: string): boolean;
    dispose(): void;
}>;
