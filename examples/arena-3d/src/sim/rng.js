// Small seeded PRNG (mulberry32) so simulations replay bit-identically from a seed.
export function createRng(seed = 1) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: n => Math.floor(next() * n),
    get state() { return s; },
    set state(v) { s = v >>> 0; },
  };
}

/** FNV-1a over raw bytes; fold several typed arrays / numbers into one 32-bit checksum. */
export function createHasher() {
  let h = 0x811c9dc5;
  const f64 = new Float64Array(1);
  const u8 = new Uint8Array(f64.buffer);
  return {
    bytes(view) {
      const b = view instanceof Uint8Array ? view : new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193);
    },
    number(v) {
      f64[0] = v;
      for (let i = 0; i < 8; i++) h = Math.imul(h ^ u8[i], 0x01000193);
    },
    hex() { return (h >>> 0).toString(16).padStart(8, '0'); },
  };
}
