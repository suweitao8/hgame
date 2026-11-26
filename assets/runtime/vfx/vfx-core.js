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

/**
 * Evaluates instantaneous Unity VelocityModule.radial velocity toward/away from `(cx, cy, cz)`,
 * clamping inward steps over `dt` so particles settle smoothly at the radial origin without overshoot.
 * @param {number} px
 * @param {number} py
 * @param {number} pz
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {number} velRadial
 * @param {number} vScale
 * @param {number} dt
 * @param {Float32Array | number[]} out3
 */
export function computeDynamicRadialVel(px, py, pz, cx, cy, cz, velRadial, vScale, dt, out3) {
  if (!velRadial || !vScale) {
    out3[0] = 0;
    out3[1] = 0;
    out3[2] = 0;
    return;
  }
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  const rLen = Math.hypot(dx, dy, dz);
  if (rLen <= 0.0005) {
    out3[0] = 0;
    out3[1] = 0;
    out3[2] = 0;
    return;
  }
  let effVel = velRadial * vScale;
  if (dt > 0 && effVel < 0) {
    const maxStep = -effVel * dt;
    if (maxStep > rLen) {
      effVel = -rLen / dt;
    }
  }
  const inv = effVel / rLen;
  out3[0] = dx * inv;
  out3[1] = dy * inv;
  out3[2] = dz * inv;
}

const CHAMFERED_OCTAGON_VERTS = [
  -0.5, -0.21,
  -0.21, -0.5,
  0.21, -0.5,
  0.5, -0.21,
  0.5, 0.21,
  0.21, 0.5,
  -0.21, 0.5,
  -0.5, 0.21,
];

const CHAMFERED_OCTAGON_INDICES = [
  0, 1, 2,
  0, 2, 3,
  0, 3, 4,
  0, 4, 5,
  0, 5, 6,
  0, 6, 7,
];

/**
 * 2D triangle list (18 vertices = 6 triangles) tightly bounding the unit circle
 * (`r <= 1.0`), eliminating ~17% corner overdraw on mobile TBDR GPUs.
 */
export const CHAMFERED_OCTAGON_TRIS_2D = new Float32Array(
  CHAMFERED_OCTAGON_INDICES.flatMap((idx) => [
    CHAMFERED_OCTAGON_VERTS[idx * 2],
    CHAMFERED_OCTAGON_VERTS[idx * 2 + 1],
  ]),
);

/**
 * Builds an instanced chamfered-octagon particle geometry (8 vertices, 6 triangles)
 * bounding the unit inscribed circle (`r <= 1.0`) to cut ~17% corner pixel overdraw.
 * @param {object} THREE
 * @returns {object}
 */
export function createChamferedOctagonGeometry(THREE) {
  const geo = new THREE.InstancedBufferGeometry();
  const pos = new Float32Array(24);
  const uv = new Float32Array(16);
  for (let i = 0; i < 8; i++) {
    const x = CHAMFERED_OCTAGON_VERTS[i * 2];
    const y = CHAMFERED_OCTAGON_VERTS[i * 2 + 1];
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = 0;
    uv[i * 2] = x + 0.5;
    uv[i * 2 + 1] = y + 0.5;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(CHAMFERED_OCTAGON_INDICES);
  return geo;
}

/**
 * Detects mobile devices, Bilibili Toy WebViews, and WeChat/Douyin mini-game runtimes
 * so VFX pools apply mobile-safe memory budgets and half-float GPU defaults.
 * @returns {boolean}
 */
export function isMobileOrMiniGameEnv() {
  if (typeof globalThis === 'undefined') return false;
  if (globalThis.wx?.createCanvas || globalThis.tt?.createCanvas || globalThis.toy) return true;
  const nav = globalThis.navigator;
  if (nav?.userAgent && /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(nav.userAgent)) return true;
  if ((nav?.maxTouchPoints ?? 0) > 1 && (globalThis.innerWidth ?? 1920) <= 1024) return true;
  return false;
}

/**
 * Creates a 2D offscreen/staging canvas across Browser DOM, WeChat (`wx.createCanvas`),
 * Douyin (`tt.createCanvas`), and Worker `OffscreenCanvas` runtimes.
 * @param {number} width
 * @param {number} height
 * @returns {HTMLCanvasElement | OffscreenCanvas | null}
 */
export function createOffscreen2dCanvas(width, height) {
  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  /** @type {any} */
  let canvas = null;
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    canvas = document.createElement('canvas');
  } else if (typeof globalThis.wx?.createCanvas === 'function') {
    canvas = globalThis.wx.createCanvas();
  } else if (typeof globalThis.tt?.createCanvas === 'function') {
    canvas = globalThis.tt.createCanvas();
  } else if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(w, h);
  }
  if (!canvas) return null;
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function evalClampCurveArray(pts, t, fallback) {
  if (!Array.isArray(pts) || pts.length === 0) return fallback;
  if (t <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 0; i < pts.length - 1; i++) {
    const x0 = pts[i][0];
    const x1 = pts[i + 1][0];
    if (t <= x1) {
      const span = Math.max(1e-6, x1 - x0);
      return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * ((t - x0) / span);
    }
  }
  return last[1];
}

