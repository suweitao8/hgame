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
export function createStateChecksum(): StateChecksum;
/**
 * One-shot stable hash of a value.
 * @param {unknown} value
 * @returns {number} uint32
 */
export function hashState(value: unknown): number;
export type StateChecksum = {
    /**
     * Fold any supported value (number, string, boolean, null, array, typed array, plain object).
     */
    update: (value: unknown) => StateChecksum;
    /**
     * Allocation-free fold of one number.
     */
    updateNumber: (n: number) => StateChecksum;
    /**
     * Current uint32 hash (does not reset).
     */
    digest: () => number;
    /**
     * Current hash as 8 lowercase hex chars.
     */
    hex: () => string;
    /**
     * Restore the initial seed.
     */
    reset: () => StateChecksum;
};
