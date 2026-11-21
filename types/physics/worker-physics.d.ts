/**
 * Create a deterministic physics world facade backed by a module Web Worker (with automatic
 * non-COOP/COEP inline fallback using the identical deterministic physics kernel).
 *
 * @param {{
 *   dimension?: 2 | 3,
 *   tickHz?: number,
 *   gravity?: { x?: number, y?: number, z?: number },
 *   worker?: 'auto' | 'worker' | 'inline' | object,
 *   WorldClass?: import('./rapier-world.js').RapierPhysicsWorldConstructor | null,
 *   workerUrl?: string | URL | null,
 *   WorkerCtor?: typeof Worker | null,
 * }} [options]
 */
export function createWorkerPhysicsWorld({ dimension, tickHz, gravity, worker, WorldClass, workerUrl, WorkerCtor, }?: {
    dimension?: 2 | 3;
    tickHz?: number;
    gravity?: {
        x?: number;
        y?: number;
        z?: number;
    };
    worker?: "auto" | "worker" | "inline" | object;
    WorldClass?: import("./rapier-world.js").RapierPhysicsWorldConstructor | null;
    workerUrl?: string | URL | null;
    WorkerCtor?: typeof Worker | null;
} | undefined): {
    readonly mode: string;
    readonly fallbackReason: any;
    readonly tickHz: number;
    readonly fixedDt: number;
    readonly tick: number;
    readonly dimension: 2 | 3;
    add: (entity: any, options?: {}) => number;
    remove: (entity: any) => boolean;
    setVelocity: (entity: any, velocity: any) => void;
    setPosition: (entity: any, position: any) => void;
    setAngularVelocity: (entity: any, omega: any) => void;
    step: (dt?: number) => number;
    getInterpolated: (entity: any, alpha?: number, out?: {}) => {} | null;
    flush: () => Promise<void>;
    stateChecksum: () => Promise<any>;
    dispose: () => boolean;
};
