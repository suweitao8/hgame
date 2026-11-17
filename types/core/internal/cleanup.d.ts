/** Run every independent cleanup action before reporting failures to the caller.
 * @param {Iterable<() => unknown>} actions
 * @param {string} message
 * @returns {void}
 */
export function cleanupAll(actions: Iterable<() => unknown>, message: string): void;
