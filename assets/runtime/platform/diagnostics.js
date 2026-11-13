export function createDiagnostics({
  gameId = 'unknown',
  windowRef = globalThis.window,
  onReport = () => {},
  sampleFrames = 60,
} = {}) {
  let frames = [];
  let errors = 0;
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
    return Object.freeze({ gameId, fps, frameTimeMs, frameCount: frames.length, errorCount: errors, lastError });
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
