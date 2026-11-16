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
export function createTraceRecorder({ gameId, scenarioId, build, tickHz, emit, maxEvents, }?: TraceRecorderOptions): TraceRecorder;
export type TraceRecorderOptions = {
    /**
     * Non-empty game identifier written to the header.
     */
    gameId: string;
    /**
     * Non-empty scenario/replay identifier written to the header.
     */
    scenarioId: string;
    /**
     * Non-empty build label.
     */
    build?: string | undefined;
    /**
     * Simulation rate in Hz (>= 0; 0 = unspecified).
     */
    tickHz?: number | undefined;
    /**
     * Receives each JSONL line (header first, then one per event).
     */
    emit: (line: string) => void;
    /**
     * Maximum recordable events (integer 1..10,000,000).
     */
    maxEvents?: number | undefined;
};
/**
 * First line emitted by a recorder.
 */
export type TraceHeader = {
    /**
     * Record discriminator.
     */
    _type: "trace";
    /**
     * Trace schema version.
     */
    schemaVersion: 1;
    gameId: string;
    scenarioId: string;
    build: string;
    tickHz: number;
};
/**
 * Event accepted by TraceRecorder#record; extra JSON-serializable fields are preserved.
 */
export type TraceEventInput = {
    /**
     * Non-negative safe integer simulation tick; must be non-decreasing.
     */
    tick: number;
    /**
     * Non-empty string or safe-integer actor identifier.
     */
    actorId: string | number;
    /**
     * Non-empty event type.
     */
    type: string;
};
export type TraceRecorder = {
    /**
     * The emitted header record.
     */
    header: Readonly<TraceHeader>;
    /**
     * Number of events recorded so far (getter).
     */
    sequence: number;
    /**
     * Tick of the last recorded event, or -1 (getter).
     */
    lastTick: number;
    /**
     * Validate and emit an event; returns its 1-based sequence number.
     */
    record: (event: TraceEventInput & Record<string, unknown>) => number;
};
