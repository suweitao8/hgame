// Zero-GC VFX core utilities: isolated visual PRNG, lossless 24-bit RGB packing,
// partial ring-buffer upload helpers, hitstop visual clock, and trauma camera shake.

export const VFX_RENDER_ORDERS = Object.freeze({
  CROWD: 0,
  TELEGRAPH: 10,
  TRAILS: 20,
  PARTICLES: 20,
  FLOATING_TEXT: 30,
  SCREEN: 999,
});

export const VFX_EASING = Object.freeze({
  easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const u = t - 1;
    return 1 + c3 * u * u * u + c1 * u * u;
  },
  easeOutQuint(t) {
    const u = 1 - t;
    return 1 - u * u * u * u * u;
  },
  easeOutCubic(t) {
    const u = 1 - t;
    return 1 - u * u * u;
  },
});

/**
 * Isolated visual PRNG (xorshift32). Never touches gameplay/lockstep RNG state.
 * @param {number} [seed=0x9e3779b9]
 */
export function createVisualPrng(seed = 0x9e3779b9) {
  let state = (seed >>> 0) || 0x12345678;
  return {
    nextFloat() {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    },
    range(min, max) {
      return min + (max - min) * this.nextFloat();
    },
    reset(newSeed = 0x9e3779b9) {
      state = (newSeed >>> 0) || 0x12345678;
    },
  };
}

/**
 * Packs 0xRRGGBB or (r, g, b) into an exact 24-bit IEEE-754 float32 integer [0 .. 16777215].
 * Avoids Uint32->Float32 bit-casting which can hit NaN bit patterns.
 * @param {number} hexOrR
 * @param {number} [g]
 * @param {number} [b]
 * @returns {number}
 */
export function packRgb24(hexOrR, g, b) {
  if (g === undefined) {
    return (hexOrR & 0xffffff) >>> 0;
  }
  const r8 = Math.max(0, Math.min(255, hexOrR | 0));
  const g8 = Math.max(0, Math.min(255, g | 0));
  const b8 = Math.max(0, Math.min(255, b | 0));
  return r8 * 65536 + g8 * 256 + b8;
}

/**
 * Unpacks a 24-bit integer float into normalized [0..1] RGB components inside a pre-allocated array.
 * @param {number} packed
 * @param {Float32Array|number[]} outRgb
 */
export function unpackRgb24Into(packed, outRgb) {
  const v = Math.max(0, Math.min(16777215, Math.floor(packed)));
  const r = Math.floor(v / 65536);
  const rem = v - r * 65536;
  const g = Math.floor(rem / 256);
  const b = rem - g * 256;
  outRgb[0] = r / 255;
  outRgb[1] = g / 255;
  outRgb[2] = b / 255;
  return outRgb;
}

/**
 * Marks a sub-range of a Three.js BufferAttribute as dirty using r17x addUpdateRange when available.
 * @param {object} attr
 * @param {number} floatOffset
 * @param {number} floatCount
 */
export function markAttributeRangeDirty(attr, floatOffset, floatCount) {
  if (!attr || floatCount <= 0) return;
  if (typeof attr.addUpdateRange === 'function') {
    attr.addUpdateRange(floatOffset, floatCount);
  } else if (attr.updateRange) {
    if (attr.updateRange.count < 0) {
      attr.updateRange.offset = floatOffset;
      attr.updateRange.count = floatCount;
    } else {
      const start = Math.min(attr.updateRange.offset, floatOffset);
      const end = Math.max(
        attr.updateRange.offset + attr.updateRange.count,
        floatOffset + floatCount,
      );
      attr.updateRange.offset = start;
      attr.updateRange.count = end - start;
    }
  }
  attr.needsUpdate = true;
}

