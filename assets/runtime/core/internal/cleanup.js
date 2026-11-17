/** Run every independent cleanup action before reporting failures to the caller.
 * @param {Iterable<() => unknown>} actions
 * @param {string} message
 * @returns {void}
 */
export function cleanupAll(actions, message) {
  const errors = [];
  for (const action of actions) {
    try { action(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, message);
}
