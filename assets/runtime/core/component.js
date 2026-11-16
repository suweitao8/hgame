/** Unity-inspired, intentionally small behavior component.
 * Hooks are camelCase and execute on the owning Scene's one logical loop.
 */
/**
 * Base class for behaviors; subclass and override the lifecycle hooks.
 */
export class Component {
  constructor() {
    /** @type {import('./entity.js').Entity | null} Owning entity (null while detached or destroyed). */
    this.entity = null;
    this._enabled = true;
    this._awake = false;
    this._started = false;
    this._running = false;
    this._destroyed = false;
  }
  /** Enabled flag; a disabled component receives no update hooks. @type {boolean} */
  get enabled() { return this._enabled; }
  /** @param {boolean} value */
  set enabled(value) {
    this._enabled = Boolean(value);
    this.entity?._syncComponents();
  }
  /** Unity-style alias of {@link Component#entity}. @returns {import('./entity.js').Entity | null} */
  get gameObject() { return this.entity; }
  /** Scene of the owning entity. @returns {import('./scene.js').Scene | null} */
  get scene() { return this.entity?.scene ?? null; }
  /** Called once when first activated. @returns {void} */
  awake() {}
  /** Called each time the component becomes active. @returns {void} */
  onEnable() {}
  /** Called once before the first update. @returns {void} */
  start() {}
  /**
   * Fixed-timestep hook.
   * @param {number} _dt Seconds (1 / tickHz).
   * @param {import('./application.js').GameApplication} _app
   * @returns {void}
   */
  fixedUpdate(_dt, _app) {}
  /**
   * Per-frame hook.
   * @param {number} _dt Scaled seconds since the previous frame.
   * @param {import('./application.js').GameApplication} _app
   * @returns {void}
   */
  update(_dt, _app) {}
  /**
   * Runs after every update hook of the frame.
   * @param {number} _dt Scaled seconds since the previous frame.
   * @param {import('./application.js').GameApplication} _app
   * @returns {void}
   */
  lateUpdate(_dt, _app) {}
  /** Called each time the component becomes inactive. @returns {void} */
  onDisable() {}
  /** Called once when destroyed. @returns {void} */
  onDestroy() {}
}
