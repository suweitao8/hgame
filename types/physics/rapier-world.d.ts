/**
 * Build a small, renderer-neutral adapter around one pinned Rapier WASM World.
 * @param {RapierModule} RAPIER Pinned Rapier 0.21.0 module namespace.
 * @param {2 | 3} dimension World dimension.
 * @returns {RapierPhysicsWorldConstructor} World class bound to `RAPIER`.
 */
export function createRapierPhysicsWorldClass(RAPIER: RapierModule, dimension: 2 | 3): RapierPhysicsWorldConstructor;
/**
 * Rapier WASM module namespace (`@dimforge/rapier2d-deterministic` or `rapier3d-deterministic`), pinned to 0.21.0.
 * Members used: `version()`, `World`, `EventQueue`, `Ray`, `RigidBodyDesc`, `ColliderDesc`, `ActiveEvents`.
 */
export type RapierModule = {
    [member: string]: unknown;
};
/**
 * Native Rapier object (RigidBody, Collider, KinematicCharacterController, World). Opaque to HGame callers.
 */
export type RapierNativeObject = {
    [member: string]: unknown;
};
/**
 * 2D vector (world units).
 */
export type RapierVec2 = {
    x: number;
    y: number;
};
/**
 * 3D vector (world units).
 */
export type RapierVec3 = {
    x: number;
    y: number;
    z: number;
};
/**
 * Vector input: 2D worlds read `x`/`y`, 3D worlds read `x`/`y`/`z`. Missing components default to 0.
 */
export type RapierVectorInput = {
    x?: number;
    y?: number;
    z?: number;
};
/**
 * Quaternion (unit length after normalization).
 */
export type RapierQuaternion = {
    x: number;
    y: number;
    z: number;
    w: number;
};
/**
 * Rotation input. 2D: angle in radians or `{z}`. 3D: quaternion `{x,y,z,w}` or Euler `{x,y,z}` in radians (XYZ order).
 */
export type RapierRotationInput = number | {
    x?: number;
    y?: number;
    z?: number;
    w?: number;
};
/**
 * Minimal structural HGame Entity contract required by the physics world.
 */
export type RapierEntityLike = {
    /**
     * World X (written back after each step).
     */
    x: number;
    /**
     * World Y.
     */
    y: number;
    /**
     * World Z (3D only).
     */
    z?: number | undefined;
    /**
     * Euler X in radians.
     */
    rotationX?: number | undefined;
    /**
     * Euler Y in radians.
     */
    rotationY?: number | undefined;
    /**
     * Euler Z in radians (2D angle).
     */
    rotationZ?: number | undefined;
    /**
     * Default collider width in world units.
     */
    width?: number | undefined;
    /**
     * Default collider height in world units.
     */
    height?: number | undefined;
    /**
     * Default collider depth in world units.
     */
    depth?: number | undefined;
    /**
     * True once the entity is destroyed.
     */
    destroyed?: boolean | undefined;
    /**
     * Parent entity; bodies must be on root entities.
     */
    parent?: object | null;
    /**
     * World position.
     */
    worldPosition: () => RapierVec3;
    /**
     * Resets render interpolation.
     */
    snapTransform?: (() => void) | undefined;
};
/**
 * Options for {@link RapierPhysicsWorld} construction.
 */
export type RapierPhysicsWorldOptions = {
    /**
     * Fixed simulation rate (integer 1..240) in hertz.
     */
    tickHz?: number | undefined;
    /**
     * Gravity in world units per second squared. Defaults: 2D `{x:0,y:0}`, 3D `{x:0,y:-9.81,z:0}`.
     */
    gravity?: RapierVectorInput | undefined;
};
/**
 * Options for {@link RapierPhysicsWorld.add}.
 */
