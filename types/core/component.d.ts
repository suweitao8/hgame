/** Unity-inspired, intentionally small behavior component.
 * Hooks are camelCase and execute on the owning Scene's one logical loop.
 */
/**
 * Base class for behaviors; subclass and override the lifecycle hooks.
 */
export class Component {
    /** @type {import('./entity.js').Entity | null} Owning entity (null while detached or destroyed). */
    entity: import("./entity.js").Entity | null;
    _enabled: boolean;
    _awake: boolean;
    _started: boolean;
    _running: boolean;
    _destroyed: boolean;
    /** @param {boolean} value */
    set enabled(value: boolean);
    /** Enabled flag; a disabled component receives no update hooks. @type {boolean} */
    get enabled(): boolean;
    /** Unity-style alias of {@link Component#entity}. @type {import('./entity.js').Entity | null} */
    get gameObject(): import("./entity.js").Entity;
    /** Scene of the owning entity. @type {import('./scene.js').Scene | null} */
    get scene(): import("./scene.js").Scene;
    /** Called once when first activated. @returns {void} */
    awake(): void;
    /** Called each time the component becomes active. @returns {void} */
    onEnable(): void;
    /** Called once before the first update. @returns {void} */
    start(): void;
    /**
     * Fixed-timestep hook.
     * @param {number} _dt Seconds (1 / tickHz).
     * @param {import('./application.js').GameApplication} _app
     * @returns {void}
     */
    fixedUpdate(_dt: number, _app: import("./application.js").GameApplication): void;
    /**
     * Per-frame hook.
     * @param {number} _dt Scaled seconds since the previous frame.
     * @param {import('./application.js').GameApplication} _app
     * @returns {void}
     */
    update(_dt: number, _app: import("./application.js").GameApplication): void;
    /**
     * Runs after every update hook of the frame.
     * @param {number} _dt Scaled seconds since the previous frame.
     * @param {import('./application.js').GameApplication} _app
     * @returns {void}
     */
    lateUpdate(_dt: number, _app: import("./application.js").GameApplication): void;
    /** Called each time the component becomes inactive. @returns {void} */
    onDisable(): void;
    /** Called once when destroyed. @returns {void} */
    onDestroy(): void;
}
