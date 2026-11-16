/**
 * Create a deterministic mulberry32-style generator.
 * @param {number | string} [seed] Integer (or string) seed; default `1`.
 * @returns {SeededRng}
 */
export function createSeededRng(seed?: string | number | undefined): SeededRng;
export type SeededRng = {
    /**
     * Float in `[0, 1)`.
     */
    next: () => number;
    /**
     * Integer in `[0, maxExclusive)`.
     */
    int: (maxExclusive: number) => number;
    /**
     * Float in `[min, max)`.
     */
    range: (min: number, max: number) => number;
    /**
     * Uniform element (`undefined` when empty).
     */
    pick: <T>(items: ArrayLike<T>) => T | undefined;
    /**
     * In-place Fisher-Yates; returns the same array.
     */
    shuffle: <T extends {
        length: number;
    }>(items: T) => T;
    /**
     * Independent child stream; advances the parent by one draw.
     */
    fork: (label?: number | string) => SeededRng;
    /**
     * Current uint32 state (serialisable).
     */
    getState: () => number;
    /**
     * Restore a state from `getState()`.
     */
    setState: (state: number) => SeededRng;
};
