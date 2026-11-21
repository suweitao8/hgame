import { createEmitter } from '../platform/events.js';
import { Entity } from '../core/entity.js';

/**
 * Rapier WASM module namespace (`@dimforge/rapier2d-deterministic` or `rapier3d-deterministic`), pinned to 0.21.0.
 * Members used: `version()`, `World`, `EventQueue`, `Ray`, `RigidBodyDesc`, `ColliderDesc`, `ActiveEvents`.
 * @typedef {{ [member: string]: unknown }} RapierModule
 */

/**
 * Native Rapier object (RigidBody, Collider, KinematicCharacterController, World). Opaque to HGame callers.
 * @typedef {{ [member: string]: unknown }} RapierNativeObject
 */

/**
 * 2D vector (world units).
 * @typedef {{x: number, y: number}} RapierVec2
 */

/**
 * 3D vector (world units).
 * @typedef {{x: number, y: number, z: number}} RapierVec3
 */

/**
 * Vector input: 2D worlds read `x`/`y`, 3D worlds read `x`/`y`/`z`. Missing components default to 0.
 * @typedef {{x?: number, y?: number, z?: number}} RapierVectorInput
 */

/**
 * Quaternion (unit length after normalization).
 * @typedef {{x: number, y: number, z: number, w: number}} RapierQuaternion
 */

/**
 * Rotation input. 2D: angle in radians or `{z}`. 3D: quaternion `{x,y,z,w}` or Euler `{x,y,z}` in radians (XYZ order).
 * @typedef {number | {x?: number, y?: number, z?: number, w?: number}} RapierRotationInput
 */

/**
 * Minimal structural HGame Entity contract required by the physics world.
 * @typedef {object} RapierEntityLike
 * @property {number} x World X (written back after each step).
 * @property {number} y World Y.
 * @property {number} [z] World Z (3D only).
 * @property {number} [rotationX] Euler X in radians.
 * @property {number} [rotationY] Euler Y in radians.
 * @property {number} [rotationZ] Euler Z in radians (2D angle).
 * @property {number} [width] Default collider width in world units.
 * @property {number} [height] Default collider height in world units.
 * @property {number} [depth] Default collider depth in world units.
 * @property {boolean} [destroyed] True once the entity is destroyed.
 * @property {object | null} [parent] Parent entity; bodies must be on root entities.
 * @property {() => RapierVec3} worldPosition World position.
 * @property {() => void} [snapTransform] Resets render interpolation.
 */

/**
 * Options for {@link RapierPhysicsWorld} construction.
 * @typedef {object} RapierPhysicsWorldOptions
 * @property {number} [tickHz=60] Fixed simulation rate (integer 1..240) in hertz.
 * @property {RapierVectorInput} [gravity] Gravity in world units per second squared. Defaults: 2D `{x:0,y:0}`, 3D `{x:0,y:-9.81,z:0}`.
 */

/**
 * Options for {@link RapierPhysicsWorld.add}.
 * @typedef {object} RapierBodyOptions
 * @property {'fixed'|'dynamic'|'kinematicPosition'|'kinematicVelocity'} [type] Body type (default `'fixed'` if `static`, else `'dynamic'`).
 * @property {boolean} [static=false] Shortcut for `type: 'fixed'`.
 * @property {number} [rotation] Initial 2D angle in radians (default entity `rotationZ`).
 * @property {{x: number, y: number, z: number, w: number}} [quaternion] Initial 3D rotation (default from entity Euler).
 * @property {boolean} [canSleep=false] Allow the body to sleep.
 * @property {boolean} [lockRotations=false] Lock all rotations.
 * @property {boolean[]} [enabledRotations] 3D only: `[x, y, z]` rotation axes enabled.
 * @property {number} [linearDamping] Linear damping (>= 0).
 * @property {number} [angularDamping] Angular damping (>= 0).
 * @property {number} [gravityScale=1] Gravity multiplier.
 * @property {boolean} [ccd=false] Enable continuous collision detection.
 * @property {boolean} [syncRotation=true] Write body rotation back to the entity.
 * @property {'ball'|'capsule'|'cuboid'} [shape='cuboid'] Collider shape.
 * @property {number} [width] Collider width in world units (default entity width or 1).
 * @property {number} [height] Collider height in world units (default entity height or 1).
 * @property {number} [depth] Collider depth in world units, 3D (default entity depth or 1).
 * @property {number} [radius] Ball/capsule radius in world units.
 * @property {number} [halfHeight] Capsule half height of the cylindrical part in world units.
 * @property {RapierVectorInput} [offset] Collider offset from the body in world units.
 * @property {number} [offsetX] Collider offset X (when `offset` is absent).
 * @property {number} [offsetY] Collider offset Y.
 * @property {number} [offsetZ] Collider offset Z.
 * @property {boolean} [sensor=false] Sensor (trigger) collider.
 * @property {number} [friction=0.5] Friction coefficient (>= 0).
 * @property {number} [restitution=0] Restitution 0..1.
 * @property {'average'|'min'|'multiply'|'max'} [frictionCombine] Friction combine rule across colliding shapes.
 * @property {'average'|'min'|'multiply'|'max'} [restitutionCombine] Restitution combine rule across colliding shapes.
 * @property {number} [density] Collider density (>= 0).
 * @property {number} [collisionGroups] Packed Rapier collision groups (32-bit).
 * @property {number} [layer=1] Membership bitmask (16-bit), used when `collisionGroups` is absent.
 * @property {number} [layerIndex] Logical collision layer index `0..15` synced with `setLayerCollision` matrix.
 * @property {number} [mask=0xffff] Filter bitmask (16-bit), used when `collisionGroups` is absent.
 */

/**
 * Registry record for one physics body, returned by `add`/`get`.
 * @typedef {object} RapierBodyRecord
 * @property {number} id Stable body id.
 * @property {RapierEntityLike} entity Owning entity.
 * @property {string} type Body type.
 * @property {RapierNativeObject} rigidBody Native Rapier rigid body.
 * @property {RapierNativeObject} collider Native Rapier collider.
 * @property {number} bodyHandle Native rigid-body handle.
 * @property {number} colliderHandle Native collider handle.
 * @property {boolean} syncRotation Whether rotation is written back to the entity.
 * @property {boolean} lockRotations All rotations locked.
 * @property {boolean[] | null} enabledRotations 3D enabled rotation axes, or null.
 * @property {(velocity: RapierVectorInput) => void} setVelocity Sets linear velocity (units per second).
 * @property {() => RapierVec3 | RapierVec2} getVelocity Reads linear velocity.
 * @property {(omega: number | RapierVectorInput) => void} setAngularVelocity Sets angular velocity (radians per second; number in 2D, vector in 3D).
 * @property {() => number | RapierVec3} getAngularVelocity Reads angular velocity.
 * @property {(impulse: RapierVectorInput, wakeUp?: boolean) => void} applyImpulse Applies a linear impulse.
 */

/**
 * Options for {@link RapierPhysicsWorld.createCharacterController}.
 * @typedef {object} RapierCharacterControllerOptions
 * @property {number} [offset=0.01] Skin offset in world units (>= 0.0001).
 * @property {RapierVectorInput} [up] Up vector.
 * @property {boolean} [slide=true] Slide along obstacles.
 * @property {number} [maxSlopeClimbAngle] Maximum climbable slope in radians.
 * @property {number} [minSlopeSlideAngle] Minimum slope angle (radians) at which the character slides.
 * @property {{maxHeight?: number, minWidth?: number, includeDynamic?: boolean} | null} [autostep] Autostep config (heights/widths in world units).
 * @property {number | false | null} [snapToGround] Snap distance in world units, or falsy to disable.
 * @property {boolean} [applyImpulsesToDynamicBodies] Push dynamic bodies.
 * @property {number} [characterMass] Character mass used for impulses.
 */

/**
 * Options for {@link RapierCharacterController.move}.
 * @typedef {object} RapierCharacterMoveOptions
 * @property {number} [filterFlags] Rapier QueryFilterFlags bitmask.
 * @property {number} [filterGroups] Packed collision groups filter.
 * @property {(collider: RapierNativeObject) => boolean} [filterPredicate] Collider filter.
 * @property {boolean} [immediate=false] Apply the move immediately instead of as the next kinematic translation.
 */

