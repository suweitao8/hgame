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
 * @property {number} [eventCapacity=128] Maximum retained gameplay events. Set to zero to disable recording.
 */

/**
 * @typedef {object} DiagnosticEvent
 * @property {number} tick Nonnegative simulation tick.
 * @property {string} type Game-defined event type.
 * @property {string} subject Entity, objective, asset, or other affected object.
 * @property {Record<string, string | number | boolean | null>} [details] Optional JSON-safe scalar fields.
 */

/**
 * @typedef {object} SceneCancellationRecord
 * @property {string} scene
 * @property {string | null} phase
 * @property {string} reason
 * @property {number} abortedAt
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
 * @property {ErrorReport | null} lastPhaseError
 * @property {readonly SceneCancellationRecord[]} sceneCancellations
 */

/**
 * @typedef {object} Diagnostics
 * @property {(timestampMs: number, startWindow?: boolean) => void} recordFrame Record a `requestAnimationFrame` timestamp (milliseconds). Pass true to start a fresh timing window after an interruption.
 * @property {(error: unknown, context?: Record<string, unknown>) => ErrorReport} reportError
 * @property {(record: { scene: string, phase?: string | null, reason?: unknown, abortedAt?: number }) => SceneCancellationRecord | null} recordSceneCancellation
 * @property {(event: DiagnosticEvent) => boolean} recordEvent Append a gameplay event. Returns false when disabled or disposed.
 * @property {() => {dropped: number, events: Readonly<DiagnosticEvent>[]}} readEvents Read the retained events in their emission order.
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
  eventCapacity = 128,
} = {}) {
  if (!Number.isSafeInteger(eventCapacity) || eventCapacity < 0) {
    throw new RangeError('eventCapacity must be a nonnegative safe integer');
  }
  /** @type {number[]} */
  let frames = [];
  let errors = 0;
  /** @type {ErrorReport | null} */
  let lastError = null;
  /** @type {ErrorReport | null} */
  let lastPhaseError = null;
  /** @type {SceneCancellationRecord[]} */
  const sceneCancellations = [];
  let disposed = false;
  /** @type {Readonly<DiagnosticEvent>[]} */
  const events = [];
  let eventCount = 0;
  let nextEvent = 0;

  /** @param {DiagnosticEvent} input */
  function recordEvent({ tick, type, subject, details }) {
    if (disposed || eventCapacity === 0) return false;
    if (!Number.isSafeInteger(tick) || tick < 0 || typeof type !== 'string' || !type ||
        typeof subject !== 'string' || !subject) {
      throw new TypeError('Diagnostic events require a nonnegative tick, type, and subject');
    }
    /** @type {DiagnosticEvent} */
    const event = { tick, type, subject };
    if (details !== undefined) {
      if (!details || typeof details !== 'object' || Array.isArray(details) ||
          Object.values(details).some(value => value !== null && typeof value !== 'string' &&
            typeof value !== 'boolean' && !Number.isFinite(value))) {
        throw new TypeError('Diagnostic event details must contain only JSON-safe scalar fields');
      }
      event.details = Object.freeze({ ...details });
    }
    events[nextEvent] = Object.freeze(event);
    nextEvent = (nextEvent + 1) % eventCapacity;
    eventCount++;
    return true;
  }

  function readEvents() {
    return {
      dropped: eventCount - events.length,
      events: eventCount > events.length ? events.slice(nextEvent).concat(events.slice(0, nextEvent)) : events.slice(),
    };
  }

  function reportError(error, context = {}) {
    const normalizedContext = context && typeof context === 'object' ? { ...context } : {};
    const detail = {
      gameId,
      message: String(error?.message || error || 'Unknown error'),
      stack: typeof error?.stack === 'string' ? error.stack.slice(0, 4000) : '',
      context: normalizedContext,
      timestamp: Date.now(),
    };
    errors++;
    lastError = detail;
    if (typeof normalizedContext.phase === 'string' && normalizedContext.phase) {
      lastPhaseError = detail;
    }
    onReport(detail);
    return detail;
  }

  function recordSceneCancellation({ scene, phase = null, reason = null, abortedAt = Date.now() } = {}) {
    if (disposed || typeof scene !== 'string' || !scene) return null;
    const record = Object.freeze({
      scene,
      phase: typeof phase === 'string' && phase ? phase : null,
      reason: String(reason?.message ?? reason ?? 'Scene deactivated'),
      abortedAt: Number.isFinite(abortedAt) ? abortedAt : Date.now(),
    });
    sceneCancellations.push(record);
    if (sceneCancellations.length > 32) sceneCancellations.shift();
    return record;
  }

  const onError = event => reportError(event.error || event.message, { source: event.filename, line: event.lineno, column: event.colno });
  const onRejection = event => reportError(event.reason, { type: 'unhandledrejection' });
  windowRef?.addEventListener?.('error', onError);
  windowRef?.addEventListener?.('unhandledrejection', onRejection);

  function recordFrame(timestamp, startWindow = false) {
    if (!Number.isFinite(timestamp)) return;
    if (startWindow) frames.length = 0;
    frames.push(timestamp);
    if (frames.length > Math.max(2, sampleFrames)) frames.shift();
  }

  function snapshot() {
    const duration = frames.length > 1 ? frames[frames.length - 1] - frames[0] : 0;
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
      frameCount: frames.length, errorCount: errors, lastError, lastPhaseError,
      sceneCancellations: Object.freeze(sceneCancellations.slice()) });
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    windowRef?.removeEventListener?.('error', onError);
    windowRef?.removeEventListener?.('unhandledrejection', onRejection);
    frames = [];
    events.length = 0;
    eventCount = 0;
    nextEvent = 0;
    return true;
  }

  return Object.freeze({ recordFrame, reportError, recordSceneCancellation, recordEvent, readEvents, snapshot, dispose });
}
