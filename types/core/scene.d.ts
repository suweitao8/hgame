/** Logic Scene. The Renderer and physics are per-project optional services. */
export class Scene {
    /** @param {string} name Unique scene name. */
    constructor(name: string);
    name: string;
    /** Root entities. @type {Entity[]} */
    objects: Entity[];
    active: boolean;
    /** @type {import('./application.js').GameApplication | null} */
    app: import("./application.js").GameApplication | null;
    /** @type {ScenePhysicsWorld | null} */
    physics: ScenePhysicsWorld | null;
    /** @type {TweenManager | null} */
    _tweens: TweenManager | null;
    _disposing: boolean;
    /** Lazily created per-scene tween manager. @returns {TweenManager} */
    get tweens(): TweenManager;
    /** Add a root entity. @template {Entity} T @param {T} entity @returns {T} */
    add<T extends Entity>(entity: T): T;
    /** Depth-first search by name. @param {string} name @returns {Entity | null} */
    find(name: string): Entity | null;
    /** @param {string} tag @param {SceneTagFindOptions} [options] @returns {Entity[]} */
    findByTag(tag: string, { exact, activeOnly }?: SceneTagFindOptions | undefined): Entity[];
    /** @param {import('./tags.js').TagQuery} query @param {{ activeOnly?: boolean }} [options] @returns {Entity[]} */
    queryTags(query: import("./tags.js").TagQuery, { activeOnly }?: {
        activeOnly?: boolean;
    } | undefined): Entity[];
    /** Called when the scene becomes current. @param {import('./application.js').GameApplication} _app @param {unknown} [_data] Value passed to `scenes.start`. @returns {void} */
    enter(_app: import("./application.js").GameApplication, _data?: unknown): void;
    /** Called when the scene stops being current. @param {import('./application.js').GameApplication} _app @returns {void} */
    exit(_app: import("./application.js").GameApplication): void;
    /** @param {number} _dt Seconds (1 / tickHz). @param {import('./application.js').GameApplication} _app @returns {void} */
    fixedUpdate(_dt: number, _app: import("./application.js").GameApplication): void;
    /** @param {number} _dt Scaled seconds. @param {import('./application.js').GameApplication} _app @returns {void} */
    update(_dt: number, _app: import("./application.js").GameApplication): void;
    /** @param {number} _dt Scaled seconds. @param {import('./application.js').GameApplication} _app @returns {void} */
    lateUpdate(_dt: number, _app: import("./application.js").GameApplication): void;
    /** @param {GameCommand} _command @param {import('./application.js').GameApplication} _app @returns {void} */
    onCommand(_command: GameCommand, _app: import("./application.js").GameApplication): void;
    /** @param {boolean} value @returns {void} */
    _setActive(value: boolean): void;
    /** @returns {void} */
    _capturePreviousTransforms(): void;
    /** @param {'fixedUpdate' | 'update' | 'lateUpdate'} phase @param {number} dt @param {import('./application.js').GameApplication} app @returns {void} */
    _run(phase: "fixedUpdate" | "update" | "lateUpdate", dt: number, app: import("./application.js").GameApplication): void;
    /** Deactivate and destroy all entities, tweens and physics. @returns {void} */
    dispose(): void;
}
/** Registry and switcher of {@link Scene}s. */
export class SceneManager {
    /**
     * @param {import('./application.js').GameApplication} app
     * @param {(scene: Scene) => void} [onScene] Called for every added scene.
     */
    constructor(app: import("./application.js").GameApplication, onScene?: ((scene: Scene) => void) | undefined);
    app: import("./application.js").GameApplication;
    onScene: ((scene: Scene) => void) | undefined;
    /** @type {Map<string, Scene>} */
    registry: Map<string, Scene>;
    /** @type {Scene | null} */
    current: Scene | null;
    _disposing: boolean;
    _switching: boolean;
    /** @type {Set<() => void>} */
    _disposeListeners: Set<() => void>;
    /** Register a uniquely named scene. @template {Scene} T @param {T} scene @returns {T} */
    add<T extends Scene>(scene: T): T;
    /** @param {string} name @returns {Scene | null} */
    get(name: string): Scene | null;
    /** Switch to a registered scene. @param {string} name @param {unknown} [data] Forwarded to `Scene#enter`. @returns {boolean} False if already current. */
    start(name: string, data?: unknown): boolean;
    /**
     * Activate a prepared scene before retiring the previous one. The previous scene remains
     * current through candidate activation. Enter hooks should only modify candidate state.
     * @param {string} name
     * @param {unknown} [data]
     * @param {() => boolean} [canCommit] Checked after lifecycle hooks to honor a cancelled transition.
     * @returns {{changed: boolean, cleanupErrors: unknown[]}}
     */
    activatePrepared(name: string, data?: unknown, canCommit?: (() => boolean) | undefined): {
        changed: boolean;
        cleanupErrors: unknown[];
    };
    /** Remove and dispose an owned scene. @param {string} name @returns {boolean} */
    remove(name: string): boolean;
    /** @param {() => void} listener @returns {() => boolean} */
    onDispose(listener: () => void): () => boolean;
    dispose(): void;
}
/**
 * Command delivered to {@link Scene#onCommand}.
 */
export type GameCommand = {
    type: string;
} & Record<string, unknown>;
/**
 * Per-scene physics world contract (provided by the physics modules).
 */
export type ScenePhysicsWorld = {
    step?: ((dtSeconds: number) => void) | undefined;
    remove?: ((entity: import("./entity.js").Entity) => void) | undefined;
    dispose?: (() => void) | undefined;
};
export type SceneTagFindOptions = {
    exact?: boolean;
    activeOnly?: boolean;
};
import { Entity } from './entity.js';
import { TweenManager } from '../time/tween.js';