/**
 * One collision encountered while moving a character.
 * @typedef {object} RapierCharacterCollision
 * @property {RapierNativeObject | null} collider Native collider hit.
 * @property {RapierBodyRecord | null} body Matching body record.
 * @property {RapierVec2 | RapierVec3 | null} normal Contact normal.
 * @property {number} toi Time of impact.
 */

/**
 * Result of {@link RapierCharacterController.move}.
 * @typedef {object} RapierCharacterMoveResult
 * @property {RapierVec2 | RapierVec3} movement Corrected translation in world units.
 * @property {boolean} grounded True when standing on ground.
 * @property {RapierCharacterCollision[]} collisions Collisions encountered.
 */

/**
 * Handle returned by `createCharacterController`.
 * @typedef {object} RapierCharacterController
 * @property {RapierEntityLike} entity Controlled entity (getter).
 * @property {RapierBodyRecord} body Controlled body record (getter).
 * @property {RapierNativeObject | null} controller Native controller (getter).
 * @property {boolean} grounded Grounded state after the last move (getter).
 * @property {(desiredTranslation: RapierVectorInput, options?: RapierCharacterMoveOptions) => RapierCharacterMoveResult} move Moves the character, colliding with the world.
 * @property {(oldWorld: RapierNativeObject) => void} _detachNative Internal: detaches the native controller.
 * @property {(newWorld: RapierNativeObject, newRecord: RapierBodyRecord) => void} _rebind Internal: rebinds after snapshot restore.
 * @property {() => boolean} dispose Disposes the controller; false when already disposed.
 */

/**
 * Raycast options.
 * @typedef {object} RapierRayOptions
 * @property {boolean} [solid=true] Treat shapes as solid (hit at origin when inside).
 * @property {(collider: RapierNativeObject) => boolean} [filterPredicate] Collider filter.
 */

/**
 * Raycast hit.
 * @typedef {object} RapierRayHit
 * @property {number} timeOfImpact Distance along the normalized direction in world units.
 * @property {RapierVec2 | RapierVec3} point Hit point.
 * @property {RapierVec2 | RapierVec3} normal Surface normal.
 * @property {RapierNativeObject} collider Native collider hit.
 * @property {RapierBodyRecord | null} body Matching body record.
 */

/**
 * Collision event emitted as `'enter'` / `'exit'`.
 * @typedef {object} RapierCollisionEvent
 * @property {RapierBodyRecord} a First body.
 * @property {RapierBodyRecord} b Second body.
 * @property {boolean} sensor True when either collider is a sensor.
 * @property {number} tick Tick the event belongs to.
 */

/**
 * Serializable per-body snapshot record.
 * @typedef {object} RapierSnapshotRecord
 * @property {RapierEntityLike} entity Entity.
 * @property {string} type Body type.
 * @property {number} id Body id.
 * @property {number} bodyHandle Native body handle.
 * @property {number} colliderHandle Native collider handle.
 * @property {boolean} syncRotation Rotation write-back flag.
 * @property {boolean} lockRotations Rotations locked.
 * @property {boolean[] | null} enabledRotations Enabled rotation axes (3D).
 */

/**
 * World snapshot produced by `takeSnapshot`.
 * @typedef {object} RapierSnapshot
 * @property {string} version Rapier engine version.
 * @property {number} tick Simulation tick.
 * @property {Uint8Array} bytes Native world snapshot bytes.
 * @property {RapierSnapshotRecord[]} records Body registry.
 * @property {number} nextId Next body id.
 */

/**
 * Deterministic fixed-step Rapier world adapter.
 * @typedef {object} RapierPhysicsWorld
 * @property {2 | 3} dimension World dimension.
 * @property {number} tickHz Fixed rate in hertz.
 * @property {number} fixedDt Fixed step in seconds.
 * @property {string} backend Backend package name.
 * @property {string} engineVersion Rapier version.
 * @property {RapierVec2 | RapierVec3} gravity Current gravity.
 * @property {RapierNativeObject} world Native Rapier world.
 * @property {RapierBodyRecord[]} bodies Live body records.
 * @property {number} tick Current tick (getter).
 * @property {{tick: number, checksum: string}[]} checksums Recent state checksums, one per 30 ticks (getter).
 * @property {(type: 'enter' | 'exit', listener: (event: RapierCollisionEvent) => void) => (() => void)} on Subscribes to collision events; returns an unsubscribe function.
 * @property {(gravity: RapierVectorInput) => RapierVec2 | RapierVec3} setGravity Sets gravity.
 * @property {(entity: RapierEntityLike, options?: RapierBodyOptions) => RapierBodyRecord} add Adds a body + collider for a root entity.
 * @property {(target: RapierEntityLike | RapierBodyRecord) => RapierBodyRecord | null} get Looks up a body record.
 * @property {(target: RapierEntityLike | RapierBodyRecord) => boolean} remove Removes a body; false when unknown.
 * @property {(target: RapierEntityLike | RapierBodyRecord, position: RapierVectorInput) => void} setPosition Teleports (or schedules for kinematic) a body.
 * @property {(target: RapierEntityLike | RapierBodyRecord, rotation: RapierRotationInput) => void} setRotation Sets body rotation.
 * @property {(target: RapierEntityLike | RapierBodyRecord, velocity: RapierVectorInput) => void} setVelocity Sets linear velocity.
 * @property {(target: RapierEntityLike | RapierBodyRecord) => RapierVec2 | RapierVec3 | null} getVelocity Reads linear velocity.
 * @property {(target: RapierEntityLike | RapierBodyRecord, omega: number | RapierVectorInput) => void} setAngularVelocity Sets angular velocity.
 * @property {(target: RapierEntityLike | RapierBodyRecord) => number | RapierVec3 | null} getAngularVelocity Reads angular velocity.
 * @property {(target: RapierEntityLike | RapierBodyRecord, options?: RapierCharacterControllerOptions) => RapierCharacterController} createCharacterController Creates a kinematic character controller.
 * @property {(a: RapierEntityLike | RapierBodyRecord, b: RapierEntityLike | RapierBodyRecord) => boolean} overlaps True when the two bodies intersect or touch.
 * @property {(origin: RapierVectorInput, direction: RapierVectorInput, maxDistance?: number, options?: RapierRayOptions) => RapierRayHit | null} castRay Casts a ray (maxDistance in world units, default 1000).
 * @property {(options?: RapierShapeCastOptions) => RapierShapeCastHit | null} castShape Sweeps a shape (ball/cuboid/capsule) and returns the first hit.
 * @property {(options?: RapierOverlapOptions) => RapierOverlapHit[]} queryOverlap Queries all bodies overlapping a shape volume.
 * @property {(a: RapierEntityLike | RapierBodyRecord, b: RapierEntityLike | RapierBodyRecord, options?: RapierJointOptions) => RapierJointRecord} addJoint Connects two rigid bodies with an impulse joint.
 * @property {(jointOrHandle: RapierJointRecord | number) => boolean} removeJoint Removes a joint created by `addJoint`.
 * @property {(jointOrHandle: RapierJointRecord | number, motor?: RapierJointMotorOptions) => boolean} setJointMotor Configures motor force/position/velocity on a revolute or prismatic joint.
 * @property {(layerA: number, layerB: number, enabled: boolean) => void} setLayerCollision Enables or disables mutual collisions between layers `0..15`.
 * @property {(layerA: number, layerB: number) => boolean} getLayerCollision Reads layer-pair collision state.
 * @property {(layer: number) => number} getLayerMask Reads 16-bit collision filter bitmask for layer `0..15`.
 * @property {(target: RapierEntityLike | RapierBodyRecord, layerIndex: number) => boolean} setBodyLayer Moves a body to logical layer `0..15` using the layer matrix.
 * @property {(links: RapierRagdollLink[], options?: { active?: boolean }) => RapierRagdollInstance} createRagdoll Builds an articulated ragdoll chain bound to entity/bone transforms.
 * @property {(dt?: number) => number} step Advances exactly one fixed step (dt seconds must equal `fixedDt`); returns the new tick.
 * @property {() => RapierSnapshot} takeSnapshot Captures a restorable snapshot.
 * @property {(snapshot: RapierSnapshot) => RapierPhysicsWorld} restoreSnapshot Restores a snapshot; returns the world.
 * @property {() => string} stateChecksum FNV-1a checksum (hex) of the world state.
 * @property {() => boolean} dispose Frees native resources; false when already disposed.
 */