export type RapierBodyOptions = {
    /**
     * Body type (default `'fixed'` if `static`, else `'dynamic'`).
     */
    type?: "fixed" | "dynamic" | "kinematicPosition" | "kinematicVelocity" | undefined;
    /**
     * Shortcut for `type: 'fixed'`.
     */
    static?: boolean | undefined;
    /**
     * Initial 2D angle in radians (default entity `rotationZ`).
     */
    rotation?: number | undefined;
    /**
     * Initial 3D rotation (default from entity Euler).
     */
    quaternion?: {
        x: number;
        y: number;
        z: number;
        w: number;
    } | undefined;
    /**
     * Allow the body to sleep.
     */
    canSleep?: boolean | undefined;
    /**
     * Lock all rotations.
     */
    lockRotations?: boolean | undefined;
    /**
     * 3D only: `[x, y, z]` rotation axes enabled.
     */
    enabledRotations?: boolean[] | undefined;
    /**
     * Linear damping (>= 0).
     */
    linearDamping?: number | undefined;
    /**
     * Angular damping (>= 0).
     */
    angularDamping?: number | undefined;
    /**
     * Gravity multiplier.
     */
    gravityScale?: number | undefined;
    /**
     * Enable continuous collision detection.
     */
    ccd?: boolean | undefined;
    /**
     * Write body rotation back to the entity.
     */
    syncRotation?: boolean | undefined;
    /**
     * Collider shape.
     */
    shape?: "ball" | "capsule" | "cuboid" | undefined;
    /**
     * Collider width in world units (default entity width or 1).
     */
    width?: number | undefined;
    /**
     * Collider height in world units (default entity height or 1).
     */
    height?: number | undefined;
    /**
     * Collider depth in world units, 3D (default entity depth or 1).
     */
    depth?: number | undefined;
    /**
     * Ball/capsule radius in world units.
     */
    radius?: number | undefined;
    /**
     * Capsule half height of the cylindrical part in world units.
     */
    halfHeight?: number | undefined;
    /**
     * Collider offset from the body in world units.
     */
    offset?: RapierVectorInput | undefined;
    /**
     * Collider offset X (when `offset` is absent).
     */
    offsetX?: number | undefined;
    /**
     * Collider offset Y.
     */
    offsetY?: number | undefined;
    /**
     * Collider offset Z.
     */
    offsetZ?: number | undefined;
    /**
     * Sensor (trigger) collider.
     */
    sensor?: boolean | undefined;
    /**
     * Friction coefficient (>= 0).
     */
    friction?: number | undefined;
    /**
     * Restitution 0..1.
     */
    restitution?: number | undefined;
    /**
     * Collider density (>= 0).
     */
    density?: number | undefined;
    /**
     * Packed Rapier collision groups (32-bit).
     */
    collisionGroups?: number | undefined;
    /**
     * Membership bitmask (16-bit), used when `collisionGroups` is absent.
     */
    layer?: number | undefined;
    /**
     * Filter bitmask (16-bit), used when `collisionGroups` is absent.
     */
    mask?: number | undefined;
};
/**
 * Registry record for one physics body, returned by `add`/`get`.
 */
export type RapierBodyRecord = {
    /**
     * Stable body id.
     */
    id: number;
    /**
     * Owning entity.
     */
    entity: RapierEntityLike;
    /**
     * Body type.
     */
    type: string;
    /**
     * Native Rapier rigid body.
     */
    rigidBody: RapierNativeObject;
    /**
     * Native Rapier collider.
     */
    collider: RapierNativeObject;
    /**
     * Native rigid-body handle.
     */
    bodyHandle: number;
    /**
     * Native collider handle.
     */
    colliderHandle: number;
    /**
     * Whether rotation is written back to the entity.
     */
    syncRotation: boolean;
    /**
     * All rotations locked.
     */
    lockRotations: boolean;
    /**
     * 3D enabled rotation axes, or null.
     */
    enabledRotations: boolean[] | null;
    /**
     * Sets linear velocity (units per second).
     */
    setVelocity: (velocity: RapierVectorInput) => void;
    /**
     * Reads linear velocity.
     */
    getVelocity: () => RapierVec3 | RapierVec2;
    /**
     * Sets angular velocity (radians per second; number in 2D, vector in 3D).
     */
    setAngularVelocity: (omega: number | RapierVectorInput) => void;
    /**
     * Reads angular velocity.
     */
    getAngularVelocity: () => number | RapierVec3;
    /**
     * Applies a linear impulse.
     */
    applyImpulse: (impulse: RapierVectorInput, wakeUp?: boolean) => void;
};
/**
 * Options for {@link RapierPhysicsWorld.createCharacterController}.
 */
export type RapierCharacterControllerOptions = {
    /**
     * Skin offset in world units (>= 0.0001).
     */
    offset?: number | undefined;
    /**
     * Up vector.
     */
    up?: RapierVectorInput | undefined;
    /**
     * Slide along obstacles.
     */
    slide?: boolean | undefined;
    /**
     * Maximum climbable slope in radians.
     */
    maxSlopeClimbAngle?: number | undefined;
    /**
     * Minimum slope angle (radians) at which the character slides.
     */
    minSlopeSlideAngle?: number | undefined;
    /**
     * Autostep config (heights/widths in world units).
     */
    autostep?: {
        maxHeight?: number;
        minWidth?: number;
        includeDynamic?: boolean;
    } | null | undefined;
    /**
     * Snap distance in world units, or falsy to disable.
     */
    snapToGround?: number | false | null | undefined;
    /**
     * Push dynamic bodies.
     */
    applyImpulsesToDynamicBodies?: boolean | undefined;
    /**
     * Character mass used for impulses.
     */
    characterMass?: number | undefined;
};
/**
 * Options for {@link RapierCharacterController.move}.
 */
