/**
 * Coordinates simulation jobs across an optional Web Worker pool and a deterministic
 * main-thread fallback, staging worker outputs and committing results in deterministic
 * `(submitTick, priority, id)` order during `flushTick(tickIndex)`.
 * @param {object} [options]
 * @param {((index: number) => { postMessage: (msg: unknown, transfer?: unknown[]) => void, terminate?: () => void, addEventListener?: (t: string, fn: (e: { data: any }) => void) => void, removeEventListener?: (t: string, fn: (e: { data: any }) => void) => void, onmessage?: ((e: { data: any }) => void) | null, onerror?: ((e: unknown) => void) | null }) | null} [options.workerFactory=null]
 * @param {string | URL | null} [options.workerUrl=null]
 * @param {number} [options.workerCount=1]
 * @param {number} [options.maxJobsPerTick=32]
 * @param {number} [options.maxPending=256]
 * @param {Record<string, (payload: any) => any>} [options.kernels]
 * @param {((entry: { id: number, type: string, submitTick: number, status: 'completed' | 'failed', value: unknown, error: unknown }) => void) | null} [options.onCommit=null]
 */
export function createSimWorkerRunner({ workerFactory, workerUrl, workerCount, maxJobsPerTick, maxPending, kernels, onCommit, }?: {
    workerFactory?: ((index: number) => {
        postMessage: (msg: unknown, transfer?: unknown[]) => void;
        terminate?: () => void;
        addEventListener?: (t: string, fn: (e: {
            data: any;
        }) => void) => void;
        removeEventListener?: (t: string, fn: (e: {
            data: any;
        }) => void) => void;
        onmessage?: ((e: {
            data: any;
        }) => void) | null;
        onerror?: ((e: unknown) => void) | null;
    }) | null | undefined;
    workerUrl?: string | URL | null | undefined;
    workerCount?: number | undefined;
    maxJobsPerTick?: number | undefined;
    maxPending?: number | undefined;
    kernels?: Record<string, (payload: any) => any> | undefined;
    onCommit?: ((entry: {
        id: number;
        type: string;
        submitTick: number;
        status: "completed" | "failed";
        value: unknown;
        error: unknown;
    }) => void) | null | undefined;
} | undefined): {
    readonly mode: "worker" | "main-thread";
    readonly workerCount: number;
    registerKernel: (type: any, fn: any) => void;
    submit: (type: any, payload: any, { tick, signal, priority, transferables }?: {
        tick?: number | undefined;
        signal?: null | undefined;
        priority?: number | undefined;
        transferables?: never[] | undefined;
    }) => {
        id: number;
        readonly state: string;
        readonly value: undefined;
        readonly error: any;
        cancel: () => boolean;
    } | {
        id: number;
        readonly state: "queued";
        readonly value: undefined;
        readonly error: undefined;
        cancel: (reason: any) => boolean;
    } | null;
    flushTick: (tickIndex?: number) => Readonly<{
        id: any;
        type: any;
        submitTick: any;
        status: any;
        value: any;
        error: any;
    }>[];
    cancel: (id: any, reason?: DOMException) => boolean;
    cancelAll: (reason?: DOMException) => void;
    getStats(): Readonly<{
        submitted: number;
        committed: number;
        cancelled: number;
        failed: number;
        rejected: number;
        droppedLate: number;
        mode: "worker" | "main-thread";
        workerCount: number;
        queued: number;
        inFlight: number;
        staged: number;
    }>;
    dispose: () => boolean;
};
