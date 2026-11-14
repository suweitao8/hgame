/**
 * Seeded deterministic RNG (mulberry32). Zero-allocation per draw.
 * @module sim/rng
 */

/**
 * @typedef {object} SeededRng
 * @property {() => number} next Float in `[0, 1)`.
 * @property {(maxExclusive: number) => number} int Integer in `[0, maxExclusive)`.
 * @property {(min: number, max: number) => number} range Float in `[min, max)`.
 * @property {<T>(items: ArrayLike<T>) => T | undefined} pick Uniform element (`undefined` when empty).
 * @property {<T extends { length: number }>(items: T) => T} shuffle In-place Fisher-Yates; returns the same array.
 * @property {(label?: number | string) => SeededRng} fork Independent child stream; advances the parent by one draw.
 * @property {() => number} getState Current uint32 state (serialisable).
 * @property {(state: number) => SeededRng} setState Restore a state from `getState()`.
 */

/**
 * @param {number | string | undefined} seed
 * @returns {number} uint32
 */
function seedToUint32(seed) {
  if (typeof seed === 'string') {
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
    return h >>> 0;
  }
  const n = Number(seed);
  return Number.isFinite(n) ? (Math.floor(n) >>> 0) : 0;
}

/**
 * Create a deterministic mulberry32-style generator.
 * @param {number | string} [seed] Integer (or string) seed; default `1`.
 * @returns {SeededRng}
 */
export function createSeededRng(seed = 1) {
  let s = seedToUint32(seed);
  /** @type {SeededRng} */
  const rng = {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(maxExclusive) {
      return Math.floor(rng.next() * maxExclusive);
    },
    range(min, max) {
      return min + rng.next() * (max - min);
    },
    pick(items) {
      return items.length ? items[Math.floor(rng.next() * items.length)] : undefined;
    },
    shuffle(items) {
      const a = /** @type {any} */ (items);
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        const tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
      }
      return items;
    },
    fork(label = 0) {
      const base = (Math.floor(rng.next() * 4294967296) ^ seedToUint32(label)) >>> 0;
      return createSeededRng(Math.imul(base ^ 0x9e3779b9, 0x85ebca6b) >>> 0);
    },
    getState() {
      return s;
    },
    setState(state) {
      s = seedToUint32(state);
      return rng;
    },
  };
  return rng;
}
