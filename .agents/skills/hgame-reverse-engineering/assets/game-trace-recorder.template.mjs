/**
 * Project-local adapter template. It records only explicit game events;
 * it does not add a second frame loop or alter game simulation.
 */
export function createGameTraceRecorder({ emit, gameId, scenarioId, build, tickHz }) {
  if (typeof emit !== 'function') throw new TypeError('emit(line) is required');
  if (!gameId || !scenarioId || !build) throw new Error('gameId, scenarioId and build are required');
  if (!Number.isFinite(tickHz) || tickHz <= 0) throw new Error('tickHz must be positive');
  let sequence = 0;
  let lastTick = -1;
  const write = value => emit(JSON.stringify(value));
  write({ _type: 'trace', schemaVersion: 1, gameId, scenarioId, build, tickHz });
  return {
    record(event) {
      if (!event || !Number.isInteger(event.tick) || event.tick < 0) throw new Error('event.tick must be a non-negative integer');
      if (event.tick < lastTick) throw new Error('Trace events must be emitted in non-decreasing tick order');
      if (!event.actorId || !event.type) throw new Error('event.actorId and event.type are required');
      lastTick = event.tick;
      write({ ...event, _type: 'event', sequence: ++sequence });
      return sequence;
    },
    get sequence() { return sequence; },
  };
}
