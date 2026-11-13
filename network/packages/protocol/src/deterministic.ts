const INT32_MIN = -0x8000_0000;
const INT32_MAX = 0x7fff_ffff;

function assertInt32(value: bigint, name: string): number {
  if (value < BigInt(INT32_MIN) || value > BigInt(INT32_MAX)) {
    throw new RangeError(`${name} exceeds the signed 32-bit range`);
  }
  return Number(value);
}

export function toFixedInt(value: number, scale = 1000): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(scale) || scale < 1) {
    throw new RangeError('toFixedInt requires a finite value and positive safe-integer scale');
  }
  const result = Math.round(value * scale);
  if (!Number.isSafeInteger(result)) throw new RangeError('Fixed-point conversion exceeds the safe integer range');
  return assertInt32(BigInt(result), 'Fixed-point value');
}

export function toFloat(value: number, scale = 1000): number {
  if (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX || !Number.isSafeInteger(scale) || scale < 1) {
    throw new RangeError('toFloat requires an Int32 value and positive safe-integer scale');
  }
  return value / scale;
}

export function fpMul(a: number, b: number, scale = 1000): number {
  for (const [value, name] of [[a, 'a'], [b, 'b']] as const) {
    if (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX) throw new RangeError(`${name} must be Int32`);
  }
  if (!Number.isSafeInteger(scale) || scale < 1) throw new RangeError('scale must be a positive safe integer');
  return assertInt32((BigInt(a) * BigInt(b)) / BigInt(scale), 'Fixed-point product');
}

export function fpDiv(a: number, b: number, scale = 1000): number {
  for (const [value, name] of [[a, 'a'], [b, 'b']] as const) {
    if (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX) throw new RangeError(`${name} must be Int32`);
  }
  if (b === 0) throw new RangeError('Fixed-point division by zero');
  if (!Number.isSafeInteger(scale) || scale < 1) throw new RangeError('scale must be a positive safe integer');
  return assertInt32((BigInt(a) * BigInt(scale)) / BigInt(b), 'Fixed-point quotient');
}

export function intSqrt(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('intSqrt requires a nonnegative safe integer');
  let n = BigInt(value);
  if (n < 2n) return Number(n);
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return Number(x);
}

export class DeterministicRng {
  private state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new RangeError('RNG seed must be UInt32');
    this.state = seed >>> 0;
  }

  nextUint32(): number {
    let value = (this.state += 0x6d2b79f5) >>> 0;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    this.state = this.state >>> 0;
    return (value ^ (value >>> 14)) >>> 0;
  }

  rangeInt(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
      throw new RangeError('Invalid deterministic integer range');
    }
    const span = max - min + 1;
    if (span < 1 || span > 0x1_0000_0000) throw new RangeError('Range must fit in UInt32');
    const limit = Math.floor(0x1_0000_0000 / span) * span;
    let sample: number;
    do { sample = this.nextUint32(); } while (sample >= limit);
    return min + (sample % span);
  }

  getState(): number { return this.state >>> 0; }
  setState(state: number): void {
    if (!Number.isInteger(state) || state < 0 || state > 0xffff_ffff) throw new RangeError('RNG state must be UInt32');
    this.state = state >>> 0;
  }
}

/** Hashes canonical signed Int32 values in explicitly little-endian byte order. */
export function hashInt32State(values: readonly number[]): number {
  let hash = 0x811c9dc5;
  for (const value of values) {
    if (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX) throw new RangeError('State hash accepts Int32 values only');
    const unsigned = value >>> 0;
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (unsigned >>> shift) & 0xff;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0;
}