export type RapierCharacterMoveOptions = {
    /**
     * Rapier QueryFilterFlags bitmask.
     */
    filterFlags?: number | undefined;
    /**
     * Packed collision groups filter.
     */
    filterGroups?: number | undefined;
    /**
     * Collider filter.
     */
    filterPredicate?: ((collider: RapierNativeObject) => boolean) | undefined;
    /**
     * Apply the move immediately instead of as the next kinematic translation.
     */
    immediate?: boolean | undefined;
};
/**
 * One collision encountered while moving a character.
 */
export type RapierCharacterCollision = {
    /**
     * Native collider hit.
     */
    collider: RapierNativeObject | null;
    /**
     * Matching body record.
     */
    body: RapierBodyRecord | null;
    /**
     * Contact normal.
     */
    normal: RapierVec2 | RapierVec3 | null;
    /**
     * Time of impact.
     */
    toi: number;
};
/**
 * Result of {@link RapierCharacterController.move}.
 */
export type RapierCharacterMoveResult = {
    /**
     * Corrected translation in world units.
     */
    movement: RapierVec2 | RapierVec3;
    /**
     * True when standing on ground.
     */
    grounded: boolean;
    /**
     * Collisions encountered.
     */
    collisions: RapierCharacterCollision[];
};
/**
 * Handle returned by `createCharacterController`.
 */
export type RapierCharacterController = {
    /**
     * Controlled entity (getter).
     */
    entity: RapierEntityLike;
    /**
     * Controlled body record (getter).
     */
    body: RapierBodyRecord;
    /**
     * Native controller (getter).
     */
    controller: RapierNativeObject | null;
    /**
     * Grounded state after the last move (getter).
     */
    grounded: boolean;
    /**
     * Moves the character, colliding with the world.
     */
    move: (desiredTranslation: RapierVectorInput, options?: RapierCharacterMoveOptions) => RapierCharacterMoveResult;
    /**
     * Internal: detaches the native controller.
     */
    _detachNative: (oldWorld: RapierNativeObject) => void;
    /**
     * Internal: rebinds after snapshot restore.
     */
    _rebind: (newWorld: RapierNativeObject, newRecord: RapierBodyRecord) => void;
    /**
     * Disposes the controller; false when already disposed.
     */
    dispose: () => boolean;
};
/**
 * Raycast options.
 */
export type RapierRayOptions = {
    /**
     * Treat shapes as solid (hit at origin when inside).
     */
    solid?: boolean | undefined;
    /**
     * Collider filter.
     */
    filterPredicate?: ((collider: RapierNativeObject) => boolean) | undefined;
};
/**
 * Raycast hit.
 */
export type RapierRayHit = {
    /**
     * Distance along the normalized direction in world units.
     */
    timeOfImpact: number;
    /**
     * Hit point.
     */
    point: RapierVec2 | RapierVec3;
    /**
     * Surface normal.
     */
    normal: RapierVec2 | RapierVec3;
    /**
     * Native collider hit.
     */
    collider: RapierNativeObject;
    /**
     * Matching body record.
     */
    body: RapierBodyRecord | null;
};
/**
 * Collision event emitted as `'enter'` / `'exit'`.
 */
export type RapierCollisionEvent = {
    /**
     * First body.
     */
    a: RapierBodyRecord;
    /**
     * Second body.
     */
    b: RapierBodyRecord;
    /**
     * True when either collider is a sensor.
     */
    sensor: boolean;
    /**
     * Tick the event belongs to.
     */
    tick: number;
};
/**
 * Serializable per-body snapshot record.
 */
export type RapierSnapshotRecord = {
    /**
     * Entity.
     */
    entity: RapierEntityLike;
    /**
     * Body type.
     */
    type: string;
    /**
     * Body id.
     */
    id: number;
    /**
     * Native body handle.
     */
    bodyHandle: number;
    /**
     * Native collider handle.
     */
    colliderHandle: number;
    /**
     * Rotation write-back flag.
     */
    syncRotation: boolean;
    /**
     * Rotations locked.
     */
    lockRotations: boolean;
    /**
     * Enabled rotation axes (3D).
     */
    enabledRotations: boolean[] | null;
};
/**
 * World snapshot produced by `takeSnapshot`.
 */
