/**
 * Compile a set of passes into a dependency-ordered Render Graph with transient lifetimes and aliasing.
 * @param {readonly {
 *   id: string,
 *   reads?: readonly string[],
 *   optionalReads?: readonly string[],
 *   writes?: readonly string[],
 *   transientSpecs?: Record<string, object>,
 *   enabled?: boolean,
 *   sideEffect?: boolean,
 *   execute?: (ctx: object) => void,
 *   meta?: unknown,
 * }[]} passes
 * @param {{ externalInputs?: Iterable<string>, externalOutputs?: Iterable<string>, pruneDeadPasses?: boolean }} [options]
 */
export function compileRenderGraph(passes: readonly {
    id: string;
    reads?: readonly string[];
    optionalReads?: readonly string[];
    writes?: readonly string[];
    transientSpecs?: Record<string, object>;
    enabled?: boolean;
    sideEffect?: boolean;
    execute?: (ctx: object) => void;
    meta?: unknown;
}[], { externalInputs, externalOutputs, pruneDeadPasses }?: {
    externalInputs?: Iterable<string>;
    externalOutputs?: Iterable<string>;
    pruneDeadPasses?: boolean;
} | undefined): Readonly<{
    passes: any;
    order: any;
    culledPasses: readonly any[];
    edges: readonly any[];
    lifetimes: any;
    resourceToSlot: Readonly<{
        [k: string]: string;
    }>;
    aliases: any;
    peakTargets: number;
    reclaimedAt: Readonly<Record<string, readonly {
        resource: string;
        slot: string;
    }[]>>;
}>;
/**
 * Execute a compiled Render Graph against a transient target pool, allocating on first write
 * and reclaiming physical targets immediately after each resource's lastRead pass.
 * @param {ReturnType<typeof compileRenderGraph>} graph
 * @param {{ acquire: (spec: object | null, resource: string, slot: string) => unknown, release: (target: unknown, resource: string, slot: string) => void }} pool
 * @param {{ externalTargets?: Record<string, unknown>, state?: object }} [context]
 */
export function executeRenderGraph(graph: ReturnType<typeof compileRenderGraph>, pool: {
    acquire: (spec: object | null, resource: string, slot: string) => unknown;
    release: (target: unknown, resource: string, slot: string) => void;
}, { externalTargets, state }?: {
    externalTargets?: Record<string, unknown>;
    state?: object;
} | undefined): Readonly<{
    executed: readonly any[];
    acquiredCount: number;
    reusedCount: number;
    reclaimedCount: number;
    peakTargets: number;
}>;
/**
 * Physical GPU RenderTarget aliasing pool compatible with `executeRenderGraph`, reusing
 * idle `THREE.WebGLRenderTarget` instances across non-overlapping pass lifetimes to match
 * Unity URP's transient memory aliasing.
 * @param {any} [THREE=null]
 * @param {{ maxIdleFrames?: number }} [options]
 */
export function createPhysicalRenderTargetPool3D(THREE?: any, { maxIdleFrames }?: {
    maxIdleFrames?: number;
} | undefined): Readonly<{
    acquire: (spec: any, resource: any) => any;
    release: (target: any) => void;
    beginFrame: () => void;
    getStats: () => Readonly<{
        allocations: number;
        reuses: number;
        savedAllocations: number;
        estimatedSavedBytes: number;
        activeCount: number;
        freeCount: number;
        peakTargets: number;
    }>;
    dispose: () => void;
}>;
