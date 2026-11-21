/**
 * Create a network state synchronization controller for delta compression (object + binary Uint8Array),
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
    encodeDeltaBinary: (prevSnapshot?: Record<string, Record<string, unknown>>, nextSnapshot?: Record<string, Record<string, unknown>>, { tick, timestampMs, isKeyframe }?: {
        tick?: number;
        timestampMs?: number;
        isKeyframe?: boolean;
    } | undefined) => Uint8Array;
    decodeDeltaBinary: (baseSnapshot: Record<string, Record<string, unknown>> | undefined, bytes: Uint8Array) => {
        tick: number;
        timestampMs: number;
        isKeyframe: boolean;
        state: {};
        removed: string[];
        changedCount: number;
    };
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
/**
 * Bind an HGame Scene & transport channel into automatic binary delta replication,
 * snapshot interpolation for remote entities, and local prediction reconciliation.
 * @param {object} options
 * @param {import('../core/scene.js').Scene} options.scene
 * @param {ReturnType<typeof createNetworkStateSync>} [options.stateSync]
 * @param {{ send: (bytes: Uint8Array) => void, onMessage?: (fn: (bytes: Uint8Array) => void) => (() => void) | void }} options.transport
 * @param {'host' | 'client'} [options.role='client']
 * @param {string[]} [options.fields=['x', 'y', 'z', 'rotationY']]
 * @param {string | null} [options.localEntityId=null]
 * @param {((state: Record<string, unknown>, input: unknown, tick: number) => Record<string, unknown>) | null} [options.replayFn=null]
 * @param {((info: { tick: number, timestampMs: number, state: Record<string, unknown> }) => void) | null} [options.onReconcile=null]
 */
export function createSceneReplicator({ scene, stateSync, transport, role, fields, localEntityId, replayFn, onReconcile, }?: {
    scene: import("../core/scene.js").Scene;
    stateSync?: Readonly<{
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
        encodeDeltaBinary: (prevSnapshot?: Record<string, Record<string, unknown>>, nextSnapshot?: Record<string, Record<string, unknown>>, { tick, timestampMs, isKeyframe }?: {
            tick?: number;
            timestampMs?: number;
            isKeyframe?: boolean;
        } | undefined) => Uint8Array;
        decodeDeltaBinary: (baseSnapshot: Record<string, Record<string, unknown>> | undefined, bytes: Uint8Array) => {
            tick: number;
            timestampMs: number;
            isKeyframe: boolean;
            state: {};
            removed: string[];
            changedCount: number;
        };
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
    }> | undefined;
    transport: {
        send: (bytes: Uint8Array) => void;
        onMessage?: (fn: (bytes: Uint8Array) => void) => (() => void) | void;
    };
    role?: "host" | "client" | undefined;
    fields?: string[] | undefined;
    localEntityId?: string | null | undefined;
    replayFn?: ((state: Record<string, unknown>, input: unknown, tick: number) => Record<string, unknown>) | null | undefined;
    onReconcile?: ((info: {
        tick: number;
        timestampMs: number;
        state: Record<string, unknown>;
    }) => void) | null | undefined;
}): Readonly<{
    role: "host" | "client";
    stateSync: Readonly<{
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
        encodeDeltaBinary: (prevSnapshot?: Record<string, Record<string, unknown>>, nextSnapshot?: Record<string, Record<string, unknown>>, { tick, timestampMs, isKeyframe }?: {
            tick?: number;
            timestampMs?: number;
            isKeyframe?: boolean;
        } | undefined) => Uint8Array;
        decodeDeltaBinary: (baseSnapshot: Record<string, Record<string, unknown>> | undefined, bytes: Uint8Array) => {
            tick: number;
            timestampMs: number;
            isKeyframe: boolean;
            state: {};
            removed: string[];
            changedCount: number;
        };
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
    captureSceneSnapshot: () => Record<string, Record<string, unknown>>;
    sendSnapshot: (tick: any, timestampMs: any, { isKeyframe }?: {
        isKeyframe?: boolean | undefined;
    }) => Uint8Array | null;
    receivePacket: (bytes: any) => {
        tick: number;
        timestampMs: number;
        isKeyframe: boolean;
        state: {};
        removed: string[];
        changedCount: number;
    } | null;
    stepClient: (renderTimeMs: any) => number;
    getStats(): Readonly<{
        pendingInputs: number;
        bufferedSnapshots: number;
        interpolationDelayMs: number;
        role: "host" | "client";
        packetsSent: number;
        packetsReceived: number;
        packetsDroppedOutOfOrder: number;
        lastBytesSent: number;
        totalBytesSent: number;
        totalBytesReceived: number;
        latestReceivedTick: number;
    }>;
    dispose: () => void;
}>;
