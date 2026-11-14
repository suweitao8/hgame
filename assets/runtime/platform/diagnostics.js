/**
 * @typedef {object} ErrorReport
 * @property {string} gameId
 * @property {string} message
 * @property {string} stack Truncated to 4000 characters; empty when unavailable.
 * @property {Record<string, unknown>} context Extra data (e.g. `source`, `line`, `column`, `type`, `subsystem`).
 * @property {number} timestamp Epoch milliseconds.
 */

/**
 * @typedef {object} DiagnosticsOptions
 * @property {string} [gameId='unknown']
 * @property {Window} [windowRef] Window that receives `error`/`unhandledrejection` listeners.
 * @property {(report: ErrorReport) => void} [onReport] Called for every reported error.
 * @property {number} [sampleFrames=60] Rolling frame window used for FPS statistics (min 2).
 */

/**
 * @typedef {object} DiagnosticsSnapshot
 * @property {string} gameId
 * @property {number} fps Frames per second over the sample window.
 * @property {number} frameTimeMs Mean frame interval in milliseconds.
 * @property {number} frameTimeP95Ms 95th-percentile frame interval in milliseconds.
 * @property {number} frameTimeMaxMs Longest frame interval in milliseconds.
 * @property {number} longFrames Count of intervals longer than 50 ms.
 * @property {number} frameCount Frames in the window.
 * @property {number} errorCount Total reported errors.
 * @property {ErrorReport | null} lastError
 */

/**
 * @typedef {object} Diagnostics
 * @property {(timestampMs: number) => void} recordFrame Record a `requestAnimationFrame` timestamp (milliseconds).
 * @property {(error: unknown, context?: Record<string, unknown>) => ErrorReport} reportError
 * @property {() => Readonly<DiagnosticsSnapshot>} snapshot
 * @property {() => boolean} dispose Detach window listeners; false if already disposed.
 */

/**
 * Create the frame-time / error diagnostics service.
 * @param {DiagnosticsOptions} [options]
 * @returns {Diagnostics}
 */
export function createDiagnostics({
  gameId = 'unknown',
  windowRef = globalThis.window,
  onReport = () => {},
  sampleFrames = 60,
} = {}) {
  /** @type {number[]} */
  let frames = [];
  let errors = 0;
  /** @type {ErrorReport | null} */
  let lastError = null;
  let disposed = false;

  function reportError(error, context = {}) {
    const detail = {
      gameId,
      message: String(error?.message || error || 'Unknown error'),
      stack: typeof error?.stack === 'string' ? error.stack.slice(0, 4000) : '',
      context,
      timestamp: Date.now(),
    };
    errors++;
    lastError = detail;
    onReport(detail);
    return detail;
  }

  const onError = event => reportError(event.error || event.message, { source: event.filename, line: event.lineno, column: event.colno });
  const onRejection = event => reportError(event.reason, { type: 'unhandledrejection' });
  windowRef?.addEventListener?.('error', onError);
  windowRef?.addEventListener?.('unhandledrejection', onRejection);

  function recordFrame(timestamp) {
    if (!Number.isFinite(timestamp)) return;
    frames.push(timestamp);
    if (frames.length > Math.max(2, sampleFrames)) frames.shift();
  }

  function snapshot() {
    const duration = frames.length > 1 ? frames.at(-1) - frames[0] : 0;
    const fps = duration > 0 ? (frames.length - 1) * 1000 / duration : 0;
    const frameTimeMs = frames.length > 1 ? duration / (frames.length - 1) : 0;
    // Frame-time distribution so an agent can spot hitches without a profiler.
    const deltas = [];
    for (let i = 1; i < frames.length; i++) deltas.push(frames[i] - frames[i - 1]);
    deltas.sort((a, b) => a - b);
    const p95 = deltas.length ? deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * 0.95))] : 0;
    const max = deltas.length ? deltas[deltas.length - 1] : 0;
    const longFrames = deltas.filter(d => d > 50).length;
    return Object.freeze({ gameId, fps, frameTimeMs, frameTimeP95Ms: p95, frameTimeMaxMs: max, longFrames,
      frameCount: frames.length, errorCount: errors, lastError });
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    windowRef?.removeEventListener?.('error', onError);
    windowRef?.removeEventListener?.('unhandledrejection', onRejection);
    frames = [];
    return true;
  }

  return Object.freeze({ recordFrame, reportError, snapshot, dispose });
}