export type RapierSnapshot = {
    /**
     * Rapier engine version.
     */
    version: string;
    /**
     * Simulation tick.
     */
    tick: number;
    /**
     * Native world snapshot bytes.
     */
    bytes: Uint8Array;
    /**
     * Body registry.
     */
    records: RapierSnapshotRecord[];
    /**
     * Next body id.
     */
    nextId: number;
};
/**
 * Deterministic fixed-step Rapier world adapter.
 */
export type RapierPhysicsWorld = {
    /**
     * World dimension.
     */
    dimension: 2 | 3;
    /**
     * Fixed rate in hertz.
     */
    tickHz: number;
    /**
     * Fixed step in seconds.
     */
    fixedDt: number;
    /**
     * Backend package name.
     */
    backend: string;
    /**
     * Rapier version.
     */
    engineVersion: string;
    /**
     * Current gravity.
     */
    gravity: RapierVec2 | RapierVec3;
    /**
     * Native Rapier world.
     */
    world: RapierNativeObject;
    /**
     * Live body records.
     */
    bodies: RapierBodyRecord[];
    /**
     * Current tick (getter).
     */
    tick: number;
    /**
     * Recent state checksums, one per 30 ticks (getter).
     */
    checksums: {
        tick: number;
        checksum: string;
    }[];
    /**
     * Subscribes to collision events; returns an unsubscribe function.
     */
    on: (type: "enter" | "exit", listener: (event: RapierCollisionEvent) => void) => (() => void);
    /**
     * Sets gravity.
     */
    setGravity: (gravity: RapierVectorInput) => RapierVec2 | RapierVec3;
    /**
     * Adds a body + collider for a root entity.
     */
    add: (entity: RapierEntityLike, options?: RapierBodyOptions) => RapierBodyRecord;
    /**
     * Looks up a body record.
     */
    get: (target: RapierEntityLike | RapierBodyRecord) => RapierBodyRecord | null;
    /**
     * Removes a body; false when unknown.
     */
    remove: (target: RapierEntityLike | RapierBodyRecord) => boolean;
    /**
     * Teleports (or schedules for kinematic) a body.
     */
    setPosition: (target: RapierEntityLike | RapierBodyRecord, position: RapierVectorInput) => void;
    /**
     * Sets body rotation.
     */
    setRotation: (target: RapierEntityLike | RapierBodyRecord, rotation: RapierRotationInput) => void;
    /**
     * Sets linear velocity.
     */
    setVelocity: (target: RapierEntityLike | RapierBodyRecord, velocity: RapierVectorInput) => void;
    /**
     * Reads linear velocity.
     */
    getVelocity: (target: RapierEntityLike | RapierBodyRecord) => RapierVec2 | RapierVec3 | null;
    /**
     * Sets angular velocity.
     */
    setAngularVelocity: (target: RapierEntityLike | RapierBodyRecord, omega: number | RapierVectorInput) => void;
    /**
     * Reads angular velocity.
     */
    getAngularVelocity: (target: RapierEntityLike | RapierBodyRecord) => number | RapierVec3 | null;
    /**
     * Creates a kinematic character controller.
     */
    createCharacterController: (target: RapierEntityLike | RapierBodyRecord, options?: RapierCharacterControllerOptions) => RapierCharacterController;
    /**
     * True when the two bodies intersect or touch.
     */
    overlaps: (a: RapierEntityLike | RapierBodyRecord, b: RapierEntityLike | RapierBodyRecord) => boolean;
    /**
     * Casts a ray (maxDistance in world units, default 1000).
     */
    castRay: (origin: RapierVectorInput, direction: RapierVectorInput, maxDistance?: number, options?: RapierRayOptions) => RapierRayHit | null;
    /**
     * Advances exactly one fixed step (dt seconds must equal `fixedDt`); returns the new tick.
     */
    step: (dt?: number) => number;
    /**
     * Captures a restorable snapshot.
     */
    takeSnapshot: () => RapierSnapshot;
    /**
     * Restores a snapshot; returns the world.
     */
    restoreSnapshot: (snapshot: RapierSnapshot) => RapierPhysicsWorld;
    /**
     * FNV-1a checksum (hex) of the world state.
     */
    stateChecksum: () => string;
    /**
     * Frees native resources; false when already disposed.
     */
    dispose: () => boolean;
};
/**
 * Constructor of a {@link RapierPhysicsWorld}.
 */
export type RapierPhysicsWorldConstructor = new (options?: RapierPhysicsWorldOptions) => RapierPhysicsWorld;