function evalClampSpec(spec, t, seed = 0.5, fallback = 0) {
  if (spec === null || spec === undefined) return fallback;
  if (typeof spec === 'number') return Number.isFinite(spec) ? spec : fallback;
  if (Array.isArray(spec)) {
    if (spec.length === 2 && typeof spec[0] === 'number' && typeof spec[1] === 'number') {
      return spec[0] + (spec[1] - spec[0]) * seed;
    }
    return evalClampCurveArray(spec, t, fallback);
  }
  if (typeof spec === 'object') {
    const sc = Number.isFinite(spec.scalar) ? spec.scalar : 1;
    if (spec.mode === 'twoCurves' && Array.isArray(spec.curve)) {
      const mSc = Number.isFinite(spec.minScalar) ? spec.minScalar : sc;
      const a = evalClampCurveArray(spec.minCurve || spec.curve, t, fallback) * mSc;
      const b = evalClampCurveArray(spec.curve, t, fallback) * sc;
      return a + (b - a) * seed;
    }
    if (Array.isArray(spec.curve)) {
      return evalClampCurveArray(spec.curve, t, fallback) * sc;
    }
    if (Number.isFinite(spec.min) && Number.isFinite(spec.max)) {
      return spec.min + (spec.max - spec.min) * seed;
    }
    if (Number.isFinite(spec.value)) return spec.value;
    if (Number.isFinite(spec.scalar)) return spec.scalar;
  }
  return fallback;
}

/**
 * Returns true if a Unity LimitVelocityModule (`clampVelocity`) config has active drag or speed limits.
 * @param {object | null | undefined} cfg
 * @returns {boolean}
 */
export function hasClampVelocity(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  return Number(cfg.limit) > 0 || Boolean(cfg.drag) || Boolean(cfg.separateAxis) || cfg.magnitude !== undefined;
}

/**
 * Applies one Unity LimitVelocityOverLifetimeModule step (drag + scalar/separateAxis velocity clamp)
 * in-place on an object with `.vx`, `.vy`, `.vz` properties without allocations.
 * @param {{ vx: number, vy: number, vz: number }} target
 * @param {object | null | undefined} cfg
 * @param {number} dt
 * @param {number} [t=0]
 * @param {number} [seed=0.5]
 */
export function applyClampVelocityStep(target, cfg, dt, t = 0, seed = 0.5) {
  if (!cfg || dt <= 0) return;
  if (cfg.drag !== undefined && cfg.drag !== null) {
    const cDrag = Math.max(0, evalClampSpec(cfg.drag, t, seed, 0));
    if (cDrag > 0.001) {
      const cd = Math.exp(-cDrag * dt);
      target.vx *= cd;
      target.vy *= cd;
      target.vz *= cd;
    }
  }
  const cDampen = Math.max(0, Math.min(1, Number(cfg.dampen ?? 1)));
  if (cDampen <= 0) return;
  const damp = cDampen >= 0.999 ? 1.0 : (1.0 - Math.pow(1.0 - cDampen, dt * 60.0));
  if (cfg.separateAxis) {
    const lx = Math.max(0, evalClampSpec(cfg.x, t, seed, 1000));
    const ly = Math.max(0, evalClampSpec(cfg.y, t, seed, 1000));
    const lz = Math.max(0, evalClampSpec(cfg.z, t, seed, 1000));
    if (Math.abs(target.vx) > lx) target.vx += (Math.sign(target.vx) * lx - target.vx) * damp;
    if (Math.abs(target.vy) > ly) target.vy += (Math.sign(target.vy) * ly - target.vy) * damp;
    if (Math.abs(target.vz) > lz) target.vz += (Math.sign(target.vz) * lz - target.vz) * damp;
    return;
  }
  const lim = Math.max(0, evalClampSpec(cfg.magnitude !== undefined ? cfg.magnitude : cfg.limit, t, seed, Number(cfg.limit) || 0));
  if (lim <= 0) return;
  const spd = Math.hypot(target.vx, target.vy, target.vz);
  if (spd > lim && spd > 1e-6) {
    const targetSpd = spd + (lim - spd) * damp;
    const ratio = targetSpd / spd;
    target.vx *= ratio;
    target.vy *= ratio;
    target.vz *= ratio;
  }
}
