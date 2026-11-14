/**
 * Serializes unread marks, daily acknowledgements, and muted paths.
 * @param {object} ctx
 * @returns {import('./helpers.js').RedDotPersistedData}
 */
export function exportRedDotState(ctx: object): import("./helpers.js").RedDotPersistedData;
/**
 * Imports persisted red-dot state inside a batch.
 * @param {object} ctx
 * @param {unknown} data
 * @param {{ batch: (fn: () => void) => void, ensureNode: (path: string) => object, markDirtyUp: (node: object) => void }} ops
 */
export function importRedDotState(ctx: object, data: unknown, { batch, ensureNode, markDirtyUp }: {
    batch: (fn: () => void) => void;
    ensureNode: (path: string) => object;
    markDirtyUp: (node: object) => void;
}): void;
/**
 * Syncs clock & commercial day key and marks time-sensitive nodes dirty.
 * @param {object} ctx
 * @param {boolean} markAffected
 * @param {(node: object) => void} markDirtyUp
 * @returns {boolean}
 */
export function syncRedDotTime(ctx: object, markAffected: boolean, markDirtyUp: (node: object) => void): boolean;
/**
 * Acknowledges unread & daily sources on a single node.
 * @param {object} ctx
 * @param {object} node
 * @param {(node: object) => void} markDirtyUp
 * @returns {boolean}
 */
export function ackSingleRedDotNode(ctx: object, node: object, markDirtyUp: (node: object) => void): boolean;
