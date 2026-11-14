/**
 * Optional, renderer-neutral JSONL event recorder for reverse/replica QA.
 * It does not own a clock, scheduler, RAF, timer, storage or network service.
 * Record committed game events only; predicted/rolled-back events need a
 * project-specific revision key before they can be compared safely.
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