/**
 * Constructor of a {@link RapierPhysicsWorld}.
 * @typedef {new (options?: RapierPhysicsWorldOptions) => RapierPhysicsWorld} RapierPhysicsWorldConstructor
 */

/**
 * @typedef {object} RapierJointMotorOptions
 * @property {number} [targetPosition] Target angle (revolute) or offset (prismatic).
 * @property {number} [targetVelocity] Target angular or linear speed.
 * @property {number} [stiffness=0] Spring stiffness.
 * @property {number} [damping=1] Motor damping.
 * @property {number} [maxForce] Maximum motor impulse/torque.
 */

/**
 * @typedef {object} RapierJointOptions
 * @property {'fixed'|'revolute'|'prismatic'|'spherical'|'spring'} [type='revolute'] Joint constraint type.
 * @property {RapierVectorInput} [anchor1] Local anchor on body A.
 * @property {RapierVectorInput} [anchor2] Local anchor on body B.
 * @property {RapierRotationInput} [frame1=0] Local frame rotation on body A (fixed joint).
 * @property {RapierRotationInput} [frame2=0] Local frame rotation on body B (fixed joint).
 * @property {RapierVectorInput} [axis] Hinge/slide axis (default Z in 3D, X in 2D).
 * @property {readonly [number, number]} [limits] Angular/linear min/max limits where supported.
 * @property {number} [restLength=1] Spring rest length.
 * @property {number} [stiffness=100] Spring stiffness.
 * @property {number} [damping=5] Spring damping.
 * @property {boolean} [wakeUp=true] Wake connected dynamic bodies.
 * @property {RapierJointMotorOptions} [motor] Initial joint motor configuration.
 */

/**
 * @typedef {object} RapierJointRecord
 * @property {number} id
 * @property {number} handle
 * @property {string} type
 * @property {RapierBodyRecord} bodyA
 * @property {RapierBodyRecord} bodyB
 * @property {RapierNativeObject} joint
 * @property {(min: number, max: number) => boolean} setLimits
 * @property {(motor?: RapierJointMotorOptions) => boolean} setMotor
 * @property {() => boolean} dispose
 */

/**
 * @typedef {object} RapierShapeCastOptions
 * @property {'ball'|'cuboid'|'capsule'} [shape='ball'] Query volume shape.
 * @property {number} [radius=0.5]
 * @property {number} [halfHeight=0.5]
 * @property {number} [width=1]
 * @property {number} [height=1]
 * @property {number} [depth=1]
 * @property {RapierVectorInput} [origin]
 * @property {RapierRotationInput} [rotation=0]
 * @property {RapierVectorInput} [direction]
 * @property {number} [maxToi=100]
 * @property {number} [targetDistance=0]
 * @property {boolean} [stopAtPenetration=true]
 * @property {number} [filterFlags]
 * @property {number} [filterGroups]
 * @property {(collider: RapierNativeObject) => boolean} [filterPredicate]
 */

/**
 * @typedef {object} RapierShapeCastHit
 * @property {number} timeOfImpact
 * @property {RapierVec2 | RapierVec3} point
 * @property {RapierVec2 | RapierVec3} normal
 * @property {RapierNativeObject} collider
 * @property {RapierBodyRecord | null} body
 */

/**
 * @typedef {object} RapierOverlapOptions
 * @property {'ball'|'cuboid'|'capsule'} [shape='ball']
 * @property {number} [radius=0.5]
 * @property {number} [halfHeight=0.5]
 * @property {number} [width=1]
 * @property {number} [height=1]
 * @property {number} [depth=1]
 * @property {RapierVectorInput} [origin]
 * @property {RapierRotationInput} [rotation=0]
 * @property {number} [filterFlags]
 * @property {number} [filterGroups]
 * @property {(collider: RapierNativeObject) => boolean} [filterPredicate]
 */

/**
 * @typedef {object} RapierOverlapHit
 * @property {RapierNativeObject} collider
 * @property {number} colliderHandle
 * @property {RapierBodyRecord | null} body
 * @property {RapierEntityLike | null} entity
 */

/**
 * @typedef {object} RapierRagdollLink
 * @property {RapierEntityLike} entity
 * @property {RapierBodyOptions} [bodyOptions]
 * @property {number} [parentIndex=-1]
 * @property {RapierJointOptions} [joint]
 * @property {string} [boneName]
 */

/**
 * @typedef {object} RapierRagdollInstance
 * @property {RapierBodyRecord[]} bodies
 * @property {RapierJointRecord[]} joints
 * @property {(boneResolver: Map<string, object> | Record<string, object> | ((boneName: string, index: number) => object | null)) => number} syncToBones
 * @property {(enabled: boolean) => void} setActive
 * @property {() => boolean} dispose
 */

const ENGINE_VERSION = '0.21.0';
const CHECKSUM_INTERVAL = 30;

