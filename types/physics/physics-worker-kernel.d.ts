/**
 * Create a message-driven deterministic physics kernel bound to a Rapier world constructor.
 * @param {import('./rapier-world.js').RapierPhysicsWorldConstructor} WorldClass
 * @param {{ tickHz?: number, gravity?: { x?: number, y?: number, z?: number } }} [options]
 * @returns {{ handle: (msg: object) => object, world: object }}
 */
export function createPhysicsKernel(WorldClass: import("./rapier-world.js").RapierPhysicsWorldConstructor, { tickHz, gravity }?: {
    tickHz?: number;
    gravity?: {
        x?: number;
        y?: number;
        z?: number;
    };
} | undefined): {
    handle: (msg: object) => object;
    world: object;
};
