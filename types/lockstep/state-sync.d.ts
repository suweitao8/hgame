/**
 * Create a network state synchronization controller for delta compression,
 * client prediction + server reconciliation, snapshot interpolation, and lag-compensation rewind.
 * @param {object} [options]
 * @param {number} [options.quantizePos=100] Position/scalar quantization precision (100 = 0.01 units).
 * @param {number} [options.quantizeRot=1000] Rotation quantization precision.
 * @param {number} [options.maxHistoryFrames=128] Maximum retained history snapshots for prediction & rewind.
 * @param {number} [options.interpolationDelayMs=100] Jitter buffer delay for `sampleInterpolated()`.
 */
export function createNetworkStateSync({ quantizePos, quantizeRot, maxHistoryFrames, interpolationDelayMs, }?: {
    quantizePos?: number | undefined;
    quantizeRot?: number | undefined;
    maxHistoryFrames?: number | undefined;
    interpolationDelayMs?: number | undefined;
} | undefined): Readonly<{
    encodeDelta: (prevSnapshot?: Record<string, Record<string, unknown>>, nextSnapshot?: Record<string, Record<string, unknown>>) => {
        changed: Record<string, {
            mask: number;
            keys: string[];
            values: unknown[];
        }>;
        removed: string[];
        changedCount: number;
    };
    decodeDelta: (baseSnapshot?: Record<string, Record<string, unknown>>, delta?: {
        changed: Record<string, {
            mask: number;
            keys: string[];
            values: unknown[];
        }>;
        removed: string[];
    }) => {};
    pushLocalInput: (tick: any, input: any, predictedState?: null) => number;
    reconcileServerState: (serverTick: number, authoritativeState: Record<string, unknown>, replayFn: (state: Record<string, unknown>, input: unknown, tick: number) => Record<string, unknown>) => {
        state: {};
        replayedInputs: number;
    };
    pushServerSnapshot: (timestampMs: any, state: any) => number;
    sampleInterpolated: (renderTimeMs: any) => {} | null;
    getHistoricalState: (targetTimestampMs: any) => {} | null;
    getStats: () => Readonly<{
        pendingInputs: number;
        bufferedSnapshots: number;
        interpolationDelayMs: number;
    }>;
    clear: () => void;
}>;