function fnv1a(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

function finite(value, name, fallback) {
  const result = value ?? fallback;
  if (!Number.isFinite(result)) throw new TypeError(`${name} must be finite`);
  return result;
}

function vector(value, dimension, defaults = {}) {
  const source = value ?? defaults;
  return dimension === 2
    ? { x: finite(source.x, 'x', 0), y: finite(source.y, 'y', 0) }
    : { x: finite(source.x, 'x', 0), y: finite(source.y, 'y', 0), z: finite(source.z, 'z', 0) };
}

function eulerToQuaternionXYZ(rx, ry, rz) {
  const c1 = Math.cos(rx * 0.5), s1 = Math.sin(rx * 0.5);
  const c2 = Math.cos(ry * 0.5), s2 = Math.sin(ry * 0.5);
  const c3 = Math.cos(rz * 0.5), s3 = Math.sin(rz * 0.5);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}

function quaternionToEulerXYZ(q) {
  const { x, y, z, w } = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m11 = 1 - (yy + zz), m12 = xy - wz, m13 = xz + wy;
  const m22 = 1 - (xx + zz), m23 = yz - wx;
  const m32 = yz + wx, m33 = 1 - (xx + yy);
  const ry = Math.asin(Math.max(-1, Math.min(1, m13)));
  let rx, rz;
  if (Math.abs(m13) < 0.9999999) {
    rx = Math.atan2(-m23, m33);
    rz = Math.atan2(-m12, m11);
  } else {
    rx = Math.atan2(m32, m22);
    rz = 0;
  }
  return { x: rx, y: ry, z: rz };
}

function normalizeRotationInput(rotation, dimension) {
  if (dimension === 2) {
    if (typeof rotation === 'number') return finite(rotation, 'rotation', 0);
    if (rotation && typeof rotation === 'object' && 'z' in rotation) return finite(rotation.z, 'rotationZ', 0);
    throw new TypeError('2D rotation must be a finite angle in radians or { z }');
  }
  if (!rotation || typeof rotation !== 'object') {
    throw new TypeError('3D rotation must be a quaternion { x, y, z, w } or Euler { x, y, z }');
  }
  if ('w' in rotation) {
    const qx = finite(rotation.x, 'qx', 0), qy = finite(rotation.y, 'qy', 0);
    const qz = finite(rotation.z, 'qz', 0), qw = finite(rotation.w, 'qw', 1);
    const len = Math.hypot(qx, qy, qz, qw);
    if (len <= 1e-12) return { x: 0, y: 0, z: 0, w: 1 };
    return { x: qx / len, y: qy / len, z: qz / len, w: qw / len };
  }
  return eulerToQuaternionXYZ(
    finite(rotation.x, 'rotationX', 0),
    finite(rotation.y, 'rotationY', 0),
    finite(rotation.z, 'rotationZ', 0),
  );
}

function syncEntityFromBody(record, dimension) {
  const position = record.rigidBody.translation();
  record.entity.x = position.x;
  record.entity.y = position.y;
  if (dimension === 3) record.entity.z = position.z;
  if (record.syncRotation === false) return;
  const rotation = record.rigidBody.rotation();
  if (dimension === 2) {
    record.entity.rotationZ = rotation;
  } else {
    const euler = quaternionToEulerXYZ(rotation);
    record.entity.rotationX = euler.x;
    record.entity.rotationY = euler.y;
    record.entity.rotationZ = euler.z;
  }
}

function setDescriptorTranslation(descriptor, position, dimension) {
  if (dimension === 2) descriptor.setTranslation(position.x, position.y);
  else descriptor.setTranslation(position.x, position.y, position.z);
  return descriptor;
}

function createRigidBodyDescriptor(RAPIER, type, position, rotation, dimension, options) {
  const factories = {
    fixed: () => RAPIER.RigidBodyDesc.fixed(),
    dynamic: () => RAPIER.RigidBodyDesc.dynamic(),
    kinematicPosition: () => RAPIER.RigidBodyDesc.kinematicPositionBased(),
    kinematicVelocity: () => RAPIER.RigidBodyDesc.kinematicVelocityBased(),
  };
  const factory = factories[type];
  if (!factory) throw new Error(`Unsupported Rapier rigid-body type: ${type}`);
  const desc = setDescriptorTranslation(factory().setCanSleep(Boolean(options.canSleep ?? false)), position, dimension);
  desc.setRotation(rotation);
  if (options.lockRotations) desc.lockRotations();
  if (dimension === 3 && Array.isArray(options.enabledRotations)) {
    desc.enabledRotations(
      Boolean(options.enabledRotations[0]),
      Boolean(options.enabledRotations[1]),
      Boolean(options.enabledRotations[2]),
    );
  }
  if (options.linearDamping !== undefined) desc.setLinearDamping(Math.max(0, finite(options.linearDamping, 'linearDamping', 0)));
  if (options.angularDamping !== undefined) desc.setAngularDamping(Math.max(0, finite(options.angularDamping, 'angularDamping', 0)));
  return desc;
}

function resolveCombineRule(RAPIER, rule) {
  if (rule == null || !RAPIER.CoefficientCombineRule) return null;
  if (typeof rule === 'number') return rule;
  const key = String(rule).toLowerCase();
  if (key === 'average') return RAPIER.CoefficientCombineRule.Average;
  if (key === 'min') return RAPIER.CoefficientCombineRule.Min;
  if (key === 'multiply') return RAPIER.CoefficientCombineRule.Multiply;
  if (key === 'max') return RAPIER.CoefficientCombineRule.Max;
  throw new TypeError(`Unsupported Rapier combine rule: ${rule}`);
}

function createQueryShape(RAPIER, dimension, options = {}) {
  const shape = options.shape ?? 'ball';
  if (shape === 'ball') {
    const radius = Math.max(0.001, finite(options.radius, 'radius', 0.5));
    return new RAPIER.Ball(radius);
  }
  if (shape === 'capsule') {
    const radius = Math.max(0.001, finite(options.radius, 'radius', 0.35));
    const halfHeight = Math.max(0, finite(options.halfHeight, 'halfHeight', 0.5));
    return new RAPIER.Capsule(halfHeight, radius);
  }
  if (shape === 'cuboid') {
    const hw = Math.max(0.001, finite(options.width, 'width', 1) / 2);
    const hh = Math.max(0.001, finite(options.height, 'height', 1) / 2);
    if (dimension === 2) return new RAPIER.Cuboid(hw, hh);
    const hd = Math.max(0.001, finite(options.depth, 'depth', 1) / 2);
    return new RAPIER.Cuboid(hw, hh, hd);
  }
  throw new Error(`Unsupported Rapier${dimension}D query shape: ${shape}`);
}

function createColliderDescriptor(RAPIER, dimension, entity, options, layerMasks = null) {
  const shape = options.shape ?? 'cuboid';
  const width = Math.max(0.001, finite(options.width, 'width', entity.width || 1));
  const height = Math.max(0.001, finite(options.height, 'height', entity.height || 1));
  const depth = Math.max(0.001, finite(options.depth, 'depth', entity.depth || 1));
  const radius = Math.max(0.001, finite(options.radius, 'radius', Math.min(width, height, dimension === 3 ? depth : width) / 2));
  const halfHeight = Math.max(0, finite(options.halfHeight, 'halfHeight', Math.max(0, height / 2 - radius)));
  let descriptor;

  if (shape === 'ball') descriptor = RAPIER.ColliderDesc.ball(radius);
  else if (shape === 'capsule') descriptor = RAPIER.ColliderDesc.capsule(halfHeight, radius);
  else if (shape === 'cuboid') {
    descriptor = dimension === 2
      ? RAPIER.ColliderDesc.cuboid(width / 2, height / 2)
      : RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2);
  } else {
    throw new Error(`Unsupported Rapier${dimension}D collider shape: ${shape}`);
  }

  const offset = vector(options.offset, dimension, {
    x: options.offsetX ?? 0,
    y: options.offsetY ?? 0,
    z: options.offsetZ ?? 0,
  });
  setDescriptorTranslation(descriptor, offset, dimension);
  descriptor.setSensor(Boolean(options.sensor));
  descriptor.setFriction(Math.max(0, finite(options.friction, 'friction', 0.5)));
  descriptor.setRestitution(Math.max(0, Math.min(1, finite(options.restitution, 'restitution', 0))));
  const frictionRule = resolveCombineRule(RAPIER, options.frictionCombine);
  if (frictionRule !== null) descriptor.setFrictionCombineRule?.(frictionRule);
  const restitutionRule = resolveCombineRule(RAPIER, options.restitutionCombine);
  if (restitutionRule !== null) descriptor.setRestitutionCombineRule?.(restitutionRule);
  descriptor.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  if (options.density !== undefined) descriptor.setDensity(Math.max(0, finite(options.density, 'density', 1)));
  if (options.collisionGroups !== undefined) descriptor.setCollisionGroups(options.collisionGroups >>> 0);
  else if (options.layerIndex !== undefined) {
    const idx = Math.floor(options.layerIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx > 15) {
      throw new RangeError('Rapier layerIndex must be an integer in 0..15');
    }
    const membership = (1 << idx) & 0xffff;
    const filter = (options.mask ?? (layerMasks ? layerMasks[idx] : 0xffff)) & 0xffff;
    descriptor.setCollisionGroups(((membership << 16) | filter) >>> 0);
  } else if (options.layer !== undefined || options.mask !== undefined) {
    const membership = (options.layer ?? 1) & 0xffff;
    const filter = (options.mask ?? 0xffff) & 0xffff;
    descriptor.setCollisionGroups(((membership << 16) | filter) >>> 0);
  }
  return descriptor;
}

/**
 * Build a small, renderer-neutral adapter around one pinned Rapier WASM World.
 * @param {RapierModule} RAPIER Pinned Rapier 0.21.0 module namespace.
 * @param {2 | 3} dimension World dimension.
 * @returns {RapierPhysicsWorldConstructor} World class bound to `RAPIER`.
 */
