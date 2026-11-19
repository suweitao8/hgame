function referencesTexture(value, texture, visited) {
  if (value === texture) return true;
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  visited ??= new Set();
  if (visited.has(value)) return false;
  visited.add(value);
  return Object.values(value).some(element => referencesTexture(element, texture, visited));
}

function readsTexture(uniforms, texture) {
  if (!uniforms || !texture) return false;
  for (const name in uniforms) {
    if (referencesTexture(uniforms[name]?.value, texture)) return true;
  }
  return false;
}

/**
 * Pane-local full-size HDR intermediates with read/write lifetimes within a frame.
 * @template {{width: number, height: number, depthBuffer: boolean, texture: unknown, dispose?: () => void}} Target
 * @param {(width: number, height: number, depthBuffer: boolean) => Target} makeTarget
 */
export function createHdrTargets(makeTarget) {
  /** @type {{target: Target, busy: boolean, used: boolean}[]} */
  const entries = [];
  let rendering = false;

  /**
   * @param {number} width
   * @param {number} height
   * @param {boolean} depthBuffer
   * @param {Record<string, {value: unknown}>} [inputs] Optional caller uniforms that may read a pooled color target.
   */
  function acquire(width, height, depthBuffer, inputs) {
    let entry = entries.find(item => !item.busy && item.target.width === width &&
      item.target.height === height && item.target.depthBuffer === depthBuffer && !readsTexture(inputs, item.target.texture));
    if (!entry) {
      entry = { target: makeTarget(width, height, depthBuffer), busy: false, used: false };
      entries.push(entry);
    }
    entry.busy = true;
    entry.used = true;
    return entry.target;
  }

  /** @param {Target} target */
  function release(target) {
    const entry = entries.find(item => item.target === target);
    if (entry) entry.busy = false;
  }

  function remove(index) {
    const [entry] = entries.splice(index, 1);
    entry.target.dispose?.();
  }

  function finishFrame() {
    rendering = false;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (!entry.used) remove(i);
      else {
        entry.busy = false;
        entry.used = false;
      }
    }
  }

  /** @param {number} count */
  function trimColor(count) {
    if (rendering) return;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (!entries[i].target.depthBuffer && count-- <= 0) remove(i);
    }
  }

  return {
    acquire,
    release,
    beginFrame() { rendering = true; },
    finishFrame,
    trimColor,
    /** @param {{recordTarget: (target: Target) => void}} sink */
    record(sink) { for (const { target } of entries) sink.recordTarget(target); },
    dispose() { while (entries.length) remove(entries.length - 1); },
  };
}
