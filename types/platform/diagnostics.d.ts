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
export function createDiagnostics({ gameId, windowRef, onReport, sampleFrames, eventCapacity, }?: DiagnosticsOptions | undefined): Diagnostics;
export type ErrorReport = {
    gameId: string;
    message: string;
    /**
     * Truncated to 4000 characters; empty when unavailable.
     */
    stack: string;
    /**
     * Extra data (e.g. `source`, `line`, `column`, `type`, `subsystem`).
     */
    context: Record<string, unknown>;
    /**
     * Epoch milliseconds.
     */
    timestamp: number;
};
export type DiagnosticsOptions = {
    gameId?: string | undefined;
    /**
     * Window that receives `error`/`unhandledrejection` listeners.
     */
    windowRef?: Window | undefined;
    /**
     * Called for every reported error.
     */
    onReport?: ((report: ErrorReport) => void) | undefined;
    /**
     * Rolling frame window used for FPS statistics (min 2).
     */
    sampleFrames?: number | undefined;
    /**
     * Maximum retained gameplay events. Set to zero to disable recording.
     */
    eventCapacity?: number | undefined;
};
export type DiagnosticEvent = {
    /**
     * Nonnegative simulation tick.
     */
    tick: number;
    /**
     * Game-defined event type.
     */
    type: string;
    /**
     * Entity, objective, asset, or other affected object.
     */
    subject: string;
    /**
     * Optional JSON-safe scalar fields.
     */
    details?: Record<string, string | number | boolean | null> | undefined;
};
export type SceneCancellationRecord = {
    scene: string;
    phase: string | null;
    reason: string;
    abortedAt: number;
};
export type DiagnosticsSnapshot = {
    gameId: string;
    /**
     * Frames per second over the sample window.
     */
    fps: number;
    /**
     * Mean frame interval in milliseconds.
     */
    frameTimeMs: number;
    /**
     * 95th-percentile frame interval in milliseconds.
     */
    frameTimeP95Ms: number;
    /**
     * Longest frame interval in milliseconds.
     */
    frameTimeMaxMs: number;
    /**
     * Count of intervals longer than 50 ms.
     */
    longFrames: number;
    /**
     * Frames in the window.
     */
    frameCount: number;
    /**
     * Total reported errors.
     */
    errorCount: number;
    lastError: ErrorReport | null;
    lastPhaseError: ErrorReport | null;
    sceneCancellations: readonly SceneCancellationRecord[];
};
export type Diagnostics = {
    /**
     * Record a `requestAnimationFrame` timestamp (milliseconds). Pass true to start a fresh timing window after an interruption.
     */
    recordFrame: (timestampMs: number, startWindow?: boolean) => void;
    reportError: (error: unknown, context?: Record<string, unknown>) => ErrorReport;
    recordSceneCancellation: (record: {
        scene: string;
        phase?: string | null;
        reason?: unknown;
        abortedAt?: number;
    }) => SceneCancellationRecord | null;
    /**
     * Append a gameplay event. Returns false when disabled or disposed.
     */
    recordEvent: (event: DiagnosticEvent) => boolean;
    /**
     * Read the retained events in their emission order.
     */
    readEvents: () => {
        dropped: number;
        events: Readonly<DiagnosticEvent>[];
    };
    snapshot: () => Readonly<DiagnosticsSnapshot>;
    /**
     * Detach window listeners; false if already disposed.
     */
    dispose: () => boolean;
};