/**
 * Submits one or two contiguous dirty ranges for a circular ring buffer without full-buffer upload.
 * @param {object} attr
 * @param {number} startIndex
 * @param {number} count
 * @param {number} capacity
 * @param {number} strideFloats
 * @param {Array<{offset:number,count:number}>} [outRanges]
 * @returns {number} Number of ranges submitted (0, 1, or 2)
 */
export function submitRingBufferRanges(attr, startIndex, count, capacity, strideFloats, outRanges = null) {
  if (count <= 0 || capacity <= 0) {
    if (outRanges) outRanges.length = 0;
    return 0;
  }
  const clampedCount = Math.min(count, capacity);
  const start = ((startIndex % capacity) + capacity) % capacity;
  const firstCount = Math.min(clampedCount, capacity - start);
  const secondCount = clampedCount - firstCount;

  if (attr) {
    markAttributeRangeDirty(attr, start * strideFloats, firstCount * strideFloats);
    if (secondCount > 0) {
      markAttributeRangeDirty(attr, 0, secondCount * strideFloats);
    }
  }

  if (outRanges) {
    outRanges.length = 0;
    outRanges.push({ offset: start, count: firstCount });
    if (secondCount > 0) {
      outRanges.push({ offset: 0, count: secondCount });
    }
  }
  return secondCount > 0 ? 2 : 1;
}

/**
 * Visual-only hitstop clock. Scales visualDt for VFX/animations without blocking fixed-step lockstep logic.
 */
export function createHitstopClock() {
  let remainSec = 0;
  let timeScale = 1.0;

  return {
    trigger(durationSec = 0.045, scale = 0.05) {
      if (durationSec > remainSec) {
        remainSec = durationSec;
        timeScale = Math.max(0.0, Math.min(1.0, scale));
      }
    },
    step(rawDt) {
      const clampedDt = Math.min(Math.max(rawDt, 0), 0.1);
      if (remainSec > 0) {
        remainSec -= clampedDt;
        if (remainSec <= 0) {
          remainSec = 0;
          timeScale = 1.0;
        }
        return clampedDt * timeScale;
      }
      return clampedDt;
    },
    isFrozen() {
      return remainSec > 0;
    },
    reset() {
      remainSec = 0;
      timeScale = 1.0;
    },
  };
}

/**
 * Zero-allocation directional + trauma^2 camera shake controller.
 */
export function createCameraShake() {
  let trauma = 0;
  let kickX = 0;
  let kickY = 0;
  let kickZ = 0;
  let phase = 0;
  const outOffset = { x: 0, y: 0, z: 0, roll: 0 };

  return {
    impulse(intensity = 0.35, dirX = 0, dirY = 0, dirZ = 0) {
      const mag = Math.max(0, intensity);
      trauma = Math.min(1.0, trauma + mag);
      kickX += dirX * mag * 0.6;
      kickY += dirY * mag * 0.6;
      kickZ += dirZ * mag * 0.6;
    },
    update(rawDt, maxAmplitude = 0.45, maxRollRad = 0.035) {
      const dt = Math.min(Math.max(rawDt, 0), 0.1);
      phase += dt * 48.0;
      trauma = Math.max(0, trauma - dt * 2.4);
      const decay = Math.exp(-18.0 * dt);
      kickX *= decay;
      kickY *= decay;
      kickZ *= decay;

      const shake = trauma * trauma;
      outOffset.x = kickX + Math.sin(phase * 1.13) * Math.cos(phase * 0.71) * maxAmplitude * shake;
      outOffset.y = kickY + Math.sin(phase * 1.37 + 1.2) * maxAmplitude * shake;
      outOffset.z = kickZ + Math.cos(phase * 0.97 + 2.4) * maxAmplitude * shake;
      outOffset.roll = Math.sin(phase * 1.53) * maxRollRad * shake;
      return outOffset;
    },
    get offset() {
      return outOffset;
    },
    reset() {
      trauma = 0;
      kickX = kickY = kickZ = phase = 0;
      outOffset.x = outOffset.y = outOffset.z = outOffset.roll = 0;
    },
  };
}
