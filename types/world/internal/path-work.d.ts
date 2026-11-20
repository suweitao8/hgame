/**
 * Reject a sliced search if it observes two navigation revisions.
 * @template T
 * @param {Generator<undefined, T, void>} work
 * @param {() => boolean} isCurrent
 * @returns {Generator<undefined, T, void>}
 */
export function guardNavigationWork<T>(work: Generator<undefined, T, void>, isCurrent: () => boolean): Generator<undefined, T, void>;
/**
 * Account for path reconstruction as well as the search when a job is sliced.
 * @template T
 * @param {T[]} points
 */
export function reversePath<T>(points: T[]): Generator<undefined, void, unknown>;