export function createRapierPhysicsWorldClass(RAPIER, dimension) {
  if (![2, 3].includes(dimension)) throw new RangeError('Rapier dimension must be 2 or 3');
  if (RAPIER.version() !== ENGINE_VERSION) {
    throw new Error(`HGame requires Rapier ${ENGINE_VERSION}; received ${RAPIER.version()}`);
  }

  return class RapierPhysicsWorld {
    constructor({ tickHz = 60, gravity } = {}) {
      if (!Number.isInteger(tickHz) || tickHz < 1 || tickHz > 240) {
        throw new RangeError('Rapier tickHz must be an integer from 1 to 240');
      }
      this.dimension = dimension;
      this.tickHz = tickHz;
      this.fixedDt = 1 / tickHz;
      this.backend = `@dimforge/rapier${dimension}d-deterministic`;
      this.engineVersion = RAPIER.version();
      this.RAPIER = RAPIER;
      this.gravity = vector(gravity, dimension, dimension === 2
        ? { x: 0, y: 0 }
        : { x: 0, y: -9.81, z: 0 });
      this.world = new RAPIER.World(this.gravity);
      this.world.timestep = this.fixedDt;
      this.events = createEmitter();
      this.eventQueue = new RAPIER.EventQueue(true);
      this.bodies = [];
      this._byEntity = new Map();
      this._byColliderHandle = new Map();
      this._characterControllers = new Set();
      this._joints = new Map();
      this._layerMasks = new Uint16Array(16).fill(0xffff);
      this._nextId = 1;
      this._nextJointId = 1;
      this._tick = 0;
      this._checksums = [];
      this._disposed = false;
    }

    _attachBodyMethods(record) {
      const { rigidBody } = record;
      record.setVelocity = velocity => rigidBody.setLinvel(vector(velocity, dimension), true);
      record.getVelocity = () => rigidBody.linvel();
      record.setAngularVelocity = omega => {
        if (dimension === 2) {
          const w = record.lockRotations ? 0 : finite(omega, 'angularVelocity', 0);
          rigidBody.setAngvel(w, true);
          return;
        }
        const v = vector(omega, 3);
        const masked = record.lockRotations
          ? { x: 0, y: 0, z: 0 }
          : (record.enabledRotations
            ? {
                x: record.enabledRotations[0] ? v.x : 0,
                y: record.enabledRotations[1] ? v.y : 0,
                z: record.enabledRotations[2] ? v.z : 0,
              }
            : v);
        rigidBody.setAngvel(masked, true);
      };
      record.getAngularVelocity = () => rigidBody.angvel();
      record.applyImpulse = (impulse, wakeUp = true) => rigidBody.applyImpulse(vector(impulse, dimension), wakeUp);
      return record;
    }

    get tick() { return this._tick; }
    get checksums() { return this._checksums.slice(); }

    on(type, listener) { return this.events.on(type, listener); }

    setGravity(gravity) {
      this._assertAlive();
      this.gravity = vector(gravity, dimension);
      this.world.gravity = this.gravity;
      return this.gravity;
    }

    add(entity, options = {}) {
      this._assertAlive();
      if (!entity || typeof entity.worldPosition !== 'function' || entity.destroyed) {
        throw new TypeError('Rapier physics requires a live HGame Entity');
      }
      if (entity.parent) throw new Error('Rapier physics bodies must be root Entities');
      if (this._byEntity.has(entity)) throw new Error('Entity already has a Rapier body');

      const type = options.type ?? (options.static ? 'fixed' : 'dynamic');
      const position = vector(entity.worldPosition(), dimension);
      const rotation = dimension === 2
        ? finite(options.rotation, 'rotation', entity.rotationZ || 0)
        : (options.quaternion
          ? normalizeRotationInput(options.quaternion, 3)
          : eulerToQuaternionXYZ(entity.rotationX || 0, entity.rotationY || 0, entity.rotationZ || 0));
      const descriptor = createRigidBodyDescriptor(RAPIER, type, position, rotation, dimension, options);
      const rigidBody = this.world.createRigidBody(descriptor);
      if (options.gravityScale !== undefined) rigidBody.setGravityScale(finite(options.gravityScale, 'gravityScale', 1), true);
      if (options.ccd) rigidBody.enableCcd(true);
      const collider = this.world.createCollider(createColliderDescriptor(RAPIER, dimension, entity, options, this._layerMasks), rigidBody);
      const record = this._attachBodyMethods({
        id: this._nextId++, entity, type, rigidBody, collider,
        bodyHandle: rigidBody.handle, colliderHandle: collider.handle,
        layerIndex: options.layerIndex !== undefined ? Math.floor(options.layerIndex) : null,
        syncRotation: options.syncRotation !== false,
        lockRotations: Boolean(options.lockRotations),
        enabledRotations: dimension === 3 && Array.isArray(options.enabledRotations)
          ? options.enabledRotations.map(Boolean)
          : null,
      });
      this.bodies.push(record);
      this._byEntity.set(entity, record);
      this._byColliderHandle.set(collider.handle, record);
      return record;
    }

    /**
     * Build fixed colliders for the solid tiles of a TileMap (2D worlds only). Adjacent solid tiles are
     * greedily merged into the fewest rectangles, so a 100x20 floor becomes one collider instead of 2000.
     * TileMap rows grow downward; by default (`yUp: true`) world y is negated so physics stays y-up:
     * tile (x, y) occupies world x in [originX + x*tw, +tw] and y in [originY - (y+1)*th, originY - y*th].
     * @param {import('../core/scene.js').Scene} scene Scene that will own the generated tile entities.
     * @param {import('../world/tilemap.js').TileMap} map
     * @param {{ originX?: number, originY?: number, yUp?: boolean, merge?: boolean, friction?: number, restitution?: number, name?: string }} [options]
     * @returns {Array<object>} Created physics body records (call `remove(record)` to drop one).
     */
    addTileMap(scene, map, options = {}) {
      this._assertAlive();
      if (dimension !== 2) throw new Error('addTileMap is only available on 2D physics worlds');
      if (!scene || typeof scene.add !== 'function') throw new TypeError('addTileMap requires the owning Scene as the first argument');
      if (!map || typeof map.isSolid !== 'function') throw new TypeError('addTileMap requires a TileMap');
      const { originX = 0, originY = 0, yUp = true, merge = true } = options;
      const w = map.width, h = map.height, tw = map.tileWidth, th = map.tileHeight;
      const used = new Uint8Array(w * h);
      const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && map.solid.has(map.get(x, y));
      const records = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (used[y * w + x] || !solid(x, y)) continue;
          let rw = 1, rh = 1;
          if (merge) {
            while (solid(x + rw, y) && !used[y * w + x + rw]) rw++;
            grow: while (true) {
              for (let i = 0; i < rw; i++) if (!solid(x + i, y + rh) || used[(y + rh) * w + x + i]) break grow;
              rh++;
            }
          }
          for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) used[(y + j) * w + x + i] = 1;
          const cx = originX + (x + rw / 2) * tw;
          const cyDown = (y + rh / 2) * th;
          const entity = scene.add(new Entity({ name: options.name ?? 'tile-collider', x: cx, y: yUp ? originY - cyDown : originY + cyDown,
            width: rw * tw, height: rh * th }));
          const bodyOptions = { type: 'fixed' };
          if (options.friction !== undefined) bodyOptions.friction = options.friction;
          if (options.restitution !== undefined) bodyOptions.restitution = options.restitution;
          records.push(this.add(entity, bodyOptions));
        }
      }
      return records;
    }
    get(target) {
      if (target?.entity && target?.rigidBody) return this.bodies.includes(target) ? target : null;
      return this._byEntity.get(target) ?? null;
    }

    remove(target) {
      this._assertAlive();
      const record = this.get(target);
      if (!record) return false;
      for (const ctrl of [...this._characterControllers]) {
        if (ctrl.body === record) ctrl.dispose();
      }
      for (const jointRec of [...this._joints.values()]) {
        if (jointRec.bodyA === record || jointRec.bodyB === record) {
          this.removeJoint(jointRec);
        }
      }
      this.world.removeRigidBody(record.rigidBody);
      this._byEntity.delete(record.entity);
      this._byColliderHandle.delete(record.colliderHandle);
      this.bodies.splice(this.bodies.indexOf(record), 1);
      return true;
    }

    setPosition(target, position) {
      this._assertAlive();
      const record = this.get(target);
      if (!record) throw new Error('Unknown Rapier body');
      const next = vector(position, dimension);
      if (record.type === 'kinematicPosition') {
        record.rigidBody.setNextKinematicTranslation(next);
      } else {
        record.rigidBody.setTranslation(next, true);
      }
      record.entity.x = next.x;
      record.entity.y = next.y;
      if (dimension === 3) record.entity.z = next.z;
      if (record.type !== 'kinematicPosition') record.entity.snapTransform?.();
    }

    setRotation(target, rotation) {
      this._assertAlive();
      const record = this.get(target);
      if (!record) throw new Error('Unknown Rapier body');
      const next = normalizeRotationInput(rotation, dimension);
      if (record.type === 'kinematicPosition') {
        record.rigidBody.setNextKinematicRotation(next);
      } else {
        record.rigidBody.setRotation(next, true);
      }
      if (dimension === 2) {
        record.entity.rotationZ = next;
      } else {
        const euler = quaternionToEulerXYZ(next);
        record.entity.rotationX = euler.x;
        record.entity.rotationY = euler.y;
        record.entity.rotationZ = euler.z;
      }
      if (record.type !== 'kinematicPosition') record.entity.snapTransform?.();
    }

    setVelocity(target, velocity) {
      const record = this.get(target);
      if (!record) throw new Error('Unknown Rapier body');
      record.setVelocity(velocity);
    }

    getVelocity(target) {
      const record = this.get(target);
      return record?.getVelocity() ?? null;
    }

    setAngularVelocity(target, omega) {
      const record = this.get(target);
      if (!record) throw new Error('Unknown Rapier body');
      record.setAngularVelocity(omega);
    }

    getAngularVelocity(target) {
      const record = this.get(target);
      return record?.getAngularVelocity() ?? null;
    }

    createCharacterController(target, options = {}) {
      this._assertAlive();
      let record = this.get(target);
      if (!record) throw new Error('Unknown Rapier body for character controller');
      const offset = Math.max(0.0001, finite(options.offset, 'offset', 0.01));

      const configure = world => {
        const ctrl = world.createCharacterController(offset);
        if (options.up) ctrl.setUp(vector(options.up, dimension));
        ctrl.setSlideEnabled(options.slide !== false);
        if (options.maxSlopeClimbAngle !== undefined) {
          ctrl.setMaxSlopeClimbAngle(finite(options.maxSlopeClimbAngle, 'maxSlopeClimbAngle', Math.PI / 4));
        }
        if (options.minSlopeSlideAngle !== undefined) {
          ctrl.setMinSlopeSlideAngle(finite(options.minSlopeSlideAngle, 'minSlopeSlideAngle', Math.PI / 4));
        }
        if (options.autostep) {
          ctrl.enableAutostep(
            finite(options.autostep.maxHeight, 'autostep.maxHeight', 0.3),
            finite(options.autostep.minWidth, 'autostep.minWidth', 0.2),
            Boolean(options.autostep.includeDynamic),
          );
        }
        if (options.snapToGround !== undefined && options.snapToGround !== null && options.snapToGround !== false) {
          ctrl.enableSnapToGround(finite(options.snapToGround, 'snapToGround', 0.2));
        }
        if (options.applyImpulsesToDynamicBodies !== undefined) {
          ctrl.setApplyImpulsesToDynamicBodies(Boolean(options.applyImpulsesToDynamicBodies));
        }
        if (options.characterMass !== undefined) {
          ctrl.setCharacterMass(finite(options.characterMass, 'characterMass', 1));
        }
        return ctrl;
      };

      let native = configure(this.world);
      let removed = false;
      let grounded = false;
      const worldRef = this;

      const handle = {
        get entity() { return record.entity; },
        get body() { return record; },
        get controller() { return native; },
        get grounded() { return grounded; },
        move(desiredTranslation, { filterFlags, filterGroups, filterPredicate, immediate = false } = {}) {
          worldRef._assertAlive();
          if (removed) throw new Error('CharacterController has been disposed');
          if (!worldRef.bodies.includes(record) || record.entity.destroyed) {
            throw new Error('CharacterController target body was removed');
          }
          native.computeColliderMovement(
            record.collider,
            vector(desiredTranslation, dimension),
            filterFlags,
            filterGroups,
            filterPredicate,
          );
          const m = native.computedMovement();
          const movement = dimension === 2 ? { x: m.x, y: m.y } : { x: m.x, y: m.y, z: m.z };
          grounded = native.computedGrounded();
          const numCollisions = native.numComputedCollisions();
          const collisions = [];
          for (let i = 0; i < numCollisions; i++) {
            const c = native.computedCollision(i);
            if (!c) continue;
            collisions.push({
              collider: c.collider ?? null,
              body: c.collider ? (worldRef._byColliderHandle.get(c.collider.handle) ?? null) : null,
              normal: c.normal1 ? (dimension === 2 ? { x: c.normal1.x, y: c.normal1.y } : { x: c.normal1.x, y: c.normal1.y, z: c.normal1.z }) : null,
              toi: c.toi ?? 0,
            });
          }
          const cur = record.rigidBody.translation();
          const nextPos = dimension === 2
            ? { x: cur.x + movement.x, y: cur.y + movement.y }
            : { x: cur.x + movement.x, y: cur.y + movement.y, z: cur.z + movement.z };
          if (!immediate && record.type === 'kinematicPosition') {
            record.rigidBody.setNextKinematicTranslation(nextPos);
          } else {
            record.rigidBody.setTranslation(nextPos, true);
            worldRef.world.propagateModifiedBodyPositionsToColliders?.();
          }
          record.entity.x = nextPos.x;
          record.entity.y = nextPos.y;
          if (dimension === 3) record.entity.z = nextPos.z;
          return { movement, grounded, collisions };
        },
        _detachNative(oldWorld) {
          if (!removed && native) {
            oldWorld.removeCharacterController(native);
            native = null;
          }
        },
        _rebind(newWorld, newRecord) {
          if (removed) return;
          record = newRecord;
          native = configure(newWorld);
        },
        dispose() {
          if (removed) return false;
          removed = true;
          if (native && !worldRef._disposed) worldRef.world.removeCharacterController(native);
          native = null;
          worldRef._characterControllers.delete(handle);
          return true;
        },
      };

      this._characterControllers.add(handle);
      return handle;
    }

    overlaps(targetA, targetB) {
      const a = this.get(targetA), b = this.get(targetB);
      if (!a || !b) return false;
      if (this.world.intersectionPair(a.collider, b.collider)) return true;
      let touching = false;
      this.world.contactPair(a.collider, b.collider, () => { touching = true; });
      return touching;
    }

    castRay(origin, direction, maxDistance = 1000, { solid = true, filterPredicate } = {}) {
      this._assertAlive();
      if (!Number.isFinite(maxDistance) || maxDistance < 0) throw new RangeError('maxDistance must be >= 0');
      const start = vector(origin, dimension);
      const rawDirection = vector(direction, dimension);
      const lengthSquared = rawDirection.x ** 2 + rawDirection.y ** 2 + (dimension === 3 ? rawDirection.z ** 2 : 0);
      if (lengthSquared <= 1e-16) return null;
      const length = Math.sqrt(lengthSquared);
      const dir = dimension === 2
        ? { x: rawDirection.x / length, y: rawDirection.y / length }
        : { x: rawDirection.x / length, y: rawDirection.y / length, z: rawDirection.z / length };
      const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(start, dir), maxDistance, solid,
        undefined, undefined, undefined, undefined, filterPredicate);
      if (!hit) return null;
      const point = dimension === 2
        ? { x: start.x + dir.x * hit.timeOfImpact, y: start.y + dir.y * hit.timeOfImpact }
        : { x: start.x + dir.x * hit.timeOfImpact, y: start.y + dir.y * hit.timeOfImpact,
          z: start.z + dir.z * hit.timeOfImpact };
      return {
        timeOfImpact: hit.timeOfImpact, point, normal: hit.normal,
        collider: hit.collider, body: this._byColliderHandle.get(hit.collider.handle) ?? null,
      };
    }

    setLayerCollision(layerA, layerB, enabled) {
      this._assertAlive();
      if (!Number.isInteger(layerA) || layerA < 0 || layerA > 15 ||
          !Number.isInteger(layerB) || layerB < 0 || layerB > 15) {
        throw new RangeError('Collision layers must be integers in 0..15');
      }
      if (enabled) {
        this._layerMasks[layerA] |= (1 << layerB);
        this._layerMasks[layerB] |= (1 << layerA);
      } else {
        this._layerMasks[layerA] &= ~(1 << layerB);
        this._layerMasks[layerB] &= ~(1 << layerA);
      }
      for (const rec of this.bodies) {
        if (rec.layerIndex === layerA || rec.layerIndex === layerB) {
          const membership = (1 << rec.layerIndex) & 0xffff;
          const filter = this._layerMasks[rec.layerIndex] & 0xffff;
          rec.collider.setCollisionGroups(((membership << 16) | filter) >>> 0);
        }
      }
    }

    getLayerCollision(layerA, layerB) {
      if (!Number.isInteger(layerA) || layerA < 0 || layerA > 15 ||
          !Number.isInteger(layerB) || layerB < 0 || layerB > 15) {
        throw new RangeError('Collision layers must be integers in 0..15');
      }
      return Boolean((this._layerMasks[layerA] >> layerB) & 1);
    }

    getLayerMask(layer) {
      if (!Number.isInteger(layer) || layer < 0 || layer > 15) {
        throw new RangeError('Collision layer must be an integer in 0..15');
      }
      return this._layerMasks[layer] & 0xffff;
    }

    setBodyLayer(target, layerIndex) {
      this._assertAlive();
      if (!Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex > 15) {
        throw new RangeError('Collision layer must be an integer in 0..15');
      }
      const record = this.get(target);
      if (!record) return false;
      record.layerIndex = layerIndex;
      const membership = (1 << layerIndex) & 0xffff;
      const filter = this._layerMasks[layerIndex] & 0xffff;
      record.collider.setCollisionGroups(((membership << 16) | filter) >>> 0);
      return true;
    }

    addJoint(targetA, targetB, options = {}) {
      this._assertAlive();
      const bodyA = this.get(targetA);
      const bodyB = this.get(targetB);
      if (!bodyA || !bodyB) throw new Error('Both bodies must exist in this Rapier world');
      const type = options.type ?? 'revolute';
      const anchor1 = vector(options.anchor1, dimension);
      const anchor2 = vector(options.anchor2, dimension);
      let jointData;
      const defaultRot = dimension === 3 ? { x: 0, y: 0, z: 0, w: 1 } : 0;
      if (type === 'fixed') {
        const f1 = normalizeRotationInput(options.frame1 ?? defaultRot, dimension);
        const f2 = normalizeRotationInput(options.frame2 ?? defaultRot, dimension);
        jointData = RAPIER.JointData.fixed(anchor1, f1, anchor2, f2);
      } else if (type === 'revolute') {
        if (dimension === 2) {
          jointData = RAPIER.JointData.revolute(anchor1, anchor2);
        } else {
          const rawAxis = vector(options.axis ?? { x: 0, y: 0, z: 1 }, 3);
          const len = Math.hypot(rawAxis.x, rawAxis.y, rawAxis.z) || 1;
          jointData = RAPIER.JointData.revolute(anchor1, anchor2, {
            x: rawAxis.x / len, y: rawAxis.y / len, z: rawAxis.z / len,
          });
        }
      } else if (type === 'prismatic') {
        const rawAxis = vector(options.axis ?? (dimension === 2 ? { x: 1, y: 0 } : { x: 1, y: 0, z: 0 }), dimension);
        const len = Math.hypot(rawAxis.x, rawAxis.y, dimension === 3 ? rawAxis.z : 0) || 1;
        const axis = dimension === 2
          ? { x: rawAxis.x / len, y: rawAxis.y / len }
          : { x: rawAxis.x / len, y: rawAxis.y / len, z: rawAxis.z / len };
        jointData = RAPIER.JointData.prismatic(anchor1, anchor2, axis);
      } else if (type === 'spherical') {
        jointData = dimension === 3
          ? RAPIER.JointData.spherical(anchor1, anchor2)
          : RAPIER.JointData.revolute(anchor1, anchor2);
      } else if (type === 'spring') {
        const restLength = Math.max(0, finite(options.restLength, 'restLength', 1));
        const stiffness = Math.max(0, finite(options.stiffness, 'stiffness', 100));
        const damping = Math.max(0, finite(options.damping, 'damping', 5));
        jointData = RAPIER.JointData.spring(restLength, stiffness, damping, anchor1, anchor2);
      } else {
        throw new Error(`Unsupported Rapier joint type: ${type}`);
      }

      const joint = this.world.createImpulseJoint(jointData, bodyA.rigidBody, bodyB.rigidBody, options.wakeUp !== false);
      if (Array.isArray(options.limits) && options.limits.length === 2 && typeof joint.setLimits === 'function') {
        joint.setLimits(finite(options.limits[0], 'limits[0]', 0), finite(options.limits[1], 'limits[1]', 0));
      }
      const record = {
        id: this._nextJointId++,
        handle: joint.handle,
        type,
        bodyA,
        bodyB,
        joint,
        setLimits: (min, max) => {
          if (typeof joint.setLimits !== 'function' || this._disposed || !this._joints.has(joint.handle)) return false;
          joint.setLimits(finite(min, 'min', 0), finite(max, 'max', 0));
          return true;
        },
        setMotor: motor => this.setJointMotor(joint.handle, motor),
        dispose: () => this.removeJoint(joint.handle),
      };
      this._joints.set(joint.handle, record);
      if (options.motor) this.setJointMotor(record, options.motor);
      return record;
    }

    removeJoint(jointOrHandle) {
      this._assertAlive();
      const handle = typeof jointOrHandle === 'number' ? jointOrHandle : jointOrHandle?.handle;
      const record = this._joints.get(handle);
      if (!record) return false;
      this._joints.delete(handle);
      this.world.removeImpulseJoint(record.joint, true);
      return true;
    }

    setJointMotor(jointOrHandle, motor = {}) {
      this._assertAlive();
      const handle = typeof jointOrHandle === 'number' ? jointOrHandle : jointOrHandle?.handle;
      const record = this._joints.get(handle);
      if (!record) return false;
      const { joint } = record;
      if (motor.maxForce !== undefined && typeof joint.setMotorMaxForce === 'function') {
        joint.setMotorMaxForce(Math.max(0, finite(motor.maxForce, 'maxForce', 0)));
      }
      const stiffness = finite(motor.stiffness, 'stiffness', 0);
      const damping = finite(motor.damping, 'damping', 1);
      if (motor.targetPosition !== undefined && typeof joint.configureMotorPosition === 'function') {
        joint.configureMotorPosition(finite(motor.targetPosition, 'targetPosition', 0), stiffness, damping);
        return true;
      }
      if (motor.targetVelocity !== undefined && typeof joint.configureMotorVelocity === 'function') {
        joint.configureMotorVelocity(finite(motor.targetVelocity, 'targetVelocity', 0), damping);
        return true;
      }
      if (motor.targetPosition !== undefined && motor.targetVelocity !== undefined && typeof joint.configureMotor === 'function') {
        joint.configureMotor(motor.targetPosition, motor.targetVelocity, stiffness, damping);
        return true;
      }
      return false;
    }

    castShape(options = {}) {
      this._assertAlive();
      const maxToi = finite(options.maxToi, 'maxToi', 100);
      if (maxToi < 0) throw new RangeError('maxToi must be >= 0');
      const pos = vector(options.origin, dimension);
      const rot = normalizeRotationInput(options.rotation ?? (dimension === 3 ? { x: 0, y: 0, z: 0, w: 1 } : 0), dimension);
      const rawDir = vector(options.direction ?? (dimension === 2 ? { x: 1, y: 0 } : { x: 0, y: 0, z: 1 }), dimension);
      const lenSq = rawDir.x ** 2 + rawDir.y ** 2 + (dimension === 3 ? rawDir.z ** 2 : 0);
      if (lenSq <= 1e-16) return null;
      const invLen = 1 / Math.sqrt(lenSq);
      const dir = dimension === 2
        ? { x: rawDir.x * invLen, y: rawDir.y * invLen }
        : { x: rawDir.x * invLen, y: rawDir.y * invLen, z: rawDir.z * invLen };
      const queryShape = createQueryShape(RAPIER, dimension, options);
      const hit = this.world.castShape(
        pos, rot, dir, queryShape,
        finite(options.targetDistance, 'targetDistance', 0),
        maxToi,
        options.stopAtPenetration !== false,
        options.filterFlags,
        options.filterGroups,
        undefined,
        undefined,
        options.filterPredicate,
      );
      if (!hit) return null;
      const toi = hit.timeOfImpact ?? hit.time_of_impact ?? hit.toi ?? 0;
      const point = hit.witness1
        ? { x: hit.witness1.x, y: hit.witness1.y, ...(dimension === 3 ? { z: hit.witness1.z } : {}) }
        : (dimension === 2
          ? { x: pos.x + dir.x * toi, y: pos.y + dir.y * toi }
          : { x: pos.x + dir.x * toi, y: pos.y + dir.y * toi, z: pos.z + dir.z * toi });
      const normal = hit.normal1
        ? { x: hit.normal1.x, y: hit.normal1.y, ...(dimension === 3 ? { z: hit.normal1.z } : {}) }
        : null;
      return {
        timeOfImpact: toi,
        point,
        normal,
        collider: hit.collider,
        body: this._byColliderHandle.get(hit.collider.handle) ?? null,
      };
    }

    queryOverlap(options = {}) {
      this._assertAlive();
      const pos = vector(options.origin, dimension);
      const rot = normalizeRotationInput(options.rotation ?? (dimension === 3 ? { x: 0, y: 0, z: 0, w: 1 } : 0), dimension);
      const queryShape = createQueryShape(RAPIER, dimension, options);
      const hits = [];
      this.world.intersectionsWithShape(
        pos, rot, queryShape,
        collider => {
          const body = this._byColliderHandle.get(collider.handle) ?? null;
          hits.push({
            collider,
            colliderHandle: collider.handle,
            body,
            entity: body?.entity ?? null,
          });
          return true;
        },
        options.filterFlags,
        options.filterGroups,
        undefined,
        undefined,
        options.filterPredicate,
      );
      return hits;
    }

    createRagdoll(links, { active = true } = {}) {
      this._assertAlive();
      if (!Array.isArray(links) || links.length === 0) {
        throw new TypeError('createRagdoll requires a non-empty array of link definitions');
      }
      const createdBodies = [];
      const createdJoints = [];
      let isActive = Boolean(active);
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const body = this.get(link.entity) ?? this.add(link.entity, {
          type: isActive ? 'dynamic' : 'kinematicPosition',
          ...(link.bodyOptions || {}),
        });
        createdBodies.push({ body, boneName: link.boneName ?? link.entity.name ?? null, link });
      }
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const pIdx = link.parentIndex ?? -1;
        if (pIdx >= 0 && pIdx < createdBodies.length && pIdx !== i) {
          const jSpec = link.joint ?? { type: dimension === 3 ? 'spherical' : 'revolute' };
          createdJoints.push(this.addJoint(createdBodies[pIdx].body, createdBodies[i].body, jSpec));
        }
      }
      return {
        bodies: createdBodies.map(entry => entry.body),
        joints: createdJoints,
        syncToBones: boneResolver => {
          let updated = 0;
          for (let i = 0; i < createdBodies.length; i++) {
            const { body, boneName } = createdBodies[i];
            const bone = typeof boneResolver === 'function'
              ? boneResolver(boneName, i)
              : (boneResolver instanceof Map ? boneResolver.get(boneName) : boneResolver?.[boneName]);
            if (!bone) continue;
            const pos = body.rigidBody.translation();
            const rot = body.rigidBody.rotation();
            if (bone.position?.set) bone.position.set(pos.x, pos.y, dimension === 3 ? pos.z : 0);
            if (dimension === 3 && bone.quaternion?.set) {
              bone.quaternion.set(rot.x, rot.y, rot.z, rot.w);
            } else if (dimension === 2 && bone.rotation) {
              bone.rotation.z = rot;
            }
            updated++;
          }
          return updated;
        },
        setActive: enabled => {
          isActive = Boolean(enabled);
          const dynamicType = RAPIER.RigidBodyType?.Dynamic;
          const kinematicType = RAPIER.RigidBodyType?.KinematicPositionBased;
          if (dynamicType === undefined || kinematicType === undefined) return;
          for (const { body } of createdBodies) {
            body.rigidBody.setBodyType?.(isActive ? dynamicType : kinematicType, true);
          }
        },
        dispose: () => {
          if (this._disposed) return false;
          for (const j of createdJoints) this.removeJoint(j);
          for (const { body } of createdBodies) this.remove(body);
          return true;
        },
      };
    }

    step(dt = this.fixedDt) {
      this._assertAlive();
      if (!Number.isFinite(dt) || Math.abs(dt - this.fixedDt) > 1e-9) {
        throw new RangeError(`HGame Rapier requires fixed ${this.tickHz}Hz steps (${this.fixedDt}s)`);
      }
      for (const record of this.bodies) {
        if (record.type !== 'kinematicPosition' || record.entity.destroyed) continue;
        record.rigidBody.setNextKinematicTranslation(vector(record.entity.worldPosition(), dimension));
        const rot = dimension === 2
          ? (record.entity.rotationZ || 0)
          : eulerToQuaternionXYZ(record.entity.rotationX || 0, record.entity.rotationY || 0, record.entity.rotationZ || 0);
        record.rigidBody.setNextKinematicRotation(rot);
      }
      this.world.step(this.eventQueue);
      for (const record of this.bodies) {
        if (record.type === 'fixed' || record.entity.destroyed) continue;
        syncEntityFromBody(record, dimension);
      }
      this.eventQueue.drainCollisionEvents((handleA, handleB, started) => {
        const a = this._byColliderHandle.get(handleA);
        const b = this._byColliderHandle.get(handleB);
        if (!a || !b) return;
        this.events.emit(started ? 'enter' : 'exit', {
          a, b, sensor: a.collider.isSensor() || b.collider.isSensor(), tick: this._tick + 1,
        });
      });
      this._tick++;
      if (this._tick % CHECKSUM_INTERVAL === 0) {
        this._checksums.push({ tick: this._tick, checksum: this.stateChecksum() });
        if (this._checksums.length > 120) this._checksums.shift();
      }
      return this._tick;
    }

    takeSnapshot() {
      this._assertAlive();
      return {
        version: this.engineVersion,
        tick: this._tick,
        bytes: this.world.takeSnapshot(),
        records: this.bodies.map(record => ({
          entity: record.entity, type: record.type, id: record.id,
          bodyHandle: record.bodyHandle, colliderHandle: record.colliderHandle,
          syncRotation: record.syncRotation,
          lockRotations: Boolean(record.lockRotations),
          enabledRotations: record.enabledRotations ? [...record.enabledRotations] : null,
        })),
        nextId: this._nextId,
      };
    }

    restoreSnapshot(snapshot) {
      this._assertAlive();
      if (!snapshot || snapshot.version !== this.engineVersion || !(snapshot.bytes instanceof Uint8Array)) {
        throw new Error('Invalid or incompatible HGame Rapier snapshot');
      }
      if (!Array.isArray(snapshot.records)) throw new Error('HGame Rapier snapshot has no body registry');
      const restored = RAPIER.World.restoreSnapshot(snapshot.bytes);
      const records = snapshot.records.map(saved => {
        const rigidBody = restored.getRigidBody(saved.bodyHandle);
        const collider = restored.getCollider(saved.colliderHandle);
        if (!rigidBody || !collider || saved.entity.destroyed) {
          restored.free();
          throw new Error(`Rapier snapshot body ${saved.id} could not be rebound`);
        }
        return this._attachBodyMethods({
          ...saved, syncRotation: saved.syncRotation !== false, rigidBody, collider,
        });
      });
      const oldByEntity = new Map(records.map(record => [record.entity, record]));
      for (const ctrl of [...this._characterControllers]) {
        if (!oldByEntity.has(ctrl.entity)) {
          ctrl.dispose();
        } else {
          ctrl._detachNative(this.world);
        }
      }
      this.eventQueue.free();
      this.world.free();
      this.world = restored;
      this.world.timestep = this.fixedDt;
      this.eventQueue = new RAPIER.EventQueue(true);
      this.bodies = records;
      this._byEntity = oldByEntity;
      this._byColliderHandle = new Map(records.map(record => [record.colliderHandle, record]));
      this._joints.clear();
      this._nextId = snapshot.nextId;
      this._tick = snapshot.tick;
      this._checksums.length = 0;
      for (const record of records) {
        syncEntityFromBody(record, dimension);
        record.entity.snapTransform?.();
      }
      for (const ctrl of this._characterControllers) {
        ctrl._rebind(this.world, this._byEntity.get(ctrl.entity));
      }
      return this;
    }

    stateChecksum() {
      this._assertAlive();
      return fnv1a(this.world.takeSnapshot());
    }

    _assertAlive() {
      if (this._disposed) throw new Error('HGame Rapier world is disposed');
    }

    dispose() {
      if (this._disposed) return false;
      for (const ctrl of [...this._characterControllers]) ctrl._detachNative(this.world);
      this._characterControllers.clear();
      this._joints.clear();
      this._disposed = true;
      this.eventQueue.free();
      this.world.free();
      this.events.clear();
      this.bodies.length = 0;
      this._byEntity.clear();
      this._byColliderHandle.clear();
      this._checksums.length = 0;
      return true;
    }
  };
}
