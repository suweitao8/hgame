/**
 * Stable FNV-1a state hashing for determinism / lockstep checks.
 * Numbers hash by IEEE-754 bits (`-0` normalised to `0`, NaN canonical), typed arrays by
 * element bytes, plain objects by sorted keys. Little-endian byte order is assumed.
 * @module sim/checksum
 */

const f64 = new Float64Array(1);
const u8 = new Uint8Array(f64.buffer);
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * @typedef {object} StateChecksum
 * @property {(value: unknown) => StateChecksum} update Fold any supported value (number, string, boolean, null, array, typed array, plain object).
 * @property {(n: number) => StateChecksum} updateNumber Allocation-free fold of one number.
 * @property {() => number} digest Current uint32 hash (does not reset).
 * @property {() => string} hex Current hash as 8 lowercase hex chars.
 * @property {() => StateChecksum} reset Restore the initial seed.
 */

/**
 * Create an incremental FNV-1a (32-bit) checksum.
 * @returns {StateChecksum}
 */
export function createStateChecksum() {
  let h = FNV_OFFSET;
  /** @param {number} b */
  const byte = (b) => { h = Math.imul(h ^ (b & 255), FNV_PRIME); };
  /** @param {number} n */
  const num = (n) => {
    f64[0] = n !== n ? NaN : (n === 0 ? 0 : n);
    for (let i = 0; i < 8; i++) byte(u8[i]);
  };
  /** @param {unknown} v @param {number} depth */
  const fold = (v, depth) => {
    if (depth > 64) throw new RangeError('hashState: structure too deep or cyclic');
    switch (typeof v) {
      case 'number': byte(1); num(v); return;
      case 'boolean': byte(v ? 3 : 2); return;
      case 'string':
        byte(4);
        for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i); byte(c); byte(c >> 8); }
        byte(0xff);
        return;
      case 'bigint': byte(5); fold(v.toString(), depth + 1); return;
      case 'undefined': byte(6); return;
      case 'object': break;
      default: byte(7); return;
    }
    if (v === null) { byte(8); return; }
    if (ArrayBuffer.isView(v)) {
      byte(9);
      const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      num(bytes.length);
      for (let i = 0; i < bytes.length; i++) byte(bytes[i]);
      return;
    }
    if (Array.isArray(v)) {
      byte(10); num(v.length);
      for (let i = 0; i < v.length; i++) fold(v[i], depth + 1);
      return;
    }
    const obj = /** @type {Record<string, unknown>} */ (v);
    const keys = Object.keys(obj).sort();
    byte(11); num(keys.length);
    for (let i = 0; i < keys.length; i++) { fold(keys[i], depth + 1); fold(obj[keys[i]], depth + 1); }
  };
  /** @type {StateChecksum} */
  const api = {
    update(value) { fold(value, 0); return api; },
    updateNumber(n) { byte(1); num(n); return api; },
    digest() { return h >>> 0; },
    hex() { return (h >>> 0).toString(16).padStart(8, '0'); },
    reset() { h = FNV_OFFSET; return api; },
  };
  return api;
}

/**
 * One-shot stable hash of a value.
 * @param {unknown} value
 * @returns {number} uint32
 */
export function hashState(value) {
  return createStateChecksum().update(value).digest();
}
