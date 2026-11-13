/** Unity-inspired, intentionally small behavior component.
 * Hooks are camelCase and execute on the owning Scene's one logical loop.
 */
export class Component {
  constructor() {
    this.entity = null;
    this._enabled = true;
    this._awake = false;
    this._started = false;
    this._running = false;
    this._destroyed = false;
  }
  get enabled() { return this._enabled; }
  set enabled(value) {
    this._enabled = Boolean(value);
    this.entity?._syncComponents();
  }
  get gameObject() { return this.entity; }
  get scene() { return this.entity?.scene ?? null; }
  awake() {}
  onEnable() {}
  start() {}
  fixedUpdate(_dt, _app) {}
  update(_dt, _app) {}
  lateUpdate(_dt, _app) {}
  onDisable() {}
  onDestroy() {}
}
