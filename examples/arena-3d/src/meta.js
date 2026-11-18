// Persistent meta-progress. Takes any store with get/set (HGame createSaveStore), so it is testable in Node.
export const EMPTY_BEST = Object.freeze({ time: 0, kills: 0, level: 1, runs: 0, wins: 0, fastestWin: null });

export function loadBest(store) {
  return { ...EMPTY_BEST, ...store.get('best', EMPTY_BEST) };
}

/** Fold a finished run ({time,kills,level,outcome}) into the saved best. Returns { best, record }. */
export function recordRun(store, run) {
  const prev = loadBest(store);
  const won = run.outcome === 'victory';
  const faster = won && (prev.fastestWin === null || run.time < prev.fastestWin);
  const best = {
    time: Math.max(prev.time, run.time), kills: Math.max(prev.kills, run.kills),
    level: Math.max(prev.level, run.level), runs: prev.runs + 1,
    wins: prev.wins + Number(won),
    fastestWin: faster ? run.time : prev.fastestWin,
  };
  const record = faster || run.time > prev.time || run.kills > prev.kills;
  store.set('best', best);
  return { best, record };
}
