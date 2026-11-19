const MAX_QUERIES = 4;
const MAX_SAMPLE_AGE_MS = 250;

export function createGpuFrameTimer(gl, { alternate = true } = {}) {
  const ext = gl?.getExtension?.('EXT_disjoint_timer_query_webgl2');
  if (!ext || typeof gl.getQuery !== 'function' || typeof gl.createQuery !== 'function' ||
      typeof gl.getQueryParameter !== 'function' || typeof gl.getParameter !== 'function' ||
      typeof gl.beginQuery !== 'function' || typeof gl.endQuery !== 'function' ||
      typeof gl.deleteQuery !== 'function') return null;
  const target = ext.TIME_ELAPSED_EXT;
  if (!(gl.getQuery(target, ext.QUERY_COUNTER_BITS_EXT) > 0)) return null;

  const free = [];
  const pending = [];
  let active = null;
  let discardActive = false;
  let skipNext = false;

  function reset() {
    for (const { query } of pending) gl.deleteQuery(query);
    for (const { query } of free) gl.deleteQuery(query);
    pending.length = 0;
    free.length = 0;
    discardActive = active !== null;
    skipNext = false;
  }

  function begin(tag = null) {
    if (active || gl.isContextLost?.()) return false;
    skipNext = !skipNext;
    if ((alternate && !skipNext) || pending.length >= MAX_QUERIES || gl.getQuery(target, gl.CURRENT_QUERY)) return false;
    const entry = free.pop();
    const query = entry?.query ?? gl.createQuery();
    if (!query) return false;
    active = entry ?? { query, time: 0 };
    active.time = performance.now();
    active.tag = tag;
    gl.beginQuery(target, query);
    return true;
  }

  function end() {
    const entry = active;
    active = null;
    if (!entry || gl.isContextLost?.()) return;
    gl.endQuery(target);
    if (discardActive) gl.deleteQuery(entry.query);
    else pending.push(entry);
    discardActive = false;
  }

  function poll(onSample = null) {
    if (pending.length === 0 || gl.isContextLost?.()) return null;
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      if (onSample) for (const entry of pending) onSample(entry.tag, null, 'disjoint');
      reset();
      return null;
    }
    const now = performance.now();
    let sum = 0;
    let count = 0;
    while (pending.length > 0) {
      const entry = pending[0];
      if (now - entry.time >= MAX_SAMPLE_AGE_MS) {
        pending.shift();
        gl.deleteQuery(entry.query);
        onSample?.(entry.tag, null, 'expired');
        continue;
      }
      if (!gl.getQueryParameter(entry.query, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(entry.query, gl.QUERY_RESULT);
      pending.shift();
      const tag = entry.tag;
      entry.tag = null;
      free.push(entry);
      if (Number.isFinite(ns) && ns > 0) {
        sum += ns;
        count++;
        onSample?.(tag, ns / 1e6, 'ready');
      } else {
        onSample?.(tag, null, 'invalid');
      }
    }
    return count > 0 ? sum / count / 1e6 : null;
  }

  return { begin, end, poll, reset };
}
