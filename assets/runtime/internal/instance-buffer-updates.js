// Bound the number of GL uploads in fragmented batches and across flushes
// that run before Three.js consumes the pending update ranges.
const MAX_INSTANCE_UPDATE_RANGES = 8;

/** @param {number} componentsPerRow */
export function createInstanceUpdateRanges(componentsPerRow) {
  const ranges = new Int32Array(MAX_INSTANCE_UPDATE_RANGES * 2);
  let length = 0;
  let collapsed = false;

  function reset() {
    length = 0;
    collapsed = false;
  }

  /** @param {number} row */
  function add(row) {
    const start = row * componentsPerRow;
    const end = start + componentsPerRow;
    if (length && (collapsed || ranges[length - 1] === start)) {
      ranges[length - 1] = end;
    } else if (length === ranges.length) {
      length = 2;
      collapsed = true;
      ranges[1] = end;
    } else {
      ranges[length++] = start;
      ranges[length++] = end;
    }
  }

  /**
   * @param {{ array: { length: number }, needsUpdate: boolean, clearUpdateRanges?: () => void, addUpdateRange?: (start: number, count: number) => void } | null | undefined} attribute
   * @returns {number} Number of array components scheduled by this submission.
   */
  function submit(attribute) {
    if (!length || !attribute) return 0;
    let components = attribute.array.length;
    if (typeof attribute.clearUpdateRanges === 'function' && typeof attribute.addUpdateRange === 'function') {
      const pending = 'updateRanges' in attribute && Array.isArray(attribute.updateRanges) ? attribute.updateRanges : null;
      if (pending && pending.length + length / 2 <= MAX_INSTANCE_UPDATE_RANGES) {
        components = 0;
        for (let i = 0; i < length; i += 2) {
          const count = ranges[i + 1] - ranges[i];
          attribute.addUpdateRange(ranges[i], count);
          components += count;
        }
      } else {
        let start = pending ? ranges[0] : 0;
        let end = pending ? ranges[length - 1] : attribute.array.length;
        for (const range of pending ?? []) {
          start = Math.min(start, range.start);
          end = Math.max(end, range.start + range.count);
        }
        components = end - start;
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(start, components);
      }
    }
    attribute.needsUpdate = true;
    return components;
  }

  return { reset, add, submit };
}
