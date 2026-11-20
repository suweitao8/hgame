/** Pixi's Canvas mask pop restores the native blend state outside its blend cache. */
export function synchronizePixiCanvasBlend(canvasContext) {
  const setBlendMode = canvasContext.setBlendMode;
  function synchronized(mode) {
    setBlendMode.call(this, mode);
    const operation = this.blendModes[mode] ?? 'source-over';
    const ctx = this.activeContext;
    if (ctx && ctx.globalCompositeOperation !== operation) ctx.globalCompositeOperation = operation;
  }
  canvasContext.setBlendMode = synchronized;
  return () => {
    if (canvasContext.setBlendMode === synchronized) canvasContext.setBlendMode = setBlendMode;
  };
}

/** Order opt-in Pixi content while sharing one screen-space mask per adjacent run. */
export function createPixiDrawGroups({ root, stage, Container, Graphics, order, onRemove }) {
  const groups = [];
  const byHandle = new Map();
  const runs = [];
  const drawOrder = order.createDrawOrder2D(entry => entry.y);
  let dirty = false, disposed = false;
  let lastWidth = 0, lastHeight = 0;
  let activeRuns = 0;

  function getContainer(handle) {
    const entry = byHandle.get(handle);
    if (!entry) throw new TypeError('Expected an active draw group of this renderer');
    return entry.container;
  }

  function setOrder(entry, options) {
    const layer = options.layer ?? entry.layer;
    const z = options.z ?? entry.z;
    const y = options.y ?? entry.y;
    if (![layer, z, y].every(Number.isFinite)) throw new RangeError('2D draw order values must be finite');
    const ySort = options.ySort === undefined ? entry.ySort : Boolean(options.ySort);
    const blendMode = order.normalizeBlend2D(options.blendMode ?? entry.blendMode);
    const clipRect = options.clipRect === undefined ? entry.clipRect : order.normalizeClipRect2D(options.clipRect);
    if (entry.layer === layer && entry.z === z && entry.y === y && entry.ySort === ySort &&
        entry.blendMode === blendMode && order.sameClipRect2D(entry.clipRect, clipRect)) return false;
    Object.assign(entry, { layer, z, y, ySort, blendMode, clipRect });
    if (entry.container.blendMode !== blendMode) entry.container.blendMode = blendMode;
    dirty = true;
    return true;
  }

  function create(options = {}) {
    if (disposed) throw new Error('Pixi draw groups are disposed');
    const entry = { container: new Container({ sortableChildren: true }), layer: 0, z: 0, y: 0, ySort: false,
      blendMode: 'normal', clipRect: null };
    try { setOrder(entry, options); }
    catch (error) { entry.container.destroy(); throw error; }
    entry.container.blendMode = entry.blendMode;
    const handle = {
      container: entry.container,
      setOrder(next) {
        getContainer(handle);
        return setOrder(entry, next);
      },
      dispose() {
        if (!byHandle.delete(handle)) return false;
        groups.splice(groups.indexOf(entry), 1);
        dirty = true;
        try { onRemove?.(entry.container); }
        finally { entry.container.destroy(); }
        return true;
      },
    };
    groups.push(entry);
    byHandle.set(handle, entry);
    dirty = true;
    return handle;
  }

  function clearMask(run) {
    run.container.mask = null;
    run.mask?.removeFromParent();
  }

  function updateClip(run, clip, resized) {
    const changed = !order.sameClipRect2D(run.clip, clip);
    run.clip = clip;
    const visible = clip === null || (clip.width > 0 && clip.height > 0);
    run.container.visible = visible;
    if (!clip || !visible) clearMask(run);
    else if (changed || resized || !run.mask?.parent) {
      const mask = run.mask ??= new Graphics();
      mask.clear().rect(clip.x * lastWidth, clip.y * lastHeight, clip.width * lastWidth, clip.height * lastHeight).fill(0xffffff);
      if (!mask.parent) stage.addChild(mask);
      if (run.container.mask !== mask) run.container.mask = mask;
    }
  }

  function prepare(width, height) {
    if (disposed) return;
    const resized = width !== lastWidth || height !== lastHeight;
    if (!dirty && !resized) return;
    lastWidth = width;
    lastHeight = height;
    if (!dirty) {
      for (let i = 0; i < activeRuns; i++) updateClip(runs[i], runs[i].clip, resized);
      return;
    }

    const list = drawOrder.apply(groups, groups.length, true, true);
    let run = null;
    let runCount = 0, childIndex = 0;
    for (const entry of list) {
      if (!run || !order.sameClipRect2D(run.clip, entry.clipRect)) {
        run = runs[runCount] ?? (runs[runCount] = { container: new Container(), clip: null, mask: null });
        if (!run.container.parent) root.addChild(run.container);
        updateClip(run, entry.clipRect, resized);
        runCount++;
        childIndex = 0;
      }
      if (run.container.children[childIndex] !== entry.container) {
        run.container.addChildAt(entry.container, childIndex);
      }
      childIndex++;
    }
    for (let i = runCount; i < activeRuns; i++) {
      const previous = runs[i];
      clearMask(previous);
      previous.container.visible = false;
    }
    activeRuns = runCount;
    drawOrder.clear();
    dirty = false;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const run of runs) {
      clearMask(run);
      run.mask?.destroy();
    }
    for (const entry of groups) entry.container.destroy({ children: true });
    root.destroy({ children: true });
    groups.length = runs.length = 0;
    byHandle.clear();
    drawOrder.clear();
  }

  return { create, getContainer, prepare, dispose };
}
