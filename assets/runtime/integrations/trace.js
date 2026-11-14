/**
 * @typedef {object} TraceRecorderOptions
 * @property {string} gameId Non-empty game identifier written to the header.
 * @property {string} scenarioId Non-empty scenario/replay identifier written to the header.
 * @property {string} [build='dev'] Non-empty build label.
 * @property {number} [tickHz=0] Simulation rate in Hz (>= 0; 0 = unspecified).
 * @property {(line: string) => void} emit Receives each JSONL line (header first, then one per event).
 * @property {number} [maxEvents=100000] Maximum recordable events (integer 1..10,000,000).
 */

/**
 * First line emitted by a recorder.
 * @typedef {object} TraceHeader
 * @property {'trace'} _type Record discriminator.
 * @property {1} schemaVersion Trace schema version.
 * @property {string} gameId
 * @property {string} scenarioId
 * @property {string} build
 * @property {number} tickHz
 */

/**
 * Event accepted by TraceRecorder#record; extra JSON-serializable fields are preserved.
 * @typedef {object} TraceEventInput
 * @property {number} tick Non-negative safe integer simulation tick; must be non-decreasing.
 * @property {string | number} actorId Non-empty string or safe-integer actor identifier.
 * @property {string} type Non-empty event type.
 */

/**
 * @typedef {object} TraceRecorder
 * @property {Readonly<TraceHeader>} header The emitted header record.
 * @property {number} sequence Number of events recorded so far (getter).
 * @property {number} lastTick Tick of the last recorded event, or -1 (getter).
 * @property {(event: TraceEventInput & Record<string, unknown>) => number} record Validate and emit an event; returns its 1-based sequence number.
 */

/**
 * Optional, renderer-neutral JSONL event recorder for reverse/replica QA.
 * It does not own a clock, scheduler, RAF, timer, storage or network service.
 * Record committed game events only; predicted/rolled-back events need a
 * project-specific revision key before they can be compared safely.
 * @param {TraceRecorderOptions} options
 * @returns {TraceRecorder}
 */
export function createTraceRecorder({
  gameId,
  scenarioId,
  build = 'dev',
  tickHz = 0,
  emit,
  maxEvents = 100_000,
} = {}) {
  if (typeof gameId !== 'string' || !gameId.trim()) throw new TypeError('Trace recorder requires gameId');
  if (typeof scenarioId !== 'string' || !scenarioId.trim()) throw new TypeError('Trace recorder requires scenarioId');
  if (typeof build !== 'string' || !build.trim()) throw new TypeError('Trace recorder requires build');
  if (!Number.isFinite(tickHz) || tickHz < 0) throw new RangeError('tickHz must be a non-negative number');
  if (typeof emit !== 'function') throw new TypeError('Trace recorder requires emit(line)');
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 10_000_000) {
    throw new RangeError('maxEvents must be 1..10000000');
  }

  const header = Object.freeze({
    _type: 'trace', schemaVersion: 1, gameId, scenarioId, build, tickHz,
  });
  let sequence = 0;
  let lastTick = -1;
  emit(JSON.stringify(header));

  return Object.freeze({
    header,
    get sequence() { return sequence; },
    get lastTick() { return lastTick; },
    record(event) {
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw new TypeError('Trace event must be an object');
      }
      if (!Number.isSafeInteger(event.tick) || event.tick < 0) {
        throw new RangeError('Trace event tick must be a non-negative safe integer');
      }
      if (event.tick < lastTick) throw new RangeError('Trace events must be emitted in non-decreasing tick order');
      const validActorId = (typeof event.actorId === 'string' && event.actorId.trim()) ||
        (typeof event.actorId === 'number' && Number.isSafeInteger(event.actorId));
      if (!validActorId) throw new TypeError('Trace event requires a string or safe-integer actorId');
      if (typeof event.type !== 'string' || !event.type.trim()) throw new TypeError('Trace event requires type');
      if (sequence >= maxEvents) throw new RangeError('Trace event limit reached: ' + maxEvents);

      const nextSequence = sequence + 1;
      const record = { ...event, _type: 'event', sequence: nextSequence };
      const line = JSON.stringify(record);
      if (typeof line !== 'string') throw new TypeError('Trace event is not JSON serializable');
      emit(line);
      sequence = nextSequence;
      lastTick = event.tick;
      return sequence;
    },
  });
}
