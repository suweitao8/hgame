/**
 * Reject a sliced search if it observes two navigation revisions.
 * @template T
 * @param {Generator<undefined, T, void>} work
 * @param {() => boolean} isCurrent
 * @returns {Generator<undefined, T, void>}
 */
export function* guardNavigationWork(work, isCurrent) {
  try {
    while (true) {
      if (!isCurrent()) throw new Error('Navigation changed during path search');
      const next = work.next();
      if (!isCurrent()) throw new Error('Navigation changed during path search');
      if (next.done) return next.value;
      yield;
    }
  } finally {
    work.return(undefined);
  }
}

/**
 * Account for path reconstruction as well as the search when a job is sliced.
 * @template T
 * @param {T[]} points
 */
export function* reversePath(points) {
  for (let left = 0, right = points.length - 1; left < right; left++, right--) {
    const point = points[left];
    points[left] = points[right];
    points[right] = point;
    yield;
  }
}
