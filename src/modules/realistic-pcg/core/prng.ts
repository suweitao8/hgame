/**
 * Deterministic PRNGs (Mulberry32 & xoshiro128**) and seamless 2D/3D noise kernels.
 * Zero heap allocations inside per-pixel / per-vertex hot paths.
 */

export interface SeededRng {
  nextUint32(): number;
  nextFloat(): number;
  nextRange(min: number, max: number): number;
  nextInt(minInclusive: number, maxExclusive: number): number;
}

export function mulberry32(seed: number): SeededRng {
  let a = seed >>> 0;
  const nextUint32 = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
  return {
    nextUint32,
    nextFloat: () => nextUint32() / 4294967296,
    nextRange: (min, max) => min + (nextUint32() / 4294967296) * (max - min),
    nextInt: (minInc, maxExc) =>
      minInc + Math.floor((nextUint32() / 4294967296) * (maxExc - minInc)),
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function xoshiro128ss(seed: number): SeededRng {
  const seeder = mulberry32(seed);
  let s0 = seeder.nextUint32() || 1;
  let s1 = seeder.nextUint32() || 2;
  let s2 = seeder.nextUint32() || 3;
  let s3 = seeder.nextUint32() || 4;

  const nextUint32 = (): number => {
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result;
  };

  return {
    nextUint32,
    nextFloat: () => nextUint32() / 4294967296,
    nextRange: (min, max) => min + (nextUint32() / 4294967296) * (max - min),
    nextInt: (minInc, maxExc) =>
      minInc + Math.floor((nextUint32() / 4294967296) * (maxExc - minInc)),
  };
}

export function hash2i(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export function hash3i(ix: number, iy: number, iz: number, seed: number): number {
  let h =
    (Math.imul(ix | 0, 374761393) +
      Math.imul(iy | 0, 668265263) +
      Math.imul(iz | 0, 2147483647) +
      Math.imul(seed | 0, 1442695041)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function grad2Dot(hash: number, dx: number, dy: number): number {
  switch (hash & 7) {
    case 0: return dx + dy;
    case 1: return -dx + dy;
    case 2: return dx - dy;
    case 3: return -dx - dy;
    case 4: return dx;
    case 5: return -dx;
    case 6: return dy;
    default: return -dy;
  }
}

function wrapInt(i: number, period: number): number {
  const r = i % period;
  return r < 0 ? r + period : r;
}

/**
 * Seamless periodic 2D gradient (Perlin) noise on [0, 1)^2. Returns roughly [-1, 1].
 */
export function perlin2DPeriodic(
  u: number,
  v: number,
  periodX: number,
  periodY: number,
  seed: number
): number {
  const px = periodX < 1 ? 1 : (periodX + 0.5) | 0;
  const py = periodY < 1 ? 1 : (periodY + 0.5) | 0;
  const x = u * px;
  const y = v * py;
  const x0 = x >= 0 ? x | 0 : Math.floor(x);
  const y0 = y >= 0 ? y | 0 : Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;

  const wx0 = wrapInt(x0, px);
  const wy0 = wrapInt(y0, py);
  const wx1 = wx0 + 1 >= px ? 0 : wx0 + 1;
  const wy1 = wy0 + 1 >= py ? 0 : wy0 + 1;

  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);

  const n00 = grad2Dot(hash2i(wx0, wy0, seed), fx, fy);
  const n10 = grad2Dot(hash2i(wx1, wy0, seed), fx - 1, fy);
  const n01 = grad2Dot(hash2i(wx0, wy1, seed), fx, fy - 1);
  const n11 = grad2Dot(hash2i(wx1, wy1, seed), fx - 1, fy - 1);

  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

/**
 * Fast row-fill seamless periodic 2D FBM into a flat Float32Array slice [rowStart..rowEnd).
 */
export function fillFbm2DRows(
  out: Float32Array,
  size: number,
  yStart: number,
  yEnd: number,
  scale: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
  seed: number
): void {
  const invSize = 1 / size;
  const baseFreq = Math.max(1, Math.round(scale));
  const lac = Math.max(1, Math.round(lacunarity));

  // Precompute octave constants outside pixel loops
  const octFreqs = new Int32Array(octaves);
  const octAmps = new Float32Array(octaves);
  const octSeeds = new Int32Array(octaves);
  let maxAmp = 0;
  let amp = 1;
  let freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    octFreqs[o] = freq;
    octAmps[o] = amp;
    octSeeds[o] = (seed + o * 1013) | 0;
    maxAmp += amp;
    amp *= persistence;
    freq *= lac;
  }
  const invMaxAmp = maxAmp > 0 ? 0.5 / maxAmp : 0;

  for (let y = yStart; y < yEnd; y++) {
    const v = (y + 0.5) * invSize;
    const rowOff = y * size;
    // Clear row first
    out.fill(0, rowOff, rowOff + size);

    for (let o = 0; o < octaves; o++) {
      const p = octFreqs[o]!;
      const oAmp = octAmps[o]!;
      const oSeed = octSeeds[o]!;

      const py = v * p;
      const y0 = py | 0;
      const fy = py - y0;
      const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
      const wy0 = y0 % p;
      const wy1 = wy0 + 1 >= p ? 0 : wy0 + 1;
      const ySeed0 = (Math.imul(wy0, 668265263) + Math.imul(oSeed, 1442695041)) | 0;
      const ySeed1 = (Math.imul(wy1, 668265263) + Math.imul(oSeed, 1442695041)) | 0;

      for (let x = 0; x < size; x++) {
        const px = ((x + 0.5) * invSize) * p;
        const x0 = px | 0;
        const fx = px - x0;
        const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
        const wx0 = x0 % p;
        const wx1 = wx0 + 1 >= p ? 0 : wx0 + 1;

        const xMul0 = Math.imul(wx0, 374761393);
        const xMul1 = Math.imul(wx1, 374761393);

        let h00 = (xMul0 + ySeed0) | 0; h00 = Math.imul(h00 ^ (h00 >>> 13), 1274126177); h00 ^= h00 >>> 16;
        let h10 = (xMul1 + ySeed0) | 0; h10 = Math.imul(h10 ^ (h10 >>> 13), 1274126177); h10 ^= h10 >>> 16;
        let h01 = (xMul0 + ySeed1) | 0; h01 = Math.imul(h01 ^ (h01 >>> 13), 1274126177); h01 ^= h01 >>> 16;
        let h11 = (xMul1 + ySeed1) | 0; h11 = Math.imul(h11 ^ (h11 >>> 13), 1274126177); h11 ^= h11 >>> 16;

        const n00 = grad2Dot(h00, fx, fy);
        const n10 = grad2Dot(h10, fx - 1, fy);
        const n01 = grad2Dot(h01, fx, fy - 1);
        const n11 = grad2Dot(h11, fx - 1, fy - 1);

        const nx0 = n00 + (n10 - n00) * sx;
        const nx1 = n01 + (n11 - n01) * sx;
        out[rowOff + x]! += (nx0 + (nx1 - nx0) * sy) * oAmp;
      }
    }

    for (let x = 0; x < size; x++) {
      const val = out[rowOff + x]! * invMaxAmp + 0.5;
      out[rowOff + x] = val < 0 ? 0 : val > 1 ? 1 : val;
    }
  }
}

/**
 * Seamless periodic 2D FBM mapped into [0, 1].
 */
export function fbm2DPeriodic(
  u: number,
  v: number,
  scale: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
  seed: number
): number {
  let sum = 0;
  let amp = 1;
  let maxAmp = 0;
  let freq = Math.max(1, Math.round(scale));
  const lac = Math.max(1, Math.round(lacunarity));

  for (let o = 0; o < octaves; o++) {
    sum += perlin2DPeriodic(u, v, freq, freq, (seed + o * 1013) | 0) * amp;
    maxAmp += amp;
    amp *= persistence;
    freq *= lac;
  }

  const normalized = maxAmp > 0 ? sum / maxAmp : 0;
  return Math.max(0, Math.min(1, normalized * 0.5 + 0.5));
}

export interface WorleySample {
  f1: number;
  f2: number;
  f2MinusF1: number;
  cellRand: number;
}

/**
 * Seamless periodic 2D Worley (cellular) noise on [0, 1)^2.
 * Writes directly into `out` when provided to avoid heap allocations.
 */
export function worley2DPeriodic(
  u: number,
  v: number,
  scale: number,
  jitter: number,
  seed: number,
  out: WorleySample = { f1: 0, f2: 0, f2MinusF1: 0, cellRand: 0 }
): WorleySample {
  const period = Math.max(1, Math.round(scale));
  const x = u * period;
  const y = v * period;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const fx = x - cx;
  const fy = y - cy;

  let f1Sq = 1e9;
  let f2Sq = 1e9;
  let bestHash = 0;

  for (let dy = -1; dy <= 1; dy++) {
    const wy = wrapInt(cy + dy, period);
    for (let dx = -1; dx <= 1; dx++) {
      const wx = wrapInt(cx + dx, period);
      const h1 = hash2i(wx, wy, seed);
      const h2 = hash2i(wx, wy, (seed + 7919) | 0);
      const jx = ((h1 & 0xffff) / 65535 - 0.5) * jitter + 0.5;
      const jy = ((h2 & 0xffff) / 65535 - 0.5) * jitter + 0.5;
      const px = dx + jx - fx;
      const py = dy + jy - fy;
      const dSq = px * px + py * py;
      if (dSq < f1Sq) {
        f2Sq = f1Sq;
        f1Sq = dSq;
        bestHash = h1;
      } else if (dSq < f2Sq) {
        f2Sq = dSq;
      }
    }
  }

  const f1 = Math.min(1, Math.sqrt(f1Sq));
  const f2 = Math.min(1.414, Math.sqrt(f2Sq));
  out.f1 = f1;
  out.f2 = Math.min(1, f2);
  out.f2MinusF1 = Math.max(0, Math.min(1, f2 - f1));
  out.cellRand = ((bestHash >>> 16) & 0xffff) / 65535;
  return out;
}

const GRAD3: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

function grad3Dot(hash: number, dx: number, dy: number, dz: number): number {
  const g = GRAD3[hash % 12]!;
  return g[0] * dx + g[1] * dy + g[2] * dz;
}

/**
 * 3D gradient noise for rock/terrain displacement. Returns [-1, 1].
 */
export function noise3D(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const sx = fade(fx);
  const sy = fade(fy);
  const sz = fade(fz);

  const n000 = grad3Dot(hash3i(x0, y0, z0, seed), fx, fy, fz);
  const n100 = grad3Dot(hash3i(x0 + 1, y0, z0, seed), fx - 1, fy, fz);
  const n010 = grad3Dot(hash3i(x0, y0 + 1, z0, seed), fx, fy - 1, fz);
  const n110 = grad3Dot(hash3i(x0 + 1, y0 + 1, z0, seed), fx - 1, fy - 1, fz);
  const n001 = grad3Dot(hash3i(x0, y0, z0 + 1, seed), fx, fy, fz - 1);
  const n101 = grad3Dot(hash3i(x0 + 1, y0, z0 + 1, seed), fx - 1, fy, fz - 1);
  const n011 = grad3Dot(hash3i(x0, y0 + 1, z0 + 1, seed), fx, fy - 1, fz - 1);
  const n111 = grad3Dot(hash3i(x0 + 1, y0 + 1, z0 + 1, seed), fx - 1, fy - 1, fz - 1);

  const nx00 = lerp(n000, n100, sx);
  const nx10 = lerp(n010, n110, sx);
  const nx01 = lerp(n001, n101, sx);
  const nx11 = lerp(n011, n111, sx);
  return lerp(lerp(nx00, nx10, sy), lerp(nx01, nx11, sy), sz);
}

export function fbm3D(
  x: number,
  y: number,
  z: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
  seed: number
): number {
  let sum = 0;
  let amp = 1;
  let maxAmp = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise3D(x * freq, y * freq, z * freq, (seed + o * 2029) | 0) * amp;
    maxAmp += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return maxAmp > 0 ? sum / maxAmp : 0;
}
